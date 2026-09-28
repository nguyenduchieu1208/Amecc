ALTER TABLE materials ADD COLUMN delivery_date TEXT;
ALTER TABLE materials ADD COLUMN issue_dates TEXT;

ALTER TABLE material_import_rows ADD COLUMN delivery_date TEXT;
ALTER TABLE material_import_rows ADD COLUMN issue_dates TEXT;