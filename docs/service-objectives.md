# Service objectives and capacity gates

These are initial operating objectives, not claims about achieved production
performance. They must be reviewed against at least 30 days of traffic.

| Signal | Initial objective | Alert gate |
|---|---:|---:|
| Public health availability | 99.9% monthly | two consecutive 15-minute failures |
| Single lookup origin p95 | under 250 ms | over 250 ms for 15 minutes |
| Single lookup origin p99 | under 750 ms | over 750 ms for 15 minutes |
| HTTP 5xx | under 0.5% | over 1% for 15 minutes |
| Disk | below 70% normal | warning 80%, critical 90% |
| Available host memory | above 1 GiB | below 1 GiB |
| Source freshness/rights | zero failures | any failure |
| Backup age | under 30 hours | 30 hours or failed verification |

The current Mac monitor implements coarse health, disk, memory, container and
timer gates. Latency, cache-hit ratio, request volume, 429, and 5xx objectives
require privacy-preserving aggregate metrics at the edge/origin; they are not
silently reported as achieved.

Single lookup performs a bounded set of indexed prefix probes, approximately
`O(log N)` for `N` resolved rows. Bulk official lookup deduplicates inputs and
uses one SQL statement; work is `O(k log N)` for at most `k=25`. Source builds
remain proportional to input bytes plus resolver work and must not overlap with
backup or another source update.

Before raising the bulk bound or origin quota, capture p95/p99, PostgreSQL wait
time, RSS, CPU, disk I/O, Cloudflare cache status, 429, and 5xx under measured
concurrency. Do not call a limit optimal without those measurements.
