import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync('supabase/functions/process-waybill-pdfs/worker.ts', 'utf8');
const pdfSource = readFileSync('supabase/functions/process-waybill-pdfs/pdf.ts', 'utf8');
assert.match(pdfSource, /page\.drawText\(`Waybill Number:/);
assert.match(pdfSource, /`Waybill Number: \$\{snapshot\.invoice_number\}`/);
assert.doesNotMatch(pdfSource, /page\.drawText\(`Invoice Number:/i);
console.log('PASS generated Waybill PDF labels the identifier as a Waybill Number');

const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { processWaybillPdfs } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

const config = { supabaseUrl: 'https://project.example.invalid', serviceRoleKey: 'server-only-service-role-key' };
const snapshot = {
  invoice_number: 'INV-2026-000123', trip_number: 'TRIP-000123', truck_registration: 'WB-123',
  truck_type: 'Tipper', truck_capacity_tonnes: 25, truck_owner_name: 'Truck Owner',
  driver_name: 'Driver Name', driver_phone: '08010000000', driver_email: null, driver_license: 'LIC-123',
  bank_name: 'Snapshot Bank', account_name: 'Snapshot Account', account_number: '0123456789',
  loading_site_name: 'Loading Site', offloading_site_name: 'Offloading Site', quantity_tonnes: 24.5,
  opened_at: '2026-09-27T09:00:00+01:00', closed_at: '2026-09-27T11:00:00+01:00',
  loading_officer_name: 'Loading Officer', offloading_officer_name: 'Offloading Officer',
  issued_at: '2026-09-27T10:00:00Z',
};
const renderedText = [];
const fakeFont = {
  encodeText() {},
  widthOfTextAtSize(value) { return value.length * 5; },
};
globalThis.__waybillPdfTestLibrary = {
  PDFDocument: { async create() { return {
    async embedFont() { return fakeFont; },
    setTitle() {}, setSubject() {}, setAuthor() {}, setCreationDate() {}, setModificationDate() {},
    addPage() { return { drawText(value) { renderedText.push(value); } }; },
    async save() { return new TextEncoder().encode(renderedText.join('\n')); },
  }; } },
  StandardFonts: { Helvetica: 'Helvetica', HelveticaBold: 'Helvetica-Bold' },
  rgb: () => ({}),
};
const executablePdfSource = pdfSource
  .replace("import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';",
    'const { PDFDocument, StandardFonts, rgb } = globalThis.__waybillPdfTestLibrary;')
  .replace("import type { WaybillSnapshot } from './worker.ts';", '');
const pdfJavascript = ts.transpileModule(executablePdfSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { generateWaybillPdf } = await import(`data:text/javascript;base64,${Buffer.from(pdfJavascript).toString('base64')}`);
const generatedBankPdf = await generateWaybillPdf(snapshot);
const generatedBankText = new TextDecoder().decode(generatedBankPdf);
for (const detail of ['Bank Name: Snapshot Bank', 'Account Name: Snapshot Account',
  'Account Number: 0123456789']) {
  assert(generatedBankText.includes(detail), `Authoritative Waybill snapshot must render ${detail}`);
}
assert(generatedBankText.includes('Waybill Number: INV-2026-000123'));
console.log('PASS authoritative Waybill PDF renders driver banking details from its server snapshot');
renderedText.splice(0);
const generatedMissingBankPdf = await generateWaybillPdf({ ...snapshot,
  bank_name: null, account_name: null, account_number: null });
const generatedMissingBankText = new TextDecoder().decode(generatedMissingBankPdf);
for (const detail of ['Bank Name: Not provided', 'Account Name: Not provided', 'Account Number: Not provided']) {
  assert(generatedMissingBankText.includes(detail), `Missing authoritative value must remain explicit: ${detail}`);
}
console.log('PASS missing banking snapshot values are labeled without fabricated PDF data');

const job = {
  id: 'doc-123', invoice_id: 'waybill-123', trip_id: 'trip-123', invoice_number: snapshot.invoice_number,
  storage_path: '2026/INV-2026-000123.pdf', lease_token: 'lease-123',
};
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

async function runScenario({ uploadStatus = 200, snapshotRows = [snapshot], jobRow = job,
  finishResult = true, renderFails = false, limit = 5 } = {}) {
  const calls = [];
  const http = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/rpc/claim_waybill_pdf_jobs')) {
      assert.deepEqual(JSON.parse(init.body), { p_limit: limit });
      return json([jobRow]);
    }
    if (url.endsWith('/rpc/get_waybill_pdf_snapshot')) {
      assert.deepEqual(JSON.parse(init.body), { p_document_id: jobRow.id, p_lease_token: jobRow.lease_token });
      return json(snapshotRows);
    }
    if (url.includes('/storage/v1/object/waybills/')) {
      if (uploadStatus !== 200) return new Response('Sensitive storage response must not be retained', { status: uploadStatus });
      assert.equal(init.method, 'POST');
      assert.equal(init.headers['Content-Type'], 'application/pdf');
      assert.equal(init.headers['x-upsert'], 'true');
      assert.equal(init.headers.Authorization, `Bearer ${config.serviceRoleKey}`);
      return json({ Key: jobRow.storage_path });
    }
    if (url.endsWith('/rpc/finish_waybill_pdf_job')) return json(finishResult);
    throw new Error(`Unexpected request: ${url}`);
  };
  const renderPdf = async value => {
    assert.deepEqual(value, snapshotRows[0]);
    if (renderFails) throw new Error('Sensitive PDF renderer failure');
    return new Uint8Array([37, 80, 68, 70]);
  };
  const result = await processWaybillPdfs(config, renderPdf, limit, http);
  return { calls, result };
}

