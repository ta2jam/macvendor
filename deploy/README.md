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

The temporary off-host control is the encrypted MacBook restic pull documented
in `docs/recovery.md`. Replace it with independent versioned object storage and
WAL/PITR when a provider is selected.

## Administrative SSH

Install `sshd-hardening.conf` under `/etc/ssh/sshd_config.d/`, validate with
`sshd -t`, and keep a provider-console session open during reload. Only the
`deploy` public-key account is allowed; root, password, keyboard-interactive,
agent forwarding, TCP forwarding, and tunnels remain disabled.

`fail2ban-sshd.local` uses 10 failures per 10 minutes and a 15-minute ban. The
previous three-failure, one-hour exponentially increasing ban caused avoidable
operator lockout on a public-key-only host. Do not allowlist a dynamic home IP.

The Mac launch agent checks public health, release metadata, SSH, failed units,
disk, available memory, unhealthy containers, and timer count every 15 minutes.
It sends only failure/recovery transitions to Slack `#team`; a sleeping Mac is
not an independent monitoring system, so GitHub Production Monitor remains the
external HTTP probe.

The daily scheduled publication is `macvendor-source-update.timer`. It prepares
all IEEE and enrichment inputs before import, then performs one build and one
activation. Disable and mask the legacy `macvendor-ieee-update.timer`;
retaining both schedules would reintroduce intermediate publications.

`macvendor-source-health.timer` checks freshness, rights and active-config
drift every six hours. `macvendor-maintenance.timer` removes expired limiter
windows and correction contact data daily. `macvendor-correction-health.timer`
checks the operator queue SLA hourly. These jobs use the immutable `macvendor-tooling:current` image,
`/srv/sites/macvendor/release.env`, and the read-only ingest signing key.
