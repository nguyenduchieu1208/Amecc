import Database from 'better-sqlite3';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import worker from '../worker/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bodyLimit = 12 * 1024 * 1024;

class SqliteStatement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new SqliteStatement(this.database, this.sql, values);
  }

  prepared() {
    return this.database.prepare(this.sql);
  }

  first() {
    return this.prepared().get(...this.values) ?? null;
  }

  all() {
    const statement = this.prepared();
    return { results: statement.all(...this.values), success: true, meta: { changes: 0 } };
  }

  run() {
    const result = this.prepared().run(...this.values);
    return {
      success: true,
      meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid || 0) },
    };
  }

  executeInBatch() {
    const statement = this.prepared();
    if (statement.reader) return { results: statement.all(...this.values), success: true, meta: { changes: 0 } };
    const result = statement.run(...this.values);
    return {
      success: true,
      meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid || 0) },
    };
  }
}

export class SqliteD1Adapter {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new SqliteStatement(this.database, sql);
  }

  batch(statements) {
    const execute = this.database.transaction(() => statements.map((statement) => statement.executeInBatch()));
    return execute();
  }
}

function columnsFor(database, table) {
  return new Set(database.prepare(`PRAGMA table_info("${table}")`).all().map((column) => column.name));
}

function hasCurrentSchema(database, includeProjectImportStaging = true) {
  const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  const requiredColumns = {
    projects: ['code', 'name', 'source_file'],
    users: ['id', 'username', 'password_hash', 'role'],
    materials: ['delivery_date', 'issue_dates'],
    material_imports: ['category', 'committed', 'commit_token'],
    material_import_rows: ['delivery_date', 'issue_dates'],
    btp_material_import_rows: ['unit_weight', 'description', 'material', 'total_weight'],
    btp_materials: ['unit_weight', 'description', 'material', 'total_weight'],
    project_progress: ['item', 'receiver', 'record_no'],
    import_runs: ['category', 'imported_rows'],
  };
  if (includeProjectImportStaging) {
    requiredColumns.project_imports = ['expected_rows', 'next_row', 'committed', 'expires_at'];
    requiredColumns.project_progress_import_rows = ['import_id', 'row_index', 'source_row', 'record_no'];
  }
  return Object.entries(requiredColumns).every(([table, columns]) =>
    tables.has(table) && columns.every((column) => columnsFor(database, table).has(column))
  );
}

export function applyMigrations(database, migrationsDirectory = resolve(root, 'migrations')) {
  database.exec(`CREATE TABLE IF NOT EXISTS _amecc_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const migrationFiles = readdirSync(migrationsDirectory).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();

  // A D1 SQL export already has its complete schema but does not include the
  // local migration ledger. Detect that schema and record the matching files.
  if (hasCurrentSchema(database)) {
    const record = database.prepare('INSERT OR IGNORE INTO _amecc_migrations (filename) VALUES (?)');
    const markCurrent = database.transaction(() => {
      for (const filename of migrationFiles) record.run(filename);
    });
    markCurrent();
    return;
  }

  const applied = new Set(database.prepare('SELECT filename FROM _amecc_migrations').all().map((row) => row.filename));
  if (!applied.size && hasCurrentSchema(database, false)) {
    const record = database.prepare('INSERT OR IGNORE INTO _amecc_migrations (filename) VALUES (?)');
    const markPreviousSchema = database.transaction(() => {
      for (const filename of migrationFiles) {
        if (filename !== '0007_project_import_staging.sql') record.run(filename);
      }
    });
    markPreviousSchema();
    for (const filename of migrationFiles) if (filename !== '0007_project_import_staging.sql') applied.add(filename);
  }
  for (const filename of migrationFiles) {
    if (applied.has(filename)) continue;
    const sql = readFileSync(resolve(migrationsDirectory, filename), 'utf8');
    const apply = database.transaction(() => {
      database.exec(sql);
      database.prepare('INSERT INTO _amecc_migrations (filename) VALUES (?)').run(filename);
    });
    apply();
  }
}

function sendJson(response, status, error, origin, allowedOrigin) {
  const headers = { 'content-type': 'application/json; charset=utf-8' };
  if (origin && allowedOrigin.split(',').map((item) => item.trim()).includes(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-credentials'] = 'true';
    headers['vary'] = 'Origin';
  }
  response.writeHead(status, headers);
  response.end(JSON.stringify({ error }));
}

async function toWebRequest(request, baseUrl) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > bodyLimit) throw new RangeError('request body too large');
    chunks.push(chunk);
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (['host', 'connection', 'transfer-encoding', 'content-length'].includes(name.toLowerCase())) continue;
    if (Array.isArray(value)) headers.set(name, value.join(', '));
    else if (value !== undefined) headers.set(name, value);
  }
  const method = request.method || 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(Buffer.concat(chunks));
  return new Request(new URL(request.url || '/', baseUrl), { method, headers, body });
}

export function createApiServer({ database, env = process.env, host = '0.0.0.0', port = Number(env.PORT || 8787) } = {}) {
  if (!database) throw new TypeError('A SQLite database is required.');
  const runtimeEnv = {
    DB: new SqliteD1Adapter(database),
    ALLOWED_ORIGIN: env.ALLOWED_ORIGIN || 'https://nguyenduchieu1208.github.io',
    ADMIN_SETUP_KEY: env.ADMIN_SETUP_KEY || '',
    SESSION_TTL_SECONDS: env.SESSION_TTL_SECONDS || '28800',
    MAX_UPLOAD_BYTES: env.MAX_UPLOAD_BYTES || '10485760',
  };
  const server = createServer(async (request, response) => {
    const baseUrl = `http://${request.headers.host || `127.0.0.1:${port}`}`;
    try {
      const webRequest = await toWebRequest(request, baseUrl);
      const webResponse = await worker.fetch(webRequest, runtimeEnv);
      response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
      if (webResponse.body) Readable.fromWeb(webResponse.body).pipe(response);
      else response.end();
    } catch (error) {
      if (error instanceof RangeError) {
        sendJson(response, 413, 'Yêu cầu vượt quá giới hạn 12 MB.', request.headers.origin || '', runtimeEnv.ALLOWED_ORIGIN);
      } else {
        console.error('API request failed', error);
        sendJson(response, 500, 'Lỗi máy chủ khi xử lý yêu cầu.', request.headers.origin || '', runtimeEnv.ALLOWED_ORIGIN);
      }
    }
  });
  server.listen(port, host);
  return server;
}

export function openApplicationDatabase(databasePath = process.env.DATABASE_PATH || resolve(root, 'data/amecc.sqlite')) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  database.pragma('foreign_keys = ON');
  database.pragma('journal_mode = WAL');
  database.pragma('busy_timeout = 10000');
  applyMigrations(database);
  return database;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const database = openApplicationDatabase();
  const server = createApiServer({ database });
  server.on('listening', () => {
    console.log(`AMECC API listening on port ${process.env.PORT || 8787}`);
    if (!process.env.ADMIN_SETUP_KEY) console.warn('ADMIN_SETUP_KEY is empty; first-admin setup is disabled.');
  });
  const stop = () => server.close(() => {
    database.close();
    process.exit(0);
  });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
