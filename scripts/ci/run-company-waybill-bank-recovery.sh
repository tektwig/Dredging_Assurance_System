#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

repo_root="$GITHUB_WORKSPACE"
runner_temp="$RUNNER_TEMP"
secure_email_cutover="${RUN_SECURE_EMAIL_CUTOVER:-false}"
project_prefix="cwbr"
expected_branch="refs/heads/feature/company-waybill-bank-recovery"
if [[ "$secure_email_cutover" == true ]]; then
  project_prefix="sedc"
  expected_branch="refs/heads/feature/secure-email-delivery-cutover"
elif [[ "$secure_email_cutover" != false ]]; then
  printf 'ERROR: RUN_SECURE_EMAIL_CUTOVER must be true or false.\n' >&2
  exit 1
fi
project_id="$project_prefix-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
project_root="$runner_temp/$project_id"
support_root="$repo_root/.ci-sql-support"
fixture_root="$support_root/supabase/tests/fixtures/trakflit-ci"
support_fixture_root="$support_root/supabase/tests/fixtures"
support_database_test_root="$support_root/supabase/tests/database"
migration_dir="$project_root/supabase/migrations"
start_log="$runner_temp/$project_id-start.log"
start_attempted=false
project_dir_created=false
db_container=""
excluded_services="realtime,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor"

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

cleanup() {
  result=$?
  trap - EXIT
  set +e
  if [[ "$project_dir_created" == true ]]; then
    if [[ "$start_attempted" == true ]]; then
      supabase stop --yes --no-backup --workdir "$project_root" >/dev/null 2>&1
    fi
    case "$project_root" in
      "$runner_temp"/cwbr-*|"$runner_temp"/sedc-*) [[ ! -d "$project_root" ]] || rm -rf -- "$project_root" ;;
      *) printf 'Refusing cleanup outside the unique runner temp directory.\n' >&2 ;;
    esac
    find "$runner_temp" -maxdepth 1 -type f \( -name "$project_id-*.log" -o -name "$project_id-*.exit" \) -delete
  fi
  exit "$result"
}
trap cleanup EXIT

redact_log() {
  sed -E \
    -e 's/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/[REDACTED_JWT]/g' \
    -e 's/sb_(publishable|secret)_[A-Za-z0-9_-]+/[REDACTED_SUPABASE_KEY]/g' \
    -e 's/(password|secret|token|api[_ -]?key|anon[_ -]?key|service[_ -]?role[_ -]?key)([[:space:]]*[:=][[:space:]]*)[^[:space:],;]+/\1\2[REDACTED]/Ig' \
    -e 's#(postgres(ql)?://)[^[:space:]]+#\1[REDACTED_CONNECTION_STRING]#Ig' \
    -e 's/CI Concurrent Bank/[REDACTED_BANK_NAME]/Ig' \
    -e 's/CI Synthetic Bank/[REDACTED_BANK_NAME]/Ig' \
    -e 's/CI Synthetic Account/[REDACTED_ACCOUNT_NAME]/Ig' \
    -e 's/Synthetic recovery driver 43/[REDACTED_ACCOUNT_NAME]/Ig' \
    -e 's/[0-9]{10,}/[REDACTED_NUMBER]/g' \
    -e 's/[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}/[REDACTED_EMAIL]/g'
}

[[ -n "$GITHUB_RUN_ID" && -n "$GITHUB_RUN_ATTEMPT" && -n "$GITHUB_WORKSPACE" && -n "$RUNNER_TEMP" ]] || fail "GitHub runner identity is incomplete."
[[ "$GITHUB_REF" == "$expected_branch" ]] || fail "This workflow only runs on its authorized feature branch."
[[ "$project_id" =~ ^[a-z0-9-]{1,40}$ ]] || fail "Temporary Supabase project ID is invalid."
[[ ! -e "$project_root" ]] || fail "Unique temporary project path already exists."
[[ -d "$fixture_root" ]] || fail "Pinned SQL support fixture is missing."
[[ "$(supabase --version)" == 2.120.0 ]] || fail "Unexpected Supabase CLI version."
[[ -z "$(docker ps -aq --filter "label=com.supabase.cli.project=$project_id")" ]] || fail "A Docker resource already uses the generated temporary project ID."
(
  cd "$repo_root/.ci-sql-support"
  sha256sum --check supabase/tests/fixtures/trakflit-ci/MIGRATION_SHA256SUMS >/dev/null
)

unset SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SUPABASE_PROJECT_REF SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY
mkdir -m 700 -- "$project_root"
project_dir_created=true
supabase init --yes --workdir "$project_root" >/dev/null
config_file="$project_root/supabase/config.toml"
sed -i -E "s/^project_id = .*/project_id = \"$project_id\"/" "$config_file"
if grep -q '^major_version = ' "$config_file"; then
  sed -i -E 's/^major_version = .*/major_version = 17/' "$config_file"
else
  sed -i '/^\[db\]$/a major_version = 17' "$config_file"
fi
grep -q "^project_id = \"$project_id\"$" "$config_file" || fail "Temporary project ID was not written to its isolated config."
grep -q '^major_version = 17$' "$config_file" || fail "Temporary database is not configured for PostgreSQL 17."
mkdir -p -- "$migration_dir"

canonical_migrations="20260921000100_canonical_payment_free_baseline.sql
20260921000200_canonical_operational_rpcs.sql
20260924000100_canonical_loading_alignment.sql
20260924000200_loading_read_scope_security.sql
20260925000200_canonical_waybill_schema.sql
20260925000400_offloading_alignment.sql
20260927000100_waybill_pdf_infrastructure.sql
20260927000150_canonical_waybill_pdf_access.sql
20260927001150_canonical_scan_first_estimated_tonnage.sql
20261002000100_operations_analytics.sql
20261002000300_operations_analytics_summaries.sql
20261002000400_operations_analytics_preset_forwarding.sql
20261005000600_canonical_waybill_number_prefix.sql"
predecessor_migrations="20261009000000_payment_free_waybill_cutover.sql
20261010000100_payment_free_operations_read_models.sql
20261011000050_truck_type_text.sql
20261011000100_payment_free_loading_registration.sql
20261012000100_operations_analytics_payment_free.sql
20261013000100_waybill_storage_role_alignment.sql"
secure_migrations="20261013000200_secure_dual_waybill_foundation.sql
20261013000300_secure_notification_payloads.sql"
v4_migrations="20261016000050_loading_receipt_v3_operation.sql
20261016000100_loading_registration_bank_capture.sql"
later_migrations="20261018124936_restore_operations_trip_detail_payout.sql
20261019151115_company_waybill_bank_snapshot_autopreparation.sql"
baseline_versions="20260921000100,20260921000200,20260924000100,20260924000200,20260925000200,20260925000400,20260927000100,20260927000150,20260927001150,20261002000100,20261002000200,20261002000300,20261002000400,20261005000600"
predecessor_versions="$baseline_versions,20261009000000,20261010000100,20261011000050,20261011000100,20261012000100,20261013000100"
secure_versions="$predecessor_versions,20261013000200,20261013000300"
v3_versions="$secure_versions,20261016000050"
v4_versions="$v3_versions,20261016000100"
later_versions="$v4_versions,20261018124936"
all_versions="$later_versions,20261019151115"

