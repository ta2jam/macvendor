import type { NextRequest } from "next/server";
import { DataReleaseUnavailableError, getDataRelease } from "@/db/lookup";
import { getPool } from "@/db/pool";
import { consumeRateLimit } from "@/http/rate-limit";
import { jsonResponse, problemResponse, requestId } from "@/http/responses";
import { DATA_RELEASE_SURROGATE_KEY, resolutionSurrogateKey } from "@/cache/surrogate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const id = requestId(request);
  const rate = consumeRateLimit(request);
  if (!rate.allowed) {
    return problemResponse({ status: 429, code: "RATE_LIMITED", title: "Rate limit exceeded", detail: "Too many requests.", requestId: id, retryAfter: rate.retryAfter });
  }
  if ([...request.nextUrl.searchParams.keys()].length) {
    return problemResponse({ status: 400, code: "UNSUPPORTED_PARAMETER", title: "Unsupported parameter", detail: "This endpoint does not accept query parameters.", requestId: id });
  }

  try {
    const result = await getDataRelease(getPool());
    const sourceVersions = result.sources
      .map((source) => `${source.slug}:${source.configVersion}:${source.currentRightsStatus}`).join("|");
    return jsonResponse(request, result, {
      requestId: id,
      cacheControl: "public, max-age=60, s-maxage=300",
      etagSeed: `${result.activeVersion}:${result.publicationVersion}:${sourceVersions}`,
      surrogateKeys: [resolutionSurrogateKey(result.resolvedReleaseId), DATA_RELEASE_SURROGATE_KEY],
    });
  } catch (error) {
    if (error instanceof DataReleaseUnavailableError) {
      return problemResponse({ status: 503, code: "DATA_RELEASE_UNAVAILABLE", title: "Data release unavailable", detail: error.message, requestId: id });
    }
    console.error("data release lookup failed", { requestId: id, error });
    return problemResponse({ status: 503, code: "SERVICE_UNAVAILABLE", title: "Service unavailable", detail: "Release metadata is temporarily unavailable.", requestId: id });
  }
}
