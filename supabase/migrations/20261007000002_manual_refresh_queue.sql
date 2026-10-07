ALTER TABLE public.manual_refresh_state ADD COLUMN IF NOT EXISTS request_id TEXT;
ALTER TABLE public.manual_refresh_state ADD COLUMN IF NOT EXISTS refresh_status TEXT;
ALTER TABLE public.manual_refresh_state ADD COLUMN IF NOT EXISTS requested_at BIGINT;
ALTER TABLE public.manual_refresh_state ADD COLUMN IF NOT EXISTS started_at BIGINT;
ALTER TABLE public.manual_refresh_state ADD COLUMN IF NOT EXISTS completed_at BIGINT;
ALTER TABLE public.manual_refresh_state ADD COLUMN IF NOT EXISTS refresh_message TEXT;
