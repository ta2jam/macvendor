import { readFile } from "node:fs/promises";
import type { Pool, PoolClient } from "pg";
import { canonicalJson, sha256 } from "@/domain/canonical-json";

const GOVERNANCE_LOCK = 6_104_227_007;
const OPAQUE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,127}$/;
const SOURCE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HASH = /^sha256:[0-9a-f]{64}$/;

type RightsStatus = "unreviewed" | "owner_asserted" | "approved" | "rejected" | "expired";
type RightsBasis = "owner_created" | "licensed" | "permission_granted" | "public_domain_claim" | "unknown";
type DistributionScope = "internal_only" | "api_output" | "raw_redistribution";

export interface SourceGovernancePatch {
  name?: string;
  publishMode?: "production" | "qa_only" | "disabled";
  fetchPolicy?: "scheduled" | "manual";
  fetchIntervalSeconds?: number | null;
  maxAcceptableAgeSeconds?: number | null;
  requiredForActivation?: boolean;
  homepageUrl?: string | null;
  termsUrl?: string | null;
  rights?: {
    status: RightsStatus;
    basis: RightsBasis;
    distributionScope: DistributionScope;
    reviewReference: string | null;
    reviewExpiresAt: string | null;
  };
  fetchOrigins?: string[];
  signatureKeySha256?: string | null;
  diffPolicy?: { maxAddedPercent: number; maxRemovedPercent: number } | null;
}

export interface SourceGovernanceDecision {
  schemaVersion: "macvendor-governance/v1";
  sourceSlug: string;
  decisionReference: string;
  acceptActivePublicationRisk: boolean;
  patch: SourceGovernancePatch;
}

interface SourceConfigRow {
  id: string;
  slug: string;
  name: string;
  source_class: "authoritative" | "enrichment" | "owner_curated" | "reference";
  publish_mode: "production" | "qa_only" | "disabled";
  adapter_key: string;
  fetch_policy: "scheduled" | "manual";
  fetch_interval_seconds: number | null;
  max_acceptable_age_seconds: number | null;
  required_for_activation: boolean;
  homepage_url: string | null;
  terms_url: string | null;
  rights_status: RightsStatus;
  rights_basis: RightsBasis;
  distribution_scope: DistributionScope;
  rights_review_reference: string | null;
  rights_review_expires_at: Date | null;
  fetch_origins: string[];
  signature_key_sha256: string | null;
  diff_policy: { maxAddedPercent: number; maxRemovedPercent: number } | null;
  config_version: string;
}

interface SourceConfig {
  name: string;
  publishMode: SourceConfigRow["publish_mode"];
  fetchPolicy: SourceConfigRow["fetch_policy"];
  fetchIntervalSeconds: number | null;
  maxAcceptableAgeSeconds: number | null;
  requiredForActivation: boolean;
  homepageUrl: string | null;
  termsUrl: string | null;
  rights: SourceGovernancePatch["rights"] extends infer T ? Exclude<T, undefined> : never;
  fetchOrigins: string[];
  signatureKeySha256: string | null;
  diffPolicy: SourceGovernancePatch["diffPolicy"] extends infer T ? Exclude<T, undefined> : never;
}

