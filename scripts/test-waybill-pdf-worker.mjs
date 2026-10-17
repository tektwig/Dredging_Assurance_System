import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const workerSource = readFileSync('supabase/functions/process-waybill-pdfs/worker.ts', 'utf8');
const workerJavaScript = ts.transpileModule(workerSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { processWaybillPdfs } = await import(`data:text/javascript;base64,${Buffer.from(workerJavaScript).toString('base64')}`);

const config = { supabaseUrl: 'https://synthetic-project.example.invalid', serviceRoleKey: 'server-only-test-key' };
const legacyJob = {
  id: 'legacy-doc', invoice_id: 'legacy-invoice', trip_id: 'legacy-trip', invoice_number: 'WB-2026-000123',
  storage_path: '2026/WB-2026-000123.pdf', lease_token: 'legacy-lease',
};
const driverJob = {
  copy_id: 'driver-copy', invoice_id: 'driver-invoice', trip_id: 'driver-trip', invoice_number: 'WB-2026-000123',
  storage_bucket: 'waybill-driver-copies', storage_path: '2026/WB-2026-000123.pdf', attempts: 1,
  lease_token: 'driver-lease', lease_until: '2026-10-17T11:00:00.000Z',
};
const companyJob = {
  ...driverJob,
  copy_id: 'company-copy',
  storage_bucket: 'waybill-company-copies',
  storage_path: '2026/WB-2026-000123-company-v2.pdf',
  lease_token: 'company-lease',
};
const secureSnapshot = {
  invoice_number: 'WB-2026-000123', truck_registration: 'LAG-482XY', driver_name: 'Synthetic Driver',
  loading_site_name: 'Synthetic Loading Site', offloading_site_name: 'Synthetic Offloading Site',
  quantity_tonnes: 12.5, opened_at: '2026-10-17T09:00:00.000Z', closed_at: '2026-10-17T10:00:00.000Z',
  issued_at: '2026-10-17T10:00:00.000Z',
};
const legacySnapshot = {
  ...secureSnapshot, trip_number: 'TRIP-000123', truck_type: 'Tipper', truck_capacity_tonnes: 25,
  truck_owner_name: 'Synthetic Owner', driver_phone: '08000000000', driver_email: null, driver_license: null,
  bank_name: 'Legacy Synthetic Bank', account_name: 'Legacy Synthetic Account', account_number: '9876543210',
  loading_officer_name: null, offloading_officer_name: null,
};
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json', ...headers },
});
const pdfBytes = new Uint8Array([37, 80, 68, 70]);

async function runWorker({
  legacyJobs = [], legacyDenied = true, driverJobs = [], companyJobs = [], driverSnapshot = secureSnapshot,
  companySnapshot = { ...secureSnapshot, driver_phone: null, bank_name: 'Synthetic Bank',
    account_name: 'Synthetic Account', account_number: '1234567890' },
  failSecureStorage = false, conflictSecureStorage = false, staleDriverLease = false, invalidDriverPath = false,
} = {}) {
  const calls = [];
  const rendered = { legacy: [], driver: [], company: [] };
  const http = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const name = url.pathname.split('/').pop();
      const body = JSON.parse(String(init.body ?? '{}'));
      calls.push({ name, body, method, headers });
      if (name === 'claim_waybill_pdf_jobs') return legacyDenied ? json({ message: 'permission denied' }, 403) : json(legacyJobs);
      if (name === 'claim_driver_waybill_pdf_jobs') {
        return json(invalidDriverPath ? [{ ...driverJob, storage_path: 'other/unsafe.pdf' }] : driverJobs);
      }
      if (name === 'claim_company_waybill_pdf_jobs') return json(companyJobs);
      if (name === 'get_waybill_pdf_snapshot') return json([legacySnapshot]);
      if (name === 'get_driver_waybill_pdf_snapshot') {
        return json({ ...driverSnapshot, driver_phone: 'MUST_NOT_REACH_DRIVER_RENDERER',
          bank_name: 'MUST_NOT_REACH_DRIVER_RENDERER', account_name: 'MUST_NOT_REACH_DRIVER_RENDERER',
          account_number: '1111111111' });
      }
      if (name === 'get_company_waybill_pdf_snapshot') return json(companySnapshot);
      if (name === 'finish_waybill_pdf_job') return json(true);
      if (name === 'finish_driver_waybill_pdf_job') return json(!staleDriverLease);
      if (name === 'finish_company_waybill_pdf_job') return json(true);
      throw new Error(`Unexpected RPC ${name}`);
    }
    calls.push({ name: 'storage', url: url.toString(), method, headers });
    if (failSecureStorage && url.pathname.includes('/waybill-driver-copies/')) return new Response('private failure', { status: 503 });
    if (conflictSecureStorage && method === 'POST' && url.pathname.includes('/waybill-driver-copies/')) {
      return new Response('already exists', { status: 409 });
    }
    if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-type': 'application/pdf' } });
    return new Response(null, { status: 201 });
  };
  const counts = await processWaybillPdfs(config, {
    legacy: async snapshot => { rendered.legacy.push(snapshot); return pdfBytes; },
    driver: async snapshot => { rendered.driver.push(snapshot); return pdfBytes; },
    company: async snapshot => { rendered.company.push(snapshot); return pdfBytes; },
  }, 2, http);
  return { counts, calls, rendered };
}

