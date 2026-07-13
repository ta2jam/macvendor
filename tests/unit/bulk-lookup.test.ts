import { describe, expect, it } from "vitest";
import { bulkLookupOfficial } from "../../src/db/bulk-lookup";
import { normalizeMac } from "../../src/domain/mac";

describe("bulk official lookup", () => {
  it("deduplicates the SQL input but preserves response order and duplicates", async () => {
    const calls: unknown[][] = [];
    const pool = { query: async (_sql: string, values: unknown[]) => {
      calls.push(values);
      return { rows: [{ normalized_mac: "001122334455", resolution_run_id: "00000000-0000-4000-8000-000000000001",
        active_version: "1", publication_version: "2", policy_version: "v2", generated_at: new Date("2026-07-13T00:00:00Z"),
        registry: "MA-L", prefix_bits: "4386", prefix_length: 24, organization_name: "Example", organization_address: null,
        source_slug: "ieee-ma-l", source_release_id: "00000000-0000-4000-8000-000000000002" }] };
    } };
    const mac = normalizeMac("00:11:22:33:44:55");
    const result = await bulkLookupOfficial(pool as never, [mac, mac]);
    expect((calls[0]![0] as string[])).toEqual([mac.normalized]);
    expect(result).toHaveLength(2);
    expect(result[0]!.assignment).toMatchObject({ prefix: "001122", prefixLength: 24, organizationName: "Example" });
  });
});
