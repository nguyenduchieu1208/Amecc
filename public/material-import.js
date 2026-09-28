const MATERIAL_FIELDS = {
  2: 'drawing', 3: 'assembly', 4: 'description', 5: 'part_no', 7: 'size', 12: 'quantity',
  14: 'weight', 15: 'scope', 20: 'received', 21: 'remaining',
};

const MATERIAL_HEADER_ALIASES = {
  drawing: ['drawingnumber', 'drawingno'],
  assembly: ['assemblyno', 'assemblynumber'],
  description: ['description'],
  part_no: ['partno', 'partnumber', 'detailno'],
  size: ['size'],
  quantity: ['tqty', 'totalqty', 'quantity', 'tquantity'],
  weight: ['tweight', 'totalweight'],
  scope: ['scopeofsteelwork', 'scopeofwork', 'scope', 'phamvicongviec'],
  received: ['danhan', 'received', 'receivedqty'],
  remaining: ['conthieu', 'remaining', 'balance'],
};

export const BTP_COLUMNS = [
  'part_no', 'material_type', 'unit', 'size', 'length_mm', 'design_quantity',
  'received', 'remaining', 'daily_progress', 'joint_check', 'status', 'note',
];

const BTP_HEADER_ALIASES = {
  part_no: ['partno1', 'partno', 'mabtpchitiet', 'mabtpchitietchitiet'],
  material_type: ['chungloai', 'chungloai1'],
  unit: ['dvg'],
  size: ['size', 'quycach', 'quycachsize'],
  length_mm: ['length', 'chieudai', 'chieudaimm'],
  design_quantity: ['tqty', 'slthietke', 'sltk', 'sltkthietke'],
  received: ['danhan', 'received', 'receivedqty', 'slnhan'],
  remaining: ['conthieu', 'remaining'],
  daily_progress: ['tiendotheongay'],
  joint_check: ['ktranoi'],
  status: ['trangthai', 'status'],
  note: ['ghichu', 'note', 'comments'],
};

function normalizeHeader(value) {
  return typeof value === 'string' ? value.replace(/[đĐ]/g, 'd').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '') : '';
}

function findMaterialHeader(header, aliases) {
  return header.findIndex((value) => aliases.includes(normalizeHeader(value))) + 1;
}

function materialColumns(header) {
  const columns = {};
  for (const [field, aliases] of Object.entries(MATERIAL_HEADER_ALIASES)) {
    const column = findMaterialHeader(header, aliases);
    if (column) columns[column] = field;
  }
  const scopeColumns = header.flatMap((value, index) => {
    const normalized = normalizeHeader(value);
    if (!normalized.startsWith('scope') && !normalized.startsWith('workscope') && normalized !== 'phamvicongviec') return [];
    const isSteel = normalized.includes('steel');
    const isPainting = normalized.includes('painting');
    const priority = isSteel && !isPainting ? 0 : (isPainting ? 2 : 1);
    return [{ column: index + 1, priority }];
  }).sort((left, right) => left.priority - right.priority || left.column - right.column).map(({ column }) => column);
  if (!scopeColumns.length && !columns[15] && !normalizeHeader(header[14])) scopeColumns.push(15);
  if (scopeColumns.length) columns[scopeColumns[0]] = 'scope';
  for (const [column, field] of Object.entries(MATERIAL_FIELDS)) {
    if (!Object.values(columns).includes(field) && !columns[column]) columns[column] = field;
  }
  const deliveryDate = findMaterialHeader(header, ['ngaygiao', 'ngaygiaohang', 'deliverydate', 'dateofdelivery']);
  const receiptDates = header.flatMap((value, index) => {
    const normalized = normalizeHeader(value);
    return normalized.startsWith('dateissue') || normalized.startsWith('issuedate') || normalized.startsWith('dateissued')
      ? [index + 1] : [];
  });
  return { columns, scopeColumns, deliveryDate, receiptDates };
}

