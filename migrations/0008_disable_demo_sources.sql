UPDATE data_sources
SET publish_mode = 'disabled',
    required_for_activation = false,
    config_version = config_version + 1,
    updated_at = now()
WHERE slug IN ('demo-authoritative', 'demo-curated')
  AND adapter_key = 'demo-v1'
  AND (
    publish_mode <> 'disabled'
    OR required_for_activation = true
  );
