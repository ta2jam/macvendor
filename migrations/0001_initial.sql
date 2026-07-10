CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  source_class text NOT NULL CHECK (source_class IN ('authoritative', 'enrichment', 'owner_curated', 'reference')),
  publish_mode text NOT NULL CHECK (publish_mode IN ('production', 'qa_only', 'disabled')),
  adapter_key text NOT NULL,
  fetch_policy text NOT NULL CHECK (fetch_policy IN ('scheduled', 'manual')),
  fetch_interval_seconds integer CHECK (fetch_interval_seconds IS NULL OR fetch_interval_seconds > 0),
  max_acceptable_age_seconds integer CHECK (max_acceptable_age_seconds IS NULL OR max_acceptable_age_seconds > 0),
  required_for_activation boolean NOT NULL DEFAULT false,
  homepage_url text,
  terms_url text,
  rights_status text NOT NULL CHECK (rights_status IN ('unreviewed', 'owner_asserted', 'approved', 'rejected', 'expired')),
  rights_basis text NOT NULL CHECK (rights_basis IN ('owner_created', 'licensed', 'permission_granted', 'public_domain_claim', 'unknown')),
  distribution_scope text NOT NULL CHECK (distribution_scope IN ('internal_only', 'api_output', 'raw_redistribution')),
  rights_review_reference text,
  rights_review_expires_at timestamptz,
  config_version bigint NOT NULL DEFAULT 1 CHECK (config_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('fetched', 'staged', 'valid', 'rejected', 'retired')),
  snapshot_kind text NOT NULL CHECK (snapshot_kind IN ('full_snapshot', 'delta')),
  snapshot_complete boolean NOT NULL,
  schema_version text NOT NULL,
  adapter_version text NOT NULL,
  normalizer_version text NOT NULL,
  fetched_at timestamptz NOT NULL,
  validated_at timestamptz,
  upstream_last_modified timestamptz,
  upstream_etag text,
  content_hash text NOT NULL,
  import_key text NOT NULL,
  record_count integer NOT NULL CHECK (record_count >= 0),
  rejected_record_count integer NOT NULL DEFAULT 0 CHECK (rejected_record_count >= 0),
  validation_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (source_id, import_key),
  CHECK (snapshot_kind <> 'delta' OR snapshot_complete = false),
  CHECK (status <> 'valid' OR validated_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS source_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_release_id uuid NOT NULL REFERENCES source_releases(id) ON DELETE RESTRICT,
  dataset_key text NOT NULL,
  source_url text,
  source_repo_path text,
  sha256 text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  mime_type text NOT NULL,
  storage_key text NOT NULL,
  source_commit_sha text,
  source_signature_status text NOT NULL CHECK (source_signature_status IN ('verified', 'unverified', 'not_applicable')),
  http_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (num_nonnulls(source_url, source_repo_path) = 1),
  UNIQUE (source_release_id, dataset_key)
);

CREATE TABLE IF NOT EXISTS source_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_release_id uuid NOT NULL REFERENCES source_releases(id) ON DELETE RESTRICT,
  record_kind text NOT NULL CHECK (record_kind IN ('assignment', 'curated_vendor_claim', 'vendor_alias', 'device_hint', 'usage_note', 'tombstone')),
  record_status text NOT NULL CHECK (record_status IN ('eligible', 'qa_only', 'suppressed', 'withdrawn', 'rejected')),
  registry text CHECK (registry IN ('MA-L', 'MA-M', 'MA-S', 'IAB', 'CID')),
  prefix_bits bigint NOT NULL CHECK (prefix_bits >= 0),
  prefix_length smallint NOT NULL CHECK (prefix_length BETWEEN 1 AND 48),
  organization_name_raw text,
  organization_name_display text,
  organization_address_raw text,
  is_private boolean NOT NULL DEFAULT false,
  claim_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  origin_type text NOT NULL CHECK (origin_type IN ('owner_observation', 'derived', 'imported', 'unknown')),
  rights_basis text NOT NULL CHECK (rights_basis IN ('owner_created', 'licensed', 'permission_granted', 'public_domain_claim', 'unknown')),
  distribution_scope text NOT NULL CHECK (distribution_scope IN ('internal_only', 'api_output', 'raw_redistribution')),
  verification_status text NOT NULL CHECK (verification_status IN ('unverified', 'single_observation', 'corroborated', 'reviewed')),
  evidence_reference text,
  created_by text,
  reviewed_by text,
  observed_at timestamptz,
  effective_from timestamptz,
  effective_to timestamptz,
  withdrawn_at timestamptz,
  raw_record_hash text NOT NULL,
  raw_locator text NOT NULL,
  CHECK (NOT is_private OR (organization_name_display IS NULL AND organization_address_raw IS NULL)),
  CHECK (origin_type <> 'unknown' OR record_status <> 'eligible'),
  CHECK (rights_basis <> 'unknown' OR record_status <> 'eligible'),
  CHECK (record_kind <> 'assignment' OR prefix_length IN (24, 28, 36))
);

