<div align="center">

# macvendor

**A source-aware MAC address block assignment lookup service.**

macvendor keeps authoritative registry assignments, owner-curated claims,
provenance, and release state separate instead of collapsing everything into an
unverifiable “device manufacturer” string.

[![CI](https://github.com/ta2jam/macvendor/actions/workflows/ci.yml/badge.svg)](https://github.com/ta2jam/macvendor/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/package-json/v/ta2jam/macvendor)](CHANGELOG.md)
[![License](https://img.shields.io/github/license/ta2jam/macvendor)](LICENSE)
[![Stars](https://img.shields.io/github/stars/ta2jam/macvendor?style=flat)](https://github.com/ta2jam/macvendor/stargazers)
[![Contributors](https://img.shields.io/github/contributors/ta2jam/macvendor)](https://github.com/ta2jam/macvendor/graphs/contributors)

[Quick start](#quick-start) · [API](#api) · [Architecture](#architecture) ·
[Roadmap](docs/ROADMAP.md) · [Contributing](CONTRIBUTING.md) ·
[Security](SECURITY.md)

</div>

> [!WARNING]
> The repository and GitHub releases do not bundle an IEEE snapshot. The
> guarded source-update tooling retrieves MA-L, MA-M, and MA-S directly from
> IEEE under the documented owner
> risk acceptance, hash/sign/import them, and activate a derived lookup release.
> Do not represent assignment-owner results as device identity or IEEE
> endorsement.

## What macvendor is

Most MAC lookup services return one vendor string and hide how it was selected.
macvendor models the complete lookup lifecycle:

```text
source -> immutable source release -> validation -> deterministic resolution
       -> active release -> public API + web UI
```

A lookup can return:

- an authoritative address-block assignment selected by longest-prefix match;
- separate owner-curated claims that never overwrite the authoritative result;
- the source release and active resolution version behind the response;
- explicit local-administered and multicast flags without mutating input bits.

An assignment identifies a registered address block. It does **not** prove the
physical device manufacturer, model, owner, location, or current network
identity. MAC addresses can be reassigned, spoofed, or randomized.

## Current capabilities

v0.5.x is the bounded public-operations release line. The English-only web UI
and API read governed active resolution and source metadata from PostgreSQL.

- strict parsing for bare, colon, hyphen, and dotted EUI-48 forms;
- canonical uppercase redirects and conditional requests with ETag/304;
- fixed authoritative lookup order: 36-bit → 28-bit → 24-bit;
- CID kept outside full-MAC lookup semantics;
- independent 1–48 bit owner-curated claims;
- exact registry/prefix assignment lookup with bounded evidence;
- immutable PostgreSQL source, release, resolution, suppression, and audit data;
- RFC 9457 problem responses and `429 Retry-After` behavior;
- atomic active-release state and publication-suppression overlay;
- deterministic, idempotent resolution builds with guarded activation and rollback;
- responsive Next.js web interface;
- unit, PostgreSQL integration, suppression, build, and HTTP smoke coverage.
- offline CSV/TSV/JSONL source-release importer with manifest, hash, rights,
  privacy, encoding, size, and idempotency gates.
- deterministic adversarial importer coverage plus read-only source freshness
  and rights-expiry health reporting;
- active source publish-mode failures and build/current config drift visibility,
  with rebuild closure proven in PostgreSQL integration coverage;
- shared-cache surrogate keys, Cloudflare Free cache tags, and a bounded
  post-commit purge adapter;
- WCAG A/AA-oriented axe checks and lookup-flow tests across Chromium, Firefox,
  WebKit, and a 320 px mobile viewport;
- allowlisted HTTPS fetch with DNS/IP SSRF defense, redirect revalidation,
  Ed25519 verification, snapshot completeness, and release-diff gates;
- snapshot-consistent logical backup, guarded restore verification, and
  migration-plus-artifact zero-seed rebuild drills;
- reproducible lookup benchmarks with exact PostgreSQL plans, buffer/I/O
  counters, and separate database/origin latency distributions;
- public data-use terms and a correction/takedown process that fails closed when
  no accountable intake channel is configured;
- fixed-origin IEEE MA-L/MA-M/MA-S preparation with raw SHA-256 provenance,
  operator Ed25519 custody signatures, schema normalization, duplicate omission,
  immutable import, and deterministic activation;
- one atomic scheduled publication across IEEE and enrichment sources;
- bounded official bulk lookup, aggregate release changes, organization filters,
  encrypted MacBook restic backup, Slack state-change alerts, SBOM, Git-history
  secret scanning, and runtime-image vulnerability scanning.

## Quick start

Requirements: Node.js 20.9+, npm, and PostgreSQL 16+.

```bash
git clone https://github.com/ta2jam/macvendor.git
cd macvendor
createdb macvendor_dev
createdb macvendor_test
createdb macvendor_bench
cp .env.example .env.local
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and query the synthetic demo
address `02:AA:BB:CC:00:01`.

### PostgreSQL with Docker

```bash
docker compose up -d
docker compose exec postgres createdb -U macvendor macvendor_test
cp .env.example .env.local
```

Then set both database URLs in `.env.local` to port `5433`:

```dotenv
DATABASE_URL=postgresql://macvendor:macvendor@localhost:5433/macvendor_dev
TEST_DATABASE_URL=postgresql://macvendor:macvendor@localhost:5433/macvendor_test
```

## API

| Endpoint | Purpose |
|---|---|
| `GET /v1/lookup/{mac}` | Authoritative assignment plus separate curated claims |
| `GET /v1/lookup/{mac}?mode=official` | Authoritative layer only |
| `POST /v1/lookups` | Official lookup for 1–25 MAC addresses |
| `GET /v1/assignments/{registry}/{prefix}` | Exact registry/prefix assignment |
| `GET /v1/assignments/{registry}/{prefix}?include=evidence` | Exact assignment with bounded evidence |
| `GET /v1/data-release` | Active release, source snapshots, rights state, and hashes |
| `GET /v1/data-release/changes` | Aggregate difference from the preceding release |
| `GET /v1/organizations` | Reviewed organization search with scheme/registry filters |

```bash
curl -sS http://localhost:3000/v1/lookup/02AABBCC0001 | jq
curl -sS 'http://localhost:3000/v1/lookup/02AABBCC0001?mode=official' | jq
curl -sS 'http://localhost:3000/v1/assignments/ma-l/02AABB-24?include=evidence' | jq
curl -sS http://localhost:3000/v1/data-release | jq
curl -sS http://localhost:3000/v1/lookups -H 'content-type: application/json' -d '{"macs":["02AABBCC0001","001122334455"]}' | jq
curl -sS http://localhost:3000/v1/data-release/changes | jq
```

The complete public contract is in
[`docs/api-contract.md`](docs/api-contract.md). Machine-readable OpenAPI 3.1 and
JSON Schema are served at [`/openapi.json`](http://localhost:3000/openapi.json)
and [`/schemas/public-api-v1.schema.json`](http://localhost:3000/schemas/public-api-v1.schema.json).

## Architecture

```mermaid
flowchart LR
    A["IEEE candidate / owner-curated source"] --> B["Isolated fetch + adapter"]
    B --> C["Immutable source release"]
    C --> D["Rights + validation gates"]
    D --> E["Deterministic resolver"]
    E --> F["Resolved assignments"]
    E --> G["Independent resolved claims"]
    F --> H["Atomic active-release pointer"]
    G --> H
    H --> I["Next.js API + UI"]
```

The application is a low-dependency modular monolith:

- **Next.js + TypeScript** for the web UI and route handlers;
- **PostgreSQL** as the source of truth;
- **CLI migration and seed commands** from the same repository;
- no Redis, queue, search engine, microservice split, account system, or payment
  layer in the current scope.

Authoritative lookup performs exactly three indexed candidates. Curated and
insight lookup each have a hard upper bound of 48 prefix candidates. Candidate generation is `O(1)`
for fixed 48-bit input; each PostgreSQL B-tree probe is `O(log N)`. Request-time
source-table joins are excluded from the hot path.

Read the binding design in [`docs/architecture.md`](docs/architecture.md), the
physical model in [`docs/data-contract.md`](docs/data-contract.md), and the
operational constraints in [`docs/operations.md`](docs/operations.md).

## Data and licensing boundary

Data availability and data rights are different facts.

- IEEE MA-L, MA-M, MA-S, legacy IAB, and CID derived API output is approved under an explicit
  owner risk acceptance and mandatory controls. The evidence, adverse 2013
  statement, later 2014 clarification, residual ambiguity, and scope are in
  [`docs/rights/ieee-registration-authority.md`](docs/rights/ieee-registration-authority.md).
- IANA Ethernet Numbers, IEEE Group MAC, reviewed runZero history/virtual
  prefixes, and exact-mapped Wikidata aliases remain separate enrichment layers.
- KIT NETVS and unreviewed community databases are reference/QA inputs, not
  automatically production sources.
- Amateur production publication is deferred. `owner:prepare` creates only a
  quarantined `qa_only`, `internal_only` artifact and cannot remove or replace
  an existing source.
- Exact `/48` claims are treated as device identifiers and are not public by
  default.
- Third-party rows with unknown origin or rights cannot enter a production
  release.

See [`docs/governance.md`](docs/governance.md) before proposing or importing a
dataset. Adapter contributions must also follow the compile-time registry and
fixture contract in [`docs/source-adapters.md`](docs/source-adapters.md).
Existing source configuration changes use the preview-first, audited decision
workflow in [`docs/governance.md`](docs/governance.md); direct SQL is unsupported.

### Update all scheduled sources atomically

The private ingest key is never committed. The public trust anchor is versioned
under `config/keys/`. After provisioning the matching private key at
`~/.config/macvendor/ieee-ingest-ed25519-private.pem`:

```bash
OPERATOR_ACTOR_ID=operator:source-scheduler npm run source:update:all -- \
  --ieee-output .local/source-update/ieee \
  --enrichment-output .local/source-update/enrichments \
  --private-key ~/.config/macvendor/ieee-ingest-ed25519-private.pem
```

The guarded command prepares every IEEE and enrichment input before database
writes, then performs one build and one activation. A database advisory lock
rejects overlap. A failed origin cannot partially activate a publication.

Generated raw files, signatures, and manifests stay under ignored `.local/` and
are not redistributed through GitHub. See [`NOTICE`](NOTICE) and the importing
runbook before rotating keys or changing URLs. The lower-level prepare/import/
build/activate commands remain available for diagnosis and controlled recovery.

The lower-level IEEE-only and enrichment commands remain available for
controlled diagnosis. Prepare enrichments manually with:

```bash
npm run source:prepare:enrichments -- --ieee-dir .local/ieee/YYYY-MM-DD
```

The generated production manifests cover IANA protocol ranges, IEEE Group MAC
usage, runZero historical aliases and virtual-platform hints, and exact-name
Wikidata mappings. Fuzzy entity matching is intentionally unsupported.

Public attribution and reuse boundaries are available at
[`/legal/data-terms`](http://localhost:3000/legal/data-terms). Incorrect
assignment, curated claim, privacy, or rights reports use
[`/data-corrections`](http://localhost:3000/data-corrections). The latter shows
an unavailable state until `DATA_CORRECTIONS_EMAIL` is set to a valid public
address; it never claims that an unconfigured backend accepted a submission.

## Development

```bash
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run build
npm run browser:install
npm run test:browser
npm run benchmark:lookup -- --sizes 1000,10000,100000,250000
npm audit --audit-level=low
gitleaks git --redact .
```

Run the complete non-browser gate with:

```bash
npm run verify
```

Run the complete local release gate, including the disposable test-database
reset and all browser projects, with:

```bash
npm run verify:full
```

Browser setup, CI behavior, and the manual checks that automation cannot prove
are documented in
[`docs/accessibility-testing.md`](docs/accessibility-testing.md).

The integration suite resets only the database named by `TEST_DATABASE_URL` and
refuses any name that does not end with `_test`. It also refuses remote hosts by
default; an isolated remote test database requires explicit
`TEST_DATABASE_ALLOW_REMOTE=true` authorization.

The benchmark likewise destroys and recreates only the database named by
`BENCHMARK_DATABASE_URL`, and refuses a name that does not end with `_bench`.
Read the safety boundary, metric definitions, and baseline interpretation in
[`docs/performance-benchmark.md`](docs/performance-benchmark.md).

Import the synthetic QA-only example with:

```bash
npm run source:import -- --manifest examples/sources/synthetic-import/manifest.json
```

Prepare an owner-created dataset for quarantine review with:

```bash
npm run owner:prepare -- \
  --declaration examples/owner-source/declaration.example.json \
  --records examples/owner-source/records.jsonl \
  --output .local/owner-source-review
```

See [`docs/importing-sources.md`](docs/importing-sources.md). The importer reads
only a manifest-relative local file. Remote acquisition is a distinct
`source:fetch` phase; see [`docs/fetching-sources.md`](docs/fetching-sources.md).

Build and publish an explicit set of approved source releases with:

```bash
npm run resolution:build -- --source-release UUID --source-release UUID
npm run resolution:activate -- --run UUID
npm run resolution:rollback -- --run UUID
```

See [`docs/resolution-pipeline.md`](docs/resolution-pipeline.md) for rights,
freshness, reproducibility, conflict, concurrency, and rollback behavior.

Temporary correction/takedown publication overlays use the audited operator
commands documented in
[`docs/publication-suppressions.md`](docs/publication-suppressions.md). They store
opaque ticket references, not requester contact data.

The provider-neutral non-root staging image, Compose stack, probes, and smoke
drill are documented in [`docs/staging.md`](docs/staging.md). No external staging
deployment is claimed without a selected provider and deployment authority.

Recovery commands and their PITR/encryption/provider limits are documented in
[`docs/recovery.md`](docs/recovery.md).

## Contributing

Useful contributions are not limited to application code:

- [report a reproducible bug](https://github.com/ta2jam/macvendor/issues/new?template=bug_report.yml);
- [propose a focused feature](https://github.com/ta2jam/macvendor/issues/new?template=feature_request.yml);
- [propose a data source](https://github.com/ta2jam/macvendor/issues/new?template=data_source.yml)
  with license and provenance evidence;
- improve normalization, importer, resolver, migration, cache, privacy, or
  failure-path tests;
- pick a [`good first issue`](https://github.com/ta2jam/macvendor/labels/good%20first%20issue)
  or an item marked [`help wanted`](https://github.com/ta2jam/macvendor/labels/help%20wanted);
- use [Discussions](https://github.com/ta2jam/macvendor/discussions) for open-ended
  design questions.

If the project is useful, starring it makes the work easier to discover. Stars
are not treated as evidence of correctness; tests and source provenance are.

Read [`CONTRIBUTING.md`](CONTRIBUTING.md), the
[`Code of Conduct`](CODE_OF_CONDUCT.md), and the
[`technical roadmap`](docs/ROADMAP.md) before opening a large pull request.

## Version and release policy

Every released version has:

1. a version change in `package.json` and `package-lock.json`;
2. a dated entry in `CHANGELOG.md`;
3. the full verification gate passing;
4. an explicit `release: vX.Y.Z` commit;
5. an annotated `vX.Y.Z` tag pointing to that commit;
6. the commit and tag pushed together.

A version is never allowed to exist only in a working tree, only as a local tag,
or only in release notes. The detailed maintainer workflow is in
[`CONTRIBUTING.md`](CONTRIBUTING.md#version-and-release-policy).

## Security

Do not report suspected vulnerabilities through public issues. Use
[GitHub private vulnerability reporting](https://github.com/ta2jam/macvendor/security/advisories/new)
and read [`SECURITY.md`](SECURITY.md).

## License

The application source is licensed under the [MIT License](LICENSE). Source-code
licensing does not grant rights to third-party MAC assignment or vendor data.
