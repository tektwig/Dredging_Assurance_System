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
const rpcCalls = [];
let rpcHandler;

function load(path) {
  const full = resolve(path);
  if (overrides.has(full)) return overrides.get(full);
  if (cache.has(full)) return cache.get(full).exports;
  const module = { exports: {} };
  cache.set(full, module);
  const source = readFileSync(full, 'utf8').replaceAll('import.meta.env', '(globalThis.__testEnv || { DEV: true })');
  const output = ts.transpileModule(source, {
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

overrides.set(resolve('src/lib/supabase.ts'), {
  supabase: { async rpc(name, args) {
    rpcCalls.push({ name, args });
    return rpcHandler(name, args);
  } },
});

const service = load('src/features/operations/services/operationsTrips.ts');
const register = load('src/features/operations/trips/OperationsTripsRegister.tsx');
const detailView = load('src/features/operations/trips/OperationsTripDetail.tsx');
const payoutMigrationPath = 'supabase/migrations/20261018124936_restore_operations_trip_detail_payout.sql';
const payoutMigration = readFileSync(payoutMigrationPath, 'utf8');
const estimatedTonnageMigration = readFileSync('supabase/migrations/20260927001100_scan_first_estimated_tonnage.sql', 'utf8');
const detailFunction = source => source.match(/create or replace function public\.get_operations_trip_detail\(p_trip_id uuid\) returns jsonb[\s\S]*?\$\$;/i)?.[0];
const normalizeSql = source => source.replace(/\s+/g, ' ').trim().toLowerCase();
assert(detailFunction(payoutMigration), 'Forward migration defines the trip-detail RPC');
assert.equal(normalizeSql(detailFunction(payoutMigration)), normalizeSql(detailFunction(estimatedTonnageMigration)),
  'Forward migration preserves the complete hardened function from the latest repository migration');
assert.match(payoutMigration, /to_regprocedure\('public\.get_operations_trip_detail\(uuid\)'\) is null/i);
assert.match(payoutMigration, /private\.require_role\(array\['operations_manager'\]::public\.app_role\[\]\)/i);
assert.match(payoutMigration, /stable security definer set search_path\s*=\s*''/i);
assert.doesNotMatch(detailFunction(payoutMigration), /payment\.(?:account_name|account_number|bank_name|driver_email|driver_phone|payment_reference)/i);
assert.doesNotMatch(payoutMigration, /^\s*(?:grant|revoke)\b/im);
console.log('PASS payout restoration migration preserves the hardened RPC contract, authorization, and grants');
const timestamp = '2026-09-27T09:00:00.000Z';
const tripRow = {
  trip_id: 'trip-1', trip_number: 'TRP-2026-001', truck_id: 'truck-1', truck_registration: 'ABC-001',
  driver_id: 'driver-1', driver_name: 'Driver At Loading', loading_site_id: 'site-1',
  loading_site_name: 'Loading Site', opened_at: timestamp, offloading_site_id: 'site-2',
  offloading_site_name: 'Offloading Site', closed_at: '2026-09-27T12:00:00.000Z',
  quantity_tonnes: 12.5, status: 'closed',
};
const tripsPage = { items: [tripRow], page: 1, page_size: 25, total_count: 1, has_next: false };
const officer = { officer_id: 'officer-1', display_name: 'Safe Officer Name', role: 'offloading_officer' };
const detail = {
  trip: {
    trip_id: tripRow.trip_id, trip_number: tripRow.trip_number, status: 'closed', truck_id: tripRow.truck_id,
    truck_registration: tripRow.truck_registration, driver_id: tripRow.driver_id, driver_name: tripRow.driver_name,
    loading_site_id: tripRow.loading_site_id, loading_site_name: 'Snapshot Loading Site', opened_at: timestamp,
    loading_officer: { ...officer, role: 'loading_officer' }, offloading_site_id: 'site-2',
    offloading_site_name: 'Snapshot Offloading Site', closed_at: tripRow.closed_at,
    quantity_tonnes: 12.5, estimated_quantity_tonnes: 10.25,
    offloading_officer: officer, cancelled_at: null, cancelled_officer: null,
  },
  waybill: { invoice_number: 'INV-2026-000001', issued_at: timestamp, pdf_status: 'ready' },
  payout: { status: 'pending', created_at: timestamp, payment_ready_at: timestamp, paid_at: null },
  exceptions: [{ exception_id: 'exception-1', exception_type: 'dispute', status: 'open', raised_at: timestamp, resolved_at: null }],
};
const request = { page: 1, pageSize: 25 };
function findElement(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
  } else if (React.isValidElement(node)) {
    if (predicate(node)) return node;
    return findElement(node.props.children, predicate);
  }
  return null;
}

assert.equal(service.parseOperationsTripsPage(tripsPage, request).items[0].driver_name, 'Driver At Loading');
assert.throws(() => service.parseOperationsTripsPage({ ...tripsPage, account_number: 'unsafe' }, request), /Invalid/);
assert.throws(() => service.parseOperationsTripsPage({ ...tripsPage, items: [{ ...tripRow, raw_provider_error: 'unsafe' }] }, request), /Invalid/);
assert.throws(() => service.parseOperationsTripsPage({ ...tripsPage, page_size: 101 }, request), /Invalid/);
const parsedDetail = service.parseOperationsTripDetail(detail);
assert.equal(parsedDetail.waybill.pdf_status, 'ready');
assert.equal(parsedDetail.payout.status, 'pending');
assert.equal(parsedDetail.exceptions[0].exception_type, 'dispute');
assert.equal(parsedDetail.trip.estimated_quantity_tonnes, 10.25);
assert.equal(parsedDetail.trip.quantity_tonnes, 12.5);
const detailMissingEstimate = { ...detail, trip: { ...detail.trip } };
delete detailMissingEstimate.trip.estimated_quantity_tonnes;
assert.throws(() => service.parseOperationsTripDetail(detailMissingEstimate), /Invalid/);
assert.throws(() => service.parseOperationsTripDetail({ ...detail,
  trip: { ...detail.trip, account_number: 'unsafe' } }), /Invalid/);
assert.throws(() => service.parseOperationsTripDetail({ ...detail,
  trip: { ...detail.trip, estimated_quantity_tonnes: 'invalid' } }), /Invalid/);
assert.throws(() => service.parseOperationsTripDetail({ ...detail, bank_name: 'unsafe' }), /Invalid/);
assert.throws(() => service.parseOperationsTripDetail({ ...detail, payout: { ...detail.payout, account_number: 'unsafe' } }), /Invalid/);
assert.throws(() => service.parseOperationsTripDetail({ ...detail, exceptions: [{ ...detail.exceptions[0], description: 'unsafe' }] }), /Invalid/);
assert.equal(service.parseOperationsTripDetail(null), null);
console.log('PASS strict list/detail response validation rejects unapproved banking, provider, and exception fields');

rpcCalls.length = 0;
rpcHandler = async (name, args) => ({ data: name === 'get_operations_trips'
  ? { ...tripsPage, page: args.p_page, page_size: args.p_page_size } : null, error: null });
const filters = { search: ' TRP ', status: 'closed', dateFrom: '2026-09-01', dateTo: '2026-09-27',
  truck: ' AB-C 001 ', driver: ' Driver ', loadingSite: ' Load ', offloadingSite: ' Offload ' };
await service.loadOperationsTrips(filters, 2, 200);
assert.deepEqual(rpcCalls[0], { name: 'get_operations_trips', args: {
  p_page: 2, p_page_size: 100, p_search: 'TRP', p_status: 'closed', p_date_from: '2026-09-01',
  p_date_to: '2026-09-27', p_truck_filter: 'AB-C 001', p_driver_filter: 'Driver',
  p_loading_site_filter: 'Load', p_offloading_site_filter: 'Offload',
} });
console.log('PASS server-side register requests retain filters and bound page size to 100');

const registerHtml = (state, selectedFilters = register.EMPTY_TRIP_FILTERS, page = 1) => renderToStaticMarkup(
  React.createElement(router.MemoryRouter, null, React.createElement(register.OperationsTripsRegisterView, {
    state, filters: selectedFilters, page, onFiltersChange() {}, onPageChange() {}, onRetry() {},
  })),
);
assert.match(registerHtml({ status: 'loading' }), /Loading results/);
assert.match(registerHtml({ status: 'error' }), /Unable to load the trip register/);
assert.match(registerHtml({ status: 'error' }), />Retry</);
assert.match(registerHtml({ status: 'ready', data: { ...tripsPage, items: [] } }), /No trips match these filters/);
const registerReadyHtml = registerHtml({ status: 'ready', data: tripsPage }, filters, 1);
for (const label of ['Trip #', 'Plate', 'Driver', 'Loading Site', 'Opened At', 'Offloading Site', 'Closed At', 'Tonnage', 'Status']) {
  assert(registerReadyHtml.includes(label), label);
}
assert(registerReadyHtml.includes('Driver At Loading'));
assert(registerReadyHtml.includes('12.50 t'));
assert(registerReadyHtml.includes('href="/operations/trips/trip-1"'));
assert.match(readFileSync('src/App.tsx', 'utf8'), /path="trips\/:tripId"\s+element=\{<OperationsTripDetail\s*\/>\}/);
assert(registerReadyHtml.includes('Trip register filters'));
assert(!registerReadyHtml.includes('Cancel open trip'));
rpcCalls.length = 0;
rpcHandler = async name => {
  assert.equal(name, 'get_operations_trip_detail');
  return { data: detail, error: null };
};
const selectedTripDetail = await service.loadOperationsTripDetail('trip-1');
assert.equal(selectedTripDetail.trip.trip_id, 'trip-1');
assert.equal(selectedTripDetail.trip.estimated_quantity_tonnes, 10.25);
assert.deepEqual(rpcCalls, [{ name: 'get_operations_trip_detail', args: { p_trip_id: 'trip-1' } }]);
console.log('PASS Trips register link resolves to the Operations detail route and loads the selected trip');
const invalidResponseLoad = async response => {
  rpcHandler = async () => ({ data: response, error: null });
  await assert.rejects(service.loadOperationsTripDetail('trip-1'), /Invalid Operations Trips response/);
};
const missingDriverName = { ...detail, trip: { ...detail.trip } };
delete missingDriverName.trip.driver_name;
await invalidResponseLoad(missingDriverName);
await invalidResponseLoad(detailMissingEstimate);
const detailMissingPayout = { ...detail };
delete detailMissingPayout.payout;
await invalidResponseLoad(detailMissingPayout);
await invalidResponseLoad({ ...detail, trip: { ...detail.trip, bank_name: 'synthetic-sensitive-value' } });
await invalidResponseLoad({ ...detail, trip: { ...detail.trip, quantity_tonnes: 'invalid' } });
await invalidResponseLoad({ ...detail, trip: { ...detail.trip, opened_at: 'invalid-timestamp' } });
await invalidResponseLoad({ ...detail, trip: { ...detail.trip, status: 'open' } });
const rpcErrorMessage = 'synthetic-sensitive-value';
rpcHandler = async () => ({ data: null, error: { code: '42501', message: rpcErrorMessage } });
await assert.rejects(service.loadOperationsTripDetail('trip-1'), /access denied/);
rpcHandler = async () => ({ data: null, error: { code: '23514', message: rpcErrorMessage } });
await assert.rejects(service.loadOperationsTripDetail('trip-1'), error =>
  error.message === 'Unable to load Operations trip' && !error.message.includes(rpcErrorMessage));
console.log('PASS strict trip-detail response validation and safe RPC error handling');
const resultState = load('src/components/data/ListResultState.tsx');
let registerRetried = false;
const registerErrorTree = register.OperationsTripsRegisterView({ state: { status: 'error' },
  filters: register.EMPTY_TRIP_FILTERS, page: 1, onFiltersChange() {}, onPageChange() {}, onRetry() { registerRetried = true; } });
const registerErrorNode = findElement(registerErrorTree, element => element.type === resultState.ListResultState);
const registerErrorContents = resultState.ListResultState(registerErrorNode.props);
findElement(registerErrorContents, element => element.type === 'button').props.onClick();
assert.equal(registerRetried, true);
let changedFilters;
const registerTree = register.OperationsTripsRegisterView({ state: { status: 'ready', data: tripsPage },
  filters: { ...register.EMPTY_TRIP_FILTERS, driver: 'old' }, page: 1,
  onFiltersChange(value) { changedFilters = value; }, onPageChange() {}, onRetry() {} });
const filterElement = findElement(registerTree, element => element.type.name === 'TripFilters');
const filtersTree = filterElement.type(filterElement.props);
findElement(filtersTree, element => element.props.id === 'trip-driver-filter')
  .props.onChange({ currentTarget: { value: 'Driver At Loading' } });
assert.equal(changedFilters.driver, 'Driver At Loading');
findElement(filtersTree, element => element.type === 'button').props.onClick();
assert.deepEqual(changedFilters, register.EMPTY_TRIP_FILTERS);
let selectedPage;
const readyTree = register.OperationsTripsRegisterView({ state: { status: 'ready', data: tripsPage },
  filters: register.EMPTY_TRIP_FILTERS, page: 1, onFiltersChange() {}, onPageChange(value) { selectedPage = value; }, onRetry() {} });
const paginationElement = findElement(readyTree, element => element.type.name === 'PaginationControls');
paginationElement.props.onPageChange(2);
assert.equal(selectedPage, 2);
console.log('PASS register loading/error/empty/ready states, safe read-only columns, filters, and detail navigation');

const detailHtml = (state, props = {}) => renderToStaticMarkup(
  React.createElement(router.MemoryRouter, null, React.createElement(detailView.OperationsTripDetailView, {
    state, onRetry() {}, ...props,
  })),
);
assert.match(detailHtml({ status: 'loading' }), /Loading results/);
assert.match(detailHtml({ status: 'error' }), /Unable to load this trip/);
assert.match(detailHtml({ status: 'not-found' }), /Trip not found/);
const closedHtml = detailHtml({ status: 'ready', data: parsedDetail });
for (const value of ['Authoritative lifecycle', 'Loading', 'Open Trip', 'Offloading', 'Closed', 'Waybill', 'Payout',
  'INV-2026-000001', 'PDF: ready', 'Safe Officer Name', 'Exceptions']) assert(closedHtml.includes(value), value);
assert.match(closedHtml, /<dt>Estimated tonnage<\/dt><dd>10\.25 tonnes<\/dd>/);
assert.match(closedHtml, /<dt>Tonnage<\/dt><dd>12\.50 tonnes<\/dd>/);
assert.equal(parsedDetail.waybill.waybill_number, 'INV-2026-000001', 'Historical Waybill references remain visible');
assert(!('invoice_number' in parsedDetail.waybill), 'The frontend exposes Waybill terminology');
assert(!closedHtml.includes('Cancel open trip'));
assert(!closedHtml.includes('Edit Trip'));
assert(!closedHtml.includes('Commercial Invoice'));
assert(!closedHtml.includes('View / Download Invoice'));
assert(!closedHtml.includes('DL-7492-LG'));
assert(!closedHtml.includes('account_number'));
assert(!closedHtml.includes('description'));
assert(closedHtml.includes('Estimated tonnage') && closedHtml.includes('10.25 tonnes')
  && closedHtml.includes('12.50 tonnes'));
const unknownPdfStatus = { ...parsedDetail, waybill: { ...parsedDetail.waybill, pdf_status: null } };
const unknownPdfHtml = detailHtml({ status: 'ready', data: unknownPdfStatus });
assert(unknownPdfHtml.includes('PDF: Unavailable'));
assert(!unknownPdfHtml.includes('PDF: Ready'));
const openTripDetail = { ...detail, trip: { ...detail.trip, status: 'open', closed_at: null,
  offloading_site_id: null, offloading_site_name: null, quantity_tonnes: null,
  offloading_officer: null, cancelled_at: null, cancelled_officer: null }, waybill: null, payout: null, exceptions: [] };
const parsedOpenTripDetail = service.parseOperationsTripDetail(openTripDetail);
assert.equal(parsedOpenTripDetail.trip.status, 'open');
assert.equal(parsedOpenTripDetail.trip.estimated_quantity_tonnes, 10.25);
assert.equal(parsedOpenTripDetail.trip.quantity_tonnes, null);
const openHtml = detailHtml({ status: 'ready', data: parsedOpenTripDetail }, {
  onOpenCancellation() {}, onCloseCancellation() {}, onReasonChange() {}, onCancel() {},
});
assert(openHtml.includes('Cancel open trip'));
assert.match(openHtml, /<dt>Tonnage<\/dt><dd>—<\/dd>/);
assert(openHtml.includes('role="dialog"'));
assert(openHtml.includes('required'));
assert(openHtml.includes('Confirm cancellation'));
assert.match(openHtml, /disabled=""[^>]*>Confirm cancellation/);
const cancelledDetail = { ...detail, trip: { ...detail.trip, status: 'cancelled', closed_at: null,
  offloading_site_id: null, offloading_site_name: null, quantity_tonnes: null, offloading_officer: null,
  cancelled_at: timestamp, cancelled_officer: officer }, waybill: null, payout: null, exceptions: [] };
const parsedCancelledDetail = service.parseOperationsTripDetail(cancelledDetail);
assert.equal(parsedCancelledDetail.trip.status, 'cancelled');
assert.equal(parsedCancelledDetail.trip.estimated_quantity_tonnes, 10.25);
assert.equal(parsedCancelledDetail.trip.quantity_tonnes, null);
const cancelledHtml = detailHtml({ status: 'ready', data: parsedCancelledDetail });
assert(cancelledHtml.includes('Trip Cancelled'));
assert.match(cancelledHtml, /<dt>Tonnage<\/dt><dd>—<\/dd>/);
assert(cancelledHtml.includes('closure, Waybill and payout steps are not implied'));
assert(!cancelledHtml.includes('Invoice'));
console.log('PASS detail lifecycle, cancellation terminal state, and open-only required-reason dialog');

const cancelledResponse = { ...detail, trip: { ...detail.trip, status: 'cancelled', closed_at: null,
  offloading_site_id: null, offloading_site_name: null, quantity_tonnes: null, offloading_officer: null,
  cancelled_at: timestamp, cancelled_officer: detail.trip.loading_officer }, waybill: null, payout: null };

rpcCalls.length = 0;
rpcHandler = async name => name === 'cancel_trip' ? { data: null, error: null }
  : { data: cancelledResponse, error: null };
const cancellation = await service.cancelOperationsTripAndRefresh('trip-1', 'valid reason');
assert.equal(cancellation.outcome, 'cancelled');
assert.deepEqual(rpcCalls.map(call => call.name), ['cancel_trip', 'get_operations_trip_detail']);
assert.deepEqual(rpcCalls[0].args, { p_trip_id: 'trip-1', p_reason: 'valid reason' });

rpcCalls.length = 0;
rpcHandler = async name => name === 'cancel_trip' ? { data: null, error: { code: '22023', message: 'unsafe raw provider/bank info' } }
  : { data: cancelledResponse, error: null };
const conflict = await service.cancelOperationsTripAndRefresh('trip-1', 'reason');
assert.equal(conflict.outcome, 'conflict');
assert.deepEqual(rpcCalls.map(call => call.name), ['cancel_trip', 'get_operations_trip_detail']);
assert(!JSON.stringify(conflict).includes('unsafe raw'));

rpcCalls.length = 0;
rpcHandler = async name => name === 'cancel_trip' ? { data: null, error: { code: '42501', message: 'unsafe provider/bank info' } }
  : { data: detail, error: null };
const denied = await service.cancelOperationsTripAndRefresh('trip-1', 'reason');
assert.equal(denied.outcome, 'denied');
assert.deepEqual(rpcCalls.map(call => call.name), ['cancel_trip', 'get_operations_trip_detail']);
assert(!JSON.stringify(denied).includes('unsafe provider'));

rpcCalls.length = 0;
rpcHandler = async name => {
  if (name === 'cancel_trip') throw new Error('unsafe network provider error');
  return { data: { ...openTripDetail, trip: { ...openTripDetail.trip, trip_id: 'trip-1' } }, error: null };
};
const failed = await service.cancelOperationsTripAndRefresh('trip-1', 'reason');
assert.equal(failed.outcome, 'failed');
assert.deepEqual(rpcCalls.map(call => call.name), ['cancel_trip', 'get_operations_trip_detail']);
await assert.rejects(service.cancelOperationsTripAndRefresh('trip-1', '  '), /reason is required/);
console.log('PASS cancellation always reloads authoritative detail after success, conflict, authorization, or transport errors');
