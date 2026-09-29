const FORM_SHEET = 'Bieu mau check tinh trang BTP';
const FIRST_DATA_ROW = 13;

function receiptEvents(value) {
  return String(value ?? '').split(/\s*;\s*/).flatMap((entry) => {
    const divider = entry.lastIndexOf(':');
    if (divider < 0) return [];
    const date = entry.slice(0, divider).trim();
    const quantity = entry.slice(divider + 1).trim();
    return date && quantity ? [{ date, quantity }] : [];
  });
}

function dateSortKey(value) {
  const match = String(value).match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (!match) return String(value);
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year.padStart(4, '0')}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

export function listBtpReceiptDates(rows) {
  return [...new Set((Array.isArray(rows) ? rows : []).flatMap((row) => receiptEvents(row?.daily_progress).map((event) => event.date)))]
    .sort((left, right) => dateSortKey(left).localeCompare(dateSortKey(right)));
}

export function filterBtpRowsByReceiptDate(rows, selectedDate) {
  if (!selectedDate) return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).filter((row) => receiptEvents(row?.daily_progress).some((event) => event.date === selectedDate));
}

function writeCell(sheet, address, value) {
  if (value === null || value === undefined || value === '') return;
  const cell = sheet[address] || {};
  const next = { ...cell, t: typeof value === 'number' && Number.isFinite(value) ? 'n' : 's', v: value };
  delete next.w;
  delete next.h;
  sheet[address] = next;
}

function partKey(value) {
  return String(value ?? '').trim().toLocaleUpperCase();
}

function sourceSheetLabel(value) {
  return String(value ?? '').replace(/^BTP[-_\s]*/i, '') || String(value ?? '');
}

function parentContext(row, materialRows) {
  const partNo = partKey(row?.part_no);
  const sourceFile = partKey(row?.source_file);
  const sourceSheet = partKey(sourceSheetLabel(row?.source_sheet));
  const candidates = (Array.isArray(materialRows) ? materialRows : []).filter((material) =>
    Number(material?.is_main) === 1
    && partKey(material.source_file) === sourceFile
    && partKey(material.source_sheet) === sourceSheet
    && material.assembly
    && partNo.startsWith(`${partKey(material.assembly)}-`));
  const parent = candidates.sort((left, right) => String(right.assembly).length - String(left.assembly).length)[0] || null;
  if (!parent) return { parent:null, bomLine:null, assemblyCode:partNo.split('-').slice(0, 3).join('-') };
  const childCode = partNo.slice(String(parent.assembly).length + 1);
  const bomLine = (Array.isArray(materialRows) ? materialRows : []).find((material) =>
    Number(material?.is_main) !== 1
    && partKey(material.source_file) === sourceFile
    && partKey(material.source_sheet) === sourceSheet
    && partKey(material.parent) === partKey(parent.assembly)
    && partKey(material.part_no) === partKey(childCode)) || null;
  return { parent, bomLine, assemblyCode:parent.assembly };
}

function workbookFilename(projectCode, selectedSheet) {
  const sheetLabel = selectedSheet ? sourceSheetLabel(selectedSheet) : 'tat-ca-sheet';
  const safeSheet = sheetLabel.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `List_thieu_mau_${projectCode}_${safeSheet}_${date}.xlsx`;
}

