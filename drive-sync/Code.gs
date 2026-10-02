const AMECC_SYNC = Object.freeze({
  apiBaseUrl: 'https://ymewopsgearpdsvzyaxb.supabase.co/functions/v1/amecc-api',
  apiKey: 'sb_publishable_bfmlGNRuphcSb_mIFqeA8Q_p9xBBdL9',
  parserUrl: 'https://nguyenduchieu1208.github.io/Amecc/drive-sync-parser.js',
  xlsxUrl: 'https://nguyenduchieu1208.github.io/Amecc/vendor/xlsx.full.min.js',
  maxFileBytes: 20 * 1024 * 1024,
  maxRequestBytes: 512 * 1024,
  runBudgetMs: 5 * 60 * 1000,
});

const AMECC_PARSER_SHA256 = '56564acdd0e822e1f99f36372e7cf0bfe0daa52514f744773b546b413eb82b18';
const AMECC_XLSX_SHA256 = 'c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99';
const AMECC_FOLDER_PROPERTY = 'AMECC_DRIVE_FOLDER_ID';
const AMECC_TOKEN_PROPERTY = 'AMECC_DRIVE_SYNC_TOKEN';
const AMECC_SYNCED_PREFIX = 'AMECC_SYNCED_';
const AMECC_FAILED_PREFIX = 'AMECC_FAILED_';

/** Run once from the Apps Script editor after setting the two Script Properties. */
function setupAmeccDriveSync() {
  const properties = PropertiesService.getScriptProperties();
  const folderId = String(properties.getProperty(AMECC_FOLDER_PROPERTY) || '').trim();
  const token = String(properties.getProperty(AMECC_TOKEN_PROPERTY) || '').trim();
  if (!folderId || !token) {
    throw new Error(`Set Script Properties ${AMECC_FOLDER_PROPERTY} and ${AMECC_TOKEN_PROPERTY} before setup.`);
  }
  DriveApp.getFolderById(folderId).getName();
  assertSyncApiReady_(token);
  const parserXlsx = loadXlsx_();
  loadParser_(parserXlsx);
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'syncAmeccDrive')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('syncAmeccDrive').timeBased().everyMinutes(1).create();
  console.log('AMECC Drive sync trigger installed. Starting the first sync now.');
  syncAmeccDrive();
}

function stopAmeccDriveSync() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'syncAmeccDrive')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  console.log('AMECC Drive sync trigger removed. Imported site data is unchanged.');
}

function assertSyncApiReady_(syncToken) {
  const response = UrlFetchApp.fetch(`${AMECC_SYNC.apiBaseUrl}/api/admin/drive-sync/health`, {
    method: 'get',
    headers: {
      apikey: AMECC_SYNC.apiKey,
      Authorization: `Bearer ${syncToken}`,
    },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    throw new Error(`AMECC Drive sync API is not ready (${response.getResponseCode()}). Set DRIVE_SYNC_TOKEN in Supabase and redeploy amecc-api.`);
  }
}

/** Trigger entry point. Imports changed PL workbooks and safely retries failures. */
function syncAmeccDrive() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    console.log('Another AMECC Drive sync is still running; this trigger is skipped.');
    return;
  }
  const startedAt = Date.now();
  try {
    const properties = PropertiesService.getScriptProperties();
    const folderId = String(properties.getProperty(AMECC_FOLDER_PROPERTY) || '').trim();
    const syncToken = String(properties.getProperty(AMECC_TOKEN_PROPERTY) || '').trim();
    if (!folderId || !syncToken) throw new Error('Drive folder ID or sync token is missing from Script Properties.');

    const pending = findPendingFiles_(DriveApp.getFolderById(folderId), properties);
    if (!pending.length) return;
    console.log(`Found ${pending.length} changed PL workbook(s).`);
    const xlsx = loadXlsx_();
    const parser = loadParser_(xlsx);

    for (const entry of pending) {
      if (Date.now() - startedAt > AMECC_SYNC.runBudgetMs) {
        console.log('Execution time budget reached; remaining files will continue on the next trigger.');
        break;
      }
      try {
        const summary = importDriveFile_(entry, parser, xlsx, syncToken, properties);
        properties.setProperty(AMECC_SYNCED_PREFIX + entry.file.getId(), JSON.stringify({
          signature: entry.signature,
          fileName: entry.file.getName(),
          syncedAt: new Date().toISOString(),
          materialRows: summary.materialRows,
          btpRows: summary.btpRows,
        }));
        properties.deleteProperty(AMECC_FAILED_PREFIX + entry.file.getId());
        console.log(`DONE ${entry.file.getName()}: ${summary.materialRows} PL + ${summary.btpRows} BTP row(s).`);
      } catch (error) {
        const message = String(error && error.message ? error.message : error).slice(0, 1500);
        properties.setProperty(AMECC_FAILED_PREFIX + entry.file.getId(), JSON.stringify({
          signature: entry.signature,
          retryAfter: Date.now() + 15 * 60 * 1000,
          message,
        }));
        console.error(`FAILED ${entry.file.getName()}: ${message}`);
      }
    }
  } finally {
    lock.releaseLock();
  }
}

