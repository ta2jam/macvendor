import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256 } from "../../src/domain/canonical-json";
import { parseArtifact } from "../../src/importer/artifact";
import { ImportValidationError } from "../../src/importer/errors";
import { parseManifest } from "../../src/importer/manifest";
import type { SourceManifest } from "../../src/importer/types";
import { writeSignedArtifact } from "../helpers/source-fixture";
import { IEEE_ADAPTER_KEY, IEEE_RA_ORIGIN, IEEE_RIGHTS_REVIEW } from "../../src/sources/ieee";

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
      diffPolicy: { maxAddedPercent: 25, maxRemovedPercent: 5 },
    },
    artifact: {
      path: "records.csv",
      format: "csv",
      sha256: `sha256:${"0".repeat(64)}`,
      signatureStatus: "verified",
      signature: {
        algorithm: "ed25519",
        path: "records.csv.sig",
        publicKeyPath: "trusted-ed25519-public.pem",
        publicKeySha256: `sha256:${"0".repeat(64)}`,
      },
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

function ieeeManifest(): SourceManifest {
  const candidate = manifest();
  candidate.source = {
    slug: "ieee-ma-l", name: "IEEE Registration Authority MA-L", class: "authoritative",
    publishMode: "production", adapterKey: IEEE_ADAPTER_KEY, fetchPolicy: "scheduled",
    fetchIntervalSeconds: 86_400, maxAcceptableAgeSeconds: 172_800, requiredForActivation: true,
    rights: { status: "approved", basis: "public_domain_claim", distributionScope: "api_output",
      reviewReference: IEEE_RIGHTS_REVIEW },
  };
  candidate.artifact.remote = {
    url: `${IEEE_RA_ORIGIN}/oui/oui.csv`, allowedOrigins: [IEEE_RA_ORIGIN], maxRedirects: 0,
  };
  candidate.artifact.signature!.origin = "operator";
  candidate.defaults.rightsBasis = "public_domain_claim";
  return candidate;
}

describe("source manifest", () => {
  it("accepts a strict production manifest with documented rights", () => {
    expect(parseManifest(manifest()).source.slug).toBe("synthetic-authoritative");
  });

  it("accepts the fixed IEEE dataset with a local operator signature", () => {
    expect(parseManifest(ieeeManifest()).source.slug).toBe("ieee-ma-l");
  });

  it("rejects unknown fields", () => {
    expect(() => parseManifest({ ...manifest(), surprise: true })).toThrowError(ImportValidationError);
  });

  it("rejects unreviewed adapter keys", () => {
    const candidate = manifest();
    candidate.source.adapterKey = "arbitrary-code";
    expect(() => parseManifest(candidate)).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_ADAPTER" }));
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
    delete unsigned.artifact.signature;
    expect(() => parseManifest(unsigned)).toThrowError(expect.objectContaining({ code: "ARTIFACT_SIGNATURE_BLOCKED" }));
  });

  it("rejects an incomplete production full snapshot", () => {
    const candidate = manifest();
    candidate.release.snapshotComplete = false;
    expect(() => parseManifest(candidate)).toThrowError(expect.objectContaining({ code: "INCOMPLETE_PRODUCTION_SNAPSHOT" }));
  });

  it("rejects production deltas until deterministic materialization exists", () => {
    const candidate = manifest();
    candidate.release.snapshotKind = "delta";
    candidate.release.snapshotComplete = false;
    expect(() => parseManifest(candidate)).toThrowError(expect.objectContaining({ code: "PRODUCTION_DELTA_UNSUPPORTED" }));
  });
});

describe("artifact parser", () => {
  it("adapts reviewed IEEE rows and suppresses private assignee text", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "macvendor-ieee-importer-"));
    temporaryDirectories.push(directory);
    const csv = [
      "Registry,Assignment,Organization Name,Organization Address",
      `MA-L,001122,"Example, Inc.\t",\u200BExample Address`,
      "MA-L,AABBCC,Private,Private",
      "MA-L,DDEEFF,Conflicting One,Address One",
      "MA-L,DDEEFF,Conflicting Two,Address Two",
      "",
    ].join("\n");
    const signature = await writeSignedArtifact(directory, csv);
    const manifestPath = path.join(directory, "manifest.json");
    await writeFile(manifestPath, "{}");
    const candidate = ieeeManifest();
    candidate.artifact.sha256 = sha256(csv);
    candidate.artifact.signature = { ...signature, origin: "operator" };

    const parsed = await parseArtifact(candidate, manifestPath);
    expect(parsed.records).toHaveLength(2);
    expect(parsed.records[0]).toMatchObject({ registry: "MA-L", prefixBits: 0x001122n,
      prefixLength: 24, organizationName: "Example, Inc.", organizationAddress: "Example Address",
      isPrivate: false });
    expect(parsed.records[1]).toMatchObject({ registry: "MA-L", prefixBits: 0xaabbccn,
      organizationName: null, organizationAddress: null, isPrivate: true });
    expect(parsed.adapterWarnings).toEqual([{
      code: "IEEE_DUPLICATE_ASSIGNMENT_OMITTED", assignment: "DDEEFF", sourceRows: [3, 4],
    }]);
  });

  it("parses quoted CSV fields and normalizes prefix records", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "macvendor-importer-"));
    temporaryDirectories.push(directory);
    const csv = "prefix,prefixLength,organizationName\n02CCDD,24,\"Example, Incorporated\"\n";
    const manifestPath = path.join(directory, "manifest.json");
    const signature = await writeSignedArtifact(directory, csv);
    await writeFile(manifestPath, "{}");
    const candidate = manifest();
    candidate.artifact.sha256 = sha256(csv);
    candidate.artifact.signature = signature;

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
    const signature = await writeSignedArtifact(directory, csv);
    const manifestPath = path.join(directory, "manifest.json");
    await writeFile(manifestPath, "{}");
    const candidate = manifest();
    candidate.artifact.sha256 = sha256(csv);
    candidate.artifact.signature = signature;
    await expect(parseArtifact(candidate, manifestPath)).rejects.toMatchObject({ code: "CORROBORATION_RESERVED" });
  });

  it("rejects an invalid detached signature", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "macvendor-importer-"));
    temporaryDirectories.push(directory);
    const csv = "prefix,prefixLength,organizationName\n02CCDD,24,Example\n";
    const signature = await writeSignedArtifact(directory, `${csv}tampered`);
    await writeFile(path.join(directory, "records.csv"), csv);
    const manifestPath = path.join(directory, "manifest.json");
    await writeFile(manifestPath, "{}");
    const candidate = manifest();
    candidate.artifact.sha256 = sha256(csv);
    candidate.artifact.signature = signature;
    await expect(parseArtifact(candidate, manifestPath)).rejects.toMatchObject({ code: "ARTIFACT_SIGNATURE_INVALID" });
  });

  it("rejects duplicate normalized records", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "macvendor-importer-"));
    temporaryDirectories.push(directory);
    const csv = "prefix,prefixLength,organizationName\n02CCDD,24,Example\n02CCDD,24,Example\n";
    const signature = await writeSignedArtifact(directory, csv);
    const manifestPath = path.join(directory, "manifest.json");
    await writeFile(manifestPath, "{}");
    const candidate = manifest();
    candidate.artifact.sha256 = sha256(csv);
    candidate.artifact.signature = signature;
    await expect(parseArtifact(candidate, manifestPath)).rejects.toMatchObject({ code: "DUPLICATE_RECORD" });
  });
});
