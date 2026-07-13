import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { normalizeSurrogateKeys } from "@/cache/surrogate";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

export function requestId(request: Request): string {
  const candidate = request.headers.get("x-request-id");
  return candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : `req_${randomUUID()}`;
}

function commonHeaders(id: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": id,
  };
}

export function problemResponse(args: {
  status: number;
  code: string;
  title: string;
  detail: string;
  requestId: string;
  retryAfter?: number;
}): Response {
  const slug = args.code.toLowerCase().replaceAll("_", "-");
  const headers = new Headers(commonHeaders(args.requestId));
  headers.set("Content-Type", "application/problem+json; charset=utf-8");
  headers.set("Cache-Control", "private, no-store");
  if (args.retryAfter) headers.set("Retry-After", String(args.retryAfter));

  return Response.json(
    {
      type: `https://macvendor.io/problems/${slug}`,
      title: args.title,
      status: args.status,
      code: args.code,
      detail: args.detail,
      requestId: args.requestId,
    },
    { status: args.status, headers },
  );
}

export function jsonResponse(
  request: NextRequest,
  body: unknown,
  args: { requestId: string; cacheControl: string; etagSeed: string; surrogateKeys?: string[] },
): Response {
  const json = JSON.stringify(body);
  const digest = createHash("sha256").update(args.etagSeed).update("\0").update(json).digest("base64url");
  const etag = `"${digest}"`;
  const headers = new Headers(commonHeaders(args.requestId));
  headers.set("Cache-Control", args.cacheControl);
  headers.set("ETag", etag);
  if (args.surrogateKeys && args.cacheControl.startsWith("public,")) {
    const keys = normalizeSurrogateKeys(args.surrogateKeys);
    headers.set("Surrogate-Key", keys.join(" "));
    headers.set("Cache-Tag", keys.join(","));
  }

  if (request.headers.get("if-none-match") === etag) {
    headers.delete("Content-Type");
    return new Response(null, { status: 304, headers });
  }
  return new Response(json, { status: 200, headers });
}

export function redirectResponse(url: URL, id: string): Response {
  return new Response(null, {
    status: 308,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
      Location: url.toString(),
      "X-Request-Id": id,
    },
  });
}
