// Column whitelist: the project view also reads Shipment from D. Excel export keeps
// the user's requested removal of A, C:D, T:AI, AS, and every column from BB onward.
const QLDA_FIELDS = {
  2: 'project_code', 4: 'shipment', 5: 'item', 6: 'mh', 7: 'wo_date', 8: 'product_type',
  9: 'classification', 10: 'allocation', 11: 'drawing', 12: 'part_no', 13: 'size',
  14: 'quantity', 15: 'unit_weight', 16: 'total_weight', 17: 'profile', 18: 'item_id',
  19: 'note', 36: 'fitup_date', 37: 'fitup_qty', 38: 'fitup_weight',
  39: 'welding_date', 40: 'welding_qty', 41: 'welding_weight', 42: 'trial_assembly_date',
  43: 'trial_assembly_qty', 44: 'trial_assembly_weight', 46: 'acceptance_date',
  47: 'acceptance_qty', 48: 'acceptance_weight', 49: 'handover_date', 50: 'handover_qty',
  51: 'handover_weight', 52: 'receiver', 53: 'record_no',
};
const QLDA_IMPORT_LAST_COLUMN = 53; // BA; BB onward contains file-specific Check columns and is excluded.

function normalizeValue(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return null;
}

export function parseProjectWorkbook(workbook, filename, projectCode, xlsx = window.XLSX) {
  if (!xlsx?.read || !xlsx?.utils?.sheet_to_json) throw new Error('Không tải được thư viện đọc Excel; hãy tải lại trang rồi thử lại.');
  const filenameCode = String(filename || '').replace(/\.xlsx$/i, '').trim().toUpperCase();
  if (!filenameCode || String(projectCode || '').trim().toUpperCase() !== filenameCode) {
    throw new Error('Tên file QLDA không khớp mã dự án.');
  }
  const sheet = workbook.Sheets?.Progress;
  if (!sheet) throw new Error(`Workbook QLDA ${filename || ''} cần có sheet Progress.`.trim());
  const sourceRange = sheet['!ref'] && typeof xlsx.utils.decode_range === 'function'
    ? xlsx.utils.decode_range(sheet['!ref']) : null;
  if (sourceRange) sourceRange.e.c = Math.min(sourceRange.e.c, QLDA_IMPORT_LAST_COLUMN - 1);
  const sourceRows = xlsx.utils.sheet_to_json(sheet, { ...(sourceRange ? { range:sourceRange } : {}), header: 1, raw: true, defval: null, blankrows: true });
  const records = [];
  for (let index = 3; index < sourceRows.length; index += 1) {
    const raw = sourceRows[index];
    if (!raw.slice(0, QLDA_IMPORT_LAST_COLUMN).some((value) => value !== null && value !== undefined && value !== '')) continue;
    const mapped = {};
    for (const [column, field] of Object.entries(QLDA_FIELDS)) mapped[field] = normalizeValue(raw[Number(column) - 1]);
    if (![mapped.project_code, mapped.drawing, mapped.part_no, mapped.item].some((value) => value !== null && value !== undefined)) continue;
    const { project_code: _sourceProject, ...safeFields } = mapped;
    records.push({ source_row: index + 1, ...safeFields });
  }
  if (!records.length) throw new Error('Không tìm thấy dòng QLDA hợp lệ trong sheet Progress.');
  return records;
}

export async function readProjectWorkbook(file, xlsx = window.XLSX) {
  if (!xlsx?.read || !xlsx?.utils?.sheet_to_json) throw new Error('Không tải được thư viện đọc Excel; hãy tải lại trang rồi thử lại.');
  let workbook;
  try {
    workbook = xlsx.read(await file.arrayBuffer(), { type: 'array', cellDates: true, bookVBA: false });
  } catch {
    throw new Error(`Không đọc được workbook ${file.name}.`);
  }
  const filename = String(file.name || '');
  const projectCode = filename.replace(/\.xlsx$/i, '').trim().toUpperCase();
  return parseProjectWorkbook(workbook, filename, projectCode, xlsx);
}
