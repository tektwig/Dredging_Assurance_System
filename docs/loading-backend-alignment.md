# Loading backend alignment 2B

Implemented in `20260924000100_loading_alignment.sql`, after the original three
migrations. This document supersedes the daily-driver, global loading-site,
Loading registration, and audit-payload descriptions in `backend-foundation.md`.
No hosted migration, data reset, upload, or frontend implementation was part of
the original 2B change.

The forward follow-up `20260924000200_loading_read_scope_security.sql` narrows
Loading Officer direct `trips` reads to `opened_by = auth.uid()` and direct `sites`
reads to the active site in their current assignment. Other operational roles
retain their existing broader reads. `get_loading_statistics()` derives the actor
and Africa/Lagos day on the server, validates an active Loading assignment, and
returns only four aggregate counts. The Loading Portal uses this RPC instead of
reading trip rows for its dashboard.

## Operational model

- `trucks.driver_id` is the regular/default driver.
- `trips.driver_id` is the actual driver selected for that trip.
- `daily_registrations.initial_driver_id` preserves the former `driver_id` values
  and records the first driver of the day. It does not bind later trips.
- One immutable registration remains unique per truck/Lagos date. The trip FK
  binds registration and truck, and an insert trigger validates the date.
- Trips retain the driver FK and the composite identity used by payment snapshots.
- New trips store immutable `driver_name_at_loading` and `loading_assignment_id`.
  Existing trips keep NULLs; history is not fabricated.
- The existing unique partial open-trip index and truck-first operational locks remain.
- Closure, delivered quantity, payment readiness and notifications retain their contracts.

## Site administration

`assign_user_site(p_profile_id uuid, p_site_id uuid) returns jsonb` is administrator-only.
It closes the current assignment and creates a new one, or returns the same current
assignment for an unchanged site. Loading/offloading roles require matching site
types; an administrator can be assigned either type. Assignments are never deleted
or repointed. No direct client assignment writes are granted.

Opening and assignment administration lock the profile to serialize reassignments.
Opening derives the current loading site server-side; the expected assignment is
only a stale-review check. More than one loading site may now be active.

Existing Loading Officers need an explicit administrator assignment before using
the new workflow. No automatic assignments are inferred by the migration.
Existing Offloading accounts and `close_trip` do not acquire a new assignment requirement.

## Public RPCs

All below return JSONB unless specified otherwise. Write/lookup RPCs require an
active loading officer or administrator; registration/search/truck lookup require
a current active loading assignment. Opening additionally requires its expected ID.
There is no blanket administrator assignment bypass.

```sql
register_loading_participant(
  p_request_id uuid, p_plate text,
  p_expected_truck_id uuid default null,
  p_existing_driver_id uuid default null,
  p_full_name text default null, p_phone_number text default null,
  p_email text default null, p_bank_name text default null,
  p_account_number text default null, p_account_name text default null
)

create_loading_trip_v2(
  p_request_id uuid, p_plate text, p_driver_id uuid,
  p_expected_assignment_id uuid, p_capture_method text,
  p_captured_at timestamptz,
  p_ocr_detected_plate text default null, p_ocr_confidence numeric default null,
  p_image_path text default null, p_make_default_driver boolean default false
)

search_loading_drivers(p_query text, p_limit integer default 10)
lookup_loading_truck(p_plate text)
assign_user_site(p_profile_id uuid, p_site_id uuid)
normalize_driver_phone(p_phone text) returns text
```

Required parameters precede optional parameters. Site/actor/quantity are not
client inputs to opening. `p_make_default_driver` updates the regular driver only
on successful opening. False selects a driver solely for that trip.

Registration modes:

| Expected truck | Existing driver | Operation |
| --- | --- | --- |
| NULL | NULL | New truck, new driver, required banking |
| NULL | ID | New truck with existing driver; new-driver fields must be NULL |
| ID | NULL | New driver/banking for existing truck; regular driver unchanged |
| ID | ID | `INVALID_REGISTRATION_MODE`; use lookup/opening |

Registration is atomic across new master rows, banking, audits and receipt. Opening
is a separate atomic operation after review. Abandoning review leaves legitimate
registered master data but no trip/attendance. Existing banking is never edited by
these RPCs. Existing drivers without banking remain eligible, preserving the
finance-completion contract; every newly registered driver must provide banking.

Normalized plates use the existing function. The RPC allows 64 raw characters but
requires 1–32 canonical alphanumerics. For registration, a trimmed display plate
longer than the existing 32-character master field uses the canonical value; the
trip evidence still preserves the submitted confirmed plate exactly.

Registration returns explicit truck/driver fields and a boolean indicating whether
this operation captured payment details. It returns no bank values, including
masked account fragments. Opening returns explicit trip identity, loading snapshot,
site/assignment, server opening timestamp, NULL quantity, capture summary and
`default_driver_changed`. It does not serialize unrestricted database rows.

