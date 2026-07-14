import path from "node:path";
import type { Pool } from "pg";
import { DATA_RELEASE_SURROGATE_KEY, purgeSurrogateKeys, resolutionSurrogateKey } from "@/cache/surrogate";
import { importSourceRelease } from "@/importer/import-source";
import { loadManifest } from "@/importer/manifest";
import { activateResolution, type ActivationResult } from "@/resolver/activation";
import { buildResolution } from "@/resolver/build";
import { prepareEnrichmentSources } from "@/sources/prepare-enrichments";
import { prepareIeeeSources } from "@/sources/prepare-ieee";
import { checkSourceGovernance } from "./source-health";
import { readActiveSourceInputSnapshot, SOURCE_PUBLICATION_LOCK } from "./source-publication";

export interface UpdateAllSourcesOptions {
  ieeeOutput: string;
  enrichmentOutput: string;
  privateKeyPath: string;
  publicKeyPath?: string;
  mappingPath?: string;
  identityMappingPath?: string;
  policyVersion: string;
  policyCommitSha: string;
  containerImageDigest: string;
  actorId: string;
  now?: Date;
  purge?: typeof purgeSurrogateKeys;
  checkHealth?: typeof checkSourceGovernance;
  prepareIeee?: typeof prepareIeeeSources;
  prepareEnrichments?: typeof prepareEnrichmentSources;
}

export class SourceUpdatePostCommitError extends Error {
  readonly committed = true;

  constructor(
    public readonly phase: "cache_purge" | "source_health",
    message: string,
    public readonly activation: ActivationResult,
    cause: unknown,
  ) {
    super(message, { cause });
    this.name = "SourceUpdatePostCommitError";
  }
}

export async function updateAllSources(pool: Pool, options: UpdateAllSourcesOptions) {
  const lock = await pool.connect();
  const acquired = await lock.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_lock($1) AS acquired",
    [SOURCE_PUBLICATION_LOCK],
  );
  if (!acquired.rows[0]?.acquired) {
    lock.release();
    return { status: "already_running" as const };
  }

  try {
    const observedAt = options.now ?? new Date();
    if (!Number.isFinite(observedAt.getTime()) || observedAt.getTime() > Date.now() + 300_000) {
      throw new Error("source update timestamp is invalid or more than five minutes in the future");
    }

    // All network preparation completes before the first database write. A failed
    // optional origin therefore cannot create a partially activated publication.
    const ieee = await (options.prepareIeee ?? prepareIeeeSources)({
      output: path.resolve(options.ieeeOutput),
      privateKeyPath: path.resolve(options.privateKeyPath),
      publicKeyPath: options.publicKeyPath ? path.resolve(options.publicKeyPath) : undefined,
      now: observedAt,
    });
    const enrichments = await (options.prepareEnrichments ?? prepareEnrichmentSources)({
      output: path.resolve(options.enrichmentOutput),
      ieeeDirectory: path.resolve(ieee.output),
      privateKeyPath: path.resolve(options.privateKeyPath),
      publicKeyPath: options.publicKeyPath ? path.resolve(options.publicKeyPath) : undefined,
      mappingPath: options.mappingPath ? path.resolve(options.mappingPath) : undefined,
      identityMappingPath: options.identityMappingPath ? path.resolve(options.identityMappingPath) : undefined,
      now: observedAt,
    });
    if (ieee.preparedAt !== enrichments.preparedAt) throw new Error("prepared source timestamps differ");

    const prepared = [
      ...ieee.datasets.map((item) => ({ slug: path.basename(item.manifestPath, ".manifest.json"), manifestPath: item.manifestPath })),
      ...enrichments.sources.map((item) => ({ slug: item.slug, manifestPath: item.manifestPath })),
    ];
    const slugs = prepared.map((item) => item.slug);
    if (new Set(slugs).size !== slugs.length) throw new Error("source preparation produced duplicate slugs");

    const imports = [];
    for (const item of prepared) {
      const imported = await importSourceRelease(pool, item.manifestPath);
      imports.push({ ...item, ...imported });
    }

    const inputSnapshot = await readActiveSourceInputSnapshot(lock, slugs);

    await lock.query("BEGIN");
    try {
      for (const item of imports) {
        const manifest = await loadManifest(item.manifestPath);
        const sourceUrl = manifest.artifact.remote?.url ?? manifest.source.homepageUrl ?? manifest.source.termsUrl;
        if (!sourceUrl) throw new Error(`${manifest.source.slug} has no observation URL`);
        const inserted = await lock.query<{ id: string }>(
          `INSERT INTO source_fetch_observations(source_release_id, observed_at, source_url, actor_id, metadata)
           VALUES($1,$2,$3,$4,$5)
           ON CONFLICT(source_release_id, observed_at) DO NOTHING RETURNING id`,
          [item.sourceReleaseId, observedAt, sourceUrl, options.actorId,
            JSON.stringify({ sourceSlug: manifest.source.slug, recordCount: item.recordCount, atomicBatch: true })],
        );
        if (inserted.rows[0]) {
          await lock.query(
            `INSERT INTO audit_events(event_type,actor_id,target_type,target_id,metadata)
             VALUES('source_release.observed',$1,'source_release',$2,$3)`,
            [options.actorId, item.sourceReleaseId,
              JSON.stringify({ observationId: inserted.rows[0].id, observedAt: observedAt.toISOString(), atomicBatch: true })],
          );
        }
      }
      await lock.query("COMMIT");
    } catch (error) {
      await lock.query("ROLLBACK");
      throw error;
    }

    const build = await buildResolution(pool, {
      sourceReleaseIds: [...imports.map((item) => item.sourceReleaseId), ...inputSnapshot.retainedSourceReleaseIds],
      policyVersion: options.policyVersion,
      policyCommitSha: options.policyCommitSha,
      containerImageDigest: options.containerImageDigest,
      now: observedAt,
    });
    if (build.status === "rejected") throw new Error("atomic source resolution was rejected");
    const activation = await activateResolution(pool, build.resolutionRunId, {
      actorId: options.actorId,
      expectedPreviousResolutionRunId: inputSnapshot.baseResolutionRunId,
    });
    const purge = options.purge ?? purgeSurrogateKeys;
    let cachePurge;
    try {
      cachePurge = activation.status === "already_active"
        ? { status: "skipped" as const, reason: "no_change" as const }
        : await purge([
            ...(activation.previousResolutionRunId ? [resolutionSurrogateKey(activation.previousResolutionRunId)] : []),
            DATA_RELEASE_SURROGATE_KEY,
          ]);
    } catch (error) {
      throw new SourceUpdatePostCommitError("cache_purge", "source publication committed but cache purge failed", activation, error);
    }

    let health;
    try {
      health = await (options.checkHealth ?? checkSourceGovernance)(pool);
      if (!health.healthy) throw new Error("source governance is unhealthy after atomic publication");
    } catch (error) {
      throw new SourceUpdatePostCommitError("source_health", "source publication committed but health verification failed", activation, error);
    }

    return {
      status: "updated" as const,
      preparedAt: observedAt.toISOString(),
      prepared: { ieee: ieee.datasets.length, enrichments: enrichments.sources.length },
      imports: imports.map((item) => ({ slug: item.slug, sourceReleaseId: item.sourceReleaseId, recordCount: item.recordCount })),
      retainedSourceReleases: inputSnapshot.retainedSourceReleaseIds.length,
      build,
      activation,
      cachePurge,
      health: health.summary,
    };
  } finally {
    await lock.query("SELECT pg_advisory_unlock($1)", [SOURCE_PUBLICATION_LOCK]).catch(() => undefined);
    lock.release();
  }
}
