import { materialSheetKey } from './material-linkage.js';
import { getBtpShortageQuantity, getBtpShortageWeight } from './material-search.js';
import { fillTemplateWorkbook } from './template-xlsx.js';

const FORM_SHEET = 'Bieu mau check tinh trang BTP';
const FIRST_DATA_ROW = 14;
const BTP_TEMPLATE_COLUMNS = Object.freeze({
  part_no:'F',
  size:'H',
  length_mm:'I',
  design_quantity:'M',
  unit_weight:'N',
  total_weight:'O',
  note:'P',
  daily_progress:'Z',
  remaining:'AA',
  material_type:'AB',
  unit:'AC',
  received:'AD',
  received_weight:'AE',
  remaining_quantity:'AF',
  remaining_weight:'AG',
});

function btpRemark(row, received, remaining) {
  const status = row.status || (remaining === 0 ? 'Đã đủ' : received > 0 ? 'Đang nhận' : 'Còn thiếu');
  return [
    row.joint_check ? `Ktra nối: ${row.joint_check}` : '',
    status ? `Trạng thái: ${status}` : '',
    row.note ? `Ghi chú: ${row.note}` : '',
  ].filter(Boolean).join('\n');
}

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
  const match = String(value).match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (!match) return String(value);
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year.padStart(4, '0')}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

export function listBtpReceiptDates(rows) {
  return [...new Set((Array.isArray(rows) ? rows : []).flatMap((row) => receiptEvents(row?.daily_progress).map((event) => event.date)))].sort((left, right) =>
    dateSortKey(left).localeCompare(dateSortKey(right)));
}

export function filterBtpRowsByReceiptDate(rows, selectedDate) {
  if (!selectedDate) return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).filter((row) => receiptEvents(row?.daily_progress).some((event) => event.date === selectedDate));
}

function selectedSheetKeys(selectedSheets) {
  if (selectedSheets === null || selectedSheets === undefined) return null;
  const keys = new Set();
  for (const value of selectedSheets) {
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed) && parsed.length === 2) keys.add(materialSheetKey(parsed[0], parsed[1]));
      } catch { /* Ignore malformed sheet selections. */ }
    } else if (value && typeof value === 'object' && value.source_file && value.source_sheet) {
      keys.add(materialSheetKey(value.source_file, value.source_sheet));
    }
  }
  return keys;
}

function selectedSheetName(selectedSheets, projectCode) {
  if (selectedSheets === null || selectedSheets === undefined) return `List_thieu_mau_${projectCode}_tat-ca-sheet`;
  const labels = [...selectedSheetKeys(selectedSheets) || []].map((value) => {
    try { return JSON.parse(value)[1]; } catch { return ''; }
  }).filter(Boolean);
  const sheetLabel = labels.length === 1 ? labels[0] : `${labels.length}-sheet`;
  const safe = sheetLabel.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'sheet';
  return `List_thieu_mau_${projectCode}_${safe}`;
}

function reportFilename(projectCode, selectedSheets, now = new Date()) {
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `${selectedSheetName(selectedSheets, projectCode)}_${date}.xlsx`;
}

export function buildBtpShortageTemplate({ templateBytes, rows, projectCode, selectedSheets = null, now = new Date() }) {
  if (!projectCode) throw new Error('Chưa xác định được mã dự án để xuất file.');
  const selected = selectedSheetKeys(selectedSheets);
  if (selected && selected.size === 0) throw new Error('Hãy chọn ít nhất một sheet để xuất List thiếu.');
  const selectedRows = (Array.isArray(rows) ? rows : []).filter((row) =>
    !selected || selected.has(materialSheetKey(row.source_file, row.source_sheet)));
  const shortageRows = selectedRows.map((row) => ({
    ...row,
    remaining:getBtpShortageQuantity(row),
    shortage_weight:getBtpShortageWeight(row),
  })).filter((row) => typeof row.remaining === 'number' && row.remaining > 0)
    .sort((left, right) => String(left.source_sheet ?? '').localeCompare(String(right.source_sheet ?? ''), 'vi', { numeric:true, sensitivity:'base' })
      || Number(left.source_row ?? 0) - Number(right.source_row ?? 0));
  if (!shortageRows.length) throw new Error('Không có dòng BTP còn thiếu trong các sheet đã chọn.');

  const cellValues = {
    C4:projectCode,
    C5:[...new Set(shortageRows.map((row) => String(row.unit ?? '').trim()).filter(Boolean))].sort().join(', '),
    C6:new Intl.DateTimeFormat('vi-VN').format(now),
  };
  for (const [index, row] of shortageRows.entries()) {
    const rowNumber = FIRST_DATA_ROW + index;
    const unitWeight = typeof row.unit_weight === 'number' ? row.unit_weight : null;
    const designQuantity = typeof row.design_quantity === 'number' ? row.design_quantity : null;
    const received = typeof row.received === 'number' ? row.received : null;
    const remaining = row.remaining;
    const values = {
      A:index + 1,
      [BTP_TEMPLATE_COLUMNS.part_no]:row.part_no,
      [BTP_TEMPLATE_COLUMNS.size]:row.size,
      [BTP_TEMPLATE_COLUMNS.length_mm]:row.length_mm,
      [BTP_TEMPLATE_COLUMNS.design_quantity]:designQuantity,
      [BTP_TEMPLATE_COLUMNS.unit_weight]:unitWeight,
      [BTP_TEMPLATE_COLUMNS.total_weight]:typeof row.total_weight === 'number' ? row.total_weight : null,
      [BTP_TEMPLATE_COLUMNS.note]:btpRemark(row, received, remaining),
      [BTP_TEMPLATE_COLUMNS.daily_progress]:receiptEvents(row.daily_progress).map((event) => `${event.date}: ${event.quantity}`).join('\n'),
      [BTP_TEMPLATE_COLUMNS.remaining]:remaining,
      [BTP_TEMPLATE_COLUMNS.material_type]:row.material_type,
      [BTP_TEMPLATE_COLUMNS.unit]:row.unit,
      [BTP_TEMPLATE_COLUMNS.received]:received,
      [BTP_TEMPLATE_COLUMNS.received_weight]:received !== null && unitWeight !== null ? received * unitWeight : null,
      [BTP_TEMPLATE_COLUMNS.remaining_quantity]:remaining,
      [BTP_TEMPLATE_COLUMNS.remaining_weight]:row.shortage_weight,
    };
    for (const [column, value] of Object.entries(values)) {
      if (value === null || value === undefined || value === '') continue;
      cellValues[`${column}${rowNumber}`] = value;
    }
  }

  const bytes = fillTemplateWorkbook(templateBytes, FORM_SHEET, cellValues);
  return {
    bytes,
    filename:reportFilename(projectCode, selectedSheets, now),
    rowCount:shortageRows.length,
  };
}

export async function exportBtpShortageWorkbook(options) {
  const response = await fetch(options.templateUrl);
  if (!response.ok) throw new Error('Không tải được file mẫu List_thieu_mau.xlsx.');
  const report = buildBtpShortageTemplate({ ...options, templateBytes:new Uint8Array(await response.arrayBuffer()) });
  const blob = new Blob([report.bytes], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = report.filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const { bytes:_bytes, ...summary } = report;
  return summary;
}
