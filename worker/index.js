const encoder = new TextEncoder();
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const SESSION_SECONDS = 8 * 60 * 60;
const MATERIAL_COLUMNS = [
  'project_code', 'source_file', 'source_sheet', 'source_row', 'drawing', 'assembly',
  'description', 'part_no', 'size', 'scope', 'quantity', 'weight', 'received',
  'remaining', 'as_symbol', 'delivery_date', 'issue_dates', 'is_main', 'parent', 'status',
];
const MATERIAL_IMPORT_COLUMNS = MATERIAL_COLUMNS.filter((column) => !['project_code', 'source_file'].includes(column));
const BTP_COLUMNS = [
  'project_code', 'source_file', 'source_sheet', 'source_row', 'part_no', 'material_type', 'description', 'material', 'unit',
  'size', 'length_mm', 'unit_weight', 'total_weight', 'design_quantity', 'received', 'remaining', 'daily_progress', 'joint_check', 'status', 'note',
];
const BTP_IMPORT_COLUMNS = BTP_COLUMNS.filter((column) => !['project_code', 'source_file'].includes(column));
const MATERIAL_CHUNK_SIZE = 500;
const BTP_CHUNK_SIZE = 500;
const MATERIAL_INSERT_ROWS_PER_STATEMENT = Math.floor(96 / (MATERIAL_IMPORT_COLUMNS.length + 2));
const MATERIAL_COMMIT_BATCH_SIZE = 500;
const BTP_COMMIT_BATCH_SIZE = 500;
const MATERIAL_IMPORT_TTL_SECONDS = 60 * 60;
const PROJECT_IMPORT_TTL_SECONDS = 60 * 60;
const PROGRESS_COLUMNS = [
  'project_code', 'source_file', 'source_row', 'item', 'mh', 'wo_date', 'product_type',
  'classification', 'allocation', 'drawing', 'part_no', 'size', 'quantity', 'unit_weight',
  'total_weight', 'profile', 'item_id', 'note', 'fitup_date', 'fitup_qty', 'fitup_weight', 'welding_date',
  'welding_qty', 'welding_weight', 'trial_assembly_date', 'trial_assembly_qty',
  'trial_assembly_weight', 'acceptance_date', 'acceptance_qty', 'acceptance_weight',
  'handover_date', 'handover_qty', 'handover_weight', 'receiver', 'record_no',
];
const MATERIAL_READ_COLUMNS = MATERIAL_COLUMNS.filter((column) => column !== 'project_code').join(', ');
const BTP_READ_COLUMNS = BTP_COLUMNS.filter((column) => column !== 'project_code').join(', ');
const PROGRESS_READ_COLUMNS = PROGRESS_COLUMNS.filter((column) => column !== 'project_code').join(', ');
const QLDA_FIELDS = {
  2: 'project_code', 5: 'item', 6: 'mh', 7: 'wo_date', 8: 'product_type',
  9: 'classification', 10: 'allocation', 11: 'drawing', 12: 'part_no', 13: 'size',
  14: 'quantity', 15: 'unit_weight', 16: 'total_weight', 17: 'profile', 18: 'item_id',
  19: 'note', 36: 'fitup_date', 37: 'fitup_qty', 38: 'fitup_weight',
  39: 'welding_date', 40: 'welding_qty', 41: 'welding_weight', 42: 'trial_assembly_date',
  43: 'trial_assembly_qty', 44: 'trial_assembly_weight', 46: 'acceptance_date',
  47: 'acceptance_qty', 48: 'acceptance_weight', 49: 'handover_date', 50: 'handover_qty',
  51: 'handover_weight', 52: 'receiver', 53: 'record_no',
};
const PROJECT_IMPORT_COLUMNS = PROGRESS_COLUMNS.filter((column) => !['project_code', 'source_file'].includes(column));
const PROJECT_IMPORT_CHUNK_SIZE = 100;
const MATERIAL_FIELDS = {
  2: 'drawing', 3: 'assembly', 4: 'description', 5: 'part_no', 7: 'size', 12: 'quantity',
  14: 'weight', 15: 'scope', 20: 'received', 21: 'remaining',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function workerErrorDetails(error) {
  const detail = String(error?.message || '');
  if (/D1's free tier daily row write limit/i.test(detail)) {
    return {
      status: 429,
      message: 'Cloudflare D1 đã hết hạn mức ghi miễn phí hôm nay. Tạm dừng nhập và xóa dữ liệu; hệ thống sẽ cho phép thử lại sau 00:00 UTC (07:00 giờ Việt Nam/Thái Lan). Dữ liệu đã lưu không bị xóa.',
    };
  }
  if (/D1's free tier daily row read limit/i.test(detail)) {
    return {
      status: 429,
      message: 'Cloudflare D1 đã hết hạn mức đọc miễn phí hôm nay. Hệ thống sẽ cho phép thử lại sau 00:00 UTC (07:00 giờ Việt Nam/Thái Lan). Dữ liệu đã lưu không bị ảnh hưởng.',
    };
  }
  return {
    status: error instanceof HttpError ? error.status : 500,
    message: error instanceof HttpError ? error.message : 'Lỗi máy chủ khi xử lý yêu cầu.',
  };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGIN || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,apikey',
    'vary': 'Origin',
  };
}

