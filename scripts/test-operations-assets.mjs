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
let rpcHandler = async () => ({ data: null, error: null });

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

overrides.set(resolve('src/lib/supabase.ts'), { supabase: { async rpc(name, args) {
  rpcCalls.push({ name, args });
  return rpcHandler(name, args);
} } });
const service = load('src/features/operations/services/operationsAssets.ts');
const list = load('src/features/operations/trucksDrivers/OperationsAssetsList.tsx');
const detail = load('src/features/operations/trucksDrivers/OperationsAssetDetail.tsx');
const timestamp = '2026-09-28T09:00:00.123456+00:00';
const truck = { truck_id: 'truck-1', plate: 'ABC-001', truck_type: 'Tipper', capacity: 20,
  capacity_unit: 'tonnes', regular_driver_id: 'driver-1', regular_driver_name: 'Actual Driver',
  is_active: true, registered_at: timestamp, total_trips: 3, open_trips: 0, last_trip_at: timestamp };
const driver = { driver_id: 'driver-1', name: 'Actual Driver', phone: '08014000001', email: 'driver@example.invalid',
  is_active: true, registered_at: timestamp, regular_trucks: 2, total_trips: 4, open_trips: 0, last_trip_at: timestamp };
const page = items => ({ items, page: 1, page_size: 25, total_count: items.length, has_next: false });
const truckDetail = { ...truck, owner_name: 'Truck Owner', owner_contact: '08014000009',
  updated_at: timestamp, regular_driver: { driver_id: 'driver-1', name: 'Actual Driver', is_active: true } };
delete truckDetail.regular_driver_id;
delete truckDetail.regular_driver_name;
delete truckDetail.last_trip_at;
const driverDetail = { ...driver, license_number: 'LIC-1', updated_at: timestamp, active_regular_trucks: 1,
  regular_truck_preview: [{ truck_id: 'truck-1', plate: 'ABC-001', is_active: true }] };
delete driverDetail.last_trip_at;
const history = { trip_id: 'trip-1', trip_number: 'TRP-001', plate: 'ABC-001', driver_name: 'Actual Driver',
  opened_at: timestamp, closed_at: null, status: 'open', tonnage: null };

assert.equal(service.parseTrucksPage(page([truck]), { page: 1, pageSize: 25 }).items[0].plate, 'ABC-001');
assert.equal(service.parseDriversPage(page([driver]), { page: 1, pageSize: 25 }).items[0].regular_trucks, 2);
assert.equal(service.parseTruckDetail(truckDetail).regular_driver.name, 'Actual Driver');
assert.equal(service.parseDriverDetail(driverDetail).regular_truck_preview.length, 1);
assert.equal(service.parseHistoryPage(page([history]), { page: 1, pageSize: 25 }).items[0].status, 'open');
assert.equal(service.parseMutation({ outcome: 'updated', updated_at: timestamp }).updated_at, timestamp);
for (const unsafe of [
  () => service.parseTrucksPage(page([{ ...truck, account_number: 'secret' }]), { page: 1, pageSize: 25 }),
  () => service.parseDriversPage(page([{ ...driver, bank_name: 'secret' }]), { page: 1, pageSize: 25 }),
  () => service.parseTruckDetail({ ...truckDetail, payment_details: {} }),
  () => service.parseDriverDetail({ ...driverDetail, bank_name: 'secret' }),
  () => service.parseHistoryPage(page([{ ...history, provider_error: 'secret' }]), { page: 1, pageSize: 25 }),
  () => service.parseMutation({ outcome: 'updated', updated_at: timestamp, banking: 'secret' }),
  () => service.parseTrucksPage({ ...page([truck]), items: Array(26).fill(truck) }, { page: 1, pageSize: 25 }),
]) assert.throws(unsafe, /Invalid/);
console.log('PASS strict asset list/detail/history/mutation validation excludes banking and unbounded data');

rpcHandler = async (name, args) => ({ data: name === 'get_operations_trucks'
  ? { ...page([truck]), page: args.p_page, page_size: args.p_page_size }
  : name === 'get_operations_drivers' ? { ...page([driver]), page: args.p_page, page_size: args.p_page_size }
    : name === 'get_operations_asset_trips' ? { ...page([history]), page: args.p_page, page_size: args.p_page_size }
      : name === 'get_operations_truck_detail' ? truckDetail
        : name === 'get_operations_driver_detail' ? driverDetail
          : { outcome: 'updated', updated_at: timestamp }, error: null });
