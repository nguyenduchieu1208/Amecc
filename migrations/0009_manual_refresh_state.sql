CREATE TABLE IF NOT EXISTS manual_refresh_state (
  id TEXT PRIMARY KEY,
  last_refresh_at INTEGER NOT NULL
);
