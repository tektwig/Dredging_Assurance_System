import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const workerSource = readFileSync('supabase/functions/process-trip-notifications/worker.ts', 'utf8');
const compiled = ts.transpileModule(workerSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { isDevelopmentProjectUrl, processNotifications } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`
);

const config = {
  supabaseUrl: 'https://worker-test.example.invalid',
  serviceRoleKey: 'server-only-test-key',
  resendApiKey: 'server-only-provider-key',
  sender: 'TRAKFLIT <notifications@example.invalid>',
  waybillClientEmail: 'client@example.invalid',
  recipientSinkEnabled: false,
  deliveryEnabled: true,
};
const driverJob = {
  id: '11111111-1111-4111-8111-111111111111',
  event_type: 'waybill_ready',
  audience: 'driver',
  status: 'processing',
  recipients: ['driver@example.invalid'],
  lease_token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  lease_until: new Date(Date.now() + 5 * 60_000).toISOString(),
  payload: {
    invoice_id: '22222222-2222-4222-8222-222222222222',
    invoice_number: 'INV-2026-000001',
    trip_number: 'TRIP-000001',
    bank_name: 'MUST_NOT_ENTER_EMAIL',
    account_number: 'MUST_NOT_ENTER_EMAIL',
  },
  email_request: { to: ['attacker@example.invalid'], text: 'MUST_NOT_BE_USED' },
};
const companyJob = {
  ...driverJob,
  id: '33333333-3333-4333-8333-333333333333',
  audience: 'client',
  recipients: ['client@example.invalid'],
  lease_token: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  lease_until: new Date(Date.now() + 5 * 60_000).toISOString(),
  payload: { ...driverJob.payload },
};
const driverPdfMetadata = {
  invoice_id: driverJob.payload.invoice_id,
  invoice_number: driverJob.payload.invoice_number,
  copy_kind: 'driver',
  storage_bucket: 'waybill-driver-copies',
  storage_path: '2026/INV-2026-000001.pdf',
};
const companyPdfMetadata = {
  ...driverPdfMetadata,
  copy_kind: 'company',
  storage_bucket: 'waybill-company-copies',
  storage_path: '2026/INV-2026-000001-company-v2.pdf',
};
const pdf = new TextEncoder().encode('%PDF-1.7 synthetic secure copy');
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const parseBody = options => typeof options.body === 'string' ? JSON.parse(options.body) : options.body;

function mockFetch({
  jobs = [],
  metadata = new Map(),
  pdfResponse = () => new Response(pdf, { headers: { 'content-type': 'application/pdf' } }),
  providerResponse = () => json({ id: 'resend-message-id' }),
  finishResponse = () => json(true),
} = {}) {
  const calls = [];
  const fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const body = options.body ? parseBody(options) : undefined;
    calls.push({ url: url.toString(), path: url.pathname, options, body });
    if (url.pathname.endsWith('/rpc/enqueue_waybill_ready_notifications')) return json(0);
    if (url.pathname.endsWith('/rpc/claim_waybill_notifications')) return json(jobs);
    if (url.pathname.endsWith('/rpc/get_waybill_notification_pdf')) {
      const row = metadata.get(body.p_notification_id);
      return json(row ? [row] : []);
    }
    if (url.pathname.endsWith('/rpc/finish_trip_notification')) return finishResponse(body);
    if (url.pathname.startsWith('/storage/v1/object/')) return pdfResponse(url, options);
    if (url.toString() === 'https://api.resend.com/emails') return providerResponse(body, options);
    throw new Error('Unexpected worker request');
  };
  return { fetch, calls };
}

assert.equal(isDevelopmentProjectUrl('https://pidxlopbxlapfmakmtjt.supabase.co'), true);
for (const url of [
  'http://pidxlopbxlapfmakmtjt.supabase.co',
  'https://other-project.supabase.co',
  'https://pidxlopbxlapfmakmtjt.supabase.co.evil.invalid',
  'https://user@pidxlopbxlapfmakmtjt.supabase.co',
  'https://pidxlopbxlapfmakmtjt.supabase.co/path',
]) assert.equal(isDevelopmentProjectUrl(url), false);

const disabled = mockFetch();
await assert.rejects(() => processNotifications({ ...config, deliveryEnabled: false }, 1, disabled.fetch), /disabled/);
assert.equal(disabled.calls.length, 0, 'delivery kill switch is checked before any claim or reconciliation');
console.log('PASS delivery kill switch prevents all queue activity until explicitly enabled');

const secureMock = mockFetch({
  jobs: [driverJob, companyJob],
  metadata: new Map([[driverJob.id, driverPdfMetadata], [companyJob.id, companyPdfMetadata]]),
});
const secureResult = await processNotifications(config, 2, secureMock.fetch);
assert.deepEqual(secureResult, {
  claimed: 2, sent: 2, deferred: 0, unacknowledged: 0,
  reconciliationFailed: false, targetCompanyConfigured: true,
});
const secureRpcCalls = secureMock.calls.filter(call => call.path.includes('/rpc/'));
assert.deepEqual(secureRpcCalls.slice(0, 2).map(call => call.path.split('/').at(-1)), [
  'enqueue_waybill_ready_notifications', 'claim_waybill_notifications',
]);
assert.equal(secureRpcCalls.filter(call => call.path.endsWith('/get_waybill_notification_pdf')).length, 2);
assert.equal(secureRpcCalls.filter(call => call.path.endsWith('/finish_trip_notification')).length, 2);
assert.deepEqual(secureRpcCalls[0].body, { p_company_recipient: 'client@example.invalid' });
assert.deepEqual(secureRpcCalls[1].body, { p_sender: config.sender, p_limit: 2 });
for (const job of [driverJob, companyJob]) {
  const attachmentMetadataCall = secureRpcCalls.find(call => call.path.endsWith('/get_waybill_notification_pdf')
    && call.body.p_notification_id === job.id);
  assert.deepEqual(attachmentMetadataCall.body, { p_notification_id: job.id, p_lease_token: job.lease_token });
}
const storageCalls = secureMock.calls.filter(call => call.path.startsWith('/storage/v1/object/'));
assert.equal(storageCalls.length, 2);
assert(storageCalls.some(call => call.path === '/storage/v1/object/waybill-driver-copies/2026/INV-2026-000001.pdf'));
assert(storageCalls.some(call => call.path === '/storage/v1/object/waybill-company-copies/2026/INV-2026-000001-company-v2.pdf'));
assert(storageCalls.every(call => call.options.method === 'GET'));
assert(storageCalls.every(call => call.options.headers.Authorization === `Bearer ${config.serviceRoleKey}`));
const providerCalls = secureMock.calls.filter(call => call.url === 'https://api.resend.com/emails');
assert.equal(providerCalls.length, 2);
const driverMessage = providerCalls.find(call => call.body.to[0] === 'driver@example.invalid');
const companyMessage = providerCalls.find(call => call.body.to[0] === 'client@example.invalid');
assert(driverMessage && companyMessage);
assert.deepEqual(driverMessage.body.attachments.map(file => file.filename), ['INV-2026-000001-driver.pdf']);
assert.deepEqual(companyMessage.body.attachments.map(file => file.filename), ['INV-2026-000001-company.pdf']);
for (const message of providerCalls) {
  assert.equal(message.body.attachments.length, 1);
  assert.equal(message.body.from, config.sender);
  assert(!JSON.stringify(message.body).includes('MUST_NOT_ENTER_EMAIL'));
  assert(!JSON.stringify(message.body).includes('MUST_NOT_BE_USED'));
  assert.equal(message.options.headers['Idempotency-Key'], `waybill-notification/${message.body.to[0] === 'driver@example.invalid' ? driverJob.id : companyJob.id}`);
}
assert(secureRpcCalls.filter(call => call.path.includes('/rpc/')).every(call =>
  !Object.keys(call.body ?? {}).some(key => /account|bank_name|account_name/i.test(key))));
assert.equal(secureMock.calls.some(call => /claim_trip_notifications|get_waybill_ready_pdf|claim_waybill_pdf_jobs/.test(call.path)), false);
assert(!workerSource.includes('console.log(') && !workerSource.includes('console.error('));
console.log('PASS driver/company recipients receive only their lease-authorized copy from the matching private bucket');

const noCompanyAddress = mockFetch({ jobs: [driverJob], metadata: new Map([[driverJob.id, driverPdfMetadata]]) });
await processNotifications({ ...config, waybillClientEmail: null }, 1, noCompanyAddress.fetch);
assert.deepEqual(noCompanyAddress.calls.find(call => call.path.endsWith('/enqueue_waybill_ready_notifications')).body,
  { p_company_recipient: null });
assert.equal(noCompanyAddress.calls.filter(call => call.url === 'https://api.resend.com/emails').length, 1);
console.log('PASS missing company recipient reconciles with null and does not block driver delivery');

const wrongRecipient = { ...companyJob, recipients: ['wrong@example.invalid'] };
const wrongRecipientMock = mockFetch({ jobs: [wrongRecipient] });
const wrongRecipientResult = await processNotifications(config, 1, wrongRecipientMock.fetch);
assert.equal(wrongRecipientResult.sent, 0);
assert.equal(wrongRecipientMock.calls.some(call => call.path.endsWith('/get_waybill_notification_pdf')), false);
assert.equal(wrongRecipientMock.calls.some(call => call.url === 'https://api.resend.com/emails'), false);
assert.equal(wrongRecipientMock.calls.find(call => call.path.endsWith('/finish_trip_notification')).body.p_sent, false);
console.log('PASS company recipient mismatch is acknowledged as failure without attachment access or send');

for (const metadata of [
  { ...companyPdfMetadata, copy_kind: 'driver' },
  { ...companyPdfMetadata, storage_bucket: 'waybill-driver-copies' },
  { ...companyPdfMetadata, storage_path: '2026/INV-2026-999999.pdf' },
  { ...companyPdfMetadata, invoice_id: '44444444-4444-4444-8444-444444444444' },
]) {
  const mismatch = mockFetch({ jobs: [companyJob], metadata: new Map([[companyJob.id, metadata]]) });
  const result = await processNotifications(config, 1, mismatch.fetch);
  assert.equal(result.deferred, 1);
  assert.equal(mismatch.calls.some(call => call.path.startsWith('/storage/v1/object/')), false);
  assert.equal(mismatch.calls.some(call => call.url === 'https://api.resend.com/emails'), false);
}
console.log('PASS wrong copy, bucket, path, or invoice metadata cannot be attached or delivered');

for (const badPdf of [
  () => new Response(pdf, { headers: { 'content-type': 'text/plain' } }),
  () => new Response(new TextEncoder().encode('not-pdf'), { headers: { 'content-type': 'application/pdf' } }),
  () => new Response(new Uint8Array(10), { headers: { 'content-type': 'application/pdf', 'content-length': String(11 * 1024 * 1024) } }),
]) {
  const invalidPdf = mockFetch({ jobs: [driverJob], metadata: new Map([[driverJob.id, driverPdfMetadata]]), pdfResponse: badPdf });
  const result = await processNotifications(config, 1, invalidPdf.fetch);
  assert.equal(result.deferred, 1);
  assert.equal(invalidPdf.calls.some(call => call.url === 'https://api.resend.com/emails'), false);
}
console.log('PASS missing, malformed, and oversized PDF attachments fail closed');

const missingBankBlocked = mockFetch({ jobs: [] });
const blockedResult = await processNotifications(config, 1, missingBankBlocked.fetch);
assert.equal(blockedResult.claimed, 0);
assert.equal(missingBankBlocked.calls.some(call => call.path.endsWith('/get_waybill_notification_pdf')), false);
assert.equal(missingBankBlocked.calls.some(call => call.url === 'https://api.resend.com/emails'), false);
console.log('PASS bank-held company copy remains unclaimed and cannot trigger delivery');

const unsupportedHistoryJob = { ...driverJob, event_type: 'trip_closed', audience: 'finance' };
const historicalQueueMock = mockFetch({ jobs: [unsupportedHistoryJob] });
const historicalResult = await processNotifications(config, 1, historicalQueueMock.fetch);
assert.equal(historicalResult.sent, 0);
assert.equal(historicalQueueMock.calls.some(call => call.path.endsWith('/get_waybill_notification_pdf')), false);
assert.equal(historicalQueueMock.calls.some(call => call.path.endsWith('/finish_trip_notification')), false);
assert.equal(historicalQueueMock.calls.some(call => call.url === 'https://api.resend.com/emails'), false);
console.log('PASS unexpected historical trip_closed row is not sent, acknowledged, or retired by worker');

const retryFirstJob = { ...driverJob, lease_token: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  lease_until: new Date(Date.now() + 5 * 60_000).toISOString() };
const retrySecondJob = { ...driverJob, lease_token: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  lease_until: new Date(Date.now() + 5 * 60_000).toISOString() };
const retryKeys = [];
const retryBodies = [];
const retryFailures = [];
const firstAttempt = mockFetch({
  jobs: [retryFirstJob], metadata: new Map([[driverJob.id, driverPdfMetadata]]),
  providerResponse: async (_body, options) => { retryKeys.push(options.headers['Idempotency-Key']); throw new Error('synthetic timeout'); },
  finishResponse: body => { retryFailures.push(body); return json(true); },
});
const firstRetry = await processNotifications(config, 1, firstAttempt.fetch);
assert.equal(firstRetry.deferred, 1);
assert.equal(retryFailures[0].p_sent, false);
assert.equal(retryFailures[0].p_error, 'Provider acceptance is uncertain');
const secondAttempt = mockFetch({
  jobs: [retrySecondJob], metadata: new Map([[driverJob.id, driverPdfMetadata]]),
  providerResponse: async (body, options) => {
    retryKeys.push(options.headers['Idempotency-Key']);
    retryBodies.push(body);
    return json({ id: 'resend-replayed-message' });
  },
});
const secondRetry = await processNotifications(config, 1, secondAttempt.fetch);
assert.equal(secondRetry.sent, 1);
assert.deepEqual(retryKeys, [`waybill-notification/${driverJob.id}`, `waybill-notification/${driverJob.id}`]);
assert.equal(retryBodies.length, 1);
console.log('PASS provider timeout retry uses the same notification idempotency key and a refreshed lease');

const ackFailure = mockFetch({
  jobs: [driverJob], metadata: new Map([[driverJob.id, driverPdfMetadata]]), finishResponse: () => json(false),
});
const ackFailureResult = await processNotifications(config, 1, ackFailure.fetch);
assert.equal(ackFailureResult.unacknowledged, 1);
assert.equal(ackFailureResult.sent, 0);
console.log('PASS failed lease acknowledgement remains unacknowledged for safe expiry/reclaim');

const recipientSinkMock = mockFetch({ jobs: [driverJob], metadata: new Map([[driverJob.id, driverPdfMetadata]]) });
const sinkResult = await processNotifications({
  ...config,
  supabaseUrl: 'https://pidxlopbxlapfmakmtjt.supabase.co',
  recipientSinkEnabled: true,
}, 1, recipientSinkMock.fetch);
const sinkMessage = recipientSinkMock.calls.find(call => call.url === 'https://api.resend.com/emails');
assert.equal(sinkResult.sent, 1);
assert.deepEqual(sinkMessage.body.to, ['tektwig@gmail.com']);
assert(!('cc' in sinkMessage.body) && !('bcc' in sinkMessage.body));
const blockedSink = mockFetch();
await assert.rejects(() => processNotifications({ ...config, recipientSinkEnabled: true }, 1, blockedSink.fetch));
assert.equal(blockedSink.calls.length, 0);
console.log('PASS development sink reroutes to the fixed sink; non-development use is refused before database access');

const migration = readFileSync('supabase/migrations/20261013000300_secure_notification_payloads.sql', 'utf8');
const foundationMigration = readFileSync('supabase/migrations/20261013000200_secure_dual_waybill_foundation.sql', 'utf8');
const cutoverMigration = readFileSync('supabase/migrations/20261009000000_payment_free_waybill_cutover.sql', 'utf8');
const claimStart = migration.indexOf('create or replace function public.claim_waybill_notifications');
const claimEnd = migration.indexOf('$$;', claimStart);
const claimDefinition = migration.slice(claimStart, claimEnd);
assert(claimDefinition.includes("notification.event_type='waybill_ready'"));
assert(!claimDefinition.includes('trip_closed'));
assert(claimDefinition.includes("notification.payload->>'invoice_id'=invoice.id::text"));
assert(claimDefinition.includes("notification.payload->>'invoice_number'=invoice.invoice_number"));
assert(claimDefinition.includes('pdf_copy.notification_eligible'));
assert(claimDefinition.includes('pdf_copy.copy_version=('));
assert(claimDefinition.includes('pdf_copy.bank_snapshot_id is not null'));
assert(claimDefinition.includes("notification.recipients=array[invoice.driver_email]"));
assert(claimDefinition.includes('notification.lease_until<statement_timestamp()'));
assert(claimDefinition.includes("notification.lease_until>statement_timestamp()") === false,
  'expired processing jobs are eligible for reclaim, not treated as active leases');
for (const signature of [
  'public.enqueue_waybill_ready_notifications(text)',
  'public.claim_waybill_notifications(text,integer)',
  'public.get_waybill_notification_pdf(uuid,uuid)',
  'public.finish_trip_notification(uuid,uuid,boolean,text,text)',
]) {
  assert(migration.includes(`revoke all on function ${signature} from public,anon,authenticated,service_role`));
  assert(migration.includes(`grant execute on function ${signature} to service_role`));
}
assert(/pdf_copy\.copy_version\s*=\s*\(\s*select max\(latest\.copy_version\)/.test(foundationMigration));
assert(foundationMigration.includes('pdf_copy.notification_eligible'));
assert(foundationMigration.includes('pdf_copy.bank_snapshot_id is not null'));
assert(cutoverMigration.includes("p.proname in ('claim_trip_notifications','enqueue_waybill_ready_notifications')"));
assert(cutoverMigration.includes("where n.id=p_id and n.event_type='waybill_ready'"));
assert(workerSource.includes("'enqueue_waybill_ready_notifications'"));
assert(workerSource.includes("'claim_waybill_notifications'"));
assert(workerSource.includes("'get_waybill_notification_pdf'"));
for (const retiredName of ['claim_trip_notifications', 'get_waybill_ready_pdf', 'claim_waybill_pdf_jobs']) {
  assert(!workerSource.includes(retiredName), `secure worker must not invoke retired RPC ${retiredName}`);
}
console.log('PASS SQL contract statically restricts notification claims to eligible latest secure copies and excludes trip_closed');

const expiredLeaseJob = { ...driverJob, lease_until: new Date(Date.now() - 60_000).toISOString() };
const expiredLeaseMock = mockFetch({ jobs: [expiredLeaseJob] });
const expiredLeaseResult = await processNotifications(config, 1, expiredLeaseMock.fetch);
assert.equal(expiredLeaseResult.sent, 0);
assert.equal(expiredLeaseMock.calls.some(call => call.path.endsWith('/get_waybill_notification_pdf')), false);
assert.equal(expiredLeaseMock.calls.some(call => call.path.endsWith('/rpc/finish_trip_notification')), false);
console.log('PASS expired claim response cannot fetch or send an attachment; lease expiry/reclaim stays database-bound');
