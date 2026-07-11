import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPool } from "@/db/pool";
import { migrate } from "@/db/migrate";
import { getDataRelease, lookupMac } from "@/db/lookup";
import { sha256 } from "@/domain/canonical-json";
import { normalizeMac } from "@/domain/mac";
import { APP_VERSION } from "@/lib/version";
import { importSourceRelease } from "@/importer/import-source";
import { activateResolution } from "@/resolver/activation";
import { buildResolution } from "@/resolver/build";
import {
  assertDatabaseIntegrity, createDisposableDatabase, dropDisposableDatabase,
  inspectDatabaseIntegrity, RecoveryError, validateDisposableTarget,
} from "./database";

async function createSignedManifest(options: {
  directory: string;
  artifactPath: string;
  sourceSlug: string;
  sourceName: string;
  sourceClass: "authoritative" | "owner_curated";
  recordKind: "assignment" | "curated_vendor_claim";
  registry?: "MA-L";
}): Promise<string> {
  const content = await readFile(options.artifactPath);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyBytes = Buffer.from(publicKey.export({ type: "spki", format: "pem" }));
  const artifactName = path.basename(options.artifactPath);
  const localArtifact = path.join(options.directory, artifactName);
  const signatureName = `${artifactName}.sig`;
  const publicKeyName = `${options.sourceSlug}.public.pem`;
  await writeFile(localArtifact, content);
  await writeFile(path.join(options.directory, signatureName), sign(null, content, privateKey).toString("base64"));
  await writeFile(path.join(options.directory, publicKeyName), publicKeyBytes, { mode: 0o600 });
  const manifestPath = path.join(options.directory, `${options.sourceSlug}.manifest.json`);
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: "macvendor-source/v1",
    source: {
      slug: options.sourceSlug,
      name: options.sourceName,
      class: options.sourceClass,
      publishMode: "production",
      adapterKey: "strict-delimited-v1",
      requiredForActivation: true,
      rights: { status: "owner_asserted", basis: "owner_created", distributionScope: "api_output" },
    },
    release: {
      snapshotKind: "full_snapshot", snapshotComplete: true,
      schemaVersion: "1", adapterVersion: "1", normalizerVersion: "1",
      diffPolicy: { maxAddedPercent: 100, maxRemovedPercent: 100 },
    },
    artifact: {
      path: artifactName, format: "csv", sha256: sha256(content), signatureStatus: "verified",
      signature: {
        algorithm: "ed25519", path: signatureName, publicKeyPath: publicKeyName,
        publicKeySha256: sha256(publicKeyBytes),
      },
    },
    defaults: {
      recordKind: options.recordKind,
      originType: "imported",
      rightsBasis: "owner_created",
      distributionScope: "api_output",
      verificationStatus: "single_observation",
      ...(options.registry ? { registry: options.registry } : {}),
    },
  }, null, 2));
  return manifestPath;
}

export async function rebuildFromSyntheticArtifacts(options: {
  adminDatabaseUrl: string;
  targetDatabase: string;
  dropAfterCheck?: boolean;
  policyCommitSha?: string;
}) {
  const started = Date.now();
  validateDisposableTarget(options.targetDatabase, "rebuild");
  let created = false;
  const directory = await mkdtemp(path.join(tmpdir(), "macvendor-rebuild-"));
  try {
    const targetUrl = await createDisposableDatabase(options.adminDatabaseUrl, options.targetDatabase, "rebuild");
    created = true;
    const pool = createPool(targetUrl);
    try {
      await migrate(pool);
      const authoritativeManifest = await createSignedManifest({
        directory,
        artifactPath: path.join(process.cwd(), "examples/recovery/authoritative.csv"),
        sourceSlug: "rebuild-synthetic-authoritative",
        sourceName: "Rebuild Synthetic Authoritative Source",
        sourceClass: "authoritative",
        recordKind: "assignment",
        registry: "MA-L",
      });
      const curatedManifest = await createSignedManifest({
        directory,
        artifactPath: path.join(process.cwd(), "examples/recovery/curated.csv"),
        sourceSlug: "rebuild-synthetic-curated",
        sourceName: "Rebuild Synthetic Curated Source",
        sourceClass: "owner_curated",
        recordKind: "curated_vendor_claim",
      });
      const authoritative = await importSourceRelease(pool, authoritativeManifest);
      const curated = await importSourceRelease(pool, curatedManifest);
      const resolution = await buildResolution(pool, {
        sourceReleaseIds: [authoritative.sourceReleaseId, curated.sourceReleaseId],
        policyVersion: `v${APP_VERSION}`,
        policyCommitSha: options.policyCommitSha ?? process.env.GIT_COMMIT_SHA ?? "recovery-drill-local",
        containerImageDigest: process.env.BUILD_IMAGE_DIGEST ?? "recovery-drill-local",
      });
      if (resolution.status !== "validated") {
        throw new RecoveryError("REBUILD_RESOLUTION_REJECTED", "synthetic artifact resolution did not validate");
      }
      await activateResolution(pool, resolution.resolutionRunId, { actorId: "recovery:artifact-rebuild" });
      const lookup = await lookupMac(pool, normalizeMac("02AABBCC0001"), "all");
      if (lookup.assignment?.organizationName !== "Example Networks Lab"
        || lookup.curatedMatches[0]?.organizationName !== "Example Devices Community") {
        throw new RecoveryError("REBUILD_LOOKUP_MISMATCH", "rebuilt lookup output does not match the synthetic artifact fixture");
      }
      const release = await getDataRelease(pool);
      const integrity = await inspectDatabaseIntegrity(pool);
      assertDatabaseIntegrity(integrity);
      return {
        status: "verified" as const,
        targetDatabase: options.targetDatabase,
        dropped: Boolean(options.dropAfterCheck),
        durationMs: Date.now() - started,
        resolutionRunId: resolution.resolutionRunId,
        outputHash: resolution.outputHash,
        sourceCount: release.sources.length,
        integrity,
      };
    } finally {
      await pool.end();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
    if (created && options.dropAfterCheck) {
      await dropDisposableDatabase(options.adminDatabaseUrl, options.targetDatabase, "rebuild");
    }
  }
}
