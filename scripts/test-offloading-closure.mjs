// Closure workflow contract tests. Supabase and Storage are mocked; no database writes.
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
    if (!name.startsWith('.')) return require(name);
    const base = resolve(dirname(full), name);
    const target = [base, base + '.ts', base + '.tsx', base + '.css'].find(existsSync);
    assert(target, `Import must resolve: ${name}`);
    return target.endsWith('.css') ? {} : load(target);
  };
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}

const rpcCalls = [];
const uploads = [];
let rpcResult;
let rpcError = null;
let uploadError = null;
overrides.set(resolve('src/lib/supabase.ts'), { supabase: {
  async rpc(name, args) { rpcCalls.push({ name, args }); return { data: rpcResult, error: rpcError }; },
  storage: { from(bucket) { assert.equal(bucket, 'offloading-plate-evidence'); return {
    async upload(path, image, options) { uploads.push({ path, image, options }); return { error: uploadError }; },
    async download() { assert.fail('Unexpected download'); },
  }; } },
  from() { assert.fail('Offloading cannot write directly to tables'); },
} });

const { parseTonnage } = load('src/features/offloading/utils/tonnage.ts');
for (const value of ['', ' ', 'abc', '0', '0.00', '-1', '1.234', '100000000', '1e2', 'Infinity', 'NaN']) {
  assert.equal(parseTonnage(value), null, `Invalid tonnage: ${value}`);
}
assert.equal(parseTonnage('0.01'), 0.01);
assert.equal(parseTonnage('12.50'), 12.5);
assert.equal(parseTonnage('99999999.99'), 99999999.99);

const { preparedCapture } = load('src/features/offloading/types.ts');
const image = new Blob(['jpeg'], { type: 'image/jpeg' });
const evidence = { id: 'capture-a', imagePath: 'actor-a/capture-a.jpg', image,
  candidate: 'ABC-123', confidence: 0.9, capturedAt: '2026-09-25T08:30:00Z' };
const trip = { id: 'trip-a', tripNumber: 'TRP-0000000006', truckId: 'truck-a',
  registrationNumber: 'ABC-123', normalizedRegistration: 'ABC123', driverId: 'driver-a',
  driverName: 'John Driver', openedAt: '2026-09-25T08:00:00Z', loadingSiteName: 'Loading Site' };
const assignment = { assignmentId: 'assignment-a', siteId: 'site-a', siteName: 'Offloading Site' };
const review = { trip, assignment, quantityTonnes: 12.5,
  capture: preparedCapture('ABC-123', evidence, 'later') };
assert.equal(review.capture.method, 'OCR');
assert.equal(preparedCapture('XYZ-999', evidence, 'later').method, 'OCR_CORRECTED');
assert.equal(preparedCapture('ABC-123', null, 'now').method, 'MANUAL');
const request = { requestId: 'request-a', review };
const serverSuccess = { ok: true, request_id: 'request-a', trip: {
  id: 'trip-a', trip_number: 'TRP-0000000006', status: 'closed', truck_id: 'truck-a',
  driver_id: 'driver-a', offloading_site_id: 'site-a', quantity_tonnes: 12.5,
  closed_at: '2026-09-25T09:00:00Z', closed_by: 'actor-a',
}, capture: { confirmed_plate: 'ABC-123', normalized_confirmed_plate: 'ABC123',
  capture_method: 'OCR', image_recorded: true },
waybill: { invoice_number: 'INV-2026-000007' }, notification_queued: true };
const service = load('src/features/offloading/services/closeTripData.ts');
rpcResult = serverSuccess;
const parsedSuccess = await service.closeOffloadingTrip(request);
assert.equal(parsedSuccess.kind, 'success');
assert.deepEqual(parsedSuccess.waybill, { invoiceNumber: 'INV-2026-000007' });
assert.equal(JSON.stringify(parsedSuccess).includes('account_number'), false);
assert.equal(uploads.length, 1);
assert.deepEqual(uploads[0].options, { contentType: 'image/jpeg', upsert: false });
assert.deepEqual(rpcCalls[0], { name: 'close_trip_v2', args: {
  p_request_id: 'request-a', p_trip_id: 'trip-a', p_plate: 'ABC-123',
  p_expected_assignment_id: 'assignment-a', p_quantity_tonnes: 12.5,
  p_capture_method: 'OCR', p_captured_at: evidence.capturedAt,
  p_ocr_detected_plate: 'ABC-123', p_ocr_confidence: 0.9,
  p_image_path: 'actor-a/capture-a.jpg',
} });
await service.closeOffloadingTrip(request);
assert.equal(uploads.length, 1, 'Ambiguous retry must not upload again');
assert.deepEqual(rpcCalls[1].args, rpcCalls[0].args);
const manualReview = { ...review, capture: preparedCapture('ABC-123', null, '2026-09-25T08:30:00Z') };
const manualRequest = { requestId: 'manual-request', review: manualReview };
rpcResult = { ...serverSuccess, request_id: 'manual-request',
  capture: { ...serverSuccess.capture, capture_method: 'MANUAL', image_recorded: false } };
