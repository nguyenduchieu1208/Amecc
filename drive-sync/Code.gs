const AMECC_SYNC = Object.freeze({
  apiBaseUrl: 'https://ymewopsgearpdsvzyaxb.supabase.co/functions/v1/amecc-api',
  apiKey: 'sb_publishable_bfmlGNRuphcSb_mIFqeA8Q_p9xBBdL9',
  parserUrl: 'https://nguyenduchieu1208.github.io/Amecc/drive-sync-parser.js',
  xlsxUrl: 'https://nguyenduchieu1208.github.io/Amecc/vendor/xlsx.full.min.js',
  maxFileBytes: 20 * 1024 * 1024,
  // Keep uploads below the API's 1 MiB hard cap while reducing sequential chunks.
  maxRequestBytes: 900 * 1024,
  runBudgetMs: 5 * 60 * 1000,
});

const AMECC_PARSER_SHA256 = '0c0302b537de9bbb304868c4a380016636f0e68a2e1638eca0435cc11e3ed070';
const AMECC_XLSX_SHA256 = 'c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99';
const AMECC_FOLDER_PROPERTY = 'AMECC_DRIVE_FOLDER_ID';
const AMECC_QLDA_FOLDER_PROPERTY = 'AMECC_QLDA_DRIVE_FOLDER_ID';
const AMECC_DEFAULT_QLDA_FOLDER_ID = '1418VlFe3m3mgA-81jgJ8F5vetAev9qKG';
const AMECC_TOKEN_PROPERTY = 'AMECC_DRIVE_SYNC_TOKEN';
const AMECC_SYNCED_PREFIX = 'AMECC_SYNCED_';
const AMECC_FAILED_PREFIX = 'AMECC_FAILED_';
const AMECC_TRACKED_PREFIX = 'AMECC_TRACKED_';
const AMECC_DELETE_PREFIX = 'AMECC_DELETE_';

/** Run once from the Apps Script editor after setting the Drive and sync token Script Properties. */
function setupAmeccDriveSync() {
  const properties = PropertiesService.getScriptProperties();
  const folderId = String(properties.getProperty(AMECC_FOLDER_PROPERTY) || '').trim();
  const qldaFolderId = String(properties.getProperty(AMECC_QLDA_FOLDER_PROPERTY) || AMECC_DEFAULT_QLDA_FOLDER_ID).trim();
  const token = String(properties.getProperty(AMECC_TOKEN_PROPERTY) || '').trim();
  if (!folderId || !token) {
    throw new Error(`Set Script Properties ${AMECC_FOLDER_PROPERTY} and ${AMECC_TOKEN_PROPERTY} before setup.`);
  }
  DriveApp.getFolderById(folderId).getName();
  DriveApp.getFolderById(qldaFolderId).getName();
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

/** Clear retry cooldowns and immediately retry files that failed on the last sync. */
function retryFailedAmeccDriveSync() {
  const properties = PropertiesService.getScriptProperties();
  const failedKeys = Object.keys(properties.getProperties()).filter((key) => key.startsWith(AMECC_FAILED_PREFIX));
  failedKeys.forEach((key) => properties.deleteProperty(key));
  console.log(`Cleared ${failedKeys.length} AMECC Drive retry marker(s).`);
  syncAmeccDrive();
}

/** Re-import the current Drive workbooks once after a parser/schema update. */
function refreshAmeccDriveData() {
  const properties = PropertiesService.getScriptProperties();
  const all = properties.getProperties();
  const syncedKeys = Object.keys(all).filter((key) => key.startsWith(AMECC_SYNCED_PREFIX));
  const failedKeys = Object.keys(all).filter((key) => key.startsWith(AMECC_FAILED_PREFIX));
  [...syncedKeys, ...failedKeys].forEach((key) => properties.deleteProperty(key));
  console.log(`Queued ${syncedKeys.length} known Drive workbook(s) for a full re-import.`);
  syncAmeccDrive();
}

/** Re-import only QLDA workbooks after QLDA fields or schema change. */
function refreshAmeccQldaData() {
  const properties = PropertiesService.getScriptProperties();
  const folderId = String(properties.getProperty(AMECC_QLDA_FOLDER_PROPERTY) || AMECC_DEFAULT_QLDA_FOLDER_ID).trim();
  const files = DriveApp.getFolderById(folderId).getFiles();
  let queued = 0;
  while (files.hasNext()) {
    const file = files.next();
    if (!/^[\w.-]+\.xlsx$/i.test(file.getName()) || /PL\.xlsx$/i.test(file.getName())) continue;
    const id = file.getId();
    properties.deleteProperty(AMECC_SYNCED_PREFIX + id);
    properties.deleteProperty(AMECC_FAILED_PREFIX + id);
    queued += 1;
  }
  console.log(`Queued ${queued} QLDA workbook(s) for re-import; PL/BTP sync markers were preserved.`);
  syncAmeccDrive();
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

/** Trigger entry point. Imports changed PL/BTP and QLDA workbooks and safely retries failures. */
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
    const qldaFolderId = String(properties.getProperty(AMECC_QLDA_FOLDER_PROPERTY) || AMECC_DEFAULT_QLDA_FOLDER_ID).trim();
    const syncToken = String(properties.getProperty(AMECC_TOKEN_PROPERTY) || '').trim();
    if (!folderId || !qldaFolderId || !syncToken) throw new Error('One or more Drive folder IDs or the sync token are missing.');

    const currentFiles = [];
    const renamedSources = [];
    const pending = [
      ...findPendingFiles_(DriveApp.getFolderById(folderId), 'materials', properties, currentFiles, renamedSources),
      ...findPendingFiles_(DriveApp.getFolderById(qldaFolderId), 'projects', properties, currentFiles, renamedSources),
    ].sort((left, right) => left.category.localeCompare(right.category) || left.file.getName().localeCompare(right.file.getName(), 'en', { numeric: true }));
    currentFiles.forEach((entry) => properties.setProperty(AMECC_TRACKED_PREFIX + entry.file.getId(), JSON.stringify({
      fileName: entry.file.getName(), category: entry.category, lastSeenAt: new Date().toISOString(),
    })));
    reconcileDeletedFiles_(properties, currentFiles, renamedSources, syncToken);
    if (!pending.length) return;
    console.log(`Found ${pending.length} changed workbook(s) across PL/BTP and QLDA folders.`);
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
          category: entry.category,
          syncedAt: new Date().toISOString(),
          materialRows: summary.materialRows,
          btpRows: summary.btpRows,
          projectRows: summary.projectRows,
        }));
        properties.deleteProperty(AMECC_FAILED_PREFIX + entry.file.getId());
        if (entry.category === 'projects') console.log(`DONE ${entry.file.getName()}: ${summary.projectRows} QLDA row(s).`);
        else console.log(`DONE ${entry.file.getName()}: ${summary.materialRows} PL + ${summary.btpRows} BTP row(s).`);
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
    reconcileDeletedFiles_(properties, currentFiles, [], syncToken);
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

