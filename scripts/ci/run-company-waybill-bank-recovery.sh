#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

repo_root="$GITHUB_WORKSPACE"
runner_temp="$RUNNER_TEMP"
project_id="cwbr-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
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
      "$runner_temp"/cwbr-*) [[ ! -d "$project_root" ]] || rm -rf -- "$project_root" ;;
      *) printf 'Refusing cleanup outside the unique runner temp directory.\n' >&2 ;;
    esac
    find "$runner_temp" -maxdepth 1 -type f -name "$project_id-*.log" -delete
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
    -e 's/[0-9]{10,}/[REDACTED_NUMBER]/g' \
    -e 's/[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}/[REDACTED_EMAIL]/g'
}

[[ -n "$GITHUB_RUN_ID" && -n "$GITHUB_RUN_ATTEMPT" && -n "$GITHUB_WORKSPACE" && -n "$RUNNER_TEMP" ]] || fail "GitHub runner identity is incomplete."
[[ "$GITHUB_REF" == refs/heads/feature/company-waybill-bank-recovery ]] || fail "This workflow only runs on the authorized feature branch."
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
  [[ "$validated_source_count" == 26 ]] || fail "Expected 26 migration sources, validated $validated_source_count."
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
  local receipt_table_exists
  local receipt_fingerprint_field=""
  receipt_table_exists=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "select to_regclass('private.waybill_company_bank_save_receipts') is not null")
  if [[ "$receipt_table_exists" == "t" ]]; then
    receipt_fingerprint_field="'receipts',(select coalesce(jsonb_agg(to_jsonb(x) order by x.actor_id,x.request_id),'[]'::jsonb) from private.waybill_company_bank_save_receipts x),"
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
      'captures',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from private.loading_registration_bank_captures x),
      'submissions',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trip_closure_invoice_bank_submissions x),
      'snapshots',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trip_closure_invoice_bank_snapshots x),
      'events',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) from public.trip_closure_invoice_bank_detail_events x),
      ${receipt_fingerprint_field}
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
run_transactional_suite "V4 registration bank-capture suite" "$repo_root/supabase/tests/database/loading_registration_bank_capture.sql"

run_sql "synthetic Company Waybill recovery seed" "$repo_root/supabase/tests/fixtures/company_waybill_bank_recovery/seed.sql"
before_preservation=$(migration_preservation_fingerprint)
outbox_before=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb)::text) from public.notification_outbox x")
copy_migration "$repo_root/supabase/migrations" 20261019151115_company_waybill_bank_snapshot_autopreparation.sql
assert_staged_count 26
apply_migrations "$all_versions"
[[ "$before_preservation" == "$(migration_preservation_fingerprint)" ]] || fail "Recovery migration changed immutable trips, invoices, legacy documents, driver/truck records, registration captures, notifications, or Storage objects."
[[ "$outbox_before" == "$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb)::text) from public.notification_outbox x")" ]] || fail "Recovery migration modified notification-outbox records."
printf 'PASS migration preserves historical records, Storage objects, and notification outbox.\n'
run_transactional_suite "bank snapshot automatic preparation and recovery assertions" "$repo_root/supabase/tests/database/company_waybill_bank_snapshot_autopreparation.sql"

run_sql "concurrency gate setup" "$repo_root/supabase/tests/fixtures/company_waybill_bank_recovery/concurrency_gate.sql"
run_race_call() {
  app_name="$1"
  log_file="$runner_temp/$project_id-$app_name.log"
  docker exec --env "PGAPPNAME=$app_name" "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres >"$log_file" 2>&1 <<'SQL'
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000003',true);
select * from public.save_waybill_company_bank_details(
  'e7000000-0000-4000-8000-000000000043','e9000000-0000-4000-8000-000000000001',
  'CI Concurrent Bank','Synthetic recovery driver 43','9300000043');
commit;
SQL
}
run_race_call cwbrace_a & race_a_pid=$!
sleep 0.25
run_race_call cwbrace_b & race_b_pid=$!
waiting=0
for attempt in $(seq 1 45); do
  waiting=$(docker exec "$db_container" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "select count(*) from pg_stat_activity where application_name in ('cwbrace_a','cwbrace_b') and wait_event_type='Lock' and wait_event='advisory'")
  [[ "$waiting" -ge 1 ]] && break
  sleep 0.1
done
if [[ "$waiting" -lt 1 ]]; then
  kill "$race_a_pid" "$race_b_pid" 2>/dev/null || true
  wait "$race_a_pid" 2>/dev/null || true
  wait "$race_b_pid" 2>/dev/null || true
  fail "Concurrent calls did not demonstrate an advisory-lock waiter."
fi
wait "$race_a_pid" || fail "First concurrent bank-save request failed."
wait "$race_b_pid" || fail "Second concurrent bank-save request failed."
printf 'PASS concurrent RPC calls overlapped; a competing session waited on the invoice advisory lock.\n'
run_sql "concurrency gate cleanup" "$repo_root/supabase/tests/fixtures/company_waybill_bank_recovery/concurrency_gate_cleanup.sql"
run_transactional_suite "concurrent bank-save assertions" "$repo_root/supabase/tests/database/company_waybill_bank_concurrency.sql"

printf 'PASS all disposable Company Waybill bank-recovery SQL suites completed (project=%s, migrations=26).\n' "$project_id"
