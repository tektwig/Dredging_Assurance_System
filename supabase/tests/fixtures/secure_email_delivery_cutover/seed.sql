begin;

create function pg_temp.assert_true(p_value boolean,p_message text) returns void language plpgsql as $$
begin
  if p_value is distinct from true then raise exception 'Secure email fixture assertion failed: %',p_message; end if;
  raise notice 'ASSERTION PASS: %',p_message;
end;
$$;

alter table public.daily_registrations disable trigger user;
alter table public.trips disable trigger user;
alter table public.trip_closure_invoices disable trigger prevent_trip_invoice_mutation;

with approved(invoice_number,closed_at) as (
  values
    ('WB-2026-000040','2026-10-15T21:34:05.976714Z'::timestamptz),
    ('WB-2026-000041','2026-10-16T21:34:05.976714Z'::timestamptz),
    ('WB-2026-000042','2026-10-17T21:34:05.976714Z'::timestamptz),
    ('WB-2026-000043','2026-10-18T21:34:05.976714Z'::timestamptz)
)
update public.daily_registrations registration
set registered_at=approved.closed_at-interval '3 hours',
    operational_date=((approved.closed_at-interval '3 hours') at time zone 'Africa/Lagos')::date
from public.trip_closure_invoices invoice
join public.trips trip on trip.id=invoice.trip_id
join approved using(invoice_number)
where registration.id=trip.daily_registration_id;

with approved(invoice_number,closed_at) as (
  values
    ('WB-2026-000040','2026-10-15T21:34:05.976714Z'::timestamptz),
    ('WB-2026-000041','2026-10-16T21:34:05.976714Z'::timestamptz),
    ('WB-2026-000042','2026-10-17T21:34:05.976714Z'::timestamptz),
    ('WB-2026-000043','2026-10-18T21:34:05.976714Z'::timestamptz)
)
update public.trips trip
set opened_at=approved.closed_at-interval '2 hours',
    closed_at=approved.closed_at,
    created_at=approved.closed_at-interval '2 hours',
    updated_at=approved.closed_at
from public.trip_closure_invoices invoice join approved using(invoice_number)
where trip.id=invoice.trip_id;

with approved(invoice_number,closed_at) as (
  values
    ('WB-2026-000040','2026-10-15T21:34:05.976714Z'::timestamptz),
    ('WB-2026-000041','2026-10-16T21:34:05.976714Z'::timestamptz),
    ('WB-2026-000042','2026-10-17T21:34:05.976714Z'::timestamptz),
    ('WB-2026-000043','2026-10-18T21:34:05.976714Z'::timestamptz)
)
update public.trip_closure_invoices invoice
set opened_at=approved.closed_at-interval '2 hours',
    closed_at=approved.closed_at,
    issued_at=approved.closed_at,
    driver_email='synthetic-driver@example.invalid'
from approved where invoice.invoice_number=approved.invoice_number;

insert into public.daily_registrations(id,truck_id,initial_driver_id,operational_date,registered_at,registered_by)
values
  ('e5000000-0000-4000-8000-000000000039','e4000000-0000-4000-8000-000000000043','e3000000-0000-4000-8000-000000000043','2026-10-09','2026-10-09T12:00:00Z','e0000000-0000-4000-8000-000000000002'),
  ('e5000000-0000-4000-8000-000000000044','e4000000-0000-4000-8000-000000000043','e3000000-0000-4000-8000-000000000043','2026-10-10','2026-10-10T12:00:00Z','e0000000-0000-4000-8000-000000000002'),
  ('e5000000-0000-4000-8000-000000000045','e4000000-0000-4000-8000-000000000043','e3000000-0000-4000-8000-000000000043','2026-10-11','2026-10-11T12:00:00Z','e0000000-0000-4000-8000-000000000002'),
  ('e5000000-0000-4000-8000-000000000046','e4000000-0000-4000-8000-000000000043','e3000000-0000-4000-8000-000000000043','2026-10-12','2026-10-12T12:00:00Z','e0000000-0000-4000-8000-000000000002'),
  ('e5000000-0000-4000-8000-000000999999','e4000000-0000-4000-8000-000000000043','e3000000-0000-4000-8000-000000000043','2026-10-13','2026-10-13T12:00:00Z','e0000000-0000-4000-8000-000000000002');

