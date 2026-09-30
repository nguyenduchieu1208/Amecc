import { createMaterialLinkIndexes, findProgressForAssembly, linkBtpToBom, materialSheetKey } from './material-linkage.js';
import { getBtpShortageQuantity, getBtpShortageWeight } from './material-search.js';
import { fillTemplateWorkbook } from './template-xlsx.js';

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

function partKey(value) {
  return String(value ?? '').trim().toLocaleUpperCase();
}

function sourceSheetLabel(value) {
  return String(value ?? '').replace(/^BTP[-_\s]*/i, '').trim() || String(value ?? '');
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

function qldaDetails(progressRows) {
  return progressRows.map((item) => `${item.part_no || '—'} · SL ${item.quantity ?? '—'} · U.Weight ${item.unit_weight ?? '—'} · T.Weight ${item.total_weight ?? '—'} · Profile ${item.profile || '—'} · bàn giao ${item.handover_qty ?? '—'} ${item.handover_date || ''} · nhận ${item.receiver || '—'} · dòng ${item.source_row || '—'}`);
}

export function buildBtpShortageTemplate({ templateBytes, rows, progressRows, materialRows, projectCode, selectedSheets = null, now = new Date() }) {
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

  const bomRows = Array.isArray(materialRows) ? materialRows : [];
  const qldaRows = Array.isArray(progressRows) ? progressRows : [];
  const bomIndexes = createMaterialLinkIndexes(bomRows);
  const cellValues = {
    C4:projectCode,
    C5:[...new Set(shortageRows.map((row) => String(row.unit ?? '').trim()).filter(Boolean))].sort().join(', '),
    C6:new Intl.DateTimeFormat('vi-VN').format(now),
  };
  const matchCounts = { bom:0, qlda:0 };
  for (const [index, row] of shortageRows.entries()) {
    const rowNumber = FIRST_DATA_ROW + index;
    const context = linkBtpToBom(row, bomRows, bomIndexes);
    const qlda = findProgressForAssembly(context.parent, qldaRows);
    const parentProgress = qlda.rows;
    const bomLine = context.bomLine;
    const unitWeight = typeof row.unit_weight === 'number' ? row.unit_weight : null;
    const designQuantity = typeof row.design_quantity === 'number' ? row.design_quantity : null;
    const received = typeof row.received === 'number' ? row.received : null;
    const remaining = row.remaining;
    const drawings = [...new Set([context.parent?.drawing, ...parentProgress.map((item) => item.drawing)]
      .map((value) => String(value ?? '').trim()).filter(Boolean))];
    const sourceDetails = [
      `BOM cha: ${context.parent ? context.parent.assembly : 'Không nối được BOM'}${context.parent?.size ? ` · Kích thước: ${context.parent.size}` : ''}`,
      context.parent ? `Nguồn BOM cha: ${context.parent.source_file} · ${context.parent.source_sheet} · dòng ${context.parent.source_row}` : '',
      bomLine ? `BOM con: ${bomLine.part_no} · SL: ${bomLine.quantity ?? '—'} · Mô tả: ${bomLine.description || '—'} · Size: ${bomLine.size || '—'} · KL: ${bomLine.weight ?? '—'}` : 'Không tìm thấy dòng con tương ứng trong PL/BOM',
      bomLine ? `Nguồn BOM con: ${bomLine.source_file} · ${bomLine.source_sheet} · dòng ${bomLine.source_row}` : '',
      parentProgress.length ? `QLDA (${qlda.match}): ${qldaDetails(parentProgress).join(' | ')}` : `QLDA: Không tìm thấy cấu kiện ${context.parent?.assembly || ''} / bản vẽ ${context.parent?.drawing || ''} trong sheet Progress.`,
      `Nguồn BTP: ${row.source_file || projectCode} · ${row.source_sheet || 'BTP'} · dòng ${row.source_row || '—'}`,
      row.note ? `Ghi chú BTP: ${row.note}` : '',
    ].filter(Boolean).join('\n');
    const values = {
      A:index + 1,
      B:drawings.join(', '),
      C:context.parent?.assembly,
      D:row.material_type,
      E:row.description,
      F:row.part_no,
      H:row.size,
      I:row.length_mm,
      J:row.material,
      K:bomLine?.quantity,
      M:designQuantity,
      N:unitWeight,
      O:typeof row.total_weight === 'number' ? row.total_weight : (designQuantity !== null && unitWeight !== null ? designQuantity * unitWeight : null),
      P:sourceDetails,
      Z:receiptEvents(row.daily_progress).map((event) => `${event.date}: ${event.quantity}`).join('\n'),
      AA:remaining,
      AB:row.material_type,
      AC:row.unit,
      AD:received,
      AE:received !== null && unitWeight !== null ? received * unitWeight : null,
      AF:remaining,
      AG:row.shortage_weight,
      AP:'Còn thiếu',
    };
    for (const [column, value] of Object.entries(values)) {
      if (value === null || value === undefined || value === '') continue;
      cellValues[`${column}${rowNumber}`] = value;
    }
    if (bomLine) matchCounts.bom += 1;
    if (parentProgress.length) matchCounts.qlda += 1;
  }

  const bytes = fillTemplateWorkbook(templateBytes, FORM_SHEET, cellValues);
  return {
    bytes,
    filename:reportFilename(projectCode, selectedSheets, now),
    rowCount:shortageRows.length,
    matchedBomRows:matchCounts.bom,
    matchedQldaRows:matchCounts.qlda,
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
