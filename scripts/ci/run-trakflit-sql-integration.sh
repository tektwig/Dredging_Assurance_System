#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly project_id="trklci-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
readonly runner_temp="${RUNNER_TEMP:?}"
readonly repo_root="${GITHUB_WORKSPACE:?}"
readonly test_root="${runner_temp}/${project_id}"
readonly diagnostic_root="${runner_temp}/trklci-diagnostics-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
readonly fixture_root="${repo_root}/supabase/tests/fixtures/trakflit-ci"
readonly migration_dir="${test_root}/supabase/migrations"
readonly migration_log="${diagnostic_root}/migration-stage.log"
readonly start_log="${diagnostic_root}/supabase-start.log"
readonly excluded_services="realtime,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor"

start_attempted=false
db_container=""

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  local exit_code=$?
  trap - EXIT
  set +e
  if [[ "${start_attempted}" == "true" ]]; then
    supabase stop --yes --project-id "${project_id}" --no-backup --workdir "${test_root}" >/dev/null 2>&1
  fi
  if [[ "${test_root}" == "${runner_temp}/trklci-"* && -d "${test_root}" ]]; then
    rm -rf -- "${test_root}"
  fi
  if [[ "${diagnostic_root}" == "${runner_temp}/trklci-diagnostics-"* && -d "${diagnostic_root}" ]]; then
    rm -rf -- "${diagnostic_root}"
  fi
  exit "${exit_code}"
}
trap cleanup EXIT

unset SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SUPABASE_PROJECT_REF
[[ "${project_id}" =~ ^[a-z0-9-]{1,40}$ ]] || fail "Generated project ID is invalid."
[[ ! -e "${test_root}" ]] || fail "The unique temporary project directory already exists."
[[ ! -e "${diagnostic_root}" ]] || fail "The unique temporary diagnostics directory already exists."
[[ -d "${fixture_root}" ]] || fail "The checked-in CI fixture package is missing."
mkdir -m 700 -- "${test_root}"
mkdir -m 700 -- "${diagnostic_root}"
cd "${repo_root}"

sha256sum --check "${fixture_root}/MIGRATION_SHA256SUMS"

supabase init --yes --workdir "${test_root}" >/dev/null
config_file="${test_root}/supabase/config.toml"
[[ -f "${config_file}" ]] || fail "Supabase CLI did not create a local project config."
sed -i -E "s/^project_id = .*/project_id = \"${project_id}\"/" "${config_file}"
grep -q "^project_id = \"${project_id}\"$" "${config_file}" || fail "Local project ID could not be verified."
if grep -q '^major_version = ' "${config_file}"; then
  sed -i -E 's/^major_version = .*/major_version = 17/' "${config_file}"
else
  sed -i '/^\[db\]$/a major_version = 17' "${config_file}"
fi
grep -q '^major_version = 17$' "${config_file}" || fail "The CLI config does not pin PostgreSQL major version 17."

mkdir -p -- "${migration_dir}"
canonical_baseline_migrations=(
  20260921000100_canonical_payment_free_baseline.sql
  20260921000200_canonical_operational_rpcs.sql
  20260924000100_canonical_loading_alignment.sql
  20260925000200_canonical_waybill_schema.sql
  20260927000100_waybill_pdf_infrastructure.sql
  20260927000150_canonical_waybill_pdf_access.sql
  20260927001150_canonical_scan_first_estimated_tonnage.sql
  20261005000600_canonical_waybill_number_prefix.sql
)
field_session_migrations=(20261002000200_field_operational_day_auth.sql)
baseline_migrations=(
  "${canonical_baseline_migrations[@]:0:6}"
  "${field_session_migrations[@]}"
  "${canonical_baseline_migrations[6]}"
)
payment_free_migrations=(
  20261009000000_payment_free_waybill_cutover.sql
  20261010000100_payment_free_operations_read_models.sql
  20261011000050_truck_type_text.sql
  20261011000100_payment_free_loading_registration.sql
  20261012000100_operations_analytics_payment_free.sql
  20261013000100_waybill_storage_role_alignment.sql
)
secure_migrations=(
  20261013000200_secure_dual_waybill_foundation.sql
  20261013000300_secure_notification_payloads.sql
)
registration_migrations=(
  20261016000050_loading_receipt_v3_operation.sql
  20261016000100_loading_registration_bank_capture.sql
)
baseline_and_predecessors=("${baseline_migrations[@]}" "${payment_free_migrations[@]}")
through_secure_migrations=("${baseline_and_predecessors[@]}" "${secure_migrations[@]}")
all_test_migrations=("${through_secure_migrations[@]}" "${registration_migrations[@]}")