copy_migration() {
  source_file="$1/$2"
  [[ -f "$source_file" ]] || fail "Required migration is missing: $2"
  cp -- "$source_file" "$migration_dir/$2"
}

assert_staged_count() {
  count=$(find "$migration_dir" -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ')
  [[ "$count" == "$1" ]] || fail "Expected $1 staged migrations, found $count."
}

copy_support_group() {
  source_dir="$1"
  list="$2"
  while IFS= read -r migration; do
    [[ -n "$migration" ]] || continue
    copy_migration "$source_dir" "$migration"
  done <<< "$list"
}

validate_migration_group() {
  local source_dir="$1"
  local list="$2"
  local migration
  while IFS= read -r migration; do
    [[ -n "$migration" ]] || continue
    [[ -f "$source_dir/$migration" ]] || fail "Required migration source is missing: $migration"
    validated_source_count=$((validated_source_count + 1))
  done <<< "$list"
}

validate_migration_sources() {
  local validated_source_count=0
  validate_migration_group "$fixture_root/canonical_baseline" "$canonical_migrations"
  validate_migration_group "$repo_root/supabase/migrations" "20261002000200_field_operational_day_auth.sql"
  validate_migration_group "$repo_root/supabase/migrations" "$predecessor_migrations"
  validate_migration_group "$repo_root/supabase/migrations" "$secure_migrations"
  validate_migration_group "$repo_root/supabase/migrations" "$v4_migrations"
  validate_migration_group "$repo_root/supabase/migrations" "$later_migrations"
  if [[ "$secure_email_cutover" == true ]]; then
    validate_migration_group "$repo_root/supabase/migrations" "20261021000000_secure_waybill_email_delivery_cutover.sql"
    validate_migration_group "$repo_root/supabase/migrations" "20261021133526_secure_synthetic_waybill_email_canary.sql"
    validate_migration_group "$repo_root/supabase/migrations" "20261022085737_company_waybill_verified_bank_eligibility.sql"
    [[ -f "$repo_root/supabase/tests/fixtures/secure_email_delivery_cutover/seed.sql" ]] || fail "Secure email cutover seed fixture is missing."
    [[ -f "$repo_root/supabase/tests/database/secure_email_delivery_cutover.sql" ]] || fail "Secure email cutover SQL suite is missing."
    [[ -f "$repo_root/supabase/tests/fixtures/secure_email_delivery_cutover/canary_provision.sql" ]] || fail "Synthetic email canary provisioning fixture is missing."
    [[ -f "$repo_root/supabase/tests/database/secure_synthetic_email_canary.sql" ]] || fail "Synthetic email canary SQL suite is missing."
    [[ -f "$repo_root/supabase/tests/fixtures/secure_email_delivery_cutover/canary_concurrency_gate.sql" ]] || fail "Synthetic email concurrency gate fixture is missing."
    [[ -f "$repo_root/supabase/tests/fixtures/secure_email_delivery_cutover/canary_concurrency_gate_cleanup.sql" ]] || fail "Synthetic email concurrency gate cleanup is missing."
    [[ -f "$repo_root/supabase/tests/fixtures/secure_email_delivery_cutover/company_verified_bank_attempt_cleanup_seed.sql" ]] || fail "Verified-bank attempt-cleanup fixture is missing."
    [[ -f "$repo_root/supabase/tests/database/company_waybill_verified_bank_eligibility.sql" ]] || fail "Verified-bank eligibility SQL suite is missing."
    [[ "$validated_source_count" == 29 ]] || fail "Expected 29 migration sources for secure email verification hardening, validated $validated_source_count."
  else
    [[ "$validated_source_count" == 26 ]] || fail "Expected 26 migration sources, validated $validated_source_count."
  fi
  printf 'PASS preflight: validated all %s migration sources before database startup.\n' "$validated_source_count"
}

validate_sql_sources() {
  local sql_file
  local -a required_sql_files=(
    "$fixture_root/hybrid_cutover_seed.sql"
    "$support_fixture_root/secure_dual_waybill_legacy_storage_seed.sql"
    "$support_fixture_root/registration_legacy_receipts.sql"
    "$support_fixture_root/hybrid_cutover_assertions.sql"
    "$support_database_test_root/secure_dual_waybill.sql"
    "$repo_root/supabase/tests/database/field_operational_day_auth.sql"
    "$repo_root/supabase/tests/database/loading_registration_bank_capture.sql"
    "$repo_root/supabase/tests/fixtures/company_waybill_bank_recovery/seed.sql"
    "$repo_root/supabase/tests/database/company_waybill_bank_snapshot_autopreparation.sql"
    "$repo_root/supabase/tests/fixtures/company_waybill_bank_recovery/concurrency_gate.sql"
    "$repo_root/supabase/tests/fixtures/company_waybill_bank_recovery/concurrency_gate_cleanup.sql"
    "$repo_root/supabase/tests/database/company_waybill_bank_concurrency.sql"
  )
  for sql_file in "${required_sql_files[@]}"; do
    [[ -f "$sql_file" ]] || fail "Required SQL fixture or test suite is missing: $sql_file"
  done
  if [[ "$secure_email_cutover" == true ]]; then
    [[ -f "$repo_root/supabase/tests/fixtures/secure_email_delivery_cutover/seed.sql" ]] || fail "Secure email cutover seed fixture is missing."
    [[ -f "$repo_root/supabase/tests/database/secure_email_delivery_cutover.sql" ]] || fail "Secure email cutover SQL suite is missing."
    [[ -f "$repo_root/supabase/tests/fixtures/secure_email_delivery_cutover/canary_provision.sql" ]] || fail "Synthetic email canary provisioning fixture is missing."
    [[ -f "$repo_root/supabase/tests/database/secure_synthetic_email_canary.sql" ]] || fail "Synthetic email canary SQL suite is missing."
    [[ -f "$repo_root/supabase/tests/fixtures/secure_email_delivery_cutover/canary_concurrency_gate.sql" ]] || fail "Synthetic email concurrency gate fixture is missing."
    [[ -f "$repo_root/supabase/tests/fixtures/secure_email_delivery_cutover/canary_concurrency_gate_cleanup.sql" ]] || fail "Synthetic email concurrency gate cleanup is missing."
  fi
  printf 'PASS preflight: validated all %s SQL fixtures and test suites before database startup.\n' "${#required_sql_files[@]}"
}

validate_sql_sources
validate_migration_sources

copy_support_group "$fixture_root/canonical_baseline" "$canonical_migrations"
copy_migration "$repo_root/supabase/migrations" 20261002000200_field_operational_day_auth.sql
assert_staged_count 14

verify_snapshot() {
  migration="$1"
  case "$migration" in
    20261009*|20261010*|20261011*|20261012*|20261013000100*) snapshot="$fixture_root/payment_free_predecessors/$migration" ;;
    20261013000200*|20261013000300*) snapshot="$fixture_root/dual_waybill/$migration" ;;
    202610160*) snapshot="$fixture_root/registration/$migration" ;;
    *) return 0 ;;
  esac
  diff -q \
    <(awk '{ sub(/\r$/, ""); print }' "$repo_root/supabase/migrations/$migration") \
    <(awk '{ sub(/\r$/, ""); print }' "$snapshot") >/dev/null \
    || fail "Deployable migration differs from the checksum-pinned, previously tested source: $migration"
}

