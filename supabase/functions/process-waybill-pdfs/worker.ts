import type {
  CompanyWaybillSnapshot,
  DriverWaybillSnapshot,
  LegacyWaybillSnapshot,
  PdfFailureCode,
  PdfGenerators,
  WaybillPdfJob,
  WorkerConfig,
} from './types.ts';

export type {
  CompanyWaybillSnapshot,
  DriverWaybillSnapshot,
  LegacyWaybillSnapshot,
  PdfFailureCode,
  PdfGenerators,
  WaybillPdfJob,
  WorkerConfig,
} from './types.ts';

export type WaybillSnapshot = LegacyWaybillSnapshot;

interface LegacyPdfJob {
  id: string;
  invoice_id: string;
  trip_id: string;
  invoice_number: string;
  storage_path: string;
  lease_token: string;
}

interface WorkerCounts {
  claimed: number;
  ready: number;
  deferred: number;
  unacknowledged: number;
  legacy_claimed: number;
  driver_claimed: number;
  company_claimed: number;
  claim_errors: number;
}

type CopyKind = 'driver' | 'company';
type AnySecureSnapshot = DriverWaybillSnapshot | CompanyWaybillSnapshot;
type LegacyPdfFailureCode =
  | 'invoice_snapshot_unavailable'
  | 'invalid_invoice_snapshot'
  | 'pdf_generation_failed'
  | 'storage_upload_failed';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const validText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const validTimestamp = (value: unknown): value is string =>
  validText(value) && !Number.isNaN(new Date(value).getTime());

function legacyStoragePath(invoiceNumber: string): string | null {
  const match = /^(?:INV|WB)-(\d{4})-\d{6,}$/.exec(invoiceNumber);
  return match ? `${match[1]}/${invoiceNumber}.pdf` : null;
}

export function expectedWaybillPath(invoiceNumber: string, copyKind: CopyKind, path: string): boolean {
  const match = /^(INV|WB)-(\d{4})-(\d{6,})$/.exec(invoiceNumber);
  if (!match) return false;
  const basePath = `${match[2]}/${invoiceNumber}.pdf`;
  if (copyKind === 'driver') return path === basePath;
  return path === basePath
    || new RegExp(`^${match[2]}/${invoiceNumber}-company-v(?:[2-9]|[1-9][0-9]+)\\.pdf$`).test(path);
}

function parseSecureSnapshot(value: unknown, copyKind: CopyKind, job: WaybillPdfJob): AnySecureSnapshot | null {
  if (!isRecord(value) || typeof value.invoice_number !== 'string' || value.invoice_number !== job.invoice_number) return null;
  const fields = {
    invoice_number: value.invoice_number as string,
    truck_registration: validText(value.truck_registration) ? value.truck_registration : '',
    driver_name: validText(value.driver_name) ? value.driver_name : '',
    loading_site_name: validText(value.loading_site_name) ? value.loading_site_name : '',
    offloading_site_name: validText(value.offloading_site_name) ? value.offloading_site_name : '',
    quantity_tonnes: typeof value.quantity_tonnes === 'number' || typeof value.quantity_tonnes === 'string'
      ? value.quantity_tonnes
      : '',
    opened_at: validTimestamp(value.opened_at) ? value.opened_at : '',
    closed_at: validTimestamp(value.closed_at) ? value.closed_at : '',
    issued_at: validTimestamp(value.issued_at) ? value.issued_at : '',
  };
  if (
    !validText(fields.invoice_number)
    || !validText(fields.truck_registration)
    || !validText(fields.driver_name)
    || !validText(fields.loading_site_name)
    || !validText(fields.offloading_site_name)
    || !Number.isFinite(Number(fields.quantity_tonnes))
    || Number(fields.quantity_tonnes) <= 0
    || !validTimestamp(fields.opened_at)
    || !validTimestamp(fields.closed_at)
    || !validTimestamp(fields.issued_at)
  ) return null;

  if (copyKind === 'driver') return { ...fields, copy_kind: 'driver' };
  const driverPhone = value.driver_phone;
  const bankName = value.bank_name;
  const accountName = value.account_name;
  const accountNumber = value.account_number;
  if (
    !(driverPhone === null || typeof driverPhone === 'string')
    || !validText(bankName)
    || !validText(accountName)
    || typeof accountNumber !== 'string'
    || !/^\d{10}$/.test(accountNumber)
  ) return null;
  return {
    ...fields,
    copy_kind: 'company',
    driver_phone: driverPhone,
    bank_name: bankName,
    account_name: accountName,
    account_number: accountNumber,
  };
}

