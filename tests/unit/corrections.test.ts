import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptCorrectionContact, encryptCorrectionContact } from "../../src/operations/corrections";

afterEach(() => vi.unstubAllEnvs());

describe("correction contact encryption", () => {
  it("round-trips with AES-256-GCM without storing plaintext", () => {
    vi.stubEnv("CORRECTION_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    const encrypted = encryptCorrectionContact("reporter@example.org");
    expect(JSON.stringify(encrypted)).not.toContain("reporter@example.org");
    expect(decryptCorrectionContact(encrypted)).toBe("reporter@example.org");
  });

  it("rejects an invalid key", () => {
    vi.stubEnv("CORRECTION_ENCRYPTION_KEY", "short");
    expect(() => encryptCorrectionContact("reporter@example.org")).toThrow("32-byte key");
  });
});
