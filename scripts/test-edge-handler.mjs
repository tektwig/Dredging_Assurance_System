// Tests the real handler/authentication with an in-memory Deno host and stubbed
// worker dispatch. No provider, Supabase, or remote network requests are made.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const values = new Map();
let handler;
globalThis.Deno = { env: { get: name => values.get(name) }, serve: callback => { handler = callback; } };
const original = readFileSync('supabase/functions/process-trip-notifications/index.ts', 'utf8');
const importPattern = /import \{ processNotifications, type WorkerConfig \} from '\.\/worker\.ts';/;
assert(importPattern.test(original), 'Expected worker import for isolated handler test');
const source = original.replace(importPattern,
  'type WorkerConfig = any; const processNotifications = async (_config: WorkerConfig) => ({mocked:true});');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const request = (method = 'POST', secret = '') => new Request('http://localhost/test', {
  method, headers: { 'x-worker-secret': secret },
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
const response = await handler(request('POST', testSecret));
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), { mocked: true });
console.log('PASS handler authorized dispatch');
delete globalThis.Deno;
