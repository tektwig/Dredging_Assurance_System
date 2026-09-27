export interface WaybillSnapshot {
  invoice_number: string;
  trip_number: string;
  truck_registration: string;
  truck_type: string | null;
  truck_capacity_tonnes: number | string | null;
  truck_owner_name: string | null;
  driver_name: string;
  driver_phone: string | null;
  driver_email: string | null;
  driver_license: string | null;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  loading_site_name: string;
  offloading_site_name: string;
  quantity_tonnes: number | string;
  opened_at: string;
  closed_at: string;
  loading_officer_name: string | null;
  offloading_officer_name: string | null;
  issued_at: string;
}

export interface WorkerConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
}

interface PdfJob {
  id: string;
  invoice_id: string;
  trip_id: string;
  invoice_number: string;
  storage_path: string;
  lease_token: string;
}

export type PdfFailureCode =
  | 'invoice_snapshot_unavailable'
  | 'invalid_invoice_snapshot'
  | 'pdf_generation_failed'
  | 'storage_upload_failed';

export type PdfGenerator = (snapshot: WaybillSnapshot) => Promise<Uint8Array>;

const expectedStoragePath = (invoiceNumber: string): string | null => {
  const match = /^INV-(\d{4})-\d{6,}$/.exec(invoiceNumber);
  return match ? `${match[1]}/${invoiceNumber}.pdf` : null;
};

export async function processWaybillPdfs(
  config: WorkerConfig,
  generatePdf: PdfGenerator,
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
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('Database operation failed');
    return await response.json() as T;
  };

  const jobs = await rpc<PdfJob[]>('claim_waybill_pdf_jobs', { p_limit: batchLimit });
  let ready = 0;
  let deferred = 0;
  let unacknowledged = 0;

  for (const job of jobs) {
    let failureCode: PdfFailureCode | null = null;
    let snapshot: WaybillSnapshot | null = null;
    try {
      const rows = await rpc<WaybillSnapshot[]>('get_waybill_pdf_snapshot', {
        p_document_id: job.id,
        p_lease_token: job.lease_token,
      });
      if (rows.length !== 1) throw new Error('Snapshot unavailable');
      snapshot = rows[0];
    } catch {
      failureCode = 'invoice_snapshot_unavailable';
    }

    if (snapshot) {
      const storagePath = expectedStoragePath(snapshot.invoice_number);
      if (!storagePath || storagePath !== job.storage_path || snapshot.invoice_number !== job.invoice_number) {
        failureCode = 'invalid_invoice_snapshot';
      } else {
        let pdf: Uint8Array | null = null;
        try {
          pdf = await generatePdf(snapshot);
        } catch {
          failureCode = 'pdf_generation_failed';
        }
        if (pdf) {
          try {
            const objectPath = storagePath.split('/').map(encodeURIComponent).join('/');
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
            if (!response.ok) throw new Error('Storage upload failed');
          } catch {
            failureCode = 'storage_upload_failed';
          }
        }
      }
    }

    try {
      const acknowledged = await rpc<boolean>('finish_waybill_pdf_job', {
        p_id: job.id,
        p_lease_token: job.lease_token,
        p_succeeded: failureCode === null,
        p_failure_code: failureCode,
      });
      if (!acknowledged) unacknowledged++;
      else if (failureCode === null) ready++;
      else deferred++;
    } catch {
      unacknowledged++;
    }
  }

  return { claimed: jobs.length, ready, deferred, unacknowledged };
}
