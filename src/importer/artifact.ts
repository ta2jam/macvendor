import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { canonicalJson, sha256 } from "@/domain/canonical-json";
import { formatPrefix } from "@/domain/mac";
import { ImportValidationError } from "./errors";
import type { ParsedSourceRecord, RecordKind, Registry, SourceManifest } from "./types";
import { verifyArtifactSignature } from "./signature";

export const IMPORT_LIMITS = Object.freeze({
  artifactBytes: 20 * 1024 * 1024,
  lineBytes: 64 * 1024,
  fieldBytes: 16 * 1024,
  claimValueBytes: 32 * 1024,
  claimValueDepth: 20,
  claimValueNodes: 4_096,
  records: 250_000,
});
const FORBIDDEN_TEXT = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u;
const ALLOWED_FIELDS = new Set([
  "prefix", "prefixLength", "organizationName", "organizationAddress", "registry", "recordKind",
  "originType", "rightsBasis", "distributionScope", "verificationStatus", "evidenceReference",
  "privacyReviewReference", "reviewedBy", "observedAt", "private", "claimValue",
]);

type RawRecord = Record<string, unknown>;

function text(value: unknown, field: string, required = false): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ImportValidationError("MISSING_FIELD", `${field} is required`);
    return null;
  }
  if (typeof value !== "string") throw new ImportValidationError("INVALID_FIELD", `${field} must be string`);
  const normalized = value.trim().normalize("NFC");
  if (Buffer.byteLength(normalized, "utf8") > IMPORT_LIMITS.fieldBytes) throw new ImportValidationError("FIELD_TOO_LARGE", `${field} exceeds 16 KiB`);
  if (FORBIDDEN_TEXT.test(normalized)) throw new ImportValidationError("UNSAFE_TEXT", `${field} contains control or invisible formatting characters`);
  return normalized || null;
}

function enumValue<T extends string>(value: unknown, fallback: T, allowed: readonly T[], field: string): T {
  const candidate = value === undefined || value === "" ? fallback : value;
  if (typeof candidate !== "string" || !allowed.includes(candidate as T)) {
    throw new ImportValidationError("INVALID_FIELD", `${field} must be one of ${allowed.join(", ")}`);
  }
  return candidate as T;
}

function booleanValue(value: unknown, field: string): boolean {
  if (value === undefined || value === "" || value === false || value === "false") return false;
  if (value === true || value === "true") return true;
  throw new ImportValidationError("INVALID_FIELD", `${field} must be true or false`);
}

function prefixValue(rawHex: unknown, rawLength: unknown): { bits: bigint; length: number } {
  const hex = text(rawHex, "prefix", true)!;
  const length = typeof rawLength === "number" ? rawLength : Number(text(rawLength, "prefixLength", true));
  if (!Number.isInteger(length) || length < 1 || length > 48 || !/^[0-9A-Fa-f]+$/.test(hex)) {
    throw new ImportValidationError("INVALID_PREFIX", "prefix must be hexadecimal and prefixLength must be 1..48");
  }
  const width = Math.ceil(length / 4);
  if (hex.length !== width) throw new ImportValidationError("INVALID_PREFIX", `prefix must contain exactly ${width} hexadecimal characters`);
  const unused = width * 4 - length;
  const display = BigInt(`0x${hex}`);
  if (unused && (display & ((1n << BigInt(unused)) - 1n)) !== 0n) {
    throw new ImportValidationError("INVALID_PREFIX", "unused low bits in the final prefix digit must be zero");
  }
  const bits = display >> BigInt(unused);
  if (formatPrefix(bits, length) !== hex.toUpperCase()) throw new ImportValidationError("INVALID_PREFIX", "prefix is not canonical");
  return { bits, length };
}

function timestamp(value: unknown, field: string): string | null {
  const candidate = text(value, field);
  if (!candidate) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(candidate) || Number.isNaN(Date.parse(candidate))) {
    throw new ImportValidationError("INVALID_TIMESTAMP", `${field} must be RFC 3339 UTC`);
  }
  return candidate;
}

