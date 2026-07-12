CREATE UNLOGGED TABLE rate_limit_windows (
  key_hash text NOT NULL CHECK (key_hash ~ '^sha256:[0-9a-f]{64}$'),
  window_start timestamptz NOT NULL,
  request_cost integer NOT NULL CHECK (request_cost >= 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (key_hash, window_start)
);

CREATE INDEX rate_limit_windows_expiry_idx ON rate_limit_windows (expires_at);
