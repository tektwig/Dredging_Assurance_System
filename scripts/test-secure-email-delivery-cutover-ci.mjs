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
const companyVerificationMigration = readFileSync('supabase/migrations/20261022085737_company_waybill_verified_bank_eligibility.sql', 'utf8');
const companyVerificationFixture = readFileSync('supabase/tests/fixtures/secure_email_delivery_cutover/company_verified_bank_attempt_cleanup_seed.sql', 'utf8');
const companyVerificationSuite = readFileSync('supabase/tests/database/company_waybill_verified_bank_eligibility.sql', 'utf8');
const pdfWorkerIndex = readFileSync('supabase/functions/process-waybill-pdfs/index.ts', 'utf8');
const getRunnerFunction = (name) => {
  const body = runner.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm'))?.[0];
  assert(body, `runner function ${name} must exist`);
  return body;
};
const migrationPreservationFingerprint = getRunnerFunction('migration_preservation_fingerprint');
const secureEmailHardeningFingerprint = getRunnerFunction('secure_email_hardening_fingerprint');

for (const table of [
  'public.trips', 'public.trip_closure_invoices', 'public.trip_closure_invoice_documents',
  'public.drivers', 'public.trucks', 'public.trip_payments', 'public.audit_log',
  'private.loading_registration_bank_captures', 'public.notification_outbox', 'storage.objects',
]) assert(migrationPreservationFingerprint.includes(`from ${table} x`));
for (const table of [
  'public.trip_closure_invoice_bank_submissions', 'public.trip_closure_invoice_bank_snapshots',
  'public.trip_closure_invoice_bank_detail_events', 'public.trip_closure_invoice_pdf_copies',
]) assert(!migrationPreservationFingerprint.includes(table),
  `migration-26 recovery fingerprint must not include backfilled table ${table}`);
for (const table of [
  'public.audit_log', 'private.loading_registration_bank_captures',
  'public.trip_closure_invoice_bank_submissions', 'public.trip_closure_invoice_bank_snapshots',
  'public.trip_closure_invoice_bank_detail_events', 'public.trip_closure_invoice_pdf_copies',
  'private.waybill_company_bank_save_receipts', 'private.waybill_notification_canary_runs',
  'private.waybill_synthetic_email_canary_permits', 'public.notification_outbox', 'storage.objects',
]) assert(secureEmailHardeningFingerprint.includes(`from ${table} x`));
const migration29Copy = runner.indexOf('copy_migration "$repo_root/supabase/migrations" 20261022085737_company_waybill_verified_bank_eligibility.sql');
const migration29Apply = runner.indexOf('apply_migrations "$all_versions,20261021000000,20261021133526,20261022085737"', migration29Copy);
assert(migration29Copy >= 0 && runner.lastIndexOf('hardening_before=$(secure_email_hardening_fingerprint)', migration29Copy) > 0);
assert(migration29Apply > migration29Copy);
assert(runner.indexOf('hardening_after=$(secure_email_hardening_fingerprint)', migration29Apply) > migration29Apply);

const snapshotTargets = seed.match(/create temporary table email_cutover_snapshot_targets[\s\S]*?;\s*insert into/m)?.[0] ?? '';
assert(snapshotTargets.length > 0, 'snapshot setup must be identifiable');
assert(!snapshotTargets.includes('WB-2026-000046'), 'blocked future invoice 046 must not receive a bank snapshot');
assert(!snapshotTargets.includes('WB-9999-999999'), 'the reserved invoice must not be preseeded before the cutover');

assert(workflow.includes('feature/secure-email-delivery-cutover'));
assert(workflow.includes('permissions:\n  contents: read'));
assert(workflow.includes('RUN_SECURE_EMAIL_CUTOVER: "true"'));
assert(workflow.includes('supabase/tests/database/company_waybill_verified_bank_eligibility.sql'));
assert(workflow.includes('supabase/tests/fixtures/secure_email_delivery_cutover/**'));
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
assert(runner.includes('20261022085737_company_waybill_verified_bank_eligibility.sql'));
assert(runner.includes('secure_email_delivery_cutover/seed.sql'));
assert(runner.includes('secure_email_delivery_cutover.sql'));
assert(runner.indexOf('validate_sql_sources') < runner.indexOf('supabase start'));
assert(runner.includes('supabase stop --yes --no-backup --workdir'));
assert(runner.includes('Refusing cleanup outside the unique runner temp directory'));
assert(runner.includes('20261021000000"'));
assert(runner.includes('20261021133526'));
assert(runner.includes('Expected 29 migration sources for secure email verification hardening'));
assert(runner.includes('Company verified-bank eligibility hardening assertions'));
assert(runner.includes('company_verified_bank_attempt_cleanup_seed.sql'));
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
assert(canarySuite.includes('normal Company PDF eligibility remains blocked until a verified bank snapshot exists'),
  'the existing unverified Company PDF negative-control assertion must remain unchanged');
