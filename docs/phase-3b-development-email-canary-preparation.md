# Phase 3B — Development Email Canary Preparation

**Status: NOT READY TO PROVISION — no live SQL, worker, or email operation was performed.**

This document records the local schema review and a read-only preflight. It is not a provisioning script and must not be used to create records or arm a canary.

## Current implementation

The additive migration `20261021133526_secure_synthetic_waybill_email_canary.sql` and isolated CI coverage are prepared; they are not deployed. Provisioning is bound to explicit Vault project/enablement entries and service-role-only RPCs. A one-use permit is limited to the dedicated synthetic driver/truck, V4 registration capture, active Loading Officer site assignment, fixed `.invalid` recipients, and a post-cutoff open trip. The permit is consumed by the normal trip-close trigger; ordinary WB numbering and standard closure side effects remain unchanged. No session GUC authorizes the flow and no operational trigger is disabled.

Normal PDF claims exclude only `WB-9999-999999`; a separate service-role RPC claims one copy kind for that exact permitted invoice, validates the latest copy version, private bucket/path, no Driver bank snapshot, and a verified Company snapshot. Canary worker mode requires explicit opt-in, the selected invoice ID, and the approved DEVELOPMENT Supabase host; it independently validates claim results and verifies stored PDF bytes. Default batch processing and the existing scheduler remain unchanged.

The post-cutover provisioning RPC requires an active reserved-invoice canary and both latest eligible PDFs. It creates exactly two invoice-bound `waybill_ready` rows with fixed `.invalid` recipients; advisory locking, duplicate validation and immutable outbox guards reject duplicate or unrelated inserts. Regular email reconciliation/claims remain blocked while a canary is armed. Disarm refuses active leases; expiry recovery touches only the reserved synthetic jobs and safely disarms the run.

## CI closure response contract and schema parity

The pinned CI migration chain uses the canonical `20260925000400_offloading_alignment` response contract: `close_trip_v2` returns `ok`, `request_id`, trip identity/status, capture data, and the notification flag, but does not return `waybill.invoice_number`. The later `20260925000500_waybill_backend_extension` adds a `waybill.invoice_number` response field. Canary fixture assertions therefore require success, matching request ID and trip identity, and closed status from the RPC; when the optional Waybill field is present, it must match the expected number. Invoice number, invoice-to-trip association, and closure timestamps are verified directly against `trip_closure_invoices` and `trips` for both reserved and ordinary closures. This CI compatibility does not establish the deployed Development function contract. Before deployment, perform a separate read-only parity check of the live `public.close_trip_v2` definition and confirm whether its response includes `waybill.invoice_number`; do not change the pinned migration baseline to mask a schema difference.

CI uses only synthetic `storage.objects` metadata; it does not call external Storage. Edge worker tests mock HTTP/Storage and do not call Resend or any email provider. The workflow does not connect to DEVELOPMENT or PRODUCTION.

## Findings before implementation (historical)

- The trip invoice trigger generates `INV-<Lagos year>-<sequence>` on the normal open-to-closed transition. The trip guard requires new trips to start open, and invoice rows are immutable. The normal workflow therefore cannot create the reserved `WB-9999-999999` invoice. CI creates this synthetic invoice by directly seeding rows before the email cutover migration; that is not a safe DEVELOPMENT provisioning path.
- The cutover's canary guard accepts only a closed, post-cutoff `WB-9999-999999` invoice. No dedicated, audited DEVELOPMENT-only provisioning RPC or invoice-number override exists in the inspected migration.
- Outbox direct DML is revoked from API roles and `service_role`. The outbox trigger permits a `waybill_ready` insert for the reserved invoice only while a valid canary run is armed. The claim RPC consumes existing Driver and Company jobs; it does not create them. A privileged SQL Editor transaction could satisfy the current trigger, but doing so before there is a supported synthetic-invoice creation path would bypass the approved trip lifecycle and is not approved here.
- The existing CI fixture creates its canary notification rows before applying the cutover migration. Its 300-assertion pass verifies canary claim isolation, not post-cutover provisioning of new notification rows under the guard.
- The PDF claim RPCs accept an optional invoice ID, but the deployed PDF Edge Function currently calls them with only a batch limit. Invoking it can claim unrelated pending jobs. No invoice-scoped worker mode is present.
- Registration-capture snapshots are created with source `registration_capture` and null verification actor/time. The current PDF/notification eligibility checks require a bank snapshot ID, not a non-null `verified_at`. If this canary is required to prove an explicitly verified snapshot, its synthetic banking step must use the authorized Operations Manager workflow or the eligibility contract must be separately reviewed.
- The payment-free predecessor removes the old `snapshot_closed_trip` trigger that created `trip_closed` emails. In the checked-in migration lineage, a normal new closure does not add a legacy `trip_closed` row. Confirm the corresponding trigger inventory in Development before relying on that result.

## Original design gaps (addressed above)