for migration in $predecessor_migrations $secure_migrations $v4_migrations; do verify_snapshot "$migration"; done

start_attempted=true
if ! supabase start --yes --exclude "$excluded_services" --workdir "$project_root" >"$start_log" 2>&1; then
  printf 'Supabase startup failed for isolated project %s. Redacted diagnostics follow:\n' "$project_id" >&2
  redact_log <"$start_log" | tail -n 60 >&2
  fail "Disposable Supabase PostgreSQL startup failed."
fi

mapfile -t db_containers < <(docker ps --filter "label=com.supabase.cli.project=$project_id" --format '{{.Names}}' | grep '^supabase_db_' || true)
[[ "${#db_containers[@]}" == 1 ]] || fail "Could not identify exactly one database for the unique temporary project."
db_container="${db_containers[0]}"
db_label=$(docker inspect --format '{{ index .Config.Labels "com.supabase.cli.project" }}' "$db_container")
[[ "$db_label" == "$project_id" ]] || fail "Database container label does not match the temporary project ID."
db_identity=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "select current_database() || '|' || split_part(current_setting('server_version'),'.',1)")
[[ "$db_identity" == postgres\|17 ]] || fail "Unexpected test database identity or PostgreSQL major version."
printf 'Isolated test database ready: project=%s PostgreSQL=%s\n' "$project_id" "${db_identity#*|}"

assert_ledger() {
  expected="$1"
  actual=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "select string_agg(version::text,',' order by version::text) from supabase_migrations.schema_migrations")
  [[ "$actual" == "$expected" ]] || fail "Migration ledger differs from the expected staged sequence."
}

apply_migrations() {
  expected="$1"
  if ! supabase migration up --local --workdir "$project_root" >"$runner_temp/$project_id-migration.log" 2>&1; then
    printf 'Migration application failed. Redacted diagnostics follow:\n' >&2
    redact_log <"$runner_temp/$project_id-migration.log" | tail -n 80 >&2
    fail "Local migration application failed."
  fi
  assert_ledger "$expected"
  printf 'PASS migration ledger (%s versions): %s\n' "$(printf '%s' "$expected" | awk -F, '{print NF}')" "$expected"
}

run_sql() {
  label="$1"
  sql_file="$2"
  log_file="$runner_temp/$project_id-$label.log"
  [[ -f "$sql_file" ]] || fail "SQL suite or fixture is missing: $label"
  if docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -f - <"$sql_file" >"$log_file" 2>&1; then
    assertions=$(grep -c 'ASSERTION PASS:' "$log_file" || true)
    printf 'PASS SQL suite: %s (assertions=%s)\n' "$label" "$assertions"
    return 0
  fi
  printf 'FAIL SQL suite: %s. Redacted database diagnostics follow:\n' "$label" >&2
  redact_log <"$log_file" | grep -E 'ERROR:|FATAL:|psql: error:|ASSERTION PASS:' | tail -n 35 >&2 || true
  return 1
}

fingerprint() {
  local capture_table_exists
  local capture_fingerprint_field=""
  local receipt_table_exists
  local receipt_fingerprint_field=""
  local canary_table_exists
  local canary_fingerprint_field=""
  capture_table_exists=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "select to_regclass('private.loading_registration_bank_captures') is not null")
  if [[ "$capture_table_exists" == "t" ]]; then
    capture_fingerprint_field="'captures',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from private.loading_registration_bank_captures x),"
  fi
  receipt_table_exists=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "select to_regclass('private.waybill_company_bank_save_receipts') is not null")
  if [[ "$receipt_table_exists" == "t" ]]; then
    receipt_fingerprint_field="'receipts',(select coalesce(jsonb_agg(to_jsonb(x) order by x.actor_id,x.request_id),'[]'::jsonb) from private.waybill_company_bank_save_receipts x),"
  fi
  canary_table_exists=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "select to_regclass('private.waybill_notification_canary_runs') is not null")
  if [[ "$canary_table_exists" == "t" ]]; then
    canary_fingerprint_field="'notification_canary_runs',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from private.waybill_notification_canary_runs x),"
  fi
  docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "
    select md5(jsonb_build_object(
      'users',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from auth.users x),
      'sessions',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from auth.sessions x),
      'profiles',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.profiles x),
      'audit_log',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.audit_log x),
      'sites',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.sites x),
      'assignments',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.user_site_assignments x),
      'drivers',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.drivers x),
      'trucks',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trucks x),
      'registrations',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.daily_registrations x),
      'trips',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trips x),
      'invoices',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trip_closure_invoices x),
      'legacy_documents',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trip_closure_invoice_documents x),
      'copies',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trip_closure_invoice_pdf_copies x),
      'payments',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trip_payments x),
      'notifications',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.notification_outbox x),
      ${capture_fingerprint_field}
      'submissions',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trip_closure_invoice_bank_submissions x),
      'snapshots',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trip_closure_invoice_bank_snapshots x),
      'events',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trip_closure_invoice_bank_detail_events x),
      ${receipt_fingerprint_field}
      ${canary_fingerprint_field}
      'storage',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from storage.objects x)
    )::text)"
}

run_transactional_suite() {
  before=$(fingerprint)
  run_sql "$1" "$2"
  after=$(fingerprint)
  [[ "$before" == "$after" ]] || fail "Transactional suite changed persistent database state: $1"
  printf 'PASS transaction rollback: %s\n' "$1"
}

migration_preservation_fingerprint() {
  docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "
    select md5(jsonb_build_object(
      'trips',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trips x),
      'invoices',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trip_closure_invoices x),
      'legacy_documents',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trip_closure_invoice_documents x),
      'drivers',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.drivers x),
      'trucks',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trucks x),
      'payments',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trip_payments x),
      'audit_log',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.audit_log x),
      'captures',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from private.loading_registration_bank_captures x),
      'notifications',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.notification_outbox x),
      'storage',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from storage.objects x)
    )::text)"
}

secure_email_hardening_fingerprint() {
  docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "
    select md5(jsonb_build_object(
      'trips',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trips x),
      'invoices',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trip_closure_invoices x),
      'legacy_documents',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trip_closure_invoice_documents x),
      'drivers',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.drivers x),
      'trucks',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trucks x),
      'payments',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trip_payments x),
      'audit_log',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.audit_log x),
      'captures',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from private.loading_registration_bank_captures x),
      'bank_submissions',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trip_closure_invoice_bank_submissions x),
      'bank_snapshots',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trip_closure_invoice_bank_snapshots x),
      'bank_events',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trip_closure_invoice_bank_detail_events x),
      'pdf_copies',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trip_closure_invoice_pdf_copies x),
      'bank_save_receipts',(select coalesce(jsonb_agg(to_jsonb(x) order by x.invoice_id,x.actor_id,x.request_id),'[]'::jsonb) from private.waybill_company_bank_save_receipts x),
      'notifications',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.notification_outbox x),
      'canary_runs',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from private.waybill_notification_canary_runs x),
      'canary_permits',(select coalesce(jsonb_agg(to_jsonb(x) order by x.trip_id),'[]'::jsonb) from private.waybill_synthetic_email_canary_permits x),
      'storage',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from storage.objects x)
    )::text)"
}

