CREATE TABLE IF NOT EXISTS public.manual_refresh_state (
  id TEXT PRIMARY KEY,
  last_refresh_at BIGINT NOT NULL
);

ALTER TABLE public.manual_refresh_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.manual_refresh_state FROM anon, authenticated;
