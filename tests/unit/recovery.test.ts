import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BACKUP_TABLES, connectionUrlForDatabase, databaseName, postgresEnvironment, validateDisposableTarget,
} from "../../src/recovery/database";
import { loadBackupManifest } from "../../src/recovery/restore";

describe("recovery database guards", () => {
  it("accepts only explicit disposable restore and rebuild names", () => {
    expect(() => validateDisposableTarget("macvendor_test_restore_a1b2", "restore")).not.toThrow();
    expect(() => validateDisposableTarget("macvendor_test_rebuild_a1b2", "rebuild")).not.toThrow();
    expect(() => validateDisposableTarget("macvendor", "restore")).toThrow(/target database must match/);
    expect(() => validateDisposableTarget("postgres_restore_a1b2", "rebuild")).toThrow(/target database must match/);
    expect(() => validateDisposableTarget("macvendor_restore_x", "restore")).toThrow(/target database must match/);
  });

  it("derives PostgreSQL tool settings from the connection URL", () => {
    const url = "postgresql://operator:s3cret@db.example.test:5433/macvendor?sslmode=require";
    const environment = postgresEnvironment(url, "macvendor_restore_a1b2");
    expect(databaseName(url)).toBe("macvendor");
    expect(environment).toMatchObject({
      PGHOST: "db.example.test", PGPORT: "5433", PGUSER: "operator",
      PGPASSWORD: "s3cret", PGDATABASE: "macvendor_restore_a1b2", PGSSLMODE: "require",
    });
    expect(connectionUrlForDatabase(url, "macvendor_restore_a1b2")).not.toContain("/macvendor?");
  });

  it("rejects non-PostgreSQL URLs and unsafe database names", () => {
    expect(() => databaseName("https://db.example.test/macvendor")).toThrow(/postgres/);
    expect(() => databaseName("postgresql://db.example.test/bad%2Fname")).toThrow(/safe database name/);
  });

  it("rejects a dump whose bytes do not match the backup manifest", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "macvendor-recovery-unit-"));
    try {
      const dump = Buffer.from("synthetic-not-a-real-dump");
      await writeFile(path.join(directory, "backup.dump"), dump, { mode: 0o600 });
      await writeFile(path.join(directory, "backup.json"), JSON.stringify({
        schemaVersion: "macvendor-backup/v1",
        createdAt: "2026-07-11T00:00:00.000Z",
        sourceDatabase: "macvendor_test",
        applicationVersion: "0.0.7",
        gitCommitSha: "abcdef0",
        pgDumpVersion: "pg_dump synthetic",
        durationMs: 1,
        dump: { file: "backup.dump", format: "postgres-custom", byteSize: dump.byteLength, sha256: `sha256:${"0".repeat(64)}` },
        integrity: {
          schemaMigrations: ["0001_initial.sql"],
          tableCounts: Object.fromEntries(BACKUP_TABLES.map((table) => [table, "0"])),
          activeResolutionRunId: "00000000-0000-4000-8000-000000000000",
          activeVersion: 1,
          publicationVersion: 1,
          auditAppendOnlyTrigger: true,
          unvalidatedConstraintCount: 0,
        },
      }));
      await expect(loadBackupManifest(path.join(directory, "backup.json")))
        .rejects.toMatchObject({ code: "BACKUP_HASH_MISMATCH" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
