import { createPrivateKey, sign } from "node:crypto";
import { copyFile, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { load as loadHtml } from "cheerio";
import { parse } from "csv-parse/sync";
import { sha256 } from "@/domain/canonical-json";
import { formatPrefix } from "@/domain/mac";
import { parseArtifact } from "@/importer/artifact";
import { loadManifest } from "@/importer/manifest";
import type { RightsBasis, SourceManifest, VerificationStatus } from "@/importer/types";
import { RECORD_NORMALIZER_VERSION, SOURCE_SCHEMA_VERSION } from "@/importer/versions";
import { downloadHttps } from "@/fetcher/network";

const IANA_ORIGIN = "https://www.iana.org";
const IEEE_SITE_ORIGIN = "https://standards.ieee.org";
const RUNZERO_ORIGIN = "https://raw.githubusercontent.com";
const WIKIDATA_ORIGIN = "https://www.wikidata.org";
const WIRESHARK_ORIGIN = "https://gitlab.com";
const MICROSOFT_ORIGIN = "https://learn.microsoft.com";
const BROADCOM_ORIGIN = "https://knowledge.broadcom.com";
const OPENSTACK_ORIGIN = "https://opendev.org";
const PCI_ORIGIN = "https://pci-ids.ucw.cz";
const GLEIF_ORIGIN = "https://api.gleif.org";
const SEC_ORIGIN = "https://data.sec.gov";
const COMPANIES_HOUSE_ORIGIN = "https://data.companieshouse.gov.uk";
const IANA_UNICAST_URL = `${IANA_ORIGIN}/assignments/ethernet-numbers/ethernet-numbers-2.csv`;
const IANA_MULTICAST_URL = `${IANA_ORIGIN}/assignments/ethernet-numbers/ethernet-numbers-3.csv`;
const IEEE_GROUP_URL = `${IEEE_SITE_ORIGIN}/products-programs/regauth/grpmac/public/`;
const RUNZERO_HISTORY_URL = `${RUNZERO_ORIGIN}/runZeroInc/mac-tracker/main/data/macs.json`;
const RUNZERO_VIRTUAL_URL = `${RUNZERO_ORIGIN}/runZeroInc/mac-tracker/main/oui_virtual.go`;
const WIKIDATA_ENTITY = `${WIKIDATA_ORIGIN}/wiki/Special:EntityData`;
const WIRESHARK_WKA_URL = `${WIRESHARK_ORIGIN}/wireshark/wireshark/-/raw/master/wka`;
const HYPERV_URL = `${MICROSOFT_ORIGIN}/en-us/troubleshoot/windows-server/virtualization/default-limit-256-dynamic-mac-addresses`;
const VMWARE_URL = `${BROADCOM_ORIGIN}/external/article/316642`;
const OPENSTACK_MAC_URL = `${OPENSTACK_ORIGIN}/openstack/neutron/raw/branch/master/neutron/conf/common.py`;
const OPENSTACK_DVR_URL = `${OPENSTACK_ORIGIN}/openstack/neutron/raw/branch/master/neutron/conf/db/dvr_mac_db.py`;
const IANA_PEN_URL = `${IANA_ORIGIN}/assignments/enterprise-numbers.txt`;
const PCI_IDS_URL = `${PCI_ORIGIN}/v2.2/pci.ids`;
const USB_IDS_URL = `${RUNZERO_ORIGIN}/vcrhonek/hwdata/master/usb.ids`;
const MAX_BYTES = 20 * 1024 * 1024;

export const VIRTUAL_PLATFORM_RIGHTS_BASIS = {
  hyperv: "public_domain_claim",
  vmware: "public_domain_claim",
  openstack: "licensed",
} as const satisfies Record<"hyperv" | "vmware" | "openstack", RightsBasis>;

interface OutputRecord {
  prefix?: string;
  prefixLength?: string;
  recordKind: "vendor_alias" | "device_hint" | "usage_note" | "organization_identity";
  organizationName?: string;
  originType: "imported" | "derived";
  rightsBasis: RightsBasis;
  distributionScope: "api_output";
  verificationStatus: VerificationStatus;
  reviewedBy?: string;
  evidenceReference: string;
  privacyReviewReference?: string;
  observedAt?: string;
  claimValue: Record<string, unknown>;
}

interface WikidataMapping { qid: string; registeredNames: string[] }
interface IdentityMapping {
  organizationKey: string; registeredNames: string[]; pen?: string[]; pci?: string[]; usb?: string[];
  gleif?: string[]; sec?: string[]; companiesHouse?: string[];
}
interface IeeeRow { Registry: string; Assignment: string; "Organization Name": string }
interface RunZeroEvent { d?: string; t?: string; a?: string; c?: string; o?: string; s?: string }

function clean(value: string): string {
  return value.normalize("NFC")
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu, " ")
    .replace(/\s+/gu, " ").trim();
}

