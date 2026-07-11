import type { Pool } from "pg";
import { formatPrefix, type NormalizedMac, type Registry } from "@/domain/mac";
import type { Assignment, CuratedMatch, LookupResult, ReleaseData } from "@/domain/types";

export class DataReleaseUnavailableError extends Error {
  constructor() {
    super("No active validated data release is available.");
    this.name = "DataReleaseUnavailableError";
  }
}

interface LookupRow {
  resolution_run_id: string;
  active_version: string;
  publication_version: string;
  policy_version: string;
  generated_at: Date;
  assignment_registry: string | null;
  assignment_prefix_bits: string | null;
  assignment_prefix_length: number | null;
  assignment_organization_name: string | null;
  assignment_address: string | null;
  assignment_source_slug: string | null;
  assignment_source_release_id: string | null;
  claim_id: string | null;
  claim_prefix_bits: string | null;
  claim_prefix_length: number | null;
  claim_organization_name: string | null;
  claim_verification_status: CuratedMatch["verificationStatus"] | null;
  claim_origin_type: CuratedMatch["originType"] | null;
  claim_conflict_status: CuratedMatch["conflictStatus"] | null;
  claim_source_slug: string | null;
  claim_source_release_id: string | null;
}

const ACTIVE_SUPPRESSION = `
  ps.status = 'active'
  AND ps.starts_at <= now()
  AND (ps.expires_at IS NULL OR ps.expires_at > now())
`;

export const LOOKUP_SQL = `
  WITH active AS (
    SELECT ar.resolution_run_id, ar.version, ar.publication_version,
           rr.policy_version, rr.completed_at
    FROM active_resolution ar
    JOIN resolution_runs rr ON rr.id = ar.resolution_run_id
    WHERE ar.singleton_id = 1 AND rr.status = 'active'
  ), assignment_candidates (prefix_length, prefix_bits) AS (
    VALUES
      (36::smallint, ($1::bigint >> 12)),
      (28::smallint, ($1::bigint >> 20)),
      (24::smallint, ($1::bigint >> 24))
  ), assignment_match AS (
    SELECT ra.*
    FROM active a
    JOIN assignment_candidates candidate ON true
    JOIN resolved_assignments ra
      ON ra.resolution_run_id = a.resolution_run_id
      AND ra.prefix_length = candidate.prefix_length
      AND ra.prefix_bits = candidate.prefix_bits
    WHERE ra.registry <> 'CID'
      AND NOT EXISTS (
        SELECT 1 FROM publication_suppressions ps
        WHERE ${ACTIVE_SUPPRESSION}
          AND (
            ps.resolved_assignment_id = ra.id
            OR (
              ps.resolved_assignment_id IS NULL
              AND ps.resolved_claim_id IS NULL
              AND (ps.resolution_run_id IS NULL OR ps.resolution_run_id = a.resolution_run_id)
              AND ps.prefix_bits = ra.prefix_bits
              AND ps.prefix_length = ra.prefix_length
              AND ps.surface IN ('official', 'both')
              AND (ps.source_slug IS NULL OR ps.source_slug = ra.core_source_slug)
            )
          )
      )
    ORDER BY ra.prefix_length DESC
    LIMIT 1
  ), claim_candidates AS (
    SELECT prefix_length::smallint AS prefix_length,
      ($1::bigint >> (48 - prefix_length)) AS prefix_bits
    FROM generate_series(1, 48) AS prefix_length
  ), claim_matches AS (
    SELECT rc.*
    FROM active a
    JOIN claim_candidates candidate ON true
    JOIN resolved_claims rc
      ON rc.resolution_run_id = a.resolution_run_id
      AND rc.prefix_length = candidate.prefix_length
      AND rc.prefix_bits = candidate.prefix_bits
    WHERE $2::boolean = false
      AND rc.claim_type = 'curated_vendor_claim'
      AND NOT EXISTS (
        SELECT 1 FROM publication_suppressions ps
        WHERE ${ACTIVE_SUPPRESSION}
          AND (
            ps.resolved_claim_id = rc.id
            OR (
              ps.resolved_assignment_id IS NULL
              AND ps.resolved_claim_id IS NULL
              AND (ps.resolution_run_id IS NULL OR ps.resolution_run_id = a.resolution_run_id)
              AND ps.prefix_bits = rc.prefix_bits
              AND ps.prefix_length = rc.prefix_length
              AND ps.surface IN ('curated', 'both')
              AND (ps.source_slug IS NULL OR ps.source_slug = rc.source_slug)
            )
          )
      )
    ORDER BY rc.prefix_length DESC,
      CASE rc.verification_status
        WHEN 'reviewed' THEN 1
        WHEN 'corroborated' THEN 2
        WHEN 'single_observation' THEN 3
        ELSE 4
      END,
      rc.source_slug ASC,
      rc.id ASC
    LIMIT 21
  )
  SELECT
    a.resolution_run_id, a.version AS active_version,
    a.publication_version, a.policy_version, a.completed_at AS generated_at,
    am.registry AS assignment_registry,
    am.prefix_bits AS assignment_prefix_bits,
    am.prefix_length AS assignment_prefix_length,
    am.organization_name AS assignment_organization_name,
    am.organization_address AS assignment_address,
    am.core_source_slug AS assignment_source_slug,
    am.core_source_release_id AS assignment_source_release_id,
    cm.id AS claim_id,
    cm.prefix_bits AS claim_prefix_bits,
    cm.prefix_length AS claim_prefix_length,
    cm.organization_name AS claim_organization_name,
    cm.verification_status AS claim_verification_status,
    cm.origin_type AS claim_origin_type,
    cm.conflict_status AS claim_conflict_status,
    cm.source_slug AS claim_source_slug,
    cm.source_release_id AS claim_source_release_id
  FROM active a
  LEFT JOIN assignment_match am ON true
  LEFT JOIN claim_matches cm ON true
  ORDER BY cm.prefix_length DESC NULLS LAST,
    CASE cm.verification_status
      WHEN 'reviewed' THEN 1
      WHEN 'corroborated' THEN 2
      WHEN 'single_observation' THEN 3
      ELSE 4
    END,
    cm.source_slug ASC,
    cm.id ASC
`;

