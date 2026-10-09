import { createServer } from 'node:http';

const host = '127.0.0.1';
const port = Number(process.env.MOCK_MAILER_PORT || 8788);
const token = process.env.MOCK_MAILER_TOKEN || '';
let lastMail = null;

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url || '/', `http://${host}:${port}`).pathname;
  if (request.method === 'GET' && pathname === '/last') {
    response.writeHead(200, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' });
    response.end(JSON.stringify({ mail:lastMail }));
    return;
  }
  if (request.method !== 'POST' || pathname !== '/exec') { response.writeHead(404).end(); return; }
  if (!token || request.headers.authorization !== `Bearer ${token}`) { response.writeHead(401).end(JSON.stringify({sent:false})); return; }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try {
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (payload.token !== token || !payload.to || !payload.subject || !payload.text) throw new Error('invalid mail payload');
    lastMail = { to:payload.to, subject:payload.subject, text:payload.text, receivedAt:new Date().toISOString() };
    response.writeHead(200, { 'content-type':'application/json; charset=utf-8' }).end(JSON.stringify({sent:true}));
  } catch {
    response.writeHead(400, { 'content-type':'application/json; charset=utf-8' }).end(JSON.stringify({sent:false}));
  }
});

server.listen(port, host, () => console.log(`Local-only mock mailer listening at http://${host}:${port}/exec`));
process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
