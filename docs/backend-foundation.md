# MVP backend foundation

This document records the approved MVP implemented by the three migrations in
`supabase/migrations`. It supersedes the original BRD/TRD for this milestone.
The frontend is unchanged. No remote database was linked or modified.

## Model and invariants

| Entity | Purpose |
| --- | --- |
| `profiles` | Auth user identity, one application role, active status |
| `sites` | Reusable loading/offloading locations; at most one active loading site |
| `drivers` | Name, phone, optional email, active status |
| `driver_payment_details` | Restricted Nigerian bank details, one current account per driver |
| `trucks` | Display plate, generated unique normalized plate, current driver |
| `daily_registrations` | Unique truck/Lagos date; freezes that day's operational driver |
| `trips` | Loading/closure fields, frozen truck/driver references, unique sequence number |
| `exceptions` | Independent issues with explicit `blocks_operations` |
| `trip_payments` | One closure snapshot per completed trip, separately recorded later bank details, payment readiness and paid tracking |
| `notification_outbox` | Separate driver/finance email jobs, frozen message, lease, retries, outcome |
| `audit_log` | Append-only material changes with actor and before/after values |

Trips use `open`, `closed`, and `cancelled`. Raising an exception never changes
trip status. An open trip or unresolved blocking exception prevents another
trip for that truck. Only `open` participates in the unique partial trip index.
Exceptions can be raised against a truck, a trip, or an unknown entered plate.
An unknown plate cannot block an unrelated truck.

Plate normalization uses ASCII case folding and removes spaces and hyphens;
remaining characters must be A-Z or 0-9. Both display and normalized forms are
stored. Bank account numbers are text containing exactly ten digits, preserving
leading zeros. This is format validation, not bank-account ownership verification.

The first **successful** opening creates the registration. Rejected attempts do
not create registrations. `operational_date` is generated from the database's
statement timestamp in `Africa/Lagos`; authoritative timestamps are `timestamptz`.
The same statement timestamp is used for opening and registration, including
requests that span midnight. A trip opened before midnight can close the next
day and remains attached to its original daily registration.

The registration driver is authoritative for subsequent trips that day. Changing
`trucks.driver_id` affects future daily registrations; it never rewrites today's
registration or historical trips. An inactive frozen driver prevents new trips
until an administrator resolves the issue. Same-day driver replacement is not
implemented. Composite foreign keys bind each trip to its registration's truck
and driver. No separate assignment or loading/offloading event tables exist.

Trip numbers use a bigint sequence, starting `TRP-0000000001`; gaps are expected.
The formatter expands beyond ten digits rather than truncating numbers.
Delivered tonnes are `numeric(10,2)` and must be positive; the closure RPC rejects
extra decimal places rather than silently rounding. No loading quantity exists.

## Authorization

Every application table has RLS. Anonymous access is revoked. Active profiles
with one of the six roles can read operational records. Restricted banking data
is kept out of these records and out of RPC responses to field officers.

| Role | Permitted writes |
| --- | --- |
| System administrator | Master data, profiles/roles, opening/closure, exception resolution/cancellation, bank data, payment reconciliation |
| Loading officer | Open trips; raise exceptions |
| Offloading officer | Close trips at any active offloading site; raise exceptions |
| Operations manager | Raise/resolve exceptions; cancel open trips |
| Finance officer | Maintain bank details; complete missing payment details; mark pending payments paid; request investigated email retries |
| Audit reviewer | None |

Only administrators and finance can read bank details, payment snapshots, outbox
payloads, or their sensitive audit entries. Operations managers and audit
reviewers can inspect operational audit history. Profiles are readable by the
profile owner and administrators. No officer-site membership is implemented.

Critical tables have no client INSERT/UPDATE/DELETE grants. Lifecycle RPCs use
`SECURITY DEFINER`, an empty search path, schema-qualified references, and
database role checks. PUBLIC/anon execution is revoked. Worker RPCs are granted
only to `service_role`, not to authenticated application users. That key is
never used by the React application.

New Auth users receive an **inactive, unassigned** profile. User metadata is
never trusted for authorization. Bootstrap the first administrator explicitly
using trusted local SQL against the intended Auth user ID, then use that
administrator to activate/assign other profiles. Do not seed production users or
credentials. Keep administrative Auth provisioning server-side.