verify_deployable_snapshots() {
  local migration source snapshot
  for migration in "${payment_free_migrations[@]}" "${secure_migrations[@]}" "${registration_migrations[@]}"; do
    source="${repo_root}/supabase/migrations/${migration}"
    case "${migration}" in
      20261009*) snapshot="${fixture_root}/payment_free_predecessors/${migration}" ;;
      20261010*|20261011*|20261012*|20261013000100*) snapshot="${fixture_root}/payment_free_predecessors/${migration}" ;;
      20261013000200*|20261013000300*) snapshot="${fixture_root}/dual_waybill/${migration}" ;;
      202610160*) snapshot="${fixture_root}/registration/${migration}" ;;
      *) fail "Unmapped test migration: ${migration}" ;;
    esac

    if [[ -f "${source}" ]]; then
      diff -q --strip-trailing-cr "${source}" "${snapshot}" >/dev/null || fail "CI snapshot differs from deployable migration ${migration}."
    else
      printf '::warning::Using the SHA-256-pinned verified CI snapshot for %s; no same-named deployable migration is present in this branch.\n' "${migration}"
    fi
  done
}

copy_migrations() {
  local source_dir="$1"
  shift
  local migration
  for migration in "$@"; do
    [[ -f "${source_dir}/${migration}" ]] || fail "Required migration artifact is missing: ${migration}"
    cp -- "${source_dir}/${migration}" "${migration_dir}/${migration}"
  done
}

assert_staged_migrations() {
  local -a expected=("$@")
  local -a actual sorted_expected
  mapfile -t actual < <(find "${migration_dir}" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | sort)
  mapfile -t sorted_expected < <(printf '%s\n' "${expected[@]}" | sort)
  if ! diff -u <(printf '%s\n' "${sorted_expected[@]}") <(printf '%s\n' "${actual[@]}"); then
    fail "Temporary project contains an unexpected or missing SQL migration."
  fi
}

copy_migrations "${fixture_root}/canonical_baseline" "${canonical_baseline_migrations[@]}"
copy_migrations "${repo_root}/supabase/migrations" "${field_session_migrations[@]}"
assert_staged_migrations "${baseline_migrations[@]}"
verify_deployable_snapshots

redact_diagnostics() {
  sed -E \
    -e 's/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/[REDACTED_JWT]/g' \
    -e 's/sb_(publishable|secret)_[A-Za-z0-9_-]+/[REDACTED_SUPABASE_KEY]/g' \
    -e 's/(password|secret|token|api[_ -]?key|anon[_ -]?key|service[_ -]?role[_ -]?key)([[:space:]]*[:=][[:space:]]*)[^[:space:],;]+/\1\2[REDACTED]/Ig' \
    -e 's#(postgres(ql)?://)[^[:space:]]+#\1[REDACTED_CONNECTION_STRING]#Ig' \
    -e 's/[0-9]{10,}/[REDACTED_LONG_NUMBER]/g'
}

report_startup_failure() {
  local start_exit_code="$1"
  local summary_file="${diagnostic_root}/startup-summary.txt"
  local container_id container_name
  {
    printf 'Supabase CLI startup failed (exit %s) for isolated project %s.\n' "${start_exit_code}" "${project_id}"
    printf 'Supabase CLI version: '
    supabase --version 2>&1 | redact_diagnostics
    printf 'Relevant CLI diagnostics:\n'
    if [[ -s "${start_log}" ]]; then
      grep -Ei 'error|fatal|panic|timeout|failed|unhealthy|refused|killed|out of memory|port|not ready|cannot|unable' "${start_log}" \
        | redact_diagnostics | tail -n 40 || true
    else
      printf 'No Supabase startup log was produced.\n'
    fi
    printf 'Containers carrying this exact project label:\n'
    while IFS= read -r container_id; do
      [[ -n "${container_id}" ]] || continue
      container_name="$(docker inspect --format '{{.Name}}' "${container_id}" 2>/dev/null || true)"
      docker inspect --format '{{.Name}} status={{.State.Status}}{{if .State.Health}} health={{.State.Health.Status}}{{end}}' "${container_id}" 2>/dev/null | redact_diagnostics || true
      if [[ "${container_name}" == /supabase_db_* ]]; then
        printf 'Database startup log excerpts for %s:\n' "${container_name#/}"
        docker logs --tail 100 "${container_id}" 2>&1 \
          | grep -Ei 'error|fatal|panic|timeout|failed|unhealthy|refused|killed|out of memory|not ready|cannot|unable' \
          | redact_diagnostics | tail -n 30 || true
      fi
    done < <(docker ps -aq --filter "label=com.supabase.cli.project=${project_id}" 2>/dev/null || true)
  } >"${summary_file}"
  cat "${summary_file}" >&2
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    cat "${summary_file}" >>"${GITHUB_STEP_SUMMARY}"
  fi
}

