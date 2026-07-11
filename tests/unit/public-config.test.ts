import { describe, expect, it } from "vitest";
import { dataCorrectionsEmail } from "../../src/lib/public-config";

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
