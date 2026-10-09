import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import worker from '../worker/index.js';
import { applyMigrations, SqliteD1Adapter } from '../server/index.js';

const ownerPassword = 'OwnerInitial!Password2026';
const levelPassword = 'LevelAccount!Password2026';

function createAccessTest() {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  applyMigrations(database);
  const env = {
    DB:new SqliteD1Adapter(database), ADMIN_SETUP_KEY:'local-test-setup-key',
    AUTH_CODE_PEPPER:'test-only-pepper-that-is-long-enough',
    AMECC_MAILER_URL:'https://mailer.test/exec', AMECC_MAILER_TOKEN:'a'.repeat(40),
    MANUAL_REFRESH_COOLDOWN_SECONDS:'60',
  };
  async function call(path, {method='GET', body, token}={}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await worker.fetch(new Request(`https://amecc.test${path}`, {
      method, headers, body:body === undefined ? undefined : JSON.stringify(body),
    }), env);
    const data = await response.json().catch(() => ({}));
    return {status:response.status, data};
  }
  async function login(identity, password) {
    const result = await call('/api/auth/login', {method:'POST', body:{login:identity,password}});
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result.data.token;
  }
  return {database, env, call, login, close:() => database.close()};
}

function extractCode(mail) {
  const found = String(mail?.text || '').match(/(?:là|is)\s+(\d{6})/i);
  assert.ok(found, 'mail relay must receive a one-time code');
  return found[1];
}

test('setup key can claim an existing uninitialized owner once with an email and new strong password', async (t) => {
  const fixture = createAccessTest();
  t.after(() => fixture.close());
  const {call, env, login, database} = fixture;
  const initial = await call('/api/auth/setup', {method:'POST', body:{setup_key:env.ADMIN_SETUP_KEY, username:'legacyowner', password:ownerPassword}});
  assert.equal(initial.status, 201);
  const oldToken = await login('legacyowner', ownerPassword);
  const nextPassword = 'OwnerClaimed!Password2026';
  const claim = await call('/api/auth/setup', {method:'POST', body:{setup_key:env.ADMIN_SETUP_KEY, email:'ndhieu1208@gmail.com', password:nextPassword}});
  assert.equal(claim.status, 201, JSON.stringify(claim.data));
  assert.equal(claim.data.claimed_existing_owner, true);
  assert.equal(claim.data.username, 'legacyowner');
  assert.equal(database.prepare('SELECT COUNT(*) AS total FROM sessions').get().total, 0);
  assert.equal((await call('/api/auth/me', {token:oldToken})).data.user, null, 'claim revokes previous sessions');
  assert.equal((await call('/api/auth/login', {method:'POST', body:{login:'legacyowner', password:ownerPassword}})).status, 401);
  const emailToken = await login('NDHIEU1208@GMAIL.COM', nextPassword);
  assert.equal((await call('/api/auth/me', {token:emailToken})).data.user.owner_protected, true);
  const secondClaim = await call('/api/auth/setup', {method:'POST', body:{setup_key:env.ADMIN_SETUP_KEY, email:'ndhieu1208@gmail.com', password:nextPassword}});
  assert.equal(secondClaim.status, 409, 'claimed owner cannot be claimed a second time');
});