await service.closeOffloadingTrip(manualRequest);
assert.equal(uploads.length, 1);
assert.equal(rpcCalls.at(-1).args.p_ocr_detected_plate, null);
assert.equal(rpcCalls.at(-1).args.p_image_path, null);
assert.equal(rpcCalls.at(-1).args.p_captured_at, manualReview.capture.capturedAt);
const correctedEvidence = { ...evidence, id: 'capture-b', imagePath: 'actor-a/capture-b.jpg', candidate: 'XYZ-999' };
const correctedReview = { ...review, capture: preparedCapture('ABC-123', correctedEvidence, 'later') };
const correctedRequest = { requestId: 'corrected-request', review: correctedReview };
rpcResult = { ...serverSuccess, request_id: 'corrected-request',
  capture: { confirmed_plate: 'ABC-123', normalized_confirmed_plate: 'ABC123',
    capture_method: 'OCR_CORRECTED', image_recorded: true } };
await service.closeOffloadingTrip(correctedRequest);
assert.equal(rpcCalls.at(-1).args.p_plate, 'ABC-123');
assert.equal(rpcCalls.at(-1).args.p_capture_method, 'OCR_CORRECTED');
assert.equal(rpcCalls.at(-1).args.p_ocr_detected_plate, 'XYZ-999');
assert.equal(rpcCalls.at(-1).args.p_ocr_confidence, 0.9);
rpcResult = { ok: false, code: 'TRIP_NOT_OPEN', details: { trip_number: 'TRP-0000000006' } };
assert.deepEqual(await service.closeOffloadingTrip(manualRequest), { kind: 'business_failure',
  code: 'TRIP_NOT_OPEN', tripNumber: 'TRP-0000000006' });
rpcResult = { ok: false, code: 'SITE_ASSIGNMENT_CHANGED', details: {} };
assert.equal((await service.closeOffloadingTrip(manualRequest)).code, 'SITE_ASSIGNMENT_CHANGED');
rpcResult = { ok: true, request_id: 'manual-request', trip: { id: 'bad-trip' } };
await assert.rejects(service.closeOffloadingTrip(manualRequest), service.ClosureOutcomeUnknownError);
rpcResult = { ...serverSuccess, request_id: 'manual-request', waybill: undefined,
  capture: { ...serverSuccess.capture, capture_method: 'MANUAL', image_recorded: false } };
await assert.rejects(service.closeOffloadingTrip(manualRequest), service.ClosureOutcomeUnknownError);
rpcResult = { ...rpcResult, waybill: { invoice_number: 'invalid-reference' } };
await assert.rejects(service.closeOffloadingTrip(manualRequest), service.ClosureOutcomeUnknownError);
rpcError = { code: '42501', message: 'private database detail' };
await assert.rejects(service.closeOffloadingTrip(manualRequest));
rpcError = null;

