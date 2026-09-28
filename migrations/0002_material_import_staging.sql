CREATE TABLE IF NOT EXISTS material_imports (
  id TEXT PRIMARY KEY,
  project_code TEXT NOT NULL,
  source_file TEXT NOT NULL,
  expected_rows INTEGER NOT NULL CHECK (expected_rows BETWEEN 1 AND 50000),
  next_row INTEGER NOT NULL DEFAULT 0,
  committed INTEGER NOT NULL DEFAULT 0 CHECK (committed IN (0, 1, 2)),
  commit_token TEXT,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_material_imports_expiry ON material_imports(expires_at);

CREATE TABLE IF NOT EXISTS material_import_rows (
  import_id TEXT NOT NULL REFERENCES material_imports(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  drawing TEXT,
  assembly TEXT,
  description TEXT,
  part_no TEXT,
  size TEXT,
  scope TEXT,
  quantity REAL,
  weight REAL,
  received REAL,
  remaining REAL,
  as_symbol TEXT,
  is_main INTEGER NOT NULL DEFAULT 0,
  parent TEXT,
  status TEXT NOT NULL,
  PRIMARY KEY (import_id, row_index)
);