export class SourceGovernanceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "SourceGovernanceError";
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SourceGovernanceError("INVALID_DECISION", `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, allowed: string[], field: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new SourceGovernanceError("INVALID_DECISION", `${field} contains unknown field ${unknown}`);
}

function nullableUrl(value: unknown, field: string, origin = false): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 2048) throw new SourceGovernanceError("INVALID_DECISION", `${field} is invalid`);
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || (origin && url.pathname !== "/")) throw new Error();
    return origin ? url.origin : value;
  } catch { throw new SourceGovernanceError("INVALID_DECISION", `${field} must be a safe HTTPS ${origin ? "origin" : "URL"}`); }
}

function nullableInteger(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 60 || (value as number) > 31_536_000) {
    throw new SourceGovernanceError("INVALID_DECISION", `${field} must be null or an integer from 60 to 31536000`);
  }
  return value as number;
}

function parseDecision(value: unknown): SourceGovernanceDecision {
  const root = record(value, "decision");
  exact(root, ["schemaVersion", "sourceSlug", "decisionReference", "acceptActivePublicationRisk", "patch"], "decision");
  if (root.schemaVersion !== "macvendor-governance/v1" || typeof root.sourceSlug !== "string"
    || root.sourceSlug.length > 80 || !SOURCE_SLUG.test(root.sourceSlug)
    || typeof root.decisionReference !== "string" || !OPAQUE_REFERENCE.test(root.decisionReference)
    || typeof root.acceptActivePublicationRisk !== "boolean") {
    throw new SourceGovernanceError("INVALID_DECISION", "decision identity fields are invalid");
  }
  const raw = record(root.patch, "patch");
  const allowed = ["name", "publishMode", "fetchPolicy", "fetchIntervalSeconds", "maxAcceptableAgeSeconds",
    "requiredForActivation", "homepageUrl", "termsUrl", "rights", "fetchOrigins", "signatureKeySha256", "diffPolicy"];
  exact(raw, allowed, "patch");
  if (!Object.keys(raw).length) throw new SourceGovernanceError("INVALID_DECISION", "patch must change at least one field");
  const patch: SourceGovernancePatch = {};
  if ("name" in raw) {
    const name = typeof raw.name === "string" ? raw.name.trim().normalize("NFC") : "";
    if (!name || Buffer.byteLength(name, "utf8") > 512
      || /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(name)) {
      throw new SourceGovernanceError("INVALID_DECISION", "patch.name is invalid");
    }
    patch.name = name;
  }
  if ("publishMode" in raw) {
    if (!(typeof raw.publishMode === "string" && ["production", "qa_only", "disabled"].includes(raw.publishMode))) throw new SourceGovernanceError("INVALID_DECISION", "patch.publishMode is invalid");
    patch.publishMode = raw.publishMode as SourceGovernancePatch["publishMode"];
  }
  if ("fetchPolicy" in raw) {
    if (!(raw.fetchPolicy === "scheduled" || raw.fetchPolicy === "manual")) throw new SourceGovernanceError("INVALID_DECISION", "patch.fetchPolicy is invalid");
    patch.fetchPolicy = raw.fetchPolicy;
  }
  if ("fetchIntervalSeconds" in raw) patch.fetchIntervalSeconds = nullableInteger(raw.fetchIntervalSeconds, "patch.fetchIntervalSeconds");
  if ("maxAcceptableAgeSeconds" in raw) patch.maxAcceptableAgeSeconds = nullableInteger(raw.maxAcceptableAgeSeconds, "patch.maxAcceptableAgeSeconds");
  if ("requiredForActivation" in raw) {
    if (typeof raw.requiredForActivation !== "boolean") throw new SourceGovernanceError("INVALID_DECISION", "patch.requiredForActivation is invalid");
    patch.requiredForActivation = raw.requiredForActivation;
  }
  if ("homepageUrl" in raw) patch.homepageUrl = nullableUrl(raw.homepageUrl, "patch.homepageUrl");
  if ("termsUrl" in raw) patch.termsUrl = nullableUrl(raw.termsUrl, "patch.termsUrl");
  if ("rights" in raw) {
    const rights = record(raw.rights, "patch.rights");
    exact(rights, ["status", "basis", "distributionScope", "reviewReference", "reviewExpiresAt"], "patch.rights");
    if (!(typeof rights.status === "string" && ["unreviewed", "owner_asserted", "approved", "rejected", "expired"].includes(rights.status))
      || !(typeof rights.basis === "string" && ["owner_created", "licensed", "permission_granted", "public_domain_claim", "unknown"].includes(rights.basis))
      || !(typeof rights.distributionScope === "string" && ["internal_only", "api_output", "raw_redistribution"].includes(rights.distributionScope))
      || !(rights.reviewReference === null || (typeof rights.reviewReference === "string" && OPAQUE_REFERENCE.test(rights.reviewReference)))
      || !(rights.reviewExpiresAt === null || (typeof rights.reviewExpiresAt === "string"
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(rights.reviewExpiresAt)
        && !Number.isNaN(Date.parse(rights.reviewExpiresAt))))) {
      throw new SourceGovernanceError("INVALID_DECISION", "patch.rights is invalid");
    }
    patch.rights = { status: rights.status as RightsStatus, basis: rights.basis as RightsBasis,
      distributionScope: rights.distributionScope as DistributionScope, reviewReference: rights.reviewReference,
      reviewExpiresAt: rights.reviewExpiresAt === null ? null : new Date(rights.reviewExpiresAt).toISOString() } as SourceGovernancePatch["rights"];
  }
  if ("fetchOrigins" in raw) {
    if (!Array.isArray(raw.fetchOrigins) || raw.fetchOrigins.length > 8) throw new SourceGovernanceError("INVALID_DECISION", "patch.fetchOrigins is invalid");
    patch.fetchOrigins = raw.fetchOrigins.map((item, index) => nullableUrl(item, `patch.fetchOrigins[${index}]`, true)!);
    if (new Set(patch.fetchOrigins).size !== patch.fetchOrigins.length) throw new SourceGovernanceError("INVALID_DECISION", "patch.fetchOrigins must be unique");
  }
  if ("signatureKeySha256" in raw) {
    if (!(raw.signatureKeySha256 === null || (typeof raw.signatureKeySha256 === "string" && HASH.test(raw.signatureKeySha256)))) throw new SourceGovernanceError("INVALID_DECISION", "patch.signatureKeySha256 is invalid");
    patch.signatureKeySha256 = raw.signatureKeySha256;
  }
  if ("diffPolicy" in raw) {
    if (raw.diffPolicy === null) patch.diffPolicy = null;
    else {
      const policy = record(raw.diffPolicy, "patch.diffPolicy");
      exact(policy, ["maxAddedPercent", "maxRemovedPercent"], "patch.diffPolicy");
      if (typeof policy.maxAddedPercent !== "number" || !Number.isFinite(policy.maxAddedPercent) || policy.maxAddedPercent < 0 || policy.maxAddedPercent > 1000
        || typeof policy.maxRemovedPercent !== "number" || !Number.isFinite(policy.maxRemovedPercent) || policy.maxRemovedPercent < 0 || policy.maxRemovedPercent > 100) {
        throw new SourceGovernanceError("INVALID_DECISION", "patch.diffPolicy is invalid");
      }
      patch.diffPolicy = { maxAddedPercent: policy.maxAddedPercent, maxRemovedPercent: policy.maxRemovedPercent };
    }
  }
  return { schemaVersion: "macvendor-governance/v1", sourceSlug: root.sourceSlug,
    decisionReference: root.decisionReference, acceptActivePublicationRisk: root.acceptActivePublicationRisk, patch };
}

export async function loadSourceGovernanceDecision(path: string): Promise<SourceGovernanceDecision> {
  const bytes = await readFile(path);
  if (bytes.byteLength > 64 * 1024) throw new SourceGovernanceError("INVALID_DECISION", "decision exceeds 64 KiB");
  try { return parseDecision(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown); }
  catch (error) {
    if (error instanceof SourceGovernanceError) throw error;
    throw new SourceGovernanceError("INVALID_DECISION", "decision must be valid UTF-8 JSON");
  }
}

function config(row: SourceConfigRow): SourceConfig {
  return { name: row.name, publishMode: row.publish_mode, fetchPolicy: row.fetch_policy,
    fetchIntervalSeconds: row.fetch_interval_seconds, maxAcceptableAgeSeconds: row.max_acceptable_age_seconds,
    requiredForActivation: row.required_for_activation, homepageUrl: row.homepage_url, termsUrl: row.terms_url,
    rights: { status: row.rights_status, basis: row.rights_basis, distributionScope: row.distribution_scope,
      reviewReference: row.rights_review_reference, reviewExpiresAt: row.rights_review_expires_at?.toISOString() ?? null },
    fetchOrigins: row.fetch_origins, signatureKeySha256: row.signature_key_sha256, diffPolicy: row.diff_policy };
}

function desiredConfig(row: SourceConfigRow, patch: SourceGovernancePatch): SourceConfig {
  const current = config(row);
  return { ...current, ...patch, rights: patch.rights ?? current.rights };
}

function publicationRisk(row: SourceConfigRow, desired: SourceConfig, now: Date): boolean {
  const rights = desired.rights;
  const rightsBlocked = rights.basis === "owner_created"
    ? !["owner_asserted", "approved"].includes(rights.status)
    : rights.status !== "approved" || !rights.reviewReference;
  return desired.publishMode !== "production" || row.source_class === "reference"
    || rightsBlocked || rights.distributionScope !== "api_output"
    || Boolean(rights.reviewExpiresAt && Date.parse(rights.reviewExpiresAt) <= now.getTime());
}

async function readSource(client: PoolClient, slug: string, lock: boolean): Promise<SourceConfigRow> {
  const result = await client.query<SourceConfigRow>(
    `SELECT id, slug, name, source_class, publish_mode, adapter_key, fetch_policy,
      fetch_interval_seconds, max_acceptable_age_seconds, required_for_activation,
      homepage_url, terms_url, rights_status, rights_basis, distribution_scope,
      rights_review_reference, rights_review_expires_at, fetch_origins,
      signature_key_sha256, diff_policy, config_version
     FROM data_sources WHERE slug = $1${lock ? " FOR UPDATE" : ""}`,
    [slug],
  );
  if (!result.rows[0]) throw new SourceGovernanceError("SOURCE_NOT_FOUND", "source does not exist");
  return result.rows[0];
}

async function isActiveInput(client: PoolClient, sourceId: string): Promise<boolean> {
  const result = await client.query<{ active: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM active_resolution ar JOIN resolution_inputs ri ON ri.resolution_run_id = ar.resolution_run_id
      JOIN source_releases sr ON sr.id = ri.source_release_id
      WHERE ar.singleton_id = 1 AND sr.source_id = $1
    ) AS active`, [sourceId],
  );
  return Boolean(result.rows[0]?.active);
}

