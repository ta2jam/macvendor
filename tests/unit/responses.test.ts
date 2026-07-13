import { describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { jsonResponse } from "../../src/http/responses";

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

  it("returns the representation when no validator matches", () => {
    expect(response('"unrelated"').status).toBe(200);
  });
});
