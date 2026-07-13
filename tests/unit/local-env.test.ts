import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadLocalEnvironment } from "../../scripts/local-env";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("local environment loading", () => {
  it("loads browser-test settings from .env.local", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "macvendor-local-env-"));
    directories.push(directory);
    await writeFile(path.join(directory, ".env.local"), "DATABASE_URL=postgresql://localhost/macvendor_test\n");
    const environment: Record<string, string | undefined> = {};

    loadLocalEnvironment(environment, directory);

    expect(environment.DATABASE_URL).toBe("postgresql://localhost/macvendor_test");
  });

  it("does not override an explicitly injected environment value", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "macvendor-local-env-"));
    directories.push(directory);
    await writeFile(path.join(directory, ".env.local"), "DATABASE_URL=postgresql://localhost/from-file\n");
    const environment: Record<string, string | undefined> = {
      DATABASE_URL: "postgresql://localhost/from-process",
    };

    loadLocalEnvironment(environment, directory);

    expect(environment.DATABASE_URL).toBe("postgresql://localhost/from-process");
  });
});
