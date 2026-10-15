import { supabase } from '../../../lib/supabase';
import { normalizePageRequest } from '../../../types/listQuery';

export type PdfStatus = 'pending' | 'processing' | 'ready' | 'failed';
export type DeliveryStatus = 'pending' | 'processing' | 'sent' | 'failed'
  | 'blocked_missing_email' | 'blocked_configuration' | null;
export type WaybillPdfCopyKind = 'driver' | 'company';
export type WaybillPdfCopyStatus = PdfStatus | 'blocked_missing_bank_details'
  | 'blocked_bank_details_unverified' | 'not_available';
export type BankVerificationState = 'missing' | 'pending_verification' | 'correction_pending' | 'verified' | 'rejected';
export type WaybillCopyManagementState = {
  invoice_id: string;
  invoice_number: string;
  driver_pdf_status: WaybillPdfCopyStatus;
  driver_pdf_ready_at: string | null;
  company_pdf_status: WaybillPdfCopyStatus;
  company_pdf_ready_at: string | null;
  bank_verification_state: BankVerificationState;
  pending_bank_submission_id: string | null;
  latest_bank_snapshot_version: number | null;
  company_pdf_held_for_missing_bank_details: boolean;
};
export type BankDetailReview = {
  invoice_number: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  submitted_by: string;
  submitted_at: string;
};
export type BankDetailAuditEvent = {
  event_type: 'submitted' | 'correction_submitted' | 'review_viewed' | 'verified'
    | 'correction_verified' | 'rejected';
  occurred_at: string;
  actor_id: string;
  reason_code: string | null;
};
export type WaybillFilters = {
  search: string;
  quickFilter: string;
  dateFrom: string;
  dateTo: string;
  pdfStatus: string;
  deliveryStatus: string;
};
export type WaybillRow = {
  waybill_id: string;
  waybill_number: string;
  trip_id: string;
  trip_number: string;
  truck_registration: string;
  driver_name: string;
  quantity_tonnes: number;
  closed_at: string;
  pdf_status: PdfStatus;
  driver_delivery_status: DeliveryStatus;
  company_delivery_status: DeliveryStatus;
};
export type Page<T> = { items: T[]; page: number; pageSize: number; totalCount: number; hasNext: boolean };
export type WaybillDetail = {
  waybill: {
    id: string; waybill_number: string; trip_id: string; trip_number: string; driver_id: string;
    truck_registration: string; truck_type: string | null; truck_capacity_tonnes: number | null;
    truck_owner_name: string | null; driver_name: string; driver_phone: string | null;
    driver_email_available: boolean; driver_license: string | null;
    loading_site_name: string; offloading_site_name: string;
    loading_officer_name: string | null; offloading_officer_name: string | null;
    opened_at: string; closed_at: string; issued_at: string; quantity_tonnes: number;
  };
  document: { status: PdfStatus; storage_path: string | null; ready_at: string | null };
  delivery: { driver: DeliveryStatus; company: DeliveryStatus };
};
export type DeliveryAttempt = {
  notification_id: string; audience: 'driver' | 'client'; sequence: number;
  status: Exclude<DeliveryStatus, null>; attempts: number; created_at: string;
  sent_at: string | null; requested_reason_code: string | null; blocked_reason_code: string | null;
};

