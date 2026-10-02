import { supabase } from '../../../lib/supabase';

export const ANALYTICS_PERIODS = ['7_days', '30_days', '90_days', 'custom'] as const;
export type AnalyticsPeriod = typeof ANALYTICS_PERIODS[number];
export type AnalyticsFilters = {
  period: AnalyticsPeriod;
  date_from?: string;
  date_to?: string;
  loading_site_id?: string;
  offloading_site_id?: string;
  truck_id?: string;
  driver_id?: string;
};
export const PERFORMANCE_DIMENSIONS = ['truck', 'driver', 'loading_site', 'offloading_site'] as const;
export type PerformanceDimension = typeof PERFORMANCE_DIMENSIONS[number];
export const PERFORMANCE_METRICS = ['trips', 'actual_tonnage', 'average_tonnage', 'average_turnaround'] as const;
export type PerformanceMetric = typeof PERFORMANCE_METRICS[number];
export type AnalyticsOptionKind = 'loading_site' | 'offloading_site' | 'truck' | 'driver';
export type AnalyticsOption = { id: string; label: string; is_active: boolean };
export type AnalyticsOptionPage = { kind: AnalyticsOptionKind; items: AnalyticsOption[]; hasMore: boolean };

type NullableNumber = number | null;
export type AnalyticsStatus = {
  denominator: number;
  slices: Array<{ status: string; count: number; share: number }>;
};
export type OperationsAnalyticsData = {
  as_of: string;
  range_start: string;
  range_end: string;
  time_zone: 'Africa/Lagos';
  period: AnalyticsPeriod;
  kpis: {
    total_trips: number;
    actual_tonnage_tonnes: number;
    actual_tonnage_closed_trip_count: number;
    average_tonnage_per_trip_tonnes: NullableNumber;
    average_tonnage_trip_count: number;
    average_turnaround_seconds: NullableNumber;
    average_turnaround_trip_count: number;
    average_tonnage_variance_tonnes: NullableNumber;
    total_tonnage_variance_tonnes: NullableNumber;
    variance_trip_count: number;
    estimate_coverage: NullableNumber;
  };
  trips_trend: Array<{ date: string; opened: number; closed: number }>;
  tonnage_trend: Array<{
    date: string;
    estimated_tonnage_tonnes: NullableNumber;
    actual_tonnage_tonnes: NullableNumber;
    paired_trip_count: number;
  }>;
  performance: {
    dimension: PerformanceDimension;
    metric: PerformanceMetric;
    entity_count: number;
    items: Array<{
      entity_id: string;
      label: string;
      trip_count: number;
      closed_trip_count: number;
      actual_tonnage_tonnes: NullableNumber;
      average_tonnage_tonnes: NullableNumber;
      average_turnaround_seconds: NullableNumber;
    }>;
  };
  status_distributions: {
    trip: AnalyticsStatus;
    payout: AnalyticsStatus;
    exception: AnalyticsStatus;
  };
  variance: {
    total_variance_tonnes: NullableNumber;
    average_variance_tonnes: NullableNumber;
    paired_trip_count: number;
    estimate_coverage: NullableNumber;
    daily: Array<{ date: string; variance_tonnes: NullableNumber; paired_trip_count: number }>;
    trucks: Array<{
      entity_id: string;
      label: string;
      average_variance_tonnes: number;
      total_variance_tonnes: number;
      paired_trip_count: number;
    }>;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function safeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function safeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function safeNonNegative(value: unknown): value is number {
  return safeNumber(value) && value >= 0;
}

function safeNullableNumber(value: unknown): value is NullableNumber {
  return value === null || safeNumber(value);
}

function dateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function invalid(): never {
  throw new Error('Invalid Operations Analytics response');
}

function parseStatus(value: unknown, statuses: readonly string[]): AnalyticsStatus {
  if (!isRecord(value) || !exactKeys(value, ['denominator', 'slices']) || !safeCount(value.denominator)
    || !Array.isArray(value.slices)) invalid();
  const slices = value.slices.map(slice => {
    if (!isRecord(slice) || !exactKeys(slice, ['status', 'count', 'share'])
      || typeof slice.status !== 'string' || !statuses.includes(slice.status)
      || !safeCount(slice.count) || !safeNumber(slice.share) || slice.share < 0 || slice.share > 1) invalid();
    return { status: slice.status, count: slice.count, share: slice.share };
  });
  if (slices.length > statuses.length || new Set(slices.map(slice => slice.status)).size !== slices.length
    || slices.reduce((sum, slice) => sum + slice.count, 0) !== value.denominator
    || (value.denominator === 0 && slices.length !== 0)
    || (value.denominator > 0 && Math.abs(slices.reduce((sum, slice) => sum + slice.share, 0) - 1) > 0.001)) invalid();
  return { denominator: value.denominator, slices };
}

export function parseOperationsAnalytics(value: unknown): OperationsAnalyticsData {
  const rootKeys = ['as_of', 'range_start', 'range_end', 'time_zone', 'period', 'kpis', 'trips_trend',
    'tonnage_trend', 'performance', 'status_distributions', 'variance'];
  if (!isRecord(value) || !exactKeys(value, rootKeys) || !timestamp(value.as_of)
    || !dateOnly(value.range_start) || !dateOnly(value.range_end) || value.range_start > value.range_end
    || value.time_zone !== 'Africa/Lagos' || !ANALYTICS_PERIODS.includes(value.period as AnalyticsPeriod)) invalid();

  const kpiKeys = ['total_trips', 'actual_tonnage_tonnes', 'actual_tonnage_closed_trip_count',
    'average_tonnage_per_trip_tonnes', 'average_tonnage_trip_count', 'average_turnaround_seconds',
    'average_turnaround_trip_count', 'average_tonnage_variance_tonnes', 'total_tonnage_variance_tonnes',
    'variance_trip_count', 'estimate_coverage'];
  const kpis = value.kpis;
  if (!isRecord(kpis) || !exactKeys(kpis, kpiKeys) || !safeCount(kpis.total_trips)
    || !safeNonNegative(kpis.actual_tonnage_tonnes) || !safeCount(kpis.actual_tonnage_closed_trip_count)
    || !safeNullableNumber(kpis.average_tonnage_per_trip_tonnes)
    || !safeCount(kpis.average_tonnage_trip_count) || !safeNullableNumber(kpis.average_turnaround_seconds)
    || !safeCount(kpis.average_turnaround_trip_count) || !safeNullableNumber(kpis.average_tonnage_variance_tonnes)
    || !safeNullableNumber(kpis.total_tonnage_variance_tonnes) || !safeCount(kpis.variance_trip_count)
    || !safeNullableNumber(kpis.estimate_coverage)
    || (kpis.estimate_coverage !== null && (kpis.estimate_coverage < 0 || kpis.estimate_coverage > 1))
    || kpis.variance_trip_count > kpis.actual_tonnage_closed_trip_count) invalid();

  const days = Math.floor((Date.parse(`${value.range_end}T00:00:00Z`) - Date.parse(`${value.range_start}T00:00:00Z`)) / 86_400_000) + 1;
  if (!Array.isArray(value.trips_trend) || value.trips_trend.length !== days || days > 90) invalid();
  const tripsTrend = value.trips_trend.map(row => {
    if (!isRecord(row) || !exactKeys(row, ['date', 'opened', 'closed']) || !dateOnly(row.date)
      || !safeCount(row.opened) || !safeCount(row.closed)) invalid();
    return { date: row.date, opened: row.opened, closed: row.closed };
  });

  if (!Array.isArray(value.tonnage_trend) || value.tonnage_trend.length !== days) invalid();
  const tonnageTrend = value.tonnage_trend.map(row => {
    if (!isRecord(row) || !exactKeys(row, ['date', 'estimated_tonnage_tonnes', 'actual_tonnage_tonnes', 'paired_trip_count'])
      || !dateOnly(row.date) || !safeNullableNumber(row.estimated_tonnage_tonnes)
      || !safeNullableNumber(row.actual_tonnage_tonnes) || !safeCount(row.paired_trip_count)
      || (row.paired_trip_count === 0 && (row.estimated_tonnage_tonnes !== null || row.actual_tonnage_tonnes !== null))
      || (row.paired_trip_count > 0 && (!safeNonNegative(row.estimated_tonnage_tonnes) || !safeNonNegative(row.actual_tonnage_tonnes)))) invalid();
    return { date: row.date, estimated_tonnage_tonnes: row.estimated_tonnage_tonnes,
      actual_tonnage_tonnes: row.actual_tonnage_tonnes, paired_trip_count: row.paired_trip_count };
  });

  const performance = value.performance;
  if (!isRecord(performance) || !exactKeys(performance, ['dimension', 'metric', 'entity_count', 'items'])
    || !PERFORMANCE_DIMENSIONS.includes(performance.dimension as PerformanceDimension)
    || !PERFORMANCE_METRICS.includes(performance.metric as PerformanceMetric)
    || !safeCount(performance.entity_count) || !Array.isArray(performance.items)
    || performance.items.length > 10 || performance.items.length > performance.entity_count) invalid();
  const performanceItems = performance.items.map(item => {
    if (!isRecord(item) || !exactKeys(item, ['entity_id', 'label', 'trip_count', 'closed_trip_count',
      'actual_tonnage_tonnes', 'average_tonnage_tonnes', 'average_turnaround_seconds'])
      || typeof item.entity_id !== 'string' || typeof item.label !== 'string' || !safeCount(item.trip_count)
      || !safeCount(item.closed_trip_count)
      || !safeNullableNumber(item.actual_tonnage_tonnes)
      || (item.actual_tonnage_tonnes !== null && !safeNonNegative(item.actual_tonnage_tonnes))
      || !safeNullableNumber(item.average_tonnage_tonnes)
      || !safeNullableNumber(item.average_turnaround_seconds)) invalid();
    return { entity_id: item.entity_id, label: item.label, trip_count: item.trip_count,
      closed_trip_count: item.closed_trip_count, actual_tonnage_tonnes: item.actual_tonnage_tonnes,
      average_tonnage_tonnes: item.average_tonnage_tonnes, average_turnaround_seconds: item.average_turnaround_seconds };
  });

  const statusDistributions = value.status_distributions;
  if (!isRecord(statusDistributions) || !exactKeys(statusDistributions, ['trip', 'payout', 'exception'])) invalid();
  const tripStatus = parseStatus(statusDistributions.trip, ['open', 'closed', 'cancelled']);
  const payoutStatus = parseStatus(statusDistributions.payout, ['payment_details_required', 'pending', 'paid']);
  const exceptionStatus = parseStatus(statusDistributions.exception, ['open', 'in_review', 'resolved']);

  const variance = value.variance;
  if (!isRecord(variance) || !exactKeys(variance, ['total_variance_tonnes', 'average_variance_tonnes',
    'paired_trip_count', 'estimate_coverage', 'daily', 'trucks'])
    || !safeNullableNumber(variance.total_variance_tonnes) || !safeNullableNumber(variance.average_variance_tonnes)
    || !safeCount(variance.paired_trip_count) || variance.paired_trip_count !== kpis.variance_trip_count
    || !safeNullableNumber(variance.estimate_coverage) || variance.estimate_coverage !== kpis.estimate_coverage
    || !Array.isArray(variance.daily) || variance.daily.length !== days
    || !Array.isArray(variance.trucks) || variance.trucks.length > 10) invalid();
  const varianceDaily = variance.daily.map(row => {
    if (!isRecord(row) || !exactKeys(row, ['date', 'variance_tonnes', 'paired_trip_count'])
      || !dateOnly(row.date) || !safeNullableNumber(row.variance_tonnes) || !safeCount(row.paired_trip_count)
      || (row.paired_trip_count === 0 && row.variance_tonnes !== null)
      || (row.paired_trip_count > 0 && row.variance_tonnes === null)) invalid();
    return { date: row.date, variance_tonnes: row.variance_tonnes, paired_trip_count: row.paired_trip_count };
  });
  const varianceTrucks = variance.trucks.map(row => {
    if (!isRecord(row) || !exactKeys(row, ['entity_id', 'label', 'average_variance_tonnes',
      'total_variance_tonnes', 'paired_trip_count'])
      || typeof row.entity_id !== 'string' || typeof row.label !== 'string'
      || !safeNumber(row.average_variance_tonnes) || !safeNumber(row.total_variance_tonnes)
      || !safeCount(row.paired_trip_count) || row.paired_trip_count === 0) invalid();
    return { entity_id: row.entity_id, label: row.label, average_variance_tonnes: row.average_variance_tonnes,
      total_variance_tonnes: row.total_variance_tonnes, paired_trip_count: row.paired_trip_count };
  });

  return {
    as_of: value.as_of, range_start: value.range_start, range_end: value.range_end,
    time_zone: 'Africa/Lagos', period: value.period as AnalyticsPeriod,
    kpis: {
      total_trips: kpis.total_trips, actual_tonnage_tonnes: kpis.actual_tonnage_tonnes,
      actual_tonnage_closed_trip_count: kpis.actual_tonnage_closed_trip_count,
      average_tonnage_per_trip_tonnes: kpis.average_tonnage_per_trip_tonnes,
      average_tonnage_trip_count: kpis.average_tonnage_trip_count,
      average_turnaround_seconds: kpis.average_turnaround_seconds,
      average_turnaround_trip_count: kpis.average_turnaround_trip_count,
      average_tonnage_variance_tonnes: kpis.average_tonnage_variance_tonnes,
      total_tonnage_variance_tonnes: kpis.total_tonnage_variance_tonnes,
      variance_trip_count: kpis.variance_trip_count, estimate_coverage: kpis.estimate_coverage,
    },
    trips_trend: tripsTrend, tonnage_trend: tonnageTrend,
    performance: { dimension: performance.dimension as PerformanceDimension,
      metric: performance.metric as PerformanceMetric, entity_count: performance.entity_count,
      items: performanceItems },
    status_distributions: { trip: tripStatus, payout: payoutStatus, exception: exceptionStatus },
    variance: {
      total_variance_tonnes: variance.total_variance_tonnes,
      average_variance_tonnes: variance.average_variance_tonnes,
      paired_trip_count: variance.paired_trip_count,
      estimate_coverage: variance.estimate_coverage,
      daily: varianceDaily, trucks: varianceTrucks,
    },
  };
}

function validateFilters(filters: AnalyticsFilters): Record<string, string> {
  const allowedKeys = ['period', 'date_from', 'date_to', 'loading_site_id', 'offloading_site_id', 'truck_id', 'driver_id'];
  if (!isRecord(filters) || Object.keys(filters).some(key => !allowedKeys.includes(key))) {
    throw new Error('Invalid Analytics filters');
  }
  if (!ANALYTICS_PERIODS.includes(filters.period)) throw new Error('Invalid Analytics filters');
  const output: Record<string, string> = { period: filters.period };
  if (filters.period === 'custom') {
    if (!dateOnly(filters.date_from) || !dateOnly(filters.date_to) || filters.date_from > filters.date_to) {
      throw new Error('Choose a valid custom date range');
    }
    output.date_from = filters.date_from;
    output.date_to = filters.date_to;
  } else if (filters.date_from || filters.date_to) {
    throw new Error('Preset Analytics ranges do not accept custom dates');
  }
  for (const key of ['loading_site_id', 'offloading_site_id', 'truck_id', 'driver_id'] as const) {
    const value = filters[key];
    if (value) output[key] = value;
  }
  return output;
}

export async function loadOperationsAnalytics(
  filters: AnalyticsFilters,
  dimension: PerformanceDimension,
  metric: PerformanceMetric,
): Promise<OperationsAnalyticsData> {
  if (!supabase) throw new Error('Operations Analytics unavailable');
  const result = await supabase.rpc('get_operations_analytics', {
    p_filters: validateFilters(filters), p_performance_dimension: dimension, p_performance_metric: metric,
  });
  if (result.error?.code === '42501') throw new Error('Operations Analytics access denied');
  if (result.error) throw new Error('Unable to load Operations Analytics');
  return parseOperationsAnalytics(result.data);
}

export async function loadOperationsAnalyticsOptions(
  kind: AnalyticsOptionKind,
  search: string,
  limit = 50,
): Promise<AnalyticsOptionPage> {
  if (!supabase) throw new Error('Operations Analytics filters unavailable');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || search.length > 100) {
    throw new Error('Invalid Analytics option request');
  }
  const result = await supabase.rpc('get_operations_analytics_filter_options', {
    p_kind: kind, p_search: search.trim() || null, p_limit: limit,
  });
  if (result.error?.code === '42501') throw new Error('Operations Analytics access denied');
  if (result.error) throw new Error('Unable to load Analytics filter options');
  const value = result.data;
  if (!isRecord(value) || !exactKeys(value, ['kind', 'items', 'has_more']) || value.kind !== kind
    || !Array.isArray(value.items) || value.items.length > limit || typeof value.has_more !== 'boolean') invalid();
  const items = value.items.map(item => {
    if (!isRecord(item) || !exactKeys(item, ['id', 'label', 'is_active'])
      || typeof item.id !== 'string' || typeof item.label !== 'string' || typeof item.is_active !== 'boolean') invalid();
    return { id: item.id, label: item.label, is_active: item.is_active };
  });
  if (new Set(items.map(item => item.id)).size !== items.length) invalid();
  return { kind, items, hasMore: value.has_more };
}
