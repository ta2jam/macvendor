import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { parse } from "dotenv";
import { correctionDatabaseIntakeReady, dataCorrectionsEmail } from "../../src/lib/public-config";

describe("dataCorrectionsEmail", () => {
  it.each([undefined, "", "   "])("keeps intake disabled for %s", (value) => {
    expect(dataCorrectionsEmail(value)).toBeNull();
  });

  it("returns a trimmed valid public address", () => {
    expect(dataCorrectionsEmail(" corrections+data@example.org ")).toBe("corrections+data@example.org");
  });

  it.each([
    "corrections@example",
    "corrections @example.org",
    ".corrections@example.org",
    "corrections..data@example.org",
    "corrections@example..org",
    "corrections@example.org\r\nBcc: attacker@example.org",
  ])("fails closed for invalid configuration: %s", (value) => {
    expect(() => dataCorrectionsEmail(value)).toThrow("DATA_CORRECTIONS_EMAIL");
  });
});

describe("correctionDatabaseIntakeReady", () => {
  it("requires a 32-byte key and a valid key identifier", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    expect(correctionDatabaseIntakeReady(key, "primary-2026")).toBe(true);
    expect(correctionDatabaseIntakeReady("short", "primary-2026")).toBe(false);
    expect(correctionDatabaseIntakeReady(key, "invalid key id")).toBe(false);
  });
});

describe("local environment example", () => {
  it("does not enable the shared limiter without a configured salt", async () => {
    const example = parse(await readFile(".env.example"));
    expect(example.RATE_LIMIT_ENABLED).toBe("false");
    expect(example.RATE_LIMIT_SALT).toBe("");
  });
});