async function uploadLegacyPdf(
  config: WorkerConfig,
  job: LegacyPdfJob,
  pdf: Uint8Array,
  http: typeof fetch,
) {
  const objectPath = job.storage_path.split('/').map(encodeURIComponent).join('/');
  const response = await http(`${config.supabaseUrl}/storage/v1/object/waybills/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      'Content-Type': 'application/pdf',
      'x-upsert': 'true',
    },
    body: pdf as unknown as BodyInit,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error('Legacy Storage upload failed');
}

async function uploadSecurePdf(
  config: WorkerConfig,
  job: WaybillPdfJob,
  pdf: Uint8Array,
  http: typeof fetch,
) {
  const objectPath = job.storage_path.split('/').map(encodeURIComponent).join('/');
  const url = `${config.supabaseUrl}/storage/v1/object/${job.storage_bucket}/${objectPath}`;
  const headers = {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    'Content-Type': 'application/pdf',
    'x-upsert': 'false',
  };
  const response = await http(url, {
    method: 'POST',
    headers,
    body: pdf as unknown as BodyInit,
    signal: AbortSignal.timeout(30_000),
  });
  if (response.ok) return;
  if (response.status !== 400 && response.status !== 409 && response.status !== 412) {
    throw new Error('Secure Storage upload failed');
  }
  const existing = await http(url, {
    method: 'HEAD',
    headers: { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!existing.ok || existing.headers.get('content-type')?.split(';')[0].trim() !== 'application/pdf') {
    throw new Error('Existing secure PDF object could not be confirmed');
  }
}

async function processLegacyQueue(
  config: WorkerConfig,
  generatePdf: PdfGenerators['legacy'],
  batchLimit: number,
  rpc: <T>(name: string, body: unknown) => Promise<T>,
  http: typeof fetch,
): Promise<Pick<WorkerCounts, 'claimed' | 'ready' | 'deferred' | 'unacknowledged' | 'legacy_claimed'> & { claimErrors: number }> {
  const counts = { claimed: 0, ready: 0, deferred: 0, unacknowledged: 0, legacy_claimed: 0, claimErrors: 0 };
  let jobs: LegacyPdfJob[];
  try {
    const result = await rpc<unknown>('claim_waybill_pdf_jobs', { p_limit: batchLimit });
    if (!Array.isArray(result)) throw new Error('Invalid legacy claim response');
    jobs = result as LegacyPdfJob[];
  } catch {
    counts.claimErrors++;
    return counts;
  }

  counts.claimed = jobs.length;
  counts.legacy_claimed = jobs.length;
  for (const job of jobs) {
    let failureCode: LegacyPdfFailureCode | null = null;
    try {
      const rows = await rpc<unknown>('get_waybill_pdf_snapshot', {
        p_document_id: job.id,
        p_lease_token: job.lease_token,
      });
      if (!Array.isArray(rows) || rows.length !== 1 || !isRecord(rows[0])) {
        throw new Error('Legacy snapshot unavailable');
      }
      const snapshot = rows[0] as unknown as WaybillSnapshot;
      const path = legacyStoragePath(snapshot.invoice_number);
      if (!path || path !== job.storage_path || snapshot.invoice_number !== job.invoice_number) {
        failureCode = 'invalid_invoice_snapshot';
      } else {
        let pdf: Uint8Array | null = null;
        try {
          pdf = await generatePdf(snapshot);
          if (!pdf.length) throw new Error('Empty legacy PDF');
        } catch {
          failureCode = 'pdf_generation_failed';
        }
        if (pdf && failureCode === null) {
          try {
            await uploadLegacyPdf(config, job, pdf, http);
          } catch {
            failureCode = 'storage_upload_failed';
          }
        }
      }
    } catch {
      failureCode = 'invoice_snapshot_unavailable';
    }

    try {
      const acknowledged = await rpc<boolean>('finish_waybill_pdf_job', {
        p_id: job.id,
        p_lease_token: job.lease_token,
        p_succeeded: failureCode === null,
        p_failure_code: failureCode,
      });
      if (!acknowledged) counts.unacknowledged++;
      else if (failureCode === null) counts.ready++;
      else counts.deferred++;
    } catch {
      counts.unacknowledged++;
    }
  }
  return counts;
}

export async function processWaybillPdfs(
  config: WorkerConfig,
  generators: PdfGenerators,
  batchLimit = 5,
  http: typeof fetch = fetch,
) {
  const headers = {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    'Content-Type': 'application/json',
  };
  const rpc = async <T>(name: string, body: unknown): Promise<T> => {
    const response = await http(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('Database operation failed');
    return await response.json() as T;
  };

  const result: WorkerCounts = {
    claimed: 0,
    ready: 0,
    deferred: 0,
    unacknowledged: 0,
    legacy_claimed: 0,
    driver_claimed: 0,
    company_claimed: 0,
    claim_errors: 0,
  };
  const legacy = await processLegacyQueue(config, generators.legacy, batchLimit, rpc, http);
  result.claimed += legacy.claimed;
  result.ready += legacy.ready;
  result.deferred += legacy.deferred;
  result.unacknowledged += legacy.unacknowledged;
  result.legacy_claimed = legacy.legacy_claimed;
  result.claim_errors += legacy.claimErrors;

  const processSecureCopy = async (copyKind: CopyKind) => {
    let jobs: WaybillPdfJob[];
    try {
      const claimRpc = copyKind === 'driver' ? 'claim_driver_waybill_pdf_jobs' : 'claim_company_waybill_pdf_jobs';
      const response = await rpc<unknown>(claimRpc, { p_limit: batchLimit });
      if (!Array.isArray(response)) throw new Error('Invalid secure claim response');
      jobs = response as WaybillPdfJob[];
    } catch {
      result.claim_errors++;
      return;
    }
    result.claimed += jobs.length;
    result[copyKind === 'driver' ? 'driver_claimed' : 'company_claimed'] = jobs.length;

    for (const job of jobs) {
      let failureCode: PdfFailureCode | null = null;
      let pdf: Uint8Array | null = null;
      const expectedBucket = copyKind === 'driver' ? 'waybill-driver-copies' : 'waybill-company-copies';
      if (
        job.storage_bucket !== expectedBucket
        || !expectedWaybillPath(job.invoice_number, copyKind, job.storage_path)
      ) {
        failureCode = 'invalid_snapshot';
      } else {
        try {
          const snapshotRpc = copyKind === 'driver'
            ? 'get_driver_waybill_pdf_snapshot'
            : 'get_company_waybill_pdf_snapshot';
          const snapshot = await rpc<unknown>(snapshotRpc, {
            p_copy_id: job.copy_id,
            p_lease_token: job.lease_token,
          });
          const safeSnapshot = parseSecureSnapshot(snapshot, copyKind, job);
          if (!safeSnapshot) failureCode = snapshot === null ? 'snapshot_unavailable' : 'invalid_snapshot';
          else {
            try {
              pdf = copyKind === 'driver'
                ? await generators.driver(safeSnapshot as DriverWaybillSnapshot)
                : await generators.company(safeSnapshot as CompanyWaybillSnapshot);
              if (!pdf.length) throw new Error('Empty secure PDF');
            } catch {
              failureCode = 'pdf_generation_failed';
            }
          }
        } catch {
          failureCode = 'snapshot_unavailable';
        }
      }

      if (pdf && failureCode === null) {
        try {
          await uploadSecurePdf(config, job, pdf, http);
        } catch {
          failureCode = 'storage_upload_failed';
        }
      }

      try {
        const finishRpc = copyKind === 'driver' ? 'finish_driver_waybill_pdf_job' : 'finish_company_waybill_pdf_job';
        const acknowledged = await rpc<boolean>(finishRpc, {
          p_copy_id: job.copy_id,
          p_lease_token: job.lease_token,
          p_succeeded: failureCode === null,
          p_failure_code: failureCode,
        });
        if (!acknowledged) result.unacknowledged++;
        else if (failureCode === null) result.ready++;
        else result.deferred++;
      } catch {
        result.unacknowledged++;
      }
    }
  };

  await processSecureCopy('driver');
  await processSecureCopy('company');
  return result;
}
