import { readFile } from "node:fs/promises";
import { ImportValidationError } from "./errors";
import type {
  DistributionScope,
  OriginType,
  PublishMode,
  RecordKind,
  Registry,
  RightsBasis,
  RightsStatus,
  SourceClass,
  SourceManifest,
  VerificationStatus,
} from "./types";

const SOURCE_CLASSES = ["authoritative", "enrichment", "owner_curated", "reference"] as const;
const PUBLISH_MODES = ["production", "qa_only", "disabled"] as const;
const RIGHTS_STATUSES = ["unreviewed", "owner_asserted", "approved", "rejected", "expired"] as const;
const RIGHTS_BASES = ["owner_created", "licensed", "permission_granted", "public_domain_claim", "unknown"] as const;
const SCOPES = ["internal_only", "api_output", "raw_redistribution"] as const;
const RECORD_KINDS = ["assignment", "curated_vendor_claim", "vendor_alias", "device_hint", "usage_note", "tombstone"] as const;
const ORIGIN_TYPES = ["owner_observation", "derived", "imported", "unknown"] as const;
const VERIFICATION_STATUSES = ["unverified", "single_observation", "corroborated", "reviewed"] as const;
const REGISTRIES = ["MA-L", "MA-M", "MA-S", "IAB", "CID"] as const;

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ImportValidationError("INVALID_MANIFEST", `${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new ImportValidationError("UNKNOWN_MANIFEST_FIELD", `${path} contains unknown field ${unknown[0]}`);
}

function string(value: unknown, path: string, max = 2048): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > max) {
    throw new ImportValidationError("INVALID_MANIFEST", `${path} must be a non-empty string up to ${max} bytes`);
  }
  return value;
}

function optionalString(value: unknown, path: string, max = 2048): string | undefined {
  return value === undefined ? undefined : string(value, path, max);
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new ImportValidationError("INVALID_MANIFEST", `${path} must be boolean`);
  return value;
}

function number(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ImportValidationError("INVALID_MANIFEST", `${path} must be a number from ${minimum} to ${maximum}`);
  }
  return value;
}

function integer(value: unknown, path: string, minimum: number, maximum: number): number {
  const candidate = number(value, path, minimum, maximum);
  if (!Number.isInteger(candidate)) throw new ImportValidationError("INVALID_MANIFEST", `${path} must be an integer`);
  return candidate;
}

function oneOf<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new ImportValidationError("INVALID_MANIFEST", `${path} must be one of ${values.join(", ")}`);
  }
  return value as T;
}

function isoDate(value: string | undefined, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ImportValidationError("INVALID_MANIFEST", `${path} must be an RFC 3339 UTC timestamp`);
  }
  return new Date(value).toISOString();
}

function optionalHttpsUrl(value: unknown, path: string): string | undefined {
  const candidate = optionalString(value, path);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
  } catch {
    throw new ImportValidationError("INVALID_MANIFEST", `${path} must be an HTTPS URL without credentials, query, or fragment`);
  }
  return candidate;
}

function httpsUrl(value: unknown, path: string): string {
  return optionalHttpsUrl(value, path)
    ?? (() => { throw new ImportValidationError("INVALID_MANIFEST", `${path} is required`); })();
}

function safeRelativePath(value: unknown, field: string): string {
  const candidate = string(value, field, 1024);
  if (candidate.startsWith("/") || candidate.startsWith("\\") || candidate.split(/[\\/]/).includes("..")) {
    throw new ImportValidationError("UNSAFE_ARTIFACT_PATH", `${field} must be a relative path without parent traversal`);
  }
  return candidate;
}

function hash(value: unknown, field: string): string {
  const candidate = string(value, field, 71);
  if (!/^sha256:[0-9a-f]{64}$/.test(candidate)) {
    throw new ImportValidationError("INVALID_ARTIFACT_HASH", `${field} must use lowercase sha256:<64 hex>`);
  }
  return candidate;
}

export function parseManifest(value: unknown): SourceManifest {
  const root = object(value, "manifest");
  keys(root, ["schemaVersion", "source", "release", "artifact", "defaults"], "manifest");
  if (root.schemaVersion !== "macvendor-source/v1") {
    throw new ImportValidationError("UNSUPPORTED_MANIFEST_VERSION", "schemaVersion must be macvendor-source/v1");
  }

  const source = object(root.source, "source");
  keys(source, ["slug", "name", "class", "publishMode", "adapterKey", "requiredForActivation", "homepageUrl", "termsUrl", "rights"], "source");
  const slug = string(source.slug, "source.slug", 80);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new ImportValidationError("INVALID_SOURCE_SLUG", "source.slug must be lowercase kebab-case");
  }
  const rights = object(source.rights, "source.rights");
  keys(rights, ["status", "basis", "distributionScope", "reviewReference", "reviewExpiresAt"], "source.rights");
  const adapterKey = string(source.adapterKey, "source.adapterKey", 120);
  if (adapterKey !== "strict-delimited-v1") {
    throw new ImportValidationError("UNSUPPORTED_ADAPTER", "only the reviewed strict-delimited-v1 adapter is available");
  }

  const release = object(root.release, "release");
  keys(release, ["snapshotKind", "snapshotComplete", "schemaVersion", "adapterVersion", "normalizerVersion", "diffPolicy"], "release");
  const snapshotKind = oneOf(release.snapshotKind, ["full_snapshot", "delta"] as const, "release.snapshotKind");
  const snapshotComplete = boolean(release.snapshotComplete, "release.snapshotComplete");
  if (snapshotKind === "delta" && snapshotComplete) {
    throw new ImportValidationError("INVALID_SNAPSHOT", "delta releases cannot set snapshotComplete=true");
  }

  const diffPolicy = release.diffPolicy === undefined ? undefined : object(release.diffPolicy, "release.diffPolicy");
  if (diffPolicy) keys(diffPolicy, ["maxAddedPercent", "maxRemovedPercent"], "release.diffPolicy");

  const artifact = object(root.artifact, "artifact");
  keys(artifact, ["path", "format", "sha256", "signatureStatus", "signature", "remote"], "artifact");
  const artifactPath = safeRelativePath(artifact.path, "artifact.path");
  const artifactHash = hash(artifact.sha256, "artifact.sha256");
  const signatureStatus = oneOf(artifact.signatureStatus, ["verified", "unverified", "not_applicable"] as const, "artifact.signatureStatus");
  const signature = artifact.signature === undefined ? undefined : object(artifact.signature, "artifact.signature");
  if (signature) keys(signature, ["algorithm", "path", "publicKeyPath", "publicKeySha256", "url"], "artifact.signature");
  const remote = artifact.remote === undefined ? undefined : object(artifact.remote, "artifact.remote");
  if (remote) keys(remote, ["url", "allowedOrigins", "maxRedirects"], "artifact.remote");
  const remoteUrl = remote ? httpsUrl(remote.url, "artifact.remote.url") : undefined;
  const allowedOrigins = remote ? (() => {
    if (!Array.isArray(remote.allowedOrigins) || remote.allowedOrigins.length < 1 || remote.allowedOrigins.length > 8) {
      throw new ImportValidationError("INVALID_MANIFEST", "artifact.remote.allowedOrigins must contain 1..8 origins");
    }
    const values = remote.allowedOrigins.map((value, index) => {
      const candidate = httpsUrl(value, `artifact.remote.allowedOrigins[${index}]`);
      const url = new URL(candidate);
      if (url.pathname !== "/") throw new ImportValidationError("INVALID_MANIFEST", "allowed origins cannot include a path");
      return url.origin;
    });
    if (new Set(values).size !== values.length) throw new ImportValidationError("INVALID_MANIFEST", "allowed origins must be unique");
    if (!values.includes(new URL(remoteUrl!).origin)) throw new ImportValidationError("REMOTE_ORIGIN_BLOCKED", "artifact URL origin is not allowlisted");
    return values;
  })() : undefined;

  const defaults = object(root.defaults, "defaults");
  keys(defaults, ["recordKind", "originType", "rightsBasis", "distributionScope", "verificationStatus", "registry"], "defaults");

  const manifest: SourceManifest = {
    schemaVersion: "macvendor-source/v1",
    source: {
      slug,
      name: string(source.name, "source.name", 512),
      class: oneOf<SourceClass>(source.class, SOURCE_CLASSES, "source.class"),
      publishMode: oneOf<PublishMode>(source.publishMode, PUBLISH_MODES, "source.publishMode"),
      adapterKey,
      requiredForActivation: boolean(source.requiredForActivation, "source.requiredForActivation"),
      homepageUrl: optionalHttpsUrl(source.homepageUrl, "source.homepageUrl"),
      termsUrl: optionalHttpsUrl(source.termsUrl, "source.termsUrl"),
      rights: {
        status: oneOf<RightsStatus>(rights.status, RIGHTS_STATUSES, "source.rights.status"),
        basis: oneOf<RightsBasis>(rights.basis, RIGHTS_BASES, "source.rights.basis"),
        distributionScope: oneOf<DistributionScope>(rights.distributionScope, SCOPES, "source.rights.distributionScope"),
        reviewReference: optionalString(rights.reviewReference, "source.rights.reviewReference", 512),
        reviewExpiresAt: isoDate(optionalString(rights.reviewExpiresAt, "source.rights.reviewExpiresAt", 40), "source.rights.reviewExpiresAt"),
      },
    },
    release: {
      snapshotKind,
      snapshotComplete,
      schemaVersion: string(release.schemaVersion, "release.schemaVersion", 80),
      adapterVersion: string(release.adapterVersion, "release.adapterVersion", 80),
      normalizerVersion: string(release.normalizerVersion, "release.normalizerVersion", 80),
      diffPolicy: diffPolicy ? {
        maxAddedPercent: number(diffPolicy.maxAddedPercent, "release.diffPolicy.maxAddedPercent", 0, 1000),
        maxRemovedPercent: number(diffPolicy.maxRemovedPercent, "release.diffPolicy.maxRemovedPercent", 0, 100),
      } : undefined,
    },
    artifact: {
      path: artifactPath,
      format: oneOf(artifact.format, ["csv", "tsv", "jsonl"] as const, "artifact.format"),
      sha256: artifactHash,
      signatureStatus,
      signature: signature ? {
        algorithm: oneOf(signature.algorithm, ["ed25519"] as const, "artifact.signature.algorithm"),
        path: safeRelativePath(signature.path, "artifact.signature.path"),
        publicKeyPath: safeRelativePath(signature.publicKeyPath, "artifact.signature.publicKeyPath"),
        publicKeySha256: hash(signature.publicKeySha256, "artifact.signature.publicKeySha256"),
        url: optionalHttpsUrl(signature.url, "artifact.signature.url"),
      } : undefined,
      remote: remote ? {
        url: remoteUrl!,
        allowedOrigins: allowedOrigins!,
        maxRedirects: integer(remote.maxRedirects, "artifact.remote.maxRedirects", 0, 3),
      } : undefined,
    },
    defaults: {
      recordKind: oneOf<RecordKind>(defaults.recordKind, RECORD_KINDS, "defaults.recordKind"),
      originType: oneOf<OriginType>(defaults.originType, ORIGIN_TYPES, "defaults.originType"),
      rightsBasis: oneOf<RightsBasis>(defaults.rightsBasis, RIGHTS_BASES, "defaults.rightsBasis"),
      distributionScope: oneOf<DistributionScope>(defaults.distributionScope, SCOPES, "defaults.distributionScope"),
      verificationStatus: oneOf<VerificationStatus>(defaults.verificationStatus, VERIFICATION_STATUSES, "defaults.verificationStatus"),
      registry: defaults.registry === undefined ? undefined : oneOf<Registry>(defaults.registry, REGISTRIES, "defaults.registry"),
    },
  };

  validateRightsGate(manifest);
  if (manifest.artifact.signatureStatus === "verified" && !manifest.artifact.signature) {
    throw new ImportValidationError("SIGNATURE_CONFIG_REQUIRED", "signatureStatus=verified requires artifact.signature");
  }
  if (manifest.artifact.signatureStatus !== "verified" && manifest.artifact.signature) {
    throw new ImportValidationError("SIGNATURE_CONFIG_UNEXPECTED", "artifact.signature is valid only with signatureStatus=verified");
  }
  if (manifest.artifact.remote && manifest.artifact.signatureStatus === "verified" && !manifest.artifact.signature?.url) {
    throw new ImportValidationError("SIGNATURE_URL_REQUIRED", "remote verified artifacts require artifact.signature.url");
  }
  if (manifest.source.publishMode === "production" && manifest.artifact.signatureStatus !== "verified") {
    throw new ImportValidationError("ARTIFACT_SIGNATURE_BLOCKED", "production artifacts require a verified signature");
  }
  if (manifest.source.publishMode === "production" && manifest.release.snapshotKind === "delta") {
    throw new ImportValidationError("PRODUCTION_DELTA_UNSUPPORTED", "production delta materialization is not implemented");
  }
  if (manifest.source.publishMode === "production" && !manifest.release.diffPolicy) {
    throw new ImportValidationError("DIFF_POLICY_REQUIRED", "production releases require release.diffPolicy");
  }
  return manifest;
}

export function validateRightsGate(manifest: SourceManifest, now = new Date()): void {
  const { source } = manifest;
  if (source.class === "reference" && source.publishMode === "production") {
    throw new ImportValidationError("REFERENCE_CANNOT_PUBLISH", "reference sources cannot use production publish mode");
  }
  if (source.publishMode !== "production") return;
  if (manifest.release.snapshotKind === "full_snapshot" && !manifest.release.snapshotComplete) {
    throw new ImportValidationError("INCOMPLETE_PRODUCTION_SNAPSHOT", "production full snapshots require snapshotComplete=true");
  }
  if (source.rights.distributionScope !== "api_output") {
    throw new ImportValidationError("RIGHTS_SCOPE_BLOCKED", "production V1 sources require distributionScope=api_output");
  }
  if (source.rights.basis === "owner_created") {
    if (!(["owner_asserted", "approved"] as RightsStatus[]).includes(source.rights.status)) {
      throw new ImportValidationError("RIGHTS_STATUS_BLOCKED", "owner-created production sources require owner_asserted or approved rights");
    }
  } else {
    if (source.rights.status !== "approved" || !source.rights.reviewReference) {
      throw new ImportValidationError("RIGHTS_REVIEW_REQUIRED", "third-party production sources require approved status and reviewReference");
    }
  }
  if (source.rights.reviewExpiresAt && Date.parse(source.rights.reviewExpiresAt) <= now.getTime()) {
    throw new ImportValidationError("RIGHTS_REVIEW_EXPIRED", "source rights review has expired");
  }
}

export async function loadManifest(path: string): Promise<SourceManifest> {
  const bytes = await readFile(path);
  if (bytes.byteLength > 256 * 1024) throw new ImportValidationError("MANIFEST_TOO_LARGE", "manifest exceeds 256 KiB");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ImportValidationError("INVALID_UTF8", "manifest must be valid UTF-8");
  }
  try {
    return parseManifest(JSON.parse(text) as unknown);
  } catch (error) {
    if (error instanceof ImportValidationError) throw error;
    throw new ImportValidationError("INVALID_JSON", "manifest must contain valid JSON");
  }
}
