function key(value) {
  return String(value ?? '').trim().toLocaleUpperCase();
}

export function materialSheetName(value) {
  return String(value ?? '').trim().replace(/^BTP[-_\s]*/i, '').trim();
}

export function isPurchasingMaterialSheet(value) {
  return materialSheetName(value).toLocaleLowerCase().replace(/[^a-z0-9]/g, '') === 'purchasing';
}

export function materialSheetKey(sourceFile, sourceSheet) {
  return JSON.stringify([String(sourceFile ?? '').trim(), materialSheetName(sourceSheet)]);
}

function scopeKey(row) {
  return `${key(row?.source_file)}|${key(materialSheetName(row?.source_sheet))}`;
}

function addIndex(index, indexKey, value) {
  if (!index.has(indexKey)) index.set(indexKey, []);
  index.get(indexKey).push(value);
}

function lookupUnique(index, indexKey) {
  const matches = index.get(indexKey) || [];
  if (matches.length === 1) return { row:matches[0], ambiguous:false };
  return { row:null, ambiguous:matches.length > 1 };
}

function prefixCodes(value) {
  const parts = key(value).split('-').filter(Boolean);
  return Array.from({ length:Math.max(0, parts.length - 1) }, (_, index) => parts.slice(0, parts.length - index - 1).join('-'));
}

function indexBom(materialRows) {
  const mainsByScope = new Map();
  const mainsBySheet = new Map();
  const mainsByAssembly = new Map();
  const childrenByScope = new Map();
  const childrenBySheet = new Map();
  const childrenByCode = new Map();
  const mainRows = [];
  const childRows = [];
  for (const row of Array.isArray(materialRows) ? materialRows : []) {
    if (Number(row?.is_main) === 1) {
      mainRows.push(row);
      addIndex(mainsByScope, `${scopeKey(row)}|${key(row.assembly)}`, row);
      addIndex(mainsBySheet, `${key(materialSheetName(row.source_sheet))}|${key(row.assembly)}`, row);
      addIndex(mainsByAssembly, key(row.assembly), row);
    } else if (row?.part_no) {
      childRows.push(row);
      const childKey = `${key(row.parent)}|${key(row.part_no)}`;
      addIndex(childrenByScope, `${scopeKey(row)}|${childKey}`, row);
      addIndex(childrenBySheet, `${key(materialSheetName(row.source_sheet))}|${childKey}`, row);
      addIndex(childrenByCode, childKey, row);
    }
  }
  return { mainRows, childRows, mainsByScope, mainsBySheet, mainsByAssembly, childrenByScope, childrenBySheet, childrenByCode };
}

export function createMaterialLinkIndexes(materialRows) {
  return indexBom(materialRows);
}

function findParent(row, indexes) {
  const partNo = key(row?.part_no);
  const baseSheet = key(materialSheetName(row?.source_sheet));
  let ambiguous = false;
  for (const assembly of prefixCodes(partNo)) {
    const exact = lookupUnique(indexes.mainsByScope, `${scopeKey(row)}|${assembly}`);
    if (exact.row) return { parent:exact.row, ambiguous:false, match:'file-and-sheet' };
    if (exact.ambiguous) return { parent:null, ambiguous:true, match:'ambiguous' };
    const sameSheet = lookupUnique(indexes.mainsBySheet, `${baseSheet}|${assembly}`);
    if (sameSheet.row) return { parent:sameSheet.row, ambiguous:false, match:'sheet-name' };
    if (sameSheet.ambiguous) ambiguous = true;
    const projectMatch = lookupUnique(indexes.mainsByAssembly, assembly);
    if (projectMatch.row) return { parent:projectMatch.row, ambiguous:false, match:'unique-project-code' };
    if (projectMatch.ambiguous) ambiguous = true;
  }
  return { parent:null, ambiguous, match:ambiguous ? 'ambiguous' : 'missing' };
}

function findBomLine(row, parent, indexes) {
  if (!parent) return { bomLine:null, ambiguous:false, match:'missing' };
  const childCode = key(row?.part_no).slice(String(parent.assembly ?? '').trim().length + 1);
  if (!childCode) return { bomLine:null, ambiguous:false, match:'missing' };
  const childKey = `${key(parent.assembly)}|${key(childCode)}`;
  const exact = lookupUnique(indexes.childrenByScope, `${scopeKey(parent)}|${childKey}`);
  if (exact.row) return { bomLine:exact.row, ambiguous:false, match:'file-and-sheet' };
  if (exact.ambiguous) return { bomLine:null, ambiguous:true, match:'ambiguous' };
  const sameSheet = lookupUnique(indexes.childrenBySheet, `${key(materialSheetName(parent.source_sheet))}|${childKey}`);
  if (sameSheet.row) return { bomLine:sameSheet.row, ambiguous:false, match:'sheet-name' };
  if (sameSheet.ambiguous) return { bomLine:null, ambiguous:true, match:'ambiguous' };
  const projectMatch = lookupUnique(indexes.childrenByCode, childKey);
  if (projectMatch.row) return { bomLine:projectMatch.row, ambiguous:false, match:'unique-project-code' };
  return { bomLine:null, ambiguous:projectMatch.ambiguous, match:projectMatch.ambiguous ? 'ambiguous' : 'missing' };
}