insert into public.trips(
  id,trip_number,truck_id,driver_id,daily_registration_id,loading_site_id,offloading_site_id,
  status,quantity_tonnes,opened_at,opened_by,closed_at,closed_by,
  truck_registration_at_loading,truck_type_at_loading,truck_capacity_at_loading,truck_owner_at_loading,
  driver_phone_at_loading,driver_license_at_loading,driver_name_at_loading,loading_assignment_id
)
select ids.trip_id,ids.trip_number,template.truck_id,template.driver_id,ids.registration_id,
  template.loading_site_id,template.offloading_site_id,'closed',12,ids.closed_at-interval '2 hours',
  template.opened_by,ids.closed_at,template.closed_by,template.truck_registration_at_loading,
  template.truck_type_at_loading,template.truck_capacity_at_loading,template.truck_owner_at_loading,
  template.driver_phone_at_loading,template.driver_license_at_loading,template.driver_name_at_loading,
  template.loading_assignment_id
from (values
  ('e6000000-0000-4000-8000-000000000039'::uuid,'EMAIL-CUTOVER-039','e5000000-0000-4000-8000-000000000039'::uuid,'2026-10-14T21:34:05.976714Z'::timestamptz),
  ('e6000000-0000-4000-8000-000000000044'::uuid,'EMAIL-CUTOVER-044','e5000000-0000-4000-8000-000000000044'::uuid,'2026-10-19T21:34:05.976714Z'::timestamptz),
  ('e6000000-0000-4000-8000-000000000045'::uuid,'EMAIL-CUTOVER-045','e5000000-0000-4000-8000-000000000045'::uuid,'2026-10-20T21:34:05.976714Z'::timestamptz),
  ('e6000000-0000-4000-8000-000000000046'::uuid,'EMAIL-CUTOVER-046','e5000000-0000-4000-8000-000000000046'::uuid,'2026-10-20T21:34:06.976714Z'::timestamptz),
  ('e6000000-0000-4000-8000-000000999999'::uuid,'EMAIL-CUTOVER-CANARY','e5000000-0000-4000-8000-000000999999'::uuid,'2026-10-20T21:39:05.976714Z'::timestamptz)
) ids(trip_id,trip_number,registration_id,closed_at)
cross join public.trips template
where template.trip_number='BANKREC-TRIP-43';

alter table public.trips enable trigger user;
alter table public.daily_registrations enable trigger user;
alter table public.trip_closure_invoices enable trigger prevent_trip_invoice_mutation;

select pg_temp.assert_true(not exists (
  select 1 from pg_catalog.pg_trigger
  where tgrelid in ('public.daily_registrations'::regclass,'public.trips'::regclass,'public.trip_closure_invoices'::regclass)
    and not tgisinternal and tgenabled='D'
),'all test-seed trigger bypasses are restored before fixture commit');
select pg_temp.assert_true((
  select count(*)=4 and bool_and(
    trip.status='closed' and trip.opened_at<trip.closed_at
    and invoice.opened_at=trip.opened_at and invoice.closed_at=trip.closed_at
    and invoice.issued_at>=invoice.closed_at
    and registration.registered_at<trip.opened_at
    and registration.operational_date=(registration.registered_at at time zone 'Africa/Lagos')::date
  )
  from public.trip_closure_invoices invoice
  join public.trips trip on trip.id=invoice.trip_id
  join public.daily_registrations registration on registration.id=trip.daily_registration_id
  where invoice.invoice_number in ('WB-2026-000040','WB-2026-000041','WB-2026-000042','WB-2026-000043')
),'retimed historical fixture trips, invoices and registrations are chronologically consistent');

