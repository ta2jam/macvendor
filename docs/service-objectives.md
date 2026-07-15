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
| Shared rate limiter | enabled and healthy | disabled or degraded readiness |
| Backup age | under 30 hours | 30 hours or failed verification |

`macvendor-traffic-report.timer` produces a bounded aggregate every 15 minutes
from the seven-day Caddy log: 24-hour product/operational/known-monitor/likely-
scan counts, fixed endpoint buckets, peak requests per minute, 400/404/429/other
4xx, 5xx, and mean/max origin duration. It retains no raw URI, MAC, IP or user
agent. Scan classification is explicitly heuristic and is not a security verdict.
The Mac monitor alerts when the report is over one hour old, peak traffic reaches
3,000 requests/minute, 429 reaches 50/day, or 5xx reaches 5/day. These are
investigation gates, not capacity claims.

Single lookup performs a bounded set of indexed prefix probes, approximately
`O(log N)` for `N` resolved rows. Bulk official lookup deduplicates inputs and
uses one SQL statement; work is `O(k log N)` for at most `k=100`. Enriched bulk
uses one repeatable-read snapshot and three bounded set queries for at most
`k=50`; database work remains `O(k log N)` while response memory is driven by
the bounded 20 curated matches and 50 insights per item. Source builds remain
proportional to input bytes plus resolver work and must not overlap with backup
or another source update.

Before raising the bulk bound or origin quota, capture p95/p99, PostgreSQL wait
time, RSS, CPU, disk I/O, Cloudflare edge policy, 429, and 5xx under measured
concurrency. The current API edge policy is deliberately `DYNAMIC` so cached
responses cannot bypass origin quota. Do not call a limit optimal without those
measurements.
