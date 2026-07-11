# macvendor technical roadmap

This roadmap is directional, not a promise. Security, data rights, privacy, and
correctness gates can delay or reject a feature.

## Current — 0.0.2 community foundation

- [x] strict EUI-48 normalization;
- [x] authoritative and curated layers kept separate;
- [x] immutable source/release/resolution schema;
- [x] active release pointer and suppression overlay;
- [x] web UI and versioned API;
- [x] synthetic local seed;
- [x] unit, PostgreSQL integration, build, and HTTP smoke coverage;
- [x] CI, issue templates, contribution, security, and release policy.
- [x] offline manifest-driven CSV/TSV/JSONL source-release importer;

## Next — production-data readiness

- [ ] obtain and document approved production source rights;
- [ ] implement the isolated HTTPS fetcher and adapter runner around the offline importer;
- [ ] verify signatures, artifact hashes, snapshot completeness, and diff gates;
- [ ] implement deterministic resolver build manifests and reproducibility tests;
- [ ] publish OpenAPI and machine-readable JSON Schemas;
- [ ] add correction/takedown intake and publication-guard CLI;
- [ ] complete backup/restore and zero-from-artifact rebuild drills.

## After data readiness

- [ ] CDN surrogate-key purge and failure-injection tests;
- [ ] external/shared rate limiting based on measured traffic;
- [ ] importer fuzz corpus and resource-limit enforcement;
- [ ] source freshness and rights-expiry monitoring;
- [ ] accessibility and cross-browser UI verification;
- [ ] benchmark lookup p50/p95/p99, query plans, CPU, memory, and I/O;
- [ ] contributor-maintained source adapters after rights review.

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
