CREATE INDEX IF NOT EXISTS resolution_runs_retention_idx
ON resolution_runs (status, activated_at DESC, completed_at DESC)
WHERE status = 'retired';
