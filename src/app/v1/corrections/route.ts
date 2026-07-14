import type { NextRequest } from "next/server";
import { getPool } from "@/db/pool";
import { consumeRateLimit } from "@/http/rate-limit";
import { privateJsonResponse, problemResponse, requestId } from "@/http/responses";
import { CorrectionValidationError, createCorrectionRequest } from "@/operations/corrections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 16 * 1024;

class PayloadTooLargeError extends Error {}

async function readBoundedBody(request: Request): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), byteLength).toString("utf8");
}

export async function POST(request: NextRequest) {
  const id = requestId(request);
  const rate = await consumeRateLimit(request, 5);
  if (!rate.allowed) return problemResponse({ status: 429, code: "RATE_LIMITED", title: "Rate limit exceeded",
    detail: "Too many correction requests.", requestId: id, retryAfter: rate.retryAfter });
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return problemResponse({ status: 415, code: "UNSUPPORTED_MEDIA_TYPE", title: "Unsupported media type",
      detail: "Use application/json.", requestId: id });
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return problemResponse({ status: 413, code: "PAYLOAD_TOO_LARGE", title: "Payload too large",
    detail: "Correction requests are limited to 16 KiB.", requestId: id });
  try {
    const raw = await readBoundedBody(request);
    const body = JSON.parse(raw) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("request body must be an object");
    const result = await createCorrectionRequest(getPool(), body as Record<string, unknown>);
    return privateJsonResponse(result, { status: 202, requestId: id });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return problemResponse({ status: 413, code: "PAYLOAD_TOO_LARGE", title: "Payload too large",
        detail: "Correction requests are limited to 16 KiB.", requestId: id });
    }
    if (error instanceof CorrectionValidationError || error instanceof SyntaxError) {
      const detail = error instanceof Error ? error.message : "invalid request";
      return problemResponse({ status: 400, code: "INVALID_CORRECTION_REQUEST", title: "Invalid correction request", detail, requestId: id });
    }
    console.error("correction intake failed", { requestId: id, error });
    return problemResponse({ status: 503, code: "CORRECTION_INTAKE_UNAVAILABLE", title: "Correction intake unavailable",
      detail: "The correction request could not be stored.", requestId: id });
  }
}
