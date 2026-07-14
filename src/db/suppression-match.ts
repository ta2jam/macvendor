export const ACTIVE_SUPPRESSION_SQL = `
  ps.status = 'active'
  AND ps.starts_at <= now()
  AND (ps.expires_at IS NULL OR ps.expires_at > now())
`;

export function assignmentSuppressionTargetSql(assignmentAlias: string, activeAlias: string): string {
  return `(
    ps.resolved_assignment_id = ${assignmentAlias}.id
    OR EXISTS (
      SELECT 1 FROM resolved_assignments suppressed_assignment
      WHERE suppressed_assignment.id = ps.resolved_assignment_id
        AND suppressed_assignment.registry = ${assignmentAlias}.registry
        AND suppressed_assignment.prefix_bits = ${assignmentAlias}.prefix_bits
        AND suppressed_assignment.prefix_length = ${assignmentAlias}.prefix_length
        AND suppressed_assignment.core_source_slug = ${assignmentAlias}.core_source_slug
        AND suppressed_assignment.organization_name IS NOT DISTINCT FROM ${assignmentAlias}.organization_name
        AND suppressed_assignment.organization_address IS NOT DISTINCT FROM ${assignmentAlias}.organization_address
        AND suppressed_assignment.is_private = ${assignmentAlias}.is_private
    )
    OR (
      ps.resolved_assignment_id IS NULL
      AND ps.resolved_claim_id IS NULL
      AND (ps.resolution_run_id IS NULL OR ps.resolution_run_id = ${activeAlias}.resolution_run_id)
      AND ps.prefix_bits = ${assignmentAlias}.prefix_bits
      AND ps.prefix_length = ${assignmentAlias}.prefix_length
      AND ps.surface IN ('official', 'both')
      AND (ps.source_slug IS NULL OR ps.source_slug = ${assignmentAlias}.core_source_slug)
    )
  )`;
}

export function claimSuppressionTargetSql(claimAlias: string, activeAlias: string): string {
  return `(
    ps.resolved_claim_id = ${claimAlias}.id
    OR EXISTS (
      SELECT 1 FROM resolved_claims suppressed_claim
      WHERE suppressed_claim.id = ps.resolved_claim_id
        AND suppressed_claim.claim_type = ${claimAlias}.claim_type
        AND suppressed_claim.prefix_bits = ${claimAlias}.prefix_bits
        AND suppressed_claim.prefix_length = ${claimAlias}.prefix_length
        AND suppressed_claim.source_slug = ${claimAlias}.source_slug
        AND suppressed_claim.claim_value = ${claimAlias}.claim_value
        AND suppressed_claim.organization_name IS NOT DISTINCT FROM ${claimAlias}.organization_name
    )
    OR (
      ps.resolved_assignment_id IS NULL
      AND ps.resolved_claim_id IS NULL
      AND (ps.resolution_run_id IS NULL OR ps.resolution_run_id = ${activeAlias}.resolution_run_id)
      AND ps.prefix_bits = ${claimAlias}.prefix_bits
      AND ps.prefix_length = ${claimAlias}.prefix_length
      AND ps.surface IN ('curated', 'both')
      AND (ps.source_slug IS NULL OR ps.source_slug = ${claimAlias}.source_slug)
    )
  )`;
}
