import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const React = require('react');
const router = require('react-router-dom');
const { renderToStaticMarkup } = require('react-dom/server');
const overrides = new Map();
const cache = new Map();
const calls = [];
let rpcHandler = async () => ({ data: response, error: null });

function MockChart() {
  return null;
}
overrides.set('recharts', Object.fromEntries([
  'Bar', 'BarChart', 'CartesianGrid', 'Cell', 'Legend', 'Line', 'LineChart', 'Pie', 'PieChart',
  'ReferenceLine', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis',
].map(name => [name, MockChart])));
overrides.set(resolve('src/lib/supabase.ts'), { supabase: {
  async rpc(name, args) { calls.push({ name, args }); return rpcHandler(name, args); },
} });

function load(path) {
  const full = resolve(path);
  if (overrides.has(full)) return overrides.get(full);
  if (cache.has(full)) return cache.get(full).exports;
  const module = { exports: {} };
  cache.set(full, module);
  const output = ts.transpileModule(readFileSync(full, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const localRequire = name => {
    if (overrides.has(name)) return overrides.get(name);
    if (!name.startsWith('.')) return require(name);
    const base = resolve(dirname(full), name);
    const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.css`].find(existsSync);
    assert(target, `Local import must resolve: ${name}`);
    return target.endsWith('.css') ? {} : load(target);
  };
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}

const days = Array.from({ length: 7 }, (_, index) => {
  const value = new Date(Date.UTC(2026, 8, 26 + index));
  return value.toISOString().slice(0, 10);
});
const response = {
  as_of: '2026-10-02T10:00:00.000Z', range_start: days[0], range_end: days.at(-1),
  time_zone: 'Africa/Lagos', period: '7_days',
  kpis: {
    total_trips: 20, actual_tonnage_tonnes: 100, actual_tonnage_closed_trip_count: 12,
    average_tonnage_per_trip_tonnes: 100 / 12, average_tonnage_trip_count: 12,
    average_turnaround_seconds: 3600, average_turnaround_trip_count: 12,
    average_tonnage_variance_tonnes: -1, total_tonnage_variance_tonnes: -7,
    variance_trip_count: 7, estimate_coverage: 7 / 12,
  },
  trips_trend: days.map((date, index) => ({ date, opened: index + 1, closed: index })),
  tonnage_trend: days.map((date, index) => index === 1
    ? { date, estimated_tonnage_tonnes: null, actual_tonnage_tonnes: null, paired_trip_count: 0 }
    : { date, estimated_tonnage_tonnes: 10, actual_tonnage_tonnes: 9, paired_trip_count: 1 }),
  performance: {
    dimension: 'truck', metric: 'trips', entity_count: 12,
    items: Array.from({ length: 10 }, (_, index) => ({ entity_id: `truck-${index}`,
      label: `TRK-${index}`, trip_count: 10 - index, closed_trip_count: 8 - Math.min(index, 7),
      actual_tonnage_tonnes: 25, average_tonnage_tonnes: 12.5, average_turnaround_seconds: 3600 })),
  },
  status_distributions: {
    trip: { denominator: 20, slices: [
      { status: 'open', count: 2, share: 0.1 }, { status: 'closed', count: 15, share: 0.75 },
      { status: 'cancelled', count: 3, share: 0.15 },
    ] },
    payout: { denominator: 12, slices: [
      { status: 'payment_details_required', count: 2, share: 2 / 12 },
      { status: 'pending', count: 5, share: 5 / 12 }, { status: 'paid', count: 5, share: 5 / 12 },
    ] },
    exception: { denominator: 4, slices: [
      { status: 'open', count: 2, share: 0.5 }, { status: 'in_review', count: 1, share: 0.25 },
      { status: 'resolved', count: 1, share: 0.25 },
    ] },
  },
  variance: {
    total_variance_tonnes: -7, average_variance_tonnes: -1, paired_trip_count: 7,
    estimate_coverage: 7 / 12,
    daily: days.map((date, index) => ({ date, variance_tonnes: index === 1 ? null : -1,
      paired_trip_count: index === 1 ? 0 : 1 })),
    trucks: Array.from({ length: 10 }, (_, index) => ({ entity_id: `truck-${index}`,
      label: `TRK-${index}`, average_variance_tonnes: index === 0 ? -3 : 2,
      total_variance_tonnes: index === 0 ? -6 : 2, paired_trip_count: 2 })),
  },
  driver_performance_daily: {
    selected_driver_id: 'driver-analytics',
    days: days.map((date, index) => ({ date, trips_opened: index + 1, trips_closed: index === 1 ? 1 : 0,
      actual_tonnage_tonnes: index === 1 ? 8 : 0,
      average_tonnage_per_trip_tonnes: index === 1 ? 8 : null, average_tonnage_trip_count: index === 1 ? 1 : 0,
      average_turnaround_seconds: index === 1 ? 3600 : null, average_turnaround_trip_count: index === 1 ? 1 : 0 })),
  },
  period_summaries: {
    weekly: [
      { period_start: '2026-09-26', period_end: '2026-09-27', trips_opened: 2, trips_closed: 1,
        outstanding_at_period_end: 3, outstanding_excluded_unassigned_offloading_site_count: 0,
        actual_tonnage_tonnes: 8, average_tonnage_per_trip_tonnes: 8, average_tonnage_trip_count: 1,
        average_turnaround_seconds: 3600, average_turnaround_trip_count: 1 },
      { period_start: '2026-09-28', period_end: '2026-10-02', trips_opened: 3, trips_closed: 2,
        outstanding_at_period_end: 4, outstanding_excluded_unassigned_offloading_site_count: 0,
        actual_tonnage_tonnes: 12, average_tonnage_per_trip_tonnes: 6, average_tonnage_trip_count: 2,
        average_turnaround_seconds: 7200, average_turnaround_trip_count: 2 },
    ],
    monthly: [
      { period_start: '2026-09-26', period_end: '2026-09-30', trips_opened: 4, trips_closed: 2,
        outstanding_at_period_end: 3, outstanding_excluded_unassigned_offloading_site_count: 0,
        actual_tonnage_tonnes: 16, average_tonnage_per_trip_tonnes: 8, average_tonnage_trip_count: 2,
        average_turnaround_seconds: 5400, average_turnaround_trip_count: 2 },
      { period_start: '2026-10-01', period_end: '2026-10-02', trips_opened: 1, trips_closed: 1,
        outstanding_at_period_end: 4, outstanding_excluded_unassigned_offloading_site_count: 0,
        actual_tonnage_tonnes: 4, average_tonnage_per_trip_tonnes: 4, average_tonnage_trip_count: 1,
        average_turnaround_seconds: 3600, average_turnaround_trip_count: 1 },
    ],
    outstanding_definition: 'open_at_end_of_last_included_lagos_operational_date',
    offloading_site_filter_scope: 'all_matching_trips',
  },
};

const service = load('src/features/operations/services/operationsAnalytics.ts');
const parsed = service.parseOperationsAnalytics(response);
assert.equal(parsed.variance.paired_trip_count, 7);
assert.equal(parsed.tonnage_trend[1].estimated_tonnage_tonnes, null);
assert.equal(parsed.driver_performance_daily.days[1].actual_tonnage_tonnes, 8,
  'actual output remains present for a closed trip whose estimate is unavailable');
assert.equal(parsed.driver_performance_daily.days[1].average_tonnage_trip_count, 1);
assert.equal(parsed.period_summaries.weekly[0].period_start, '2026-09-26');
assert.equal(parsed.period_summaries.weekly[1].period_end, '2026-10-02');
assert.equal(parsed.period_summaries.monthly[0].period_end, '2026-09-30');
assert.equal(parsed.status_distributions.payout.denominator, 12);
const noSelectedDriver = service.parseOperationsAnalytics({ ...response,
  driver_performance_daily: { selected_driver_id: null, days: [] },
});
assert.equal(noSelectedDriver.driver_performance_daily.days.length, 0);
assert.throws(() => service.parseOperationsAnalytics({ ...response, bank_name: 'Unexpected field' }), /Invalid/);
assert.throws(() => service.parseOperationsAnalytics({ ...response, tonnage_trend: [
  { ...response.tonnage_trend[1], actual_tonnage_tonnes: 0 }, ...response.tonnage_trend.slice(1),
] }), /Invalid/);
assert.throws(() => service.parseOperationsAnalytics({ ...response, status_distributions: {
  ...response.status_distributions, trip: { ...response.status_distributions.trip, denominator: 99 },
} }), /Invalid/);
assert.throws(() => service.parseOperationsAnalytics({ ...response, performance: {
  ...response.performance, items: [{ ...response.performance.items[0], phone: 'private' }, ...response.performance.items.slice(1)],
} }), /Invalid/);
assert.throws(() => service.parseOperationsAnalytics({ ...response, driver_performance_daily: {
  ...response.driver_performance_daily,
  days: response.driver_performance_daily.days.map((row, index) => index === 1
    ? { ...row, average_tonnage_trip_count: 0 } : row),
} }), /Invalid/);
assert.throws(() => service.parseOperationsAnalytics({ ...response, period_summaries: {
  ...response.period_summaries,
  offloading_site_filter_scope: 'excludes_unassigned_at_period_end',
} }), /Invalid/);
assert.throws(() => service.parseOperationsAnalytics({ ...response, period_summaries: {
  ...response.period_summaries, weekly: response.period_summaries.weekly.slice(1),
} }), /Invalid/);
console.log('PASS strict Analytics response schema, NULL-estimate actuals, bucket coverage, denominators, and privacy fields');

calls.length = 0;
for (const period of ['7_days', '30_days', '90_days']) {
  calls.length = 0;
  await service.loadOperationsAnalytics({ period, driver_id: 'driver-analytics' }, 'truck', 'trips');
  assert.deepEqual(calls[0], { name: 'get_operations_analytics', args: {
    p_filters: { period, driver_id: 'driver-analytics' },
    p_performance_dimension: 'truck', p_performance_metric: 'trips',
  } }, `${period} preset sends no custom dates`);
}

calls.length = 0;
const filters = { period: 'custom', date_from: days[0], date_to: days.at(-1), loading_site_id: 'loading-site-id',
  offloading_site_id: 'offloading-site-id', truck_id: 'truck-id', driver_id: 'driver-id' };
assert.equal((await service.loadOperationsAnalytics(filters, 'offloading_site', 'average_turnaround')).range_start, days[0]);
assert.deepEqual(calls[0], { name: 'get_operations_analytics', args: {
  p_filters: filters, p_performance_dimension: 'offloading_site', p_performance_metric: 'average_turnaround',
} });
const callsBeforeInvalidRanges = calls.length;
await assert.rejects(() => service.loadOperationsAnalytics({ period: '7_days', date_from: days[0], date_to: days.at(-1) }, 'truck', 'trips'),
  /Preset Analytics ranges do not accept custom dates/);
await assert.rejects(() => service.loadOperationsAnalytics({ period: 'custom' }, 'truck', 'trips'), /Choose a valid custom date range/);
assert.equal(calls.length, callsBeforeInvalidRanges, 'invalid range contracts are rejected before an RPC request');
await assert.rejects(() => service.loadOperationsAnalytics({ ...filters, unexpected: 'raw' }, 'truck', 'trips'), /Invalid Analytics filters/);
rpcHandler = async () => ({ data: { kind: 'truck', items: [{ id: 'truck-1', label: 'TRK-1', is_active: false }], has_more: false }, error: null });
const options = await service.loadOperationsAnalyticsOptions('truck', 'TRK-1');
assert.deepEqual(options.items, [{ id: 'truck-1', label: 'TRK-1', is_active: false }]);
assert.equal(calls.at(-1).args.p_limit, 50);
rpcHandler = async () => ({ data: null, error: { code: '42501' } });
await assert.rejects(() => service.loadOperationsAnalyticsOptions('driver', '', 50), /access denied/i);
rpcHandler = async () => ({ data: response, error: null });
console.log('PASS server RPC arguments, bounded filter options, inactive entity labels, and safe authorization errors');

const view = load('src/features/operations/analytics/OperationsAnalytics.tsx');
const viewProps = {
  filters: { period: '7_days' }, options: {}, selectedOptions: {}, optionsLoading: {}, optionsError: {},
  today: days.at(-1), dimension: 'truck', metric: 'trips', summaryGranularity: 'weekly',
  onSummaryGranularity() {}, onChangeFilters() {}, onSearchOptions() {},
  onSelectOption() {}, onRetryOptions() {}, onResetFilters() {}, onDimension() {}, onMetric() {}, onRetry() {},
};
const render = state => renderToStaticMarkup(React.createElement(router.MemoryRouter, null,
  React.createElement(view.OperationsAnalyticsView, { ...viewProps, state })));
assert.match(render({ status: 'loading' }), /Loading results/);
assert.match(render({ status: 'error' }), /Unable to load Operations Analytics/);
const ready = render({ status: 'ready', data: parsed });
for (const label of ['Analytics Centre', 'Total Trips', 'Actual Tonnage', 'Avg Tonnage / Trip',
  'Avg Turnaround Time', 'Avg Tonnage Variance', 'Trips Opened vs Closed', 'Estimated vs Actual Tonnage',
  'Driver Performance', 'Weekly / Monthly Summary', 'Outstanding at Period End',
  'Trips Opened', 'Trips Closed', 'Performance', 'Status Distribution', 'Signed Variance Over Time', 'Average Signed Variance by Truck',
  'View daily trip trend data table', 'View estimated and actual tonnage data table',
  'View daily driver performance data table', 'View weekly operational summary data table',
  'View performance data table', 'View trip status data table', 'View daily signed variance data table']) {
  assert(ready.includes(label), `Analytics ready view should include ${label}`);
}
assert(ready.includes('Denominator: 20 matching records'));
assert(ready.includes('Unavailable'));
assert(ready.includes('role="img"'));
assert(ready.includes('aria-pressed="true">Weekly</button>'));
assert(ready.includes('Africa/Lagos'));
assert(!ready.includes('ANALYTICS-SECRET'));
const monthly = renderToStaticMarkup(React.createElement(router.MemoryRouter, null,
  React.createElement(view.OperationsAnalyticsView, { ...viewProps, summaryGranularity: 'monthly',
    state: { status: 'ready', data: parsed } })));
assert(monthly.includes('aria-pressed="true">Monthly</button>'));
assert(monthly.includes('2026'));
const offloadingScopeData = service.parseOperationsAnalytics({ ...response, period_summaries: {
  ...response.period_summaries,
  weekly: response.period_summaries.weekly.map(row => ({ ...row,
    outstanding_at_period_end: 0, outstanding_excluded_unassigned_offloading_site_count: 2,
  })),
  monthly: response.period_summaries.monthly.map(row => ({ ...row,
    outstanding_at_period_end: 0, outstanding_excluded_unassigned_offloading_site_count: 2,
  })),
  offloading_site_filter_scope: 'excludes_unassigned_at_period_end',
} });
const offloadingScopeHtml = render({ status: 'ready', data: offloadingScopeData });
assert(offloadingScopeHtml.includes('no offloading site assigned at period end'));
assert(offloadingScopeHtml.includes('Unassigned excluded'));
const noDriverHtml = render({ status: 'ready', data: noSelectedDriver });
assert(noDriverHtml.includes('Select a driver in the global filters'));
console.log('PASS Analytics loading/error states, driver daily panel, weekly/monthly toggle, denominators, and accessible tables');

const navigation = load('src/routing/roleRoutes.ts');
assert.deepEqual(navigation.OPERATIONS_NAVIGATION.map(item => item.label), [
  'Dashboard', 'Trips', 'Trucks & Drivers', 'Waybills & Payouts', 'Exceptions', 'Reports', 'Analytics',
]);
const app = readFileSync('src/App.tsx', 'utf8');
assert.match(app, /lazy\(\(\) => import\('\.\/features\/operations\/analytics\/OperationsAnalytics'\)/);
assert.match(app, /path="analytics"/);
assert.match(app, /filter\(item => item\.route !== 'analytics'\)/);
console.log('PASS Analytics navigation order, Operations route integration, and lazy-loaded chart bundle');
