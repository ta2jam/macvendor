# Lookup performance baseline

Generated: 2026-07-11T13:59:19.057Z

> This is a machine-specific baseline, not a production SLO or a hosted-CI latency gate.

| Context | Value |
|---|---|
| Application | 0.0.10 |
| Git commit | `1fc440b64028` (dirty: false) |
| Host | darwin arm64 25.5.0 |
| CPU | Apple M4 (10 logical) |
| Memory | 16384.0 MiB |
| Runtime | Node v26.5.0; PostgreSQL 18.4 (Homebrew) |
| Samples | 500 measured + 50 warmup; concurrency 1 |

## Latency and query plan

| Assignments | Claims | Layer | Scenario | p50 ms | p95 ms | p99 ms | req/s | Plan ms | Shared hit/read | Lookup indexes |
|---:|---:|---|---|---:|---:|---:|---:|---:|---:|---|
| 1,000 | 1,048 | database | official_hit | 1.802 | 3.061 | 4.124 | 513.99 | 0.134 | 11/0 | resolved_assignments_lookup_idx |
| 1,000 | 1,048 | http | official_hit | 3.801 | 5.775 | 6.73 | 248.81 | — | — | — |
| 1,000 | 1,048 | database | no_match | 1.621 | 3.256 | 4.415 | 546.25 | 0.219 | 10/0 | resolved_assignments_lookup_idx |
| 1,000 | 1,048 | http | no_match | 4.084 | 5.943 | 6.899 | 238.46 | — | — | — |
| 1,000 | 1,048 | database | curated_48_match | 1.905 | 4.068 | 5.053 | 493.42 | 0.835 | 45/0 | resolved_assignments_lookup_idx |
| 1,000 | 1,048 | http | curated_48_match | 4.335 | 6.123 | 6.678 | 225.58 | — | — | — |
| 10,000 | 10,048 | database | official_hit | 0.527 | 2.109 | 3.158 | 1012.74 | 0.099 | 11/0 | resolved_assignments_lookup_idx |
| 10,000 | 10,048 | http | official_hit | 3.879 | 5.693 | 7.41 | 246.48 | — | — | — |
| 10,000 | 10,048 | database | no_match | 0.538 | 1.219 | 1.645 | 1572.09 | 0.188 | 10/0 | resolved_assignments_lookup_idx |
| 10,000 | 10,048 | http | no_match | 3.962 | 5.665 | 6.619 | 243.93 | — | — | — |
| 10,000 | 10,048 | database | curated_48_match | 1.415 | 2.548 | 3.117 | 669.98 | 0.658 | 154/0 | resolved_assignments_lookup_idx, resolved_claims_lookup_idx |
| 10,000 | 10,048 | http | curated_48_match | 4.199 | 6.468 | 9.416 | 219.46 | — | — | — |
| 100,000 | 100,048 | database | official_hit | 1.709 | 3.578 | 4.497 | 516.41 | 0.12 | 14/0 | resolved_assignments_lookup_idx |
| 100,000 | 100,048 | http | official_hit | 3.93 | 5.911 | 7.452 | 237.95 | — | — | — |
| 100,000 | 100,048 | database | no_match | 1.715 | 3.409 | 4.574 | 513.45 | 0.123 | 13/0 | resolved_assignments_lookup_idx |
| 100,000 | 100,048 | http | no_match | 3.982 | 5.7 | 7.576 | 236.61 | — | — | — |
| 100,000 | 100,048 | database | curated_48_match | 2.44 | 4.016 | 4.608 | 387.88 | 0.683 | 205/0 | resolved_assignments_lookup_idx, resolved_claims_lookup_idx |
| 100,000 | 100,048 | http | curated_48_match | 4.283 | 6.28 | 7.271 | 224.07 | — | — | — |
| 250,000 | 250,048 | database | official_hit | 1.47 | 2.565 | 3.305 | 645.14 | 0.27 | 14/0 | resolved_assignments_lookup_idx |
| 250,000 | 250,048 | http | official_hit | 4.339 | 6.309 | 7.283 | 223.84 | — | — | — |
| 250,000 | 250,048 | database | no_match | 1.558 | 3.326 | 4.397 | 556.69 | 0.244 | 13/0 | resolved_assignments_lookup_idx |
| 250,000 | 250,048 | http | no_match | 4.298 | 5.822 | 6.773 | 230.97 | — | — | — |
| 250,000 | 250,048 | database | curated_48_match | 1.363 | 3.664 | 5.81 | 613.77 | 0.579 | 205/0 | resolved_assignments_lookup_idx, resolved_claims_lookup_idx |
| 250,000 | 250,048 | http | curated_48_match | 4.641 | 6.258 | 7.336 | 212.52 | — | — | — |