export async function lookupMac(pool: Pool, mac: NormalizedMac, mode: "all" | "official"): Promise<LookupResult> {
  const result = await pool.query<LookupRow>(LOOKUP_SQL, [mac.value.toString(), mode === "official"]);

  const first = result.rows[0];
  if (!first) throw new DataReleaseUnavailableError();

  const data: ReleaseData = {
    resolvedReleaseId: `rr_${first.resolution_run_id}`,
    activeVersion: Number(first.active_version),
    publicationVersion: Number(first.publication_version),
    policyVersion: first.policy_version,
    generatedAt: first.generated_at.toISOString(),
  };

  const assignment: Assignment | null = first.assignment_registry && first.assignment_prefix_bits && first.assignment_prefix_length
    ? {
        prefix: formatPrefix(BigInt(first.assignment_prefix_bits), first.assignment_prefix_length),
        prefixLength: first.assignment_prefix_length,
        registry: first.assignment_registry,
        organizationName: first.assignment_organization_name,
        address: first.assignment_address,
        source: {
          slug: first.assignment_source_slug!,
          sourceReleaseId: `sr_${first.assignment_source_release_id}`,
        },
      }
    : null;

  const allClaims = result.rows.flatMap<CuratedMatch>((row) => {
    if (!row.claim_id || !row.claim_prefix_bits || !row.claim_prefix_length || !row.claim_organization_name) return [];
    return [{
      claimId: `clm_${row.claim_id}`,
      prefix: formatPrefix(BigInt(row.claim_prefix_bits), row.claim_prefix_length),
      prefixLength: row.claim_prefix_length,
      claimType: "vendor_label",
      organizationName: row.claim_organization_name,
      verificationStatus: row.claim_verification_status!,
      originType: row.claim_origin_type!,
      conflictStatus: row.claim_conflict_status!,
      source: {
        slug: row.claim_source_slug!,
        sourceReleaseId: `sr_${row.claim_source_release_id}`,
      },
    }];
  });

  return {
    assignment,
    curatedMatches: allClaims.slice(0, 20),
    curatedMatchesTruncated: allClaims.length > 20,
    data,
  };
}