cd "$fixture_root/canonical_baseline"
baseline_list="20260921000100,20260921000200,20260924000100,20260924000200,20260925000200,20260925000400,20260927000100,20260927000150,20260927001150,20261002000100,20261002000200,20261002000300,20261002000400,20261005000600"
cd "$repo_root"
apply_migrations "$baseline_list"
run_sql "synthetic hybrid seed" "$fixture_root/hybrid_cutover_seed.sql"

for migration in $predecessor_migrations; do copy_migration "$repo_root/supabase/migrations" "$migration"; done
assert_staged_count 20
apply_migrations "$predecessor_versions"
run_sql "legacy Storage seed" "$support_fixture_root/secure_dual_waybill_legacy_storage_seed.sql"

for migration in $secure_migrations; do copy_migration "$repo_root/supabase/migrations" "$migration"; done
assert_staged_count 22
apply_migrations "$secure_versions"
run_sql "historical registration receipt seed" "$support_fixture_root/registration_legacy_receipts.sql"
copy_migration "$repo_root/supabase/migrations" 20261016000050_loading_receipt_v3_operation.sql
assert_staged_count 23
apply_migrations "$v3_versions"
run_transactional_suite "hybrid cutover assertions" "$support_fixture_root/hybrid_cutover_assertions.sql"
copy_migration "$repo_root/supabase/migrations" 20261016000100_loading_registration_bank_capture.sql
assert_staged_count 24
apply_migrations "$v4_versions"
copy_migration "$repo_root/supabase/migrations" 20261018124936_restore_operations_trip_detail_payout.sql
assert_staged_count 25
apply_migrations "$later_versions"

run_transactional_suite "secure dual-Waybill suite" "$support_database_test_root/secure_dual_waybill.sql"
run_transactional_suite "field-session authorization suite" "$repo_root/supabase/tests/database/field_operational_day_auth.sql"

run_sql "synthetic Company Waybill recovery seed" "$repo_root/supabase/tests/fixtures/company_waybill_bank_recovery/seed.sql"
before_preservation=$(migration_preservation_fingerprint)
outbox_before=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb)::text) from public.notification_outbox x")
copy_migration "$repo_root/supabase/migrations" 20261019151115_company_waybill_bank_snapshot_autopreparation.sql
assert_staged_count 26
apply_migrations "$all_versions"
[[ "$before_preservation" == "$(migration_preservation_fingerprint)" ]] || fail "Recovery migration changed immutable trips, invoices, legacy documents, driver/truck records, registration captures, notifications, or Storage objects."
[[ "$outbox_before" == "$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb)::text) from public.notification_outbox x")" ]] || fail "Recovery migration modified notification-outbox records."
printf 'PASS migration preserves historical records, Storage objects, and notification outbox.\n'
run_transactional_suite "V4 registration bank-capture suite" "$repo_root/supabase/tests/database/loading_registration_bank_capture.sql"
run_transactional_suite "bank snapshot automatic preparation and recovery assertions" "$repo_root/supabase/tests/database/company_waybill_bank_snapshot_autopreparation.sql"

run_sql "concurrency gate setup" "$repo_root/supabase/tests/fixtures/company_waybill_bank_recovery/concurrency_gate.sql"
run_race_call() {
  local app_name="$1"
  local log_file="$runner_temp/$project_id-$app_name.log"
  local status_file="$runner_temp/$project_id-$app_name.exit"
  local client_status
  if docker exec -i --env "PGAPPNAME=$app_name" "$db_container" psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d postgres >"$log_file" 2>&1 <<'SQL'
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000003',true);
select * from public.save_waybill_company_bank_details(
  'e7000000-0000-4000-8000-000000000043','e9000000-0000-4000-8000-000000000001',
  'CI Concurrent Bank','Synthetic recovery driver 43','9300000043');
commit;
SQL
  then
    client_status=0
  else
    client_status=$?
  fi
  printf '%s\n' "$client_status" >"$status_file"
  return "$client_status"
}
race_client_diagnostics() {
  local app_name="$1"
  local log_file="$runner_temp/$project_id-$app_name.log"
  local status_file="$runner_temp/$project_id-$app_name.exit"
  if [[ -f "$status_file" ]]; then
    printf 'Race client %s exit status: %s\n' "$app_name" "$(cat "$status_file")" >&2
  else
    printf 'Race client %s exit status: still running (no exit marker)\n' "$app_name" >&2
  fi
  if [[ -s "$log_file" ]]; then
    printf 'Race client %s redacted PostgreSQL diagnostics:\n' "$app_name" >&2
    redact_log <"$log_file" | grep -E '^(ERROR:|DETAIL:|HINT:|FATAL:|psql: error:)' | tail -n 20 >&2 || true
  else
    printf 'Race client %s captured no PostgreSQL error output.\n' "$app_name" >&2
  fi
}

stop_race_client() {
  local app_name="$1"
  local client_pid="$2"
  local wait_status
  if kill -0 "$client_pid" 2>/dev/null; then
    kill "$client_pid" 2>/dev/null || true
  fi
  if wait "$client_pid"; then
    wait_status=0
  else
    wait_status=$?
  fi
  printf 'Race client %s process wait status: %s\n' "$app_name" "$wait_status" >&2
}

wait_for_pg_state() {
  local app_name="$1"
  local event_type="$2"
  local event_name="$3"
  local observer_app="cwbrmon_${app_name}_${event_name}"
  local observer_log="$runner_temp/$project_id-observer-$app_name-$event_name.log"
  local observer_sql="$project_root/wait-for-race-state.sql"
  printf "select set_config('ci.expected_app','%s',false);\nselect set_config('ci.expected_event_type','%s',false);\nselect set_config('ci.expected_event','%s',false);\n" \
    "$app_name" "$event_type" "$event_name" >"$observer_sql"
  cat >>"$observer_sql" <<'SQL'
do $wait$
declare
  v_expected_app text := current_setting('ci.expected_app');
  v_expected_event_type text := current_setting('ci.expected_event_type');
  v_expected_event text := current_setting('ci.expected_event');
  v_deadline timestamptz := clock_timestamp() + interval '30 seconds';
  v_session_seen boolean := false;
begin
  loop
    perform pg_catalog.pg_stat_clear_snapshot();
    if exists (
      select 1 from pg_catalog.pg_stat_activity
      where application_name=v_expected_app
        and wait_event_type=v_expected_event_type
        and wait_event=v_expected_event
    ) then
      raise notice 'Observed expected PostgreSQL session wait state.';
      return;
    end if;
    if exists (
      select 1 from pg_catalog.pg_stat_activity
      where application_name=v_expected_app
    ) then
      v_session_seen:=true;
    elsif v_session_seen then
      raise exception 'Observed race session exited before the expected wait state' using errcode='P0001';
    end if;
    if clock_timestamp()>=v_deadline then
      raise exception 'Timed out waiting for the expected race session wait state' using errcode='P0001';
    end if;
    perform pg_catalog.pg_sleep(0.05);
  end loop;
end;
$wait$;
SQL
  docker exec --env "PGAPPNAME=$observer_app" -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d postgres \
    -f - <"$observer_sql" >"$observer_log" 2>&1
}

wait_for_canary_lock_contention() {
  local app_a="$1"
  local app_b="$2"
  local observer_app="cwbrmon_${app_a}_and_${app_b}"
  local observer_log="$runner_temp/$project_id-observer-$app_a-$app_b-lock.log"
  local observer_sql="$project_root/wait-for-canary-lock-contention.sql"
  printf "select set_config('ci.canary_app_a','%s',false);\nselect set_config('ci.canary_app_b','%s',false);\n" \
    "$app_a" "$app_b" >"$observer_sql"
  cat >>"$observer_sql" <<'SQL'
do $wait$
declare
  v_app_a text := current_setting('ci.canary_app_a');
  v_app_b text := current_setting('ci.canary_app_b');
  v_deadline timestamptz := clock_timestamp() + interval '30 seconds';
  v_a_sleeping boolean := false;
  v_b_waiting boolean := false;
  v_states text;
begin
  loop
    perform pg_catalog.pg_stat_clear_snapshot();
    select
      coalesce(bool_or(application_name=v_app_a and state='active'
        and wait_event_type='Timeout' and wait_event='PgSleep'),false),
      coalesce(bool_or(application_name=v_app_b and state='active'
        and wait_event_type='Lock' and wait_event='advisory'),false),
      coalesce(string_agg(application_name||'|'||coalesce(state,'')||'|'
        ||coalesce(wait_event_type,'')||'|'||coalesce(wait_event,''),';'
        order by application_name),'no canary claim sessions')
    into v_a_sleeping,v_b_waiting,v_states
    from pg_catalog.pg_stat_activity
    where application_name in (v_app_a,v_app_b);
    if v_a_sleeping and v_b_waiting then
      raise notice 'Observed client A in PgSleep and client B waiting on advisory lock in the same fresh activity snapshot.';
      return;
    end if;
    if clock_timestamp()>=v_deadline then
      raise exception 'Timed out waiting for serialized canary contention; client_a_pg_sleep=%, client_b_advisory_lock=%, sessions=%',
        v_a_sleeping,v_b_waiting,v_states using errcode='P0001';
    end if;
    perform pg_catalog.pg_sleep(0.05);
  end loop;
end;
$wait$;
SQL
  docker exec --env "PGAPPNAME=$observer_app" -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U postgres -d postgres \
    -f - <"$observer_sql" >"$observer_log" 2>&1
}

wait_for_observer_start() {
  local observer_app="$1"
  local active
  for attempt in $(seq 1 120); do
    active=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
      -c "select count(*) from pg_catalog.pg_stat_activity where application_name='$observer_app' and state='active'")
    if [[ "$active" -ge 1 ]]; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

wait_for_pg_state cwbrace_a Timeout PgSleep & gate_observer_pid=$!
if ! wait_for_observer_start cwbrmon_cwbrace_a_PgSleep; then
  printf 'Gate observer did not become active before the first race client.\n' >&2
  stop_race_client gate-observer "$gate_observer_pid"
  redact_log <"$runner_temp/$project_id-observer-cwbrace_a-PgSleep.log" | grep -E '^(ERROR:|DETAIL:|HINT:|FATAL:|psql: error:)' | tail -n 20 >&2 || true
  fail "Could not start the PostgreSQL gate observer."
fi
concurrency_outbox_before=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb)::text) from public.notification_outbox x")
concurrency_driver_pdf_before=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb)::text) from public.trip_closure_invoice_pdf_copies x where x.invoice_id='e7000000-0000-4000-8000-000000000043' and x.copy_kind='driver'")
run_race_call cwbrace_a & race_a_pid=$!
if wait "$gate_observer_pid"; then
  gate_observer_status=0
