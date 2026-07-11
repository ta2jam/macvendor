import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { canonicalJson, sha256 } from "@/domain/canonical-json";
import { ImportValidationError } from "./errors";
import { loadManifest } from "./manifest";
import { parseArtifact } from "./artifact";
import type { ParsedSourceRecord, SourceManifest } from "./types";

interface DiffReport {
  baselineReleaseId: string | null;
  previousCount: number;
  currentCount: number;
  addedCount: number;
  removedCount: number;
  addedPercent: number;
  removedPercent: number;
  status: "initial" | "passed" | "not_applicable";
}

function sourceConfig(manifest: SourceManifest) {
  return {
    slug: manifest.source.slug,
    name: manifest.source.name,
    sourceClass: manifest.source.class,
    publishMode: manifest.source.publishMode,
    adapterKey: manifest.source.adapterKey,
    fetchPolicy: manifest.source.fetchPolicy ?? "manual",
    fetchIntervalSeconds: manifest.source.fetchIntervalSeconds ?? null,
    maxAcceptableAgeSeconds: manifest.source.maxAcceptableAgeSeconds ?? null,
    requiredForActivation: manifest.source.requiredForActivation,
    homepageUrl: manifest.source.homepageUrl ?? null,
    termsUrl: manifest.source.termsUrl ?? null,
    rightsStatus: manifest.source.rights.status,
    rightsBasis: manifest.source.rights.basis,
    distributionScope: manifest.source.rights.distributionScope,
    rightsReviewReference: manifest.source.rights.reviewReference ?? null,
    rightsReviewExpiresAt: manifest.source.rights.reviewExpiresAt ?? null,
    fetchOrigins: manifest.artifact.remote?.allowedOrigins ?? [],
    signatureKeySha256: manifest.artifact.signature?.publicKeySha256 ?? null,
    diffPolicy: manifest.release.diffPolicy ?? null,
  };
}

