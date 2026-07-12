# Changelog

## Unreleased

## 0.4.2 — 2026-07-12

- Fixed the external production monitor's freshness parser for PostgreSQL ISO
  timestamps with fractional seconds. The monitor now evaluates the live
  19-source release instead of producing a false failure in `jq`.

## 0.4.1 — 2026-07-12

- Fixed full, uncompressed global IPv6 addresses being rejected by the SSRF
  address classifier. The fail-closed bug blocked enrichment updates for
  dual-stack GitLab and OpenDev origins even though every resolved address was
  public; private, loopback, documentation, and mixed DNS results remain
  blocked.

## 0.4.0 — 2026-07-12

- Replaced quadratic claim-to-assignment resolution and per-row materialization
  with indexed longest-prefix matching and bounded JSONB batches. The governed
  58,072-assignment/14,134-claim build fell from roughly nine minutes on the
  production path to 4.7 seconds in the local benchmark without changing its
  semantic output hash.
- Decoupled the data-resolution policy revision from application commits and
  container image digests, so UI-only releases no longer create redundant
  resolution runs. Added an integration regression for runtime-image changes.
- Added correction encryption-key identifiers and a backward-compatible
  decryption ring, hourly correction-SLA checks, and bounded backup retention
  with collision-resistant filenames.
- Added a 15-minute external production monitor, weekly CodeQL analysis,
  stricter organization API schemas, graceful organization-search failures,
  baseline CSP/frame isolation, and shorter shared-cache lifetimes.
- Fixed local WebKit CSP behavior and isolated Playwright's canonical origin;
  the 57 applicable cross-browser/accessibility checks pass on Chromium,
  Firefox, WebKit, and a 320 px mobile viewport.
- Updated dotenv to 17.4.2 with a zero-vulnerability dependency audit and added
  an explicit local/GitHub/release/production synchronization verifier.

## 0.3.2 — 2026-07-12

- Linked both homepage version labels to the public GitHub repository, opening
  in a new tab with explicit opener isolation and browser coverage.

## 0.3.1 — 2026-07-12

- Raised the bounded IEEE download wall-time from 30 to 90 seconds after the
  production route measured 58.6 seconds for the direct 3.8 MB MA-L snapshot.
- Made scheduled source-update shells fail immediately when IEEE preparation
  fails instead of starting a dependent enrichment step with missing files.
- Allowed first-run systemd jobs to create their source-work path without a
  mount-namespace setup failure.

## 0.3.0 — 2026-07-12

- Added ten governed sources: Wireshark well-known addresses; official Hyper-V,
  VMware and OpenStack MAC hints; and reviewed IANA PEN, PCI, USB, GLEIF, SEC,
  and Companies House organization identifiers.
- Added exact-only organization identity search and reverse assignment views;
  identity claims remain separate from IEEE assignment authority and never use
  fuzzy matching.
- Added PostgreSQL-backed shared rate limiting, encrypted correction intake,
  append-only correction audit events, retention maintenance, and operator CLIs.
- Added daily IEEE, weekly enrichment, six-hour source-health, and daily
  maintenance systemd jobs with backup boundaries.
- Disabled synthetic demo sources for governed deployments, documented all six
  public API endpoints, added the contributor adapter fixture, and enforced a
  tag-to-main release gate.

## 0.1.1 — 2026-07-12

- Standardized the entire public web interface on English, including document
  language metadata, navigation, lookup states, active source/release views,
  correction and data-terms pages, problem descriptions, empty/error states,
  accessible names, and date/number formatting.
- Updated cross-browser assertions to enforce the English public surface.

## 0.1.0 — 2026-07-12

- Graduated the local product surface from foundation preview to the first
  inspectable release without claiming production infrastructure readiness.
- Replaced static demo source descriptions with the deployment's live active
  resolution inputs, including source class, record count, latest observation,
  rights state, API scope, and build/current config status.
- Replaced the raw-only data-release page with human-readable release metrics,
  provenance, and source cards while retaining the exact API JSON behind a
  disclosure control.
- Added `sourceClass` and `recordCount` to the additive public data-release
  contract and runtime schema validation.
- Removed the synthetic default MAC and the inaccurate implication that amateur
  data is active; lookups now start empty and require explicit input.
- Added live-source browser assertions and responsive presentation. Shared rate
  limiting and correction intake remain deployment-blocked, not silently faked.

## 0.0.18 — 2026-07-11

- `/v1/data-release` now returns the latest immutable fetch observation for each
  active source release instead of permanently exposing its first fetch time.
- IEEE unchanged-snapshot updates report how many observation rows were added
  and how many affect active inputs. Only active observation changes purge
  `data-release` immediately after commit; new inactive releases defer to the
  activation purge and exact timestamp reruns remain no-change operations.
- Data-release ETags now include observation time, preventing conditional and
  shared caches from retaining stale public freshness metadata.
- Added PostgreSQL regressions covering first observation, unchanged refresh,
  exact rerun idempotence, targeted purge keys, pre-build purge failure,
  response timestamps, and ETag rotation. Corrected the source-health
  TypeScript QA publish-mode literal.

## 0.0.17 — 2026-07-11