export async function exportBtpShortageWorkbook({ rows, progressRows, materialRows, projectCode, selectedSheet, xlsx, templateUrl }) {
  if (!xlsx?.read || !xlsx?.writeFile) throw new Error('Không tải được thư viện Excel; hãy tải lại trang rồi thử lại.');
  const response = await fetch(templateUrl);
  if (!response.ok) throw new Error('Không tải được file mẫu List_thieu_mau.xlsx.');
  const workbook = xlsx.read(await response.arrayBuffer(), { type: 'array', cellStyles: true, cellDates: true });
  const sheet = workbook.Sheets[FORM_SHEET];
  if (!sheet) throw new Error(`File mẫu thiếu sheet “${FORM_SHEET}”.`);

  const projectRows = Array.isArray(progressRows) ? progressRows : [];
  const bomRows = Array.isArray(materialRows) ? materialRows : [];
  const bomByPart = new Map();
  for (const row of projectRows) {
    const key = partKey(row?.part_no);
    if (!key) continue;
    if (!bomByPart.has(key)) bomByPart.set(key, []);
    bomByPart.get(key).push(row);
  }
  const shortageRows = (Array.isArray(rows) ? rows : []).slice().sort((left, right) =>
    String(left.source_sheet ?? '').localeCompare(String(right.source_sheet ?? ''), 'vi', { numeric: true, sensitivity: 'base' })
    || Number(left.source_row ?? 0) - Number(right.source_row ?? 0));

  const range = xlsx.utils.decode_range(sheet['!ref'] || 'A1:BL12');
  const lastTemplateRow = range.e.r + 1;
  for (const address of Object.keys(sheet)) {
    if (!/^[A-Z]+\d+$/.test(address)) continue;
    const rowNumber = Number(address.match(/\d+$/)[0]);
    const cell = sheet[address];
    if (rowNumber < FIRST_DATA_ROW || (cell.v === undefined && cell.f === undefined)) continue;
    delete cell.v;
    delete cell.f;
    delete cell.w;
    delete cell.h;
    cell.t = 'z';
  }

  const units = [...new Set(shortageRows.map((row) => String(row.unit ?? '').trim()).filter(Boolean))].sort();
  writeCell(sheet, 'C4', projectCode);
  writeCell(sheet, 'C5', units.join(', '));
  writeCell(sheet, 'C6', new Intl.DateTimeFormat('vi-VN').format(new Date()));

  const dataEndRow = FIRST_DATA_ROW + shortageRows.length - 1;
  for (const [index, row] of shortageRows.entries()) {
    const rowNumber = FIRST_DATA_ROW + index;
    const context = parentContext(row, bomRows);
    const parentProgress = context.parent ? (bomByPart.get(partKey(context.assemblyCode)) || []) : [];
    const bomLine = context.bomLine;
    const unitWeight = typeof row.unit_weight === 'number' ? row.unit_weight : null;
    const designQuantity = typeof row.design_quantity === 'number' ? row.design_quantity : null;
    const received = typeof row.received === 'number' ? row.received : null;
    const remaining = typeof row.remaining === 'number' ? row.remaining : null;
    const drawings = [...new Set([context.parent?.drawing, ...parentProgress.map((bom) => bom.drawing)].map((value) => String(value ?? '').trim()).filter(Boolean))];
    const bomQuantity = typeof bomLine?.quantity === 'number' ? bomLine.quantity : null;
    const receiptHistory = receiptEvents(row.daily_progress).map((event) => `${event.date}: ${event.quantity}`).join('\n');
    const sourceDetails = [
      `BOM cha: ${context.parent ? context.assemblyCode : 'Không nối được BOM'}${context.parent?.size ? ` · Kích thước: ${context.parent.size}` : ''}`,
      context.parent ? `Nguồn BOM cha: ${context.parent.source_file} · ${context.parent.source_sheet} · dòng ${context.parent.source_row}` : '',
      bomLine ? `BOM con: ${bomLine.part_no} · SL: ${bomLine.quantity ?? '—'} · Mô tả: ${bomLine.description || '—'} · Size: ${bomLine.size || '—'} · KL: ${bomLine.weight ?? '—'}` : 'Không tìm thấy dòng con tương ứng trong PL/BOM',
      bomLine ? `Nguồn BOM con: ${bomLine.source_file} · ${bomLine.source_sheet} · dòng ${bomLine.source_row}` : '',
      parentProgress.length ? `QLDA: ${parentProgress.map((item) => `${item.part_no} · SL ${item.quantity ?? '—'} · U.Weight ${item.unit_weight ?? '—'} · T.Weight ${item.total_weight ?? '—'} · Profile ${item.profile || '—'} · dòng ${item.source_row}`).join(' | ')}` : '',
      `Nguồn BTP: ${row.source_file || projectCode} · ${row.source_sheet || 'BTP'} · dòng ${row.source_row || '—'}`,
      row.note ? `Ghi chú BTP: ${row.note}` : '',
    ].filter(Boolean).join('\n');
    const values = {
      A: index + 1,
      B: drawings.join(', '),
      C: context.parent ? context.assemblyCode : null,
      D: row.material_type,
      E: row.description,
      F: row.part_no,
      H: row.size,
      I: row.length_mm,
      J: row.material,
      K: bomQuantity,
      M: designQuantity,
      N: unitWeight,
      O: typeof row.total_weight === 'number' ? row.total_weight : (designQuantity !== null && unitWeight !== null ? designQuantity * unitWeight : null),
      P: sourceDetails,
      Z: receiptHistory,
      AA: remaining,
      AB: row.material_type,
      AC: row.unit,
      AD: received,
      AE: received !== null && unitWeight !== null ? received * unitWeight : null,
      AF: remaining,
      AG: row.shortage_weight,
      AP: 'Còn thiếu',
    };
    for (const [column, value] of Object.entries(values)) writeCell(sheet, `${column}${rowNumber}`, value);
    const wrapColumns = ['P', 'Z'];
    for (const column of wrapColumns) {
      const address = `${column}${rowNumber}`;
      if (!sheet[address]) continue;
      const cell = sheet[address];
      cell.s = { ...cell.s, alignment: { ...cell.s?.alignment, vertical: 'top', wrapText: true } };
    }
    const noteLength = String(values.P ?? '').length;
    const visibleLines = Math.max(receiptEvents(row.daily_progress).length, String(values.P ?? '').split('\n').length, Math.ceil(noteLength / 42), 2);
    const rowHeights = sheet['!rows'] || [];
    rowHeights[rowNumber - 1] = { ...rowHeights[rowNumber - 1], hpt: Math.min(240, visibleLines * 15) };
    sheet['!rows'] = rowHeights;
  }

  const endRow = Math.max(lastTemplateRow, dataEndRow, 12);
  if (shortageRows.length) sheet['!autofilter'] = { ref: `A12:BL${dataEndRow}` };
  sheet['!ref'] = `A1:BL${endRow}`;
  const filename = workbookFilename(projectCode, selectedSheet);
  xlsx.writeFile(workbook, filename, { bookType: 'xlsx', cellStyles: true });
  return { filename, rowCount: shortageRows.length };
}