await service.loadTrucks({ search: ' abc 001 ', active: 'active' }, 0, 'driver-1');
assert.deepEqual(rpcCalls.at(-1), { name: 'get_operations_trucks', args: {
  p_page: 1, p_page_size: 25, p_search: 'abc 001', p_active: true, p_regular_driver_id: 'driver-1' } });
await service.loadDrivers({ search: '0801', active: 'inactive' }, 2);
assert.equal(rpcCalls.at(-1).args.p_page, 2);
await service.loadAssetHistory('driver', 'driver-1', 1);
assert.equal(rpcCalls.at(-1).args.p_kind, 'driver');
await service.correctTruckPlate('truck-1', timestamp, 'ABC-002');
assert.equal(rpcCalls.at(-1).args.p_expected_updated_at, timestamp);
assert.equal(rpcCalls.at(-1).args.p_reason, 'identity_correction');
await service.setRegularDriver('truck-1', timestamp, 'driver-2');
assert.equal(rpcCalls.at(-1).args.p_driver_id, 'driver-2');
await service.setDriverActive('driver-1', timestamp, false);
assert.equal(rpcCalls.at(-1).args.p_reason, 'deactivate');
for (const [code, kind] of [['P4090', 'stale'], ['P4091', 'open-trip'], ['P4092', 'relationship'],
  ['23505', 'duplicate'], ['42501', 'denied']]) {
  rpcHandler = async () => ({ data: null, error: { code, message: 'UNSAFE RAW ERROR' } });
  await assert.rejects(service.correctTruckPlate('truck-1', timestamp, 'ABC-002'), error =>
    error instanceof service.OperationsAssetError && error.kind === kind && !error.message.includes('UNSAFE'));
}
console.log('PASS server-side pagination, exact concurrency timestamp, explicit RPCs and sanitized conflicts');

const render = element => renderToStaticMarkup(React.createElement(router.MemoryRouter, null, element));
const callbacks = { onFiltersChange() {}, onPageChange() {}, onRetry() {}, onRun() {} };
const filters = { search: '', active: 'all' };
const trucksHtml = render(React.createElement(list.OperationsTrucksListView,
  { state: { status: 'ready', data: service.parseTrucksPage(page([truck]), { page: 1, pageSize: 25 }) }, filters, page: 1, ...callbacks }));
assert(trucksHtml.includes('Trucks and drivers') && trucksHtml.includes('ABC-001'));
assert(trucksHtml.includes('href="/operations/trucks-drivers/trucks/truck-1"'));
const driversHtml = render(React.createElement(list.OperationsDriversListView,
  { state: { status: 'ready', data: service.parseDriversPage(page([driver]), { page: 1, pageSize: 25 }) }, filters, page: 1, ...callbacks }));
assert(driversHtml.includes('Actual Driver') && driversHtml.includes('Regular Trucks'));
assert(render(React.createElement(list.OperationsTrucksListView, { state: { status: 'error' }, filters, page: 1, ...callbacks })).includes('Retry'));
assert(render(React.createElement(list.OperationsDriversListView, { state: { status: 'ready',
  data: service.parseDriversPage(page([]), { page: 1, pageSize: 25 }) }, filters, page: 1, ...callbacks })).includes('No drivers match'));
const truckHtml = render(React.createElement(detail.OperationsTruckDetailView, { state: { status: 'ready', data: truckDetail },
  change: { status: 'idle' }, ...callbacks }));
assert(truckHtml.includes('Correct truck plate') && truckHtml.includes('Change Regular Driver'));
assert(!truckHtml.includes('account_number') && !truckHtml.includes('bank_name'));
const driverHtml = render(React.createElement(detail.OperationsDriverDetailView, { state: { status: 'ready', data: driverDetail },
  change: { status: 'idle' }, ...callbacks }));
assert(driverHtml.includes('Driver master data') && driverHtml.includes('Trip history'));
assert(render(React.createElement(detail.OperationsDriverDetailView, { state: { status: 'error' },
  change: { status: 'idle' }, ...callbacks })).includes('Retry'));
console.log('PASS responsive tab/list/detail views, explicit actions and loading/error/empty states');
