# Secure Waybill PDF worker

## Database contract

The worker requires the already-reviewed dual-copy foundation migration `20261013000200_secure_dual_waybill_foundation.sql`. It calls only the service-role RPCs `claim_driver_waybill_pdf_jobs`, `get_driver_waybill_pdf_snapshot`, `finish_driver_waybill_pdf_job`, `claim_company_waybill_pdf_jobs`, `get_company_waybill_pdf_snapshot`, and `finish_company_waybill_pdf_job` for secure copies. The database remains authoritative for role checks, bank-snapshot eligibility, attempt limits, leases, retry timing, and finish acknowledgement. Do not deploy or invoke this worker until those contracts are installed and verified. This change adds no migration and performs no database operation.

The company claim RPC excludes copies without a verified bank snapshot. The driver RPC returns only operational fields, and the worker constructs a driver renderer input containing no phone or banking properties. Company fields are accepted only from the lease-bound company snapshot RPC.

## Storage and idempotency

- Driver copies upload only to `waybill-driver-copies`.
- Company copies upload only to `waybill-company-copies`.
- Secure uploads use `x-upsert: false`; a pre-existing PDF is confirmed with a `HEAD` request rather than replaced.
- The legacy code path retains its existing `waybills` bucket, legacy snapshot/finish RPCs, and upload behavior when that legacy RPC contract remains authorized.
- RPC errors and Storage responses are not logged or returned verbatim. Counts contain no Waybill or bank values.

## Legacy queue compatibility

Migration `20261013000200_secure_dual_waybill_foundation.sql` explicitly revokes `service_role` execution of the legacy `claim_waybill_pdf_jobs`, `get_waybill_pdf_snapshot`, and `finish_waybill_pdf_job` RPCs. Therefore, after that migration is applied, historical legacy jobs cannot be processed through the old worker contract. The worker treats a denied legacy claim as a queue-level error and continues to the independent secure driver/company queues; it does not bypass the revocation with direct table access. The old processing path remains available only in environments where those legacy RPC grants still exist.

Historical legacy records and objects are not rewritten. If pending legacy jobs must be drained after the secure migration, that requires a separately reviewed, recipient-safe database contract and explicit approval; do not restore the old grants or attach legacy PDFs to driver notifications as a workaround.

## Notification worker follow-up (not included)

Do not deploy or enable the current `process-trip-notifications` worker against the secure notification contract. Its current calls are incompatible and its legacy PDF fallback is unsafe for historical documents:

- Reconcile recipients with `enqueue_waybill_ready_notifications(p_company_recipient text)`, passing the configured `WAYBILL_CLIENT_EMAIL` or `null`; the current empty-argument call selects the legacy no-argument overload and does not configure the secure company recipient.
- Claim only secure Waybill-ready delivery jobs through `claim_waybill_notifications(p_sender text, p_limit integer)`. This contract returns recipient-specific `waybill_ready` jobs only; it does not replace handling for the separate legacy `trip_closed` event stream.
- Resolve each attachment with the lease-bound `get_waybill_notification_pdf(p_notification_id uuid, p_lease_token uuid)`. Validate that `copy_kind` matches the audience (`driver` for driver, `company` for client), then fetch only the returned private bucket/path. Never trust `payload.storage_path`, call the legacy `get_waybill_ready_pdf`, or fall back to the public-era `waybills` bucket.
- Preserve the existing `finish_trip_notification(p_id, p_lease_token, p_sent, p_provider_message_id, p_error)` lease acknowledgement and provider idempotency key. Treat a missing or mismatched resolver result as no attachment and do not mark the job sent.

Historical notifications without an eligible current dual-copy record must remain untouched and must never trigger email attachment fallback. Keep notification-worker deployment and its scheduler disabled until these changes have their own tests and approval. This PDF-worker branch does not change `process-trip-notifications`.

## Function deployment and invocation

The repository's `supabase/config.toml` sets `verify_jwt = false` for `process-waybill-pdfs`. Keep that setting aligned with the handler, which requires a sufficiently long `WAYBILL_PDF_WORKER_SECRET` in the `x-worker-secret` header before it reads the batch request or calls the database. Never expose this secret in browser code, logs, command output, or source control. The function also uses the platform-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only server-side.

Deploy the complete function directory, including `secure_pdf.ts`, `types.ts`, `assets/trakflit-logo.jpg`, `pdf.ts`, and the pinned `npm:pdf-lib@1.17.1` import. Do not deploy only `index.ts` or omit the image asset. The worker accepts a POST JSON body with `limit` from 1 through 10 (default 5). Scheduler calls must send `x-worker-secret` and must use the same secret value configured for the function.

The scheduler/Vault implementation is external to this repository's migrations. Before scheduling, verify its Vault secret selection, target project URL, request headers, POST method, and batch payload. Keep the existing PDF schedule disabled until separately authorized. This change neither invokes the scheduler nor enables or changes cron.

## Local checks

Run the focused synthetic tests with `npm run test:waybill-pdf-worker` and Operations UI contracts with `node scripts/test-operations-waybills.mjs`. They use mocked HTTP/RPC/Storage transports and do not contact Supabase or send email. The database enforces the actual lease, retry, and authorization behavior; those database contracts are not integration-tested by these mocked tests.