const success = await runScenario();
const successFinish = JSON.parse(success.calls.find(call => call.url.endsWith('/rpc/finish_waybill_pdf_job')).init.body);
assert.equal(successFinish.p_failure_code, null, `Unexpected worker failure: ${JSON.stringify(successFinish)}`);
assert.deepEqual(success.result, { claimed: 1, ready: 1, deferred: 0, unacknowledged: 0 });
assert.equal(success.calls.filter(call => call.url.includes('/storage/v1/object/')).length, 1);
assert.equal(success.calls.find(call => call.url.endsWith('/rpc/finish_waybill_pdf_job')).init.body,
  JSON.stringify({ p_id: job.id, p_lease_token: job.lease_token, p_succeeded: true, p_failure_code: null }));
console.log('PASS snapshot-driven PDF upload uses deterministic path and storage upsert');

const wbNumber = 'WB-2026-000123';
const wbSnapshot = { ...snapshot, invoice_number: wbNumber };
const wbJob = { ...job, invoice_number: wbNumber, storage_path: `2026/${wbNumber}.pdf` };
const wbResult = await runScenario({ snapshotRows: [wbSnapshot], jobRow: wbJob });
assert.deepEqual(wbResult.result, { claimed: 1, ready: 1, deferred: 0, unacknowledged: 0 });
assert(wbResult.calls.some(call => call.url.endsWith(`/storage/v1/object/waybills/${wbJob.storage_path}`)));
console.log('PASS PDF worker stores a new WB reference at its deterministic Waybill path');

const singleJob = await runScenario({ limit: 1 });
assert.deepEqual(singleJob.result, { claimed: 1, ready: 1, deferred: 0, unacknowledged: 0 });
console.log('PASS batch limit of one reaches the claim RPC as p_limit: 1');

const storageFailure = await runScenario({ uploadStatus: 503 });
assert.deepEqual(storageFailure.result, { claimed: 1, ready: 0, deferred: 1, unacknowledged: 0 });
const storageFinish = JSON.parse(storageFailure.calls.find(call => call.url.endsWith('/rpc/finish_waybill_pdf_job')).init.body);
assert.equal(storageFinish.p_failure_code, 'storage_upload_failed');
assert.equal(JSON.stringify(storageFinish).includes('Sensitive'), false);
console.log('PASS Storage failures produce sanitized retryable job state');

const pdfFailure = await runScenario({ renderFails: true });
assert.deepEqual(pdfFailure.result, { claimed: 1, ready: 0, deferred: 1, unacknowledged: 0 });
assert.equal(pdfFailure.calls.some(call => call.url.includes('/storage/v1/object/')), false);
assert.equal(JSON.parse(pdfFailure.calls.find(call => call.url.endsWith('/rpc/finish_waybill_pdf_job')).init.body).p_failure_code,
  'pdf_generation_failed');
console.log('PASS PDF generation failures do not upload or escape into job errors');

const invalidSnapshot = { ...snapshot, invoice_number: 'INV-2025-000123' };
const invalid = await runScenario({ snapshotRows: [invalidSnapshot] });
assert.deepEqual(invalid.result, { claimed: 1, ready: 0, deferred: 1, unacknowledged: 0 });
assert.equal(invalid.calls.some(call => call.url.includes('/storage/v1/object/')), false);
assert.equal(JSON.parse(invalid.calls.find(call => call.url.endsWith('/rpc/finish_waybill_pdf_job')).init.body).p_failure_code,
  'invalid_invoice_snapshot');
console.log('PASS Waybill snapshot/path mismatch is rejected before Storage upload');

const lostLease = await runScenario({ finishResult: false });
assert.deepEqual(lostLease.result, { claimed: 1, ready: 0, deferred: 0, unacknowledged: 1 });
console.log('PASS stale job lease cannot be acknowledged');
