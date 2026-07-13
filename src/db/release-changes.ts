import type { Pool } from "pg";

interface ChangeRow {
  current_id: string;
  previous_id: string | null;
  current_version: string;
  publication_version: string;
  current_generated_at: Date;
  previous_generated_at: Date | null;
  assignments_added: string;
  assignments_removed: string;
  assignments_changed: string;
  claims_added: string;
  claims_removed: string;
  source_releases_changed: string;
}

export async function getReleaseChanges(pool: Pool) {
  const result = await pool.query<ChangeRow>(`
    WITH current_release AS (
      SELECT ar.resolution_run_id AS id, ar.version, ar.publication_version, rr.completed_at
      FROM active_resolution ar JOIN resolution_runs rr ON rr.id = ar.resolution_run_id
      WHERE ar.singleton_id = 1
    ), previous_release AS (
      SELECT rr.id, rr.completed_at FROM resolution_runs rr, current_release current
      WHERE rr.status = 'retired' AND rr.id <> current.id AND rr.completed_at <= current.completed_at
      ORDER BY rr.activated_at DESC NULLS LAST, rr.completed_at DESC LIMIT 1
    ), current_assignments AS (
      SELECT ra.* FROM resolved_assignments ra, current_release cr WHERE ra.resolution_run_id = cr.id
    ), previous_assignments AS (
      SELECT ra.* FROM resolved_assignments ra, previous_release pr WHERE ra.resolution_run_id = pr.id
    ), assignment_diff AS (
      SELECT
        count(*) FILTER (WHERE previous.id IS NULL)::text AS added,
        count(*) FILTER (WHERE current.id IS NULL)::text AS removed,
        count(*) FILTER (WHERE current.id IS NOT NULL AND previous.id IS NOT NULL AND
          (current.organization_name IS DISTINCT FROM previous.organization_name
           OR current.organization_address IS DISTINCT FROM previous.organization_address
           OR current.core_source_slug IS DISTINCT FROM previous.core_source_slug))::text AS changed
      FROM current_assignments current FULL JOIN previous_assignments previous
        ON previous.registry = current.registry AND previous.prefix_length = current.prefix_length
        AND previous.prefix_bits = current.prefix_bits
    ), current_claims AS (
      SELECT rc.* FROM resolved_claims rc, current_release cr WHERE rc.resolution_run_id = cr.id
    ), previous_claims AS (
      SELECT rc.* FROM resolved_claims rc, previous_release pr WHERE rc.resolution_run_id = pr.id
    ), claim_diff AS (
      SELECT count(*) FILTER (WHERE previous.id IS NULL)::text AS added,
        count(*) FILTER (WHERE current.id IS NULL)::text AS removed
      FROM current_claims current FULL JOIN previous_claims previous
        ON previous.source_slug = current.source_slug AND previous.claim_type = current.claim_type
        AND previous.prefix_length = current.prefix_length AND previous.prefix_bits = current.prefix_bits
        AND previous.organization_name IS NOT DISTINCT FROM current.organization_name
        AND previous.claim_value = current.claim_value
    ), current_sources AS (
      SELECT ds.slug, sr.id FROM resolution_inputs ri JOIN source_releases sr ON sr.id=ri.source_release_id
      JOIN data_sources ds ON ds.id=sr.source_id, current_release cr WHERE ri.resolution_run_id=cr.id
    ), previous_sources AS (
      SELECT ds.slug, sr.id FROM resolution_inputs ri JOIN source_releases sr ON sr.id=ri.source_release_id
      JOIN data_sources ds ON ds.id=sr.source_id, previous_release pr WHERE ri.resolution_run_id=pr.id
    ), source_diff AS (
      SELECT count(*)::text AS changed FROM current_sources current FULL JOIN previous_sources previous USING(slug)
      WHERE current.id IS DISTINCT FROM previous.id
    )
    SELECT cr.id AS current_id, pr.id AS previous_id, cr.version AS current_version,
      cr.publication_version, cr.completed_at AS current_generated_at,
      pr.completed_at AS previous_generated_at, ad.added AS assignments_added,
      ad.removed AS assignments_removed, ad.changed AS assignments_changed,
      cd.added AS claims_added, cd.removed AS claims_removed, sd.changed AS source_releases_changed
    FROM current_release cr LEFT JOIN previous_release pr ON true
    CROSS JOIN assignment_diff ad CROSS JOIN claim_diff cd CROSS JOIN source_diff sd
  `);
  const row = result.rows[0];
  if (!row) throw new Error("active data release is unavailable");
  return {
    current: { resolvedReleaseId: `rr_${row.current_id}`, activeVersion: Number(row.current_version),
      publicationVersion: Number(row.publication_version), generatedAt: row.current_generated_at.toISOString() },
    previous: row.previous_id ? { resolvedReleaseId: `rr_${row.previous_id}`, generatedAt: row.previous_generated_at!.toISOString() } : null,
    changes: { assignmentsAdded: Number(row.assignments_added), assignmentsRemoved: Number(row.assignments_removed),
      assignmentsChanged: Number(row.assignments_changed), claimsAdded: Number(row.claims_added),
      claimsRemoved: Number(row.claims_removed), sourceReleasesChanged: Number(row.source_releases_changed) },
  };
}
