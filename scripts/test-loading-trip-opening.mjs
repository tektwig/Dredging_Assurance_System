// Behavioral contract tests with in-memory RPC transport; no network or database writes.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const overrides = new Map();
const cache = new Map();
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
    if (!name.startsWith('.')) return returnExternal(name);
    const base = resolve(dirname(full), name);
    const target = [base, base + '.ts', base + '.tsx'].find(existsSync);
    assert(target, `Import must resolve: ${name}`);
    return load(target);
  };
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}
function returnExternal(name) { return require(name); }

const review = {
  plate: 'ABC-123', truck: { id: 'truck-a', registrationNumber: 'ABC-123', normalizedRegistration: 'ABC123', isActive: true },
  actualDriver: { id: 'driver-b', fullName: 'Driver B', phoneNumber: '08012345678', email: null, isActive: true },
  regularDriverId: 'driver-a', site: { assignmentId: 'assignment-a', siteId: 'site-a', siteName: 'Loading Site' },
  makeRegular: false,
};
const rawSuccess = request => ({ ok: true, request_id: request.requestId,
  trip: { id: 'trip-a', trip_number: 'TRIP-001', status: 'open', truck_id: review.truck.id,
    driver_id: review.actualDriver.id, driver_name_at_loading: 'Authoritative Driver B',
    daily_registration_id: 'day-a', loading_site_id: review.site.siteId,
    loading_assignment_id: review.site.assignmentId, opened_at: '2026-09-24T10:01:00Z',
    opened_by: 'actor-a', quantity_tonnes: null },
  capture: { confirmed_plate: review.plate, normalized_confirmed_plate: 'ABC123',
    capture_method: 'MANUAL', image_recorded: false }, default_driver_changed: false });

let response;
let rpcError = null;
let rpcCalls = [];
overrides.set(resolve('src/lib/supabase.ts'), { supabase: {
  from(table) { assert.fail(`Unexpected direct table access: ${table}`); },
  async rpc(name, args) { assert.equal(name, 'create_loading_trip_v2'); rpcCalls.push(args);
    return { data: response, error: rpcError }; },
} });
const { openLoadingTrip } = load('src/features/loading/services/tripData.ts');
const request = { requestId: 'req-a', capturedAt: '2026-09-24T10:00:00.000Z', review };
response = rawSuccess(request);
let result = await openLoadingTrip(request);
assert.equal(result.kind, 'success');
assert.equal(result.trip.driverNameAtLoading, 'Authoritative Driver B');
assert.deepEqual(rpcCalls.at(-1), {
  p_request_id: 'req-a', p_plate: 'ABC-123', p_driver_id: 'driver-b', p_expected_assignment_id: 'assignment-a',
  p_capture_method: 'MANUAL', p_captured_at: request.capturedAt, p_ocr_detected_plate: null,
  p_ocr_confidence: null, p_image_path: null, p_make_default_driver: false,
});
const regularChangeRequest = { ...request, requestId: 'req-b', review: { ...review, makeRegular: true } };
response = { ...rawSuccess(regularChangeRequest), default_driver_changed: true };
assert.equal((await openLoadingTrip(regularChangeRequest)).defaultDriverChanged, true);
assert.equal(rpcCalls.at(-1).p_make_default_driver, true);
response = { ok: false, code: 'OPEN_TRIP_EXISTS', details: { trip_number: 'TRIP-OPEN' } };
assert.deepEqual(await openLoadingTrip(request), { kind: 'business_failure', code: 'OPEN_TRIP_EXISTS', tripNumber: 'TRIP-OPEN' });
rpcError = { code: '42501', message: 'private error' };
await assert.rejects(openLoadingTrip(request), { message: 'Loading access unavailable' });
rpcError = { code: 'PGRST000', message: 'private error' };
await assert.rejects(openLoadingTrip(request), { message: 'Trip opening outcome unknown' });
rpcError = null;
response = { ok: true, trip: { id: 'bad' } };
await assert.rejects(openLoadingTrip(request), { message: 'Trip opening outcome unknown' });
console.log('PASS exact manual RPC payload, authoritative response, business and auth/error mapping');

const { OpenTripController } = load('src/features/loading/utils/openTripController.ts');
let ids = 0; let timestamps = 0; let opened = 0; let siteChanged = 0; let accessLost = 0; let stale = [];
let dispatched = [];
let handler = async req => { dispatched.push(req); return { kind: 'success', requestId: req.requestId,
  trip: { id: 'trip-a', tripNumber: 'TRIP-001', driverNameAtLoading: 'Authoritative Driver B',
    openedAt: '2026-09-24T10:01:00Z' }, capture: { confirmedPlate: req.review.plate }, defaultDriverChanged: false }; };
const controller = new OpenTripController(req => handler(req), () => {}, () => opened++,
  () => siteChanged++, () => accessLost++, () => `uuid-${++ids}`,
  () => `capture-${++timestamps}`, result => stale.push(result));