- Source health now keeps active inputs visible after their current publish mode
  changes and fails when an active source is no longer a production publisher;
  disabling a source can no longer hide it from the report.
- Active source-config snapshot drift is reported as a warning with current and
  build-time config versions, while existing rights and publish-mode failures
  remain fail-closed.
- `/v1/data-release` now exposes `configVersionAtBuild` and
  `configChangedSinceBuild` alongside the compatible current `configVersion`.
- Added unit and PostgreSQL regressions for disable, restore, drift visibility,
  public contract validation, and rebuild/activation closure.

## 0.0.16 — 2026-07-11

- Added a strict, bounded `macvendor-governance/v1` decision document and a
  preview-first CLI for changing existing source configuration without ad-hoc
  SQL.
- Governance apply now locks, versions, hashes, and audits configuration changes
  atomically; identical reruns are no-ops and pending builds are invalidated by
  the existing config-version activation gate.
- Active-source rights/publication weakening requires explicit risk acceptance,
  while the audit records that acceptance and the CLI reports cache-purge errors
  as post-commit failures.
- Fixed nullable source diff policies being written as JSON `null` instead of SQL
  `NULL`, which previously rejected valid QA/reference source creation.
- Added malformed-decision, preview, idempotence, audit, active-risk, and
  pending-build regression coverage. No source data or rights approval was added.

## 0.0.15 — 2026-07-11

- Replaced duplicated adapter-key branches with one typed, compile-time reviewed
  registry; manifests cannot load runtime modules or claim unregistered keys.
- Bound adapter keys to supported adapter versions and reserved source slugs,
  and reject unimplemented source-schema/normalizer version claims before
  artifact parsing.
- Added bounded JSON warning validation and a no-row-expansion V1 contract while
  retaining all downstream rights, privacy, signature, duplicate, diff, and
  resource gates.
- Preserved original source-row locators through filtering adapters instead of
  silently renumbering provenance after omitted rows; this behavior change uses
  `normalizerVersion=2`, producing new immutable releases instead of reusing
  v1 import keys.
- Added a database-free `source:validate` command, contributor adapter contract,
  and regression coverage. No amateur or third-party dataset was admitted.

## 0.0.14 — 2026-07-11

- Added a committed SHA-256 ledger covering the exact migration SQL set and a
  database-free verification command in the required release gate.
- Migration history now stores a checksum for every applied filename, rejects
  edited or missing applied migrations before executing new SQL, and upgrades
  legacy filename-only history from the verified ledger transactionally.
- Added machine-readable migration integrity failures plus unit and PostgreSQL
  regression coverage for file tampering, incomplete ledgers, applied drift,
  unknown database history, legacy backfill, and idempotent reruns.

## 0.0.13 — 2026-07-11

- Added a provider-neutral `source:update:ieee` command that prepares, verifies,
  imports, resolves, activates, purges, and health-checks the fixed MA-L/MA-M/
  MA-S source set under one database advisory lock.
- Added append-only fetch observations so an unchanged upstream snapshot
  refreshes source-health evidence without duplicating immutable releases or
  changing the active resolution version.
- Resolver freshness now uses the latest verified observation, while failed
  pre-activation runs preserve the active pointer and post-commit purge/health
  failures are reported explicitly as committed.
- Added preparation unit coverage and end-to-end PostgreSQL coverage for first
  publication, unchanged reruns, active-version stability, and overlap rejection.

## 0.0.12 — 2026-07-11

- Reopened the IEEE rights review with the adverse 2013 response, later 2014
  no-copyright/no-distribution-restriction clarification preserved by Debian,
  current direct CSV downloads, and explicit repository-owner risk acceptance.
- Added a fixed-origin MA-L/MA-M/MA-S adapter and preparation command with DNS/IP
  egress controls, raw SHA-256 hashes, operator Ed25519 custody signatures,
  exact schema/registry/prefix gates, and a versioned public trust anchor.
- Deterministically normalizes unsafe whitespace while retaining signed raw
  artifacts; ambiguous MA-L prefixes `0001C8` and `080030` are omitted rather
  than assigned a silent winner and remain in validation warnings.
- Imported and locally activated 53,283 real IEEE assignments (39,722 MA-L,
  6,478 MA-M, 7,083 MA-S) with successful longest-prefix lookup verification.
- Added the NOTICE, operator runbook, annual rights re-review, no-raw-dataset,
  no-endorsement, and no-device-identification boundaries. Amateur data remains
  deferred.

## 0.0.11 — 2026-07-11

- Added public data-use terms covering attribution, source-rights boundaries,
  non-device-identification semantics, raw redistribution, correctness, cache,
  rate-limit, and correction limits.
- Added the correction/takedown process, required evidence, target review times,
  decision types, immutable-release behavior, and private security-channel
  separation.
- Added a runtime-validated `DATA_CORRECTIONS_EMAIL` link that fails closed on
  invalid configuration and shows an explicit unavailable state when no real
  intake channel exists; the application does not persist contact or evidence.
- Added footer/navigation discovery and axe/cross-browser coverage for both new
  public pages. IEEE and amateur data remain absent.

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
