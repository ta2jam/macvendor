import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { canonicalJson, sha256 } from "@/domain/canonical-json";
import { resolveRecords, type ResolverRecord, type ResolutionDraft } from "./resolve";

export class ResolutionBuildError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ResolutionBuildError";
  }
}

interface InputReleaseRow {
  source_release_id: string;
  source_id: string;
  source_slug: string;
  source_class: "authoritative" | "enrichment" | "owner_curated" | "reference";
  publish_mode: "production" | "qa_only" | "disabled";
  adapter_key: string;
  required_for_activation: boolean;
  max_acceptable_age_seconds: number | null;
  config_version: string;
  rights_status: string;
  rights_basis: string;
  distribution_scope: string;
  rights_review_reference: string | null;
  rights_review_expires_at: Date | null;
  release_status: string;
  schema_version: string;
  adapter_version: string;
  normalizer_version: string;
  fetched_at: Date;
  content_hash: string;
  import_key: string;
}

interface SourceRecordRow {
  id: string;
  source_release_id: string;
  source_slug: string;
  source_class: ResolverRecord["sourceClass"];
  record_kind: ResolverRecord["recordKind"];
  registry: ResolverRecord["registry"];
  prefix_bits: string;
  prefix_length: number;
  organization_name_display: string | null;
  organization_address_raw: string | null;
  is_private: boolean;
  claim_value: Record<string, unknown>;
  origin_type: ResolverRecord["originType"];
  verification_status: ResolverRecord["verificationStatus"];
  raw_record_hash: string;
}

function validateInputReleases(inputs: InputReleaseRow[], requestedIds: string[], now: Date): void {
  if (inputs.length !== requestedIds.length) throw new ResolutionBuildError("SOURCE_RELEASE_NOT_FOUND", "one or more source releases do not exist");
  const sources = new Set<string>();
  for (const input of inputs) {
    if (sources.has(input.source_id)) throw new ResolutionBuildError("DUPLICATE_SOURCE_RELEASE", `multiple releases selected for ${input.source_slug}`);
    sources.add(input.source_id);
    if (input.release_status !== "valid") throw new ResolutionBuildError("SOURCE_RELEASE_NOT_VALID", `${input.source_slug} release is not valid`);
    if (input.publish_mode !== "production" || input.source_class === "reference") {
      throw new ResolutionBuildError("SOURCE_NOT_PRODUCTION", `${input.source_slug} is not a production resolver input`);
    }
    if (input.distribution_scope !== "api_output") throw new ResolutionBuildError("RIGHTS_SCOPE_BLOCKED", `${input.source_slug} is not approved for API output`);
    const ownerCreated = input.rights_basis === "owner_created";
    if (ownerCreated) {
      if (!(["owner_asserted", "approved"] as string[]).includes(input.rights_status)) {
        throw new ResolutionBuildError("RIGHTS_STATUS_BLOCKED", `${input.source_slug} owner-created rights are not asserted or approved`);
      }
    } else if (input.rights_status !== "approved" || !input.rights_review_reference) {
      throw new ResolutionBuildError("RIGHTS_REVIEW_REQUIRED", `${input.source_slug} third-party rights are not approved`);
    }
    if (input.rights_review_expires_at && input.rights_review_expires_at <= now) {
      throw new ResolutionBuildError("RIGHTS_REVIEW_EXPIRED", `${input.source_slug} rights review expired`);
    }
    if (input.max_acceptable_age_seconds
      && now.getTime() - input.fetched_at.getTime() > input.max_acceptable_age_seconds * 1_000) {
      throw new ResolutionBuildError("SOURCE_STALE", `${input.source_slug} exceeds max acceptable age`);
    }
  }
}

function configSnapshot(input: InputReleaseRow) {
  return {
    configVersion: Number(input.config_version),
    publishMode: input.publish_mode,
    sourceClass: input.source_class,
    rightsStatus: input.rights_status,
    rightsBasis: input.rights_basis,
    distributionScope: input.distribution_scope,
    rightsReviewReference: input.rights_review_reference,
    rightsReviewExpiresAt: input.rights_review_expires_at?.toISOString() ?? null,
    freshnessStatus: "fresh",
  };
}

function inputManifest(inputs: InputReleaseRow[]) {
  return inputs.map((input) => ({
    sourceSlug: input.source_slug,
    sourceReleaseId: input.source_release_id,
    contentHash: input.content_hash,
    importKey: input.import_key,
    schemaVersion: input.schema_version,
    adapterVersion: input.adapter_version,
    normalizerVersion: input.normalizer_version,
    sourceConfig: configSnapshot(input),
  })).sort((left, right) => left.sourceSlug.localeCompare(right.sourceSlug, "en"));
}

