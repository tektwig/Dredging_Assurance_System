import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync('supabase/functions/process-waybill-pdfs/index.ts', 'utf8')
  .replace(/^import .*;\r?\n/gm, '');
const javascript = ts.transpileModule(
  `const processWaybillPdfs = globalThis.__processWaybillPdfs;\nconst generateWaybillPdf = globalThis.__generateWaybillPdf;\n${source}`,
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;
const env = new Map();
let handler;
let workerCalls = 0;
const workerLimits = [];
globalThis.Deno = {
  env: { get: name => env.get(name) },
  serve: value => { handler = value; },
};
globalThis.__processWaybillPdfs = async (config, _generatePdf, batchLimit) => {
  workerCalls++;
  assert.equal(config.serviceRoleKey, 'server-only-service-role-key');
  workerLimits.push(batchLimit);
  return { claimed: 0, ready: 0, deferred: 0, unacknowledged: 0 };
};
globalThis.__generateWaybillPdf = async () => new Uint8Array();
await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

const workerSecret = 'waybill-worker-secret-with-at-least-32-characters';
const serviceRoleKey = 'server-only-service-role-key';
const request = (method = 'POST', secret = workerSecret, body) => new Request('https://edge.example.invalid', {
  method,
  headers: { ...(secret ? { 'x-worker-secret': secret } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
  ...(body === undefined ? {} : { body }),
});

assert.equal((await handler(request('GET'))).status, 405);
assert.equal((await handler(request('POST', 'incorrect'))).status, 503);
env.set('WAYBILL_PDF_WORKER_SECRET', workerSecret);
assert.equal((await handler(request('POST', 'incorrect'))).status, 401);
assert.equal(workerCalls, 0);
env.set('SUPABASE_URL', 'https://project.example.invalid');
env.set('SUPABASE_SERVICE_ROLE_KEY', serviceRoleKey);
const response = await handler(request());
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), { claimed: 0, ready: 0, deferred: 0, unacknowledged: 0 });
assert.equal(response.headers.get('access-control-allow-origin'), null);
assert.equal(workerCalls, 1);
assert.deepEqual(workerLimits, [5]);

const defaultResponse = await handler(request('POST', workerSecret, '{}'));
assert.equal(defaultResponse.status, 200);
assert.deepEqual(workerLimits, [5, 5]);

const limitedResponse = await handler(request('POST', workerSecret, '{"limit":1}'));
assert.equal(limitedResponse.status, 200);
assert.deepEqual(workerLimits, [5, 5, 1]);

for (const body of ['{', '{"limit":0}', '{"limit":11}', '{"limit":1.5}', '{"limit":"1"}', 'null']) {
  const invalidResponse = await handler(request('POST', workerSecret, body));
  assert.equal(invalidResponse.status, 400, `Expected invalid body ${body} to return 400`);
}
assert.equal(workerCalls, 3, 'invalid batch limits must not claim jobs');
console.log('PASS endpoint validates optional batch limit before processing and never returns server credentials');
