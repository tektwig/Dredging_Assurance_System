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
let storagePath;

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
  async rpc(name, args) { rpcCalls.push({ name, args }); return rpcHandler(name, args); },
  storage: { from(bucket) {
    assert.equal(bucket, 'waybills');
    return { async download(path) { storagePath = path; return { data: new Blob(['%PDF-test']), error: null }; } };
  } },
} });
const service = load('src/features/operations/services/operationsWaybills.ts');
const register = load('src/features/operations/waybillsPayouts/OperationsWaybillsRegister.tsx');
const detailModule = load('src/features/operations/waybillsPayouts/OperationsWaybillDetail.tsx');
const timestamp = '2026-09-28T09:00:00.000Z';
const row = { invoice_id: 'waybill-1', invoice_number: 'INV-2026-000001', trip_id: 'trip-1',
  trip_number: 'TRP-000001', truck_registration: 'ABC-001', driver_name: 'Snapshot Driver',
  quantity_tonnes: 12.5, closed_at: timestamp, pdf_status: 'ready', payout_status: 'pending',
  driver_delivery_status: 'sent', internal_delivery_status: 'failed' };
const page = items => ({ items, page: 1, page_size: 25, total_count: items.length, has_next: false });
const detail = { invoice: { id: 'waybill-1', invoice_number: 'INV-2026-000001', trip_id: 'trip-1',
  trip_number: 'TRP-000001', truck_registration: 'ABC-001', truck_type: 'Tipper',
  truck_capacity_tonnes: 20, truck_owner_name: 'Owner', driver_name: 'Snapshot Driver',
  driver_phone: '08010000000', driver_email_available: true, driver_license: null,
  loading_site_name: 'Loading', offloading_site_name: 'Offloading',
  loading_officer_name: 'Loading Officer', offloading_officer_name: 'Offloading Officer',
  opened_at: timestamp, closed_at: timestamp, issued_at: timestamp, quantity_tonnes: 12.5,
  closure_account_name: 'Closure Account', closure_account_number: '9999999999', closure_bank_name: 'Closure Bank' },
document: { status: 'ready', storage_path: '2026/INV-2026-000001.pdf', ready_at: timestamp },
payment: { id: 'payment-1', status: 'pending', updated_at: timestamp, account_name: 'Selected Account',
  account_number: '1234567890', bank_name: 'Selected Bank', payment_ready_at: timestamp,
  paid_at: null, payment_reference: null },
delivery: { driver: 'sent', internal: 'failed' } };
const attempt = { notification_id: 'notification-1', audience: 'driver', sequence: 0,
  status: 'sent', attempts: 1, created_at: timestamp, sent_at: timestamp, requested_reason_code: null };
const financeAttempt = { ...attempt, notification_id: 'notification-finance-1', audience: 'finance' };
const clientAttempt = { ...attempt, notification_id: 'notification-client-1', audience: 'client' };

const parsedRow = service.parseWaybillRow(row);
assert.equal(parsedRow.waybill_number, row.invoice_number);
assert.equal(parsedRow.waybill_id, row.invoice_id);
assert(!('invoice_number' in parsedRow) && !('invoice_id' in parsedRow));
const newNumber = 'WB-2026-000002';
const parsedNewRow = service.parseWaybillRow({ ...row, invoice_id: 'waybill-2', invoice_number: newNumber });
assert.equal(parsedNewRow.waybill_number, newNumber);
assert.throws(() => service.parseWaybillRow({ ...row, account_number: 'secret' }), /Invalid/);
assert.throws(() => service.parseWaybillRow({ ...row, raw_provider_error: 'secret' }), /Invalid/);
const parsedDetail = service.parseWaybillDetail(detail);
assert.equal(parsedDetail.payment.account_number, '1234567890');
assert.equal(parsedDetail.waybill.waybill_number, detail.invoice.invoice_number);
assert(!('invoice' in parsedDetail) && !('invoice_number' in parsedDetail.waybill));
assert.equal(service.parseWaybillDetail({ ...detail, delivery: { driver: null, internal: null } }).delivery.driver, null);
assert.throws(() => service.parseWaybillDetail({ ...detail, notification_payload: {} }), /Invalid/);
assert.throws(() => service.parseWaybillDetail({ ...detail, document: { ...detail.document,
  storage_path: '2026/INV-2026-999999.pdf' } }), /Invalid/);
const newDetail = { ...detail, invoice: { ...detail.invoice, id: 'waybill-2', invoice_number: newNumber },
  document: { ...detail.document, storage_path: `2026/${newNumber}.pdf` } };
