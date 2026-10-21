import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const workerSource = readFileSync('supabase/functions/process-waybill-pdfs/worker.ts', 'utf8');
const pdfMigration = readFileSync('supabase/migrations/20261013000200_secure_dual_waybill_foundation.sql', 'utf8');
const workerJavaScript = ts.transpileModule(workerSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { processWaybillPdfs } = await import(`data:text/javascript;base64,${Buffer.from(workerJavaScript).toString('base64')}`);

const config = { supabaseUrl: 'https://synthetic-project.example.invalid', serviceRoleKey: 'server-only-test-key' };
const canaryConfig = { supabaseUrl: 'https://pidxlopbxlapfmakmtjt.supabase.co', serviceRoleKey: 'server-only-test-key' };
const driverJob = {
  copy_id: '44444444-4444-4444-8444-444444444444',
  invoice_id: '22222222-2222-4222-8222-222222222222',
  trip_id: '55555555-5555-4555-8555-555555555555', invoice_number: 'WB-2026-000123',
  storage_bucket: 'waybill-driver-copies', storage_path: '2026/WB-2026-000123.pdf', attempts: 1,
  lease_token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', lease_until: '2099-10-17T11:00:00.000Z',
};
const companyJob = {
  ...driverJob,
  copy_id: '66666666-6666-4666-8666-666666666666',
  storage_bucket: 'waybill-company-copies',
  storage_path: '2026/WB-2026-000123-company-v2.pdf',
  lease_token: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};
const secureSnapshot = {
  invoice_number: 'WB-2026-000123', truck_registration: 'LAG-482XY', driver_name: 'Synthetic Driver',
  loading_site_name: 'Synthetic Loading Site', offloading_site_name: 'Synthetic Offloading Site',
  quantity_tonnes: 12.5, opened_at: '2026-10-17T09:00:00.000Z', closed_at: '2026-10-17T10:00:00.000Z',
  issued_at: '2026-10-17T10:00:00.000Z',
};
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json', ...headers },
});
const pdfBytes = new TextEncoder().encode('%PDF-1.7\nsynthetic-test-only\n%%EOF\n');

