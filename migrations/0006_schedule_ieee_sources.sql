UPDATE data_sources
SET fetch_policy = 'scheduled',
    fetch_interval_seconds = 86400,
    max_acceptable_age_seconds = 172800,
    config_version = config_version + 1,
    updated_at = now()
WHERE adapter_key = 'ieee-registration-authority-csv-v1'
  AND (
    fetch_policy <> 'scheduled'
    OR fetch_interval_seconds IS DISTINCT FROM 86400
    OR max_acceptable_age_seconds IS DISTINCT FROM 172800
  );
