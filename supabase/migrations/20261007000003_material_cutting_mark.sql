ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS cutting_mark TEXT;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS material TEXT;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS lot TEXT;
ALTER TABLE public.material_import_rows ADD COLUMN IF NOT EXISTS cutting_mark TEXT;
ALTER TABLE public.material_import_rows ADD COLUMN IF NOT EXISTS material TEXT;
ALTER TABLE public.material_import_rows ADD COLUMN IF NOT EXISTS lot TEXT;
