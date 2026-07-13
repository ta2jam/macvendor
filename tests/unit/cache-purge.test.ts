import { describe, expect, it, vi } from "vitest";
import {
  CachePurgeError,
  DATA_RELEASE_SURROGATE_KEY,
  normalizeSurrogateKeys,
  purgeSurrogateKeys,
  resolutionSurrogateKey,
} from "../../src/cache/surrogate";

const runId = "00000000-0000-4000-8000-000000000001";

describe("cache surrogate invalidation", () => {
  it("creates bounded deterministic resolution keys", () => {
    expect(resolutionSurrogateKey(`rr_${runId}`)).toBe(`resolved-release-${runId}`);
    expect(normalizeSurrogateKeys([DATA_RELEASE_SURROGATE_KEY, DATA_RELEASE_SURROGATE_KEY,
      `resolved-release-${runId}`])).toEqual([DATA_RELEASE_SURROGATE_KEY, `resolved-release-${runId}`]);
    expect(() => normalizeSurrogateKeys(["Invalid Key"])).toThrowError(CachePurgeError);
  });

  it("skips an unconfigured optional provider and fails when purge is required", async () => {
    await expect(purgeSurrogateKeys([DATA_RELEASE_SURROGATE_KEY], {
      endpoint: "", token: "", required: false,
    })).resolves.toEqual({ status: "skipped", reason: "not_configured" });
    await expect(purgeSurrogateKeys([DATA_RELEASE_SURROGATE_KEY], {
      endpoint: "", token: "", required: true,
    })).rejects.toMatchObject({ code: "CACHE_PURGE_NOT_CONFIGURED" });
  });

  it("posts only normalized keys to the configured HTTPS adapter", async () => {
    const fetchImplementation = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    );
    const result = await purgeSurrogateKeys([
      `resolved-release-${runId}`, DATA_RELEASE_SURROGATE_KEY, DATA_RELEASE_SURROGATE_KEY,
    ], {
      endpoint: "https://cache-adapter.example.test/purge",
      token: "test-secret",
      fetchImplementation,
    });
    expect(result).toEqual({
      status: "purged",
      surrogateKeys: [DATA_RELEASE_SURROGATE_KEY, `resolved-release-${runId}`],
    });
    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(String(url)).toBe("https://cache-adapter.example.test/purge");
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      body: JSON.stringify({ surrogateKeys: [DATA_RELEASE_SURROGATE_KEY, `resolved-release-${runId}`] }),
    });
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-secret");
  });

  it("uses Cloudflare Free cache-tag purge without a paid Worker adapter", async () => {
    const fetchImplementation = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>(
      async () => Response.json({ success: true, result: { id: "zone" } }),
    );
    await expect(purgeSurrogateKeys([DATA_RELEASE_SURROGATE_KEY], {
      provider: "cloudflare",
      cloudflareZoneId: "0123456789abcdef0123456789abcdef",
      token: "scoped-test-token",
      required: true,
      fetchImplementation,
    })).resolves.toEqual({ status: "purged", surrogateKeys: [DATA_RELEASE_SURROGATE_KEY] });
    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(String(url)).toBe("https://api.cloudflare.com/client/v4/zones/0123456789abcdef0123456789abcdef/purge_cache");
    expect(init?.body).toBe(JSON.stringify({ tags: [DATA_RELEASE_SURROGATE_KEY] }));
  });

  it("rejects malformed Cloudflare configuration before a request", async () => {
    const fetchImplementation = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>();
    await expect(purgeSurrogateKeys([DATA_RELEASE_SURROGATE_KEY], {
      provider: "cloudflare", cloudflareZoneId: "not-a-zone", token: "secret", fetchImplementation,
    })).rejects.toMatchObject({ code: "INVALID_CLOUDFLARE_ZONE_ID" });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("does not treat a Cloudflare HTTP 200 API rejection as a purge", async () => {
    await expect(purgeSurrogateKeys([DATA_RELEASE_SURROGATE_KEY], {
      provider: "cloudflare", cloudflareZoneId: "0123456789abcdef0123456789abcdef",
      token: "scoped-test-token", required: true,
      fetchImplementation: async () => Response.json({ success: false, errors: [{ code: 1000 }] }),
    })).rejects.toMatchObject({ code: "CACHE_PURGE_REJECTED", message: "Cloudflare did not accept the cache purge" });
  });

  it("contains network and HTTP failure injection without leaking the token", async () => {
    await expect(purgeSurrogateKeys([DATA_RELEASE_SURROGATE_KEY], {
      endpoint: "https://cache-adapter.example.test/purge",
      token: "never-log-this",
      fetchImplementation: async () => { throw new Error("never-log-this"); },
    })).rejects.toMatchObject({ code: "CACHE_PURGE_FAILED" });
    await expect(purgeSurrogateKeys([DATA_RELEASE_SURROGATE_KEY], {
      endpoint: "https://cache-adapter.example.test/purge",
      token: "never-log-this",
      fetchImplementation: async () => new Response("rejected details", { status: 503 }),
    })).rejects.toMatchObject({ code: "CACHE_PURGE_REJECTED", message: "cache purge endpoint returned HTTP 503" });
  });

  it("rejects unsafe endpoints and missing tokens before network access", async () => {
    const fetchImplementation = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    );
    await expect(purgeSurrogateKeys([DATA_RELEASE_SURROGATE_KEY], {
      endpoint: "http://cache-adapter.example.test/purge",
      token: "secret",
      fetchImplementation,
    })).rejects.toMatchObject({ code: "INVALID_CACHE_PURGE_ENDPOINT" });
    await expect(purgeSurrogateKeys([DATA_RELEASE_SURROGATE_KEY], {
      endpoint: "https://cache-adapter.example.test/purge",
      token: "",
      fetchImplementation,
    })).rejects.toMatchObject({ code: "CACHE_PURGE_TOKEN_REQUIRED" });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
