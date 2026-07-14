import type { Pool, PoolClient } from "pg";
import { formatPrefix, type NormalizedMac } from "@/domain/mac";
import type { CuratedMatch, LookupInsight } from "@/domain/types";
import { ACTIVE_SUPPRESSION_SQL, assignmentSuppressionTargetSql } from "./suppression-match";
import { claimSuppressionTargetSql } from "./suppression-match";

interface BulkRow {
  normalized_mac: string;
  resolution_run_id: string;
  active_version: string;
  publication_version: string;
  policy_version: string;
  generated_at: Date;
  registry: string | null;
  prefix_bits: string | null;
  prefix_length: number | null;
  organization_name: string | null;
  organization_address: string | null;
  source_slug: string | null;
  source_release_id: string | null;
}

interface BulkCuratedRow {
  normalized_mac: string;
  claim_id: string;
  prefix_bits: string;
  prefix_length: number;
  organization_name: string;
  verification_status: CuratedMatch["verificationStatus"];
  origin_type: CuratedMatch["originType"];
  conflict_status: CuratedMatch["conflictStatus"];
  source_slug: string;
  source_release_id: string;
}

interface BulkInsightRow {
  normalized_mac: string;
  claim_id: string;
  prefix_bits: string;
  prefix_length: number;
  claim_type: LookupInsight["claimType"];
  claim_value: Record<string, unknown>;
  organization_name: string | null;
  verification_status: LookupInsight["verificationStatus"];
  source_slug: string;
  source_release_id: string;
}

const BULK_LOOKUP_SQL = `
  WITH active AS (
    SELECT ar.resolution_run_id, ar.version, ar.publication_version, rr.policy_version, rr.completed_at
    FROM active_resolution ar JOIN resolution_runs rr ON rr.id = ar.resolution_run_id
    WHERE ar.singleton_id = 1 AND rr.status = 'active'
  ), inputs AS (
    SELECT * FROM unnest($1::text[], $2::bigint[]) AS input(normalized_mac, mac_value)
  )
  SELECT input.normalized_mac, a.resolution_run_id, a.version AS active_version,
    a.publication_version, a.policy_version, a.completed_at AS generated_at,
    match.registry, match.prefix_bits, match.prefix_length, match.organization_name,
    match.organization_address, match.core_source_slug AS source_slug,
    match.core_source_release_id AS source_release_id
  FROM inputs input CROSS JOIN active a
  LEFT JOIN LATERAL (
    SELECT ra.*
    FROM (VALUES
      (36::smallint, input.mac_value >> 12),
      (28::smallint, input.mac_value >> 20),
      (24::smallint, input.mac_value >> 24)
    ) candidate(prefix_length, prefix_bits)
    JOIN resolved_assignments ra ON ra.resolution_run_id = a.resolution_run_id
      AND ra.prefix_length = candidate.prefix_length AND ra.prefix_bits = candidate.prefix_bits
    WHERE ra.registry <> 'CID' AND NOT EXISTS (
      SELECT 1 FROM publication_suppressions ps
      WHERE ${ACTIVE_SUPPRESSION_SQL}
        AND ${assignmentSuppressionTargetSql("ra", "a")}
    )
    ORDER BY ra.prefix_length DESC LIMIT 1
  ) match ON true
  ORDER BY input.normalized_mac
`;

const BULK_CURATED_SQL = `
  WITH active AS (
    SELECT ar.resolution_run_id, ar.publication_version
    FROM active_resolution ar JOIN resolution_runs rr ON rr.id = ar.resolution_run_id
    WHERE ar.singleton_id = 1 AND rr.status = 'active'
  ), inputs AS (
    SELECT * FROM unnest($1::text[], $2::bigint[]) AS input(normalized_mac, mac_value)
  )
  SELECT input.normalized_mac, match.id AS claim_id, match.prefix_bits,
    match.prefix_length, match.organization_name, match.verification_status,
    match.origin_type, match.conflict_status, match.source_slug, match.source_release_id
  FROM inputs input CROSS JOIN active a
  JOIN LATERAL (
    SELECT rc.*
    FROM generate_series(1, 48) AS candidate(prefix_length)
    JOIN resolved_claims rc ON rc.resolution_run_id = a.resolution_run_id
      AND rc.prefix_length = candidate.prefix_length
      AND rc.prefix_bits = input.mac_value >> (48 - candidate.prefix_length)
    WHERE rc.claim_type = 'curated_vendor_claim'
      AND NOT EXISTS (
        SELECT 1 FROM publication_suppressions ps
        WHERE ${ACTIVE_SUPPRESSION_SQL}
          AND ${claimSuppressionTargetSql("rc", "a")}
      )
    ORDER BY rc.prefix_length DESC,
      CASE rc.verification_status
        WHEN 'reviewed' THEN 1 WHEN 'corroborated' THEN 2
        WHEN 'single_observation' THEN 3 ELSE 4
      END,
      rc.source_slug ASC, rc.id ASC
    LIMIT 21
  ) match ON true
  ORDER BY input.normalized_mac, match.prefix_length DESC,
    CASE match.verification_status
      WHEN 'reviewed' THEN 1 WHEN 'corroborated' THEN 2
      WHEN 'single_observation' THEN 3 ELSE 4
    END,
    match.source_slug ASC, match.id ASC
`;

