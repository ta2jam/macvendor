import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Pool, PoolClient } from "pg";
import { createPool } from "@/db/pool";

const runFile = promisify(execFile);
const TARGET_PATTERN = /^[a-z][a-z0-9_]{1,39}_(restore|rebuild)_[a-z0-9]{4,12}$/;

export const LEGACY_BACKUP_TABLES = [
  "schema_migrations",
  "data_sources",
  "source_releases",
  "source_fetch_observations",
  "source_artifacts",
  "source_records",
  "resolution_runs",
  "resolution_inputs",
  "resolved_assignments",
  "resolved_claims",
  "resolution_evidence",
  "active_resolution",
  "publication_suppressions",
  "audit_events",
] as const;

export const BACKUP_TABLES = [
  ...LEGACY_BACKUP_TABLES,
  "correction_requests",
  "correction_events",
] as const;

export class RecoveryError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "RecoveryError";
  }
}

export function databaseName(connectionUrl: string): string {
  let url: URL;
  try { url = new URL(connectionUrl); } catch { throw new RecoveryError("INVALID_DATABASE_URL", "database URL is invalid"); }
  if (!(url.protocol === "postgresql:" || url.protocol === "postgres:")) {
    throw new RecoveryError("INVALID_DATABASE_URL", "database URL must use postgres or postgresql");
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,62}$/.test(name)) {
    throw new RecoveryError("INVALID_DATABASE_NAME", "database URL must contain one safe database name");
  }
  return name;
}

export function connectionUrlForDatabase(connectionUrl: string, targetDatabase: string): string {
  const url = new URL(connectionUrl);
  url.pathname = `/${encodeURIComponent(targetDatabase)}`;
  return url.toString();
}

export function postgresEnvironment(connectionUrl: string, targetDatabase?: string): NodeJS.ProcessEnv {
  const url = new URL(connectionUrl);
  const sslmode = url.searchParams.get("sslmode");
  const environment = { ...process.env };
  delete environment.DATABASE_URL;
  delete environment.TEST_DATABASE_URL;
  delete environment.RECOVERY_SOURCE_DATABASE_URL;
  delete environment.RECOVERY_ADMIN_DATABASE_URL;
  return {
    ...environment,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: targetDatabase ?? databaseName(connectionUrl),
    PGCONNECT_TIMEOUT: "10",
    ...(sslmode ? { PGSSLMODE: sslmode } : {}),
  };
}

export async function runPostgresTool(
  command: "pg_dump" | "pg_restore" | "createdb" | "dropdb",
  args: string[],
  connectionUrl: string,
  targetDatabase?: string,
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await runFile(command, args, {
      env: postgresEnvironment(connectionUrl, targetDatabase),
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      timeout: 10 * 60_000,
    });
  } catch (error) {
    const detail = error as { killed?: boolean; signal?: string; code?: string | number };
    throw new RecoveryError(
      "POSTGRES_TOOL_FAILED",
      `${command} failed${detail.killed ? " by timeout" : ""}${detail.signal ? ` with signal ${detail.signal}` : ""}`,
    );
  }
}

export function validateDisposableTarget(targetDatabase: string, kind: "restore" | "rebuild"): void {
  const match = TARGET_PATTERN.exec(targetDatabase);
  if (!match || match[1] !== kind || Buffer.byteLength(targetDatabase, "utf8") > 63) {
    throw new RecoveryError(
      "UNSAFE_TARGET_DATABASE",
      `target database must match <name>_${kind}_<4-12 lowercase letters or digits>`,
    );
  }
}

export async function createDisposableDatabase(
  adminDatabaseUrl: string,
  targetDatabase: string,
  kind: "restore" | "rebuild",
): Promise<string> {
  validateDisposableTarget(targetDatabase, kind);
  if (databaseName(adminDatabaseUrl) !== "postgres") {
    throw new RecoveryError("UNSAFE_ADMIN_DATABASE", "RECOVERY_ADMIN_DATABASE_URL must point to the postgres maintenance database");
  }
  const admin = createPool(adminDatabaseUrl);
  try {
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [targetDatabase]);
    if (exists.rowCount) throw new RecoveryError("TARGET_DATABASE_EXISTS", "target database already exists");
  } finally {
    await admin.end();
  }
  await runPostgresTool("createdb", ["--no-password", "--template=template0", "--encoding=UTF8", targetDatabase], adminDatabaseUrl);
  return connectionUrlForDatabase(adminDatabaseUrl, targetDatabase);
}

