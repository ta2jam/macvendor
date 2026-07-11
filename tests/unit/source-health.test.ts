import { describe, expect, it } from "vitest";
import {
  evaluateSourceGovernance,
  type SourceHealthRow,
} from "../../src/operations/source-health";

const now = new Date("2026-07-11T00:00:00.000Z");

function row(overrides: Partial<SourceHealthRow> = {}): SourceHealthRow {
  return {
    slug: "licensed-source",
    source_class: "authoritative",
    publish_mode: "production",
    config_version: "1",
    required_for_activation: true,
    max_acceptable_age_seconds: 86_400,
    rights_status: "approved",
    rights_basis: "licensed",
    distribution_scope: "api_output",
    rights_review_reference: "RIGHTS-1",
    rights_review_expires_at: new Date("2027-01-01T00:00:00.000Z"),
    active_source_release_id: "00000000-0000-4000-8000-000000000001",
    active_release_status: "valid",
    active_fetched_at: new Date("2026-07-10T12:00:00.000Z"),
    active_config_version: "1",
    latest_valid_release_id: "00000000-0000-4000-8000-000000000001",
    latest_valid_fetched_at: new Date("2026-07-10T12:00:00.000Z"),
    ...overrides,
  };
}

describe("source governance health", () => {
  it("reports a current approved source as healthy", () => {
    const report = evaluateSourceGovernance([row()], { now });
    expect(report).toMatchObject({ healthy: true, summary: { sources: 1, failures: 0, warnings: 0 } });
  });

  it("fails closed on stale data, missing releases, and blocked rights", () => {
    const report = evaluateSourceGovernance([
      row({ slug: "stale", active_fetched_at: new Date("2026-07-01T00:00:00.000Z") }),
      row({
        slug: "missing",
        active_source_release_id: null,
        active_release_status: null,
        active_fetched_at: null,
        latest_valid_release_id: null,
        latest_valid_fetched_at: null,
      }),
      row({ slug: "rights", rights_status: "unreviewed", rights_review_reference: null, distribution_scope: "internal_only" }),
    ], { now });
    expect(report.healthy).toBe(false);
    expect(report.sources.flatMap((source) => source.findings.map((item) => item.code))).toEqual(expect.arrayContaining([
      "SOURCE_STALE", "NO_VALID_RELEASE", "RIGHTS_STATUS_BLOCKED", "RIGHTS_SCOPE_BLOCKED",
    ]));
  });

  it("warns before rights expiry and when freshness policy is absent", () => {
    const report = evaluateSourceGovernance([row({
      max_acceptable_age_seconds: null,
      rights_review_expires_at: new Date("2026-07-20T00:00:00.000Z"),
    })], { now, warningWindowDays: 30 });
    expect(report).toMatchObject({ healthy: true, summary: { failures: 0, warnings: 2 } });
    expect(report.sources[0]?.findings.map((item) => item.code)).toEqual([
      "RIGHTS_REVIEW_EXPIRING", "FRESHNESS_LIMIT_MISSING",
    ]);
  });

  it("accepts owner assertions only for owner-created sources", () => {
    const owner = evaluateSourceGovernance([row({
      rights_status: "owner_asserted",
      rights_basis: "owner_created",
      rights_review_reference: null,
    })], { now });
    const thirdParty = evaluateSourceGovernance([row({
      rights_status: "owner_asserted",
      rights_basis: "permission_granted",
      rights_review_reference: "RIGHTS-2",
    })], { now });
    expect(owner.healthy).toBe(true);
    expect(thirdParty.healthy).toBe(false);
  });

  it("detects required sources omitted from the active resolution", () => {
    const report = evaluateSourceGovernance([row({
      active_source_release_id: null,
      active_release_status: null,
      active_fetched_at: null,
    })], { now });
    expect(report.healthy).toBe(false);
    expect(report.sources[0]?.findings.map((item) => item.code)).toContain("REQUIRED_SOURCE_NOT_ACTIVE");
  });

  it("rejects reference publishers, invalid active releases, and future clocks", () => {
    const report = evaluateSourceGovernance([row({
      source_class: "reference",
      active_release_status: "retired",
      active_fetched_at: new Date("2026-07-11T00:06:00.000Z"),
    })], { now });
    expect(report.healthy).toBe(false);
    expect(report.sources[0]?.findings.map((item) => item.code)).toEqual(expect.arrayContaining([
      "REFERENCE_CANNOT_PUBLISH", "ACTIVE_RELEASE_NOT_VALID", "FUTURE_FETCH_TIME",
    ]));
  });

  it("fails for a non-production active source and warns on config drift", () => {
    const report = evaluateSourceGovernance([row({
      publish_mode: "disabled",
      config_version: "2",
      active_config_version: "1",
    })], { now });
    expect(report.healthy).toBe(false);
    expect(report.sources[0]).toMatchObject({
      publishMode: "disabled",
      currentConfigVersion: 2,
      activeConfigVersion: 1,
      activeConfigChanged: true,
    });
    expect(report.sources[0]?.findings.map((item) => item.code)).toEqual(expect.arrayContaining([
      "ACTIVE_SOURCE_NOT_PRODUCTION", "ACTIVE_CONFIG_CHANGED",
    ]));
  });

  it("rejects invalid warning windows", () => {
    expect(() => evaluateSourceGovernance([], { warningWindowDays: 0 })).toThrow("warningWindowDays");
  });
});
