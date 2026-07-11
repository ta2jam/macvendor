CREATE INDEX IF NOT EXISTS source_releases_latest_valid_idx
  ON source_releases (source_id, validated_at DESC, id DESC)
  WHERE status = 'valid';