`create_loading_trip(text)` is retained as a tombstone that throws `42501`; execution
is revoked from PUBLIC, anon, authenticated and service_role. It cannot bypass V2.

## Phone normalization and search

Original `phone_number` is preserved. Generated `normalized_phone` applies exactly:

1. Reject inputs over 40 characters or containing characters other than digits,
   plus, whitespace, parentheses, dot and ASCII hyphen.
2. Strip whitespace, parentheses, dot and ASCII hyphen.
3. Nigerian mobile form `^0[789][01][0-9]{8}$` becomes `+234` plus the final ten digits.
4. Explicit international form `^\+[1-9][0-9]{7,14}$` is preserved.
5. Everything else returns NULL; country/identity is not guessed.

The generated column backfills only deterministic values. Existing duplicates are
not merged and no global unique phone index is introduced. New controlled driver
creation checks normalized-phone matches and returns `DRIVER_MATCH_REQUIRES_REVIEW`.
A trigger serializes phone-changing master writes and rejects new normalized
collisions, including administrative direct writes. Existing unchanged duplicates
are preserved; ambiguous/shared-number registration needs administrator review.

Search requires 3–200 characters and limit 1–20 (default 10). Name search is literal,
case-insensitive substring matching. Phone fragments need at least four digits.
Complete Nigerian local, formatted local, `+234` international and `234`
digit-only forms resolve to the same canonical phone. Shorter intentional phone
fragments use bounded matching; complete phone queries use exact normalized matching.
Results contain ID, name, original phone, optional email and active state. Duplicate
names remain separate IDs. Loading Officers cannot directly enumerate `drivers`;
truck lookup explicitly returns safe regular-driver fields and assignment/block
information. All prechecks remain advisory.

Pre-deployment privacy hardening: define the permitted driver discovery scope
and an abuse/rate-control strategy for repeated searches. The current bounded
RPC can still be called repeatedly with short name fragments, and there is no
established driver-to-site ownership model that would make site scoping safe.

## Errors and idempotency

Business errors are `{ok:false,code,details:{...}}`; details contain only safe,
allowlisted references. Ordinary validation failures do not create exceptions.
Authorization raises SQLSTATE `42501`. Unexpected errors roll back and propagate;
clients must not display raw database detail. Malformed typed RPC arguments can
fail transport parsing before function execution.

Opening codes:
`INVALID_REQUEST_ID`, `INVALID_PLATE`, `DRIVER_REQUIRED`, `INVALID_DEFAULT_OPTION`,
`SITE_REVIEW_REQUIRED`, `SITE_ASSIGNMENT_REQUIRED`, `SITE_ASSIGNMENT_CHANGED`,
`INVALID_SITE_ASSIGNMENT`, `INACTIVE_SITE`, `UNKNOWN_TRUCK`, `INACTIVE_TRUCK`,
`OPEN_TRIP_EXISTS`, `BLOCKING_EXCEPTION`, `DRIVER_NOT_FOUND`, `INACTIVE_DRIVER`,
`INVALID_CAPTURE_METHOD`, `INVALID_CAPTURE_TIMESTAMP`, `INVALID_OCR_DATA`,
`INVALID_IMAGE_REFERENCE`, `IMAGE_NOT_FOUND`, `IMAGE_ALREADY_USED`.

Registration also uses:
`INVALID_REGISTRATION_MODE`, `PLATE_ALREADY_REGISTERED`, `TRUCK_NOT_FOUND`,
`TRUCK_PLATE_MISMATCH`, `INVALID_DRIVER_NAME`, `INVALID_PHONE`, `INVALID_EMAIL`,
`DRIVER_MATCH_REQUIRES_REVIEW`, `PAYMENT_DETAILS_REQUIRED`, `INVALID_BANK_NAME`,
`INVALID_ACCOUNT_NUMBER`, `INVALID_ACCOUNT_NAME`.
Search adds `INVALID_SEARCH`; site administration adds `PROFILE_NOT_FOUND` and
`SITE_NOT_FOUND`.

The private immutable receipt key is actor + operation + request UUID. Only
successful safe responses are stored; never registration input/banking payloads.
Reusing a successful request ID returns that first response, even after closure or
with changed arguments: actor + operation + request ID denotes one immutable
logical request. Clients MUST keep the same ID only for an unchanged retry and
mint a new ID for changed input or a new operation.
Authorization is checked before replay. Failed requests do not consume IDs.

Loading operations take a `FOR NO KEY UPDATE` profile lock, then a request advisory
lock, then assignment/site, truck, driver and image locks. Registration adds a
normalized-plate advisory lock before truck lookup and a normalized-phone lock
after the existing truck lock. Assignment administration locks actor/target profiles
in UUID order, then assignment/site. `FOR NO KEY UPDATE` is compatible with the
profile key-share checks made by trip/exception foreign keys, removing the
identified profile/truck inversion with exception creation. Existing closure and
exception operations keep their truck-first order. Recognized unique races roll
back the whole mutation subtransaction before returning a business error. Browser
RPCs use PostgreSQL READ COMMITTED. This lock analysis is static; real multi-session
deadlock/concurrency tests are still required.

