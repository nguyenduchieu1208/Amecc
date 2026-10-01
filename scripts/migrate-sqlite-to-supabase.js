import Database from 'better-sqlite3';
import postgres from 'postgres';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(process.argv[2] || resolve(root, 'Data/amecc-migrated.sqlite'));
const connectionString = process.env.AMECC_SUPABASE_DB_URL;
if (!connectionString || connectionString.includes('[YOUR-PASSWORD]')) {
  throw new Error('Set AMECC_SUPABASE_DB_URL to the Supabase PostgreSQL connection string, with its password URL-encoded.');
}

const tables = [
  'projects', 'users', 'sessions', 'materials', 'project_progress', 'import_runs',
  'material_imports', 'material_import_rows', 'btp_material_import_rows', 'btp_materials',
];
const identityTables = ['materials', 'project_progress', 'btp_materials'];
const decimalColumns = new Set([
  'materials.quantity', 'materials.weight', 'materials.received', 'materials.remaining',
  'project_progress.quantity', 'project_progress.unit_weight', 'project_progress.total_weight',
  'project_progress.material_received_percent', 'project_progress.material_received_weight',
  'project_progress.fitup_qty', 'project_progress.fitup_weight', 'project_progress.welding_qty',
  'project_progress.welding_weight', 'project_progress.trial_assembly_qty',
  'project_progress.trial_assembly_weight', 'project_progress.acceptance_qty',
  'project_progress.acceptance_weight', 'project_progress.handover_qty', 'project_progress.handover_weight',
  'btp_materials.length_mm', 'btp_materials.unit_weight', 'btp_materials.total_weight',
  'btp_materials.design_quantity', 'btp_materials.received', 'btp_materials.remaining',
]);

function normalizeValue(table, column, value) {
  if (typeof value === 'string' && decimalColumns.has(`${table}.${column}`)) {
    const localizedDecimal = value.trim().match(/^([+-]?\d+),(\d+)$/);
    if (localizedDecimal) return `${localizedDecimal[1]}.${localizedDecimal[2]}`;
  }
  return value;
}

const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
const sql = postgres(connectionString, { max: 1, connect_timeout: 15, prepare: false, ssl: 'require' });

try {
  const currentCounts = await sql.begin(async (transaction) => {
    const counts = {};
    for (const table of tables) {
      const rows = await transaction.unsafe(`SELECT COUNT(*)::bigint AS total FROM public."${table}"`);
      counts[table] = Number(rows[0].total);
    }
    return counts;
  });
  const occupied = Object.entries(currentCounts).filter(([, count]) => count > 0);
  if (occupied.length) {
    throw new Error(`Target Supabase tables are not empty (${occupied.map(([table, count]) => `${table}: ${count}`).join(', ')}). No rows were changed.`);
  }

  const totals = {};
  await sql.begin(async (transaction) => {
    for (const table of tables) {
      const columns = source.prepare(`PRAGMA table_info("${table}")`).all().map(({ name }) => name);
      const rows = source.prepare(`SELECT * FROM "${table}"`).all();
      totals[table] = rows.length;
      if (!rows.length) continue;
      const quotedColumns = columns.map((column) => `"${column}"`).join(', ');
      const chunkSize = 250;
      for (let offset = 0; offset < rows.length; offset += chunkSize) {
        const chunk = rows.slice(offset, offset + chunkSize);
        const values = [];
        const tuples = chunk.map((row, rowIndex) => {
          const placeholders = columns.map((column, columnIndex) => {
            values.push(normalizeValue(table, column, row[column]));
            return `$${rowIndex * columns.length + columnIndex + 1}`;
          });
          return `(${placeholders.join(', ')})`;
        });
        await transaction.unsafe(
          `INSERT INTO public."${table}" (${quotedColumns}) VALUES ${tuples.join(', ')}`,
          values,
        );
      }
    }
    for (const table of identityTables) {
      await transaction.unsafe(
        `SELECT setval(pg_get_serial_sequence('public.${table}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM public.${table}`,
      );
    }
  });
  console.log(`Migrated rows from ${sourcePath}:`);
  for (const [table, count] of Object.entries(totals)) console.log(`${table}: ${count}`);
} finally {
  source.close();
  await sql.end({ timeout: 5 });
}