1. Approve a forward-only, narrowly scoped way for the normal trip-close transaction to produce the reserved synthetic invoice while preserving the open/close triggers, audit and immutable invoice behavior. It must be disabled by default and verifiably unavailable outside Development; do not solve this with trigger disabling, direct invoice edits, sequence tricks, or a general invoice-number override.
2. Add CI coverage that starts with no canary `waybill_ready` rows, applies the cutover, arms only the reserved synthetic invoice, creates exactly its Driver and Company rows through the authorized provisioning path, and proves regular reconciliation/claims remain blocked. Retain the existing excluded-history and rollback assertions.
3. Either add a fail-closed Development-only invoice filter to the PDF worker and test it, or establish by read-only preflight that no unrelated secure PDF jobs can be claimed. Do not invoke the current unfiltered worker when unrelated jobs may be pending.
4. Keep email delivery disabled. Any later delivery test requires separate approval, Development URL and secret checks, the fixed recipient sink, and a short-lived canary run.

## Read-only preflight and dry-run query

Run only after confirming the Dashboard URL is the Development project `pidxlopbxlapfmakmtjt`. This query is read-only and reports aggregate counts/fingerprints, not recipients or bank values. A mismatch from the supplied baseline (76 outbox rows and fingerprint `a30184b6880850e0fd4654ec4be912c4`) is a stop condition.

```sql
begin read only;

select current_database() as database_name,
       current_user as database_role,
       current_setting('server_version') as postgres_version;

select version
from supabase_migrations.schema_migrations
where version in ('20261021000000');

select count(*)::integer as outbox_rows,
       md5(coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.id), '[]'::jsonb)::text)
         as outbox_fingerprint,
       count(*) filter (where row_data.status = 'processing')::integer as processing_rows
from public.notification_outbox as row_data;

select count(*)::integer as reserved_invoice_count
from public.trip_closure_invoices
where invoice_number = 'WB-9999-999999';

select count(*)::integer as armed_or_unclosed_canary_runs
from private.waybill_notification_canary_runs
where disarmed_at is null;

select event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table in ('trips', 'trip_closure_invoices', 'notification_outbox')
order by event_object_table, trigger_name, event_manipulation;

select copy_kind, status, count(*)::integer as jobs
from public.trip_closure_invoice_pdf_copies
group by copy_kind, status
order by copy_kind, status;

select to_regprocedure('public.claim_driver_waybill_pdf_jobs(integer,uuid)') is not null
         as driver_claim_rpc_present,
       to_regprocedure('public.claim_company_waybill_pdf_jobs(integer,uuid)') is not null
         as company_claim_rpc_present,
       to_regprocedure('public.claim_waybill_notification_canary(text,uuid,text,integer)') is not null
         as canary_claim_rpc_present,
       has_function_privilege('service_role',
         'public.claim_waybill_notification_canary(text,uuid,text,integer)', 'EXECUTE')
         as canary_claim_service_role_execute;

rollback;
```

The two `current_database/current_user` fields do not prove the Supabase project identity; confirm the project reference in the Dashboard before running. Expected values from the request are not a substitute for rechecking the live result. The dry-run outcome for this preparation is **zero records created**. No exact live post-provision record count can be reported because provisioning is blocked before a supported reserved-invoice path exists.

## Original record plan (superseded by the implementation above)

The earlier proposal expected one synthetic truck, driver, registration receipt/capture, daily registration, normal-lifecycle trip, reserved invoice, invoice-specific bank/audit chain, secure PDF copies and then two `waybill_ready` rows. The CI implementation above uses synthetic Storage metadata in SQL and separately verifies actual PDF byte validation with mocked worker HTTP; it does not perform external Storage uploads.

Historical proposal, not current execution instructions: no canary rows are created before the cutover guard. CI applies the additive canary migration before creating the two rows via the guarded provisioning RPC. CI asserts all outbox rows outside the explicit synthetic trip remain unchanged; its total is not hardcoded to DEVELOPMENT's 76-row baseline.

Historical note, superseded: the implementation now uses service-role-only provisioning RPCs; it does not require direct outbox DML or a SQL Editor insertion procedure. Those RPCs must remain unused in DEVELOPMENT until separate deployment/provisioning approval.

## Preservation, rollback, and execution gates

- Before any approved provisioning, record the exact outbox count and full-row fingerprint, require zero processing rows, require no canary row with `disarmed_at is null`, and require the reserved invoice to be absent. Inventory expected trip-close side effects and secure PDF backlog without exposing row contents.
- Provision only through the approved synthetic workflow and a transactionally guarded, Development-only mechanism. Do not disable triggers or edit historical rows. Fail on any duplicate key, unexpected row count, unexpected status, or fingerprint delta outside the explicitly enumerated synthetic rows.
- Generate both copies through the secure PDF worker. Verify object existence, expected private bucket/path, non-zero file size and PDF parseability before accepting ready status. Do not set ready fields manually.
- A pre-commit transaction can roll back SQL setup only before external object uploads or email delivery. Once PDFs exist, stop the worker and use a separately reviewed, invoice-scoped cleanup/recovery plan; immutable invoice, snapshot, audit, and notification rows are not to be deleted or rewritten. Preserve artifacts and disarm only after proving there are no processing/ambiguous notification leases.
- Do not arm the canary, enable the delivery flag, invoke the notification worker, send email, or create a scheduler without separate approval.
