// Frontend behavior tests with in-memory Supabase reads. No network or database writes.
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
const absolute = path => resolve(path);

function load(path) {
  const full = absolute(path);
  if (overrides.has(full)) return overrides.get(full);
  if (cache.has(full)) return cache.get(full).exports;
  const module = { exports: {} };
  cache.set(full, module);
  const source = readFileSync(full, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const localRequire = name => {
    if (overrides.has(name)) return overrides.get(name);
    if (!name.startsWith('.')) return require(name);
    const base = resolve(dirname(full), name);
    const target = [base, base + '.ts', base + '.tsx', base + '.css'].find(existsSync);
    assert(target, `Import must resolve: ${name}`);
    if (target.endsWith('.css')) return {};
    return load(target);
  };
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}

const { operationalDateKey, platePreview } = load('src/features/loading/utils/operationalDate.ts');
const midnight = new Date('2026-09-23T23:30:00.000Z');
assert.equal(operationalDateKey(midnight), '2026-09-24');
assert.equal(platePreview(' abc - 123 '), 'ABC123');
console.log('PASS Africa/Lagos date and manual plate preview');

const calls = [];
let rows = { user_site_assignments: [], sites: [] };
let rpcResponse;
let rpcError = null;
let statisticsResponse;
let statisticsError = null;
class Query {
  constructor(table) { this.table = table; this.filters = []; this.options = {}; }
  select(columns, options = {}) { this.columns = columns; this.options = options; return this; }
  eq(column, value) { this.filters.push([column, 'eq', value]); return this; }
  is(column, value) { this.filters.push([column, 'is', value]); return this; }
  execute() {
    calls.push({ table: this.table, filters: this.filters, columns: this.columns });
    let selected = rows[this.table].filter(row => this.filters.every(([key, op, value]) => {
      if (op === 'eq') return row[key] === value;
      return op === 'is' && row[key] === value;
    }));
    const count = selected.length;
    if (this.options.head) return { data: null, count, error: null };
    const columns = this.columns.split(',').map(item => item.trim());
    return { data: selected.map(row => Object.fromEntries(columns.map(column => [column, row[column]]))), count, error: null };
  }
  maybeSingle() { const result = this.execute(); return Promise.resolve({ ...result, data: result.data[0] ?? null }); }
  then(resolve, reject) { return Promise.resolve(this.execute()).then(resolve, reject); }
}
const mockClient = {
  from(table) { assert(['user_site_assignments', 'sites'].includes(table), 'Loading must not directly read trips'); return new Query(table); },
  async rpc(name, args) { calls.push({ rpc: name, args }); return name === 'get_loading_statistics'
    ? { data: statisticsResponse, error: statisticsError } : { data: rpcResponse, error: rpcError }; },
};
overrides.set(absolute('src/lib/supabase.ts'), { supabase: mockClient });
const data = load('src/features/loading/services/loadingData.ts');
rows.user_site_assignments = [{ id: 'assignment-1', profile_id: 'officer-1', site_id: 'site-1', ended_at: null }];
rows.sites = [{ id: 'site-1', name: 'North Loading Yard', site_type: 'loading', is_active: true }];
assert.deepEqual(await data.loadAssignedSite('officer-1'), {
  kind: 'ready', site: { assignmentId: 'assignment-1', siteId: 'site-1', siteName: 'North Loading Yard' },
});
rows.user_site_assignments = [];
assert.deepEqual(await data.loadAssignedSite('officer-1'), { kind: 'blocked', reason: 'missing' });
rows.user_site_assignments = [{ id: 'assignment-1', profile_id: 'officer-1', site_id: 'site-1', ended_at: null }];
rows.sites[0].site_type = 'offloading';
assert.deepEqual(await data.loadAssignedSite('officer-1'), { kind: 'blocked', reason: 'wrong_type' });
rows.sites[0].site_type = 'loading'; rows.sites[0].is_active = false;
assert.deepEqual(await data.loadAssignedSite('officer-1'), { kind: 'blocked', reason: 'inactive' });
rows.sites = [];
assert.deepEqual(await data.loadAssignedSite('officer-1'), { kind: 'blocked', reason: 'inactive' });
rows.sites = [{ id: 'site-1', name: 'North Loading Yard', site_type: 'loading', is_active: false }];
rows.sites[0].is_active = true;
console.log('PASS assigned site read and blocking states');

statisticsResponse = { ok: true, trips_opened: 3, open_trips: 2, trips_closed: 2, trucks_processed: 2 };
calls.length = 0;
assert.deepEqual(await data.loadLoadingStatistics(), {
  tripsOpened: 3, openTrips: 2, tripsClosed: 2, trucksProcessed: 2,
});
assert.deepEqual(calls.at(-1), { rpc: 'get_loading_statistics', args: undefined });
assert(!calls.some(call => call.table === 'trips'));
statisticsResponse = { ok: true, trips_opened: '3', open_trips: 2, trips_closed: 2, trucks_processed: 2 };
await assert.rejects(data.loadLoadingStatistics(), { message: 'Invalid statistics response' });
statisticsResponse = { ok: false, code: 'SITE_ASSIGNMENT_REQUIRED', details: {} };
await assert.rejects(data.loadLoadingStatistics(), { message: 'Statistics unavailable' });
statisticsError = { code: 'PGRST000', message: 'private backend detail' };
await assert.rejects(data.loadLoadingStatistics(), { message: 'Statistics read failed' });
statisticsError = null;
statisticsResponse = { ok: true, trips_opened: 3, open_trips: 2, trips_closed: 2, trucks_processed: 2 };
console.log('PASS actor-free statistics RPC, safe response validation and no direct trips reads');

const assignment = { ok: true, assignment_id: 'assignment-1', site_id: 'site-1', site_name: 'North Loading Yard' };
const truck = { id: 'truck-1', registration_number: 'ABC-123', normalized_registration: 'ABC123', is_active: true };
const driver = { id: 'driver-1', full_name: 'John Doe', phone_number: '08012345678', email: null, is_active: true, bank_name: 'NEVER_DISPLAY' };
rpcResponse = { ok: true, found: true, assignment, truck, default_driver: driver, block: null };
assert.deepEqual(await data.lookupLoadingTruck({ plate: 'ABC-123' }), {
  kind: 'known_ready', assignmentId: 'assignment-1',
  truck: { id: 'truck-1', registrationNumber: 'ABC-123', normalizedRegistration: 'ABC123', isActive: true },
  driver: { id: 'driver-1', fullName: 'John Doe', phoneNumber: '08012345678', email: null, isActive: true },
});
assert.deepEqual(calls.at(-1), { rpc: 'lookup_loading_truck', args: { p_plate: 'ABC-123' } });
rpcResponse = { ok: true, found: false, assignment };
assert.equal((await data.lookupLoadingTruck({ plate: 'NEW-123' })).kind, 'unknown_truck');
rpcResponse = { ok: true, found: true, assignment, truck: { ...truck, is_active: false }, default_driver: driver, block: null };
assert.equal((await data.lookupLoadingTruck({ plate: 'ABC-123' })).kind, 'inactive_truck');
rpcResponse = { ok: true, found: true, assignment, truck, default_driver: driver,
  block: { ok: false, code: 'OPEN_TRIP_EXISTS', details: { trip_id: 'trip-1', trip_number: 'TRP-001' } } };
assert.equal((await data.lookupLoadingTruck({ plate: 'ABC-123' })).trip.tripNumber, 'TRP-001');
rpcResponse.block = { ok: false, code: 'BLOCKING_EXCEPTION', details: { exception_id: 'private-issue' } };
assert.equal((await data.lookupLoadingTruck({ plate: 'ABC-123' })).kind, 'blocking_exception');
rpcResponse = { ok: false, code: 'SITE_ASSIGNMENT_REQUIRED', details: {} };
assert.deepEqual(await data.lookupLoadingTruck({ plate: 'ABC-123' }), { kind: 'business_failure', code: 'SITE_ASSIGNMENT_REQUIRED' });
rpcError = { code: '42501' };
await assert.rejects(data.lookupLoadingTruck({ plate: 'ABC-123' }), { name: 'Error', message: 'Loading access unavailable' });
rpcError = null;
assert(!calls.some(call => call.rpc === 'create_loading_trip_v2'));
console.log('PASS exact safe lookup branches and no trip-opening call');

const { LoadingLookupController } = load('src/features/loading/utils/lookupController.ts');
let resolveLookup;
let lookupCalls = 0;
let assignmentRefreshes = 0;
let snapshot;
const controller = new LoadingLookupController(() => {
  lookupCalls += 1;
  return new Promise(resolve => { resolveLookup = resolve; });
}, value => { snapshot = value; }, () => { assignmentRefreshes += 1; });
const first = controller.submit('ABC-123', 'assignment-1');
assert.equal(snapshot.state.status, 'looking_up');
assert.equal(await controller.submit('ABC-123', 'assignment-1'), false);
assert.equal(lookupCalls, 1);
controller.editPlate();
assert.equal(snapshot.state.status, 'idle');
resolveLookup({ kind: 'unknown_truck', assignmentId: 'assignment-1' });
await first;
assert.equal(snapshot.state.status, 'idle');
const second = controller.submit('XYZ-999', 'assignment-1');
resolveLookup({ kind: 'unknown_truck', assignmentId: 'assignment-1' });
await second;
assert.equal(snapshot.state.status, 'unknown_truck');
assert.equal(snapshot.state.plate, 'XYZ-999');
const third = controller.submit('ABC-123', 'assignment-1');
resolveLookup({ kind: 'unknown_truck', assignmentId: 'assignment-2' });
await third;
assert.equal(snapshot.state.status, 'site_unavailable');
assert.equal(assignmentRefreshes, 1);
const failure = new LoadingLookupController(async () => { throw new Error('private backend detail'); }, value => { snapshot = value; }, () => {});
await failure.submit('ABC-123', 'assignment-1');
assert.equal(snapshot.state.status, 'lookup_error');
assert.equal(snapshot.pending, false);
const { LoadingAuthorizationError } = load('src/features/loading/services/errors.ts');
const denied = new LoadingLookupController(async () => { throw new LoadingAuthorizationError(); }, value => { snapshot = value; }, () => {});
await denied.submit('ABC-123', 'assignment-1');
assert.equal(snapshot.state.status, 'access_unavailable');
console.log('PASS keyboard-submission controller, duplicate guard, stale-result invalidation and safe errors');

const { LoadingPortalView } = load('src/features/loading/components/LoadingPortalView.tsx');
const readySite = { status: 'ready', site: { assignmentId: 'assignment-1', siteId: 'site-1', siteName: 'North Loading Yard' } };
let submitted = 0; let edited;
const viewProps = {
  officerName: 'Test Officer', now: midnight, site: readySite,
  statistics: { status: 'ready', statistics: { tripsOpened: 3, openTrips: 2, tripsClosed: 2, trucksProcessed: 2 } },
  plate: 'ABC-123', lookup: { state: { status: 'idle' }, pending: false },
  onPlateChange: value => { edited = value; }, onLookup: () => { submitted += 1; },
  onRetrySite() {}, onRetryStatistics() {},
};
const render = changes => renderToStaticMarkup(React.createElement(LoadingPortalView, { ...viewProps, ...changes }));
let html = render();
assert(html.includes('Loading Portal') && html.includes('Test Officer') && html.includes('North Loading Yard'));
assert(html.includes('24 September 2026') && html.includes('ABC123'));
for (const label of ['Trips Opened', 'Open Trips', 'Trips Closed', 'Trucks Processed']) assert(html.includes(label));
assert(html.includes('type="submit"') && html.includes('name="plate"'));
// Native form submit handles Enter and button activation through the same callback.
function findElement(node, type) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === type) return node;
  return React.Children.toArray(node.props?.children).map(child => findElement(child, type)).find(Boolean) ?? null;
}
const tree = LoadingPortalView(viewProps);
let prevented = false;
findElement(tree, 'form').props.onSubmit({ preventDefault() { prevented = true; } });
findElement(tree, 'input').props.onChange({ target: { value: 'XYZ-999' } });
assert(prevented && submitted === 1 && edited === 'XYZ-999');
for (const blockedSite of [{ status: 'blocked', reason: 'missing' }, { status: 'blocked', reason: 'wrong_type' }, { status: 'blocked', reason: 'inactive' }, { status: 'blocked', reason: 'unauthorized' }]) {
  html = render({ site: blockedSite });
  assert(html.includes('Loading site unavailable') && html.includes('name="plate"') && html.includes('disabled=""'));
}
const state = value => ({ state: value, pending: false });
html = render({ lookup: state({ status: 'known_ready', plate: 'ABC-123', truck: { id: 'truck-1', registrationNumber: 'ABC-123', normalizedRegistration: 'ABC123', isActive: true },
  driver: { id: 'driver-1', fullName: 'John Doe', phoneNumber: '08012345678', email: null, isActive: true } }) });
