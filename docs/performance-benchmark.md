# Lookup performance benchmark

The benchmark exists to expose query-plan and scaling regressions. It is not a
production SLO, capacity claim, or hosted-CI latency gate.

## Safety boundary

`benchmark:lookup` drops and recreates the target `public` schema. It refuses to
run unless `BENCHMARK_DATABASE_URL` names a database ending in `_bench`. Remote
hosts are also refused unless `BENCHMARK_ALLOW_REMOTE=true` is explicitly set.
Never point it at development, test, staging, or production data.

```bash
createdb macvendor_bench
cp .env.example .env.local
npm run build
npm run benchmark:lookup -- \
  --sizes 1000,10000,100000,250000 \
  --samples 500 \
  --warmup 50 \
  --label local \
  --output benchmarks/lookup-local.json \
  --markdown docs/performance-baseline.md
```

The generated dataset is deterministic in shape and synthetic in content. For
each requested size it creates that many `/24` authoritative assignments, the
same number of nonmatching `/48` curated claims, and 48 matching claims covering
every prefix length for the curated worst case. It uses neither IEEE nor amateur
records.

## Measurements

Each scenario is measured sequentially at concurrency 1:

| Scenario | Mode | Purpose |
|---|---|---|
| `official_hit` | `official` | successful three-candidate assignment path |
| `no_match` | `official` | bounded assignment miss |
| `curated_48_match` | `all` | all 48 curated prefix candidates and 21-row truncation probe |

The JSON report contains:

- direct PostgreSQL and origin HTTP p50/p95/p99, mean, max, and throughput;
- exact JSON `EXPLAIN ANALYZE` plans with buffers and WAL counters;
- database-wide PostgreSQL block, tuple, and temporary-byte deltas;
- benchmark-client and standalone Node CPU, filesystem operations, and peak RSS;
- database, table, and index sizes;
- application/git version plus operating-system, CPU, memory, Node, and
  PostgreSQL context.

`pg_stat_database` is database-wide and includes measurement overhead. For
direct-database measurements, the harness waits 1.1 seconds outside the latency
and CPU window after warmup and again before the ending read so PostgreSQL can
publish cumulative backend statistics without leaking setup or warmup work into
the measured delta. HTTP uses a separate process and connection pool, so its
database-wide delta cannot be attributed reliably and is intentionally `null`;
the exact direct-query `EXPLAIN BUFFERS` plan remains the I/O evidence.
`EXPLAIN ANALYZE` adds instrumentation cost. Standalone CPU time is limited by
the operating system's process-time resolution. PostgreSQL process CPU and
energy are not reported because there is no portable, attribution-safe method in
this harness.

## Interpretation

The hot path generates exactly three authoritative candidates and at most 48
curated candidates, then uses the composite
`(resolution_run_id, prefix_length, prefix_bits)` B-tree indexes. Candidate work
is bounded for a 48-bit address; each exact probe is approximately `O(log N)`.
The stored baseline must show the lookup indexes in large-dataset plans. A small
dataset may legitimately use a sequential scan when PostgreSQL estimates it is
cheaper.

Do not compare numbers from different machines as if they were a regression.
Re-run on the target deployment with representative concurrency, connection
pooling, cache state, and traffic before setting an SLO, rate limit, or capacity
budget. The checked-in local result is in
[`performance-baseline.md`](./performance-baseline.md); its raw plans and
machine context are stored under `benchmarks/`.
