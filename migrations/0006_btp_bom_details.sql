ALTER TABLE btp_materials ADD COLUMN description TEXT;
ALTER TABLE btp_materials ADD COLUMN material TEXT;
ALTER TABLE btp_materials ADD COLUMN total_weight REAL;

ALTER TABLE btp_material_import_rows ADD COLUMN description TEXT;
ALTER TABLE btp_material_import_rows ADD COLUMN material TEXT;
ALTER TABLE btp_material_import_rows ADD COLUMN total_weight REAL;
