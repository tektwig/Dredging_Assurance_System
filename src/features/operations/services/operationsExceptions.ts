import { supabase } from '../../../lib/supabase';
import { DEFAULT_PAGE_SIZE, normalizePageRequest } from '../../../types/listQuery';

export const EXCEPTION_STATUSES = ['open', 'in_review', 'resolved'] as const;
export const EXCEPTION_TYPES = ['unknown_truck', 'invalid_driver', 'open_trip_conflict',
  'offloading_mismatch', 'invalid_state', 'dispute'] as const;
export const RESOLUTION_CODES = ['issue_verified_resolved', 'operational_action_completed',
  'referred_for_correction', 'duplicate_exception', 'no_action_required'] as const;
export type ExceptionStatus = typeof EXCEPTION_STATUSES[number];
export type ExceptionType = typeof EXCEPTION_TYPES[number];
export type ResolutionCode = typeof RESOLUTION_CODES[number];
export type ExceptionFilters = {
  search: string; status: '' | ExceptionStatus; type: '' | ExceptionType;
  dateFrom: string; dateTo: string; tripId: string; truckId: string;
};
export type ExceptionRow = {
  exception_id: string; exception_type: ExceptionType; status: ExceptionStatus;
  blocks_operations: boolean; trip_id: string | null; trip_number: string | null;
  truck_id: string | null; truck_registration: string | null; driver_name: string | null;
  created_at: string; updated_at: string;
};
export type ExceptionPage = { items: ExceptionRow[]; page: number; pageSize: number; totalCount: number; hasNext: boolean };
type Officer = { officer_id: string; display_name: string | null };
type HistoryEntry = { occurred_at: string; from_status: ExceptionStatus | null;
  to_status: ExceptionStatus; actor: Officer | null };
export type ExceptionDetail = ExceptionRow & {
  loading_site_name: string | null; offloading_site_name: string | null;
  review_started_at: string | null; resolved_at: string | null;
  resolution_code: ResolutionCode | null; reporter: Officer; reviewer: Officer | null;
  resolver: Officer | null; history: HistoryEntry[];
};
export type TransitionResult = { ok: true; status: ExceptionStatus; updated_at: string }
  | { ok: false; code: 'STALE_EXCEPTION' | 'INVALID_TRANSITION' | 'NOT_FOUND' };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const text = (value: unknown): value is string => typeof value === 'string';
const nullableText = (value: unknown): value is string | null => value === null || text(value);
const timestamp = (value: unknown): value is string => text(value) && Number.isFinite(Date.parse(value));
const nullableTimestamp = (value: unknown): value is string | null => value === null || timestamp(value);
const uuid = (value: unknown): value is string => text(value) && uuidPattern.test(value);
const nullableUuid = (value: unknown): value is string | null => value === null || uuid(value);
const status = (value: unknown): value is ExceptionStatus => EXCEPTION_STATUSES.includes(value as ExceptionStatus);
const type = (value: unknown): value is ExceptionType => EXCEPTION_TYPES.includes(value as ExceptionType);
const nullableStatus = (value: unknown): value is ExceptionStatus | null => value === null || status(value);
const officer = (value: unknown): value is Officer => record(value)
  && exact(value, ['officer_id', 'display_name']) && uuid(value.officer_id) && nullableText(value.display_name);
const nullableOfficer = (value: unknown): value is Officer | null => value === null || officer(value);
const rowKeys = ['exception_id', 'exception_type', 'status', 'blocks_operations', 'trip_id', 'trip_number',
  'truck_id', 'truck_registration', 'driver_name', 'created_at', 'updated_at'];

function parseRow(value: unknown): ExceptionRow {
  if (!record(value) || !exact(value, rowKeys) || !uuid(value.exception_id)
    || !type(value.exception_type) || !status(value.status) || typeof value.blocks_operations !== 'boolean'
    || !nullableUuid(value.trip_id) || !nullableText(value.trip_number) || !nullableUuid(value.truck_id)
    || !nullableText(value.truck_registration) || !nullableText(value.driver_name)
    || !timestamp(value.created_at) || !timestamp(value.updated_at)) {
    throw new Error('Invalid Exceptions response');
  }
  return value as ExceptionRow;
}

export function parseExceptionPage(value: unknown): ExceptionPage {
  if (!record(value) || !exact(value, ['items', 'page', 'page_size', 'total_count', 'has_next'])
    || !Array.isArray(value.items) || !Number.isSafeInteger(value.page) || (value.page as number) < 1
    || !Number.isSafeInteger(value.page_size) || (value.page_size as number) < 1 || (value.page_size as number) > 100
    || !Number.isSafeInteger(value.total_count) || (value.total_count as number) < 0
    || typeof value.has_next !== 'boolean') throw new Error('Invalid Exceptions response');
  return { items: value.items.map(parseRow), page: value.page as number,
    pageSize: value.page_size as number, totalCount: value.total_count as number, hasNext: value.has_next };
}