async function runWorker({
  driverJobs = [], companyJobs = [], driverSnapshot = secureSnapshot,
  companySnapshot = { ...secureSnapshot, driver_phone: null, bank_name: 'Synthetic Bank',
    account_name: 'Synthetic Account', account_number: '1234567890' },
  failSecureStorage = false, failCompanyStorage = false, conflictSecureStorage = false,
  staleDriverLease = false, staleCompanyLease = false, invalidDriverPath = false,
  driverClaimResponses = null, canaryInvoiceId = null, canaryDriverJobs = [], canaryCompanyJobs = [],
  canaryWrongInvoice = false, canaryWrongProject = false, canaryDriverPath = null,
  canaryCompanyPath = null, missingDriverSnapshot = false, missingCompanySnapshot = false,
  mismatchedExistingPdf = false,
} = {}) {
  const calls = [];
  const rendered = { driver: [], company: [] };
  const claimAttempts = { driver: 0, company: 0 };
  const uploaded = new Map();
  const selectedConfig = canaryWrongProject ? config : canaryConfig;
  const http = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const name = url.pathname.split('/').pop();
      const body = JSON.parse(String(init.body ?? '{}'));
      calls.push({ name, body, method, headers });
      if (name === 'claim_driver_waybill_pdf_jobs') {
        const attempt = claimAttempts.driver++;
        const scriptedResponse = driverClaimResponses?.[attempt];
        if (scriptedResponse?.networkFailure) throw new TypeError('synthetic network timeout');
        if (scriptedResponse) return json(scriptedResponse.body, scriptedResponse.status);
        return json(invalidDriverPath ? [{ ...driverJob, storage_path: 'other/unsafe.pdf' }] : driverJobs);
      }
      if (name === 'claim_company_waybill_pdf_jobs') {
        claimAttempts.company++;
        return json(companyJobs);
      }
      if (name === 'claim_waybill_synthetic_canary_pdf_jobs') {
        const jobs = body.p_copy_kind === 'driver' ? canaryDriverJobs : canaryCompanyJobs;
        const altered = canaryWrongInvoice ? jobs.map(job => ({ ...job, invoice_id: driverJob.invoice_id,
          invoice_number: driverJob.invoice_number })) : jobs;
        const selectedCanaryPath = body.p_copy_kind === 'driver' ? canaryDriverPath : canaryCompanyPath;
        const withPath = selectedCanaryPath
          ? altered.map(job => ({ ...job, storage_path: selectedCanaryPath })) : altered;
        return json(withPath);
      }
      if (name === 'get_driver_waybill_pdf_snapshot') {
        if (missingDriverSnapshot) return json(null);
        return json({ ...driverSnapshot, driver_phone: 'MUST_NOT_REACH_DRIVER_RENDERER',
          bank_name: 'MUST_NOT_REACH_DRIVER_RENDERER', account_name: 'MUST_NOT_REACH_DRIVER_RENDERER',
          account_number: '1111111111' });
      }
      if (name === 'get_company_waybill_pdf_snapshot') return json(missingCompanySnapshot ? null : companySnapshot);
      if (name === 'finish_driver_waybill_pdf_job') return json(!staleDriverLease);
      if (name === 'finish_company_waybill_pdf_job') return json(!staleCompanyLease);
      throw new Error(`Unexpected RPC ${name}`);
    }
    calls.push({ name: 'storage', url: url.toString(), method, headers });
    if (failSecureStorage && url.pathname.includes('/waybill-driver-copies/')) return new Response('private failure', { status: 503 });
    if (failCompanyStorage && url.pathname.includes('/waybill-company-copies/')) return new Response('private failure', { status: 503 });
    if (conflictSecureStorage && method === 'POST' && url.pathname.includes('/waybill-driver-copies/')) {
      return new Response('already exists', { status: 409 });
    }
    if (method === 'POST') {
      if (conflictSecureStorage && url.pathname.includes('/waybill-driver-copies/')) {
        uploaded.set(url.pathname, pdfBytes);
        return new Response('already exists', { status: 409 });
      }
      uploaded.set(url.pathname, new Uint8Array(init.body));
      return new Response(null, { status: 201 });
    }
    if (method === 'GET') {
      const bytes = mismatchedExistingPdf
        ? new TextEncoder().encode('%PDF-1.7\nwrong-synthetic-object\n%%EOF\n')
        : uploaded.get(url.pathname) ?? pdfBytes;
      return new Response(bytes, { status: 200, headers: { 'content-type': 'application/pdf' } });
    }
    return new Response(null, { status: 405 });
  };
  let counts;
  try {
    counts = await processWaybillPdfs(selectedConfig, {
      driver: async snapshot => { rendered.driver.push(snapshot); return pdfBytes; },
      company: async snapshot => { rendered.company.push(snapshot); return pdfBytes; },
    }, 2, http, canaryInvoiceId ? { syntheticCanaryInvoiceId: canaryInvoiceId } : {});
  } catch (error) {
    if (!canaryWrongProject) throw error;
    return { counts: null, calls, rendered, claimAttempts, error };
  }
  return { counts, calls, rendered, claimAttempts };
}

const privateErrorSentinel = 'AUTH_RESPONSE_BODY_MUST_NOT_LEAK';
const recoveredPgrst303 = await runWorker({
  driverClaimResponses: [
    { status: 401, body: { code: 'PGRST303', message: privateErrorSentinel } },
    { status: 200, body: [driverJob] },
  ],
});
assert.equal(recoveredPgrst303.counts.driver_claimed, 1);
assert.equal(recoveredPgrst303.counts.ready, 1);
assert.equal(recoveredPgrst303.counts.claim_errors, 0);
assert.equal(recoveredPgrst303.claimAttempts.driver, 2);
assert.equal(recoveredPgrst303.calls.filter(call => call.name === 'get_driver_waybill_pdf_snapshot').length, 1);
assert.equal(recoveredPgrst303.calls.filter(call => call.name === 'finish_driver_waybill_pdf_job').length, 1);
assert.equal(recoveredPgrst303.calls.filter(call => call.name === 'storage' && call.method === 'POST').length, 1);
assert.equal(recoveredPgrst303.calls.some(call => call.url?.includes('api.resend.com')), false);
assert.equal(recoveredPgrst303.calls.some(call => ['enqueue_waybill_ready_notifications',
  'claim_waybill_notifications', 'get_waybill_notification_pdf'].includes(call.name)), false);