function parseMac(value: string): bigint {
  const hex = value.replaceAll("-", "").replaceAll(":", "").trim();
  if (!/^[0-9A-Fa-f]{12}$/.test(hex)) throw new Error(`invalid EUI-48 value: ${value}`);
  return BigInt(`0x${hex}`);
}

export function rangeToPrefixes(start: bigint, end: bigint): Array<{ bits: bigint; length: number }> {
  if (start < 0n || end > 0xffffffffffffn || start > end) throw new Error("invalid EUI-48 range");
  const result: Array<{ bits: bigint; length: number }> = [];
  let current = start;
  while (current <= end) {
    let size = current === 0n ? 1n << 48n : current & -current;
    const remaining = end - current + 1n;
    while (size > remaining) size >>= 1n;
    const hostBits = size.toString(2).length - 1;
    const length = 48 - hostBits;
    result.push({ bits: current >> BigInt(hostBits), length });
    current += size;
  }
  return result;
}

function rangeText(value: string, base: bigint): Array<{ bits: bigint; length: number }> {
  const parts = value.split(/\s+to\s+/iu);
  const suffix = (item: string) => BigInt(`0x${item.replaceAll("-", "").trim()}`);
  const start = base | suffix(parts[0]!);
  const end = base | suffix(parts[1] ?? parts[0]!);
  return rangeToPrefixes(start, end);
}

function outputPrefix(item: { bits: bigint; length: number }): Pick<OutputRecord, "prefix" | "prefixLength"> {
  return { prefix: formatPrefix(item.bits, item.length), prefixLength: String(item.length) };
}

async function download(url: string, origins: string[], accept: "application/octet-stream" | "application/json" = "application/octet-stream"): Promise<Buffer> {
  return (await downloadHttps(url, {
    allowedOrigins: origins, maxRedirects: 0, maxBytes: MAX_BYTES, timeoutMs: 60_000, accept,
  })).bytes;
}

async function ianaRecords(): Promise<OutputRecord[]> {
  const inputs = [
    { url: IANA_UNICAST_URL, base: 0x00005e000000n, scope: "IANA unicast" },
    { url: IANA_MULTICAST_URL, base: 0x01005e000000n, scope: "IANA multicast" },
  ];
  const records: OutputRecord[] = [];
  for (const input of inputs) {
    const rows = parse(await download(input.url, [IANA_ORIGIN]), {
      columns: true, bom: true, skip_empty_lines: true, relax_column_count: false,
    }) as Array<{ Addresses: string; Usage: string; Reference: string }>;
    for (const row of rows) {
      if (!row.Addresses || !row.Usage) throw new Error("IANA Ethernet Numbers schema changed");
      for (const prefix of rangeText(row.Addresses, input.base)) {
        records.push({ ...outputPrefix(prefix), recordKind: "usage_note", originType: "imported",
          rightsBasis: "public_domain_claim", distributionScope: "api_output",
          verificationStatus: "reviewed", reviewedBy: "operator:iana-registry-review-2026-07-12",
          evidenceReference: input.url,
          privacyReviewReference: prefix.length >= 37 ? "docs/privacy.md#group-and-protocol-addresses" : undefined,
          claimValue: { usage: clean(row.Usage), reference: clean(row.Reference ?? ""), scope: input.scope } });
      }
    }
  }
  return records;
}

async function ieeeGroupRecords(): Promise<OutputRecord[]> {
  const html = (await download(IEEE_GROUP_URL, [IEEE_SITE_ORIGIN])).toString("utf8");
  const $ = loadHtml(html);
  const records: OutputRecord[] = [];
  $("table tr").each((_index, element) => {
    const cells = $(element).find("td").map((_cell, td) => clean($(td).text())).get();
    if (!cells.length) return;
    const addresses = cells[0]!.match(/\b[0-9A-F]{2}(?:-[0-9A-F]{2}){5}\b/giu) ?? [];
    if (!addresses.length) return;
    const start = parseMac(addresses[0]!);
    const end = parseMac(addresses[1] ?? addresses[0]!);
    for (const prefix of rangeToPrefixes(start, end)) {
      records.push({ ...outputPrefix(prefix), recordKind: "usage_note",
        organizationName: cells[1] || undefined, originType: "imported",
        rightsBasis: "public_domain_claim", distributionScope: "api_output",
        verificationStatus: "reviewed", reviewedBy: "operator:ieee-group-mac-review-2026-07-12",
        evidenceReference: IEEE_GROUP_URL,
        privacyReviewReference: prefix.length >= 37 ? "docs/privacy.md#group-and-protocol-addresses" : undefined,
        claimValue: { organization: cells[1] ?? "", standard: cells[2] ?? "", notes: cells.slice(3).join(" ") } });
    }
  });
  if (records.length < 50) throw new Error("IEEE group MAC public listing produced too few records");
  return records;
}

