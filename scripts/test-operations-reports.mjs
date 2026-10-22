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
const waybillSummary = { waybills: 1, pdf_failed: 0, delivery_failed: 0,
  blocked_missing_email: 0, blocked_configuration: 0 };
const waybillRow = { invoice_id: 'waybill-1', invoice_number: 'INV-2026-000001', trip_number: 'TRP-001',
  truck_plate: 'RPT-001', driver_name: 'Driver', tonnage_tonnes: 12.5, issued_at: timestamp,
  pdf_status: 'ready', driver_delivery_status: 'sent', company_delivery_status: 'sent' };
const waybillPage = { summary: waybillSummary, items: [waybillRow], total_count: 1,
  page: 1, page_size: 25, has_next: false };
assert.equal(service.validateReportPage('trips', page).items.length, 1);
assert.throws(() => service.validateReportPage('trips', { ...page, items: [{ ...tripRow, bank_name: 'Sensitive' }] }), /Invalid/);
assert.throws(() => service.validateReportPage('trips', { ...page, summary: { ...page.summary, raw_payload: 1 } }), /Invalid/);
assert.throws(() => service.validateReportPage('trips', { ...page, page_size: 101 }), /Invalid/);
const parsedWaybillPage = service.validateReportPage('waybills', waybillPage);
assert.equal(parsedWaybillPage.items[0].waybill_id, 'waybill-1');
assert.equal(parsedWaybillPage.items[0].waybill_number, 'INV-2026-000001');
assert(!('invoice_number' in parsedWaybillPage.items[0]) && !('invoice_id' in parsedWaybillPage.items[0]));
assert(service.buildCsv('waybills', parsedWaybillPage.items).includes('"INV-2026-000001"'));
const waybillCsv = service.buildCsv('waybills', parsedWaybillPage.items);
assert(waybillCsv.includes('"Company Delivery"') && !waybillCsv.includes('Payout'));
assert.throws(() => service.validateReportPage('waybills', { ...waybillPage,
  summary: { ...waybillSummary, payout_total: 1 } }), /Invalid/);
assert.throws(() => service.validateReportPage('waybills', { ...waybillPage,
  items: [{ ...waybillRow, internal_delivery_status: 'sent' }] }), /Invalid/);
assert.equal(service.validateReportPage('waybills', { ...waybillPage, items: [], total_count: 0 }).items.length, 0);
console.log('PASS fixed report projections, bounded pagination and sensitive-field rejection');

rpcHandler = async (name, args) => ({ data: name === 'get_operations_report'
  ? args.p_kind === 'waybills' ? waybillPage : page
  : { export_id: 'export-1', report_kind: args.p_kind, format: 'csv', filters: args.p_filters,
    summary: args.p_kind === 'waybills' ? waybillSummary : page.summary,
    items: args.p_kind === 'waybills' ? [waybillRow] : [tripRow], row_count: 1, generated_at: timestamp }, error: null });
assert.equal((await service.loadOperationsReport('trips', { basis: 'opened', date_from: '2000-01-01', date_to: '2000-01-30' }, 1)).totalCount, 1);
assert.deepEqual(calls.at(-1), { name: 'get_operations_report', args: {
  p_kind: 'trips', p_filters: { basis: 'opened', date_from: '2000-01-01', date_to: '2000-01-30' }, p_page: 1, p_page_size: 25,
} });
const exported = await service.exportOperationsReport('trips', { basis: 'opened', date_from: '2000-01-01', date_to: '2000-01-30' }, 'csv');
assert.equal(exported.rowCount, 1);
assert.equal(calls.at(-1).name, 'export_operations_report');
assert.equal(calls.at(-1).args.p_format, 'csv');
const waybillReport = await service.loadOperationsReport('waybills', {}, 1);
assert.equal(waybillReport.items[0].waybill_number, 'INV-2026-000001');
const waybillExport = await service.exportOperationsReport('waybills', {}, 'csv');
assert.equal(waybillExport.items[0].waybill_id, 'waybill-1');
assert.equal(waybillExport.items[0].waybill_number, 'INV-2026-000001');
assert.equal(waybillExport.summary.blocked_configuration, 0);
assert.equal(calls.at(-1).args.p_filters.payout_status, undefined);
const allowedDeliveryStatuses = ['pending', 'processing', 'sent', 'failed', 'blocked_missing_email', 'blocked_configuration', 'not_queued'];
for (const status of allowedDeliveryStatuses) {
  await service.loadOperationsReport('waybills', { delivery_status: status }, 1);
  assert.deepEqual(calls.at(-1).args.p_filters, { delivery_status: status });
}
await service.loadOperationsReport('waybills', { pdf_status: 'ready' }, 2);
assert.equal(calls.at(-1).args.p_page, 2, 'Pagination sends the selected page to the report RPC');
const callsBeforeInvalidFilter = calls.length;
await assert.rejects(() => service.loadOperationsReport('waybills', { payout_status: 'paid' }, 1), error => {
  assert.equal(error.code, 'invalid_request');
  assert.equal(error.message, 'The selected report filters are not supported.');
  return true;
});
assert.equal(calls.length, callsBeforeInvalidFilter, 'Unsupported payout filters are rejected before the RPC');
await assert.rejects(() => service.loadOperationsReport('trips', { raw: 'any' }, 1), error => error.code === 'invalid_request');
await assert.rejects(() => service.exportOperationsReport('waybills', { payout_status: 'paid' }, 'csv'),
  error => error.code === 'invalid_request');
