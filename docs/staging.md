# Provider-neutral staging runbook

The staging artifact contains application code and synthetic demo records only.
It does not contain production source data or credentials.

## Local or single-host staging

Create an ignored environment file from `.env.staging.example`. Use a random,
URL-encoded password and repeat it in `STAGING_DATABASE_URL`:

```bash
cp .env.staging.example .env.staging
docker compose --env-file .env.staging -f compose.staging.yaml up --build -d
```

The one-shot `migrate` service applies every migration and idempotently seeds the
synthetic demo. The application starts only after that service exits successfully.
PostgreSQL is not published to the host.

Checks:

```bash
curl -fsS http://127.0.0.1:3000/healthz
curl -fsS http://127.0.0.1:3000/readyz
curl -fsS http://127.0.0.1:3000/v1/lookup/02AABBCC0001
```

`healthz` verifies the process. `readyz` verifies PostgreSQL connectivity and an
active resolution. Both are uncacheable and expose no database error details.

Run the destructive, ephemeral smoke drill with explicit test credentials:

```bash
set -a
. ./.env.staging
set +a
npm run staging:smoke
```

The drill builds the multi-stage image, starts PostgreSQL, migrates, seeds,
checks health/readiness/OpenAPI/lookup, sends a graceful stop, verifies exit code
zero or the standard SIGTERM-derived `143` without an OOM kill, and deletes the
staging volume.

## Runtime boundary

- Runtime is non-root UID/GID `1001`.
- Root filesystem is read-only; only a 16 MiB `/tmp` tmpfs is writable.
- Linux capabilities are dropped and privilege escalation is disabled.
- The runtime image contains the standalone Next.js output, static assets, and
  public API schemas—not TypeScript tooling or source datasets.
- Database migrations run from a separate tooling stage.

## External deployment blocker

No external staging environment is deployed by this repository. That requires a
selected provider, account authority, DNS/TLS ownership, secret storage,
network policy, backup destination, retention policy, and cost boundary. Until
those are supplied, claiming an internet staging deployment would be false.
