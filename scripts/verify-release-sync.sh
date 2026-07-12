#!/bin/sh
set -eu

: "${DEPLOY_HOST:?DEPLOY_HOST is required, for example deploy@example.invalid}"
origin=${PRODUCTION_ORIGIN:-https://macvendor.io}
version=$(node -p "require('./package.json').version")
tag="v$version"
local_sha=$(git rev-parse HEAD)
origin_sha=$(git ls-remote origin refs/heads/main | awk '{print $1}')
tag_sha=$(git rev-list -n 1 "$tag")

test -z "$(git status --porcelain)"
test "$local_sha" = "$origin_sha"
test "$local_sha" = "$tag_sha"
test "$(gh release view "$tag" --json tagName --jq .tagName)" = "$tag"
test "$(curl --fail --silent --show-error "$origin/healthz" | node -e '
  let body="";process.stdin.on("data",chunk=>body+=chunk).on("end",()=>{
    process.stdout.write(JSON.parse(body).version);
  });
')" = "$version"

remote_sha=$(ssh "$DEPLOY_HOST" "cat /srv/sites/macvendor/releases/$tag/COMMIT_SHA")
remote_app=$(ssh "$DEPLOY_HOST" "readlink -f /srv/sites/macvendor/app")
test "$remote_sha" = "$local_sha"
test "$remote_app" = "/srv/sites/macvendor/releases/$tag/app"

printf '%s\n' "local=github=release=production $tag $local_sha"