insert into public.trip_closure_invoices(
  id,invoice_number,trip_id,trip_number,truck_id,truck_registration,truck_type,
  truck_capacity_tonnes,truck_owner_name,driver_id,driver_name,driver_phone,driver_license,driver_email,
  loading_site_id,loading_site_name,offloading_site_id,offloading_site_name,
  loading_officer_id,loading_officer_name,offloading_officer_id,offloading_officer_name,
  quantity_tonnes,opened_at,closed_at,issued_at
)
select ids.invoice_id,ids.invoice_number,trip.id,trip.trip_number,trip.truck_id,
  trip.truck_registration_at_loading,trip.truck_type_at_loading,trip.truck_capacity_at_loading,
  trip.truck_owner_at_loading,trip.driver_id,trip.driver_name_at_loading,trip.driver_phone_at_loading,
  trip.driver_license_at_loading,case when ids.invoice_number='WB-2026-000045' then null else 'synthetic-driver@example.invalid' end,
  trip.loading_site_id,loading_site.name,trip.offloading_site_id,offloading_site.name,
  trip.opened_by,loading_profile.display_name,trip.closed_by,offloading_profile.display_name,
  trip.quantity_tonnes,trip.opened_at,trip.closed_at,trip.closed_at
from (values
  ('e7000000-0000-4000-8000-000000000039'::uuid,'WB-2026-000039','e6000000-0000-4000-8000-000000000039'::uuid),
  ('e7000000-0000-4000-8000-000000000044'::uuid,'WB-2026-000044','e6000000-0000-4000-8000-000000000044'::uuid),
  ('e7000000-0000-4000-8000-000000000045'::uuid,'WB-2026-000045','e6000000-0000-4000-8000-000000000045'::uuid),
  ('e7000000-0000-4000-8000-000000000046'::uuid,'WB-2026-000046','e6000000-0000-4000-8000-000000000046'::uuid),
  ('e7000000-0000-4000-8000-000000999999'::uuid,'WB-9999-999999','e6000000-0000-4000-8000-000000999999'::uuid)
) ids(invoice_id,invoice_number,trip_id)
join public.trips trip on trip.id=ids.trip_id
join public.sites loading_site on loading_site.id=trip.loading_site_id
join public.sites offloading_site on offloading_site.id=trip.offloading_site_id
join public.profiles loading_profile on loading_profile.id=trip.opened_by
join public.profiles offloading_profile on offloading_profile.id=trip.closed_by;

create temporary table email_cutover_snapshot_targets on commit drop as
select invoice.id,invoice.trip_id,row_number() over(order by invoice.invoice_number)::integer as sequence
from public.trip_closure_invoices invoice
where invoice.invoice_number in ('WB-2026-000043','WB-2026-000044','WB-2026-000045','WB-9999-999999')
  and not exists (select 1 from public.trip_closure_invoice_bank_snapshots snapshot where snapshot.invoice_id=invoice.id);

insert into public.trip_closure_invoice_bank_submissions(
  id,invoice_id,trip_id,bank_name,account_name,account_number,submitted_by,submitted_at
)
select md5(target.id::text||':email-cutover-submission')::uuid,target.id,target.trip_id,
  'CI Synthetic Bank','CI Synthetic Account',lpad(target.sequence::text,10,'0'),
  'e0000000-0000-4000-8000-000000000003',statement_timestamp()
from email_cutover_snapshot_targets target;

insert into public.trip_closure_invoice_bank_detail_events(
  submission_id,invoice_id,trip_id,event_type,reason_code,actor_id
)
select submission.id,submission.invoice_id,submission.trip_id,'submitted',null,submission.submitted_by
from public.trip_closure_invoice_bank_submissions submission
where submission.id in (select md5(target.id::text||':email-cutover-submission')::uuid from email_cutover_snapshot_targets target);

