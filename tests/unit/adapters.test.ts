import { describe, expect, it } from "vitest";
import { adaptSourceRows, REGISTERED_ADAPTER_KEYS, sourceAdapter } from "../../src/importer/adapters/registry";
import { STRICT_DELIMITED_ADAPTER_KEY } from "../../src/importer/adapters/strict-delimited";
import { adapterRawLocator } from "../../src/importer/adapters/types";
import type { SourceManifest } from "../../src/importer/types";
import { IEEE_ADAPTER_KEY } from "../../src/sources/ieee";

const strictManifest = (): SourceManifest => ({
  schemaVersion: "macvendor-source/v1",
  source: { slug: "adapter-contract-fixture", name: "Adapter Contract Fixture", class: "reference",
    publishMode: "qa_only", adapterKey: STRICT_DELIMITED_ADAPTER_KEY, requiredForActivation: false,
    rights: { status: "unreviewed", basis: "unknown", distributionScope: "internal_only" } },
  release: { snapshotKind: "full_snapshot", snapshotComplete: true, schemaVersion: "1",
    adapterVersion: "1", normalizerVersion: "2" },
  artifact: { path: "records.csv", format: "csv", sha256: `sha256:${"0".repeat(64)}`, signatureStatus: "not_applicable" },
  defaults: { recordKind: "usage_note", originType: "unknown", rightsBasis: "unknown",
    distributionScope: "internal_only", verificationStatus: "unverified" },
});

describe("reviewed source adapter registry", () => {
  it("contains only the compile-time reviewed adapters", () => {
    expect(REGISTERED_ADAPTER_KEYS).toEqual([STRICT_DELIMITED_ADAPTER_KEY, IEEE_ADAPTER_KEY]);
    expect(() => sourceAdapter("runtime-plugin")).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_ADAPTER" }));
  });

  it("keeps strict delimited rows unchanged and emits no warnings", () => {
    const rows = [{ prefix: "02AABB", prefixLength: "24" }];
    const result = adaptSourceRows(rows, strictManifest());
    expect(result).toEqual({ rows, warnings: [] });
    expect(result.rows).toBe(rows);
    expect(result.rows.map(adapterRawLocator)).toEqual(["row:1"]);
  });
});
