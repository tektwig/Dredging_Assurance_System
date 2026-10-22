import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/secure-waybill-email-delivery-cutover-sql.yml', 'utf8');
const runner = readFileSync('scripts/ci/run-company-waybill-bank-recovery.sh', 'utf8');
const migration = readFileSync('supabase/migrations/20261021000000_secure_waybill_email_delivery_cutover.sql', 'utf8');
const seed = readFileSync('supabase/tests/fixtures/secure_email_delivery_cutover/seed.sql', 'utf8');
const suite = readFileSync('supabase/tests/database/secure_email_delivery_cutover.sql', 'utf8');
const canaryMigration = readFileSync('supabase/migrations/20261021133526_secure_synthetic_waybill_email_canary.sql', 'utf8');
const canaryFixture = readFileSync('supabase/tests/fixtures/secure_email_delivery_cutover/canary_provision.sql', 'utf8');
const canarySuite = readFileSync('supabase/tests/database/secure_synthetic_email_canary.sql', 'utf8');
const canaryGate = readFileSync('supabase/tests/fixtures/secure_email_delivery_cutover/canary_concurrency_gate.sql', 'utf8');
const canaryGateCleanup = readFileSync('supabase/tests/fixtures/secure_email_delivery_cutover/canary_concurrency_gate_cleanup.sql', 'utf8');
const pdfWorkerIndex = readFileSync('supabase/functions/process-waybill-pdfs/index.ts', 'utf8');

const snapshotTargets = seed.match(/create temporary table email_cutover_snapshot_targets[\s\S]*?;\s*insert into/m)?.[0] ?? '';
assert(snapshotTargets.length > 0, 'snapshot setup must be identifiable');
assert(!snapshotTargets.includes('WB-2026-000046'), 'blocked future invoice 046 must not receive a bank snapshot');
assert(!snapshotTargets.includes('WB-9999-999999'), 'the reserved invoice must not be preseeded before the cutover');

assert(workflow.includes('feature/secure-email-delivery-cutover'));
assert(workflow.includes('permissions:\n  contents: read'));
assert(workflow.includes('RUN_SECURE_EMAIL_CUTOVER: "true"'));
assert(workflow.includes('ref: 16bf4ec5286f8ed5efc225da5456b95fbb7ba4dd'));
assert(workflow.includes('cd .ci-sql-support\n            sha256sum --check supabase/tests/fixtures/trakflit-ci/MIGRATION_SHA256SUMS'));
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
assert(runner.includes('20261021133526_secure_synthetic_waybill_email_canary.sql'));
assert(runner.includes('secure_email_delivery_cutover/seed.sql'));
assert(runner.includes('secure_email_delivery_cutover.sql'));
assert(runner.indexOf('validate_sql_sources') < runner.indexOf('supabase start'));
assert(runner.includes('supabase stop --yes --no-backup --workdir'));
assert(runner.includes('Refusing cleanup outside the unique runner temp directory'));
assert(runner.includes('20261021000000"'));
assert(runner.includes('20261021133526'));
assert(runner.includes('Expected 28 migration sources for secure email canary'));
assert(runner.includes('synthetic email canary assertions'));
assert(runner.includes('canary concurrency gate setup'));
assert(runner.includes('canary lease recovery'));
assert(runner.includes('notification_canary_runs'));
assert(runner.includes('migration replay is rejected before changes'));

for (const version of [
  'WB-2026-000041', 'WB-2026-000042', 'WB-2026-000043', 'WB-2026-000044', 'WB-2026-000045',
]) assert(migration.includes(version) && seed.includes(version) && suite.includes(version));
assert(seed.includes('WB-2026-000039'));
assert(seed.includes('WB-2026-000040'));
assert(seed.includes('WB-2026-000046'));
assert(!/insert\s+into\s+public\.trip_closure_invoices[\s\S]{0,3000}'WB-9999-999999'/i.test(seed),
  'the pre-cutover seed must not insert the reserved canary invoice');