function cookieValue(request, key) {
  const pair = (request.headers.get('Cookie') || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${key}=`));
  return pair ? decodeURIComponent(pair.slice(key.length + 1)) : '';
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value) {
  return bytesToBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  // Cloudflare Workers WebCrypto supports up to 100,000 PBKDF2 iterations.
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return bytesToBase64(new Uint8Array(bits));
}

function constantTimeEqual(left, right) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a[i] ^ b[i];
  return result === 0;
}

function safeProjectCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,32}$/.test(code)) throw new HttpError(400, 'Mã dự án không hợp lệ.');
  return code;
}

function projectCodeFromFilename(filename, category) {
  const projectName = category === 'materials'
    ? String(filename).replace(/PL\.xlsx$/i, '')
    : String(filename).replace(/\.xlsx$/i, '');
  return safeProjectCode(projectName);
}

function normalizeValue(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return null;
}

function normalizedRow(raw, mapping) {
  const result = {};
  for (const [column, field] of Object.entries(mapping)) result[field] = normalizeValue(raw[Number(column) - 1]);
  return result;
}

function rowsFromSheet(sheet, xlsx) {
  return xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: true });
}

function validWorkbook(bytes, xlsx) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 100 || bytes.byteLength > MAX_FILE_BYTES) {
    throw new HttpError(400, 'File phải là workbook XLSX hợp lệ và không vượt quá 20 MB.');
  }
  try {
    return xlsx.read(bytes, { type: 'array', cellDates: true, bookVBA: false });
  } catch {
    throw new HttpError(400, 'Không đọc được workbook XLSX.');
  }
}

function parseMaterials(workbook, filename, projectCode, xlsx) {
  const result = [];
  for (const sheetName of workbook.SheetNames) {
    const name = sheetName.toLowerCase();
    if (name === 'cover' || name.startsWith('btp') || name.includes('backup')) continue;
    const sheetRows = rowsFromSheet(workbook.Sheets[sheetName], xlsx);
    let headerIndex = -1;
    let symbolColumn = -1;
    for (let index = 0; index < Math.min(sheetRows.length, 35); index += 1) {
      symbolColumn = sheetRows[index].findIndex((value) => typeof value === 'string' && ['as symbol', 'symbol'].includes(value.trim().toLowerCase()));
      if (symbolColumn !== -1) { headerIndex = index; break; }
    }
    if (headerIndex === -1) continue;
    let parent = null;
    for (let rowIndex = headerIndex + 1; rowIndex < sheetRows.length; rowIndex += 1) {
      const raw = sheetRows[rowIndex];
      const symbol = normalizeValue(raw[symbolColumn]);
      const marker = String(symbol || '').trim().toLowerCase();
      const isMain = ['x', '×', '✓', 'yes', 'true', '1'].includes(marker);
      const fields = normalizedRow(raw, MATERIAL_FIELDS);
      if (![fields.drawing, fields.assembly, fields.part_no, fields.description].some((item) => item !== null && item !== undefined)) continue;
      if (typeof fields.drawing === 'number') continue;
      if (isMain) parent = fields.assembly || fields.drawing || fields.description || 'Cấu kiện chính';
      let status = 'chưa xác định';
      if (typeof fields.quantity === 'number') {
        if (typeof fields.received === 'number') status = fields.received >= fields.quantity ? 'đủ' : (fields.received > 0 ? 'chưa đủ' : 'chưa có');
        else if (typeof fields.remaining === 'number') status = fields.remaining <= 0 ? 'đủ' : (fields.remaining < fields.quantity ? 'chưa đủ' : 'chưa có');
      } else if (isMain) status = 'cấu kiện chính';
      result.push({
        project_code: projectCode, source_file: filename, source_sheet: sheetName, source_row: rowIndex + 1,
        ...fields, as_symbol: symbol, is_main: isMain ? 1 : 0, parent, status,
      });
    }
  }
  if (!result.length) throw new HttpError(400, 'Không tìm thấy sheet PL có tiêu đề AS Symbol hoặc Symbol và dòng dữ liệu hợp lệ.');
  return result;
}

function parseProjectProgress(workbook, filename, projectCode, xlsx) {
  const sheet = workbook.Sheets.Progress;
  if (!sheet) throw new HttpError(400, 'Workbook QLDA cần có sheet Progress.');
  const sourceRows = rowsFromSheet(sheet, xlsx);
  const result = [];
  for (let index = 3; index < sourceRows.length; index += 1) {
    const raw = sourceRows[index];
    if (!raw.slice(0, 53).some((value) => value !== null && value !== undefined && value !== '')) continue;
    const mapped = normalizedRow(raw, QLDA_FIELDS);
    if (![mapped.project_code, mapped.drawing, mapped.part_no, mapped.item].some((value) => value !== null && value !== undefined)) continue;
    const { project_code: _sourceProject, ...safeFields } = mapped;
    result.push({ project_code: projectCode, source_file: filename, source_row: index + 1, ...safeFields });
  }
  if (!result.length) throw new HttpError(400, 'Không tìm thấy dòng QLDA hợp lệ trong sheet Progress.');
  return result;
}

function statementForInsert(db, table, columns, row) {
  const values = columns.map((column) => row[column] ?? null);
  const placeholders = columns.map(() => '?').join(', ');
  return db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`).bind(...values);
}

function validateImportRecords(records, columns, projectCode, filename, category) {
  if (!Array.isArray(records) || records.length === 0 || records.length > 50000) {
    throw new HttpError(400, 'Dữ liệu JSON không hợp lệ hoặc vượt quá 50.000 dòng.');
  }
  return records.map((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new HttpError(400, `Dòng JSON ${index + 1} không hợp lệ.`);
    }
    const row = {};
    for (const column of columns) {
      if (column === 'project_code') row[column] = projectCode;
      else if (column === 'source_file') row[column] = filename;
      else if (column === 'source_row') {
        const sourceRow = Number(record[column]);
        if (!Number.isInteger(sourceRow) || sourceRow < 1) throw new HttpError(400, `Số dòng nguồn không hợp lệ tại dòng JSON ${index + 1}.`);
        row[column] = sourceRow;
      } else if (column === 'source_sheet' && category === 'materials') {
        if (typeof record[column] !== 'string' || !record[column] || record[column].length > 128) {
          throw new HttpError(400, `Tên sheet không hợp lệ tại dòng JSON ${index + 1}.`);
        }
        row[column] = record[column];
      } else if (column === 'is_main') row[column] = record[column] ? 1 : 0;
      else {
        const value = record[column];
        if (value === null || value === undefined || value === '') row[column] = null;
        else if (typeof value === 'string' && value.length <= 10000) row[column] = value;
        else if (typeof value === 'number' && Number.isFinite(value)) row[column] = value;
        else throw new HttpError(400, `Giá trị không hợp lệ cho ${column} tại dòng JSON ${index + 1}.`);
      }
    }
    return row;
  });
}

async function currentUser(request, env) {
  const authorization = request.headers.get('Authorization') || '';
  const bearer = authorization.match(/^Bearer\s+(.+)$/i);
  const token = bearer ? bearer[1] : cookieValue(request, 'amecc_session');
  if (!token) return null;
  const tokenHash = await sha256(token);
  const session = await env.DB.prepare(
    'SELECT users.id, users.username, users.role FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?'
  ).bind(tokenHash, Math.floor(Date.now() / 1000)).first();
  return session || null;
}

