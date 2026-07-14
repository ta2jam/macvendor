# Resolution build and publication

The resolver turns an explicit set of immutable, valid source releases into an
immutable resolution run. Building and publishing are separate operations.

## Invariants

- Only `production` sources approved for `api_output` enter a build.
- Every source marked `required_for_activation` must be present.
- Only `authoritative` source records can produce official assignments.
- Owner-curated and enrichment claims remain separate resolved claims.
- Different authoritative semantics for the same EUI prefix reject the run.
- A rights review expiry or stale required source blocks the build.
- The input manifest and semantic output have canonical SHA-256 hashes.
- Repeating the same build returns the existing run.
- Activation checks that every source configuration version still matches the
  build snapshot.
- Activation and rollback move one singleton pointer in one transaction and
  increment both the active and publication versions.

The output hash excludes database-generated UUIDs and timestamps. It includes
the selected source slug, source-record hash, normalized assignment values,
claim values, claim decisions, and evidence roles. Equivalent inputs therefore
produce the same hash even after a clean database rebuild.

## Build

Find the intended valid source releases first:

```sql
SELECT ds.slug, sr.id, sr.fetched_at, sr.content_hash
FROM source_releases sr
JOIN data_sources ds ON ds.id = sr.source_id
WHERE sr.status = 'valid' AND ds.publish_mode = 'production'
ORDER BY ds.slug, sr.fetched_at DESC;
```

Build with one explicit argument per selected release:

```bash
npm run resolution:build -- \
  --source-release 00000000-0000-0000-0000-000000000001 \
  --source-release 00000000-0000-0000-0000-000000000002
```

Production automation must set `GIT_COMMIT_SHA` and `BUILD_IMAGE_DIGEST` to the
deployed commit and immutable container digest. The CLI uses the local Git SHA
and the literal value `local` only for local runs.

A successful build returns `validated`. An identical retry returns
`already_built`. A same-prefix authoritative disagreement persists a `rejected`
run with conflict evidence and exits non-zero; it never writes partial resolved
rows.

## Activate and roll back

```bash
OPERATOR_ACTOR_ID=operator:alice \
  npm run resolution:activate -- --run 00000000-0000-0000-0000-000000000003 \
    --expected-active-run 00000000-0000-0000-0000-000000000002 --expected-publication-version 7

OPERATOR_ACTOR_ID=operator:alice \
  npm run resolution:rollback -- --run 00000000-0000-0000-0000-000000000004 \
    --expected-active-run 00000000-0000-0000-0000-000000000003 --expected-publication-version 8
```

Normal activation accepts only a `validated` run. Rollback accepts only a
`retired` run. Repeating activation of the current run is a no-op. Every state
change writes an audit event with the previous run and resulting versions.

Rollback does not mutate or delete either resolution. It republishes a previous
immutable run through the same guarded pointer change.

## Cost model

Resolution is `O(R log R)` time for `R` eligible records because records and
groups are sorted, and `O(R)` application memory. Persistence currently performs
one bounded transaction and one insert per resolved row/evidence row. This is
appropriate for the synthetic and early rights-approved inputs, but must be
benchmarked and changed to bounded batches before a large production dataset is
admitted. Runtime lookups remain independent of source-table size.
