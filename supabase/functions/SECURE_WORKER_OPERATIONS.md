# TRAKFLIT Secure Worker Operations

This runbook covers the secure Driver/Company PDF queues and the secure `waybill_ready` email stream. It does not activate or create schedules, send mail, modify queue rows, or replace the separate historical `trip_closed` stream.

## Findings and queue boundaries

- `process-waybill-pdfs` previously attempted `claim_waybill_pdf_jobs` before secure claims. Migration `20261013000200` revokes that legacy RPC from `service_role`; this produced a recurring claim error even though the secure queues could proceed. The worker now calls only the Driver and Company copy claim/snapshot/finish RPCs. It does not claim, upload, acknowledge, or rewrite legacy document rows or objects. The old renderer remains in the repository for historical compatibility but is not wired into this worker.
- The notification worker previously called the retired `claim_trip_notifications` and `get_waybill_ready_pdf` contracts, and passed `{}` to an older enqueue signature. The secure migration contract is now used: `enqueue_waybill_ready_notifications(text)`, `claim_waybill_notifications(text,integer)`, `get_waybill_notification_pdf(uuid,uuid)`, and the lease-bound `finish_trip_notification(uuid,uuid,boolean,text,text)`.
- The notification worker processes only `waybill_ready` rows for `driver` and `client` audiences. It never claims `trip_closed`, historical finance, or legacy PDF rows. The database claim joins a matching invoice and latest eligible secure copy; the PDF metadata RPC independently checks invoice identity, audience-to-copy mapping, current lease, ready state, latest copy version, notification eligibility, and a company bank snapshot. The worker validates the returned invoice, copy kind, bucket, path, recipient, and lease before downloading or sending.
- Historical Waybill notifications without a matching eligible secure copy are not eligible for the secure claim. However, any pre-existing `waybill_ready` row that *does* match a current eligible secure copy could be claimed once delivery is enabled. Review the candidate query below before activation; do not presume old rows are approved. Rows from the unrelated `trip_closed` stream remain untouched.
- Company PDFs are fetched only from `waybill-company-copies`; Driver PDFs only from `waybill-driver-copies`. The Driver renderer and email body have no banking fields. Company bank data remains inside the already-generated Company PDF only; no bank fields are requested from notification RPCs, copied into email text, or logged.
- The notification endpoint has a fail-closed `WAYBILL_NOTIFICATION_DELIVERY_ENABLED` gate. Missing, invalid, or false configuration stops before any reconciliation or queue claim. Keep it false until the recipient-sink test and the eligible historical queue review have been explicitly approved.

## Queue policy and retries

