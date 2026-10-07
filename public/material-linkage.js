function key(value) {
  return String(value ?? '').trim().toLocaleUpperCase();
}

function matchText(value) {
  return key(value).replace(/[^A-Z0-9]/g, '');
}

export function materialSheetName(value) {
  return String(value ?? '').trim().replace(/^BTP[-_\s]*/i, '').trim();
}

export function isPurchasingMaterialSheet(value) {
  return materialSheetName(value).toLocaleLowerCase().replace(/[^a-z0-9]/g, '') === 'purchasing';
}

export function hasBtpIdentity(row) {
  return [row?.part_no, row?.description].some((value) => {
    if (value === null || value === undefined) return false;
    const text = String(value).trim();
    return Boolean(text) && !/^[-–—]+$/u.test(text);
  });
}

function isDrawingMarkingPlaceholder(value) {
  return /\(\s*marking\s+as\s+dwg\.?\s*\)/i.test(String(value ?? ''));
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

function lookupParent(index, indexKey) {
  const matches = index.get(indexKey) || [];
  if (!matches.length) return { row:null, ambiguous:false };
  const parentKeys = new Set(matches.map((row) => `${scopeKey(row)}|${key(row?.assembly)}`));
  if (parentKeys.size === 1) return { row:matches[0], ambiguous:false };
  return { row:null, ambiguous:true };
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
  const childrenByCuttingMarkScope = new Map();
  const childrenByCuttingMarkSheet = new Map();
  const childrenByCuttingMark = new Map();
  const mainRows = [];
  const childRows = [];
  for (const row of Array.isArray(materialRows) ? materialRows : []) {
    if (Number(row?.is_main) === 1) {
      mainRows.push(row);
      addIndex(mainsByScope, `${scopeKey(row)}|${key(row.assembly)}`, row);
      addIndex(mainsBySheet, `${key(materialSheetName(row.source_sheet))}|${key(row.assembly)}`, row);
      addIndex(mainsByAssembly, key(row.assembly), row);
    } else if ((row?.part_no || row?.cutting_mark) && !isDrawingMarkingPlaceholder(row.part_no)) {
      childRows.push(row);
      const childKey = `${key(row.parent)}|${key(row.part_no)}`;
      addIndex(childrenByScope, `${scopeKey(row)}|${childKey}`, row);
      addIndex(childrenBySheet, `${key(materialSheetName(row.source_sheet))}|${childKey}`, row);
      addIndex(childrenByCode, childKey, row);
      if (row.cutting_mark) {
        const mark = key(row.cutting_mark);
        addIndex(childrenByCuttingMarkScope, `${scopeKey(row)}|${mark}`, row);
        addIndex(childrenByCuttingMarkSheet, `${key(materialSheetName(row.source_sheet))}|${mark}`, row);
        addIndex(childrenByCuttingMark, mark, row);
      }
    }
  }
  return { mainRows, childRows, mainsByScope, mainsBySheet, mainsByAssembly, childrenByScope, childrenBySheet, childrenByCode, childrenByCuttingMarkScope, childrenByCuttingMarkSheet, childrenByCuttingMark };
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
  const cuttingMark = key(row?.part_no);
  let cuttingMarkMismatch = false;
  if (cuttingMark) {
    let bomLines = indexes.childrenByCuttingMarkScope.get(`${scopeKey(row)}|${cuttingMark}`) || [];
    if (!bomLines.length) bomLines = indexes.childrenByCuttingMarkSheet.get(`${key(materialSheetName(row?.source_sheet))}|${cuttingMark}`) || [];
    if (!bomLines.length) bomLines = indexes.childrenByCuttingMark.get(cuttingMark) || [];
    if (bomLines.length) {
      let candidates = [...bomLines];
      for (const field of ['description', 'size', 'material']) {
        const target = matchText(row?.[field]);
        if (!target) continue;
        const comparable = candidates.filter((line) => matchText(line?.[field]));
        if (!comparable.length) continue;
        const exact = comparable.filter((line) => matchText(line?.[field]) === target);
        if (!exact.length) {
          cuttingMarkMismatch = true;
          break;
        }
        candidates = exact;
      }
      if (!cuttingMarkMismatch) {
        const parents = candidates.map((line) => findParentForBomLine(line, indexes));
        const parentKeys = new Set(parents.filter(Boolean).map((parent) => `${scopeKey(parent)}|${key(parent.assembly)}`));
        const uniqueParents = [...new Map(parents.filter(Boolean).map((candidate) => [`${scopeKey(candidate)}|${key(candidate.assembly)}`, candidate])).values()];
        const parent = uniqueParents[0] || null;
        const specKeys = new Set(candidates.map((line) => [line?.description, line?.size, line?.material].map(matchText).join('|')));
        const bomQuantity = candidates.map((line) => Number(line.quantity));
        const btpQuantity = Number(row?.design_quantity);
        const aggregateQuantityMatches = bomQuantity.length > 0 && bomQuantity.every(Number.isFinite)
          && Number.isFinite(btpQuantity)
          && Math.abs(bomQuantity.reduce((sum, value) => sum + value, 0) - btpQuantity) < 1e-6;
        const sharedParentMatch = uniqueParents.length > 1
          && parents.every(Boolean)
          && specKeys.size === 1
          && aggregateQuantityMatches;
        const ambiguous = !parent || parents.some((candidate) => !candidate)
          || (parentKeys.size !== 1 && !sharedParentMatch)
          || specKeys.size !== 1;
        return {
          parent,
          parents:uniqueParents,
          parentLabel:!ambiguous && uniqueParents.length > 1 ? uniqueParents.map((candidate) => candidate.assembly).join(' · ') : '',
          bomLine:candidates[0] || null,
          bomLines:candidates,
          childCode:cuttingMark,
          bomStatus:ambiguous ? 'ambiguous' : 'matched',
          bomMatch:'cutting-mark',
          progress:{ rows:[], status:'missing', match:'missing' },
        };
      }
    }
  }
  const parentMatch = findParent(row, indexes);
  const childMatch = findBomLine(row, parentMatch.parent, indexes);
  const progress = { rows:[], status:'missing', match:'missing' };
  const bomStatus = parentMatch.parent
    ? childMatch.bomLine ? 'matched' : childMatch.ambiguous ? 'ambiguous' : 'parent-only'
    : parentMatch.ambiguous ? 'ambiguous' : 'missing';
  const resolvedBomStatus = cuttingMarkMismatch && !childMatch.bomLine && !childMatch.ambiguous ? 'ambiguous' : bomStatus;
  return {
    parent:parentMatch.parent,
    parents:parentMatch.parent ? [parentMatch.parent] : [],
    parentLabel:'',
    bomLine:childMatch.bomLine,
    bomLines:childMatch.bomLine ? [childMatch.bomLine] : [],
    childCode:parentMatch.parent ? key(row?.part_no).slice(String(parentMatch.parent.assembly ?? '').trim().length + 1) : '',
    bomStatus:resolvedBomStatus,
    bomMatch:childMatch.bomLine ? childMatch.match : cuttingMarkMismatch ? 'cutting-mark-spec-mismatch' : parentMatch.match,
    progress,
  };
}

function findParentForBomLine(row, indexes) {
  const parentCode = key(row?.parent || row?.assembly);
  if (!parentCode) return null;
  // A project workbook may repeat one assembly for several lots. Those rows
  // still identify the same parent; treating them as ambiguous prevents the
  // cutting-mark link from being attached to the BOM tree.
  const exact = lookupParent(indexes.mainsByScope, `${scopeKey(row)}|${parentCode}`);
  if (exact.row) return exact.row;
  const sameSheet = lookupParent(indexes.mainsBySheet, `${key(materialSheetName(row?.source_sheet))}|${parentCode}`);
  if (sameSheet.row) return sameSheet.row;
  return lookupParent(indexes.mainsByAssembly, parentCode).row;
}

function rowIdentity(row) {
  return `${scopeKey(row)}|${Number(row?.source_row) || 0}|${key(row?.part_no)}`;
}

function findProgressForParents(parents, progressRows) {
  const linkedParents = Array.isArray(parents) ? parents.filter(Boolean) : [];
  if (!linkedParents.length) return { rows:[], status:'missing', match:'missing' };
  const matches = linkedParents.map((parent) => findProgressForAssembly(parent, progressRows));
  const rows = [...new Map(matches.flatMap((match) => match.rows).map((row) => [rowIdentity(row), row])).values()];
  const status = matches.every((match) => match.status === 'matched')
    ? 'matched'
    : matches.some((match) => match.status === 'ambiguous') ? 'ambiguous'
      : matches.some((match) => match.status === 'matched') ? 'partial' : 'missing';
  return {
    rows,
    status,
    match:linkedParents.length > 1 ? 'multiple-parent-assemblies' : matches[0].match,
  };
}

export function buildMaterialAuditRows({ materialRows = [], btpRows = [], progressRows = [] } = {}) {
  const materials = Array.isArray(materialRows) ? materialRows : [];
  const btp = Array.isArray(btpRows) ? btpRows : [];
  const progress = Array.isArray(progressRows) ? progressRows : [];
  const indexes = indexBom(materials);
  const usedBomLines = new Set();
  const rows = btp.map((btpRow) => {
    const linkage = linkBtpToBom(btpRow, materials, indexes);
    const bomLines = linkage.bomLines?.length ? linkage.bomLines : linkage.bomLine ? [linkage.bomLine] : [];
    for (const bomLine of bomLines) usedBomLines.add(rowIdentity(bomLine));
    const parents = linkage.parents?.length ? linkage.parents : linkage.parent ? [linkage.parent] : [];
    const qlda = findProgressForParents(parents, progress);
    linkage.progress = qlda;
    const bomQuantities = bomLines.map((line) => Number(line.quantity)).filter(Number.isFinite);
    const bomWeights = bomLines.map((line) => Number(line.weight)).filter(Number.isFinite);
    return {
      source_file:linkage.bomLine?.source_file || linkage.parent?.source_file || btpRow.source_file || '',
      source_sheet:linkage.bomLine?.source_sheet || linkage.parent?.source_sheet || materialSheetName(btpRow.source_sheet),
      btp_source_file:btpRow.source_file || '',
      btp_source_sheet:btpRow.source_sheet || '',
      bom_source_file:linkage.bomLine?.source_file || linkage.parent?.source_file || '',
      bom_source_sheet:linkage.bomLine?.source_sheet || linkage.parent?.source_sheet || '',
      bomParent:linkage.parent,
      bomParentLabel:linkage.parentLabel || linkage.parent?.assembly || '',
      bomLine:linkage.bomLine,
      bomLines,
      bomQuantity:bomLines.length && bomQuantities.length === bomLines.length ? bomQuantities.reduce((sum, value) => sum + value, 0) : null,
      bomWeight:bomLines.length && bomWeights.length === bomLines.length ? bomWeights.reduce((sum, value) => sum + value, 0) : null,
      bomNote:[...new Set([...bomLines.map((line) => line.note), ...parents.map((parent) => parent.note)].map((value) => String(value || '').trim()).filter(Boolean))].join(' | '),
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
      bomNote:bomLine.note || parent?.note || '',
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
    row?.bomParentLabel,
    row?.bomLine?.part_no, row?.bomLine?.description, row?.bomLine?.size,
    ...(Array.isArray(row?.bomLines) ? row.bomLines.flatMap((line) => [line.part_no, line.cutting_mark, line.description, line.size]) : []),
    row?.bomLine?.note, row?.bomParent?.note, row?.bomNote,
    row?.btp?.part_no, row?.btp?.material_type, row?.btp?.description, row?.btp?.material,
    row?.btp?.unit, row?.btp?.size, row?.btp?.note,
    ...(Array.isArray(row?.progress) ? row.progress.flatMap((item) => [item.part_no, item.drawing, item.item, item.receiver]) : []),
  ];
  return values.filter((value) => value !== null && value !== undefined).join(' ').toLocaleLowerCase();
}
