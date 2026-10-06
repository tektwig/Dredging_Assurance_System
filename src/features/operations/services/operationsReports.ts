import { supabase } from '../../../lib/supabase';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, normalizePageRequest } from '../../../types/listQuery';

export const OPERATIONS_REPORT_KINDS = ['trips', 'performance', 'waybills', 'exceptions'] as const;
export type OperationsReportKind = typeof OPERATIONS_REPORT_KINDS[number];
export type ReportFilters = Record<string, string | boolean>;
export type ReportRow = Record<string, string | number | boolean | null>;
export type OperationsReportPage = {
  summary: Record<string, number>;
  items: ReportRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
};
export type OperationsReportExport = {
  exportId: string;
  reportKind: OperationsReportKind;
  format: 'csv' | 'xlsx';
  filters: ReportFilters;
  summary: Record<string, number>;
  items: ReportRow[];
  rowCount: number;
  generatedAt: string;
};

const reportColumns: Record<OperationsReportKind, readonly [string, string][]> = {
  trips: [['trip_number', 'Trip #'], ['truck_plate', 'Truck'], ['driver_name', 'Driver'],
    ['loading_site', 'Loading Site'], ['offloading_site', 'Offloading Site'], ['opened_at', 'Opened At'],
    ['closed_at', 'Closed At'], ['cancelled_at', 'Cancelled At'], ['estimated_tonnage_tonnes', 'Estimated Tonnage'],
    ['tonnage_tonnes', 'Actual Tonnage'], ['status', 'Status']],
  performance: [['label', 'Truck / Driver / Site'], ['trip_count', 'Trips'], ['closed_count', 'Closed Trips'],
    ['tonnage_tonnes', 'Tonnage']],
  waybills: [['waybill_number', 'Waybill #'], ['trip_number', 'Trip #'], ['truck_plate', 'Truck'],
    ['driver_name', 'Driver'], ['tonnage_tonnes', 'Tonnage'], ['issued_at', 'Issued At'], ['pdf_status', 'PDF Status'],
    ['driver_delivery_status', 'Driver Delivery'], ['internal_delivery_status', 'Internal Delivery'], ['payout_status', 'Payout Status']],
  exceptions: [['exception_type', 'Type'], ['status', 'Status'], ['blocks_operations', 'Blocking'],
    ['count', 'Count'], ['first_raised_at', 'First Raised'], ['last_raised_at', 'Last Raised']],
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => key in value);
}

function safeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function safeCell(value: unknown): value is ReportRow[string] {
  return value === null || typeof value === 'string' || typeof value === 'boolean'
    || typeof value === 'number' && Number.isFinite(value);
}

function validateRows(kind: OperationsReportKind, value: unknown): value is ReportRow[] {
  if (!Array.isArray(value)) return false;
  const keys: Record<OperationsReportKind, readonly string[]> = {
    trips: ['trip_id', 'trip_number', 'truck_id', 'truck_plate', 'driver_id', 'driver_name', 'loading_site_id',
      'loading_site', 'offloading_site_id', 'offloading_site', 'opened_at', 'closed_at', 'cancelled_at',
      'estimated_tonnage_tonnes', 'tonnage_tonnes', 'status'],
    performance: ['entity_id', 'label', 'trip_count', 'closed_count', 'tonnage_tonnes'],
    waybills: ['invoice_id', 'invoice_number', 'trip_number', 'truck_plate', 'driver_name', 'tonnage_tonnes',
      'issued_at', 'pdf_status', 'driver_delivery_status', 'internal_delivery_status', 'payout_status'],
    exceptions: ['exception_type', 'status', 'blocks_operations', 'count', 'first_raised_at', 'last_raised_at'],
  };
  return value.every(row => record(row) && exactKeys(row, keys[kind]) && Object.values(row).every(safeCell));
}

function mapReportRows(kind: OperationsReportKind, rows: ReportRow[]): ReportRow[] {
  if (kind !== 'waybills') return rows;
  return rows.map(row => {
    const { invoice_id, invoice_number, ...fields } = row;
    return { ...fields, waybill_id: invoice_id, waybill_number: invoice_number };
  });
}

function validateSummary(value: unknown): value is Record<string, number> {
  return record(value) && Object.values(value).every(safeNumber);
}

function validSummary(kind: OperationsReportKind, value: unknown): value is Record<string, number> {
  const keys: Record<OperationsReportKind, readonly string[]> = {
    trips: ['rows', 'trips_opened', 'trips_closed', 'trips_cancelled', 'open_trips', 'tonnage_tonnes'],
    performance: ['entities', 'trip_count', 'closed_count', 'tonnage_tonnes'],
    waybills: ['waybills', 'pdf_failed', 'delivery_failed', 'payment_details_required', 'pending_payout', 'paid'],
    exceptions: ['groups', 'exceptions', 'requiring_attention', 'blocking'],
  };
  return validateSummary(value) && exactKeys(value, keys[kind]);
}

