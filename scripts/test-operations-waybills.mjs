// Mocked RPC and Storage transport; never contacts a database or sends email.
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
let storageBucket;
let copyDownloadOverride;

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
    return { async download(path) { storageBucket = bucket; storagePath = path; return { data: new Blob(['%PDF-mock']), error: null }; } };
  } },
} });
const service = load('src/features/operations/services/operationsWaybills.ts');
const register = load('src/features/operations/waybillsPayouts/OperationsWaybillsRegister.tsx');
const detailModule = load('src/features/operations/waybillsPayouts/OperationsWaybillDetail.tsx');
const timestamp = '2026-09-28T09:00:00.000Z';
const waybillNumber = 'WB-2026-000001';
const row = { invoice_id: 'waybill-1', invoice_number: waybillNumber, trip_id: 'trip-1',
  trip_number: 'TRP-000001', truck_registration: 'ABC-001', driver_name: 'Snapshot Driver',
  quantity_tonnes: 12.5, closed_at: timestamp, pdf_status: 'ready',
  driver_delivery_status: 'blocked_missing_email', company_delivery_status: 'blocked_configuration' };
const page = items => ({ items, page: 1, page_size: 25, total_count: items.length, has_next: false });
const detail = { invoice: { id: 'waybill-1', invoice_number: waybillNumber, trip_id: 'trip-1',
  trip_number: 'TRP-000001', driver_id: 'driver-1', truck_registration: 'ABC-001', truck_type: 'Tipper',
  truck_capacity_tonnes: 20, truck_owner_name: 'Owner', driver_name: 'Snapshot Driver',
  driver_phone: '08010000000', driver_email_available: false, driver_license: null,
  loading_site_name: 'Loading', offloading_site_name: 'Offloading',
  loading_officer_name: 'Loading Officer', offloading_officer_name: 'Offloading Officer',
  opened_at: timestamp, closed_at: timestamp, issued_at: timestamp, quantity_tonnes: 12.5 },
  document: { status: 'ready', storage_path: '2026/WB-2026-000001.pdf', ready_at: timestamp },
  delivery: { driver: 'blocked_missing_email', company: 'blocked_configuration' } };
const attempt = { notification_id: 'notification-1', audience: 'driver', sequence: 0,
  status: 'blocked_missing_email', attempts: 0, created_at: timestamp, sent_at: null,
  requested_reason_code: null, blocked_reason_code: 'missing_driver_email' };
const copyStatus = { invoice_id: 'waybill-1', invoice_number: waybillNumber, driver_pdf_status: 'ready',
  driver_pdf_ready_at: timestamp, company_pdf_status: 'blocked_missing_bank_details', company_pdf_ready_at: null,
  bank_verification_state: 'missing', pending_bank_submission_id: null, latest_bank_snapshot_version: null,
  company_pdf_held_for_missing_bank_details: true };
const saveResult = [{ snapshot_version: 1, company_pdf_status: 'pending', unchanged: false }];

const parsedRow = service.parseWaybillRow(row);
assert.equal(parsedRow.waybill_number, waybillNumber);
assert.equal(parsedRow.waybill_id, 'waybill-1');
assert(!JSON.stringify(parsedRow).match(/payment|payout|bank|account_number/i));
assert.throws(() => service.parseWaybillRow({ ...row, account_number: 'sensitive' }), /Invalid/);
const parsedDetail = service.parseWaybillDetail(detail);
assert.equal(parsedDetail.delivery.company, 'blocked_configuration');
assert(!JSON.stringify(parsedDetail).match(/payment|payout|bank|account_number/i));
assert.throws(() => service.parseWaybillDetail({ ...detail, payment: { status: 'paid' } }), /Invalid/);
console.log('PASS Waybill read models allowlist operational fields and exclude payment data');

rpcHandler = async (name, args) => ({ data: name === 'get_operations_waybills'
  ? { ...page([row]), page: args.p_page, page_size: args.p_page_size }
  : name === 'get_operations_waybill_detail' ? detail
  : name === 'get_operations_waybill_copy_management_state' ? [copyStatus]
  : name === 'save_waybill_company_bank_details' ? saveResult
  : name === 'get_operations_waybill_pdf_copy' ? copyDownloadOverride ?? [{ copy_kind: args.p_copy_kind,
    storage_bucket: args.p_copy_kind === 'driver' ? 'waybill-driver-copies' : 'waybill-company-copies',
    storage_path: args.p_copy_kind === 'company' ? '2026/WB-2026-000001-company-v2.pdf' : '2026/WB-2026-000001.pdf',
    ready_at: timestamp }]
  : name === 'get_operations_waybill_delivery_history'
    ? { ...page([attempt]), page: args.p_page, page_size: args.p_page_size }
    : { notification_id: 'notification-1', status: 'pending', sequence: 0 }, error: null });
