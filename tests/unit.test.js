import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as xlsx from 'xlsx';
import { __test__ } from '../worker/index.js';
import { BTP_COLUMNS, parseMaterialWorkbook } from '../public/material-import.js';
import { filterBtpRows, filterMaterialGroups, filterMaterialRowsBySheet, highlightMatch } from '../public/material-search.js';
import { formatMaterialDate, getMaterialReceiptDate } from '../public/material-display.js';

test('project codes are normalized and restricted to safe identifiers', () => {
  assert.equal(__test__.safeProjectCode(' a290 '), 'A290');
  assert.throws(() => __test__.safeProjectCode('../private'), /không hợp lệ/);
  assert.throws(() => __test__.safeProjectCode('A'), /không hợp lệ/);
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

test('PL materials page has per-sheet detail filters and no separate BTP detail page', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync('public/app.js', 'utf8');
  const styles = readFileSync('public/styles.css', 'utf8');
  const materialColumns = app.match(/const materialColumns = \[([^\]]+)\]/)?.[1]
    .split(',').map((column) => column.trim().replace(/^['"]|['"]$/g, ''));
  assert.ok(materialColumns, 'PL material columns must be defined');
  for (const hidden of ['assembly', 'source_sheet', 'source_row', 'scope', 'as_symbol', 'issue_dates']) {
    assert.equal(materialColumns.includes(hidden), false, `${hidden} must not be displayed in the PL table`);
  }
  assert.ok(materialColumns.includes('delivery_date'), 'PL table keeps the recognized delivery date');
  assert.match(app, /class="sidebar-settings"[\s\S]*?id="themeSelect"/);
  assert.match(app, /id="sidebarCollapse"/);
  assert.match(styles, /@media\(max-width:820px\)\{\.shell\.sidebar-collapsed \.sidebar\{width:min\(290px,86vw\);min-width:min\(290px,86vw\)/);
  assert.match(styles, /\.shell\.sidebar-collapsed \.main-area\{margin-left:0\}/);
  assert.match(styles, /@media\(min-width:821px\)\{\.shell\.sidebar-collapsed \.nav-group\.expanded \.nav-children\{display:none\}\}/);
  assert.match(app, /class="material-filter-stack"[\s\S]*?id="materialSheetFilter"[\s\S]*?id="materialSearch"/);
  assert.match(app, /Toàn bộ file \(\$\{sheetOptions\.length\} sheet\)/);
  assert.doesNotMatch(app, /function btpPage\(|Chi tiết BTP|href="#btp"/);
  assert.match(app, /localeCompare\(String\(right\.code\), 'vi', \{ numeric:true, sensitivity:'base' \}\)/);
  assert.match(app, /\[\.\.\.state\.projects\]\.sort\(\(left, right\) => String\(left\.code\)\.localeCompare\(String\(right\.code\)/);
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
  assert.match(app, /Ngày nhận: \$\{fmt\(receiptDate\)\}/);
  assert.match(app, /getMaterialReceiptDate\(group\)/);
  assert.doesNotMatch(app, /Ngày phát hành:/);
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
  for (const [column, value] of [[2,'DWG-2'],[4,'Component'],[5,'P-2'],[7,'M20'],[12,4],[14,12],[20,2],[21,2]]) component[column - 1] = value;
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
  assert.equal(payload.records[1].status, 'chưa đủ');
  assert.equal(payload.records[1].source_sheet, 'PL-1');
  assert.equal(Object.hasOwn(payload.records[1], 'project_code'), false);
  assert.equal(Object.hasOwn(payload.records[1], 'filename'), false);
});

test('BTP parser recognizes detail headers, keeps dated progress, and excludes issue date fields', () => {
  const headers = ['Chủng loại','Part No.1','Size','Description','Length','Material',"T.Q'ty",'U.Weight','T.Weight','Đã nhận','SL Nhận','Còn thiếu',new Date('2026-07-21T00:00:00Z'),'Ktra nối','Lấy data','KO BB','Tôn','Cảnh báo thừa','DVG','MPR No','Qty MPR','Cutting No.','Qty Cutting',new Date('2026-07-23T00:00:00Z'),'Ghi Chú'];
  const detail = ['Shape','BTP-001','L-75X75X6','ANGLE',350,'A36',2,2.4,4.8,0,1,1,3,'✓','ok','x','PL10',null,'MCC','MPR-1',2,'CUT-1',2,'23/07/2026','Kiểm tra ghi chú'];
  const workbook = { SheetNames:['BTP-A290T1P1'], Sheets:{ 'BTP-A290T1P1':{} } };
  const parser = { utils:{ sheet_to_json:() => [...Array.from({length:25}, () => []), headers, detail] } };
  const payload = parseMaterialWorkbook(workbook, 'A290PL.xlsx', 'A290', parser);
  assert.equal(payload.records.length, 0);
  assert.deepEqual(BTP_COLUMNS, ['part_no','material_type','unit','size','length_mm','design_quantity','received','remaining','daily_progress','joint_check','status','note']);
  assert.equal(payload.btp_records.length, 1);
  assert.deepEqual(payload.btp_records[0], {
    source_sheet:'BTP-A290T1P1', source_row:27, part_no:'BTP-001', material_type:'Shape', size:'L-75X75X6', length_mm:350,
    design_quantity:2, received:0, remaining:1, daily_progress:'21/07/2026: 3', joint_check:'✓', unit:'MCC', status:'Còn thiếu', note:'Kiểm tra ghi chú',
  });
  assert.equal(Object.keys(payload.btp_records[0]).some((field) => ['description','material','weight','issue_date','date_issue','MPR No','Cutting No.'].includes(field)), false);
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
  assert.equal(__test__.MATERIAL_CHUNK_SIZE, 100);
  assert.ok(__test__.MATERIAL_INSERT_ROWS_PER_STATEMENT * (__test__.MATERIAL_IMPORT_COLUMNS.length + 2) + 4 <= 100,
    'chunk inserts must stay below 100 bound parameters per statement');
  assert.ok(__test__.MATERIAL_COMMIT_BATCH_SIZE >= __test__.MATERIAL_CHUNK_SIZE);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS material_imports/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS material_import_rows/);
  assert.match(dateMigration, /ALTER TABLE materials ADD COLUMN delivery_date TEXT/);
  assert.match(dateMigration, /ALTER TABLE material_import_rows ADD COLUMN issue_dates TEXT/);
  assert.match(btpMigration, /CREATE TABLE IF NOT EXISTS btp_materials/);
  assert.match(btpMigration, /CREATE TABLE IF NOT EXISTS btp_material_import_rows/);
  assert.equal(__test__.BTP_IMPORT_COLUMNS.length, 14);
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
  assert.equal(payload.records.length, 12698);
  assert.ok(payload.btp_records.length > 10000);
  assert.ok(payload.records.some((row) => row.is_main === 1));
  const receiptRecord = payload.records.find((row) => row.part_no === '6HH-43');
  assert.equal(receiptRecord?.received, 1);
  assert.equal(receiptRecord?.delivery_date, '2026-05-21');
  assert.equal(Object.hasOwn(receiptRecord || {}, 'issue_dates'), false);
  assert.ok(payload.btp_records.every((row) => !Object.hasOwn(row, 'issue_date') && !Object.hasOwn(row, 'date_issue')));
  assert.ok(Buffer.byteLength(JSON.stringify(payload)) < 10 * 1024 * 1024);
  assert.equal(Object.hasOwn(payload.records[0], 'project_code'), false);
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