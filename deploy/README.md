# Production deployment

The host-level Caddy service owns ports 80 and 443 so additional sites can be
added without coupling their application stacks. This project exposes its app
only on `127.0.0.1:3000`; PostgreSQL has no host port.

Runtime secrets belong in `/srv/sites/macvendor/.env` with mode `0600`. They
must never be committed. Start the stack with:

```sh
docker compose --env-file .env -f compose.production.yaml up -d --build
```

Every deployment writes the released commit to
`/srv/sites/macvendor/releases/vX.Y.Z/COMMIT_SHA`. After publication, verify the
local commit, `origin/main`, tag, GitHub Release, public version, remote marker,
and active symlink agree:

```sh
DEPLOY_HOST=deploy@example.invalid npm run release:verify-sync
```

The production database volume is persistent. Take and verify a logical backup
before upgrades or destructive database work.

`macvendor-backup.timer` creates and validates a daily logical backup. Host
retention is bounded to 14 days and the newest 20 dumps because releases also
create pre- and post-deploy backups. It must be paired with an off-host copy. A
same-disk backup does not protect against VPS or disk loss.

`macvendor-ieee-update.timer` runs the guarded IEEE update daily.
`macvendor-source-update.timer` refreshes IEEE and all enrichment sources weekly
with verified backups before and after activation.
`macvendor-source-health.timer` checks freshness, rights and active-config
drift every six hours. `macvendor-maintenance.timer` removes expired limiter
windows and correction contact data daily. `macvendor-correction-health.timer`
checks the operator queue SLA hourly. These jobs use the immutable `macvendor-tooling:current` image,
`/srv/sites/macvendor/release.env`, and the read-only ingest signing key.
