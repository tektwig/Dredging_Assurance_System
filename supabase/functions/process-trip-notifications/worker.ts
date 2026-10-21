export interface WorkerConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  resendApiKey: string;
  sender: string;
  waybillClientEmail: string | null;
  recipientSinkEnabled: boolean;
  deliveryEnabled: boolean;
  canaryEnabled?: boolean;
  canaryInvoiceId?: string | null;
}

interface NotificationJob {
  id: string;
  event_type: string;
  audience: string;
  recipients: unknown;
  status: string;
  lease_token: string;
  lease_until: string;
  payload: unknown;
}

interface NotificationPdf {
  invoice_id: string;
  invoice_number: string;
  copy_kind: string;
  storage_bucket: string;
  storage_path: string;
}

const maxPdfBytes = 10 * 1024 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const developmentProjectOrigin = 'https://pidxlopbxlapfmakmtjt.supabase.co';
const developmentTestRecipient = 'tektwig@gmail.com';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function isDevelopmentProjectUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === developmentProjectOrigin && !url.username && !url.password
      && url.pathname === '/' && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function isValidEmailAddress(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidSender(value: string): boolean {
  return value.length > 0 && value.length <= 254 && !/[\r\n]/.test(value);
}

function encodeBase64(bytes: Uint8Array): string {
  const chunkSize = 24 * 576;
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))));
  }
  return chunks.join('');
}

function expectedWaybillPath(invoiceNumber: string, copyKind: 'driver' | 'company', storagePath: string): boolean {
  const match = /^(?:INV|WB)-(\d{4})-(\d{6,})$/.exec(invoiceNumber);
  if (!match) return false;
  const expectedBase = `${match[1]}/${invoiceNumber}.pdf`;
  if (copyKind === 'driver') return storagePath === expectedBase;
  return storagePath === expectedBase
    || new RegExp(`^${match[1]}/${invoiceNumber}-company-v(?:[2-9]|[1-9][0-9]+)\\.pdf$`).test(storagePath);
}

function parseJob(value: unknown): NotificationJob | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !uuidPattern.test(value.id)
    || value.event_type !== 'waybill_ready'
    || (value.audience !== 'driver' && value.audience !== 'client')
    || value.status !== 'processing'
    || typeof value.lease_token !== 'string' || !uuidPattern.test(value.lease_token)
    || typeof value.lease_until !== 'string' || !Number.isFinite(Date.parse(value.lease_until))
    || Date.parse(value.lease_until) <= Date.now()
    || !Array.isArray(value.recipients) || value.recipients.length !== 1
    || typeof value.recipients[0] !== 'string' || !isValidEmailAddress(value.recipients[0])
    || !isRecord(value.payload)) return null;
  const payload = value.payload;
  if (typeof payload.invoice_id !== 'string' || !uuidPattern.test(payload.invoice_id)
    || typeof payload.invoice_number !== 'string'
    || !/^(?:INV|WB)-\d{4}-\d{6,}$/.test(payload.invoice_number)) return null;
  return value as unknown as NotificationJob;
}

async function readPdf(response: Response): Promise<Uint8Array> {
  if (!response.ok) throw new Error('Waybill PDF unavailable');
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/pdf') throw new Error('Waybill PDF unavailable');
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxPdfBytes)) {
    throw new Error('Waybill PDF unavailable');
  }
  if (!response.body) throw new Error('Waybill PDF unavailable');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.length;
      if (totalBytes > maxPdfBytes) throw new Error('Waybill PDF unavailable');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  if (totalBytes < 5) throw new Error('Waybill PDF unavailable');
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('Waybill PDF unavailable');
  return bytes;
}

function applyRecipientSink(emailRequest: Record<string, unknown>): Record<string, unknown> {
  const routed = { ...emailRequest };
  for (const key of Object.keys(routed)) {
    if (key.toLowerCase() === 'cc' || key.toLowerCase() === 'bcc') delete routed[key];
  }
  routed.to = [developmentTestRecipient];
  return routed;
}

