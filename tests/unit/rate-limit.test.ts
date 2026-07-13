import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type { Pool } from "pg";
import { consumeRateLimit } from "../../src/http/rate-limit";

function request(ip = "203.0.113.10"): NextRequest {
  return { headers: new Headers({ "x-real-ip": ip }) } as NextRequest;
}

afterEach(() => {
  globalThis.__macvendorRateBuckets?.clear();
  vi.unstubAllEnvs();
  delete process.env.RATE_LIMIT_BACKEND;
  delete process.env.RATE_LIMIT_SALT;
  delete process.env.RATE_LIMIT_WINDOW_SECONDS;
  delete process.env.RATE_LIMIT_MAX_COST;
  process.env.RATE_LIMIT_ENABLED = "false";
  process.env.TRUST_PROXY = "false";
});

describe("shared rate limiting", () => {
  it("bounds local fallback memory under many client addresses", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.RATE_LIMIT_ENABLED = "true";
    process.env.TRUST_PROXY = "true";

    for (let index = 0; index < 10_050; index += 1) {
      await consumeRateLimit(request(`2001:db8::${index.toString(16)}`));
    }

    expect(globalThis.__macvendorRateBuckets!.size).toBeLessThanOrEqual(10_000);
  });

  it("does not initialize PostgreSQL when rate limiting is disabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.RATE_LIMIT_ENABLED = "false";
    delete process.env.DATABASE_URL;

    await expect(consumeRateLimit(request())).resolves.toEqual({
      allowed: true,
      retryAfter: 0,
      backend: "disabled",
    });
  });

  it("uses a HMAC key and returns the PostgreSQL decision", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.RATE_LIMIT_ENABLED = "true";
    process.env.RATE_LIMIT_BACKEND = "postgres";
    process.env.RATE_LIMIT_SALT = "a".repeat(32);
    process.env.TRUST_PROXY = "true";
    const query = vi.fn().mockResolvedValue({ rows: [{ allowed: false, retry_after: 7 }] });
    const result = await consumeRateLimit(request(), 5, { query } as unknown as Pool);
    expect(result).toEqual({ allowed: false, retryAfter: 7, backend: "postgres" });
    expect(query.mock.calls[0]![1][0]).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(query.mock.calls)).not.toContain("203.0.113.10");
  });

  it("falls back locally when PostgreSQL is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.RATE_LIMIT_ENABLED = "true";
    process.env.RATE_LIMIT_BACKEND = "postgres";
    process.env.RATE_LIMIT_SALT = "b".repeat(32);
    const query = vi.fn().mockRejectedValue(new Error("offline"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await consumeRateLimit(request(), 1, { query } as unknown as Pool);
    expect(result.backend).toBe("local");
    expect(result.allowed).toBe(true);
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });
});