const BULK_INSIGHTS_SQL = `
  WITH active AS (
    SELECT ar.resolution_run_id, ar.publication_version
    FROM active_resolution ar JOIN resolution_runs rr ON rr.id = ar.resolution_run_id
    WHERE ar.singleton_id = 1 AND rr.status = 'active'
  ), inputs AS (
    SELECT * FROM unnest($1::text[], $2::bigint[]) AS input(normalized_mac, mac_value)
  )
  SELECT input.normalized_mac, match.id AS claim_id, match.prefix_bits,
    match.prefix_length, match.claim_type, match.claim_value,
    match.organization_name, match.verification_status, match.source_slug,
    match.source_release_id
  FROM inputs input CROSS JOIN active a
  JOIN LATERAL (
    SELECT rc.*
    FROM generate_series(1, 48) AS candidate(prefix_length)
    JOIN resolved_claims rc ON rc.resolution_run_id = a.resolution_run_id
      AND rc.prefix_length = candidate.prefix_length
      AND rc.prefix_bits = input.mac_value >> (48 - candidate.prefix_length)
    WHERE rc.claim_type IN ('vendor_alias', 'device_hint', 'usage_note')
      AND NOT EXISTS (
        SELECT 1 FROM publication_suppressions ps
        WHERE ${ACTIVE_SUPPRESSION_SQL}
          AND ${claimSuppressionTargetSql("rc", "a")}
      )
    ORDER BY rc.prefix_length DESC,
      CASE rc.verification_status
        WHEN 'reviewed' THEN 1 WHEN 'corroborated' THEN 2
        WHEN 'single_observation' THEN 3 ELSE 4
      END,
      rc.claim_type, rc.source_slug, rc.id
    LIMIT 51
  ) match ON true
  ORDER BY input.normalized_mac, match.prefix_length DESC,
    CASE match.verification_status
      WHEN 'reviewed' THEN 1 WHEN 'corroborated' THEN 2
      WHEN 'single_observation' THEN 3 ELSE 4
    END,
    match.claim_type, match.source_slug, match.id
`;

type Queryable = Pick<PoolClient, "query">;

function uniqueInputs(macs: NormalizedMac[]) {
  const unique = [...new Map(macs.map((mac) => [mac.normalized, mac])).values()];
  return {
    unique,
    values: [unique.map((mac) => mac.normalized), unique.map((mac) => mac.value.toString())],
  };
}

async function queryBulkOfficial(queryable: Queryable, macs: NormalizedMac[]) {
  const { values } = uniqueInputs(macs);
  const result = await queryable.query<BulkRow>(BULK_LOOKUP_SQL, values);
  const byMac = new Map(result.rows.map((row) => [row.normalized_mac, row]));
  return macs.map((mac) => {
    const row = byMac.get(mac.normalized);
    if (!row) throw new Error("active data release is unavailable");
    return {
      normalizedMac: mac.normalized,
      matchStatus: row.registry ? "matched" as const : "no_match" as const,
      assignment: row.registry && row.prefix_bits && row.prefix_length
        ? {
            prefix: formatPrefix(BigInt(row.prefix_bits), row.prefix_length),
            prefixLength: row.prefix_length,
            registry: row.registry,
            organizationName: row.organization_name,
            address: row.organization_address,
            source: { slug: row.source_slug!, sourceReleaseId: `sr_${row.source_release_id}` },
          }
        : null,
      release: {
        resolvedReleaseId: `rr_${row.resolution_run_id}`,
        activeVersion: Number(row.active_version),
        publicationVersion: Number(row.publication_version),
        policyVersion: row.policy_version,
        generatedAt: row.generated_at.toISOString(),
      },
    };
  });
}

export async function bulkLookupOfficial(pool: Pool, macs: NormalizedMac[]) {
  return queryBulkOfficial(pool, macs);
}

export async function bulkLookupEnriched(pool: Pool, macs: NormalizedMac[]) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { values } = uniqueInputs(macs);
    const official = await queryBulkOfficial(client, macs);
    const curatedResult = await client.query<BulkCuratedRow>(BULK_CURATED_SQL, values);
    const insightResult = await client.query<BulkInsightRow>(BULK_INSIGHTS_SQL, values);

    const curatedByMac = new Map<string, CuratedMatch[]>();
    for (const row of curatedResult.rows) {
      const matches = curatedByMac.get(row.normalized_mac) ?? [];
      matches.push({
        claimId: `clm_${row.claim_id}`,
        prefix: formatPrefix(BigInt(row.prefix_bits), row.prefix_length),
        prefixLength: row.prefix_length,
        claimType: "vendor_label",
        organizationName: row.organization_name,
        verificationStatus: row.verification_status,
        originType: row.origin_type,
        conflictStatus: row.conflict_status,
        source: { slug: row.source_slug, sourceReleaseId: `sr_${row.source_release_id}` },
      });
      curatedByMac.set(row.normalized_mac, matches);
    }

    const insightsByMac = new Map<string, LookupInsight[]>();
    for (const row of insightResult.rows) {
      const insights = insightsByMac.get(row.normalized_mac) ?? [];
      insights.push({
        claimId: `clm_${row.claim_id}`,
        prefix: formatPrefix(BigInt(row.prefix_bits), row.prefix_length),
        prefixLength: row.prefix_length,
        claimType: row.claim_type,
        organizationName: row.organization_name,
        details: row.claim_value,
        verificationStatus: row.verification_status,
        source: { slug: row.source_slug, sourceReleaseId: `sr_${row.source_release_id}` },
      });
      insightsByMac.set(row.normalized_mac, insights);
    }

    await client.query("COMMIT");
    return official.map((item) => {
      const allCurated = curatedByMac.get(item.normalizedMac) ?? [];
      const allInsights = insightsByMac.get(item.normalizedMac) ?? [];
      return {
        ...item,
        curatedMatches: allCurated.slice(0, 20),
        curatedMatchesTruncated: allCurated.length > 20,
        insights: allInsights.slice(0, 50),
        insightsTruncated: allInsights.length > 50,
      };
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
