import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256 } from "../../src/domain/canonical-json";
import { IMPORT_LIMITS, parseArtifact } from "../../src/importer/artifact";
import { ImportValidationError } from "../../src/importer/errors";
import type { SourceManifest } from "../../src/importer/types";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function qaManifest(bytes: Uint8Array, format: SourceManifest["artifact"]["format"] = "csv"): SourceManifest {
  return {
    schemaVersion: "macvendor-source/v1",
    source: {
      slug: "synthetic-fuzz",
      name: "Synthetic Fuzz Input",
      class: "authoritative",
      publishMode: "qa_only",
      adapterKey: "strict-delimited-v1",
      requiredForActivation: false,
      rights: { status: "unreviewed", basis: "unknown", distributionScope: "internal_only" },
    },
    release: {
      snapshotKind: "full_snapshot",
      snapshotComplete: true,
      schemaVersion: "1",
      adapterVersion: "1",
      normalizerVersion: "2",
    },
    artifact: {
      path: format === "jsonl" ? "records.jsonl" : "records.csv",
      format,
      sha256: sha256(bytes),
      signatureStatus: "not_applicable",
    },
    defaults: {
      recordKind: "assignment",
      originType: "unknown",
      rightsBasis: "unknown",
      distributionScope: "internal_only",
      verificationStatus: "unverified",
      registry: "MA-L",
    },
  };
}

async function parseBytes(bytes: Uint8Array, format: SourceManifest["artifact"]["format"] = "csv") {
  const directory = await mkdtemp(path.join(tmpdir(), "macvendor-fuzz-"));
  temporaryDirectories.push(directory);
  const manifest = qaManifest(bytes, format);
  const manifestPath = path.join(directory, "manifest.json");
  await writeFile(manifestPath, "{}");
  await writeFile(path.join(directory, manifest.artifact.path), bytes);
  return parseArtifact(manifest, manifestPath);
}

function jsonlRecord(claimValue: unknown): Uint8Array {
  return Buffer.from(`${JSON.stringify({
    prefix: "02CCDD",
    prefixLength: 24,
    organizationName: "Example",
    claimValue,
  })}\n`);
}

describe("importer adversarial corpus", () => {
  it("contains malformed bytes inside validation errors instead of parser crashes", async () => {
    let state = 0x6d2b79f5;
    const random = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    const base = Buffer.from("prefix,prefixLength,organizationName\n02CCDD,24,Example Networks\n");
    for (let caseIndex = 0; caseIndex < 64; caseIndex += 1) {
      const candidate = Buffer.from(base);
      const mutations = 1 + (random() % 4);
      for (let mutation = 0; mutation < mutations; mutation += 1) {
        candidate[random() % candidate.length] = random() & 0xff;
      }
      try {
        await parseBytes(candidate);
      } catch (error) {
        expect(error, `mutation ${caseIndex}`).toBeInstanceOf(ImportValidationError);
      }
    }
  }, 15_000);

  it("rejects invalid UTF-8 and oversized artifact, line, field, and record counts", async () => {
    const invalidUtf8 = Buffer.concat([
      Buffer.from("prefix,prefixLength,organizationName\n02CCDD,24,"),
      Buffer.from([0xc3, 0x28]),
      Buffer.from("\n"),
    ]);
    await expect(parseBytes(invalidUtf8)).rejects.toMatchObject({ code: "INVALID_UTF8" });

    const longLine = Buffer.from(`prefix,prefixLength,organizationName\n02CCDD,24,${"a".repeat(IMPORT_LIMITS.lineBytes)}\n`);
    await expect(parseBytes(longLine)).rejects.toMatchObject({ code: "LINE_TOO_LARGE" });

    const longField = Buffer.from(`prefix,prefixLength,organizationName\n02CCDD,24,${"a".repeat(IMPORT_LIMITS.fieldBytes + 1)}\n`);
    await expect(parseBytes(longField)).rejects.toMatchObject({ code: "FIELD_TOO_LARGE" });

    const tooManyRecords = Buffer.from(
      `prefix,prefixLength,organizationName\n${"0,1,X\n".repeat(IMPORT_LIMITS.records + 1)}`,
    );
    await expect(parseBytes(tooManyRecords)).rejects.toMatchObject({ code: "TOO_MANY_RECORDS" });

    const oversizedArtifact = Buffer.alloc(IMPORT_LIMITS.artifactBytes + 1, 0x61);
    await expect(parseBytes(oversizedArtifact)).rejects.toMatchObject({ code: "ARTIFACT_TOO_LARGE" });
  }, 20_000);

  it("bounds claim JSON depth, node count, byte size, and unsafe nested text", async () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let index = 0; index < IMPORT_LIMITS.claimValueDepth; index += 1) deep = { child: deep };
    await expect(parseBytes(jsonlRecord(deep), "jsonl")).rejects.toMatchObject({ code: "CLAIM_VALUE_TOO_DEEP" });

    const complex = { values: Array.from({ length: IMPORT_LIMITS.claimValueNodes }, () => 0) };
    await expect(parseBytes(jsonlRecord(complex), "jsonl")).rejects.toMatchObject({ code: "CLAIM_VALUE_TOO_COMPLEX" });

    const large = { first: "a".repeat(12_000), second: "b".repeat(12_000), third: "c".repeat(12_000) };
    await expect(parseBytes(jsonlRecord(large), "jsonl")).rejects.toMatchObject({ code: "CLAIM_VALUE_TOO_LARGE" });

    await expect(parseBytes(jsonlRecord({ label: "safe\u202Eunsafe" }), "jsonl"))
      .rejects.toMatchObject({ code: "UNSAFE_TEXT" });
  });

  it("normalizes nested claim text and rejects colliding normalized keys", async () => {
    const parsed = await parseBytes(jsonlRecord({ label: "Cafe\u0301" }), "jsonl");
    expect(parsed.records[0]?.claimValue).toEqual({ label: "Café" });

    const colliding = Object.fromEntries([["é", 1], ["e\u0301", 2]]);
    await expect(parseBytes(jsonlRecord(colliding), "jsonl"))
      .rejects.toMatchObject({ code: "DUPLICATE_CLAIM_KEY" });
  });
});