const { ClosureController } = load('src/features/offloading/utils/closureController.ts');
let state;
let requestSeen;
let finish;
let ids = 0;
const controller = new ClosureController(requestValue => {
  requestSeen = requestValue;
  return new Promise((resolve, reject) => { finish = { resolve, reject }; });
}, value => { state = value; }, () => assert.fail('Unexpected auth refresh'), () => `uuid-${++ids}`);
controller.dispose();
controller.resume(); // React StrictMode may clean up and restart effects in development.
controller.setInput(manualReview);
controller.beginReview();
assert.equal(state.status, 'review');
const first = controller.submit();
assert.equal(state.status, 'submitting');
await controller.submit();
assert.equal(ids, 1, 'Double submission must not generate a second request');
assert.equal(controller.reset(), false, 'Cannot scan next while closure is unresolved');
finish.reject(new Error('Network outcome unknown'));
await first;
assert.equal(state.status, 'ambiguous');
const frozen = controller.frozenRequest;
assert.equal(controller.reset(), false);
controller.setInput({ ...manualReview, quantityTonnes: 99 });
assert.equal(controller.frozenRequest, frozen, 'Edit must not alter an ambiguous request');
const retry = controller.submit();
assert.equal(requestSeen, frozen);
finish.resolve({ kind: 'success', requestId: frozen.requestId,
  trip: { id: 'trip-a', tripNumber: 'TRP-0000000006', status: 'closed', truckId: 'truck-a',
    driverId: 'driver-a', offloadingSiteId: 'site-a', quantityTonnes: 12.5,
    closedAt: '2026-09-25T09:00:00Z', closedBy: 'actor-a' },
  capture: { confirmedPlate: 'ABC-123', normalizedConfirmedPlate: 'ABC123',
    method: 'MANUAL', imageRecorded: false },
  waybill: { invoiceNumber: 'INV-2026-000007' }, notificationQueued: true });
await retry;
assert.equal(state.status, 'success');
assert.equal(controller.reset(), true);
assert.equal(controller.frozenRequest, null);
assert.equal(state.status, 'idle');

const outcomes = [];
const siteController = new ClosureController(async () => ({ kind: 'business_failure',
  code: 'SITE_ASSIGNMENT_CHANGED' }), value => outcomes.push(value),
  () => assert.fail('Site change must not be treated as auth failure'), () => 'site-request');
siteController.setInput(manualReview);
siteController.beginReview();
await siteController.submit();
assert.equal(siteController.current.status, 'site_changed');
assert.equal(siteController.frozenRequest, null);
let authRefreshed = 0;
const { OffloadingAuthorizationError } = load('src/features/offloading/services/offloadingData.ts');
const authController = new ClosureController(async () => { throw new OffloadingAuthorizationError(); },
  value => outcomes.push(value), () => { authRefreshed++; }, () => 'auth-request');
authController.setInput(manualReview);
authController.beginReview();
await authController.submit();
assert.equal(authController.current.status, 'authorization');
assert.equal(authRefreshed, 1);

const { ClosurePanel } = load('src/features/offloading/components/ClosurePanel.tsx');
const panel = props => renderToStaticMarkup(React.createElement(ClosurePanel, {
  lookup: { status: 'found', assignment, trip, capture: manualReview.capture },
  state: { status: 'idle' }, quantity: '', onQuantity() {}, onReview() {}, onBack() {}, onClose() {}, ...props,
}));
assert(panel({}).includes('disabled'), 'Invalid tonnage must block Review Trip');
assert(!panel({ quantity: '12.50' }).includes('disabled'));
const reviewHtml = panel({ state: { status: 'review', review: manualReview } });
assert(reviewHtml.includes('Confirm &amp; Close Trip'));
assert(reviewHtml.includes('Offloading Site') && reviewHtml.includes('John Driver'));
assert(panel({ state: { status: 'ambiguous', review: manualReview } }).includes('Retry Same Request'));
const successHtml = panel({ state: { status: 'success', result: {
  kind: 'success', requestId: 'x', trip: { ...serverSuccess.trip, tripNumber: 'TRP-0000000006',
    quantityTonnes: 12.5, closedAt: '2026-09-25T09:00:00Z' },
  capture: { confirmedPlate: 'ABC-123' }, waybill: { invoiceNumber: 'INV-2026-000007' },
  notificationQueued: true,
} } });
assert(successHtml.includes('Notification queued successfully.'));
assert(successHtml.includes('<dt>Waybill</dt><dd>INV-2026-000007</dd>'));
assert(successHtml.includes('TRP-0000000006') && successHtml.includes('ABC-123')
  && successHtml.includes('12.50 tonnes') && successHtml.includes('Closed'));
assert(!successHtml.includes('account_number') && !successHtml.includes('bank_name'));
assert(panel({ state: { status: 'business_failure', review: manualReview,
  code: 'TRIP_NOT_OPEN', tripNumber: 'TRP-0000000006' } }).includes('Contact Operations'));
console.log('PASS tonnage, explicit review, frozen retry, evidence upload, closure response and reset');
