# macvendor technical roadmap

This roadmap is directional, not a promise. Security, data rights, privacy, and
correctness gates can delay or reject a feature.

## Current — 0.0.17 durable foundation

- [x] strict EUI-48 normalization;
- [x] authoritative and curated layers kept separate;
- [x] immutable source/release/resolution schema;
- [x] active release pointer and suppression overlay;
- [x] web UI and versioned API;
- [x] synthetic local seed;
- [x] unit, PostgreSQL integration, build, and HTTP smoke coverage;
- [x] CI, issue templates, contribution, security, and release policy.
- [x] offline manifest-driven CSV/TSV/JSONL source-release importer;
- [x] deterministic input manifests and semantic output hashes;
- [x] authoritative conflict rejection and independent curated claims;
- [x] idempotent, concurrency-locked builds;
- [x] guarded atomic activation and rollback commands.
- [x] OpenAPI 3.1 and JSON Schema response contracts;
- [x] runtime response-drift tests;
- [x] audited create, revoke, list, and expire suppression commands;
- [x] provider-neutral non-root staging image and container smoke workflow.
- [x] isolated allowlisted HTTPS fetch and DNS/IP SSRF controls;
- [x] Ed25519 artifact authenticity verification;
- [x] full-snapshot completeness, duplicate, and release-diff gates.
- [x] snapshot-consistent logical backup with checksum manifest;
- [x] guarded disposable-database restore and integrity verification;
- [x] zero-from-artifact migration/import/resolution rebuild drill.
- [x] WCAG A/AA-oriented axe gate across Chromium, Firefox, WebKit, and a
  320 px mobile viewport;
- [x] skip link, visible focus, async status/error semantics, mobile navigation,
  and measured text contrast fixes;
- [x] public data-use/attribution terms and correction/takedown process pages;
- [x] runtime-validated correction email with an explicit unavailable state;

## Next — production-data readiness

- [x] approve scoped IEEE MA-L/MA-M/MA-S derived API output under the documented
  2013/2014 evidence chain, explicit owner risk acceptance, annual re-review,
  direct-origin requirement, and no-raw-redistribution boundary — issue #8;
- [x] prepare, sign, import, resolve, and locally activate a real 53,283-row IEEE
  release while omitting two ambiguous duplicate MA-L prefixes;
- [x] guarded one-command IEEE prepare/import/build/activate workflow with
  overlap rejection, immutable unchanged-snapshot observations, freshness
  continuity, and explicit post-commit failure reporting — issue #29;
- [x] exact migration SHA-256 ledger, applied-history drift rejection, and
  transactional legacy checksum backfill — issue #31;
- [x] compile-time reviewed source-adapter registry, version/source ownership
  bindings, bounded transform contract, and database-free fixture validator —
  issue #33;
- [x] preview-first source governance decisions with transactional config
  versioning/audit, active-publication risk acceptance, and cache invalidation —
  issue #35;
- [x] active non-production source failure, config-snapshot drift visibility in
  health/release metadata, and rebuild closure — issue #37;

## Independent hardening while data rights are blocked

- [x] provider-neutral surrogate-key headers, purge hook, and failure-injection
  tests; a real CDN adapter still requires provider validation — issue #18;
- [ ] external/shared rate limiting based on measured traffic — blocked issue #19;
- [ ] access-controlled external correction ticket backend, accountable owner,
  and escalation rota; the public page must remain unavailable until configured
  and proven — blocked issue #26;
- [x] importer fuzz corpus and resource-limit enforcement — issue #17;
- [x] source freshness and rights-expiry monitoring — issue #17;
- [x] accessibility and cross-browser UI verification — issue #21;
- [x] reproducible lookup p50/p95/p99, throughput, exact query plans,
  PostgreSQL buffer/I/O, Node CPU, and peak RSS baseline; deployment SLO and
  capacity remain intentionally unset until target infrastructure and traffic
  concurrency are known — issue #23;

## After data readiness

- [ ] contributor-maintained source adapters after rights review.

Amateur/owner-curated database ingestion remains deferred until its provenance
and review workflow is explicitly resumed.

## Explicitly not current scope

- device model, operating system, user, or location identification;
- scraping commercial lookup services;
- raw third-party database redistribution;
- automatic fuzzy organization merging;
- payments, accounts, API-key plans, Kubernetes, or microservices;
- claims of “optimal”, “official device vendor”, or privacy guarantees without
  measured evidence and review.

Propose roadmap changes through a focused
[feature request](https://github.com/ta2jam/macvendor/issues/new?template=feature_request.yml)
or [Discussion](https://github.com/ta2jam/macvendor/discussions).
