import type { SourceManifest } from "@/importer/types";

export const IEEE_ADAPTER_KEY = "ieee-registration-authority-csv-v1";
export const IEEE_RA_ORIGIN = "https://standards-oui.ieee.org";
export const IEEE_RIGHTS_REVIEW = "docs/rights/ieee-registration-authority.md#decision-2026-07-11";

export const IEEE_DATASETS = [
  { registry: "MA-L", slug: "ieee-ma-l", name: "IEEE Registration Authority MA-L",
    url: `${IEEE_RA_ORIGIN}/oui/oui.csv`, file: "oui.csv", prefixLength: 24, requiredForActivation: true },
  { registry: "MA-M", slug: "ieee-ma-m", name: "IEEE Registration Authority MA-M",
    url: `${IEEE_RA_ORIGIN}/oui28/mam.csv`, file: "mam.csv", prefixLength: 28, requiredForActivation: true },
  { registry: "MA-S", slug: "ieee-ma-s", name: "IEEE Registration Authority MA-S",
    url: `${IEEE_RA_ORIGIN}/oui36/oui36.csv`, file: "oui36.csv", prefixLength: 36, requiredForActivation: true },
  { registry: "IAB", slug: "ieee-iab", name: "IEEE Registration Authority legacy IAB",
    url: `${IEEE_RA_ORIGIN}/iab/iab.csv`, file: "iab.csv", prefixLength: 36, requiredForActivation: true },
  { registry: "CID", slug: "ieee-cid", name: "IEEE Registration Authority CID",
    url: `${IEEE_RA_ORIGIN}/cid/cid.csv`, file: "cid.csv", prefixLength: 24, requiredForActivation: false },
] as const;

export type IeeeDataset = typeof IEEE_DATASETS[number];

export function ieeeDatasetForManifest(manifest: SourceManifest): IeeeDataset | null {
  if (manifest.source.adapterKey !== IEEE_ADAPTER_KEY) return null;
  const dataset = IEEE_DATASETS.find((item) => item.slug === manifest.source.slug);
  if (!dataset || manifest.source.class !== "authoritative" || manifest.source.publishMode !== "production"
    || manifest.source.requiredForActivation !== dataset.requiredForActivation
    || manifest.source.fetchPolicy !== "scheduled"
    || manifest.defaults.registry !== dataset.registry || manifest.artifact.remote?.url !== dataset.url
    || manifest.artifact.remote.allowedOrigins.length !== 1
    || manifest.artifact.remote.allowedOrigins[0] !== IEEE_RA_ORIGIN
    || manifest.source.rights.status !== "approved"
    || manifest.source.rights.basis !== "public_domain_claim"
    || manifest.source.rights.distributionScope !== "api_output"
    || manifest.source.rights.reviewReference !== IEEE_RIGHTS_REVIEW) return null;
  return dataset;
}
