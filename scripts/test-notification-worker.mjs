// Mocked HTTP only: no email or remote database requests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync('supabase/functions/process-trip-notifications/worker.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { isDevelopmentProjectUrl, processNotifications } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
const config = {
  supabaseUrl: 'https://database.invalid', serviceRoleKey: 'test-only', resendApiKey: 'test-only',
  sender: 'sender@example.invalid', financeRecipients: ['finance@example.invalid'],
  waybillInternalRecipients: ['ops@example.invalid', 'finance@example.invalid'],
  recipientSinkEnabled: false,
};
const tripJob = {
  id: 'job-1', event_type: 'trip_closed', lease_token: 'lease-1',
  email_request: { to: ['driver@example.invalid'], cc: ['ops@example.invalid'], bcc: ['audit@example.invalid'], text: 'Snapshot' }, payload: {},
};
const waybillJob = {
  id: 'waybill-job-1', event_type: 'waybill_ready', lease_token: 'waybill-lease-1',
  email_request: {
    to: ['driver@example.invalid', 'driver-copy@example.invalid'],
    cc: ['ops@example.invalid'], bcc: ['finance@example.invalid'],
    subject: 'Waybill INV-2026-000001', text: 'PDF attached',
  },
  payload: {
    invoice_id: '11111111-1111-1111-1111-111111111111',
    invoice_number: 'INV-2026-000001',
    trip_number: 'TRIP-000001',
    storage_path: '2026/INV-2026-000001.pdf',
  },
};
const pdf = new TextEncoder().encode('%PDF-1.7\nwaybill-test');
const pdfMetadata = [{
  invoice_id: waybillJob.payload.invoice_id,
  invoice_number: waybillJob.payload.invoice_number,
  storage_path: waybillJob.payload.storage_path,
}];
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const parseBody = options => typeof options.body === 'string' ? JSON.parse(options.body) : options.body;

assert.equal(isDevelopmentProjectUrl('https://pidxlopbxlapfmakmtjt.supabase.co'), true);
assert.equal(isDevelopmentProjectUrl('https://pidxlopbxlapfmakmtjt.supabase.co/'), true);
for (const url of [
  'https://other-project.supabase.co',
  'http://pidxlopbxlapfmakmtjt.supabase.co',
  'https://pidxlopbxlapfmakmtjt.supabase.co.evil.invalid',
  'https://user@pidxlopbxlapfmakmtjt.supabase.co',
  'https://pidxlopbxlapfmakmtjt.supabase.co/path',
]) assert.equal(isDevelopmentProjectUrl(url), false);

for (const scenario of ['success', 'provider_failure', 'timeout', 'ack_failure', 'lost_lease', 'invalid_provider_response']) {
  const calls = [];
  const mock = async (url, options) => {
    calls.push({ url, options, body: parseBody(options) });
    if (url.endsWith('enqueue_waybill_ready_notifications')) return json(0);
    if (url.endsWith('claim_trip_notifications')) return json([tripJob]);
    if (url === 'https://api.resend.com/emails') {
      if (scenario === 'timeout') throw new Error('Timeout');
      if (scenario === 'invalid_provider_response') return json({});
      return scenario === 'provider_failure' ? json({}, 503) : json({ id: 'provider-1' });
    }
    if (scenario === 'ack_failure') return json({}, 503);
    return json(scenario !== 'lost_lease');
  };
  const result = await processNotifications(config, 5, mock);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].body.p_internal_recipients.length, 2);
  assert.equal(calls[1].body.p_include_waybill_ready, true);
  assert.deepEqual(calls[1].body.p_waybill_internal_recipients, config.waybillInternalRecipients);
  assert.equal(calls[2].url, 'https://api.resend.com/emails');
  assert.equal(calls[2].options.headers['Idempotency-Key'], 'trip-notification/job-1');
  assert.deepEqual(calls[2].body, tripJob.email_request);
  assert.equal(calls[3].body.p_lease_token, 'lease-1');
  assert.equal(result.sent, scenario === 'success' ? 1 : 0);
  assert.equal(result.deferred, ['provider_failure', 'timeout', 'invalid_provider_response'].includes(scenario) ? 1 : 0);
  assert.equal(result.unacknowledged, ['ack_failure', 'lost_lease'].includes(scenario) ? 1 : 0);
  assert.equal(result.reconciliationFailed, false);
  assert(!calls.some(call => call.url.includes('close_trip') || call.url.includes('finish_waybill_pdf')));
  console.log(`PASS existing trip_closed ${scenario}`);
}