## RPC contract

| RPC | Result and behavior |
| --- | --- |
| `create_loading_trip(p_plate text)` | JSON `{ok:true, trip}` or `{ok:false, code, exception_id}`; truck lock, active validation, daily registration, blockers, sequence and audit in one transaction |
| `close_trip(p_trip_id uuid, p_offloading_site_id uuid, p_quantity_tonnes numeric)` | JSON `{ok:true, trip, notification_queued:true}` or `{ok:false, code}`; locks truck then trip, validates physical closure, closes, snapshots available details and queues atomically; missing bank data never blocks closure |
| `raise_trip_exception(p_type exception_type, p_description text, p_truck_id uuid = null, p_trip_id uuid = null, p_entered_plate text = null, p_blocks_operations boolean = false)` | UUID of new issue; infers truck from trip and rejects conflicting references |
| `resolve_trip_exception(p_exception_id uuid, p_reason text)` | Resolves issue with actor/time/reason; does not close or reopen the trip |
| `cancel_trip(p_trip_id uuid, p_reason text)` | Cancels only an open trip; retains history and does not create a payment |
| `mark_trip_payment_paid(p_payment_id uuid, p_payment_reference text)` | Pending to paid only; records authenticated actor, time and required external payment reference |
| `complete_trip_payment_details(p_payment_id uuid, p_account_name text, p_account_number text, p_bank_name text, p_reason text)` | Finance/admin only; atomically upserts current driver bank details, records later-supplied details on the selected payment, marks it pending, and audits both changes |
| `retry_trip_notification(p_id uuid, p_reason text)` | Finance/admin can requeue failed jobs within their original delivery-attempt window; first attempt, identity and message remain unchanged; audited |
| `claim_trip_notifications(p_finance_recipients text[], p_sender text, p_limit integer = 5)` | Worker only; leases due jobs with `FOR UPDATE SKIP LOCKED`, freezes recipients and request body |
| `finish_trip_notification(p_id uuid, p_lease_token uuid, p_sent boolean, p_provider_message_id text = null, p_error text = null)` | Worker only; acknowledges matching lease or returns false; failures retry without touching trips |

Operational rejection codes include `INVALID_PLATE`, `UNKNOWN_TRUCK`,
`INACTIVE_TRUCK`, `INVALID_DRIVER`, `NO_ACTIVE_LOADING_SITE`, `OPEN_TRIP_EXISTS`,
`BLOCKING_EXCEPTION`, `TRIP_NOT_FOUND`, `TRIP_NOT_OPEN`, `INVALID_QUANTITY`,
`INVALID_OFFLOADING_SITE`. Authorization failures
raise SQLSTATE `42501`. A frontend must check `ok`, not just HTTP success.

Expected loading rejections are persisted as nonblocking issues; an existing
blocking issue is returned rather than duplicated. Duplicate arrival issues
remain visible but do not require resolution to unblock an already closed trip.
Closure validation failures return a code without mutating the trip; officers
can explicitly raise an issue when investigation is needed.

An unresolved blocking exception prevents **opening another trip**, not closure
of an existing one. Closing does not silently resolve exceptions. This follows
the approved separation of exception handling from trip lifecycle.

Closed trips, frozen registrations and closure-time payment snapshots cannot be
silently edited. Missing bank details may be supplied once in separate columns
through the audited completion RPC. Advanced historical correction/reassignment is deliberately not exposed
in this foundation; use an exception for disputes until its approval workflow is
specified. Master-data changes are audited with before/after values.

## Payment and email transaction

Physical closure does not depend on the **trip's frozen driver's** bank details.
Every successful closure creates exactly one payment record:

- Complete bank details: `pending`, with the closure-time bank snapshot retained.
- Missing bank details: `payment_details_required`, with missing bank fields
  explicitly NULL and the available driver/contact snapshot retained.

Both cases queue a finance notification and, when a valid email exists, a
separate driver notification. Missing-details emails clearly state that physical
delivery completed but payment details were unavailable at closure and must be
completed by finance/admin. They display missing fields as unavailable, not fake
account data. They describe closure-time state and direct recipients to the
current payment record for later resolution.

