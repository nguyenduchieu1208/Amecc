import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { applyMigrations, createApiServer, SqliteD1Adapter } from '../server/index.js';

const allowedOrigin = 'https://nguyenduchieu1208.github.io';

test('SQLite replacement applies all migrations and exposes the existing API contract', async (t) => {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  applyMigrations(database);
  const server = createApiServer({
    database,
    host: '127.0.0.1',
    port: 0,
    env: { ALLOWED_ORIGIN: allowedOrigin },
  });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    database.close();
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${baseUrl}/api/health`, { headers: { Origin: allowedOrigin } });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('access-control-allow-origin'), allowedOrigin);
  assert.equal((await health.json()).service, 'amecc-api');

  const projects = await fetch(`${baseUrl}/api/projects`, { headers: { Origin: 'https://other.example' } });
  assert.equal(projects.status, 200);
  assert.equal(projects.headers.get('access-control-allow-origin'), null);
  assert.deepEqual((await projects.json()).projects, []);

  const tables = database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'").get();
  assert.ok(Number(tables.count) >= 10);
});

test('SQLite batch writes are atomic, matching D1 batch behavior', () => {
  const database = new Database(':memory:');
  const adapter = new SqliteD1Adapter(database);
  database.exec('CREATE TABLE batch_check (value TEXT UNIQUE)');
  assert.throws(() => adapter.batch([
    adapter.prepare('INSERT INTO batch_check (value) VALUES (?)').bind('first'),
    adapter.prepare('INSERT INTO batch_check (value) VALUES (?)').bind('first'),
  ]));
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM batch_check').get().count, 0);
  database.close();
});
