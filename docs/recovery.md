# Backup, restore, and artifact rebuild

These commands implement logical-backup and recovery drills. They do not create
managed PostgreSQL PITR, object-storage versioning, encryption-at-rest, or an
external correction-system backup. Those remain provider responsibilities.

Requirements:

- PostgreSQL client tools compatible with the server major version;
- `DATABASE_URL` for backup;
- `RECOVERY_ADMIN_DATABASE_URL` pointing specifically to the server's `postgres`
  maintenance database for restore/rebuild;
- a backup directory with mode `0700` on encrypted storage.

Database credentials are translated to `PG*` environment variables. They are
never included in `pg_dump`, `pg_restore`, `createdb`, or `dropdb` arguments or
written to recovery manifests.

## Logical backup

```bash
mkdir -m 700 /secure/macvendor-backups
npm run recovery:backup -- --output-dir /secure/macvendor-backups
```

The command opens a repeatable-read transaction, exports its PostgreSQL
snapshot, records table counts and active-pointer integrity inside that snapshot,
and gives the same snapshot to `pg_dump`. Live writes therefore cannot make the
manifest and dump describe different instants.

Output is a compressed PostgreSQL custom dump plus a `macvendor-backup/v2` JSON
manifest containing:

- application, Git, migration, and `pg_dump` versions;
- dump byte size and SHA-256;
- counts for every source/resolution/suppression/audit/correction table;
- active resolution, active version, and publication version;
- audit/correction append-only trigger and constraint-validation state;
- measured duration.

Files are created with mode `0600` and atomic final names. A database without one
consistent active release, migration history, append-only audit trigger, or fully
validated constraints is not backed up as a successful recovery point.

Restore remains backward compatible with `macvendor-backup/v1` manifests. New
`v2` manifests additionally make correction-request/event loss and a missing or
disabled correction-event append-only trigger detectable during restore.

## Restore drill

```bash
export RECOVERY_ADMIN_DATABASE_URL='postgresql://operator:...@db:5432/postgres'
npm run recovery:restore -- \
  --manifest /secure/macvendor-backups/macvendor-....json \
  --target-database macvendor_restore_a1b2
```

The target must not exist and must match
`<name>_restore_<4-12 lowercase letters or digits>`. Names such as `macvendor`,
`postgres`, or an existing database are rejected. The tool never drops a
pre-existing database.

Before database creation it validates manifest shape, dump basename, regular-file
status, byte size, SHA-256, and `pg_restore --list`. Restore uses
`--single-transaction --exit-on-error --no-owner --no-acl`. It then compares all
table counts, migrations, the active pointer and versions, checks the applicable
append-only triggers and constraints, and executes the active data-release query.

By default the verified disposable database remains for inspection. Automated
drills may add `--drop-after-check`; only the database created by that invocation
and passing the disposable-name guard can then be removed.

## Zero-from-artifact rebuild

```bash
export RECOVERY_ADMIN_DATABASE_URL='postgresql://operator:...@db:5432/postgres'
npm run recovery:rebuild -- \
  --target-database macvendor_rebuild_a1b2 \
  --drop-after-check
```

This path does not use `pg_dump` or `db:seed`. It creates an empty disposable
database, applies forward migrations, reads the checked-in synthetic CSV
artifacts under `examples/recovery`, generates ephemeral Ed25519 signatures,
imports both immutable source releases, builds and activates a resolution, and
checks lookup, data-release, constraints, active-pointer, and audit integrity.

The fixture is synthetic and exists only to prove reconstructability. It is not
a production or amateur dataset.

## End-to-end smoke

```bash
export RECOVERY_ADMIN_DATABASE_URL='postgresql://localhost:5432/postgres'
npm run recovery:smoke
```

The smoke command backs up `RECOVERY_SOURCE_DATABASE_URL` (or
`TEST_DATABASE_URL`), restores and verifies it, rebuilds independently from
synthetic artifacts, drops both disposable databases, removes temporary backup
files, and prints measured durations and hashes. The staging container CI runs
this drill with PostgreSQL 18 client tools.

## Capacity and remaining guarantees

Backup/restore time and I/O are `O(D)` for logical database size `D`; restore
temporarily needs another database of comparable size. Artifact rebuild is
`O(B + R log R)` for artifact bytes `B` and records `R`. The commands report
durations but make no RTO claim from a synthetic database.

A daily invocation can support the documented 24-hour logical-backup RPO only
when an external scheduler, failure alert, encrypted/versioned destination, and
retention policy are configured. The 15-minute configuration/audit RPO and
seven-day PITR target require managed physical backup/WAL archiving and remain
unimplemented without a selected provider.

## Temporary MacBook off-host copy

Until remote object storage is selected, `deploy/macos/install-operations.sh`
installs a daily pull job on the operator Mac. It downloads the newest VPS dump
and SHA-256 sidecar over the `deploy` public key, verifies the digest and
`pg_restore --list`, then stores both in an encrypted restic repository. The
restic password lives in macOS Keychain; FileVault must remain enabled.

This is off-host but not continuously available infrastructure. A sleeping,
offline, damaged, or stolen Mac delays the backup, so it does not satisfy the
future managed PITR target. Failures are sent to Slack `#team` when Hermes is
configured. Retention is 14 daily, 8 weekly, and 6 monthly snapshots.