for (const deliveryStatus of ['not_applicable', 'unknown']) {
  await assert.rejects(() => service.loadOperationsReport('waybills', { delivery_status: deliveryStatus }, 1),
    error => error.code === 'invalid_request');
}
await assert.rejects(() => service.loadOperationsReport('waybills', { pdf_status: 'not_queued' }, 1),
  error => error.code === 'invalid_request');
rpcHandler = async () => ({ data: null, error: { code: 'P0001', details: 'EXPORT_LIMIT_EXCEEDED' } });
await assert.rejects(() => service.exportOperationsReport('trips', {}, 'csv'), error => error.code === 'export_limit');
rpcHandler = async () => ({ data: null, error: { code: '42501', message: 'sensitive database detail', details: 'private value' } });
await assert.rejects(() => service.loadOperationsReport('trips', {}, 1), error => {
  assert.equal(error.code, 'access_denied');
  assert.equal(error.message, 'Your account cannot access Operations Reports.');
  assert(!error.message.includes('sensitive database detail'));
  return true;
});
rpcHandler = async () => ({ data: null, error: { code: 'XX000', message: 'internal schema details', details: 'private value' } });
await assert.rejects(() => service.loadOperationsReport('waybills', {}, 1), error => {
  assert.equal(error.code, 'rpc_failed');
  assert.equal(error.message, 'The report request failed. Retry or contact Operations Support.');
  assert(!error.message.includes('internal schema details'));
  return true;
});
rpcHandler = async () => { throw new Error('private transport response'); };
await assert.rejects(() => service.loadOperationsReport('waybills', {}, 1), error => {
  assert.equal(error.code, 'rpc_failed');
  assert(!error.message.includes('private transport response'));
  return true;
});
rpcHandler = async () => ({ data: { ...waybillPage, summary: { ...waybillSummary, payout: 2 } }, error: null });
await assert.rejects(() => service.loadOperationsReport('waybills', {}, 1), error => error.code === 'invalid_response');
rpcHandler = async (_name, args) => ({ data: { export_id: 'export-2', report_kind: 'waybills', format: 'xlsx',
  filters: args.p_filters, summary: waybillSummary, items: [waybillRow], row_count: 1, generated_at: timestamp }, error: null });
const xlsxExport = await service.exportOperationsReport('waybills', {}, 'xlsx');
assert.equal(xlsxExport.format, 'xlsx');
const waybillXlsxBytes = writer.createXlsxBytes('waybills', xlsxExport.items);
const waybillSheet = new TextDecoder().decode(waybillXlsxBytes);
assert(waybillSheet.includes('Company Delivery') && !waybillSheet.includes('Payout Status'));
assert(waybillSheet.includes('Legacy PDF Status'));
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

const render = (state, kind = 'trips') => renderToStaticMarkup(React.createElement(router.MemoryRouter, null,
  React.createElement(view.OperationsReportsView, { kind, onKindChange() {}, filters: { basis: 'opened' }, changeFilter() {},
    state, page: 1, onPageChange() {}, onRetry() {}, exporting: false, exportError: '', onExport() {} })));
assert.match(render({ status: 'loading' }), /Loading results/);
assert.match(render({ status: 'error', message: 'Unable to load report results.' }), /Unable to load report results/);
assert.match(render({ status: 'error', message: 'Your account cannot access Operations Reports.' }),
  /Your account cannot access Operations Reports/);
assert.match(render({ status: 'ready', data: { ...service.validateReportPage('trips', page), items: [], totalCount: 0 } }), /No report results match/);
const ready = render({ status: 'ready', data: service.validateReportPage('trips', page) });
assert(ready.includes('Export CSV') && ready.includes('Export Excel') && ready.includes('Tonnage'));
const waybillUi = render({ status: 'ready', data: service.validateReportPage('waybills', waybillPage) }, 'waybills');
assert(waybillUi.includes('Waybills &amp; Delivery') && waybillUi.includes('Company Delivery'));
assert(!waybillUi.includes('Payout Status') && !waybillUi.includes('not_applicable'));
for (const status of ['blocked_missing_email', 'blocked_configuration', 'not_queued']) assert(waybillUi.includes(status));
assert(waybillUi.includes('Clear filters') && waybillUi.includes('Next'));
const busy = renderToStaticMarkup(React.createElement(router.MemoryRouter, null,
  React.createElement(view.OperationsReportsView, { kind: 'trips', onKindChange() {}, filters: { basis: 'opened' }, changeFilter() {},
    state: { status: 'ready', data: service.validateReportPage('trips', page) }, page: 1, onPageChange() {}, onRetry() {},
    exporting: true, exportError: '', onExport() {} })));
assert.equal((busy.match(/disabled=""[^>]*>Preparing…/g) ?? []).length, 2);
const app = readFileSync('src/App.tsx', 'utf8');
assert(app.includes('path="reports" element={<OperationsReports />}'));
console.log('PASS reports loading/error/empty/ready UI, export busy states and guarded route integration');
