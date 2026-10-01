CREATE TABLE IF NOT EXISTS public.project_imports (
  id TEXT PRIMARY KEY,
  project_code TEXT NOT NULL,
  source_file TEXT NOT NULL,
  expected_rows INTEGER NOT NULL CHECK (expected_rows BETWEEN 1 AND 50000),
  next_row INTEGER NOT NULL DEFAULT 0,
  committed SMALLINT NOT NULL DEFAULT 0 CHECK (committed IN (0, 1, 2)),
  commit_token TEXT,
  expires_at BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_imports_expiry ON public.project_imports(expires_at);

CREATE TABLE IF NOT EXISTS public.project_progress_import_rows (
  import_id TEXT NOT NULL REFERENCES public.project_imports(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
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
  quantity DOUBLE PRECISION,
  unit_weight DOUBLE PRECISION,
  total_weight DOUBLE PRECISION,
  profile TEXT,
  item_id TEXT,
  note TEXT,
  fitup_date TEXT,
  fitup_qty DOUBLE PRECISION,
  fitup_weight DOUBLE PRECISION,
  welding_date TEXT,
  welding_qty DOUBLE PRECISION,
  welding_weight DOUBLE PRECISION,
  trial_assembly_date TEXT,
  trial_assembly_qty DOUBLE PRECISION,
  trial_assembly_weight DOUBLE PRECISION,
  acceptance_date TEXT,
  acceptance_qty DOUBLE PRECISION,
  acceptance_weight DOUBLE PRECISION,
  handover_date TEXT,
  handover_qty DOUBLE PRECISION,
  handover_weight DOUBLE PRECISION,
  receiver TEXT,
  record_no TEXT,
  PRIMARY KEY (import_id, row_index)
);

ALTER TABLE public.project_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_progress_import_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.project_imports, public.project_progress_import_rows FROM anon, authenticated;