/** Allow an operator to retry files that previously failed without changing the source workbook. */
function resetAmeccDriveSyncFailures() {
  const properties = PropertiesService.getScriptProperties();
  const all = properties.getProperties();
  Object.keys(all).filter((key) => key.startsWith(AMECC_FAILED_PREFIX)).forEach((key) => properties.deleteProperty(key));
  console.log('Cleared saved failure backoff. Failed files will be retried by the next sync.');
}

function findPendingFiles_(folder, properties) {
  const candidates = [];
  const nameCounts = new Map();
  const iterator = folder.getFiles();
  while (iterator.hasNext()) {
    const file = iterator.next();
    if (!/^[\w.-]+PL\.xlsx$/i.test(file.getName())) continue;
    const normalizedName = file.getName().toLocaleLowerCase();
    nameCounts.set(normalizedName, (nameCounts.get(normalizedName) || 0) + 1);
    const updated = file.getLastUpdated().getTime();
    const signature = `${updated}:${file.getSize()}`;
    const previous = parseProperty_(properties.getProperty(AMECC_SYNCED_PREFIX + file.getId()));
    if (previous && previous.signature === signature) continue;
    const failure = parseProperty_(properties.getProperty(AMECC_FAILED_PREFIX + file.getId()));
    if (failure && failure.signature === signature && Number(failure.retryAfter) > Date.now()) continue;
    candidates.push({ file, signature });
  }

  const unique = candidates.filter(({ file }) => {
    const duplicate = nameCounts.get(file.getName().toLocaleLowerCase()) > 1;
    if (duplicate) console.error(`SKIP ${file.getName()}: duplicate filename in Drive folder.`);
    return !duplicate;
  });
  unique.sort((left, right) => left.file.getName().localeCompare(right.file.getName(), 'en', { numeric: true }));
  return unique;
}

function importDriveFile_(entry, parser, xlsx, syncToken, properties) {
  const file = entry.file;
  const fileName = file.getName();
  const fileId = file.getId();
  const materialStateKey = `${AMECC_SYNCED_PREFIX}${fileId}_materials`;
  const btpStateKey = `${AMECC_SYNCED_PREFIX}${fileId}_btp`;
  const materialState = parseProperty_(properties.getProperty(materialStateKey));
  const btpState = parseProperty_(properties.getProperty(btpStateKey));
  if (materialState?.signature === entry.signature && btpState?.signature === entry.signature) {
    return { materialRows: Number(materialState.rows || 0), btpRows: Number(btpState.rows || 0) };
  }
  const size = file.getSize();
  if (size <= 0) throw new Error('Workbook is empty.');
  if (size > AMECC_SYNC.maxFileBytes) throw new Error(`Workbook exceeds ${AMECC_SYNC.maxFileBytes / 1024 / 1024} MB.`);
  console.log(`READ ${fileName} (${(size / 1024 / 1024).toFixed(2)} MB).`);
  const bytes = new Uint8Array(file.getBlob().getBytes());
  if (bytes.byteLength !== size) throw new Error('Downloaded byte count does not match Drive file size.');
  const projectCode = parser.projectCodeFromFilename(fileName, 'materials');
  const workbook = xlsx.read(bytes, { type: 'array', cellDates: false, bookVBA: false });
  const payload = parser.parseMaterialWorkbook(workbook, fileName, projectCode, xlsx);
  if (materialState?.signature !== entry.signature) {
    importCategory_(payload, 'materials', payload.records, syncToken);
    properties.setProperty(materialStateKey, JSON.stringify({ signature: entry.signature, rows: payload.records.length }));
  }
  if (btpState?.signature !== entry.signature) {
    importCategory_(payload, 'btp', payload.btp_records, syncToken);
    properties.setProperty(btpStateKey, JSON.stringify({ signature: entry.signature, rows: payload.btp_records.length }));
  }
  return { materialRows: payload.records.length, btpRows: payload.btp_records.length };
}

