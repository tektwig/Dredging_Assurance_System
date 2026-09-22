// Invoke from a trusted scheduler after deployment. No browser access or CORS.
// Uses the Resend HTTP API; no email is sent during a database transaction.
import { processNotifications, type WorkerConfig } from './worker.ts';

const env = (name: string): string => Deno.env.get(name)?.trim() ?? '';

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
  const config: WorkerConfig = {
    supabaseUrl: env('SUPABASE_URL'),
    serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
    resendApiKey: env('RESEND_API_KEY'),
    sender: env('TRIP_NOTIFICATION_FROM'),
    financeRecipients: env('TRIP_NOTIFICATION_FINANCE_EMAILS').split(',').map(x => x.trim()).filter(Boolean),
  };
  if (!config.supabaseUrl || !config.serviceRoleKey || !config.resendApiKey || !config.sender || !config.financeRecipients.length) {
    return new Response('Worker not configured', { status: 503 });
  }
  try {
    const result = await processNotifications(config);
    return Response.json(result);
  } catch {
    // Do not log response bodies, addresses, bank details, or credentials.
    return new Response('Notification processing unavailable; queued work retained', { status: 503 });
  }
});