assert(seed.includes('blocked_missing_email'));
assert(seed.includes("'sent'"));
assert(seed.includes("'processing'"));
assert(suite.includes('claim_waybill_notification_canary'));
assert(suite.includes('claim_waybill_notifications'));
assert(suite.includes('trip_closed'));
assert(suite.includes('rollback;'));
assert(!suite.includes('api.resend.com'));

assert(canaryMigration.includes("secret.decrypted_secret='pidxlopbxlapfmakmtjt'"));
assert(canaryMigration.includes("secret.decrypted_secret='true'"));
assert(canaryMigration.includes("'WB-9999-999999'"));
assert(canaryMigration.includes("'synthetic-driver@example.invalid'"));
assert(canaryMigration.includes("'synthetic-company@example.invalid'"));
assert(canaryMigration.includes('claim_waybill_synthetic_canary_pdf_jobs'));
assert(canaryMigration.includes('provision_waybill_synthetic_email_canary_notifications'));
assert(canaryMigration.includes('recover_expired_waybill_synthetic_email_canary'));
assert(canaryMigration.includes('private.waybill_synthetic_canary_company_copy_allowed'));
assert(canaryMigration.includes('create or replace function public.claim_waybill_notification_canary'));
assert(canaryMigration.includes('create or replace function public.get_waybill_notification_pdf'));
assert(canaryMigration.includes("company_copy.notification_eligible=false"));
assert(canaryMigration.includes("snapshot.source_kind='operations_manager'"));
assert(canaryMigration.includes("snapshot.verified_by is not null and snapshot.verified_at is not null"));
assert(!/set\s+notification_eligible\s*=\s*true/i.test(canaryMigration),
  'canary eligibility must not mutate the global PDF notification flag');
assert(canaryMigration.includes("pdf_copy.invoice_number<>'WB-9999-999999'"),
  'normal PDF claims must leave the reserved synthetic invoice to the invoice-scoped claim RPC');
assert(!canaryFixture.includes('disable trigger'));
assert(canaryFixture.includes('public.register_loading_participant_v4'));
assert(canaryFixture.includes('public.create_loading_trip_v2'));
assert(canaryFixture.includes('public.close_trip_v2'));
assert(canaryFixture.includes('public.authorize_waybill_synthetic_email_canary_trip'));
assert(canaryFixture.includes('public.register_loading_participant_v4'));
assert(canaryFixture.includes('public.save_waybill_company_bank_details'));
assert(canaryFixture.includes('public.claim_waybill_synthetic_canary_pdf_jobs'));
assert(canaryFixture.includes("snapshot.source_kind='registration_capture'"));
assert(canaryFixture.includes("company_copy.status='pending'"));
assert(canaryFixture.includes("company_copy.bank_snapshot_id=snapshot.id"));
assert(canaryFixture.includes('blocked Company claim leaves status, attempts and lease unchanged'));
const unverifiedClaimAssertion = canaryFixture.indexOf('unverified Company bank snapshot cannot be claimed');
const unverifiedStateAssertion = canaryFixture.indexOf('blocked Company claim leaves status, attempts and lease unchanged');
const driverClaimRpc = canaryFixture.indexOf("current_setting('test.phase3b_invoice_id')::uuid,'driver')", unverifiedStateAssertion);
assert(unverifiedClaimAssertion >= 0 && unverifiedStateAssertion > unverifiedClaimAssertion,
  'the unverified Company claim must be checked before inspecting its saved state');
assert(canaryFixture.slice(unverifiedClaimAssertion, unverifiedStateAssertion).includes('reset role;'),
  'privileged claim context must be reset before inspecting the postgres-owned before-state table');
assert(driverClaimRpc > unverifiedStateAssertion,
  'the subsequent invoice-scoped Driver claim must remain present');
