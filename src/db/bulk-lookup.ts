import type { Pool } from "pg";
import { formatPrefix, type NormalizedMac } from "@/domain/mac";

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

const BULK_LOOKUP_SQL = `
  WITH active AS (
    SELECT ar.resolution_run_id, ar.version, ar.publication_version, rr.policy_version, rr.completed_at
    FROM active_resolution ar JOIN resolution_runs rr ON rr.id = ar.resolution_run_id
    WHERE ar.singleton_id = 1 AND rr.status = 'active'
  ), inputs AS (
    SELECT * FROM unnest($1::text[], $2::bigint[]) AS input(normalized_mac, mac_value)
  )
  SELECT input.normalized_mac, active.resolution_run_id, active.version AS active_version,
    active.publication_version, active.policy_version, active.completed_at AS generated_at,
    match.registry, match.prefix_bits, match.prefix_length, match.organization_name,
    match.organization_address, match.core_source_slug AS source_slug,
    match.core_source_release_id AS source_release_id
  FROM inputs input CROSS JOIN active
  LEFT JOIN LATERAL (
    SELECT ra.*
    FROM (VALUES
      (36::smallint, input.mac_value >> 12),
      (28::smallint, input.mac_value >> 20),
      (24::smallint, input.mac_value >> 24)
    ) candidate(prefix_length, prefix_bits)
    JOIN resolved_assignments ra ON ra.resolution_run_id = active.resolution_run_id
      AND ra.prefix_length = candidate.prefix_length AND ra.prefix_bits = candidate.prefix_bits
    WHERE ra.registry <> 'CID' AND NOT EXISTS (
      SELECT 1 FROM publication_suppressions ps
      WHERE ps.status = 'active' AND ps.starts_at <= now() AND (ps.expires_at IS NULL OR ps.expires_at > now())
        AND (ps.resolved_assignment_id = ra.id OR (
          ps.resolved_assignment_id IS NULL AND ps.resolved_claim_id IS NULL
          AND (ps.resolution_run_id IS NULL OR ps.resolution_run_id = active.resolution_run_id)
          AND ps.prefix_bits = ra.prefix_bits AND ps.prefix_length = ra.prefix_length
          AND ps.surface IN ('official','both') AND (ps.source_slug IS NULL OR ps.source_slug = ra.core_source_slug)
        ))
    )
    ORDER BY ra.prefix_length DESC LIMIT 1
  ) match ON true
  ORDER BY input.normalized_mac
`;

export async function bulkLookupOfficial(pool: Pool, macs: NormalizedMac[]) {
  const unique = [...new Map(macs.map((mac) => [mac.normalized, mac])).values()];
  const result = await pool.query<BulkRow>(BULK_LOOKUP_SQL, [
    unique.map((mac) => mac.normalized), unique.map((mac) => mac.value.toString()),
  ]);
  const byMac = new Map(result.rows.map((row) => [row.normalized_mac, row]));
  return macs.map((mac) => {
    const row = byMac.get(mac.normalized);
    if (!row) throw new Error("active data release is unavailable");
    return {
      normalizedMac: mac.normalized,
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
