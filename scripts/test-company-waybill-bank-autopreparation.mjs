import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20261019151115_company_waybill_bank_snapshot_autopreparation.sql', 'utf8');
const v3RegistrationMigration = readFileSync('supabase/migrations/20261011000100_payment_free_loading_registration.sql', 'utf8');
const v4RegistrationMigration = readFileSync('supabase/migrations/20261016000100_loading_registration_bank_capture.sql', 'utf8');
const loadingAlignmentMigration = readFileSync('supabase/migrations/20260924000100_loading_alignment.sql', 'utf8');
const databaseTest = readFileSync('supabase/tests/database/loading_registration_bank_capture.sql', 'utf8');
const waybillService = readFileSync('src/features/operations/services/operationsWaybills.ts', 'utf8');
const waybillDetail = readFileSync('src/features/operations/waybillsPayouts/OperationsWaybillDetail.tsx', 'utf8');
const dashboardService = readFileSync('src/features/operations/services/operationsDashboard.ts', 'utf8');
const dashboard = readFileSync('src/features/operations/dashboard/OperationsDashboard.tsx', 'utf8');
const recoveryAssertions = readFileSync('supabase/tests/database/company_waybill_bank_snapshot_autopreparation.sql', 'utf8');
const concurrencyAssertions = readFileSync('supabase/tests/database/company_waybill_bank_concurrency.sql', 'utf8');
const recoverySeed = readFileSync('supabase/tests/fixtures/company_waybill_bank_recovery/seed.sql', 'utf8');
const concurrencyGate = readFileSync('supabase/tests/fixtures/company_waybill_bank_recovery/concurrency_gate.sql', 'utf8');
const concurrencyGateCleanup = readFileSync('supabase/tests/fixtures/company_waybill_bank_recovery/concurrency_gate_cleanup.sql', 'utf8');
const ciRunner = readFileSync('scripts/ci/run-company-waybill-bank-recovery.sh', 'utf8');
const ciWorkflow = readFileSync('.github/workflows/company-waybill-bank-recovery-sql.yml', 'utf8');

