import type { Pool } from "pg";

interface SourceValueRow {
  slug: string;
  source_class: string;
  required_for_activation: boolean;
  record_count: string;
  rejected_record_count: string;
  assignments: string;
  claims: string;
  identities: string;
  conflicts: string;
  latest_observation: Date | null;
  rights_review_expires_at: Date | null;
}

export interface SourceValueEntry {
  slug: string;
  sourceClass: string;
  requiredForActivation: boolean;
  inputRecords: number;
  rejectedRecords: number;
  outputAssignments: number;
  outputClaims: number;
  organizationIdentities: number;
  conflicts: number;
  latestObservation: string | null;
  rightsReviewExpiresAt: string | null;
  outputContribution: number;
}

export async function sourceValueReport(pool: Pool): Promise<{ generatedAt: string; sources: SourceValueEntry[] }> {
  const result = await pool.query<SourceValueRow>(`
    WITH active AS (
      SELECT resolution_run_id FROM active_resolution WHERE singleton_id = 1
    ), inputs AS (
      SELECT ds.slug, ds.source_class, ds.required_for_activation, ds.rights_review_expires_at,
        sr.id AS source_release_id, sr.record_count, sr.rejected_record_count
      FROM active a
      JOIN resolution_inputs ri ON ri.resolution_run_id = a.resolution_run_id
      JOIN source_releases sr ON sr.id = ri.source_release_id
      JOIN data_sources ds ON ds.id = sr.source_id
    )
    SELECT i.slug, i.source_class, i.required_for_activation,
      i.record_count::text, i.rejected_record_count::text,
      (SELECT count(*) FROM resolved_assignments ra, active a
       WHERE ra.resolution_run_id = a.resolution_run_id AND ra.core_source_slug = i.slug)::text AS assignments,
      (SELECT count(*) FROM resolved_claims rc, active a
       WHERE rc.resolution_run_id = a.resolution_run_id AND rc.source_slug = i.slug)::text AS claims,
      (SELECT count(*) FROM source_records rec
       WHERE rec.source_release_id = i.source_release_id AND rec.record_kind = 'organization_identity'
         AND rec.record_status = 'eligible')::text AS identities,
      (SELECT count(*) FROM resolved_claims rc, active a
       WHERE rc.resolution_run_id = a.resolution_run_id AND rc.source_slug = i.slug
         AND rc.conflict_status = 'conflicts')::text AS conflicts,
      (SELECT max(observed_at) FROM source_fetch_observations obs
       WHERE obs.source_release_id = i.source_release_id) AS latest_observation,
      i.rights_review_expires_at
    FROM inputs i ORDER BY i.slug
  `);
  return {
    generatedAt: new Date().toISOString(),
    sources: result.rows.map((row) => {
      const outputAssignments = Number(row.assignments);
      const outputClaims = Number(row.claims);
      const organizationIdentities = Number(row.identities);
      return {
        slug: row.slug,
        sourceClass: row.source_class,
        requiredForActivation: row.required_for_activation,
        inputRecords: Number(row.record_count),
        rejectedRecords: Number(row.rejected_record_count),
        outputAssignments,
        outputClaims,
        organizationIdentities,
        conflicts: Number(row.conflicts),
        latestObservation: row.latest_observation?.toISOString() ?? null,
        rightsReviewExpiresAt: row.rights_review_expires_at?.toISOString() ?? null,
        outputContribution: outputAssignments + outputClaims + organizationIdentities,
      };
    }),
  };
}
