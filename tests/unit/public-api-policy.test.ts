import { describe, expect, it } from "vitest";
import {
  BULK_LOOKUP_LIMITS,
  PUBLIC_RATE_LIMIT_MAX_COST,
  PUBLIC_RATE_LIMIT_WINDOW_SECONDS,
  bulkLookupCost,
} from "../../src/http/public-api-policy";

describe("public API policy", () => {
  it("keeps each maximum request inside the published quota window", () => {
    expect(BULK_LOOKUP_LIMITS).toEqual({ official: 100, enriched: 50 });
    expect(PUBLIC_RATE_LIMIT_WINDOW_SECONDS).toBe(10);
    expect(PUBLIC_RATE_LIMIT_MAX_COST).toBe(50);
    expect(bulkLookupCost("official", BULK_LOOKUP_LIMITS.official)).toBe(50);
    expect(bulkLookupCost("enriched", BULK_LOOKUP_LIMITS.enriched)).toBe(50);
  });

  it("rounds official bulk cost up without discounting enriched entries", () => {
    expect(bulkLookupCost("official", 1)).toBe(1);
    expect(bulkLookupCost("official", 3)).toBe(2);
    expect(bulkLookupCost("enriched", 3)).toBe(3);
  });
});
