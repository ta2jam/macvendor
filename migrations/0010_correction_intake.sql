CREATE TABLE correction_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE CHECK (reference ~ '^CORR-[0-9]{8}-[A-F0-9]{8}$'),
  category text NOT NULL CHECK (category IN ('incorrect_assignment', 'incorrect_context', 'privacy', 'rights', 'withdrawal')),
  target text NOT NULL CHECK (char_length(target) BETWEEN 1 AND 128),
  requested_change text NOT NULL CHECK (char_length(requested_change) BETWEEN 20 AND 2000),
  evidence_url text NOT NULL CHECK (char_length(evidence_url) BETWEEN 9 AND 2048),
  contact_ciphertext jsonb NOT NULL,
  contact_purged_at timestamptz,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'triaged', 'accepted', 'rejected', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  retention_until timestamptz NOT NULL DEFAULT (now() + interval '180 days')
);

CREATE INDEX correction_requests_status_created_idx ON correction_requests (status, created_at);
CREATE INDEX correction_requests_retention_idx ON correction_requests (retention_until);

CREATE TABLE correction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correction_request_id uuid NOT NULL REFERENCES correction_requests(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('received', 'status_changed', 'contact_accessed', 'retention_deleted')),
  actor_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX correction_events_request_created_idx ON correction_events (correction_request_id, created_at);

CREATE OR REPLACE FUNCTION reject_correction_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'correction_events are append-only';
END;
$$;

CREATE TRIGGER correction_events_append_only
BEFORE UPDATE OR DELETE ON correction_events
FOR EACH ROW EXECUTE FUNCTION reject_correction_event_mutation();