Snapshot creation runs in an AFTER UPDATE trigger inside the closure transaction;
any snapshot or enqueue failure rolls back closure. Later changes to the driver
or bank record cannot change the historical snapshot or queued email payload.
An incomplete payment does not create a blocking operational exception and does
not prevent the truck's next trip after closure.

`complete_trip_payment_details` accepts complete bank details and a required
reason. It locks the driver and affected payment, upserts the current bank record,
and transitions only that selected payment from `payment_details_required` to
`pending`. It does not silently repair other historical payments for the driver.
The original `account_name`, `account_number`, and `bank_name` remain NULL when
unknown at closure; the later values are saved separately in
`supplied_account_name`, `supplied_account_number`, and `supplied_bank_name`.
`payment_ready_at` and `payment_ready_by` record when and by whom readiness was
established. For payments ready at closure, these identify the closure timestamp
and closing officer whose operation captured the existing bank record, not an
independent verification of bank ownership. Bank master-data changes and the
readiness transition both retain before/after audit entries.

Finance reads the effective account from the original snapshot if present,
otherwise from the supplied fields. The supplied fields are frozen once ready.
The permitted lifecycle is `payment_details_required -> pending -> paid`, or
`pending -> paid` when bank details were available at closure. Directly marking a
details-required payment paid is rejected. Completion does not rewrite the
original closure notification or emit an additional notification event.

Email provider calls run only in `process-trip-notifications`, after commit.
The initial adapter uses Resend's HTTP API. No account has been created, no
credentials configured, no function deployed, and no messages sent by this work.
The payment rate/amount was not specified and is not invented; reconciliation
records track a completed trip and manual payment status, not automatic transfers.

Configure these **server-side secrets** at deployment:

- `RESEND_API_KEY`: sending credential for the selected Resend account.
- `TRIP_NOTIFICATION_FROM`: verified sender address.
- `TRIP_NOTIFICATION_FINANCE_EMAILS`: comma-separated trusted finance/admin recipients.
- `TRIP_NOTIFICATION_WORKER_SECRET`: independent random secret, at least 32 characters.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: supplied by hosted Supabase.

### Environment files and local setup

| File | Purpose | Git status |
| --- | --- | --- |
| `.env.example` | Browser-only variable names and fake examples | Safe to track |
| `.env.local` | Developer's actual `VITE_SUPABASE_URL` and public `VITE_SUPABASE_ANON_KEY` | Ignored |
| `supabase/functions/.env.example` | Four custom worker variable names plus commented runtime-injected variables | Safe to track; no credentials |
| `supabase/functions/.env` | Developer's four actual custom worker settings | Ignored |

Never overwrite another developer's environment file. The local files were
initially created with empty values, leaving the worker unconfigured until a
developer supplies the settings. Supply values locally; do not paste secrets into chat.
Root `.env`, `.env.local`, `.env.production`, and all other `.env.*` variants are
ignored, except explicitly named `.env.example` files. The same protection
applies within `supabase/`. Git ignore rules do not untrack an already tracked
file; inspect staged changes before committing.

Vite exposes `VITE_` variables to browsers by design. Use only the intended
public Supabase URL and anon key there. The service-role key, Resend credential,
and worker secret must never receive a `VITE_` prefix. There is no custom Vite
`envPrefix`, `define`, or `loadEnv` override in the current scaffold.

For local function execution, the Supabase CLI automatically reads
`supabase/functions/.env`; you can also explicitly use
`npx --no-install supabase functions serve process-trip-notifications --env-file supabase/functions/.env`
once the local stack is running. This command is not a deployment. The CLI and
hosted Edge Runtime automatically inject `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`. Do not manually upload variables with the reserved
`SUPABASE_` prefix or copy a remote service-role key into local browser settings.
The template lists those two names as commented documentation placeholders.

Obtain a sending API key from the Resend dashboard and verify a sender domain
you control through its DNS instructions. Supply the approved sender and finance
recipient addresses yourself. Generate the worker secret independently (at least
32 random characters). Put those four values only in the ignored functions
environment file for local use. Later, after deployment is authorized, configure
them in Supabase Edge Function Secrets and configure the worker secret in your
trusted scheduler's secret store. No scheduler, domain verification, or hosted
secret has been configured by this repository work.

Verify protection without displaying values:

```powershell
git check-ignore -v .env.local .env.production supabase/functions/.env
```

