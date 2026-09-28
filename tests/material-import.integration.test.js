import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import * as xlsx from 'xlsx';
import worker from '../worker/index.js';
import { parseMaterialWorkbook } from '../public/material-import.js';

const workbookPath = 'Data/A290PL.xlsx';

function createD1(database) {
  return {
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...bindings) { values = bindings; return statement; },
        async first() { return database.prepare(sql).get(...values) ?? null; },
        async all() { return { results: database.prepare(sql).all(...values) }; },
        async run() {
          const result = database.prepare(sql).run(...values);
          return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid || 0) } };
        },
      };
      return statement;
    },
    async batch(statements) {
      database.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

async function post(env, token, body) {
  return worker.fetch(new Request('https://amecc.test/api/admin/import/materials', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), env);
}

test('A290 staged import keeps existing PL data on commit failure and atomically replaces it on retry', {
  skip: !existsSync(workbookPath),
  timeout: 120000,
}, async () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec(readFileSync('migrations/0001_initial.sql', 'utf8'));
    database.exec(readFileSync('migrations/0002_material_import_staging.sql', 'utf8'));
    database.exec(readFileSync('migrations/0003_material_delivery_and_issue_dates.sql', 'utf8'));
    database.exec(readFileSync('migrations/0004_btp_materials.sql', 'utf8'));

    const token = 'isolated-a290-import-test-session';
    const tokenHash = createHash('sha256').update(token).digest('base64');
    database.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)')
      .run('test-admin', 'testadmin', 'unused', 'admin');
    database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(tokenHash, 'test-admin', Math.floor(Date.now() / 1000) + 3600);
    database.prepare('INSERT INTO projects (code, name, source_file, updated_at) VALUES (?, ?, ?, ?)')
      .run('A290', 'A290', 'ExistingPL.xlsx', 'before-import');
    database.prepare(`INSERT INTO materials (project_code, source_file, source_sheet, source_row, drawing, status)
      VALUES ('A290', 'ExistingPL.xlsx', 'Existing', 1, 'OLD-ROW', 'old')`).run();
    database.prepare(`INSERT INTO import_runs (id, project_code, category, source_file, imported_rows)
      VALUES ('previous-run', 'A290', 'materials', 'ExistingPL.xlsx', 1)`).run();

    const workbook = xlsx.read(readFileSync(workbookPath), { type: 'buffer', cellDates: true, bookVBA: false });
    const payload = parseMaterialWorkbook(workbook, 'A290PL.xlsx', 'A290', xlsx);
    assert.equal(payload.records.length, 12698);
    const env = { DB: createD1(database) };

    const begun = await post(env, token, {
      action: 'begin', project_code: payload.project_code, filename: payload.filename, expected_rows: payload.records.length,
    });
    assert.equal(begun.status, 201);
    const session = await begun.json();
    assert.equal(session.chunk_size, 100);

    const earlyCommit = await post(env, token, { action: 'commit', import_id: session.import_id });
    assert.equal(earlyCommit.status, 409);
    assert.equal(database.prepare("SELECT drawing FROM materials WHERE project_code = 'A290'").get().drawing, 'OLD-ROW');

    for (let start = 0; start < payload.records.length; start += session.chunk_size) {
      const chunk = await post(env, token, {
        action: 'chunk', import_id: session.import_id, start_row: start,
        records: payload.records.slice(start, start + session.chunk_size),
      });
      assert.equal(chunk.status, 200, `staging request at row ${start} failed: ${await chunk.text()}`);
    }
    assert.equal(Number(database.prepare('SELECT COUNT(*) AS total FROM materials WHERE project_code = ?').get('A290').total), 1);
    assert.equal(Number(database.prepare('SELECT COUNT(*) AS total FROM material_import_rows WHERE import_id = ?').get(session.import_id).total), 12698);

    database.exec(`CREATE TRIGGER fail_a290_commit BEFORE INSERT ON materials
      WHEN NEW.project_code = 'A290' BEGIN SELECT RAISE(ABORT, 'forced test failure'); END`);
    const originalConsoleError = console.error;
    console.error = () => {};
    let failedCommit;
    try {
      failedCommit = await post(env, token, { action: 'commit', import_id: session.import_id });
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(failedCommit.status, 500);
    assert.equal(Number(database.prepare('SELECT COUNT(*) AS total FROM materials WHERE project_code = ?').get('A290').total), 1);
    assert.equal(database.prepare("SELECT drawing FROM materials WHERE project_code = 'A290'").get().drawing, 'OLD-ROW');
    assert.equal(database.prepare("SELECT source_file FROM projects WHERE code = 'A290'").get().source_file, 'ExistingPL.xlsx');
    assert.equal(Number(database.prepare("SELECT COUNT(*) AS total FROM import_runs WHERE project_code = 'A290'").get().total), 1);
    assert.equal(Number(database.prepare('SELECT COUNT(*) AS total FROM material_import_rows WHERE import_id = ?').get(session.import_id).total), 12698);

    database.exec('DROP TRIGGER fail_a290_commit');
    const committed = await post(env, token, { action: 'commit', import_id: session.import_id });
    const committedBody = await committed.text();
    assert.equal(committed.status, 200, committedBody);
    const result = JSON.parse(committedBody);
    assert.equal(result.imported_rows, 12698);
    assert.equal(Number(database.prepare("SELECT COUNT(*) AS total FROM materials WHERE project_code = 'A290' AND source_file = 'A290PL.xlsx'").get().total), 12698);
    assert.equal(database.prepare("SELECT source_file FROM projects WHERE code = 'A290'").get().source_file, 'A290PL.xlsx');
    assert.equal(Number(database.prepare("SELECT COUNT(*) AS total FROM import_runs WHERE project_code = 'A290'").get().total), 2);
    assert.equal(Number(database.prepare('SELECT COUNT(*) AS total FROM material_import_rows WHERE import_id = ?').get(session.import_id).total), 0);

    database.prepare(`INSERT INTO materials (project_code, source_file, source_sheet, source_row, drawing, status)
      VALUES ('A290', 'SecondPL.xlsx', 'PL-2', 1, 'SECOND-FILE-ROW', 'chưa xác định')`).run();
    const replacement = await post(env, token, {
      action: 'begin', project_code: 'A290', filename: 'A290PL.xlsx', expected_rows: 1,
    });
    const replacementSession = await replacement.json();
    const replacementChunk = await post(env, token, {
      action: 'chunk', import_id: replacementSession.import_id, start_row: 0,
      records: [{ source_sheet:'PL-1', source_row:1, drawing:'REPLACED-ROW', delivery_date:'2026-09-01', issue_dates:'2026-01-01, 2026-03-01', is_main:0, status:'chưa xác định' }],
    });
    assert.equal(replacementChunk.status, 200);
    const replacementCommit = await post(env, token, { action:'commit', import_id:replacementSession.import_id });
    assert.equal(replacementCommit.status, 200, await replacementCommit.text());
    assert.equal(Number(database.prepare("SELECT COUNT(*) AS total FROM materials WHERE project_code = 'A290' AND source_file = 'A290PL.xlsx'").get().total), 1);
    assert.equal(database.prepare("SELECT drawing FROM materials WHERE project_code = 'A290' AND source_file = 'A290PL.xlsx'").get().drawing, 'REPLACED-ROW');
    assert.deepEqual({ ...database.prepare("SELECT delivery_date, issue_dates FROM materials WHERE project_code = 'A290' AND source_file = 'A290PL.xlsx'").get() }, {
      delivery_date:'2026-09-01', issue_dates:'2026-01-01, 2026-03-01',
    });
    assert.equal(database.prepare("SELECT drawing FROM materials WHERE project_code = 'A290' AND source_file = 'SecondPL.xlsx'").get().drawing, 'SECOND-FILE-ROW');

    const materialResponse = await worker.fetch(new Request('https://amecc.test/api/projects/A290/materials', {
      headers:{ authorization:`Bearer ${token}` },
    }), env);
    assert.equal(materialResponse.status, 200);
    const materialPayload = await materialResponse.json();
    const apiRow = materialPayload.rows.find((row) => row.source_file === 'A290PL.xlsx');
    assert.equal(apiRow.delivery_date, '2026-09-01');
    assert.equal(apiRow.issue_dates, '2026-01-01, 2026-03-01');

    const btpBegin = await post(env, token, {
      action:'begin', category:'btp', project_code:'A290', filename:'A290PL.xlsx', expected_rows:1,
    });
    assert.equal(btpBegin.status, 201);
    const btpSession = await btpBegin.json();
    const btpChunk = await post(env, token, {
      action:'chunk', import_id:btpSession.import_id, start_row:0,
      records:[{ source_sheet:'BTP-A290', source_row:27, part_no:'BTP-001', material_type:'Shape', unit:'MCC', size:'L75', length_mm:350, design_quantity:2, received:1, remaining:1, daily_progress:'21/07: 1', joint_check:'✓', status:'Còn thiếu', note:null }],
    });
    assert.equal(btpChunk.status, 200, await btpChunk.text());
    const btpCommit = await post(env, token, { action:'commit', import_id:btpSession.import_id });
    assert.equal(btpCommit.status, 200, await btpCommit.text());
    const storedBtp = database.prepare("SELECT part_no, material_type, unit, size, length_mm, design_quantity, received, remaining, daily_progress, joint_check, status, note FROM btp_materials WHERE project_code = 'A290'").get();
    assert.deepEqual({ ...storedBtp }, { part_no:'BTP-001', material_type:'Shape', unit:'MCC', size:'L75', length_mm:350, design_quantity:2, received:1, remaining:1, daily_progress:'21/07: 1', joint_check:'✓', status:'Còn thiếu', note:null });
    const btpResponse = await worker.fetch(new Request('https://amecc.test/api/projects/A290/btp', {
      headers:{ authorization:`Bearer ${token}` },
    }), env);
    assert.equal(btpResponse.status, 200);
    assert.equal((await btpResponse.json()).rows[0].part_no, 'BTP-001');

    const retryCommit = await post(env, token, { action: 'commit', import_id: session.import_id });
    assert.equal(retryCommit.status, 200);
    assert.equal(Number(database.prepare("SELECT COUNT(*) AS total FROM import_runs WHERE project_code = 'A290'").get().total), 4);
    assert.equal(database.prepare("SELECT category FROM import_runs WHERE source_file = 'A290PL.xlsx' AND imported_rows = 1 ORDER BY rowid DESC").get().category, 'btp');
  } finally {
    database.close();
  }
});