insert into public.trip_closure_invoice_bank_snapshots(
  invoice_id,trip_id,version,source_submission_id,bank_name,account_name,account_number,
  submitted_by,submitted_at,verified_by,verified_at
)
select submission.invoice_id,submission.trip_id,1,submission.id,submission.bank_name,submission.account_name,
  submission.account_number,submission.submitted_by,submission.submitted_at,
  'e0000000-0000-4000-8000-000000000003',submission.submitted_at
from public.trip_closure_invoice_bank_submissions submission
where submission.id in (select md5(target.id::text||':email-cutover-submission')::uuid from email_cutover_snapshot_targets target);

insert into public.trip_closure_invoice_bank_detail_events(
  submission_id,invoice_id,trip_id,event_type,reason_code,actor_id
)
select submission.id,submission.invoice_id,submission.trip_id,'verified','verified','e0000000-0000-4000-8000-000000000003'
from public.trip_closure_invoice_bank_submissions submission
where submission.id in (select md5(target.id::text||':email-cutover-submission')::uuid from email_cutover_snapshot_targets target);

update public.trip_closure_invoice_pdf_copies copy
set status='ready',ready_at=statement_timestamp(),failed_at=null,last_error_code=null
from public.trip_closure_invoices invoice
where copy.invoice_id=invoice.id and copy.copy_kind='driver'
  and invoice.invoice_number in ('WB-2026-000039','WB-2026-000040','WB-2026-000041','WB-2026-000042','WB-2026-000043','WB-2026-000044','WB-2026-000045','WB-2026-000046','WB-9999-999999');

update public.trip_closure_invoice_pdf_copies copy
set status='ready',ready_at=statement_timestamp(),failed_at=null,last_error_code=null,
    bank_snapshot_id=snapshot.id
from public.trip_closure_invoices invoice
join public.trip_closure_invoice_bank_snapshots snapshot on snapshot.invoice_id=invoice.id and snapshot.trip_id=invoice.trip_id
where copy.invoice_id=invoice.id and copy.copy_kind='company'
  and invoice.invoice_number in ('WB-2026-000040','WB-2026-000041','WB-2026-000042','WB-2026-000043','WB-2026-000044','WB-2026-000045','WB-2026-000046','WB-9999-999999');

select public.enqueue_waybill_ready_notifications('synthetic-company@example.invalid');

insert into public.notification_outbox(trip_id,event_type,audience,delivery_sequence,recipients,payload,status,blocked_reason_code)
select invoice.trip_id,'waybill_ready','driver',0,null,
  jsonb_build_object('invoice_id',invoice.id,'invoice_number',invoice.invoice_number),
  'blocked_missing_email','missing_driver_email'
from public.trip_closure_invoices invoice
where invoice.invoice_number='WB-2026-000045'
on conflict (trip_id,event_type,audience,delivery_sequence) do nothing;

update public.notification_outbox notification
set status='sent',attempts=1,first_attempt_at=statement_timestamp()-interval '1 hour',
  sent_at=statement_timestamp()-interval '50 minutes',provider_message_id='synthetic-provider-accepted'
from public.trip_closure_invoices invoice
where notification.trip_id=invoice.trip_id and notification.event_type='waybill_ready'
  and notification.audience='client' and invoice.invoice_number='WB-2026-000040';

update public.notification_outbox notification
set status='processing',attempts=2,first_attempt_at=statement_timestamp()-interval '10 minutes',
  lease_token='f8000000-0000-4000-8000-000000000041',lease_until=statement_timestamp()-interval '1 minute'
from public.trip_closure_invoices invoice
where notification.trip_id=invoice.trip_id and notification.event_type='waybill_ready'
  and notification.audience='driver' and invoice.invoice_number='WB-2026-000041';

insert into public.notification_outbox(trip_id,event_type,audience,delivery_sequence,recipients,payload,status)
select invoice.trip_id,'trip_closed','finance',0,array['synthetic-legacy@example.invalid'],
  jsonb_build_object('event','synthetic historical trip closure'), 'pending'
