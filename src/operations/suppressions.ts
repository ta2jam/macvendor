import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

const PUBLICATION_LOCK = 6_104_227_004;
const OPAQUE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,127}$/;
const REASON_CODE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SuppressionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "SuppressionError";
  }
}

export type SuppressionTarget =
  | { assignmentId: string }
  | { claimId: string }
  | { prefixBits: bigint; prefixLength: number; surface: "official" | "curated" | "both"; sourceSlug?: string };

export interface CreateSuppressionOptions {
  target: SuppressionTarget;
  reasonCode: string;
  ticketReference: string;
  actorId: string;
  expiresAt?: Date;
  now?: Date;
}

function validateOpaque(value: string, field: string): void {
  if (!OPAQUE_REFERENCE.test(value)) {
    throw new SuppressionError("INVALID_REFERENCE", `${field} must be an opaque 1-128 character reference`);
  }
}

function targetKind(target: SuppressionTarget): "assignment" | "claim" | "prefix" {
  const targetObject = target as unknown as Record<string, unknown>;
  const kinds = ["assignmentId" in targetObject, "claimId" in targetObject, "prefixBits" in targetObject]
    .filter(Boolean).length;
  if (kinds !== 1) throw new SuppressionError("INVALID_TARGET", "exactly one suppression target is required");
  if ("assignmentId" in targetObject) return "assignment";
  if ("claimId" in targetObject) return "claim";
  return "prefix";
}

async function lockActiveResolution(client: PoolClient): Promise<{ runId: string; publicationVersion: number }> {
  await client.query("SELECT pg_advisory_xact_lock($1)", [PUBLICATION_LOCK]);
  const active = await client.query<{ resolution_run_id: string; publication_version: string }>(
    `SELECT ar.resolution_run_id, ar.publication_version
     FROM active_resolution ar JOIN resolution_runs rr ON rr.id = ar.resolution_run_id
     WHERE ar.singleton_id = 1 AND rr.status = 'active' FOR UPDATE OF ar`,
  );
  if (!active.rows[0]) throw new SuppressionError("NO_ACTIVE_RESOLUTION", "no active resolution is available");
  return { runId: active.rows[0].resolution_run_id, publicationVersion: Number(active.rows[0].publication_version) };
}

async function bumpPublicationVersion(client: PoolClient, actorId: string): Promise<number> {
  const updated = await client.query<{ publication_version: string }>(
    `UPDATE active_resolution SET publication_version = publication_version + 1,
      updated_at = now(), updated_by = $1 WHERE singleton_id = 1 RETURNING publication_version`,
    [actorId],
  );
  return Number(updated.rows[0]!.publication_version);
}

function targetMetadata(target: SuppressionTarget): Record<string, unknown> {
  if ("assignmentId" in target) return { assignmentId: target.assignmentId };
  if ("claimId" in target) return { claimId: target.claimId };
  return {
    prefixBits: target.prefixBits.toString(), prefixLength: target.prefixLength,
    surface: target.surface, sourceSlug: target.sourceSlug ?? null,
  };
}