function client() {
  if (!supabase) throw new Error('Waybills unavailable');
  return supabase;
}
function safeError(error: { code?: string } | null, operation: string): never {
  if (error?.code === '42501') throw new Error('Operations Waybills access denied');
  if (error?.code === 'P4091') throw new Error('Record changed or delivery state conflicts. Refresh and review before retrying.');
  throw new Error(`Unable to ${operation} Waybill`);
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function text(value: unknown): value is string { return typeof value === 'string'; }
function nullableText(value: unknown): value is string | null { return value === null || text(value); }
function timestamp(value: unknown): value is string { return text(value) && Number.isFinite(Date.parse(value)); }
function nullableTimestamp(value: unknown): value is string | null { return value === null || timestamp(value); }
function pdfStatus(value: unknown): value is PdfStatus {
  return value === 'pending' || value === 'processing' || value === 'ready' || value === 'failed';
}
function copyStatus(value: unknown): value is WaybillPdfCopyStatus {
  return pdfStatus(value) || value === 'blocked_missing_bank_details'
    || value === 'blocked_bank_details_unverified' || value === 'not_available';
}
function deliveryStatus(value: unknown): value is DeliveryStatus {
  return value === null || value === 'pending' || value === 'processing' || value === 'sent'
    || value === 'failed' || value === 'blocked_missing_email' || value === 'blocked_configuration';
}
function number(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function waybillStoragePath(number: string): string | null {
  const match = /^(?:INV|WB)-(\d{4})-\d{6,}$/.exec(number);
  return match ? `${match[1]}/${number}.pdf` : null;
}
function rows(value: unknown): unknown[] {
  if (value === null) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

export function parseWaybillCopyManagementState(value: unknown): WaybillCopyManagementState {
  const result = rows(value);
  if (result.length !== 1) throw new Error('Invalid Waybill copy management response');
  const row = result[0];
  if (!record(row) || !exactKeys(row, ['invoice_id', 'invoice_number', 'driver_pdf_status',
    'driver_pdf_ready_at', 'company_pdf_status', 'company_pdf_ready_at', 'bank_verification_state',
    'pending_bank_submission_id', 'latest_bank_snapshot_version', 'company_pdf_held_for_missing_bank_details'])
    || !text(row.invoice_id) || !text(row.invoice_number) || !waybillStoragePath(row.invoice_number)
    || !copyStatus(row.driver_pdf_status) || !nullableTimestamp(row.driver_pdf_ready_at)
    || !copyStatus(row.company_pdf_status) || !nullableTimestamp(row.company_pdf_ready_at)
    || !['missing', 'pending_verification', 'correction_pending', 'verified', 'rejected'].includes(row.bank_verification_state as string)
    || !nullableText(row.pending_bank_submission_id)
    || !(row.latest_bank_snapshot_version === null || (Number.isSafeInteger(row.latest_bank_snapshot_version)
      && (row.latest_bank_snapshot_version as number) > 0))
    || typeof row.company_pdf_held_for_missing_bank_details !== 'boolean') {
    throw new Error('Invalid Waybill copy management response');
  }
  return row as WaybillCopyManagementState;
}

function parseCopyDownload(value: unknown, invoiceNumber: string, kind: WaybillPdfCopyKind): {
  bucket: string; path: string;
} {
  const result = rows(value);
  if (result.length !== 1) throw new Error('Waybill PDF is not ready');
  const row = result[0];
  const expectedBucket = kind === 'driver' ? 'waybill-driver-copies' : 'waybill-company-copies';
  const basePath = waybillStoragePath(invoiceNumber);
  if (!basePath) throw new Error('Invalid Waybill PDF download response');
  const companyVersionPrefix = `${basePath.slice(0, basePath.indexOf('/') + 1)}${invoiceNumber}-company-v`;
  const companyVersionSuffix = record(row) && typeof row.storage_path === 'string'
    && row.storage_path.startsWith(companyVersionPrefix) && row.storage_path.endsWith('.pdf')
    ? row.storage_path.slice(companyVersionPrefix.length, -4) : '';
  const validPath = kind === 'driver' ? row && record(row) && row.storage_path === basePath
    : row && record(row) && (row.storage_path === basePath
      || (/^\d+$/.test(companyVersionSuffix) && Number.isSafeInteger(Number(companyVersionSuffix))
        && Number(companyVersionSuffix) >= 2));
  if (!record(row) || !exactKeys(row, ['copy_kind', 'storage_bucket', 'storage_path', 'ready_at'])
    || row.copy_kind !== kind || row.storage_bucket !== expectedBucket || !validPath
    || !timestamp(row.ready_at)) throw new Error('Invalid Waybill PDF download response');
  return { bucket: expectedBucket, path: row.storage_path as string };
}

function parseBankReview(value: unknown): BankDetailReview | null {
  const result = rows(value);
  if (result.length === 0) return null;
  const row = result[0];
  if (result.length !== 1 || !record(row)
    || !exactKeys(row, ['invoice_number', 'bank_name', 'account_name', 'account_number', 'submitted_by', 'submitted_at'])
    || !text(row.invoice_number) || !waybillStoragePath(row.invoice_number)
    || !text(row.bank_name) || !text(row.account_name) || !/^\d{10}$/.test(String(row.account_number))
    || !text(row.submitted_by) || !timestamp(row.submitted_at)) {
    throw new Error('Invalid bank detail review response');
  }
  return row as BankDetailReview;
}

function parseBankAudit(value: unknown): BankDetailAuditEvent[] {
  if (!Array.isArray(value)) throw new Error('Invalid bank detail audit response');
  const events = value.map(item => {
    if (!record(item) || !exactKeys(item, ['event_type', 'occurred_at', 'actor_id', 'reason_code'])
      || !['submitted', 'correction_submitted', 'review_viewed', 'verified', 'correction_verified', 'rejected']
        .includes(item.event_type as string)
      || !timestamp(item.occurred_at) || !text(item.actor_id) || !nullableText(item.reason_code)) {
      throw new Error('Invalid bank detail audit response');
    }
    return item as BankDetailAuditEvent;
  });
  return events;
}

export function parseWaybillRow(value: unknown): WaybillRow {
  if (!record(value) || !exactKeys(value, ['invoice_id','invoice_number','trip_id','trip_number',
    'truck_registration','driver_name','quantity_tonnes','closed_at','pdf_status',
    'driver_delivery_status','company_delivery_status'])
    || !text(value.invoice_id) || !text(value.invoice_number) || !waybillStoragePath(value.invoice_number)
    || !text(value.trip_id) || !text(value.trip_number) || !text(value.truck_registration)
    || !text(value.driver_name) || !number(value.quantity_tonnes) || !timestamp(value.closed_at)
    || !pdfStatus(value.pdf_status)
    || !deliveryStatus(value.driver_delivery_status) || !deliveryStatus(value.company_delivery_status)) {
    throw new Error('Invalid Waybill register response');
  }
  const { invoice_id, invoice_number, ...row } = value;
  return { ...row, waybill_id: invoice_id as string, waybill_number: invoice_number as string } as WaybillRow;
}

function parsePage<T>(value: unknown, page: number, pageSize: number, parseItem: (item: unknown) => T): Page<T> {
  if (!record(value) || !exactKeys(value, ['items','page','page_size','total_count','has_next'])
    || !Array.isArray(value.items) || value.items.length > pageSize
    || value.page !== page || value.page_size !== pageSize || !Number.isSafeInteger(value.total_count)
    || (value.total_count as number) < 0 || typeof value.has_next !== 'boolean') {
    throw new Error('Invalid Waybill page response');
  }
  return { items: value.items.map(parseItem), page, pageSize,
    totalCount: value.total_count as number, hasNext: value.has_next };
}

export function parseWaybillDetail(value: unknown): WaybillDetail | null {
  if (value === null) return null;
  if (!record(value) || !record(value.invoice) || !record(value.document) || !record(value.delivery)
    || !exactKeys(value, ['invoice','document','delivery'])) throw new Error('Invalid Waybill detail response');
  const rawWaybill = value.invoice; const document = value.document;
  const delivery = value.delivery;
  if (!exactKeys(rawWaybill, ['id','invoice_number','trip_id','trip_number','driver_id','truck_registration','truck_type',
    'truck_capacity_tonnes','truck_owner_name','driver_name','driver_phone','driver_email_available',
    'driver_license','loading_site_name','offloading_site_name','loading_officer_name',
    'offloading_officer_name','opened_at','closed_at','issued_at','quantity_tonnes'])
    || !exactKeys(document, ['status','storage_path','ready_at'])
    || !exactKeys(delivery, ['driver','company'])) throw new Error('Invalid Waybill detail response');
  for (const key of ['id','invoice_number','trip_id','trip_number','driver_id','truck_registration','driver_name',
    'loading_site_name','offloading_site_name'] as const) {
    if (!text(rawWaybill[key])) throw new Error('Invalid Waybill detail response');
  }
  for (const key of ['truck_type','truck_owner_name','driver_phone','driver_license',
    'loading_officer_name','offloading_officer_name'] as const) {
    if (!nullableText(rawWaybill[key])) throw new Error('Invalid Waybill detail response');
  }
  if (!number(rawWaybill.quantity_tonnes) || !(rawWaybill.truck_capacity_tonnes === null || number(rawWaybill.truck_capacity_tonnes))
    || typeof rawWaybill.driver_email_available !== 'boolean'
    || !timestamp(rawWaybill.opened_at) || !timestamp(rawWaybill.closed_at) || !timestamp(rawWaybill.issued_at)
    || !pdfStatus(document.status) || !nullableText(document.storage_path) || !nullableTimestamp(document.ready_at)
    || !deliveryStatus(delivery.driver) || !deliveryStatus(delivery.company)) {
    throw new Error('Invalid Waybill detail response');
  }
  if (document.status === 'ready') {
    if (document.storage_path !== waybillStoragePath(rawWaybill.invoice_number as string)) {
      throw new Error('Invalid Waybill PDF path');
    }
  }
  const { invoice_number, ...waybillFields } = rawWaybill;
  return { waybill: { ...waybillFields, waybill_number: invoice_number as string } as WaybillDetail['waybill'],
    document: document as WaybillDetail['document'],
    delivery: delivery as WaybillDetail['delivery'] };
}

function parseAttempt(value: unknown): DeliveryAttempt {
  if (!record(value) || !exactKeys(value, ['notification_id','audience','sequence','status','attempts',
    'created_at','sent_at','requested_reason_code','blocked_reason_code'])
    || !text(value.notification_id) || !['driver','client'].includes(value.audience as string)
    || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0
    || !deliveryStatus(value.status) || value.status === null
    || !Number.isSafeInteger(value.attempts) || (value.attempts as number) < 0
    || !timestamp(value.created_at) || !nullableTimestamp(value.sent_at)
    || !nullableText(value.requested_reason_code) || !nullableText(value.blocked_reason_code)) throw new Error('Invalid delivery history response');
  return value as DeliveryAttempt;
}

export async function loadWaybills(filters: WaybillFilters, page: number): Promise<Page<WaybillRow>> {
  const request = normalizePageRequest(page, 25);
  const result = await client().rpc('get_operations_waybills', {
    p_page: request.page, p_page_size: request.pageSize,
    p_search: filters.search.trim() || null, p_quick_filter: filters.quickFilter || null,
    p_date_from: filters.dateFrom || null, p_date_to: filters.dateTo || null,
    p_pdf_status: filters.pdfStatus || null, p_delivery_status: filters.deliveryStatus || null,
  });
  if (result.error) safeError(result.error, 'load');
  return parsePage(result.data, request.page, request.pageSize, parseWaybillRow);
}

export async function loadWaybillDetail(waybillId: string): Promise<WaybillDetail | null> {
  const result = await client().rpc('get_operations_waybill_detail', { p_invoice_id: waybillId });
  if (result.error) safeError(result.error, 'load');
  return parseWaybillDetail(result.data);
}

export async function loadWaybillCopyManagementState(waybillId: string): Promise<WaybillCopyManagementState> {
  const result = await client().rpc('get_operations_waybill_copy_management_state', { p_invoice_id: waybillId });
  if (result.error) safeError(result.error, 'load Waybill copy status');
  return parseWaybillCopyManagementState(result.data);
}

export async function downloadWaybillCopy(waybillId: string, waybillNumber: string,
  kind: WaybillPdfCopyKind): Promise<void> {
  const result = await client().rpc('get_operations_waybill_pdf_copy', {
    p_invoice_id: waybillId, p_copy_kind: kind,
  });
  if (result.error) safeError(result.error, 'authorize Waybill PDF download');
  const copy = parseCopyDownload(result.data, waybillNumber, kind);
  const download = await client().storage.from(copy.bucket).download(copy.path);
  if (download.error || !download.data) throw new Error('Unable to download Waybill PDF');
  const objectUrl = URL.createObjectURL(download.data);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = `${waybillNumber}-${kind}-copy.pdf`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally { URL.revokeObjectURL(objectUrl); }
}

export async function submitWaybillBankDetails(invoiceId: string, bankName: string,
  accountName: string, accountNumber: string): Promise<string> {
  const cleanBankName = bankName.trim();
  const cleanAccountName = accountName.trim();
  const cleanAccountNumber = accountNumber.trim();
  if (cleanBankName.length < 1 || cleanBankName.length > 200 || cleanAccountName.length < 1
    || cleanAccountName.length > 200 || !/^\d{10}$/.test(cleanAccountNumber)) {
    throw new Error('Enter a bank name, account name and 10-digit account number.');
  }
  const result = await client().rpc('submit_waybill_company_bank_details', {
    p_invoice_id: invoiceId, p_bank_name: cleanBankName,
    p_account_name: cleanAccountName, p_account_number: cleanAccountNumber,
  });
  if (result.error) safeError(result.error, 'submit bank details');
  if (!text(result.data) || !result.data) throw new Error('Unable to submit bank details');
  return result.data;
}

export async function loadWaybillBankSubmissionForReview(submissionId: string): Promise<BankDetailReview | null> {
  const result = await client().rpc('get_waybill_company_bank_submission_for_review', {
    p_submission_id: submissionId,
  });
  if (result.error) safeError(result.error, 'load bank detail review');
  return parseBankReview(result.data);
}

export async function verifyWaybillBankSubmission(submissionId: string, approved: boolean,
  reasonCode: string | null): Promise<'verified' | 'corrected' | 'rejected'> {
  const result = await client().rpc('verify_waybill_company_bank_details', {
    p_submission_id: submissionId, p_approved: approved, p_reason_code: reasonCode,
  });
  if (result.error) safeError(result.error, 'record bank detail decision');
  if (result.data !== 'verified' && result.data !== 'corrected' && result.data !== 'rejected') {
    throw new Error('Unable to record bank detail decision');
  }
  return result.data;
}

export async function loadWaybillBankDetailAudit(invoiceId: string): Promise<BankDetailAuditEvent[]> {
  const result = await client().rpc('get_waybill_bank_detail_audit', { p_invoice_id: invoiceId });
  if (result.error) safeError(result.error, 'load bank detail audit history');
  return parseBankAudit(result.data);
}

export async function loadDeliveryHistory(waybillId: string, page: number): Promise<Page<DeliveryAttempt> | null> {
  const request = normalizePageRequest(page, 25);
  const result = await client().rpc('get_operations_waybill_delivery_history', {
    p_invoice_id: waybillId, p_page: request.page, p_page_size: request.pageSize,
  });
  if (result.error) safeError(result.error, 'load');
  return result.data === null ? null : parsePage(result.data, request.page, request.pageSize, parseAttempt);
}

export async function downloadWaybill(detail: WaybillDetail): Promise<void> {
  if (detail.document.status !== 'ready' || !detail.document.storage_path) throw new Error('PDF not ready');
  if (detail.document.storage_path !== waybillStoragePath(detail.waybill.waybill_number)) {
    throw new Error('Invalid Waybill PDF path');
  }
  const result = await client().storage.from('waybills').download(detail.document.storage_path);
  if (result.error || !result.data) throw new Error('Unable to download Waybill PDF');
  const objectUrl = URL.createObjectURL(result.data);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl; anchor.download = `${detail.waybill.waybill_number}.pdf`;
    document.body.append(anchor); anchor.click(); anchor.remove();
  } finally { URL.revokeObjectURL(objectUrl); }
}

export async function resendWaybill(waybillId: string, audience: 'driver' | 'client',
  requestId: string, reasonCode: string, duplicateRiskConfirmed: boolean): Promise<void> {
  const result = await client().rpc('resend_operations_waybill', {
    p_invoice_id: waybillId, p_audience: audience, p_request_id: requestId,
    p_reason_code: reasonCode, p_duplicate_risk_confirmed: duplicateRiskConfirmed,
  });
  if (result.error) safeError(result.error, 'resend');
}

export async function retryWaybillDelivery(waybillId: string, audience: 'driver' | 'client', reasonCode: string): Promise<void> {
  const result = await client().rpc('retry_operations_waybill_delivery', {
    p_invoice_id: waybillId, p_audience: audience, p_reason_code: reasonCode,
  });
  if (result.error) safeError(result.error, 'retry delivery for');
}
