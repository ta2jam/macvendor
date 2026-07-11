import { describe, expect, it } from "vitest";
import { resolveRecords, type ResolverRecord } from "../../src/resolver/resolve";

function record(overrides: Partial<ResolverRecord> = {}): ResolverRecord {
  return {
    id: "record-1",
    sourceReleaseId: "release-1",
    sourceSlug: "registry-a",
    sourceClass: "authoritative",
    recordKind: "assignment",
    registry: "MA-L",
    prefixBits: 0x02aabbn,
    prefixLength: 24,
    organizationName: "Example Networks",
    organizationAddress: null,
    isPrivate: false,
    claimValue: {},
    originType: "imported",
    verificationStatus: "single_observation",
    rawRecordHash: "hash-1",
    ...overrides,
  };
}

describe("deterministic resolver", () => {
  it("produces the same output hash regardless of input order or database ids", () => {
    const left = record();
    const right = record({
      id: "record-2",
      sourceReleaseId: "release-2",
      sourceSlug: "registry-b",
      rawRecordHash: "hash-2",
    });
    const first = resolveRecords([left, right]);
    const second = resolveRecords([
      { ...right, id: "different-db-id-2", sourceReleaseId: "different-release-2" },
      { ...left, id: "different-db-id-1", sourceReleaseId: "different-release-1" },
    ]);

    expect(first.outputHash).toBe(second.outputHash);
    expect(first.assignments).toHaveLength(1);
    expect(first.assignments[0]!.evidence.map((item) => item.role)).toEqual(["selected", "corroborating"]);
  });

  it("rejects conflicting authoritative semantics for the same EUI prefix", () => {
    const result = resolveRecords([
      record(),
      record({
        id: "record-2",
        sourceReleaseId: "release-2",
        sourceSlug: "registry-b",
        registry: "IAB",
        organizationName: "Different Vendor",
        rawRecordHash: "hash-2",
      }),
    ]);

    expect(result.assignments).toHaveLength(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.records.map((item) => item.sourceSlug)).toEqual(["registry-a", "registry-b"]);
  });

  it("keeps curated claims separate and evaluates them against the longest official prefix", () => {
    const result = resolveRecords([
      record(),
      record({
        id: "claim-agrees",
        sourceReleaseId: "release-curated",
        sourceSlug: "curated-a",
        sourceClass: "owner_curated",
        recordKind: "curated_vendor_claim",
        registry: null,
        prefixBits: 0x02aabbccn,
        prefixLength: 32,
        organizationName: " example networks ",
        claimValue: { label: "Example Networks" },
        originType: "owner_observation",
        rawRecordHash: "claim-hash-1",
      }),
      record({
        id: "claim-no-match",
        sourceReleaseId: "release-curated",
        sourceSlug: "curated-a",
        sourceClass: "owner_curated",
        recordKind: "vendor_alias",
        registry: null,
        prefixBits: 0x123456n,
        prefixLength: 24,
        organizationName: "Unknown Vendor",
        claimValue: { alias: "Unknown Vendor" },
        originType: "owner_observation",
        rawRecordHash: "claim-hash-2",
      }),
      record({
        id: "hint",
        sourceReleaseId: "release-curated",
        sourceSlug: "curated-a",
        sourceClass: "owner_curated",
        recordKind: "device_hint",
        registry: null,
        prefixBits: 0x02aabbccn,
        prefixLength: 32,
        organizationName: null,
        claimValue: { family: "sensor" },
        originType: "owner_observation",
        rawRecordHash: "claim-hash-3",
      }),
    ]);

    expect(Object.fromEntries(result.claims.map((claim) => [claim.source.id, claim.conflictStatus]))).toEqual({
      "claim-agrees": "agrees",
      "claim-no-match": "no_official_match",
      hint: "not_evaluated",
    });
  });

  it("requires distinct sources before marking a claim corroborated", () => {
    const common = {
      sourceClass: "owner_curated" as const,
      recordKind: "curated_vendor_claim" as const,
      registry: null,
      prefixBits: 0x02aabbccn,
      prefixLength: 32,
      organizationName: "Community Label",
      claimValue: { label: "Community Label" },
      originType: "owner_observation" as const,
      verificationStatus: "corroborated" as const,
    };
    const oneSource = resolveRecords([
      record({ ...common, id: "claim-1", sourceSlug: "curated-a", rawRecordHash: "claim-1" }),
      record({ ...common, id: "claim-2", sourceSlug: "curated-a", rawRecordHash: "claim-2" }),
    ]);
    const twoSources = resolveRecords([
      record({ ...common, id: "claim-1", sourceSlug: "curated-a", rawRecordHash: "claim-1" }),
      record({ ...common, id: "claim-2", sourceSlug: "curated-b", rawRecordHash: "claim-2" }),
    ]);

    expect(oneSource.claims.map((claim) => claim.verificationStatus)).toEqual(["single_observation", "single_observation"]);
    expect(twoSources.claims.map((claim) => claim.verificationStatus)).toEqual(["corroborated", "corroborated"]);
  });

  it("does not treat CID assignments as official EUI matches", () => {
    const result = resolveRecords([
      record({ registry: "CID" }),
      record({
        id: "claim-1",
        sourceSlug: "curated-a",
        sourceClass: "owner_curated",
        recordKind: "curated_vendor_claim",
        registry: null,
        organizationName: "Example Networks",
        originType: "owner_observation",
        rawRecordHash: "claim-1",
      }),
    ]);

    expect(result.claims[0]!.conflictStatus).toBe("no_official_match");
  });

  it("does not publish assignments from enrichment or curated sources", () => {
    const result = resolveRecords([
      record({ sourceClass: "enrichment", sourceSlug: "enrichment-a" }),
      record({ sourceClass: "owner_curated", sourceSlug: "curated-a" }),
    ]);

    expect(result.assignments).toEqual([]);
  });
});
