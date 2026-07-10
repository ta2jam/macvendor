import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { prefixBits } from "@/domain/mac";

function sha(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function insertSource(client: PoolClient, values: {
  slug: string;
  name: string;
  sourceClass: "authoritative" | "owner_curated";
}) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO data_sources (
      id, slug, name, source_class, publish_mode, adapter_key, fetch_policy,
      required_for_activation, rights_status, rights_basis, distribution_scope,
      rights_review_reference
    ) VALUES ($1, $2, $3, $4, 'production', 'demo-v1', 'manual', true,
      'owner_asserted', 'owner_created', 'api_output', 'local-demo-only')`,
    [id, values.slug, values.name, values.sourceClass],
  );
  return id;
}

async function insertRelease(client: PoolClient, sourceId: string, key: string, recordCount: number) {
  const id = randomUUID();
  const now = new Date();
  await client.query(
    `INSERT INTO source_releases (
      id, source_id, status, snapshot_kind, snapshot_complete, schema_version,
      adapter_version, normalizer_version, fetched_at, validated_at, content_hash,
      import_key, record_count, validation_report
    ) VALUES ($1, $2, 'valid', 'full_snapshot', true, '1', 'demo-v1', '1',
      $3, $3, $4, $5, $6, '{"demo":true}'::jsonb)`,
    [id, sourceId, now, sha(`${key}:content`), sha(`${key}:import`), recordCount],
  );
  return id;
}

export async function seedDemo(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT 1 FROM data_sources WHERE slug = 'demo-authoritative'");
    if (existing.rowCount) {
      await client.query("ROLLBACK");
      return;
    }

    const authoritativeSourceId = await insertSource(client, {
      slug: "demo-authoritative",
      name: "Local Demo Assignment Registry",
      sourceClass: "authoritative",
    });
    const curatedSourceId = await insertSource(client, {
      slug: "demo-curated",
      name: "Local Demo Curated Database",
      sourceClass: "owner_curated",
    });
    const authoritativeReleaseId = await insertRelease(client, authoritativeSourceId, "authoritative", 1);
    const curatedReleaseId = await insertRelease(client, curatedSourceId, "curated", 1);

    const officialMac = BigInt("0x02AABB000000");
    const curatedMac = BigInt("0x02AABBCC0000");
    const officialBits = prefixBits(officialMac, 24);
    const curatedBits = prefixBits(curatedMac, 32);
    const officialRecordId = randomUUID();
    const curatedRecordId = randomUUID();

    await client.query(
      `INSERT INTO source_records (
        id, source_release_id, record_kind, record_status, registry, prefix_bits,
        prefix_length, organization_name_raw, organization_name_display, is_private,
        origin_type, rights_basis, distribution_scope, verification_status,
        evidence_reference, created_by, raw_record_hash, raw_locator
      ) VALUES ($1, $2, 'assignment', 'eligible', 'MA-L', $3, 24,
        'Example Networks Lab', 'Example Networks Lab', false, 'owner_observation',
        'owner_created', 'api_output', 'reviewed', 'local-demo', 'seed:v0.0.1', $4, 'row:1')`,
      [officialRecordId, authoritativeReleaseId, officialBits.toString(), sha("official-row")],
    );
    await client.query(
      `INSERT INTO source_records (
        id, source_release_id, record_kind, record_status, prefix_bits, prefix_length,
        organization_name_raw, organization_name_display, is_private, claim_value,
        origin_type, rights_basis, distribution_scope, verification_status,
        evidence_reference, created_by, raw_record_hash, raw_locator
      ) VALUES ($1, $2, 'curated_vendor_claim', 'eligible', $3, 32,
        'Example Devices Community', 'Example Devices Community', false,
        '{"label":"Example Devices Community"}'::jsonb, 'owner_observation',
        'owner_created', 'api_output', 'corroborated', 'local-demo', 'seed:v0.0.1', $4, 'row:1')`,
      [curatedRecordId, curatedReleaseId, curatedBits.toString(), sha("curated-row")],
    );

    const runId = randomUUID();
    const now = new Date();
    await client.query(
      `INSERT INTO resolution_runs (
        id, status, policy_version, policy_commit_sha, schema_version,
        normalizer_version, container_image_digest, input_manifest_hash, output_hash,
        started_at, completed_at, activated_at, validation_summary
      ) VALUES ($1, 'active', 'v0.0.1', 'local-seed', '1', '1', 'local', $2, $3,
        $4, $4, $4, '{"demo":true,"validated":true}'::jsonb)`,
      [runId, sha("demo-input-manifest"), sha("demo-output"), now],
    );

    const configSnapshot = {
      publishMode: "production",
      rightsStatus: "owner_asserted",
      distributionScope: "api_output",
      configVersion: 1,
      freshnessStatus: "fresh",
    };
    for (const [releaseId, role] of [[authoritativeReleaseId, "authoritative"], [curatedReleaseId, "owner_curated"]] as const) {
      const snapshot = JSON.stringify(configSnapshot);
      await client.query(
        `INSERT INTO resolution_inputs (
          resolution_run_id, source_release_id, role, freshness_status,
          source_config_snapshot, source_config_hash
        ) VALUES ($1, $2, $3, 'fresh', $4::jsonb, $5)`,
        [runId, releaseId, role, snapshot, sha(snapshot)],
      );
    }

    const assignmentId = randomUUID();
    await client.query(
      `INSERT INTO resolved_assignments (
        id, resolution_run_id, registry, prefix_bits, prefix_length,
        organization_name, is_private, attribution_status, core_source_record_id,
        core_source_slug, core_source_release_id
      ) VALUES ($1, $2, 'MA-L', $3, 24, 'Example Networks Lab', false,
        'authoritative', $4, 'demo-authoritative', $5)`,
      [assignmentId, runId, officialBits.toString(), officialRecordId, authoritativeReleaseId],
    );
    const claimId = randomUUID();
    await client.query(
      `INSERT INTO resolved_claims (
        id, resolution_run_id, claim_type, prefix_bits, prefix_length, claim_value,
        organization_name, verification_status, origin_type, conflict_status,
        source_record_id, source_slug, source_release_id
      ) VALUES ($1, $2, 'curated_vendor_claim', $3, 32,
        '{"label":"Example Devices Community"}'::jsonb, 'Example Devices Community',
        'corroborated', 'owner_observation', 'agrees', $4, 'demo-curated', $5)`,
      [claimId, runId, curatedBits.toString(), curatedRecordId, curatedReleaseId],
    );
    await client.query(
      `INSERT INTO resolution_evidence (
        resolution_run_id, resolved_assignment_id, field_name, source_record_id, role, reason_code
      ) VALUES ($1, $2, 'organization_name', $3, 'selected', 'longest_prefix_authoritative')`,
      [runId, assignmentId, officialRecordId],
    );
    await client.query(
      `INSERT INTO resolution_evidence (
        resolution_run_id, resolved_claim_id, field_name, source_record_id, role, reason_code
      ) VALUES ($1, $2, 'organization_name', $3, 'selected', 'owner_curated_claim')`,
      [runId, claimId, curatedRecordId],
    );
    await client.query(
      `INSERT INTO active_resolution (
        singleton_id, resolution_run_id, version, publication_version, updated_at, updated_by
      ) VALUES (1, $1, 1, 1, $2, 'seed:v0.0.1')`,
      [runId, now],
    );
    await client.query(
      `INSERT INTO audit_events (event_type, actor_id, target_type, target_id, metadata)
       VALUES ('resolution.activated', 'seed:v0.0.1', 'resolution_run', $1, '{"demo":true}'::jsonb)`,
      [runId],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