export function validateReportPage(kind: OperationsReportKind, value: unknown): OperationsReportPage {
  if (!record(value) || !exactKeys(value, ['summary', 'items', 'total_count', 'page', 'page_size', 'has_next'])
    || !validSummary(kind, value.summary) || !validateRows(kind, value.items)
    || !Number.isSafeInteger(value.total_count) || (value.total_count as number) < 0
    || !Number.isSafeInteger(value.page) || (value.page as number) < 1
    || !Number.isSafeInteger(value.page_size) || (value.page_size as number) < 1
    || (value.page_size as number) > MAX_PAGE_SIZE || value.items.length > (value.page_size as number)
    || typeof value.has_next !== 'boolean') throw new Error('Invalid Operations report response');
  return { summary: value.summary, items: mapReportRows(kind, value.items), totalCount: value.total_count as number,
    page: value.page as number, pageSize: value.page_size as number, hasNext: value.has_next };
}

function validateFilters(filters: ReportFilters): ReportFilters {
  const valid: ReportFilters = {};
  for (const [key, value] of Object.entries(filters)) {
    if (!/^(basis|direction|dimension|date_from|date_to|status|truck_id|driver_id|loading_site_id|offloading_site_id|site_id|pdf_status|delivery_status|payout_status|exception_type|blocks_operations)$/.test(key)
      || typeof value !== 'string' && typeof value !== 'boolean') throw new Error('Invalid report filters');
    if (typeof value === 'string' && (value.length > 100 || /[\r\n\0]/.test(value))) throw new Error('Invalid report filters');
    valid[key] = value;
  }
  return valid;
}

export async function loadOperationsReport(kind: OperationsReportKind, filters: ReportFilters, page: number): Promise<OperationsReportPage> {
  if (!supabase) throw new Error('Reports unavailable');
  const request = normalizePageRequest(page, DEFAULT_PAGE_SIZE);
  const result = await supabase.rpc('get_operations_report', {
    p_kind: kind, p_filters: validateFilters(filters), p_page: request.page, p_page_size: request.pageSize,
  });
  if (result.error?.code === '42501') throw new Error('Reports access denied');
  if (result.error) throw new Error('Unable to load report');
  return validateReportPage(kind, result.data);
}

export async function exportOperationsReport(
  kind: OperationsReportKind, filters: ReportFilters, format: 'csv' | 'xlsx',
): Promise<OperationsReportExport> {
  if (!supabase) throw new Error('Reports unavailable');
  const result = await supabase.rpc('export_operations_report', {
    p_kind: kind, p_filters: validateFilters(filters), p_format: format,
  });
  if (result.error?.code === '42501') throw new Error('Reports access denied');
  if (result.error?.details === 'EXPORT_LIMIT_EXCEEDED') throw new Error('Export exceeds 1,000 rows. Narrow the report filters.');
  if (result.error) throw new Error('Unable to export report');
  const value = result.data;
  if (!record(value) || !exactKeys(value, ['export_id', 'report_kind', 'format', 'filters', 'summary', 'items', 'row_count', 'generated_at'])
    || typeof value.export_id !== 'string' || value.report_kind !== kind || value.format !== format
    || !record(value.filters) || !validateFilters(value.filters as ReportFilters)
    || !validSummary(kind, value.summary) || !validateRows(kind, value.items)
    || value.items.length > 1000 || value.row_count !== value.items.length
    || typeof value.generated_at !== 'string' || !Number.isFinite(Date.parse(value.generated_at))) {
    throw new Error('Invalid Operations export response');
  }
  return { exportId: value.export_id, reportKind: kind, format, filters: value.filters as ReportFilters,
    summary: value.summary, items: mapReportRows(kind, value.items), rowCount: value.row_count, generatedAt: value.generated_at };
}

export function reportColumnsFor(kind: OperationsReportKind) {
  return reportColumns[kind];
}

export function buildCsv(kind: OperationsReportKind, rows: ReportRow[]): string {
  const columns = reportColumns[kind];
  const escapeCell = (value: unknown) => {
    let text = value === null || value === undefined ? '' : String(value);
    if (typeof value === 'string' && /^[\s\u0000-\u001f\uFEFF]*[=+\-@＝＋－＠]/u.test(value)) text = `\t${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const csv = [columns.map(([, label]) => escapeCell(label)).join(','),
    ...rows.map(row => columns.map(([key]) => escapeCell(row[key])).join(','))].join('\r\n');
  return `\uFEFF${csv}`;
}

export function downloadCsv(kind: OperationsReportKind, rows: ReportRow[], filename: string) {
  downloadBlob(new Blob([buildCsv(kind, rows)], { type: 'text/csv;charset=utf-8' }), filename);
}

export function makeReportFilename(kind: OperationsReportKind, format: 'csv' | 'xlsx', filters: ReportFilters, generatedAt: string) {
  const from = typeof filters.date_from === 'string' ? filters.date_from : 'all';
  const to = typeof filters.date_to === 'string' ? filters.date_to : 'open';
  const stamp = generatedAt.replace(/[-:]/g, '').replace(/\.\d{3}/, '').replace(/Z$/, 'Z');
  return `operations-${kind}-${from}_to_${to}-${stamp}.${format}`;
}

async function downloadXlsx(kind: OperationsReportKind, rows: ReportRow[], filename: string) {
  const { createXlsxBytes } = await import('./xlsxWriter');
  downloadBlob(new Blob([createXlsxBytes(kind, rows)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }), filename);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function downloadReport(exported: OperationsReportExport) {
  const filename = makeReportFilename(exported.reportKind, exported.format, exported.filters, exported.generatedAt);
  if (exported.format === 'csv') downloadCsv(exported.reportKind, exported.items, filename);
  else await downloadXlsx(exported.reportKind, exported.items, filename);
}
