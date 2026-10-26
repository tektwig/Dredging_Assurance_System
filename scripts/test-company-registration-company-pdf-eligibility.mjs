import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20261024173258_company_registration_capture_pdf_eligibility.sql', 'utf8');
const registrationTest = readFileSync('supabase/tests/database/loading_registration_bank_capture.sql', 'utf8');
const snapshotTest = readFileSync('supabase/tests/database/company_waybill_bank_snapshot_autopreparation.sql', 'utf8');
const canaryTest = readFileSync('supabase/tests/database/secure_synthetic_email_canary.sql', 'utf8');
const ciRunner = readFileSync('scripts/ci/run-company-waybill-bank-recovery.sh', 'utf8');

const approvedMigrationHashes = {
  'supabase/migrations/20261021000000_secure_waybill_email_delivery_cutover.sql': 'A355F39B9B7919C44E6BD2FE21297C33A598746940527C5A5CE93B5EAAC4B81B',
  'supabase/migrations/20261021133526_secure_synthetic_waybill_email_canary.sql': '98BE1765B8AADDC822FB54C5D4476EA94BD6793AAAEE9F6F98AA4D84EDF00BD1',
  'supabase/migrations/20261022085737_company_waybill_verified_bank_eligibility.sql': 'CE439867669656BA989C491D02975B3B6845B0CABDDA5BDD161B743DA0A35C6F',
};

for (const [path, expectedHash] of Object.entries(approvedMigrationHashes)) {
  const normalizedSql = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const actualHash = createHash('sha256').update(normalizedSql).digest('hex').toUpperCase();
  assert.equal(actualHash, expectedHash, `${path} must remain byte-identical to its approved source`);
}

assert.match(migration, /20261022085737 must be installed first/);
assert.match(migration, /private\.claim_waybill_pdf_copy_jobs\(text,integer,uuid\)/);
assert.match(migration, /public\.get_company_waybill_pdf_snapshot\(uuid,uuid\)/);
assert.match(migration, /private\.finish_waybill_pdf_copy_job\(text,uuid,uuid,boolean,text\)/);
assert.match(migration, /create or replace function private\.waybill_company_copy_verification_eligible\([\s\S]*?security definer set search_path = ''/);
assert.match(migration, /snapshot\.source_kind='registration_capture'[\s\S]*?snapshot\.verified_by is null and snapshot\.verified_at is null/);
assert.match(migration, /submission\.source_registration_capture_id=snapshot\.source_registration_capture_id/);
assert.match(migration, /capture\.driver_id=invoice\.driver_id/);
assert.match(migration, /capture\.bank_name=snapshot\.bank_name[\s\S]*?capture\.account_number ~ '\^\[0-9\]\{10\}\$'/);
assert.match(migration, /event_type='registration_capture_snapshotted'[\s\S]*?event\.actor_id=capture\.captured_by/);
assert.match(migration, /snapshot\.source_kind='operations_manager'[\s\S]*?snapshot\.verified_by is not null and snapshot\.verified_at is not null/);
assert.match(migration, /max\(latest\.copy_version\)/);
assert.match(migration, /max\(latest\.version\)/);
assert.match(migration, /revoke all on function private\.waybill_company_copy_verification_eligible/);
assert.doesNotMatch(migration, /\b(?:insert into|update|delete from)\s+public\.(?:trip_closure_invoices|trip_closure_invoice_bank_snapshots|trip_closure_invoice_pdf_copies|notification_outbox)/i);
assert.doesNotMatch(migration, /waybill_synthetic_canary|WB-9999-999999|notification_outbox|grant execute/i);

assert.match(registrationTest, /valid V4 registration capture qualifies the pending Company PDF without OPM verification/);
assert.match(registrationTest, /missing registration bank capture remains ineligible/);
assert.match(registrationTest, /INVALID_BANK_NAME/);
assert.match(registrationTest, /INVALID_ACCOUNT_NUMBER/);
assert.match(registrationTest, /INVALID_ACCOUNT_NAME/);
assert.match(registrationTest, /invoice and trip association mismatch/);
assert.match(registrationTest, /snapshot belonging to another invoice/);
assert.match(registrationTest, /protected Company PDF claim accepts a valid registration-captured snapshot/);
assert.match(registrationTest, /Driver claim control is pending and has no registration bank capture/);
assert.match(registrationTest, /Driver PDF claim remains independent of registration-capture Company eligibility/);
assert.match(registrationTest, /WB-9999-999999/);
assert.match(registrationTest, /waybill_synthetic_canary_company_copy_allowed/);
assert.match(registrationTest, /notification_eligible[\s\S]*?waybill_company_copy_email_eligible/);
assert.match(registrationTest, /invoice-scoped claim test targets exactly one eligible pending synthetic registration Waybill/);
assert.match(registrationTest, /test\.company_pdf_registration_invoice_id','d6000000-0000-0000-0000-000000000001'/);
assert.match(registrationTest, /rollback;/i);
assert.match(snapshotTest, /update public\.trip_closure_invoice_bank_snapshots[\s\S]*?delete from public\.trip_closure_invoice_bank_snapshots/);
assert.match(snapshotTest, /no fabricated verification/);
assert.match(ciRunner, /20261024173258_company_registration_capture_pdf_eligibility\.sql/);
assert.match(ciRunner, /validated_source_count" == 30/);
assert.match(ciRunner, /assert_staged_count 30/);
assert.match(ciRunner, /migrations=30/);
assert.match(ciRunner, /assertions_passed_before_failure/);
const migration30Stage = ciRunner.indexOf('copy_migration "$repo_root/supabase/migrations" 20261024173258_company_registration_capture_pdf_eligibility.sql');
const migration30Apply = ciRunner.indexOf('apply_migrations "$all_versions,20261021000000,20261021133526,20261022085737,20261024173258"');
const canaryProvision = ciRunner.indexOf('run_sql "synthetic email canary provisioning fixture"');
const companyHardeningSuite = ciRunner.indexOf('run_transactional_suite "Company verified-bank eligibility hardening assertions"');
const preEligibilityCanarySuite = ciRunner.indexOf('run_transactional_suite "synthetic email canary assertions before registration-capture eligibility"');
const registrationSuite = ciRunner.indexOf('run_transactional_suite "V4 registration bank-capture suite"');
const canarySuite = ciRunner.indexOf('run_transactional_suite "synthetic email canary assertions after registration-capture eligibility"');
assert.ok(canaryProvision >= 0 && companyHardeningSuite > canaryProvision && preEligibilityCanarySuite > companyHardeningSuite && migration30Stage > preEligibilityCanarySuite,
  'migration-29 Company and canary suites must preserve the original verification policy checkpoint');
assert.ok(migration30Stage >= 0 && migration30Apply > migration30Stage && registrationSuite > migration30Apply && canarySuite > registrationSuite,
  'migration 30 must precede registration-capture eligibility and the post-migration canary suite');
assert.match(canaryTest, /test\.registration_capture_pdf_eligibility_installed/);
assert.match(canaryTest, /Company PDF claim follows installed registration-capture policy while regular email remains canary-locked/);
assert.match(canaryTest, /regular claims are blocked while the synthetic canary is armed/);
assert.match(canaryTest, /claim_waybill_notifications/);

console.log('Company registration-to-PDF eligibility static contract checks passed.');
