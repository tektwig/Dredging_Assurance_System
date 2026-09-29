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
const calls = [];
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

overrides.set(resolve('src/lib/supabase.ts'), { supabase: {
  async rpc(name, args) { calls.push({ name, args }); return rpcHandler(name, args); },
} });
const service = load('src/features/operations/services/operationsExceptions.ts');
const register = load('src/features/operations/exceptions/OperationsExceptionsRegister.tsx');
const detailView = load('src/features/operations/exceptions/OperationsExceptionDetail.tsx');
const navigation = load('src/components/PortalNavigation.tsx');
const exceptionId = 'c9630000-0000-0000-0000-000000000001';
const truckId = 'c9620000-0000-0000-0000-000000000001';
const tripId = 'c9640000-0000-0000-0000-000000000001';
const officerId = 'c9600000-0000-0000-0000-000000000001';
const timestamp = '2026-09-29T09:00:00.000Z';
const row = { exception_id: exceptionId, exception_type: 'dispute', status: 'open',
  blocks_operations: true, trip_id: tripId, trip_number: 'TRP-000001', truck_id: truckId,
  truck_registration: 'EXC-001', driver_name: 'Actual Trip Driver', created_at: timestamp,
  updated_at: timestamp };
const officer = { officer_id: officerId, display_name: 'Operations Officer' };
const detail = { ...row, loading_site_name: 'Loading', offloading_site_name: null,
  review_started_at: null, resolved_at: null, resolution_code: null,
  reporter: officer, reviewer: null, resolver: null,
  history: [{ occurred_at: timestamp, from_status: null, to_status: 'open', actor: officer }] };
const page = { items: [row], page: 1, page_size: 25, total_count: 1, has_next: false };

assert.equal(service.parseExceptionPage(page).items[0].truck_registration, 'EXC-001');
assert.equal(service.parseExceptionDetail(detail).history[0].to_status, 'open');
assert.equal(service.parseExceptionDetail(null), null);
for (const extra of [{ description: 'BANK-SECRET' }, { payload: { bank_name: 'SECRET' } }]) {
  assert.throws(() => service.parseExceptionPage({ ...page, items: [{ ...row, ...extra }] }), /Invalid/);
  assert.throws(() => service.parseExceptionDetail({ ...detail, ...extra }), /Invalid/);
}
assert.throws(() => service.parseExceptionDetail({ ...detail, history: [{ ...detail.history[0],
  old_value: { description: 'SECRET' } }] }), /Invalid/);
assert.throws(() => service.parseExceptionDetail({ ...detail, resolution_code: 'UNAPPROVED' }), /Invalid/);
assert.throws(() => service.parseExceptionPage({ ...page, page_size: 101 }), /Invalid/);
assert.deepEqual(service.parseTransition({ ok: false, code: 'STALE_EXCEPTION' }),
  { ok: false, code: 'STALE_EXCEPTION' });
assert.throws(() => service.parseTransition({ ok: false, code: 'UNKNOWN' }), /Invalid/);
console.log('PASS strict bounded safe exception projections and transition responses');

rpcHandler = async name => ({ data: name === 'get_operations_exceptions' ? page
  : name === 'get_operations_exception_detail' ? detail
    : { ok: true, status: 'in_review', updated_at: timestamp }, error: null });
const filters = { search: ' EXC-001 ', status: 'open', type: 'dispute', dateFrom: '2026-09-01',
  dateTo: '2026-09-29', tripId, truckId };
assert.equal((await service.loadExceptions(filters, 1)).items[0].exception_id, exceptionId);
assert.deepEqual(calls.at(-1), { name: 'get_operations_exceptions', args: {
  p_page: 1, p_page_size: 25, p_search: 'EXC-001', p_status: 'open', p_type: 'dispute',
  p_date_from: '2026-09-01', p_date_to: '2026-09-29', p_trip_id: tripId, p_truck_id: truckId,
} });
assert.equal((await service.loadExceptionDetail(exceptionId)).reporter.officer_id, officerId);
assert.deepEqual(calls.at(-1), { name: 'get_operations_exception_detail', args: {
  p_exception_id: exceptionId, p_history_limit: 20,
} });
await service.startExceptionReview(exceptionId, timestamp);
assert.deepEqual(calls.at(-1), { name: 'start_operations_exception_review', args: {
  p_exception_id: exceptionId, p_expected_updated_at: timestamp,
} });
await service.resolveException(exceptionId, timestamp, 'referred_for_correction');
assert.deepEqual(calls.at(-1), { name: 'resolve_operations_exception', args: {
  p_exception_id: exceptionId, p_expected_updated_at: timestamp, p_resolution_code: 'referred_for_correction',
} });
await assert.rejects(() => service.resolveException(exceptionId, timestamp, 'UNAPPROVED'), /Approved/);
await assert.rejects(() => service.loadExceptions({ ...filters, truckId: 'invalid' }, 1), /complete ID/);
rpcHandler = async () => ({ data: null, error: { code: '42501' } });
await assert.rejects(() => service.loadExceptionDetail(exceptionId), /access denied/);
console.log('PASS server-side filters, exact versions, approved code, and safe errors');