const canaryClaimStart = companyVerificationMigration.indexOf(
  'create or replace function public.claim_waybill_notification_canary(');
const canaryClaimEnd = companyVerificationMigration.indexOf('\n$$;', canaryClaimStart);
assert(canaryClaimStart >= 0 && canaryClaimEnd > canaryClaimStart,
  'the effective Company-eligibility migration must define the synthetic canary claim RPC');
const effectiveCanaryClaim = companyVerificationMigration.slice(canaryClaimStart, canaryClaimEnd);
assert(effectiveCanaryClaim.includes("p_company_recipient is distinct from 'synthetic-company@example.invalid'")
  && effectiveCanaryClaim.includes("using errcode='22023'"),
  'the effective canary RPC must reject non-synthetic Company recipients with SQLSTATE 22023');
assert(canarySuite.includes("'attacker@example.invalid'),\n  '22023','canary claim rejects a non-synthetic Company recipient'"),
  'the invalid-recipient regression must preserve its attacker input and match the effective 22023 contract');
assert(/phase3b_recipient_rejection_before[\s\S]*full outer join reserved_notification_rows_after after_row using \(id\)[\s\S]*before_row\.complete_row is distinct from after_row\.complete_row/i.test(canarySuite),
  'the invalid-recipient test must compare complete before/after reserved notification rows');
assert(canarySuite.includes('invalid Company recipient rejection preserves both reserved notification rows exactly'),
  'the invalid-recipient test must assert both reserved notification rows remain unchanged');
const canaryCompanyPdfDenial = canarySuite.indexOf(
  'normal Company PDF eligibility remains blocked until a verified bank snapshot exists');
const canaryOutboxPreservation = canarySuite.indexOf(
  'regular reconciliation and claims preserve every non-canary outbox field');
const canaryRoleReset = canarySuite.indexOf('reset role;', canaryCompanyPdfDenial);
assert(canaryCompanyPdfDenial >= 0 && canaryRoleReset > canaryCompanyPdfDenial
  && canaryRoleReset < canaryOutboxPreservation,
  'the service-role Company PDF denial must be followed by RESET ROLE before privileged outbox comparison');
assert(!canarySuite.slice(canaryOutboxPreservation,
  canarySuite.indexOf("select set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000004'",
    canaryOutboxPreservation)).includes('reset role;'),
  'the historical outbox comparison must not retain a redundant service-role reset afterward');

assert(companyVerificationMigration.startsWith('begin;'));
assert(companyVerificationMigration.trimEnd().endsWith('commit;'));
assert(companyVerificationMigration.includes("copy.copy_kind='company'"));
assert(companyVerificationMigration.includes('copy.copy_version=('));
assert(companyVerificationMigration.includes('snapshot.version=copy.copy_version'));
assert(companyVerificationMigration.includes("snapshot.source_kind='operations_manager'"));
assert(companyVerificationMigration.includes('snapshot.verified_by is not null and snapshot.verified_at is not null'));
assert(companyVerificationMigration.includes('snapshot.verified_at<=statement_timestamp()'));
assert(companyVerificationMigration.includes('event.actor_id=snapshot.verified_by'));
assert(companyVerificationMigration.includes('event.occurred_at>=snapshot.verified_at'));
assert(companyVerificationMigration.includes('create policy secure_waybill_company_verified_storage_read'));
assert(companyVerificationMigration.includes('An unverified or superseded Company PDF/email lease is active'));
assert(companyVerificationMigration.includes('waybill_company_invoice_has_processing_delivery'));
assert(companyVerificationMigration.includes('save_waybill_company_bank_details'));
assert(companyVerificationMigration.includes("and copy.notification_eligible"));
const unverifiedClaimMessage = companyVerificationSuite.indexOf('an unverified Company PDF cannot be claimed');
const unverifiedSnapshotCall = companyVerificationSuite.indexOf(
  "public.get_company_waybill_pdf_snapshot(\n    current_setting('phase3c.unverified_company_copy_id')::uuid,\n    gen_random_uuid()) is null");
