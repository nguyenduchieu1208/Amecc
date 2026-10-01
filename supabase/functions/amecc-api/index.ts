import postgres from 'npm:postgres@3.4.7';
import worker from '../../../worker/index.js';
import { PostgresD1Adapter } from '../_shared/postgres-d1-adapter.js';

let client: ReturnType<typeof postgres> | undefined;

function getClient() {
  if (client) return client;
  const connectionString = Deno.env.get('SUPABASE_DB_URL');
  if (!connectionString) throw new Error('Supabase did not provide SUPABASE_DB_URL.');
  client = postgres(connectionString, {
    max: 1,
    idle_timeout: 25,
    connect_timeout: 10,
    prepare: false,
    ssl: 'require',
  });
  return client;
}

Deno.serve(async (request) => {
  try {
    const url = new URL(request.url);
    const functionPrefixes = ['/functions/v1/amecc-api', '/amecc-api'];
    const functionPrefix = functionPrefixes.find((prefix) =>
      url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)
    );
    if (functionPrefix) {
      url.pathname = url.pathname.slice(functionPrefix.length) || '/';
    }
    const routedRequest = new Request(url, request);
    const env = {
      DB: new PostgresD1Adapter(getClient()),
      ALLOWED_ORIGIN: 'https://nguyenduchieu1208.github.io',
      ADMIN_SETUP_KEY: Deno.env.get('ADMIN_SETUP_KEY') || '',
      SESSION_TTL_SECONDS: '28800',
      MAX_UPLOAD_BYTES: '10485760',
    };
    return await worker.fetch(routedRequest, env);
  } catch (error) {
    console.error('AMECC Supabase API failed', error);
    return Response.json({ error: 'Lỗi máy chủ khi xử lý yêu cầu.' }, { status: 500 });
  }
});