export function wiresharkWkaRecords(source: string): OutputRecord[] {
  const records: OutputRecord[] = [];
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    const value = line.trim();
    if (!value || value.startsWith("#")) continue;
    const [address, ...labelParts] = value.split(/\s+/u);
    const match = /^([0-9A-Fa-f]{2}(?:-[0-9A-Fa-f]{2}){2,5})(?:\/(\d{1,2}))?$/.exec(address ?? "");
    if (!match || !labelParts.length) throw new Error(`invalid Wireshark WKA row ${index + 1}`);
    const octets = match[1]!.split("-");
    const length = match[2] ? Number(match[2]) : octets.length * 8;
    if (length < 1 || length > 48) throw new Error(`invalid Wireshark WKA prefix row ${index + 1}`);
    const padded = `${octets.join("")}${"00".repeat(6 - octets.length)}`;
    const bits = BigInt(`0x${padded}`) >> BigInt(48 - length);
    const label = clean(labelParts.join(" "));
    records.push({ ...outputPrefix({ bits, length }), recordKind: "usage_note", originType: "imported",
      rightsBasis: "licensed", distributionScope: "api_output", verificationStatus: "reviewed",
      reviewedBy: "operator:wireshark-wka-review-2026-07-12", evidenceReference: WIRESHARK_WKA_URL,
      privacyReviewReference: length >= 37 ? "docs/privacy.md#group-and-protocol-addresses" : undefined,
      claimValue: { usage: label, sourceLine: index + 1, scope: "Wireshark well-known address" } });
  }
  if (records.length < 50) throw new Error("Wireshark WKA produced too few records");
  return records;
}

function reviewedHint(prefix: string, platform: string, evidenceReference: string,
  details: Record<string, unknown>): OutputRecord {
  const length = 24;
  return { prefix, prefixLength: String(length), recordKind: "device_hint", organizationName: platform,
    originType: "derived", rightsBasis: "permission_granted", distributionScope: "api_output",
    verificationStatus: "reviewed", reviewedBy: "operator:virtual-mac-review-2026-07-12", evidenceReference,
    claimValue: { platform, confidence: "possible", configurable: true, ...details } };
}

function identityRecord(mapping: IdentityMapping, scheme: string, identifier: string, organizationName: string,
  aliases: string[], evidenceReference: string, rightsBasis: RightsBasis, extra: Record<string, unknown> = {}): OutputRecord {
  return { recordKind: "organization_identity", organizationName: clean(organizationName), originType: "imported",
    rightsBasis, distributionScope: "api_output", verificationStatus: "reviewed",
    reviewedBy: "operator:organization-identity-review-2026-07-12", evidenceReference,
    claimValue: { organizationKey: mapping.organizationKey, scheme, identifier,
      registeredNames: mapping.registeredNames.map(clean), aliases: aliases.map(clean).filter(Boolean), ...extra } };
}

function vendorIdRecords(source: string, mappings: IdentityMapping[], field: "pci" | "usb", scheme: string,
  evidenceReference: string): OutputRecord[] {
  const names = new Map<string,string>();
  for (const line of source.split(/\r?\n/u)) {
    const match = /^([0-9A-Fa-f]{4})  (.+)$/u.exec(line);
    if (match) names.set(match[1]!.toLowerCase(), clean(match[2]!));
  }
  const records: OutputRecord[] = [];
  for (const mapping of mappings) for (const identifier of mapping[field] ?? []) {
    const name = names.get(identifier.toLowerCase());
    if (!name) throw new Error(`${scheme} identifier ${identifier} is missing`);
    records.push(identityRecord(mapping, scheme, identifier.toLowerCase(), name, [], evidenceReference, "licensed"));
  }
  return records;
}

