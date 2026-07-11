import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, open, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createPool } from "@/db/pool";
import { APP_VERSION } from "@/lib/version";
import {
  assertDatabaseIntegrity, databaseName, inspectDatabaseIntegrity,
  RecoveryError, runPostgresTool, type DatabaseIntegrity,
} from "./database";

const runFile = promisify(execFile);

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return `sha256:${hash.digest("hex")}`;
}

async function safeOutputDirectory(directory: string): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const requested = path.resolve(directory);
  const requestedInfo = await lstat(requested);
  if (requestedInfo.isSymbolicLink()) {
    throw new RecoveryError("UNSAFE_BACKUP_DIRECTORY", "backup output directory cannot be a symlink");
  }
  const absolute = await realpath(requested);
  const info = await lstat(absolute);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    throw new RecoveryError("UNSAFE_BACKUP_DIRECTORY", "backup output directory must be a non-symlink directory with mode 0700");
  }
  return absolute;
}

async function gitCommitSha(): Promise<string> {
  if (process.env.GIT_COMMIT_SHA && /^[0-9a-f]{7,64}$/.test(process.env.GIT_COMMIT_SHA)) return process.env.GIT_COMMIT_SHA;
  try {
    const result = await runFile("git", ["rev-parse", "HEAD"], { encoding: "utf8", timeout: 5_000 });
    return result.stdout.trim();
  } catch {
    return "unknown";
  }
}

export interface BackupManifest {
  schemaVersion: "macvendor-backup/v1";
  createdAt: string;
  sourceDatabase: string;
  applicationVersion: string;
  gitCommitSha: string;
  pgDumpVersion: string;
  durationMs: number;
  dump: { file: string; format: "postgres-custom"; byteSize: number; sha256: string };
  integrity: DatabaseIntegrity;
}

export interface CreateBackupResult {
  status: "created";
  manifestPath: string;
  dumpPath: string;
  byteSize: number;
  sha256: string;
  durationMs: number;
}

export async function createLogicalBackup(
  sourceDatabaseUrl: string,
  outputDirectory: string,
): Promise<CreateBackupResult> {
  const started = Date.now();
  const directory = await safeOutputDirectory(outputDirectory);
  const sourceName = databaseName(sourceDatabaseUrl);
  const version = (await runPostgresTool("pg_dump", ["--version"], sourceDatabaseUrl)).stdout.trim();
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const suffix = randomUUID().slice(0, 8);
  const baseName = `macvendor-${sourceName}-${timestamp}-${suffix}`;
  const finalDump = path.join(directory, `${baseName}.dump`);
  const finalManifest = path.join(directory, `${baseName}.json`);
  const temporaryDump = `${finalDump}.tmp`;
  const temporaryManifest = `${finalManifest}.tmp`;
  const dumpFile = await open(temporaryDump, "wx", 0o600);
  await dumpFile.close();
  const pool = createPool(sourceDatabaseUrl);
  const client = await pool.connect();
  let integrity: DatabaseIntegrity;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshot = await client.query<{ snapshot: string }>("SELECT pg_export_snapshot() AS snapshot");
    integrity = await inspectDatabaseIntegrity(client);
    assertDatabaseIntegrity(integrity);
    await runPostgresTool("pg_dump", [
      "--no-password", "--format=custom", "--compress=6", "--no-owner", "--no-acl",
      `--snapshot=${snapshot.rows[0]!.snapshot}`, `--file=${temporaryDump}`,
    ], sourceDatabaseUrl);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    await rm(temporaryDump, { force: true });
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
  try {
    await chmod(temporaryDump, 0o600);
    const dumpInfo = await stat(temporaryDump);
    if (!dumpInfo.isFile() || dumpInfo.size < 1) {
      throw new RecoveryError("EMPTY_BACKUP", "pg_dump produced an empty or non-regular backup");
    }
    const digest = await sha256File(temporaryDump);
    const manifest: BackupManifest = {
      schemaVersion: "macvendor-backup/v1",
      createdAt: new Date().toISOString(),
      sourceDatabase: sourceName,
      applicationVersion: APP_VERSION,
      gitCommitSha: await gitCommitSha(),
      pgDumpVersion: version,
      durationMs: Date.now() - started,
      dump: { file: path.basename(finalDump), format: "postgres-custom", byteSize: dumpInfo.size, sha256: digest },
      integrity,
    };
    const manifestFile = await open(temporaryManifest, "wx", 0o600);
    try {
      await manifestFile.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await manifestFile.sync();
    } finally {
      await manifestFile.close();
    }
    await rename(temporaryDump, finalDump);
    await rename(temporaryManifest, finalManifest);
    return {
      status: "created", manifestPath: finalManifest, dumpPath: finalDump,
      byteSize: dumpInfo.size, sha256: digest, durationMs: manifest.durationMs,
    };
  } catch (error) {
    await rm(temporaryDump, { force: true });
    await rm(temporaryManifest, { force: true });
    await rm(finalDump, { force: true });
    throw error;
  }
}
