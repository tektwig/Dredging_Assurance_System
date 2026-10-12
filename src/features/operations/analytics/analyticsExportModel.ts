import type {
  AnalyticsFilters, AnalyticsOptionKind, OperationsAnalyticsData, PerformanceDimension, PerformanceMetric,
} from '../services/operationsAnalytics';

export const DRIVER_METRIC_OPTIONS = [
  { key: 'trips_opened', label: 'Trips Opened', unit: 'count' },
  { key: 'trips_closed', label: 'Trips Closed', unit: 'count' },
  { key: 'actual_tonnage_tonnes', label: 'Actual Tonnage', unit: 'tonnes' },
  { key: 'average_tonnage_per_trip_tonnes', label: 'Average Actual Tonnage / Trip', unit: 'tonnes' },
  { key: 'average_turnaround_seconds', label: 'Average Turnaround Time', unit: 'seconds' },
] as const;

export type DriverMetricKey = typeof DRIVER_METRIC_OPTIONS[number]['key'];

export const SUMMARY_METRIC_OPTIONS = [
  { key: 'trips_opened', label: 'Trips Opened', unit: 'count' },
  { key: 'trips_closed', label: 'Trips Closed', unit: 'count' },
  { key: 'outstanding_at_period_end', label: 'Outstanding at Period End', unit: 'count' },
  { key: 'actual_tonnage_tonnes', label: 'Actual Tonnage', unit: 'tonnes' },
  { key: 'average_tonnage_per_trip_tonnes', label: 'Average Tonnage / Trip', unit: 'tonnes' },
  { key: 'average_turnaround_seconds', label: 'Average Turnaround Time', unit: 'seconds' },
] as const;

export type SummaryMetricKey = typeof SUMMARY_METRIC_OPTIONS[number]['key'];
export type StatusCohort = 'trip' | 'exception';
export type AnalyticsExportCell = string | number | null;

export type AnalyticsExportSelections = {
  dimension: PerformanceDimension;
  metric: PerformanceMetric;
  driverMetric: DriverMetricKey;
  summaryGranularity: 'weekly' | 'monthly';
  summaryMetric: SummaryMetricKey;
  statusCohort: StatusCohort;
};

export type AnalyticsExportChart = {
  key: string;
  title: string;
  unit: string;
  note: string;
  headers: string[];
  rows: AnalyticsExportCell[][];
  hasChart: boolean;
  image?: { bytes: Uint8Array; widthPx: number; heightPx: number };
};

export type AnalyticsWorkbookModel = {
  rangeStart: string;
  rangeEnd: string;
  exportedAt: string;
  exportedAtLagos: string;
  filters: Array<{ label: string; value: string }>;
  selections: Array<{ label: string; value: string }>;
  kpis: Array<{ label: string; value: number | null; unit: string; sample: string; definition: string }>;
  charts: AnalyticsExportChart[];
  limitations: string[];
};

export type AnalyticsExportInput = {
  data: OperationsAnalyticsData;
  filters: AnalyticsFilters;
  filterLabels: Partial<Record<AnalyticsOptionKind, string>>;
  selections: AnalyticsExportSelections;
  exportedAt?: Date;
};

export function analyticsExportFilename(rangeStart: string, rangeEnd: string): string {
  return `TRAKFLIT_Analytics_${rangeStart}_to_${rangeEnd}.xlsx`;
}

const dimensionLabels: Record<PerformanceDimension, string> = {
  truck: 'Truck', driver: 'Driver', loading_site: 'Loading Site', offloading_site: 'Offloading Site',
};

const performanceMetricLabels: Record<PerformanceMetric, { label: string; unit: string }> = {
  trips: { label: 'Trips', unit: 'trips' },
  actual_tonnage: { label: 'Actual Tonnage', unit: 'tonnes' },
  average_tonnage: { label: 'Average Tonnage', unit: 'tonnes' },
  average_turnaround: { label: 'Average Turnaround Time', unit: 'hours' },
};

const periodLabels: Record<AnalyticsFilters['period'], string> = {
  '7_days': 'Last 7 days', '30_days': 'Last 30 days', '90_days': 'Last 90 days', custom: 'Custom date range',
};

function rounded(value: number | null, places: number): number | null {
  if (value === null) return null;
  const result = Number(value.toFixed(places));
  return Object.is(result, -0) ? 0 : result;
}

function hours(seconds: number | null): number | null {
  return seconds === null ? null : rounded(seconds / 3600, 1);
}

function workbookUnit(unit: string): string {
  if (unit === 'count') return 'trips';
  if (unit === 'seconds') return 'hours';
  return unit;
}