- Secure PDF copies use five-minute leases, a maximum of five attempts, and retryable failures with exponential delay capped at one hour. Exhausted jobs become `failed`. A Company PDF without a verified snapshot remains blocked and is not claimed; the Driver queue remains independent.
- Secure PDF RPC requests retry only when both the HTTP status is `401` and the parsed JSON error `code` is exactly `PGRST303`. PostgREST describes `PGRST303` as JWT claims validation/parsing failure; this bounded retry does not refresh credentials. Repeated failures therefore still require configuration/runtime investigation. The worker makes at most three total attempts with 100 ms and 200 ms backoff. Other 401/403 responses (including `PGRST301`), malformed error bodies, network failures, timeouts, and ambiguous responses are not retried. Error bodies, API keys, and bearer tokens are never logged or returned. Persistent `PGRST303` failures still count as claim errors when the affected call is a claim; a recovered retry does not. [PostgREST error reference](https://docs.postgrest.org/en/v16/references/errors.html)
- Secure notification claims use five-minute leases, a maximum of eight attempts or a 23-hour retry window, and exponential retry delay capped at one hour. Resend idempotency keys are stable per outbox notification (`waybill-notification/<notification UUID>`). Resend retains idempotency keys for 24 hours, longer than the database's 23-hour retry window; this bounds duplicate risk after a timeout or lost acknowledgement. A timeout or malformed success response is treated as acceptance-uncertain and retried with the same key. Do not manually reset an exhausted/ambiguous job without checking provider state first.
- Workers default to one item per invocation. The request limit is capped at two; the PDF worker claims Driver and Company work concurrently, while each copy type stays sequential. The email worker handles at most two jobs concurrently to keep the five-minute lease and Edge Function wall-clock/memory limits safe. Start scheduled calls with `{"limit":1}`. Increase only after observing runtime duration, memory, lease outcomes, and queue age in a controlled test.
- A provider `sent` state means Resend accepted the request, not that the recipient mailbox delivered it. Provider delivery/bounce reporting must be monitored separately in Resend.

## Read-only DEVELOPMENT preflight

Run these in the authenticated Dashboard SQL Editor only after confirming the project reference is `pidxlopbxlapfmakmtjt`. These queries expose no recipient addresses, bank values, payloads, credentials, or Storage paths.

### All notification streams and retry/lease counts

```sql
select event_type, audience, status,
       count(*) as jobs,
       count(*) filter (where status = 'pending' and next_attempt_at <= statement_timestamp()) as due_pending,
       count(*) filter (where status = 'processing' and lease_until > statement_timestamp()) as active_leases,
       count(*) filter (where status = 'processing' and (lease_until is null or lease_until <= statement_timestamp())) as expired_leases,
       count(*) filter (where status = 'failed' and attempts >= 8) as retry_exhausted,
       min(created_at) as oldest_created_at
from public.notification_outbox
group by event_type, audience, status
order by event_type, audience, status;
```

### Specific `waybill_ready` rows that could be claimed

Review each result before enabling delivery. It shows notification IDs and status metadata only; it does not show recipients or payload contents. `claim_action` mirrors the secure claim's candidate and retry-exhaustion conditions. Any returned row is a pre-existing candidate and must be explicitly accepted or left unprocessed before activation. Also run the eligible-copy query below: reconciliation can create a new outbox row for an already-ready eligible copy that has no `waybill_ready` row yet.

```sql
with current_copy as (
  select notification.id as notification_id,
         notification.created_at,
         notification.audience,
         notification.status as notification_status,
         notification.attempts,
         notification.first_attempt_at,
         notification.next_attempt_at,
         notification.lease_until,
         invoice.id as invoice_id,
         invoice.invoice_number,
         pdf_copy.id as copy_id,
         pdf_copy.copy_kind,
         pdf_copy.copy_version,
         pdf_copy.status as copy_status,
         pdf_copy.ready_at,
         pdf_copy.notification_eligible,
         pdf_copy.bank_snapshot_id,
         notification.recipients,
         invoice.driver_email
  from public.notification_outbox notification
  join public.trip_closure_invoices invoice
    on invoice.trip_id = notification.trip_id
   and notification.payload->>'invoice_id' = invoice.id::text
   and notification.payload->>'invoice_number' = invoice.invoice_number
  join lateral (
    select candidate.*
    from public.trip_closure_invoice_pdf_copies candidate
    where candidate.invoice_id = invoice.id
      and candidate.trip_id = invoice.trip_id
      and candidate.copy_kind = case notification.audience
        when 'driver' then 'driver' when 'client' then 'company' else null end
    order by candidate.copy_version desc
    limit 1
  ) pdf_copy on true
  where notification.event_type = 'waybill_ready'
    and notification.audience in ('driver','client')
    and notification.status in ('pending','processing')
    and notification.recipients is not null
    and cardinality(notification.recipients) = 1
    and ((notification.status = 'pending' and notification.next_attempt_at <= statement_timestamp())
      or (notification.status = 'processing'
        and (notification.lease_until is null or notification.lease_until < statement_timestamp())))
    and pdf_copy.status = 'ready'
    and pdf_copy.ready_at is not null
    and pdf_copy.notification_eligible
    and (pdf_copy.copy_kind <> 'company' or pdf_copy.bank_snapshot_id is not null)
    and pdf_copy.copy_version = (
      select max(latest.copy_version)
      from public.trip_closure_invoice_pdf_copies latest
      where latest.invoice_id = invoice.id
        and latest.copy_kind = pdf_copy.copy_kind
    )
    and ((notification.audience = 'driver'
        and invoice.driver_email is not null
        and notification.recipients = array[invoice.driver_email])
      or (notification.audience = 'client'
        and notification.recipients[1] ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
)
select notification_id, created_at, audience, notification_status, attempts,
       invoice_number, copy_kind, copy_version, copy_status, ready_at,
       case when attempts >= 8
              or first_attempt_at < statement_timestamp() - interval '23 hours'
            then 'would_be_marked_failed_by_claim'
            else 'would_be_claimed'
       end as claim_action
from current_copy
order by created_at, notification_id;
```

### Existing ready copies that reconciliation can enqueue

```sql
select invoice.invoice_number, pdf_copy.copy_kind, pdf_copy.copy_version,
       pdf_copy.created_at, pdf_copy.ready_at, pdf_copy.notification_eligible,
       count(notification.id) as existing_delivery_rows,
       count(*) filter (where notification.status = 'pending') as pending_rows,
       count(*) filter (where notification.status = 'processing') as processing_rows,
       count(*) filter (where notification.status = 'failed') as failed_rows,
       count(*) filter (where notification.status in ('blocked_missing_email','blocked_configuration')) as blocked_rows
from public.trip_closure_invoice_pdf_copies pdf_copy
join public.trip_closure_invoices invoice
  on invoice.id = pdf_copy.invoice_id and invoice.trip_id = pdf_copy.trip_id
left join public.notification_outbox notification
  on notification.trip_id = invoice.trip_id
 and notification.event_type = 'waybill_ready'
 and notification.audience = case pdf_copy.copy_kind when 'driver' then 'driver' when 'company' then 'client' end
 and notification.delivery_sequence = 0
where pdf_copy.status = 'ready'
  and pdf_copy.ready_at is not null
  and pdf_copy.notification_eligible
  and (pdf_copy.copy_kind <> 'company' or pdf_copy.bank_snapshot_id is not null)
  and pdf_copy.copy_version = (
    select max(latest.copy_version)
    from public.trip_closure_invoice_pdf_copies latest
    where latest.invoice_id = invoice.id and latest.copy_kind = pdf_copy.copy_kind
  )
  and (pdf_copy.copy_kind <> 'driver' or invoice.driver_email is not null)
group by invoice.invoice_number, pdf_copy.copy_kind, pdf_copy.copy_version,
         pdf_copy.created_at, pdf_copy.ready_at, pdf_copy.notification_eligible
order by pdf_copy.created_at, invoice.invoice_number, pdf_copy.copy_kind;
```

Each result with zero existing delivery rows can produce a new email row during reconciliation. Review these as potential historical sends even though the outbox row does not yet exist.

### Secure PDF copies and preserved legacy PDF documents

```sql
select copy_kind, status, count(*) as jobs,
       count(*) filter (where attempts >= 5) as attempt_limit_reached,
       count(*) filter (where status = 'processing'
         and (lease_until is null or lease_until <= statement_timestamp())) as expired_leases,
       min(created_at) as oldest_created_at
from public.trip_closure_invoice_pdf_copies
group by copy_kind, status
order by copy_kind, status;

select status, count(*) as legacy_documents,
       count(*) filter (where status = 'processing'
         and (lease_until is null or lease_until <= statement_timestamp())) as expired_leases,
       min(created_at) as oldest_created_at
from public.trip_closure_invoice_documents
group by status
order by status;
```

### Worker RPC grants

```sql
with expected(signature, legacy) as (values
  ('public.claim_driver_waybill_pdf_jobs(integer,uuid)', false),
  ('public.claim_company_waybill_pdf_jobs(integer,uuid)', false),
  ('public.get_driver_waybill_pdf_snapshot(uuid,uuid)', false),
  ('public.get_company_waybill_pdf_snapshot(uuid,uuid)', false),
  ('public.finish_driver_waybill_pdf_job(uuid,uuid,boolean,text)', false),
  ('public.finish_company_waybill_pdf_job(uuid,uuid,boolean,text)', false),
  ('public.enqueue_waybill_ready_notifications(text)', false),
  ('public.claim_waybill_notifications(text,integer)', false),
  ('public.get_waybill_notification_pdf(uuid,uuid)', false),
  ('public.finish_trip_notification(uuid,uuid,boolean,text,text)', false),
  ('public.claim_waybill_pdf_jobs(integer)', true),
  ('public.get_waybill_pdf_snapshot(uuid,uuid)', true),
  ('public.finish_waybill_pdf_job(uuid,uuid,boolean,text)', true),
  ('public.get_waybill_ready_pdf(uuid,uuid)', true)
), resolved as (
  select expected.signature, expected.legacy,
         to_regprocedure(expected.signature) as function_oid
  from expected
)
select signature, legacy, function_oid is not null as exists,
       case when function_oid is null then false
         else has_function_privilege('service_role', function_oid, 'EXECUTE') end as service_role_execute,
       case when function_oid is null then false
         else has_function_privilege('authenticated', function_oid, 'EXECUTE') end as authenticated_execute,
       case when function_oid is null then false
         else has_function_privilege('anon', function_oid, 'EXECUTE') end as anon_execute,
       case when function_oid is null then false else exists (
         select 1 from aclexplode(coalesce(
           (select proacl from pg_proc where oid = function_oid),
           acldefault('f', (select proowner from pg_proc where oid = function_oid))
         )) as privilege
         where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
       ) end as public_execute
from resolved
order by legacy, signature;
```

Expected: secure RPCs exist and are executable only by `service_role` among API roles; legacy generic PDF RPCs are absent or non-executable by `service_role`, `authenticated`, `anon`, and `PUBLIC`.

### Cron, extensions, and Vault secret names (names only)

```sql
select extname, extversion
from pg_extension
where extname in ('pg_cron','pg_net','supabase_vault')
order by extname;

select jobid, jobname, schedule, active
from cron.job
order by jobname, jobid;

select job.jobname, run.status, run.start_time, run.end_time
from cron.job_run_details run
join cron.job job on job.jobid = run.jobid
where job.jobname in ('trakflit-process-waybill-pdfs','trakflit-process-waybill-notifications')
   or job.jobname = 'trakflit_dev_process_waybill_pdfs'
   or job.jobname ilike '%waybill%notification%'
order by run.start_time desc
limit 20;

select name
from vault.secrets
where name in ('project_url','publishable_key','waybill_pdf_worker_secret',
               'trip_notification_worker_secret')
order by name;
```

### Safely classify the existing PDF Cron command

This query never returns `cron.job.command`, function source, header values, Vault values, URLs, or request bodies. It reports only the top-level called function identifier and boolean indicators. A direct `net.http_post` command is an HTTP invocation; a named top-level SQL function is a wrapper candidate; a SQL statement without a detected top-level call or a placeholder/other command needs further review. If a wrapper candidate delegates to another helper and all body indicators are false, inspect that helper using the same redacted pattern before classifying it.

```sql
with target_job as (
  select jobid, jobname, schedule, active, command,
         regexp_match(
           command,
           '(?i)^[[:space:]]*(select|call|perform)[[:space:]]+((?:"[^"]+"|[a-z_][a-z0-9_]*)(?:[.](?:"[^"]+"|[a-z_][a-z0-9_]*))?)[[:space:]]*[(]'
         ) as call_match
  from cron.job
  where jobid = 1
    and jobname = 'trakflit_dev_process_waybill_pdfs'
), normalized as (
  select target_job.*,
         replace(call_match[2], '"', '') as called_function
  from target_job
), parts as (
  select normalized.*,
         string_to_array(called_function, '.') as function_parts
  from normalized
)
select jobid, jobname, schedule, active,
       called_function as first_called_function,
       case
         when command ~* 'net[.]http_post[[:space:]]*[(]' then 'direct_http_invocation'
         when called_function is not null then 'function_wrapper_candidate'
         when command ~* '^[[:space:]]*(select|call|perform|do)[[:space:]]' then 'sql_without_detected_function_call'
         else 'placeholder_or_other'
       end as command_class,
       command ~* 'net[.]http_post[[:space:]]*[(]' as command_calls_pg_net,
       command ~* 'process-waybill-pdfs' as command_mentions_pdf_function,
       command ~* 'x-worker-secret' as command_mentions_worker_header,
       command ~* 'vault' as command_mentions_vault,
       command ~* 'limit' as command_mentions_batch_limit,
       coalesce(wrapper.body_calls_pg_net, false) as wrapper_body_calls_pg_net,
       coalesce(wrapper.body_mentions_pdf_function, false) as wrapper_body_mentions_pdf_function,
       coalesce(wrapper.body_mentions_worker_header, false) as wrapper_body_mentions_worker_header,
       coalesce(wrapper.body_mentions_vault, false) as wrapper_body_mentions_vault,
       coalesce(wrapper.body_mentions_batch_limit, false) as wrapper_body_mentions_batch_limit
from parts
left join lateral (
  select bool_or(p.prosrc ~* 'net[.]http_post[[:space:]]*[(]') as body_calls_pg_net,
         bool_or(p.prosrc ~* 'process-waybill-pdfs') as body_mentions_pdf_function,
         bool_or(p.prosrc ~* 'x-worker-secret') as body_mentions_worker_header,
         bool_or(p.prosrc ~* 'vault') as body_mentions_vault,
         bool_or(p.prosrc ~* 'limit') as body_mentions_batch_limit
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.proname = function_parts[array_length(function_parts, 1)]
    and (array_length(function_parts, 1) = 1 or n.nspname = function_parts[1])
) wrapper on true;
```

No rows means the named job is absent or has changed identity; stop and inspect the job list. The indicators are heuristic: a wrapper can delegate to another function or build its request dynamically. A wrapper candidate with no direct indicators is not proof that it is a placeholder; inspect its referenced helper chain before approving activation.

Do not select Vault secret values, cron command text, notification recipients/payloads, or response bodies from `net._http_response`.

## Configuration checklist (names only)

### PDF Edge Function

- `WAYBILL_PDF_WORKER_SECRET`: independent random value with at least 32 characters; store the matching value in Vault for the PDF schedule.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: Supabase runtime-provided values; do not upload custom copies or expose them to the scheduler.
- `verify_jwt = false` is required by the current custom `x-worker-secret` handler; keep the secret comparison enabled. The scheduler also supplies a publishable API key in `apikey` for the gateway.
- Deploy the function with `supabase/config.toml` static file declaration so `assets/trakflit-logo.jpg` is bundled.

### Notification Edge Function

- `TRIP_NOTIFICATION_WORKER_SECRET`: separate random value, at least 32 characters; matching value stored in Vault.
- `RESEND_API_KEY`: server-only provider key.
- `TRIP_NOTIFICATION_FROM`: verified Resend sending identity; no CR/LF; verify domain and sender in Resend before activation.
- `WAYBILL_CLIENT_EMAIL`: optional target-company recipient. Missing/invalid configuration blocks Company notification reconciliation; it does not block Driver processing.
- `WAYBILL_NOTIFICATION_DELIVERY_ENABLED`: explicit kill switch. Keep `false` (or unset, which fails closed) until the controlled recipient-sink test is approved and passed.
- `WAYBILL_TEST_RECIPIENT_SINK_ENABLED`: normally `false`. `true` is accepted only for the exact DEVELOPMENT project and routes all messages to the code-configured sink; do not use as a production setting.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are runtime-provided. The secure worker no longer requires `TRIP_NOTIFICATION_FINANCE_EMAILS`; do not remove any old project secret until other consumers are independently checked.
- `verify_jwt = false` is required by the custom worker-secret handler. Keep `x-worker-secret` authentication enabled.

### Scheduler/Vault integration

Supabase Cron uses `pg_cron` and `pg_net`; Supabase recommends storing the project URL and API key in Vault for function invocation. Store only the publishable key for the gateway `apikey` header and the worker-specific secret for `x-worker-secret`; never store or send the service-role key from Cron. The custom worker secret is the function's application authentication. [Supabase scheduling guidance](https://supabase.com/docs/guides/functions/schedule-functions)

Do not create or activate jobs during this change. After separate approval, schedule only these POST calls, with JSON `{"limit":1}` and Vault-backed headers. Keep job names distinct. Suggested initial cadence is PDF every minute and notification every two minutes; do not schedule notification delivery until the eligible historical candidate review and controlled sink test are approved. Supabase recommends keeping Cron work under ten minutes and limits concurrent jobs; these small batches intentionally stay well below that. [Supabase Cron guidance](https://supabase.com/docs/guides/cron) [Edge Function runtime limits](https://supabase.com/docs/guides/functions/limits)

The request must use `Content-Type: application/json`, `apikey` from Vault, and `x-worker-secret` from the matching Vault entry. Do not add a user JWT or service-role Authorization header. Set a bounded `pg_net` timeout; inspect the stored HTTP status metadata without returning or printing response bodies.

## Controlled deployment and activation sequence

No deployment or scheduling is authorized by this work item. For a separately approved rollout:

1. Confirm the DEVELOPMENT project reference and verify migration 002/003 objects and RPC grants using the read-only checks above. Do not apply or repair migrations as part of worker deployment.
2. Inspect counts for every `notification_outbox` event stream and all legacy PDF rows. Review the candidate query row by row. Do not automatically dispatch pending historical candidates; obtain explicit approval for any candidate backlog.
3. Configure Edge secrets by name. Keep notification delivery disabled and both schedulers inactive. Confirm `verify_jwt=false` plus the handler secret check for both functions.
4. For a PDF-only rollout, deploy only `process-waybill-pdfs` with its static logo, verify the deployed version and secret presence without printing values, and keep the notification function/schedule untouched. Confirm `WAYBILL_NOTIFICATION_DELIVERY_ENABLED` is false or absent and the notification schedule remains inactive. The PDF worker calls no notification RPC or email provider: it only claims secure copy jobs, reads their lease-bound snapshots, uploads to the copy-specific private bucket, and finishes the PDF job. Once a PDF execution test is separately approved, activate only a verified PDF schedule whose command targets `process-waybill-pdfs`; first classify the existing job with the redacted query above. Stop if it is a placeholder, an unexpected wrapper, or its target/authentication cannot be established. PDF readiness alone does not authorize email delivery.
5. Deploy `process-trip-notifications` only after reviewing the worker version. Keep `WAYBILL_NOTIFICATION_DELIVERY_ENABLED=false`, `WAYBILL_TEST_RECIPIENT_SINK_ENABLED=false`, and its scheduler inactive.
6. Under a separately authorized controlled test using synthetic recipient fixtures, set the notification delivery switch true and the DEVELOPMENT-only sink true; invoke a single limit-1 test request through a trusted method. This consumes/attempts claimed queue jobs, so do not use an unreviewed production backlog as the test fixture. Verify only aggregate status and provider acceptance in logs; never print recipients, PDF content, tokens, or bank values.
7. After the sink test passes and a separate approval authorizes real recipient delivery, set the sink false, set the delivery switch true, and activate the notification schedule. Enable the PDF schedule separately. A schedule or secret change is not part of this implementation.
8. Observe at least one full interval and verify RPC success, no auth/config failures, no unexpected `trip_closed` transitions, bounded lease age, PDF retry counts, notification provider acceptance counts, and backlog age before increasing cadence or batch size.

## Monitoring

- Inspect grouped queue counts using the SQL above: pending/due, failed, blocked, active processing and expired leases by event stream/audience/copy kind.
- Track Edge invocation status/duration and the aggregate counters returned by each worker. Do not log request/response bodies, recipient arrays, full SQL errors, signed URLs, service-role keys or PDF/bank data.
- PDF: alert on nonzero `claim_errors`, repeated `deferred`, `unacknowledged`, attempt-limit failures, and increasing age of pending rows. Confirm Company copy blocks separately from Driver readiness.
- Notifications: distinguish `reconciliationFailed`, `deferred`, `unacknowledged`, and `sent` (provider accepted). Check Resend activity for delivered, bounced, and rejected events. Alert on expired processing leases, retry exhaustion, old pending candidates, configuration-blocked Company rows, provider timeouts, and any unexpected `trip_closed` status changes.
- Inspect Cron job history by job name, timestamps and status only. Keep response bodies and command text out of copied diagnostics.

## Rollback and incident response

1. If delivery is wrong or uncertain, first disable the notification Cron job and set `WAYBILL_NOTIFICATION_DELIVERY_ENABLED=false`; this stops new claims before code changes. If PDF generation is implicated, disable its Cron job as well.
2. Wait at least the five-minute lease interval before redeploying or retrying; verify no active lease remains. Do not clear or reset job rows manually.
3. For provider timeouts or lost acknowledgements, preserve the stable idempotency key and consult Resend activity before any manual retry. Never change the key to force a resend without an approved incident decision.
4. Keep historical `trip_closed` notifications and legacy PDF documents/objects untouched. Do not grant EXECUTE on retired legacy PDF RPCs and do not change migration history.
5. If a worker deployment is rolled back, leave schedules inactive and notification delivery disabled until the replacement version and queue contracts are re-verified. Database migrations/data are not rolled back as part of this worker procedure.