const waybillRequests = [];
for (let retry = 0; retry < 2; retry++) {
  const calls = [];
  const mock = async (url, options) => {
    const body = parseBody(options);
    calls.push({ url, options, body });
    if (url.endsWith('enqueue_waybill_ready_notifications')) return json(retry === 0 ? 2 : 0);
    if (url.endsWith('claim_trip_notifications')) return json([waybillJob]);
    if (url.endsWith('get_waybill_ready_pdf')) return json(pdfMetadata);
    if (url.includes('/storage/v1/object/')) return new Response(pdf, { headers: { 'content-type': 'application/pdf' } });
    if (url === 'https://api.resend.com/emails') {
      waybillRequests.push({ idempotency: options.headers['Idempotency-Key'], body });
      return json({ id: 'provider-waybill-1' });
    }
    if (url.endsWith('finish_trip_notification')) return json(true);
    throw new Error(`Unexpected mocked request ${url}`);
  };
  const result = await processNotifications(config, 5, mock);
  const storageCall = calls.find(call => call.url.includes('/storage/v1/object/'));
  assert.equal(storageCall.url, 'https://database.invalid/storage/v1/object/authenticated/waybills/2026/INV-2026-000001.pdf');
  assert.equal(storageCall.options.method, 'GET');
  assert.equal(storageCall.options.headers.Authorization, 'Bearer test-only');
  assert(!calls.some(call => call.url.includes('/object/public/') || call.url.includes('/sign/')));
  assert.equal(result.sent, 1);
  assert.equal(result.deferred, 0);
  assert.equal(result.unacknowledged, 0);
  assert.equal(calls.find(call => call.url.endsWith('finish_trip_notification')).body.p_sent, true);
  console.log(`PASS Waybill attachment retry ${retry + 1}`);
}
assert.equal(waybillRequests.length, 2);
assert.deepEqual(waybillRequests.map(request => request.idempotency), [
  'trip-notification/waybill-job-1', 'trip-notification/waybill-job-1',
]);
assert.deepEqual(waybillRequests[0].body, waybillRequests[1].body);
assert.equal(waybillRequests[0].body.attachments[0].filename, 'INV-2026-000001.pdf');
assert.deepEqual(Buffer.from(waybillRequests[0].body.attachments[0].content, 'base64'), Buffer.from(pdf));
assert.equal(waybillRequests[0].body.attachments.length, 1);
console.log('PASS Waybill reuses invoice, PDF, filename, and outbox idempotency key');

const resendJob = { ...waybillJob, id: 'waybill-resend-1', lease_token: 'resend-lease-1' };
const resendCalls = [];
const resendResult = await processNotifications(config, 1, async (url, options) => {
  resendCalls.push({ url, options, body: parseBody(options) });
  if (url.endsWith('enqueue_waybill_ready_notifications')) return json(0);
  if (url.endsWith('claim_trip_notifications')) return json([resendJob]);
  if (url.endsWith('get_waybill_ready_pdf')) return json(pdfMetadata);
  if (url.includes('/storage/v1/object/')) return new Response(pdf, { headers: { 'content-type': 'application/pdf' } });
  if (url === 'https://api.resend.com/emails') return json({ id: 'provider-resend-1' });
  if (url.endsWith('finish_trip_notification')) return json(true);
  throw new Error(`Unexpected mocked request ${url}`);
});
assert.equal(resendResult.sent, 1);
assert.equal(resendCalls.find(call => call.url === 'https://api.resend.com/emails').options.headers['Idempotency-Key'],
  'trip-notification/waybill-resend-1');
assert.equal(resendCalls.find(call => call.url.endsWith('get_waybill_ready_pdf')).body.p_notification_id, resendJob.id);
assert(!resendCalls.some(call => call.url.includes('process-waybill-pdfs') || call.url.includes('close_trip')));
console.log('PASS explicit resend reuses the same PDF with a distinct outbox/provider idempotency identity');

for (const scenario of ['mismatched_path', 'download_failure', 'invalid_pdf']) {
  const calls = [];
  const mock = async (url, options) => {
    const body = parseBody(options);
    calls.push({ url, options, body });
    if (url.endsWith('enqueue_waybill_ready_notifications')) return json(0);
    if (url.endsWith('claim_trip_notifications')) return json([waybillJob]);
    if (url.endsWith('get_waybill_ready_pdf')) {
      return json([scenario === 'mismatched_path' ? { ...pdfMetadata[0], storage_path: '2026/INV-2026-999999.pdf' } : pdfMetadata[0]]);
    }
    if (url.includes('/storage/v1/object/')) {
      return scenario === 'download_failure' ? json({}, 503)
        : new Response(new TextEncoder().encode('not a PDF'), { headers: { 'content-type': 'application/pdf' } });
    }
    if (url === 'https://api.resend.com/emails') return json({ id: 'should-not-send' });
    if (url.endsWith('finish_trip_notification')) return json(true);
    throw new Error(`Unexpected mocked request ${url}`);
  };
  const result = await processNotifications(config, 5, mock);
  assert.equal(result.deferred, 1);
  assert(!calls.some(call => call.url === 'https://api.resend.com/emails'));
  const finish = calls.find(call => call.url.endsWith('finish_trip_notification'));
  assert.equal(finish.body.p_sent, false);
  assert.equal(finish.body.p_error, 'Waybill PDF attachment unavailable');
  assert(!JSON.stringify(finish.body).match(/bank|019876|secret|pdf-1\.7/i));
  assert(!calls.some(call => call.url.includes('finish_waybill_pdf') || call.url.includes('trip_closure_invoices')));
  console.log(`PASS Waybill safe failure ${scenario}`);
}

