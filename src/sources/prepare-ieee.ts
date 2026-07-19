import { createPrivateKey, sign } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sha256 } from "@/domain/canonical-json";
import { downloadHttps, type FetchNetworkOptions } from "@/fetcher/network";
import { parseArtifact } from "@/importer/artifact";
import { loadManifest } from "@/importer/manifest";
import { IEEE_ADAPTER_KEY, IEEE_DATASETS, IEEE_RA_ORIGIN, IEEE_RIGHTS_REVIEW } from "./ieee";
import type { AdapterWarning } from "@/importer/adapters/types";
import { RECORD_NORMALIZER_VERSION, SOURCE_SCHEMA_VERSION } from "@/importer/versions";

const MAX_BYTES = 20 * 1024 * 1024;

export interface PreparedIeeeDataset {
  registry: "MA-L" | "MA-M" | "MA-S" | "IAB" | "CID";
  manifestPath: string;
  contentHash: string;
  records: number;
  bytes: number;
  adapterWarnings: AdapterWarning[];
  finalOrigin: string;
  sourceUrl: string;
}

export interface PreparedIeeeSnapshot {
  status: "prepared";
  preparedAt: string;
  output: string;
  datasets: PreparedIeeeDataset[];
}

export interface PrepareIeeeOptions {
  output?: string;
  privateKeyPath?: string;
  publicKeyPath?: string;
  now?: Date;
  networkOptions?: FetchNetworkOptions;
  download?: typeof downloadHttps;
}

async function atomicWrite(destination: string, bytes: Buffer | string): Promise<void> {
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
  await rename(temporary, destination);
  await chmod(destination, 0o600);
}

export async function prepareIeeeSources(options: PrepareIeeeOptions = {}): Promise<PreparedIeeeSnapshot> {
  const startedAt = options.now ?? new Date();
  const output = path.resolve(options.output ?? `.local/ieee/${startedAt.toISOString().slice(0, 10)}`);
  const privateKeyPath = path.resolve(options.privateKeyPath
    ?? path.join(os.homedir(), ".config/macvendor/ieee-ingest-ed25519-private.pem"));
  const publicKeySource = path.resolve(options.publicKeyPath ?? "config/keys/ieee-ingest-ed25519-public.pem");
  await mkdir(output, { recursive: true, mode: 0o700 });
  const privateKey = createPrivateKey(await readFile(privateKeyPath));
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("IEEE ingest private key must be Ed25519");
  const publicKeyBytes = await readFile(publicKeySource);
  const publicKeyHash = sha256(publicKeyBytes);
  const publicKeyName = "ieee-ingest-ed25519-public.pem";
  await copyFile(publicKeySource, path.join(output, publicKeyName));
  await chmod(path.join(output, publicKeyName), 0o600);

  const results: PreparedIeeeDataset[] = [];
  const download = options.download ?? downloadHttps;
  for (const dataset of IEEE_DATASETS) {
    const downloaded = await download(dataset.url, {
      allowedOrigins: [IEEE_RA_ORIGIN], maxRedirects: 0, maxBytes: MAX_BYTES, timeoutMs: 90_000,
      sourceSlug: dataset.slug,
    }, options.networkOptions);
    const artifactPath = path.join(output, dataset.file);
    const signatureName = `${dataset.file}.sig`;
    await atomicWrite(artifactPath, downloaded.bytes);
    await atomicWrite(path.join(output, signatureName), `${sign(null, downloaded.bytes, privateKey).toString("base64")}\n`);
    const manifest = {
      schemaVersion: "macvendor-source/v1",
      source: {
        slug: dataset.slug, name: dataset.name, class: "authoritative", publishMode: "production",
        adapterKey: IEEE_ADAPTER_KEY, fetchPolicy: "scheduled", fetchIntervalSeconds: 86_400,
        maxAcceptableAgeSeconds: 172_800, requiredForActivation: dataset.requiredForActivation,
        homepageUrl: "https://standards.ieee.org/products-programs/regauth/",
        termsUrl: "https://standards.ieee.org/faqs/regauth/",
        rights: { status: "approved", basis: "public_domain_claim", distributionScope: "api_output",
          reviewReference: IEEE_RIGHTS_REVIEW, reviewExpiresAt: "2027-07-11T00:00:00.000Z" },
      },
      release: { snapshotKind: "full_snapshot", snapshotComplete: true, schemaVersion: SOURCE_SCHEMA_VERSION,
        adapterVersion: "1", normalizerVersion: RECORD_NORMALIZER_VERSION,
        diffPolicy: { maxAddedPercent: 10, maxRemovedPercent: 2 } },
      artifact: {
        path: dataset.file, format: "csv", sha256: sha256(downloaded.bytes), signatureStatus: "verified",
        signature: { algorithm: "ed25519", origin: "operator", path: signatureName,
          publicKeyPath: publicKeyName, publicKeySha256: publicKeyHash },
        remote: { url: dataset.url, allowedOrigins: [IEEE_RA_ORIGIN], maxRedirects: 0 },
      },
      defaults: { recordKind: "assignment", originType: "imported", rightsBasis: "public_domain_claim",
        distributionScope: "api_output", verificationStatus: "single_observation", registry: dataset.registry },
    };
    const manifestPath = path.join(output, `${dataset.slug}.manifest.json`);
    await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const parsedArtifact = await parseArtifact(await loadManifest(manifestPath), manifestPath);
    results.push({ registry: dataset.registry, manifestPath, contentHash: parsedArtifact.contentHash,
      records: parsedArtifact.records.length, bytes: parsedArtifact.byteSize,
      adapterWarnings: parsedArtifact.adapterWarnings, finalOrigin: downloaded.finalOrigin, sourceUrl: dataset.url });
  }
  const preparedAt = options.now ?? new Date();
  return { status: "prepared", preparedAt: preparedAt.toISOString(), output, datasets: results };
}
