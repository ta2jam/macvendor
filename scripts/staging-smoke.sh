#!/bin/sh
set -eu

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${STAGING_DATABASE_URL:?STAGING_DATABASE_URL is required}"

compose_file=${COMPOSE_FILE:-compose.staging.yaml}
app_port=${APP_PORT:-3000}

if docker compose version >/dev/null 2>&1; then
  compose() { docker compose "$@"; }
elif command -v docker-compose >/dev/null 2>&1; then
  compose() { docker-compose "$@"; }
else
  echo "Docker Compose v2 plugin or docker-compose is required" >&2
  exit 2
fi

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [ "$status" -ne 0 ]; then
    compose -f "$compose_file" logs app migrate postgres || true
  fi
  compose -f "$compose_file" down --volumes --remove-orphans || true
  exit "$status"
}
trap cleanup EXIT INT TERM

compose -f "$compose_file" up --build --detach

attempt=0
until curl --fail --silent --show-error "http://127.0.0.1:${app_port}/readyz" >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    compose -f "$compose_file" logs app migrate postgres
    exit 1
  fi
  sleep 1
done

curl --fail --silent --show-error "http://127.0.0.1:${app_port}/healthz" >/dev/null
curl --fail --silent --show-error "http://127.0.0.1:${app_port}/openapi.json" >/dev/null
curl --fail --silent --show-error "http://127.0.0.1:${app_port}/schemas/public-api-v1.schema.json" >/dev/null
curl --fail --silent --show-error "http://127.0.0.1:${app_port}/v1/lookup/02AABBCC0001" >/dev/null
compose -f "$compose_file" --profile recovery run --rm --no-deps recovery

container_id=$(compose -f "$compose_file" ps --quiet app)
compose -f "$compose_file" stop --timeout 10 app
exit_code=$(docker inspect --format '{{.State.ExitCode}}' "$container_id")
oom_killed=$(docker inspect --format '{{.State.OOMKilled}}' "$container_id")
test "$oom_killed" = "false"
case "$exit_code" in
  0|143) ;;
  *) echo "unexpected app exit code: $exit_code" >&2; exit 1 ;;
esac
