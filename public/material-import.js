const MATERIAL_FIELDS = {
  2: 'drawing', 3: 'assembly', 4: 'description', 5: 'part_no', 7: 'size', 12: 'quantity',
  14: 'weight', 15: 'scope', 20: 'received', 21: 'remaining',
};

function normalizeValue(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return null;
}

export function parseMaterialWorkbook(workbook, filename, projectCode, xlsx) {
  const records = [];
  for (const sheetName of workbook.SheetNames) {
    const name = sheetName.toLowerCase();
    if (name === 'cover' || name.startsWith('btp') || name.includes('backup')) continue;
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1, raw: true, cellDates: true, defval: null, blankrows: true,
    });
    let headerIndex = -1;
    let symbolColumn = -1;
    for (let index = 0; index < Math.min(rows.length, 35); index += 1) {
      symbolColumn = rows[index].findIndex((value) => typeof value === 'string'
        && ['as symbol', 'symbol'].includes(value.trim().toLowerCase()));
      if (symbolColumn !== -1) { headerIndex = index; break; }
    }
    if (headerIndex === -1) continue;
    let parent = null;
    for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const raw = rows[rowIndex];
      const symbol = normalizeValue(raw[symbolColumn]);
      const marker = String(symbol || '').trim().toLowerCase();
      const isMain = ['x', '×', '✓', 'yes', 'true', '1'].includes(marker);
      const fields = {};
      for (const [column, field] of Object.entries(MATERIAL_FIELDS)) {
        fields[field] = normalizeValue(raw[Number(column) - 1]);
      }
      if (![fields.drawing, fields.assembly, fields.part_no, fields.description]
        .some((item) => item !== null && item !== undefined)) continue;
      if (typeof fields.drawing === 'number') continue;
      if (isMain) parent = fields.assembly || fields.drawing || fields.description || 'Cấu kiện chính';
      let status = 'chưa xác định';
      if (typeof fields.quantity === 'number') {
        if (typeof fields.received === 'number') {
          status = fields.received >= fields.quantity ? 'đủ' : (fields.received > 0 ? 'chưa đủ' : 'chưa có');
        } else if (typeof fields.remaining === 'number') {
          status = fields.remaining <= 0 ? 'đủ' : (fields.remaining < fields.quantity ? 'chưa đủ' : 'chưa có');
        }
      } else if (isMain) status = 'cấu kiện chính';
      records.push({
        source_sheet: sheetName, source_row: rowIndex + 1, ...fields,
        as_symbol: symbol, is_main: isMain ? 1 : 0, parent, status,
      });
    }
  }
  if (!records.length) throw new Error('Không tìm thấy sheet PL có tiêu đề AS Symbol hoặc Symbol và dòng dữ liệu hợp lệ.');
  return { project_code: projectCode, filename, records };
}

export async function readMaterialWorkbook(file, projectCode, xlsx) {
  if (!(file instanceof Blob) || file.size === 0 || file.size > 10 * 1024 * 1024
    || !/^[\w.-]+PL\.xlsx$/i.test(file.name)) {
    throw new Error('Chọn file .xlsx tên kết thúc bằng PL.xlsx, dung lượng tối đa 10 MB.');
  }
  const workbook = xlsx.read(await file.arrayBuffer(), { type: 'array', cellDates: true, bookVBA: false });
  return parseMaterialWorkbook(workbook, file.name, projectCode, xlsx);
}