controller.setInput(review);
controller.beginReview();
assert.equal(controller.current.status, 'review');
await controller.submit();
assert.equal(controller.current.status, 'success');
assert.equal(controller.current.result.trip.driverNameAtLoading, 'Authoritative Driver B');
assert.equal(opened, 1);
controller.nextTruck();
assert.equal(controller.current.status, 'idle');
assert.equal(controller.frozenRequest, null);
controller.setInput(review);
controller.beginReview();
let resolvePending;
handler = req => { dispatched.push(req); return new Promise(resolve => { resolvePending = resolve; }); };
const first = controller.submit();
const count = dispatched.length;
await controller.submit();
assert.equal(dispatched.length, count, 'double submit must not send another RPC');
resolvePending({ kind: 'success', requestId: 'uuid-2', trip: { tripNumber: 'TRIP-002' } });
await first;
assert.equal(controller.current.status, 'success');

controller.nextTruck(); controller.setInput(review); controller.beginReview();
handler = async req => { dispatched.push(req); throw new Error('network unknown'); };
await controller.submit();
assert.equal(controller.current.status, 'ambiguous');
const frozen = controller.frozenRequest;
assert(frozen);
assert(Object.isFrozen(frozen) && Object.isFrozen(frozen.review) && Object.isFrozen(frozen.review.site));
controller.backToDriver();
assert.equal(controller.current.status, 'ambiguous', 'ambiguous outcome cannot be abandoned through Back');
await controller.submit();
assert.equal(dispatched.at(-1), frozen, 'explicit ambiguous retry must reuse same immutable request object');
assert.equal(dispatched.at(-1).capturedAt, frozen.capturedAt);
controller.setInput({ ...review, makeRegular: true });
assert.equal(controller.frozenRequest, null);
controller.beginReview();
await controller.submit();
assert.notEqual(dispatched.at(-1).requestId, frozen.requestId);
assert.notEqual(dispatched.at(-1).capturedAt, frozen.capturedAt);
for (const changed of [
  { plate: 'XYZ-999' }, { actualDriver: { ...review.actualDriver, id: 'driver-c' } },
  { site: { ...review.site, assignmentId: 'assignment-b' } },
]) {
  controller.setInput(review); controller.beginReview(); await controller.submit();
  const before = controller.frozenRequest.requestId;
  controller.setInput({ ...review, ...changed }); controller.beginReview(); await controller.submit();
  assert.notEqual(controller.frozenRequest.requestId, before);
}
controller.nextTruck(); controller.setInput(review); controller.beginReview();
handler = async req => { dispatched.push(req); return { kind: 'business_failure', code: 'OPEN_TRIP_EXISTS', tripNumber: 'TRIP-OPEN' }; };
await controller.submit();
assert.equal(controller.current.status, 'business_failure');
assert.equal(controller.current.tripNumber, 'TRIP-OPEN');
assert.equal(controller.frozenRequest, null);
const businessCount = dispatched.length;
await controller.submit();
assert.equal(dispatched.length, businessCount, 'OPEN_TRIP_EXISTS must not be retried');
controller.nextTruck(); controller.setInput(review); controller.beginReview();
handler = async req => { dispatched.push(req); return { kind: 'business_failure', code: 'SITE_ASSIGNMENT_CHANGED' }; };
await controller.submit();
assert.equal(controller.current.status, 'site_changed'); assert.equal(siteChanged, 1);
controller.nextTruck(); controller.setInput(review); controller.beginReview();
const { LoadingAuthorizationError } = load('src/features/loading/services/errors.ts');
handler = async req => { dispatched.push(req); throw new LoadingAuthorizationError(); };
await controller.submit();
assert.equal(controller.current.status, 'authorization'); assert.equal(accessLost, 1);
controller.nextTruck(); controller.setInput(review); controller.beginReview();
handler = req => { dispatched.push(req); return new Promise(resolve => { resolvePending = resolve; }); };
const late = controller.submit();
controller.setInput({ ...review, plate: 'XYZ-999' });
resolvePending({ kind: 'success', trip: { tripNumber: 'TRIP-LATE' } });
await late;
assert.equal(controller.current.status, 'idle'); assert.equal(stale.length, 1);
assert.equal(opened, 2, 'late success must not publish as current success');
console.log('PASS request lifecycle, double submit, business blocks, auth, stale success and next-truck reset');

const { TripReview } = load('src/features/loading/components/TripReview.tsx');
const render = state => renderToStaticMarkup(React.createElement(TripReview, {
  state, canReview: true, operationalDate: '24 September 2026', onReview() {}, onBack() {}, onOpen() {}, onNext() {},
}));
assert.match(render({ status: 'review', review }), /Loading Site/);
assert.match(render({ status: 'review', review }), /Driver B/);
assert.match(render({ status: 'business_failure', review, code: 'OPEN_TRIP_EXISTS', tripNumber: 'TRIP-OPEN' }), /TRIP-OPEN/);
assert.match(render({ status: 'ambiguous', review }), /Retry Same Request/);
assert(!render({ status: 'ambiguous', review }).includes('Back to driver'));
assert.match(render({ status: 'success', review, result: { ...result, defaultDriverChanged: true } }), /Process Next Truck/);
assert.match(render({ status: 'success', review: { ...review, makeRegular: true }, result: { ...result, defaultDriverChanged: true } }), /now the truck/);
assert.match(render({ status: 'success', review: { ...review, makeRegular: true }, result: { ...result, defaultDriverChanged: false } }), /not changed/);
assert.match(render({ status: 'success', review, result }), /Authoritative Driver B/);
assert(!render({ status: 'success', review, result }).includes('bank_name'));
console.log('PASS review and authoritative success rendering');

