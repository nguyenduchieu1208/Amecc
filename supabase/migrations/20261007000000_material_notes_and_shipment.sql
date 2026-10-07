ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE public.material_import_rows ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE public.project_progress ADD COLUMN IF NOT EXISTS shipment TEXT;
ALTER TABLE public.project_progress_import_rows ADD COLUMN IF NOT EXISTS shipment TEXT;