async function organizationIdentityRecords(mappingPath: string): Promise<Record<string, OutputRecord[]>> {
  const mappings = JSON.parse(await readFile(mappingPath, "utf8")) as IdentityMapping[];
  if (!mappings.length || new Set(mappings.map((item) => item.organizationKey)).size !== mappings.length) {
    throw new Error("organization identity mappings must contain unique organizationKey values");
  }
  const [penBytes, pciBytes, usbBytes] = await Promise.all([
    download(IANA_PEN_URL, [IANA_ORIGIN]), download(PCI_IDS_URL, [PCI_ORIGIN]), download(USB_IDS_URL, [RUNZERO_ORIGIN]),
  ]);
  const penNames = new Map<string,string>();
  for (const match of penBytes.toString("utf8").matchAll(/^(\d+)\r?\n {2}([^\r\n]+)$/gmu)) {
    penNames.set(match[1]!, clean(match[2]!));
  }
  const pen: OutputRecord[] = [];
  for (const mapping of mappings) for (const identifier of mapping.pen ?? []) {
    const name = penNames.get(identifier);
    if (!name) throw new Error(`IANA PEN ${identifier} is missing`);
    pen.push(identityRecord(mapping, "iana-pen", identifier, name, [], IANA_PEN_URL, "public_domain_claim"));
  }
  const pci = vendorIdRecords(pciBytes.toString("utf8"), mappings, "pci", "pci-vendor-id", PCI_IDS_URL);
  const usb = vendorIdRecords(usbBytes.toString("utf8"), mappings, "usb", "usb-vendor-id", USB_IDS_URL);
  const gleif: OutputRecord[] = [];
  const sec: OutputRecord[] = [];
  const companiesHouse: OutputRecord[] = [];
  for (const mapping of mappings) {
    for (const identifier of mapping.gleif ?? []) {
      const url = `${GLEIF_ORIGIN}/api/v1/lei-records/${identifier}`;
      const body = JSON.parse((await download(url, [GLEIF_ORIGIN], "application/json")).toString("utf8")) as {
        data?: { id?: string; attributes?: { entity?: { legalName?: { name?: string }; otherNames?: Array<{ name?: string }>;
          legalAddress?: { country?: string }; registeredAs?: string }; registration?: { status?: string } } };
      };
      const data = body.data;
      const legalName = clean(data?.attributes?.entity?.legalName?.name ?? "");
      if (data?.id !== identifier || !legalName) throw new Error(`GLEIF LEI ${identifier} response is invalid`);
      gleif.push(identityRecord(mapping, "lei", identifier, legalName,
        (data.attributes?.entity?.otherNames ?? []).flatMap((item) => item.name ? [item.name] : []), url,
        "public_domain_claim", { country: data.attributes?.entity?.legalAddress?.country ?? null,
          registrationStatus: data.attributes?.registration?.status ?? null,
          registeredAs: data.attributes?.entity?.registeredAs ?? null }));
    }
    for (const identifier of mapping.sec ?? []) {
      const url = `${SEC_ORIGIN}/submissions/CIK${identifier}.json`;
      const body = JSON.parse((await download(url, [SEC_ORIGIN], "application/json")).toString("utf8")) as {
        cik?: number; name?: string; formerNames?: Array<{ name?: string; from?: string; to?: string }>;
        tickers?: string[]; exchanges?: string[]; stateOfIncorporation?: string;
      };
      if (String(body.cik ?? "").padStart(10, "0") !== identifier || !body.name) throw new Error(`SEC CIK ${identifier} response is invalid`);
      sec.push(identityRecord(mapping, "sec-cik", identifier, body.name,
        (body.formerNames ?? []).flatMap((item) => item.name ? [item.name] : []), url, "public_domain_claim",
        { tickers: body.tickers ?? [], exchanges: body.exchanges ?? [], stateOfIncorporation: body.stateOfIncorporation ?? null }));
    }
    for (const identifier of mapping.companiesHouse ?? []) {
      const url = `${COMPANIES_HOUSE_ORIGIN}/doc/company/${identifier}.json`;
      const body = JSON.parse((await download(url, [COMPANIES_HOUSE_ORIGIN], "application/json")).toString("utf8")) as {
        primaryTopic?: { CompanyName?: string; CompanyNumber?: string; CompanyStatus?: string; PreviousCompanyName?: string[] };
      };
      const company = body.primaryTopic;
      if (company?.CompanyNumber !== identifier || !company.CompanyName) throw new Error(`Companies House ${identifier} response is invalid`);
      companiesHouse.push(identityRecord(mapping, "uk-company-number", identifier, company.CompanyName,
        Array.isArray(company.PreviousCompanyName) ? company.PreviousCompanyName : [], url, "licensed",
        { companyStatus: company.CompanyStatus ?? null }));
    }
  }
  return { pen, pci, usb, gleif, sec, companiesHouse };
}

