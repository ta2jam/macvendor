import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { createPool } from "@/db/pool";
import { getDataRelease } from "@/db/lookup";
import {
  assertDatabaseIntegrity, BACKUP_TABLES, createDisposableDatabase, databaseName,
  dropDisposableDatabase, inspectDatabaseIntegrity, RecoveryError, runPostgresTool,
  validateDisposableTarget, LEGACY_BACKUP_TABLES, type DatabaseIntegrity,
} from "./database";
import type { BackupManifest } from "./backup";

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RecoveryError("INVALID_BACKUP_MANIFEST", `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== [...expected].sort()[index])) {
    throw new RecoveryError("INVALID_BACKUP_MANIFEST", `${label} fields do not match the declared backup schema`);
  }
}

function text(value: unknown, label: string, pattern?: RegExp): string {
  if (typeof value !== "string" || !value || Buffer.byteLength(value, "utf8") > 1024 || (pattern && !pattern.test(value))) {
    throw new RecoveryError("INVALID_BACKUP_MANIFEST", `${label} is invalid`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new RecoveryError("INVALID_BACKUP_MANIFEST", `${label} must be an integer >= ${minimum}`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  const candidate = text(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
  if (Number.isNaN(Date.parse(candidate))) throw new RecoveryError("INVALID_BACKUP_MANIFEST", `${label} is invalid`);
  return candidate;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return `sha256:${hash.digest("hex")}`;
}

export async function loadBackupManifest(manifestPath: string): Promise<{ manifest: BackupManifest; dumpPath: string }> {
  const absoluteManifest = path.resolve(manifestPath);
  const manifestInfo = await lstat(absoluteManifest).catch(() => null);
  if (!manifestInfo || !manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > 1024 * 1024) {
    throw new RecoveryError("UNSAFE_BACKUP_MANIFEST", "backup manifest must be a regular non-symlink file up to 1 MiB");
  }
  let raw: unknown;
  try { raw = JSON.parse(await readFile(absoluteManifest, "utf8")); }
  catch { throw new RecoveryError("INVALID_BACKUP_MANIFEST", "backup manifest must be valid JSON"); }
  const root = object(raw, "manifest");
  exactKeys(root, ["schemaVersion", "createdAt", "sourceDatabase", "applicationVersion", "gitCommitSha", "pgDumpVersion", "durationMs", "dump", "integrity"], "manifest");
  if (root.schemaVersion !== "macvendor-backup/v1" && root.schemaVersion !== "macvendor-backup/v2") {
    throw new RecoveryError("INVALID_BACKUP_MANIFEST", "unsupported backup manifest version");
  }
  const schemaVersion = root.schemaVersion;
  const dump = object(root.dump, "dump");
  exactKeys(dump, ["file", "format", "byteSize", "sha256"], "dump");
  if (dump.format !== "postgres-custom") throw new RecoveryError("INVALID_BACKUP_MANIFEST", "dump format must be postgres-custom");
  const dumpFile = text(dump.file, "dump.file", /^[A-Za-z0-9_.-]+\.dump$/);
  if (path.basename(dumpFile) !== dumpFile) throw new RecoveryError("UNSAFE_BACKUP_PATH", "dump.file must be a basename");
  const integrityRaw = object(root.integrity, "integrity");
  const integrityFields = ["schemaMigrations", "tableCounts", "activeResolutionRunId", "activeVersion",
    "publicationVersion", "auditAppendOnlyTrigger", "unvalidatedConstraintCount"];
  if (schemaVersion === "macvendor-backup/v2") integrityFields.push("correctionEventsAppendOnlyTrigger");
  exactKeys(integrityRaw, integrityFields, "integrity");
  if (!Array.isArray(integrityRaw.schemaMigrations) || !integrityRaw.schemaMigrations.length
    || integrityRaw.schemaMigrations.some((item) => typeof item !== "string" || !/^\d{4}_[a-z0-9_]+\.sql$/.test(item))) {
    throw new RecoveryError("INVALID_BACKUP_MANIFEST", "integrity.schemaMigrations is invalid");
  }
  const countsRaw = object(integrityRaw.tableCounts, "integrity.tableCounts");
  const trackedTables = schemaVersion === "macvendor-backup/v2" ? BACKUP_TABLES : LEGACY_BACKUP_TABLES;
  exactKeys(countsRaw, [...trackedTables], "integrity.tableCounts");
  const tableCounts: Record<string, string> = {};
  for (const table of trackedTables) tableCounts[table] = text(countsRaw[table], `tableCounts.${table}`, /^\d+$/);
  const manifest: BackupManifest = {
    schemaVersion,
    createdAt: timestamp(root.createdAt, "createdAt"),
    sourceDatabase: text(root.sourceDatabase, "sourceDatabase", /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,62}$/),
    applicationVersion: text(root.applicationVersion, "applicationVersion"),
    gitCommitSha: text(root.gitCommitSha, "gitCommitSha", /^(?:[0-9a-f]{7,64}|unknown)$/),
    pgDumpVersion: text(root.pgDumpVersion, "pgDumpVersion"),
    durationMs: integer(root.durationMs, "durationMs"),
    dump: {
      file: dumpFile,
      format: "postgres-custom",
      byteSize: integer(dump.byteSize, "dump.byteSize", 1),
      sha256: text(dump.sha256, "dump.sha256", /^sha256:[0-9a-f]{64}$/),
    },
    integrity: {
      schemaMigrations: [...integrityRaw.schemaMigrations] as string[],
      tableCounts,
      activeResolutionRunId: text(integrityRaw.activeResolutionRunId, "activeResolutionRunId", /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      activeVersion: integer(integrityRaw.activeVersion, "activeVersion", 1),
      publicationVersion: integer(integrityRaw.publicationVersion, "publicationVersion", 1),
      auditAppendOnlyTrigger: integrityRaw.auditAppendOnlyTrigger === true,
      correctionEventsAppendOnlyTrigger: schemaVersion === "macvendor-backup/v2"
        && integrityRaw.correctionEventsAppendOnlyTrigger === true,
      unvalidatedConstraintCount: integer(integrityRaw.unvalidatedConstraintCount, "unvalidatedConstraintCount"),
    },
  };
  if (!manifest.integrity.auditAppendOnlyTrigger || manifest.integrity.unvalidatedConstraintCount !== 0
    || (schemaVersion === "macvendor-backup/v2" && !manifest.integrity.correctionEventsAppendOnlyTrigger)) {
    throw new RecoveryError("INVALID_BACKUP_INTEGRITY", "backup manifest does not describe an integrity-valid source database");
  }
  const manifestDirectory = await realpath(path.dirname(absoluteManifest));
  const dumpPath = path.join(manifestDirectory, dumpFile);
  const dumpInfo = await lstat(dumpPath).catch(() => null);
  if (!dumpInfo || !dumpInfo.isFile() || dumpInfo.isSymbolicLink() || dumpInfo.size !== manifest.dump.byteSize) {
    throw new RecoveryError("BACKUP_SIZE_MISMATCH", "backup dump is missing, unsafe, or has the wrong byte size");
  }
  if (await sha256File(dumpPath) !== manifest.dump.sha256) {
    throw new RecoveryError("BACKUP_HASH_MISMATCH", "backup dump SHA-256 does not match the manifest");
  }
  return { manifest, dumpPath };
}

function compareIntegrity(expected: DatabaseIntegrity, actual: DatabaseIntegrity): void {
  if (JSON.stringify(actual.schemaMigrations) !== JSON.stringify(expected.schemaMigrations)) {
    throw new RecoveryError("RESTORE_MIGRATION_MISMATCH", "restored migration history differs from the backup snapshot");
  }
  for (const table of Object.keys(expected.tableCounts)) {
    if (actual.tableCounts[table] !== expected.tableCounts[table]) {
      throw new RecoveryError("RESTORE_COUNT_MISMATCH", `restored ${table} count differs from the backup snapshot`);
    }
  }
  if (expected.correctionEventsAppendOnlyTrigger && !actual.correctionEventsAppendOnlyTrigger) {
    throw new RecoveryError("RESTORE_TRIGGER_MISMATCH", "restored correction event trigger differs from the backup snapshot");
  }
  if (actual.activeResolutionRunId !== expected.activeResolutionRunId
    || actual.activeVersion !== expected.activeVersion
    || actual.publicationVersion !== expected.publicationVersion) {
    throw new RecoveryError("RESTORE_POINTER_MISMATCH", "restored active pointer differs from the backup snapshot");
  }
}

export async function restoreLogicalBackup(options: {
  adminDatabaseUrl: string;
  manifestPath: string;
  targetDatabase: string;
  dropAfterCheck?: boolean;
}) {
  const started = Date.now();
  validateDisposableTarget(options.targetDatabase, "restore");
  const { manifest, dumpPath } = await loadBackupManifest(options.manifestPath);
  if (manifest.sourceDatabase === options.targetDatabase || databaseName(options.adminDatabaseUrl) === options.targetDatabase) {
    throw new RecoveryError("UNSAFE_TARGET_DATABASE", "restore target must differ from source and maintenance databases");
  }
  await runPostgresTool("pg_restore", ["--list", dumpPath], options.adminDatabaseUrl);
  let created = false;
  let targetUrl = "";
  try {
    targetUrl = await createDisposableDatabase(options.adminDatabaseUrl, options.targetDatabase, "restore");
    created = true;
    await runPostgresTool("pg_restore", [
      "--no-password", "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl",
      `--dbname=${options.targetDatabase}`, dumpPath,
    ], options.adminDatabaseUrl, options.targetDatabase);
    const pool = createPool(targetUrl);
    let actual: DatabaseIntegrity;
    try {
      actual = await inspectDatabaseIntegrity(pool);
      assertDatabaseIntegrity(actual);
      compareIntegrity(manifest.integrity, actual);
      await getDataRelease(pool);
    } finally {
      await pool.end();
    }
    return {
      status: "verified" as const,
      targetDatabase: options.targetDatabase,
      dropped: Boolean(options.dropAfterCheck),
      durationMs: Date.now() - started,
      integrity: actual,
    };
  } finally {
    if (created && options.dropAfterCheck) {
      await dropDisposableDatabase(options.adminDatabaseUrl, options.targetDatabase, "restore");
    }
  }
}
