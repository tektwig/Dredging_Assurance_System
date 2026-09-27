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

let response;
let rpcError = null;
const rpcCalls = [];
overrides.set(resolve('src/lib/supabase.ts'), { supabase: {
  async rpc(name, args) { rpcCalls.push({ name, args }); return { data: response, error: rpcError }; },
  from() { assert.fail('Statistics must not read trip rows directly'); },
} });

const statisticsResponse = {
  trips_closed_today: 2,
  open_trips: 4,
  tonnage_processed_today: 27.35,
  trucks_processed_today: 1,
};
const service = load('src/features/offloading/services/offloadingStatistics.ts');
response = statisticsResponse;
assert.deepEqual(await service.loadOffloadingStatistics(), {
  tripsClosedToday: 2, openTrips: 4, tonnageProcessedToday: 27.35, trucksProcessedToday: 1,
});
assert.deepEqual(rpcCalls[0], { name: 'get_offloading_statistics', args: undefined });
for (const invalid of [null, [], { ...statisticsResponse, extra: 'unsafe' },
  { ...statisticsResponse, trips_closed_today: -1 },
  { ...statisticsResponse, open_trips: Number.MAX_SAFE_INTEGER + 1 },
  { ...statisticsResponse, tonnage_processed_today: 1.234 }]) {
  assert.throws(() => service.parseOffloadingStatistics(invalid));
}
rpcError = { code: '42501', message: 'internal database detail' };
await assert.rejects(service.loadOffloadingStatistics(), service.OffloadingAuthorizationError);
rpcError = { code: 'XX000', message: 'private database detail' };
await assert.rejects(service.loadOffloadingStatistics(), /Offloading statistics unavailable/);
rpcError = null;

const viewModule = load('src/features/offloading/components/OffloadingPortalView.tsx');
const panel = (state, retry = () => {}) => React.createElement(viewModule.OffloadingStatistics, { state, retry });
const loadingMarkup = renderToStaticMarkup(panel({ status: 'loading' }));
assert.match(loadingMarkup, /Loading today&#x27;s figures/);
const errorMarkup = renderToStaticMarkup(panel({ status: 'error' }));
assert.match(errorMarkup, /Today&#x27;s figures are unavailable/);
assert.match(errorMarkup, /Retry figures/);
let retried = 0;
const errorTree = viewModule.OffloadingStatistics({ state: { status: 'error' }, retry: () => { retried++; } });
const findButton = element => {
  if (!element || typeof element !== 'object') return null;
  if (element.type === 'button') return element;
  const children = element.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findButton(child);
    if (found) return found;
  }
  return null;
};
findButton(errorTree).props.onClick();
assert.equal(retried, 1, 'Retry figures invokes the retry callback');

const readyState = { status: 'ready', statistics: {
  tripsClosedToday: 2, openTrips: 4, tonnageProcessedToday: 1234.5, trucksProcessedToday: 1,
} };
const cardsMarkup = renderToStaticMarkup(panel(readyState));
const orderedLabels = ['Trips Closed Today', 'Open Trips', 'Tonnage Processed Today', 'Trucks Processed Today'];
assert(orderedLabels.every(label => cardsMarkup.includes(label)));
assert.deepEqual([...orderedLabels].sort((a, b) => cardsMarkup.indexOf(a) - cardsMarkup.indexOf(b)), orderedLabels);
assert.match(cardsMarkup, /1,234\.50/);

const { operationalDateKey } = load('src/features/loading/utils/operationalDate.ts');
assert.equal(operationalDateKey(new Date('2026-09-27T22:59:59Z')), '2026-09-27');
assert.equal(operationalDateKey(new Date('2026-09-27T23:00:00Z')), '2026-09-28');
const portalSource = readFileSync('src/features/offloading/OffloadingPortal.tsx', 'utf8');
assert(portalSource.includes('setInterval(() => setNow(new Date()), 60_000)'));
assert(portalSource.includes('[actorId, dateKey, statisticsRevision]'));

const { ClosureController } = load('src/features/offloading/utils/closureController.ts');
const review = { assignment: { assignmentId: 'assignment-a', siteId: 'site-a', siteName: 'Site A' },
  trip: { id: 'trip-a', tripNumber: 'TRP-1', truckId: 'truck-a', registrationNumber: 'ABC-123',
    normalizedRegistration: 'ABC123', driverId: 'driver-a', driverName: 'Driver',
    openedAt: '2026-09-27T08:00:00Z', loadingSiteName: 'Loading Site' },
  capture: { method: 'MANUAL', confirmedPlate: 'ABC-123', capturedAt: '2026-09-27T08:00:00Z',
    ocrDetectedPlate: null, ocrConfidence: null, image: null, imagePath: null }, quantityTonnes: 12.5 };
let closureStatisticsRefreshes = 0;
const controller = new ClosureController(async request => ({ kind: 'success', requestId: request.requestId,
  trip: { id: 'trip-a', tripNumber: 'TRP-1', status: 'closed', truckId: 'truck-a', driverId: 'driver-a',
    offloadingSiteId: 'site-a', quantityTonnes: 12.5, closedAt: '2026-09-27T09:00:00Z', closedBy: 'actor-a' },
  capture: { confirmedPlate: 'ABC-123', normalizedConfirmedPlate: 'ABC123', method: 'MANUAL', imageRecorded: false },
  waybill: { invoiceNumber: 'INV-2026-000001' }, notificationQueued: true }), () => {}, () => {},
() => 'request-a', () => { closureStatisticsRefreshes++; });
controller.setInput(review);
controller.beginReview();
await controller.submit();
assert.equal(controller.current.status, 'success');
assert.equal(closureStatisticsRefreshes, 1, 'successful closure refreshes statistics immediately');

console.log('PASS Offloading statistics validation, states, rendering, closure refresh and Lagos-date rollover');