const filters = { search: ' WB-2026 ', quickFilter: 'blocked_missing_email', dateFrom: '2026-09-01',
  dateTo: '2026-09-28', pdfStatus: 'ready', deliveryStatus: 'blocked_missing_email' };
assert.equal((await service.loadWaybills(filters, 2)).items[0].waybill_number, waybillNumber);
assert.deepEqual(rpcCalls[0], { name: 'get_operations_waybills', args: {
  p_page: 2, p_page_size: 25, p_search: 'WB-2026', p_quick_filter: 'blocked_missing_email',
  p_date_from: '2026-09-01', p_date_to: '2026-09-28', p_pdf_status: 'ready',
  p_delivery_status: 'blocked_missing_email',
} });
assert.equal((await service.loadWaybillDetail('waybill-1')).waybill.trip_number, 'TRP-000001');
const secureStatus = await service.loadWaybillCopyManagementState('waybill-1');
assert.equal(secureStatus.driver_pdf_status, 'ready');
assert.equal(secureStatus.company_pdf_status, 'blocked_missing_bank_details');
assert.equal(secureStatus.company_pdf_held_for_missing_bank_details, true);
assert.equal(secureStatus.bank_verification_state, 'missing');
assert(!JSON.stringify(secureStatus).match(/account_number|bank_name|storage_path|pending_bank_submission_id/i));
assert.throws(() => service.parseWaybillCopyManagementState([{ ...copyStatus, account_number: 'restricted' }], 'waybill-1'), /Invalid/);
assert.equal(service.parseSaveCompanyBankResult(saveResult).snapshot_version, 1);
assert.throws(() => service.parseSaveCompanyBankResult([{ ...saveResult[0], account_number: 'restricted' }]), /Invalid/);
const savedBankState = await service.saveWaybillCompanyBankDetails('waybill-1', 'request-1',
  ' Example Bank ', ' Synthetic Driver ', '0123456789');
assert.equal(savedBankState.company_pdf_status, 'pending');
assert.deepEqual(rpcCalls.at(-1), { name: 'save_waybill_company_bank_details', args: {
  p_invoice_id: 'waybill-1', p_request_id: 'request-1', p_bank_name: 'Example Bank',
  p_account_name: 'Synthetic Driver', p_account_number: '0123456789',
} });
assert(!JSON.stringify(savedBankState).match(/bank_name|account_number|Example Bank|0123456789/i));
const successfulRpcHandler = rpcHandler;
rpcHandler = async name => name === 'save_waybill_company_bank_details'
  ? { data: null, error: { code: 'P4091', message: 'sensitive payload must not be shown' } }
  : { data: null, error: null };
await assert.rejects(() => service.saveWaybillCompanyBankDetails('waybill-1', 'request-2',
  'Example Bank', 'Synthetic Driver', '0123456789'), error => {
  assert.match(error.message, /changed while saving/i);
  assert(!error.message.includes('sensitive payload'));
  assert(!error.message.includes('0123456789'));
  return true;
});
rpcHandler = successfulRpcHandler;
const deliveryHistory = await service.loadDeliveryHistory('waybill-1', 1);
const parsedAttempt = deliveryHistory.items[0];
assert.equal(parsedAttempt.audience, 'driver');
assert.equal(parsedAttempt.blocked_reason_code, 'missing_driver_email');
await service.retryWaybillDelivery('waybill-1', 'driver', 'DELIVERY_UNCONFIRMED');
assert.deepEqual(rpcCalls.at(-1), { name: 'retry_operations_waybill_delivery', args: {
  p_invoice_id: 'waybill-1', p_audience: 'driver', p_reason_code: 'DELIVERY_UNCONFIRMED',
} });
assert(!rpcCalls.some(call => /payment|payout|mark_trip_payment/i.test(call.name)));
console.log('PASS server filters and audited delivery retry use only driver/company streams');

