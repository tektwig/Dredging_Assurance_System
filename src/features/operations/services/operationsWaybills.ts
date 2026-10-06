import { supabase } from '../../../lib/supabase';
import { normalizePageRequest } from '../../../types/listQuery';

export type PdfStatus = 'pending' | 'processing' | 'ready' | 'failed';
export type DeliveryStatus = 'pending' | 'processing' | 'sent' | 'failed' | null;
export type PayoutStatus = 'payment_details_required' | 'pending' | 'paid';
export type WaybillFilters = {
  search: string;
  quickFilter: string;
  dateFrom: string;
  dateTo: string;
  pdfStatus: string;
  deliveryStatus: string;
  payoutStatus: string;
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
  payout_status: PayoutStatus;
  driver_delivery_status: DeliveryStatus;
  internal_delivery_status: DeliveryStatus;
};
export type Page<T> = { items: T[]; page: number; pageSize: number; totalCount: number; hasNext: boolean };
export type WaybillDetail = {
  waybill: {
    id: string; waybill_number: string; trip_id: string; trip_number: string;
    truck_registration: string; truck_type: string | null; truck_capacity_tonnes: number | null;
    truck_owner_name: string | null; driver_name: string; driver_phone: string | null;
    driver_email_available: boolean; driver_license: string | null;
    loading_site_name: string; offloading_site_name: string;
    loading_officer_name: string | null; offloading_officer_name: string | null;
    opened_at: string; closed_at: string; issued_at: string; quantity_tonnes: number;
    closure_account_name: string | null; closure_account_number: string | null; closure_bank_name: string | null;
  };
  document: { status: PdfStatus; storage_path: string | null; ready_at: string | null };
  payment: { id: string; status: PayoutStatus; updated_at: string;
    account_name: string | null; account_number: string | null; bank_name: string | null;
    payment_ready_at: string | null; paid_at: string | null; payment_reference: string | null };
  delivery: { driver: DeliveryStatus; internal: DeliveryStatus };
};
export type DeliveryAttempt = {
  notification_id: string; audience: 'driver' | 'finance' | 'client'; sequence: number;
  status: Exclude<DeliveryStatus, null>; attempts: number; created_at: string;
  sent_at: string | null; requested_reason_code: string | null;
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
function payoutStatus(value: unknown): value is PayoutStatus {
  return value === 'payment_details_required' || value === 'pending' || value === 'paid';
}
function deliveryStatus(value: unknown): value is DeliveryStatus {
  return value === null || value === 'pending' || value === 'processing' || value === 'sent' || value === 'failed';
}
function number(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function waybillStoragePath(number: string): string | null {
  const match = /^(?:INV|WB)-(\d{4})-\d{6,}$/.exec(number);
  return match ? `${match[1]}/${number}.pdf` : null;
}

export function parseWaybillRow(value: unknown): WaybillRow {
  if (!record(value) || !exactKeys(value, ['invoice_id','invoice_number','trip_id','trip_number',
    'truck_registration','driver_name','quantity_tonnes','closed_at','pdf_status','payout_status',
    'driver_delivery_status','internal_delivery_status'])
    || !text(value.invoice_id) || !text(value.invoice_number) || !waybillStoragePath(value.invoice_number)
    || !text(value.trip_id) || !text(value.trip_number) || !text(value.truck_registration)
    || !text(value.driver_name) || !number(value.quantity_tonnes) || !timestamp(value.closed_at)
    || !pdfStatus(value.pdf_status) || !payoutStatus(value.payout_status)
    || !deliveryStatus(value.driver_delivery_status) || !deliveryStatus(value.internal_delivery_status)) {
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
  if (!record(value) || !record(value.invoice) || !record(value.document)
    || !record(value.payment) || !record(value.delivery)
    || !exactKeys(value, ['invoice','document','payment','delivery'])) throw new Error('Invalid Waybill detail response');
  const rawWaybill = value.invoice; const document = value.document;
  const payment = value.payment; const delivery = value.delivery;
  if (!exactKeys(rawWaybill, ['id','invoice_number','trip_id','trip_number','truck_registration','truck_type',
    'truck_capacity_tonnes','truck_owner_name','driver_name','driver_phone','driver_email_available',
    'driver_license','loading_site_name','offloading_site_name','loading_officer_name',
    'offloading_officer_name','opened_at','closed_at','issued_at','quantity_tonnes',
    'closure_account_name','closure_account_number','closure_bank_name'])
    || !exactKeys(document, ['status','storage_path','ready_at'])
    || !exactKeys(payment, ['id','status','updated_at','account_name','account_number','bank_name',
      'payment_ready_at','paid_at','payment_reference'])
    || !exactKeys(delivery, ['driver','internal'])) throw new Error('Invalid Waybill detail response');
  for (const key of ['id','invoice_number','trip_id','trip_number','truck_registration','driver_name',
    'loading_site_name','offloading_site_name'] as const) {
    if (!text(rawWaybill[key])) throw new Error('Invalid Waybill detail response');
  }
  for (const key of ['truck_type','truck_owner_name','driver_phone','driver_license',
    'loading_officer_name','offloading_officer_name'] as const) {
    if (!nullableText(rawWaybill[key])) throw new Error('Invalid Waybill detail response');
  }
  if (!number(rawWaybill.quantity_tonnes) || !(rawWaybill.truck_capacity_tonnes === null || number(rawWaybill.truck_capacity_tonnes))
    || typeof rawWaybill.driver_email_available !== 'boolean'
    || !nullableText(rawWaybill.closure_account_name) || !nullableText(rawWaybill.closure_account_number)
    || !nullableText(rawWaybill.closure_bank_name)
    || !timestamp(rawWaybill.opened_at) || !timestamp(rawWaybill.closed_at) || !timestamp(rawWaybill.issued_at)
    || !pdfStatus(document.status) || !nullableText(document.storage_path) || !nullableTimestamp(document.ready_at)
    || !text(payment.id) || !payoutStatus(payment.status) || !timestamp(payment.updated_at)
    || !nullableText(payment.account_name) || !nullableText(payment.account_number)
    || !nullableText(payment.bank_name) || !nullableText(payment.payment_reference)
    || !nullableTimestamp(payment.payment_ready_at) || !nullableTimestamp(payment.paid_at)
    || !deliveryStatus(delivery.driver) || !deliveryStatus(delivery.internal)) {
    throw new Error('Invalid Waybill detail response');
  }
  if (document.status === 'ready') {
    if (document.storage_path !== waybillStoragePath(rawWaybill.invoice_number as string)) {
      throw new Error('Invalid Waybill PDF path');
    }
  }
  const { invoice_number, ...waybillFields } = rawWaybill;
  return { waybill: { ...waybillFields, waybill_number: invoice_number as string } as WaybillDetail['waybill'],
    document: document as WaybillDetail['document'], payment: payment as WaybillDetail['payment'],
    delivery: delivery as WaybillDetail['delivery'] };
}

function parseAttempt(value: unknown): DeliveryAttempt {
  if (!record(value) || !exactKeys(value, ['notification_id','audience','sequence','status','attempts',
    'created_at','sent_at','requested_reason_code'])
    || !text(value.notification_id) || !['driver','finance','client'].includes(value.audience as string)
    || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0
    || !deliveryStatus(value.status) || value.status === null
    || !Number.isSafeInteger(value.attempts) || (value.attempts as number) < 0
    || !timestamp(value.created_at) || !nullableTimestamp(value.sent_at)
    || !nullableText(value.requested_reason_code)) throw new Error('Invalid delivery history response');
  return value as DeliveryAttempt;
}

export async function loadWaybills(filters: WaybillFilters, page: number): Promise<Page<WaybillRow>> {
  const request = normalizePageRequest(page, 25);
  const result = await client().rpc('get_operations_waybills', {
    p_page: request.page, p_page_size: request.pageSize,
    p_search: filters.search.trim() || null, p_quick_filter: filters.quickFilter || null,
    p_date_from: filters.dateFrom || null, p_date_to: filters.dateTo || null,
    p_pdf_status: filters.pdfStatus || null, p_delivery_status: filters.deliveryStatus || null,
    p_payout_status: filters.payoutStatus || null,
  });
  if (result.error) safeError(result.error, 'load');
  return parsePage(result.data, request.page, request.pageSize, parseWaybillRow);
}

export async function loadWaybillDetail(waybillId: string): Promise<WaybillDetail | null> {
  const result = await client().rpc('get_operations_waybill_detail', { p_invoice_id: waybillId });
  if (result.error) safeError(result.error, 'load');
  return parseWaybillDetail(result.data);
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

export async function resendWaybill(waybillId: string, audience: 'driver',
  requestId: string, reasonCode: string, duplicateRiskConfirmed: boolean): Promise<void> {
  const result = await client().rpc('resend_operations_waybill', {
    p_invoice_id: waybillId, p_audience: audience, p_request_id: requestId,
    p_reason_code: reasonCode, p_duplicate_risk_confirmed: duplicateRiskConfirmed,
  });
  if (result.error) safeError(result.error, 'resend');
}

export async function retryWaybillDelivery(waybillId: string, audience: 'driver', reasonCode: string): Promise<void> {
  const result = await client().rpc('retry_operations_waybill_delivery', {
    p_invoice_id: waybillId, p_audience: audience, p_reason_code: reasonCode,
  });
  if (result.error) safeError(result.error, 'retry delivery for');
}

export async function completeOperationsPayment(paymentId: string, expectedUpdatedAt: string,
  accountName: string, accountNumber: string, bankName: string): Promise<void> {
  const result = await client().rpc('complete_operations_payment_details', {
    p_payment_id: paymentId, p_expected_updated_at: expectedUpdatedAt,
    p_account_name: accountName.trim(), p_account_number: accountNumber.trim(), p_bank_name: bankName.trim(),
  });
  if (result.error) safeError(result.error, 'complete payment details for');
}

export async function markOperationsPaymentPaid(paymentId: string, expectedUpdatedAt: string,
  paymentReference: string): Promise<void> {
  const result = await client().rpc('mark_operations_payment_paid', {
    p_payment_id: paymentId, p_expected_updated_at: expectedUpdatedAt,
    p_payment_reference: paymentReference.trim(),
  });
  if (result.error) safeError(result.error, 'mark payment paid for');
}
