import type { NextRequest } from "next/server";

interface Bucket {
  tokens: number;
  updatedAt: number;
  lastSeen: number;
}

declare global {
  var __macvendorRateBuckets: Map<string, Bucket> | undefined;
}

const RATE = 5;
const BURST = 25;
const buckets = globalThis.__macvendorRateBuckets ?? new Map<string, Bucket>();
globalThis.__macvendorRateBuckets = buckets;

function clientKey(request: NextRequest): string {
  if (process.env.TRUST_PROXY === "true") {
    const trusted = request.headers.get("x-real-ip");
    if (trusted) return trusted.includes(":") ? trusted.split(":").slice(0, 4).join(":") : trusted;
  }
  return "direct-origin";
}

export function consumeRateLimit(request: NextRequest, cost = 1): { allowed: boolean; retryAfter: number } {
  if (process.env.RATE_LIMIT_ENABLED === "false" || process.env.NODE_ENV === "test") {
    return { allowed: true, retryAfter: 0 };
  }

  const now = Date.now();
  const key = clientKey(request);
  const current = buckets.get(key) ?? { tokens: BURST, updatedAt: now, lastSeen: now };
  const replenished = Math.min(BURST, current.tokens + ((now - current.updatedAt) / 1000) * RATE);
  const allowed = replenished >= cost;
  buckets.set(key, {
    tokens: allowed ? replenished - cost : replenished,
    updatedAt: now,
    lastSeen: now,
  });

  if (buckets.size > 10_000) {
    for (const [bucketKey, bucket] of buckets) {
      if (now - bucket.lastSeen > 10 * 60_000) buckets.delete(bucketKey);
    }
  }

  return { allowed, retryAfter: allowed ? 0 : Math.max(1, Math.ceil((cost - replenished) / RATE)) };
}
