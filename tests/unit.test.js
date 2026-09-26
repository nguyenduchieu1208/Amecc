import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { __test__ } from '../worker/index.js';

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

test('real source workbooks are kept outside Git and ignored', { skip: !existsSync('Data/A290PL.xlsx') || !existsSync('QLDA/A290.xlsx') }, () => {
  assert.equal(execFileSync('git', ['check-ignore','Data/A290PL.xlsx'], { encoding:'utf8' }).trim().length > 0, true);
  assert.equal(execFileSync('git', ['check-ignore','QLDA/A290.xlsx'], { encoding:'utf8' }).trim().length > 0, true);
  const tracked = execFileSync('git', ['ls-files'], { encoding:'utf8', stdio:['ignore','pipe','pipe'] });
  assert.doesNotMatch(tracked, /(?:^|\n)(?:Data|QLDA)[\\/].*\.xlsx?(?:\n|$)/i);
  assert.ok(existsSync('Data/A290PL.xlsx'));
  assert.ok(existsSync('QLDA/A290.xlsx'));
});