function claimValue(value: unknown, organizationName: string | null): Record<string, unknown> {
  if (value === undefined || value === "") return organizationName ? { label: organizationName } : {};
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { throw new ImportValidationError("INVALID_CLAIM_VALUE", "claimValue must be a JSON object"); }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ImportValidationError("INVALID_CLAIM_VALUE", "claimValue must be a JSON object");
  validateClaimValueStructure(parsed);
  const normalized = normalizeClaimJson(parsed) as Record<string, unknown>;
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > IMPORT_LIMITS.claimValueBytes) throw new ImportValidationError("CLAIM_VALUE_TOO_LARGE", "claimValue exceeds 32 KiB");
  return normalized;
}

function validateClaimText(value: string, field: string): void {
  if (Buffer.byteLength(value, "utf8") > IMPORT_LIMITS.fieldBytes) {
    throw new ImportValidationError("FIELD_TOO_LARGE", `${field} string exceeds 16 KiB`);
  }
  if (FORBIDDEN_TEXT.test(value)) {
    throw new ImportValidationError("UNSAFE_TEXT", `${field} contains control or invisible formatting characters`);
  }
}

function validateClaimValueStructure(root: object): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 1 }];
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > IMPORT_LIMITS.claimValueNodes) {
      throw new ImportValidationError("CLAIM_VALUE_TOO_COMPLEX", `claimValue exceeds ${IMPORT_LIMITS.claimValueNodes} JSON nodes`);
    }
    if (typeof current.value === "string") continue;
    if (!current.value || typeof current.value !== "object") continue;
    if (current.depth > IMPORT_LIMITS.claimValueDepth) {
      throw new ImportValidationError("CLAIM_VALUE_TOO_DEEP", `claimValue exceeds JSON nesting depth ${IMPORT_LIMITS.claimValueDepth}`);
    }
    if (Array.isArray(current.value)) {
      for (const item of current.value) stack.push({ value: item, depth: current.depth + 1 });
      continue;
    }
    for (const item of Object.values(current.value)) {
      stack.push({ value: item, depth: current.depth + 1 });
    }
  }
}

function normalizeClaimJson(value: unknown): unknown {
  if (typeof value === "string") {
    const normalized = value.normalize("NFC");
    validateClaimText(normalized, "claimValue");
    return normalized;
  }
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(normalizeClaimJson);
  const entries: Array<[string, unknown]> = [];
  const keys = new Set<string>();
  for (const [rawKey, item] of Object.entries(value)) {
    const key = rawKey.normalize("NFC");
    validateClaimText(key, "claimValue key");
    if (keys.has(key)) {
      throw new ImportValidationError("DUPLICATE_CLAIM_KEY", "claimValue contains keys that collide after Unicode normalization");
    }
    keys.add(key);
    entries.push([key, normalizeClaimJson(item)]);
  }
  return Object.fromEntries(entries);
}

