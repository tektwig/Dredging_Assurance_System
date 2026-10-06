export interface WorkerConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  resendApiKey: string;
  sender: string;
  financeRecipients: string[];
  waybillClientEmail: string | null;
  recipientSinkEnabled: boolean;
}

interface Job {
  id: string;
  event_type: 'trip_closed' | 'waybill_ready';
  audience?: 'driver' | 'finance' | 'client';
  lease_token: string;
  email_request: Record<string, unknown>;
  payload: Record<string, unknown>;
}

interface WaybillPdfMetadata {
  invoice_id: string;
  invoice_number: string;
  storage_path: string;
}

const maxPdfBytes = 10 * 1024 * 1024;
const developmentProjectOrigin = 'https://pidxlopbxlapfmakmtjt.supabase.co';
const developmentTestRecipient = 'tektwig@gmail.com';

export function isDevelopmentProjectUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === developmentProjectOrigin && !url.username && !url.password
      && url.pathname === '/' && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function applyRecipientSink(emailRequest: Record<string, unknown>): Record<string, unknown> {
  const routed = { ...emailRequest };
  for (const key of Object.keys(routed)) {
    if (key.toLowerCase() === 'cc' || key.toLowerCase() === 'bcc') delete routed[key];
  }
  routed.to = [developmentTestRecipient];
  return routed;
}

export function isValidEmailAddress(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function encodeBase64(bytes: Uint8Array): string {
  const chunkSize = 24 * 576;
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))));
  }
  return chunks.join('');
}

function expectedPath(invoiceNumber: string): string | null {
  const match = /^(?:INV|WB)-(\d{4})-\d{6,}$/.exec(invoiceNumber);
  return match ? `${match[1]}/${invoiceNumber}.pdf` : null;
}

export async function processNotifications(config: WorkerConfig, batchLimit = 5, http: typeof fetch = fetch) {
  const waybillClientEmail = config.waybillClientEmail && isValidEmailAddress(config.waybillClientEmail)
    ? config.waybillClientEmail : null;
  if (config.recipientSinkEnabled && !isDevelopmentProjectUrl(config.supabaseUrl)) {
    throw new Error('Recipient sink is restricted to the DEVELOPMENT project');
  }

  const rpc = async <T>(name: string, body: unknown): Promise<T> => {
    const response = await http(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Database operation failed (${response.status})`);
    return await response.json() as T;
  };

  let reconciliationFailed = false;
  try {
    await rpc<number>('enqueue_waybill_ready_notifications', {});
  } catch {
    reconciliationFailed = true;
  }

  const jobs = await rpc<Job[]>('claim_trip_notifications', {
    p_finance_recipients: config.financeRecipients,
    p_sender: config.sender,
    p_limit: batchLimit,
    p_include_waybill_ready: true,
    p_include_waybill_client: waybillClientEmail !== null,
  });
  let sent = 0, deferred = 0, unacknowledged = 0;
  for (const job of jobs) {
    let providerId: string | null = null;
    let failure = 'Email provider unavailable or acceptance uncertain';
    try {
      let emailRequest = job.email_request;
      if (job.event_type === 'waybill_ready') {
        if (job.audience === 'finance') {
          throw new Error('Internal Waybill email delivery is disabled');
        }
        if (job.audience !== 'driver' && job.audience !== 'client') {
          throw new Error('Unsupported Waybill audience');
        }
        if (job.audience === 'client' && !waybillClientEmail) {
          throw new Error('Target company recipient is not configured');
        }
        const rows = await rpc<WaybillPdfMetadata[]>('get_waybill_ready_pdf', {
          p_notification_id: job.id,
          p_lease_token: job.lease_token,
        });
        const metadata = rows.length === 1 ? rows[0] : null;
        const invoiceId = typeof job.payload.invoice_id === 'string' ? job.payload.invoice_id : '';
        const invoiceNumber = typeof job.payload.invoice_number === 'string' ? job.payload.invoice_number : '';
        const storagePath = typeof job.payload.storage_path === 'string' ? job.payload.storage_path : '';
        const requiredPath = expectedPath(invoiceNumber);
        if (!metadata || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceId)
          || metadata.invoice_id !== invoiceId || metadata.invoice_number !== invoiceNumber
          || metadata.storage_path !== storagePath || !requiredPath || requiredPath !== storagePath) {
          throw new Error('Waybill PDF unavailable');
        }

        const objectPath = storagePath.split('/').map(encodeURIComponent).join('/');
        const pdfResponse = await http(`${config.supabaseUrl}/storage/v1/object/authenticated/waybills/${objectPath}`, {
          method: 'GET',
          headers: {
            apikey: config.serviceRoleKey,
            Authorization: `Bearer ${config.serviceRoleKey}`,
          },
          signal: AbortSignal.timeout(30_000),
        });
        const reportedSize = Number(pdfResponse.headers.get('content-length'));
        if (!pdfResponse.ok || (Number.isFinite(reportedSize) && reportedSize > maxPdfBytes)) {
          throw new Error('Waybill PDF unavailable');
        }
        const pdf = new Uint8Array(await pdfResponse.arrayBuffer());
        if (pdf.length === 0 || pdf.length > maxPdfBytes
          || new TextDecoder().decode(pdf.subarray(0, 5)) !== '%PDF-') {
          throw new Error('Waybill PDF unavailable');
        }
        emailRequest = {
          ...job.email_request,
          ...(job.audience === 'client' ? {
            to: [waybillClientEmail!],
            subject: `Waybill ${invoiceNumber} for trip ${String(job.payload.trip_number ?? '')}`,
            text: `The issued Waybill PDF is attached.\nWaybill Number: ${invoiceNumber}\nTrip Number: ${String(job.payload.trip_number ?? '')}`,
          } : {}),
          attachments: [{ filename: `${invoiceNumber}.pdf`, content: encodeBase64(pdf) }],
        };
      } else if (job.event_type !== 'trip_closed') {
        throw new Error('Unsupported notification event');
      }

      if (config.recipientSinkEnabled) emailRequest = applyRecipientSink(emailRequest);
      const response = await http('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.resendApiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `trip-notification/${job.id}`,
        },
        body: JSON.stringify(emailRequest),
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) {
        const data: unknown = await response.json();
        if (data && typeof data === 'object' && 'id' in data && typeof data.id === 'string' && data.id) providerId = data.id;
      } else {
        failure = `Email provider HTTP ${response.status}`;
      }
    } catch {
      failure = job.event_type === 'waybill_ready'
        ? job.audience === 'finance' ? 'Internal Waybill email delivery is disabled' : 'Waybill PDF attachment unavailable'
        : 'Email provider unavailable or acceptance uncertain';
    }
    try {
      const acknowledged = await rpc<boolean>('finish_trip_notification', {
        p_id: job.id,
        p_lease_token: job.lease_token,
        p_sent: providerId !== null,
        p_provider_message_id: providerId,
        p_error: providerId ? null : failure,
      });
      if (!acknowledged) unacknowledged++;
      else if (providerId) sent++;
      else deferred++;
    } catch {
      // Lease expiry makes work reclaimable if database acknowledgement fails.
      unacknowledged++;
    }
  }
  return { claimed: jobs.length, sent, deferred, unacknowledged, reconciliationFailed,
    targetCompanyConfigured: waybillClientEmail !== null };
}
