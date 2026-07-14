import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import type { NextRequest } from "next/server";
import type { Pool } from "pg";
import { getPool } from "@/db/pool";

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
const MAX_LOCAL_BUCKETS = 10_000;
const LOCAL_BUCKET_PRUNE_TARGET = 9_000;
const buckets = globalThis.__macvendorRateBuckets ?? new Map<string, Bucket>();
globalThis.__macvendorRateBuckets = buckets;

function clientKey(request: NextRequest): string {
  if (process.env.TRUST_PROXY === "true") {
    const trusted = request.headers.get("x-real-ip");
    if (trusted && isIP(trusted)) return trusted;
  }
  return "direct-origin";
}

export interface RateLimitResult { allowed: boolean; retryAfter: number; backend: "disabled" | "postgres" | "local" }

function consumeLocalRateLimit(request: NextRequest, cost: number): RateLimitResult {
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

  if (buckets.size > MAX_LOCAL_BUCKETS) {
    for (const [bucketKey, bucket] of buckets) {
      if (now - bucket.lastSeen > 10 * 60_000) buckets.delete(bucketKey);
    }
    if (buckets.size > MAX_LOCAL_BUCKETS) {
      for (const bucketKey of buckets.keys()) {
        buckets.delete(bucketKey);
        if (buckets.size <= LOCAL_BUCKET_PRUNE_TARGET) break;
      }
    }
  }

  return { allowed, retryAfter: allowed ? 0 : Math.max(1, Math.ceil((cost - replenished) / RATE)), backend: "local" };
}

function integerSetting(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

export async function consumeRateLimit(request: NextRequest, cost = 1, pool?: Pool): Promise<RateLimitResult> {
  if (process.env.RATE_LIMIT_ENABLED === "false" || process.env.NODE_ENV === "test") {
    return { allowed: true, retryAfter: 0, backend: "disabled" };
  }
  if (!Number.isInteger(cost) || cost < 1 || cost > 25) throw new Error("rate limit cost must be an integer from 1 to 25");
  if (process.env.RATE_LIMIT_BACKEND !== "postgres") return consumeLocalRateLimit(request, cost);

  const salt = process.env.RATE_LIMIT_SALT;
  if (!salt || salt.length < 32) throw new Error("RATE_LIMIT_SALT must contain at least 32 characters");
  const windowSeconds = integerSetting("RATE_LIMIT_WINDOW_SECONDS", 10, 1, 300);
  const maxCost = integerSetting("RATE_LIMIT_MAX_COST", 50, 1, 10_000);
  const keyHash = `sha256:${createHmac("sha256", salt).update(clientKey(request)).digest("hex")}`;
  try {
    const result = await (pool ?? getPool()).query<{ allowed: boolean; retry_after: number }>(
      `WITH timing AS (
         SELECT to_timestamp(floor(extract(epoch FROM clock_timestamp()) / $2::integer) * $2::integer) AS window_start
       ), attempted AS (
         INSERT INTO rate_limit_windows (key_hash, window_start, request_cost, expires_at)
         SELECT $1::text, window_start, $3::integer,
           window_start + make_interval(secs => $2::integer * 2) FROM timing
         WHERE $3::integer <= $4::integer
         ON CONFLICT (key_hash, window_start) DO UPDATE
         SET request_cost = rate_limit_windows.request_cost + EXCLUDED.request_cost,
             expires_at = EXCLUDED.expires_at
         WHERE rate_limit_windows.request_cost + EXCLUDED.request_cost <= $4::integer
         RETURNING 1
       )
       SELECT EXISTS (SELECT 1 FROM attempted) AS allowed,
         greatest(1, ceil(extract(epoch FROM ((SELECT window_start FROM timing)
           + make_interval(secs => $2::integer) - clock_timestamp()))))::integer AS retry_after`,
      [keyHash, windowSeconds, cost, maxCost],
    );
    const row = result.rows[0]!;
    return { allowed: row.allowed, retryAfter: row.allowed ? 0 : row.retry_after, backend: "postgres" };
  } catch (error) {
    console.error("shared rate limiter unavailable; using local fallback", { error });
    return consumeLocalRateLimit(request, cost);
  }
}
