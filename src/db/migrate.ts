import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";

const MIGRATION_LOCK = 6_104_227_001;
const LEDGER_SCHEMA = "macvendor-migrations/v1";
const MIGRATION_NAME = /^\d{4}_[a-z0-9_]+\.sql$/;
const CHECKSUM = /^sha256:[0-9a-f]{64}$/;

export type MigrationIntegrityCode =
  | "INVALID_MIGRATION_SET"
  | "INVALID_MIGRATION_LEDGER"
  | "MIGRATION_LEDGER_MISMATCH"
  | "APPLIED_MIGRATION_MISSING"
  | "APPLIED_MIGRATION_DRIFT";

export class MigrationIntegrityError extends Error {
  constructor(public readonly code: MigrationIntegrityCode, message: string) {
    super(message);
    this.name = "MigrationIntegrityError";
  }
}

export interface VerifiedMigration {
  name: string;
  checksum: string;
  sql: string;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function loadMigrationSet(directory: string): Promise<VerifiedMigration[]> {
  const names = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  if (names.length < 1 || names.some((name, index) => !MIGRATION_NAME.test(name)
    || name.slice(0, 4) !== String(index + 1).padStart(4, "0"))) {
    throw new MigrationIntegrityError(
      "INVALID_MIGRATION_SET", "migration filenames must form a contiguous NNNN_lowercase_name.sql sequence",
    );
  }
  let parsed: unknown;
  try {
    const ledgerPath = path.join(directory, "checksums.json");
    const ledgerStat = await lstat(ledgerPath);
    if (!ledgerStat.isFile() || ledgerStat.isSymbolicLink()) throw new Error();
    parsed = JSON.parse(await readFile(ledgerPath, "utf8"));
  } catch {
    throw new MigrationIntegrityError("INVALID_MIGRATION_LEDGER", "migration checksum ledger is missing or invalid JSON");
  }
  const ledger = object(parsed);
  const files = object(ledger?.files);
  if (!ledger || ledger.schemaVersion !== LEDGER_SCHEMA || !files
    || Object.keys(ledger).some((key) => !["schemaVersion", "files"].includes(key))) {
    throw new MigrationIntegrityError("INVALID_MIGRATION_LEDGER", "migration checksum ledger has an invalid schema");
  }
  const ledgerNames = Object.keys(files).sort();
  if (ledgerNames.length !== names.length || ledgerNames.some((name, index) => name !== names[index])) {
    throw new MigrationIntegrityError("INVALID_MIGRATION_LEDGER", "migration checksum ledger must cover the exact SQL file set");
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const migrations: VerifiedMigration[] = [];
  for (const name of names) {
    const expected = files[name];
    if (typeof expected !== "string" || !CHECKSUM.test(expected)) {
      throw new MigrationIntegrityError("INVALID_MIGRATION_LEDGER", `${name} has an invalid ledger checksum`);
    }
    const migrationPath = path.join(directory, name);
    const stat = await lstat(migrationPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new MigrationIntegrityError("INVALID_MIGRATION_SET", `${name} must be a regular non-symlink file`);
    }
    const bytes = await readFile(migrationPath);
    const actual = sha256(bytes);
    if (actual !== expected) {
      throw new MigrationIntegrityError("MIGRATION_LEDGER_MISMATCH", `${name} does not match the committed checksum ledger`);
    }
    let sql: string;
    try { sql = decoder.decode(bytes); }
    catch { throw new MigrationIntegrityError("INVALID_MIGRATION_SET", `${name} is not valid UTF-8`); }
    migrations.push({ name, checksum: actual, sql });
  }
  return migrations;
}

export async function migrate(pool: Pool, directory = path.join(process.cwd(), "migrations")): Promise<void> {
  const migrations = await loadMigrationSet(directory);
  const expected = new Map(migrations.map((migration) => [migration.name, migration]));
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query("BEGIN");
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          name text PRIMARY KEY,
          checksum text CHECK (checksum IS NULL OR checksum ~ '^sha256:[0-9a-f]{64}$'),
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await client.query(`
        ALTER TABLE schema_migrations
        ADD COLUMN IF NOT EXISTS checksum text
        CHECK (checksum IS NULL OR checksum ~ '^sha256:[0-9a-f]{64}$')
      `);
      const applied = await client.query<{ name: string; checksum: string | null }>(
        "SELECT name, checksum FROM schema_migrations ORDER BY name",
      );
      for (const row of applied.rows) {
        const migration = expected.get(row.name);
        if (!migration) {
          throw new MigrationIntegrityError(
            "APPLIED_MIGRATION_MISSING", `${row.name} exists in database history but not in the deployed migration set`,
          );
        }
        if (row.checksum !== null && row.checksum !== migration.checksum) {
          throw new MigrationIntegrityError(
            "APPLIED_MIGRATION_DRIFT", `${row.name} checksum differs from the applied database history`,
          );
        }
        if (row.checksum === null) {
          await client.query("UPDATE schema_migrations SET checksum = $2 WHERE name = $1 AND checksum IS NULL", [
            row.name, migration.checksum,
          ]);
        }
      }
      await client.query("ALTER TABLE schema_migrations ALTER COLUMN checksum SET NOT NULL");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    for (const migration of migrations) {
      const applied = await client.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE name = $1",
        [migration.name],
      );
      if (applied.rows[0]) continue;
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [
          migration.name, migration.checksum,
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
}