async function officialVirtualPlatformRecords(): Promise<{
  wireshark: OutputRecord[]; hyperv: OutputRecord[]; vmware: OutputRecord[]; openstack: OutputRecord[];
}> {
  const [wka, hypervPage, vmwarePage, openstackSource, openstackDvrSource] = await Promise.all([
    download(WIRESHARK_WKA_URL, [WIRESHARK_ORIGIN]), download(HYPERV_URL, [MICROSOFT_ORIGIN]),
    download(VMWARE_URL, [BROADCOM_ORIGIN]), download(OPENSTACK_MAC_URL, [OPENSTACK_ORIGIN]),
    download(OPENSTACK_DVR_URL, [OPENSTACK_ORIGIN]),
  ]);
  const hypervText = hypervPage.toString("utf8").toLowerCase();
  const vmwareText = vmwarePage.toString("utf8").toLowerCase();
  const openstackText = openstackSource.toString("utf8").toLowerCase();
  const openstackDvrText = openstackDvrSource.toString("utf8").toLowerCase();
  if (!hypervText.includes("00:15:5d") && !hypervText.includes("00-15-5d")) throw new Error("Hyper-V source no longer documents 00:15:5D");
  if (!vmwareText.includes("00:0c:29") || !vmwareText.includes("00:50:56")) throw new Error("VMware source no longer documents expected prefixes");
  if (!openstackText.includes("fa:16:3e") || !openstackDvrText.includes("fa:16:3f")) throw new Error("OpenStack source no longer documents expected base MACs");
  return {
    wireshark: wiresharkWkaRecords(wka.toString("utf8")),
    hyperv: [reviewedHint("00155D", "Microsoft Hyper-V", HYPERV_URL, { allocation: "dynamic virtual NIC" })],
    vmware: ["000C29", "005056"].map((prefix) => reviewedHint(prefix, "VMware", VMWARE_URL, { allocation: "virtual NIC" })),
    openstack: [
      reviewedHint("FA163E", "OpenStack Neutron", OPENSTACK_MAC_URL, { allocation: "tenant port default base" }),
      reviewedHint("FA163F", "OpenStack Neutron", OPENSTACK_DVR_URL, { allocation: "distributed router default base" }),
    ],
  };
}

function runZeroHistoryRecords(input: Record<string, RunZeroEvent[]>): OutputRecord[] {
  const records: OutputRecord[] = [];
  for (const [range, events] of Object.entries(input)) {
    const match = /^([0-9a-fA-F]{12})\/(24|28|36)$/.exec(range);
    if (!match || !Array.isArray(events) || !events.length) continue;
    const currentName = clean([...events].reverse().find((event) => event.o)?.o ?? "");
    if (!currentName || currentName.toUpperCase() === "PRIVATE") continue;
    const aliases = new Map<string, RunZeroEvent[]>();
    for (const event of events) {
      const name = clean(event.o ?? "");
      if (!name || name.toUpperCase() === "PRIVATE" || /^\d+$/u.test(name)
        || name.toUpperCase() === currentName.toUpperCase()) continue;
      aliases.set(name, [...(aliases.get(name) ?? []), event]);
    }
    const length = Number(match[2]);
    const bits = BigInt(`0x${match[1]}`) >> BigInt(48 - length);
    for (const [alias, aliasEvents] of aliases) {
      records.push({ ...outputPrefix({ bits, length }), recordKind: "vendor_alias", organizationName: alias,
        originType: "imported", rightsBasis: "licensed", distributionScope: "api_output",
        verificationStatus: "single_observation", evidenceReference: RUNZERO_HISTORY_URL,
        claimValue: { registeredName: currentName, alias,
          firstSeen: aliasEvents[0]?.d ?? null, lastSeen: aliasEvents.at(-1)?.d ?? null,
          country: aliasEvents.at(-1)?.c ?? null } });
    }
  }
  return records;
}

export function runZeroVirtualRecords(source: string): OutputRecord[] {
  const records: OutputRecord[] = [];
  const pattern = /"([0-9a-f]{12})\/(24|28|36)":\s*\{[^\n]*?Vendor:\s*"([^"]+)"[^\n]*?Added:\s*"([^"]+)"[^\n]*?Virtual:\s*VirtType([A-Za-z0-9]+)\}/gu;
  for (const match of source.matchAll(pattern)) {
    const length = Number(match[2]);
    const bits = BigInt(`0x${match[1]}`) >> BigInt(48 - length);
    records.push({ ...outputPrefix({ bits, length }), recordKind: "device_hint",
      organizationName: clean(match[3]!), originType: "imported", rightsBasis: "licensed",
      distributionScope: "api_output", verificationStatus: "reviewed",
      reviewedBy: "operator:runzero-virtual-prefix-review-2026-07-12",
      evidenceReference: RUNZERO_VIRTUAL_URL,
      claimValue: { platform: match[5], vendor: clean(match[3]!), added: match[4] } });
  }
  return records;
}

async function runZeroRecords(): Promise<OutputRecord[]> {
  const [history, virtual] = await Promise.all([
    download(RUNZERO_HISTORY_URL, [RUNZERO_ORIGIN]), download(RUNZERO_VIRTUAL_URL, [RUNZERO_ORIGIN]),
  ]);
  const virtualRecords = runZeroVirtualRecords(virtual.toString("utf8"));
  if (virtualRecords.length < 10) throw new Error("runZero virtual prefix parser produced too few records");
  return [
    ...runZeroHistoryRecords(JSON.parse(history.toString("utf8")) as Record<string, RunZeroEvent[]>),
    ...virtualRecords,
  ];
}