else
  gate_observer_status=$?
fi
if [[ "$gate_observer_status" -ne 0 ]]; then
  printf 'Concurrency gate state: ' >&2
  docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "select coalesce(string_agg(application_name||'|'||coalesce(state,'')||'|'||coalesce(wait_event_type,'')||'|'||coalesce(wait_event,''),';' order by application_name),'no race sessions') from pg_stat_activity where application_name in ('cwbrace_a','cwbrace_b')" >&2 || true
  printf 'Gate observer diagnostics:\n' >&2
  redact_log <"$runner_temp/$project_id-observer-cwbrace_a-PgSleep.log" | grep -E '^(ERROR:|DETAIL:|HINT:|FATAL:|psql: error:)' | tail -n 20 >&2 || true
  race_client_diagnostics cwbrace_a
  stop_race_client cwbrace_a "$race_a_pid"
  fail "First concurrent request did not reach the synthetic receipt sleep gate."
fi
printf 'PASS first concurrent request reached the synthetic receipt sleep gate.\n'
wait_for_pg_state cwbrace_b Lock advisory & lock_observer_pid=$!
if ! wait_for_observer_start cwbrmon_cwbrace_b_advisory; then
  printf 'Lock observer did not become active before the second race client.\n' >&2
  race_client_diagnostics cwbrace_a
  stop_race_client cwbrace_a "$race_a_pid"
  stop_race_client lock-observer "$lock_observer_pid"
  redact_log <"$runner_temp/$project_id-observer-cwbrace_b-advisory.log" | grep -E '^(ERROR:|DETAIL:|HINT:|FATAL:|psql: error:)' | tail -n 20 >&2 || true
  fail "Could not start the PostgreSQL lock observer."
fi
run_race_call cwbrace_b & race_b_pid=$!
if wait "$lock_observer_pid"; then
  lock_observer_status=0
else
  lock_observer_status=$?
fi
if [[ "$lock_observer_status" -ne 0 ]]; then
  printf 'Race session state: ' >&2
  docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "select coalesce(string_agg(application_name||'|'||coalesce(state,'')||'|'||coalesce(wait_event_type,'')||'|'||coalesce(wait_event,''),';' order by application_name),'no race sessions') from pg_stat_activity where application_name in ('cwbrace_a','cwbrace_b')" >&2 || true
  printf 'Lock observer diagnostics:\n' >&2
  redact_log <"$runner_temp/$project_id-observer-cwbrace_b-advisory.log" | grep -E '^(ERROR:|DETAIL:|HINT:|FATAL:|psql: error:)' | tail -n 20 >&2 || true
  race_client_diagnostics cwbrace_a
  race_client_diagnostics cwbrace_b
  stop_race_client cwbrace_a "$race_a_pid"
  stop_race_client cwbrace_b "$race_b_pid"
  fail "Second concurrent request did not wait on the invoice advisory lock."
