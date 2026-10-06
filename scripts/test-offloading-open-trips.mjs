// Open Trips selection and mandatory camera verification regressions.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const React = require('react');
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
    if (!name.startsWith('.')) return require(name);
    const base = resolve(dirname(full), name);
    const target = [base, base + '.ts', base + '.tsx', base + '.css'].find(existsSync);
    assert(target, `Import must resolve: ${name}`);
    return target.endsWith('.css') ? {} : load(target);
  };
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}

overrides.set(resolve('src/lib/supabase.ts'), { supabase: {
  async rpc() { return { data: null, error: null }; },
  from() { assert.fail('Offloading must use actor-authorized RPCs, not direct table reads'); },
} });

const { normalizeOffloadingPlate } = load('src/features/offloading/types.ts');
assert.equal(normalizeOffloadingPlate('ab c-123'), 'ABC123');
assert.equal(normalizeOffloadingPlate('AB\tC 123'), 'ABC123');

const assignmentA = { assignmentId: 'assignment-a', siteId: 'site-a', siteName: 'Offloading A' };
const assignmentB = { assignmentId: 'assignment-b', siteId: 'site-b', siteName: 'Offloading B' };
const tripA = { id: 'trip-a', tripNumber: 'TRP-0000000001', truckId: 'truck-a',
  registrationNumber: 'ABC-123', normalizedRegistration: 'ABC123', openedAt: '2026-10-04T08:00:00Z',
  loadingSiteName: 'Loading North' };
const tripB = { id: 'trip-b', tripNumber: 'TRP-0000000002', truckId: 'truck-b',
  registrationNumber: 'XYZ-999', normalizedRegistration: 'XYZ999', openedAt: '2026-10-04T09:00:00Z',
  loadingSiteName: 'Loading South' };
const found = (trip, assignment = assignmentA) => ({ kind: 'found', assignment,
  trip: { ...trip, estimatedQuantityTonnes: trip.id === tripA.id ? 20.25 : null,
    driverId: 'driver-a', driverName: 'Driver A' } });
const evidence = (id, candidate) => ({ id, imagePath: `offloader/${id}.jpg`,
  image: new Blob(['jpeg'], { type: 'image/jpeg' }), candidate, confidence: 0.9,
  capturedAt: '2026-10-04T09:15:00Z' });

const { OffloadingVerificationController } = load('src/features/offloading/utils/offloadingVerificationController.ts');
let snapshot;
const requests = [];
const controller = new OffloadingVerificationController((plate) => new Promise(resolveRequest => {
  requests.push({ plate, resolve: resolveRequest });
}), value => { snapshot = value; }, () => '2026-10-04T09:16:00Z');
controller.select(tripA, assignmentA);
const matchingEvidence = evidence('match', 'a b c-123');
const verifying = controller.verify(matchingEvidence);
assert.equal(snapshot.state.status, 'verifying', 'selected trip alone stays locked until the scan lookup completes');
assert.equal(requests[0].plate, 'a b c-123', 'captured OCR candidate is looked up without manual editing');
requests[0].resolve(found({ ...tripA, normalizedRegistration: 'ABC123' }));
await verifying;
assert.equal(snapshot.state.status, 'verified');
assert.equal(snapshot.state.trip.id, tripA.id);
assert.equal(snapshot.state.capture.method, 'OCR');
assert.equal(snapshot.state.capture.image, matchingEvidence.image);

controller.resetForRescan();
const mismatch = controller.verify(evidence('mismatch', 'XYZ-999'));
requests[1].resolve(found({ ...tripB, normalizedRegistration: 'XYZ999' }));
await mismatch;
assert.deepEqual(snapshot.state, { status: 'mismatch', tripId: tripA.id, candidate: 'XYZ-999' });
controller.resetForRescan();
const noOpenTrip = controller.verify(evidence('no-trip', 'ABC-123'));
requests[2].resolve({ kind: 'business_failure', code: 'NO_OPEN_TRIP' });
await noOpenTrip;
assert.equal(snapshot.state.status, 'mismatch', 'a scan without the selected OPEN trip cannot unlock work');

controller.select(tripA, assignmentA);
const stale = controller.verify(evidence('stale', 'ABC-123'));
controller.select(tripB, assignmentA);
requests[3].resolve(found({ ...tripA, normalizedRegistration: 'ABC123' }));
await stale;
assert.equal(snapshot.state.status, 'idle', 'an in-flight result from an earlier selection cannot verify the new trip');
const selectedB = controller.verify(evidence('selected-b', 'XYZ999'));
requests[4].resolve(found({ ...tripB, normalizedRegistration: 'XYZ999' }));
await selectedB;
assert.equal(snapshot.state.status, 'verified');
assert.equal(snapshot.state.trip.id, tripB.id);
controller.clear();
assert.deepEqual(snapshot, { state: { status: 'idle' }, pending: false }, 'return/reset clears verification');
console.log('PASS selected-trip plate verification, mismatch blocking, selection reset, and stale OCR lookup fencing');