const parsedNewDetail = service.parseWaybillDetail(newDetail);
assert.equal(parsedNewDetail.waybill.waybill_number, newNumber);
assert.equal(service.parseWaybillDetail(null), null);
console.log('PASS Operations parses and displays stored INV and WB Waybill references with validated PDF paths');

rpcHandler = async (name, args) => ({ data: name === 'get_operations_waybills'
  ? { ...page([row]), page: args.p_page, page_size: args.p_page_size }
  : name === 'get_operations_waybill_detail' ? detail
  : name === 'get_operations_waybill_delivery_history'
    ? { ...page([attempt, financeAttempt, clientAttempt]), page: args.p_page, page_size: args.p_page_size }
    : { status: 'pending' }, error: null });
const filters = { search: ' INV-2026 ', quickFilter: 'delivery_failed', dateFrom: '2026-09-01',
  dateTo: '2026-09-28', pdfStatus: 'ready', deliveryStatus: 'failed', payoutStatus: 'pending' };
assert.equal((await service.loadWaybills(filters, 2)).items[0].waybill_number, row.invoice_number);
assert.deepEqual(rpcCalls[0], { name: 'get_operations_waybills', args: {
  p_page: 2, p_page_size: 25, p_search: 'INV-2026', p_quick_filter: 'delivery_failed',
  p_date_from: '2026-09-01', p_date_to: '2026-09-28', p_pdf_status: 'ready',
  p_delivery_status: 'failed', p_payout_status: 'pending',
} });
assert.equal((await service.loadWaybillDetail('waybill-1')).waybill.trip_number, 'TRP-000001');
const deliveryHistory = await service.loadDeliveryHistory('waybill-1', 1);
assert.equal(deliveryHistory.items[0].sequence, 0);
assert.equal(deliveryHistory.items[1].audience, 'finance');
assert.equal(deliveryHistory.items[2].audience, 'client');
await service.resendWaybill('waybill-1','driver','request-1','DRIVER_REQUEST',false);
assert.deepEqual(rpcCalls.at(-1), { name: 'resend_operations_waybill', args: {
  p_invoice_id: 'waybill-1', p_audience: 'driver', p_request_id: 'request-1',
  p_reason_code: 'DRIVER_REQUEST', p_duplicate_risk_confirmed: false,
} });
await service.retryWaybillDelivery('waybill-1','driver','DELIVERY_UNCONFIRMED');
await service.completeOperationsPayment('payment-1',timestamp,' Account ','1234567890',' Bank ');
assert.equal(rpcCalls.at(-1).args.p_account_name, 'Account');
assert.equal(rpcCalls.at(-1).args.p_bank_name, 'Bank');
await service.markOperationsPaymentPaid('payment-1',timestamp,' REF-001 ');
assert.deepEqual(rpcCalls.at(-1), { name: 'mark_operations_payment_paid', args: {
  p_payment_id: 'payment-1', p_expected_updated_at: timestamp, p_payment_reference: 'REF-001',
} });
console.log('PASS bounded server-side filters, safe resend arguments, and selected payout actions');

let clicked = false; let revoked = false;
const originalDocument = globalThis.document;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
globalThis.document = { body: { append() {} }, createElement() {
  return { click() { clicked = true; }, remove() {} };
} };
URL.createObjectURL = () => 'blob:test';
URL.revokeObjectURL = () => { revoked = true; };
try {
  await service.downloadWaybill(parsedDetail);
  assert.equal(storagePath, '2026/INV-2026-000001.pdf');
  assert(clicked && revoked);
  storagePath = undefined;
  clicked = false;
  revoked = false;
  await service.downloadWaybill(parsedNewDetail);
  assert.equal(storagePath, `2026/${newNumber}.pdf`);
  assert(clicked && revoked);
  storagePath = undefined;
  await assert.rejects(() => service.downloadWaybill({ ...parsedDetail, document: { ...parsedDetail.document,
    storage_path: '2026/INV-2026-999999.pdf' } }), /Invalid/);
  assert.equal(storagePath, undefined);
} finally {
  globalThis.document = originalDocument;
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
}
console.log('PASS private authenticated bucket download rejects mismatched path before Storage access');

const registerHtml = state => renderToStaticMarkup(React.createElement(router.MemoryRouter, null,
  React.createElement(register.OperationsWaybillsRegisterView, { state,
    filters: register.EMPTY_WAYBILL_FILTERS, page: 1, onFiltersChange() {}, onPageChange() {}, onRetry() {},
  })));
