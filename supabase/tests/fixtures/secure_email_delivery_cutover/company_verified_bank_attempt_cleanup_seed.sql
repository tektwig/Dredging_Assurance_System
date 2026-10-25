begin;

do $fixture_check$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.notification_outbox notification
  join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id
  join public.trip_closure_invoice_pdf_copies copy
    on copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id and copy.copy_kind='company'
  join public.trip_closure_invoice_bank_snapshots snapshot
    on snapshot.id=copy.bank_snapshot_id and snapshot.invoice_id=copy.invoice_id
      and snapshot.trip_id=copy.trip_id
  where invoice.invoice_number='WB-2026-000041'
    and notification.event_type='waybill_ready' and notification.audience='client'
    and notification.status='pending' and notification.attempts=0
    and notification.first_attempt_at is null and notification.lease_token is null
    and notification.lease_until is null
    and snapshot.source_kind='registration_capture'
    and snapshot.verified_by is null and snapshot.verified_at is null;
  if v_count<>1 then
    raise exception 'Expected exactly one untouched synthetic unverified Company notification for retry-limit setup; found %',v_count;
  end if;
end;
$fixture_check$;

do $pdf_fixture_check$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.trip_closure_invoice_pdf_copies copy
  join public.trip_closure_invoices invoice on invoice.id=copy.invoice_id
    and invoice.trip_id=copy.trip_id
  join public.trip_closure_invoice_bank_snapshots snapshot
    on snapshot.id=copy.bank_snapshot_id and snapshot.invoice_id=copy.invoice_id
      and snapshot.trip_id=copy.trip_id
  where invoice.invoice_number='WB-2026-000041'
    and copy.copy_kind='company' and copy.copy_version=1 and copy.status='ready'
    and copy.attempts=0 and snapshot.source_kind='registration_capture'
    and snapshot.verified_by is null and snapshot.verified_at is null;
  if v_count<>1 then
    raise exception 'Expected exactly one ready synthetic Company copy backed only by an unverified registration capture; found %',v_count;
  end if;
end;
$pdf_fixture_check$;

update public.notification_outbox notification
set attempts=8,
    first_attempt_at=statement_timestamp()-interval '24 hours',
    updated_at=statement_timestamp()
from public.trip_closure_invoices invoice
where notification.trip_id=invoice.trip_id
  and invoice.invoice_number='WB-2026-000041'
  and notification.event_type='waybill_ready'
  and notification.audience='client'
  and notification.status='pending'
  and notification.attempts=0
  and notification.lease_token is null
  and notification.lease_until is null;

update public.trip_closure_invoice_pdf_copies copy
set status='pending',
    attempts=5,
    ready_at=null,
    failed_at=null,
    next_attempt_at=statement_timestamp()
from public.trip_closure_invoices invoice
where copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id
  and invoice.invoice_number='WB-2026-000041'
  and copy.copy_kind='company' and copy.copy_version=1
  and copy.status='ready' and copy.attempts=0;

do $fixture_result$
begin
  if not exists (
    select 1 from public.notification_outbox notification
    join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id
    join public.trip_closure_invoice_pdf_copies copy
      on copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id and copy.copy_kind='company'
    join public.trip_closure_invoice_bank_snapshots snapshot
      on snapshot.id=copy.bank_snapshot_id and snapshot.invoice_id=copy.invoice_id
        and snapshot.trip_id=copy.trip_id
    where invoice.invoice_number='WB-2026-000041'
      and notification.event_type='waybill_ready' and notification.audience='client'
      and notification.status='pending' and notification.attempts=8
      and notification.first_attempt_at<=statement_timestamp()-interval '23 hours'
      and notification.lease_token is null and notification.lease_until is null
      and snapshot.source_kind='registration_capture'
      and snapshot.verified_by is null and snapshot.verified_at is null
  ) then
    raise exception 'Synthetic exhausted-attempt row was not prepared as expected';
  end if;
  if not exists (
    select 1 from public.trip_closure_invoice_pdf_copies copy
    join public.trip_closure_invoices invoice on invoice.id=copy.invoice_id
      and invoice.trip_id=copy.trip_id
    join public.trip_closure_invoice_bank_snapshots snapshot
      on snapshot.id=copy.bank_snapshot_id and snapshot.invoice_id=copy.invoice_id
        and snapshot.trip_id=copy.trip_id
    where invoice.invoice_number='WB-2026-000041'
      and copy.copy_kind='company' and copy.copy_version=1 and copy.status='pending'
      and copy.attempts=5 and copy.next_attempt_at<=statement_timestamp()
      and snapshot.source_kind='registration_capture'
      and snapshot.verified_by is null and snapshot.verified_at is null
  ) then
    raise exception 'Synthetic Company PDF attempt-limit row was not prepared as expected';
  end if;
end;
$fixture_result$;

commit;