interface AssignmentRow {
  resolution_run_id: string;
  active_version: string;
  publication_version: string;
  policy_version: string;
  generated_at: Date;
  id: string;
  registry: Registry;
  prefix_bits: string;
  prefix_length: number;
  organization_name: string | null;
  organization_address: string | null;
  core_source_slug: string;
  core_source_release_id: string;
  evidence_id: string | null;
  evidence_role: "selected" | "corroborating" | "conflicting" | "suppressed" | null;
  reason_code: string | null;
  source_record_hash: string | null;
  observed_at: Date | null;
  evidence_source_slug: string | null;
  evidence_source_release_id: string | null;
}

export async function getAssignment(
  pool: Pool,
  registry: Registry,
  prefixBitsValue: bigint,
  prefixLength: number,
  includeEvidence: boolean,
) {
  const result = await pool.query<AssignmentRow>(
    `
      WITH active AS (
        SELECT ar.resolution_run_id, ar.version, ar.publication_version,
               rr.policy_version, rr.completed_at
        FROM active_resolution ar
        JOIN resolution_runs rr ON rr.id = ar.resolution_run_id
        WHERE ar.singleton_id = 1 AND rr.status = 'active'
      ), assignment AS (
        SELECT ra.*
        FROM active a
        JOIN resolved_assignments ra ON ra.resolution_run_id = a.resolution_run_id
        WHERE ra.registry = $1 AND ra.prefix_bits = $2 AND ra.prefix_length = $3
          AND NOT EXISTS (
            SELECT 1 FROM publication_suppressions ps
            WHERE ${ACTIVE_SUPPRESSION}
              AND (
                ps.resolved_assignment_id = ra.id
                OR (
                  ps.resolved_assignment_id IS NULL AND ps.resolved_claim_id IS NULL
                  AND (ps.resolution_run_id IS NULL OR ps.resolution_run_id = a.resolution_run_id)
                  AND ps.prefix_bits = ra.prefix_bits AND ps.prefix_length = ra.prefix_length
                  AND ps.surface IN ('official', 'both')
                  AND (ps.source_slug IS NULL OR ps.source_slug = ra.core_source_slug)
                )
              )
          )
      )
      SELECT a.resolution_run_id, a.version AS active_version, a.publication_version,
             a.policy_version, a.completed_at AS generated_at,
             ass.id, ass.registry, ass.prefix_bits, ass.prefix_length,
             ass.organization_name, ass.organization_address,
             ass.core_source_slug, ass.core_source_release_id,
             CASE WHEN $4::boolean THEN ev.id END AS evidence_id,
             CASE WHEN $4::boolean THEN ev.role END AS evidence_role,
             CASE WHEN $4::boolean THEN ev.reason_code END AS reason_code,
             CASE WHEN $4::boolean THEN sr.raw_record_hash END AS source_record_hash,
             CASE WHEN $4::boolean THEN sr.observed_at END AS observed_at,
             CASE WHEN $4::boolean THEN eds.slug END AS evidence_source_slug,
             CASE WHEN $4::boolean THEN esr.id END AS evidence_source_release_id
      FROM active a
      JOIN assignment ass ON true
      LEFT JOIN resolution_evidence ev ON $4::boolean AND ev.resolved_assignment_id = ass.id
      LEFT JOIN source_records sr ON sr.id = ev.source_record_id
      LEFT JOIN source_releases esr ON esr.id = sr.source_release_id
      LEFT JOIN data_sources eds ON eds.id = esr.source_id
      ORDER BY ev.role NULLS LAST, ev.id
      LIMIT 101
    `,
    [registry, prefixBitsValue.toString(), prefixLength, includeEvidence],
  );

  if (!result.rows[0]) return null;
  const first = result.rows[0];
  return {
    assignment: {
      prefix: formatPrefix(BigInt(first.prefix_bits), first.prefix_length),
      prefixLength: first.prefix_length,
      registry: first.registry,
      organizationName: first.organization_name,
      address: first.organization_address,
      source: { slug: first.core_source_slug, sourceReleaseId: `sr_${first.core_source_release_id}` },
    } satisfies Assignment,
    data: {
      resolvedReleaseId: `rr_${first.resolution_run_id}`,
      activeVersion: Number(first.active_version),
      publicationVersion: Number(first.publication_version),
      policyVersion: first.policy_version,
      generatedAt: first.generated_at.toISOString(),
    } satisfies ReleaseData,
    evidence: includeEvidence
      ? result.rows.slice(0, 100).flatMap((row) => row.evidence_id ? [{
          evidenceId: `ev_${row.evidence_id}`,
          sourceSlug: row.evidence_source_slug!,
          sourceReleaseId: `sr_${row.evidence_source_release_id}`,
          role: row.evidence_role,
          reasonCode: row.reason_code,
          observedAt: row.observed_at?.toISOString() ?? null,
        }] : [])
      : undefined,
    evidenceTruncated: includeEvidence ? result.rows.length > 100 : undefined,
  };
}

