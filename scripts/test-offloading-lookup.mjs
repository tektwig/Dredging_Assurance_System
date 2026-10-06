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
  const source = readFileSync(full, 'utf8').replaceAll('import.meta.env', '(globalThis.__testEnv || { DEV: true })');
  const output = ts.transpileModule(source, {
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
  driver_name: 'John Driver', opened_at: '2026-09-25T08:00:00Z', loading_site_name: 'Loading Site',
  estimated_quantity_tonnes: 20.25 };
response = { ok: true, assignment, trip };
const found = await service.lookupOffloadingOpenTrip('ABC-123');
assert.deepEqual(calls, [{ name: 'lookup_offloading_open_trip', args: { p_plate: 'ABC-123' } }]);
assert.equal(found.kind, 'found');
assert.equal(found.trip.tripNumber, trip.trip_number);
assert.equal(found.trip.estimatedQuantityTonnes, 20.25);
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

response = { ok: true, assignment, trips: [{ id: trip.id, trip_number: trip.trip_number,
  truck_id: trip.truck_id, registration_number: trip.registration_number,
  normalized_registration: trip.normalized_registration, opened_at: trip.opened_at,
  loading_site_name: trip.loading_site_name }] };
const listed = await service.loadOffloadingOpenTrips();
assert.equal(calls.at(-1).name, 'get_offloading_open_trips');
assert.equal(calls.at(-1).args, undefined, 'Open Trips read derives officer and site from auth');
assert.equal(listed.kind, 'ready');
assert.equal(listed.value.trips[0].registrationNumber, 'ABC-123');
assert.equal(listed.value.assignment.siteName, 'Offloading Site');
assert(!JSON.stringify(listed).includes('John Driver') && !JSON.stringify(listed).includes('account_number'));
response = { ok: true, assignment, trips: [{ id: trip.id, trip_number: trip.trip_number,
  truck_id: trip.truck_id, registration_number: trip.registration_number,
  normalized_registration: 'WRONG', opened_at: trip.opened_at,
  loading_site_name: trip.loading_site_name }] };
await assert.rejects(service.loadOffloadingOpenTrips(), /Invalid Offloading Open Trips response/);
response = { ok: false, code: 'SITE_ASSIGNMENT_REQUIRED' };
assert.deepEqual(await service.loadOffloadingOpenTrips(), { kind: 'business_failure', code: 'SITE_ASSIGNMENT_REQUIRED' });

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

const { PlateCapture } = load('src/features/loading/components/PlateCapture.tsx');
const scanMarkup = renderToStaticMarkup(React.createElement(PlateCapture, {
  state: { status: 'detected', evidence }, disabled: false,
  onCapture() {}, onScanStart() {},
}));
assert(scanMarkup.includes('Looking up this candidate automatically'));
assert(!scanMarkup.includes('Correct recognized plate') && !scanMarkup.includes('Enter plate manually'));
assert(!scanMarkup.includes('Choose Photo') && !scanMarkup.includes('type="file"') && !scanMarkup.includes('accept="image/'));
const failedScanMarkup = renderToStaticMarkup(React.createElement(PlateCapture, {
  state: { status: 'error', reason: 'no_plate' }, disabled: false,
  onCapture() {}, onScanStart() {},
}));
assert(failedScanMarkup.includes('Rescan or try again'));
assert(failedScanMarkup.includes('Try Again'));
assert(!failedScanMarkup.includes('Manual Entry') && !failedScanMarkup.includes('Correct plate'));
assert(!failedScanMarkup.includes('Choose Photo') && !failedScanMarkup.includes('type="file"'));

const portalSource = readFileSync(resolve('src/features/offloading/OffloadingPortal.tsx'), 'utf8');
assert(portalSource.includes('PlateCaptureController') && portalSource.includes('createPlateOcrService'));
assert(!portalSource.includes('close_trip_v2') && !portalSource.includes('.storage.')
  && !portalSource.includes(".from('trips')"));
assert(portalSource.includes('get_offloading_open_trips') || portalSource.includes('loadOffloadingOpenTrips'));
assert(portalSource.includes('verificationController.verify(capture.evidence)'));
assert(portalSource.includes('autoLookupEvidence.current === capture.evidence.id'));
assert(!portalSource.includes('lookupController.submit') && !portalSource.includes('confirmCorrection'));
const captureSource = readFileSync(resolve('src/features/loading/components/PlateCapture.tsx'), 'utf8');
assert(captureSource.includes('navigator.mediaDevices?.getUserMedia'));
assert(!captureSource.includes('type="file"') && !captureSource.includes('accept="image/'));
console.log('PASS Offloading retains camera OCR, candidate lookup, and no manual/gallery bypass');
