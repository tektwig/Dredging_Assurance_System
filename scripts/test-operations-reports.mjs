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
const service = load('src/features/operations/services/operationsReports.ts');
const writer = load('src/features/operations/services/xlsxWriter.ts');
const view = load('src/features/operations/reports/OperationsReports.tsx');

const timestamp = '2000-01-01T00:00:00.000Z';
const tripRow = { trip_id: 'trip-1', trip_number: 'TRP-001', truck_id: 'truck-1', truck_plate: 'RPT-001',
  driver_id: 'driver-1', driver_name: 'Driver', loading_site_id: 'site-1', loading_site: 'Loading',
  offloading_site_id: 'site-2', offloading_site: 'Offloading', opened_at: timestamp, closed_at: timestamp,
  cancelled_at: null, estimated_tonnage_tonnes: 10.25, tonnage_tonnes: 12.5, status: 'closed' };
const page = { summary: { rows: 1, trips_opened: 0, trips_closed: 1, trips_cancelled: 0, open_trips: 0, tonnage_tonnes: 12.5 },
  items: [tripRow], total_count: 1, page: 1, page_size: 25, has_next: false };
assert.equal(service.validateReportPage('trips', page).items.length, 1);
assert.throws(() => service.validateReportPage('trips', { ...page, items: [{ ...tripRow, bank_name: 'Sensitive' }] }), /Invalid/);
assert.throws(() => service.validateReportPage('trips', { ...page, summary: { ...page.summary, raw_payload: 1 } }), /Invalid/);
assert.throws(() => service.validateReportPage('trips', { ...page, page_size: 101 }), /Invalid/);
console.log('PASS fixed report projections, bounded pagination and sensitive-field rejection');

rpcHandler = async name => ({ data: name === 'get_operations_report' ? page : {
  export_id: 'export-1', report_kind: 'trips', format: 'csv', filters: { basis: 'opened', date_from: '2000-01-01', date_to: '2000-01-30' },
  summary: page.summary, items: [tripRow], row_count: 1, generated_at: timestamp,
}, error: null });
assert.equal((await service.loadOperationsReport('trips', { basis: 'opened', date_from: '2000-01-01', date_to: '2000-01-30' }, 1)).totalCount, 1);
assert.deepEqual(calls.at(-1), { name: 'get_operations_report', args: {
  p_kind: 'trips', p_filters: { basis: 'opened', date_from: '2000-01-01', date_to: '2000-01-30' }, p_page: 1, p_page_size: 25,
} });
const exported = await service.exportOperationsReport('trips', { basis: 'opened', date_from: '2000-01-01', date_to: '2000-01-30' }, 'csv');
assert.equal(exported.rowCount, 1);
assert.equal(calls.at(-1).name, 'export_operations_report');
assert.equal(calls.at(-1).args.p_format, 'csv');
await assert.rejects(() => service.loadOperationsReport('trips', { raw: 'any' }, 1), /Invalid report filters/);
rpcHandler = async () => ({ data: null, error: { code: 'P0001', details: 'EXPORT_LIMIT_EXCEEDED' } });
await assert.rejects(() => service.exportOperationsReport('trips', {}, 'csv'), /1,000 rows/);
rpcHandler = async () => ({ data: null, error: { code: '42501' } });
await assert.rejects(() => service.loadOperationsReport('trips', {}, 1), /access denied/);
console.log('PASS server-side RPC calls, safe authorization failures and export-limit handling');

const malicious = { ...tripRow, driver_name: ' =HYPERLINK("https://bad.invalid")' };
const csv = service.buildCsv('trips', [malicious]);
assert(csv.startsWith('\uFEFF'));
assert(csv.includes('"\t =HYPERLINK(""https://bad.invalid"")"'));
assert.equal(service.makeReportFilename('trips', 'csv', { date_from: '2000-01-01', date_to: '2000-01-30' }, timestamp),
  'operations-trips-2000-01-01_to_2000-01-30-20000101T000000Z.csv');
console.log('PASS CSV quoting, spreadsheet formula prefix and deterministic filename');

const xlsxBytes = writer.createXlsxBytes('trips', [malicious]);
const files = new Map();
const decoder = new TextDecoder();
let offset = 0;
while (offset + 4 < xlsxBytes.length && new DataView(xlsxBytes.buffer).getUint32(offset, true) === 0x04034b50) {
  const view = new DataView(xlsxBytes.buffer);
  const size = view.getUint32(offset + 18, true);
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const name = decoder.decode(xlsxBytes.slice(offset + 30, offset + 30 + nameLength));
  const dataStart = offset + 30 + nameLength + extraLength;
  files.set(name, decoder.decode(xlsxBytes.slice(dataStart, dataStart + size)));
  offset = dataStart + size;
}
assert.equal(files.size, 5);
assert(files.has('[Content_Types].xml') && files.has('xl/workbook.xml') && files.has('xl/worksheets/sheet1.xml'));
const sheet = files.get('xl/worksheets/sheet1.xml');
assert(sheet.includes('t="inlineStr"'));
assert(sheet.includes(' =HYPERLINK(&quot;https://bad.invalid&quot;)'));
assert(!/<f[ >]/i.test(sheet));
assert(![...files.keys()].some(name => /vbaProject|externalLinks|hyperlinks/i.test(name)));
assert(![...files.values()].some(value => /<f[ >]|TargetMode="External"|<hyperlinks\b/i.test(value)));
console.log('PASS XLSX is a valid stored OpenXML workbook with literal cells and no formula or external-link parts');

const render = state => renderToStaticMarkup(React.createElement(router.MemoryRouter, null,
  React.createElement(view.OperationsReportsView, { kind: 'trips', onKindChange() {}, filters: { basis: 'opened' }, changeFilter() {},
    state, page: 1, onPageChange() {}, onRetry() {}, exporting: false, exportError: '', onExport() {} })));
assert.match(render({ status: 'loading' }), /Loading results/);
assert.match(render({ status: 'error' }), /Unable to load report results/);
assert.match(render({ status: 'ready', data: { ...service.validateReportPage('trips', page), items: [], totalCount: 0 } }), /No report results match/);
const ready = render({ status: 'ready', data: service.validateReportPage('trips', page) });
assert(ready.includes('Export CSV') && ready.includes('Export Excel') && ready.includes('Tonnage'));
const busy = renderToStaticMarkup(React.createElement(router.MemoryRouter, null,
  React.createElement(view.OperationsReportsView, { kind: 'trips', onKindChange() {}, filters: { basis: 'opened' }, changeFilter() {},
    state: { status: 'ready', data: service.validateReportPage('trips', page) }, page: 1, onPageChange() {}, onRetry() {},
    exporting: true, exportError: '', onExport() {} })));
assert.equal((busy.match(/disabled=""[^>]*>Preparing…/g) ?? []).length, 2);
const app = readFileSync('src/App.tsx', 'utf8');
assert(app.includes('path="reports" element={<OperationsReports />}'));
console.log('PASS reports loading/error/empty/ready UI, export busy states and guarded route integration');
