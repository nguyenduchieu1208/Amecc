import { unzipSync, zipSync } from './vendor/fflate.mjs';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function xmlAttribute(tag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return tag.match(new RegExp(`(?:^|\\s)${escapedName}="([^"]*)"`))?.[1] ?? null;
}

function unescapeXml(value) {
  return String(value ?? '').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\r/g, '&#13;');
}

function worksheetPath(files, sheetName) {
  const workbookXml = decoder.decode(files['xl/workbook.xml'] || new Uint8Array());
  const relationshipsXml = decoder.decode(files['xl/_rels/workbook.xml.rels'] || new Uint8Array());
  const sheetTag = workbookXml.match(/<sheet\b[^>]*>/g)?.find((tag) => unescapeXml(xmlAttribute(tag, 'name')) === sheetName);
  if (!sheetTag) throw new Error(`File mẫu thiếu sheet “${sheetName}”.`);
  const relationshipId = xmlAttribute(sheetTag, 'r:id');
  const relationTag = relationshipsXml.match(/<Relationship\b[^>]*>/g)?.find((tag) => xmlAttribute(tag, 'Id') === relationshipId);
  const target = relationTag && xmlAttribute(relationTag, 'Target');
  if (!target || xmlAttribute(relationTag, 'TargetMode') === 'External') throw new Error(`Không xác định được đường dẫn sheet “${sheetName}” trong file mẫu.`);
  return target.startsWith('/') ? target.replace(/^\/+/, '') : `xl/${target.replace(/^\.\//, '')}`;
}

function columnNumber(address) {
  const letters = address.match(/^[A-Z]+/i)?.[0]?.toUpperCase() || '';
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
}

function rowNumber(address) {
  const number = Number(address.match(/\d+$/)?.[0]);
  if (!Number.isInteger(number) || number < 1) throw new Error(`Địa chỉ ô không hợp lệ: ${address}`);
  return number;
}

function rowMatch(xml, number) {
  const escaped = String(number).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return xml.match(new RegExp(`<row\\b(?=[^>]*\\br="${escaped}")[^>]*>[\\s\\S]*?<\\/row>`));
}

function lastRowNumber(xml) {
  const values = [...xml.matchAll(/<row\b[^>]*\br="(\d+)"/g)].map((match) => Number(match[1]));
  return Math.max(0, ...values);
}