export function findProgressForAssembly(parent, progressRows) {
  if (!parent?.assembly) return { rows:[], status:'missing', match:'missing' };
  const partNo = key(parent.assembly);
  const drawing = key(parent.drawing);
  const rows = Array.isArray(progressRows) ? progressRows : [];
  const exact = rows.filter((row) => key(row?.part_no) === partNo);
  if (exact.length) {
    const byDrawing = drawing ? exact.filter((row) => key(row?.drawing) === drawing) : [];
    if (byDrawing.length) return { rows:byDrawing, status:'matched', match:'part-and-drawing' };
    if (exact.length === 1) return { rows:exact, status:'matched', match:'part-number' };
    return { rows:[], status:'ambiguous', match:'ambiguous-part-number' };
  }
  const byDrawing = drawing ? rows.filter((row) => key(row?.drawing) === drawing) : [];
  if (byDrawing.length === 1) return { rows:byDrawing, status:'matched', match:'drawing' };
  if (byDrawing.length > 1) return { rows:[], status:'ambiguous', match:'ambiguous-drawing' };
  return { rows:[], status:'missing', match:'missing' };
}

export function linkBtpToBom(row, materialRows, indexes = indexBom(materialRows)) {
  const parentMatch = findParent(row, indexes);
  const childMatch = findBomLine(row, parentMatch.parent, indexes);
  const progress = { rows:[], status:'missing', match:'missing' };
  const bomStatus = parentMatch.parent
    ? childMatch.bomLine ? 'matched' : childMatch.ambiguous ? 'ambiguous' : 'parent-only'
    : parentMatch.ambiguous ? 'ambiguous' : 'missing';
  return {
    parent:parentMatch.parent,
    bomLine:childMatch.bomLine,
    childCode:parentMatch.parent ? key(row?.part_no).slice(String(parentMatch.parent.assembly ?? '').trim().length + 1) : '',
    bomStatus,
    bomMatch:childMatch.bomLine ? childMatch.match : parentMatch.match,
    progress,
  };
}

function findParentForBomLine(row, indexes) {
  const parentCode = key(row?.parent || row?.assembly);
  if (!parentCode) return null;
  const exact = lookupUnique(indexes.mainsByScope, `${scopeKey(row)}|${parentCode}`);
  if (exact.row) return exact.row;
  const sameSheet = lookupUnique(indexes.mainsBySheet, `${key(materialSheetName(row?.source_sheet))}|${parentCode}`);
  if (sameSheet.row) return sameSheet.row;
  return lookupUnique(indexes.mainsByAssembly, parentCode).row;
}

function rowIdentity(row) {
  return `${scopeKey(row)}|${Number(row?.source_row) || 0}|${key(row?.part_no)}`;
}

export function buildMaterialAuditRows({ materialRows = [], btpRows = [], progressRows = [] } = {}) {
  const materials = Array.isArray(materialRows) ? materialRows : [];
  const btp = Array.isArray(btpRows) ? btpRows : [];
  const progress = Array.isArray(progressRows) ? progressRows : [];
  const indexes = indexBom(materials);
  const usedBomLines = new Set();
  const rows = btp.map((btpRow) => {
    const linkage = linkBtpToBom(btpRow, materials, indexes);
    if (linkage.bomLine) usedBomLines.add(rowIdentity(linkage.bomLine));
    const qlda = findProgressForAssembly(linkage.parent, progress);
    linkage.progress = qlda;
    return {
      source_file:linkage.bomLine?.source_file || linkage.parent?.source_file || btpRow.source_file || '',
      source_sheet:linkage.bomLine?.source_sheet || linkage.parent?.source_sheet || materialSheetName(btpRow.source_sheet),
      btp_source_file:btpRow.source_file || '',
      btp_source_sheet:btpRow.source_sheet || '',
      bom_source_file:linkage.bomLine?.source_file || linkage.parent?.source_file || '',
      bom_source_sheet:linkage.bomLine?.source_sheet || linkage.parent?.source_sheet || '',
      bomParent:linkage.parent,
      bomLine:linkage.bomLine,
      btp:btpRow,
      progress:qlda.rows,
      bomStatus:linkage.bomStatus,
      qldaStatus:qlda.status,
      kind:'btp',
    };
  });

  for (const bomLine of indexes.childRows) {
    if (usedBomLines.has(rowIdentity(bomLine))) continue;
    const parent = findParentForBomLine(bomLine, indexes);
    const qlda = findProgressForAssembly(parent, progress);
    rows.push({
      source_file:bomLine.source_file || '',
      source_sheet:bomLine.source_sheet || '',
      btp_source_file:'',
      btp_source_sheet:'',
      bom_source_file:bomLine.source_file || '',
      bom_source_sheet:bomLine.source_sheet || '',
      bomParent:parent,
      bomLine,
      btp:null,
      progress:qlda.rows,
      bomStatus:'no-btp',
      qldaStatus:qlda.status,
      kind:'bom-only',
    });
  }
  return rows;
}

export function materialAuditRowSearchText(row) {
  const values = [
    row?.source_file, row?.source_sheet, row?.bomParent?.assembly, row?.bomParent?.drawing,
    row?.bomLine?.part_no, row?.bomLine?.description, row?.bomLine?.size,
    row?.btp?.part_no, row?.btp?.material_type, row?.btp?.description, row?.btp?.material,
    row?.btp?.unit, row?.btp?.size, row?.btp?.note,
    ...(Array.isArray(row?.progress) ? row.progress.flatMap((item) => [item.part_no, item.drawing, item.item, item.receiver]) : []),
  ];
  return values.filter((value) => value !== null && value !== undefined).join(' ').toLocaleLowerCase();
}