const { OffloadingPortalView } = load('src/features/offloading/components/OffloadingPortalView.tsx');
const { ClosurePanel } = load('src/features/offloading/components/ClosurePanel.tsx');
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = require('react-dom/client');
const { act } = require('react');
const root = createRoot(document.getElementById('root'));
let selectedId = null;
let rescans = 0;
let returned = 0;
const closureIdle = { status: 'idle' };
const listState = { status: 'ready', value: { assignment: assignmentA, trips: [tripA, tripB] } };
const baseProps = { officerName: 'Officer A', openTrips: listState, selectedTrip: null,
  verification: { status: 'idle' }, closure: closureIdle, capturePanel: React.createElement('span', null, 'camera'),
  closurePanel: null, statistics: { status: 'loading' }, now: new Date('2026-10-04T10:00:00Z'),
  onSelectTrip: trip => { selectedId = trip.id; }, onRetryOpenTrips() {}, onRetryStatistics() {},
  onRescan: () => { rescans++; }, onReturnToOpenTrips: () => { returned++; } };
await act(async () => root.render(React.createElement(OffloadingPortalView, baseProps)));
const html = document.getElementById('root').innerHTML;
assert(html.indexOf('TRP-0000000001') < html.indexOf('TRP-0000000002'), 'server order is preserved in the UI');
assert(html.includes('ABC-123') && html.includes('Loading North') && html.includes('Select Trip'));
assert(!html.includes('offloading-tonnage') && !html.includes('Review Trip') && !html.includes('Confirm &amp; Close'));
const selectButton = [...document.querySelectorAll('button')].find(button => button.textContent.includes('Select Trip'));
await act(async () => selectButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
assert.equal(selectedId, tripA.id);

await act(async () => root.render(React.createElement(OffloadingPortalView, {
  ...baseProps, selectedTrip: tripA, capturePanel: React.createElement('span', null, 'camera'),
})));
let selectedHtml = document.getElementById('root').innerHTML;
assert(selectedHtml.includes('Verify Physical Truck') && selectedHtml.includes('camera'));
assert(!selectedHtml.includes('offloading-tonnage') && !selectedHtml.includes('Review Trip')
  && !selectedHtml.includes('Confirm &amp; Close'), 'selection alone never exposes tonnage, review, or closure');

await act(async () => root.render(React.createElement(OffloadingPortalView, {
  ...baseProps, selectedTrip: tripA, verification: { status: 'mismatch', tripId: tripA.id, candidate: 'XYZ-999' },
})));
selectedHtml = document.getElementById('root').innerHTML;
assert(selectedHtml.includes('Scanned truck does not match the selected trip'));
assert(selectedHtml.includes('Rescan') && selectedHtml.includes('Return to Open Trips'));
assert(!selectedHtml.includes('offloading-tonnage') && !selectedHtml.includes('Review Trip'));
await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Rescan')
  .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
assert.equal(rescans, 1);
await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Return to Open Trips')
  .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
assert.equal(returned, 1);

const verifiedLookup = { status: 'found', assignment: assignmentA,
  trip: { ...tripA, estimatedQuantityTonnes: 20.25, driverId: 'driver-a', driverName: 'Driver A' },
  capture: { method: 'OCR', confirmedPlate: 'ABC-123', capturedAt: '2026-10-04T09:15:00Z',
    ocrDetectedPlate: 'ABC-123', ocrConfidence: .9, image: new Blob(['jpeg'], { type: 'image/jpeg' }),
    imagePath: 'offloader/match.jpg' } };
const closurePanel = React.createElement(ClosurePanel, { lookup: verifiedLookup, state: closureIdle,
  quantity: '', onQuantity() {}, onReview() {}, onBack() {}, onClose() {} });
await act(async () => root.render(React.createElement(OffloadingPortalView, {
  ...baseProps, selectedTrip: tripA, verification: { status: 'verified', tripId: tripA.id,
    assignment: assignmentA, trip: verifiedLookup.trip, capture: verifiedLookup.capture }, closurePanel,
})));
selectedHtml = document.getElementById('root').innerHTML;
assert(selectedHtml.includes('offloading-tonnage') && selectedHtml.includes('Review Trip'),
  'actual tonnage entry appears only after selected-trip verification');
await act(async () => root.unmount());
dom.window.close();
console.log('PASS Open Trips ordering, selection gating, mismatch actions, and verified tonnage UI');

const portalSource = readFileSync(resolve('src/features/offloading/OffloadingPortal.tsx'), 'utf8');
assert(portalSource.includes('closeOffloadingTrip') && portalSource.includes('refreshOpenTrips'));
assert(portalSource.includes('verificationController.clear()') && portalSource.includes('workflowStore.clearOffloading'));
assert(!portalSource.includes(".from('trips')") && !portalSource.includes('setStatus'));
const migration = readFileSync(resolve('supabase/migrations/20261005000500_offloading_open_trips.sql'), 'utf8');
assert(migration.includes("private.require_role(array['offloading_officer']"));
assert(migration.includes('trip.opened_at asc, trip.id asc'));
assert(!migration.includes('create policy') && !migration.includes('alter policy'));
console.log('PASS server-scoped read model, closure service retention, and no RLS weakening');