function btpColumns(header) {
  const columns = {};
  const mappedFields = new Set();
  for (const [field, aliases] of Object.entries(BTP_HEADER_ALIASES)) {
    const column = findMaterialHeader(header, aliases);
    if (column && !mappedFields.has(field)) {
      columns[column] = field;
      mappedFields.add(field);
    }
  }
  return columns;
}

function btpNumeric(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return value;
  const text = value.trim().replace(/,/g, '');
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : value.trim();
}

function btpHeaderIndex(rows) {
  for (let index = 0; index < Math.min(rows.length, 60); index += 1) {
    const normalized = rows[index].map(normalizeHeader);
    const hasSize = normalized.some((value) => ['size', 'quycach', 'quycachsize'].includes(value));
    if ((normalized.includes('partno1') || normalized.includes('mabtpchitiet'))
      && hasSize && (normalized.includes('tqty') || normalized.includes('slthietke') || normalized.includes('sltk'))) return index;
  }
  return -1;
}

function btpDateHeader(value, xlsx) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getUTCDate()).padStart(2, '0')}/${String(value.getUTCMonth() + 1).padStart(2, '0')}/${value.getUTCFullYear()}`;
  }
  if (typeof value === 'number' && value > 20000) {
    const date = xlsx?.SSF?.parse_date_code?.(value);
    if (date?.y && date?.m && date?.d) return `${String(date.d).padStart(2, '0')}/${String(date.m).padStart(2, '0')}/${date.y}`;
  }
  if (typeof value === 'string' && /^\d{1,2}[/.\-]\d{1,2}(?:[/.\-]\d{2,4})?$/.test(value.trim())) return value.trim();
  return null;
}

function parseBtpSheet(sheetName, rows, xlsx) {
  const headerIndex = btpHeaderIndex(rows);
  if (headerIndex === -1) return [];
  const columns = btpColumns(rows[headerIndex]);
  const remainingColumn = Number(Object.keys(columns).find((column) => columns[column] === 'remaining'));
  const jointCheckColumn = Number(Object.keys(columns).find((column) => columns[column] === 'joint_check'));
  const dateColumns = rows[headerIndex].flatMap((value, index) => {
    const column = index + 1;
    if (!remainingColumn || !jointCheckColumn || column <= remainingColumn || column >= jointCheckColumn) return [];
    const date = btpDateHeader(value, xlsx);
    return date ? [{ column: index, date }] : [];
  });
  if (!Object.values(columns).includes('part_no')) return [];
  const rowsOut = [];
  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const raw = rows[rowIndex];
    const fields = {};
    for (const field of BTP_COLUMNS) fields[field] = null;
    for (const [column, field] of Object.entries(columns)) fields[field] = normalizeValue(raw[Number(column) - 1]);
    if (!fields.part_no) continue;
    for (const field of ['length_mm', 'design_quantity', 'received', 'remaining']) fields[field] = btpNumeric(fields[field]);
    if (dateColumns.length) {
      const dailyProgress = dateColumns
        .filter(({ column }) => raw[column] !== null && raw[column] !== undefined && raw[column] !== '')
        .map(({ date, column }) => `${date}: ${normalizeValue(raw[column])}`)
        .join('; ');
      if (dailyProgress) fields.daily_progress = dailyProgress;
    }
    if (fields.status == null && fields.remaining != null) fields.status = fields.remaining === 0 ? 'Đủ' : 'Còn thiếu';
    rowsOut.push({ source_sheet: sheetName, source_row: rowIndex + 1, ...fields });
  }
  return rowsOut;
}

function validIsoDate(year, month, day) {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeMaterialDate(value, xlsx) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return validIsoDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = xlsx?.SSF?.parse_date_code?.(value);
    if (parsed?.y && parsed?.m && parsed?.d) return validIsoDate(parsed.y, parsed.m, parsed.d);
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) return validIsoDate(isoMatch[1], isoMatch[2], isoMatch[3]);
  const match = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return validIsoDate(year, match[2], match[1]);
  }
  return null;
}

function sortedIssueDates(raw, columns, xlsx) {
  return [...new Set(columns.map((column) => normalizeMaterialDate(raw[column - 1], xlsx)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'en'))
    .join(', ') || null;
}

function normalizeValue(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return null;
}

function normalizePartNumber(sheet, rowIndex, value, xlsx) {
  if (typeof value !== 'number') return normalizeValue(value);
  try {
    const address = xlsx.utils.encode_cell({ r: rowIndex, c: 4 });
    const cell = sheet[address];
    if (cell && typeof xlsx.utils.format_cell === 'function') {
      return normalizeValue(xlsx.utils.format_cell(cell)) ?? normalizeValue(value);
    }
  } catch { /* Fall back to the raw value when cell formatting is unavailable. */ }
  return normalizeValue(value);
}

export function parseMaterialWorkbook(workbook, filename, projectCode, xlsx) {
  const records = [];
  const btpRecords = [];
  for (const sheetName of workbook.SheetNames) {
    const name = sheetName.toLowerCase();
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1, raw: true, cellDates: true, defval: null, blankrows: true,
    });
    if (name.startsWith('btp')) {
      btpRecords.push(...parseBtpSheet(sheetName, rows, xlsx));
      continue;
    }
    if (name === 'cover' || name.includes('backup')) continue;
    let headerIndex = -1;
    let symbolColumn = -1;
    for (let index = 0; index < Math.min(rows.length, 35); index += 1) {
      symbolColumn = rows[index].findIndex((value) => {
        const normalized = normalizeHeader(value);
        return normalized === 'symbol' || normalized.startsWith('assymbol');
      });
      if (symbolColumn !== -1) { headerIndex = index; break; }
    }
    if (headerIndex === -1) continue;
    const sourceColumns = materialColumns(rows[headerIndex]);
    let parent = null;
    for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const raw = rows[rowIndex];
      const symbol = normalizeValue(raw[symbolColumn]);
      const marker = String(symbol || '').trim().toLowerCase();
      const isMain = ['x', '×', '✓', 'yes', 'true', '1'].includes(marker);
      const fields = {};
      for (const [column, field] of Object.entries(sourceColumns.columns)) {
        fields[field] = normalizeValue(raw[Number(column) - 1]);
      }
      fields.part_no = normalizePartNumber(workbook.Sheets[sheetName], rowIndex, raw[4], xlsx);
      fields.scope = sourceColumns.scopeColumns.map((column) => normalizeValue(raw[column - 1])).find(Boolean) ?? fields.scope ?? null;
      fields.delivery_date = sourceColumns.deliveryDate ? normalizeMaterialDate(raw[sourceColumns.deliveryDate - 1], xlsx) : null;
      const receiptDates = sortedIssueDates(raw, sourceColumns.receiptDates, xlsx);
      fields.delivery_date = receiptDates || (sourceColumns.deliveryDate
        ? normalizeMaterialDate(raw[sourceColumns.deliveryDate - 1], xlsx)
        : null);
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
  if (!records.length && !btpRecords.length) throw new Error('Không tìm thấy sheet PL/BTP có tiêu đề AS Symbol, Symbol hoặc Part No.1 và dòng dữ liệu hợp lệ.');
  return { project_code: projectCode, filename, records, btp_records: btpRecords };
}

export async function readMaterialWorkbook(file, projectCode, xlsx) {
  if (!(file instanceof Blob) || file.size === 0 || file.size > 10 * 1024 * 1024
    || !/^[\w.-]+PL\.xlsx$/i.test(file.name)) {
    throw new Error('Chọn file .xlsx tên kết thúc bằng PL.xlsx, dung lượng tối đa 10 MB.');
  }
  const workbook = xlsx.read(await file.arrayBuffer(), { type: 'array', cellDates: true, bookVBA: false });
  return parseMaterialWorkbook(workbook, file.name, projectCode, xlsx);
}