function findPendingFiles_(folder, category, properties, inventory = [], renamedSources = []) {
  const candidates = [];
  const nameCounts = new Map();
  const iterator = folder.getFiles();
  while (iterator.hasNext()) {
    const file = iterator.next();
    const eligible = category === 'projects'
      ? /^[\w.-]+\.xlsx$/i.test(file.getName()) && !/PL\.xlsx$/i.test(file.getName())
      : /^[\w.-]+PL\.xlsx$/i.test(file.getName());
    if (!eligible) continue;
    const normalizedName = file.getName().toLocaleLowerCase();
    nameCounts.set(normalizedName, (nameCounts.get(normalizedName) || 0) + 1);
    const fileId = file.getId();
    const previousTracked = parseProperty_(properties.getProperty(AMECC_TRACKED_PREFIX + fileId));
    const previousSynced = parseProperty_(properties.getProperty(AMECC_SYNCED_PREFIX + fileId));
    [previousTracked, previousSynced].forEach((previousSource) => {
      if (previousSource?.fileName && previousSource?.category
        && ['materials', 'projects'].includes(previousSource.category)
        && (previousSource.category !== category || previousSource.fileName.toLocaleLowerCase() !== normalizedName)) {
        renamedSources.push({ fileId, fileName: previousSource.fileName, category: previousSource.category });
      }
    });
    const updated = file.getLastUpdated().getTime();
    const signature = `${updated}:${file.getSize()}`;
    inventory.push({ file, category, signature });
    const previous = parseProperty_(properties.getProperty(AMECC_SYNCED_PREFIX + fileId));
    const sameSource = previous?.fileName?.toLocaleLowerCase() === normalizedName && previous?.category === category;
    if (previous && previous.signature === signature && sameSource) continue;
    const failure = parseProperty_(properties.getProperty(AMECC_FAILED_PREFIX + fileId));
    if (failure && failure.signature === signature && Number(failure.retryAfter) > Date.now()) continue;
    candidates.push({ file, signature, category, sourceChanged: !sameSource });
  }

  const unique = candidates.filter(({ file }) => {
    const duplicate = nameCounts.get(file.getName().toLocaleLowerCase()) > 1;
    if (duplicate) console.error(`SKIP ${file.getName()}: duplicate filename in Drive folder.`);
    return !duplicate;
  });
  unique.sort((left, right) => left.file.getName().localeCompare(right.file.getName(), 'en', { numeric: true }));
  return unique;
}

