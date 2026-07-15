# macvendor technical roadmap

This roadmap records current production truth and evidence gates. It is not a
feature wish list.

## Current — 0.7.4 observation release

The modular monolith serves governed IEEE assignments and separately labelled
enrichment through the web interface and versioned API. Production uses
PostgreSQL, Caddy, Cloudflare's free transport proxy, shared origin rate
limiting, immutable data releases, encrypted correction intake, scheduled
source publication, backups, restore drills, and external monitoring.

The implemented contract includes:

- exact 36 -> 28 -> 24-bit authoritative longest-prefix matching;
- explicit `matched` and `no_match` results;
- official and enriched single/bulk modes;
- OpenAPI 3.1, JSON Schema, RFC 9457 errors, version headers, ETag and cache policy;
- 19 governed production inputs with provenance, rights expiry, source health,
  atomic publication and rollback;
- bounded resolver, correction, retention, backup, restore, accessibility,
  supply-chain, release-sync and production-monitor gates;
- privacy-preserving traffic reporting that separates product routes,
  operational probes and likely automated exploit scans.

## Observation window — 2026-07-15 through 2026-08-14

Feature expansion and new production data sources are frozen. Security,
correctness, data-rights, dependency, recovery and operational fixes remain
allowed. Ordinary fixes are bundled into at most one scheduled release in any
seven-day period; a measured P0/P1 incident may justify an emergency release.

The review must use 30 days of evidence:

- availability, p95/p99 origin latency, 4xx classes, 429, 5xx and peak minute;
- product-route requests separated from health checks and likely exploit scans;
- source freshness, publication failures, rights-review horizon and correction SLA;
- host and container CPU, memory, disk, I/O and backup growth;
- real restore/rollback evidence and local/GitHub/release/production sync;
- documented independent users or integrations, not page views, bots, stars or
  synthetic monitor traffic.

The detailed decision record is in
[`production-observation.md`](./production-observation.md).

## Next decision

After 2026-08-14, choose one path from evidence:

1. Keep the bounded free public service unchanged when capacity and demand are low.
2. Improve documentation and integration examples when valid API use exists but
   integration errors remain material.
3. Add API keys/account quotas only after at least three independent integrations
   or repeated legitimate quota requests.
4. Raise bulk or origin limits only after measured concurrency, PostgreSQL wait,
   RSS, CPU, I/O and latency evidence.

Accounts, payments, SDK repositories, raw data redistribution, Redis,
microservices and Kubernetes remain out of scope without those gates. Amateur
data stays in the existing non-publishing quarantine path until a real file,
rights declaration and privacy review are supplied.

## Version 1.0 gate

Do not publish 1.0 until all are true:

- at least 30 days of measured production stability;
- no binding-document drift against the deployed API and operations;
- successful real-backup restore and rollback drills;
- current source-rights reviews and zero unresolved publication failures;
- a documented backward-compatibility policy and frozen v1 contract;
- evidence of independent use;
- PR-based protected-main releases and a documented continuity path.
