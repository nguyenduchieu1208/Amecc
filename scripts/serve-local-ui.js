import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const host = process.env.UI_HOST || '127.0.0.1';
const port = Number(process.env.UI_PORT || 4173);
const apiBaseUrl = process.env.LOCAL_API_URL || 'http://127.0.0.1:8787';
const types = {
  '.css':'text/css; charset=utf-8', '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml', '.woff':'font/woff',
  '.woff2':'font/woff2', '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const server = createServer((request, response) => {
  const pathname = new URL(request.url || '/', `http://${host}:${port}`).pathname;
  if (pathname === '/config.js') {
    response.writeHead(200, { 'content-type':'text/javascript; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff' });
    response.end(`window.AMECC_CONFIG = ${JSON.stringify({apiBaseUrl, apiKey:''})};`);
    return;
  }
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { response.writeHead(400).end('Bad path'); return; }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  let filePath = resolve(root, relative);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) { response.writeHead(403).end('Forbidden'); return; }
  try {
    if (statSync(filePath).isDirectory()) filePath = resolve(filePath, 'index.html');
    const content = readFileSync(filePath);
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
    response.writeHead(200, { 'content-type':types[ext] || 'application/octet-stream', 'x-content-type-options':'nosniff' });
    response.end(content);
  } catch {
    response.writeHead(404, { 'content-type':'text/plain; charset=utf-8' }).end('Not found');
  }
});

server.listen(port, host, () => console.log(`AMECC local UI: http://${host}:${port}/ (API ${apiBaseUrl})`));
process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
