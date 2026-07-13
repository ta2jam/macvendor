import type { NextRequest } from "next/server";
import { bulkLookupOfficial } from "@/db/bulk-lookup";
import { getPool } from "@/db/pool";
import { InvalidMacError, normalizeMac } from "@/domain/mac";
import { consumeRateLimit } from "@/http/rate-limit";
import { problemResponse, requestId } from "@/http/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const MAX_BODY_BYTES = 16 * 1024;
const MAX_MACS = 25;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Request-Id",
    "Access-Control-Max-Age": "86400",
    Allow: "POST, OPTIONS",
  } });
}

export async function POST(request: NextRequest) {
  const id = requestId(request);
  const baseRate = await consumeRateLimit(request, 1);
  if (!baseRate.allowed) return problemResponse({ status: 429, code: "RATE_LIMITED", title: "Rate limit exceeded",
    detail: "Too many requests.", requestId: id, retryAfter: baseRate.retryAfter });
  if (request.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase() !== "application/json") {
    return problemResponse({ status: 415, code: "UNSUPPORTED_MEDIA_TYPE", title: "Unsupported media type",
      detail: "Use application/json.", requestId: id });
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return problemResponse({ status: 413, code: "BULK_BODY_TOO_LARGE", title: "Request body too large",
      detail: `Bulk lookup bodies are limited to ${MAX_BODY_BYTES} bytes.`, requestId: id });
  }
  let raw: string;
  try { raw = await request.text(); }
  catch { return problemResponse({ status: 400, code: "INVALID_JSON", title: "Invalid JSON", detail: "Request body could not be read.", requestId: id }); }
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return problemResponse({ status: 413, code: "BULK_BODY_TOO_LARGE", title: "Request body too large",
      detail: `Bulk lookup bodies are limited to ${MAX_BODY_BYTES} bytes.`, requestId: id });
  }
  let body: unknown;
  try { body = JSON.parse(raw); }
  catch { return problemResponse({ status: 400, code: "INVALID_JSON", title: "Invalid JSON", detail: "Request body must be valid JSON.", requestId: id }); }
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some((key) => key !== "macs")
    || !Array.isArray((body as { macs?: unknown }).macs)) {
    return problemResponse({ status: 400, code: "INVALID_BULK_REQUEST", title: "Invalid bulk lookup request",
      detail: "The request must contain exactly one macs array.", requestId: id });
  }
  const values = (body as { macs: unknown[] }).macs;
  if (values.length < 1 || values.length > MAX_MACS || values.some((value) => typeof value !== "string")) {
    return problemResponse({ status: 400, code: "INVALID_BULK_REQUEST", title: "Invalid bulk lookup request",
      detail: `macs must contain 1..${MAX_MACS} string values.`, requestId: id });
  }
  let macs;
  try { macs = values.map((value) => normalizeMac(value as string)); }
  catch (error) {
    const detail = error instanceof InvalidMacError ? error.message : "A MAC address is invalid.";
    return problemResponse({ status: 400, code: "INVALID_MAC", title: "Invalid MAC address", detail, requestId: id });
  }
  const rate = values.length === 1 ? baseRate : await consumeRateLimit(request, values.length - 1);
  if (!rate.allowed) return problemResponse({ status: 429, code: "RATE_LIMITED", title: "Rate limit exceeded",
    detail: "Bulk lookup cost is proportional to the number of submitted addresses.", requestId: id, retryAfter: rate.retryAfter });
  try {
    const results = await bulkLookupOfficial(getPool(), macs);
    return Response.json({ data: { type: "bulk_lookup", mode: "official", results },
      meta: { requestId: id, count: results.length, uniqueCount: new Set(macs.map((mac) => mac.normalized)).size } },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff", "X-Request-Id": id } });
  } catch {
    return problemResponse({ status: 503, code: "DATA_RELEASE_UNAVAILABLE", title: "Data release unavailable",
      detail: "Bulk lookup is temporarily unavailable.", requestId: id });
  }
}
