CREATE UNIQUE INDEX IF NOT EXISTS one_active_assignment_suppression_idx
  ON publication_suppressions (resolved_assignment_id)
  WHERE status = 'active' AND resolved_assignment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS one_active_claim_suppression_idx
  ON publication_suppressions (resolved_claim_id)
  WHERE status = 'active' AND resolved_claim_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS one_active_prefix_suppression_idx
  ON publication_suppressions (
    COALESCE(resolution_run_id, '00000000-0000-0000-0000-000000000000'::uuid),
    prefix_length,
    prefix_bits,
    surface,
    COALESCE(source_slug, '')
  )
  WHERE status = 'active'
    AND resolved_assignment_id IS NULL
    AND resolved_claim_id IS NULL;

CREATE OR REPLACE FUNCTION reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();