export async function getDataRelease(pool: Pool) {
  const result = await pool.query<{
    resolution_run_id: string;
    active_version: string;
    publication_version: string;
    policy_version: string;
    output_hash: string;
    generated_at: Date;
    source_slug: string;
    source_release_id: string;
    observed_at: Date;
    source_class: string;
    distribution_scope: string;
    rights_status_at_build: string;
    current_rights_status: string;
    rights_review_expires_at: Date | null;
    config_version: string;
    config_version_at_build: string;
  }>(`
    SELECT ar.resolution_run_id, ar.version AS active_version, ar.publication_version,
           rr.policy_version, rr.output_hash, rr.completed_at AS generated_at,
           ds.slug AS source_slug, sr.id AS source_release_id,
           COALESCE(observation.observed_at, sr.fetched_at) AS observed_at,
           ds.source_class, ds.distribution_scope,
           ri.source_config_snapshot->>'rightsStatus' AS rights_status_at_build,
           ds.rights_status AS current_rights_status, ds.rights_review_expires_at,
           ds.config_version,
           ri.source_config_snapshot->>'configVersion' AS config_version_at_build
    FROM active_resolution ar
    JOIN resolution_runs rr ON rr.id = ar.resolution_run_id AND rr.status = 'active'
    JOIN resolution_inputs ri ON ri.resolution_run_id = ar.resolution_run_id
    JOIN source_releases sr ON sr.id = ri.source_release_id
    JOIN data_sources ds ON ds.id = sr.source_id
    LEFT JOIN LATERAL (
      SELECT observed_at FROM source_fetch_observations sfo
      WHERE sfo.source_release_id = sr.id
      ORDER BY observed_at DESC LIMIT 1
    ) observation ON true
    WHERE ar.singleton_id = 1
    ORDER BY ds.slug
  `);

  const first = result.rows[0];
  if (!first) throw new DataReleaseUnavailableError();
  return {
    resolvedReleaseId: `rr_${first.resolution_run_id}`,
    activeVersion: Number(first.active_version),
    publicationVersion: Number(first.publication_version),
    policyVersion: first.policy_version,
    outputSha256: first.output_hash,
    generatedAt: first.generated_at.toISOString(),
    sources: result.rows.map((row) => ({
      slug: row.source_slug,
      sourceReleaseId: `sr_${row.source_release_id}`,
      observedAt: row.observed_at.toISOString(),
      verificationStatus: row.source_class === "authoritative" ? "authoritative" : "owner_asserted",
      rightsScope: row.distribution_scope,
      rightsStatusAtBuild: row.rights_status_at_build,
      currentRightsStatus: row.current_rights_status,
      rightsReviewExpiresAt: row.rights_review_expires_at?.toISOString() ?? null,
      status: "included",
      configVersion: Number(row.config_version),
      configVersionAtBuild: Number(row.config_version_at_build),
      configChangedSinceBuild: Number(row.config_version) !== Number(row.config_version_at_build),
    })),
  };
}
