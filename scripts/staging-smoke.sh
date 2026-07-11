#!/bin/sh
set -eu

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${STAGING_DATABASE_URL:?STAGING_DATABASE_URL is required}"

compose_file=${COMPOSE_FILE:-compose.staging.yaml}
app_port=${APP_PORT:-3000}

cleanup() {
  docker compose -f "$compose_file" down --volumes --remove-orphans
}
trap cleanup EXIT INT TERM

docker compose -f "$compose_file" up --build --detach
docker compose -f "$compose_file" wait migrate

attempt=0
until curl --fail --silent --show-error "http://127.0.0.1:${app_port}/readyz" >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    docker compose -f "$compose_file" logs app migrate postgres
    exit 1
  fi
  sleep 1
done

curl --fail --silent --show-error "http://127.0.0.1:${app_port}/healthz" >/dev/null
curl --fail --silent --show-error "http://127.0.0.1:${app_port}/openapi.json" >/dev/null
curl --fail --silent --show-error "http://127.0.0.1:${app_port}/schemas/public-api-v1.schema.json" >/dev/null
curl --fail --silent --show-error "http://127.0.0.1:${app_port}/v1/lookup/02AABBCC0001" >/dev/null

container_id=$(docker compose -f "$compose_file" ps --quiet app)
docker compose -f "$compose_file" stop --timeout 10 app
test "$(docker inspect --format '{{.State.ExitCode}}' "$container_id")" = "0"
