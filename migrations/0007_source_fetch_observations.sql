CREATE TABLE IF NOT EXISTS source_fetch_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_release_id uuid NOT NULL REFERENCES source_releases(id) ON DELETE RESTRICT,
  observed_at timestamptz NOT NULL,
  source_url text NOT NULL CHECK (octet_length(source_url) BETWEEN 1 AND 2048),
  actor_id text NOT NULL CHECK (octet_length(actor_id) BETWEEN 1 AND 256),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE (source_release_id, observed_at)
);

CREATE INDEX IF NOT EXISTS source_fetch_observations_latest_idx
  ON source_fetch_observations (source_release_id, observed_at DESC);

CREATE OR REPLACE FUNCTION reject_source_fetch_observation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'source_fetch_observations are append-only';
END;
$$;

DROP TRIGGER IF EXISTS source_fetch_observations_append_only ON source_fetch_observations;
CREATE TRIGGER source_fetch_observations_append_only
BEFORE UPDATE OR DELETE ON source_fetch_observations
FOR EACH ROW EXECUTE FUNCTION reject_source_fetch_observation_mutation();

INSERT INTO source_fetch_observations (
  source_release_id, observed_at, source_url, actor_id, metadata
)
SELECT sr.id, sr.fetched_at,
  COALESCE(sa.source_url, 'https://local.invalid/not-remotely-fetched'),
  'migration:0007', '{"backfilled":true}'::jsonb
FROM source_releases sr
LEFT JOIN LATERAL (
  SELECT source_url FROM source_artifacts
  WHERE source_release_id = sr.id ORDER BY id LIMIT 1
) sa ON true
ON CONFLICT (source_release_id, observed_at) DO NOTHING;
