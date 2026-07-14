import { describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { jsonResponse, privateJsonResponse, problemResponse, redirectResponse } from "../../src/http/responses";

function response(ifNoneMatch?: string) {
  const request = new Request("https://macvendor.io/v1/data-release", {
    headers: ifNoneMatch ? { "if-none-match": ifNoneMatch } : undefined,
  }) as NextRequest;
  return jsonResponse(request, { activeVersion: 1 }, {
    requestId: "test",
    cacheControl: "public, max-age=60",
    etagSeed: "release-1",
  });
}

describe("conditional JSON responses", () => {
  it("matches an ETag inside an If-None-Match list", () => {
    const etag = response().headers.get("etag")!;
    expect(response(`"unrelated", ${etag}`).status).toBe(304);
  });

  it("uses weak comparison and supports the wildcard", () => {
    const etag = response().headers.get("etag")!;
    expect(response(`W/${etag}`).status).toBe(304);
    expect(response("*").status).toBe(304);
  });

  it("recognizes and preserves weak validators derived by proxy compression", () => {
    const etag = response().headers.get("etag")!;
    const opaque = etag.slice(1, -1);
    for (const coding of ["gzip", "zstd", "br"]) {
      const encoded = `W/"${opaque}-${coding}"`;
      const cached = response(encoded);
      expect(cached.status).toBe(304);
      expect(cached.headers.get("etag")).toBe(encoded);
    }
    expect(response(`W/"${opaque}-deflate"`).status).toBe(200);
  });

  it("returns the representation when no validator matches", () => {
    expect(response('"unrelated"').status).toBe(200);
  });

  it("keeps ETag, cache policy, and version headers on 304", () => {
    const initial = response();
    const cached = response(initial.headers.get("etag")!);
    expect(cached.status).toBe(304);
    expect(cached.headers.get("cache-control")).toBe("public, max-age=60");
    expect(cached.headers.get("etag")).toBe(initial.headers.get("etag"));
    expect(cached.headers.get("x-api-version")).toBe("v1");
    expect(cached.headers.get("x-app-version")).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("uses one versioned no-store policy for private and problem responses", async () => {
    const privateResponse = privateJsonResponse({ status: "accepted" }, { requestId: "private", status: 202 });
    const problem = problemResponse({ status: 400, code: "INVALID_MAC", title: "Invalid MAC",
      detail: "Invalid input.", requestId: "problem" });
    for (const item of [privateResponse, problem]) {
      expect(item.headers.get("cache-control")).toBe("private, no-store");
      expect(item.headers.get("etag")).toBeNull();
      expect(item.headers.get("x-api-version")).toBe("v1");
      expect(item.headers.get("x-app-version")).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(await problem.json()).toMatchObject({ apiVersion: "v1", appVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/) });
  });

  it("versions canonical redirects without attaching an entity validator", () => {
    const redirected = redirectResponse(new URL("https://macvendor.io/v1/lookup/001122334455"), "redirect");
    expect(redirected.status).toBe(308);
    expect(redirected.headers.get("cache-control")).toBe("public, max-age=300");
    expect(redirected.headers.get("etag")).toBeNull();
    expect(redirected.headers.get("x-api-version")).toBe("v1");
  });
});
