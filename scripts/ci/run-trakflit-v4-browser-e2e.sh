#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

project_id="${TRAKFLIT_PROJECT_ID:?}"
test_root="${TRAKFLIT_TEST_ROOT:?}"
diagnostic_root="${TRAKFLIT_DIAGNOSTIC_ROOT:?}"
db_container="${TRAKFLIT_DB_CONTAINER:?}"
repo_root="${TRAKFLIT_REPO_ROOT:?}"
readonly api_status_file="${diagnostic_root}/local-status.env"
readonly api_status_error="${diagnostic_root}/local-status-error.log"
readonly user_ids_file="${diagnostic_root}/e2e-user-ids.json"
readonly browser_result_file="${diagnostic_root}/browser-result.json"
readonly vite_log="${diagnostic_root}/vite.log"
readonly vite_port=4173
vite_pid=""

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
cleanup_browser() {
  local status=$?
  trap - EXIT
  if [[ -n "${vite_pid}" ]]; then
    kill "${vite_pid}" 2>/dev/null || true
    wait "${vite_pid}" 2>/dev/null || true
  fi
  exit "${status}"
}
trap cleanup_browser EXIT

redact() {
  sed -E \
    -e 's/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/[REDACTED_JWT]/g' \
    -e 's/sb_(publishable|secret)_[A-Za-z0-9_-]+/[REDACTED_SUPABASE_KEY]/g' \
    -e 's/(password|secret|token|api[_ -]?key|anon[_ -]?key|service[_ -]?role[_ -]?key)([[:space:]]*[:=][[:space:]]*)[^[:space:],;]+/\1\2[REDACTED]/Ig' \
    -e 's#(postgres(ql)?://)[^[:space:]]+#\1[REDACTED_CONNECTION_STRING]#Ig' \
    -e 's/[0-9]{10,}/[REDACTED_LONG_NUMBER]/g'
}

[[ -d "${test_root}/supabase" ]] || fail 'The run-specific temporary Supabase project is unavailable.'
[[ "$(docker inspect --format '{{ index .Config.Labels "com.supabase.cli.project" }}' "${db_container}")" == "${project_id}" ]] \
  || fail 'The database container does not carry this exact temporary project label.'
[[ ! -e "${user_ids_file}" && ! -e "${browser_result_file}" ]] || fail 'A run-specific E2E fixture file already exists.'

if ! supabase status --workdir "${test_root}" -o env >"${api_status_file}" 2>"${api_status_error}"; then
  tail -n 30 "${api_status_error}" | redact >&2 || true
  fail 'Could not read local Supabase runtime configuration.'
fi

status_value() {
  awk -F= -v name="$1" '$1 == name { sub(/^[^=]*=/, ""); gsub(/^"|"$/, ""); print; exit }' "${api_status_file}"
}

