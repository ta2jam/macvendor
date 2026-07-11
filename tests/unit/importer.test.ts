import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256 } from "../../src/domain/canonical-json";
import { parseArtifact } from "../../src/importer/artifact";
import { ImportValidationError } from "../../src/importer/errors";
import { parseManifest } from "../../src/importer/manifest";
import type { SourceManifest } from "../../src/importer/types";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function manifest(overrides: Partial<SourceManifest> = {}): SourceManifest {
  return {
    schemaVersion: "macvendor-source/v1",
    source: {
      slug: "synthetic-authoritative",
      name: "Synthetic Authoritative Source",
      class: "authoritative",
      publishMode: "production",
      adapterKey: "strict-delimited-v1",
      requiredForActivation: true,
      rights: {
        status: "approved",
        basis: "licensed",
        distributionScope: "api_output",
        reviewReference: "TEST-RIGHTS-1",
      },
    },
    release: {
      snapshotKind: "full_snapshot",
      snapshotComplete: true,
      schemaVersion: "1",
      adapterVersion: "1",
      normalizerVersion: "1",
    },
    artifact: {
      path: "records.csv",
      format: "csv",
      sha256: `sha256:${"0".repeat(64)}`,
      signatureStatus: "verified",
    },
    defaults: {
      recordKind: "assignment",
      originType: "imported",
      rightsBasis: "licensed",
      distributionScope: "api_output",
      verificationStatus: "single_observation",
      registry: "MA-L",
    },
    ...overrides,
  };
}

describe("source manifest", () => {
  it("accepts a strict production manifest with documented rights", () => {
    expect(parseManifest(manifest()).source.slug).toBe("synthetic-authoritative");
  });

  it("rejects unknown fields", () => {
    expect(() => parseManifest({ ...manifest(), surprise: true })).toThrowError(ImportValidationError);
  });

  it("rejects third-party production use without an approved review", () => {
    const candidate = manifest();
    candidate.source.rights.status = "unreviewed";
    delete candidate.source.rights.reviewReference;
    expect(() => parseManifest(candidate)).toThrowError(expect.objectContaining({ code: "RIGHTS_REVIEW_REQUIRED" }));
  });

  it("rejects traversal and unverified production artifacts", () => {
    const traversal = manifest();
    traversal.artifact.path = "../records.csv";
    expect(() => parseManifest(traversal)).toThrowError(expect.objectContaining({ code: "UNSAFE_ARTIFACT_PATH" }));

    const unsigned = manifest();
    unsigned.artifact.signatureStatus = "unverified";
    expect(() => parseManifest(unsigned)).toThrowError(expect.objectContaining({ code: "ARTIFACT_SIGNATURE_BLOCKED" }));
  });

  it("rejects an incomplete production full snapshot", () => {
    const candidate = manifest();
    candidate.release.snapshotComplete = false;
    expect(() => parseManifest(candidate)).toThrowError(expect.objectContaining({ code: "INCOMPLETE_PRODUCTION_SNAPSHOT" }));
  });
});

describe("artifact parser", () => {
  it("parses quoted CSV fields and normalizes prefix records", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "macvendor-importer-"));
    temporaryDirectories.push(directory);
    const csv = "prefix,prefixLength,organizationName\n02CCDD,24,\"Example, Incorporated\"\n";
    const artifactPath = path.join(directory, "records.csv");
    const manifestPath = path.join(directory, "manifest.json");
    await writeFile(artifactPath, csv);
    await writeFile(manifestPath, "{}");
    const candidate = manifest();
    candidate.artifact.sha256 = sha256(csv);

    const parsed = await parseArtifact(candidate, manifestPath);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]).toMatchObject({
      prefixBits: 0x02ccddn,
      prefixLength: 24,
      organizationName: "Example, Incorporated",
      recordStatus: "eligible",
    });
  });

  it("rejects hash mismatch before parsing records", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "macvendor-importer-"));
    temporaryDirectories.push(directory);
    await writeFile(path.join(directory, "records.csv"), "prefix,prefixLength,organizationName\n02CCDD,24,Example\n");
    const manifestPath = path.join(directory, "manifest.json");
    await writeFile(manifestPath, "{}");
    await expect(parseArtifact(manifest(), manifestPath)).rejects.toMatchObject({ code: "ARTIFACT_HASH_MISMATCH" });
  });

  it("reserves corroborated status for resolver output", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "macvendor-importer-"));
    temporaryDirectories.push(directory);
    const csv = "prefix,prefixLength,organizationName,verificationStatus\n02CCDD,24,Example,corroborated\n";
    await writeFile(path.join(directory, "records.csv"), csv);
    const manifestPath = path.join(directory, "manifest.json");
    await writeFile(manifestPath, "{}");
    const candidate = manifest();
    candidate.artifact.sha256 = sha256(csv);
    await expect(parseArtifact(candidate, manifestPath)).rejects.toMatchObject({ code: "CORROBORATION_RESERVED" });
  });
});