References: [Vite environment exposure](https://vite.dev/guide/env-and-mode) and
[Supabase runtime secrets and reserved names](https://supabase.com/docs/guides/functions/secrets).

The function disables gateway JWT checking because it authenticates a trusted
scheduler with `x-worker-secret`. It accepts POST only, performs a constant-time
hashed secret comparison, ignores request-body recipient data and has no browser
CORS support. Never expose this secret or service key in `VITE_*` variables.

After separately authorized deployment, arrange a trusted server-side scheduler
to POST to `/functions/v1/process-trip-notifications` every minute with the secret
header. Scheduling is required: merely queueing a row does not execute an Edge
Function. No remote scheduler/webhook has been provisioned in this milestone.
Missing provider/configuration leaves notifications queued without affecting
trip closure. A development-only blank environment template is supplied; no
existing environment files are replaced.

Retries use five-minute leases, up to eight attempts, bounded exponential backoff,
and a stable provider idempotency key per outbox row. Driver and finance requests
are separate, so a finance failure does not resend an acknowledged driver email.
Automatic retry stops before the provider's 24-hour deduplication window ends;
old/ambiguous jobs require finance/admin review. Manual retry preserves the
original `first_attempt_at`, row ID, recipients, frozen request and provider
idempotency key. It resets the per-run attempt count and retry scheduling only;
it cannot extend the original 23-hour safety window. Ordinary retry rejects both
expired jobs and already-sent jobs. Expired delivery reconciliation and any
deliberately new notification require a separately designed workflow; this MVP
does not bypass the original window. `sent` means **provider
accepted**, not inbox delivery; bounce/delivery webhooks are not implemented.

Inspect pending/failed jobs through the finance-restricted outbox. Worker responses
include claimed/sent/deferred/unacknowledged counts and never contain bank details.
An acknowledgement failure leaves the lease reclaimable. Provider response
bodies and sensitive request payloads are not logged.

## Validation and local operation

Use the locally installed CLI: `npx --no-install supabase ...`. No production seed
data is supplied; default seeding is disabled. No remote project is linked.

Available checks:

```powershell
npm run build
node scripts/check-edge-types.mjs
node scripts/test-notification-worker.mjs
node scripts/test-edge-handler.mjs
git diff --check
```

With Docker/Podman available, start a fresh local Supabase instance, apply local
migrations, run `npx --no-install supabase db lint --local`, and execute
both files in `supabase/tests/database/` using psql with `ON_ERROR_STOP=1`.
The SQL fixtures are development-only and roll back. Do not run them against remote
data. A reset destroys the selected local database; use a disposable instance.

Optional embedded PostgreSQL validation, installed only into ignored scratch:

```powershell
npm install --prefix scratch/backend-validation --no-save --package-lock=false @electric-sql/pglite@0.5.4
node scripts/validate-db-embedded.mjs
```

This executes migrations and SQL assertions with simulated Supabase Auth roles;
it does **not** verify GoTrue, PostgREST, Edge Runtime, real multi-connection
concurrency, or hosted deployment. The mock worker tests never send real email.
The Edge type check uses minimal Deno host declarations, not the Deno runtime.

Local Auth's `site_url` is `http://127.0.0.1:5174`, with HTTP redirect origins for
both `127.0.0.1:5174` and `localhost:5174`. This matches `server.port = 5174` in
`vite.config.ts` and the `dev` script (`vite`). Vite's `strictPort` is not enabled,
so it can select another port if 5174 is occupied; inspect its printed URL or use
`npm run dev -- --strictPort` for Auth testing rather than assuming a fallback
port is allowlisted. No remote Auth configuration was changed.

Before rollout, test simultaneous open requests, simultaneous closures, opening
against concurrently raised blocking exceptions, midnight rollover, Auth/JWT
integration, and scheduler/provider failure/recovery on a real local Supabase
stack. The row locks and unique indexes provide the intended protections; those
concurrency scenarios still require actual multi-session verification.

## Reference documentation

- [Supabase database functions and execution permissions](https://supabase.com/docs/guides/database/functions)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase email Edge Function example](https://supabase.com/docs/guides/functions/examples/send-emails)
- [PostgreSQL 17 row locking](https://www.postgresql.org/docs/17/explicit-locking.html)
- [Resend idempotency window](https://resend.com/changelog/idempotency-keys)
