CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS projects (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_file TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_code TEXT NOT NULL REFERENCES projects(code) ON DELETE CASCADE,
  source_file TEXT NOT NULL,
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
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_materials_project ON materials(project_code);
CREATE INDEX IF NOT EXISTS idx_materials_parent ON materials(project_code, source_file, source_sheet, is_main);

CREATE TABLE IF NOT EXISTS project_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_code TEXT NOT NULL REFERENCES projects(code) ON DELETE CASCADE,
  source_file TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  item TEXT,
  mh TEXT,
  wo_date TEXT,
  product_type TEXT,
  classification TEXT,
  allocation TEXT,
  drawing TEXT,
  part_no TEXT,
  size TEXT,
  quantity REAL,
  unit_weight REAL,
  total_weight REAL,
  profile TEXT,
  item_id TEXT,
  note TEXT,
  monthly_plan TEXT,
  material_received_percent REAL,
  material_received_weight REAL,
  fitup_date TEXT,
  fitup_qty REAL,
  fitup_weight REAL,
  welding_date TEXT,
  welding_qty REAL,
  welding_weight REAL,
  trial_assembly_date TEXT,
  trial_assembly_qty REAL,
  trial_assembly_weight REAL,
  acceptance_date TEXT,
  acceptance_qty REAL,
  acceptance_weight REAL,
  handover_date TEXT,
  handover_qty REAL,
  handover_weight REAL,
  receiver TEXT,
  record_no TEXT,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_progress_project ON project_progress(project_code);
CREATE INDEX IF NOT EXISTS idx_progress_drawing ON project_progress(project_code, drawing);

CREATE TABLE IF NOT EXISTS import_runs (
  id TEXT PRIMARY KEY,
  project_code TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('materials', 'projects')),
  source_file TEXT NOT NULL,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);