function cloneRowsThrough(xml, endRow) {
  let lastRow = lastRowNumber(xml);
  if (endRow <= lastRow) return xml;
  const sourceRow = rowMatch(xml, lastRow)?.[0];
  if (!sourceRow) throw new Error('Không thể mở rộng các dòng định dạng sẵn trong file mẫu.');
  const sheetDataEnd = xml.indexOf('</sheetData>');
  if (sheetDataEnd < 0) throw new Error('File mẫu không có vùng dữ liệu worksheet hợp lệ.');
  const appendedRows = [];
  while (lastRow < endRow) {
    const nextRow = lastRow + 1;
    const cloned = sourceRow
      .replace(new RegExp(`(<row\\b[^>]*\\br=")${lastRow}("[^>]*>)`), `$1${nextRow}$2`)
      .replace(new RegExp(`(\\br=")[A-Z]{1,3}${lastRow}("(?=[^>]*\\/?>))`, 'g'), (match, before, after) => {
        const column = match.match(/r="([A-Z]+)/)?.[1] || '';
        return `${before}${column}${nextRow}${after}`;
      });
    appendedRows.push(cloned);
    lastRow = nextRow;
  }
  return `${xml.slice(0, sheetDataEnd)}${appendedRows.join('')}${xml.slice(sheetDataEnd)}`;
}

function cellMatch(xml, address) {
  const escaped = address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return xml.match(new RegExp(`<c\\b(?=[^>]*\\br="${escaped}")[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`));
}

function styleForColumn(xml, column, targetRow) {
  for (let candidate = targetRow; candidate >= 13; candidate -= 1) {
    const cell = cellMatch(xml, `${column}${candidate}`)?.[0];
    const opening = cell?.match(/^<c\b[^>]*>/)?.[0];
    const style = opening && xmlAttribute(opening, 's');
    if (style !== null && style !== undefined) return style;
  }
  return null;
}

function insertCell(xml, address, opening, content) {
  const targetRow = rowNumber(address);
  const row = rowMatch(xml, targetRow);
  if (!row) throw new Error(`Không thể tìm dòng ${targetRow} trong file mẫu.`);
  const rowXml = row[0];
  const targetColumn = columnNumber(address);
  const cells = [...rowXml.matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g)];
  const before = cells.find((match) => columnNumber(match[1]) > targetColumn);
  const insertAt = before ? before.index : rowXml.lastIndexOf('</row>');
  if (insertAt < 0) throw new Error(`Không thể ghi ô ${address} trong file mẫu.`);
  let replacement = `${rowXml.slice(0, insertAt)}${opening}${content}</c>${rowXml.slice(insertAt)}`;
  const rowOpening = replacement.match(/^<row\b[^>]*>/)?.[0] || '';
  const existingSpan = xmlAttribute(rowOpening, 'spans')?.match(/^(\d+):(\d+)$/);
  if (existingSpan) {
    const firstColumn = Math.min(Number(existingSpan[1]), targetColumn);
    const lastColumn = Math.max(Number(existingSpan[2]), targetColumn);
    replacement = replacement.replace(/(<row\b[^>]*\bspans=")[^"]*"/, `$1${firstColumn}:${lastColumn}"`);
  }
  return xml.slice(0, row.index) + replacement + xml.slice(row.index + rowXml.length);
}

function setCellValue(xml, address, value) {
  const cell = cellMatch(xml, address);
  let opening = cell?.[0].match(/^<c\b[^>]*>/)?.[0] || null;
  if (!opening) {
    const column = address.match(/^[A-Z]+/i)[0].toUpperCase();
    const style = styleForColumn(xml, column, rowNumber(address));
    const isNumber = typeof value === 'number' && Number.isFinite(value);
    opening = `<c r="${address}"${style ? ` s="${style}"` : ''}${isNumber ? '' : ' t="inlineStr"'}>`;
    const content = isNumber
      ? `<v>${String(value)}</v>`
      : `<is><t${/^\s|\s$/.test(String(value)) ? ' xml:space="preserve"' : ''}>${escapeXml(value)}</t></is>`;
    return insertCell(xml, address, opening, content);
  }

  let attributes = opening.slice(2, -1).replace(/\/$/, '').trim();
  attributes = attributes.replace(/\s+t="[^"]*"/g, '');
  const isNumber = typeof value === 'number' && Number.isFinite(value);
  const type = isNumber ? '' : ' t="inlineStr"';
  const nextOpening = `<c ${attributes}${type}>`;
  const content = isNumber
    ? `<v>${String(value)}</v>`
    : `<is><t${/^\s|\s$/.test(String(value)) ? ' xml:space="preserve"' : ''}>${escapeXml(value)}</t></is>`;
  return xml.slice(0, cell.index) + `${nextOpening}${content}</c>` + xml.slice(cell.index + cell[0].length);
}

function extendDimension(xml, endRow) {
  return xml.replace(/(<dimension\b[^>]*\bref="[A-Z]+\d+:[A-Z]+)(\d+)"/, (match, before, currentEnd) =>
    Number(currentEnd) >= endRow ? match : `${before}${endRow}"`);
}

function extendAutoFilter(xml, endRow) {
  return xml.replace(/(<autoFilter\b[^>]*\bref="[A-Z]+\d+:[A-Z]+)(\d+)"/, (match, before, currentEnd) =>
    Number(currentEnd) >= endRow ? match : `${before}${endRow}"`);
}

function extendFilterDatabase(xml, sheetName, endRow) {
  const escapedName = sheetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return xml.replace(new RegExp(`(<definedName\\b(?=[^>]*name="_xlnm\\._FilterDatabase")(?=[^>]*localSheetId="\\d+")[^>]*>\\s*'${escapedName}'!\\$A\\$13:\\$AQ\\$)(\\d+)(<\\/definedName>)`),
    (match, before, currentEnd, after) => Number(currentEnd) >= endRow ? match : `${before}${endRow}${after}`);
}

export function fillTemplateWorkbook(templateBytes, sheetName, cellValues) {
  let files;
  try {
    files = unzipSync(templateBytes instanceof Uint8Array ? templateBytes : new Uint8Array(templateBytes));
  } catch {
    throw new Error('Không thể đọc cấu trúc file mẫu List_thieu_mau.xlsx.');
  }
  const path = worksheetPath(files, sheetName);
  if (!files[path]) throw new Error(`Không tìm thấy nội dung sheet “${sheetName}” trong file mẫu.`);
  const entries = Object.entries(cellValues || {}).filter(([, value]) => value !== null && value !== undefined && value !== '');
  const endRow = Math.max(0, ...entries.map(([address]) => rowNumber(address)));
  let xml = decoder.decode(files[path]);
  xml = cloneRowsThrough(xml, endRow);
  for (const [address, value] of entries) xml = setCellValue(xml, address.toUpperCase(), value);
  if (endRow) {
    xml = extendDimension(xml, endRow);
    xml = extendAutoFilter(xml, endRow);
    const workbookXml = decoder.decode(files['xl/workbook.xml'] || new Uint8Array());
    const updatedWorkbookXml = extendFilterDatabase(workbookXml, sheetName, endRow);
    if (updatedWorkbookXml !== workbookXml) files['xl/workbook.xml'] = encoder.encode(updatedWorkbookXml);
  }
  files[path] = encoder.encode(xml);
  return zipSync(files, { level:6 });
}
