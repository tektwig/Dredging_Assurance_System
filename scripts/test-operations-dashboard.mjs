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
let rpcCalls = [];
let rpcFailure = null;

const emptyCategory = { count: 0, items: [] };
const summaryResponse = {
  trips_opened_today: 3,
  trips_closed_today: 2,
  open_trips: 1,
  tonnage_today: 12.5,
  trucks_processed_today: 2,
  exceptions_requiring_attention: 0,
  action_required: {
    unresolved_exceptions: emptyCategory,
    failed_waybill_pdfs: emptyCategory,
    failed_waybill_emails: emptyCategory,
    payment_details_required: emptyCategory,
  },
};
const openTripsResponse = {
  as_of: '2026-09-27T10:00:00.000Z',
  items: [{ trip_id: 'trip-1', trip_number: 'TRP-1', truck_registration: 'ABC-123',
    driver_name: 'Driver One', loading_site_name: 'Loading Site', opened_at: '2026-09-27T09:00:00.000Z',
    duration_seconds: 3600, status: 'open' }],
};
const activityResponse = {
  as_of: '2026-09-27T10:00:00.000Z',
  items: [
    { event_id: 'trip-opened:trip-1', event_type: 'trip_opened', occurred_at: '2026-09-27T09:00:00.000Z',
      trip_number: 'TRP-1', truck_registration: 'ABC-123', officer_id: 'officer-1',
      officer_name: 'Officer One', officer_role: 'operations_manager', site_name: 'Loading Site', payment_status: null },
    { event_id: 'waybill-issued:invoice-1', event_type: 'waybill_issued', occurred_at: '2026-09-27T09:30:00.000Z',
      trip_number: 'TRP-1', truck_registration: 'ABC-123', officer_id: 'officer-1',
      officer_name: 'Officer One', officer_role: 'offloading_officer', site_name: 'Offloading Site', payment_status: null },
  ],
};
const rpcData = {
  get_operations_dashboard_summary: summaryResponse,
  get_operations_dashboard_open_trips: openTripsResponse,
  get_operations_dashboard_activity: activityResponse,
};

overrides.set(resolve('src/lib/supabase.ts'), {
  supabase: {
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return rpcFailure ?? { data: rpcData[name], error: null };
    },
  },
});

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

const service = load('src/features/operations/services/operationsDashboard.ts');
const dashboard = load('src/features/operations/dashboard/OperationsDashboard.tsx');
const renderView = state => renderToStaticMarkup(React.createElement(router.MemoryRouter, null,
  React.createElement(dashboard.OperationsDashboardView, { state, onRetry() {} })));
const summary = service.parseOperationsDashboardSummary(summaryResponse);
assert.equal(summary.tripsOpenedToday, 3);
assert.equal(summary.tonnageToday, 12.5);
assert.equal(summary.actionRequired.failedWaybillEmails.count, 0);
assert.throws(() => service.parseOperationsDashboardSummary({ ...summaryResponse, bank_name: 'unexpected' }), /Invalid/);
assert.throws(() => service.parseOperationsDashboardSummary({ ...summaryResponse, tonnage_today: 1.234 }), /Invalid/);
assert.throws(() => service.parseOperationsDashboardSummary({ ...summaryResponse, action_required: {
  ...summaryResponse.action_required,
  unresolved_exceptions: { count: 1, items: [{ exception_id: null, exception_type: 'invalid_state',
    trip_number: null, truck_registration: null, created_at: '2026-09-27T10:00:00.000Z' }] },
} }), /Invalid/);

rpcCalls = [];
const data = await service.loadOperationsDashboard();
assert.equal(data.openTrips.items.length, 1);
assert.deepEqual(rpcCalls.map(call => call.name), [
  'get_operations_dashboard_summary', 'get_operations_dashboard_open_trips', 'get_operations_dashboard_activity',
]);
assert.deepEqual(rpcCalls[1].args, { p_limit: 10 });
assert.deepEqual(rpcCalls[2].args, { p_limit: 20 });
rpcFailure = { data: null, error: { code: '42501' } };
await assert.rejects(service.loadOperationsDashboard(), /access denied/i);
rpcFailure = null;
console.log('PASS strict response validation, safe authorization errors and fixed bounded RPC request limits');

const loadingHtml = renderView({ status: 'loading' });
assert.match(loadingHtml, /role="status"/);
assert.match(loadingHtml, /Loading results/);
const errorHtml = renderView({ status: 'error' });
assert.match(errorHtml, /Unable to load the Operations dashboard/);
assert.match(errorHtml, />Retry</);
let retried = false;
const resultState = load('src/components/data/ListResultState.tsx');
const retryElement = dashboard.OperationsDashboardView({ state: { status: 'error' }, onRetry: () => { retried = true; } });
const retryTree = resultState.ListResultState(retryElement.props);
React.Children.toArray(retryTree.props.children).find(child => React.isValidElement(child) && child.type === 'button').props.onClick();
assert.equal(retried, true);
const emptyData = {
  summary,
  openTrips: { as_of: openTripsResponse.as_of, items: [] },
  activity: { as_of: activityResponse.as_of, items: [] },
};
const emptyHtml = renderView({ status: 'ready', data: emptyData });
assert.match(emptyHtml, /There are no open trips/);
assert.match(emptyHtml, /No recent operational activity/);
assert.match(emptyHtml, /No items requiring attention/);
const readyHtml = renderView({ status: 'ready', data });
for (const label of ['Trips Opened Today', 'Trips Closed Today', 'Open Trips', 'Tonnage Today',
  'Trucks Processed Today', 'Exceptions Requiring Attention', 'Open Trips Requiring Attention',
  'Action Required', 'Recent Activity', 'Waybill Issued', 'TRP-1']) assert(readyHtml.includes(label), label);
assert(readyHtml.includes('12.50'));
assert(readyHtml.includes('href="/operations/trips"'));
assert(readyHtml.includes('href="/operations/waybills-payouts"'));
assert(!readyHtml.includes('<button'));
console.log('PASS loading, error, empty and ready dashboard states; read-only cards, previews and module links');