const reconciliationCalls = [];
const afterReconciliationFailure = await processNotifications(config, 5, async (url, options) => {
  const body = parseBody(options);
  reconciliationCalls.push({ url, body });
  if (url.endsWith('enqueue_waybill_ready_notifications')) return json({}, 503);
  if (url.endsWith('claim_trip_notifications')) return json([tripJob]);
  if (url === 'https://api.resend.com/emails') return json({ id: 'provider-1' });
  return json(true);
});
assert.equal(afterReconciliationFailure.sent, 1);
assert.equal(afterReconciliationFailure.reconciliationFailed, true);
assert(reconciliationCalls.some(call => call.url.endsWith('claim_trip_notifications')));
console.log('PASS reconciliation failure does not block existing trip_closed delivery');

const sinkConfig = {
  ...config,
  supabaseUrl: 'https://pidxlopbxlapfmakmtjt.supabase.co',
  recipientSinkEnabled: true,
};
const sinkCalls = [];
const sinkResult = await processNotifications(sinkConfig, 5, async (url, options) => {
  const body = parseBody(options);
  sinkCalls.push({ url, body });
  if (url.endsWith('enqueue_waybill_ready_notifications')) return json(0);
  if (url.endsWith('claim_trip_notifications')) return json([tripJob, waybillJob]);
  if (url.endsWith('get_waybill_ready_pdf')) return json(pdfMetadata);
  if (url.includes('/storage/v1/object/')) return new Response(pdf, { headers: { 'content-type': 'application/pdf' } });
  if (url === 'https://api.resend.com/emails') return json({ id: 'sink-test-provider-id' });
  if (url.endsWith('finish_trip_notification')) return json(true);
  throw new Error(`Unexpected mocked request ${url}`);
});
const sinkMessages = sinkCalls.filter(call => call.url === 'https://api.resend.com/emails');
assert.equal(sinkResult.sent, 2);
assert.equal(sinkMessages.length, 2);
for (const message of sinkMessages) {
  assert.deepEqual(message.body.to, ['tektwig@gmail.com']);
  assert(!Object.keys(message.body).some(key => ['cc', 'bcc'].includes(key.toLowerCase())));
  assert(!JSON.stringify(message.body).match(/driver@example\.invalid|driver-copy@example\.invalid|ops@example\.invalid|finance@example\.invalid|audit@example\.invalid/i));
}
console.log('PASS recipient sink routes trip_closed and waybill_ready only to tektwig@gmail.com');

const blockedProjectCalls = [];
await assert.rejects(() => processNotifications({ ...sinkConfig, supabaseUrl: 'https://other-project.supabase.co' }, 5, async (...args) => {
  blockedProjectCalls.push(args);
  return json([]);
}));
assert.equal(blockedProjectCalls.length, 0);
console.log('PASS recipient sink rejects non-DEVELOPMENT project before queue RPCs');

assert.deepEqual(await processNotifications(config, 5, async () => json([])), {
  claimed: 0, sent: 0, deferred: 0, unacknowledged: 0, reconciliationFailed: false,
});
console.log('PASS empty queue');
await assert.rejects(() => processNotifications(config, 5, async () => json({}, 503)));
console.log('PASS claim failure');

const singleClaimRequest = [];
const singleClaimResult = await processNotifications(config, 1, async (url, options) => {
  const body = parseBody(options);
  singleClaimRequest.push({ url, body });
  if (url.endsWith('enqueue_waybill_ready_notifications')) return json(0);
  if (url.endsWith('claim_trip_notifications')) return json([]);
  throw new Error(`Unexpected request ${url}`);
});
assert.deepEqual(singleClaimRequest.find(call => call.url.endsWith('claim_trip_notifications')).body, {
  p_finance_recipients: config.financeRecipients,
  p_sender: config.sender,
  p_limit: 1,
  p_include_waybill_ready: true,
  p_waybill_internal_recipients: config.waybillInternalRecipients,
});
assert.deepEqual(singleClaimResult, { claimed: 0, sent: 0, deferred: 0, unacknowledged: 0, reconciliationFailed: false });
console.log('PASS limit one reaches notification claim RPC as p_limit: 1');
