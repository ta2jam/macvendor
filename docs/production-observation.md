# Production observation and expansion gate

Observation window: 2026-07-15 through 2026-08-14.

macvendor has production engineering evidence but not product-market or
long-duration operating evidence. Forty-seven commits and forty-three tags in
the first four days are not maturity signals. This window deliberately replaces
feature volume with measured behavior.

## Change policy

- No new product surface or production data source during the window.
- Security, correctness, rights, privacy, recovery and operational fixes remain allowed.
- Bundle ordinary fixes into no more than one scheduled release per seven days.
- P0/P1 incidents may ship immediately with a written incident reason.
- Every production change uses a pull request and required checks. Until a
  second trusted reviewer exists, approval count may be zero; this is workflow
  protection, not independent review.

## Initial evidence

The 2026-07-15 v2 replay over the rolling 24-hour log contained 898 requests,
564 likely automated exploit scans, 463 client errors, one rate-limited request
and zero server errors. Of the 4xx responses, 459 were `404`, three were `400`
and one was `429`. A bounded route/status inspection showed the `404` volume was
dominated by WordPress/PHP/CGI probes. The old single `clientErrors` number
therefore overstated product failure.

Traffic report schema `macvendor-traffic/v2` now retains only fixed counters:
product and operational requests, known monitor requests, likely automated
scans, status/error classes and bounded endpoint buckets. It stores no raw URI,
MAC, IP address or User-Agent. Classification cost is `O(R)` time and constant
working memory for `R` log records; output cardinality is fixed.

## Weekly evidence record

Record the following once per week without copying raw access logs:

- request, product-request, known-monitor and likely-scan counts;
- endpoint buckets, 400/404/429/other 4xx, 5xx and peak requests/minute;
- mean plus p95/p99 origin duration when the reporting path supports percentiles;
- source age, rights-review horizon and publication/update failures;
- host available memory, disk use, database/app RSS and backup size growth;
- correction queue age, restore/rollback result and production release SHA.

Request counts do not identify users. Independent-use evidence requires a
voluntary issue, correction/contact submission, integration report or another
documented external signal. Stars, bots and synthetic probes do not satisfy it.

## Expansion decision

Do not add accounts, API keys, payments, SDK repositories, higher quotas or a
distributed architecture unless the 30-day review establishes a concrete need.
The minimum commercial/product signal is three independent integrations or
repeated legitimate quota/support requests. The minimum capacity signal is a
measured breach of the existing latency, memory, disk, I/O, 429 or 5xx gates.
