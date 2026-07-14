import type { NextRequest } from "next/server";
import { bulkLookupEnriched, bulkLookupOfficial } from "@/db/bulk-lookup";
import { getPool } from "@/db/pool";
import { InvalidMacError, normalizeMac } from "@/domain/mac";
import { consumeRateLimit } from "@/http/rate-limit";
import { privateJsonResponse, problemResponse, publicApiHeaders, requestId } from "@/http/responses";
import { BULK_LOOKUP_LIMITS, bulkLookupCost, type PublicLookupMode } from "@/http/public-api-policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const MAX_BODY_BYTES = 16 * 1024;

export async function OPTIONS(request: NextRequest) {
  const headers = publicApiHeaders(requestId(request));
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, X-Request-Id");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Allow", "POST, OPTIONS");
  headers.delete("Content-Type");
  return new Response(null, { status: 204, headers });
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
    || Object.keys(body).some((key) => key !== "macs" && key !== "mode")
    || !Array.isArray((body as { macs?: unknown }).macs)) {
    return problemResponse({ status: 400, code: "INVALID_BULK_REQUEST", title: "Invalid bulk lookup request",
      detail: "The request must contain a macs array and may contain mode.", requestId: id });
  }
  const requestBody = body as { macs: unknown[]; mode?: unknown };
  if (requestBody.mode !== undefined && requestBody.mode !== "official" && requestBody.mode !== "enriched") {
    return problemResponse({ status: 400, code: "INVALID_BULK_REQUEST", title: "Invalid bulk lookup request",
      detail: "mode must be official or enriched.", requestId: id });
  }
  const mode: PublicLookupMode = requestBody.mode === "enriched" ? "enriched" : "official";
  const values = requestBody.macs;
  const maxMacs = BULK_LOOKUP_LIMITS[mode];
  if (values.length < 1 || values.length > maxMacs || values.some((value) => typeof value !== "string")) {
    return problemResponse({ status: 400, code: "INVALID_BULK_REQUEST", title: "Invalid bulk lookup request",
      detail: `macs must contain 1..${maxMacs} string values in ${mode} mode.`, requestId: id });
  }
  let macs;
  try { macs = values.map((value) => normalizeMac(value as string)); }
  catch (error) {
    const detail = error instanceof InvalidMacError ? error.message : "A MAC address is invalid.";
    return problemResponse({ status: 400, code: "INVALID_MAC", title: "Invalid MAC address", detail, requestId: id });
  }
  const totalCost = bulkLookupCost(mode, values.length);
  const rate = totalCost === 1 ? baseRate : await consumeRateLimit(request, totalCost - 1);
  if (!rate.allowed) return problemResponse({ status: 429, code: "RATE_LIMITED", title: "Rate limit exceeded",
    detail: "Bulk lookup cost exceeded the current client quota.", requestId: id, retryAfter: rate.retryAfter });
  try {
    const pool = getPool();
    const results = mode === "enriched"
      ? await bulkLookupEnriched(pool, macs)
      : await bulkLookupOfficial(pool, macs);
    return privateJsonResponse({ data: { type: "bulk_lookup", mode, results },
      meta: { requestId: id, count: results.length, uniqueCount: new Set(macs.map((mac) => mac.normalized)).size } },
    { requestId: id });
  } catch {
    return problemResponse({ status: 503, code: "DATA_RELEASE_UNAVAILABLE", title: "Data release unavailable",
      detail: "Bulk lookup is temporarily unavailable.", requestId: id });
  }
}
