import { lookup as dnsLookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import type { SecureContextOptions } from "node:tls";
import { ImportValidationError } from "@/importer/errors";

export interface FetchNetworkOptions {
  resolver?: (hostname: string) => Promise<LookupAddress[]>;
  ca?: SecureContextOptions["ca"];
  testOnlyAllowPrivateAddresses?: boolean;
}

interface LookupAddress {
  address: string;
  family: number;
}

export interface DownloadPolicy {
  allowedOrigins: string[];
  maxRedirects: number;
  maxBytes: number;
  timeoutMs: number;
}

function ipv4Number(address: string): number {
  return address.split(".").reduce((value, octet) => value * 256 + Number(octet), 0) >>> 0;
}

function inIpv4Range(value: number, base: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (ipv4Number(base) & mask);
}

function parseIpv6(address: string): bigint | null {
  let value = address.toLowerCase().split("%")[0]!;
  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    const ipv4 = value.slice(lastColon + 1);
    if (isIP(ipv4) !== 4) return null;
    const numeric = ipv4Number(ipv4);
    value = `${value.slice(0, lastColon)}:${(numeric >>> 16).toString(16)}:${(numeric & 0xffff).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  if ((halves.length === 1 && left.length !== 8) || left.length + right.length > 7) return null;
  const groups = [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n);
}

function ipv6Prefix(value: bigint, base: bigint, prefix: number): boolean {
  return (value >> BigInt(128 - prefix)) === (base >> BigInt(128 - prefix));
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Number(address);
    const blocked: Array<[string, number]> = [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
      ["224.0.0.0", 4], ["240.0.0.0", 4],
    ];
    return !blocked.some(([base, prefix]) => inIpv4Range(value, base, prefix));
  }
  if (family === 6) {
    const value = parseIpv6(address);
    if (value === null) return false;
    const globalBase = 0x20000000000000000000000000000000n;
    const documentation = 0x20010db8000000000000000000000000n;
    return ipv6Prefix(value, globalBase, 3) && !ipv6Prefix(value, documentation, 32);
  }
  return false;
}

function safeUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new ImportValidationError("INVALID_REMOTE_URL", "remote URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new ImportValidationError("INVALID_REMOTE_URL", "remote URL must be HTTPS without credentials, query, or fragment");
  }
  return url;
}

async function pinnedAddress(url: URL, options: FetchNetworkOptions, timeoutMs: number): Promise<LookupAddress> {
  const hostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await new Promise<LookupAddress[]>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new ImportValidationError("DNS_TIMEOUT", "remote hostname resolution exceeded the timeout")),
          timeoutMs,
        );
        (options.resolver ?? ((name) => dnsLookup(name, { all: true, verbatim: true })))(hostname)
          .then((result) => { clearTimeout(timer); resolve(result); }, (error) => { clearTimeout(timer); reject(error); });
      });
  if (addresses.length < 1 || addresses.length > 8) {
    throw new ImportValidationError("DNS_RESULT_BLOCKED", "remote hostname must resolve to 1..8 addresses");
  }
  if (options.testOnlyAllowPrivateAddresses && process.env.NODE_ENV !== "test") {
    throw new ImportValidationError("TEST_NETWORK_OVERRIDE_BLOCKED", "private-address override is test-only");
  }
  if (!options.testOnlyAllowPrivateAddresses && addresses.some((item) => !isPublicAddress(item.address))) {
    throw new ImportValidationError("SSRF_ADDRESS_BLOCKED", "remote hostname resolved to a non-public address");
  }
  return [...addresses].sort((left, right) => left.family - right.family || left.address.localeCompare(right.address))[0]!;
}

function requestBuffer(url: URL, address: LookupAddress, maximumBytes: number, timeoutMs: number, ca: SecureContextOptions["ca"]): Promise<{
  status: number; location: string | null; body: Buffer;
}> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let byteSize = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const req = request(url, {
      method: "GET",
      agent: false,
      headers: { Accept: "application/octet-stream", "Accept-Encoding": "identity", "User-Agent": "macvendor-fetcher/1" },
      ca,
      lookup: ((_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
        if (options?.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      }) as never,
    });
    const timer = setTimeout(() => req.destroy(new ImportValidationError("FETCH_TIMEOUT", "remote fetch exceeded its wall-time limit")), timeoutMs);
    req.once("error", (error) => { clearTimeout(timer); fail(error); });
    req.once("response", (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location ?? null;
      if ([301, 302, 303, 307, 308].includes(status)) {
        clearTimeout(timer);
        response.destroy();
        settled = true;
        resolve({ status, location, body: Buffer.alloc(0) });
        return;
      }
      const encoding = response.headers["content-encoding"];
      if (encoding && encoding !== "identity") {
        clearTimeout(timer);
        response.destroy();
        fail(new ImportValidationError("CONTENT_ENCODING_BLOCKED", "compressed remote responses are not accepted"));
        return;
      }
      const declared = Number(response.headers["content-length"] ?? 0);
      if (Number.isFinite(declared) && declared > maximumBytes) {
        clearTimeout(timer);
        response.destroy();
        fail(new ImportValidationError("FETCH_TOO_LARGE", "remote artifact exceeds the byte limit"));
        return;
      }
      response.on("data", (chunk: Buffer) => {
        byteSize += chunk.byteLength;
        if (byteSize > maximumBytes) {
          req.destroy(new ImportValidationError("FETCH_TOO_LARGE", "remote artifact exceeds the byte limit"));
          response.destroy();
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.once("error", (error) => { clearTimeout(timer); fail(error); });
      response.once("end", () => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve({ status, location, body: Buffer.concat(chunks, byteSize) });
      });
    });
    req.end();
  });
}

export async function downloadHttps(
  inputUrl: string,
  policy: DownloadPolicy,
  options: FetchNetworkOptions = {},
): Promise<{ bytes: Buffer; redirectCount: number; finalOrigin: string }> {
  const allowed = new Set(policy.allowedOrigins.map((origin) => safeUrl(origin).origin));
  if (allowed.size < 1 || allowed.size !== policy.allowedOrigins.length) {
    throw new ImportValidationError("INVALID_ORIGIN_ALLOWLIST", "origin allowlist must contain unique HTTPS origins");
  }
  if (!Number.isInteger(policy.maxRedirects) || policy.maxRedirects < 0 || policy.maxRedirects > 3
    || !Number.isInteger(policy.maxBytes) || policy.maxBytes < 1 || policy.maxBytes > 20 * 1024 * 1024
    || !Number.isInteger(policy.timeoutMs) || policy.timeoutMs < 100 || policy.timeoutMs > 300_000) {
    throw new ImportValidationError("INVALID_FETCH_POLICY", "fetch policy limits are invalid");
  }
  let url = safeUrl(inputUrl);
  const visited = new Set<string>();
  const deadline = Date.now() + policy.timeoutMs;
  for (let redirects = 0; redirects <= policy.maxRedirects; redirects += 1) {
    if (!allowed.has(url.origin)) throw new ImportValidationError("REMOTE_ORIGIN_BLOCKED", "remote URL origin is not allowlisted");
    if (visited.has(url.href)) throw new ImportValidationError("REDIRECT_LOOP", "remote redirect loop detected");
    visited.add(url.href);
    const remainingForDns = deadline - Date.now();
    if (remainingForDns < 1) throw new ImportValidationError("FETCH_TIMEOUT", "remote fetch exceeded its wall-time limit");
    let address: LookupAddress;
    try {
      address = await pinnedAddress(url, options, remainingForDns);
    } catch (error) {
      if (error instanceof ImportValidationError) throw error;
      throw new ImportValidationError("DNS_FAILED", "remote hostname resolution failed");
    }
    const remainingForRequest = deadline - Date.now();
    if (remainingForRequest < 1) throw new ImportValidationError("FETCH_TIMEOUT", "remote fetch exceeded its wall-time limit");
    let result;
    try {
      result = await requestBuffer(url, address, policy.maxBytes, remainingForRequest, options.ca);
    } catch (error) {
      if (error instanceof ImportValidationError) throw error;
      throw new ImportValidationError("FETCH_FAILED", "HTTPS fetch failed TLS or transport validation");
    }
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      if (redirects === policy.maxRedirects) throw new ImportValidationError("TOO_MANY_REDIRECTS", "remote fetch exceeded the redirect limit");
      if (!result.location) throw new ImportValidationError("INVALID_REDIRECT", "redirect response has no Location header");
      url = safeUrl(new URL(result.location, url).href);
      continue;
    }
    if (result.status !== 200) throw new ImportValidationError("FETCH_STATUS_REJECTED", "remote fetch did not return HTTP 200");
    return { bytes: result.body, redirectCount: redirects, finalOrigin: url.origin };
  }
  throw new ImportValidationError("TOO_MANY_REDIRECTS", "remote fetch exceeded the redirect limit");
}