export function parseExceptionDetail(value: unknown): ExceptionDetail | null {
  if (value === null) return null;
  if (!record(value) || !exact(value, [...rowKeys, 'loading_site_name', 'offloading_site_name',
    'review_started_at', 'resolved_at', 'resolution_code', 'reporter', 'reviewer', 'resolver', 'history'])) {
    throw new Error('Invalid Exceptions response');
  }
  const base = Object.fromEntries(rowKeys.map(key => [key, value[key]]));
  parseRow(base);
  if (!nullableText(value.loading_site_name) || !nullableText(value.offloading_site_name)
    || !nullableTimestamp(value.review_started_at) || !nullableTimestamp(value.resolved_at)
    || !(value.resolution_code === null || RESOLUTION_CODES.includes(value.resolution_code as ResolutionCode))
    || !officer(value.reporter) || !nullableOfficer(value.reviewer) || !nullableOfficer(value.resolver)
    || !Array.isArray(value.history) || value.history.length > 50
    || !value.history.every(entry => record(entry)
      && exact(entry, ['occurred_at', 'from_status', 'to_status', 'actor'])
      && timestamp(entry.occurred_at) && nullableStatus(entry.from_status)
      && status(entry.to_status) && nullableOfficer(entry.actor))) {
    throw new Error('Invalid Exceptions response');
  }
  return value as ExceptionDetail;
}

export function parseTransition(value: unknown): TransitionResult {
  if (!record(value) || typeof value.ok !== 'boolean') throw new Error('Invalid Exceptions response');
  if (value.ok && exact(value, ['ok', 'status', 'updated_at'])
    && status(value.status) && timestamp(value.updated_at)) return value as TransitionResult;
  if (!value.ok && exact(value, ['ok', 'code'])
    && ['STALE_EXCEPTION', 'INVALID_TRANSITION', 'NOT_FOUND'].includes(value.code as string)) {
    return value as TransitionResult;
  }
  throw new Error('Invalid Exceptions response');
}

function client() {
  if (!supabase) throw new Error('Exceptions unavailable');
  return supabase;
}

function checkError(error: { code?: string } | null): never {
  if (error?.code === '42501') throw new Error('Exceptions access denied');
  throw new Error('Unable to complete Exceptions request');
}

export async function loadExceptions(filters: ExceptionFilters, page: number, pageSize = DEFAULT_PAGE_SIZE) {
  const request = normalizePageRequest(page, pageSize);
  for (const value of [filters.tripId, filters.truckId]) {
    if (value.trim() && !uuid(value.trim())) throw new Error('Trip and truck filters require a complete ID');
  }
  for (const value of [filters.dateFrom, filters.dateTo]) {
    if (value && !datePattern.test(value)) throw new Error('Invalid date filter');
  }
  const result = await client().rpc('get_operations_exceptions', {
    p_page: request.page, p_page_size: request.pageSize, p_search: filters.search.trim() || null,
    p_status: filters.status || null, p_type: filters.type || null,
    p_date_from: filters.dateFrom || null, p_date_to: filters.dateTo || null,
    p_trip_id: filters.tripId.trim() || null, p_truck_id: filters.truckId.trim() || null,
  });
  if (result.error) checkError(result.error);
  return parseExceptionPage(result.data);
}

export async function loadExceptionDetail(exceptionId: string): Promise<ExceptionDetail | null> {
  if (!uuid(exceptionId)) throw new Error('Invalid exception ID');
  const result = await client().rpc('get_operations_exception_detail', {
    p_exception_id: exceptionId, p_history_limit: 20,
  });
  if (result.error) checkError(result.error);
  return parseExceptionDetail(result.data);
}

export async function startExceptionReview(exceptionId: string, updatedAt: string): Promise<TransitionResult> {
  const result = await client().rpc('start_operations_exception_review', {
    p_exception_id: exceptionId, p_expected_updated_at: updatedAt,
  });
  if (result.error) checkError(result.error);
  return parseTransition(result.data);
}

export async function resolveException(exceptionId: string, updatedAt: string, code: ResolutionCode): Promise<TransitionResult> {
  if (!RESOLUTION_CODES.includes(code)) throw new Error('Approved resolution code required');
  const result = await client().rpc('resolve_operations_exception', {
    p_exception_id: exceptionId, p_expected_updated_at: updatedAt, p_resolution_code: code,
  });
  if (result.error) checkError(result.error);
  return parseTransition(result.data);
}