assert.equal(JSON.stringify(recoveredPgrst303.counts).includes(privateErrorSentinel), false);
console.log('PASS exact PGRST303 claim failure retries once, processes one lease once, and never invokes email delivery');

const exhaustedPgrst303 = await runWorker({
  driverClaimResponses: Array.from({ length: 3 }, () => ({
    status: 401, body: { code: 'PGRST303', message: privateErrorSentinel },
  })),
});
assert.equal(exhaustedPgrst303.claimAttempts.driver, 3);
assert.equal(exhaustedPgrst303.counts.claim_errors, 1);
assert.equal(exhaustedPgrst303.counts.claimed, 0);
assert.equal(exhaustedPgrst303.calls.some(call => call.name === 'get_driver_waybill_pdf_snapshot'), false);
assert.equal(exhaustedPgrst303.calls.some(call => call.name === 'storage'), false);
console.log('PASS PGRST303 retry stops after three total attempts and reports one final claim error');

const ordinary401 = await runWorker({
  driverClaimResponses: [{ status: 401, body: { code: 'PGRST301', message: privateErrorSentinel } }],
});
assert.equal(ordinary401.claimAttempts.driver, 1);
assert.equal(ordinary401.counts.claim_errors, 1);
console.log('PASS ordinary 401 is not retried');

const forbiddenPgrst303 = await runWorker({
  driverClaimResponses: [{ status: 403, body: { code: 'PGRST303', message: privateErrorSentinel } }],
});
assert.equal(forbiddenPgrst303.claimAttempts.driver, 1);
assert.equal(forbiddenPgrst303.counts.claim_errors, 1);
console.log('PASS PGRST303 on a non-401 response is not retried');

const networkFailure = await runWorker({ driverClaimResponses: [{ networkFailure: true }] });
assert.equal(networkFailure.claimAttempts.driver, 1);
assert.equal(networkFailure.counts.claim_errors, 1);
console.log('PASS network failure is not retried');

assert(!workerSource.includes('api.resend.com'));
assert(!workerSource.includes('enqueue_waybill_ready_notifications'));
assert(!workerSource.includes('claim_waybill_notifications'));
console.log('PASS PDF worker implementation contains no email provider or notification RPC calls');

const secureSuccess = await runWorker({ driverJobs: [driverJob], companyJobs: [companyJob] });
assert.deepEqual(secureSuccess.counts, {
  claimed: 2, ready: 2, deferred: 0, unacknowledged: 0,
  driver_claimed: 1, company_claimed: 1, claim_errors: 0,
});
assert.equal(secureSuccess.rendered.driver.length, 1);
assert.equal('driver_phone' in secureSuccess.rendered.driver[0], false);
assert.equal('bank_name' in secureSuccess.rendered.driver[0], false);
assert.equal('account_number' in secureSuccess.rendered.driver[0], false);
assert.equal(secureSuccess.rendered.company[0].account_number, '1234567890');
assert.equal(secureSuccess.rendered.company[0].bank_name, 'Synthetic Bank');
assert.equal(secureSuccess.calls.some(call => call.name === 'get_waybill_pdf_snapshot'), false);
assert.equal(secureSuccess.calls.some(call => call.name === 'claim_waybill_pdf_jobs'), false);
assert.equal(secureSuccess.calls.some(call => call.name === 'finish_waybill_pdf_job'), false);
assert(secureSuccess.calls.some(call => call.name === 'get_driver_waybill_pdf_snapshot'
  && call.body.p_copy_id === driverJob.copy_id && call.body.p_lease_token === driverJob.lease_token));
assert(secureSuccess.calls.some(call => call.name === 'get_company_waybill_pdf_snapshot'
  && call.body.p_copy_id === companyJob.copy_id && call.body.p_lease_token === companyJob.lease_token));
