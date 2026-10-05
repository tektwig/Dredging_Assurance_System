// Field operational-day timer and route-only workflow persistence regressions.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import ts from 'typescript';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
const overrides = new Map();
const cache = new Map();
let providerAccount = { status: 'unauthenticated' };
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
    const target = [base, base + '.ts', base + '.tsx'].find(existsSync);
    assert(target, `Import must resolve: ${name}`);
    return load(target);
  };
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}

overrides.set(resolve('src/auth/AuthProvider.tsx'), { useAuth: () => ({ account: providerAccount }) });
const { watchFieldSession } = load('src/auth/fieldSessionWatcher.ts');

function fakeBrowser() {
  let nextId = 0;
  const timeouts = new Map();
  const intervals = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  const window = {
    setTimeout(callback, delay) { const id = ++nextId; timeouts.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    setInterval(callback, delay) { const id = ++nextId; intervals.set(id, { callback, delay }); return id; },
    clearInterval(id) { intervals.delete(id); },
    addEventListener(name, callback) { windowListeners.set(name, callback); },
    removeEventListener(name) { windowListeners.delete(name); },
    fire(name) { windowListeners.get(name)?.(); },
    runNextTimeout() {
      const entry = timeouts.entries().next().value;
      assert(entry, 'Expected a scheduled server boundary timer');
      timeouts.delete(entry[0]);
      entry[1].callback();
    },
    get timeouts() { return [...timeouts.values()]; },
    get intervals() { return [...intervals.values()]; },
  };
  const document = {
    visibilityState: 'visible',
    addEventListener(name, callback) { documentListeners.set(name, callback); },
    removeEventListener(name) { documentListeners.delete(name); },
    fire(name) { documentListeners.get(name)?.(); },
  };
  return { window, document };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

for (const wake of ['focus', 'pageshow', 'visibilitychange']) {
  const browser = fakeBrowser();
  let status = { status: 'valid', expiresInMs: 86_400_000, operationalDate: '2026-10-02' };
  let calls = 0;
  const ended = [];
  const stop = watchFieldSession(async () => { calls++; return status; }, value => ended.push(value), browser);
  await flush();
  assert.equal(browser.window.timeouts[0].delay, 86_400_000, 'Timer comes from the server boundary response');
  assert.equal(browser.window.intervals[0].delay, 60_000, 'Visible-tab polling covers suspended timers');
  status = { status: 'expired' };
  if (wake === 'visibilitychange') {
    browser.document.visibilityState = 'hidden'; browser.document.fire('visibilitychange');
    assert.equal(calls, 1, 'Hidden visibility does not issue a probe');
    browser.document.visibilityState = 'visible'; browser.document.fire('visibilitychange');
  } else browser.window.fire(wake);
  await flush();
  assert.equal(calls, 2, `${wake} revalidates after sleep or navigation`);
  assert.deepEqual(ended, ['expired']);
  stop();
  assert.equal(browser.window.intervals.length, 0, 'Expiry clears the polling interval');
}
console.log('PASS server-boundary timer plus focus/pageshow/visibility wake expiry detection');

{
  const browser = fakeBrowser();
  let probes = 0;
  const ended = [];
  const stop = watchFieldSession(async () => {
    probes++;
    return { status: 'valid', expiresInMs: 50, operationalDate: '2026-10-02' };
  }, value => ended.push(value), browser);
  await flush();
  browser.window.runNextTimeout();
  assert.deepEqual(ended, ['expired'], 'Server-derived boundary timer ends field access even if wake probe is unavailable');
  assert.equal(probes, 1, 'The boundary timer does not rely on a post-boundary server round trip');
  stop();
}
console.log('PASS field access expires locally at the server-supplied boundary');

const { FieldWorkflowStore, FieldWorkflowProvider, useFieldWorkflowStore } = load('src/features/fieldWorkflow/FieldWorkflowProvider.tsx');
const { checkLoadingRestore, checkOffloadingRestore } = load('src/features/fieldWorkflow/restoration.ts');
const store = new FieldWorkflowStore();
const loadingScope = { actorId: 'loader-1', role: 'loading_officer', operationalDate: '2026-10-02' };
store.setScope(loadingScope);
store.saveLoading(loadingScope, {
  assignmentId: 'assignment-1', plate: 'ABC-123', estimatedTonnage: '12.5',
  truckId: 'truck-1', driverId: 'driver-1', makeRegular: false,
  requestId: 'must-not-persist', password: 'secret', bankAccount: '1234567890', image: new Blob(['private']),
});
const afterRouteUnmount = store.getLoading(loadingScope);
assert.deepEqual(afterRouteUnmount, {
  assignmentId: 'assignment-1', plate: 'ABC-123', estimatedTonnage: '12.5',
  truckId: 'truck-1', driverId: 'driver-1', makeRegular: false,
}, 'Route remount reads only the safe Loading allow-list');
assert.equal(store.getLoading(loadingScope)?.plate, 'ABC-123', 'The app-level store survives route navigation');
const currentLoading = { status: 'known_ready', plate: 'ABC-123',
  truck: { id: 'truck-1', registrationNumber: 'ABC-123', normalizedRegistration: 'ABC123', isActive: true },
  driver: { id: 'driver-1', fullName: 'Driver', phoneNumber: '08000000000', email: null, isActive: true } };
assert.equal(checkLoadingRestore(afterRouteUnmount, 'assignment-1', { status: 'looking_up', plate: 'ABC-123' }), 'pending');
assert.equal(checkLoadingRestore(afterRouteUnmount, 'assignment-1', currentLoading), 'ready');
assert.equal(checkLoadingRestore(afterRouteUnmount, 'assignment-changed', currentLoading), 'stale');
assert.equal(checkLoadingRestore(afterRouteUnmount, 'assignment-1', { ...currentLoading,
  truck: { ...currentLoading.truck, id: 'replacement-truck' } }), 'stale');
assert.equal(checkLoadingRestore(afterRouteUnmount, 'assignment-1', {
  status: 'open_trip_exists', plate: 'ABC-123', truck: currentLoading.truck,
  trip: { tripId: 'trip-1', tripNumber: 'TRP-1' },
}), 'stale', 'A truck with a newly opened trip cannot resume old work');
store.clearLoading(loadingScope);
assert.equal(store.getLoading(loadingScope), null, 'Cancel/reset/success clears Loading state');

const offloadingScope = { actorId: 'offloader-1', role: 'offloading_officer', operationalDate: '2026-10-02' };
store.setScope(offloadingScope);
store.saveOffloading(offloadingScope, {
  assignmentId: 'offload-assignment-1', tripId: 'trip-1', plate: 'ABC-123', quantity: '13.5',
  requestId: 'must-not-persist', image: new Blob(['private']), driverName: 'unneeded PII',
});
const afterOffloadingRouteUnmount = store.getOffloading(offloadingScope);
assert.deepEqual(afterOffloadingRouteUnmount, {
  assignmentId: 'offload-assignment-1', tripId: 'trip-1', plate: 'ABC-123', quantity: '13.5',
}, 'Offloading stores only IDs and editable workflow values');
const currentOffloading = { status: 'found',
  assignment: { assignmentId: 'offload-assignment-1', siteId: 'site-1', siteName: 'Site' },
  trip: { id: 'trip-1', tripNumber: 'TRP-1', truckId: 'truck-1', registrationNumber: 'ABC-123',
    normalizedRegistration: 'ABC123', driverId: 'driver-1', driverName: 'Driver', openedAt: '2026-10-02T10:00:00Z',
    loadingSiteName: 'Loading', estimatedQuantityTonnes: 12 },
  capture: { method: 'MANUAL', confirmedPlate: 'ABC-123', capturedAt: '2026-10-02T10:00:00Z',
    ocrDetectedPlate: null, ocrConfidence: null, image: null, imagePath: null } };
assert.equal(checkOffloadingRestore(afterOffloadingRouteUnmount, { status: 'lookup_error', plate: 'ABC-123' }), 'pending');
assert.equal(checkOffloadingRestore(afterOffloadingRouteUnmount, currentOffloading), 'ready');
assert.equal(checkOffloadingRestore(afterOffloadingRouteUnmount, { ...currentOffloading,
  assignment: { ...currentOffloading.assignment, assignmentId: 'assignment-changed' } }), 'stale');
assert.equal(checkOffloadingRestore(afterOffloadingRouteUnmount, { ...currentOffloading,
  trip: { ...currentOffloading.trip, id: 'already-closed-trip' } }), 'stale',
  'A closed or replaced trip cannot resume old closure work');
assert.equal(checkOffloadingRestore(afterOffloadingRouteUnmount, { status: 'no_open_trip', plate: 'ABC-123' }), 'stale');
store.clearOffloading(offloadingScope);
assert.equal(store.getOffloading(offloadingScope), null, 'Cancel/reset/success clears Offloading state');

store.setScope(loadingScope);
store.saveLoading(loadingScope, { assignmentId: 'assignment-1', plate: 'XYZ-999',
  estimatedTonnage: '', truckId: null, driverId: null, makeRegular: false });
store.setScope({ ...loadingScope, operationalDate: '2026-10-03' });
assert.equal(store.getLoading({ ...loadingScope, operationalDate: '2026-10-03' }), null,
  'Operational-day expiry clears workflow state');
store.setScope(loadingScope);
store.saveLoading(loadingScope, { assignmentId: 'assignment-1', plate: 'XYZ-999',
  estimatedTonnage: '', truckId: null, driverId: null, makeRegular: false });
store.setScope(null);
assert.equal(store.getLoading(loadingScope), null, 'Logout/deactivation clears workflow state');
const freshBrowserStore = new FieldWorkflowStore();
freshBrowserStore.setScope(loadingScope);
assert.equal(freshBrowserStore.getLoading(loadingScope), null, 'Refresh/reopen does not restore workflow data');
console.log('PASS route-only Loading/Offloading persistence, stale entity rejection, and cleanup');

const providerRoot = createRoot(document.getElementById('root'));
let providerStore;
function WorkflowRoute({ kind }) {
  const value = useFieldWorkflowStore();
  providerStore = value;
  const scope = kind === 'loading' ? loadingScope : offloadingScope;
  React.useEffect(() => {
    if (kind === 'loading') value.saveLoading(scope, { assignmentId: 'assignment-1', plate: 'ROUTE-1',
      estimatedTonnage: '8', truckId: null, driverId: null, makeRegular: false });
    else value.saveOffloading(scope, { assignmentId: 'assignment-2', tripId: 'trip-2', plate: 'ROUTE-2', quantity: '9' });
  }, [kind, value]);
  return React.createElement('p', null, kind === 'loading'
    ? value.getLoading(scope)?.plate ?? 'empty' : value.getOffloading(scope)?.plate ?? 'empty');
}
async function renderWorkflowRoute(kind) {
  await act(async () => providerRoot.render(React.createElement(FieldWorkflowProvider, null,
    kind ? React.createElement(WorkflowRoute, { kind }) : null)));
}
providerAccount = { status: 'active', fieldOperationalDate: '2026-10-02',
  session: { user: { id: 'loader-1' } },
  profile: { id: 'loader-1', role: 'loading_officer' } };
await renderWorkflowRoute('loading');
assert.equal(providerStore.getLoading(loadingScope)?.plate, 'ROUTE-1');
await renderWorkflowRoute(null);
assert.equal(providerStore.getLoading(loadingScope)?.plate, 'ROUTE-1', 'Loading state survives child route unmount');
await renderWorkflowRoute('loading');
assert.equal(document.getElementById('root').textContent, 'ROUTE-1', 'Loading route re-reads its saved values');
providerAccount = { status: 'active', fieldOperationalDate: '2026-10-02',
  session: { user: { id: 'offloader-1' } }, profile: { id: 'offloader-1', role: 'offloading_officer' } };
await renderWorkflowRoute('offloading');
assert.equal(providerStore.getOffloading(offloadingScope)?.plate, 'ROUTE-2');
await renderWorkflowRoute(null);
assert.equal(providerStore.getOffloading(offloadingScope)?.plate, 'ROUTE-2', 'Offloading state survives child route unmount');
await renderWorkflowRoute('offloading');
assert.equal(document.getElementById('root').textContent, 'ROUTE-2', 'Offloading route re-reads its saved values');
providerAccount = { status: 'loading-profile', session: { user: { id: 'offloader-1' } } };
await renderWorkflowRoute(null);
assert.equal(providerStore.getOffloading(offloadingScope)?.plate, 'ROUTE-2', 'Token refresh profile read preserves the same officer draft');
providerAccount = { status: 'unauthenticated' };
await renderWorkflowRoute(null);
assert.equal(providerStore.getOffloading(offloadingScope), null, 'Provider clears both workflows on logout');
await act(async () => providerRoot.unmount());
dom.window.close();
console.log('PASS app-level Provider retains Loading/Offloading across routes and clears on logout');
