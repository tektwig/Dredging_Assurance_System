// Offloading frontend contract tests with mocked RPC and OCR; no database writes.
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
    const target = [base, base + '.ts', base + '.tsx', base + '.css'].find(existsSync);
    assert(target, `Import must resolve: ${name}`);
    return target.endsWith('.css') ? {} : load(target);
  };
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}
function returnExternal(name) { return require(name); }

let response;
let rpcError = null;
const calls = [];
overrides.set(resolve('src/lib/supabase.ts'), { supabase: {
  async rpc(name, args) { calls.push({ name, args }); return { data: response, error: rpcError }; },
  from() { assert.fail('Offloading must not directly read tables'); },
} });
const service = load('src/features/offloading/services/offloadingData.ts');
const assignment = { ok: true, assignment_id: 'assignment-a', site_id: 'site-a', site_name: 'Offloading Site' };
const trip = { id: 'trip-a', trip_number: 'TRP-0000000001', truck_id: 'truck-a',
  registration_number: 'ABC-123', normalized_registration: 'ABC123', driver_id: 'driver-a',
  driver_name: 'John Driver', opened_at: '2026-09-25T08:00:00Z', loading_site_name: 'Loading Site' };
response = { ok: true, assignment, trip };
const found = await service.lookupOffloadingOpenTrip('ABC-123');
assert.deepEqual(calls, [{ name: 'lookup_offloading_open_trip', args: { p_plate: 'ABC-123' } }]);
assert.equal(found.kind, 'found');
assert.equal(found.trip.tripNumber, trip.trip_number);
assert.equal(found.assignment.siteName, assignment.site_name);
assert.equal(JSON.stringify(found).includes('account_number'), false);
response = { ok: false, code: 'NO_OPEN_TRIP', details: {} };
assert.deepEqual(await service.lookupOffloadingOpenTrip('ABC-123'),
  { kind: 'business_failure', code: 'NO_OPEN_TRIP' });
response = { ok: true, trip: { id: 'trip-a' } };
await assert.rejects(service.lookupOffloadingOpenTrip('ABC-123'));
rpcError = { code: '42501', message: 'private server detail' };
await assert.rejects(service.lookupOffloadingOpenTrip('ABC-123'), service.OffloadingAuthorizationError);
rpcError = null;

const { preparedCapture } = load('src/features/offloading/types.ts');
const image = new Blob(['jpeg'], { type: 'image/jpeg' });
const evidence = { id: 'capture-a', imagePath: 'actor-a/capture-a.jpg', image,
  candidate: 'ABC-123', confidence: 0.83, capturedAt: '2026-09-25T08:30:00Z' };
assert.deepEqual(preparedCapture('ABC-123', null, '2026-09-25T09:00:00Z'), {
  method: 'MANUAL', confirmedPlate: 'ABC-123', capturedAt: '2026-09-25T09:00:00Z',
  ocrDetectedPlate: null, ocrConfidence: null, image: null, imagePath: null,
});
assert.equal(preparedCapture('ABC 123', evidence, 'later').method, 'OCR');
const corrected = preparedCapture('XYZ-999', evidence, 'later');
assert.equal(corrected.method, 'OCR_CORRECTED');
assert.equal(corrected.ocrDetectedPlate, 'ABC-123');
assert.equal(corrected.capturedAt, evidence.capturedAt);
assert.equal(corrected.image, image);

const { OffloadingLookupController } = load('src/features/offloading/utils/offloadingLookupController.ts');
let snapshot;
const requests = [];
const controller = new OffloadingLookupController(() => new Promise(resolve => requests.push(resolve)),
  value => { snapshot = value; }, () => '2026-09-25T09:00:00Z');
assert.equal(requests.length, 0, 'Capture alone must not look up a trip');
const first = controller.submit('ABC-123', evidence);
assert.equal(snapshot.state.status, 'looking_up');
assert.equal(await controller.submit('ABC-123', evidence), false, 'Duplicate submit blocked');
requests[0](found);
await first;
assert.equal(snapshot.state.status, 'found');
assert.equal(snapshot.state.capture.method, 'OCR');
assert.equal(snapshot.state.capture.image, image);
controller.reset();
assert.deepEqual(snapshot, { state: { status: 'idle' }, pending: false });
const correctedRequest = controller.submit('XYZ-999', evidence);
requests[1](found);
await correctedRequest;
assert.equal(snapshot.state.capture.method, 'OCR_CORRECTED');
controller.reset();
const noTrip = controller.submit('ABC-123', null);
requests[2]({ kind: 'business_failure', code: 'NO_OPEN_TRIP' });
await noTrip;
assert.equal(snapshot.state.status, 'no_open_trip');
controller.reset();
const stale = controller.submit('OLD-111', null);
controller.reset();
requests[3](found);
await stale;
assert.equal(snapshot.state.status, 'idle', 'Late lookup cannot publish an old trip');
const failing = new OffloadingLookupController(async () => { throw new Error('private db detail'); },
  value => { snapshot = value; });
await failing.submit('ABC-123', null);
assert.equal(snapshot.state.status, 'lookup_error');

const { OffloadingPortalView } = load('src/features/offloading/components/OffloadingPortalView.tsx');
const { PlateCapture } = load('src/features/loading/components/PlateCapture.tsx');
const scanMarkup = renderToStaticMarkup(React.createElement(PlateCapture, {
  state: { status: 'detected', evidence }, disabled: false, lookupActionLabel: 'Find Open Trip',
  onCapture() {}, onManual() {}, onScanStart() {},
}));
assert(scanMarkup.includes('Find Open Trip'));
assert(scanMarkup.includes('No lookup has started'));
const view = (state, plate = 'ABC-123') => renderToStaticMarkup(React.createElement(OffloadingPortalView, {
  officerName: 'Officer A', plate, lookup: { state, pending: false },
  closure: { status: 'idle' }, closurePanel: null,
  capturePanel: React.createElement('span', null, 'shared scanner'),
  onPlateChange() {}, onLookup() {}, onReset() {},
}));
assert(view({ status: 'idle' }).includes('Find Open Trip'));
assert(view({ status: 'idle' }).includes('shared scanner'));
assert(view({ status: 'no_open_trip', plate: 'ABC-123' }).includes('Contact Operations'));
assert(view({ status: 'lookup_error', plate: 'ABC-123' }).includes('Retry lookup'));
const rendered = view({ status: 'found', assignment: found.assignment,
  trip: found.trip, capture: preparedCapture('ABC-123', evidence, 'later') });
assert(rendered.includes('TRP-0000000001'));
assert(rendered.includes('John Driver'));
assert(rendered.includes('Scan Next Truck'));
assert(!rendered.includes('account_number'));
assert(!rendered.includes('Close Trip'));

const portalSource = readFileSync(resolve('src/features/offloading/OffloadingPortal.tsx'), 'utf8');
assert(portalSource.includes('PlateCaptureController') && portalSource.includes('createPlateOcrService'));
assert(!portalSource.includes('close_trip_v2') && !portalSource.includes('.storage.')
  && !portalSource.includes(".from('trips')"));
console.log('PASS Offloading manual/OCR lookup, NO_OPEN_TRIP, error, reset, stale result and safe rendering');