const secureSuccess = await runWorker({ driverJobs: [driverJob], companyJobs: [companyJob] });
assert.deepEqual(secureSuccess.counts, {
  claimed: 2, ready: 2, deferred: 0, unacknowledged: 0, legacy_claimed: 0,
  driver_claimed: 1, company_claimed: 1, claim_errors: 1,
});
assert.equal(secureSuccess.rendered.driver.length, 1);
assert.equal('driver_phone' in secureSuccess.rendered.driver[0], false);
assert.equal('bank_name' in secureSuccess.rendered.driver[0], false);
assert.equal('account_number' in secureSuccess.rendered.driver[0], false);
assert.equal(secureSuccess.rendered.company[0].account_number, '1234567890');
assert.equal(secureSuccess.rendered.company[0].bank_name, 'Synthetic Bank');
assert.equal(secureSuccess.calls.some(call => call.name === 'get_waybill_pdf_snapshot'), false);
assert(secureSuccess.calls.some(call => call.name === 'get_driver_waybill_pdf_snapshot'
  && call.body.p_copy_id === driverJob.copy_id && call.body.p_lease_token === driverJob.lease_token));
assert(secureSuccess.calls.some(call => call.name === 'get_company_waybill_pdf_snapshot'
  && call.body.p_copy_id === companyJob.copy_id && call.body.p_lease_token === companyJob.lease_token));
const secureUploads = secureSuccess.calls.filter(call => call.name === 'storage');
assert.equal(secureUploads.length, 2);
assert(secureUploads.every(call => call.method === 'POST' && call.headers.get('x-upsert') === 'false'));
assert(secureUploads.some(call => call.url.includes('/waybill-driver-copies/2026/WB-2026-000123.pdf')));
assert(secureUploads.some(call => call.url.includes('/waybill-company-copies/2026/WB-2026-000123-company-v2.pdf')));
assert.equal(JSON.stringify(secureSuccess.counts).includes('1234567890'), false);
console.log('PASS secure jobs use leased copy-specific RPCs, isolated buckets, and safe renderer inputs');

const blockedCompany = await runWorker({ driverJobs: [driverJob], companyJobs: [] });
assert.equal(blockedCompany.counts.driver_claimed, 1);
assert.equal(blockedCompany.counts.company_claimed, 0);
assert.equal(blockedCompany.rendered.driver.length, 1);
assert.equal(blockedCompany.calls.some(call => call.name === 'get_company_waybill_pdf_snapshot'), false);
console.log('PASS bank-blocked company jobs remain unclaimed while Driver PDFs proceed');

const invalidCompany = await runWorker({
  driverJobs: [driverJob], companyJobs: [companyJob],
  companySnapshot: { ...secureSnapshot, driver_phone: null, bank_name: null, account_name: null, account_number: null },
});
assert.equal(invalidCompany.counts.ready, 1);
assert.equal(invalidCompany.counts.deferred, 1);
assert.equal(invalidCompany.rendered.company.length, 0);
assert.equal(invalidCompany.calls.filter(call => call.name === 'storage').length, 1);
assert(invalidCompany.calls.some(call => call.name === 'finish_company_waybill_pdf_job'
  && call.body.p_failure_code === 'invalid_snapshot' && call.body.p_succeeded === false));
console.log('PASS incomplete company snapshot fails only the company job without uploading banking data');

const storageFailure = await runWorker({ driverJobs: [driverJob], failSecureStorage: true });
assert.equal(storageFailure.counts.deferred, 1);
assert(storageFailure.calls.some(call => call.name === 'finish_driver_waybill_pdf_job'
  && call.body.p_failure_code === 'storage_upload_failed'));
console.log('PASS Storage failures are acknowledged with the approved retryable failure code');

const leaseConflict = await runWorker({ driverJobs: [driverJob], staleDriverLease: true });
assert.equal(leaseConflict.counts.unacknowledged, 1);
assert.equal(leaseConflict.counts.ready, 0);
console.log('PASS stale lease acknowledgement is counted as unacknowledged');

const conflict = await runWorker({ driverJobs: [driverJob], conflictSecureStorage: true });
const conflictStorage = conflict.calls.filter(call => call.name === 'storage');
assert.deepEqual(conflictStorage.map(call => call.method), ['POST', 'HEAD']);
assert.equal(conflictStorage[0].headers.get('x-upsert'), 'false');
assert.equal(conflict.counts.ready, 1);
console.log('PASS secure object conflicts confirm an existing PDF and never overwrite it');

const unsafePath = await runWorker({ driverJobs: [driverJob], invalidDriverPath: true });
assert.equal(unsafePath.rendered.driver.length, 0);
assert.equal(unsafePath.calls.some(call => call.name === 'get_driver_waybill_pdf_snapshot'), false);
assert(unsafePath.calls.some(call => call.name === 'finish_driver_waybill_pdf_job'
  && call.body.p_failure_code === 'invalid_snapshot'));
