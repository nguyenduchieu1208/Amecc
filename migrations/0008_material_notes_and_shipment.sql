ALTER TABLE materials ADD COLUMN note TEXT;
ALTER TABLE material_import_rows ADD COLUMN note TEXT;
ALTER TABLE project_progress ADD COLUMN shipment TEXT;
ALTER TABLE project_progress_import_rows ADD COLUMN shipment TEXT;