## Evidence and Storage

Every new trip requires one immutable evidence row; a deferred constraint checks
existence. It records confirmed/canonical plate, candidate/confidence, method,
optional object path, client capture time, server record time and authenticated actor.
Legacy trips need no fabricated evidence, including during closure.

- MANUAL: no OCR candidate/confidence; image optional.
- OCR: image/candidate required; canonical candidate equals canonical confirmed plate.
- OCR_CORRECTED: image/candidate required; canonical values differ.
- Confidence is optional but, when supplied, finite and within 0–1.
- Client capture time must be finite and no more than five minutes in the future.
  It is not a trusted proof of capture time. Server timestamps remain authoritative.

Private bucket `loading-plate-evidence`: JPEG/PNG, maximum 5 MiB. Paths are lowercase
`<actor UUID>/<capture UUID>.jpg|png`. Upload requires an active loading assignment,
matching owner and prefix. SQL linking validates object existence/owner/type/size,
extension and unique path. No client overwrite/update/delete is allowed. Restrictive
policies fence off unrelated permissive policies for this bucket, including anon.
Officers read their own images; active administrator/operations/audit roles read
for operational review. Only server-controlled cleanup may remove orphan uploads.

Upload and trip opening are not a distributed transaction. A failed submission can
leave an unlinked object. A cleanup scheduler is NOT installed by this change; a
future trusted cleanup must use a retention buffer, recheck linkage and never delete
linked evidence. No images were uploaded during implementation.
MIME metadata checks are not image-content inspection; a future capture client
should decode/re-encode images. Storage HTTP behavior still needs real local tests.

## Audit privacy and upgrade

The audit writer uses explicit per-entity allowlists. Payment and notification
history keeps IDs, statuses, timestamps, references, failure/retry reasons,
reconciliation context, provider identifiers and safe changed-field names.
Bank names, account names/numbers, supplied banking, notification payloads and
rendered email content are excluded. A BEFORE INSERT sanitizer also covers explicit
audit inserts, including notification retry. It removes known bank values and
labelled bank/account values from free text while preserving surrounding operational
meaning. Unlabelled arbitrary secrets unrelated to known banking records cannot be
classified reliably; operational reasons must not include such secrets.

Near the end of the transaction, the migration takes an exclusive audit-table lock,
transactionally suspends only the immutability trigger, projects existing sensitive
audit payloads, then reenables the trigger. No audit rows/identities/actors/timestamps
are deleted. Actual banking, payment snapshots and notification payloads are not
redacted or changed. This is a one-time privacy migration.

Deployment requires a controlled maintenance window with operational writes stopped.
Verify no long-running transactions remain, apply the forward migration, run the
post-migration checks, then restore operations. Set a bounded session `lock_timeout`
appropriate to the maintenance window so unexpected lock contention aborts instead
of waiting indefinitely. If migration execution fails, PostgreSQL rolls back its
transaction; keep writes stopped, investigate, and retry the same forward migration
only after the cause is corrected. If verification after commit fails, keep writes
stopped and use a separately reviewed corrective migration or restore procedure;
do not reset production data or reverse this migration ad hoc.

New audits cover registration, payment capture, new trucks, default changes,
different actual drivers, trip opening, capture/corrections and assignment changes.
Request IDs and trip/driver/site links are recorded without bank request bodies.

## Local verification

`node scripts/validate-db-embedded.mjs` creates an in-memory PostgreSQL/WASM instance;
it never reads Supabase environment files or connects to a server. Install its
optional dependency into ignored scratch as documented in backend-foundation.md.

The harness runs:

1. Original three migrations and legacy checkpoint suites.
2. A populated upgrade fixture (existing users, open/closed trips, bank snapshots,
   audit values and malformed legacy phone).
3. The forward migration and preservation/redaction assertions.
4. Loading alignment tests and the full payment-readiness suite against V2.

`mvp_foundation.sql` is intentionally a legacy-checkpoint test: do not run it against
V2 as if it specified the new daily-driver contract. `payment_readiness.sql` supports
both checkpoints. Fixtures are synthetic; upgrade fixtures intentionally persist
within the disposable test engine across the migration. Never run them on hosted data.

The Storage schema in this harness is a minimal metadata/RLS mock. SQL policy checks
are covered, not Storage HTTP, PostgREST, JWT issuance, upload content enforcement or
real multi-session concurrency. Before rollout, verify simultaneous opening and
registration requests, opening versus closure/assignment/driver changes, midnight
rollover, and two-user Storage access on a real disposable local Supabase stack.
Do not reset or migrate any hosted project to perform these checks.
