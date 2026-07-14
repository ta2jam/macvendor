import type { Pool } from "pg";

export class ActivationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ActivationError";
  }
}

export interface ActivationResult {
  status: "activated" | "rolled_back" | "already_active";
  resolutionRunId: string;
  activeVersion: number;
  publicationVersion: number;
  previousResolutionRunId: string | null;
}

export async function activateResolution(
  pool: Pool,
  runId: string,
  options: {
    actorId: string;
    rollback?: boolean;
    expectedPreviousResolutionRunId?: string | null;
    expectedPreviousPublicationVersion?: number | null;
  },
): Promise<ActivationResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [6_104_227_004]);
    const candidate = await client.query<{ status: string }>(
      "SELECT status FROM resolution_runs WHERE id = $1 FOR UPDATE",
      [runId],
    );
    if (!candidate.rows[0]) throw new ActivationError("RUN_NOT_FOUND", "resolution run does not exist");
    const expected = options.rollback ? "retired" : "validated";
    if (candidate.rows[0].status === "active") {
      const pointer = await client.query<{ version: string; publication_version: string }>(
        "SELECT version, publication_version FROM active_resolution WHERE resolution_run_id = $1",
        [runId],
      );
      if (!pointer.rows[0]) throw new ActivationError("POINTER_INCONSISTENT", "active run is not the active pointer");
      await client.query("COMMIT");
      return {
        status: "already_active", resolutionRunId: runId,
        activeVersion: Number(pointer.rows[0].version),
        publicationVersion: Number(pointer.rows[0].publication_version),
        previousResolutionRunId: null,
      };
    }
    if (candidate.rows[0].status !== expected) {
      throw new ActivationError("RUN_NOT_ACTIVATABLE", `expected ${expected} run, received ${candidate.rows[0].status}`);
    }

    const changedConfig = await client.query<{ slug: string }>(
      `SELECT ds.slug FROM resolution_inputs ri
       JOIN source_releases sr ON sr.id = ri.source_release_id
       JOIN data_sources ds ON ds.id = sr.source_id
       WHERE ri.resolution_run_id = $1
         AND (ri.source_config_snapshot->>'configVersion')::bigint <> ds.config_version
       LIMIT 1`,
      [runId],
    );
    if (changedConfig.rows[0]) throw new ActivationError("SOURCE_CONFIG_CHANGED", `${changedConfig.rows[0].slug} changed after the build`);

    const pointer = await client.query<{ resolution_run_id: string; version: string; publication_version: string }>(
      "SELECT resolution_run_id, version, publication_version FROM active_resolution WHERE singleton_id = 1 FOR UPDATE",
    );
    const previousResolutionRunId = pointer.rows[0]?.resolution_run_id ?? null;
    const previousPublicationVersion = pointer.rows[0] ? Number(pointer.rows[0].publication_version) : null;
    if (options.expectedPreviousResolutionRunId !== undefined
      && previousResolutionRunId !== options.expectedPreviousResolutionRunId) {
      throw new ActivationError(
        "ACTIVE_RESOLUTION_CHANGED",
        "active resolution changed after the source inputs were selected",
      );
    }
    if (options.expectedPreviousPublicationVersion !== undefined
      && previousPublicationVersion !== options.expectedPreviousPublicationVersion) {
      throw new ActivationError(
        "ACTIVE_PUBLICATION_CHANGED",
        "active publication changed after the source inputs were selected",
      );
    }
    if (pointer.rows[0]) {
      await client.query("UPDATE resolution_runs SET status = 'retired' WHERE id = $1", [pointer.rows[0].resolution_run_id]);
      await client.query("UPDATE resolution_runs SET status = 'active', activated_at = now() WHERE id = $1", [runId]);
      await client.query(
        `UPDATE active_resolution SET resolution_run_id = $1, version = version + 1,
          publication_version = publication_version + 1, updated_at = now(), updated_by = $2
         WHERE singleton_id = 1`,
        [runId, options.actorId],
      );
    } else {
      await client.query("UPDATE resolution_runs SET status = 'active', activated_at = now() WHERE id = $1", [runId]);
      await client.query(
        `INSERT INTO active_resolution (
          singleton_id, resolution_run_id, version, publication_version, updated_at, updated_by
        ) VALUES (1, $1, 1, 1, now(), $2)`,
        [runId, options.actorId],
      );
    }
    const updated = await client.query<{ version: string; publication_version: string }>(
      "SELECT version, publication_version FROM active_resolution WHERE singleton_id = 1",
    );
    await client.query(
      `INSERT INTO audit_events (event_type, actor_id, target_type, target_id, metadata)
       VALUES ($1, $2, 'resolution_run', $3, $4)`,
      [options.rollback ? "resolution.rolled_back" : "resolution.activated", options.actorId,
        runId, JSON.stringify({ previousRunId: previousResolutionRunId,
          activeVersion: Number(updated.rows[0]!.version), publicationVersion: Number(updated.rows[0]!.publication_version) })],
    );
    await client.query("COMMIT");
    return {
      status: options.rollback ? "rolled_back" : "activated",
      resolutionRunId: runId,
      activeVersion: Number(updated.rows[0]!.version),
      publicationVersion: Number(updated.rows[0]!.publication_version),
      previousResolutionRunId,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