console.log('PASS unsafe bucket paths are rejected before snapshot access or Storage upload');

const legacySuccess = await runWorker({ legacyDenied: false, legacyJobs: [legacyJob] });
assert.equal(legacySuccess.counts.legacy_claimed, 1);
assert.equal(legacySuccess.counts.ready, 1);
assert.equal(legacySuccess.rendered.legacy[0].account_number, '9876543210');
const legacyUpload = legacySuccess.calls.find(call => call.name === 'storage');
assert.equal(legacyUpload.url, 'https://synthetic-project.example.invalid/storage/v1/object/waybills/2026/WB-2026-000123.pdf');
assert.equal(legacyUpload.headers.get('x-upsert'), 'true');
assert(legacySuccess.calls.some(call => call.name === 'finish_waybill_pdf_job'
  && call.body.p_id === legacyJob.id && call.body.p_lease_token === legacyJob.lease_token));
console.log('PASS legacy queue processing retains its existing snapshot, path, upload, and finish contract');

const pdfSource = readFileSync('supabase/functions/process-waybill-pdfs/secure_pdf.ts', 'utf8');
const pdfJavaScript = ts.transpileModule(pdfSource
  .replace(/^import \{ PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage \} from 'npm:pdf-lib@1\.17\.1';$/m,
    'const { PDFDocument, StandardFonts, rgb } = globalThis.__testPdfLib;')
  .replace(/^import type .*;\r?\n/gm, ''), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const renderedText = [];
const pageSizes = [];
const fakeFont = { encodeText() {}, widthOfTextAtSize(value, size) { return value.length * size * 0.45; } };
const fakePage = {
  drawText(value, options) { renderedText.push({ value, options }); },
  drawRectangle() {}, drawImage() {}, drawLine() {},
};
globalThis.__testPdfLib = {
  PDFDocument: { async create() { return {
    async embedFont() { return fakeFont; }, async embedJpg(bytes) { assert.deepEqual([...bytes], [1, 2, 3]); return { scaleToFit: () => ({ width: 100, height: 60 }) }; },
    setTitle() {}, setSubject() {}, setAuthor() {}, setCreationDate() {}, setModificationDate() {},
    addPage(size) { pageSizes.push(size); return fakePage; }, async save() { return new TextEncoder().encode(renderedText.map(item => item.value).join('\n')); },
  }; } }, StandardFonts: { Helvetica: 'Helvetica', HelveticaBold: 'Helvetica-Bold' }, rgb: () => ({}),
};
const pdfModule = await import(`data:text/javascript;base64,${Buffer.from(pdfJavaScript).toString('base64')}`);
const commonPdf = { invoice_number: 'WB-2026-000123', truck_registration: 'LAG-482XY',
  driver_name: 'Synthetic Driver', loading_site_name: 'Loading Site', offloading_site_name: 'Offloading Site',
  quantity_tonnes: 12.5, opened_at: '2026-10-17T09:00:00.000Z', closed_at: '2026-10-17T10:00:00.000Z',
  issued_at: '2026-10-17T10:00:00.000Z' };
const maliciousDriver = { ...commonPdf, copy_kind: 'driver', driver_phone: 'PHONE_SECRET', bank_name: 'BANK_SECRET',
  account_name: 'ACCOUNT_SECRET', account_number: '1234567890' };
const driverPdf = await pdfModule.generateDriverWaybillPdf(maliciousDriver, new Uint8Array([1, 2, 3]));
const driverText = new TextDecoder().decode(driverPdf);
assert(!driverText.includes('PHONE_SECRET'));
assert(!driverText.includes('BANK_SECRET'));
assert(!driverText.includes('ACCOUNT_SECRET'));
assert(!driverText.includes('DRIVER PAYMENT DETAILS'));
assert(pageSizes.every(size => size[0] === 595.28 && size[1] === 841.89));
assert(driverText.includes('Waybill Number: WB-2026-000123'));
assert(driverText.includes('17 Oct 2026, 10:00 WAT'));
renderedText.length = 0;
const companyPdf = await pdfModule.generateCompanyWaybillPdf({ ...commonPdf, copy_kind: 'company',
  driver_phone: null, bank_name: 'Synthetic Bank', account_name: 'Synthetic Account', account_number: '1234567890' },
new Uint8Array([1, 2, 3]));
const companyText = new TextDecoder().decode(companyPdf);
assert(companyText.includes('Synthetic Bank'));
assert(companyText.includes('Synthetic Account'));
assert(companyText.includes('1234567890'));
assert(!companyText.includes('PHONE_SECRET'));
assert.throws(() => pdfModule.generateCompanyWaybillPdf({ ...commonPdf, copy_kind: 'company',
  driver_phone: null, bank_name: '', account_name: '', account_number: '' }, new Uint8Array([1, 2, 3])));
assert.equal((await import('node:fs')).statSync('supabase/functions/process-waybill-pdfs/assets/trakflit-logo.jpg').size > 0, true);
console.log('PASS secure PDF renderers use A4, Lagos timestamps, the TRAKFLIT logo, and recipient-specific fields');
