#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

printf 'HTTP/2 200\r\nCF-Cache-Status: DYNAMIC\r\nX-API-Version: v1\r\n\r\n' > "$tmp/crlf"
printf 'HTTP/2 200\ncf-cache-status: DYNAMIC\nx-api-version: v1\n' > "$tmp/lf"
printf 'HTTP/2 200\r\nCF-Cache-Status: HIT\r\nX-API-Version: v1\r\n\r\n' > "$tmp/hit"

sh "$root/scripts/check-production-headers.sh" "$tmp/crlf"
sh "$root/scripts/check-production-headers.sh" "$tmp/lf"
if sh "$root/scripts/check-production-headers.sh" "$tmp/hit"; then
  echo "HIT must violate the origin-rate-limited policy" >&2
  exit 1
fi