async function requireUser(request, env) {
  const user = await currentUser(request, env);
  if (!user) throw new HttpError(401, 'Vui lòng đăng nhập để tiếp tục.');
  return user;
}

async function requireAdmin(request, env) {
  const user = await requireUser(request, env);
  if (user.role !== 'admin') throw new HttpError(403, 'Chỉ admin được phép tải dữ liệu lên.');
  return user;
}

async function requireDriveSync(request, env) {
  const authorization = request.headers.get('Authorization') || '';
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || '';
  if (!env.DRIVE_SYNC_TOKEN || !constantTimeEqual(bearer, env.DRIVE_SYNC_TOKEN)) {
    throw new HttpError(401, 'Token đồng bộ Drive không hợp lệ.');
  }
}

async function login(request, env) {
  const body = await request.json().catch(() => null);
  const username = String(body?.username || '').trim().toLowerCase();
  const password = String(body?.password || '');
  if (!/^[a-z0-9._-]{3,64}$/.test(username) || password.length < 8 || password.length > 256) {
    throw new HttpError(400, 'Tên đăng nhập hoặc mật khẩu không hợp lệ.');
  }
  const user = await env.DB.prepare('SELECT id, username, password_hash, role FROM users WHERE username = ?').bind(username).first();
  if (!user) throw new HttpError(401, 'Sai tên đăng nhập hoặc mật khẩu.');
  const [salt, savedHash] = user.password_hash.split(':');
  const actualHash = await passwordHash(password, salt);
  if (!constantTimeEqual(actualHash, savedHash)) throw new HttpError(401, 'Sai tên đăng nhập hoặc mật khẩu.');
  const token = bytesToBase64(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), user.id, expires).run();
  return json({ token, user: { id: user.id, username: user.username, role: user.role } });
}

async function setupFirstAdmin(request, env) {
  if (!env.ADMIN_SETUP_KEY) throw new HttpError(503, 'Chưa cấu hình khóa khởi tạo admin trên Supabase.');
  const body = await request.json().catch(() => null);
  if (!constantTimeEqual(String(body?.setup_key || ''), env.ADMIN_SETUP_KEY)) {
    throw new HttpError(403, 'Khóa khởi tạo không hợp lệ.');
  }
  const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin'").first();
  if (Number(count?.total || 0) > 0) throw new HttpError(409, 'Admin ban đầu đã được tạo.');
  const username = String(body?.username || '').trim().toLowerCase();
  const password = String(body?.password || '');
  if (!/^[a-z0-9._-]{3,64}$/.test(username) || password.length < 12 || password.length > 256) {
    throw new HttpError(400, 'Tên đăng nhập không hợp lệ hoặc mật khẩu admin ngắn hơn 12 ký tự.');
  }
  const salt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await passwordHash(password, salt);
  await env.DB.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), username, `${salt}:${hash}`, 'admin').run();
  return json({ created: true, username, role: 'admin' }, 201);
}

async function createViewer(request, env) {
  await requireAdmin(request, env);
  const body = await request.json().catch(() => null);
  const username = String(body?.username || '').trim().toLowerCase();
  const password = String(body?.password || '');
  if (!/^[a-z0-9._-]{3,64}$/.test(username) || password.length < 12 || password.length > 256) {
    throw new HttpError(400, 'Tên đăng nhập không hợp lệ hoặc mật khẩu cần ít nhất 12 ký tự.');
  }
  const salt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await passwordHash(password, salt);
  try {
    await env.DB.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)')
      .bind(crypto.randomUUID(), username, `${salt}:${hash}`, 'viewer').run();
  } catch {
    throw new HttpError(409, 'Tên đăng nhập đã tồn tại.');
  }
  return json({ created: true, username, role: 'viewer' }, 201);
}

async function logout(request, env) {
  const bearer = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  const token = bearer ? bearer[1] : cookieValue(request, 'amecc_session');
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return json({ authenticated: false });
}

async function listProjects(env) {
  const { results } = await env.DB.prepare(
    `SELECT p.code, p.name, p.source_file, p.updated_at,
      (SELECT COUNT(*) FROM materials m WHERE m.project_code = p.code) AS material_rows,
      (SELECT COUNT(*) FROM btp_materials b WHERE b.project_code = p.code) AS btp_rows,
      (SELECT COUNT(*) FROM project_progress q WHERE q.project_code = p.code) AS progress_rows
     FROM projects p
     WHERE EXISTS (SELECT 1 FROM materials m WHERE m.project_code = p.code)
        OR EXISTS (SELECT 1 FROM btp_materials b WHERE b.project_code = p.code)
        OR EXISTS (SELECT 1 FROM project_progress q WHERE q.project_code = p.code)
     ORDER BY p.code`
  ).all();
  return results;
}

async function listPlFiles(env) {
  const { results } = await env.DB.prepare(
    `SELECT project_code, source_file,
      SUM(material_rows) AS material_rows, SUM(btp_rows) AS btp_rows,
      MAX(imported_at) AS imported_at
     FROM (
       SELECT project_code, source_file, COUNT(*) AS material_rows, 0 AS btp_rows, MAX(imported_at) AS imported_at
       FROM materials GROUP BY project_code, source_file
       UNION ALL
       SELECT project_code, source_file, 0 AS material_rows, COUNT(*) AS btp_rows, MAX(imported_at) AS imported_at
       FROM btp_materials GROUP BY project_code, source_file
     ) AS file_imports GROUP BY project_code, source_file ORDER BY project_code, source_file`
  ).all();
  return results;
}

function projectSourceFallbackStatement(env, projectCode, filename) {
  return env.DB.prepare(
    `UPDATE projects SET source_file = COALESCE(
      (SELECT source_file FROM project_progress WHERE project_code = ? ORDER BY imported_at DESC, id DESC LIMIT 1),
      (SELECT source_file FROM (
        SELECT source_file, MAX(imported_at) AS imported_at FROM (
          SELECT source_file, imported_at FROM materials WHERE project_code = ?
          UNION ALL
          SELECT source_file, imported_at FROM btp_materials WHERE project_code = ?
        ) AS project_sources GROUP BY source_file
      ) AS latest_sources ORDER BY imported_at DESC, source_file LIMIT 1),
      code || '.xlsx'
    ) WHERE code = ? AND source_file = ? COLLATE NOCASE
      AND NOT EXISTS (SELECT 1 FROM materials WHERE project_code = ? AND source_file = ? COLLATE NOCASE)
      AND NOT EXISTS (SELECT 1 FROM btp_materials WHERE project_code = ? AND source_file = ? COLLATE NOCASE)`
  ).bind(projectCode, projectCode, projectCode, projectCode, filename, projectCode, filename, projectCode, filename);
}