const unverifiedSnapshotMessage = companyVerificationSuite.indexOf(
  'an unclaimed unverified Company copy returns scalar SQL NULL; bank eligibility is asserted by claim denial');
assert(unverifiedClaimMessage >= 0 && unverifiedSnapshotCall > unverifiedClaimMessage
  && unverifiedSnapshotMessage > unverifiedSnapshotCall,
  'the unverified Company claim denial must precede its scalar SQL NULL lookup assertion');
assert(companyVerificationSuite.lastIndexOf('set local role service_role;', unverifiedSnapshotCall)
  > companyVerificationSuite.lastIndexOf('reset role;', unverifiedSnapshotCall),
  'the unverified Company scalar snapshot lookup must run as service_role');
assert.doesNotMatch(companyVerificationSuite,
  /not\s+exists\s*\(\s*select\s+1\s+from\s+public\.get_company_waybill_pdf_snapshot/i,
  'scalar JSONB snapshot functions must not be asserted as set-returning functions');
assert(companyVerificationSuite.includes("public.get_company_waybill_pdf_snapshot(\n    current_setting('phase3c.verified_company_claim_copy_id')::uuid,\n    gen_random_uuid()) is null")
  && companyVerificationSuite.includes('the verified Company snapshot getter returns scalar SQL NULL for an invalid lease token'),
  'invalid-lease rejection must be independently asserted for a verified Company copy');
assert.match(companyVerificationSuite,
  /select lease\.copy_id,public\.get_company_waybill_pdf_snapshot\(lease\.copy_id,lease\.lease_token\)/i,
  'the positive Company snapshot test must continue using the valid claimed lease');
assert(companyVerificationFixture.includes('attempts=8'));
assert(companyVerificationFixture.includes('attempts=5'));
assert(companyVerificationSuite.includes('future-dated verification evidence'));
assert(companyVerificationSuite.includes('previously eligible Company copy becomes ineligible'));
assert(companyVerificationSuite.includes('ready but unverified Company copy'));
assert(companyVerificationSuite.includes('reconciliation does not enqueue, unblock, or mutate any unverified historical Company notification'));
assert(companyVerificationSuite.includes('from private.waybill_email_historical_allowlist allowlist'));
assert(companyVerificationSuite.includes('array_agg(allowlist.invoice_number order by allowlist.invoice_number)'));
assert(companyVerificationSuite.includes('allowlist.invoice_id=invoice.id'));
assert(companyVerificationSuite.includes('allowlist.trip_id=invoice.trip_id'));
assert(companyVerificationSuite.includes('allowlist.closed_at=invoice.closed_at'));
assert(companyVerificationSuite.includes('allowlist.closed_at=trip.closed_at'));
assert(companyVerificationSuite.includes("allowlist.invoice_number in ('WB-2026-000039','WB-2026-000040')"));
assert(companyVerificationSuite.includes('canary.disarmed_at is null'));
assert(companyVerificationSuite.includes('canary.expires_at>statement_timestamp()'));
assert(companyVerificationSuite.includes('regular email delivery remains disabled while the synthetic canary is armed'));
assert(companyVerificationSuite.indexOf('regular email delivery remains disabled while the synthetic canary is armed')
  < companyVerificationSuite.indexOf('CI transaction disarms the synthetic canary'));
assert(companyVerificationSuite.includes('Company PDF worker cannot claim a future-verified or superseded Company copy'));
assert(companyVerificationSuite.includes('bank correction fails closed while a Company email lease is active'));
assert(companyVerificationSuite.includes('bank correction fails closed while a Company PDF lease is active'));
const mismatchLeaseStart = companyVerificationSuite.indexOf('select pg_temp.assert_true(not public.finish_trip_notification(');
const mismatchLeaseEnd = companyVerificationSuite.indexOf('select pg_temp.assert_true((', mismatchLeaseStart + 1);
const mismatchLeaseAssertion = companyVerificationSuite.slice(mismatchLeaseStart, mismatchLeaseEnd);
assert(mismatchLeaseStart >= 0 && mismatchLeaseEnd > mismatchLeaseStart
  && /select pg_temp\.assert_true\(not public\.finish_trip_notification\([\s\S]*?gen_random_uuid\(\),false,null,'synthetic lease mismatch'\)\s*,'notification completion rejects a mismatched lease token'\);/i.test(mismatchLeaseAssertion),
  'the mismatched notification lease assertion must pass its message as the second assert_true argument');
assert(companyVerificationSuite.includes("bool_and(public.finish_trip_notification(lease.id,lease.lease_token,false,null,'synthetic SQL-only attachment test'))")
  && companyVerificationSuite.includes('valid notification leases can be safely released through the existing failure/retry RPC without provider calls'),
  'valid notification leases must still be released through the retry RPC');
assert(companyVerificationSuite.includes('(select count(*)=0 from phase3c_followup_claims)')
  && companyVerificationSuite.includes('actual_count=')
  && companyVerificationSuite.includes('jobs=')
  && companyVerificationSuite.includes('earlier valid notification claims are pending with retry backoff and no lease')
  && companyVerificationSuite.includes('all earlier valid notification leases were released and none remain stranded')
  && !/bool_and\([^)]*finish_trip_notification\([^)]*\)\s*from phase3c_followup_claims/i.test(companyVerificationSuite),
  'follow-up retry claims must assert their expected empty count and prove prior leases are not stranded');
