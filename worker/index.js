const encoder = new TextEncoder();
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const SESSION_SECONDS = 8 * 60 * 60;
const MATERIAL_COLUMNS = [
  'project_code', 'source_file', 'source_sheet', 'source_row', 'drawing', 'assembly',
  'description', 'part_no', 'size', 'scope', 'quantity', 'weight', 'received',
  'remaining', 'as_symbol', 'is_main', 'parent', 'status',
];
const PROGRESS_COLUMNS = [
  'project_code', 'source_file', 'source_row', 'item', 'mh', 'wo_date', 'product_type',
  'classification', 'allocation', 'drawing', 'part_no', 'size', 'quantity', 'unit_weight',
  'total_weight', 'profile', 'item_id', 'note', 'fitup_date', 'fitup_qty', 'fitup_weight', 'welding_date',
  'welding_qty', 'welding_weight', 'trial_assembly_date', 'trial_assembly_qty',
  'trial_assembly_weight', 'acceptance_date', 'acceptance_qty', 'acceptance_weight',
  'handover_date', 'handover_qty', 'handover_weight', 'receiver', 'record_no',
];
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
const MATERIAL_FIELDS = {
  2: 'drawing', 3: 'assembly', 4: 'description', 5: 'part_no', 7: 'size', 12: 'quantity',
  14: 'weight', 15: 'scope', 20: 'received', 21: 'remaining',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
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
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
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
    throw new HttpError(400, 'File phải là workbook XLSX hợp lệ và không vượt quá 10 MB.');
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
  if (!env.ADMIN_SETUP_KEY) throw new HttpError(503, 'Chưa cấu hình khóa khởi tạo admin trên Cloudflare.');
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
    `SELECT p.code, p.name, p.updated_at,
      (SELECT COUNT(*) FROM materials m WHERE m.project_code = p.code) AS material_rows,
      (SELECT COUNT(*) FROM project_progress q WHERE q.project_code = p.code) AS progress_rows
     FROM projects p ORDER BY p.code`
  ).all();
  return results;
}

async function importWorkbook(request, env, category) {
  await requireAdmin(request, env);
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  const maxBytes = Math.min(Number(env.MAX_UPLOAD_BYTES || MAX_FILE_BYTES), MAX_FILE_BYTES);
  if (contentLength > maxBytes) throw new HttpError(413, 'File vượt quá giới hạn 10 MB.');
  const form = await request.formData();
  const file = form.get('file');
  const projectCode = safeProjectCode(form.get('project_code'));
  if (!(file instanceof File)) throw new HttpError(400, 'Vui lòng chọn file Excel.');
  const filename = file.name;
  if (!/^[\w.-]+\.xlsx$/i.test(filename) || file.size > maxBytes || file.size === 0) {
    throw new HttpError(400, 'Chỉ nhận workbook .xlsx hợp lệ, dung lượng tối đa 10 MB.');
  }
  if (category === 'materials' && !/PL\.xlsx$/i.test(filename)) {
    throw new HttpError(400, 'Tên file vật tư phải kết thúc bằng PL.xlsx, ví dụ A290PL.xlsx.');
  }
  const xlsx = await import('xlsx');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const workbook = validWorkbook(bytes, xlsx);
  const records = category === 'materials'
    ? parseMaterials(workbook, filename, projectCode, xlsx)
    : parseProjectProgress(workbook, filename, projectCode, xlsx);
  const table = category === 'materials' ? 'materials' : 'project_progress';
  const columns = category === 'materials' ? MATERIAL_COLUMNS : PROGRESS_COLUMNS;
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
  if (request.method === 'GET' && path === '/api/projects') {
    await requireUser(request, env);
    return json({ projects: await listProjects(env) });
  }
  if (request.method === 'POST' && path === '/api/admin/users') return createViewer(request, env);
  if (request.method === 'POST' && path === '/api/admin/import/materials') return importWorkbook(request, env, 'materials');
  if (request.method === 'POST' && path === '/api/admin/import/projects') return importWorkbook(request, env, 'projects');
  const materialMatch = path.match(/^\/api\/projects\/([A-Za-z0-9_-]{2,32})\/materials$/);
  if (request.method === 'GET' && materialMatch) {
    await requireUser(request, env);
    const projectCode = safeProjectCode(materialMatch[1]);
    const { results } = await env.DB.prepare('SELECT * FROM materials WHERE project_code = ? ORDER BY source_file, source_sheet, source_row').bind(projectCode).all();
    return json({ project_code: projectCode, rows: results });
  }
  const progressMatch = path.match(/^\/api\/projects\/([A-Za-z0-9_-]{2,32})\/progress$/);
  if (request.method === 'GET' && progressMatch) {
    await requireUser(request, env);
    const projectCode = safeProjectCode(progressMatch[1]);
    const { results } = await env.DB.prepare('SELECT * FROM project_progress WHERE project_code = ? ORDER BY source_file, source_row').bind(projectCode).all();
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
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : 'Lỗi máy chủ khi xử lý yêu cầu.';
      if (status === 500) console.error('Worker request failed', error);
      return json({ error: message }, status, cors);
    }
  },
};

export const __test__ = { safeProjectCode, normalizedRow, parseProjectProgress, parseMaterials, validWorkbook, QLDA_FIELDS, MATERIAL_FIELDS };