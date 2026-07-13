# Cloudflare Free cache policy

Production currently uses release-scoped ETags and a maximum five-minute shared
TTL. This has no Cloudflare credential and no paid-feature dependency. A
suppression or activation can therefore remain in an already cached response for
at most five minutes; origin state changes immediately.

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

Purge is an optional latency optimization, not a production correctness
dependency. If enabled later, set `CACHE_PURGE_REQUIRED=true` only after a
staging purge succeeds. Previously exposed tokens must not be reused.
