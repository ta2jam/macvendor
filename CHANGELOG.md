# Changelog

## Unreleased

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