assert(html.includes('Truck found') && html.includes('John Doe') && html.includes('08012345678'));
assert(!html.includes('NEVER_DISPLAY') && !html.includes('bank_name') && !html.includes('Open Trip</button>'));
for (const [lookup, message] of [
  [{ status: 'unknown_truck', plate: 'NEW-123' }, 'Truck not registered'],
  [{ status: 'inactive_truck', plate: 'ABC-123', truck }, 'Truck inactive'],
  [{ status: 'open_trip_exists', plate: 'ABC-123', truck, trip: { tripId: 'trip-1', tripNumber: 'TRP-001' } }, 'Open trip already exists'],
  [{ status: 'blocking_exception', plate: 'ABC-123', truck }, 'Truck needs review'],
  [{ status: 'lookup_error', plate: 'ABC-123' }, 'Retry lookup'],
  [{ status: 'access_unavailable' }, 'Loading access unavailable'],
]) assert(render({ lookup: state(lookup) }).includes(message));
assert(render({ statistics: { status: 'error' } }).includes('Retry figures'));
assert(render({ site: { status: 'error' } }).includes('Recheck assignment'));
console.log('PASS portal shell, form behavior, site gates, statistics, safe review and error states');

let portalAccount = { status: 'active', profile: { id: 'officer-1', role: 'loading_officer', display_name: 'Test Officer' } };
overrides.set(absolute('src/auth/AuthProvider.tsx'), { useAuth: () => ({ account: portalAccount }) });
const { LoadingPortal } = load('src/features/loading/LoadingPortal.tsx');
assert(renderToStaticMarkup(React.createElement(LoadingPortal)).includes('Loading Portal'));
portalAccount = { status: 'active', profile: { ...portalAccount.profile, role: 'offloading_officer' } };
assert.equal(renderToStaticMarkup(React.createElement(LoadingPortal)), '');
console.log('PASS Loading Portal renders for Loading Officer only');
