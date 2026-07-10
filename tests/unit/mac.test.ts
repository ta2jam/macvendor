import { describe, expect, it } from "vitest";
import {
  InvalidMacError,
  InvalidPrefixError,
  formatPrefix,
  normalizeMac,
  normalizeRegistry,
  parseAssignmentPrefix,
  prefixBits,
} from "../../src/domain/mac";

describe("normalizeMac", () => {
  it.each([
    "02AABBCC0001",
    "02:AA:BB:CC:00:01",
    "02-AA-BB-CC-00-01",
    "02AA.BBCC.0001",
  ])("normalizes %s without changing address bits", (input) => {
    const mac = normalizeMac(input);
    expect(mac.normalized).toBe("02AABBCC0001");
    expect(mac.value).toBe(0x02aabbcc0001n);
  });

  it.each([
    "02:AA-BB:CC:00:01",
    " 02:AA:BB:CC:00:01",
    "02:AA:BB:CC:00",
    "02AABBCC0001/24",
    "GG:AA:BB:CC:00:01",
    "",
  ])("rejects malformed input %s", (input) => {
    expect(() => normalizeMac(input)).toThrow(InvalidMacError);
  });

  it("reports U/L and I/G flags but preserves the bits", () => {
    const local = normalizeMac("02:00:00:00:00:00");
    const multicast = normalizeMac("01:00:00:00:00:00");
    expect(local.flags).toEqual({ locallyAdministered: true, multicast: false });
    expect(multicast.flags).toEqual({ locallyAdministered: false, multicast: true });
    expect(local.normalized.startsWith("02")).toBe(true);
  });
});

describe("prefix representation", () => {
  it("extracts right-aligned prefix bits", () => {
    expect(prefixBits(0x02aabbcc0001n, 24)).toBe(0x02aabbn);
    expect(prefixBits(0x02aabbcc0001n, 28)).toBe(0x02aabbcn);
    expect(prefixBits(0x02aabbcc0001n, 36)).toBe(0x02aabbcc0n);
  });

  it("formats non-nibble prefixes with low display bits zero", () => {
    expect(formatPrefix(1n, 1)).toBe("8");
    expect(formatPrefix(0b101n, 3)).toBe("A");
    expect(formatPrefix(0x02aabbcn, 28)).toBe("02AABBC");
  });

  it("rejects invalid prefix lengths", () => {
    expect(() => prefixBits(1n, 0)).toThrow(InvalidPrefixError);
    expect(() => formatPrefix(1n, 49)).toThrow(InvalidPrefixError);
  });
});

describe("assignment path parsing", () => {
  it("binds registry to its required prefix length", () => {
    expect(normalizeRegistry("MA-M")).toEqual({ path: "ma-m", registry: "MA-M", prefixLength: 28 });
    expect(parseAssignmentPrefix("02AABBC-28", 28)).toEqual({ bits: 0x02aabbcn, canonical: "02AABBC-28" });
  });

  it("rejects a registry and length mismatch", () => {
    expect(() => parseAssignmentPrefix("02AABB-24", 28)).toThrow(InvalidPrefixError);
  });
});
