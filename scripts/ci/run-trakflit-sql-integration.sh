#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly project_id="trklci-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
readonly runner_temp="${RUNNER_TEMP:?}"
readonly repo_root="${GITHUB_WORKSPACE:?}"
readonly test_root="${runner_temp}/${project_id}"
readonly fixture_root="${repo_root}/supabase/tests/fixtures/trakflit-ci"
readonly migration_dir="${test_root}/supabase/migrations"
readonly migration_log="${test_root}/migration-stage.log"
readonly start_log="${test_root}/supabase-start.log"
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
  exit "${exit_code}"
}
trap cleanup EXIT

unset SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SUPABASE_PROJECT_REF
[[ "${project_id}" =~ ^[a-z0-9-]{1,40}$ ]] || fail "Generated project ID is invalid."
[[ ! -e "${test_root}" ]] || fail "The unique temporary project directory already exists."
[[ -d "${fixture_root}" ]] || fail "The checked-in CI fixture package is missing."
mkdir -m 700 -- "${test_root}"
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
baseline_migrations=(
  20260921000100_canonical_payment_free_baseline.sql
  20260921000200_canonical_operational_rpcs.sql
  20260924000100_canonical_loading_alignment.sql
  20260925000200_canonical_waybill_schema.sql
  20260927000150_canonical_waybill_pdf_access.sql
  20260927001150_canonical_scan_first_estimated_tonnage.sql
  20261005000600_canonical_waybill_number_prefix.sql
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
banking_migrations=(20261015000100_waybill_single_manager_bank_save.sql)
baseline_and_predecessors=("${baseline_migrations[@]}" "${payment_free_migrations[@]}")
through_secure_migrations=("${baseline_and_predecessors[@]}" "${secure_migrations[@]}")
all_test_migrations=("${through_secure_migrations[@]}" "${banking_migrations[@]}")

verify_deployable_snapshots() {
  local migration source snapshot
  for migration in "${payment_free_migrations[@]}" "${secure_migrations[@]}" "${banking_migrations[@]}"; do
    source="${repo_root}/supabase/migrations/${migration}"
    case "${migration}" in
      20261009*) snapshot="${fixture_root}/payment_free_predecessors/${migration}" ;;
      20261010*|20261011*|20261012*|20261013000100*) snapshot="${fixture_root}/payment_free_predecessors/${migration}" ;;
      20261013000200*|20261013000300*) snapshot="${fixture_root}/dual_waybill/${migration}" ;;
      20261015000100*) snapshot="${fixture_root}/banking_correction/${migration}" ;;
      *) fail "Unmapped test migration: ${migration}" ;;
    esac

    if [[ -f "${source}" ]]; then
      diff -q --strip-trailing-cr "${source}" "${snapshot}" >/dev/null || fail "CI snapshot differs from deployable migration ${migration}."
    elif [[ "${migration}" == "20261015000100_waybill_single_manager_bank_save.sql" ]]; then
      fail "The deployable one-step banking migration is absent from this branch."
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

copy_migrations "${fixture_root}/canonical_baseline" "${baseline_migrations[@]}"
assert_staged_migrations "${baseline_migrations[@]}"
verify_deployable_snapshots

# The project is created under a unique CLI project ID. Only Auth and Storage
# services are retained beside Postgres; no cloud project is linked or queried.
start_attempted=true
if ! supabase start --yes --exclude "${excluded_services}" --workdir "${test_root}" >"${start_log}" 2>&1; then
  fail "Supabase local startup failed; CLI output is kept private because startup output can contain local test keys."
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
    tail -n 30 "${migration_log}" | sed -E 's/[0-9]{9,18}/[REDACTED_NUMERIC]/g' >&2
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
  if docker exec -i "${db_container}" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -f - <"${sql_file}" >"${output_file}" 2>&1; then
    printf 'PASS: %s\n' "${label}"
    return 0
  else
    local exit_code=$?
    printf 'FAIL: %s (psql exit %s)\n' "${label}" "${exit_code}" >&2
    grep -E 'ERROR:|FATAL:|psql: error:' "${output_file}" | sed -E 's/[0-9]{9,18}/[REDACTED_NUMERIC]/g; s/[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}/[REDACTED_EMAIL]/g' | tail -n 20 >&2 || true
    return "${exit_code}"
  fi
}

fingerprint() {
  docker exec "${db_container}" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "
    select md5(jsonb_build_object(
      'users', (select coalesce(jsonb_agg(to_jsonb(u) order by u.id), '[]'::jsonb) from auth.users u),
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
      'storage_objects', (select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb) from storage.objects o)
    )::text)
  "
}

run_transactional_suite() {
  local label="$1"
  local sql_file="$2"
  local before after
  before="$(fingerprint)"
  run_sql_file "${label}" "${sql_file}"
  after="$(fingerprint)"
  [[ "${before}" == "${after}" ]] || fail "${label} did not roll back to its exact pre-suite database fingerprint."
  printf 'PASS: %s transaction rollback and historical-state fingerprint\n' "${label}"
}

apply_migrations "20260921000100,20260921000200,20260924000100,20260925000200,20260927000150,20260927001150,20261005000600"
run_sql_file "synthetic hybrid cutover seed" "${fixture_root}/hybrid_cutover_seed.sql"

copy_migrations "${fixture_root}/payment_free_predecessors" "${payment_free_migrations[@]}"
assert_staged_migrations "${baseline_and_predecessors[@]}"
apply_migrations "20260921000100,20260921000200,20260924000100,20260925000200,20260927000150,20260927001150,20261005000600,20261009000000,20261010000100,20261011000050,20261011000100,20261012000100,20261013000100"
run_sql_file "legacy Waybill Storage seed" "${repo_root}/supabase/tests/fixtures/secure_dual_waybill_legacy_storage_seed.sql"

copy_migrations "${fixture_root}/dual_waybill" "${secure_migrations[@]}"
assert_staged_migrations "${through_secure_migrations[@]}"
apply_migrations "20260921000100,20260921000200,20260924000100,20260925000200,20260927000150,20260927001150,20261005000600,20261009000000,20261010000100,20261011000050,20261011000100,20261012000100,20261013000100,20261013000200,20261013000300"

run_transactional_suite "hybrid-cutover assertions" "${repo_root}/supabase/tests/fixtures/hybrid_cutover_assertions.sql"
run_transactional_suite "secure dual-Waybill SQL suite" "${repo_root}/supabase/tests/database/secure_dual_waybill.sql"

copy_migrations "${fixture_root}/banking_correction" "${banking_migrations[@]}"
assert_staged_migrations "${all_test_migrations[@]}"
apply_migrations "20260921000100,20260921000200,20260924000100,20260925000200,20260927000150,20260927001150,20261005000600,20261009000000,20261010000100,20261011000050,20261011000100,20261012000100,20261013000100,20261013000200,20261013000300,20261015000100"
run_transactional_suite "single-manager banking correction SQL suite" "${repo_root}/supabase/tests/database/waybill_single_manager_bank_save.sql"

printf 'PASS: all three SQL suites completed against isolated project %s.\n' "${project_id}"
