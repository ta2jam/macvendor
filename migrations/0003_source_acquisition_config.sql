ALTER TABLE data_sources
  ADD COLUMN IF NOT EXISTS fetch_origins jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS signature_key_sha256 text,
  ADD COLUMN IF NOT EXISTS diff_policy jsonb;

ALTER TABLE data_sources
  DROP CONSTRAINT IF EXISTS data_sources_fetch_origins_array,
  ADD CONSTRAINT data_sources_fetch_origins_array
    CHECK (jsonb_typeof(fetch_origins) = 'array' AND jsonb_array_length(fetch_origins) <= 8),
  DROP CONSTRAINT IF EXISTS data_sources_signature_key_hash,
  ADD CONSTRAINT data_sources_signature_key_hash
    CHECK (signature_key_sha256 IS NULL OR signature_key_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  DROP CONSTRAINT IF EXISTS data_sources_diff_policy_object,
  ADD CONSTRAINT data_sources_diff_policy_object
    CHECK (diff_policy IS NULL OR jsonb_typeof(diff_policy) = 'object');