function pruneEmptyProjectStatement(env, projectCode) {
  return env.DB.prepare(
    `DELETE FROM projects WHERE code = ?
      AND NOT EXISTS (SELECT 1 FROM materials WHERE project_code = ?)
      AND NOT EXISTS (SELECT 1 FROM btp_materials WHERE project_code = ?)
      AND NOT EXISTS (SELECT 1 FROM project_progress WHERE project_code = ?)`
  ).bind(projectCode, projectCode, projectCode, projectCode);
}

async function deletePlFile(request, env) {
  await requireAdmin(request, env);
  const body = await request.json().catch(() => null);
  const projectCode = safeProjectCode(body?.project_code);
  const filename = String(body?.filename || '').trim();
  if (!/^[\w.-]{1,255}PL\.xlsx$/i.test(filename)) throw new HttpError(400, 'Tên file PL không hợp lệ.');

  const results = await env.DB.batch([
    env.DB.prepare('DELETE FROM materials WHERE project_code = ? AND source_file = ? COLLATE NOCASE').bind(projectCode, filename),
    env.DB.prepare('DELETE FROM btp_materials WHERE project_code = ? AND source_file = ? COLLATE NOCASE').bind(projectCode, filename),
    env.DB.prepare("DELETE FROM import_runs WHERE project_code = ? AND source_file = ? COLLATE NOCASE AND category IN ('materials', 'btp')").bind(projectCode, filename),
    projectSourceFallbackStatement(env, projectCode, filename),
    pruneEmptyProjectStatement(env, projectCode),
  ]);
  const deletedRows = results.slice(0, 2).reduce((total, result) => total + Number(result.meta?.changes || 0), 0);
  if (!deletedRows) throw new HttpError(404, 'Không tìm thấy file PL/BTP để xóa.');
  return json({ project_code: projectCode, source_file: filename, deleted_rows: deletedRows });
}

async function importWorkbook(request, env, category) {
  await requireAdmin(request, env);
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  const maxBytes = Math.min(Number(env.MAX_UPLOAD_BYTES || MAX_FILE_BYTES), MAX_FILE_BYTES);
  if (contentLength > maxBytes) throw new HttpError(413, 'File vượt quá giới hạn 20 MB.');
  const contentType = request.headers.get('Content-Type') || '';
  if (category === 'projects' && contentType.toLowerCase().includes('application/json')) {
    return importProjectRows(request, env);
  }
  if (category === 'projects') throw new HttpError(415, 'QLDA cần được đọc trong trình duyệt; hãy tải lại trang quản trị rồi thử lại.');
  let projectCode;
  let filename;
  let records;
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'Vui lòng chọn file Excel.');
  filename = file.name;
  if (!/^[\w.-]+\.xlsx$/i.test(filename) || file.size > maxBytes || file.size === 0) {
    throw new HttpError(400, 'Chỉ nhận workbook .xlsx hợp lệ, dung lượng tối đa 20 MB.');
  }
  projectCode = projectCodeFromFilename(filename, category);
  const xlsxPackage = 'xlsx';
  const xlsx = env.XLSX || await import(xlsxPackage);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const workbook = validWorkbook(bytes, xlsx);
  records = parseProjectProgress(workbook, filename, projectCode, xlsx);
  const table = 'project_progress';
  const columns = PROGRESS_COLUMNS;
  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  const batchSize = 80;
  const prepareProjectAndClear = [
    env.DB.prepare(
      `INSERT INTO projects (code, name, source_file, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET source_file = excluded.source_file, updated_at = excluded.updated_at`
    ).bind(projectCode, projectCode, filename, now),
    env.DB.prepare(`DELETE FROM ${table} WHERE project_code = ?`).bind(projectCode),
  ];
  const batches = [];
  for (let index = 0; index < records.length; index += batchSize) {
    batches.push(records.slice(index, index + batchSize).map((row) => statementForInsert(env.DB, table, columns, row)));
  }
  await env.DB.batch(prepareProjectAndClear);
  for (const batch of batches) await env.DB.batch(batch);
  await env.DB.prepare('INSERT INTO import_runs (id, project_code, category, source_file, imported_rows) VALUES (?, ?, ?, ?, ?)')
    .bind(runId, projectCode, category, filename, records.length).run();
  return json({ project_code: projectCode, category, source_file: filename, imported_rows: records.length });
}

