ALTER TABLE manual_refresh_state ADD COLUMN request_id TEXT;
ALTER TABLE manual_refresh_state ADD COLUMN refresh_status TEXT;
ALTER TABLE manual_refresh_state ADD COLUMN requested_at INTEGER;
ALTER TABLE manual_refresh_state ADD COLUMN started_at INTEGER;
ALTER TABLE manual_refresh_state ADD COLUMN completed_at INTEGER;
ALTER TABLE manual_refresh_state ADD COLUMN refresh_message TEXT;