function reconcileDeletedFiles_(properties, currentFiles, renamedSources, syncToken) {
  const allProperties = properties.getProperties();
  const activeById = new Map(currentFiles.map((entry) => [entry.file.getId(), entry]));
  const activeIds = new Set(activeById.keys());
  const activeNames = new Set(currentFiles.map((entry) => `${entry.category}:${entry.file.getName().toLocaleLowerCase()}`));
  const staleSources = [...renamedSources];

  Object.keys(allProperties).forEach((key) => {
    const isTracked = key.startsWith(AMECC_TRACKED_PREFIX);
    const isSynced = key.startsWith(AMECC_SYNCED_PREFIX) && !/_materials$|_btp$|_projects$/.test(key);
    if (!isTracked && !isSynced) return;
    const source = parseProperty_(allProperties[key]);
    if (!source?.fileName || !['materials', 'projects'].includes(source.category)) return;
    const fileId = key.slice((isTracked ? AMECC_TRACKED_PREFIX : AMECC_SYNCED_PREFIX).length);
    if (!activeIds.has(fileId)) staleSources.push({ fileId, fileName: source.fileName, category: source.category });
  });

  const queued = new Map(Object.keys(allProperties)
    .filter((key) => key.startsWith(AMECC_DELETE_PREFIX))
    .map((key) => [key, parseProperty_(allProperties[key])])
    .filter(([, source]) => source?.fileName && ['materials', 'projects'].includes(source.category)));
  staleSources.forEach((source) => {
    if (!source.fileId || !source.fileName || !['materials', 'projects'].includes(source.category)) return;
    const queueKey = `${AMECC_DELETE_PREFIX}${source.category}_${source.fileId}`;
    const existing = parseProperty_(properties.getProperty(queueKey));
    queued.set(queueKey, existing || source);
    properties.setProperty(queueKey, JSON.stringify(queued.get(queueKey)));
  });

  let removed = 0;
  queued.forEach((source, queueKey) => {
    const activeName = `${source.category}:${source.fileName.toLocaleLowerCase()}`;
    if (activeNames.has(activeName)) {
      properties.deleteProperty(queueKey);
      if (!activeIds.has(source.fileId)) clearDriveFileState_(properties, source.fileId);
      console.log(`KEEP ${source.fileName}: a same-name workbook is still present in its Drive folder.`);
      return;
    }
    const activeEntry = activeById.get(source.fileId);
    if (activeEntry) {
      const currentName = activeEntry.file.getName();
      const currentState = parseProperty_(properties.getProperty(AMECC_SYNCED_PREFIX + source.fileId));
      const replacementIsSynced = currentState?.category === activeEntry.category
        && currentState?.fileName === currentName && currentState?.signature === activeEntry.signature;
      if (!replacementIsSynced) {
        console.log(`WAIT ${source.fileName}: syncing renamed/moved ${currentName} before removing the prior source.`);
        return;
      }
    }
    try {
      const result = deleteDriveSource_(source, syncToken);
      properties.deleteProperty(queueKey);
      if (!activeIds.has(source.fileId)) clearDriveFileState_(properties, source.fileId);
      removed += Number(result.deleted_rows || 0);
      console.log(`REMOVED ${source.fileName}: ${Number(result.deleted_rows || 0)} imported row(s) deleted from AMECC.`);
    } catch (error) {
      console.error(`DELETE FAILED ${source.fileName}: ${String(error && error.message ? error.message : error).slice(0, 1000)}`);
    }
  });
  if (queued.size) console.log(`Drive deletion reconciliation checked ${queued.size} source file(s); ${removed} imported row(s) removed.`);
}

function deleteDriveSource_(source, syncToken) {
  const projectCode = String(source.fileName).replace(source.category === 'materials' ? /PL\.xlsx$/i : /\.xlsx$/i, '').trim().toUpperCase();
  const response = UrlFetchApp.fetch(`${AMECC_SYNC.apiBaseUrl}/api/admin/drive-sync/delete`, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: AMECC_SYNC.apiKey, Authorization: `Bearer ${syncToken}` },
    payload: JSON.stringify({ category: source.category, project_code: projectCode, filename: source.fileName }),
    muteHttpExceptions: true,
  });
  const status = response.getResponseCode();
  let body;
  try { body = JSON.parse(response.getContentText()); } catch (_) { body = {}; }
  if (status < 200 || status >= 300) throw new Error(`API ${status}: ${String(body.error || response.getContentText()).slice(0, 900)}`);
  return body;
}