from public.trip_closure_invoices invoice where invoice.invoice_number='WB-2026-000040'
on conflict (trip_id,event_type,audience,delivery_sequence) do nothing;

select pg_temp.assert_true((
  select count(*)=5 from public.trip_closure_invoices
  where invoice_number in ('WB-2026-000041','WB-2026-000042','WB-2026-000043','WB-2026-000044','WB-2026-000045')
),'the exact five approved invoice numbers exist before migration');
select pg_temp.assert_true((
  select count(*)=5 and bool_and(
    trip.status='closed' and trip.opened_at<trip.closed_at
    and invoice.opened_at=trip.opened_at and invoice.closed_at=trip.closed_at
    and invoice.issued_at>=invoice.closed_at
    and registration.registered_at<trip.opened_at
    and registration.operational_date=(registration.registered_at at time zone 'Africa/Lagos')::date
  )
  from public.trip_closure_invoices invoice
  join public.trips trip on trip.id=invoice.trip_id
  join public.daily_registrations registration on registration.id=trip.daily_registration_id
  where invoice.invoice_number in ('WB-2026-000041','WB-2026-000042','WB-2026-000043','WB-2026-000044','WB-2026-000045')
),'all five approved historical trips and invoices have matching chronologically valid timestamps');
with approved(invoice_number,closed_at) as (
  values
    ('WB-2026-000041','2026-10-16T21:34:05.976714Z'::timestamptz),
    ('WB-2026-000042','2026-10-17T21:34:05.976714Z'::timestamptz),
    ('WB-2026-000043','2026-10-18T21:34:05.976714Z'::timestamptz),
    ('WB-2026-000044','2026-10-19T21:34:05.976714Z'::timestamptz),
    ('WB-2026-000045','2026-10-20T21:34:05.976714Z'::timestamptz)
)
select pg_temp.assert_true((
  select count(*)=5 and bool_and(invoice.closed_at=approved.closed_at and trip.closed_at=approved.closed_at)
  from approved
  join public.trip_closure_invoices invoice using(invoice_number)
  join public.trips trip on trip.id=invoice.trip_id
),'the five fixed historical invoices match their approved timestamps and latest cutoff');
select pg_temp.assert_true((
  select count(*)=1 and bool_and(
    trip.closed_at>'2026-10-20T21:34:05.976714Z'::timestamptz
    and invoice.closed_at=trip.closed_at and invoice.issued_at>=invoice.closed_at
  )
  from public.trip_closure_invoices invoice
  join public.trips trip on trip.id=invoice.trip_id
  where invoice.invoice_number='WB-2026-000046' and trip.status='closed'
),'the future synthetic trip is strictly after the approved cutoff with a matching invoice closure');
select pg_temp.assert_true((
  select count(*)=1 from public.trip_closure_invoices where invoice_number='WB-9999-999999'
),'the reserved synthetic canary invoice number satisfies the database invoice constraint');
select pg_temp.assert_true((
  select count(*)=1 from public.trip_closure_invoices where invoice_number='WB-2026-000039'
),'an older Waybill exists as an explicit negative-scope fixture');
select pg_temp.assert_true((
  select count(*)=9 from public.notification_outbox notification
  join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id
  where notification.event_type='waybill_ready'
    and invoice.invoice_number between 'WB-2026-000041' and 'WB-2026-000045'
    and notification.status in ('pending','processing')
),'the five approved historical Waybills contain nine potential deliverable messages');
select pg_temp.assert_true((
  select count(*)=1 from public.notification_outbox notification
  join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id
  where invoice.invoice_number='WB-2026-000045' and notification.event_type='waybill_ready'
    and notification.audience='driver' and notification.status='blocked_missing_email'
    and notification.recipients is null
),'the approved Waybill without Driver email remains blocked');

commit;
