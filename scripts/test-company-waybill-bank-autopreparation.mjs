import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20261019151115_company_waybill_bank_snapshot_autopreparation.sql', 'utf8');
const databaseTest = readFileSync('supabase/tests/database/loading_registration_bank_capture.sql', 'utf8');
const waybillService = readFileSync('src/features/operations/services/operationsWaybills.ts', 'utf8');
const waybillDetail = readFileSync('src/features/operations/waybillsPayouts/OperationsWaybillDetail.tsx', 'utf8');
const dashboardService = readFileSync('src/features/operations/services/operationsDashboard.ts', 'utf8');
const dashboard = readFileSync('src/features/operations/dashboard/OperationsDashboard.tsx', 'utf8');

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

console.log('PASS automatic snapshot provenance, OPM save authorization, queue scope, no-email boundary, privacy and frontend contracts');
