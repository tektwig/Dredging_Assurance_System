import { supabase } from '../../../lib/supabase';

const eventTypes = ['trip_opened', 'trip_closed', 'trip_cancelled', 'exception_raised',
  'exception_resolved', 'waybill_issued', 'pdf_ready', 'payment_status_changed'] as const;
const roles = ['system_administrator', 'loading_officer', 'offloading_officer',
  'operations_manager', 'finance_officer', 'audit_reviewer'] as const;

export type DashboardPreview = Record<string, unknown>;
export type DashboardActionCategory = { count: number; items: DashboardPreview[] };
export type OperationsDashboardSummary = {
  tripsOpenedToday: number;
  tripsClosedToday: number;
  openTrips: number;
  tonnageToday: number;
  trucksProcessedToday: number;
  exceptionsRequiringAttention: number;
  actionRequired: {
    unresolvedExceptions: DashboardActionCategory;
    failedWaybillPdfs: DashboardActionCategory;
    failedWaybillEmails: DashboardActionCategory;
    paymentDetailsRequired: DashboardActionCategory;
  };
};
export type OperationsDashboardOpenTrip = {
  trip_id: string;
  trip_number: string;
  truck_registration: string;
  driver_name: string;
  loading_site_name: string;
  opened_at: string;
  duration_seconds: number;
  status: 'open';
};
export type OperationsDashboardActivity = {
  event_id: string;
  event_type: typeof eventTypes[number];
  occurred_at: string;
  trip_number: string | null;
  truck_registration: string | null;
  officer_id: string | null;
  officer_name: string | null;
  officer_role: typeof roles[number] | null;
  site_name: string | null;
  payment_status: string | null;
};
export type OperationsDashboardData = {
  summary: OperationsDashboardSummary;
  openTrips: { as_of: string; items: OperationsDashboardOpenTrip[] };
  activity: { as_of: string; items: OperationsDashboardActivity[] };
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length
    && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function date(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function parseCategory(value: unknown, expectedKeys: readonly string[]): DashboardActionCategory {
  if (!record(value) || !exactKeys(value, ['count', 'items']) || !count(value.count)
    || !Array.isArray(value.items) || value.items.length > 5
    || value.count < value.items.length
    || !value.items.every(item => record(item) && exactKeys(item, expectedKeys))) {
    throw new Error('Invalid Operations dashboard response');
  }
  return { count: value.count, items: value.items as DashboardPreview[] };
}

function mapWaybillNumbers(category: DashboardActionCategory): DashboardActionCategory {
  return { ...category, items: category.items.map(item => {
    const { invoice_number, ...fields } = item;
    return { ...fields, waybill_number: invoice_number };
  }) };
}

export function parseOperationsDashboardSummary(value: unknown): OperationsDashboardSummary {
  const keys = ['trips_opened_today', 'trips_closed_today', 'open_trips', 'tonnage_today',
    'trucks_processed_today', 'exceptions_requiring_attention', 'action_required'] as const;
  if (!record(value) || !exactKeys(value, keys) || !count(value.trips_opened_today)
    || !count(value.trips_closed_today) || !count(value.open_trips)
    || typeof value.tonnage_today !== 'number' || !Number.isFinite(value.tonnage_today)
    || value.tonnage_today < 0 || Math.abs(value.tonnage_today * 100 - Math.round(value.tonnage_today * 100)) > 0.000001
    || !count(value.trucks_processed_today) || !count(value.exceptions_requiring_attention)
    || !record(value.action_required) || !exactKeys(value.action_required, [
      'unresolved_exceptions', 'failed_waybill_pdfs', 'failed_waybill_emails', 'payment_details_required',
    ])) {
    throw new Error('Invalid Operations dashboard response');
  }
  const action = value.action_required;
  const unresolvedExceptions = parseCategory(action.unresolved_exceptions,
    ['exception_id', 'exception_type', 'trip_number', 'truck_registration', 'created_at']);
  const failedWaybillPdfs = mapWaybillNumbers(parseCategory(action.failed_waybill_pdfs,
    ['document_id', 'invoice_number', 'trip_number', 'failed_at']));
  const failedWaybillEmails = mapWaybillNumbers(parseCategory(action.failed_waybill_emails,
    ['notification_id', 'invoice_number', 'trip_number', 'failed_at']));
  const paymentDetailsRequired = parseCategory(action.payment_details_required,
    ['payment_id', 'trip_number', 'truck_registration', 'driver_name', 'created_at']);
  if (unresolvedExceptions.items.some(item => typeof item.exception_id !== 'string' || typeof item.exception_type !== 'string'
      || !nullableText(item.trip_number) || !nullableText(item.truck_registration) || !date(item.created_at))
    || failedWaybillPdfs.items.some(item => typeof item.document_id !== 'string' || typeof item.waybill_number !== 'string'
      || typeof item.trip_number !== 'string' || !date(item.failed_at))
    || failedWaybillEmails.items.some(item => typeof item.notification_id !== 'string' || typeof item.waybill_number !== 'string'
      || typeof item.trip_number !== 'string' || !date(item.failed_at))
    || paymentDetailsRequired.items.some(item => typeof item.payment_id !== 'string' || typeof item.trip_number !== 'string'
      || typeof item.truck_registration !== 'string' || typeof item.driver_name !== 'string' || !date(item.created_at))) {
    throw new Error('Invalid Operations dashboard response');
  }
  if (unresolvedExceptions.count !== value.exceptions_requiring_attention) {
    throw new Error('Invalid Operations dashboard response');
  }
  return {
    tripsOpenedToday: value.trips_opened_today,
    tripsClosedToday: value.trips_closed_today,
    openTrips: value.open_trips,
    tonnageToday: value.tonnage_today,
    trucksProcessedToday: value.trucks_processed_today,
    exceptionsRequiringAttention: value.exceptions_requiring_attention,
    actionRequired: { unresolvedExceptions, failedWaybillPdfs, failedWaybillEmails, paymentDetailsRequired },
  };
}

function parseOpenTrips(value: unknown): OperationsDashboardData['openTrips'] {
  if (!record(value) || !exactKeys(value, ['as_of', 'items']) || !date(value.as_of)
    || !Array.isArray(value.items) || value.items.length > 10) {
    throw new Error('Invalid Operations dashboard response');
  }
  const keys = ['trip_id', 'trip_number', 'truck_registration', 'driver_name', 'loading_site_name',
    'opened_at', 'duration_seconds', 'status'];
  const items = value.items;
  if (!items.every(item => record(item) && exactKeys(item, keys)
    && typeof item.trip_id === 'string' && typeof item.trip_number === 'string'
    && typeof item.truck_registration === 'string' && typeof item.driver_name === 'string'
    && typeof item.loading_site_name === 'string' && date(item.opened_at)
    && count(item.duration_seconds) && item.status === 'open')) {
    throw new Error('Invalid Operations dashboard response');
  }
  return { as_of: value.as_of, items: items as OperationsDashboardOpenTrip[] };
}

function parseActivity(value: unknown): OperationsDashboardData['activity'] {
  if (!record(value) || !exactKeys(value, ['as_of', 'items']) || !date(value.as_of)
    || !Array.isArray(value.items) || value.items.length > 50) {
    throw new Error('Invalid Operations dashboard response');
  }
  const keys = ['event_id', 'event_type', 'occurred_at', 'trip_number', 'truck_registration',
    'officer_id', 'officer_name', 'officer_role', 'site_name', 'payment_status'];
  const items = value.items;
  if (!items.every(item => record(item) && exactKeys(item, keys)
    && typeof item.event_id === 'string' && eventTypes.includes(item.event_type as typeof eventTypes[number])
    && date(item.occurred_at) && nullableText(item.trip_number) && nullableText(item.truck_registration)
    && nullableText(item.officer_id) && nullableText(item.officer_name)
    && (item.officer_role === null || roles.includes(item.officer_role as typeof roles[number]))
    && nullableText(item.site_name)
    && (item.payment_status === null || ['payment_details_required', 'pending', 'paid'].includes(item.payment_status as string))
    && (item.event_type === 'payment_status_changed'
      ? item.payment_status !== null
      : item.payment_status === null))) {
    throw new Error('Invalid Operations dashboard response');
  }
  return { as_of: value.as_of, items: items as OperationsDashboardActivity[] };
}

export async function loadOperationsDashboard(): Promise<OperationsDashboardData> {
  if (!supabase) throw new Error('Operations dashboard unavailable');
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    name: string, args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { code?: string } | null }>;
  const [summary, openTrips, activity] = await Promise.all([
    rpc('get_operations_dashboard_summary'),
    rpc('get_operations_dashboard_open_trips', { p_limit: 10 }),
    rpc('get_operations_dashboard_activity', { p_limit: 20 }),
  ]);
  if ([summary, openTrips, activity].some(result => result.error?.code === '42501')) {
    throw new Error('Operations dashboard access denied');
  }
  if (summary.error || openTrips.error || activity.error) throw new Error('Operations dashboard unavailable');
  return {
    summary: parseOperationsDashboardSummary(summary.data),
    openTrips: parseOpenTrips(openTrips.data),
    activity: parseActivity(activity.data),
  };
}