test('project data is public while PL file deletion is restricted to admins and preserves other data', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    for (const migration of [
      'migrations/0001_initial.sql',
      'migrations/0002_material_import_staging.sql',
      'migrations/0003_material_delivery_and_issue_dates.sql',
      'migrations/0004_btp_materials.sql',
    ]) database.exec(readFileSync(migration, 'utf8'));

    database.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)')
      .run('admin-user', 'adminuser', 'unused', 'admin');
    database.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)')
      .run('viewer-user', 'vieweruser', 'unused', 'viewer');
    const adminToken = 'admin-file-delete-test-token';
    const viewerToken = 'viewer-file-delete-test-token';
    for (const [token, userId] of [[adminToken, 'admin-user'], [viewerToken, 'viewer-user']]) {
      database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
        .run(createHash('sha256').update(token).digest('base64'), userId, Math.floor(Date.now() / 1000) + 3600);
    }
    database.prepare('INSERT INTO projects (code, name, source_file) VALUES (?, ?, ?)').run('A290', 'A290', 'A290.xlsx');
    database.prepare(`INSERT INTO materials (project_code, source_file, source_sheet, source_row, drawing, status)
      VALUES ('A290', 'OldPL.xlsx', 'PL', 1, 'OLD', 'old'), ('A290', 'KeepPL.xlsx', 'PL', 2, 'KEEP', 'ok')`).run();
    database.prepare(`INSERT INTO btp_materials (project_code, source_file, source_sheet, source_row, part_no)
      VALUES ('A290', 'OldPL.xlsx', 'BTP-1', 1, 'BTP-OLD'), ('A290', 'KeepPL.xlsx', 'BTP-1', 2, 'BTP-KEEP')`).run();
    database.prepare(`INSERT INTO project_progress (project_code, source_file, source_row, drawing)
      VALUES ('A290', 'A290.xlsx', 1, 'QLDA-KEEP')`).run();
    for (const [id, file, category] of [['old-pl-run', 'OldPL.xlsx', 'materials'], ['old-btp-run', 'OldPL.xlsx', 'btp']]) {
      database.prepare('INSERT INTO import_runs (id, project_code, category, source_file, imported_rows) VALUES (?, ?, ?, ?, 1)')
        .run(id, 'A290', category, file);
    }
    const env = { DB: createD1(database) };

    const projects = await worker.fetch(new Request('https://amecc.test/api/projects'), env);
    assert.equal(projects.status, 200);
    assert.equal((await projects.json()).projects[0].code, 'A290');
    const publicMaterial = await worker.fetch(new Request('https://amecc.test/api/projects/A290/materials'), env);
    assert.equal(publicMaterial.status, 200);
    assert.equal((await publicMaterial.json()).rows.length, 2);
    const publicBtp = await worker.fetch(new Request('https://amecc.test/api/projects/A290/btp'), env);
    assert.equal(publicBtp.status, 200);
    const publicProgress = await worker.fetch(new Request('https://amecc.test/api/projects/A290/progress'), env);
    assert.equal(publicProgress.status, 200);
    assert.equal((await publicProgress.json()).rows[0].drawing, 'QLDA-KEEP');

    const filesWithoutAdmin = await worker.fetch(new Request('https://amecc.test/api/admin/pl-files'), env);
    assert.equal(filesWithoutAdmin.status, 401);
    const importWithoutLogin = await post(env, '', { action: 'begin', project_code: 'A290', filename: 'NewPL.xlsx', expected_rows: 1 });
    assert.equal(importWithoutLogin.status, 401);
    const deleteRequest = (token) => new Request('https://amecc.test/api/admin/pl-files', {
      method: 'DELETE', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ project_code: 'A290', filename: 'OldPL.xlsx' }),
    });
    assert.equal((await worker.fetch(deleteRequest(viewerToken), env)).status, 403);
    assert.equal((await worker.fetch(deleteRequest(''), env)).status, 401);

    const filesResponse = await worker.fetch(new Request('https://amecc.test/api/admin/pl-files', {
      headers: { authorization: `Bearer ${adminToken}` },
    }), env);
    assert.equal(filesResponse.status, 200);
    assert.deepEqual((await filesResponse.json()).files.map(({ source_file, material_rows, btp_rows }) => ({ source_file, material_rows, btp_rows })), [
      { source_file: 'KeepPL.xlsx', material_rows: 1, btp_rows: 1 },
      { source_file: 'OldPL.xlsx', material_rows: 1, btp_rows: 1 },
    ]);

    const deleted = await worker.fetch(deleteRequest(adminToken), env);
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).deleted_rows, 2);
    assert.equal(Number(database.prepare("SELECT COUNT(*) AS total FROM materials WHERE source_file = 'OldPL.xlsx'").get().total), 0);
    assert.equal(Number(database.prepare("SELECT COUNT(*) AS total FROM btp_materials WHERE source_file = 'OldPL.xlsx'").get().total), 0);
    assert.equal(Number(database.prepare("SELECT COUNT(*) AS total FROM import_runs WHERE source_file = 'OldPL.xlsx'").get().total), 0);
    assert.equal(database.prepare("SELECT drawing FROM materials WHERE source_file = 'KeepPL.xlsx'").get().drawing, 'KEEP');
    assert.equal(database.prepare("SELECT part_no FROM btp_materials WHERE source_file = 'KeepPL.xlsx'").get().part_no, 'BTP-KEEP');
    assert.equal(database.prepare('SELECT drawing FROM project_progress').get().drawing, 'QLDA-KEEP');
  } finally {
    database.close();
  }
});