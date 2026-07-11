# macvendor technical roadmap

This roadmap is directional, not a promise. Security, data rights, privacy, and
correctness gates can delay or reject a feature.

## Current — 0.0.6 source acquisition foundation

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

## Next — production-data readiness

- [ ] obtain and document approved production source rights;
- [ ] complete backup/restore and zero-from-artifact rebuild drills.

## After data readiness

- [ ] CDN surrogate-key purge and failure-injection tests;
- [ ] external/shared rate limiting based on measured traffic;
- [ ] importer fuzz corpus and resource-limit enforcement;
- [ ] source freshness and rights-expiry monitoring;
- [ ] accessibility and cross-browser UI verification;
- [ ] benchmark lookup p50/p95/p99, query plans, CPU, memory, and I/O;
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
