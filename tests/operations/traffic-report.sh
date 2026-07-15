#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

MACVENDOR_CADDY_LOG="$root/tests/fixtures/caddy-traffic.jsonl" \
MACVENDOR_METRICS_DIR="$tmp" \
MACVENDOR_METRICS_OWNER="$(id -un)" \
MACVENDOR_METRICS_GROUP="$(id -gn)" \
  "$root/deploy/macvendor-traffic-report" >/dev/null

jq -e '
  .schemaVersion == "macvendor-traffic/v2" and
  .requests == 10 and
  .productRequests == 6 and
  .operationalRequests == 2 and
  .knownMonitorRequests == 2 and
  .likelyAutomatedScanRequests == 2 and
  .peakRequestsPerMinute == 10 and
  .clientErrors == 4 and
  .rateLimited == 1 and
  .serverErrors == 1 and
  .status == {successful:4,redirected:1,clientErrors:4,serverErrors:1} and
  .clientErrorBreakdown == {badRequest:1,notFound:2,rateLimited:1,other:0} and
  .endpoints.lookup == 3 and
  .endpoints.bulk == 1 and
  .endpoints.health == 1 and
  .endpoints.other == 2 and
  .edgePolicy == "origin_rate_limited"
' "$tmp/traffic-latest.json" >/dev/null
