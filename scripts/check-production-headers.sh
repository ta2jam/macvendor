#!/bin/sh
set -eu

headers=${1:?response header file is required}
normalized=$(mktemp)
trap 'rm -f "$normalized"' EXIT HUP INT TERM

# curl writes HTTP header files with CRLF. Normalize explicitly because GNU and
# BSD grep do not interpret \r identically inside an extended regular expression.
tr -d '\r' < "$headers" > "$normalized"
grep -Eiq '^cf-cache-status: DYNAMIC$' "$normalized"
grep -Eiq '^x-api-version: v1$' "$normalized"