test('account levels, owner protection, sync delegation, profile and recovery buttons enforce policy through the API', async (t) => {
  const fixture = createAccessTest();
  t.after(() => fixture.close());
  const {database, env, call, login} = fixture;
  const previousFetch = globalThis.fetch;
  const sentMails = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), env.AMECC_MAILER_URL);
    assert.equal(options.headers.authorization, `Bearer ${env.AMECC_MAILER_TOKEN}`);
    const payload = JSON.parse(options.body);
    sentMails.push(payload);
    return Response.json({sent:true});
  };
  t.after(() => { globalThis.fetch = previousFetch; });

  const setup = await call('/api/auth/setup', {method:'POST', body:{setup_key:env.ADMIN_SETUP_KEY, email:'ndhieu1208@gmail.com', password:ownerPassword}});
  assert.equal(setup.status, 201);
  assert.equal(setup.data.email, 'ndhieu1208@gmail.com');
  assert.equal(setup.data.username, 'ndhieu1208');
  const ownerToken = await login('ndhieu1208', ownerPassword);
  assert.equal((await login('NDHIEU1208@GMAIL.COM', ownerPassword)).length > 20, true, 'owner can sign in with case-insensitive email');
  const owner = (await call('/api/auth/me', {token:ownerToken})).data.user;
  assert.equal(owner.admin_level, 'superadmin');
  assert.equal(owner.owner_protected, true);
  assert.equal(owner.capabilities.can_sync, true);

  const makeAccount = async (token, username, admin_level, can_sync=false) => call('/api/admin/users', {
    method:'POST', token, body:{username, password:levelPassword, admin_level, can_sync},
  });
  const level1Created = await makeAccount(ownerToken, 'levelone', 'level1');
  const level2Created = await makeAccount(ownerToken, 'leveltwo', 'level2');
  const viewerCreated = await makeAccount(ownerToken, 'viewerone', 'none');
  assert.equal(level1Created.status, 201);
  assert.equal(level2Created.status, 201);
  assert.equal(viewerCreated.status, 201);
  const level1Token = await login('levelone', levelPassword);
  const level2Token = await login('leveltwo', levelPassword);
  const viewerToken = await login('viewerone', levelPassword);
  const level1 = (await call('/api/auth/me', {token:level1Token})).data.user;
  const level2 = (await call('/api/auth/me', {token:level2Token})).data.user;
  assert.equal(level1.admin_level, 'level1');
  assert.equal(level2.admin_level, 'level2');
  assert.equal(level1.capabilities.can_sync, true);
  assert.equal(level2.capabilities.can_sync, true);
  assert.equal((await call('/api/auth/me', {token:viewerToken})).data.user.capabilities.can_sync, false);

  assert.equal((await call('/api/projects')).status, 200, 'project data remains public');
  assert.equal((await call('/api/admin/users', {token:ownerToken})).status, 200);
  assert.equal((await call('/api/admin/users', {token:level1Token})).status, 200);
  assert.equal((await call('/api/admin/users', {token:level2Token})).status, 403);
  assert.equal((await call('/api/admin/users', {token:viewerToken})).status, 403);
  assert.equal((await makeAccount(level1Token, 'level1second', 'level1')).status, 403);
  assert.equal((await makeAccount(level1Token, 'level1viewer', 'none')).status, 403);
  assert.equal((await makeAccount(level2Token, 'level2third', 'level2')).status, 403);
  assert.equal((await call('/api/admin/import/materials', {method:'POST', token:level1Token, body:{action:'begin'}})).status, 403);

  const ownerId = owner.id;
  const targetId = viewerCreated.data.user.id;
  const protectedDelete = await call(`/api/admin/users/${ownerId}`, {method:'DELETE', token:ownerToken});
  assert.equal(protectedDelete.status, 403);
  assert.equal((await call(`/api/admin/users/${ownerId}`, {method:'PATCH', token:ownerToken, body:{can_sync:false}})).status, 403);
  assert.throws(() => database.prepare('DELETE FROM users WHERE id = ?').run(ownerId), /cannot be deleted/i);
  assert.throws(() => database.prepare("UPDATE users SET admin_level = 'level2' WHERE id = ?").run(ownerId), /cannot be disabled or demoted/i);
  assert.throws(() => database.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(ownerId), /cannot be disabled or demoted/i);

  const firstSync = await call('/api/data/refresh', {method:'POST', token:ownerToken, body:{}});
  assert.equal(firstSync.status, 200, JSON.stringify(firstSync.data));
  const requestId = firstSync.data.request_id;
  assert.equal(database.prepare("SELECT requested_by FROM manual_refresh_state WHERE id='workspace'").get().requested_by, ownerId);
  assert.equal((await call('/api/data/refresh', {method:'POST', token:level1Token, body:{}})).status, 200);
  assert.equal((await call('/api/data/refresh', {method:'POST', token:level2Token, body:{}})).status, 200);
  assert.equal((await call('/api/data/refresh', {method:'POST', token:viewerToken, body:{}})).status, 403);
  assert.equal((await call(`/api/data/refresh/${requestId}`, {token:viewerToken})).status, 403);
  assert.equal((await call(`/api/admin/users/${targetId}`, {method:'PATCH', token:level1Token, body:{can_sync:true}})).status, 200);
  const viewerSync = await call('/api/data/refresh', {method:'POST', token:viewerToken, body:{}});
  assert.equal(viewerSync.status, 200);
  assert.equal((await call(`/api/data/refresh/${viewerSync.data.request_id}`, {token:viewerToken})).status, 200, 'a viewer with sync permission can see shared sync progress');

  const deleted = await call(`/api/admin/users/${targetId}`, {method:'DELETE', token:ownerToken});
  assert.equal(deleted.status, 200);
  assert.equal(await database.prepare('SELECT id FROM users WHERE id = ?').get(targetId), undefined);
  assert.ok(Number(database.prepare('SELECT COUNT(*) AS total FROM account_audit_logs').get().total) >= 3);

  const emailRequest = await call('/api/auth/email/request', {method:'POST', token:level1Token, body:{email:'user.one@example.com'}});
  assert.equal(emailRequest.status, 200, JSON.stringify(emailRequest.data));
  assert.match(sentMails.at(-1).subject, /xác minh email/i);
  assert.equal(sentMails.at(-1).name, undefined, 'display name is set only in the owner Apps Script relay');
  const emailCode = extractCode(sentMails.at(-1));
  assert.equal((await call('/api/auth/email/request', {method:'POST', token:level1Token, body:{email:'user.one@example.com'}})).status, 429);
  assert.equal((await call('/api/auth/email/verify', {method:'POST', token:level1Token, body:{code:'000000'}})).status, 400);
  const verified = await call('/api/auth/email/verify', {method:'POST', token:level1Token, body:{code:emailCode}});
  assert.equal(verified.status, 200, JSON.stringify(verified.data));
  assert.equal(verified.data.user.email, 'user.one@example.com');
  assert.ok(verified.data.user.email_verified_at);
  assert.equal((await call('/api/auth/email/verify', {method:'POST', token:level1Token, body:{code:emailCode}})).status, 400, 'verified code cannot be replayed');

  const unknownReset = await call('/api/auth/password/forgot', {method:'POST', body:{email:'missing@example.com'}});
  assert.equal(unknownReset.status, 200, 'forgot-password response does not disclose whether an account exists');
  const requestedReset = await call('/api/auth/password/forgot', {method:'POST', body:{email:'user.one@example.com'}});
  assert.equal(requestedReset.status, 200);
  assert.match(sentMails.at(-1).subject, /đặt lại mật khẩu/i);
  const resetCode = extractCode(sentMails.at(-1));
  const wrongCode = await call('/api/auth/password/reset', {method:'POST', body:{email:'user.one@example.com', code:'000001', password:'Recovered!Password2026'}});
  assert.equal(wrongCode.status, 400);
  const reset = await call('/api/auth/password/reset', {method:'POST', body:{email:'user.one@example.com', code:resetCode, password:'Recovered!Password2026'}});
  assert.equal(reset.status, 200, JSON.stringify(reset.data));
  assert.equal((await call('/api/auth/password/reset', {method:'POST', body:{email:'user.one@example.com', code:resetCode, password:'Replay!Password2026'}})).status, 400);
  assert.equal((await call('/api/auth/me', {token:level1Token})).data.user, null, 'password reset revokes old sessions');
  const recoveredToken = await login('levelone', 'Recovered!Password2026');
  const changed = await call('/api/auth/password/change', {method:'POST', token:recoveredToken, body:{current_password:'Recovered!Password2026', new_password:'Changed!Password2026'}});
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  assert.equal((await call('/api/auth/password/change', {method:'POST', token:recoveredToken, body:{current_password:'wrong-password', new_password:'Next!Password2026'}})).status, 401);
  await login('levelone', 'Changed!Password2026');

  const cooldown = await call('/api/data/refresh', {method:'POST', token:ownerToken, body:{}});
  assert.equal(cooldown.status, 200, 'an active queued refresh is reused');
  database.prepare("UPDATE manual_refresh_state SET refresh_status='completed', completed_at=? WHERE id='workspace'").run(Math.floor(Date.now()/1000));
  assert.equal((await call('/api/data/refresh', {method:'POST', token:ownerToken, body:{}})).status, 429, 'completed refresh remains rate limited');
});

test('recovery email requests fail closed when the owner mail relay is not configured', async (t) => {
  const fixture = createAccessTest();
  t.after(() => fixture.close());
  const {call, env} = fixture;
  const ownerPasswordHash = await (async () => {
    const {pbkdf2Sync, randomBytes} = await import('node:crypto');
    const salt = randomBytes(16).toString('base64');
    return `${salt}:${pbkdf2Sync(ownerPassword, salt, 100000, 32, 'sha256').toString('base64')}`;
  })();
  await env.DB.prepare('INSERT INTO users (id, username, password_hash, role, admin_level, can_sync, owner_protected, is_active) VALUES (?, ?, ?, ?, ?, 1, 1, 1)')
    .bind('owner-id', 'owner', ownerPasswordHash, 'admin', 'superadmin').run();
  const token = (await call('/api/auth/login', {method:'POST', body:{username:'owner',password:ownerPassword}})).data.token;
  env.AMECC_MAILER_URL = '';
  assert.equal((await call('/api/auth/email/request', {method:'POST', token, body:{email:'owner@example.com'}})).status, 503);
  assert.equal((await call('/api/auth/password/forgot', {method:'POST', body:{email:'owner@example.com'}})).status, 503);
});