const secureUploads = secureSuccess.calls.filter(call => call.name === 'storage');
assert.equal(secureUploads.filter(call => call.method === 'POST').length, 2);
assert.equal(secureUploads.filter(call => call.method === 'GET').length, 2);
const secureUploadPosts = secureUploads.filter(call => call.method === 'POST');
assert(secureUploadPosts.every(call => call.headers.get('x-upsert') === 'false'));
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
assert.deepEqual(invalidCompany.calls.filter(call => call.name === 'storage')
  .map(call => [call.method, new URL(call.url).pathname.includes('/waybill-driver-copies/')]),
[['POST', true], ['GET', true]]);
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
assert.deepEqual(conflictStorage.map(call => call.method), ['POST', 'GET']);
assert.equal(conflictStorage[0].headers.get('x-upsert'), 'false');
assert.equal(conflict.counts.ready, 1);
console.log('PASS secure object conflicts confirm an existing PDF and never overwrite it');

const mismatchedConflict = await runWorker({ driverJobs: [driverJob], conflictSecureStorage: true,
  mismatchedExistingPdf: true });
assert.equal(mismatchedConflict.counts.deferred, 1);
assert.equal(mismatchedConflict.counts.ready, 0);
assert(mismatchedConflict.calls.some(call => call.name === 'finish_driver_waybill_pdf_job'
  && call.body.p_failure_code === 'storage_upload_failed'));
console.log('PASS a conflicting but different PDF object is not marked ready');

const unsafePath = await runWorker({ driverJobs: [driverJob], invalidDriverPath: true });
assert.equal(unsafePath.rendered.driver.length, 0);
assert.equal(unsafePath.calls.some(call => call.name === 'get_driver_waybill_pdf_snapshot'), false);
assert(unsafePath.calls.some(call => call.name === 'finish_driver_waybill_pdf_job'
  && call.body.p_failure_code === 'invalid_snapshot'));
console.log('PASS unsafe bucket paths are rejected before snapshot access or Storage upload');

const canaryInvoiceId = '99999999-9999-4999-8999-999999999999';
const canaryDriverJob = { ...driverJob, invoice_id: canaryInvoiceId,
  invoice_number: 'WB-9999-999999', storage_path: '9999/WB-9999-999999.pdf' };
const canaryCompanyJob = { ...companyJob, invoice_id: canaryInvoiceId,
  invoice_number: 'WB-9999-999999', storage_path: '9999/WB-9999-999999-company-v2.pdf' };
const scopedCanary = await runWorker({ canaryInvoiceId, canaryDriverJobs: [canaryDriverJob],
  canaryCompanyJobs: [canaryCompanyJob],
  driverSnapshot: { ...secureSnapshot, invoice_number: 'WB-9999-999999' },
  companySnapshot: { ...secureSnapshot, invoice_number: 'WB-9999-999999', driver_phone: null,
    bank_name: 'Synthetic Bank', account_name: 'Synthetic Account', account_number: '1234567890' } });
assert.equal(scopedCanary.counts.ready, 2);
assert.equal(scopedCanary.claimAttempts.driver, 0);
assert.equal(scopedCanary.calls.filter(call => call.name === 'claim_waybill_synthetic_canary_pdf_jobs').length, 2);
assert(scopedCanary.calls.filter(call => call.name === 'claim_waybill_synthetic_canary_pdf_jobs')
  .every(call => call.body.p_invoice_id === canaryInvoiceId));
assert.equal(scopedCanary.calls.some(call => call.name === 'claim_driver_waybill_pdf_jobs'
  || call.name === 'claim_company_waybill_pdf_jobs'), false);
assert.equal(scopedCanary.calls.filter(call => call.name === 'storage' && call.method === 'POST').length, 2);
console.log('PASS canary mode claims only the explicitly selected synthetic invoice and verifies uploaded PDF bytes');

const wrongCanaryInvoice = await runWorker({ canaryInvoiceId, canaryDriverJobs: [canaryDriverJob],
  canaryCompanyJobs: [], canaryWrongInvoice: true });
assert.equal(wrongCanaryInvoice.counts.unacknowledged, 1);
assert.equal(wrongCanaryInvoice.calls.some(call => call.name === 'get_driver_waybill_pdf_snapshot'
  || call.name === 'finish_driver_waybill_pdf_job' || call.name === 'storage'), false);