function plan(row: SourceConfigRow, decision: SourceGovernanceDecision, activeInput: boolean, now: Date) {
  const before = config(row);
  const after = desiredConfig(row, decision.patch);
  if (after.fetchPolicy === "scheduled" && after.fetchIntervalSeconds === null) {
    throw new SourceGovernanceError("INVALID_FINAL_CONFIG", "scheduled sources require fetchIntervalSeconds");
  }
  if (after.fetchPolicy === "scheduled" && !after.fetchOrigins.length) {
    throw new SourceGovernanceError("INVALID_FINAL_CONFIG", "scheduled sources require at least one fetch origin");
  }
  if (row.source_class === "reference" && after.publishMode === "production") {
    throw new SourceGovernanceError("INVALID_FINAL_CONFIG", "reference sources cannot publish");
  }
  if (after.requiredForActivation && after.publishMode !== "production") {
    throw new SourceGovernanceError("INVALID_FINAL_CONFIG", "only production sources can be required for activation");
  }
  if (after.publishMode === "production" && (!after.signatureKeySha256 || !after.diffPolicy)) {
    throw new SourceGovernanceError("INVALID_FINAL_CONFIG", "production sources require a signature key and diff policy");
  }
  const changedFields = Object.keys(after).filter((key) => canonicalJson(before[key as keyof SourceConfig])
    !== canonicalJson(after[key as keyof SourceConfig])).sort();
  const activePublicationRisk = activeInput && publicationRisk(row, after, now);
  if (decision.acceptActivePublicationRisk && !activePublicationRisk) {
    throw new SourceGovernanceError("RISK_ACCEPTANCE_UNNECESSARY", "active publication risk acceptance is not applicable");
  }
  return { before, after, changedFields, activeInput, activePublicationRisk,
    currentConfigVersion: Number(row.config_version), beforeHash: sha256(canonicalJson(before)), afterHash: sha256(canonicalJson(after)) };
}