async function importProjectRows(request, env) {
  if (encoder.encode(await request.clone().text()).byteLength > 1024 * 1024) {
    throw new HttpError(413, 'Mỗi phần nhập QLDA không được vượt quá 1 MB.');
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'JSON không hợp lệ.');

  if (body.action === 'begin') {
    const filename = String(body.filename || '');
    const projectCode = safeProjectCode(body.project_code);
    const expectedRows = Number(body.expected_rows);
    if (!/^[\w.-]{1,255}\.xlsx$/i.test(filename)) throw new HttpError(400, 'Tên file QLDA không hợp lệ.');
    if (projectCode !== projectCodeFromFilename(filename, 'projects')) {
      throw new HttpError(400, 'Mã dự án phải khớp với tên file QLDA.');
    }
    if (!Number.isInteger(expectedRows) || expectedRows < 1 || expectedRows > 50000) {
      throw new HttpError(400, 'Số dòng QLDA nhập phải từ 1 đến 50.000.');
    }
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + PROJECT_IMPORT_TTL_SECONDS;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM project_progress_import_rows WHERE import_id IN (SELECT id FROM project_imports WHERE expires_at <= ?)').bind(now),
      env.DB.prepare('DELETE FROM project_imports WHERE expires_at <= ?').bind(now),
      env.DB.prepare('INSERT INTO project_imports (id, project_code, source_file, expected_rows, next_row, expires_at) VALUES (?, ?, ?, ?, 0, ?)')
        .bind(id, projectCode, filename, expectedRows, expiresAt),
    ]);
    return json({ import_id: id, chunk_size: PROJECT_IMPORT_CHUNK_SIZE, expected_rows: expectedRows, expires_at: expiresAt }, 201);
  }

  const importId = String(body.import_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(importId)) throw new HttpError(400, 'Mã phiên nhập QLDA không hợp lệ.');
  const manifest = await env.DB.prepare('SELECT * FROM project_imports WHERE id = ? AND expires_at > ?')
    .bind(importId, Math.floor(Date.now() / 1000)).first();
  if (!manifest) throw new HttpError(404, 'Phiên nhập QLDA không tồn tại hoặc đã hết hạn; hãy chọn lại file.');
  if (Number(manifest.committed) === 2) {
    if (body.action === 'commit') return json({ project_code: manifest.project_code, source_file: manifest.source_file, imported_rows: Number(manifest.expected_rows) });
    throw new HttpError(409, 'Phiên nhập QLDA đã được hoàn tất.');
  }
  if (Number(manifest.committed) === 1 && body.action !== 'commit') {
    throw new HttpError(409, 'Phiên nhập QLDA đang hoàn tất; hãy gửi lại thao tác commit.');
  }

  if (body.action === 'chunk') {
    const startRow = Number(body.start_row);
    if (!Number.isInteger(startRow) || startRow < 0 || startRow !== Number(manifest.next_row)) {
      throw new HttpError(409, `Thứ tự phần QLDA không hợp lệ; dòng tiếp theo là ${manifest.next_row}.`);
    }
    if (!Array.isArray(body.records) || body.records.length < 1 || body.records.length > PROJECT_IMPORT_CHUNK_SIZE
      || startRow + body.records.length > Number(manifest.expected_rows)) {
      throw new HttpError(400, `Mỗi phần QLDA phải có từ 1 đến ${PROJECT_IMPORT_CHUNK_SIZE} dòng và không vượt tổng số dòng.`);
    }
    const records = validateImportRecords(body.records, PROJECT_IMPORT_COLUMNS, manifest.project_code, manifest.source_file, 'projects');
    const nextRow = startRow + records.length;
    const stagingColumns = ['import_id', 'row_index', ...PROJECT_IMPORT_COLUMNS];
    const maxRowsPerInsert = Math.max(1, Math.floor(96 / stagingColumns.length));
    const statements = [];
    for (let offset = 0; offset < records.length; offset += maxRowsPerInsert) {
      const group = records.slice(offset, offset + maxRowsPerInsert);
      const values = group.flatMap((row, index) => [importId, startRow + offset + index, ...PROJECT_IMPORT_COLUMNS.map((column) => row[column] ?? null)]);
      const rowSelects = group.map(() => `SELECT ${stagingColumns.map(() => '?').join(', ')}`).join(' UNION ALL ');
      statements.push(env.DB.prepare(`INSERT INTO project_progress_import_rows (${stagingColumns.join(', ')}) SELECT * FROM (${rowSelects}) AS incoming_rows`).bind(...values));
    }
    statements.push(env.DB.prepare('UPDATE project_imports SET next_row = ? WHERE id = ? AND next_row = ? AND committed = 0')
      .bind(nextRow, importId, startRow));
    const results = await env.DB.batch(statements);
    if (Number(results.at(-1)?.meta?.changes || 0) !== 1) {
      throw new HttpError(409, 'Phần QLDA đã được xử lý hoặc phiên nhập đang hoàn tất.');
    }
    return json({ import_id: importId, received_rows: nextRow });
  }

  if (body.action === 'commit') {
    if (Number(manifest.next_row) !== Number(manifest.expected_rows)) {
      throw new HttpError(409, `Còn thiếu dữ liệu QLDA: đã nhận ${manifest.next_row}/${manifest.expected_rows} dòng.`);
    }
    const rowCount = await env.DB.prepare('SELECT COUNT(*) AS total FROM project_progress_import_rows WHERE import_id = ?').bind(importId).first();
    if (Number(rowCount?.total) !== Number(manifest.expected_rows)) {
      throw new HttpError(409, 'Số dòng QLDA tạm không khớp; dữ liệu hiện hành chưa bị thay thế. Hãy tải lại file.');
    }
    const now = new Date().toISOString();
    const runId = crypto.randomUUID();
    const sourceColumns = PROJECT_IMPORT_COLUMNS.join(', ');
    const statements = [
      env.DB.prepare('UPDATE project_imports SET committed = 1, commit_token = ? WHERE id = ? AND committed = 0 AND next_row = ? AND (SELECT COUNT(*) FROM project_progress_import_rows WHERE import_id = ?) = ?')
        .bind(runId, importId, manifest.expected_rows, importId, manifest.expected_rows),
      env.DB.prepare(`INSERT INTO projects (code, name, source_file, updated_at)
        SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM project_imports WHERE id = ? AND committed = 1 AND commit_token = ?)
        ON CONFLICT(code) DO UPDATE SET source_file = excluded.source_file, updated_at = excluded.updated_at`)
        .bind(manifest.project_code, manifest.project_code, manifest.source_file, now, importId, runId),
      env.DB.prepare('DELETE FROM project_progress WHERE project_code = ? AND EXISTS (SELECT 1 FROM project_imports WHERE id = ? AND committed = 1 AND commit_token = ?)')
        .bind(manifest.project_code, importId, runId),
      env.DB.prepare(`INSERT INTO project_progress (${PROGRESS_COLUMNS.join(', ')})
        SELECT ?, ?, source_row, ${sourceColumns} FROM project_progress_import_rows
        WHERE import_id = ? AND EXISTS (SELECT 1 FROM project_imports WHERE id = ? AND committed = 1 AND commit_token = ?) ORDER BY row_index`)
        .bind(manifest.project_code, manifest.source_file, importId, importId, runId),
      env.DB.prepare('INSERT INTO import_runs (id, project_code, category, source_file, imported_rows) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM project_imports WHERE id = ? AND committed = 1 AND commit_token = ?)')
        .bind(runId, manifest.project_code, 'projects', manifest.source_file, manifest.expected_rows, importId, runId),
      env.DB.prepare('UPDATE project_imports SET committed = 2 WHERE id = ? AND committed = 1 AND commit_token = ?').bind(importId, runId),
      env.DB.prepare('DELETE FROM project_progress_import_rows WHERE import_id = ? AND EXISTS (SELECT 1 FROM project_imports WHERE id = ? AND committed = 2 AND commit_token = ?)')
        .bind(importId, importId, runId),
    ];
    const results = await env.DB.batch(statements);
    if (Number(results[0]?.meta?.changes || 0) !== 1) {
      throw new HttpError(409, 'Phiên nhập QLDA đã thay đổi hoặc không đầy đủ; dữ liệu hiện hành chưa bị thay thế.');
    }
    return json({ project_code: manifest.project_code, source_file: manifest.source_file, imported_rows: Number(manifest.expected_rows) });
  }

  if (body.action === 'abort') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM project_progress_import_rows WHERE import_id = ?').bind(importId),
      env.DB.prepare('DELETE FROM project_imports WHERE id = ?').bind(importId),
    ]);
    return json({ aborted: true, import_id: importId });
  }
  throw new HttpError(400, 'Thao tác nhập QLDA không hợp lệ.');
}