function clearDriveFileState_(properties, fileId) {
  [
    `${AMECC_TRACKED_PREFIX}${fileId}`,
    `${AMECC_SYNCED_PREFIX}${fileId}`,
    `${AMECC_SYNCED_PREFIX}${fileId}_materials`,
    `${AMECC_SYNCED_PREFIX}${fileId}_btp`,
    `${AMECC_SYNCED_PREFIX}${fileId}_projects`,
    `${AMECC_FAILED_PREFIX}${fileId}`,
  ].forEach((key) => properties.deleteProperty(key));
}

function importDriveFile_(entry, parser, xlsx, syncToken, properties) {
  const file = entry.file;
  const fileName = file.getName();
  const fileId = file.getId();
  if (entry.category === 'projects') {
    const stateKey = `${AMECC_SYNCED_PREFIX}${fileId}_projects`;
    const state = parseProperty_(properties.getProperty(stateKey));
    if (!entry.sourceChanged && state?.signature === entry.signature) return { projectRows: Number(state.rows || 0) };
    const size = file.getSize();
    if (size <= 0) throw new Error('Workbook is empty.');
    if (size > AMECC_SYNC.maxFileBytes) throw new Error(`Workbook exceeds ${AMECC_SYNC.maxFileBytes / 1024 / 1024} MB.`);
    console.log(`READ QLDA ${fileName} (${(size / 1024 / 1024).toFixed(2)} MB).`);
    const bytes = new Uint8Array(file.getBlob().getBytes());
    if (bytes.byteLength !== size) throw new Error('Downloaded byte count does not match Drive file size.');
    const projectCode = parser.projectCodeFromFilename(fileName, 'projects');
    const workbook = xlsx.read(bytes, { type: 'array', cellDates: true, bookVBA: false });
    const records = parser.parseProjectWorkbook(workbook, fileName, projectCode, xlsx);
    importCategory_({ project_code: projectCode, filename: fileName }, 'projects', records, syncToken);
    properties.setProperty(stateKey, JSON.stringify({ signature: entry.signature, fileName, rows: records.length }));
    return { projectRows: records.length };
  }

  const materialStateKey = `${AMECC_SYNCED_PREFIX}${fileId}_materials`;
  const btpStateKey = `${AMECC_SYNCED_PREFIX}${fileId}_btp`;
  const materialState = parseProperty_(properties.getProperty(materialStateKey));
  const btpState = parseProperty_(properties.getProperty(btpStateKey));
  if (!entry.sourceChanged && materialState?.signature === entry.signature && btpState?.signature === entry.signature) {
    return { materialRows: Number(materialState.rows || 0), btpRows: Number(btpState.rows || 0), projectRows: 0 };
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
  if (entry.sourceChanged || materialState?.signature !== entry.signature) {
    importCategory_(payload, 'materials', payload.records, syncToken);
    properties.setProperty(materialStateKey, JSON.stringify({ signature: entry.signature, fileName, rows: payload.records.length }));
  }
  if (entry.sourceChanged || btpState?.signature !== entry.signature) {
    importCategory_(payload, 'btp', payload.btp_records, syncToken);
    properties.setProperty(btpStateKey, JSON.stringify({ signature: entry.signature, fileName, rows: payload.btp_records.length }));
  }
  return { materialRows: payload.records.length, btpRows: payload.btp_records.length, projectRows: 0 };
}

function importCategory_(payload, category, records, syncToken) {
  const send = (body) => apiJson_(body, syncToken, category);
  if (!records.length) {
    if (category === 'projects') throw new Error(`Không tìm thấy dòng QLDA hợp lệ trong ${payload.filename}; dữ liệu cũ được giữ nguyên.`);
    send({
      action: 'clear-category', category,
      project_code: payload.project_code,
      filename: payload.filename,
    }, syncToken);
    return;
  }

  const session = send({
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
      send(body);
      start += count;
      if (start % 5000 === 0 || start === records.length) {
        console.log(`${payload.filename} · ${category}: ${start}/${records.length} row(s).`);
      }
    }
    send({ action: 'commit', import_id: session.import_id });
  } catch (error) {
    try { send({ action: 'abort', import_id: session.import_id }); } catch (_) { /* Expired sessions are cleaned up automatically. */ }
    throw error;
  }
}

function apiJson_(payload, syncToken, category) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const endpoint = category === 'projects' ? '/api/admin/import/projects' : '/api/admin/import/materials';
      const response = UrlFetchApp.fetch(`${AMECC_SYNC.apiBaseUrl}${endpoint}`, {
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
