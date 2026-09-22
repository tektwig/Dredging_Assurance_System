// Mocked HTTP only: no email or remote database requests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync('supabase/functions/process-trip-notifications/worker.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { processNotifications } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
const config = { supabaseUrl: 'https://database.invalid', serviceRoleKey: 'test-only', resendApiKey: 'test-only', sender: 'sender@example.invalid', financeRecipients: ['finance@example.invalid'] };
const job = { id: 'job-1', lease_token: 'lease-1', email_request: { to: ['driver@example.invalid'], text: 'Snapshot' } };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

for (const scenario of ['success', 'provider_failure', 'timeout', 'ack_failure', 'lost_lease', 'invalid_provider_response']) {
  const calls = [];
  const mock = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    if (url.endsWith('claim_trip_notifications')) return json([job]);
    if (url === 'https://api.resend.com/emails') {
      if (scenario === 'timeout') throw new Error('Timeout');
      if (scenario === 'invalid_provider_response') return json({});
      return scenario === 'provider_failure' ? json({}, 503) : json({ id: 'provider-1' });
    }
    if (scenario === 'ack_failure') return json({}, 503);
    return json(scenario !== 'lost_lease');
  };
  const result = await processNotifications(config, mock);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].options.headers['Idempotency-Key'], 'trip-notification/job-1');
  assert.deepEqual(calls[1].body, job.email_request);
  assert.equal(calls[2].body.p_lease_token, 'lease-1');
  assert.equal(result.sent, scenario === 'success' ? 1 : 0);
  assert.equal(result.deferred, ['provider_failure', 'timeout', 'invalid_provider_response'].includes(scenario) ? 1 : 0);
  assert.equal(result.unacknowledged, ['ack_failure', 'lost_lease'].includes(scenario) ? 1 : 0);
  assert(!calls.some(call => call.url.includes('close_trip')));
  console.log(`PASS ${scenario}`);
}
assert.deepEqual(await processNotifications(config, async () => json([])), { claimed: 0, sent: 0, deferred: 0, unacknowledged: 0 });
console.log('PASS empty queue');
await assert.rejects(() => processNotifications(config, async () => json({}, 503)));
console.log('PASS claim failure');