console.log('PASS canary worker rejects an unrelated claimed invoice without snapshot, upload, or acknowledgement');

const wrongCanaryPath = await runWorker({ canaryInvoiceId, canaryDriverJobs: [canaryDriverJob],
  canaryCompanyJobs: [], canaryDriverPath: '2026/unrelated.pdf' });
assert.equal(wrongCanaryPath.calls.some(call => call.name === 'get_driver_waybill_pdf_snapshot'
  || call.name === 'storage'), false);
assert.equal(wrongCanaryPath.calls.some(call => call.name === 'finish_driver_waybill_pdf_job'
  && call.body.p_failure_code === 'invalid_snapshot'), true);
console.log('PASS canary worker rejects an unexpected storage path before touching Storage');

const wrongCanaryCompanyPath = await runWorker({ canaryInvoiceId, canaryDriverJobs: [],
  canaryCompanyJobs: [canaryCompanyJob], canaryCompanyPath: '9999/unrelated-company.pdf' });
assert.equal(wrongCanaryCompanyPath.calls.some(call => call.name === 'get_company_waybill_pdf_snapshot'
  || call.name === 'storage'), false);
assert(wrongCanaryCompanyPath.calls.some(call => call.name === 'finish_company_waybill_pdf_job'
  && call.body.p_failure_code === 'invalid_snapshot'));
console.log('PASS canary worker rejects an unexpected Company storage path before snapshot access or Storage');

const unrelatedCanaryResult = await runWorker({ canaryInvoiceId, canaryDriverJobs: [driverJob], canaryCompanyJobs: [] });
assert.equal(unrelatedCanaryResult.counts.unacknowledged, 1);
assert.equal(unrelatedCanaryResult.calls.some(call => call.name === 'storage'
  || call.name === 'finish_driver_waybill_pdf_job'), false);
console.log('PASS unrelated claim results remain untouched in canary mode');

const failedCanaryUpload = await runWorker({ canaryInvoiceId, canaryDriverJobs: [canaryDriverJob],
  canaryCompanyJobs: [], failSecureStorage: true,
  driverSnapshot: { ...secureSnapshot, invoice_number: 'WB-9999-999999' } });
assert.equal(failedCanaryUpload.counts.deferred, 1);
assert(failedCanaryUpload.calls.some(call => call.name === 'finish_driver_waybill_pdf_job'
  && call.body.p_failure_code === 'storage_upload_failed'));
console.log('PASS canary upload failures retain retryable lease handling');

const missingCanarySnapshot = await runWorker({ canaryInvoiceId, canaryDriverJobs: [canaryDriverJob],
  canaryCompanyJobs: [], missingDriverSnapshot: true });
assert.equal(missingCanarySnapshot.counts.deferred, 1);
assert.equal(missingCanarySnapshot.calls.some(call => call.name === 'storage'), false);
assert(missingCanarySnapshot.calls.some(call => call.name === 'finish_driver_waybill_pdf_job'
  && call.body.p_failure_code === 'snapshot_unavailable' && call.body.p_succeeded === false));
console.log('PASS missing canary PDF snapshots remain retryable and never reach Storage');

const missingCanaryCompanySnapshot = await runWorker({ canaryInvoiceId, canaryDriverJobs: [],
  canaryCompanyJobs: [canaryCompanyJob], missingCompanySnapshot: true });
assert.equal(missingCanaryCompanySnapshot.counts.deferred, 1);
assert.equal(missingCanaryCompanySnapshot.calls.some(call => call.name === 'storage'), false);
assert(missingCanaryCompanySnapshot.calls.some(call => call.name === 'finish_company_waybill_pdf_job'
  && call.body.p_failure_code === 'snapshot_unavailable' && call.body.p_succeeded === false));
console.log('PASS a missing canary Company snapshot remains retryable and never reaches Storage');

const incompleteCanaryAck = await runWorker({ canaryInvoiceId, canaryDriverJobs: [canaryDriverJob],
  canaryCompanyJobs: [], staleDriverLease: true,
  driverSnapshot: { ...secureSnapshot, invoice_number: 'WB-9999-999999' } });