async function wikidataRecords(ieeeDirectory: string, mappingPath: string): Promise<OutputRecord[]> {
  const mappings = JSON.parse(await readFile(mappingPath, "utf8")) as WikidataMapping[];
  const names = new Map(mappings.flatMap((mapping) => mapping.registeredNames.map((name) => [clean(name), mapping])));
  const rows: IeeeRow[] = [];
  for (const file of ["oui.csv", "mam.csv", "oui36.csv", "iab.csv", "cid.csv"]) {
    rows.push(...parse(await readFile(path.join(ieeeDirectory, file)), {
      columns: true, bom: true, skip_empty_lines: true, relax_column_count: false,
    }) as IeeeRow[]);
  }
  const entities = new Map<string, { label: string; aliases: string[] }>();
  for (const mapping of mappings) {
    const url = `${WIKIDATA_ENTITY}/${mapping.qid}.json`;
    const body = JSON.parse((await download(url, [WIKIDATA_ORIGIN])).toString("utf8")) as {
      entities: Record<string, { labels?: Record<string, { value: string }>; aliases?: Record<string, Array<{ value: string }>> }>;
    };
    const entity = body.entities[mapping.qid];
    const label = clean(entity?.labels?.en?.value ?? entity?.labels?.mul?.value ?? "");
    if (!label) throw new Error(`Wikidata entity ${mapping.qid} has no English label`);
    entities.set(mapping.qid, { label, aliases: (entity?.aliases?.en ?? []).map((item) => clean(item.value)).filter(Boolean) });
  }
  const records: OutputRecord[] = [];
  for (const row of rows) {
    const mapping = names.get(clean(row["Organization Name"]));
    if (!mapping) continue;
    const entity = entities.get(mapping.qid)!;
    const length = row.Registry === "MA-M" ? 28 : row.Registry === "MA-S" || row.Registry === "IAB" ? 36 : 24;
    const bits = BigInt(`0x${row.Assignment}`) >> BigInt(Math.ceil(length / 4) * 4 - length);
    records.push({ ...outputPrefix({ bits, length }), recordKind: "vendor_alias", organizationName: entity.label,
      originType: "imported", rightsBasis: "public_domain_claim", distributionScope: "api_output",
      verificationStatus: "reviewed", reviewedBy: "operator:wikidata-mapping-review-2026-07-12",
      evidenceReference: `${WIKIDATA_ENTITY}/${mapping.qid}.json`,
      claimValue: { wikidataId: mapping.qid, registeredName: clean(row["Organization Name"]), aliases: entity.aliases } });
  }
  if (!records.length) throw new Error("Wikidata mapping produced no records");
  return records;
}

interface SourceDefinition {
  slug: string; name: string; homepageUrl: string; termsUrl: string; rightsBasis: RightsBasis;
  reviewReference: string; records: OutputRecord[]; maxAddedPercent: number; maxRemovedPercent: number;
}

