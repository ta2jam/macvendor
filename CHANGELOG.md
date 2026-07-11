# Changelog

## Unreleased

## 0.0.10 — 2026-07-11

- Added a destructive-operation guard and deterministic synthetic benchmark for
  1K, 10K, 100K, and 250K resolved assignments plus equally scaled curated
  claims; no IEEE or amateur records are used.
- Recorded separate direct-database and origin-HTTP p50/p95/p99, sequential
  throughput, Node CPU/peak RSS, PostgreSQL database I/O, storage, and exact
  `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON)` evidence.
- Fixed the lookup hot path after the benchmark exposed a linear resolved-table
  scan: official lookup now performs three exact index candidates and curated
  lookup performs at most 48 exact index candidates.
- Kept machine-specific latency out of required CI thresholds; deployment SLO,
  concurrency capacity, shared rate limiting, PostgreSQL process CPU, and energy
  remain unset until target infrastructure and traffic are measured.

## 0.0.9 — 2026-07-11

- Added a Playwright and axe release gate across Chromium, Firefox, WebKit, and
  a 320 px Chromium mobile viewport for all public pages and lookup states.
- Added skip-link focus, persistent mobile navigation, visible focus rings,
  labelled/busy/status/error regions, focusable JSON output, and bounded touch
  targets.
- Darkened muted text after measured 3.95–4.45:1 failures; the tested surfaces
  now exceed the 4.5:1 normal-text threshold.
- Fixed local standalone startup so `npm start` copies public/static assets
  before launching; the previous script served HTML without CSS or client JS.
- Added failure-only browser screenshots, traces, video, and HTML report
  retention to CI; `browser`, `verify`, and `container-smoke` are required main
  branch checks.
- Documented that automated checks are not formal WCAG conformance and retained
  real Safari Tab traversal, assistive-technology, forced-color, and 200% zoom
  checks as explicit manual work.

## 0.0.8 — 2026-07-11

- Recorded the IEEE Registration Authority evidence review and kept production
  ingestion blocked because public-listing access does not establish derived
  public API-output rights.
- Added bounded claim JSON depth, node count, nested text, and existing byte
  limits before canonicalization or persistence.
- Added a deterministic 64-case mutation corpus plus explicit UTF-8, artifact,
  line, field, record-count, claim-size, nesting, complexity, and bidi tests.
- Added a read-only PostgreSQL source-governance report and CLI with machine-
  readable failures/warnings for rights status/scope/expiry, active-input and
  release presence, freshness, and future timestamps.
- Added a partial latest-valid-release index and documented `O(S)` report
  evaluation. No IEEE or amateur records were imported.
- Added bounded shared-cache surrogate headers and a provider-neutral HTTPS
  purge adapter invoked after activation, rollback, and suppression commits.
- Added explicit post-commit failure reporting plus unsafe endpoint, missing
  credential, network, HTTP rejection, private-response, and success tests.
- Kept distributed rate limiting blocked on an edge provider and measured
  traffic instead of adding an unmeasured shared hot-path dependency.

## 0.0.7 — 2026-07-11

- Added repeatable-read exported-snapshot PostgreSQL custom backups so dump bytes
  and integrity counts describe the same database instant.
- Added versioned backup manifests with dump SHA-256, size, migrations, bounded
  table counts, active pointer/versions, audit-trigger state, and measured time.
- Added restrictive output permissions and credential-free PostgreSQL tool
  arguments.
- Added guarded restore into a new disposable database only, pre-restore archive
  validation, single-transaction restore, exact integrity comparison, and
  optional post-check removal.
- Added zero-from-artifact rebuild without logical dump or demo seed: migrations,
  signed synthetic source imports, deterministic resolution, activation, lookup,
  and integrity checks.
- Added target-name, existing-database, dump tamper, active-pointer, migration,
  constraint, and append-only audit guards.
- Added the measured recovery drill to the PostgreSQL 18 staging container smoke
  workflow while documenting that provider PITR, encryption, scheduling, and RPO
  guarantees remain external.