fi
printf 'PASS second concurrent request waited on the invoice advisory lock.\n'
if wait "$race_a_pid"; then
  race_a_status=0
else
  race_a_status=$?
fi
if [[ "$race_a_status" -ne 0 ]]; then
  race_client_diagnostics cwbrace_a
  race_client_diagnostics cwbrace_b
  fail "First concurrent bank-save request failed (exit=$race_a_status)."
fi
if wait "$race_b_pid"; then
  race_b_status=0
else
  race_b_status=$?
fi
if [[ "$race_b_status" -ne 0 ]]; then
  race_client_diagnostics cwbrace_a
  race_client_diagnostics cwbrace_b
  fail "Second concurrent bank-save request failed (exit=$race_b_status)."
fi
concurrency_outbox_after=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb)::text) from public.notification_outbox x")
concurrency_driver_pdf_after=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb)::text) from public.trip_closure_invoice_pdf_copies x where x.invoice_id='e7000000-0000-4000-8000-000000000043' and x.copy_kind='driver'")
[[ "$concurrency_outbox_before" == "$concurrency_outbox_after" ]] || fail "Concurrent bank saving modified notification-outbox records."
[[ "$concurrency_driver_pdf_before" == "$concurrency_driver_pdf_after" ]] || fail "Concurrent bank saving modified the Driver PDF record."
printf 'PASS concurrency leaves the notification outbox and Driver PDF unchanged.\n'
printf 'PASS concurrent RPC calls overlapped; a competing session waited on the invoice advisory lock.\n'
run_sql "concurrency gate cleanup" "$repo_root/supabase/tests/fixtures/company_waybill_bank_recovery/concurrency_gate_cleanup.sql"
run_transactional_suite "concurrent bank-save assertions" "$repo_root/supabase/tests/database/company_waybill_bank_concurrency.sql"

if [[ "$secure_email_cutover" == true ]]; then
  run_sql "secure email delivery synthetic seed" "$repo_root/supabase/tests/fixtures/secure_email_delivery_cutover/seed.sql"
  email_outbox_before=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb)::text) from public.notification_outbox x")
  email_audit_before=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb)::text) from public.audit_log x")
  copy_migration "$repo_root/supabase/migrations" 20261021000000_secure_waybill_email_delivery_cutover.sql
  assert_staged_count 27
  apply_migrations "$all_versions,20261021000000"
  email_outbox_after=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb)::text) from public.notification_outbox x")
  email_audit_after=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb)::text) from public.audit_log x")
  [[ "$email_outbox_before" == "$email_outbox_after" ]] || fail "Email cutover migration changed notification outbox records."
  [[ "$email_audit_before" == "$email_audit_after" ]] || fail "Email cutover migration changed historical audit records."
  printf 'PASS email cutover migration preserved every seeded notification and audit row.\n'
    run_transactional_suite "secure email delivery cutover assertions" "$repo_root/supabase/tests/database/secure_email_delivery_cutover.sql"

  replay_log="$runner_temp/$project_id-email-migration-replay.log"
  replay_before=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "select md5(jsonb_build_object('notifications',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.notification_outbox x),'audit',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.audit_log x))::text)")
  if docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -f - \
      <"$repo_root/supabase/migrations/20261021000000_secure_waybill_email_delivery_cutover.sql" >"$replay_log" 2>&1; then
    fail "Cutover migration unexpectedly replayed instead of rejecting an already-installed schema."
  fi
  grep -qi 'already exists' "$replay_log" || { redact_log <"$replay_log" | tail -n 25 >&2; fail "Migration replay failed for an unexpected reason."; }
  replay_after=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "select md5(jsonb_build_object('notifications',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.notification_outbox x),'audit',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.audit_log x))::text)")
  [[ "$replay_before" == "$replay_after" ]] || fail "Rejected migration replay modified notification or audit history."
  printf 'PASS migration replay is rejected before changes; notification and audit fingerprints remain unchanged.\n'

  race_invoice_id='e7000000-0000-4000-8000-000000000046'
  race_job_id=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "select n.id from public.notification_outbox n where n.event_type='waybill_ready' and n.audience='driver' and n.payload->>'invoice_id'='$race_invoice_id' and n.status='pending'")
  [[ "$race_job_id" =~ ^[0-9a-f-]{36}$ ]] || fail "Synthetic future Driver notification for concurrency test is missing."
  race_a="sedc-a-$GITHUB_RUN_ID"
  race_b="sedc-b-$GITHUB_RUN_ID"
  race_a_log="$runner_temp/$project_id-$race_a.log"
  race_b_log="$runner_temp/$project_id-$race_b.log"
  docker exec -i --env "PGAPPNAME=$race_a" "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    >"$race_a_log" 2>&1 <<SQL &
begin;
select id from public.claim_waybill_notifications('secure-email-race-a',1);
select pg_sleep(4);
commit;
SQL
  race_a_pid=$!
  if ! wait_for_pg_state "$race_a" Timeout PgSleep; then
    race_client_diagnostics "$race_a"
    stop_race_client "$race_a" "$race_a_pid"
    fail "First secure notification claim did not enter the concurrency hold."
  fi
  docker exec -i --env "PGAPPNAME=$race_b" "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    >"$race_b_log" 2>&1 <<'SQL'
