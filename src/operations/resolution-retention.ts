import type { Pool } from "pg";

const PUBLICATION_LOCK = 6_104_227_004;
const DEFAULT_MINIMUM_AGE_DAYS = 90;
const DEFAULT_RETAIN_RETIRED_RUNS = 8;
const DEFAULT_BATCH_SIZE = 2;

export interface ResolutionRetentionOptions {
  actorId: string;
  now?: Date;
  minimumAgeDays?: number;
  retainRetiredRuns?: number;
  batchSize?: number;
}

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function actorId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)) {
    throw new Error("retention actorId must be an opaque 1-128 character identifier");
  }
  return value;
}

export async function pruneRetiredResolutions(pool: Pool, options: ResolutionRetentionOptions) {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime()) || now.getTime() > Date.now() + 300_000) {
    throw new Error("retention timestamp is invalid or more than five minutes in the future");
  }
  const minimumAgeDays = boundedInteger(
    options.minimumAgeDays ?? DEFAULT_MINIMUM_AGE_DAYS, "minimumAgeDays", 30, 3_650,
  );
  const retainRetiredRuns = boundedInteger(
    options.retainRetiredRuns ?? DEFAULT_RETAIN_RETIRED_RUNS, "retainRetiredRuns", 1, 100,
  );
  const batchSize = boundedInteger(options.batchSize ?? DEFAULT_BATCH_SIZE, "batchSize", 1, 10);
  const operator = actorId(options.actorId);
  const cutoff = new Date(now.getTime() - minimumAgeDays * 86_400_000);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '5min'");
    await client.query("SELECT pg_advisory_xact_lock($1)", [PUBLICATION_LOCK]);
    const candidates = await client.query<{ id: string; completed_at: Date }>(
      `WITH ranked AS (
         SELECT rr.id, rr.completed_at,
           row_number() OVER (
             ORDER BY rr.activated_at DESC NULLS LAST, rr.completed_at DESC, rr.id DESC
           ) AS retirement_rank
         FROM resolution_runs rr
         WHERE rr.status = 'retired'
       )
       SELECT ranked.id, ranked.completed_at
       FROM ranked
       WHERE ranked.retirement_rank > $2
         AND ranked.completed_at < $1
         AND NOT EXISTS (
           SELECT 1
           FROM publication_suppressions ps
           WHERE ps.resolution_run_id = ranked.id
             OR EXISTS (
               SELECT 1 FROM resolved_assignments ra
               WHERE ra.resolution_run_id = ranked.id AND ra.id = ps.resolved_assignment_id
             )
             OR EXISTS (
               SELECT 1 FROM resolved_claims rc
               WHERE rc.resolution_run_id = ranked.id AND rc.id = ps.resolved_claim_id
             )
         )
       ORDER BY ranked.completed_at, ranked.id
       LIMIT $3`,
      [cutoff, retainRetiredRuns, batchSize],
    );

    const deleted = { runs: 0, evidence: 0, claims: 0, assignments: 0, inputs: 0 };
    const prunedRuns: Array<{ resolutionRunId: string; completedAt: string }> = [];
    for (const candidate of candidates.rows) {
      const locked = await client.query(
        "SELECT id FROM resolution_runs WHERE id = $1 AND status = 'retired' FOR UPDATE",
        [candidate.id],
      );
      if (!locked.rowCount) continue;
      const evidence = await client.query("DELETE FROM resolution_evidence WHERE resolution_run_id = $1", [candidate.id]);
      const claims = await client.query("DELETE FROM resolved_claims WHERE resolution_run_id = $1", [candidate.id]);
      const assignments = await client.query("DELETE FROM resolved_assignments WHERE resolution_run_id = $1", [candidate.id]);
      const inputs = await client.query("DELETE FROM resolution_inputs WHERE resolution_run_id = $1", [candidate.id]);
      const run = await client.query("DELETE FROM resolution_runs WHERE id = $1 AND status = 'retired'", [candidate.id]);
      if (!run.rowCount) throw new Error("retired resolution disappeared during retention");
      deleted.runs += run.rowCount;
      deleted.evidence += evidence.rowCount ?? 0;
      deleted.claims += claims.rowCount ?? 0;
      deleted.assignments += assignments.rowCount ?? 0;
      deleted.inputs += inputs.rowCount ?? 0;
      prunedRuns.push({ resolutionRunId: candidate.id, completedAt: candidate.completed_at.toISOString() });
      await client.query(
        `INSERT INTO audit_events(event_type, actor_id, target_type, target_id, metadata)
         VALUES('resolution.retention_deleted', $1, 'resolution_run', $2, $3)`,
        [operator, candidate.id, JSON.stringify({ completedAt: candidate.completed_at.toISOString(),
          cutoff: cutoff.toISOString(), minimumAgeDays, retainRetiredRuns,
          deleted: { evidence: evidence.rowCount ?? 0, claims: claims.rowCount ?? 0,
            assignments: assignments.rowCount ?? 0, inputs: inputs.rowCount ?? 0 } })],
      );
    }
    await client.query("COMMIT");
    return {
      status: prunedRuns.length ? "pruned" as const : "no_change" as const,
      cutoff: cutoff.toISOString(),
      minimumAgeDays,
      retainRetiredRuns,
      batchSize,
      prunedRuns,
      deleted,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
