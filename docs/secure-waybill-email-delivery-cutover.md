# Secure Waybill Email Delivery Cutover

## Scope and default state

The fixed historical allowlist is WB-2026-000041 through WB-2026-000045. The database migration resolves those invoice IDs once and aborts unless all five are closed, their invoice/trip close timestamps agree, all are at or before `2026-10-20T21:34:05.976714Z`, and the latest equals that exact cutoff. Every other trip is in the regular scope only when it is closed strictly after the cutoff. Invoice numbers are not queried dynamically to form the historical set.

The migration does not update existing outbox rows. It fails closed if an out-of-scope notification remains processing, then protects excluded rows from updates/deletes and blocks truncation. `trip_closed` events are not eligible for email claims and remain unchanged. Direct API-role DML on the outbox is revoked; worker and Operations Manager mutations go through the guarded RPCs.

Notification delivery remains disabled unless `WAYBILL_NOTIFICATION_DELIVERY_ENABLED=true` is explicitly configured. If unset, malformed, or false, the Edge Function returns before queue access. No worker deployment, Resend invocation, or scheduler activation is part of this change.

## Migration and verification order

1. Keep the notification worker and its scheduler inactive; confirm the PDF scheduler is unchanged.
2. Confirm the target project identity, recovery point, and a read-only outbox baseline/fingerprint.
3. Confirm the five invoice numbers, closed status, trip association, and exact timestamps. Do not proceed if the migration's fixed-set precondition would fail.
4. Stop any notification processing and wait for every out-of-scope `processing` row to become unambiguous. The migration intentionally refuses even expired processing leases.
5. Apply only `20261021000000_secure_waybill_email_delivery_cutover.sql` after the existing secure-notification and Waybill bank-recovery migrations.
6. Verify the five immutable allowlist rows, scope predicates, function grants, lack of service/API direct DML, no armed canary, and the unchanged outbox fingerprint. Confirm legacy claim/retry/PDF RPCs are not executable by `service_role` or API roles.
7. Keep delivery disabled pending separate approval. This feature does not alter PDF generation or any schedule.

Any mismatch is a stop condition. Do not retry or repair the migration by manually editing allowlist entries or historical notifications.

## Synthetic Development canary (separate approval required)

The canary RPC can claim only the explicitly armed synthetic invoice numbered `WB-9999-999999`, outside the fixed historical set and strictly after the cutoff. Both the database guard and worker validate this reserved invoice number; no operational invoice may be used for canary mode. While its short-lived run is armed, regular reconciliation/claim/retry is blocked. Arming fails if any notification is still processing or ambiguous. The canary target and run history are private, immutable except one-way disarm, inaccessible to API/service-role table DML, and the RPC is executable only by `service_role`.

The Edge Function additionally requires all of the following before canary database access:

- `WAYBILL_NOTIFICATION_DELIVERY_ENABLED=true`
- `WAYBILL_NOTIFICATION_CANARY_ENABLED=true`
- `WAYBILL_NOTIFICATION_CANARY_INVOICE_ID=<one explicitly selected synthetic invoice UUID>`
- `WAYBILL_TEST_RECIPIENT_SINK_ENABLED=true`
- `SUPABASE_URL=https://pidxlopbxlapfmakmtjt.supabase.co`

The worker uses the canary claim RPC only, verifies every returned job matches the selected invoice, strips CC/BCC, and replaces the recipient with the fixed Development sink. Sink mode is rejected outside canary mode and outside the exact Development project URL. Never arm a real operational invoice or use real bank data for a canary. Disarm the run after it has no processing rows; if the database cannot prove a safe state, leave delivery disabled and stop.

These settings and the canary RPC are not authorization to send email. The user has not approved delivery activation. Do not set the delivery flag, deploy the notification worker, invoke it, or schedule it without separate approval.

## Retry and duplicate controls

The secure queue keeps its existing eight-attempt/23-hour limits and five-minute leases. Provider retries retain `waybill-notification/<notification-id>` as the stable idempotency key. Driver attachments must resolve to the latest notification-eligible Driver copy; Company attachments must resolve to the latest notification-eligible Company copy with an invoice bank snapshot. Legacy PDF attachment fallback is unavailable.

## Operational monitoring

Before any separately approved activation, monitor pending/blocked/failed/processing counts, oldest eligible backlog, expired or ambiguous leases, worker claim/acknowledgement results, provider acceptance, and the canary run's selected invoice only. Do not use broad retries or bulk queue updates to clear historical work.