export async function previewSourceGovernance(pool: Pool, decision: SourceGovernanceDecision, now = new Date()) {
  const client = await pool.connect();
  try {
    const row = await readSource(client, decision.sourceSlug, false);
    return { status: "preview" as const, sourceSlug: decision.sourceSlug,
      ...plan(row, decision, await isActiveInput(client, row.id), now) };
  } finally { client.release(); }
}

export async function applySourceGovernance(pool: Pool, decision: SourceGovernanceDecision, actorId: string, now = new Date()) {
  if (!OPAQUE_REFERENCE.test(actorId)) throw new SourceGovernanceError("INVALID_ACTOR", "actorId must be opaque");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [GOVERNANCE_LOCK]);
    const row = await readSource(client, decision.sourceSlug, true);
    const planned = plan(row, decision, await isActiveInput(client, row.id), now);
    if (!planned.changedFields.length) {
      await client.query("COMMIT");
      return { status: "no_change" as const, sourceSlug: row.slug, configVersion: planned.currentConfigVersion };
    }
    if (planned.activePublicationRisk && !decision.acceptActivePublicationRisk) {
      throw new SourceGovernanceError("ACTIVE_PUBLICATION_RISK", "decision weakens an active source and requires explicit risk acceptance");
    }
    const next = planned.after;
    const updated = await client.query<{ config_version: string }>(
      `UPDATE data_sources SET name=$2, publish_mode=$3, fetch_policy=$4, fetch_interval_seconds=$5,
        max_acceptable_age_seconds=$6, required_for_activation=$7, homepage_url=$8, terms_url=$9,
        rights_status=$10, rights_basis=$11, distribution_scope=$12, rights_review_reference=$13,
        rights_review_expires_at=$14, fetch_origins=$15, signature_key_sha256=$16, diff_policy=$17,
        config_version=config_version+1, updated_at=$18 WHERE id=$1 RETURNING config_version`,
      [row.id, next.name, next.publishMode, next.fetchPolicy, next.fetchIntervalSeconds,
        next.maxAcceptableAgeSeconds, next.requiredForActivation, next.homepageUrl, next.termsUrl,
        next.rights.status, next.rights.basis, next.rights.distributionScope, next.rights.reviewReference,
        next.rights.reviewExpiresAt, JSON.stringify(next.fetchOrigins), next.signatureKeySha256,
        next.diffPolicy === null ? null : JSON.stringify(next.diffPolicy), now],
    );
    const configVersion = Number(updated.rows[0]!.config_version);
    await client.query(
      `INSERT INTO audit_events (event_type, actor_id, target_type, target_id, metadata)
       VALUES ('source.governance_updated', $1, 'data_source', $2, $3)`,
      [actorId, row.id, JSON.stringify({ sourceSlug: row.slug, decisionReference: decision.decisionReference,
        changedFields: planned.changedFields, beforeHash: planned.beforeHash, afterHash: planned.afterHash,
        previousConfigVersion: planned.currentConfigVersion, configVersion, activeInput: planned.activeInput,
        acceptedActivePublicationRisk: planned.activePublicationRisk && decision.acceptActivePublicationRisk })],
    );
    await client.query("COMMIT");
    return { status: "updated" as const, sourceSlug: row.slug, configVersion, changedFields: planned.changedFields,
      activeInput: planned.activeInput, activePublicationRisk: planned.activePublicationRisk,
      decisionReference: decision.decisionReference };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
