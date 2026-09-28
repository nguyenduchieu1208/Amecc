ALTER TABLE material_imports ADD COLUMN category TEXT NOT NULL DEFAULT 'materials' CHECK (category IN ('materials', 'btp'));

CREATE TABLE IF NOT EXISTS import_runs_v2 (
  id TEXT PRIMARY KEY,
  project_code TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('materials', 'projects', 'btp')),
  source_file TEXT NOT NULL,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO import_runs_v2 (id, project_code, category, source_file, imported_rows, imported_at)
SELECT id, project_code, category, source_file, imported_rows, imported_at FROM import_runs;

DROP TABLE import_runs;
ALTER TABLE import_runs_v2 RENAME TO import_runs;

CREATE TABLE IF NOT EXISTS btp_material_import_rows (
  import_id TEXT NOT NULL REFERENCES material_imports(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  part_no TEXT,
  material_type TEXT,
  unit TEXT,
  size TEXT,
  length_mm REAL,
  design_quantity REAL,
  received REAL,
  remaining REAL,
  daily_progress TEXT,
  joint_check TEXT,
  status TEXT,
  note TEXT,
  PRIMARY KEY (import_id, row_index)
);

CREATE TABLE IF NOT EXISTS btp_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_code TEXT NOT NULL REFERENCES projects(code) ON DELETE CASCADE,
  source_file TEXT NOT NULL,
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  part_no TEXT,
  material_type TEXT,
  unit TEXT,
  size TEXT,
  length_mm REAL,
  design_quantity REAL,
  received REAL,
  remaining REAL,
  daily_progress TEXT,
  joint_check TEXT,
  status TEXT,
  note TEXT,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_btp_materials_project ON btp_materials(project_code, source_file, source_sheet, source_row);