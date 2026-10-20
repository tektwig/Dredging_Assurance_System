import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20261019151115_company_waybill_bank_snapshot_autopreparation.sql', 'utf8');
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
assert.match(waybillService, /save_waybill_company_bank_details/);
assert.match(waybillDetail, /Enter Bank Details[\s\S]*?Account Number[\s\S]*?Save bank details/);
assert.match(waybillDetail, /latest_bank_snapshot_version === null/);
assert.match(waybillDetail, /company_pdf_held_for_missing_bank_details/);
assert.match(dashboardService, /get_operations_missing_bank_waybills/);
assert.match(dashboardService, /const keys = \['invoice_id', 'invoice_number', 'trip_number', 'issued_at'\]/);
assert.match(dashboard, /MissingBankActionCard[\s\S]*?\/operations\/waybills\/\$\{encodeURIComponent\(item\.invoice_id\)\}/);

assert.match(recoverySeed, /WB-2026-'\|\|lpad\(value::text,6,'0'\)/);
assert.match(recoverySeed, /private\.loading_registration_bank_captures/);
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
assert.match(ciRunner, /for migration in \$predecessor_migrations; do copy_migration "\$repo_root\/supabase\/migrations" "\$migration"; done/);
assert.match(ciRunner, /for migration in \$secure_migrations; do copy_migration "\$repo_root\/supabase\/migrations" "\$migration"; done/);
assert.match(ciRunner, /copy_migration "\$repo_root\/supabase\/migrations" 20261016000050_loading_receipt_v3_operation\.sql/);
assert.match(ciRunner, /copy_migration "\$repo_root\/supabase\/migrations" 20261016000100_loading_registration_bank_capture\.sql/);
assert.doesNotMatch(ciRunner, /copy_migration "\$repo_root\/supabase\/tests\/fixtures\/trakflit-ci\/(?:payment_free_predecessors|dual_waybill|registration)"/);
assert.match(ciRunner, /validate_migration_sources\n/);
assert.match(ciRunner, /\[\[ "\$validated_source_count" == 26 \]\]/);
assert.ok(ciRunner.indexOf('\nvalidate_migration_sources\n') < ciRunner.indexOf('supabase start --yes --exclude'));
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
assert.match(ciWorkflow, /persist-credentials: false/);
assert.doesNotMatch(ciWorkflow, /SUPABASE_ACCESS_TOKEN:|SUPABASE_DB_PASSWORD:|service_role_key:/i);

console.log('PASS snapshot provenance, recovery scope, OPM authorization, concurrent idempotency, no-email boundary, fixture isolation and CI safeguards');