const registerHtml = state => renderToStaticMarkup(React.createElement(router.MemoryRouter, null,
  React.createElement(register.OperationsExceptionsRegisterView, {
    state, filters: register.EMPTY_EXCEPTION_FILTERS, page: 1,
    onFiltersChange() {}, onPageChange() {}, onRetry() {},
  })));
assert.match(registerHtml({ status: 'loading' }), /Loading results/);
assert.match(registerHtml({ status: 'error' }), /Unable to load Exceptions/);
assert.match(registerHtml({ status: 'ready', data: { items: [], page: 1, pageSize: 25,
  totalCount: 0, hasNext: false } }), /No Exceptions match/);
const registerReady = registerHtml({ status: 'ready', data: { items: [row], page: 1,
  pageSize: 25, totalCount: 1, hasNext: false } });
for (const title of ['Related Trip', 'Blocks Operations', 'Created At', 'Updated At']) {
  assert(registerReady.includes(title));
}
assert(registerReady.includes(`href="/operations/exceptions/${exceptionId}"`));
assert(!registerReady.includes('BANK-SECRET'));
const detailHtml = (state, busy = false, code = 'issue_verified_resolved') => renderToStaticMarkup(React.createElement(router.MemoryRouter, null,
  React.createElement(detailView.OperationsExceptionDetailView, {
    state, busy, code, message: '',
    onCodeChange() {}, onReview() {}, onResolve() {}, onRetry() {},
  })));
assert.match(detailHtml({ status: 'loading' }), /Loading results/);
assert.match(detailHtml({ status: 'error' }), /Unable to load Exception detail/);
assert.match(detailHtml({ status: 'not-found' }), /Exception not found/);
const openHtml = detailHtml({ status: 'ready', data: detail });
assert(openHtml.includes('Start review'));
assert(!openHtml.includes('Resolve exception'));
assert(openHtml.includes('Yes, until resolved'));
assert(openHtml.includes(`href="/operations/trips/${tripId}"`));
assert(detailHtml({ status: 'ready', data: detail }, true).includes('disabled=""'));
const reviewed = { ...detail, status: 'in_review', review_started_at: timestamp, reviewer: officer,
  history: [...detail.history, { occurred_at: timestamp, from_status: 'open', to_status: 'in_review', actor: officer }] };
assert(detailHtml({ status: 'ready', data: reviewed }).includes('Resolve exception'));
assert(detailHtml({ status: 'ready', data: reviewed }, false, '').includes('disabled=""'));
const resolved = { ...reviewed, status: 'resolved', resolved_at: timestamp, resolver: officer,
  resolution_code: 'no_action_required' };
const resolvedHtml = detailHtml({ status: 'ready', data: resolved });
assert(resolvedHtml.includes('cannot be reopened'));
assert(!resolvedHtml.includes('Start review'));
assert(!resolvedHtml.includes('Resolve exception'));
const app = readFileSync('src/App.tsx', 'utf8');
assert(app.includes('path="exceptions" element={<OperationsExceptionsRegister />}'));
assert(app.includes('path="exceptions/:exceptionId" element={<OperationsExceptionDetail />}'));
const navHtml = renderToStaticMarkup(React.createElement(router.MemoryRouter,
  { initialEntries: [`/operations/exceptions/${exceptionId}`] },
  React.createElement(navigation.PortalNavigation, { basePath: '/operations', label: 'Operations',
    items: [{ label: 'Dashboard', route: '', title: 'Dashboard' },
      { label: 'Exceptions', route: 'exceptions', title: 'Exceptions' }] })));
assert.match(navHtml, /class="portal-navigation-link active"[^>]*href="\/operations\/exceptions"/);
console.log('PASS guarded routes and register/detail loading, empty, conflict-ready lifecycle states');
