import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptCorrectionContact, encryptCorrectionContact } from "../../src/operations/corrections";

afterEach(() => vi.unstubAllEnvs());

describe("correction contact encryption", () => {
  it("round-trips with AES-256-GCM without storing plaintext", () => {
    vi.stubEnv("CORRECTION_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    const encrypted = encryptCorrectionContact("reporter@example.org");
    expect(encrypted).toMatchObject({v:2,keyId:"primary",algorithm:"A256GCM"});
    expect(JSON.stringify(encrypted)).not.toContain("reporter@example.org");
    expect(decryptCorrectionContact(encrypted)).toBe("reporter@example.org");
  });

  it("decrypts a prior key after rotation",()=>{
    const oldKey=Buffer.alloc(32,3).toString("base64"),newKey=Buffer.alloc(32,9).toString("base64");
    vi.stubEnv("CORRECTION_ENCRYPTION_KEY",oldKey);vi.stubEnv("CORRECTION_ENCRYPTION_KEY_ID","old-2026");
    const encrypted=encryptCorrectionContact("reporter@example.org");
    vi.stubEnv("CORRECTION_ENCRYPTION_KEY",newKey);vi.stubEnv("CORRECTION_ENCRYPTION_KEY_ID","current-2027");
    vi.stubEnv("CORRECTION_DECRYPTION_KEYS",JSON.stringify({"old-2026":oldKey}));
    expect(decryptCorrectionContact(encrypted)).toBe("reporter@example.org");
  });

  it("rejects an invalid key", () => {
    vi.stubEnv("CORRECTION_ENCRYPTION_KEY", "short");
    expect(() => encryptCorrectionContact("reporter@example.org")).toThrow("32-byte key");
  });
});
