const SEARCH_FIELDS = ['assembly', 'drawing', 'description', 'part_no', 'source_sheet'];

function rowMatches(row, query) {
  return SEARCH_FIELDS.some((field) => String(row?.[field] ?? '').toLocaleLowerCase().includes(query));
}

export function filterMaterialGroups(groups, search) {
  const query = String(search ?? '').trim().toLocaleLowerCase();
  if (!query) return { matching: groups, other: [] };
  const matching = [];
  const other = [];
  for (const group of groups) {
    (rowMatches(group, query) || group.children.some((row) => rowMatches(row, query)) ? matching : other).push(group);
  }
  return { matching, other };
}

export function filterMaterialRowsBySheet(rows, sheetFilter) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  if (!sheetFilter) return sourceRows;
  let selected;
  try {
    selected = JSON.parse(sheetFilter);
  } catch {
    return [];
  }
  if (!Array.isArray(selected) || selected.length !== 2) return [];
  const [sourceFile, sourceSheet] = selected;
  return sourceRows.filter((row) => row?.source_file === sourceFile && row?.source_sheet === sourceSheet);
}

export function isMaterialIncomplete(row) {
  const status = String(row?.status ?? '').trim().toLocaleLowerCase();
  if (status) return status === 'chưa đủ' || status === 'chưa có';
  if (typeof row?.received === 'number' && typeof row?.quantity === 'number') return row.received < row.quantity;
  if (typeof row?.remaining === 'number') return row.remaining > 0;
  return false;
}

export function getMaterialShortageQuantity(row) {
  if (typeof row?.remaining === 'number') return Math.max(0, row.remaining);
  if (typeof row?.quantity === 'number' && typeof row?.received === 'number') {
    return Math.max(0, row.quantity - row.received);
  }
  return null;
}

export function filterMaterialRowsByStatus(rows, statusFilter) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  if (statusFilter !== 'incomplete') return sourceRows;
  return sourceRows.filter(isMaterialIncomplete);
}

export function filterBtpRows(rows, sheetName, search) {
  let selectedSheet = String(sheetName ?? '').trim();
  let selectedFile = '';
  if (selectedSheet.startsWith('[')) {
    try {
      const selection = JSON.parse(selectedSheet);
      if (Array.isArray(selection) && selection.length === 2) [selectedFile, selectedSheet] = selection.map((value) => String(value ?? '').toLocaleLowerCase());
    } catch { return []; }
  }
  selectedSheet = selectedSheet.toLocaleLowerCase();
  const query = String(search ?? '').trim().toLocaleLowerCase();
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (selectedSheet && String(row?.source_sheet ?? '').toLocaleLowerCase() !== selectedSheet) return false;
    if (selectedFile && String(row?.source_file ?? '').toLocaleLowerCase() !== selectedFile) return false;
    return !query || ['source_file', 'source_sheet', 'part_no', 'material_type', 'description', 'material', 'unit', 'size', 'length_mm', 'unit_weight', 'total_weight', 'design_quantity', 'received', 'remaining', 'daily_progress', 'joint_check', 'status', 'note']
      .some((field) => String(row?.[field] ?? '').toLocaleLowerCase().includes(query));
  });
}

export function getBtpShortageQuantity(row) {
  if (typeof row?.remaining === 'number' && Number.isFinite(row.remaining)) return Math.max(0, row.remaining);
  if (typeof row?.design_quantity === 'number' && Number.isFinite(row.design_quantity)
    && typeof row?.received === 'number' && Number.isFinite(row.received)) {
    return Math.max(0, row.design_quantity - row.received);
  }
  return null;
}

export function getBtpShortageWeight(row) {
  const quantity = getBtpShortageQuantity(row);
  if (quantity === null || typeof row?.unit_weight !== 'number' || !Number.isFinite(row.unit_weight)) return null;
  return quantity * row.unit_weight;
}

export function summarizeBtpShortages(rows) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const quantity = getBtpShortageQuantity(row);
    if (quantity === null || quantity <= 0) continue;
    const unit = String(row?.unit ?? '').trim() || 'Chưa xác định';
    if (!groups.has(unit)) groups.set(unit, { unit, shortage_rows:0, partNumbers:new Set(), shortage_quantity:0, shortage_weight:0, weight_missing_rows:0 });
    const group = groups.get(unit);
    group.shortage_rows += 1;
    if (row?.part_no) group.partNumbers.add(String(row.part_no));
    group.shortage_quantity += quantity;
    const weight = getBtpShortageWeight(row);
    if (weight === null) group.weight_missing_rows += 1;
    else group.shortage_weight += weight;
  }
  return [...groups.values()].map(({ partNumbers, ...group }) => ({ ...group, part_count:partNumbers.size }))
    .sort((left, right) => right.shortage_quantity - left.shortage_quantity || left.unit.localeCompare(right.unit, 'vi', { sensitivity:'base' }));
}

export function highlightMatch(value, search) {
  const text = value === null || value === undefined || value === '' ? '—' : String(value);
  const query = String(search ?? '').trim();
  if (!query) return escapeHtml(text);
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(`(${escapedQuery})`, 'giu');
  return text.split(matcher).map((part) => part.toLocaleLowerCase() === query.toLocaleLowerCase()
    ? `<mark class="search-highlight">${escapeHtml(part)}</mark>`
    : escapeHtml(part)).join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}
