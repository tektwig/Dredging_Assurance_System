// Tests the real handler/authentication with an in-memory Deno host and stubbed
// worker dispatch. No provider, Supabase, or remote network requests are made.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const values = new Map();
let handler;
globalThis.Deno = { env: { get: name => values.get(name) }, serve: callback => { handler = callback; } };
const original = readFileSync('supabase/functions/process-trip-notifications/index.ts', 'utf8');
const importPattern = /import \{ isDevelopmentProjectUrl, isValidEmailAddress, processNotifications, type WorkerConfig \} from '\.\/worker\.ts';/;
assert(importPattern.test(original), 'Expected worker import for isolated handler test');
const source = original.replace(importPattern,
  'type WorkerConfig = any; const isDevelopmentProjectUrl = (value: string) => value === "https://pidxlopbxlapfmakmtjt.supabase.co"; const isValidEmailAddress = (value: string) => /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value); const processNotifications = async (_config: WorkerConfig, _batchLimit: number) => { globalThis.__workerDispatchCount = (globalThis.__workerDispatchCount ?? 0) + 1; globalThis.__capturedWorkerConfig = _config; globalThis.__capturedBatchLimit = _batchLimit; return {mocked:true}; };');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const request = (method = 'POST', secret = '', body) => new Request('http://localhost/test', {
  method,
  headers: { 'x-worker-secret': secret, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
  ...(body === undefined ? {} : { body }),
});
assert.equal((await handler(request('GET'))).status, 405);
console.log('PASS handler method restriction');
assert.equal((await handler(request())).status, 503);
console.log('PASS handler missing-secret rejection');
const testSecret = 'x'.repeat(32);
values.set('TRIP_NOTIFICATION_WORKER_SECRET', testSecret);
assert.equal((await handler(request('POST', 'wrong'))).status, 401);
console.log('PASS handler unauthorized rejection');
assert.equal((await handler(request('POST', testSecret))).status, 503);
console.log('PASS handler incomplete-config rejection');
for (const name of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'TRIP_NOTIFICATION_FROM', 'TRIP_NOTIFICATION_FINANCE_EMAILS']) {
  values.set(name, 'test-only');
}
let response = await handler(request('POST', testSecret));
assert.equal(response.status, 200);
assert.equal(globalThis.__capturedWorkerConfig.waybillClientEmail, null);
console.log('PASS missing target-company configuration leaves delivery pending without blocking the worker');
values.set('WAYBILL_CLIENT_EMAIL', 'not-an-email');
assert.equal((await handler(request('POST', testSecret))).status, 200);
assert.equal(globalThis.__capturedWorkerConfig.waybillClientEmail, null);
console.log('PASS malformed target-company configuration is ignored safely without blocking the worker');
const targetAddress = 'target-company@example.invalid';
values.set('WAYBILL_CLIENT_EMAIL', targetAddress);
response = await handler(request('POST', testSecret));
assert.equal(response.status, 200);
const responseBody = await response.json();
assert.deepEqual(responseBody, { mocked: true });
assert.equal(globalThis.__capturedWorkerConfig.waybillClientEmail, targetAddress);
assert(!('waybillInternalRecipients' in globalThis.__capturedWorkerConfig));
assert.equal(globalThis.__capturedBatchLimit, 5);
values.set('WAYBILL_INTERNAL_RECIPIENTS', ' ops@example.invalid, finance@example.invalid,ops@example.invalid ');
assert.equal((await handler(request('POST', testSecret))).status, 200);
assert(!('waybillInternalRecipients' in globalThis.__capturedWorkerConfig));
assert.equal(globalThis.__capturedBatchLimit, 5);
assert(!JSON.stringify(globalThis.__capturedWorkerConfig).includes('SERVICE_ROLE'));
assert.equal((await handler(request('POST', testSecret, '{}'))).status, 200);
assert.equal(globalThis.__capturedBatchLimit, 5);
assert.equal((await handler(request('POST', testSecret, '{"limit":1}'))).status, 200);
assert.equal(globalThis.__capturedBatchLimit, 1);
const dispatchCountBeforeInvalidLimits = globalThis.__workerDispatchCount;
for (const body of ['{', 'null', '[]', '{"limit":0}', '{"limit":11}', '{"limit":1.5}', '{"limit":"1"}']) {
  assert.equal((await handler(request('POST', testSecret, body))).status, 400);
}
assert.equal(globalThis.__workerDispatchCount, dispatchCountBeforeInvalidLimits);
values.set('WAYBILL_TEST_RECIPIENT_SINK_ENABLED', 'true');
assert.equal((await handler(request('POST', testSecret))).status, 503);
assert.equal(globalThis.__workerDispatchCount, dispatchCountBeforeInvalidLimits);
assert.equal(globalThis.__capturedWorkerConfig.recipientSinkEnabled, false);
values.set('SUPABASE_URL', 'https://pidxlopbxlapfmakmtjt.supabase.co');
assert.equal((await handler(request('POST', testSecret))).status, 200);
assert.equal(globalThis.__workerDispatchCount, dispatchCountBeforeInvalidLimits + 1);
assert.equal(globalThis.__capturedWorkerConfig.recipientSinkEnabled, true);
values.set('WAYBILL_TEST_RECIPIENT_SINK_ENABLED', 'yes');
assert.equal((await handler(request('POST', testSecret))).status, 503);
assert.equal(globalThis.__workerDispatchCount, dispatchCountBeforeInvalidLimits + 1);
assert.equal(globalThis.__capturedWorkerConfig.recipientSinkEnabled, true);
console.log('PASS handler authorized dispatch');

const frontendSource = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? frontendSource(path) : [readFileSync(path, 'utf8')];
});
for (const fileSource of frontendSource('src')) {
  assert(!fileSource.includes('WAYBILL_CLIENT_EMAIL'), 'Target email configuration must stay out of frontend source');
  assert(!fileSource.includes(targetAddress), 'Target-company email value must not appear in frontend source');
}
assert(!JSON.stringify(responseBody).includes(targetAddress));
delete globalThis.__capturedWorkerConfig;
delete globalThis.__workerDispatchCount;
delete globalThis.__capturedBatchLimit;
delete globalThis.Deno;