assert(companyVerificationSuite.includes('all fields on unverified historical notification rows remain unchanged'));
assert(companyVerificationSuite.includes('rollback;'));
assert(!companyVerificationSuite.includes('api.resend.com'));
assert(companyVerificationSuite.includes('the reserved synthetic invoice resolves exactly once before the service-role disarm call'));
assert(companyVerificationSuite.includes("current_setting('phase3c.reserved_invoice_id')::uuid"));
assert(companyVerificationSuite.includes('both synthetic Company Storage objects exist before authenticated RLS checks'));
assert(companyVerificationSuite.includes('where existing.bucket_id=copy.storage_bucket and existing.name=copy.storage_path'));
assert(!companyVerificationSuite.includes('on conflict (bucket_id,name) do nothing'));
assert(companyVerificationSuite.includes("(select count(*) from storage.objects object\n      where object.bucket_id=copy.storage_bucket and object.name=copy.storage_path)=1"));
assert(companyVerificationSuite.includes("invoice.invoice_number='WB-2026-000042'\n        and not private.waybill_company_copy_verification_eligible"));
assert(companyVerificationSuite.includes("invoice.invoice_number='WB-2026-000043'\n        and private.waybill_company_copy_verification_eligible"));
assert(companyVerificationSuite.includes('the authenticated Company access checks use a seeded active Operations Manager'));
assert(companyVerificationSuite.includes('the Storage denial identity is an active, assigned Loading Officer with a seeded session'));
const companyVerificationRoleBlocks = [...companyVerificationSuite.matchAll(
  /set local role (service_role|authenticated);([\s\S]*?)reset role;/gi,
)];
assert(companyVerificationRoleBlocks.length > 0, 'the eligibility suite retains role-scoped authorization tests');
for (const [, role, body] of companyVerificationRoleBlocks) {
  assert(!/\b(?:from|join)\s+public\.(?:trip_closure_invoices|trip_closure_invoice_pdf_copies)\b/i.test(body),
    `${role} test blocks must not directly inspect restricted invoice or PDF tables`);
}
const companyStorageRlsBlocks = companyVerificationRoleBlocks
  .filter(([, , body]) => body.includes("current_setting('phase3c.company_verified_path')"));
assert(companyStorageRlsBlocks.length === 2,
  'both Operations Manager and Loading Officer Storage RLS checks use privileged-prepared object paths');
for (const [, role, body] of companyStorageRlsBlocks) {
  assert(role === 'authenticated' && body.includes('from storage.objects') && !/\bjoin\s+public\./i.test(body),
    'authenticated Storage checks query storage.objects directly without joining restricted Company metadata');
}

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
