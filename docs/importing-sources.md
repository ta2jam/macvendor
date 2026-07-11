# Importing source releases

The importer is an offline, local-file parser and database writer. Remote
download is a separate phase documented in
[`fetching-sources.md`](fetching-sources.md); fetching does not make a source
eligible for production by itself.

## Command

```bash
npm run source:validate -- --manifest examples/sources/synthetic-import/manifest.json
npm run source:import -- --manifest examples/sources/synthetic-import/manifest.json
```

`source:validate` performs the complete manifest, signature, adapter, schema,
normalization, duplicate, privacy, rights, and resource validation without a
database connection or write. Adapter development rules are in
[`source-adapters.md`](source-adapters.md).

The importer performs all file and record validation before opening a database
transaction. A failed artifact therefore creates no source, release, artifact,
record, or audit row.

## Manifest

The machine-readable schema is
[`schemas/source-manifest-v1.schema.json`](../schemas/source-manifest-v1.schema.json).

Required sections:

- `source`: immutable identity, class, publish mode and rights decision;
- `release`: snapshot, adapter, normalizer and schema versions;
- `artifact`: relative path, format, expected SHA-256 and signature state;
- `defaults`: record type, origin, rights scope and verification defaults.

Unknown manifest and record fields are rejected. Production manifests require:

- `distributionScope=api_output`;
- approved third-party rights plus a review reference, or an owner-created source
  with at least an owner assertion;
- a non-expired rights review when an expiry exists;
- a cryptographically verified Ed25519 artifact signature;
- an explicit full-snapshot diff policy;
- known record origin and rights;
- a privacy review reference for `/37`–`/48` records.

The importer never upgrades `corroborated` from a source row. Corroboration is a
resolver decision across independent sources. `reviewed` rows require an opaque
`reviewedBy` actor identifier.

Production delta releases are rejected until deterministic base-snapshot
materialization exists. Production full snapshots are compared with the most
recent valid release and abort atomically when the configured added/removed
percentages are exceeded.

The reviewed `ieee-registration-authority-csv-v1` adapter is deliberately not a
generic CSV adapter. It accepts only the fixed MA-L, MA-M, and MA-S source slugs,
registries, prefix widths, and official URLs in `src/sources/ieee.ts`. The
operator signs each directly fetched raw CSV before import. Control/invisible
characters are normalized deterministically, while duplicate assignment
prefixes are omitted and recorded in `adapterWarnings`. The raw signed bytes
remain the provenance artifact.

## Accepted artifact formats

- UTF-8 CSV with one strict header row;
- UTF-8 TSV with one strict header row;
- UTF-8 JSON Lines with one object per line.

Limits:

| Limit | Value |
|---|---:|
| Artifact | 20 MiB |
| Records | 250,000 |
| Line | 64 KiB |
| Text field | 16 KiB |
| Claim JSON | 32 KiB |
| Claim JSON nesting | 20 containers |
| Claim JSON nodes | 4,096 values/containers |

Symlinks, absolute paths, parent traversal, NUL bytes, invalid UTF-8, control
characters, invisible/bidirectional formatting characters, hash mismatch,
partial CSV rows and unsupported fields are rejected.
Nested claim keys and strings are normalized to NFC; keys that collide after
normalization are rejected rather than overwritten.

The deterministic adversarial suite mutates valid artifacts and verifies that
malformed inputs remain inside typed validation failures. It also exercises the
byte, line, field, record, JSON-depth and JSON-node boundaries. This is a
regression corpus, not proof that every parser input is safe.

## Idempotency

The import key contains the source slug, artifact hash, canonical manifest hash,
schema version, adapter version and normalizer version. Re-importing the same
input returns the existing source release. Changing adapter or normalization
logic produces a new release even when artifact bytes are unchanged.

A successful remote re-fetch of unchanged bytes appends a
`source_fetch_observations` row instead of mutating the immutable release.
Freshness checks use the latest observation; release identity and historical
`fetched_at` remain stable. Observation rows are append-only and included in
logical backup/restore verification.

The checked-in example is synthetic and `qa_only`. It is not a template for
claiming unknown third-party data as owner-created.
