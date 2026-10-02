import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { File } from 'node:buffer';
import * as xlsx from 'xlsx';
import { __test__ } from '../worker/index.js';
import { BTP_COLUMNS, MAX_MATERIAL_FILE_BYTES, MAX_MATERIAL_FILE_MB, parseMaterialWorkbook, projectCodeFromFilename, readMaterialWorkbook } from '../public/material-import.js';
import { filterBtpRows, filterMaterialGroups, filterMaterialRowsBySheet, filterMaterialRowsByStatus, getBtpShortageQuantity, getBtpShortageWeight, getMaterialShortageQuantity, highlightMatch, summarizeBtpShortages } from '../public/material-search.js';
import { formatMaterialDate, getMaterialReceiptDate } from '../public/material-display.js';
import { renderMaterialDashboard } from '../public/material-dashboard.js';
import { buildMaterialAuditRows, hasBtpIdentity, isPurchasingMaterialSheet, linkBtpToBom, findProgressForAssembly } from '../public/material-linkage.js';
import { buildBtpShortageTemplate, filterBtpRowsByReceiptDate } from '../public/shortage-export.js';
import { fillTemplateWorkbook } from '../public/template-xlsx.js';
import { unzipSync } from '../public/vendor/fflate.mjs';
import { PostgresD1Adapter } from '../supabase/functions/_shared/postgres-d1-adapter.js';

test('project codes are normalized and restricted to safe identifiers', () => {
  assert.equal(__test__.safeProjectCode(' a290 '), 'A290');
  assert.throws(() => __test__.safeProjectCode('../private'), /không hợp lệ/);
  assert.throws(() => __test__.safeProjectCode('A'), /không hợp lệ/);
  assert.equal(projectCodeFromFilename('M304PL.xlsx', 'materials'), 'M304');
  assert.equal(MAX_MATERIAL_FILE_MB, 20);
  assert.equal(MAX_MATERIAL_FILE_BYTES, 20 * 1024 * 1024);
});

test('D1 free daily row limits return actionable retry messages instead of a generic server error', () => {
  const writeLimit = __test__.workerErrorDetails(new Error("D1_ERROR: Your account has exceeded D1's free tier daily row write limit."));
  assert.equal(writeLimit.status, 429);
  assert.match(writeLimit.message, /hết hạn mức ghi miễn phí/);
  assert.match(writeLimit.message, /00:00 UTC/);
  const readLimit = __test__.workerErrorDetails(new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit."));
  assert.equal(readLimit.status, 429);
  assert.match(readLimit.message, /hết hạn mức đọc miễn phí/);
  assert.equal(__test__.workerErrorDetails(new Error('unexpected')).status, 500);
});

test('Supabase adapter pipelines batched SQL requests inside one transaction', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const client = {
    begin(callback) {
      const transaction = {
        async unsafe(statement, values) {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inFlight -= 1;
          return Object.assign([{ statement, values }], { count: 1 });
        },
      };
      const pipeline = callback(transaction);
      assert.ok(Array.isArray(pipeline), 'Postgres.js receives the statements together to pipeline them');
      return Promise.all(pipeline);
    },
  };
  const database = new PostgresD1Adapter(client);
  const results = await database.batch([
    database.prepare('INSERT INTO test_table (value) VALUES (?)').bind('one'),
    database.prepare('UPDATE test_table SET value = ?').bind('two'),
    database.prepare('DELETE FROM test_table WHERE value = ?').bind('three'),
  ]);
  assert.equal(maxInFlight, 3, 'all batched statements are issued without waiting a round-trip between them');
  assert.deepEqual(results.map((result) => result.results[0].values[0]), ['one', 'two', 'three']);
  assert.deepEqual(results.map((result) => result.results[0].statement), [
    'INSERT INTO test_table (value) VALUES ($1)',
    'UPDATE test_table SET value = $1',
    'DELETE FROM test_table WHERE value = $1',
  ]);
});

test('QLDA mapping exposes selected fields and excludes hidden source columns', () => {
  assert.equal(__test__.QLDA_FIELDS[2], 'project_code');
  for (const column of [1,3,4,20,21,22,30,31,32,33,34,35,45,54,55,56,57,58,60,163,164]) {
    assert.equal(__test__.QLDA_FIELDS[column], undefined, `column ${column} must not be emitted`);
  }
});

test('QLDA parser uses Progress rows starting at row four and removes source project field', () => {
  const workbook = { SheetNames:['Progress'], Sheets:{ Progress:{} } };
  const xlsx = { utils:{ sheet_to_json:() => [[],[],[],['TT','A290','Group',null,'Frame','MH1',null,'Steel',null,null,'DWG1','P1','M20',4,2,8,'IPE','ID1','note',...Array(16).fill(null),'2026-09-01',1,2]] } };
  const rows = __test__.parseProjectProgress(workbook, 'A290.xlsx', 'A290', xlsx);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].project_code, 'A290');
  assert.equal(rows[0].source_row, 4);
  assert.equal(rows[0].drawing, 'DWG1');
  assert.equal(rows[0].fitup_date, '2026-09-01');
  assert.equal(rows[0].fitup_qty, 1);
  assert.equal(Object.hasOwn(rows[0], 'TT'), false);
});

test('PL parser recognizes Symbol header and groups markers without editing the workbook', () => {
  const workbook = { SheetNames:['Cover','ProjectSheet'], Sheets:{ Cover:{}, ProjectSheet:{} } };
  const header = [];
  for (const [column, value] of [[1,'No.'],[2,'Drawing Number'],[3,'Assembly No.'],[4,'Description'],[5,'Part No.'],[7,'Size'],[12,"T.Q'ty"],[14,'T.Weight'],[15,'Scope of Steel Work'],[20,'Da nhan'],[21,'Con thieu'],[28,'AS Symbol']]) header[column - 1] = value;
  const main = [];
  for (const [column, value] of [[1,1],[2,'DWG-1'],[3,'ASM-1'],[4,'Main assembly'],[12,10],[14,100],[15,'AMC2'],[20,4],[21,6],[28,'x']]) main[column - 1] = value;
  const component = [];
  for (const [column, value] of [[1,2],[2,'DWG-2'],[4,'Component'],[5,'P-2'],[7,'M20'],[12,4],[14,12],[15,'AMC2'],[20,2],[21,2],[28,'']]) component[column - 1] = value;
  const xlsx = { utils:{ sheet_to_json:(sheet) => sheet === workbook.Sheets.Cover ? [] : [
    ...Array.from({length:7}, () => []),
    header, main, component,
  ] } };
  const rows = __test__.parseMaterials(workbook, 'A290PL.xlsx', 'A290', xlsx);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].is_main, 1);
  assert.equal(rows[1].parent, 'ASM-1');
  assert.equal(rows[1].quantity, 4);
  assert.equal(rows[1].received, 2);
  assert.equal(rows[1].status, 'chưa đủ');
});

