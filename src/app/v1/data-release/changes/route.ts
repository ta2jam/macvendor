import type { NextRequest } from "next/server";
import { DATA_RELEASE_SURROGATE_KEY, resolutionSurrogateKey } from "@/cache/surrogate";
import { getPool } from "@/db/pool";
import { getReleaseChanges } from "@/db/release-changes";
import { consumeRateLimit } from "@/http/rate-limit";
import { jsonResponse, problemResponse, requestId } from "@/http/responses";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const id = requestId(request);
  if ([...request.nextUrl.searchParams.keys()].length) return problemResponse({ status: 400,
    code: "UNSUPPORTED_PARAMETER", title: "Unsupported parameter", detail: "This endpoint does not accept query parameters.", requestId: id });
  const rate = await consumeRateLimit(request);
  if (!rate.allowed) return problemResponse({ status: 429, code: "RATE_LIMITED", title: "Rate limit exceeded",
    detail: "Too many requests.", requestId: id, retryAfter: rate.retryAfter });
  try {
    const result = await getReleaseChanges(getPool());
    return jsonResponse(request, result, { requestId: id,
      cacheControl: "public, max-age=60, s-maxage=300, stale-while-revalidate=60",
      etagSeed: `${result.current.activeVersion}:${result.current.publicationVersion}:changes`,
      surrogateKeys: [DATA_RELEASE_SURROGATE_KEY, resolutionSurrogateKey(result.current.resolvedReleaseId)] });
  } catch {
    return problemResponse({ status: 503, code: "DATA_RELEASE_UNAVAILABLE", title: "Data release unavailable",
      detail: "Release change metadata is temporarily unavailable.", requestId: id });
  }
}
