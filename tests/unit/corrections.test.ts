import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Pool } from "pg";
import {
  createCorrectionRequest,
  decryptCorrectionContact,
  encryptCorrectionContact,
} from "../../src/operations/corrections";
import { POST } from "../../src/app/v1/corrections/route";

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

describe("correction intake HTTP boundary", () => {
  it("rejects fields excluded by the public correction schema", async () => {
    await expect(createCorrectionRequest({} as Pool, {
      category: "privacy",
      target: "example",
      requestedChange: "Remove the incorrect public record.",
      evidenceUrl: "https://example.org/evidence",
      contactEmail: "reporter@example.org",
      internalStatus: "accepted",
    })).rejects.toThrow("unsupported field");
  });

  it("rejects a chunked body that exceeds the 16 KiB limit", async () => {
    const request = new NextRequest("http://localhost/v1/corrections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(17 * 1024) }),
    });

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("accepts case-insensitive JSON media types before validating the payload", async () => {
    const request = new NextRequest("http://localhost/v1/corrections", {
      method: "POST",
      headers: { "content-type": "Application/JSON; Charset=UTF-8" },
      body: "{",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_CORRECTION_REQUEST" });
  });
});