function labelForFilter(label: string | undefined, fallback: string): string {
  return label?.trim() || `${fallback} (label unavailable)`;
}

function buildFilters(input: AnalyticsExportInput): Array<{ label: string; value: string }> {
  const { filters, filterLabels, data } = input;
  const values: Array<{ label: string; value: string }> = [
    { label: 'Period', value: periodLabels[filters.period] },
    { label: 'Date range (Africa/Lagos)', value: `${data.range_start} to ${data.range_end}` },
  ];
  const entityFilters: Array<[AnalyticsOptionKind, keyof AnalyticsFilters, string]> = [
    ['loading_site', 'loading_site_id', 'Loading Site'],
    ['offloading_site', 'offloading_site_id', 'Offloading Site'],
    ['truck', 'truck_id', 'Truck'],
    ['driver', 'driver_id', 'Driver'],
  ];
  for (const [kind, filterKey, label] of entityFilters) {
    if (filters[filterKey]) values.push({ label, value: labelForFilter(filterLabels[kind], `Selected ${label.toLowerCase()}`) });
  }
  return values;
}

function buildKpis(data: OperationsAnalyticsData): AnalyticsWorkbookModel['kpis'] {
  const kpi = data.kpis;
  const coverage = kpi.estimate_coverage === null ? 'Estimate coverage unavailable'
    : `${(kpi.estimate_coverage * 100).toFixed(1)}% estimate coverage`;
  return [
    { label: 'Total Trips', value: kpi.total_trips, unit: 'trips',
      sample: `${kpi.total_trips} trips opened during the selected period`,
      definition: 'Trips opened in the selected period.' },
    { label: 'Actual Tonnage', value: rounded(kpi.actual_tonnage_tonnes, 2), unit: 'tonnes',
      sample: `${kpi.actual_tonnage_closed_trip_count} closed trips with actual tonnage`,
      definition: 'Actual tonnage for closed trips in the selected close-date cohort.' },
    { label: 'Avg Tonnage / Trip', value: rounded(kpi.average_tonnage_per_trip_tonnes, 2), unit: 'tonnes',
      sample: kpi.average_tonnage_per_trip_tonnes === null
        ? `${kpi.average_tonnage_trip_count} qualifying closed trips; no data available`
        : `${kpi.average_tonnage_trip_count} closed trips with actual tonnage`,
      definition: 'Actual tonnage divided by qualifying closed trips with actual tonnage.' },
    { label: 'Avg Turnaround Time', value: hours(kpi.average_turnaround_seconds), unit: 'hours',
      sample: kpi.average_turnaround_seconds === null
        ? `${kpi.average_turnaround_trip_count} qualifying trips; no data available`
        : `${kpi.average_turnaround_trip_count} trips with opened and closed timestamps`,
      definition: 'Average elapsed time for trips with both opened and closed timestamps.' },
    { label: 'Avg Tonnage Variance', value: rounded(kpi.average_tonnage_variance_tonnes, 2), unit: 'tonnes',
      sample: kpi.average_tonnage_variance_tonnes === null
        ? `${kpi.variance_trip_count} paired trips; no variance data available; ${coverage}`
        : `${kpi.variance_trip_count} paired trips; ${coverage}`,
      definition: 'Average actual minus estimated tonnage for paired closed trips only.' },
  ];
}

function driverValue(row: OperationsAnalyticsData['driver_performance_daily']['days'][number], metric: DriverMetricKey) {
  switch (metric) {
    case 'trips_opened': return row.trips_opened;
    case 'trips_closed': return row.trips_closed;
    case 'actual_tonnage_tonnes': return row.actual_tonnage_tonnes;
    case 'average_tonnage_per_trip_tonnes': return row.average_tonnage_per_trip_tonnes;
    case 'average_turnaround_seconds': return hours(row.average_turnaround_seconds);
  }
}

function driverSample(row: OperationsAnalyticsData['driver_performance_daily']['days'][number], metric: DriverMetricKey) {
  if (metric === 'average_tonnage_per_trip_tonnes') return row.average_tonnage_trip_count;
  if (metric === 'average_turnaround_seconds') return row.average_turnaround_trip_count;
  if (metric === 'actual_tonnage_tonnes') return row.trips_closed;
  return null;
}

function summaryValue(row: OperationsAnalyticsData['period_summaries']['weekly'][number], metric: SummaryMetricKey) {
  return metric === 'average_turnaround_seconds' ? hours(row.average_turnaround_seconds) : row[metric];
}

function summarySample(row: OperationsAnalyticsData['period_summaries']['weekly'][number], metric: SummaryMetricKey) {
  if (metric === 'average_tonnage_per_trip_tonnes') return row.average_tonnage_trip_count;
  if (metric === 'average_turnaround_seconds') return row.average_turnaround_trip_count;
  return null;
}

