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
      officer_name: 'Officer One', officer_role: 'operations_manager', site_name: 'Loading Site' },
    { event_id: 'waybill-issued:waybill-1', event_type: 'waybill_issued', occurred_at: '2026-09-27T09:30:00.000Z',
      trip_number: 'TRP-1', truck_registration: 'ABC-123', officer_id: 'officer-1',
      officer_name: 'Officer One', officer_role: 'offloading_officer', site_name: 'Offloading Site' },
    { event_id: 'pdf-ready:legacy-document-1', event_type: 'pdf_ready', occurred_at: '2026-09-27T09:45:00.000Z',
      trip_number: 'TRP-1', truck_registration: 'ABC-123', officer_id: null,
      officer_name: null, officer_role: null, site_name: 'Offloading Site' },
  ],
};
const queueHealthResponse = {
  as_of: '2026-09-27T10:00:00.000Z',
  pdf: { pending_total: 4, due_pending: 3, processing_total: 2, active_processing: 1,
    expired_processing_leases: 1, failed: 1, ready: 12, unexpected_status: 0,
    latest_status: 'failed', latest_updated_at: '2026-09-27T09:59:00.000Z' },
  notifications: { pending_total: 5, due_pending: 2, processing_total: 2, active_processing: 1,
    expired_processing_leases: 1, failed: 2, provider_accepted: 6,
    blocked_missing_email: 0, blocked_configuration: 0, unexpected_status: 0,
    latest_status: 'provider_accepted', latest_updated_at: '2026-09-27T09:58:00.000Z' },
};
const missingBankQueueResponse = {
  as_of: '2026-09-27T10:00:00.000Z', count: 1,
  items: [{ invoice_id: 'invoice-1', invoice_number: 'WB-2026-000040',
    trip_number: 'TRP-40', issued_at: '2026-09-27T08:30:00.000Z' }],
};
const rpcData = {
  get_operations_dashboard_summary: summaryResponse,
  get_operations_dashboard_open_trips: openTripsResponse,
  get_operations_dashboard_activity: activityResponse,
  get_operations_dashboard_queue_health: queueHealthResponse,
  get_operations_missing_bank_waybills: missingBankQueueResponse,
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
const renderView = (state, queueHealthState = { status: 'ready', data: queueHealthResponse },
  missingBankQueueState = { status: 'ready', data: missingBankQueueResponse }) => renderToStaticMarkup(
  React.createElement(router.MemoryRouter, null,
    React.createElement(dashboard.OperationsDashboardView, { state, onRetry() {}, queueHealthState,
      onQueueHealthRetry() {}, missingBankQueueState, onMissingBankQueueRetry() {} })));
const summary = service.parseOperationsDashboardSummary(summaryResponse);
assert.equal(summary.tripsOpenedToday, 3);
assert.equal(summary.tonnageToday, 12.5);
assert.equal(summary.actionRequired.failedWaybillEmails.count, 0);
const waybillSummaryResponse = { ...summaryResponse, action_required: { ...summaryResponse.action_required,
  failed_waybill_pdfs: { count: 1, items: [{ document_id: 'doc-1', invoice_number: 'INV-2026-000001',
    trip_number: 'TRP-1', failed_at: '2026-09-27T10:00:00.000Z' }] } } };
const waybillSummary = service.parseOperationsDashboardSummary(waybillSummaryResponse);
assert.equal(waybillSummary.actionRequired.failedWaybillPdfs.items[0].waybill_number, 'INV-2026-000001');
assert(!('invoice_number' in waybillSummary.actionRequired.failedWaybillPdfs.items[0]));
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
assert.equal(data.activity.items[1].event_id, 'waybill-issued:waybill-1');
assert.equal(data.activity.items[1].occurred_at, '2026-09-27T09:30:00.000Z');
assert.equal(data.activity.items[2].event_id, 'pdf-ready:legacy-document-1');
assert.equal(data.activity.items[2].occurred_at, '2026-09-27T09:45:00.000Z');
assert.deepEqual(rpcCalls.map(call => call.name), [
  'get_operations_dashboard_summary', 'get_operations_dashboard_open_trips', 'get_operations_dashboard_activity',
]);
assert.deepEqual(rpcCalls[1].args, { p_limit: 10 });
assert.deepEqual(rpcCalls[2].args, { p_limit: 20 });
rpcCalls = [];
const queueHealth = await service.loadOperationsDashboardQueueHealth();
assert.deepEqual(rpcCalls.map(call => call.name), ['get_operations_dashboard_queue_health']);
assert.equal(queueHealth.pdf.due_pending, 3);
assert.equal(queueHealth.pdf.expired_processing_leases, 1);
assert.equal(queueHealth.notifications.completed, 6);
assert.equal(queueHealth.notifications.latest_status, 'provider_accepted');
assert.throws(() => service.parseOperationsDashboardQueueHealth({ ...queueHealthResponse, storage_path: 'private/path' }), /Invalid/);
assert.throws(() => service.parseOperationsDashboardQueueHealth({ ...queueHealthResponse,
  pdf: { ...queueHealthResponse.pdf, recipient: 'private@example.invalid' } }), /Invalid/);
assert.throws(() => service.parseOperationsDashboardQueueHealth({ ...queueHealthResponse,
  pdf: { ...queueHealthResponse.pdf, due_pending: 5 } }), /Invalid/);
assert.throws(() => service.parseOperationsDashboardQueueHealth({ ...queueHealthResponse,
  notifications: { ...queueHealthResponse.notifications, active_processing: 2 } }), /Invalid/);
assert.throws(() => service.parseOperationsDashboardQueueHealth({ ...queueHealthResponse,
  notifications: { ...queueHealthResponse.notifications, latest_status: 'ready' } }), /Invalid/);
const unrecognizedQueueHealth = service.parseOperationsDashboardQueueHealth({ ...queueHealthResponse,
  pdf: { ...queueHealthResponse.pdf, unexpected_status: 1, latest_status: 'unknown' } });
assert.equal(unrecognizedQueueHealth.pdf.latest_status, 'unknown');
const emptyQueueHealth = {
  as_of: queueHealthResponse.as_of,
  pdf: { pending_total: 0, due_pending: 0, processing_total: 0, active_processing: 0,
    expired_processing_leases: 0, failed: 0, ready: 0, unexpected_status: 0,
    latest_status: null, latest_updated_at: null },
  notifications: { pending_total: 0, due_pending: 0, processing_total: 0, active_processing: 0,
    expired_processing_leases: 0, failed: 0, provider_accepted: 0,
    blocked_missing_email: 0, blocked_configuration: 0, unexpected_status: 0,
    latest_status: null, latest_updated_at: null },
};
assert.equal(service.parseOperationsDashboardQueueHealth(emptyQueueHealth).pdf.pending_total, 0);
const missingQueue = service.parseOperationsMissingBankQueue(missingBankQueueResponse);
assert.equal(missingQueue.count, 1);
assert.equal(missingQueue.items[0].invoice_number, 'WB-2026-000040');
assert.throws(() => service.parseOperationsMissingBankQueue({ ...missingBankQueueResponse,
  items: [{ ...missingBankQueueResponse.items[0], account_number: 'sensitive' }] }), /Invalid/);
assert.throws(() => service.parseOperationsMissingBankQueue({ ...missingBankQueueResponse,
  items: [{ ...missingBankQueueResponse.items[0], storage_path: 'private/path' }] }), /Invalid/);
assert.equal(service.parseOperationsMissingBankQueue({ ...missingBankQueueResponse, count: 0, items: [] }).count, 0);
rpcCalls = [];
assert.equal((await service.loadOperationsMissingBankQueue()).items[0].invoice_id, 'invoice-1');
assert.deepEqual(rpcCalls.map(call => call.name), ['get_operations_missing_bank_waybills']);
rpcFailure = { data: null, error: { code: '42501' } };
await assert.rejects(service.loadOperationsDashboard(), /access denied/i);
await assert.rejects(service.loadOperationsDashboardQueueHealth(), /access denied/i);
await assert.rejects(service.loadOperationsMissingBankQueue(), /access denied/i);
rpcFailure = null;
console.log('PASS strict dashboard and queue response validation, sensitive-field exclusion, safe authorization errors and fixed RPC requests');

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
const resolvedMissingQueue = { ...missingBankQueueResponse, count: 0, items: [] };
const emptyHtml = renderView({ status: 'ready', data: emptyData }, { status: 'ready', data: emptyQueueHealth },
  { status: 'ready', data: resolvedMissingQueue });
assert.match(emptyHtml, /There are no open trips/);
assert.match(emptyHtml, /No recent operational activity/);
assert.match(emptyHtml, /No items requiring attention/);
assert.match(emptyHtml, /No closed Waybills are missing bank details/);
assert.match(emptyHtml, /No pending, processing, or failed jobs are currently recorded/);
const readyHtml = renderView({ status: 'ready', data });
const dashboardMigration = readFileSync(resolve('supabase/migrations/20261009000000_payment_free_waybill_cutover.sql'), 'utf8');
const pdfReadyStart = dashboardMigration.indexOf("(select 'pdf-ready:");
assert.notEqual(pdfReadyStart, -1);
const pdfReadySource = dashboardMigration.slice(pdfReadyStart, pdfReadyStart + 600);
assert.match(pdfReadySource, /'pdf_ready',\s*d\.ready_at/);
assert.match(pdfReadySource, /from public\.trip_closure_invoice_documents d/);
assert.match(pdfReadySource, /where d\.status='ready' and d\.ready_at is not null/);
assert(!pdfReadySource.includes('trip_closure_invoice_pdf_copies'));
for (const label of ['Trips Opened Today', 'Trips Closed Today', 'Open Trips', 'Tonnage Today',
  'Trucks Processed Today', 'Exceptions Requiring Attention', 'Open Trips Requiring Attention',
  'Action Required', 'Waybill Queue Health', 'PDF generation', 'Notifications', 'Pending', 'Due pending',
  'Processing total', 'Currently processing', 'Expired or missing lease', 'Failed', 'Completed',
  'Provider accepted', 'Unrecognized status', 'Latest current job status',
  'Recent Activity', 'Waybill Record Created', 'Legacy Waybill PDF Ready', 'TRP-1']) assert(readyHtml.includes(label), label);
assert(!readyHtml.includes('Waybill Issued'));
assert(!readyHtml.includes('>PDF Ready</td>'));
assert(readyHtml.includes('12.50'));
assert(readyHtml.includes('href="/operations/trips"'));
assert(readyHtml.includes('href="/operations/waybills"'));
assert(readyHtml.includes('Missing Bank Details'));
assert(readyHtml.includes('WB-2026-000040'));
assert(readyHtml.includes('href="/operations/waybills/invoice-1"'));
assert(readyHtml.includes('Server snapshot observed'));
assert(readyHtml.includes('Queue status does not establish whether a worker is running or healthy'));
assert(readyHtml.includes('not confirmed email delivery'));
assert(readyHtml.includes('Refresh queue status'));
assert(!readyHtml.includes('private@example.invalid'));
assert(!readyHtml.includes('Retry PDF'));
const unrecognizedQueueHtml = renderView({ status: 'ready', data }, { status: 'ready', data: unrecognizedQueueHealth });
assert(unrecognizedQueueHtml.includes('Latest current job status: <strong>Unrecognized status</strong>'));
const queueErrorHtml = renderView({ status: 'ready', data }, { status: 'error' });
assert(queueErrorHtml.includes('Unable to load queue health'));
assert(queueErrorHtml.includes('Recent Activity'));
const missingQueueErrorHtml = renderView({ status: 'ready', data }, { status: 'ready', data: queueHealthResponse },
  { status: 'error' });
assert(missingQueueErrorHtml.includes('Unable to load missing-bank Waybills'));
console.log('PASS existing dashboard compatibility, queue classifications, empty/error states, refresh controls and safe drill-down');
