import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { migrate } from "@/db/migrate";
import { sha256 } from "@/domain/canonical-json";

export const CURATED_WORST_CASE_MAC = "AABBCCDDEEFF";

export interface BenchmarkScenarios {
  officialHit: string;
  noMatch: string;
  curatedWorstCase: string;
}

function benchmarkHash(value: string): string {
  return sha256(`benchmark:${value}`);
}

export async function resetBenchmarkDatabase(pool: Pool): Promise<void> {
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await migrate(pool);
}

export async function loadBenchmarkDataset(pool: Pool, assignmentCount: number): Promise<BenchmarkScenarios> {
  if (!Number.isInteger(assignmentCount) || assignmentCount < 1 || assignmentCount > 1_000_000) {
    throw new Error("assignmentCount must be an integer from 1 to 1,000,000");
  }
  const authoritativeSourceId = randomUUID();
  const curatedSourceId = randomUUID();
  const authoritativeReleaseId = randomUUID();
  const curatedReleaseId = randomUUID();
  const runId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO data_sources (
        id, slug, name, source_class, publish_mode, adapter_key, fetch_policy,
        max_acceptable_age_seconds, required_for_activation, rights_status,
        rights_basis, distribution_scope, rights_review_reference
      ) VALUES
        ($1, 'benchmark-authoritative', 'Synthetic Benchmark Assignments', 'authoritative',
          'production', 'benchmark-v1', 'manual', 86400, true, 'owner_asserted',
          'owner_created', 'api_output', 'benchmark-only'),
        ($2, 'benchmark-curated', 'Synthetic Benchmark Claims', 'owner_curated',
          'production', 'benchmark-v1', 'manual', 86400, true, 'owner_asserted',
          'owner_created', 'api_output', 'benchmark-only')`,
      [authoritativeSourceId, curatedSourceId],
    );
    await client.query(
      `INSERT INTO source_releases (
        id, source_id, status, snapshot_kind, snapshot_complete, schema_version,
        adapter_version, normalizer_version, fetched_at, validated_at, content_hash,
        import_key, record_count, validation_report
      ) VALUES
        ($1, $2, 'valid', 'full_snapshot', true, 'benchmark-v1', 'benchmark-v1', '1',
          now(), now(), $3, $4, $5, '{"syntheticBenchmark":true}'::jsonb),
        ($6, $7, 'valid', 'full_snapshot', true, 'benchmark-v1', 'benchmark-v1', '1',
          now(), now(), $8, $9, $10, '{"syntheticBenchmark":true}'::jsonb)`,
      [authoritativeReleaseId, authoritativeSourceId, benchmarkHash(`assignments:${assignmentCount}`),
        benchmarkHash(`assignments-import:${assignmentCount}`), assignmentCount,
        curatedReleaseId, curatedSourceId, benchmarkHash(`curated:${assignmentCount + 48}`),
        benchmarkHash(`curated-import:${assignmentCount + 48}`), assignmentCount + 48],
    );
    await client.query(
      `INSERT INTO resolution_runs (
        id, status, policy_version, policy_commit_sha, schema_version,
        normalizer_version, container_image_digest, input_manifest_hash, output_hash,
        started_at, completed_at, activated_at, validation_summary
      ) VALUES ($1, 'active', 'benchmark-v1', 'synthetic-benchmark', '1', '1',
        'local-benchmark', $2, $3, now(), now(), now(),
        jsonb_build_object('syntheticBenchmark', true, 'assignmentCount', $4::integer))`,
      [runId, benchmarkHash(`input:${assignmentCount}`), benchmarkHash(`output:${assignmentCount}`), assignmentCount],
    );
    for (const [releaseId, role] of [
      [authoritativeReleaseId, "authoritative"], [curatedReleaseId, "owner_curated"],
    ] as const) {
      const snapshot = JSON.stringify({ configVersion: 1, publishMode: "production",
        rightsStatus: "owner_asserted", rightsBasis: "owner_created",
        distributionScope: "api_output", freshnessStatus: "fresh" });
      await client.query(
        `INSERT INTO resolution_inputs (
          resolution_run_id, source_release_id, role, freshness_status,
          source_config_snapshot, source_config_hash
        ) VALUES ($1, $2, $3, 'fresh', $4::jsonb, $5)`,
        [runId, releaseId, role, snapshot, benchmarkHash(`${releaseId}:${snapshot}`)],
      );
    }
    await client.query(
      `WITH generated AS MATERIALIZED (
        SELECT gen_random_uuid() AS record_id, series::bigint AS prefix_bits,
          'Benchmark Vendor ' || series::text AS organization_name,
          'sha256:' || encode(digest('assignment:' || series::text, 'sha256'), 'hex') AS record_hash
        FROM generate_series(0, $3::integer - 1) AS series
      ), inserted_records AS (
        INSERT INTO source_records (
          id, source_release_id, record_kind, record_status, registry, prefix_bits,
          prefix_length, organization_name_raw, organization_name_display, is_private,
          origin_type, rights_basis, distribution_scope, verification_status,
          evidence_reference, raw_record_hash, raw_locator
        ) SELECT record_id, $1, 'assignment', 'eligible', 'MA-L', prefix_bits, 24,
          organization_name, organization_name, false, 'owner_observation', 'owner_created',
          'api_output', 'single_observation', 'synthetic-benchmark', record_hash,
          'generated:' || prefix_bits::text
        FROM generated
        RETURNING id, prefix_bits, organization_name_display
      )
      INSERT INTO resolved_assignments (
        id, resolution_run_id, registry, prefix_bits, prefix_length,
        organization_name, is_private, attribution_status, core_source_record_id,
        core_source_slug, core_source_release_id
      ) SELECT gen_random_uuid(), $2, 'MA-L', prefix_bits, 24, organization_name_display,
        false, 'authoritative', id, 'benchmark-authoritative', $1
      FROM inserted_records`,
      [authoritativeReleaseId, runId, assignmentCount],
    );
    await client.query(
      `WITH generated AS MATERIALIZED (
        SELECT gen_random_uuid() AS record_id,
          (70368744177664::bigint + series::bigint) AS prefix_bits,
          'sha256:' || encode(digest('background-claim:' || series::text, 'sha256'), 'hex') AS record_hash
        FROM generate_series(0, $3::integer - 1) AS series
      ), inserted_records AS (
        INSERT INTO source_records (
          id, source_release_id, record_kind, record_status, prefix_bits, prefix_length,
          organization_name_raw, organization_name_display, is_private, claim_value,
          origin_type, rights_basis, distribution_scope, verification_status,
          evidence_reference, raw_record_hash, raw_locator
        ) SELECT record_id, $1, 'curated_vendor_claim', 'eligible', prefix_bits, 48,
          'Benchmark Background Claim', 'Benchmark Background Claim', false,
          '{"label":"Benchmark Background Claim"}'::jsonb, 'owner_observation',
          'owner_created', 'api_output', 'single_observation', 'synthetic-benchmark',
          record_hash, 'generated-background:' || prefix_bits::text
        FROM generated
        RETURNING id, prefix_bits
      )
      INSERT INTO resolved_claims (
        id, resolution_run_id, claim_type, prefix_bits, prefix_length, claim_value,
        organization_name, verification_status, origin_type, conflict_status,
        source_record_id, source_slug, source_release_id
      ) SELECT gen_random_uuid(), $2, 'curated_vendor_claim', prefix_bits, 48,
        '{"label":"Benchmark Background Claim"}'::jsonb, 'Benchmark Background Claim',
        'single_observation', 'owner_observation', 'not_evaluated', id,
        'benchmark-curated', $1
      FROM inserted_records`,
      [curatedReleaseId, runId, assignmentCount],
    );
    const worstCaseValue = BigInt(`0x${CURATED_WORST_CASE_MAC}`).toString();
    await client.query(
      `WITH generated AS MATERIALIZED (
        SELECT gen_random_uuid() AS record_id, length::smallint AS prefix_length,
          ($3::bigint >> (48 - length)) AS prefix_bits,
          'sha256:' || encode(digest('claim:' || length::text, 'sha256'), 'hex') AS record_hash
        FROM generate_series(1, 48) AS length
      ), inserted_records AS (
        INSERT INTO source_records (
          id, source_release_id, record_kind, record_status, prefix_bits, prefix_length,
          organization_name_raw, organization_name_display, is_private, claim_value,
          origin_type, rights_basis, distribution_scope, verification_status,
          evidence_reference, raw_record_hash, raw_locator
        ) SELECT record_id, $1, 'curated_vendor_claim', 'eligible', prefix_bits,
          prefix_length, 'Benchmark Worst Case', 'Benchmark Worst Case', false,
          '{"label":"Benchmark Worst Case"}'::jsonb, 'owner_observation',
          'owner_created', 'api_output', 'single_observation', 'synthetic-benchmark',
          record_hash, 'generated-worst-case:' || prefix_length::text
        FROM generated
        RETURNING id, prefix_bits, prefix_length
      )
      INSERT INTO resolved_claims (
        id, resolution_run_id, claim_type, prefix_bits, prefix_length, claim_value,
        organization_name, verification_status, origin_type, conflict_status,
        source_record_id, source_slug, source_release_id
      ) SELECT gen_random_uuid(), $2, 'curated_vendor_claim', prefix_bits, prefix_length,
        '{"label":"Benchmark Worst Case"}'::jsonb, 'Benchmark Worst Case',
        'single_observation', 'owner_observation', 'not_evaluated', id,
        'benchmark-curated', $1
      FROM inserted_records`,
      [curatedReleaseId, runId, worstCaseValue],
    );
    await client.query(
      `INSERT INTO active_resolution (
        singleton_id, resolution_run_id, version, publication_version, updated_at, updated_by
      ) VALUES (1, $1, 1, 1, now(), 'benchmark-harness')`,
      [runId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await pool.query("ANALYZE resolved_assignments");
  await pool.query("ANALYZE resolved_claims");
  await pool.query("ANALYZE publication_suppressions");
  const hitPrefix = BigInt(Math.floor(assignmentCount / 2));
  return {
    officialHit: ((hitPrefix << 24n) | 1n).toString(16).toUpperCase().padStart(12, "0"),
    noMatch: "FFFFFF000001",
    curatedWorstCase: CURATED_WORST_CASE_MAC,
  };
}
