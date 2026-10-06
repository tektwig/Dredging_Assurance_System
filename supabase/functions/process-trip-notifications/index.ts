// Invoke from a trusted scheduler after deployment. No browser access or CORS.
// Uses the Resend HTTP API; no email is sent during a database transaction.
import { isDevelopmentProjectUrl, isValidEmailAddress, processNotifications, type WorkerConfig } from './worker.ts';

const env = (name: string): string => Deno.env.get(name)?.trim() ?? '';

async function readBatchLimit(request: Request): Promise<number | null> {
  let bodyText: string;
  try {
    bodyText = await request.text();
  } catch {
    return null;
  }
  if (!bodyText.trim()) return 5;

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;

  const limit = (body as Record<string, unknown>).limit;
  if (limit === undefined) return 5;
  return typeof limit === 'number' && Number.isInteger(limit) && limit >= 1 && limit <= 10
    ? limit
    : null;
}

async function secretMatches(actual: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(actual)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const workerSecret = env('TRIP_NOTIFICATION_WORKER_SECRET');
  if (workerSecret.length < 32) return new Response('Worker not configured', { status: 503 });
  if (!(await secretMatches(request.headers.get('x-worker-secret') ?? '', workerSecret))) {
    return new Response('Unauthorized', { status: 401 });
  }
  const batchLimit = await readBatchLimit(request);
  if (batchLimit === null) return new Response('Invalid batch limit', { status: 400 });
  const recipientSinkSetting = env('WAYBILL_TEST_RECIPIENT_SINK_ENABLED');
  if (recipientSinkSetting !== '' && recipientSinkSetting !== 'true' && recipientSinkSetting !== 'false') {
    return new Response('Worker not configured', { status: 503 });
  }
  const config: WorkerConfig = {
    supabaseUrl: env('SUPABASE_URL'),
    serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
    resendApiKey: env('RESEND_API_KEY'),
    sender: env('TRIP_NOTIFICATION_FROM'),
    financeRecipients: env('TRIP_NOTIFICATION_FINANCE_EMAILS').split(',').map(x => x.trim()).filter(Boolean),
    waybillClientEmail: isValidEmailAddress(env('WAYBILL_CLIENT_EMAIL')) ? env('WAYBILL_CLIENT_EMAIL') : null,
    recipientSinkEnabled: recipientSinkSetting === 'true',
  };
  if (!config.supabaseUrl || !config.serviceRoleKey || !config.resendApiKey || !config.sender
    || !config.financeRecipients.length) {
    return new Response('Worker not configured', { status: 503 });
  }
  if (config.recipientSinkEnabled && !isDevelopmentProjectUrl(config.supabaseUrl)) {
    return new Response('Worker not configured', { status: 503 });
  }
  try {
    const result = await processNotifications(config, batchLimit);
    return Response.json(result);
  } catch {
    // Do not log response bodies, addresses, bank details, or credentials.
    return new Response('Notification processing unavailable; queued work retained', { status: 503 });
  }
});