async function importMaterials(request, env) {
  try { await requireDriveSync(request, env); }
  catch (error) {
    if (!(error instanceof HttpError) || error.status !== 401) throw error;
    await requireAdmin(request, env);
  }
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > 1024 * 1024) throw new HttpError(413, 'Mỗi phần nhập PL không được vượt quá 1 MB.');
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'JSON không hợp lệ.');
  if (encoder.encode(JSON.stringify(body)).byteLength > 1024 * 1024) {
    throw new HttpError(413, 'Mỗi phần nhập PL không được vượt quá 1 MB.');
  }

  if (body.action === 'begin') {
    const filename = String(body.filename || '');
    const category = body.category === 'btp' ? 'btp' : 'materials';
    const projectCode = safeProjectCode(body.project_code);
    const expectedRows = Number(body.expected_rows);
    if (!/^[\w.-]{1,255}PL\.xlsx$/i.test(filename)) {
      throw new HttpError(400, 'Tên file vật tư phải kết thúc bằng PL.xlsx, ví dụ A290PL.xlsx.');
    }
    if (projectCode !== projectCodeFromFilename(filename, 'materials')) {
      throw new HttpError(400, 'Mã dự án phải khớp với phần tên file đứng trước PL.xlsx.');
    }
    if (!Number.isInteger(expectedRows) || expectedRows < 1 || expectedRows > 50000) {
      throw new HttpError(400, 'Số dòng nhập phải từ 1 đến 50.000.');
    }
    const id = crypto.randomUUID();
    const expiresAt = Math.floor(Date.now() / 1000) + MATERIAL_IMPORT_TTL_SECONDS;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM material_import_rows WHERE import_id IN (SELECT id FROM material_imports WHERE expires_at <= ? AND category = ?)').bind(Math.floor(Date.now() / 1000), 'materials'),
      env.DB.prepare('DELETE FROM btp_material_import_rows WHERE import_id IN (SELECT id FROM material_imports WHERE expires_at <= ? AND category = ?)').bind(Math.floor(Date.now() / 1000), 'btp'),
      env.DB.prepare('DELETE FROM material_imports WHERE expires_at <= ?').bind(Math.floor(Date.now() / 1000)),
      env.DB.prepare('INSERT INTO material_imports (id, project_code, source_file, expected_rows, next_row, expires_at, category) VALUES (?, ?, ?, ?, 0, ?, ?)')
        .bind(id, projectCode, filename, expectedRows, expiresAt, category),
    ]);
    const chunkSize = Number(env.DB.materialImportChunkSize || (category === 'btp' ? BTP_CHUNK_SIZE : MATERIAL_CHUNK_SIZE));
    return json({ import_id: id, chunk_size: chunkSize, expected_rows: expectedRows, expires_at: expiresAt }, 201);
  }

  if (body.action === 'clear-category') {
    const category = body.category === 'btp' ? 'btp' : 'materials';
    const projectCode = safeProjectCode(body.project_code);
    const filename = String(body.filename || '');
    if (!/^[\w.-]{1,255}PL\.xlsx$/i.test(filename)) {
      throw new HttpError(400, 'Tên file vật tư phải kết thúc bằng PL.xlsx, ví dụ M304PL.xlsx.');
    }
    if (projectCode !== projectCodeFromFilename(filename, 'materials')) {
      throw new HttpError(400, 'Mã dự án phải khớp với phần tên file đứng trước PL.xlsx.');
    }
    const table = category === 'btp' ? 'btp_materials' : 'materials';
    const results = await env.DB.batch([
      env.DB.prepare(`DELETE FROM ${table} WHERE project_code = ? AND source_file = ? COLLATE NOCASE`).bind(projectCode, filename),
      env.DB.prepare('DELETE FROM import_runs WHERE project_code = ? AND source_file = ? COLLATE NOCASE AND category = ?').bind(projectCode, filename, category),
      projectSourceFallbackStatement(env, projectCode, filename),
      pruneEmptyProjectStatement(env, projectCode),
    ]);
    return json({ project_code: projectCode, category, source_file: filename, deleted_rows: Number(results[0]?.meta?.changes || 0), cleared: true });
  }

  const importId = String(body.import_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(importId)) throw new HttpError(400, 'Mã phiên nhập không hợp lệ.');
  const manifest = await env.DB.prepare('SELECT * FROM material_imports WHERE id = ? AND expires_at > ?')
    .bind(importId, Math.floor(Date.now() / 1000)).first();
  if (!manifest) throw new HttpError(404, 'Phiên nhập không tồn tại hoặc đã hết hạn; hãy tải lại file.');
  if (Number(manifest.committed) === 2) {
    if (body.action === 'commit') {
      return json({ project_code: manifest.project_code, category: manifest.category || 'materials', source_file: manifest.source_file, imported_rows: Number(manifest.expected_rows) });
    }
    throw new HttpError(409, 'Phiên nhập đã được hoàn tất.');
  }
  if (Number(manifest.committed) === 1 && body.action !== 'commit') {
    throw new HttpError(409, 'Phiên nhập đang hoàn tất; hãy gửi lại thao tác commit.');
  }

  if (body.action === 'chunk') {
    const startRow = Number(body.start_row);
    if (!Number.isInteger(startRow) || startRow < 0 || startRow !== Number(manifest.next_row)) {
      throw new HttpError(409, `Thứ tự phần nhập không hợp lệ; dòng tiếp theo là ${manifest.next_row}.`);
    }
    const isBtp = manifest.category === 'btp';
    const importColumns = isBtp ? BTP_IMPORT_COLUMNS : MATERIAL_IMPORT_COLUMNS;
    const chunkSize = Number(env.DB.materialImportChunkSize || (isBtp ? BTP_CHUNK_SIZE : MATERIAL_CHUNK_SIZE));
    if (!Array.isArray(body.records) || body.records.length < 1 || body.records.length > chunkSize
      || startRow + body.records.length > Number(manifest.expected_rows)) {
      throw new HttpError(400, `Mỗi phần phải có từ 1 đến ${chunkSize} dòng và không vượt tổng số dòng.`);
    }
    const records = validateImportRecords(body.records, importColumns, manifest.project_code, manifest.source_file, isBtp ? 'btp' : 'materials');
    const nextRow = startRow + records.length;
    const statements = [];
    const stagingColumns = ['import_id', 'row_index', ...importColumns];
    const maxRowsPerInsert = Math.max(1, Math.floor(Number(env.DB.maxBindParameters || 96) / stagingColumns.length));
    const stagingTable = isBtp ? 'btp_material_import_rows' : 'material_import_rows';
    for (let offset = 0; offset < records.length; offset += maxRowsPerInsert) {
      const group = records.slice(offset, offset + maxRowsPerInsert);
      const values = group.flatMap((row, index) => [
        importId,
        startRow + offset + index,
        ...importColumns.map((column) => row[column] ?? null),
      ]);
      const valueGroups = group.map(() => `(${stagingColumns.map(() => '?').join(', ')})`).join(', ');
      statements.push(env.DB.prepare(`INSERT INTO ${stagingTable} (${stagingColumns.join(', ')}) VALUES ${valueGroups}`)
        .bind(...values));
    }
    statements.push(env.DB.prepare('UPDATE material_imports SET next_row = ? WHERE id = ? AND next_row = ? AND committed = 0')
      .bind(nextRow, importId, startRow));
    const results = await env.DB.batch(statements);
    if (Number(results.at(-1)?.meta?.changes || 0) !== 1) {
      throw new HttpError(409, 'Phần nhập đã được xử lý hoặc phiên nhập đang hoàn tất.');
    }
    return json({ import_id: importId, received_rows: nextRow });
  }

  if (body.action === 'commit') {
    if (Number(manifest.next_row) !== Number(manifest.expected_rows)) {
      throw new HttpError(409, `Còn thiếu dữ liệu: đã nhận ${manifest.next_row}/${manifest.expected_rows} dòng.`);
    }
    const isBtp = manifest.category === 'btp';
    const stagingTable = isBtp ? 'btp_material_import_rows' : 'material_import_rows';
    const rowCount = await env.DB.prepare(`SELECT COUNT(*) AS total FROM ${stagingTable} WHERE import_id = ?`).bind(importId).first();
    if (Number(rowCount?.total) !== Number(manifest.expected_rows)) {
      throw new HttpError(409, 'Số dòng staging không khớp; dữ liệu PL hiện hành chưa bị thay đổi. Hãy tải lại file.');
    }

    const now = new Date().toISOString();
    const runId = crypto.randomUUID();
    const insertColumns = MATERIAL_COLUMNS.join(', ');
    const statements = [
      env.DB.prepare(`UPDATE material_imports SET committed = 1, commit_token = ? WHERE id = ? AND committed = 0 AND next_row = ? AND (SELECT COUNT(*) FROM ${stagingTable} WHERE import_id = ?) = ?`)
        .bind(runId, importId, manifest.expected_rows, importId, manifest.expected_rows),
      env.DB.prepare(
        `INSERT INTO projects (code, name, source_file, updated_at)
         SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM material_imports WHERE id = ? AND committed = 1 AND commit_token = ?)
         ON CONFLICT(code) DO UPDATE SET source_file = excluded.source_file, updated_at = excluded.updated_at`
      ).bind(manifest.project_code, manifest.project_code, manifest.source_file, now, importId, runId),
      isBtp
        ? env.DB.prepare('DELETE FROM btp_materials WHERE project_code = ? AND EXISTS (SELECT 1 FROM material_imports WHERE id = ? AND committed = 1 AND commit_token = ?) AND source_file = ? COLLATE NOCASE')
          .bind(manifest.project_code, importId, runId, manifest.source_file)
        : env.DB.prepare('DELETE FROM materials WHERE project_code = ? AND EXISTS (SELECT 1 FROM material_imports WHERE id = ? AND committed = 1 AND commit_token = ?) AND source_file = ? COLLATE NOCASE')
          .bind(manifest.project_code, importId, runId, manifest.source_file),
      env.DB.prepare('DELETE FROM import_runs WHERE project_code = ? AND source_file = ? COLLATE NOCASE AND category = ? AND EXISTS (SELECT 1 FROM material_imports WHERE id = ? AND committed = 1 AND commit_token = ?)')
        .bind(manifest.project_code, manifest.source_file, isBtp ? 'btp' : 'materials', importId, runId),
    ];
    const commitBatchSize = Number(env.DB.materialCommitBatchSize || (isBtp ? BTP_COMMIT_BATCH_SIZE : MATERIAL_COMMIT_BATCH_SIZE));
    for (let startRow = 0; startRow < Number(manifest.expected_rows); startRow += commitBatchSize) {
      statements.push(isBtp ? env.DB.prepare(
        `INSERT INTO btp_materials (${BTP_COLUMNS.join(', ')}) SELECT ?, ?, source_sheet, source_row, part_no, material_type, description, material, unit, size, length_mm, unit_weight, total_weight, design_quantity, received, remaining, daily_progress, joint_check, status, note FROM btp_material_import_rows
         WHERE import_id = ? AND row_index >= ? AND row_index < ?
           AND EXISTS (SELECT 1 FROM material_imports WHERE id = ? AND committed = 1 AND commit_token = ?) ORDER BY row_index`
      ).bind(manifest.project_code, manifest.source_file, importId, startRow,
        Math.min(startRow + commitBatchSize, Number(manifest.expected_rows)), importId, runId) : env.DB.prepare(
        `INSERT INTO materials (${insertColumns}) SELECT ?, ?, source_sheet, source_row, drawing, assembly, description, part_no, size, scope, quantity, weight, received, remaining, as_symbol, delivery_date, issue_dates, is_main, parent, status FROM material_import_rows
         WHERE import_id = ? AND row_index >= ? AND row_index < ?
           AND EXISTS (SELECT 1 FROM material_imports WHERE id = ? AND committed = 1 AND commit_token = ?) ORDER BY row_index`
      ).bind(manifest.project_code, manifest.source_file, importId, startRow,
        Math.min(startRow + commitBatchSize, Number(manifest.expected_rows)), importId, runId));
    }
    statements.push(
      env.DB.prepare('INSERT INTO import_runs (id, project_code, category, source_file, imported_rows) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM material_imports WHERE id = ? AND committed = 1 AND commit_token = ?)')
        .bind(runId, manifest.project_code, isBtp ? 'btp' : 'materials', manifest.source_file, manifest.expected_rows, importId, runId),
      env.DB.prepare('UPDATE material_imports SET committed = 2 WHERE id = ? AND committed = 1 AND commit_token = ?').bind(importId, runId),
      env.DB.prepare(`DELETE FROM ${stagingTable} WHERE import_id = ? AND EXISTS (SELECT 1 FROM material_imports WHERE id = ? AND committed = 2 AND commit_token = ?)`).bind(importId, importId, runId),
    );
    const results = await env.DB.batch(statements);
    if (Number(results[0]?.meta?.changes || 0) !== 1) {
      throw new HttpError(409, 'Phiên nhập đã thay đổi hoặc không đầy đủ; dữ liệu PL hiện hành chưa bị thay thế.');
    }
    return json({ project_code: manifest.project_code, category: isBtp ? 'btp' : 'materials', source_file: manifest.source_file, imported_rows: Number(manifest.expected_rows) });
  }

  if (body.action === 'abort') {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM ${manifest.category === 'btp' ? 'btp_material_import_rows' : 'material_import_rows'} WHERE import_id = ?`).bind(importId),
      env.DB.prepare('DELETE FROM material_imports WHERE id = ?').bind(importId),
    ]);
    return json({ aborted: true, import_id: importId });
  }

  throw new HttpError(400, 'Thao tác nhập PL không hợp lệ.');
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method === 'GET' && path === '/api/health') return json({ ok: true, service: 'amecc-api' });
  if (request.method === 'GET' && path !== '/' && !path.startsWith('/api/') && env.ASSETS) {
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) return asset;
    return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
  }
  if (request.method === 'POST' && path === '/api/auth/setup') return setupFirstAdmin(request, env);
  if (request.method === 'POST' && path === '/api/auth/login') return login(request, env);
  if (request.method === 'POST' && path === '/api/auth/logout') return logout(request, env);
  if (request.method === 'GET' && path === '/api/auth/me') {
    const user = await currentUser(request, env);
    return json({ user: user ? { id: user.id, username: user.username, role: user.role } : null });
  }
  if (request.method === 'GET' && path === '/api/admin/drive-sync/health') {
    await requireDriveSync(request, env);
    return json({ ok: true, scope: 'pl-btp-import' });
  }
  if (request.method === 'GET' && path === '/api/projects') {
    return json({ projects: await listProjects(env) });
  }
  if (request.method === 'GET' && path === '/api/admin/pl-files') {
    await requireAdmin(request, env);
    return json({ files: await listPlFiles(env) });
  }
  if (request.method === 'DELETE' && path === '/api/admin/pl-files') return deletePlFile(request, env);
  if (request.method === 'POST' && path === '/api/admin/users') return createViewer(request, env);
  if (request.method === 'POST' && path === '/api/admin/import/materials') return importMaterials(request, env);
  if (request.method === 'POST' && path === '/api/admin/import/projects') return importWorkbook(request, env, 'projects');
  const materialMatch = path.match(/^\/api\/projects\/([A-Za-z0-9_-]{2,32})\/materials$/);
  if (request.method === 'GET' && materialMatch) {
    const projectCode = safeProjectCode(materialMatch[1]);
    const { results } = await env.DB.prepare(`SELECT ${MATERIAL_READ_COLUMNS} FROM materials WHERE project_code = ? ORDER BY source_file, source_sheet, source_row`).bind(projectCode).all();
    return json({ project_code: projectCode, rows: results });
  }
  const btpMatch = path.match(/^\/api\/projects\/([A-Za-z0-9_-]{2,32})\/btp$/);
  if (request.method === 'GET' && btpMatch) {
    const projectCode = safeProjectCode(btpMatch[1]);
    const { results } = await env.DB.prepare(`SELECT ${BTP_READ_COLUMNS} FROM btp_materials WHERE project_code = ? ORDER BY source_file, source_sheet, source_row`).bind(projectCode).all();
    return json({ project_code: projectCode, rows: results });
  }
  const progressMatch = path.match(/^\/api\/projects\/([A-Za-z0-9_-]{2,32})\/progress$/);
  if (request.method === 'GET' && progressMatch) {
    const projectCode = safeProjectCode(progressMatch[1]);
    const { results } = await env.DB.prepare(`SELECT ${PROGRESS_READ_COLUMNS} FROM project_progress WHERE project_code = ? ORDER BY source_file, source_row`).bind(projectCode).all();
    return json({ project_code: projectCode, rows: results });
  }
  throw new HttpError(404, 'Không tìm thấy API.');
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    try {
      const response = await route(request, env);
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(cors)) headers.set(key, value);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      const { status, message } = workerErrorDetails(error);
      if (status === 500 || status === 429) console.error('Worker request failed', error);
      return json({ error: message }, status, cors);
    }
  },
};

export const __test__ = { safeProjectCode, normalizedRow, parseProjectProgress, parseMaterials, validWorkbook, validateImportRecords, workerErrorDetails, QLDA_FIELDS, MATERIAL_FIELDS, MATERIAL_IMPORT_COLUMNS, BTP_IMPORT_COLUMNS, MATERIAL_CHUNK_SIZE, MATERIAL_INSERT_ROWS_PER_STATEMENT, MATERIAL_COMMIT_BATCH_SIZE };