assert.equal(incompleteCanaryAck.counts.unacknowledged, 1);
assert.equal(incompleteCanaryAck.counts.ready, 0);
assert.equal(incompleteCanaryAck.calls.filter(call => call.name === 'finish_driver_waybill_pdf_job').length, 1);
console.log('PASS incomplete canary lease acknowledgement is not reported as ready');

const failedCanaryCompanyUpload = await runWorker({ canaryInvoiceId, canaryDriverJobs: [],
  canaryCompanyJobs: [canaryCompanyJob], failCompanyStorage: true,
  companySnapshot: { ...secureSnapshot, invoice_number: 'WB-9999-999999', driver_phone: null,
    bank_name: 'Synthetic Bank', account_name: 'Synthetic Account', account_number: '1234567890' } });
assert.equal(failedCanaryCompanyUpload.counts.deferred, 1);
assert(failedCanaryCompanyUpload.calls.some(call => call.name === 'finish_company_waybill_pdf_job'
  && call.body.p_failure_code === 'storage_upload_failed'));
console.log('PASS canary Company upload failure retains retryable lease handling');

const incompleteCanaryCompanyAck = await runWorker({ canaryInvoiceId, canaryDriverJobs: [],
  canaryCompanyJobs: [canaryCompanyJob], staleCompanyLease: true,
  companySnapshot: { ...secureSnapshot, invoice_number: 'WB-9999-999999', driver_phone: null,
    bank_name: 'Synthetic Bank', account_name: 'Synthetic Account', account_number: '1234567890' } });
assert.equal(incompleteCanaryCompanyAck.counts.unacknowledged, 1);
assert.equal(incompleteCanaryCompanyAck.counts.ready, 0);
assert.equal(incompleteCanaryCompanyAck.calls.filter(call => call.name === 'finish_company_waybill_pdf_job').length, 1);
console.log('PASS incomplete canary Company lease acknowledgement is not reported as ready');

const wrongCanaryProject = await runWorker({ canaryInvoiceId, canaryDriverJobs: [canaryDriverJob],
  canaryCompanyJobs: [], canaryWrongProject: true });
assert.equal(wrongCanaryProject.calls.some(call => call.name === 'claim_waybill_synthetic_canary_pdf_jobs'), false);
assert.equal(wrongCanaryProject.calls.length, 0);
console.log('PASS canary mode refuses an unapproved Supabase project before database or Storage requests');

const legacyPreserved = await runWorker({ driverJobs: [driverJob] });
assert.equal(legacyPreserved.counts.driver_claimed, 1);
assert.equal(legacyPreserved.rendered.driver.length, 1);
assert.equal(legacyPreserved.calls.some(call => ['claim_waybill_pdf_jobs', 'get_waybill_pdf_snapshot',
  'finish_waybill_pdf_job'].includes(call.name)), false);
assert.equal(legacyPreserved.calls.some(call => call.name === 'storage' && call.url.includes('/waybills/2026/')), false);
for (const retiredRpc of ['claim_waybill_pdf_jobs', 'get_waybill_pdf_snapshot', 'finish_waybill_pdf_job']) {
  assert(!workerSource.includes(retiredRpc), `worker source must not invoke retired RPC ${retiredRpc}`);
}
for (const signature of [
  'public.claim_driver_waybill_pdf_jobs(integer,uuid)',
  'public.claim_company_waybill_pdf_jobs(integer,uuid)',
  'public.get_driver_waybill_pdf_snapshot(uuid,uuid)',
  'public.get_company_waybill_pdf_snapshot(uuid,uuid)',
  'public.finish_driver_waybill_pdf_job(uuid,uuid,boolean,text)',
  'public.finish_company_waybill_pdf_job(uuid,uuid,boolean,text)',
]) {
  assert(pdfMigration.includes(`revoke all on function ${signature} from public,anon,authenticated,service_role`));
  assert(pdfMigration.includes(`grant execute on function ${signature} to service_role`));
}
assert(pdfMigration.includes("to_regprocedure('public.claim_waybill_pdf_jobs(integer)')"));
assert(pdfMigration.includes("execute format('revoke all on function %s from public,anon,authenticated,service_role',v_function)"));
console.log('PASS legacy PDF queue is not claimed, rewritten, uploaded, or acknowledged while secure copies process');

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
