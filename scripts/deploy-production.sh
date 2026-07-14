#!/bin/sh
set -eu
umask 077

: "${DEPLOY_HOST:?DEPLOY_HOST is required}"
origin=${PRODUCTION_ORIGIN:-https://macvendor.io}
identity=${DEPLOY_IDENTITY:-}
version=$(node -p "require('./package.json').version")
tag="v$version"
sha=$(git rev-parse HEAD)
origin_sha=$(git ls-remote origin refs/heads/main | awk '{print $1}')
tag_sha=$(git rev-list -n 1 "$tag")

test -z "$(git status --porcelain)"
test "$sha" = "$origin_sha"
test "$sha" = "$tag_sha"
test "$(gh release view "$tag" --json tagName --jq .tagName)" = "$tag"

for workflow in CI CodeQL "Supply Chain" "Release Gate"; do
  count=$(gh run list --commit "$sha" --limit 100 --json workflowName,conclusion \
    --jq "[.[] | select(.workflowName == \"$workflow\" and .conclusion == \"success\")] | length")
  test "$count" -ge 1
done

set -- -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=15
if [ -n "$identity" ]; then
  set -- "$@" -i "$identity"
fi

ssh "$@" "$DEPLOY_HOST" "sudo -n install -d -o deploy -g deploy -m 0755 \
  /srv/sites/macvendor/releases/$tag/app"
git archive "$tag" | ssh "$@" "$DEPLOY_HOST" \
  "sudo -n tar -x -C /srv/sites/macvendor/releases/$tag/app"
printf '%s\n' "$sha" | ssh "$@" "$DEPLOY_HOST" \
  "sudo -n tee /srv/sites/macvendor/releases/$tag/COMMIT_SHA >/dev/null"

# All mutable promotion steps run in one remote shell so its rollback trap can
# restore the previous image aliases, symlink, release metadata, and container.
ssh "$@" "$DEPLOY_HOST" sudo -n sh -s -- "$tag" "$version" "$sha" <<'REMOTE'
set -eu
root=/srv/sites/macvendor
tag=$1
version=$2
sha=$3
release="$root/releases/$tag/app"
previous_link=$(readlink -f "$root/app")
previous_app_image=$(docker image inspect macvendor-app:latest --format '{{.Id}}')
previous_tooling_image=$(docker image inspect macvendor-tooling:current --format '{{.Id}}')
previous_env=$(mktemp)
cp "$root/release.env" "$previous_env"
promoting=1

rollback() {
  status=$?
  if [ "$promoting" -eq 1 ]; then
    docker tag "$previous_app_image" macvendor-app:latest
    docker tag "$previous_tooling_image" macvendor-tooling:current
    ln -sfn "$previous_link" "$root/app"
    cp "$previous_env" "$root/release.env"
    cd "$root/app"
    docker compose --env-file "$root/.env" -f compose.production.yaml \
      up -d --no-build --force-recreate app >/dev/null 2>&1 || true
  fi
  rm -f "$previous_env"
  exit "$status"
}
trap rollback EXIT HUP INT TERM

systemctl start macvendor-backup.service
cd "$release"
docker build --target runtime \
  --label "org.opencontainers.image.version=$version" \
  --label "org.opencontainers.image.revision=$sha" \
  --tag "macvendor-app:$tag" --tag macvendor-app:latest .
docker build --target tooling \
  --label "org.opencontainers.image.version=$version" \
  --label "org.opencontainers.image.revision=$sha" \
  --tag "macvendor-tooling:$tag" --tag macvendor-tooling:current .

app_digest=$(docker image inspect "macvendor-app:$tag" --format '{{.Id}}')
encoded_password=$(docker run --rm --env-file "$root/.env" \
  --entrypoint node "macvendor-tooling:$tag" -e \
  'process.stdout.write(encodeURIComponent(process.env.POSTGRES_PASSWORD))')
docker run --rm --network macvendor_default \
  --env-file "$root/.env" \
  -e "DATABASE_URL=postgresql://macvendor:$encoded_password@database:5432/macvendor" \
  --entrypoint sh "macvendor-tooling:$tag" -lc 'npm run db:migrate'

ln -sfn "$release" "$root/app"
cat > "$root/release.env" <<EOF
RELEASE_VERSION=$version
RELEASE_SHA=$sha
APP_IMAGE_DIGEST=$app_digest
EOF
chmod 0600 "$root/release.env"

install -m 0755 "$release/deploy/macvendor-image-retention" /usr/local/sbin/macvendor-image-retention
install -m 0644 "$release/deploy/macvendor-image-retention.service" /etc/systemd/system/macvendor-image-retention.service
install -m 0644 "$release/deploy/macvendor-image-retention.timer" /etc/systemd/system/macvendor-image-retention.timer
systemctl daemon-reload
systemctl enable --now macvendor-image-retention.timer

cd "$root/app"
docker compose --env-file "$root/.env" -f compose.production.yaml \
  up -d --no-build --force-recreate app
attempt=0
until [ "$(docker inspect macvendor-app-1 --format '{{.State.Health.Status}}' 2>/dev/null || true)" = healthy ]; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 40 ]
  sleep 3
done
test "$(docker inspect macvendor-app-1 --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$sha"
systemctl start macvendor-backup.service
/usr/local/sbin/macvendor-image-retention

promoting=0
rm -f "$previous_env"
trap - EXIT HUP INT TERM
REMOTE

DEPLOY_HOST="$DEPLOY_HOST" PRODUCTION_ORIGIN="$origin" DEPLOY_IDENTITY="$identity" \
  npm run release:verify-sync