assert.match(migration, /create function private\.snapshot_registration_bank_capture_for_invoice\(p_invoice_id uuid\)[\s\S]*?security definer set search_path = ''/);
assert.match(migration, /pg_advisory_xact_lock[\s\S]*?where id=p_invoice_id for update/);
assert.match(migration, /v_capture_driver_id is distinct from v_driver_id/);
assert.match(migration, /v_capture_actor is distinct from new\.submitted_by[\s\S]*?v_capture_at is distinct from new\.submitted_at/);
assert.match(migration, /registration_capture_snapshotted/);
assert.match(migration, /create or replace function private\.queue_secure_waybill_pdf_copies\(\)[\s\S]*?snapshot_registration_bank_capture_for_invoice\(new\.id\)/);
assert.match(migration, /case when v_snapshot_id is null then 'blocked_missing_bank_details' else 'pending' end/);
assert.match(migration, /create function public\.save_waybill_company_bank_details\([\s\S]*?private\.require_role\(array\['operations_manager'\]/);
assert.match(migration, /v_account_number !~ '\^\[0-9\]\{10\}\$'/);
assert.match(migration, /pg_advisory_xact_lock[\s\S]*?waybill_company_bank_save_receipts/);
assert.match(migration, /This request identifier was already used with different bank details[\s\S]*?P4091/);
assert.match(migration, /source_kind='registration_capture'[\s\S]*?verified_by is null and verified_at is null/);
assert.match(migration, /'waybill-company-copies'[\s\S]*?v_snapshot_id,false/);
assert.match(migration, /create function public\.get_operations_missing_bank_waybills\(\)[\s\S]*?private\.require_role\(array\['operations_manager'\]/);
assert.match(migration, /trip\.status='closed'[\s\S]*?company_copy\.status='blocked_missing_bank_details'/);
assert.doesNotMatch(migration, /notification_outbox|send_email|http_post/i);
assert.deepEqual([...migration.matchAll(/'WB-2026-0000(?:40|41|42)'/g)].map(match => match[0]).sort(), [
  "'WB-2026-000040'", "'WB-2026-000041'", "'WB-2026-000042'",
]);
assert.doesNotMatch(migration, /delete from public\.trip_closure_invoice_(?:bank_snapshots|bank_submissions|pdf_copies)/i);
assert.match(databaseTest, /automatically snapshots registration banking and releases only its Company PDF/);
assert.match(databaseTest, /registration snapshot preserves source values, actor, timestamp and non-approval provenance/);
assert.match(databaseTest, /one authorized save atomically verifies details and releases Company PDF processing/);
assert.match(databaseTest, /same request replay is idempotent/);
assert.match(databaseTest, /failed audit insert rolls back all bank save writes/);
assert.match(databaseTest, /missing-bank Action Required queue includes only the closed Waybill without a capture/);
assert.match(databaseTest, /bank saving does not enqueue notification delivery or send email as a side effect/);
assert.match(databaseTest, /Company PDF snapshot receives only the invoice-specific saved bank version/);
assert.match(databaseTest, /correction preserves prior snapshot and creates only a new Company PDF version/);
assert.match(databaseTest, /Driver PDF renderer snapshot contains no bank data or driver phone/);
assert.match(loadingAlignmentMigration, /alter table public\.daily_registrations rename column driver_id to initial_driver_id/i);
const registrationSeedColumns = [...databaseTest.matchAll(/insert into public\.daily_registrations\s*\(([^)]*)\)/gi)]
  .map(([, columns]) => columns);
assert.ok(registrationSeedColumns.length > 0, 'registration suite must seed daily registrations');
for (const columns of registrationSeedColumns) {
  assert.match(columns, /\binitial_driver_id\b/i, 'daily registration fixtures must use the post-alignment driver column');
  assert.doesNotMatch(columns, /(^|,)\s*driver_id\s*(,|$)/i, 'daily registration fixtures must not use the pre-alignment driver column');
}
assert.match(waybillService, /save_waybill_company_bank_details/);
assert.match(waybillDetail, /Enter Bank Details[\s\S]*?Account Number[\s\S]*?Save bank details/);
assert.match(waybillDetail, /latest_bank_snapshot_version === null/);
assert.match(waybillDetail, /company_pdf_held_for_missing_bank_details/);
assert.match(dashboardService, /get_operations_missing_bank_waybills/);
assert.match(dashboardService, /const keys = \['invoice_id', 'invoice_number', 'trip_number', 'issued_at'\]/);
assert.match(dashboard, /MissingBankActionCard[\s\S]*?\/operations\/waybills\/\$\{encodeURIComponent\(item\.invoice_id\)\}/);

assert.match(recoverySeed, /WB-2026-'\|\|lpad\(value::text,6,'0'\)/);
assert.match(recoverySeed, /private\.loading_registration_bank_captures/);
assert.match(loadingAlignmentMigration, /assigned_at timestamptz not null default clock_timestamp\(\)/);
assert.match(recoverySeed, /from public\.user_site_assignments[\s\S]*?ended_at is null order by assigned_at desc limit 1/);
assert.doesNotMatch(recoverySeed, /from public\.user_site_assignments[\s\S]*?order by created_at desc/);
assert.match(recoverySeed, /'WB-2026-000043'/);
assert.match(recoveryAssertions, /historical recovery creates invoice snapshots from the correct driver captures/);
assert.match(recoveryAssertions, /no fabricated verification/);
assert.match(recoveryAssertions, /Operations Manager queue reports only the synthetic Waybill still missing bank data/);
assert.match(recoveryAssertions, /e0000000-0000-4000-8000-000000000004/);
assert.match(recoveryAssertions, /e0000000-0000-4000-8000-000000000001/);
assert.match(recoveryAssertions, /Driver PDF jobs remain independent and contain no bank snapshot/);
assert.match(recoveryAssertions, /migration creates no duplicate Driver or Company PDF versions/);
assert.match(recoveryAssertions, /rollback;/i);
assert.match(concurrencyAssertions, /concurrent same-request calls create one immutable bank snapshot/);
assert.match(concurrencyAssertions, /concurrent same-request calls persist one idempotency receipt/);
assert.match(concurrencyAssertions, /rollback;/i);
assert.match(concurrencyGate, /pg_sleep\(6\)/);
assert.match(concurrencyGate, /waybill_company_bank_save_receipts/);
assert.match(concurrencyGateCleanup, /drop trigger if exists zz_ci_company_bank_receipt_gate/);
assert.match(ciRunner, /refs\/heads\/feature\/company-waybill-bank-recovery/);
assert.match(ciRunner, /supabase start --yes --exclude/);
assert.match(ciRunner, /supabase migration up --local/);
assert.match(ciRunner, /wait_event='advisory'/);
assert.match(ciRunner, /run_transactional_suite/);
const fingerprintFunction = ciRunner.match(/fingerprint\(\) \{([\s\S]*?)\n\}/)?.[1];
assert.ok(fingerprintFunction, 'runner must define the persistent-state fingerprint function');
assert.match(fingerprintFunction, /to_regclass\('private\.loading_registration_bank_captures'\) is not null/);
assert.match(fingerprintFunction, /if \[\[ "\$capture_table_exists" == "t" \]\]; then/);
assert.match(fingerprintFunction, /capture_fingerprint_field=.*'captures',.*from private\.loading_registration_bank_captures x\),/);
assert.match(fingerprintFunction, /\$\{capture_fingerprint_field\}/);
assert.match(fingerprintFunction, /to_regclass\('private\.waybill_company_bank_save_receipts'\) is not null/);
assert.match(fingerprintFunction, /if \[\[ "\$receipt_table_exists" == "t" \]\]; then/);
assert.match(fingerprintFunction, /receipt_fingerprint_field=.*'receipts',.*from private\.waybill_company_bank_save_receipts x\),/);
assert.match(fingerprintFunction, /\$\{receipt_fingerprint_field\}/);
assert.match(fingerprintFunction, /from storage\.objects x/);
assert.match(ciRunner, /before=\$\(fingerprint\)\n  run_sql/);
assert.ok(ciRunner.indexOf('run_transactional_suite "hybrid cutover assertions"') < ciRunner.indexOf('apply_migrations "$all_versions"'), 'pre-recovery suites must fingerprint before and after while the receipt table is absent');
assert.ok(ciRunner.indexOf('apply_migrations "$all_versions"') < ciRunner.indexOf('run_transactional_suite "bank snapshot automatic preparation and recovery assertions"'), 'post-recovery suite must fingerprint with the receipt table present');
assert.match(fingerprintFunction, /receipts/);
const v3CheckpointIndex = ciRunner.indexOf('apply_migrations "$v3_versions"');
const hybridSuiteIndex = ciRunner.indexOf('run_transactional_suite "hybrid cutover assertions"');
const v4MigrationCopyIndex = ciRunner.indexOf('copy_migration "$repo_root/supabase/migrations" 20261016000100_loading_registration_bank_capture.sql');
const v4CheckpointIndex = ciRunner.indexOf('apply_migrations "$v4_versions"');
assert.ok(v3CheckpointIndex < hybridSuiteIndex && hybridSuiteIndex < v4MigrationCopyIndex, 'hybrid assertions must execute after migration 000050 and before V4 migration 00100');
assert.ok(v4MigrationCopyIndex < v4CheckpointIndex, 'V4 migration must be staged before its checkpoint is applied');
assert.match(v3RegistrationMigration, /grant execute on function public\.register_loading_participant_v3\([\s\S]*?\)\s*to authenticated;/);
assert.match(v4RegistrationMigration, /revoke all on function public\.register_loading_participant_v3\([\s\S]*?\)\s*from public,anon,authenticated,service_role;/);
assert.match(v4RegistrationMigration, /grant execute on function public\.register_loading_participant_v4\([\s\S]*?\)\s*to authenticated;/);
assert.match(databaseTest, /authenticated can call the versioned registration RPC/);
assert.match(databaseTest, /direct v3 registration is retired after the v4 cutover/);
const secureSuiteIndex = ciRunner.indexOf('run_transactional_suite "secure dual-Waybill suite"');
const fieldSuiteIndex = ciRunner.indexOf('run_transactional_suite "field-session authorization suite"');
const v4SuiteIndex = ciRunner.indexOf('run_transactional_suite "V4 registration bank-capture suite"');
const allVersionsIndex = ciRunner.indexOf('apply_migrations "$all_versions"');
const migrationPreservationIndex = ciRunner.indexOf('PASS migration preserves historical records, Storage objects, and notification outbox.');
const recoverySuiteIndex = ciRunner.indexOf('run_transactional_suite "bank snapshot automatic preparation and recovery assertions"');
const concurrencySuiteIndex = ciRunner.indexOf('run_transactional_suite "concurrent bank-save assertions"');
assert.ok(v4CheckpointIndex < secureSuiteIndex && secureSuiteIndex < fieldSuiteIndex && fieldSuiteIndex < allVersionsIndex && allVersionsIndex < migrationPreservationIndex && migrationPreservationIndex < v4SuiteIndex && v4SuiteIndex < recoverySuiteIndex && recoverySuiteIndex < concurrencySuiteIndex, 'V4 registration assertions requiring the recovery contract must run after all migrations and preservation checks');
assert.match(ciRunner, /for migration in \$predecessor_migrations; do copy_migration "\$repo_root\/supabase\/migrations" "\$migration"; done/);
assert.match(ciRunner, /for migration in \$secure_migrations; do copy_migration "\$repo_root\/supabase\/migrations" "\$migration"; done/);
assert.match(ciRunner, /copy_migration "\$repo_root\/supabase\/migrations" 20261016000050_loading_receipt_v3_operation\.sql/);
assert.match(ciRunner, /copy_migration "\$repo_root\/supabase\/migrations" 20261016000100_loading_registration_bank_capture\.sql/);
assert.doesNotMatch(ciRunner, /copy_migration "\$repo_root\/supabase\/tests\/fixtures\/trakflit-ci\/(?:payment_free_predecessors|dual_waybill|registration)"/);
assert.match(ciRunner, /run_sql "legacy Storage seed" "\$support_fixture_root\/secure_dual_waybill_legacy_storage_seed\.sql"/);
assert.match(ciRunner, /run_sql "historical registration receipt seed" "\$support_fixture_root\/registration_legacy_receipts\.sql"/);
assert.match(ciRunner, /run_transactional_suite "hybrid cutover assertions" "\$support_fixture_root\/hybrid_cutover_assertions\.sql"/);
assert.match(ciRunner, /run_transactional_suite "secure dual-Waybill suite" "\$support_database_test_root\/secure_dual_waybill\.sql"/);
assert.doesNotMatch(ciRunner, /\$repo_root\/supabase\/tests\/(?:fixtures\/(?:secure_dual_waybill_legacy_storage_seed|registration_legacy_receipts|hybrid_cutover_assertions)|database\/secure_dual_waybill)\.sql/);
assert.match(ciRunner, /validate_migration_sources\n/);
assert.match(ciRunner, /\[\[ "\$validated_source_count" == 26 \]\]/);
assert.match(ciRunner, /validate_sql_sources\n/);
assert.ok(ciRunner.indexOf('\nvalidate_sql_sources\n') < ciRunner.indexOf('supabase start --yes --exclude'));
const sqlPreflight = ciRunner.match(/local -a required_sql_files=\(([\s\S]*?)\r?\n  \)/);
assert.ok(sqlPreflight, 'runner must explicitly preflight required SQL inputs');
const expectedSqlInputs = [
  '$fixture_root/hybrid_cutover_seed.sql',
  '$support_fixture_root/secure_dual_waybill_legacy_storage_seed.sql',
  '$support_fixture_root/registration_legacy_receipts.sql',
  '$support_fixture_root/hybrid_cutover_assertions.sql',
  '$support_database_test_root/secure_dual_waybill.sql',
  '$repo_root/supabase/tests/database/field_operational_day_auth.sql',
  '$repo_root/supabase/tests/database/loading_registration_bank_capture.sql',
  '$repo_root/supabase/tests/fixtures/company_waybill_bank_recovery/seed.sql',
  '$repo_root/supabase/tests/database/company_waybill_bank_snapshot_autopreparation.sql',
  '$repo_root/supabase/tests/fixtures/company_waybill_bank_recovery/concurrency_gate.sql',
  '$repo_root/supabase/tests/fixtures/company_waybill_bank_recovery/concurrency_gate_cleanup.sql',
  '$repo_root/supabase/tests/database/company_waybill_bank_concurrency.sql',
];
assert.equal([...sqlPreflight[1].matchAll(/"[^"]+\.sql"/g)].length, expectedSqlInputs.length);
for (const input of expectedSqlInputs) assert.ok(sqlPreflight[1].includes(`"${input}"`), `SQL preflight must include ${input}`);
for (const input of expectedSqlInputs.filter(path => path.startsWith('$repo_root/'))) {
  assert.ok(existsSync(input.replace('$repo_root/', '')), `repository SQL input must exist: ${input}`);
}
assert.ok(ciRunner.indexOf('\nvalidate_migration_sources\n') < ciRunner.indexOf('supabase start --yes --exclude'));
assert.match(ciRunner, /sha256sum --check supabase\/tests\/fixtures\/trakflit-ci\/MIGRATION_SHA256SUMS/);
assert.ok(ciRunner.indexOf('sha256sum --check') < ciRunner.indexOf('supabase start --yes --exclude'));
assert.match(ciRunner, /validate_migration_group "\$fixture_root\/canonical_baseline" "\$canonical_migrations"/);
assert.match(ciRunner, /awk '\{ sub\(\/\\r\$\/, ""\); print \}'/);
const migrationList = name => {
  const match = ciRunner.match(new RegExp(`^${name}="([\\s\\S]*?)"`, 'm'));
  assert.ok(match, `runner must define ${name}`);
  return match[1].split('\n');
};
const migrationsRoot = 'supabase/migrations';
const migrationSources = [
  ...migrationList('canonical_migrations').map(name => `.ci-sql-support/supabase/tests/fixtures/trakflit-ci/canonical_baseline/${name}`),
  `${migrationsRoot}/20261002000200_field_operational_day_auth.sql`,
  ...['predecessor_migrations', 'secure_migrations', 'v4_migrations', 'later_migrations']
    .flatMap(name => migrationList(name).map(migration => `${migrationsRoot}/${migration}`)),
];
assert.equal(migrationSources.length, 26, 'runner source inventory must include exactly 26 migrations');
assert.equal(new Set(migrationSources).size, 26, 'runner source inventory must not contain duplicates');
for (const source of migrationSources.filter(path => path.startsWith(`${migrationsRoot}/`))) {
  assert.ok(existsSync(source), `deployable migration source must exist: ${source}`);
}
const normalizeSqlSnapshot = sql => {
  const normalized = sql.replace(/\r\n/g, '\n');
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
};
const equalSqlSnapshot = (left, right) => normalizeSqlSnapshot(left) === normalizeSqlSnapshot(right);
const sqlSnapshot = 'create function public.example() returns void as $$ select 1; $$ language sql;\n';
assert.equal(equalSqlSnapshot(sqlSnapshot, sqlSnapshot), true, 'identical SQL snapshots must match');
assert.equal(equalSqlSnapshot(sqlSnapshot, sqlSnapshot.replace(/\n/g, '\r\n')), true, 'LF and CRLF snapshots must match');
assert.equal(equalSqlSnapshot(sqlSnapshot, sqlSnapshot.slice(0, -1)), true, 'a missing final newline must not change snapshot equality');
assert.equal(equalSqlSnapshot(sqlSnapshot, sqlSnapshot.replace('select 1', 'select 2')), false, 'changed SQL statements must fail snapshot equality');
assert.equal(equalSqlSnapshot("select 'pending';\n", "select 'ready';\n"), false, 'changed SQL values must fail snapshot equality');
assert.equal(equalSqlSnapshot('grant execute on function public.example() to operations_manager;\n', 'grant execute on function public.example() to authenticated;\n'), false, 'changed permissions must fail snapshot equality');
assert.match(ciRunner, /supabase stop --yes --no-backup/);
assert.match(ciWorkflow, /feature\/company-waybill-bank-recovery/);
assert.match(ciWorkflow, /ref: 16bf4ec5286f8ed5efc225da5456b95fbb7ba4dd/);
assert.match(ciWorkflow, /test "\$\(git -C \.ci-sql-support rev-parse HEAD\)" = "16bf4ec5286f8ed5efc225da5456b95fbb7ba4dd"/);
assert.match(ciWorkflow, /persist-credentials: false/);
assert.doesNotMatch(ciWorkflow, /SUPABASE_ACCESS_TOKEN:|SUPABASE_DB_PASSWORD:|service_role_key:/i);

console.log('PASS snapshot provenance, recovery scope, OPM authorization, concurrent idempotency, no-email boundary, fixture isolation and CI safeguards');
