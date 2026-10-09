ALTER TABLE users ADD COLUMN admin_level TEXT NOT NULL DEFAULT 'none'
  CHECK (admin_level IN ('none', 'superadmin', 'level1', 'level2'));
ALTER TABLE users ADD COLUMN can_sync INTEGER NOT NULL DEFAULT 0 CHECK (can_sync IN (0, 1));
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN email_verified_at INTEGER;
ALTER TABLE users ADD COLUMN owner_protected INTEGER NOT NULL DEFAULT 0 CHECK (owner_protected IN (0, 1));
ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1));
ALTER TABLE users ADD COLUMN created_by TEXT REFERENCES users(id) ON DELETE SET NULL;

UPDATE users
SET admin_level = 'level2', can_sync = 1, owner_protected = 0
WHERE role = 'admin';

UPDATE users SET admin_level = 'superadmin', owner_protected = 1
WHERE id = (
  SELECT id FROM users WHERE role = 'admin'
  ORDER BY created_at ASC, id ASC LIMIT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_nocase
  ON users(email COLLATE NOCASE) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_owner
  ON users(owner_protected) WHERE owner_protected = 1;
CREATE INDEX IF NOT EXISTS idx_users_created_by ON users(created_by);

CREATE TABLE IF NOT EXISTS password_recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('email_verify', 'password_reset')),
  target_email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_recovery_codes_user
  ON password_recovery_codes(user_id, purpose, created_at);

CREATE TABLE IF NOT EXISTS account_audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  details TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_audit_logs_created_at ON account_audit_logs(created_at);

ALTER TABLE manual_refresh_state ADD COLUMN requested_by TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE TRIGGER IF NOT EXISTS protect_amecc_owner_delete
BEFORE DELETE ON users
WHEN OLD.owner_protected = 1
BEGIN
  SELECT RAISE(ABORT, 'The AMECC owner account cannot be deleted.');
END;

CREATE TRIGGER IF NOT EXISTS protect_amecc_owner_privileges
BEFORE UPDATE OF role, admin_level, owner_protected, is_active ON users
WHEN OLD.owner_protected = 1 AND (
  NEW.role <> OLD.role OR NEW.admin_level <> OLD.admin_level OR
  NEW.owner_protected <> 1 OR NEW.is_active <> OLD.is_active
)
BEGIN
  SELECT RAISE(ABORT, 'The AMECC owner account cannot be disabled or demoted.');
END;