export async function processNotifications(config: WorkerConfig, batchLimit = 1, http: typeof fetch = fetch) {
  if (!config.deliveryEnabled) throw new Error('Waybill notification delivery is disabled');
  if (!isValidSender(config.sender) || !config.supabaseUrl || !config.serviceRoleKey
    || !config.resendApiKey || !Number.isInteger(batchLimit) || batchLimit < 1 || batchLimit > 2) {
    throw new Error('Waybill notification worker is not configured');
  }
  const waybillClientEmail = config.waybillClientEmail && isValidEmailAddress(config.waybillClientEmail)
    ? config.waybillClientEmail : null;
  const canaryEnabled = config.canaryEnabled === true;
  const canaryInvoiceId = config.canaryInvoiceId?.trim().toLowerCase() ?? '';
  if ((!canaryEnabled && canaryInvoiceId !== '')
    || (canaryEnabled && (!uuidPattern.test(canaryInvoiceId)
      || !config.recipientSinkEnabled || !isDevelopmentProjectUrl(config.supabaseUrl)))) {
    throw new Error('Notification canary configuration is invalid');
  }
  if (config.recipientSinkEnabled && (!canaryEnabled || !isDevelopmentProjectUrl(config.supabaseUrl))) {
    throw new Error('Recipient sink is restricted to an isolated DEVELOPMENT canary');
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
    if (!response.ok) throw new Error('Database operation failed');
    return await response.json() as T;
  };

  let reconciliationFailed = false;
  let claimedJobs: unknown;
  if (canaryEnabled) {
    claimedJobs = await rpc<unknown>('claim_waybill_notification_canary', {
      p_sender: config.sender,
      p_invoice_id: canaryInvoiceId,
      p_company_recipient: waybillClientEmail,
      p_limit: batchLimit,
    });
  } else {
    try {
      await rpc<number>('enqueue_waybill_ready_notifications', {
        p_company_recipient: waybillClientEmail,
      });
    } catch {
      reconciliationFailed = true;
    }

    claimedJobs = await rpc<unknown>('claim_waybill_notifications', {
      p_sender: config.sender,
      p_limit: batchLimit,
    });
  }
  if (!Array.isArray(claimedJobs)) throw new Error('Notification claim response is invalid');

  let sent = 0;
  let deferred = 0;
  let unacknowledged = 0;
  await Promise.all(claimedJobs.map(async value => {
    const job = parseJob(value);
    if (!job) {
      unacknowledged++;
      return;
    }
    if (canaryEnabled && ((job.payload as Record<string, unknown>).invoice_id !== canaryInvoiceId
      || (job.payload as Record<string, unknown>).invoice_number !== 'WB-9999-999999')) {
      unacknowledged++;
      return;
    }
    const copyKind = job.audience === 'driver' ? 'driver' : 'company';
    const recipient = (job.recipients as string[])[0];
    const recipientAllowed = job.audience === 'driver'
      || (waybillClientEmail !== null && recipient.toLowerCase() === waybillClientEmail.toLowerCase());
    let failure = 'Waybill PDF attachment unavailable';
    let providerMessageId: string | null = null;

    try {
      if (!recipientAllowed) throw new Error('Recipient configuration mismatch');
      const invoiceId = (job.payload as Record<string, unknown>).invoice_id as string;
      const invoiceNumber = (job.payload as Record<string, unknown>).invoice_number as string;
      const pdfRows = await rpc<unknown>('get_waybill_notification_pdf', {
        p_notification_id: job.id,
        p_lease_token: job.lease_token,
      });
      const metadata = Array.isArray(pdfRows) && pdfRows.length === 1 && isRecord(pdfRows[0])
        ? pdfRows[0] as unknown as NotificationPdf
        : null;
      const expectedCopyKind = copyKind;
      const expectedBucket = copyKind === 'driver' ? 'waybill-driver-copies' : 'waybill-company-copies';
      if (!metadata || metadata.invoice_id !== invoiceId || metadata.invoice_number !== invoiceNumber
        || metadata.copy_kind !== expectedCopyKind || metadata.storage_bucket !== expectedBucket
        || !expectedWaybillPath(invoiceNumber, copyKind, metadata.storage_path)) {
        throw new Error('Waybill PDF metadata is invalid');
      }

      const objectPath = metadata.storage_path.split('/').map(encodeURIComponent).join('/');
      const pdfResponse = await http(`${config.supabaseUrl}/storage/v1/object/${expectedBucket}/${objectPath}`, {
        method: 'GET',
        headers: {
          apikey: config.serviceRoleKey,
          Authorization: `Bearer ${config.serviceRoleKey}`,
        },
        signal: AbortSignal.timeout(30_000),
      });
      const pdf = await readPdf(pdfResponse);
      const emailRequest: Record<string, unknown> = {
        from: config.sender,
        to: [recipient],
        subject: `TRAKFLIT Waybill ${invoiceNumber}`,
        text: `The ${copyKind === 'driver' ? 'Driver' : 'Company'} Waybill PDF is attached.\nWaybill Number: ${invoiceNumber}`,
        attachments: [{ filename: `${invoiceNumber}-${copyKind}.pdf`, content: encodeBase64(pdf) }],
      };
      const request = config.recipientSinkEnabled ? applyRecipientSink(emailRequest) : emailRequest;
      failure = 'Provider acceptance is uncertain';
      const providerResponse = await http('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.resendApiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `waybill-notification/${job.id}`,
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(20_000),
      });
      if (!providerResponse.ok) {
        failure = `Provider rejected delivery (HTTP ${providerResponse.status})`;
      } else {
        const data: unknown = await providerResponse.json();
        if (isRecord(data) && typeof data.id === 'string' && data.id.length > 0 && data.id.length <= 255) {
          providerMessageId = data.id;
        }
      }
    } catch {
      failure = failure === 'Provider acceptance is uncertain'
        ? failure
        : 'Waybill PDF attachment unavailable';
    }

    try {
      const acknowledged = await rpc<boolean>('finish_trip_notification', {
        p_id: job.id,
        p_lease_token: job.lease_token,
        p_sent: providerMessageId !== null,
        p_provider_message_id: providerMessageId,
        p_error: providerMessageId === null ? failure : null,
      });
      if (!acknowledged) unacknowledged++;
      else if (providerMessageId !== null) sent++;
      else deferred++;
    } catch {
      unacknowledged++;
    }
  }));
  return {
    claimed: claimedJobs.length,
    sent,
    deferred,
    unacknowledged,
    reconciliationFailed,
    targetCompanyConfigured: waybillClientEmail !== null,
  };
}