## 0.0.6 — 2026-07-11

- Added a database-free HTTPS fetch phase with explicit origin/port allowlists,
  redirect revalidation, DNS result bounds, private/reserved IP rejection, and
  DNS-to-TLS connection pinning.
- Added wall-time, byte, content-encoding, status, URL credential/query, and TLS
  verification gates with atomic artifact handoff.
- Added Ed25519 detached-signature verification against a hash-pinned local trust
  anchor; production releases can no longer assert signature status without
  cryptographic verification.
- Added reviewed adapter-key enforcement, duplicate record/assignment rejection,
  mandatory production full-snapshot diff policies, and atomic change-threshold
  enforcement.
- Blocked production deltas until deterministic base-snapshot materialization is
  implemented.
- Added synthetic local HTTPS, TLS, SSRF, redirect, size, signature, duplicate,
  and PostgreSQL diff-gate tests.

## 0.0.5 — 2026-07-11

- Published OpenAPI 3.1 and JSON Schema documents for all public v1 endpoints,
  canonical redirects, nullable fields, enums, and RFC 9457 errors.
- Added schema-backed runtime response tests that fail on API contract drift.
- Fixed assignment evidence provenance to report the evidence record's source
  instead of always reporting the selected core source.
- Added audited create, revoke, list, and expire publication-suppression CLIs
  with exactly-one-target validation, race protection, opaque references, and
  atomic publication-version increments.
- Added uniqueness constraints and tests for suppression races, expiry, audit,
  ETag invalidation, and contact-like reference rejection.
- Added health/readiness probes, a multi-stage non-root standalone image,
  provider-neutral staging Compose stack, graceful-shutdown smoke drill, and CI
  container job.
- Kept external staging deployment blocked until provider and deployment
  authority are supplied.

## 0.0.4 — 2026-07-11

- Added deterministic resolution builds from explicit immutable source releases.
- Added canonical input-manifest and semantic-output hashes plus idempotent build
  reuse.
- Added strict rights, freshness, required-source, source-class, and source
  configuration gates.
- Added same-prefix authoritative conflict rejection while keeping curated
  claims independent.
- Added transaction-locked activation and rollback CLIs with monotonic active
  and publication versions and audit events.
- Added reproducibility, conflict, source-layer, concurrent build/activation,
  configuration-change, and rollback tests.
- Explicitly deferred amateur database ingestion.

## 0.0.3 — 2026-07-11

- Updated GitHub Actions to Node 24-native major versions after the initial
  v0.0.2 CI run reported Node 20 action-runtime deprecation warnings.
- Added the offline manifest-driven CSV, TSV, and JSON Lines importer.
- Added strict artifact hashing, path, UTF-8, field, size, snapshot, rights,
  privacy, verification, and source-configuration gates.
- Added atomic source-release persistence, source-scoped locking, bounded batch
  inserts, deterministic import keys, and idempotent re-import behavior.
- Added a machine-readable source manifest schema, synthetic QA-only example,
  importer documentation, unit tests, and PostgreSQL integration tests.

## 0.0.2 — 2026-07-11

- Rebuilt the README around the product thesis, actual boundaries, architecture,
  API, performance model, roadmap, and contribution paths.
- Added CI, Dependabot, structured issue forms, and a pull-request template.
- Added contribution, security, code-of-conduct, and technical-roadmap policies.
- Made the displayed application version derive from `package.json`.
- Established commit-backed SemVer releases with annotated tags.

## 0.0.1 — 2026-07-11

- Added the Next.js App Router web application and public v1 route handlers.
- Added strict MAC normalization and fixed-candidate authoritative lookup.
- Added independent owner-curated prefix claims.
- Added the 12-table PostgreSQL source/release/resolution schema.
- Added synthetic, rights-safe local demo data.
- Added canonical redirects, RFC 9457 problems, ETag/cache behavior and fallback rate limiting.
- Added unit, PostgreSQL integration, suppression and HTTP smoke coverage.
