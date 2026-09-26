import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const [usernameArg, roleArg = 'viewer'] = process.argv.slice(2);
const username = String(usernameArg || '').trim().toLowerCase();
const role = roleArg;
if (!/^[a-z0-9._-]{3,64}$/.test(username) || !['viewer','admin'].includes(role)) {
  console.error('Usage: npm run user:create -- <username> [viewer|admin]');
  process.exit(1);
}
if (!process.env.AMECC_USER_PASSWORD || process.env.AMECC_USER_PASSWORD.length < 12) {
  console.error('Set AMECC_USER_PASSWORD to a password of at least 12 characters; it is never saved by this script.');
  process.exit(1);
}
const salt = randomBytes(16).toString('base64');
const passwordHash = pbkdf2Sync(process.env.AMECC_USER_PASSWORD, salt, 100000, 32, 'sha256').toString('base64');
const id = randomUUID();
const sql = `INSERT INTO users (id, username, password_hash, role) VALUES ('${id}', '${username}', '${salt}:${passwordHash}', '${role}');`;
execFileSync('npx', ['wrangler','d1','execute','amecc-db','--remote','--command',sql], { stdio:'inherit', shell:process.platform === 'win32' });
console.log(`Created ${role} account: ${username}`);