function normalizeRecord(raw: RawRecord, row: number, manifest: SourceManifest): ParsedSourceRecord {
  const unknown = Object.keys(raw).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unknown.length) throw new ImportValidationError("UNKNOWN_RECORD_FIELD", `row ${row} contains unknown field ${unknown[0]}`);
  const prefix = prefixValue(raw.prefix, raw.prefixLength);
  const recordKind = enumValue<RecordKind>(raw.recordKind, manifest.defaults.recordKind,
    ["assignment", "curated_vendor_claim", "vendor_alias", "device_hint", "usage_note", "tombstone"], "recordKind");
  const registry = enumValue<Registry | "">(raw.registry, manifest.defaults.registry ?? "",
    ["", "MA-L", "MA-M", "MA-S", "IAB", "CID"], "registry") || null;
  const originType = enumValue(raw.originType, manifest.defaults.originType,
    ["owner_observation", "derived", "imported", "unknown"] as const, "originType");
  const rightsBasis = enumValue(raw.rightsBasis, manifest.defaults.rightsBasis,
    ["owner_created", "licensed", "permission_granted", "public_domain_claim", "unknown"] as const, "rightsBasis");
  const distributionScope = enumValue(raw.distributionScope, manifest.defaults.distributionScope,
    ["internal_only", "api_output", "raw_redistribution"] as const, "distributionScope");
  const verificationStatus = enumValue(raw.verificationStatus, manifest.defaults.verificationStatus,
    ["unverified", "single_observation", "corroborated", "reviewed"] as const, "verificationStatus");
  const isPrivate = booleanValue(raw.private, "private");
  const organizationName = text(raw.organizationName, "organizationName", !isPrivate && (recordKind === "assignment" || recordKind === "curated_vendor_claim"));
  const organizationAddress = text(raw.organizationAddress, "organizationAddress");
  const privacyReviewReference = text(raw.privacyReviewReference, "privacyReviewReference");
  const reviewedBy = text(raw.reviewedBy, "reviewedBy");
  const normalizedClaimValue = claimValue(raw.claimValue, organizationName);
  const evidenceReference = text(raw.evidenceReference, "evidenceReference");

  if (recordKind === "assignment") {
    if (manifest.source.class !== "authoritative") throw new ImportValidationError("ASSIGNMENT_SOURCE_CLASS", "only authoritative sources can import assignment records");
    if (!registry) throw new ImportValidationError("REGISTRY_REQUIRED", "assignment records require registry");
    const requiredLength = registry === "MA-M" ? 28 : registry === "MA-S" || registry === "IAB" ? 36 : 24;
    if (prefix.length !== requiredLength) throw new ImportValidationError("REGISTRY_PREFIX_MISMATCH", `${registry} requires /${requiredLength}`);
  } else if (registry) {
    throw new ImportValidationError("REGISTRY_NOT_ALLOWED", "non-assignment records cannot set registry");
  }
  if (manifest.source.class === "authoritative" && recordKind !== "assignment" && recordKind !== "tombstone") {
    throw new ImportValidationError("AUTHORITATIVE_RECORD_KIND", "authoritative sources can contain only assignments or tombstones");
  }
  if (manifest.source.class === "owner_curated" && recordKind === "assignment") {
    throw new ImportValidationError("CURATED_CANNOT_ASSIGN", "owner-curated sources cannot create authoritative assignments");
  }
  if (isPrivate && (organizationName || organizationAddress)) {
    throw new ImportValidationError("PRIVATE_DATA_EXPOSED", "private records cannot include public organization name or address");
  }
  if (manifest.source.publishMode === "production") {
    if (originType === "unknown" || rightsBasis === "unknown" || distributionScope !== "api_output") {
      throw new ImportValidationError("RECORD_RIGHTS_BLOCKED", `row ${row} lacks production origin/rights/api_output scope`);
    }
    if (prefix.length >= 37 && !privacyReviewReference) {
      throw new ImportValidationError("PRIVACY_REVIEW_REQUIRED", `row ${row} with /${prefix.length} requires privacyReviewReference`);
    }
  }
  if (verificationStatus === "corroborated") {
    throw new ImportValidationError("CORROBORATION_RESERVED", "corroborated status is assigned only by the resolver across independent sources");
  }
  if (verificationStatus === "reviewed" && !reviewedBy) {
    throw new ImportValidationError("REVIEWER_REQUIRED", "reviewed records require an opaque reviewedBy actor ID");
  }

  const normalizedForHash = {
    recordKind, registry, prefix: formatPrefix(prefix.bits, prefix.length), prefixLength: prefix.length,
    organizationName, organizationAddress, isPrivate, originType, rightsBasis, distributionScope,
    verificationStatus, reviewedBy, claimValue: normalizedClaimValue, evidenceReference, privacyReviewReference,
    observedAt: timestamp(raw.observedAt, "observedAt"),
  };
  return {
    recordKind,
    recordStatus: manifest.source.publishMode === "production" ? "eligible" : "qa_only",
    registry,
    prefixBits: prefix.bits,
    prefixLength: prefix.length,
    organizationName,
    organizationAddress,
    isPrivate,
    claimValue: normalizedClaimValue,
    originType,
    rightsBasis,
    distributionScope,
    verificationStatus,
    reviewedBy,
    evidenceReference,
    privacyReviewReference,
    observedAt: normalizedForHash.observedAt,
    rawRecordHash: sha256(canonicalJson(normalizedForHash)),
    rawLocator: `row:${row}`,
  };
}