CREATE INDEX IF NOT EXISTS source_records_prefix_idx
  ON source_records (source_release_id, prefix_length, prefix_bits);

CREATE TABLE IF NOT EXISTS resolution_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL CHECK (status IN ('building', 'validated', 'rejected', 'active', 'retired')),
  policy_version text NOT NULL,
  policy_commit_sha text NOT NULL,
  schema_version text NOT NULL,
  normalizer_version text NOT NULL,
  container_image_digest text NOT NULL,
  input_manifest_hash text NOT NULL,
  output_hash text NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  activated_at timestamptz,
  validation_summary jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_resolution_run_idx
  ON resolution_runs (status) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS resolution_inputs (
  resolution_run_id uuid NOT NULL REFERENCES resolution_runs(id) ON DELETE RESTRICT,
  source_release_id uuid NOT NULL REFERENCES source_releases(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('authoritative', 'enrichment', 'owner_curated')),
  freshness_status text NOT NULL CHECK (freshness_status IN ('fresh', 'stale_accepted')),
  stale_acceptance_reference text,
  source_config_snapshot jsonb NOT NULL,
  source_config_hash text NOT NULL,
  PRIMARY KEY (resolution_run_id, source_release_id),
  CHECK (freshness_status <> 'stale_accepted' OR stale_acceptance_reference IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS resolved_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resolution_run_id uuid NOT NULL REFERENCES resolution_runs(id) ON DELETE RESTRICT,
  registry text NOT NULL CHECK (registry IN ('MA-L', 'MA-M', 'MA-S', 'IAB', 'CID')),
  prefix_bits bigint NOT NULL CHECK (prefix_bits >= 0),
  prefix_length smallint NOT NULL CHECK (prefix_length IN (24, 28, 36)),
  organization_name text,
  organization_address text,
  is_private boolean NOT NULL DEFAULT false,
  attribution_status text NOT NULL CHECK (attribution_status IN ('authoritative', 'authoritative_private')),
  core_source_record_id uuid NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
  core_source_slug text NOT NULL,
  core_source_release_id uuid NOT NULL REFERENCES source_releases(id) ON DELETE RESTRICT,
  UNIQUE (resolution_run_id, registry, prefix_length, prefix_bits),
  CHECK (NOT is_private OR (organization_name IS NULL AND organization_address IS NULL))
);

CREATE INDEX IF NOT EXISTS resolved_assignments_lookup_idx
  ON resolved_assignments (resolution_run_id, prefix_length, prefix_bits);

CREATE TABLE IF NOT EXISTS resolved_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resolution_run_id uuid NOT NULL REFERENCES resolution_runs(id) ON DELETE RESTRICT,
  claim_type text NOT NULL CHECK (claim_type IN ('curated_vendor_claim', 'vendor_alias', 'device_hint', 'usage_note')),
  prefix_bits bigint NOT NULL CHECK (prefix_bits >= 0),
  prefix_length smallint NOT NULL CHECK (prefix_length BETWEEN 1 AND 48),
  claim_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  organization_name text,
  verification_status text NOT NULL CHECK (verification_status IN ('unverified', 'single_observation', 'corroborated', 'reviewed')),
  origin_type text NOT NULL CHECK (origin_type IN ('owner_observation', 'derived', 'imported')),
  conflict_status text NOT NULL CHECK (conflict_status IN ('agrees', 'conflicts', 'no_official_match', 'not_evaluated')),
  source_record_id uuid NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
  source_slug text NOT NULL,
  source_release_id uuid NOT NULL REFERENCES source_releases(id) ON DELETE RESTRICT,
  CHECK (claim_type <> 'curated_vendor_claim' OR organization_name IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS resolved_claims_lookup_idx
  ON resolved_claims (resolution_run_id, prefix_length, prefix_bits);

CREATE TABLE IF NOT EXISTS resolution_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resolution_run_id uuid NOT NULL REFERENCES resolution_runs(id) ON DELETE RESTRICT,
  resolved_assignment_id uuid REFERENCES resolved_assignments(id) ON DELETE RESTRICT,
  resolved_claim_id uuid REFERENCES resolved_claims(id) ON DELETE RESTRICT,
  field_name text NOT NULL,
  source_record_id uuid NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('selected', 'corroborating', 'conflicting', 'suppressed')),
  reason_code text NOT NULL,
  CHECK (num_nonnulls(resolved_assignment_id, resolved_claim_id) = 1)
);

