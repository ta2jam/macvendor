import type { NextRequest } from "next/server";
import { getAssignment } from "@/db/lookup";
import { getPool } from "@/db/pool";
import { InvalidPrefixError, normalizeRegistry, parseAssignmentPrefix, REGISTRY_LENGTHS } from "@/domain/mac";
import { consumeRateLimit } from "@/http/rate-limit";
import { jsonResponse, problemResponse, redirectResponse, requestId } from "@/http/responses";
import { DATA_RELEASE_SURROGATE_KEY, resolutionSurrogateKey } from "@/cache/surrogate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ registry: string; prefix: string }> },
) {
  const id = requestId(request);
  const rate = consumeRateLimit(request, request.nextUrl.searchParams.get("include") === "evidence" ? 5 : 1);
  if (!rate.allowed) {
    return problemResponse({ status: 429, code: "RATE_LIMITED", title: "Rate limit exceeded", detail: "Too many requests.", requestId: id, retryAfter: rate.retryAfter });
  }

  const include = request.nextUrl.searchParams.get("include");
  const unknown = [...request.nextUrl.searchParams.keys()].filter((key) => key !== "include");
  if (unknown.length || (include !== null && include !== "evidence")) {
    return problemResponse({ status: 400, code: "UNSUPPORTED_PARAMETER", title: "Unsupported parameter", detail: "Only include=evidence is supported.", requestId: id });
  }

  const raw = await params;
  if (!(raw.registry.toLowerCase() in REGISTRY_LENGTHS)) {
    return problemResponse({ status: 400, code: "INVALID_REGISTRY", title: "Invalid registry", detail: "The registry is not supported.", requestId: id });
  }

  try {
    const registry = normalizeRegistry(raw.registry);
    const prefix = parseAssignmentPrefix(raw.prefix, registry.prefixLength);
    if (raw.registry !== registry.path || raw.prefix !== prefix.canonical) {
      const canonical = process.env.PUBLIC_ORIGIN
        ? new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, process.env.PUBLIC_ORIGIN)
        : new URL(request.url);
      canonical.pathname = `/v1/assignments/${registry.path}/${prefix.canonical}`;
      return redirectResponse(canonical, id);
    }

    const result = await getAssignment(getPool(), registry.registry, prefix.bits, registry.prefixLength, include === "evidence");
    if (!result) {
      return problemResponse({ status: 404, code: "ASSIGNMENT_NOT_FOUND", title: "Assignment not found", detail: "No active assignment matches this registry and prefix.", requestId: id });
    }
    return jsonResponse(request, result, {
      requestId: id,
      cacheControl: include === "evidence" ? "private, no-store" : "public, max-age=300, s-maxage=86400",
      etagSeed: `${result.data.activeVersion}:${result.data.publicationVersion}:${registry.registry}:${prefix.canonical}:${include ?? "none"}`,
      surrogateKeys: [resolutionSurrogateKey(result.data.resolvedReleaseId), DATA_RELEASE_SURROGATE_KEY],
    });
  } catch (error) {
    if (error instanceof InvalidPrefixError) {
      return problemResponse({ status: 400, code: "INVALID_PREFIX", title: "Invalid prefix", detail: error.message, requestId: id });
    }
    console.error("assignment lookup failed", { requestId: id, error });
    return problemResponse({ status: 503, code: "SERVICE_UNAVAILABLE", title: "Service unavailable", detail: "The assignment service is temporarily unavailable.", requestId: id });
  }
}