export interface ParsedArtifact {
  absolutePath: string;
  byteSize: number;
  contentHash: string;
  records: ParsedSourceRecord[];
  mimeType: string;
  signatureKeyHash: string | null;
}

export async function parseArtifact(manifest: SourceManifest, manifestPath: string): Promise<ParsedArtifact> {
  const manifestDirectory = await realpath(path.dirname(manifestPath));
  const candidate = path.resolve(manifestDirectory, manifest.artifact.path);
  const relative = path.relative(manifestDirectory, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new ImportValidationError("UNSAFE_ARTIFACT_PATH", "artifact escapes manifest directory");
  const stat = await lstat(candidate).catch(() => null);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) throw new ImportValidationError("UNSAFE_ARTIFACT_FILE", "artifact must be a regular non-symlink file");
  if (stat.size > IMPORT_LIMITS.artifactBytes) throw new ImportValidationError("ARTIFACT_TOO_LARGE", "artifact exceeds 20 MiB");
  const bytes = await readFile(candidate);
  const contentHash = sha256(bytes);
  if (contentHash !== manifest.artifact.sha256) throw new ImportValidationError("ARTIFACT_HASH_MISMATCH", "artifact SHA-256 does not match manifest");
  const signatureKeyHash = await verifyArtifactSignature(manifest, manifestPath, bytes);
  let content: string;
  try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new ImportValidationError("INVALID_UTF8", "artifact must be valid UTF-8"); }
  if (content.startsWith("\uFEFF")) content = content.slice(1);
  if (content.includes("\0")) throw new ImportValidationError("NUL_BYTE", "artifact contains NUL byte");
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (Buffer.byteLength(line, "utf8") > IMPORT_LIMITS.lineBytes) throw new ImportValidationError("LINE_TOO_LARGE", `line ${index + 1} exceeds 64 KiB`);
  }

  let rawRecords: RawRecord[];
  if (manifest.artifact.format === "jsonl") {
    rawRecords = lines.flatMap((line, index) => {
      if (!line.trim()) return [];
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        return [parsed as RawRecord];
      } catch {
        throw new ImportValidationError("INVALID_JSONL", `line ${index + 1} must contain one JSON object`);
      }
    });
  } else {
    try {
      rawRecords = parse(content, {
        bom: true,
        columns: true,
        delimiter: manifest.artifact.format === "tsv" ? "\t" : ",",
        skip_empty_lines: true,
        relax_column_count: false,
        max_record_size: IMPORT_LIMITS.lineBytes,
      }) as RawRecord[];
    } catch {
      throw new ImportValidationError("INVALID_DELIMITED_FILE", "CSV/TSV artifact could not be parsed with a single strict header row");
    }
  }
  if (rawRecords.length === 0) throw new ImportValidationError("EMPTY_ARTIFACT", "artifact contains no records");
  if (rawRecords.length > IMPORT_LIMITS.records) throw new ImportValidationError("TOO_MANY_RECORDS", "artifact exceeds 250,000 records");
  const records = rawRecords.map((record, index) => normalizeRecord(record, index + 1, manifest));
  const recordHashes = new Set<string>();
  const authoritativeKeys = new Set<string>();
  for (const record of records) {
    if (recordHashes.has(record.rawRecordHash)) {
      throw new ImportValidationError("DUPLICATE_RECORD", "artifact contains duplicate normalized records");
    }
    recordHashes.add(record.rawRecordHash);
    if (manifest.source.class === "authoritative" && record.recordKind === "assignment") {
      const key = `${record.registry}:${record.prefixLength}:${record.prefixBits}`;
      if (authoritativeKeys.has(key)) {
        throw new ImportValidationError("DUPLICATE_ASSIGNMENT", "authoritative artifact contains multiple assignments for the same registry prefix");
      }
      authoritativeKeys.add(key);
    }
  }
  return {
    absolutePath: candidate,
    byteSize: bytes.byteLength,
    contentHash,
    records,
    mimeType: manifest.artifact.format === "jsonl" ? "application/x-ndjson" : "text/plain",
    signatureKeyHash,
  };
}
