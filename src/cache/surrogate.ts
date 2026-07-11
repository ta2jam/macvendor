const SURROGATE_KEY = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const RESOLUTION_ID = /^(?:rr_)?([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export const DATA_RELEASE_SURROGATE_KEY = "data-release";

export class CachePurgeError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "CachePurgeError";
  }
}

export function resolutionSurrogateKey(resolutionRunId: string): string {
  const match = RESOLUTION_ID.exec(resolutionRunId);
  if (!match) throw new CachePurgeError("INVALID_SURROGATE_KEY", "resolution run ID is invalid");
  return `resolved-release-${match[1]!.toLowerCase()}`;
}

export function normalizeSurrogateKeys(values: string[]): string[] {
  const keys = [...new Set(values)].sort();
  if (keys.length < 1 || keys.length > 16 || keys.some((key) => !SURROGATE_KEY.test(key))) {
    throw new CachePurgeError("INVALID_SURROGATE_KEY", "surrogate keys must contain 1..16 bounded lowercase keys");
  }
  return keys;
}

type FetchImplementation = (input: string | URL, init?: RequestInit) => Promise<Response>;

export async function purgeSurrogateKeys(
  values: string[],
  options: {
    endpoint?: string;
    token?: string;
    required?: boolean;
    fetchImplementation?: FetchImplementation;
    timeoutMs?: number;
  } = {},
): Promise<{ status: "purged"; surrogateKeys: string[] } | { status: "skipped"; reason: "not_configured" }> {
  const surrogateKeys = normalizeSurrogateKeys(values);
  const endpoint = options.endpoint ?? process.env.CACHE_PURGE_ENDPOINT;
  const token = options.token ?? process.env.CACHE_PURGE_TOKEN;
  const required = options.required ?? process.env.CACHE_PURGE_REQUIRED === "true";
  if (!endpoint) {
    if (required) throw new CachePurgeError("CACHE_PURGE_NOT_CONFIGURED", "cache purge is required but no endpoint is configured");
    return { status: "skipped", reason: "not_configured" };
  }
  let url: URL;
  try {
    url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
  } catch {
    throw new CachePurgeError("INVALID_CACHE_PURGE_ENDPOINT", "cache purge endpoint must be HTTPS without credentials, query, or fragment");
  }
  if (!token || token.length > 4_096 || /[\u0000-\u001f\u007f]/u.test(token)) {
    throw new CachePurgeError("CACHE_PURGE_TOKEN_REQUIRED", "a bounded cache purge token is required when an endpoint is configured");
  }
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new CachePurgeError("INVALID_CACHE_PURGE_TIMEOUT", "cache purge timeout must be 100..30000 milliseconds");
  }
  const fetchImplementation = options.fetchImplementation ?? fetch;
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "macvendor-cache-purge/1",
      },
      body: JSON.stringify({ surrogateKeys }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new CachePurgeError("CACHE_PURGE_FAILED", "cache purge request failed before an accepted response");
  }
  await response.body?.cancel().catch(() => undefined);
  if (!response.ok) {
    throw new CachePurgeError("CACHE_PURGE_REJECTED", `cache purge endpoint returned HTTP ${response.status}`);
  }
  return { status: "purged", surrogateKeys };
}