const { LoadingPortalView } = load('src/features/loading/components/LoadingPortalView.tsx');
const { DriverWorkflowController } = load('src/features/loading/utils/driverWorkflowController.ts');
const { reviewForSelection } = load('src/features/loading/utils/reviewSelection.ts');
const { DriverIdentification } = load('src/features/loading/components/DriverIdentification.tsx');
const regular = { id: 'driver-a', fullName: 'Regular Driver', phoneNumber: '08011111111', email: null, isActive: true };
const workflow = new DriverWorkflowController(async () => { throw new Error('unexpected search'); },
  async () => { throw new Error('unexpected registration'); },
  async () => { throw new Error('unexpected lookup'); }, () => false, () => {});
workflow.setContext({ kind: 'known', plate: review.plate, assignmentId: review.site.assignmentId,
  truck: review.truck, regular });
assert.equal(workflow.current.choice, 'regular');
assert.equal(workflow.current.selected.driver.id, regular.id);
const readySite = { status: 'ready', site: review.site };
const readyLookup = { state: { status: 'known_ready', plate: review.plate, truck: review.truck, driver: regular }, pending: false };
const regularReview = reviewForSelection(readySite, readyLookup, workflow.current);
assert(regularReview, 'default selected regular driver must enable review');
assert.equal(regularReview.actualDriver.id, regular.id);
const reviewController = new OpenTripController(async () => { throw new Error('not submitting'); }, () => {},
  () => {}, () => {}, () => {});
reviewController.setInput(regularReview);
const identification = React.createElement(DriverIdentification, { state: workflow.current,
  onRegular() {}, onDifferent() {}, onSearchEdit() {}, onSearch() {}, onSelectExisting() {},
  onStartUnknown() {}, onStartNewDriver() {}, onFormEdit() {}, onCancel() {}, onRegister() {},
  onBackFromDuplicate() {}, onMakeRegular() {},
});
const workspaceProps = {
  officerName: 'Officer', now: new Date('2026-09-24T10:00:00Z'), site: readySite,
  statistics: { status: 'ready', statistics: { tripsOpened: 0, openTrips: 0, tripsClosed: 0, trucksProcessed: 0 } },
  plate: review.plate, lookup: readyLookup, driverPanel: identification,
  onPlateChange() {}, onLookup() {}, onRetrySite() {}, onRetryStatistics() {},
};
const initialWorkspace = renderToStaticMarkup(React.createElement(LoadingPortalView, {
  ...workspaceProps, tripStage: 'idle', tripPanel: React.createElement(TripReview, {
    state: reviewController.current, canReview: !!regularReview, operationalDate: '24 September 2026',
    onReview() {}, onBack() {}, onOpen() {}, onNext() {},
  }),
}));
assert.match(initialWorkspace, /Regular Driver/);
assert.match(initialWorkspace, /Review Trip/);
assert(!initialWorkspace.includes('Trip review and opening will be available in the next phase'));
reviewController.beginReview();
const reviewWorkspace = renderToStaticMarkup(React.createElement(LoadingPortalView, {
  ...workspaceProps, tripStage: 'review', tripPanel: React.createElement(TripReview, {
    state: reviewController.current, canReview: true, operationalDate: '24 September 2026',
    onReview() {}, onBack() {}, onOpen() {}, onNext() {},
  }),
}));
assert.match(reviewWorkspace, /Open Trip/);
assert.match(reviewWorkspace, /Regular Driver/);
console.log('PASS known active truck with regular driver selected by default reaches Review Trip and Open Trip');
const successPanel = React.createElement(TripReview, { state: { status: 'success', review, result },
  canReview: false, operationalDate: '24 September 2026', onReview() {}, onBack() {}, onOpen() {}, onNext() {} });
const page = renderToStaticMarkup(React.createElement(LoadingPortalView, {
  officerName: 'Officer', now: new Date('2026-09-24T10:00:00Z'),
  site: { status: 'ready', site: review.site }, statistics: { status: 'error' },
  plate: review.plate, lookup: { state: { status: 'known_ready', plate: review.plate,
    truck: review.truck, driver: review.actualDriver }, pending: false },
  tripPanel: successPanel, tripStage: 'success', onPlateChange() {}, onLookup() {}, onRetrySite() {}, onRetryStatistics() {},
}));
assert.match(page, /Trip opened/);
assert.match(page, /Today.*figures are unavailable/);
assert(page.indexOf('Trip opened') < page.indexOf('Today'), 'success must remain above unavailable statistics');
console.log('PASS statistics-refresh failure cannot mask opened trip');