async function ensureSource(client: PoolClient, manifest: SourceManifest): Promise<string> {
  const config = sourceConfig(manifest);
  const existing = await client.query<{ id: string; config: Record<string, unknown> }>(
    `SELECT id, jsonb_build_object(
      'slug', slug, 'name', name, 'sourceClass', source_class, 'publishMode', publish_mode,
      'adapterKey', adapter_key, 'fetchPolicy', fetch_policy,
      'fetchIntervalSeconds', fetch_interval_seconds,
      'maxAcceptableAgeSeconds', max_acceptable_age_seconds,
      'requiredForActivation', required_for_activation,
      'homepageUrl', homepage_url, 'termsUrl', terms_url, 'rightsStatus', rights_status,
      'rightsBasis', rights_basis, 'distributionScope', distribution_scope,
      'rightsReviewReference', rights_review_reference,
      'rightsReviewExpiresAt', CASE WHEN rights_review_expires_at IS NULL THEN NULL ELSE to_char(rights_review_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
      'fetchOrigins', fetch_origins, 'signatureKeySha256', signature_key_sha256,
      'diffPolicy', diff_policy
    ) AS config FROM data_sources WHERE slug = $1`,
    [manifest.source.slug],
  );
  if (existing.rows[0]) {
    if (canonicalJson(existing.rows[0].config) !== canonicalJson(config)) {
      throw new ImportValidationError("SOURCE_CONFIG_MISMATCH", "existing source configuration differs; governance update is required before import");
    }
    return existing.rows[0].id;
  }
  const id = randomUUID();
  await client.query(
    `INSERT INTO data_sources (
      id, slug, name, source_class, publish_mode, adapter_key, fetch_policy,
      fetch_interval_seconds, max_acceptable_age_seconds,
      required_for_activation, homepage_url, terms_url, rights_status, rights_basis,
      distribution_scope, rights_review_reference, rights_review_expires_at,
      fetch_origins, signature_key_sha256, diff_policy
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
    [id, config.slug, config.name, config.sourceClass, config.publishMode, config.adapterKey,
      config.fetchPolicy, config.fetchIntervalSeconds, config.maxAcceptableAgeSeconds,
      config.requiredForActivation, config.homepageUrl, config.termsUrl, config.rightsStatus,
      config.rightsBasis, config.distributionScope, config.rightsReviewReference, config.rightsReviewExpiresAt,
      JSON.stringify(config.fetchOrigins), config.signatureKeySha256, JSON.stringify(config.diffPolicy)],
  );
  return id;
}

async function insertRecordChunk(client: PoolClient, sourceReleaseId: string, records: ParsedSourceRecord[]): Promise<void> {
  const payload = records.map((record) => ({
    id: randomUUID(), record_kind: record.recordKind, record_status: record.recordStatus,
    registry: record.registry, prefix_bits: record.prefixBits.toString(), prefix_length: record.prefixLength,
    organization_name_raw: record.organizationName, organization_name_display: record.organizationName,
    organization_address_raw: record.organizationAddress, is_private: record.isPrivate,
    claim_value: record.claimValue, origin_type: record.originType, rights_basis: record.rightsBasis,
    distribution_scope: record.distributionScope, verification_status: record.verificationStatus,
    reviewed_by: record.reviewedBy,
    evidence_reference: record.evidenceReference ?? record.privacyReviewReference,
    observed_at: record.observedAt, raw_record_hash: record.rawRecordHash, raw_locator: record.rawLocator,
  }));
  await client.query(
    `INSERT INTO source_records (
      id, source_release_id, record_kind, record_status, registry, prefix_bits, prefix_length,
      organization_name_raw, organization_name_display, organization_address_raw, is_private,
      claim_value, origin_type, rights_basis, distribution_scope, verification_status,
      evidence_reference, reviewed_by, observed_at, raw_record_hash, raw_locator
    ) SELECT x.id, $1, x.record_kind, x.record_status, x.registry, x.prefix_bits::bigint,
      x.prefix_length, x.organization_name_raw, x.organization_name_display,
      x.organization_address_raw, x.is_private, x.claim_value, x.origin_type,
      x.rights_basis, x.distribution_scope, x.verification_status,
      x.evidence_reference, x.reviewed_by, x.observed_at, x.raw_record_hash, x.raw_locator
    FROM jsonb_to_recordset($2::jsonb) AS x(
      id uuid, record_kind text, record_status text, registry text, prefix_bits text,
      prefix_length smallint, organization_name_raw text, organization_name_display text,
      organization_address_raw text, is_private boolean, claim_value jsonb,
      origin_type text, rights_basis text, distribution_scope text,
      verification_status text, evidence_reference text, reviewed_by text, observed_at timestamptz,
      raw_record_hash text, raw_locator text
    )`,
    [sourceReleaseId, JSON.stringify(payload)],
  );
}

async function validateReleaseDiff(
  client: PoolClient,
  sourceId: string,
  records: ParsedSourceRecord[],
  manifest: SourceManifest,
): Promise<DiffReport> {
  const current = new Set(records.map((record) => record.rawRecordHash));
  if (manifest.release.snapshotKind === "delta") {
    return {
      baselineReleaseId: null, previousCount: 0, currentCount: current.size,
      addedCount: 0, removedCount: 0, addedPercent: 0, removedPercent: 0, status: "not_applicable",
    };
  }
  const previousRelease = await client.query<{ id: string }>(
    `SELECT id FROM source_releases WHERE source_id = $1 AND status = 'valid'
     ORDER BY validated_at DESC, id DESC LIMIT 1`,
    [sourceId],
  );
  if (!previousRelease.rows[0]) {
    return {
      baselineReleaseId: null, previousCount: 0, currentCount: current.size,
      addedCount: current.size, removedCount: 0, addedPercent: 0, removedPercent: 0, status: "initial",
    };
  }
  const previousRows = await client.query<{ raw_record_hash: string }>(
    "SELECT raw_record_hash FROM source_records WHERE source_release_id = $1 AND record_status IN ('eligible', 'qa_only')",
    [previousRelease.rows[0].id],
  );
  const previous = new Set(previousRows.rows.map((row) => row.raw_record_hash));
  const addedCount = [...current].filter((hash) => !previous.has(hash)).length;
  const removedCount = [...previous].filter((hash) => !current.has(hash)).length;
  const addedPercent = previous.size ? (addedCount / previous.size) * 100 : 0;
  const removedPercent = previous.size ? (removedCount / previous.size) * 100 : 0;
  const report: DiffReport = {
    baselineReleaseId: previousRelease.rows[0].id,
    previousCount: previous.size,
    currentCount: current.size,
    addedCount,
    removedCount,
    addedPercent: Number(addedPercent.toFixed(6)),
    removedPercent: Number(removedPercent.toFixed(6)),
    status: "passed",
  };
  const policy = manifest.release.diffPolicy;
  if (policy && (addedPercent > policy.maxAddedPercent || removedPercent > policy.maxRemovedPercent)) {
    throw new ImportValidationError(
      "RELEASE_DIFF_EXCEEDED",
      `release diff exceeds policy: added=${report.addedPercent}% removed=${report.removedPercent}%`,
    );
  }
  return report;
}

export interface ImportResult {
  status: "imported" | "already_imported";
  sourceReleaseId: string;
  recordCount: number;
  importKey: string;
  contentHash: string;
}

export async function importSourceRelease(pool: Pool, manifestPath: string): Promise<ImportResult> {
  const manifest = await loadManifest(manifestPath);
  if (manifest.source.publishMode === "disabled") {
    throw new ImportValidationError("SOURCE_DISABLED", "disabled sources cannot be imported");
  }
  const artifact = await parseArtifact(manifest, manifestPath);
  const manifestHash = sha256(canonicalJson(manifest));
  const importKey = sha256(canonicalJson({
    source: manifest.source.slug,
    artifact: artifact.contentHash,
    manifest: manifestHash,
    schemaVersion: manifest.release.schemaVersion,
    adapterVersion: manifest.release.adapterVersion,
    normalizerVersion: manifest.release.normalizerVersion,
  }));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [manifest.source.slug]);
    const sourceId = await ensureSource(client, manifest);
    const existing = await client.query<{ id: string; record_count: number }>(
      "SELECT id, record_count FROM source_releases WHERE source_id = $1 AND import_key = $2",
      [sourceId, importKey],
    );
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return {
        status: "already_imported", sourceReleaseId: existing.rows[0].id,
        recordCount: existing.rows[0].record_count, importKey, contentHash: artifact.contentHash,
      };
    }

    const diff = await validateReleaseDiff(client, sourceId, artifact.records, manifest);

    const sourceReleaseId = randomUUID();
    const now = new Date();
    await client.query(
      `INSERT INTO source_releases (
        id, source_id, status, snapshot_kind, snapshot_complete, schema_version,
        adapter_version, normalizer_version, fetched_at, validated_at, content_hash,
        import_key, record_count, rejected_record_count, validation_report
      ) VALUES ($1, $2, 'valid', $3, $4, $5, $6, $7, $8, $8, $9, $10, $11, 0, $12)`,
      [sourceReleaseId, sourceId, manifest.release.snapshotKind, manifest.release.snapshotComplete,
        manifest.release.schemaVersion, manifest.release.adapterVersion, manifest.release.normalizerVersion,
        now, artifact.contentHash, importKey, artifact.records.length,
        JSON.stringify({ manifestHash, limits: { artifactBytes: artifact.byteSize },
          signature: { status: manifest.artifact.signatureStatus, publicKeySha256: artifact.signatureKeyHash },
          adapterWarnings: artifact.adapterWarnings, diff, validation: "passed" })],
    );
    await client.query(
      `INSERT INTO source_artifacts (
        source_release_id, dataset_key, source_url, source_repo_path, sha256, byte_size, mime_type,
        storage_key, source_signature_status
      ) VALUES ($1, 'primary', $2, $3, $4, $5, $6, $7, $8)`,
      [sourceReleaseId, manifest.artifact.remote?.url ?? null,
        manifest.artifact.remote ? null : manifest.artifact.path,
        artifact.contentHash, artifact.byteSize, artifact.mimeType,
        `local/${artifact.contentHash.slice(7)}`, manifest.artifact.signatureStatus],
    );
    for (let offset = 0; offset < artifact.records.length; offset += 1_000) {
      await insertRecordChunk(client, sourceReleaseId, artifact.records.slice(offset, offset + 1_000));
    }
    await client.query(
      `INSERT INTO audit_events (event_type, actor_id, target_type, target_id, metadata)
       VALUES ('source_release.imported', 'cli:source-import', 'source_release', $1, $2)`,
      [sourceReleaseId, JSON.stringify({ sourceSlug: manifest.source.slug, importKey, contentHash: artifact.contentHash })],
    );
    await client.query("COMMIT");
    return { status: "imported", sourceReleaseId, recordCount: artifact.records.length, importKey, contentHash: artifact.contentHash };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