async function writeSource(definition: SourceDefinition, output: string, privateKeyPath: string,
  publicKeyPath: string): Promise<{ slug: string; manifestPath: string; recordCount: number; contentHash: string }> {
  const artifactName = `${definition.slug}.jsonl`;
  const signatureName = `${artifactName}.sig`;
  const publicKeyName = "enrichment-ingest-ed25519-public.pem";
  const records = [...new Map(definition.records.map((record) => [JSON.stringify(record), record])).values()];
  const artifact = Buffer.from(`${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  const privateKey = createPrivateKey(await readFile(privateKeyPath));
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("enrichment ingest key must be Ed25519");
  const publicKey = await readFile(publicKeyPath);
  await writeFile(path.join(output, artifactName), artifact, { mode: 0o600 });
  await writeFile(path.join(output, signatureName), `${sign(null, artifact, privateKey).toString("base64")}\n`, { mode: 0o600 });
  await copyFile(publicKeyPath, path.join(output, publicKeyName));
  await chmod(path.join(output, publicKeyName), 0o600);
  const manifest: SourceManifest = {
    schemaVersion: "macvendor-source/v1",
    source: { slug: definition.slug, name: definition.name, class: "enrichment", publishMode: "production",
      adapterKey: "strict-delimited-v1", fetchPolicy: "scheduled", fetchIntervalSeconds: 86_400,
      maxAcceptableAgeSeconds: 604_800, requiredForActivation: false,
      homepageUrl: definition.homepageUrl, termsUrl: definition.termsUrl,
      rights: { status: "approved", basis: definition.rightsBasis, distributionScope: "api_output",
        reviewReference: definition.reviewReference, reviewExpiresAt: "2027-07-12T00:00:00.000Z" } },
    release: { snapshotKind: "full_snapshot", snapshotComplete: true, schemaVersion: SOURCE_SCHEMA_VERSION,
      adapterVersion: "1", normalizerVersion: RECORD_NORMALIZER_VERSION,
      diffPolicy: { maxAddedPercent: definition.maxAddedPercent, maxRemovedPercent: definition.maxRemovedPercent } },
    artifact: { path: artifactName, format: "jsonl", sha256: sha256(artifact), signatureStatus: "verified",
      signature: { algorithm: "ed25519", origin: "operator", path: signatureName,
        publicKeyPath: publicKeyName, publicKeySha256: sha256(publicKey) } },
    defaults: { recordKind: "usage_note", originType: "imported", rightsBasis: definition.rightsBasis,
      distributionScope: "api_output", verificationStatus: "single_observation" },
  };
  const manifestPath = path.join(output, `${definition.slug}.manifest.json`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  const parsed = await parseArtifact(await loadManifest(manifestPath), manifestPath);
  return { slug: definition.slug, manifestPath, recordCount: parsed.records.length, contentHash: parsed.contentHash };
}

export interface PrepareEnrichmentOptions {
  output?: string; ieeeDirectory: string; mappingPath?: string; identityMappingPath?: string;
  privateKeyPath?: string; publicKeyPath?: string; now?: Date;
}

export async function prepareEnrichmentSources(options: PrepareEnrichmentOptions) {
  const now = options.now ?? new Date();
  const output = path.resolve(options.output ?? `.local/enrichments/${now.toISOString().slice(0, 10)}`);
  const privateKeyPath = path.resolve(options.privateKeyPath
    ?? path.join(os.homedir(), ".config/macvendor/ieee-ingest-ed25519-private.pem"));
  const publicKeyPath = path.resolve(options.publicKeyPath ?? "config/keys/ieee-ingest-ed25519-public.pem");
  const mappingPath = path.resolve(options.mappingPath ?? "config/wikidata-alias-mappings.json");
  const identityMappingPath = path.resolve(options.identityMappingPath ?? "config/organization-identity-mappings.json");
  await mkdir(output, { recursive: true, mode: 0o700 });
  const observedAt = now.toISOString();
  const [iana, ieeeGroup, runZero, wikidata, virtualPlatforms, identities] = await Promise.all([
    ianaRecords(), ieeeGroupRecords(), runZeroRecords(),
    wikidataRecords(path.resolve(options.ieeeDirectory), mappingPath), officialVirtualPlatformRecords(),
    organizationIdentityRecords(identityMappingPath),
  ]);
  const definitions: SourceDefinition[] = [
    { slug: "iana-ethernet-numbers", name: "IANA Ethernet Numbers", homepageUrl: `${IANA_ORIGIN}/assignments/ethernet-numbers/ethernet-numbers.xhtml`,
      termsUrl: `${IANA_ORIGIN}/help/licensing-terms`, rightsBasis: "public_domain_claim",
      reviewReference: "docs/rights/iana-protocol-registries.md#decision-2026-07-12", records: iana,
      maxAddedPercent: 30, maxRemovedPercent: 10 },
    { slug: "ieee-group-mac", name: "IEEE Standards Group MAC Public Listing", homepageUrl: IEEE_GROUP_URL,
      termsUrl: "https://standards.ieee.org/faqs/regauth/", rightsBasis: "public_domain_claim",
      reviewReference: "docs/rights/ieee-registration-authority.md#group-mac-decision-2026-07-12", records: ieeeGroup,
      maxAddedPercent: 20, maxRemovedPercent: 5 },
    { slug: "runzero-mac-tracker", name: "runZero MAC assignment history and virtual prefixes",
      homepageUrl: "https://github.com/runZeroInc/mac-tracker", termsUrl: "https://github.com/runZeroInc/mac-tracker/blob/main/LICENSE",
      rightsBasis: "licensed", reviewReference: "docs/rights/runzero-mac-tracker.md#decision-2026-07-12", records: runZero,
      maxAddedPercent: 30, maxRemovedPercent: 10 },
    { slug: "wikidata-vendor-aliases", name: "Reviewed Wikidata vendor aliases", homepageUrl: "https://www.wikidata.org/",
      termsUrl: "https://www.wikidata.org/wiki/Wikidata:Licensing", rightsBasis: "public_domain_claim",
      reviewReference: "docs/rights/wikidata.md#decision-2026-07-12", records: wikidata,
      maxAddedPercent: 50, maxRemovedPercent: 20 },
    { slug: "wireshark-well-known-addresses", name: "Wireshark well-known MAC addresses", homepageUrl: WIRESHARK_WKA_URL,
      termsUrl: "https://gitlab.com/wireshark/wireshark/-/blob/master/COPYING", rightsBasis: "licensed",
      reviewReference: "docs/rights/wireshark-wka.md#decision-2026-07-12", records: virtualPlatforms.wireshark,
      maxAddedPercent: 30, maxRemovedPercent: 15 },
    { slug: "microsoft-hyperv-mac-hints", name: "Microsoft Hyper-V MAC allocation hints", homepageUrl: HYPERV_URL,
      termsUrl: "https://learn.microsoft.com/legal/termsofuse", rightsBasis: VIRTUAL_PLATFORM_RIGHTS_BASIS.hyperv,
      reviewReference: "docs/rights/virtual-platform-mac-hints.md#decision-2026-07-12", records: virtualPlatforms.hyperv,
      maxAddedPercent: 100, maxRemovedPercent: 100 },
    { slug: "vmware-mac-hints", name: "VMware MAC allocation hints", homepageUrl: VMWARE_URL,
      termsUrl: "https://www.broadcom.com/company/legal/terms-of-use", rightsBasis: VIRTUAL_PLATFORM_RIGHTS_BASIS.vmware,
      reviewReference: "docs/rights/virtual-platform-mac-hints.md#decision-2026-07-12", records: virtualPlatforms.vmware,
      maxAddedPercent: 100, maxRemovedPercent: 100 },
    { slug: "openstack-neutron-mac-hints", name: "OpenStack Neutron default MAC hints", homepageUrl: OPENSTACK_MAC_URL,
      termsUrl: "https://opendev.org/openstack/neutron/src/branch/master/LICENSE",
      rightsBasis: VIRTUAL_PLATFORM_RIGHTS_BASIS.openstack,
      reviewReference: "docs/rights/virtual-platform-mac-hints.md#decision-2026-07-12", records: virtualPlatforms.openstack,
      maxAddedPercent: 100, maxRemovedPercent: 100 },
    { slug: "iana-private-enterprise-numbers", name: "IANA Private Enterprise Numbers", homepageUrl: IANA_PEN_URL,
      termsUrl: `${IANA_ORIGIN}/help/licensing-terms`, rightsBasis: "public_domain_claim",
      reviewReference: "docs/rights/organization-identity-sources.md#iana-pen", records: identities.pen,
      maxAddedPercent: 50, maxRemovedPercent: 20 },
    { slug: "pci-id-repository", name: "PCI ID Repository reviewed vendors", homepageUrl: PCI_IDS_URL,
      termsUrl: "https://pci-ids.ucw.cz/", rightsBasis: "licensed",
      reviewReference: "docs/rights/organization-identity-sources.md#pci-ids", records: identities.pci,
      maxAddedPercent: 50, maxRemovedPercent: 20 },
    { slug: "hwdata-usb-vendors", name: "hwdata USB vendor identifiers", homepageUrl: USB_IDS_URL,
      termsUrl: "https://github.com/vcrhonek/hwdata/blob/master/LICENSE", rightsBasis: "licensed",
      reviewReference: "docs/rights/organization-identity-sources.md#usb-ids", records: identities.usb,
      maxAddedPercent: 50, maxRemovedPercent: 20 },
    { slug: "gleif-lei-identities", name: "GLEIF reviewed legal entities", homepageUrl: `${GLEIF_ORIGIN}/api/v1/lei-records`,
      termsUrl: "https://www.gleif.org/en/meta/lei-data-terms-of-use", rightsBasis: "public_domain_claim",
      reviewReference: "docs/rights/organization-identity-sources.md#gleif", records: identities.gleif,
      maxAddedPercent: 50, maxRemovedPercent: 20 },
    { slug: "sec-edgar-identities", name: "SEC EDGAR reviewed filer identities", homepageUrl: `${SEC_ORIGIN}/submissions/`,
      termsUrl: "https://www.sec.gov/about/developer-resources", rightsBasis: "public_domain_claim",
      reviewReference: "docs/rights/organization-identity-sources.md#sec-edgar", records: identities.sec,
      maxAddedPercent: 50, maxRemovedPercent: 20 },
    { slug: "companies-house-identities", name: "Companies House reviewed legal entities", homepageUrl: COMPANIES_HOUSE_ORIGIN,
      termsUrl: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/", rightsBasis: "licensed",
      reviewReference: "docs/rights/organization-identity-sources.md#companies-house", records: identities.companiesHouse,
      maxAddedPercent: 50, maxRemovedPercent: 20 },
  ];
  const sources = [];
  for (const definition of definitions) sources.push(await writeSource(definition, output, privateKeyPath, publicKeyPath));
  return { status: "prepared" as const, preparedAt: observedAt, output, sources };
}