const originalDocument = globalThis.document;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
globalThis.document = { body: { append() {} }, createElement() { return { click() {}, remove() {} }; } };
URL.createObjectURL = () => 'blob:mock'; URL.revokeObjectURL = () => {};
try {
  await service.downloadWaybill(parsedDetail);
  assert.equal(storagePath, '2026/WB-2026-000001.pdf');
  assert.equal(storageBucket, 'waybills');
  storagePath = undefined;
  await service.downloadWaybillCopy('waybill-1', waybillNumber, 'driver');
  assert.equal(storageBucket, 'waybill-driver-copies');
  assert.equal(storagePath, '2026/WB-2026-000001.pdf');
  storagePath = undefined;
  await service.downloadWaybillCopy('waybill-1', waybillNumber, 'company');
  assert.equal(storageBucket, 'waybill-company-copies');
  assert.equal(storagePath, '2026/WB-2026-000001-company-v2.pdf');
  storagePath = undefined;
  copyDownloadOverride = [{ copy_kind: 'company', storage_bucket: 'waybill-company-copies',
    storage_path: '2026/WB-2026-000001.pdf', ready_at: timestamp, bank_name: 'must-not-accept' }];
  await assert.rejects(() => service.downloadWaybillCopy('waybill-1', waybillNumber, 'company'), /Invalid/);
  assert.equal(storagePath, undefined);
  copyDownloadOverride = undefined;
  await assert.rejects(() => service.downloadWaybill({ ...parsedDetail, document: {
    ...parsedDetail.document, storage_path: '2026/WB-2026-999999.pdf',
  } }), /Invalid/);
  assert.equal(storagePath, undefined);
} finally { globalThis.document = originalDocument; URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
console.log('PASS private PDF download validates the Waybill storage path before Storage access');

const registerHtml = state => renderToStaticMarkup(React.createElement(router.MemoryRouter, null,
  React.createElement(register.OperationsWaybillsRegisterView, { state, filters: register.EMPTY_WAYBILL_FILTERS,
    page: 1, onFiltersChange() {}, onPageChange() {}, onRetry() {} })));
assert.match(registerHtml({ status: 'loading' }), /Loading results/);
assert.match(registerHtml({ status: 'error' }), /Unable to load Waybills/);
assert.match(registerHtml({ status: 'ready', data: { ...page([]), pageSize: 25, totalCount: 0 } }), /No Waybills match/);
const registerReady = registerHtml({ status: 'ready', data: { items: [parsedRow], page: 1, pageSize: 25, totalCount: 1, hasNext: false } });
for (const text of ['Waybill #', 'Waybill PDF', 'Delivery Status', 'Parent company:', 'Driver:']) assert(registerReady.includes(text));
assert(registerReady.includes('href="/operations/waybills/waybill-1"'));
assert(!registerReady.match(/payout|payment|bank|account_number/i));
const detailHtml = (state, copyState = { status: 'ready', data: secureStatus }) => renderToStaticMarkup(React.createElement(router.MemoryRouter, null,
  React.createElement(detailModule.OperationsWaybillDetailView, { state, copyState,
    history: { ...page([parsedAttempt]), pageSize: 25 }, historyError: false, historyPage: 1,
    onHistoryPageChange() {}, onRetry() {}, onDownload() {}, onCopyDownload() {}, onRefresh() {}, onActionError() {} })));
const readyHtml = detailHtml({ status: 'ready', data: parsedDetail });
for (const text of ['Correct the driver email', 'Add an email to the driver master record first.',
  'Company delivery is blocked until the parent company email recipient is configured.',
  'No Finance Officer mailbox is used as a fallback.', 'The original Waybill and delivery record are preserved.']) {
  assert(readyHtml.includes(text), text);
}
const acceptedHtml = detailHtml({ status: 'ready', data: { ...parsedDetail, delivery: { driver: 'sent', company: 'sent' } } });
assert(acceptedHtml.includes('The email provider accepted the message. This does not confirm mailbox delivery.'));
assert(acceptedHtml.includes('Driver PDF'));
assert(acceptedHtml.includes('Company PDF'));
assert(acceptedHtml.includes('Bank Details Required'));
assert(acceptedHtml.includes('Enter Bank Details'));
assert(acceptedHtml.includes('Account Number'));
assert(acceptedHtml.includes('Save bank details'));
assert(!acceptedHtml.match(/payout|payment|bank_name|account_number|1234567890/i));
const registrationCapturedState = { ...copyStatus, company_pdf_status: 'pending',
  bank_verification_state: 'registration_captured', latest_bank_snapshot_version: 1,
  company_pdf_held_for_missing_bank_details: false };
const registrationCapturedHtml = detailHtml({ status: 'ready', data: parsedDetail },
  { status: 'ready', data: service.parseWaybillCopyManagementState([registrationCapturedState], 'waybill-1') });
assert(!registrationCapturedHtml.includes('Enter Bank Details'));
assert(registrationCapturedHtml.includes('Status: <strong>Pending</strong>'));
const verifiedCopyStatus = { ...copyStatus, company_pdf_status: 'pending', bank_verification_state: 'verified',
  latest_bank_snapshot_version: 1, company_pdf_held_for_missing_bank_details: false };
const savedBankHtml = detailHtml({ status: 'ready', data: parsedDetail },
  { status: 'ready', data: service.parseWaybillCopyManagementState([verifiedCopyStatus], 'waybill-1') });
assert(!savedBankHtml.includes('Enter Bank Details'));
assert(!savedBankHtml.includes('Bank Details Required'));
assert(savedBankHtml.includes('Status: <strong>Pending</strong>'));
assert(detailHtml({ status: 'ready', data: parsedDetail }, { status: 'error' }).includes('Secure copy statuses are unavailable'));
console.log('PASS Waybill detail shows separate secure PDF states without exposing bank values or copy paths');
