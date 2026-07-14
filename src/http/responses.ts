import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { normalizeSurrogateKeys } from "@/cache/surrogate";
import { PUBLIC_API_VERSION } from "@/http/public-api-policy";
import { APP_VERSION } from "@/lib/version";

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
    "X-API-Version": PUBLIC_API_VERSION,
    "X-App-Version": APP_VERSION,
    "X-Request-Id": id,
  };
}

export function publicApiHeaders(id: string): Headers {
  return new Headers(commonHeaders(id));
}

function validatorIdentity(value: string): string | null {
  const weak = value.startsWith("W/");
  const tag = weak ? value.slice(2) : value;
  const quoted = /^"([^"]*)"$/u.exec(tag);
  if (!quoted) return null;
  // Caddy's encode handler derives weak validators for compressed variants by
  // adding the content-coding suffix. If-None-Match on GET uses weak
  // comparison, so the encoded and identity representations share semantics.
  return weak ? quoted[1].replace(/-(?:br|gzip|zstd)$/u, "") : quoted[1];
}

function matchingIfNoneMatch(header: string | null, etag: string): string | null {
  if (!header) return null;
  const expected = validatorIdentity(etag);
  for (const candidate of header.split(",")) {
    const value = candidate.trim();
    if (value === "*") return etag;
    if (expected !== null && validatorIdentity(value) === expected) return value;
  }
  return null;
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
      apiVersion: PUBLIC_API_VERSION,
      appVersion: APP_VERSION,
    },
    { status: args.status, headers },
  );
}

export function privateJsonResponse(body: unknown, args: { requestId: string; status?: number }): Response {
  const headers = new Headers(commonHeaders(args.requestId));
  headers.set("Cache-Control", "private, no-store");
  return Response.json(body, {
    status: args.status ?? 200,
    headers,
  });
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

  const matchingValidator = matchingIfNoneMatch(request.headers.get("if-none-match"), etag);
  if (matchingValidator) {
    headers.set("ETag", matchingValidator);
    headers.delete("Content-Type");
    return new Response(null, { status: 304, headers });
  }
  return new Response(json, { status: 200, headers });
}

export function redirectResponse(url: URL, id: string): Response {
  const headers = new Headers(commonHeaders(id));
  headers.set("Cache-Control", "public, max-age=300");
  headers.set("Location", url.toString());
  return new Response(null, {
    status: 308,
    headers,
  });
}
