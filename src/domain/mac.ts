export const REGISTRY_LENGTHS = {
  "ma-l": 24,
  "ma-m": 28,
  "ma-s": 36,
  iab: 36,
  cid: 24,
} as const;

export type RegistryPath = keyof typeof REGISTRY_LENGTHS;
export type Registry = "MA-L" | "MA-M" | "MA-S" | "IAB" | "CID";

const MAC_PATTERNS = [
  /^[0-9a-fA-F]{12}$/,
  /^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/,
  /^(?:[0-9a-fA-F]{2}-){5}[0-9a-fA-F]{2}$/,
  /^(?:[0-9a-fA-F]{4}\.){2}[0-9a-fA-F]{4}$/,
];

export class InvalidMacError extends Error {
  constructor() {
    super("The value is not a supported 48-bit MAC address format.");
    this.name = "InvalidMacError";
  }
}

export class InvalidPrefixError extends Error {
  constructor(message = "The prefix or prefix length is invalid.") {
    super(message);
    this.name = "InvalidPrefixError";
  }
}

export interface NormalizedMac {
  input: string;
  normalized: string;
  value: bigint;
  flags: {
    locallyAdministered: boolean;
    multicast: boolean;
  };
}

export function normalizeMac(input: string): NormalizedMac {
  if (input.length > 32 || !MAC_PATTERNS.some((pattern) => pattern.test(input))) {
    throw new InvalidMacError();
  }

  const normalized = input.replaceAll(":", "").replaceAll("-", "").replaceAll(".", "").toUpperCase();
  const firstOctet = Number.parseInt(normalized.slice(0, 2), 16);

  return {
    input,
    normalized,
    value: BigInt(`0x${normalized}`),
    flags: {
      locallyAdministered: (firstOctet & 0b10) !== 0,
      multicast: (firstOctet & 0b1) !== 0,
    },
  };
}

export function prefixBits(mac: bigint, prefixLength: number): bigint {
  if (!Number.isInteger(prefixLength) || prefixLength < 1 || prefixLength > 48) {
    throw new InvalidPrefixError();
  }
  return mac >> BigInt(48 - prefixLength);
}

export function formatPrefix(bits: bigint, prefixLength: number): string {
  if (!Number.isInteger(prefixLength) || prefixLength < 1 || prefixLength > 48 || bits < 0n) {
    throw new InvalidPrefixError();
  }

  const width = Math.ceil(prefixLength / 4);
  const unusedLowBits = width * 4 - prefixLength;
  const displayValue = bits << BigInt(unusedLowBits);
  return displayValue.toString(16).toUpperCase().padStart(width, "0");
}

export function normalizeRegistry(input: string): { path: RegistryPath; registry: Registry; prefixLength: number } {
  const path = input.toLowerCase() as RegistryPath;
  const prefixLength = REGISTRY_LENGTHS[path];
  if (!prefixLength) {
    throw new InvalidPrefixError("The registry is not supported.");
  }

  return { path, registry: path.toUpperCase() as Registry, prefixLength };
}

export function parseAssignmentPrefix(input: string, expectedLength: number): { bits: bigint; canonical: string } {
  const match = /^([0-9a-fA-F]+)-(\d{1,2})$/.exec(input);
  if (!match) throw new InvalidPrefixError();

  const [, hex, lengthText] = match;
  const prefixLength = Number(lengthText);
  if (prefixLength !== expectedLength || hex.length !== Math.ceil(prefixLength / 4)) {
    throw new InvalidPrefixError("The prefix length does not match the registry.");
  }

  const unusedLowBits = hex.length * 4 - prefixLength;
  const displayValue = BigInt(`0x${hex}`);
  if (unusedLowBits > 0 && (displayValue & ((1n << BigInt(unusedLowBits)) - 1n)) !== 0n) {
    throw new InvalidPrefixError("Unused low bits in the final hexadecimal digit must be zero.");
  }

  const bits = displayValue >> BigInt(unusedLowBits);
  return { bits, canonical: `${formatPrefix(bits, prefixLength)}-${prefixLength}` };
}
