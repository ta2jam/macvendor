import type { PoolClient } from "pg";

export const SOURCE_PUBLICATION_LOCK = 6_104_227_008;

export interface ActiveSourceInputSnapshot {
  baseResolutionRunId: string;
  retainedSourceReleaseIds: string[];
}

export async function readActiveSourceInputSnapshot(
  client: PoolClient,
  excludedSlugs: string[],
): Promise<ActiveSourceInputSnapshot> {
  const active = await client.query<{ resolution_run_id: string }>(
    "SELECT resolution_run_id FROM active_resolution WHERE singleton_id = 1",
  );
  const baseResolutionRunId = active.rows[0]?.resolution_run_id;
  if (!baseResolutionRunId) throw new Error("active resolution is unavailable");

  const retained = await client.query<{ source_release_id: string }>(
    `SELECT ri.source_release_id
     FROM resolution_inputs ri
     JOIN source_releases sr ON sr.id = ri.source_release_id
     JOIN data_sources ds ON ds.id = sr.source_id
     WHERE ri.resolution_run_id = $1 AND ds.slug <> ALL($2::text[])
       AND ds.publish_mode = 'production' AND ds.source_class <> 'reference'
     ORDER BY ds.slug`,
    [baseResolutionRunId, excludedSlugs],
  );

  return {
    baseResolutionRunId,
    retainedSourceReleaseIds: retained.rows.map((row) => row.source_release_id),
  };
}
