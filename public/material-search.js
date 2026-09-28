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

export function filterBtpRows(rows, sheetName, search) {
  const selectedSheet = String(sheetName ?? '').trim().toLocaleLowerCase();
  const query = String(search ?? '').trim().toLocaleLowerCase();
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (selectedSheet && String(row?.source_sheet ?? '').toLocaleLowerCase() !== selectedSheet) return false;
    return !query || ['part_no', 'material_type', 'unit', 'size', 'length_mm', 'design_quantity', 'received', 'remaining', 'daily_progress', 'joint_check', 'status', 'note']
      .some((field) => String(row?.[field] ?? '').toLocaleLowerCase().includes(query));
  });
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