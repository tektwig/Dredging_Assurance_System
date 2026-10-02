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
};

const service = load('src/features/operations/services/operationsAnalytics.ts');
const parsed = service.parseOperationsAnalytics(response);
assert.equal(parsed.variance.paired_trip_count, 7);
assert.equal(parsed.tonnage_trend[1].estimated_tonnage_tonnes, null);
assert.equal(parsed.status_distributions.payout.denominator, 12);
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
console.log('PASS strict Analytics response schema, explicit NULL estimates, denominators, and privacy fields');

calls.length = 0;
const filters = { period: 'custom', date_from: days[0], date_to: days.at(-1), truck_id: 'truck-id' };
assert.equal((await service.loadOperationsAnalytics(filters, 'offloading_site', 'average_turnaround')).range_start, days[0]);
assert.deepEqual(calls[0], { name: 'get_operations_analytics', args: {
  p_filters: filters, p_performance_dimension: 'offloading_site', p_performance_metric: 'average_turnaround',
} });
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
  today: days.at(-1), dimension: 'truck', metric: 'trips', onChangeFilters() {}, onSearchOptions() {},
  onSelectOption() {}, onRetryOptions() {}, onResetFilters() {}, onDimension() {}, onMetric() {}, onRetry() {},
};
const render = state => renderToStaticMarkup(React.createElement(router.MemoryRouter, null,
  React.createElement(view.OperationsAnalyticsView, { ...viewProps, state })));
assert.match(render({ status: 'loading' }), /Loading results/);
assert.match(render({ status: 'error' }), /Unable to load Operations Analytics/);
const ready = render({ status: 'ready', data: parsed });
for (const label of ['Analytics Centre', 'Total Trips', 'Actual Tonnage', 'Avg Tonnage / Trip',
  'Avg Turnaround Time', 'Avg Tonnage Variance', 'Trips Opened vs Closed', 'Estimated vs Actual Tonnage',
  'Performance', 'Status Distribution', 'Signed Variance Over Time', 'Average Signed Variance by Truck',
  'View daily trip trend data table', 'View estimated and actual tonnage data table',
  'View performance data table', 'View trip status data table', 'View daily signed variance data table']) {
  assert(ready.includes(label), `Analytics ready view should include ${label}`);
}
assert(ready.includes('Denominator: 20 matching records'));
assert(ready.includes('Unavailable'));
assert(ready.includes('role="img"'));
assert(ready.includes('Africa/Lagos'));
assert(!ready.includes('ANALYTICS-SECRET'));
console.log('PASS Analytics loading/error/ready states, KPI cards, visualization families, denominators, and tabular alternatives');

const navigation = load('src/routing/roleRoutes.ts');
assert.deepEqual(navigation.OPERATIONS_NAVIGATION.map(item => item.label), [
  'Dashboard', 'Trips', 'Trucks & Drivers', 'Waybills & Payouts', 'Exceptions', 'Reports', 'Analytics',
]);
const app = readFileSync('src/App.tsx', 'utf8');
assert.match(app, /lazy\(\(\) => import\('\.\/features\/operations\/analytics\/OperationsAnalytics'\)/);
assert.match(app, /path="analytics"/);
assert.match(app, /filter\(item => item\.route !== 'analytics'\)/);
console.log('PASS Analytics navigation order, Operations route integration, and lazy-loaded chart bundle');
