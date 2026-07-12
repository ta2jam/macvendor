import type { NextRequest } from "next/server";
import { getPool } from "@/db/pool";
import { DataReleaseUnavailableError, lookupMac } from "@/db/lookup";
import { InvalidMacError, normalizeMac } from "@/domain/mac";
import { consumeRateLimit } from "@/http/rate-limit";
import { jsonResponse, problemResponse, redirectResponse, requestId } from "@/http/responses";
import { DATA_RELEASE_SURROGATE_KEY, resolutionSurrogateKey } from "@/cache/surrogate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ mac: string }> }) {
  const id = requestId(request);
  const rate = consumeRateLimit(request);
  if (!rate.allowed) {
    return problemResponse({
      status: 429,
      code: "RATE_LIMITED",
      title: "Rate limit exceeded",
      detail: "Too many requests. Retry after the indicated delay.",
      requestId: id,
      retryAfter: rate.retryAfter,
    });
  }

  const unsupported = [...request.nextUrl.searchParams.keys()].filter((key) => key !== "mode");
  const mode = request.nextUrl.searchParams.get("mode") ?? "all";
  if (unsupported.length || (mode !== "all" && mode !== "official")) {
    return problemResponse({
      status: 400,
      code: "UNSUPPORTED_PARAMETER",
      title: "Unsupported parameter",
      detail: "Only mode=all or mode=official is supported.",
      requestId: id,
    });
  }

  try {
    const { mac: rawMac } = await params;
    const mac = normalizeMac(rawMac);
    if (rawMac !== mac.normalized) {
      const canonical = process.env.PUBLIC_ORIGIN
        ? new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, process.env.PUBLIC_ORIGIN)
        : new URL(request.url);
      canonical.pathname = `/v1/lookup/${mac.normalized}`;
      return redirectResponse(canonical, id);
    }

    const result = await lookupMac(getPool(), mac, mode);
    const body = {
      query: {
        input: mac.normalized,
        normalized: mac.normalized,
        flags: mac.flags,
      },
      ...result,
    };
    const positive = Boolean(result.assignment || result.curatedMatches.length || result.insights.length);
    return jsonResponse(request, body, {
      requestId: id,
      cacheControl: positive
        ? "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800"
        : "public, max-age=60, s-maxage=3600",
      etagSeed: `${result.data.activeVersion}:${result.data.publicationVersion}:${mode}:${mac.normalized}`,
      surrogateKeys: [resolutionSurrogateKey(result.data.resolvedReleaseId), DATA_RELEASE_SURROGATE_KEY],
    });
  } catch (error) {
    if (error instanceof InvalidMacError) {
      return problemResponse({ status: 400, code: "INVALID_MAC", title: "Invalid MAC address", detail: error.message, requestId: id });
    }
    if (error instanceof DataReleaseUnavailableError) {
      return problemResponse({ status: 503, code: "DATA_RELEASE_UNAVAILABLE", title: "Data release unavailable", detail: error.message, requestId: id });
    }
    console.error("lookup failed", { requestId: id, error });
    return problemResponse({ status: 503, code: "SERVICE_UNAVAILABLE", title: "Service unavailable", detail: "The lookup service is temporarily unavailable.", requestId: id });
  }
}