assert(canaryFixture.slice(unverifiedStateAssertion, driverClaimRpc).includes('set local role service_role;'),
  'service_role must be restored before the subsequent invoice-scoped Driver claim');
assert(canaryFixture.includes('verified Company v2 is eligible only through the reserved canary path'));
assert(canaryFixture.includes("v_trip_id_matches:=coalesce(v_response#>>'{trip,id}'=p_trip_id::text,false)"),
  'canary closure assertions must verify the RPC trip identity');
assert(canaryFixture.includes("v_waybill_invoice_present:=coalesce((v_response->'waybill') ? 'invoice_number',false)"),
  'canary closure assertions must tolerate the canonical RPC response without a Waybill field');
assert(canaryFixture.includes("where invoice.trip_id=p_trip_id and invoice.invoice_number=v_invoice_number"),
  'an optional RPC Waybill number must match its database invoice');
assert(canaryFixture.includes("where trip.id=current_setting('test.phase3b_trip_id')::uuid"),
  'reserved invoice assertions must use the exact synthetic trip ID');
assert(canaryFixture.includes('reserved trip has exactly one matching invoice with the reserved number and matching closure timestamps'),
  'reserved invoice identity, number, and closure timestamps must be database-verified');
assert(canaryFixture.includes('public.finish_driver_waybill_pdf_job'));
assert(canaryFixture.includes('public.finish_company_waybill_pdf_job'));
assert(canaryFixture.includes('vault.create_secret'));
assert(!canaryFixture.includes('api.resend.com'));
assert(canarySuite.includes('claim_waybill_synthetic_canary_pdf_jobs'));
assert(canarySuite.includes("trip.driver_id=v_ordinary_driver_id and trip.status='closed'"),
  'ordinary control trip lookup must bind the closed trip to the identified synthetic driver');
assert(canarySuite.includes('v_ordinary_trip_count<>1 or v_ordinary_invoice_count<>1'),
  'ordinary control lookup must fail clearly unless exactly one closed trip and invoice match');
assert(canarySuite.includes("perform set_config('test.phase3b_ordinary_invoice_id',v_ordinary_invoice_id::text,true)"),
  'the actual non-reserved ordinary invoice ID must be initialized before UUID casts');
assert(!canarySuite.includes("driver.full_name='Synthetic Ordinary Control Driver' and trip.status='open'"),
  'ordinary control lookup must not assume the trip remains open after provisioning');
assert(canarySuite.includes('ordinary closed trip received no reserved-number permit'));
assert(canarySuite.includes('invoice-scoped PDF claim rejects an ordinary closed trip'));
assert(canarySuite.includes('notification_outbox'));
assert(canarySuite.includes('pre-existing outbox rows retain their complete status'));
assert(canarySuite.includes('recover_expired_waybill_synthetic_email_canary'));
assert(canarySuite.includes('normal PDF processing still claims an eligible non-canary Driver copy'));
assert(canarySuite.includes('each canary notification resolves only its audience-matched ready secure PDF'));
assert(canarySuite.includes('normal eligibility flag remains false'));
assert(canarySuite.includes('all pre-existing outbox rows retain their complete status'));
assert(!canarySuite.includes('all 76 pre-existing outbox rows'));
assert(!canarySuite.includes('api.resend.com'));
assert(canaryGate.includes('pg_sleep'));
assert(canaryGate.includes('WB-9999-999999'));
assert(canaryGateCleanup.includes('drop trigger'));
assert(pdfWorkerIndex.includes("!['limit', 'mode', 'invoice_id'].includes(key)"));
assert(canaryMigration.includes("'waybill_synthetic_email_canary',p_trip_id,'INSERT'"));
assert(canaryMigration.includes("'waybill_synthetic_email_canary',new.id,'INSERT'"));

console.log('PASS CI branch, pinned baseline, unique temp project, cleanup, migration ordering, fixed scope, synthetic canary, and SQL-suite wiring');
