import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArtifact } from "../src/importer/artifact";
import { loadManifest } from "../src/importer/manifest";
import { RECORD_NORMALIZER_VERSION, SOURCE_SCHEMA_VERSION } from "../src/importer/versions";

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: string[], label: string) {
  const unexpected = Object.keys(value).filter((key) => !keys.includes(key));
  const missing = keys.filter((key) => !(key in value));
  if (unexpected.length || missing.length) throw new Error(`${label} fields do not match owner-source-declaration/v1`);
}
function text(value: unknown, label: string, pattern?: RegExp): string {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > 2_048 || (pattern && !pattern.test(value))) {
    throw new Error(`${label} is invalid`);
  }
  return value.trim();
}
function httpsUrl(value: unknown, label: string): string {
  const candidate = text(value, label);
  const url = new URL(candidate);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error(`${label} must be a safe HTTPS URL`);
  return candidate;
}

const flags = new Map<string, string>();
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 2) {
  const key = args[index], value = args[index + 1];
  if (!key?.startsWith("--") || !value || value.startsWith("--") || flags.has(key)) throw new Error("invalid arguments");
  flags.set(key, value);
}
if ([...flags.keys()].some((key) => !["--declaration", "--records", "--output"].includes(key))
  || !flags.get("--declaration") || !flags.get("--records") || !flags.get("--output")) {
  throw new Error("Usage: npm run owner:prepare -- --declaration declaration.json --records records.jsonl --output directory");
}

const declarationPath = path.resolve(flags.get("--declaration")!);
const recordsPath = path.resolve(flags.get("--records")!);
const output = path.resolve(flags.get("--output")!);
const declaration = object(JSON.parse(await readFile(declarationPath, "utf8")), "declaration");
exactKeys(declaration, ["schemaVersion", "source", "collection", "rights", "release"], "declaration");
if (declaration.schemaVersion !== "owner-source-declaration/v1") throw new Error("unsupported declaration schema");
const source = object(declaration.source, "source");
exactKeys(source, ["slug", "name", "homepageUrl", "termsUrl"], "source");
const collection = object(declaration.collection, "collection");
exactKeys(collection, ["owner", "method", "contactReference", "privacyReviewReference"], "collection");
const rights = object(declaration.rights, "rights");
exactKeys(rights, ["statement", "permissionReference"], "rights");
const release = object(declaration.release, "release");
exactKeys(release, ["observedAt"], "release");

const slug = text(source.slug, "source.slug", /^[a-z0-9][a-z0-9-]{2,62}$/);
const observedAt = text(release.observedAt, "release.observedAt", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
if (Number.isNaN(Date.parse(observedAt)) || Date.parse(observedAt) > Date.now() + 300_000) throw new Error("release.observedAt is invalid");
text(collection.owner, "collection.owner");
text(collection.method, "collection.method");
text(collection.contactReference, "collection.contactReference", /^[a-z0-9][a-z0-9:_.\/-]{2,255}$/i);
text(collection.privacyReviewReference, "collection.privacyReviewReference");
text(rights.statement, "rights.statement");
const permissionReference = text(rights.permissionReference, "rights.permissionReference");
const bytes = await readFile(recordsPath);
if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error("records must contain 1 byte..20 MiB");

await mkdir(output, { recursive: true, mode: 0o700 });
const artifactName = `${slug}.jsonl`;
await copyFile(recordsPath, path.join(output, artifactName));
const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const manifest = {
  schemaVersion: "macvendor-source/v1",
  source: {
    slug, name: text(source.name, "source.name"), class: "owner_curated", publishMode: "qa_only",
    adapterKey: "strict-delimited-v1", fetchPolicy: "manual", requiredForActivation: false,
    homepageUrl: httpsUrl(source.homepageUrl, "source.homepageUrl"), termsUrl: httpsUrl(source.termsUrl, "source.termsUrl"),
    rights: { status: "owner_asserted", basis: "owner_created", distributionScope: "internal_only", reviewReference: permissionReference },
  },
  release: { snapshotKind: "full_snapshot", snapshotComplete: true, schemaVersion: SOURCE_SCHEMA_VERSION,
    adapterVersion: "1", normalizerVersion: RECORD_NORMALIZER_VERSION },
  artifact: { path: artifactName, format: "jsonl", sha256: digest, signatureStatus: "not_applicable" },
  defaults: { recordKind: "curated_vendor_claim", originType: "owner_observation", rightsBasis: "owner_created",
    distributionScope: "internal_only", verificationStatus: "unverified" },
};
const manifestPath = path.join(output, `${slug}.manifest.json`);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
const parsed = await parseArtifact(await loadManifest(manifestPath), manifestPath);
process.stdout.write(`${JSON.stringify({ status: "prepared_qa_only", slug, manifestPath,
  records: parsed.records.length, contentHash: parsed.contentHash,
  review: { collectionMethod: collection.method, privacyReviewReference: collection.privacyReviewReference,
    rightsStatement: rights.statement, permissionReference } }, null, 2)}\n`);