assert.match(registerHtml({ status: 'loading' }), /Loading results/);
assert.match(registerHtml({ status: 'error' }), /Unable to load Waybills/);
assert.match(registerHtml({ status: 'ready', data: { ...page([]), pageSize: 25, totalCount: 0 } }), /No Waybills match/);
const registerReady = registerHtml({ status: 'ready', data: { items: [parsedRow, parsedNewRow], page: 1, pageSize: 25, totalCount: 2, hasNext: false } });
for (const column of ['Waybill #','Trip #','Truck','Driver','Tonnage','Waybill Status','Delivery Status','Payout Status','Closed At']) {
  assert(registerReady.includes(column), column);
}
assert(registerReady.includes('href="/operations/waybills-payouts/waybill-1"'));
assert(registerReady.includes('INV-2026-000001') && registerReady.includes(newNumber));
assert(!registerReady.includes('1234567890'));
const detailHtml = (state, history = null) => renderToStaticMarkup(React.createElement(router.MemoryRouter, null,
  React.createElement(detailModule.OperationsWaybillDetailView, { state, history, historyPage: 1,
    historyError: false, onHistoryPageChange() {}, onRetry() {}, onDownload() {}, onRefresh() {}, onActionError() {},
  })));
assert.match(detailHtml({ status: 'loading' }), /Loading results/);
assert.match(detailHtml({ status: 'error' }), /Unable to load Waybill detail/);
assert.match(detailHtml({ status: 'not-found' }), /Waybill not found/);
const detailReady = detailHtml({ status: 'ready', data: parsedDetail });
for (const item of ['Immutable Waybill','PDF','Delivery','Payout','Selected Bank','1234567890',
  'Download private PDF','Controlled driver resend','Operations and Finance access the Waybill through this portal',
  'Mark payout paid']) assert(detailReady.includes(item), item);
assert(!detailReady.includes('Internal Operations / Finance</option>'));
assert(detailReady.includes('Operations / Finance: portal access and download only'));
assert(!detailReady.includes('raw_provider_error'));
const newDetailReady = detailHtml({ status: 'ready', data: parsedNewDetail });
assert(newDetailReady.includes(newNumber));
const historyWithClient = { items: [clientAttempt], page: 1, pageSize: 25, totalCount: 1, hasNext: false };
assert(detailHtml({ status: 'ready', data: parsedNewDetail }, historyWithClient).includes('Target company'));
const resendButton = html => html.match(/<button[^>]*>Create resend attempt<\/button>/)?.[0];
assert(!resendButton(detailReady).includes('disabled'));
const noInitialDelivery = detailHtml({ status: 'ready', data: {
  ...parsedDetail, delivery: { driver: null, internal: null },
} });
assert(noInitialDelivery.includes('Initial delivery not queued'));
assert(noInitialDelivery.includes('Resend becomes available after the initial delivery is processed'));
assert(resendButton(noInitialDelivery).includes('disabled'));
for (const status of ['pending', 'processing']) {
  const initialDeliveryInProgress = detailHtml({ status: 'ready', data: {
    ...parsedDetail, delivery: { driver: status, internal: 'sent' },
  } });
  assert(initialDeliveryInProgress.includes(`Delivery ${status}. Resend becomes available`));
  assert(resendButton(initialDeliveryInProgress).includes('disabled'));
}
const pendingPdf = detailHtml({ status: 'ready', data: {
  ...parsedDetail, document: { status: 'pending', storage_path: null, ready_at: null },
} });
assert(pendingPdf.includes('Ready PDF required'));
assert(pendingPdf.includes('Download private PDF'));
const missingBank = detailHtml({ status: 'ready', data: {
  ...parsedDetail, payment: { ...parsedDetail.payment, status: 'payment_details_required', account_name: null,
    account_number: null, bank_name: null, payment_ready_at: null },
} });
assert(missingBank.includes('Complete payment details'));
const ambiguous = detailHtml({ status: 'ready', data: {
  ...parsedDetail, delivery: { driver: 'failed', internal: 'sent' },
} });
assert(ambiguous.includes('could duplicate a message'));
assert(ambiguous.includes('Retry existing attempt safely'));
const historyError = renderToStaticMarkup(React.createElement(router.MemoryRouter, null,
  React.createElement(detailModule.OperationsWaybillDetailView, {
    state: { status: 'ready', data: parsedDetail }, history: null, historyError: true, historyPage: 1,
    onHistoryPageChange() {}, onRetry() {}, onDownload() {}, onRefresh() {}, onActionError() {},
  })));
assert(historyError.includes('Unable to load delivery history'));
console.log('PASS register/detail loading, empty, error, navigation and action rendering');
