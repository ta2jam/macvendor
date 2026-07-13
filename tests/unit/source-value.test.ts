import { describe, expect, it } from "vitest";
import { sourceValueReport } from "../../src/operations/source-value";

describe("source value report", () => {
  it("keeps input and output contribution separate without deleting low-value sources", async () => {
    const pool = { query: async () => ({ rows: [{
      slug: "example", source_class: "enrichment", required_for_activation: false,
      record_count: "10", rejected_record_count: "2", assignments: "0", claims: "3",
      identities: "1", conflicts: "1", latest_observation: new Date("2026-07-13T00:00:00Z"),
      rights_review_expires_at: null,
    }] }) };
    const report = await sourceValueReport(pool as never);
    expect(report.sources[0]).toMatchObject({
      slug: "example", inputRecords: 10, rejectedRecords: 2, outputContribution: 4, conflicts: 1,
      latestObservation: "2026-07-13T00:00:00.000Z",
    });
  });
});