select id from public.claim_waybill_notifications('secure-email-race-b',1);
SQL
  race_b_status=$?
  if wait "$race_a_pid"; then race_a_status=0; else race_a_status=$?; fi
  [[ "$race_a_status" == 0 && "$race_b_status" == 0 ]] || fail "Concurrent secure notification claims failed (a=$race_a_status,b=$race_b_status)."
  race_a_id=$(grep -Eo '^[0-9a-f-]{36}$' "$race_a_log" | head -n 1)
  race_b_id=$(grep -Eo '^[0-9a-f-]{36}$' "$race_b_log" | head -n 1)
  [[ -n "$race_a_id" && -n "$race_b_id" && "$race_a_id" != "$race_b_id" ]] || fail "Concurrent claim sessions did not receive distinct notification rows."
  race_invoice_count=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "select count(*) from public.notification_outbox n join public.trip_closure_invoices i on i.trip_id=n.trip_id where n.id in ('$race_a_id','$race_b_id') and n.event_type='waybill_ready' and (i.invoice_number in ('WB-2026-000041','WB-2026-000042','WB-2026-000043','WB-2026-000044','WB-2026-000045') or (i.closed_at>'2026-10-20T21:34:05.976714Z'::timestamptz and i.invoice_number<>'WB-9999-999999'))")
  [[ "$race_invoice_count" == 2 ]] || fail "Concurrent claims escaped the approved historical/future scope."
  printf 'PASS concurrent email claims overlapped and returned distinct eligible notifications.\n'

  race_release_ok=$(docker exec -i "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -f - <<SQL
begin;
select notification.id::text as race_a_id,notification.lease_token::text as race_a_lease_token
from public.notification_outbox notification
where notification.id='$race_a_id'::uuid and notification.status='processing'
  and notification.lease_token is not null and notification.lease_until>clock_timestamp()
\\gset
select notification.id::text as race_b_id,notification.lease_token::text as race_b_lease_token
from public.notification_outbox notification
where notification.id='$race_b_id'::uuid and notification.status='processing'
  and notification.lease_token is not null and notification.lease_until>clock_timestamp()
\\gset
set local role service_role;
select public.finish_trip_notification(:'race_a_id'::uuid,:'race_a_lease_token'::uuid,false,null,'isolated CI lease release') as race_a_released
\\gset
select public.finish_trip_notification(:'race_b_id'::uuid,:'race_b_lease_token'::uuid,false,null,'isolated CI lease release') as race_b_released
\\gset
select (:'race_a_released'::boolean and :'race_b_released'::boolean);
commit;
SQL
  )
  [[ "$race_release_ok" == t ]] || fail "Could not release both CI-only secure-email test leases."
  race_release_state=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "select count(*)=2 and bool_and(status='pending' and lease_token is null and lease_until is null) from public.notification_outbox where id in ('$race_a_id'::uuid,'$race_b_id'::uuid)")
  [[ "$race_release_state" == t ]] || fail "CI-only secure-email claim fixtures remain in an unexpected state."

  email_canary_outbox_before=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "select md5(coalesce(jsonb_agg(to_jsonb(notification) order by notification.id),'[]'::jsonb)::text) from public.notification_outbox notification")
  email_canary_audit_before=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "select md5(coalesce(jsonb_agg(to_jsonb(audit) order by audit.id),'[]'::jsonb)::text) from public.audit_log audit")
  copy_migration "$repo_root/supabase/migrations" 20261021133526_secure_synthetic_waybill_email_canary.sql
  assert_staged_count 28
  apply_migrations "$all_versions,20261021000000,20261021133526"
  email_canary_outbox_after=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "select md5(coalesce(jsonb_agg(to_jsonb(notification) order by notification.id),'[]'::jsonb)::text) from public.notification_outbox notification")
  email_canary_audit_after=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "select md5(coalesce(jsonb_agg(to_jsonb(audit) order by audit.id),'[]'::jsonb)::text) from public.audit_log audit")
  [[ "$email_canary_outbox_before" == "$email_canary_outbox_after" ]] || fail "Synthetic canary migration changed notification-outbox rows."
  [[ "$email_canary_audit_before" == "$email_canary_audit_after" ]] || fail "Synthetic canary migration changed historical audit rows."
  printf 'PASS synthetic canary migration preserved every pre-existing notification and audit row.\n'

  run_sql "synthetic unverified Company retry-limit fixture" "$repo_root/supabase/tests/fixtures/secure_email_delivery_cutover/company_verified_bank_attempt_cleanup_seed.sql"
  hardening_before=$(secure_email_hardening_fingerprint)
  copy_migration "$repo_root/supabase/migrations" 20261022085737_company_waybill_verified_bank_eligibility.sql
  assert_staged_count 29
  apply_migrations "$all_versions,20261021000000,20261021133526,20261022085737"
  hardening_after=$(secure_email_hardening_fingerprint)
  [[ "$hardening_before" == "$hardening_after" ]] || fail "Company verification hardening migration changed existing operational, financial, bank, PDF, notification, canary, audit, or Storage records."
  printf 'PASS Company verification hardening migration preserved every pre-existing row and Storage object.\n'

  run_sql "synthetic email canary provisioning fixture" "$repo_root/supabase/tests/fixtures/secure_email_delivery_cutover/canary_provision.sql"
  run_transactional_suite "Company verified-bank eligibility hardening assertions" "$repo_root/supabase/tests/database/company_waybill_verified_bank_eligibility.sql"
  run_transactional_suite "synthetic email canary assertions" "$repo_root/supabase/tests/database/secure_synthetic_email_canary.sql"
  run_sql "canary concurrency gate setup" "$repo_root/supabase/tests/fixtures/secure_email_delivery_cutover/canary_concurrency_gate.sql"

  canary_invoice_id=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "select id from public.trip_closure_invoices where invoice_number='WB-9999-999999'")
  canary_trip_id=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "select trip_id from public.trip_closure_invoices where invoice_number='WB-9999-999999'")
  [[ "$canary_invoice_id" =~ ^[0-9a-f-]{36}$ && "$canary_trip_id" =~ ^[0-9a-f-]{36}$ ]] || fail "The reserved synthetic email canary invoice is unavailable."
  canary_outside_fingerprint=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "select md5(coalesce(jsonb_agg(to_jsonb(notification) order by notification.id),'[]'::jsonb)::text) from public.notification_outbox notification where notification.trip_id<>'$canary_trip_id'::uuid")

  run_canary_claim() {
    local app_name="$1"
    local log_file="$runner_temp/$project_id-$app_name.log"
    local status_file="$runner_temp/$project_id-$app_name.exit"
    local client_status
    if docker exec -i --env "PGAPPNAME=$app_name" "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -f - >"$log_file" 2>&1 <<SQL
begin;
set local role service_role;
select notification.id::text||'|'||notification.audience
from public.claim_waybill_notification_canary('ci-canary-$GITHUB_RUN_ID','$canary_invoice_id','synthetic-company@example.invalid',1) notification;
commit;
SQL
    then
      client_status=0
    else
      client_status=$?
    fi
    printf '%s\n' "$client_status" >"$status_file"
    return "$client_status"
  }

  canary_a="sedc-canary-a-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
  canary_b="sedc-canary-b-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
  wait_for_pg_state "$canary_a" Timeout PgSleep & canary_observer_a_pid=$!
  if ! wait_for_observer_start "cwbrmon_${canary_a}_PgSleep"; then
    stop_race_client "canary-observer-a" "$canary_observer_a_pid"
    fail "Could not start the first canary PostgreSQL wait observer."
  fi
  run_canary_claim "$canary_a" & canary_a_pid=$!
  if ! wait "$canary_observer_a_pid"; then
    race_client_diagnostics "$canary_a"
    stop_race_client "$canary_a" "$canary_a_pid"
    fail "First canary claim did not reach the synthetic PostgreSQL sleep gate."
  fi
  run_canary_claim "$canary_b" & canary_b_pid=$!
  if ! wait_for_canary_lock_contention "$canary_a" "$canary_b"; then
    printf 'Canary same-snapshot advisory-lock diagnostics:\n' >&2
    redact_log <"$runner_temp/$project_id-observer-$canary_a-$canary_b-lock.log" \
      | grep -E '^(ERROR:|DETAIL:|HINT:|FATAL:|psql: error:|NOTICE:)' | tail -n 20 >&2 || true
    race_client_diagnostics "$canary_a"
    race_client_diagnostics "$canary_b"
    stop_race_client "$canary_a" "$canary_a_pid"
    stop_race_client "$canary_b" "$canary_b_pid"
    fail "Canary clients did not show client A in PgSleep and client B waiting on the invoice advisory lock in one activity snapshot."
  fi
  printf 'PASS independent canary sessions overlapped: client A held the invoice lock in PgSleep while client B waited on the advisory lock in one PostgreSQL activity snapshot.\n'
  if wait "$canary_a_pid"; then canary_a_status=0; else canary_a_status=$?; fi
  if wait "$canary_b_pid"; then canary_b_status=0; else canary_b_status=$?; fi
  [[ "$canary_a_status" == 0 && "$canary_b_status" == 0 ]] || {
    race_client_diagnostics "$canary_a"
    race_client_diagnostics "$canary_b"
    fail "Concurrent canary claims failed (a=$canary_a_status,b=$canary_b_status)."
  }
  canary_a_result=$(grep -Eo '^[0-9a-f-]{36}\|(driver|client)$' "$runner_temp/$project_id-$canary_a.log" | head -n 1)
  canary_b_result=$(grep -Eo '^[0-9a-f-]{36}\|(driver|client)$' "$runner_temp/$project_id-$canary_b.log" | head -n 1)
  [[ "$canary_a_result" =~ ^[0-9a-f-]{36}\|(driver|client)$ && "$canary_b_result" =~ ^[0-9a-f-]{36}\|(driver|client)$ ]] || fail "Concurrent canary clients returned malformed claim results."
  canary_a_id="${canary_a_result%%|*}"
  canary_b_id="${canary_b_result%%|*}"
  canary_a_audience="${canary_a_result##*|}"
  canary_b_audience="${canary_b_result##*|}"
  [[ "$canary_a_id" != "$canary_b_id" && "$canary_a_audience" != "$canary_b_audience" ]] || fail "Concurrent canary claims were not distinct audience-specific records."
  canary_claim_integrity=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "select count(*)=2 and count(distinct audience)=2 and bool_and(status='processing' and lease_token is not null and lease_until>clock_timestamp() and payload->>'invoice_id'='$canary_invoice_id' and payload->>'invoice_number'='WB-9999-999999' and recipients=array[case audience when 'driver' then 'synthetic-driver@example.invalid' else 'synthetic-company@example.invalid' end]::text[]) from public.notification_outbox where id in ('$canary_a_id'::uuid,'$canary_b_id'::uuid)")
  [[ "$canary_claim_integrity" == t ]] || fail "Concurrent canary claims escaped the reserved invoice or recipient scope."
  canary_outside_after=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "select md5(coalesce(jsonb_agg(to_jsonb(notification) order by notification.id),'[]'::jsonb)::text) from public.notification_outbox notification where notification.trip_id<>'$canary_trip_id'::uuid")
  [[ "$canary_outside_fingerprint" == "$canary_outside_after" ]] || fail "Canary claims modified an unrelated or historical notification."
  printf 'PASS concurrent canary leases are distinct, invoice-scoped, audience-isolated, and leave other outbox rows unchanged.\n'

  canary_lease_wait=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "select ceil(extract(epoch from max(lease_until)-clock_timestamp()))::integer from public.notification_outbox where id in ('$canary_a_id'::uuid,'$canary_b_id'::uuid) and status='processing'")
  [[ "$canary_lease_wait" =~ ^[0-9]+$ && "$canary_lease_wait" -le 300 ]] || fail "Canary lease expiry could not be bounded safely."
  if [[ "$canary_lease_wait" -gt 0 ]]; then sleep "$((canary_lease_wait + 1))"; fi
  canary_recovered_count=$(docker exec -i "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -f - <<SQL
set role service_role;
select public.recover_expired_waybill_synthetic_email_canary('$canary_invoice_id'::uuid);
SQL
  )
  [[ "$canary_recovered_count" == 2 ]] || fail "Expired canary recovery did not release exactly two synthetic leases."
  canary_recovery_state=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "select (select count(*)=2 and bool_and(status='pending' and lease_token is null and lease_until is null) from public.notification_outbox where trip_id='$canary_trip_id'::uuid and event_type='waybill_ready') and (select disarmed_at is not null from private.waybill_notification_canary_runs where invoice_id='$canary_invoice_id'::uuid order by armed_at desc limit 1)")
  [[ "$canary_recovery_state" == t ]] || fail "Expired canary leases were not safely returned to pending and disarmed."
  printf 'PASS expired canary lease recovery released exactly two jobs and disarmed the run without delivery.\n'

  canary_second_run=$(docker exec -i "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -f - <<SQL
set role service_role;
select public.arm_waybill_synthetic_email_canary('$canary_invoice_id'::uuid,60);
SQL
  )
  [[ "$canary_second_run" =~ ^[0-9a-f-]{36}$ ]] || fail "A second short-lived canary run could not be armed after recovery."
  canary_disarm_result=$(docker exec -i "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -f - <<SQL
set role service_role;
select public.disarm_waybill_synthetic_email_canary('$canary_invoice_id'::uuid);
SQL
  )
  [[ "$canary_disarm_result" == t ]] || fail "A canary with no active leases could not be safely disarmed."
  printf 'PASS canary can be explicitly disarmed when no notification lease is active.\n'

  canary_expiry_run=$(docker exec -i "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -f - <<SQL
set role service_role;
select public.arm_waybill_synthetic_email_canary('$canary_invoice_id'::uuid,60);
SQL
  )
  [[ "$canary_expiry_run" =~ ^[0-9a-f-]{36}$ ]] || fail "Expired-run recovery fixture could not be armed."
  canary_expiry_wait=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "select greatest(0,ceil(extract(epoch from expires_at-clock_timestamp()))::integer) from private.waybill_notification_canary_runs where id='$canary_expiry_run'::uuid and disarmed_at is null")
  [[ "$canary_expiry_wait" =~ ^[0-9]+$ && "$canary_expiry_wait" -le 60 ]] || fail "Canary expiration wait could not be bounded."
  if [[ "$canary_expiry_wait" -gt 0 ]]; then sleep "$((canary_expiry_wait + 1))"; fi
  canary_expiry_recovery=$(docker exec -i "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -f - <<SQL
set role service_role;
select public.recover_expired_waybill_synthetic_email_canary('$canary_invoice_id'::uuid);
SQL
  )
  [[ "$canary_expiry_recovery" == 0 ]] || fail "Expired, unclaimed canary unexpectedly recovered notification rows."
  canary_final_state=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "select not exists(select 1 from private.waybill_notification_canary_runs where disarmed_at is null) and (select count(*)=2 and bool_and(status='pending' and lease_token is null and lease_until is null) from public.notification_outbox where trip_id='$canary_trip_id'::uuid and event_type='waybill_ready')")
  [[ "$canary_final_state" == t ]] || fail "An expired, undisarmed canary still blocks recovery or changed its pending rows."
  printf 'PASS expired undisarmed canary safely recovers and no longer blocks regular processing.\n'

  run_sql "canary concurrency gate cleanup" "$repo_root/supabase/tests/fixtures/secure_email_delivery_cutover/canary_concurrency_gate_cleanup.sql"
  apply_migrations "$all_versions,20261021000000,20261021133526,20261022085737"
  printf 'PASS complete secure email, synthetic canary, and Company verification SQL integration completed in isolated PostgreSQL 17 (project=%s, migrations=29).\n' "$project_id"
else
  printf 'PASS all disposable Company Waybill bank-recovery SQL suites completed (project=%s, migrations=26).\n' "$project_id"
fi
