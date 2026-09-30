import { supabase } from '../../../lib/supabase';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, normalizePageRequest } from '../../../types/listQuery';

const roles = ['system_administrator', 'loading_officer', 'offloading_officer',
  'operations_manager', 'finance_officer', 'audit_reviewer'] as const;
const tripStatuses = ['open', 'closed', 'cancelled'] as const;
const pdfStatuses = ['pending', 'processing', 'ready', 'failed'] as const;
const exceptionStatuses = ['open', 'in_review', 'resolved'] as const;

export type OperationsTripStatus = typeof tripStatuses[number];
export type OperationsTripFilters = {
  search: string;
  status: '' | OperationsTripStatus;
  dateFrom: string;
  dateTo: string;
  truck: string;
  driver: string;
  loadingSite: string;
  offloadingSite: string;
};
export type OperationsTripRow = {
  trip_id: string;
  trip_number: string;
  truck_id: string;
  truck_registration: string;
  driver_id: string;
  driver_name: string;
  loading_site_id: string;
  loading_site_name: string;
  opened_at: string;
  offloading_site_id: string | null;
  offloading_site_name: string | null;
  closed_at: string | null;
  quantity_tonnes: number | null;
  status: OperationsTripStatus;
};
export type OperationsTripsPage = {
  items: OperationsTripRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  hasNext: boolean;
};
export type OperationsTripOfficer = {
  officer_id: string;
  display_name: string | null;
  role: typeof roles[number] | null;
};
export type OperationsTripDetailRecord = {
  trip_id: string;
  trip_number: string;
  status: OperationsTripStatus;
  truck_id: string;
  truck_registration: string;
  driver_id: string;
  driver_name: string;
  loading_site_id: string;
  loading_site_name: string;
  opened_at: string;
  loading_officer: OperationsTripOfficer | null;
  offloading_site_id: string | null;
  offloading_site_name: string | null;
  closed_at: string | null;
  quantity_tonnes: number | null;
  estimated_quantity_tonnes: number | null;
  offloading_officer: OperationsTripOfficer | null;
  cancelled_at: string | null;
  cancelled_officer: OperationsTripOfficer | null;
};
export type OperationsTripDetail = {
  trip: OperationsTripDetailRecord;
  waybill: { invoice_number: string; issued_at: string; pdf_status: typeof pdfStatuses[number] | null } | null;
  payout: {
    status: 'payment_details_required' | 'pending' | 'paid';
    created_at: string;
    payment_ready_at: string | null;
    paid_at: string | null;
  } | null;
  exceptions: Array<{
    exception_id: string;
    exception_type: string;
    status: typeof exceptionStatuses[number];
    raised_at: string;
    resolved_at: string | null;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length
    && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function text(value: unknown): value is string {
  return typeof value === 'string';
}

function nullableText(value: unknown): value is string | null {
  return value === null || text(value);
}

function timestamp(value: unknown): value is string {
  return text(value) && Number.isFinite(Date.parse(value));
}

function nullableTimestamp(value: unknown): value is string | null {
  return value === null || timestamp(value);
}

function validTonnage(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0
    && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001);
}

function parseTripRow(value: unknown): OperationsTripRow {
  const keys = ['trip_id', 'trip_number', 'truck_id', 'truck_registration', 'driver_id', 'driver_name',
    'loading_site_id', 'loading_site_name', 'opened_at', 'offloading_site_id', 'offloading_site_name',
    'closed_at', 'quantity_tonnes', 'status'];
  if (!isRecord(value) || !exactKeys(value, keys) || !text(value.trip_id) || !text(value.trip_number)
    || !text(value.truck_id) || !text(value.truck_registration) || !text(value.driver_id)
    || !text(value.driver_name) || !text(value.loading_site_id) || !text(value.loading_site_name)
    || !timestamp(value.opened_at) || !nullableText(value.offloading_site_id)
    || !nullableText(value.offloading_site_name) || !nullableTimestamp(value.closed_at)
    || !validTonnage(value.quantity_tonnes) || !tripStatuses.includes(value.status as OperationsTripStatus)) {
    throw new Error('Invalid Operations Trips response');
  }
  return value as OperationsTripRow;
}

export function parseOperationsTripsPage(value: unknown, request: { page: number; pageSize: number }): OperationsTripsPage {
  if (!isRecord(value) || !exactKeys(value, ['items', 'page', 'page_size', 'total_count', 'has_next'])
    || !Array.isArray(value.items) || value.items.length > request.pageSize
    || value.page !== request.page || value.page_size !== request.pageSize
    || typeof value.total_count !== 'number' || !Number.isSafeInteger(value.total_count) || value.total_count < 0
    || typeof value.has_next !== 'boolean') {
    throw new Error('Invalid Operations Trips response');
  }
  return {
    items: value.items.map(parseTripRow),
    page: value.page,
    pageSize: value.page_size,
    totalCount: value.total_count,
    hasNext: value.has_next,
  };
}

function parseOfficer(value: unknown): OperationsTripOfficer | null {
  if (value === null) return null;
  if (!isRecord(value) || !exactKeys(value, ['officer_id', 'display_name', 'role'])
    || !text(value.officer_id) || !nullableText(value.display_name)
    || (value.role !== null && !roles.includes(value.role as typeof roles[number]))) {
    throw new Error('Invalid Operations Trips response');
  }
  return value as OperationsTripOfficer;
}

export function parseOperationsTripDetail(value: unknown): OperationsTripDetail | null {
  if (value === null) return null;
  if (!isRecord(value) || !exactKeys(value, ['trip', 'waybill', 'payout', 'exceptions']) || !isRecord(value.trip)) {
    throw new Error('Invalid Operations Trips response');
  }
  const trip = value.trip;
  const tripKeys = ['trip_id', 'trip_number', 'status', 'truck_id', 'truck_registration', 'driver_id', 'driver_name',
    'loading_site_id', 'loading_site_name', 'opened_at', 'loading_officer', 'offloading_site_id',
    'offloading_site_name', 'closed_at', 'quantity_tonnes', 'estimated_quantity_tonnes', 'offloading_officer', 'cancelled_at', 'cancelled_officer'];
  if (!exactKeys(trip, tripKeys) || !text(trip.trip_id) || !text(trip.trip_number)
    || !tripStatuses.includes(trip.status as OperationsTripStatus) || !text(trip.truck_id)
    || !text(trip.truck_registration) || !text(trip.driver_id) || !text(trip.driver_name)
    || !text(trip.loading_site_id) || !text(trip.loading_site_name) || !timestamp(trip.opened_at)
    || !nullableText(trip.offloading_site_id) || !nullableText(trip.offloading_site_name)
    || !nullableTimestamp(trip.closed_at) || !validTonnage(trip.quantity_tonnes)
    || !validTonnage(trip.estimated_quantity_tonnes)
    || !nullableTimestamp(trip.cancelled_at)) {
    throw new Error('Invalid Operations Trips response');
  }
  const loadingOfficer = parseOfficer(trip.loading_officer);
  const offloadingOfficer = parseOfficer(trip.offloading_officer);
  const cancelledOfficer = parseOfficer(trip.cancelled_officer);
  if ((trip.offloading_site_id === null) !== (trip.offloading_site_name === null)
    || (trip.cancelled_at === null) !== (cancelledOfficer === null)) {
    throw new Error('Invalid Operations Trips response');
  }

  let waybill: OperationsTripDetail['waybill'] = null;
  if (value.waybill !== null) {
    if (!isRecord(value.waybill) || !exactKeys(value.waybill, ['invoice_number', 'issued_at', 'pdf_status'])
      || !text(value.waybill.invoice_number) || !timestamp(value.waybill.issued_at)
      || (value.waybill.pdf_status !== null && !pdfStatuses.includes(value.waybill.pdf_status as typeof pdfStatuses[number]))) {
      throw new Error('Invalid Operations Trips response');
    }
    waybill = value.waybill as OperationsTripDetail['waybill'];
  }

  let payout: OperationsTripDetail['payout'] = null;
  if (value.payout !== null) {
    if (!isRecord(value.payout) || !exactKeys(value.payout, ['status', 'created_at', 'payment_ready_at', 'paid_at'])
      || !['payment_details_required', 'pending', 'paid'].includes(value.payout.status as string)
      || !timestamp(value.payout.created_at) || !nullableTimestamp(value.payout.payment_ready_at)
      || !nullableTimestamp(value.payout.paid_at)) {
      throw new Error('Invalid Operations Trips response');
    }
    payout = value.payout as OperationsTripDetail['payout'];
  }

  if (!Array.isArray(value.exceptions) || !value.exceptions.every(exception => isRecord(exception)
    && exactKeys(exception, ['exception_id', 'exception_type', 'status', 'raised_at', 'resolved_at'])
    && text(exception.exception_id) && text(exception.exception_type)
    && exceptionStatuses.includes(exception.status as typeof exceptionStatuses[number])
    && timestamp(exception.raised_at) && nullableTimestamp(exception.resolved_at))) {
    throw new Error('Invalid Operations Trips response');
  }
  const status = trip.status as OperationsTripStatus;
  if (status === 'open' && (trip.closed_at !== null || trip.offloading_site_id !== null
      || trip.quantity_tonnes !== null || offloadingOfficer !== null || trip.cancelled_at !== null
      || cancelledOfficer !== null || waybill !== null || payout !== null)
    || status === 'closed' && (trip.closed_at === null || trip.offloading_site_id === null
      || trip.quantity_tonnes === null || offloadingOfficer === null || trip.cancelled_at !== null
      || cancelledOfficer !== null)
    || status === 'cancelled' && (trip.cancelled_at === null || cancelledOfficer === null
      || trip.closed_at !== null || trip.offloading_site_id !== null || trip.quantity_tonnes !== null
      || offloadingOfficer !== null || waybill !== null || payout !== null)) {
    throw new Error('Invalid Operations Trips response');
  }
  const parsedTrip = {
    ...trip,
    loading_officer: loadingOfficer,
    offloading_officer: offloadingOfficer,
    cancelled_officer: cancelledOfficer,
  } as OperationsTripDetailRecord;
  return { trip: parsedTrip, waybill, payout, exceptions: value.exceptions as OperationsTripDetail['exceptions'] };
}

function rpcClient() {
  if (!supabase) throw new Error('Operations Trips unavailable');
  return supabase;
}

function safeRpcError(error: { code?: string } | null, action: string): never {
  if (error?.code === '42501') throw new Error('Operations Trips access denied');
  throw new Error(`Unable to ${action} Operations trip`);
}

export async function loadOperationsTrips(filters: OperationsTripFilters, page: number, pageSize = DEFAULT_PAGE_SIZE) {
  const request = normalizePageRequest(page, pageSize);
  const result = await rpcClient().rpc('get_operations_trips', {
    p_page: request.page,
    p_page_size: request.pageSize,
    p_search: filters.search.trim() || null,
    p_status: filters.status || null,
    p_date_from: filters.dateFrom || null,
    p_date_to: filters.dateTo || null,
    p_truck_filter: filters.truck.trim() || null,
    p_driver_filter: filters.driver.trim() || null,
    p_loading_site_filter: filters.loadingSite.trim() || null,
    p_offloading_site_filter: filters.offloadingSite.trim() || null,
  });
  if (result.error) safeRpcError(result.error, 'load');
  return parseOperationsTripsPage(result.data, request);
}

export async function loadOperationsTripDetail(tripId: string): Promise<OperationsTripDetail | null> {
  const result = await rpcClient().rpc('get_operations_trip_detail', { p_trip_id: tripId });
  if (result.error) safeRpcError(result.error, 'load');
  return parseOperationsTripDetail(result.data);
}

export type OperationsTripCancellation = {
  outcome: 'cancelled' | 'conflict' | 'failed' | 'denied';
  trip: OperationsTripDetail | null;
};

export async function cancelOperationsTripAndRefresh(tripId: string, reason: string): Promise<OperationsTripCancellation> {
  if (!reason.trim()) throw new Error('A cancellation reason is required');
  let error: { code?: string } | null = null;
  try {
    const result = await rpcClient().rpc('cancel_trip', { p_trip_id: tripId, p_reason: reason.trim() });
    error = result.error;
  } catch {
    error = { code: 'NETWORK' };
  }

  const trip = await loadOperationsTripDetail(tripId);
  if (error?.code === '42501') return { outcome: 'denied', trip };
  if (error) return { outcome: error.code === '22023' && trip && trip.trip.status !== 'open' ? 'conflict' : 'failed', trip };
  return { outcome: trip?.trip.status === 'cancelled' ? 'cancelled' : 'conflict', trip };
}

export const OPERATIONS_TRIPS_PAGE_SIZE = DEFAULT_PAGE_SIZE;
export const OPERATIONS_TRIPS_MAX_PAGE_SIZE = MAX_PAGE_SIZE;