## Process and database counters

| Assignments | Layer | Scenario | Client CPU ms | Client peak MiB | Server CPU ms | Server peak MiB | DB hit/read blocks | Temp bytes |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 1,000 | database | official_hit | 249.961 | 97.1 | — | — | 12669/0 | 0 |
| 1,000 | http | official_hit | 401.991 | 125.7 | 660 | 198.6 | — | — |
| 1,000 | database | no_match | 160.017 | 102.8 | — | — | 12000/0 | 0 |
| 1,000 | http | no_match | 416.199 | 109.3 | 590 | 170.3 | — | — |
| 1,000 | database | curated_48_match | 188.301 | 121.1 | — | — | 29500/0 | 0 |
| 1,000 | http | curated_48_match | 357.797 | 134.6 | 560 | 172.3 | — | — |
| 10,000 | database | official_hit | 71.963 | 141.8 | — | — | 12503/0 | 0 |
| 10,000 | http | official_hit | 357.730 | 142.7 | 460 | 173.7 | — | — |
| 10,000 | database | no_match | 69.959 | 146.3 | — | — | 12000/0 | 0 |
| 10,000 | http | no_match | 350.439 | 153.4 | 470 | 176.2 | — | — |
| 10,000 | database | curated_48_match | 182.498 | 153.7 | — | — | 84000/0 | 0 |
| 10,000 | http | curated_48_match | 388.127 | 158.0 | 520 | 176.5 | — | — |
| 100,000 | database | official_hit | 196.302 | 146.5 | — | — | 14003/0 | 0 |
| 100,000 | http | official_hit | 348.473 | 144.5 | 570 | 141.3 | — | — |
| 100,000 | database | no_match | 209.932 | 152.6 | — | — | 13500/0 | 0 |
| 100,000 | http | no_match | 332.251 | 152.9 | 490 | 171.3 | — | — |
| 100,000 | database | curated_48_match | 293.727 | 153.9 | — | — | 109500/0 | 0 |
| 100,000 | http | curated_48_match | 358.767 | 156.2 | 570 | 171.7 | — | — |
| 250,000 | database | official_hit | 142.448 | 152.5 | — | — | 14001/2 | 0 |
| 250,000 | http | official_hit | 382.548 | 151.2 | 520 | 170.7 | — | — |
| 250,000 | database | no_match | 195.811 | 155.3 | — | — | 13500/0 | 0 |
| 250,000 | http | no_match | 356.946 | 155.3 | 500 | 171.6 | — | — |
| 250,000 | database | curated_48_match | 186.613 | 156.5 | — | — | 109500/0 | 0 |
| 250,000 | http | curated_48_match | 358.144 | 157.0 | 500 | 171.9 | — | — |

## Dataset build and storage

| Assignments | Claims | Setup ms | Database MiB |
|---:|---:|---:|---:|
| 1,000 | 1,048 | 108.254 | 11.8 |
| 10,000 | 10,048 | 516.126 | 25.7 |
| 100,000 | 100,048 | 5905.725 | 165.5 |
| 250,000 | 250,048 | 13550.604 | 405.5 |

## Boundaries

- Data is deterministic and synthetic; no IEEE or amateur records are used.
- Requests are sequential at concurrency 1 against the origin; CDN latency is excluded.
- Node CPU/RSS and PostgreSQL buffer/temp counters are reported separately; portable PostgreSQL process CPU and energy are not available.
- `EXPLAIN ANALYZE` adds instrumentation overhead and is stored for plan evidence, not latency percentiles.
- Re-run on the target deployment before setting an SLO, capacity, or shared rate limit.
