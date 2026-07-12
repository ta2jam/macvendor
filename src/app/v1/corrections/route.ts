import type { NextRequest } from "next/server";
import { getPool } from "@/db/pool";
import { consumeRateLimit } from "@/http/rate-limit";
import { problemResponse, requestId } from "@/http/responses";
import { CorrectionValidationError, createCorrectionRequest } from "@/operations/corrections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const id = requestId(request);
  const rate = await consumeRateLimit(request, 5);
  if (!rate.allowed) return problemResponse({ status: 429, code: "RATE_LIMITED", title: "Rate limit exceeded",
    detail: "Too many correction requests.", requestId: id, retryAfter: rate.retryAfter });
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    return problemResponse({ status: 415, code: "UNSUPPORTED_MEDIA_TYPE", title: "Unsupported media type",
      detail: "Use application/json.", requestId: id });
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 16_384) return problemResponse({ status: 413, code: "PAYLOAD_TOO_LARGE", title: "Payload too large",
    detail: "Correction requests are limited to 16 KiB.", requestId: id });
  try {
    const body = await request.json() as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("request body must be an object");
    const result = await createCorrectionRequest(getPool(), body as Record<string, unknown>);
    return Response.json(result, { status: 202, headers: { "Cache-Control": "private, no-store", "X-Request-Id": id } });
  } catch (error) {
    if (error instanceof CorrectionValidationError || error instanceof SyntaxError) {
      const detail = error instanceof Error ? error.message : "invalid request";
      return problemResponse({ status: 400, code: "INVALID_CORRECTION_REQUEST", title: "Invalid correction request", detail, requestId: id });
    }
    console.error("correction intake failed", { requestId: id, error });
    return problemResponse({ status: 503, code: "CORRECTION_INTAKE_UNAVAILABLE", title: "Correction intake unavailable",
      detail: "The correction request could not be stored.", requestId: id });
  }
}
