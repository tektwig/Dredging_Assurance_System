import { processWaybillPdfs, type WorkerConfig } from './worker.ts';
import { generateCompanyWaybillPdf, generateDriverWaybillPdf } from './secure_pdf.ts';
import type { PdfGenerators } from './types.ts';

const logoBytes = await Deno.readFile(new URL('./assets/trakflit-logo.jpg', import.meta.url));
const pdfGenerators: PdfGenerators = {
  driver: snapshot => generateDriverWaybillPdf(snapshot, logoBytes),
  company: snapshot => generateCompanyWaybillPdf(snapshot, logoBytes),
};

const env = (name: string): string => Deno.env.get(name)?.trim() ?? '';

interface WorkerRequestOptions {
  limit: number;
  syntheticCanaryInvoiceId?: string;
}

async function readWorkerRequest(request: Request): Promise<WorkerRequestOptions | null> {
  const bodyText = await request.text();
  if (!bodyText.trim()) return { limit: 1 };

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;

  const options = body as Record<string, unknown>;
  if (Object.keys(options).some(key => !['limit', 'mode', 'invoice_id'].includes(key))) return null;
  const limit = options.limit ?? 1;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 2) return null;
  if (options.mode === undefined && options.invoice_id === undefined) return { limit };
  const selectedInvoiceId = env('WAYBILL_PDF_SYNTHETIC_CANARY_INVOICE_ID');
  if (options.mode !== 'synthetic_canary'
    || env('WAYBILL_PDF_SYNTHETIC_CANARY_ENABLED') !== 'true'
    || typeof options.invoice_id !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.invoice_id)
    || options.invoice_id !== selectedInvoiceId
    || limit !== 1) return null;
  return { limit: 1, syntheticCanaryInvoiceId: options.invoice_id };
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
    const workerRequest = await readWorkerRequest(request);
    if (workerRequest === null) return new Response('Invalid PDF worker request', { status: 400 });
    const result = await processWaybillPdfs(config, pdfGenerators, workerRequest.limit, fetch, {
      syntheticCanaryInvoiceId: workerRequest.syntheticCanaryInvoiceId,
    });
    return Response.json(result);
  } catch {
    return new Response('Waybill PDF processing unavailable; queued work retained', { status: 503 });
  }
});