export async function createSuppression(pool: Pool, options: CreateSuppressionOptions) {
  validateOpaque(options.actorId, "actorId");
  validateOpaque(options.ticketReference, "ticketReference");
  if (!REASON_CODE.test(options.reasonCode)) throw new SuppressionError("INVALID_REASON", "reasonCode is invalid");
  const kind = targetKind(options.target);
  const now = options.now ?? new Date();
  if (options.expiresAt && options.expiresAt <= now) {
    throw new SuppressionError("INVALID_EXPIRY", "expiresAt must be later than startsAt");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const active = await lockActiveResolution(client);
    let assignmentId: string | null = null;
    let claimId: string | null = null;
    let prefixBits: string | null = null;
    let prefixLength: number | null = null;
    let surface: string | null = null;
    let sourceSlug: string | null = null;
    if (kind === "assignment") {
      assignmentId = (options.target as { assignmentId: string }).assignmentId;
      if (!UUID.test(assignmentId)) throw new SuppressionError("INVALID_TARGET", "assignmentId is not a UUID");
      const target = await client.query("SELECT 1 FROM resolved_assignments WHERE id = $1 AND resolution_run_id = $2", [assignmentId, active.runId]);
      if (!target.rowCount) throw new SuppressionError("TARGET_NOT_ACTIVE", "assignment is not part of the active resolution");
    } else if (kind === "claim") {
      claimId = (options.target as { claimId: string }).claimId;
      if (!UUID.test(claimId)) throw new SuppressionError("INVALID_TARGET", "claimId is not a UUID");
      const target = await client.query("SELECT 1 FROM resolved_claims WHERE id = $1 AND resolution_run_id = $2", [claimId, active.runId]);
      if (!target.rowCount) throw new SuppressionError("TARGET_NOT_ACTIVE", "claim is not part of the active resolution");
    } else {
      const target = options.target as Extract<SuppressionTarget, { prefixBits: bigint }>;
      if (!Number.isInteger(target.prefixLength) || target.prefixLength < 1 || target.prefixLength > 48 || target.prefixBits < 0n
        || target.prefixBits >= (1n << BigInt(target.prefixLength))) {
        throw new SuppressionError("INVALID_TARGET", "prefix target is invalid");
      }
      prefixBits = target.prefixBits.toString();
      prefixLength = target.prefixLength;
      surface = target.surface;
      sourceSlug = target.sourceSlug ?? null;
      if (sourceSlug) {
        const source = await client.query(
          `SELECT 1 FROM resolution_inputs ri JOIN source_releases sr ON sr.id = ri.source_release_id
           JOIN data_sources ds ON ds.id = sr.source_id WHERE ri.resolution_run_id = $1 AND ds.slug = $2`,
          [active.runId, sourceSlug],
        );
        if (!source.rowCount) throw new SuppressionError("SOURCE_NOT_ACTIVE", "source is not part of the active resolution");
      }
    }

    const id = randomUUID();
    try {
      await client.query(
        `INSERT INTO publication_suppressions (
          id, resolution_run_id, resolved_assignment_id, resolved_claim_id,
          prefix_bits, prefix_length, surface, source_slug, reason_code,
          ticket_reference, created_by, starts_at, expires_at, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'active')`,
        [id, kind === "prefix" ? active.runId : null, assignmentId, claimId, prefixBits,
          prefixLength, surface, sourceSlug, options.reasonCode, options.ticketReference,
          options.actorId, now, options.expiresAt ?? null],
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new SuppressionError("ALREADY_SUPPRESSED", "an active suppression already exists for this target");
      }
      throw error;
    }
    const publicationVersion = await bumpPublicationVersion(client, options.actorId);
    await client.query(
      `INSERT INTO audit_events (event_type, actor_id, target_type, target_id, metadata)
       VALUES ('suppression.created', $1, 'publication_suppression', $2, $3)`,
      [options.actorId, id, JSON.stringify({ reasonCode: options.reasonCode,
        ticketReference: options.ticketReference, ...targetMetadata(options.target), publicationVersion })],
    );
    await client.query("COMMIT");
    return { status: "created" as const, suppressionId: id, resolutionRunId: active.runId, publicationVersion };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeSuppression(pool: Pool, options: {
  suppressionId: string; ticketReference: string; actorId: string; now?: Date;
}) {
  if (!UUID.test(options.suppressionId)) throw new SuppressionError("INVALID_ID", "suppressionId is not a UUID");
  validateOpaque(options.actorId, "actorId");
  validateOpaque(options.ticketReference, "ticketReference");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const active = await lockActiveResolution(client);
    const suppression = await client.query<{ status: string; resolution_run_id: string | null }>(
      "SELECT status, resolution_run_id FROM publication_suppressions WHERE id = $1 FOR UPDATE",
      [options.suppressionId],
    );
    if (!suppression.rows[0]) throw new SuppressionError("SUPPRESSION_NOT_FOUND", "suppression does not exist");
    if (suppression.rows[0].status !== "active") throw new SuppressionError("SUPPRESSION_NOT_ACTIVE", "suppression is not active");
    if (suppression.rows[0].resolution_run_id && suppression.rows[0].resolution_run_id !== active.runId) {
      throw new SuppressionError("SUPPRESSION_NOT_CURRENT", "suppression belongs to a different resolution");
    }
    await client.query("UPDATE publication_suppressions SET status = 'revoked' WHERE id = $1", [options.suppressionId]);
    const publicationVersion = await bumpPublicationVersion(client, options.actorId);
    await client.query(
      `INSERT INTO audit_events (event_type, actor_id, target_type, target_id, metadata)
       VALUES ('suppression.revoked', $1, 'publication_suppression', $2, $3)`,
      [options.actorId, options.suppressionId,
        JSON.stringify({ ticketReference: options.ticketReference, revokedAt: (options.now ?? new Date()).toISOString(), publicationVersion })],
    );
    await client.query("COMMIT");
    return { status: "revoked" as const, suppressionId: options.suppressionId, publicationVersion };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function expireSuppressions(pool: Pool, options: { actorId: string; now?: Date }) {
  validateOpaque(options.actorId, "actorId");
  const now = options.now ?? new Date();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockActiveResolution(client);
    const expired = await client.query<{ id: string }>(
      `UPDATE publication_suppressions SET status = 'expired'
       WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= $1
       RETURNING id`,
      [now],
    );
    if (!expired.rowCount) {
      await client.query("COMMIT");
      return { status: "no_change" as const, expiredCount: 0, publicationVersion: null };
    }
    const publicationVersion = await bumpPublicationVersion(client, options.actorId);
    for (const row of expired.rows) {
      await client.query(
        `INSERT INTO audit_events (event_type, actor_id, target_type, target_id, metadata)
         VALUES ('suppression.expired', $1, 'publication_suppression', $2, $3)`,
        [options.actorId, row.id, JSON.stringify({ expiredAt: now.toISOString(), publicationVersion })],
      );
    }
    await client.query("COMMIT");
    return { status: "expired" as const, expiredCount: expired.rows.length, publicationVersion };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listSuppressions(pool: Pool, status: "active" | "revoked" | "expired" | "all" = "active") {
  const result = await pool.query(
    `SELECT id, resolution_run_id, resolved_assignment_id, resolved_claim_id,
      prefix_bits, prefix_length, surface, source_slug, reason_code,
      ticket_reference, created_by, starts_at, expires_at, status
     FROM publication_suppressions
     WHERE ($1 = 'all' OR status = $1)
     ORDER BY starts_at DESC, id DESC LIMIT 1000`,
    [status],
  );
  return result.rows;
}
