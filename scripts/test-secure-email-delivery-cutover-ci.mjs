import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/secure-waybill-email-delivery-cutover-sql.yml', 'utf8');
const runner = readFileSync('scripts/ci/run-company-waybill-bank-recovery.sh', 'utf8');
const migration = readFileSync('supabase/migrations/20261021000000_secure_waybill_email_delivery_cutover.sql', 'utf8');
const seed = readFileSync('supabase/tests/fixtures/secure_email_delivery_cutover/seed.sql', 'utf8');
const suite = readFileSync('supabase/tests/database/secure_email_delivery_cutover.sql', 'utf8');

const snapshotTargets = seed.match(/create temporary table email_cutover_snapshot_targets[\s\S]*?;\s*insert into/m)?.[0] ?? '';
assert(snapshotTargets.length > 0, 'snapshot setup must be identifiable');
assert(!snapshotTargets.includes('WB-2026-000046'), 'blocked future invoice 046 must not receive a bank snapshot');
assert(snapshotTargets.includes('WB-9999-999999'), 'the synthetic canary invoice must receive a bank snapshot');

assert(workflow.includes('feature/secure-email-delivery-cutover'));
assert(workflow.includes('permissions:\n  contents: read'));
assert(workflow.includes('RUN_SECURE_EMAIL_CUTOVER: "true"'));
assert(workflow.includes('ref: 16bf4ec5286f8ed5efc225da5456b95fbb7ba4dd'));
assert(workflow.includes('version: 2.120.0'));
assert(!workflow.includes('secrets.'));
assert(!workflow.includes('pidxlopbxlapfmakmtjt'));
assert(!workflow.includes('api.resend.com'));
assert(!workflow.includes('supabase db push'));

assert(runner.includes('secure_email_cutover="${RUN_SECURE_EMAIL_CUTOVER:-false}"'));
assert(runner.includes('expected_branch="refs/heads/feature/company-waybill-bank-recovery"'));
assert(runner.includes('expected_branch="refs/heads/feature/secure-email-delivery-cutover"'));
assert(runner.includes('project_prefix="cwbr"'));
assert(runner.includes('project_prefix="sedc"'));
assert(runner.includes('20261021000000_secure_waybill_email_delivery_cutover.sql'));
assert(runner.includes('secure_email_delivery_cutover/seed.sql'));
assert(runner.includes('secure_email_delivery_cutover.sql'));
assert(runner.indexOf('validate_sql_sources') < runner.indexOf('supabase start'));
assert(runner.includes('supabase stop --yes --no-backup --workdir'));
assert(runner.includes('Refusing cleanup outside the unique runner temp directory'));
assert(runner.includes('20261021000000"'));
assert(runner.includes('notification_canary_runs'));
assert(runner.includes('migration replay is rejected before changes'));

for (const version of [
  'WB-2026-000041', 'WB-2026-000042', 'WB-2026-000043', 'WB-2026-000044', 'WB-2026-000045',
]) assert(migration.includes(version) && seed.includes(version) && suite.includes(version));
assert(seed.includes('WB-2026-000039'));
assert(seed.includes('WB-2026-000040'));
assert(seed.includes('WB-2026-000046'));
assert(seed.includes('WB-9999-999999'));
assert(seed.includes('blocked_missing_email'));
assert(seed.includes("'sent'"));
assert(seed.includes("'processing'"));
assert(suite.includes('claim_waybill_notification_canary'));
assert(suite.includes('claim_waybill_notifications'));
assert(suite.includes('trip_closed'));
assert(suite.includes('rollback;'));
assert(!suite.includes('api.resend.com'));

console.log('PASS CI branch, pinned baseline, unique temp project, cleanup, migration ordering, fixed scope, synthetic canary, and SQL-suite wiring');
