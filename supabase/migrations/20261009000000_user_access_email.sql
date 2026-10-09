ALTER TABLE public.users ADD COLUMN IF NOT EXISTS admin_level TEXT NOT NULL DEFAULT 'none';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS can_sync INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email_verified_at BIGINT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS owner_protected INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_admin_level_check;
ALTER TABLE public.users ADD CONSTRAINT users_admin_level_check
  CHECK (admin_level IN ('none', 'superadmin', 'level1', 'level2'));
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_can_sync_check;
ALTER TABLE public.users ADD CONSTRAINT users_can_sync_check CHECK (can_sync IN (0, 1));
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_owner_protected_check;
ALTER TABLE public.users ADD CONSTRAINT users_owner_protected_check CHECK (owner_protected IN (0, 1));
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_is_active_check;
ALTER TABLE public.users ADD CONSTRAINT users_is_active_check CHECK (is_active IN (0, 1));

UPDATE public.users
SET admin_level = 'level2', can_sync = 1, owner_protected = 0
WHERE role = 'admin' AND admin_level = 'none';

UPDATE public.users SET owner_protected = 0 WHERE role <> 'admin';
UPDATE public.users SET admin_level = 'level2', can_sync = 1, owner_protected = 0 WHERE role = 'admin';
UPDATE public.users SET admin_level = 'superadmin', owner_protected = 1
WHERE id = (
  SELECT id FROM public.users WHERE role = 'admin'
  ORDER BY created_at ASC, id ASC LIMIT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower
  ON public.users (LOWER(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_owner
  ON public.users(owner_protected) WHERE owner_protected = 1;
CREATE INDEX IF NOT EXISTS idx_users_created_by ON public.users(created_by);

CREATE TABLE IF NOT EXISTS public.password_recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('email_verify', 'password_reset')),
  target_email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at BIGINT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_recovery_codes_user
  ON public.password_recovery_codes(user_id, purpose, created_at);

CREATE TABLE IF NOT EXISTS public.account_audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  details TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_audit_logs_created_at ON public.account_audit_logs(created_at);

ALTER TABLE public.manual_refresh_state ADD COLUMN IF NOT EXISTS requested_by TEXT REFERENCES public.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.prevent_amecc_owner_removal_or_demotion()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.owner_protected = 1 AND TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'The AMECC owner account cannot be deleted.';
  END IF;
  IF OLD.owner_protected = 1 AND TG_OP = 'UPDATE' AND (
    NEW.role <> OLD.role OR NEW.admin_level <> OLD.admin_level OR
    NEW.owner_protected <> 1 OR NEW.is_active <> OLD.is_active
  ) THEN
    RAISE EXCEPTION 'The AMECC owner account cannot be disabled or demoted.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_amecc_owner_account ON public.users;
CREATE TRIGGER protect_amecc_owner_account
BEFORE DELETE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.prevent_amecc_owner_removal_or_demotion();
DROP TRIGGER IF EXISTS protect_amecc_owner_privileges ON public.users;
CREATE TRIGGER protect_amecc_owner_privileges
BEFORE UPDATE OF role, admin_level, owner_protected, is_active ON public.users
FOR EACH ROW EXECUTE FUNCTION public.prevent_amecc_owner_removal_or_demotion();

ALTER TABLE public.password_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_audit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.password_recovery_codes, public.account_audit_logs FROM anon, authenticated;
