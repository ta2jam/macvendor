# macvendor

Source-aware MAC address block assignment lookup. v0.0.1 separates authoritative assignments from owner-curated claims and returns the active data-release provenance with every lookup.

## What v0.0.1 contains

- Next.js App Router + TypeScript web/API application.
- PostgreSQL immutable source/release/resolution model.
- Strict MAC parser and 36 → 28 → 24 bit longest-prefix lookup.
- Independent 1–48 bit curated claims.
- Canonical URL redirects, RFC 9457 errors, ETag/cache headers and origin fallback rate limiting.
- Exact registry assignment and active data-release endpoints.
- Synthetic local demo data; no third-party database is redistributed.

## Local setup

Requirements: Node.js 20.9+ and PostgreSQL 16+.

```bash
createdb macvendor_dev
createdb macvendor_test
cp .env.example .env.local
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and query `02:AA:BB:CC:00:01`.

If PostgreSQL is not installed locally, `docker compose up -d` starts PostgreSQL on port `5433`; update both database URLs in `.env.local` to use `postgresql://macvendor:macvendor@localhost:5433/...` and create the test database in that container.

## Verification

```bash
npm run verify
```

This runs lint, TypeScript, unit tests, PostgreSQL integration tests and the production build.

## API

```text
GET /v1/lookup/{mac}
GET /v1/assignments/{registry}/{prefix}
GET /v1/data-release
```

Examples:

```bash
curl -i http://localhost:3000/v1/lookup/02AABBCC0001
curl -i http://localhost:3000/v1/lookup/02AABBCC0001?mode=official
curl -i http://localhost:3000/v1/assignments/ma-l/02AABB-24?include=evidence
curl -i http://localhost:3000/v1/data-release
```

## Data and licensing boundary

The seed is deliberately synthetic. A public listing or downloadable file is not automatically licensed for redistribution. IEEE or any third-party dataset must pass the rights process in [`docs/governance.md`](docs/governance.md) before production ingest is enabled.

Architecture and contracts live in [`docs/architecture.md`](docs/architecture.md).