export async function dropDisposableDatabase(
  adminDatabaseUrl: string,
  targetDatabase: string,
  kind: "restore" | "rebuild",
): Promise<void> {
  validateDisposableTarget(targetDatabase, kind);
  await runPostgresTool("dropdb", ["--no-password", "--if-exists", targetDatabase], adminDatabaseUrl);
}

export interface DatabaseIntegrity {
  schemaMigrations: string[];
  tableCounts: Record<string, string>;
  activeResolutionRunId: string;
  activeVersion: number;
  publicationVersion: number;
  auditAppendOnlyTrigger: boolean;
  correctionEventsAppendOnlyTrigger: boolean;
  unvalidatedConstraintCount: number;
}

export async function inspectDatabaseIntegrity(pool: Pool | PoolClient): Promise<DatabaseIntegrity> {
  const schema = await pool.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name");
  const tableCounts: Record<string, string> = {};
  for (const table of BACKUP_TABLES) {
    const result = await pool.query<{ count: string }>(`SELECT count(*) AS count FROM ${table}`);
    tableCounts[table] = result.rows[0]!.count;
  }
  const active = await pool.query<{
    resolution_run_id: string; version: string; publication_version: string;
    pointer_count: string; active_run_count: string;
  }>(
    `SELECT ar.resolution_run_id, ar.version, ar.publication_version,
      (SELECT count(*) FROM active_resolution) AS pointer_count,
      (SELECT count(*) FROM resolution_runs WHERE status = 'active') AS active_run_count
     FROM active_resolution ar JOIN resolution_runs rr
       ON rr.id = ar.resolution_run_id AND rr.status = 'active'
     WHERE ar.singleton_id = 1`,
  );
  if (!active.rows[0] || active.rows[0].pointer_count !== "1" || active.rows[0].active_run_count !== "1") {
    throw new RecoveryError("ACTIVE_POINTER_INVALID", "database must contain exactly one consistent active resolution pointer");
  }
  const trigger = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relname = 'audit_events' AND t.tgname = 'audit_events_append_only'
        AND t.tgenabled <> 'D' AND NOT t.tgisinternal
    ) AS exists`,
  );
  const correctionTrigger = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relname = 'correction_events' AND t.tgname = 'correction_events_append_only'
        AND t.tgenabled <> 'D' AND NOT t.tgisinternal
    ) AS exists`,
  );
  const constraints = await pool.query<{ count: string }>(
    "SELECT count(*) AS count FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND NOT convalidated",
  );
  return {
    schemaMigrations: schema.rows.map((row) => row.name),
    tableCounts,
    activeResolutionRunId: active.rows[0].resolution_run_id,
    activeVersion: Number(active.rows[0].version),
    publicationVersion: Number(active.rows[0].publication_version),
    auditAppendOnlyTrigger: Boolean(trigger.rows[0]?.exists),
    correctionEventsAppendOnlyTrigger: Boolean(correctionTrigger.rows[0]?.exists),
    unvalidatedConstraintCount: Number(constraints.rows[0]!.count),
  };
}

export function assertDatabaseIntegrity(integrity: DatabaseIntegrity): void {
  if (!integrity.schemaMigrations.length) throw new RecoveryError("MIGRATIONS_MISSING", "restored database has no migration history");
  if (!integrity.auditAppendOnlyTrigger) throw new RecoveryError("AUDIT_TRIGGER_MISSING", "audit append-only trigger is missing or disabled");
  if (integrity.schemaMigrations.includes("0010_correction_intake.sql")
    && !integrity.correctionEventsAppendOnlyTrigger) {
    throw new RecoveryError("CORRECTION_TRIGGER_MISSING", "correction event append-only trigger is missing or disabled");
  }
  if (integrity.unvalidatedConstraintCount !== 0) throw new RecoveryError("CONSTRAINTS_UNVALIDATED", "database contains unvalidated constraints");
}