function importCategory_(payload, category, records, syncToken) {
  if (!records.length) {
    apiJson_({
      action: 'clear-category', category,
      project_code: payload.project_code,
      filename: payload.filename,
    }, syncToken);
    return;
  }

  const session = apiJson_({
    action: 'begin', category,
    project_code: payload.project_code,
    filename: payload.filename,
    expected_rows: records.length,
  }, syncToken);
  try {
    let start = 0;
    while (start < records.length) {
      let count = Math.min(Number(session.chunk_size) || 500, records.length - start);
      let body = '';
      while (count > 0) {
        body = JSON.stringify({ action: 'chunk', import_id: session.import_id, start_row: start, records: records.slice(start, start + count) });
        if (Utilities.newBlob(body, 'application/json').getBytes().length <= AMECC_SYNC.maxRequestBytes) break;
        count = Math.floor(count / 2);
      }
      if (count < 1) throw new Error(`A row near ${start + 1} is too large to import safely.`);
      apiJson_(body, syncToken);
      start += count;
      if (start % 5000 === 0 || start === records.length) {
        console.log(`${payload.filename} · ${category}: ${start}/${records.length} row(s).`);
      }
    }
    apiJson_({ action: 'commit', import_id: session.import_id }, syncToken);
  } catch (error) {
    try { apiJson_({ action: 'abort', import_id: session.import_id }, syncToken); } catch (_) { /* Expired sessions are cleaned up automatically. */ }
    throw error;
  }
}

function apiJson_(payload, syncToken) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = UrlFetchApp.fetch(`${AMECC_SYNC.apiBaseUrl}/api/admin/import/materials`, {
        method: 'post',
        contentType: 'application/json',
        payload: body,
        headers: {
          apikey: AMECC_SYNC.apiKey,
          Authorization: `Bearer ${syncToken}`,
        },
        muteHttpExceptions: true,
      });
      const status = response.getResponseCode();
      const text = response.getContentText();
      if (status >= 200 && status < 300) return text ? JSON.parse(text) : {};
      if (status < 500 && status !== 429) throw new Error(`API ${status}: ${text.slice(0, 900)}`);
      lastError = new Error(`API ${status}: ${text.slice(0, 900)}`);
    } catch (error) {
      lastError = error;
      if (/API 4\d\d:/.test(String(error && error.message))) throw error;
    }
    if (attempt < 2) Utilities.sleep(500 * (2 ** attempt));
  }
  throw lastError || new Error('AMECC API request failed.');
}

function loadXlsx_() {
  const source = checkedAsset_(AMECC_SYNC.xlsxUrl, AMECC_XLSX_SHA256);
  return new Function(`${source}\n;return XLSX;`)();
}

function loadParser_(xlsx) {
  const source = checkedAsset_(AMECC_SYNC.parserUrl, AMECC_PARSER_SHA256);
  return new Function('XLSX', `${source}\n;return createAmeccDriveParser(XLSX);`)(xlsx);
}

function checkedAsset_(url, expectedHash) {
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (response.getResponseCode() !== 200) throw new Error(`Cannot load pinned parser asset (${response.getResponseCode()}).`);
  const source = response.getContentText('UTF-8');
  const actualHash = sha256Hex_(source);
  if (!expectedHash || actualHash !== expectedHash) throw new Error('Parser asset integrity check failed; update the deployed AMECC site before syncing.');
  return source;
}

function sha256Hex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map((value) => (value & 255).toString(16).padStart(2, '0'))
    .join('');
}

function parseProperty_(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch (_) { return null; }
}
