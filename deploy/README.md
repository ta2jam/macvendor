# Production deployment

The host-level Caddy service owns ports 80 and 443 so additional sites can be
added without coupling their application stacks. This project exposes its app
only on `127.0.0.1:3000`; PostgreSQL has no host port.

Runtime secrets belong in `/srv/sites/macvendor/.env` with mode `0600`. They
must never be committed. Start the stack with:

```sh
docker compose --env-file .env -f compose.production.yaml up -d --build
```

The production database volume is persistent. Take and verify a logical backup
before upgrades or destructive database work.

`macvendor-backup.timer` creates and validates a daily logical backup, retains
14 days on the host, and must be paired with an off-host copy. A same-disk
backup does not protect against VPS or disk loss.
