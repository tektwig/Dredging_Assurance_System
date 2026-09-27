import { processWaybillPdfs, type WorkerConfig } from './worker.ts';
import { generateWaybillPdf } from './pdf.ts';

const env = (name: string): string => Deno.env.get(name)?.trim() ?? '';

async function readBatchLimit(request: Request): Promise<number | null> {
  const bodyText = await request.text();
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
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const workerSecret = env('WAYBILL_PDF_WORKER_SECRET');
  if (workerSecret.length < 32) return new Response('Worker not configured', { status: 503 });
  if (!(await secretMatches(request.headers.get('x-worker-secret') ?? '', workerSecret))) {
    return new Response('Unauthorized', { status: 401 });
  }
  const config: WorkerConfig = {
    supabaseUrl: env('SUPABASE_URL'),
    serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  };
  if (!config.supabaseUrl || !config.serviceRoleKey) return new Response('Worker not configured', { status: 503 });
  try {
    const batchLimit = await readBatchLimit(request);
    if (batchLimit === null) return new Response('Invalid batch limit', { status: 400 });
    const result = await processWaybillPdfs(config, generateWaybillPdf, batchLimit);
    return Response.json(result);
  } catch {
    return new Response('Waybill PDF processing unavailable; queued work retained', { status: 503 });
  }
});
