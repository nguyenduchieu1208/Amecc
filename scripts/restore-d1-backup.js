import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const [inputArgument, outputArgument] = process.argv.slice(2);
if (!inputArgument || !outputArgument) {
  console.error('Usage: node scripts/restore-d1-backup.js <D1-export.sql> <new-database.sqlite>');
  process.exit(2);
}

const input = resolve(inputArgument);
const output = resolve(outputArgument);
if (!existsSync(input)) throw new Error(`Backup file not found: ${input}`);
if (existsSync(output) && statSync(output).size > 0) throw new Error(`Refusing to overwrite non-empty database: ${output}`);

mkdirSync(dirname(output), { recursive: true });
const sql = readFileSync(input, 'utf8');
const database = new Database(output);
try {
  database.exec(sql);
  const projectCount = Number(database.prepare('SELECT COUNT(*) AS count FROM projects').get()?.count || 0);
  const materialCount = Number(database.prepare('SELECT COUNT(*) AS count FROM materials').get()?.count || 0);
  const btpCount = Number(database.prepare('SELECT COUNT(*) AS count FROM btp_materials').get()?.count || 0);
  const progressCount = Number(database.prepare('SELECT COUNT(*) AS count FROM project_progress').get()?.count || 0);
  console.log(`Restored ${projectCount} projects; ${materialCount} PL rows; ${btpCount} BTP rows; ${progressCount} progress rows.`);
} finally {
  database.close();
}
