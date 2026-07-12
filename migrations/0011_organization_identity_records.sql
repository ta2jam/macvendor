ALTER TABLE source_records DROP CONSTRAINT source_records_record_kind_check;
ALTER TABLE source_records DROP CONSTRAINT source_records_prefix_bits_check;
ALTER TABLE source_records DROP CONSTRAINT source_records_prefix_length_check;
ALTER TABLE source_records DROP CONSTRAINT source_records_check3;
ALTER TABLE source_records ALTER COLUMN prefix_bits DROP NOT NULL;
ALTER TABLE source_records ALTER COLUMN prefix_length DROP NOT NULL;

ALTER TABLE source_records ADD CONSTRAINT source_records_record_kind_check
CHECK (record_kind IN ('assignment', 'curated_vendor_claim', 'vendor_alias', 'device_hint', 'usage_note', 'tombstone', 'organization_identity'));
ALTER TABLE source_records ADD CONSTRAINT source_records_prefix_shape_check
CHECK (
  (record_kind = 'organization_identity' AND prefix_bits IS NULL AND prefix_length IS NULL AND registry IS NULL)
  OR
  (record_kind <> 'organization_identity' AND prefix_bits >= 0 AND prefix_length BETWEEN 1 AND 48)
);
ALTER TABLE source_records ADD CONSTRAINT source_records_assignment_length_check
CHECK (record_kind <> 'assignment' OR prefix_length IN (24, 28, 36));
ALTER TABLE source_records ADD CONSTRAINT source_records_identity_shape_check
CHECK (record_kind <> 'organization_identity' OR (
  organization_name_display IS NOT NULL
  AND claim_value ? 'organizationKey'
  AND claim_value ? 'scheme'
  AND claim_value ? 'identifier'
));

CREATE INDEX source_records_organization_key_idx
ON source_records (source_release_id, (claim_value->>'organizationKey'))
WHERE record_kind = 'organization_identity' AND record_status = 'eligible';