CREATE TABLE IF NOT EXISTS active_resolution (
  singleton_id smallint PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
  resolution_run_id uuid NOT NULL UNIQUE REFERENCES resolution_runs(id) ON DELETE RESTRICT,
  version bigint NOT NULL CHECK (version > 0),
  publication_version bigint NOT NULL CHECK (publication_version > 0),
  updated_at timestamptz NOT NULL,
  updated_by text NOT NULL
);

CREATE TABLE IF NOT EXISTS publication_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resolution_run_id uuid REFERENCES resolution_runs(id) ON DELETE RESTRICT,
  resolved_assignment_id uuid REFERENCES resolved_assignments(id) ON DELETE RESTRICT,
  resolved_claim_id uuid REFERENCES resolved_claims(id) ON DELETE RESTRICT,
  prefix_bits bigint CHECK (prefix_bits IS NULL OR prefix_bits >= 0),
  prefix_length smallint CHECK (prefix_length IS NULL OR prefix_length BETWEEN 1 AND 48),
  surface text CHECK (surface IN ('official', 'curated', 'both')),
  source_slug text,
  reason_code text NOT NULL,
  ticket_reference text NOT NULL,
  created_by text NOT NULL,
  reviewed_by text,
  starts_at timestamptz NOT NULL,
  expires_at timestamptz,
  status text NOT NULL CHECK (status IN ('active', 'expired', 'revoked')),
  CHECK (expires_at IS NULL OR expires_at > starts_at),
  CHECK (
    (resolved_assignment_id IS NOT NULL AND resolved_claim_id IS NULL AND resolution_run_id IS NULL AND prefix_bits IS NULL AND prefix_length IS NULL AND surface IS NULL AND source_slug IS NULL)
    OR
    (resolved_claim_id IS NOT NULL AND resolved_assignment_id IS NULL AND resolution_run_id IS NULL AND prefix_bits IS NULL AND prefix_length IS NULL AND surface IS NULL AND source_slug IS NULL)
    OR
    (resolved_assignment_id IS NULL AND resolved_claim_id IS NULL AND prefix_bits IS NOT NULL AND prefix_length IS NOT NULL AND surface IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS active_suppression_assignment_idx
  ON publication_suppressions (resolved_assignment_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS active_suppression_claim_idx
  ON publication_suppressions (resolved_claim_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS active_suppression_prefix_idx
  ON publication_suppressions (prefix_length, prefix_bits, surface, source_slug) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  actor_id text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_target_idx
  ON audit_events (target_type, target_id, created_at DESC);