# The project is created under a unique CLI project ID. Only Auth and Storage
# services are retained beside Postgres; no cloud project is linked or queried.
start_attempted=true
if supabase start --yes --exclude "${excluded_services}" --workdir "${test_root}" >"${start_log}" 2>&1; then
  :
else
  start_exit_code=$?
  report_startup_failure "${start_exit_code}"
  exit "${start_exit_code}"
fi

mapfile -t matching_containers < <(docker ps --filter "label=com.supabase.cli.project=${project_id}" --format '{{.Names}}')
for container in "${matching_containers[@]}"; do
  if [[ "${container}" == supabase_db_* ]]; then
    [[ -z "${db_container}" ]] || fail "More than one database container has this isolated project label."
    db_container="${container}"
  fi
done
[[ -n "${db_container}" ]] || fail "Could not identify the database container by its exact Supabase project label."
[[ "$(docker inspect --format '{{ index .Config.Labels "com.supabase.cli.project" }}' "${db_container}")" == "${project_id}" ]] || fail "Database container project label does not match the unique CI project."

db_identity="$(docker exec "${db_container}" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "select current_database() || '|' || split_part(current_setting('server_version'), '.', 1)")"
[[ "${db_identity}" == "postgres|17" ]] || fail "Unexpected isolated database identity or PostgreSQL major version: ${db_identity}"
printf 'Connected to isolated PostgreSQL %s for project %s.\n' "${db_identity#*|}" "${project_id}"

apply_migrations() {
  local expected_versions="$1"
  if ! supabase migration up --local --workdir "${test_root}" >"${migration_log}" 2>&1; then
    tail -n 30 "${migration_log}" | redact_diagnostics \
      | sed -E 's/[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}/[REDACTED_EMAIL]/g' >&2
    fail "Local migration application failed."
  fi

  local actual_versions
  actual_versions="$(docker exec "${db_container}" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "select string_agg(version::text, ',' order by version::text) from supabase_migrations.schema_migrations")"
  [[ "${actual_versions}" == "${expected_versions}" ]] || fail "Applied migration ledger does not match the explicitly staged test sequence."
}

run_sql_file() {
  local label="$1"
  local sql_file="$2"
  local output_file="${test_root}/${label}.log"
  [[ -f "${sql_file}" ]] || fail "Required SQL test or fixture is missing: ${sql_file}"
  if docker exec -i "${db_container}" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -f - <"${sql_file}" >"${output_file}" 2>&1; then
    local assertion_count
    assertion_count="$(grep -c 'ASSERTION PASS:' "${output_file}" || true)"
    printf 'PASS: %s (assertions=%s)\n' "${label}" "${assertion_count}"
    return 0
  else
    local exit_code=$?
    printf 'FAIL: %s (psql exit %s)\n' "${label}" "${exit_code}" >&2
    grep -E 'ERROR:|FATAL:|psql: error:|ASSERTION PASS:' "${output_file}" \
      | redact_diagnostics | sed -E 's/[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}/[REDACTED_EMAIL]/g' | tail -n 30 >&2 || true
    return "${exit_code}"
  fi
}

fingerprint() {
  docker exec "${db_container}" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "
    select md5(jsonb_build_object(
      'users', (select coalesce(jsonb_agg(to_jsonb(u) order by u.id), '[]'::jsonb) from auth.users u),
      'auth_sessions', (select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb) from auth.sessions s),
      'profiles', (select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb) from public.profiles p),
      'sites', (select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb) from public.sites s),
      'trucks', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from public.trucks t),
      'trips', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from public.trips t),
      'invoices', (select coalesce(jsonb_agg(to_jsonb(i) order by i.id), '[]'::jsonb) from public.trip_closure_invoices i),
      'legacy_documents', (select coalesce(jsonb_agg(to_jsonb(d) order by d.id), '[]'::jsonb) from public.trip_closure_invoice_documents d),
      'copies', (select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]'::jsonb) from public.trip_closure_invoice_pdf_copies c),
      'payments', (select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb) from public.trip_payments p),
      'notifications', (select coalesce(jsonb_agg(to_jsonb(n) order by n.id), '[]'::jsonb) from public.notification_outbox n),
      'bank_submissions', (select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb) from public.trip_closure_invoice_bank_submissions s),
      'bank_snapshots', (select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb) from public.trip_closure_invoice_bank_snapshots s),
      'bank_events', (select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb) from public.trip_closure_invoice_bank_detail_events e),
      'loading_request_receipts', (select coalesce(jsonb_agg(to_jsonb(r) order by r.actor_id,r.operation,r.request_id), '[]'::jsonb) from private.loading_request_receipts r),
      'storage_objects', (select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb) from storage.objects o)
    )::text)
  "
}

