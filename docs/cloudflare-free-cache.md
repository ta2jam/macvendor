# Cloudflare Free cache policy

Production currently uses Cloudflare Free as a TLS/DDoS/transport proxy, not as
a forced public-API response cache. Lookup responses intentionally show
`CF-Cache-Status: DYNAMIC`, so every request reaches the shared PostgreSQL
origin limiter. Client and intermediary caches may still honor the documented
opaque ETag and bounded `Cache-Control` values.

This is a deliberate quota-correctness decision. Enabling a Cloudflare Cache
Rule for `/v1/*` before an edge quota design would let cache hits bypass the
origin limiter and make the published plan inaccurate.

macvendor also supports Cloudflare's cache-tag purge API directly when a new,
unexposed scoped credential is deliberately added. It does not need a paid
Worker, Custom Cache Key, Cache Reserve, or Enterprise feature.

Configuration:

```dotenv
CACHE_PURGE_PROVIDER=cloudflare
CLOUDFLARE_ZONE_ID=<32 hexadecimal characters>
CACHE_PURGE_TOKEN=<scoped Cache Purge token>
CACHE_PURGE_REQUIRED=false
```

The application emits both `Surrogate-Key` and `Cache-Tag`. Activation and
suppression paths send at most 16 normalized tags to
`POST /zones/{zone_id}/purge_cache`. Tokens must be limited to Cache Purge for
the macvendor zone and must never be committed.

Cloudflare documents cache tags and purge as available on Free. Free-plan
hostname/tag/prefix purge is limited to 5 requests per minute with a bucket of
25 and at most 100 operations per request. macvendor's maximum 16 tags and low
publication frequency stay below those constants.

- https://developers.cloudflare.com/cache/plans/
- https://developers.cloudflare.com/cache/how-to/purge-cache/

Purge is an optional future latency optimization, not a production correctness
dependency in the current `DYNAMIC` policy. Do not enable lookup caching or set
`CACHE_PURGE_REQUIRED=true` until measured load justifies it and cache-hit rate,
negative-result TTL, suppression latency and rate-limit semantics are tested in
staging. Previously exposed tokens must not be reused.