async function insertResolution(client: PoolClient, runId: string, draft: ResolutionDraft): Promise<void> {
  const assignmentIds = new Map<ResolutionDraft["assignments"][number], string>();
  for (const assignment of draft.assignments) {
    const id = randomUUID();
    assignmentIds.set(assignment, id);
    await client.query(
      `INSERT INTO resolved_assignments (
        id, resolution_run_id, registry, prefix_bits, prefix_length, organization_name,
        organization_address, is_private, attribution_status, core_source_record_id,
        core_source_slug, core_source_release_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [id, runId, assignment.registry, assignment.prefixBits.toString(), assignment.prefixLength,
        assignment.organizationName, assignment.organizationAddress, assignment.isPrivate,
        assignment.isPrivate ? "authoritative_private" : "authoritative",
        assignment.core.id, assignment.core.sourceSlug, assignment.core.sourceReleaseId],
    );
    for (const evidence of assignment.evidence) {
      await client.query(
        `INSERT INTO resolution_evidence (
          resolution_run_id, resolved_assignment_id, field_name, source_record_id, role, reason_code
        ) VALUES ($1, $2, 'assignment', $3, $4, $5)`,
        [runId, id, evidence.record.id, evidence.role,
          evidence.role === "selected" ? "longest_prefix_authoritative" : "identical_authoritative_record"],
      );
    }
  }
  for (const claim of draft.claims) {
    const id = randomUUID();
    await client.query(
      `INSERT INTO resolved_claims (
        id, resolution_run_id, claim_type, prefix_bits, prefix_length, claim_value,
        organization_name, verification_status, origin_type, conflict_status,
        source_record_id, source_slug, source_release_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [id, runId, claim.claimType, claim.prefixBits.toString(), claim.prefixLength,
        JSON.stringify(claim.claimValue), claim.organizationName, claim.verificationStatus,
        claim.originType, claim.conflictStatus, claim.source.id, claim.source.sourceSlug,
        claim.source.sourceReleaseId],
    );
    await client.query(
      `INSERT INTO resolution_evidence (
        resolution_run_id, resolved_claim_id, field_name, source_record_id, role, reason_code
      ) VALUES ($1, $2, 'claim', $3, 'selected', 'source_claim')`,
      [runId, id, claim.source.id],
    );
  }
}

export interface BuildResolutionOptions {
  sourceReleaseIds: string[];
  policyVersion: string;
  policyCommitSha: string;
  containerImageDigest: string;
  now?: Date;
}

export interface BuildResolutionResult {
  status: "validated" | "already_built" | "rejected";
  resolutionRunId: string;
  inputManifestHash: string;
  outputHash: string;
  assignmentCount: number;
  claimCount: number;
  conflicts: ResolutionDraft["conflicts"];
}

export async function buildResolution(pool: Pool, options: BuildResolutionOptions): Promise<BuildResolutionResult> {
  const requestedIds = [...new Set(options.sourceReleaseIds)].sort();
  if (!requestedIds.length || requestedIds.length !== options.sourceReleaseIds.length) {
    throw new ResolutionBuildError("INVALID_INPUT_SET", "at least one unique source release is required");
  }
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [6_104_227_003]);
    const inputResult = await client.query<InputReleaseRow>(
      `SELECT sr.id AS source_release_id, ds.id AS source_id, ds.slug AS source_slug,
        ds.source_class, ds.publish_mode, ds.adapter_key, ds.required_for_activation,
        ds.max_acceptable_age_seconds, ds.config_version, ds.rights_status, ds.rights_basis,
        ds.distribution_scope, ds.rights_review_reference, ds.rights_review_expires_at,
        sr.status AS release_status, sr.schema_version, sr.adapter_version,
        sr.normalizer_version, sr.fetched_at, sr.content_hash, sr.import_key
       FROM source_releases sr JOIN data_sources ds ON ds.id = sr.source_id
       WHERE sr.id = ANY($1::uuid[]) ORDER BY ds.slug`,
      [requestedIds],
    );
    const now = options.now ?? new Date();
    validateInputReleases(inputResult.rows, requestedIds, now);
    const required = await client.query<{ slug: string }>(
      `SELECT slug FROM data_sources
       WHERE required_for_activation = true AND publish_mode = 'production' AND source_class <> 'reference'
       EXCEPT SELECT ds.slug FROM source_releases sr JOIN data_sources ds ON ds.id = sr.source_id
       WHERE sr.id = ANY($1::uuid[])`,
      [requestedIds],
    );
    if (required.rows.length) throw new ResolutionBuildError("REQUIRED_SOURCE_MISSING", `required source missing: ${required.rows[0]!.slug}`);

    const manifest = inputManifest(inputResult.rows);
    const inputManifestHash = sha256(canonicalJson({
      inputs: manifest,
      policyVersion: options.policyVersion,
      policyCommitSha: options.policyCommitSha,
      schemaVersion: "1",
      normalizerVersion: "1",
      containerImageDigest: options.containerImageDigest,
      locale: "C",
      timezone: "UTC",
    }));
    const existing = await client.query<{ id: string; output_hash: string; validation_summary: { assignmentCount: number; claimCount: number } }>(
      `SELECT id, output_hash, validation_summary FROM resolution_runs
       WHERE input_manifest_hash = $1 AND policy_commit_sha = $2
         AND schema_version = '1' AND normalizer_version = '1'
         AND status IN ('validated', 'active', 'retired')
       ORDER BY completed_at DESC LIMIT 1`,
      [inputManifestHash, options.policyCommitSha],
    );
    if (existing.rows[0]) {
      return {
        status: "already_built", resolutionRunId: existing.rows[0].id,
        inputManifestHash, outputHash: existing.rows[0].output_hash,
        assignmentCount: existing.rows[0].validation_summary.assignmentCount,
        claimCount: existing.rows[0].validation_summary.claimCount,
        conflicts: [],
      };
    }

    const recordsResult = await client.query<SourceRecordRow>(
      `SELECT r.id, r.source_release_id, ds.slug AS source_slug, ds.source_class,
        r.record_kind, r.registry, r.prefix_bits, r.prefix_length,
        r.organization_name_display, r.organization_address_raw, r.is_private,
        r.claim_value, r.origin_type, r.verification_status, r.raw_record_hash
       FROM source_records r
       JOIN source_releases sr ON sr.id = r.source_release_id
       JOIN data_sources ds ON ds.id = sr.source_id
       WHERE r.source_release_id = ANY($1::uuid[]) AND r.record_status = 'eligible'
       ORDER BY ds.slug, r.raw_record_hash, r.id`,
      [requestedIds],
    );
    const records: ResolverRecord[] = recordsResult.rows.map((row) => ({
      id: row.id, sourceReleaseId: row.source_release_id, sourceSlug: row.source_slug,
      sourceClass: row.source_class, recordKind: row.record_kind, registry: row.registry,
      prefixBits: BigInt(row.prefix_bits), prefixLength: row.prefix_length,
      organizationName: row.organization_name_display, organizationAddress: row.organization_address_raw,
      isPrivate: row.is_private, claimValue: row.claim_value, originType: row.origin_type,
      verificationStatus: row.verification_status, rawRecordHash: row.raw_record_hash,
    }));
    const draft = resolveRecords(records);
    const runId = randomUUID();
    const validationSummary = {
      assignmentCount: draft.assignments.length,
      claimCount: draft.claims.length,
      conflictCount: draft.conflicts.length,
      conflicts: draft.conflicts,
    };
    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO resolution_runs (
          id, status, policy_version, policy_commit_sha, schema_version, normalizer_version,
          container_image_digest, input_manifest_hash, output_hash, started_at, completed_at,
          validation_summary
        ) VALUES ($1, $2, $3, $4, '1', '1', $5, $6, $7, $8, $8, $9)`,
        [runId, draft.conflicts.length ? "rejected" : "validated", options.policyVersion,
          options.policyCommitSha, options.containerImageDigest, inputManifestHash,
          draft.outputHash, now, JSON.stringify(validationSummary)],
      );
      for (const input of inputResult.rows) {
        const snapshot = configSnapshot(input);
        await client.query(
          `INSERT INTO resolution_inputs (
            resolution_run_id, source_release_id, role, freshness_status,
            source_config_snapshot, source_config_hash
          ) VALUES ($1, $2, $3, 'fresh', $4, $5)`,
          [runId, input.source_release_id, input.source_class,
            JSON.stringify(snapshot), sha256(canonicalJson(snapshot))],
        );
      }
      if (!draft.conflicts.length) await insertResolution(client, runId, draft);
      await client.query(
        `INSERT INTO audit_events (event_type, actor_id, target_type, target_id, metadata)
         VALUES ($1, 'cli:resolution-build', 'resolution_run', $2, $3)`,
        [draft.conflicts.length ? "resolution.rejected" : "resolution.validated", runId,
          JSON.stringify({ inputManifestHash, outputHash: draft.outputHash, ...validationSummary })],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    return {
      status: draft.conflicts.length ? "rejected" : "validated",
      resolutionRunId: runId, inputManifestHash, outputHash: draft.outputHash,
      assignmentCount: draft.assignments.length, claimCount: draft.claims.length,
      conflicts: draft.conflicts,
    };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [6_104_227_003]).catch(() => undefined);
    client.release();
  }
}