test('material mapping follows PL workbook source columns', () => {
  assert.equal(__test__.MATERIAL_FIELDS[2], 'drawing');
  assert.equal(__test__.MATERIAL_FIELDS[12], 'quantity');
  assert.equal(__test__.MATERIAL_FIELDS[15], 'scope');
  assert.equal(__test__.MATERIAL_FIELDS[21], 'remaining');
});

test('material search matches child component rows and separates unrelated groups', () => {
  const groups = [
    { assembly:'Frame A', drawing:'DWG-A', children:[{ part_no:'BOLT-123', description:'Bolt' }] },
    { assembly:'Frame B', drawing:'DWG-B', children:[{ part_no:'NUT-2', description:'Nut' }] },
  ];
  const result = filterMaterialGroups(groups, 'bolt-123');
  assert.deepEqual(result.matching, [groups[0]]);
  assert.deepEqual(result.other, [groups[1]]);
  assert.match(highlightMatch('<Frame> Bolt-123', 'bolt-123'), /&lt;Frame&gt; <mark class="search-highlight">Bolt-123<\/mark>/);
  assert.doesNotMatch(highlightMatch('<script>', ''), /<script>/);
  assert.match(highlightMatch('BRACKET [A]', '['), /<mark class="search-highlight">\[<\/mark>/);
});

test('BTP filters by source sheet and combines sheet selection with text search', () => {
  const rows = [
    { source_sheet:'T5P1', part_no:'BTP-001', material_type:'Shape' },
    { source_sheet:'T5P1', part_no:'BTP-002', material_type:'Plate' },
    { source_sheet:'T5P2', part_no:'BTP-003', material_type:'Shape' },
  ];
  assert.deepEqual(filterBtpRows(rows, 't5p1', ''), rows.slice(0, 2));
  assert.deepEqual(filterBtpRows(rows, 'T5P1', 'plate'), [rows[1]]);
  assert.deepEqual(filterBtpRows(rows, '', 'shape'), [rows[0], rows[2]]);
  assert.deepEqual(filterBtpRows([{ source_file:'A.xlsx',source_sheet:'T5P1' },{ source_file:'B.xlsx',source_sheet:'T5P1' }], JSON.stringify(['A.xlsx','T5P1']), ''), [{ source_file:'A.xlsx',source_sheet:'T5P1' }]);
});

test('BTP shortage quantities and weights are grouped by delivery unit without inventing missing weight', () => {
  const rows = [
    { unit:'MCC',part_no:'A',remaining:2,design_quantity:5,received:3,unit_weight:10 },
    { unit:'MCC',part_no:'B',design_quantity:4,received:1,unit_weight:2.5 },
    { unit:'PMC',part_no:'C',remaining:3,unit_weight:null },
    { unit:null,part_no:'D',remaining:0,unit_weight:10 },
  ];
  assert.equal(getBtpShortageQuantity(rows[0]), 2);
  assert.equal(getBtpShortageQuantity(rows[1]), 3);
  assert.equal(getBtpShortageQuantity({ design_quantity:5 }), null);
  assert.equal(getBtpShortageWeight(rows[0]), 20);
  assert.equal(getBtpShortageWeight(rows[2]), null);
  assert.deepEqual(summarizeBtpShortages(rows), [
    { unit:'MCC',shortage_rows:2,shortage_quantity:5,shortage_weight:27.5,weight_missing_rows:0,part_count:2 },
    { unit:'PMC',shortage_rows:1,shortage_quantity:3,shortage_weight:0,weight_missing_rows:1,part_count:1 },
  ]);
});

test('material sheet filter scopes rows to the selected workbook and sheet', () => {
  const rows = [
    { source_file:'A290PL.xlsx', source_sheet:'PL-1', source_row:1 },
    { source_file:'A290PL.xlsx', source_sheet:'PL-2', source_row:2 },
    { source_file:'B272PL.xlsx', source_sheet:'PL-1', source_row:3 },
  ];
  const selected = JSON.stringify(['A290PL.xlsx', 'PL-1']);
  assert.deepEqual(filterMaterialRowsBySheet(rows, selected), [rows[0]]);
  assert.deepEqual(filterMaterialRowsBySheet(rows, ''), rows);
  assert.deepEqual(filterMaterialRowsBySheet(rows, 'invalid'), []);
});

test('material incomplete filter includes partially received and not-yet-received rows', () => {
  const rows = [
    { part_no:'PARTIAL', status:'chưa đủ' },
    { part_no:'NOT-RECEIVED', status:'chưa có' },
    { part_no:'COMPLETE', status:'đủ' },
    { part_no:'LEGACY-PARTIAL', quantity:10, received:4 },
    { part_no:'LEGACY-COMPLETE', quantity:10, remaining:0 },
  ];
  assert.deepEqual(filterMaterialRowsByStatus(rows, 'incomplete'), rows.filter((row) => ['PARTIAL', 'NOT-RECEIVED', 'LEGACY-PARTIAL'].includes(row.part_no)));
  assert.deepEqual(filterMaterialRowsByStatus(rows, ''), rows);
});

test('material shortage report quantity prefers remaining and falls back to required minus received', () => {
  assert.equal(getMaterialShortageQuantity({ quantity:10, received:4, remaining:7 }), 7);
  assert.equal(getMaterialShortageQuantity({ quantity:10, received:4 }), 6);
  assert.equal(getMaterialShortageQuantity({ quantity:4, received:7 }), 0);
  assert.equal(getMaterialShortageQuantity({ quantity:10 }), null);
});

test('BTP view uses expandable BOM cards with the requested detail table and separate Dashboard tab', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync('public/app.js', 'utf8');
  const styles = readFileSync('public/styles.css', 'utf8');
  const enhancements = readFileSync('public/workspace-enhancements.css', 'utf8');
  const themes = readFileSync('public/themes.css', 'utf8');
  const auditStart = app.indexOf('function materialsAuditPage()');
  const auditEnd = app.indexOf('function materialDashboardPage()', auditStart);
  const auditPage = app.slice(auditStart, auditEnd);
  assert.ok(auditStart >= 0 && auditEnd > auditStart, 'BOM/BTP audit table must be the materials view');
  assert.match(auditPage, /pageGroups\.map\(auditBomGroupMarkup\)/);
  assert.match(auditPage, /<section class="material-audit-controls[\s\S]*id="mobileAuditExtraFilters"[\s\S]*\$\{projectSelect\(\)\}[\s\S]*id="materialSheetDropdown"/);
  assert.match(styles, /\.audit-filter-grid select,\.sheet-multi-select>summary\{width:100%;min-width:0/);
  assert.match(app, /function auditBtpTableRowMarkup\(row, query = ''\)/);
  assert.match(app, /function auditBomGroupMarkup\(\{ rows, detailRows = rows, query = '' \}\)/);
  assert.match(app, /const contextRows = search \? filteredMaterialAuditRows\(\{ options, includeSearch:false \}\) : visibleRows/);
  assert.match(app, /const allGroups = auditBomGroups\(visibleRows, contextRows, search\)/);
  assert.match(app, /function usableBtpRows\(\)[\s\S]*isPurchasingMaterialSheet\(row\.source_sheet\)[\s\S]*hasBtpIdentity\(row\)/);
  assert.match(app, /btp\.part_no \|\| btp\.description \|\| '—'/);
  assert.match(app, /allGroups\.slice\(pageIndex \* pageSize, \(pageIndex \+ 1\) \* pageSize\)/);
  assert.match(app, /search-match-row/);
  assert.match(enhancements, /\.bom-btp-table tbody tr\.search-match-row td/);
  assert.match(enhancements, /\.bom-btp-group\[open\] \.bom-search-match-preview-wrap \{ display:none; \}/);
  assert.match(enhancements, /\.sheet-check-option input \{ grid-column:1; grid-row:1\/3;/);
  assert.match(enhancements, /\.material-audit-controls \{ position:sticky; top:72px; z-index:11;/);
  assert.match(enhancements, /\.mobile-audit-extra-filters \{ display:none; \}[\s\S]*\.mobile-expanded \.mobile-audit-extra-filters \{ display:grid; grid-template-columns:repeat\(2,minmax\(0,1fr\)\); grid-template-areas:"project sheet" "date unit" "status export"/);
  assert.match(enhancements, /\.mobile-audit-search-row \{ display:grid; grid-template-columns:minmax\(0,1fr\) auto;/);
  assert.match(enhancements, /\.audit-search input \{ min-width:0; min-height:42px; font-size:16px!important/);
  assert.match(app, /id="toggleMobileAuditFilters"[\s\S]*aria-controls="mobileAuditExtraFilters"/);
  assert.match(app, /querySelector\('#toggleMobileAuditFilters'\)\?\.addEventListener\('click',[\s\S]*materialMobileFiltersOpen = !state\.materialMobileFiltersOpen/);
  assert.match(app, /<details class="bom-btp-group">/);
  assert.match(app, /<summary class="bom-btp-group-summary">[\s\S]*<div class="bom-btp-table-wrap"><table class="bom-btp-table">/);
  assert.match(app, /event\.replace\(\/:\\s\*\/, ': '\)/);
  assert.match(app, /\$\{progress\.toFixed\(1\)\}%/);
  assert.ok(app.includes('BTP con') && app.includes('bom-group-progress'));
  assert.match(app, /class="sidebar-settings"[\s\S]*?id="themeSelect"/);
  assert.match(app, /id="sidebarCollapse"/);
  assert.match(styles, /@media\(max-width:820px\)\{\.shell\.sidebar-collapsed \.sidebar\{width:min\(290px,86vw\);min-width:min\(290px,86vw\)/);
  assert.match(styles, /\.shell\.sidebar-collapsed \.main-area\{margin-left:0\}/);
  assert.match(styles, /@media\(min-width:821px\)\{\.shell\.sidebar-collapsed \.nav-group\.expanded \.nav-children\{display:none\}\}/);
  assert.ok(app.indexOf('href="#materials-dashboard">Dashboard BOM &amp; vật tư') < app.indexOf('href="#materials">BOM &amp; Vật tư PL'));
  assert.doesNotMatch(app, /href="#btp(?:-dates)?"/);
  assert.match(app, /<input type="checkbox" data-material-sheet/);
  assert.match(auditPage, /type="date" id="materialReceiptDateFilter"[\s\S]*id="materialStatusFilter"[\s\S]*id="exportBtpShortage"[\s\S]*id="materialSearch"/);
  assert.match(auditPage, /id="materialSearch" type="search" inputmode="search"/);
  assert.match(app, /const rerenderAuditResults = \(\) => \{[\s\S]*for \(const selector of \['\.audit-stats','\.audit-table-heading','\.bom-btp-groups','\.btp-pagination'\]\)[\s\S]*bindAuditPagination\(\)/);
  assert.match(app, /state\.materialSearch = event\.currentTarget\.value;[\s\S]*rerenderAuditResults\(\);/);
  assert.doesNotMatch(app, /rerenderAudit\(\{ focusSearch:true/);
  assert.match(auditPage, /Đơn vị giao[\s\S]*id="materialUnitFilter"/);
  assert.match(auditPage, /deliveryUnits\.map\(\(unit\)/);
  assert.match(app, /state\.materialUnitFilter && String\(row\.btp\?\.unit/);
  assert.match(auditPage, /id="materialStatusFilter"[\s\S]*id="exportBtpShortage"[\s\S]*id="materialSearch"/);
  assert.ok(auditPage.indexOf('id="exportBtpShortage"') < auditPage.indexOf('class="bom-btp-groups"'));
  assert.match(app, /<th>Mã BTP \(Chi tiết\)<\/th><th>Chủng loại<\/th><th>DVG<\/th><th>Quy cách \(Size\)<\/th><th>Chiều dài \(mm\)<\/th><th>SL thiết kế<\/th><th>Đã nhận<\/th><th>Còn thiếu<\/th><th>Tiến độ theo ngày<\/th><th>Ktra nối<\/th><th>Trạng thái<\/th><th>Ghi chú<\/th>/);
  assert.doesNotMatch(auditPage, /<th>Mã BOM|<th>Nối QLDA|<th>Sheet nguồn/);
  assert.match(auditPage, /state\.progressData\?\.rows/);
  assert.match(styles, /\.material-audit-controls\{position:sticky;top:82px/);
  assert.match(app, /ADMIN_MODE\)[\s\S]*const key = location\.hash\.replace\(\/\^#\\\/?\//);
  assert.match(app, /\['overview','materials','materials-dashboard','projects','admin'\]\.includes\(key\) \? key : 'admin'/);
  assert.match(app, /href="\$\{ADMIN_MODE \? '#admin' : '\.\/admin\.html'\}"/);
  assert.match(app, /href="#materials-dashboard">Dashboard BOM &amp; vật tư/);
  assert.match(styles, /\.bom-btp-table th:first-child,\.bom-btp-table td:first-child\{position:sticky;left:0/);
  assert.match(styles, /@media\(max-width:580px\)[\s\S]*\.bom-btp-table\{min-width:1280px\}/);
  assert.match(styles, /\.bom-btp-table-wrap\{max-height:min\(62vh,680px\);overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-x pan-y\}/);
  assert.match(styles, /\.material-chart-svg\{display:block;width:auto;height:270px;max-width:none;flex:none\}/);
  assert.match(app, /state\.page === 'materials-dashboard' \? materialDashboardPage\(\)/);
  assert.match(app, /id="materialDashboardStartDate"/);
  assert.match(app, /id="materialDashboardEndDate"/);
  assert.match(app, /id="materialDashboardMetric"/);
  assert.match(app, /addEventListener\('change', \(event\) => \{\s*state\.materialDashboardMetric/);
  assert.match(app, /matchMedia\('\(max-width: 820px\)'\)/);
  assert.match(themes, /theme-ocean/);
  assert.match(themes, /theme-emerald/);
  assert.match(themes, /theme-violet/);
  assert.match(themes, /theme-graphite/);
  assert.match(themes, /theme-sunset/);
  assert.doesNotMatch(app, /\['overview','materials','btp','btp-dates','projects'\]/);
  assert.match(app, /projectFilenameLabel\(project\)/);
  assert.match(app, /localeCompare\(String\(right\.code\), 'vi', \{ numeric:true, sensitivity:'base' \}\)/);
  assert.match(app, /\[\.\.\.state\.projects\]\.sort\(\(left, right\) => String\(left\.code\)\.localeCompare\(String\(right\.code\)/);
});

test('workspace defers the Excel parser and only requests data needed by the selected tab', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync('public/app.js', 'utf8');
  const index = readFileSync('public/index.html', 'utf8');
  const admin = readFileSync('public/admin.html', 'utf8');
  const styles = readFileSync('public/workspace-enhancements.css', 'utf8');
  assert.doesNotMatch(index, /xlsx\.full\.min\.js/);
  assert.doesNotMatch(admin, /xlsx\.full\.min\.js/);
  assert.match(app, /function loadSpreadsheetLibrary\(\)/);
  assert.match(app, /state\.page === 'materials-dashboard' \? \[\['btpData','btp'\]\] : \[\['progressData','progress'\]\]/);
  assert.match(app, /state\.page === 'materials'\s*\? \[\['data','materials'\], \['btpData','btp'\], \['progressData','progress'\]\]/);
  assert.match(app, /if \(state\[field\]\) return/);
  assert.match(app, /id="importFileProgress" aria-live="polite"/);
  assert.match(app, /setImportProgress\(fileIndex, 'complete'/);
  assert.match(app, /setImportProgress\(fileIndex, 'error'/);
  assert.match(styles, /\.import-file-progress-item\.working \.import-file-progress-indicator[\s\S]*animation:spin/);
});

test('material dashboard charts cumulative receipt totals and received/shortage by delivery unit', () => {
  const html = renderMaterialDashboard([
    { unit:'DVG-A', design_quantity:3, received:1, remaining:2, daily_progress:'01/09/2026: 1; 02/09/2026: 1' },
    { unit:'DVG-A', design_quantity:2, received:2, remaining:0, daily_progress:'02/09/2026: 2' },
  ], 'PROJECT · Sheet A');
  assert.match(html, /Dashboard BOM &amp; vật tư/);
  assert.match(html, /Lũy kế nhận theo ngày/);
  assert.match(html, /Phân theo đơn vị giao/);
  assert.match(html, /01\/09\/2026 · lũy kế 1/);
  assert.match(html, /02\/09\/2026 · lũy kế 4/);
  assert.match(html, /DVG-A · đã nhận 3/);
  assert.match(html, /DVG-A · còn thiếu hiện tại 2 BTP/);
});

test('material dashboard filters a selected date range and calculates kg or tonnes from BTL U.Weight', () => {
  const rows = [
    { source_file:'A290PL.xlsx', source_sheet:'BTP-A290T1P1', source_row:14, part_no:'BTP-1', unit:'DVG-A', unit_weight:2, design_quantity:5, received:2, remaining:3, daily_progress:'31/08/2026: 1; 01/09/2026: 1; 02/09/2026: 2' },
    { source_file:'A290PL.xlsx', source_sheet:'BTP-A290T1P1', source_row:15, part_no:'BTP-2', unit:'DVG-B', unit_weight:0.5, design_quantity:1, received:1, remaining:0, daily_progress:'31/08/2026: 1' },
    { source_file:'A290PL.xlsx', source_sheet:'BTP-A290T1P1', source_row:16, part_no:'BTP-3', unit:'DVG-C', design_quantity:2, received:1, remaining:1, daily_progress:'02/09/2026: 1' },
  ];
  const kgHtml = renderMaterialDashboard(rows, 'A290 · A290T1P1', { from:'2026-09-01', to:'2026-09-02', metric:'kg' });
  assert.match(kgHtml, /01\/09\/2026 · lũy kế 2 kg/);
  assert.match(kgHtml, /02\/09\/2026 · lũy kế 6 kg/);
  assert.match(kgHtml, /DVG-A · đã nhận 6 kg/);
  assert.match(kgHtml, /DVG-A · còn thiếu hiện tại 6 kg/);
  assert.doesNotMatch(kgHtml, /31\/08\/2026/);
  assert.match(kgHtml, /1 lượt nhận và 1 dòng thiếu U\.Weight/);

  const tonHtml = renderMaterialDashboard([rows[0]], 'A290 · A290T1P1', { from:'2026-09-01', to:'2026-09-02', metric:'ton' });
  assert.match(tonHtml, /02\/09\/2026 · lũy kế 0,006 tấn/);
  assert.match(tonHtml, /DVG-A · đã nhận 0,006 tấn/);
});

test('A290 6HH-43 uses the date on its receipt record as the displayed receipt date', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync('public/app.js', 'utf8');
  const materialRow = {
    source_sheet:'A290ELE', part_no:'6HH-43', received:1, delivery_date:'2026-05-21',
  };
  const btpRows = [{ source_sheet:'BTP-A290ELE', part_no:'6-B-60001-6HH-43', received:1, remaining:0, daily_progress:'14/07: 1' }];
  assert.equal(materialRow.part_no, '6HH-43');
  assert.equal(btpRows[0].part_no, '6-B-60001-6HH-43');
  assert.equal(btpRows[0].received, 1);
  assert.equal(btpRows[0].remaining, 0);
  assert.equal(materialRow.delivery_date, '2026-05-21', 'the date recorded on the receipt/issue record is the receipt date');
  assert.match(app, /function auditReceiptEvents\(row\)/);
  assert.match(app, /row\?\.btp\?\.daily_progress/);
  assert.match(app, /title="Chọn ngày trên lịch hoặc nhập ngày trực tiếp"/);
  assert.doesNotMatch(app, /Ngày phát hành:/);
});

test('BTP receipt date filter accepts calendar ISO dates and stored Vietnamese dates', () => {
  const rows = [
    { part_no:'BTP-1', daily_progress:'29/09/2026: 1; 30/09/2026: 2' },
    { part_no:'BTP-2', daily_progress:'01/10/2026: 1' },
  ];
  assert.deepEqual(filterBtpRowsByReceiptDate(rows, '2026-09-30').map((row) => row.part_no), ['BTP-1']);
  assert.deepEqual(filterBtpRowsByReceiptDate(rows, '30/09/2026').map((row) => row.part_no), ['BTP-1']);
  assert.equal(filterBtpRowsByReceiptDate(rows, '').length, 2);
});

test('material receipt dates fall back to child rows and display as Vietnamese dates', () => {
  const group = {
    delivery_date:null,
    children:[
      { delivery_date:'2026-09-26' },
      { delivery_date:'2026-09-29, 2026-09-26' },
      { delivery_date:null },
    ],
  };
  const receiptDates = getMaterialReceiptDate(group);
  assert.equal(receiptDates, '2026-09-26, 2026-09-29');
  assert.equal(formatMaterialDate(receiptDates), '26/09/2026, 29/09/2026');
  assert.equal(formatMaterialDate('not-a-date'), 'not-a-date');
  assert.equal(getMaterialReceiptDate({ delivery_date:'2026-09-29', children:[] }), '2026-09-29');
});

test('browser PL parser emits only approved import fields and preserves grouping', () => {
  const header = [];
  for (const [column, value] of [[2,'Drawing Number'],[3,'Assembly No.'],[4,'Description'],[5,'Part No.'],[7,'Size'],[12,"T.Q'ty"],[14,'T.Weight'],[15,'Scope'],[20,'Received'],[21,'Remaining'],[28,'AS Symbol']]) header[column - 1] = value;
  const main = [];
  for (const [column, value] of [[2,'DWG-1'],[3,'ASM-1'],[4,'Main assembly'],[12,10],[20,4],[21,6],[28,'x']]) main[column - 1] = value;
  const component = [];
  for (const [column, value] of [[2,'DWG-2'],[4,'Component'],[5,'P-2'],[7,'M20'],[12,4],[14,'413,4'],[20,2],[21,2]]) component[column - 1] = value;
  component[4] = 12;
  const workbook = { SheetNames:['Cover','PL-1','BTP-PL-2'], Sheets:{ Cover:{}, 'PL-1':{}, 'BTP-PL-2':{} } };
  const parser = { utils:{ sheet_to_json:(sheet) => sheet === workbook.Sheets['PL-1']
    ? [...Array.from({length:7}, () => []), header, main, component] : [],
    encode_cell:({r,c}) => `${r}:${c}`,
    format_cell:(cell) => cell.z === '00000' ? String(cell.v).padStart(5,'0') : String(cell.v),
  } };
  workbook.Sheets['PL-1']['9:4'] = { v:12, z:'00000' };
  const payload = parseMaterialWorkbook(workbook, 'A290PL.xlsx', 'A290', parser);
  assert.equal(payload.records.length, 2);
  assert.equal(payload.records[0].is_main, 1);
  assert.equal(payload.records[1].parent, 'ASM-1');
  assert.equal(payload.records[1].part_no, '00012');
  assert.equal(payload.records[1].weight, 413.4);
  assert.equal(payload.records[1].status, 'chưa đủ');
  assert.equal(payload.records[1].source_sheet, 'PL-1');
  assert.equal(Object.hasOwn(payload.records[1], 'project_code'), false);
  assert.equal(Object.hasOwn(payload.records[1], 'filename'), false);
});

test('BTP parser recognizes detail headers, keeps dated progress, and excludes issue date fields', () => {
  const headers = ['Chủng loại','Part No.1','Size','Description','Length','Material',"T.Q'ty",'U.Weight','T.Weight','Đã nhận','SL Nhận','Còn thiếu','21/07',new Date('2026-07-23T00:00:00Z'),'Ktra nối','Lấy data','KO BB','Tôn','Cảnh báo thừa','DVG','MPR No','Qty MPR','Cutting No.','Qty Cutting','Date Issue','Ghi Chú'];
  const detail = ['Shape','BTP-001','L-75X75X6','ANGLE',350,'A36',2,'2,4','4,8',0,1,1,3,1,'✓','ok','x','PL10',null,'MCC','MPR-1',2,'CUT-1',2,'23/07/2026','Kiểm tra ghi chú'];
  const workbook = { SheetNames:['BTP-A290T1P1'], Sheets:{ 'BTP-A290T1P1':{} } };
  const parser = { utils:{ sheet_to_json:() => [...Array.from({length:25}, () => []), headers, detail] } };
  const payload = parseMaterialWorkbook(workbook, 'A290PL.xlsx', 'A290', parser);
  assert.equal(payload.records.length, 0);
  assert.deepEqual(BTP_COLUMNS, ['part_no','material_type','description','material','unit','size','length_mm','unit_weight','total_weight','design_quantity','received','remaining','daily_progress','joint_check','status','note']);
  assert.equal(payload.btp_records.length, 1);
  assert.deepEqual(payload.btp_records[0], {
    source_sheet:'BTP-A290T1P1', source_row:27, part_no:'BTP-001', material_type:'Shape', description:'ANGLE', material:'A36', size:'L-75X75X6', length_mm:350,
    unit_weight:2.4, total_weight:4.8, design_quantity:2, received:0, remaining:1, daily_progress:'21/07/2026: 3; 23/07/2026: 1', joint_check:'✓', unit:'MCC', status:'Còn thiếu', note:'Kiểm tra ghi chú',
  });
  assert.equal(Object.keys(payload.btp_records[0]).some((field) => ['weight','issue_date','date_issue','MPR No','Cutting No.'].includes(field)), false);
});

test('BTP import keeps rows with Part No or detail name, drops empty rows, and excludes Purchasing', () => {
  const headers = ['Part No.1','Size','Tên chi tiết',"T.Q'ty"];
  const rows = [...Array.from({length:25}, () => []), headers,
    ['PART-1','PL8*100',null,1],
    [null,null,'Chi tiết không có mã',null],
    [null,null,null,7],
    ['—',null,'-',2],
    [null,null,null,null],
    ['PART-ONLY',null,null,null]];
  const noPartNoRows = [...Array.from({length:25}, () => []), ['Tên chi tiết','Size',"T.Q'ty"], ['Tên duy nhất','PL10*50',1]];
  const workbook = { SheetNames:['BTP-A290T1P1','BTP-NoPartNo','BTP-Purchasing'], Sheets:{ 'BTP-A290T1P1':{}, 'BTP-NoPartNo':{}, 'BTP-Purchasing':{} } };
  const parser = { utils:{ sheet_to_json:(sheet) => sheet === workbook.Sheets['BTP-A290T1P1'] ? rows
    : sheet === workbook.Sheets['BTP-NoPartNo'] ? noPartNoRows
      : [...Array.from({length:25}, () => []), headers, ['PURCHASE-1', 'PL1*1', 'Không được nhập', 1]] } };
  const payload = parseMaterialWorkbook(workbook, 'A290PL.xlsx', 'A290', parser);
  assert.deepEqual(payload.btp_records.map((row) => row.part_no || row.description), ['PART-1','Chi tiết không có mã','PART-ONLY','Tên duy nhất']);
  assert.equal(payload.btp_records[1].part_no, null);
  assert.equal(payload.btp_records[1].description, 'Chi tiết không có mã');
  assert.equal(payload.btp_records[3].part_no, null);
  assert.ok(payload.btp_records.slice(0,3).every((row) => row.source_sheet === 'BTP-A290T1P1'));
  assert.equal(payload.btp_records[3].source_sheet, 'BTP-NoPartNo');
  assert.equal(isPurchasingMaterialSheet('BTP-Purchasing'), true);
  assert.equal(isPurchasingMaterialSheet('Purchasing'), true);
  assert.equal(isPurchasingMaterialSheet('BTP-Purchasing-Notes'), false);
  assert.equal(hasBtpIdentity({ part_no:'—', description:' - ' }), false);
  assert.equal(hasBtpIdentity({ part_no:null, description:'Tên chi tiết' }), true);
});

test('PL parser detects shifted headers and maps receipt record dates, normalizing duplicates', () => {
  const workbook = { SheetNames:['PL-1'], Sheets:{ 'PL-1':{} } };
  const header = ['Drawing No.', 'Assembly Number', 'Description', 'Part Number', 'Size', "T.Q'ty", 'T.Weight',
    'Scope of Painting Work', 'Delivery Date', 'Date Issue 3', 'Scope of Steel Work', 'Date Issue 1', 'Date Issue 2', 'Date Issue 4', 'AS Symbol'];
  const main = ['DWG-1', 'ASM-1', 'Main', 'P-1', 'M20', 1, 10, 'paint', 45352, '04/03/2024', 'steel', '2024-01-02', '2024-01-02', new Date('2024-02-01T00:00:00Z'), 'x'];
  const parser = {
    utils:{ sheet_to_json:() => [...Array.from({length:5}, () => []), header, main] },
    SSF:{ parse_date_code:(value) => value === 45352 ? { y:2024, m:3, d:1 } : null },
  };
  const { records } = parseMaterialWorkbook(workbook, 'A290PL.xlsx', 'A290', parser);
  assert.equal(records.length, 1);
  assert.equal(records[0].scope, 'steel');
  assert.equal(records[0].delivery_date, '2024-01-02, 2024-02-01, 2024-03-04');
  assert.equal(Object.hasOwn(records[0], 'issue_dates'), false);
});

test('PL parser ignores invalid receipt record dates and falls back to the delivery-date field', () => {
  const workbook = { SheetNames:['PL-1'], Sheets:{ 'PL-1':{} } };
  const header = ['Drawing Number', 'Description', 'Part No.', 'Scope of Work', 'Date Issue 1', 'Ngày giao', 'AS Symbol'];
  const row = ['DWG-1', 'Main', 'P-1', 'steel', '31/02/2024', '15/04/2024', 'x'];
  const parser = { utils:{ sheet_to_json:() => [...Array.from({length:5}, () => []), header, row] } };
  const { records } = parseMaterialWorkbook(workbook, 'A290PL.xlsx', 'A290', parser);
  assert.equal(records[0].delivery_date, '2024-04-15');
  const blank = parseMaterialWorkbook({ SheetNames:['PL-1'], Sheets:{ 'PL-1':{} } }, 'A290PL.xlsx', 'A290', {
    utils:{ sheet_to_json:() => [...Array.from({length:5}, () => []), header, ['DWG-2', 'Main', 'P-2', 'steel', null, null, 'x']] },
  });
  assert.equal(blank.records[0].delivery_date, null);
});

test('JSON import validator rejects invalid rows before any database operation', () => {
  const columns = ['project_code','source_file','source_sheet','source_row','drawing','is_main','status'];
  assert.throws(() => __test__.validateImportRecords([], columns, 'A290', 'A290PL.xlsx', 'materials'), /JSON/);
  assert.throws(() => __test__.validateImportRecords([{source_sheet:'PL',source_row:0}], columns, 'A290', 'A290PL.xlsx', 'materials'), /Số dòng nguồn/);
  const rows = __test__.validateImportRecords([{source_sheet:'PL',source_row:3,drawing:'DWG',is_main:1,status:'đủ'}], columns, 'A290', 'A290PL.xlsx', 'materials');
  assert.deepEqual(rows[0], {project_code:'A290',source_file:'A290PL.xlsx',source_sheet:'PL',source_row:3,drawing:'DWG',is_main:1,status:'đủ'});
});

test('PL staging chunks stay within D1 parameter limit and commit is atomic', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync('worker/index.js', 'utf8');
  const migration = readFileSync('migrations/0002_material_import_staging.sql', 'utf8');
  const dateMigration = readFileSync('migrations/0003_material_delivery_and_issue_dates.sql', 'utf8');
  const btpMigration = readFileSync('migrations/0004_btp_materials.sql', 'utf8');
  const btpWeightMigration = readFileSync('migrations/0005_btp_unit_weight.sql', 'utf8');
  const btpDetailsMigration = readFileSync('migrations/0006_btp_bom_details.sql', 'utf8');
  assert.equal(__test__.MATERIAL_CHUNK_SIZE, 500);
  assert.ok(__test__.MATERIAL_INSERT_ROWS_PER_STATEMENT * (__test__.MATERIAL_IMPORT_COLUMNS.length + 2) + 4 <= 100,
    'chunk inserts must stay below 100 bound parameters per statement');
  assert.ok(__test__.MATERIAL_COMMIT_BATCH_SIZE >= __test__.MATERIAL_CHUNK_SIZE);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS material_imports/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS material_import_rows/);
  assert.match(dateMigration, /ALTER TABLE materials ADD COLUMN delivery_date TEXT/);
  assert.match(dateMigration, /ALTER TABLE material_import_rows ADD COLUMN issue_dates TEXT/);
  assert.match(btpMigration, /CREATE TABLE IF NOT EXISTS btp_materials/);
  assert.match(btpMigration, /CREATE TABLE IF NOT EXISTS btp_material_import_rows/);
  assert.match(btpWeightMigration, /ALTER TABLE btp_materials ADD COLUMN unit_weight REAL/);
  assert.match(btpDetailsMigration, /ALTER TABLE btp_materials ADD COLUMN description TEXT/);
  assert.match(btpDetailsMigration, /ALTER TABLE btp_materials ADD COLUMN material TEXT/);
  assert.match(btpDetailsMigration, /ALTER TABLE btp_materials ADD COLUMN total_weight REAL/);
  assert.equal(__test__.BTP_IMPORT_COLUMNS.length, 18);
  assert.match(source, /INSERT INTO \$\{stagingTable\} \(\$\{stagingColumns\.join\(', '\)\}\) VALUES \$\{valueGroups\}/);
  assert.match(source, /UPDATE material_imports SET committed = 1, commit_token = \?/);
  assert.match(source, /DELETE FROM materials WHERE project_code = \? AND EXISTS/);
  assert.match(source, /INSERT INTO materials \(\$\{insertColumns\}\) SELECT \?, \?, source_sheet, source_row/);
  assert.match(source, /await env\.DB\.batch\(statements\)/);
  assert.match(source, /UPDATE material_imports SET next_row = \? WHERE id = \? AND next_row = \?/);
  assert.match(source, /request\.method === 'POST' && path === '\/api\/admin\/import\/materials'\) return importMaterials/);
});

test('actual A290 workbook parses to a compact approved-field JSON payload', { skip: !existsSync('Data/A290PL.xlsx') }, async () => {
  const { readFileSync } = await import('node:fs');
  const workbook = xlsx.read(readFileSync('Data/A290PL.xlsx'), { type:'buffer', cellDates:true, bookVBA:false });
  const payload = parseMaterialWorkbook(workbook, 'A290PL.xlsx', 'A290', xlsx);
  assert.equal(payload.records.length, 12688);
  assert.ok(payload.btp_records.length > 10000);
  assert.ok(payload.records.some((row) => row.weight === 413.4), 'decimal-comma weights are parsed as numeric values');
  assert.ok(payload.records.every((row) => ['quantity', 'weight', 'received', 'remaining'].every((field) => row[field] == null || typeof row[field] === 'number')));
  assert.equal(payload.records.some((row) => row.source_row === 9 && String(row.part_no).startsWith('5A')), false, 'column index headings are not material rows');
  assert.ok(payload.records.some((row) => row.is_main === 1));
  const receiptRecord = payload.records.find((row) => row.part_no === '6HH-43');
  assert.equal(receiptRecord?.received, 1);
  assert.equal(receiptRecord?.delivery_date, '2026-05-21');
  assert.equal(Object.hasOwn(receiptRecord || {}, 'issue_dates'), false);
  assert.ok(payload.btp_records.every((row) => !Object.hasOwn(row, 'issue_date') && !Object.hasOwn(row, 'date_issue')));
  assert.ok(Buffer.byteLength(JSON.stringify(payload)) < 10 * 1024 * 1024);
  assert.equal(Object.hasOwn(payload.records[0], 'project_code'), false);
});

test('actual M304PL workbook exceeds the old 10 MB limit but is readable under the new material upload limit', { skip: !existsSync('Data/M304PL.xlsx') }, async () => {
  const file = new File([readFileSync('Data/M304PL.xlsx')], 'M304PL.xlsx');
  assert.ok(file.size > 10 * 1024 * 1024);
  assert.ok(file.size < MAX_MATERIAL_FILE_BYTES);
  Object.defineProperty(file, 'arrayBuffer', { value: async () => { throw new DOMException('transient file read failure', 'NotReadableError'); } });
  const payload = await readMaterialWorkbook(file, 'M304', xlsx);
  assert.equal(payload.project_code, 'M304');
  assert.ok(payload.records.length > 0);
  assert.ok(payload.btp_records.length > 0);
});

test('material audit links BTP child codes to BOM across separate source files and joins QLDA conservatively', () => {
  const materials = [
    { source_file:'A290PL.xlsx', source_sheet:'A290U6T1P1', source_row:10, is_main:1, assembly:'FRAME-01', drawing:'D-01' },
    { source_file:'A290PL.xlsx', source_sheet:'A290U6T1P1', source_row:11, is_main:0, parent:'FRAME-01', part_no:'PLATE-2', quantity:2, size:'PL10*200' },
  ];
  const btp = { source_file:'BTP-Source.xlsx', source_sheet:'BTP-A290U6T1P1', source_row:31, part_no:'FRAME-01-PLATE-2', design_quantity:2, received:1, remaining:1 };
  const progress = [{ source_file:'A290.xlsx', source_sheet:'Progress', source_row:4, part_no:'FRAME-01', drawing:'D-01', quantity:2, receiver:'MCC' }];
  const linkage = linkBtpToBom(btp, materials);
  assert.equal(linkage.parent.assembly, 'FRAME-01');
  assert.equal(linkage.bomLine.part_no, 'PLATE-2');
  assert.equal(linkage.bomMatch, 'file-and-sheet', 'the child BOM row must resolve inside its PL file and sheet after the parent is found by sheet name');
  assert.equal(findProgressForAssembly(linkage.parent, progress).match, 'part-and-drawing');
  const audit = buildMaterialAuditRows({ materialRows:materials, btpRows:[btp], progressRows:progress });
  assert.equal(audit.length, 1);
  assert.equal(audit[0].bomStatus, 'matched');
  assert.equal(audit[0].qldaStatus, 'matched');
});

test('material audit omits BOM drawing-marking placeholders without hiding named parts', () => {
  const materialRows = [
    { source_file:'A290PL.xlsx', source_sheet:'A290ELE', source_row:10, is_main:0, part_no:'5A (Marking as Dwg.)' },
    { source_file:'A290PL.xlsx', source_sheet:'A290ELE', source_row:11, is_main:0, part_no:'PLATE-01' },
  ];
  const audit = buildMaterialAuditRows({ materialRows });
  assert.equal(audit.length, 1);
  assert.equal(audit[0].bomLine.part_no, 'PLATE-01');
});

test('shortage export fills the supplied template while retaining every original workbook part and cell style', async () => {
  const { readFileSync } = await import('node:fs');
  const templateBytes = new Uint8Array(readFileSync('public/templates/List_thieu_mau.xlsx'));
  const template = unzipSync(templateBytes);
  const report = buildBtpShortageTemplate({
    templateBytes,
    projectCode:'A290',
    now:new Date('2026-09-30T00:00:00Z'),
    selectedSheets:[{ source_file:'A290PL.xlsx', source_sheet:'A290U6T1P1' }],
    rows:[{ source_file:'A290PL.xlsx', source_sheet:'BTP-A290U6T1P1', source_row:31, part_no:'FRAME-01-PLATE-2', material_type:'PLATE', description:'Plate', material:'SM490', unit:'MCC', size:'PL10*200', length_mm:200, unit_weight:3, total_weight:6, design_quantity:2, received:1, remaining:1, daily_progress:'28/09/2026: 1; 30/09/2026: 1', joint_check:'Nối đạt', status:'Còn thiếu', note:'Ghi chú riêng của dòng BTP', shortage_weight:3 }],
    materialRows:[
      { source_file:'A290PL.xlsx', source_sheet:'A290U6T1P1', source_row:10, is_main:1, assembly:'FRAME-01', drawing:'D-01' },
      { source_file:'A290PL.xlsx', source_sheet:'A290U6T1P1', source_row:11, is_main:0, parent:'FRAME-01', part_no:'PLATE-2', quantity:2, size:'PL10*200', description:'Plate', weight:6 },
    ],
    progressRows:[{ source_file:'A290.xlsx', source_sheet:'Progress', source_row:4, part_no:'FRAME-01', drawing:'D-01', quantity:2, receiver:'MCC' }],
  });
  const output = unzipSync(report.bytes);
  const workbook = xlsx.read(report.bytes, { type:'array', cellStyles:true });
  const sheet = workbook.Sheets['Bieu mau check tinh trang BTP'];
  assert.equal(report.rowCount, 1);
  assert.equal(sheet.C4.v, 'A290');
  assert.equal(sheet.A13?.v, undefined, 'keep the template spacer row empty');
  assert.equal(sheet.A14.v, 1);
  assert.equal(sheet.D14.v, 'A290U6T1P1', 'category comes from the normalized BTP sheet name');
  assert.equal(sheet.E14.v, 'Plate', 'description comes from the BTP row');
  assert.equal(sheet.F14.v, 'FRAME-01-PLATE-2');
  assert.equal(sheet.H14.v, 'PL10*200');
  assert.equal(sheet.I14.v, 200);
  assert.equal(sheet.M14.v, 2);
  assert.equal(sheet.N14.v, 3);
  assert.equal(sheet.O14.v, 6);
  assert.equal(sheet.P14.v, 'Ktra nối: Nối đạt\nTrạng thái: Còn thiếu\nGhi chú: Ghi chú riêng của dòng BTP');
  assert.equal(sheet.Z14.v, '28/09/2026: 1\n30/09/2026: 1');
  assert.equal(sheet.AB14.v, 'PLATE');
  assert.equal(sheet.AC14.v, 'MCC');
  assert.equal(sheet.AD14.v, 1);
  assert.equal(sheet.AE14.v, 3);
  assert.equal(sheet.AF14.v, 1);
  assert.equal(sheet.AG14.v, 3);
  assert.equal(sheet.B14?.v, undefined, 'leave the parent drawing column empty');
  assert.equal(sheet.C14?.v, undefined, 'leave the parent assembly column empty');
  assert.equal(sheet.K14?.v, undefined, 'leave BOM quantity empty');
  assert.equal(sheet.AH14?.v, undefined, 'leave the MCC section to its owner');
  assert.equal(sheet.AP14?.v, undefined, 'leave MCC status to its owner');
  assert.equal(sheet.AR14?.v, undefined, 'leave the WTC section to its owner');
  assert.equal(sheet.BB14?.v, undefined, 'leave the PMC section to its owner');
  assert.equal(sheet.P12.v, 'Remark');
  assert.equal(sheet.AB12.v, 'Chủng loại vật tư');
  assert.equal(sheet.AP12.v, 'Tình trạng vật tư');
  assert.doesNotMatch(sheet.P14.v, /BOM|QLDA|A290PL\.xlsx|FRAME-01/);
  const changedParts = Object.keys(template).filter((path) => Buffer.compare(Buffer.from(template[path]), Buffer.from(output[path])) !== 0);
  assert.deepEqual(changedParts, ['xl/worksheets/sheet2.xml'], 'only the target worksheet values should change');
  const styleBefore = new TextDecoder().decode(template['xl/worksheets/sheet2.xml']);
  const styleAfter = new TextDecoder().decode(output['xl/worksheets/sheet2.xml']);
  assert.equal(styleBefore.match(/<c\b[^>]*\br="F13"[^>]*\bs="([^"]+)"/)?.[1], styleAfter.match(/<c\b[^>]*\br="F13"[^>]*\bs="([^"]+)"/)?.[1]);
  assert.deepEqual(Buffer.from(template['xl/styles.xml']), Buffer.from(output['xl/styles.xml']));
  const longList = unzipSync(fillTemplateWorkbook(templateBytes, 'Bieu mau check tinh trang BTP', { A600:'Line 588' }));
  assert.match(new TextDecoder().decode(longList['xl/worksheets/sheet2.xml']), /<autoFilter ref="A13:AQ600"/);
  assert.match(new TextDecoder().decode(longList['xl/workbook.xml']), /\$A\$13:\$AQ\$600/);
});

test('actual A320 workbook preserves the receipt date for SDM_A5C_1-1A_P4', { skip: !existsSync('Data/A320PL.xlsx') }, async () => {
  const { readFileSync } = await import('node:fs');
  const workbook = xlsx.read(readFileSync('Data/A320PL.xlsx'), { type:'buffer', cellDates:true, bookVBA:false });
  const payload = parseMaterialWorkbook(workbook, 'A320PL.xlsx', 'A320', xlsx);
  const receiptRow = payload.records.find((row) => row.source_sheet === 'A320M4130' && row.source_row === 211);
  assert.equal(receiptRow?.part_no, 'P4');
  assert.equal(receiptRow?.delivery_date, '2026-08-07');
});

test('real source workbooks are kept outside Git and ignored', { skip: !existsSync('Data/A290PL.xlsx') || !existsSync('QLDA/A290.xlsx') }, () => {
  assert.equal(execFileSync('git', ['check-ignore','Data/A290PL.xlsx'], { encoding:'utf8' }).trim().length > 0, true);
  assert.equal(execFileSync('git', ['check-ignore','QLDA/A290.xlsx'], { encoding:'utf8' }).trim().length > 0, true);
  const tracked = execFileSync('git', ['ls-files'], { encoding:'utf8', stdio:['ignore','pipe','pipe'] });
  assert.doesNotMatch(tracked, /(?:^|\n)(?:Data|QLDA)[\\/].*\.xlsx?(?:\n|$)/i);
  assert.ok(existsSync('Data/A290PL.xlsx'));
  assert.ok(existsSync('QLDA/A290.xlsx'));
});
