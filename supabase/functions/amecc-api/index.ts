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
    max_pipeline: 256,
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
      DRIVE_SYNC_TOKEN: Deno.env.get('DRIVE_SYNC_TOKEN') || '',
      AMECC_REFRESH_PASSWORD: Deno.env.get('AMECC_REFRESH_PASSWORD') || '',
      AMECC_MAILER_URL: Deno.env.get('AMECC_MAILER_URL') || '',
      AMECC_MAILER_TOKEN: Deno.env.get('AMECC_MAILER_TOKEN') || '',
      AUTH_CODE_PEPPER: Deno.env.get('AUTH_CODE_PEPPER') || '',
      MANUAL_REFRESH_COOLDOWN_SECONDS: Deno.env.get('MANUAL_REFRESH_COOLDOWN_SECONDS') || '60',
      SESSION_TTL_SECONDS: '28800',
      MAX_UPLOAD_BYTES: '20971520',
    };
    return await worker.fetch(routedRequest, env);
  } catch (error) {
    console.error('AMECC Supabase API failed', error);
    const driveSyncToken = Deno.env.get('DRIVE_SYNC_TOKEN') || '';
    const isDriveSyncRequest = Boolean(driveSyncToken)
      && request.headers.get('Authorization') === `Bearer ${driveSyncToken}`;
    if (isDriveSyncRequest) {
      const detail = String(error instanceof Error ? `${error.name}: ${error.message}` : error).slice(0, 900);
      return Response.json({ error: 'Lỗi máy chủ khi xử lý yêu cầu.', detail }, { status: 500 });
    }
    return Response.json({ error: 'Lỗi máy chủ khi xử lý yêu cầu.' }, { status: 500 });
  }
});
