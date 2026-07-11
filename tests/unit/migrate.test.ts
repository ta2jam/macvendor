import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMigrationSet } from "../../src/db/migrate";

const directories: string[] = [];

function checksum(sql: string): string {
  return `sha256:${createHash("sha256").update(sql).digest("hex")}`;
}

async function fixture(sql = "SELECT 1;\n"): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "macvendor-migrations-"));
  directories.push(directory);
  await writeFile(path.join(directory, "0001_initial.sql"), sql);
  await writeFile(path.join(directory, "checksums.json"), JSON.stringify({
    schemaVersion: "macvendor-migrations/v1",
    files: { "0001_initial.sql": checksum(sql) },
  }));
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("migration checksum ledger", () => {
  it("loads an exact UTF-8 SQL set", async () => {
    await expect(loadMigrationSet(await fixture())).resolves.toMatchObject([{
      name: "0001_initial.sql", sql: "SELECT 1;\n",
    }]);
  });

  it("rejects SQL tampering without database access", async () => {
    const directory = await fixture();
    await writeFile(path.join(directory, "0001_initial.sql"), "SELECT 2;\n");
    await expect(loadMigrationSet(directory)).rejects.toMatchObject({ code: "MIGRATION_LEDGER_MISMATCH" });
  });

  it("rejects incomplete and malformed ledgers", async () => {
    const incomplete = await fixture();
    await writeFile(path.join(incomplete, "0002_extra.sql"), "SELECT 2;\n");
    await expect(loadMigrationSet(incomplete)).rejects.toMatchObject({ code: "INVALID_MIGRATION_LEDGER" });

    const malformed = await fixture();
    await writeFile(path.join(malformed, "checksums.json"), "not-json");
    await expect(loadMigrationSet(malformed)).rejects.toMatchObject({ code: "INVALID_MIGRATION_LEDGER" });
  });

  it("rejects non-contiguous migration numbering", async () => {
    const directory = await fixture();
    const sql = "SELECT 2;\n";
    await writeFile(path.join(directory, "0003_gap.sql"), sql);
    const ledger = {
      schemaVersion: "macvendor-migrations/v1",
      files: { "0001_initial.sql": checksum("SELECT 1;\n"), "0003_gap.sql": checksum(sql) },
    };
    await writeFile(path.join(directory, "checksums.json"), JSON.stringify(ledger));
    await expect(loadMigrationSet(directory)).rejects.toMatchObject({ code: "INVALID_MIGRATION_SET" });
  });
});