api_url="$(status_value API_URL)"
anon_key="$(status_value ANON_KEY)"
service_role_key="$(status_value SERVICE_ROLE_KEY)"
[[ -n "${api_url}" && -n "${anon_key}" && -n "${service_role_key}" ]] || fail 'Local Auth/API credentials were not available from the isolated CLI status.'
[[ "${api_url}" =~ ^http://(127\.0\.0\.1|localhost):[0-9]+$ ]] || fail 'Supabase API URL is not loopback; refusing browser startup.'
[[ "${api_url}" != *pidxlopbxlapfmakmtjt* && "${api_url}" != *supabase.co* ]] || fail 'The API URL resolves to a hosted Supabase project.'

loading_email="loading-${project_id}@example.com"
loading_password="$(openssl rand -hex 24)"
operations_email="operations-${project_id}@example.com"
operations_password="$(openssl rand -hex 24)"
finance_email="finance-${project_id}@example.com"
finance_password="$(openssl rand -hex 24)"
unassigned_email="unassigned-${project_id}@example.com"
unassigned_password="$(openssl rand -hex 24)"

E2E_SUPABASE_URL="${api_url}" \
E2E_SUPABASE_SERVICE_ROLE_KEY="${service_role_key}" \
E2E_LOADING_EMAIL="${loading_email}" \
E2E_LOADING_PASSWORD="${loading_password}" \
E2E_OPERATIONS_EMAIL="${operations_email}" \
E2E_OPERATIONS_PASSWORD="${operations_password}" \
E2E_FINANCE_EMAIL="${finance_email}" \
E2E_FINANCE_PASSWORD="${finance_password}" \
E2E_UNASSIGNED_EMAIL="${unassigned_email}" \
E2E_UNASSIGNED_PASSWORD="${unassigned_password}" \
E2E_USER_IDS_FILE="${user_ids_file}" \
node "${repo_root}/scripts/ci/setup-trakflit-e2e-users.mjs"
unset service_role_key

loading_id="$(FILE="${user_ids_file}" node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.env.FILE,"utf8")).loading)')"
operations_id="$(FILE="${user_ids_file}" node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.env.FILE,"utf8")).operations)')"
finance_id="$(FILE="${user_ids_file}" node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.env.FILE,"utf8")).finance)')"
unassigned_id="$(FILE="${user_ids_file}" node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.env.FILE,"utf8")).unassigned)')"
for user_id in "${loading_id}" "${operations_id}" "${finance_id}" "${unassigned_id}"; do
  [[ "${user_id}" =~ ^[0-9a-fA-F-]{36}$ ]] || fail 'A temporary Auth identity ID was invalid.'
done

docker exec -i "${db_container}" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -v loading_id="${loading_id}" -v operations_id="${operations_id}" \
  -v finance_id="${finance_id}" -v unassigned_id="${unassigned_id}" \
  -f - <"${repo_root}/scripts/ci/seed-trakflit-e2e-users.sql" >"${diagnostic_root}/e2e-user-seed.log" 2>&1 \
  || { tail -n 20 "${diagnostic_root}/e2e-user-seed.log" | redact >&2 || true; fail 'Could not seed synthetic role profiles or field assignment.'; }
printf 'PASS: disposable Auth identities and Loading site assignment provisioned.\n'

[[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -H "apikey: ${anon_key}" "${api_url}/auth/v1/health")" == '200' ]] \
  || fail 'The isolated Auth service health endpoint did not return HTTP 200.'
[[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -H "apikey: ${anon_key}" "${api_url}/rest/v1/")" == '200' ]] \
  || fail 'The isolated PostgREST service did not return HTTP 200.'

if [[ "${anon_key}" != sb_publishable_* ]]; then
  E2E_ANON_KEY="${anon_key}" node -e 'const token=process.env.E2E_ANON_KEY;try{const p=JSON.parse(Buffer.from(token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"),"base64url").toString());if(p.role!=="anon")process.exit(1)}catch{process.exit(1)}' \
    || fail 'The frontend key is not a public anonymous key.'
fi

unset VITE_PLATE_RECOGNIZER_TOKEN
export VITE_SUPABASE_URL="${api_url}"
export VITE_SUPABASE_ANON_KEY="${anon_key}"
PLAYWRIGHT_BASE_URL="http://127.0.0.1:${vite_port}" \
PLAYWRIGHT_OUTPUT_DIR="${diagnostic_root}/playwright-output" \
  npm run build >"${diagnostic_root}/frontend-build.log" 2>&1 \
  || { tail -n 40 "${diagnostic_root}/frontend-build.log" | redact >&2 || true; fail 'The V4 frontend build failed against the isolated local API configuration.'; }
printf 'PASS: V4 production build used only the loopback Supabase API and public anon key.\n'

npm run dev -- --host 127.0.0.1 --port "${vite_port}" --strictPort >"${vite_log}" 2>&1 &
vite_pid=$!
vite_ready=false
for attempt in $(seq 1 60); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${vite_port}/login" -o /dev/null; then vite_ready=true; break; fi
  if ! kill -0 "${vite_pid}" 2>/dev/null; then break; fi
  sleep 1
done
if [[ "${vite_ready}" != true ]]; then
  grep -Ei 'error|failed|address already in use|unable|cannot' "${vite_log}" | redact | tail -n 25 >&2 || true
  fail 'The isolated V4 Vite server did not become ready.'
fi
printf 'PASS: V4 Vite server started on the isolated runner loopback interface.\n'

PLAYWRIGHT_BASE_URL="http://127.0.0.1:${vite_port}" \
PLAYWRIGHT_OUTPUT_DIR="${diagnostic_root}/playwright-output" \
VITE_SUPABASE_URL="${api_url}" \
VITE_SUPABASE_ANON_KEY="${anon_key}" \
E2E_LOADING_EMAIL="${loading_email}" \
E2E_LOADING_PASSWORD="${loading_password}" \
E2E_OPERATIONS_EMAIL="${operations_email}" \
E2E_OPERATIONS_PASSWORD="${operations_password}" \
E2E_FINANCE_EMAIL="${finance_email}" \
E2E_FINANCE_PASSWORD="${finance_password}" \
E2E_UNASSIGNED_EMAIL="${unassigned_email}" \
E2E_UNASSIGNED_PASSWORD="${unassigned_password}" \
E2E_RESULT_FILE="${browser_result_file}" \
  npm run test:e2e:registration >"${diagnostic_root}/playwright.log" 2>&1 \
  || { tail -n 80 "${diagnostic_root}/playwright.log" | redact | sed -E 's/[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}/[REDACTED_EMAIL]/g' >&2 || true; fail 'The real-browser V4 workflow failed.'; }

playwright_summary="$(grep -E 'Running [0-9]+ tests?|[0-9]+ passed|[0-9]+ failed|[0-9]+ skipped' \
  "${diagnostic_root}/playwright.log" | tail -n 12 || true)"
[[ -n "${playwright_summary}" ]] || fail 'Playwright did not produce a test-case summary.'
printf '%s\n' "${playwright_summary}" | redact \
  | sed -E 's/[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}/[REDACTED_EMAIL]/g'

[[ -s "${browser_result_file}" ]] || fail 'Browser verification did not produce the expected synthetic result identifiers.'
new_request_id="$(FILE="${browser_result_file}" node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.env.FILE,"utf8")).newRegistrationRequestId)')"
existing_request_id="$(FILE="${browser_result_file}" node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.env.FILE,"utf8")).existingDriverRequestId)')"
[[ "${new_request_id}" =~ ^[0-9a-fA-F-]{36}$ && "${existing_request_id}" =~ ^[0-9a-fA-F-]{36}$ ]] \
  || fail 'The browser result identifiers were malformed.'

docker exec -i "${db_container}" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -v loading_id="${loading_id}" -v new_registration_request_id="${new_request_id}" \
  -v existing_driver_request_id="${existing_request_id}" \
  -f - <"${repo_root}/scripts/ci/verify-trakflit-v4-browser-e2e.sql" \
  >"${diagnostic_root}/e2e-database-verification.log" 2>&1 \
  || { tail -n 35 "${diagnostic_root}/e2e-database-verification.log" | redact >&2 || true; fail 'Post-browser privileged persistence verification failed.'; }
browser_assertions="$(grep -c 'ASSERTION PASS:' "${diagnostic_root}/e2e-database-verification.log" || true)"
[[ "${browser_assertions}" == '9' ]] || fail "Expected 9 privileged post-browser persistence assertions; observed ${browser_assertions}."
cat "${diagnostic_root}/e2e-database-verification.log"
printf 'PASS: V4 browser registration, trip opening, role routing and restricted database persistence verified (assertions=%s).\n' "${browser_assertions}"