registration_capture_fingerprint() {
  docker exec "${db_container}" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "
    select md5(coalesce(jsonb_agg(to_jsonb(capture) order by capture.id), '[]'::jsonb)::text)
    from private.loading_registration_bank_captures capture
  "
}

run_transactional_suite() {
  local label="$1"
  local sql_file="$2"
  local include_registration_captures="${3:-false}"
  local before after
  before="$(fingerprint)"
  if [[ "${include_registration_captures}" == "true" ]]; then
    before="${before}|$(registration_capture_fingerprint)"
  fi
  run_sql_file "${label}" "${sql_file}"
  after="$(fingerprint)"
  if [[ "${include_registration_captures}" == "true" ]]; then
    after="${after}|$(registration_capture_fingerprint)"
  fi
  [[ "${before}" == "${after}" ]] || fail "${label} did not roll back to its exact pre-suite database fingerprint."
  printf 'PASS: %s transaction rollback and historical-state fingerprint\n' "${label}"
}

receipt_fingerprint() {
  docker exec "${db_container}" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "
    select md5(coalesce(jsonb_agg(to_jsonb(receipt) order by receipt.actor_id,receipt.operation,receipt.request_id), '[]'::jsonb)::text)
    from private.loading_request_receipts receipt
  "
}

apply_migrations "20260921000100,20260921000200,20260924000100,20260925000200,20260927000100,20260927000150,20260927001150,20261002000200,20261005000600"
run_sql_file "synthetic hybrid cutover seed" "${fixture_root}/hybrid_cutover_seed.sql"

copy_migrations "${fixture_root}/payment_free_predecessors" "${payment_free_migrations[@]}"
assert_staged_migrations "${baseline_and_predecessors[@]}"
apply_migrations "20260921000100,20260921000200,20260924000100,20260925000200,20260927000100,20260927000150,20260927001150,20261002000200,20261005000600,20261009000000,20261010000100,20261011000050,20261011000100,20261012000100,20261013000100"
run_sql_file "legacy Waybill Storage seed" "${repo_root}/supabase/tests/fixtures/secure_dual_waybill_legacy_storage_seed.sql"

copy_migrations "${fixture_root}/dual_waybill" "${secure_migrations[@]}"
assert_staged_migrations "${through_secure_migrations[@]}"
apply_migrations "20260921000100,20260921000200,20260924000100,20260925000200,20260927000100,20260927000150,20260927001150,20261002000200,20261005000600,20261009000000,20261010000100,20261011000050,20261011000100,20261012000100,20261013000100,20261013000200,20261013000300"

run_transactional_suite "hybrid-cutover assertions" "${repo_root}/supabase/tests/fixtures/hybrid_cutover_assertions.sql"
run_transactional_suite "secure dual-Waybill SQL suite" "${repo_root}/supabase/tests/database/secure_dual_waybill.sql"
run_transactional_suite "field operational-day authorization suite" "${repo_root}/supabase/tests/database/field_operational_day_auth.sql"

run_sql_file "synthetic historical receipt seed" "${repo_root}/supabase/tests/fixtures/registration_legacy_receipts.sql"
historical_receipts_before="$(receipt_fingerprint)"

copy_migrations "${repo_root}/supabase/migrations" "${registration_migrations[0]}"
expected_before_bank_capture="20260921000100,20260921000200,20260924000100,20260925000200,20260927000100,20260927000150,20260927001150,20261002000200,20261005000600,20261009000000,20261010000100,20261011000050,20261011000100,20261012000100,20261013000100,20261013000200,20261013000300,20261016000050"
assert_staged_migrations "${through_secure_migrations[@]}" "${registration_migrations[0]}"
apply_migrations "${expected_before_bank_capture}"
[[ "$(receipt_fingerprint)" == "${historical_receipts_before}" ]] || fail "Migration 20261016000050 changed a synthetic historical receipt."
printf 'PASS: migration 20261016000050 preserves every pre-existing receipt value.\n'

copy_migrations "${repo_root}/supabase/migrations" "${registration_migrations[1]}"
assert_staged_migrations "${all_test_migrations[@]}"
apply_migrations "${expected_before_bank_capture},20261016000100"
[[ "$(receipt_fingerprint)" == "${historical_receipts_before}" ]] || fail "Migration 20261016000100 changed a synthetic historical receipt."
printf 'PASS: migration 20261016000100 preserves every pre-existing receipt value.\n'

run_transactional_suite "loading registration bank-capture SQL suite" "${repo_root}/supabase/tests/database/loading_registration_bank_capture.sql" true

printf 'PASS: all SQL suites completed against isolated project %s.\n' "${project_id}"
