export const PUBLIC_API_VERSION = "v1";
export const PUBLIC_RATE_LIMIT_WINDOW_SECONDS = 10;
export const PUBLIC_RATE_LIMIT_MAX_COST = 50;

export const BULK_LOOKUP_LIMITS = {
  official: 100,
  enriched: 50,
} as const;

export type PublicLookupMode = keyof typeof BULK_LOOKUP_LIMITS;

export function bulkLookupCost(mode: PublicLookupMode, count: number): number {
  return mode === "enriched" ? count : Math.ceil(count / 2);
}