function performanceValue(row: OperationsAnalyticsData['performance']['items'][number], metric: PerformanceMetric) {
  switch (metric) {
    case 'trips': return row.trip_count;
    case 'actual_tonnage': return row.actual_tonnage_tonnes;
    case 'average_tonnage': return row.average_tonnage_tonnes;
    case 'average_turnaround': return hours(row.average_turnaround_seconds);
  }
}

function performanceNote(data: OperationsAnalyticsData, dimension: PerformanceDimension, metric: PerformanceMetric): string {
  const { entity_count, items } = data.performance;
  const cohort = dimension === 'offloading_site'
    ? 'Entities use trips closed during the selected period.'
    : 'Entities use trips opened during the selected period.';
  const topLimit = entity_count > items.length
    ? ` Showing ${items.length} of ${entity_count} matching entities (server-limited top 10).`
    : ` ${items.length} matching entities returned; server limit is 10.`;
  return `${cohort} Measure: ${performanceMetricLabels[metric].label}.${topLimit}`;
}

export function buildAnalyticsWorkbookModel(input: AnalyticsExportInput): AnalyticsWorkbookModel {
  const { data, selections } = input;
  const timestamp = input.exportedAt ?? new Date();
  const summaryOption = SUMMARY_METRIC_OPTIONS.find(item => item.key === selections.summaryMetric)!;
  const driverOption = DRIVER_METRIC_OPTIONS.find(item => item.key === selections.driverMetric)!;
  const activeStatus = data.status_distributions[selections.statusCohort];
  const activeStatusTitle = selections.statusCohort === 'trip' ? 'Trip Status' : 'Exception Status';
  const driverSelected = data.driver_performance_daily.selected_driver_id !== null;
  const varianceHasSamples = data.variance.paired_trip_count > 0;
  const coverageText = data.variance.estimate_coverage === null ? 'Estimate coverage unavailable'
    : `${(data.variance.estimate_coverage * 100).toFixed(1)}% estimate coverage`;
  const selectedSummaryRows = data.period_summaries[selections.summaryGranularity];
  const selectionsSummary = [
    { label: 'Performance chart', value: `${dimensionLabels[selections.dimension]} · ${performanceMetricLabels[selections.metric].label}` },
    { label: 'Driver chart', value: driverSelected ? driverOption.label : 'No driver selected' },
    { label: 'Summary chart', value: `${selections.summaryGranularity === 'weekly' ? 'Weekly' : 'Monthly'} · ${summaryOption.label}` },
    { label: 'Status chart', value: activeStatusTitle },
  ];
  const charts: AnalyticsExportChart[] = [
    {
      key: 'trips-trend', title: 'Trips Opened vs Closed', unit: 'trips', hasChart: true,
      note: data.trips_trend.length ? 'Opened and closed trips are counted on their own Africa/Lagos event dates.'
        : 'No daily trip observations are available for this range.',
      headers: ['Operational date (Africa/Lagos)', 'Opened (trips)', 'Closed (trips)'],
      rows: data.trips_trend.map(row => [row.date, row.opened, row.closed]),
    },
    {
      key: 'tonnage-trend', title: 'Estimated vs Actual Tonnage', unit: 'tonnes', hasChart: true,
      note: data.variance.paired_trip_count
        ? `Paired closed trips: ${data.variance.paired_trip_count}; ${coverageText}.`
        : 'No paired closed trips with actual and estimated tonnage are available; plotted values are unavailable.',
      headers: ['Operational date (Africa/Lagos)', 'Estimated (tonnes)', 'Estimated availability',
        'Actual (tonnes)', 'Actual availability', 'Paired trips'],
      rows: data.tonnage_trend.map(row => [row.date, row.estimated_tonnage_tonnes,
        row.estimated_tonnage_tonnes === null ? 'No data' : 'Available', row.actual_tonnage_tonnes,
        row.actual_tonnage_tonnes === null ? 'No data' : 'Available', row.paired_trip_count]),
    },
    {
      key: 'driver-daily', title: `Driver Performance · ${driverOption.label}`, unit: workbookUnit(driverOption.unit),
      hasChart: driverSelected,
      note: driverSelected ? `Daily values for the selected driver. ${driverOption.label} sample counts are included where applicable.`
        : 'No driver is selected; choose one in the Analytics filters to display this chart.',
      headers: ['Operational date (Africa/Lagos)', `${driverOption.label} (${workbookUnit(driverOption.unit)})`, 'Qualifying sample', 'Availability'],
      rows: driverSelected ? data.driver_performance_daily.days.map(row => {
        const value = driverValue(row, selections.driverMetric);
        return [row.date, value, driverSample(row, selections.driverMetric), value === null ? 'No data' : 'Available'];
      }) : [],
    },
    {
      key: 'period-summary', title: `${selections.summaryGranularity === 'weekly' ? 'Weekly' : 'Monthly'} Summary · ${summaryOption.label}`,
      unit: workbookUnit(summaryOption.unit), hasChart: true,
      note: data.period_summaries.offloading_site_filter_scope === 'excludes_unassigned_at_period_end'
        ? 'Outstanding at period end excludes trips without an offloading site; the excluded count is available in the Analytics table.'
        : 'Opened/closed counts use event dates; outstanding is the open-trip balance at period end.',
      headers: ['Period start', 'Period end', `${summaryOption.label} (${workbookUnit(summaryOption.unit)})`,
        'Qualifying sample', 'Availability'],
      rows: selectedSummaryRows.map(row => [row.period_start, row.period_end,
        summaryValue(row, selections.summaryMetric), summarySample(row, selections.summaryMetric),
        summaryValue(row, selections.summaryMetric) === null ? 'No data' : 'Available']),
    },
    {
      key: 'performance', title: `Performance · ${dimensionLabels[selections.dimension]} · ${performanceMetricLabels[selections.metric].label}`,
      unit: performanceMetricLabels[selections.metric].unit, hasChart: data.performance.items.length > 0,
      note: performanceNote(data, selections.dimension, selections.metric),
      headers: [dimensionLabels[selections.dimension], `${performanceMetricLabels[selections.metric].label} (${performanceMetricLabels[selections.metric].unit})`,
        'Availability', 'Closed trips (sample)'],
      rows: data.performance.items.map(row => {
        const value = performanceValue(row, selections.metric);
        return [row.label, value, value === null ? 'No data' : 'Available', row.closed_trip_count];
      }),
    },
    {
      key: 'status-distribution', title: `Status Distribution · ${activeStatusTitle}`, unit: 'records',
      hasChart: activeStatus.denominator > 0,
      note: activeStatus.denominator > 0
        ? `Current status of ${activeStatus.denominator} matching records in the selected cohort.`
        : `No ${activeStatusTitle.toLowerCase()} records match this cohort.`,
      headers: ['Status', 'Count (records)', 'Share of cohort (%)'],
      rows: activeStatus.slices.map(slice => [slice.status, slice.count, rounded(slice.share * 100, 1)]),
    },
    {
      key: 'variance-daily', title: 'Signed Variance Over Time', unit: 'tonnes', hasChart: varianceHasSamples,
      note: varianceHasSamples
        ? `Actual minus estimated for ${data.variance.paired_trip_count} paired closed trips; ${coverageText}.`
        : 'No closed trips with both actual and estimated tonnage match this period.',
      headers: ['Close date (Africa/Lagos)', 'Signed variance (tonnes)', 'Availability', 'Paired trips'],
      rows: data.variance.daily.map(row => [row.date, row.variance_tonnes,
        row.variance_tonnes === null ? 'No paired data' : 'Available', row.paired_trip_count]),
    },
    {
      key: 'variance-trucks', title: 'Average Signed Variance by Truck', unit: 'tonnes',
      hasChart: data.variance.trucks.length > 0,
      note: data.variance.trucks.length
        ? 'Server-limited top 10 trucks ranked by absolute average variance; bars display signed values.'
        : 'No trucks have paired closed trips in this period.',
      headers: ['Truck', 'Average signed variance (tonnes)', 'Aggregate variance (tonnes)', 'Paired trips'],
      rows: data.variance.trucks.map(row => [row.label, row.average_variance_tonnes,
        row.total_variance_tonnes, row.paired_trip_count]),
    },
  ];

  return {
    rangeStart: data.range_start,
    rangeEnd: data.range_end,
    exportedAt: timestamp.toISOString(),
    exportedAtLagos: new Intl.DateTimeFormat('en-NG', {
      dateStyle: 'medium', timeStyle: 'long', timeZone: 'Africa/Lagos',
    }).format(timestamp),
    filters: buildFilters(input),
    selections: selectionsSummary,
    kpis: buildKpis(data),
    charts,
    limitations: [
      'Analytics data covers at most 90 Africa/Lagos operational dates.',
      'Performance and truck-variance entity charts contain only the server-returned top 10; this workbook does not include the full entity population.',
      'Chart images are static snapshots; numeric aggregate cells on Chart Data are editable and do not update those images.',
      'Null aggregate values are exported as blank numeric cells with an adjacent availability label.',
    ],
  };
}
