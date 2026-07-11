import "./env";
import { createPrivateKey, sign } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sha256 } from "../src/domain/canonical-json";
import { downloadHttps } from "../src/fetcher/network";
import { parseArtifact } from "../src/importer/artifact";
import { loadManifest } from "../src/importer/manifest";
import {
  IEEE_ADAPTER_KEY, IEEE_DATASETS, IEEE_RA_ORIGIN, IEEE_RIGHTS_REVIEW,
} from "../src/sources/ieee";

const MAX_BYTES = 20 * 1024 * 1024;
const PUBLIC_KEY_SOURCE = path.resolve("config/keys/ieee-ingest-ed25519-public.pem");

function argumentsFrom(values: string[]) {
  const flags = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || flags.has(key)) {
      throw new Error("Usage: npm run source:prepare:ieee -- [--output path] [--private-key path]");
    }
    flags.set(key, value);
  }
  if ([...flags.keys()].some((key) => !["--output", "--private-key"].includes(key))) {
    throw new Error("unsupported argument");
  }
  const date = new Date().toISOString().slice(0, 10);
  return {
    output: path.resolve(flags.get("--output") ?? `.local/ieee/${date}`),
    privateKey: path.resolve(flags.get("--private-key")
      ?? path.join(os.homedir(), ".config/macvendor/ieee-ingest-ed25519-private.pem")),
  };
}

async function atomicWrite(destination: string, bytes: Buffer | string): Promise<void> {
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
  await rename(temporary, destination);
  await chmod(destination, 0o600);
}

async function main() {
  const args = argumentsFrom(process.argv.slice(2));
  await mkdir(args.output, { recursive: true, mode: 0o700 });
  const privateKeyBytes = await readFile(args.privateKey);
  const privateKey = createPrivateKey(privateKeyBytes);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("IEEE ingest private key must be Ed25519");
  const publicKeyBytes = await readFile(PUBLIC_KEY_SOURCE);
  const publicKeyHash = sha256(publicKeyBytes);
  await copyFile(PUBLIC_KEY_SOURCE, path.join(args.output, "ieee-ingest-ed25519-public.pem"));
  await chmod(path.join(args.output, "ieee-ingest-ed25519-public.pem"), 0o600);

  const results = [];
  for (const dataset of IEEE_DATASETS) {
    const downloaded = await downloadHttps(dataset.url, {
      allowedOrigins: [IEEE_RA_ORIGIN], maxRedirects: 0, maxBytes: MAX_BYTES, timeoutMs: 30_000,
    });
    const artifactPath = path.join(args.output, dataset.file);
    const signatureName = `${dataset.file}.sig`;
    const signature = sign(null, downloaded.bytes, privateKey).toString("base64");
    await atomicWrite(artifactPath, downloaded.bytes);
    await atomicWrite(path.join(args.output, signatureName), `${signature}\n`);
    const manifest = {
      schemaVersion: "macvendor-source/v1",
      source: {
        slug: dataset.slug, name: dataset.name, class: "authoritative", publishMode: "production",
        adapterKey: IEEE_ADAPTER_KEY, fetchPolicy: "scheduled", fetchIntervalSeconds: 86_400,
        maxAcceptableAgeSeconds: 172_800, requiredForActivation: true,
        homepageUrl: "https://standards.ieee.org/products-programs/regauth/",
        termsUrl: "https://standards.ieee.org/faqs/regauth/",
        rights: {
          status: "approved", basis: "public_domain_claim", distributionScope: "api_output",
          reviewReference: IEEE_RIGHTS_REVIEW, reviewExpiresAt: "2027-07-11T00:00:00.000Z",
        },
      },
      release: {
        snapshotKind: "full_snapshot", snapshotComplete: true, schemaVersion: "1",
        adapterVersion: "1", normalizerVersion: "1",
        diffPolicy: { maxAddedPercent: 10, maxRemovedPercent: 2 },
      },
      artifact: {
        path: dataset.file, format: "csv", sha256: sha256(downloaded.bytes), signatureStatus: "verified",
        signature: {
          algorithm: "ed25519", origin: "operator", path: signatureName,
          publicKeyPath: "ieee-ingest-ed25519-public.pem", publicKeySha256: publicKeyHash,
        },
        remote: { url: dataset.url, allowedOrigins: [IEEE_RA_ORIGIN], maxRedirects: 0 },
      },
      defaults: {
        recordKind: "assignment", originType: "imported", rightsBasis: "public_domain_claim",
        distributionScope: "api_output", verificationStatus: "single_observation", registry: dataset.registry,
      },
    };
    const manifestPath = path.join(args.output, `${dataset.slug}.manifest.json`);
    await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const parsedManifest = await loadManifest(manifestPath);
    const parsedArtifact = await parseArtifact(parsedManifest, manifestPath);
    results.push({ registry: dataset.registry, manifestPath, contentHash: parsedArtifact.contentHash,
      records: parsedArtifact.records.length, bytes: parsedArtifact.byteSize,
      adapterWarnings: parsedArtifact.adapterWarnings, finalOrigin: downloaded.finalOrigin });
  }
  process.stdout.write(`${JSON.stringify({ status: "prepared", output: args.output, datasets: results }, null, 2)}\n`);
}

await main();
