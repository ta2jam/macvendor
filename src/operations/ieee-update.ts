import type { Pool, PoolClient } from "pg";
import { DATA_RELEASE_SURROGATE_KEY, purgeSurrogateKeys, resolutionSurrogateKey } from "@/cache/surrogate";
import { importSourceRelease } from "@/importer/import-source";
import { activateResolution } from "@/resolver/activation";
import type { ActivationResult } from "@/resolver/activation";
import { buildResolution } from "@/resolver/build";
import { checkSourceGovernance } from "./source-health";
import { prepareIeeeSources, type PrepareIeeeOptions, type PreparedIeeeSnapshot } from "@/sources/prepare-ieee";
import { IEEE_DATASETS, IEEE_RA_ORIGIN } from "@/sources/ieee";

const IEEE_UPDATE_LOCK = 6_104_227_006;

async function recordObservations(
  client: PoolClient,
  prepared: PreparedIeeeSnapshot,
  imports: Array<{ sourceReleaseId: string; contentHash: string; recordCount: number }>,
  actorId: string,
  observedAt: Date,
): Promise<{ recorded: number; activeRecorded: number }> {
  let recorded = 0;
  let activeRecorded = 0;
  await client.query("BEGIN");
  try {
    for (const [index, dataset] of prepared.datasets.entries()) {
      const imported = imports[index]!;
      if (dataset.contentHash !== imported.contentHash) throw new Error("prepared and imported IEEE hashes differ");
      if (dataset.records !== imported.recordCount) throw new Error("prepared and imported IEEE record counts differ");
      const source = await client.query<{ id: string; active: boolean }>(
        `SELECT sr.id, EXISTS (
           SELECT 1 FROM active_resolution ar
           JOIN resolution_inputs ri ON ri.resolution_run_id = ar.resolution_run_id
           WHERE ar.singleton_id = 1 AND ri.source_release_id = sr.id
         ) AS active
         FROM source_releases sr WHERE sr.id = $1 AND sr.content_hash = $2`,
        [imported.sourceReleaseId, imported.contentHash],
      );
      if (!source.rows[0]) throw new Error("imported IEEE release is unavailable for observation");
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO source_fetch_observations (
          source_release_id, observed_at, source_url, actor_id, metadata
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (source_release_id, observed_at) DO NOTHING
        RETURNING id`,
        [imported.sourceReleaseId, observedAt, dataset.sourceUrl, actorId,
          JSON.stringify({ registry: dataset.registry,
            records: dataset.records, bytes: dataset.bytes, adapterWarnings: dataset.adapterWarnings })],
      );
      const observationId = inserted.rows[0]?.id ?? (await client.query<{ id: string }>(
        `SELECT id FROM source_fetch_observations
         WHERE source_release_id = $1 AND observed_at = $2`,
        [imported.sourceReleaseId, observedAt],
      )).rows[0]?.id;
      if (!observationId) throw new Error("IEEE observation could not be recorded");
      if (inserted.rows[0]) {
        recorded += 1;
        if (source.rows[0]!.active) activeRecorded += 1;
        await client.query(
          `INSERT INTO audit_events (event_type, actor_id, target_type, target_id, metadata)
           VALUES ('source_release.observed', $1, 'source_release', $2, $3)`,
          [actorId, imported.sourceReleaseId, JSON.stringify({ observationId,
            contentHash: imported.contentHash, observedAt: observedAt.toISOString() })],
        );
      }
    }
    await client.query("COMMIT");
    return { recorded, activeRecorded };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export interface UpdateIeeeOptions extends PrepareIeeeOptions {
  policyVersion: string;
  policyCommitSha: string;
  containerImageDigest: string;
  actorId: string;
  prepare?: (options: PrepareIeeeOptions) => Promise<PreparedIeeeSnapshot>;
  purge?: typeof purgeSurrogateKeys;
  checkHealth?: typeof checkSourceGovernance;
}

export class IeeeUpdatePostCommitError extends Error {
  readonly committed = true;

  constructor(
    public readonly phase: "cache_purge" | "source_health",
    message: string,
    public readonly activation: ActivationResult | null,
    cause: unknown,
  ) {
    super(message, { cause });
    this.name = "IeeeUpdatePostCommitError";
  }
}

function validatePreparedSnapshot(prepared: PreparedIeeeSnapshot): Date {
  const observedAt = new Date(prepared.preparedAt);
  if (!Number.isFinite(observedAt.getTime()) || observedAt.getTime() > Date.now() + 300_000) {
    throw new Error("IEEE preparation timestamp is invalid or more than five minutes in the future");
  }
  if (prepared.datasets.length !== IEEE_DATASETS.length) {
    throw new Error("IEEE preparation must produce exactly three datasets");
  }
  for (const expected of IEEE_DATASETS) {
    const matches = prepared.datasets.filter((dataset) => dataset.registry === expected.registry);
    if (matches.length !== 1 || matches[0]!.sourceUrl !== expected.url || matches[0]!.finalOrigin !== IEEE_RA_ORIGIN) {
      throw new Error(`IEEE preparation returned an unexpected ${expected.registry} dataset`);
    }
  }
  return observedAt;
}

export async function updateIeeeSources(pool: Pool, options: UpdateIeeeOptions) {
  const lock = await pool.connect();
  const acquired = await lock.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1) AS acquired", [IEEE_UPDATE_LOCK]);
  if (!acquired.rows[0]?.acquired) {
    lock.release();
    return { status: "already_running" as const };
  }
  try {
    const prepare = options.prepare ?? prepareIeeeSources;
    const prepared = await prepare(options);
    const observedAt = validatePreparedSnapshot(prepared);
    const imports = [];
    for (const dataset of prepared.datasets) imports.push(await importSourceRelease(pool, dataset.manifestPath));
    const observations = await recordObservations(lock, prepared, imports, options.actorId, observedAt);
    const purge = options.purge ?? purgeSurrogateKeys;
    let observationCachePurge;
    try {
      observationCachePurge = observations.recorded === 0
        ? { status: "skipped" as const, reason: "no_change" as const }
        : observations.activeRecorded === 0
          ? { status: "skipped" as const, reason: "no_active_change" as const }
        : await purge([DATA_RELEASE_SURROGATE_KEY]);
    } catch (error) {
      throw new IeeeUpdatePostCommitError(
        "cache_purge", "IEEE observations were committed, but metadata cache purge failed", null, error,
      );
    }
    const build = await buildResolution(pool, {
      sourceReleaseIds: imports.map((item) => item.sourceReleaseId),
      policyVersion: options.policyVersion,
      policyCommitSha: options.policyCommitSha,
      containerImageDigest: options.containerImageDigest,
      now: observedAt,
    });
    if (build.status === "rejected") throw new Error("IEEE resolution was rejected");
    const activation = await activateResolution(pool, build.resolutionRunId, { actorId: options.actorId });
    let cachePurge;
    try {
      cachePurge = activation.status === "already_active"
        ? { status: "skipped" as const, reason: "no_change" as const }
        : await purge([
            ...(activation.previousResolutionRunId ? [resolutionSurrogateKey(activation.previousResolutionRunId)] : []),
            DATA_RELEASE_SURROGATE_KEY,
          ]);
    } catch (error) {
      throw new IeeeUpdatePostCommitError(
        "cache_purge", "IEEE resolution was committed, but cache purge failed", activation, error,
      );
    }
    let health;
    try {
      health = await (options.checkHealth ?? checkSourceGovernance)(pool);
      if (!health.healthy) throw new Error("source governance is unhealthy");
    } catch (error) {
      throw new IeeeUpdatePostCommitError(
        "source_health", "IEEE resolution was committed, but the source health check failed", activation, error,
      );
    }
    return { status: "updated" as const, prepared, imports, build, activation,
      observations: { ...observations, observedAt: observedAt.toISOString() },
      cachePurge: { observation: observationCachePurge, activation: cachePurge }, health: health.summary };
  } finally {
    await lock.query("SELECT pg_advisory_unlock($1)", [IEEE_UPDATE_LOCK]).catch(() => undefined);
    lock.release();
  }
}
