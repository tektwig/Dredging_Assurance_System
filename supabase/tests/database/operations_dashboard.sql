begin;

create function pg_temp.dashboard_assert(v boolean, m text) returns void language plpgsql as $$
begin
  if v is distinct from true then raise exception 'Operations dashboard assertion failed: %', m; end if;
end;
$$;

create function pg_temp.dashboard_expect_state(q text, expected text) returns void language plpgsql as $$
declare actual text;
begin
  begin execute q;
  exception when others then
    get stacked diagnostics actual = returned_sqlstate;
    if actual = expected then return; end if;
    raise exception 'Expected SQLSTATE %, got %', expected, actual;
  end;
  raise exception 'Expected SQLSTATE %', expected;
end;
$$;

create temp table dashboard_results(k text primary key, v jsonb);
grant all on dashboard_results to authenticated;

select pg_temp.dashboard_assert(
  has_function_privilege('authenticated','public.get_operations_dashboard_summary()','EXECUTE')
    and has_function_privilege('authenticated','public.get_operations_dashboard_open_trips(integer)','EXECUTE')
    and has_function_privilege('authenticated','public.get_operations_dashboard_activity(integer)','EXECUTE')
    and not has_function_privilege('anon','public.get_operations_dashboard_summary()','EXECUTE')
    and not has_function_privilege('service_role','public.get_operations_dashboard_summary()','EXECUTE')
    and not has_function_privilege('anon','public.get_operations_dashboard_open_trips(integer)','EXECUTE')
    and not has_function_privilege('service_role','public.get_operations_dashboard_open_trips(integer)','EXECUTE')
    and not has_function_privilege('anon','public.get_operations_dashboard_activity(integer)','EXECUTE')
    and not has_function_privilege('service_role','public.get_operations_dashboard_activity(integer)','EXECUTE')
    and to_regprocedure('public.get_operations_dashboard_summary(uuid)') is null
    and to_regprocedure('public.get_operations_dashboard_open_trips(integer,uuid)') is null
    and to_regprocedure('public.get_operations_dashboard_activity(integer,uuid)') is null,
  'all dashboard functions are authenticated-only, have no actor/site input, and exclude anonymous/service role');

insert into auth.users(id,email,raw_user_meta_data) values
 ('e9000000-0000-0000-0000-000000000001','dashboard-operations@example.invalid','{}'),
 ('e9000000-0000-0000-0000-000000000002','dashboard-loading@example.invalid','{}'),
 ('e9000000-0000-0000-0000-000000000003','dashboard-offloading@example.invalid','{}'),
 ('e9000000-0000-0000-0000-000000000004','dashboard-finance@example.invalid','{}'),
 ('e9000000-0000-0000-0000-000000000005','dashboard-audit@example.invalid','{}'),
 ('e9000000-0000-0000-0000-000000000006','dashboard-admin@example.invalid','{}'),
 ('e9000000-0000-0000-0000-000000000007','dashboard-inactive@example.invalid','{}');
update public.profiles set role = case right(id::text,1)
  when '1' then 'operations_manager'::public.app_role
  when '2' then 'loading_officer'::public.app_role
  when '3' then 'offloading_officer'::public.app_role
  when '4' then 'finance_officer'::public.app_role
  when '5' then 'audit_reviewer'::public.app_role
  when '6' then 'system_administrator'::public.app_role
  else 'operations_manager'::public.app_role end,
  is_active = right(id::text,1) <> '7'
where id::text like 'e9000000-%';
update public.profiles set display_name = 'Dashboard Officer ' || right(id::text,1)
where id::text like 'e9000000-%';

insert into public.sites(id,name,site_type,is_active) values
 ('ea000000-0000-0000-0000-000000000001','Dashboard Loading Site','loading',true),
 ('ea000000-0000-0000-0000-000000000002','Dashboard Offloading Site','offloading',true);
insert into public.drivers(id,full_name,phone_number,email)
select ('eb000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  'Dashboard Driver ' || n,'08012' || lpad(n::text,6,'0'),'dashboard-driver-' || n || '@example.invalid'
from generate_series(1,19) as series(n);
insert into public.trucks(id,registration_number,driver_id)
select ('ec000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  'DASH-' || lpad(n::text,3,'0'),
  ('eb000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
from generate_series(1,19) as series(n);
alter table public.daily_registrations disable trigger user;
insert into public.daily_registrations(id,truck_id,initial_driver_id,operational_date,registered_at,registered_by)
select ('ed000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  ('ec000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  ('eb000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  (statement_timestamp() at time zone 'Africa/Lagos')::date,
  statement_timestamp(),'e9000000-0000-0000-0000-000000000001'
from generate_series(1,19) as series(n);
alter table public.daily_registrations enable trigger user;

create temp table dashboard_clock(start_at timestamptz, end_at timestamptz);
insert into dashboard_clock values (
  ((statement_timestamp() at time zone 'Africa/Lagos')::date)::timestamp at time zone 'Africa/Lagos',
  (((statement_timestamp() at time zone 'Africa/Lagos')::date + 1)::timestamp at time zone 'Africa/Lagos')
);
create temp table dashboard_baseline as
select count(*) filter (where trip.opened_at >= clock.start_at and trip.opened_at < clock.end_at) as opened_today,
  count(*) filter (where trip.status='closed' and trip.closed_at >= clock.start_at and trip.closed_at < clock.end_at) as closed_today,
  count(*) filter (where trip.status='open') as open_trips,
  coalesce(sum(trip.quantity_tonnes) filter (
    where trip.status='closed' and trip.closed_at >= clock.start_at and trip.closed_at < clock.end_at
  ),0::numeric) as tonnage_today,
  count(distinct trip.truck_id) filter (
    where trip.status='closed' and trip.closed_at >= clock.start_at and trip.closed_at < clock.end_at
  ) as trucks_today,
  (select count(*) from public.exceptions where status::text <> 'resolved') as unresolved_exceptions,
  (select count(*) from public.trip_closure_invoice_documents where status='failed') as failed_pdfs,
  (select count(*) from public.notification_outbox where event_type='waybill_ready' and status='failed') as failed_emails,
  (select count(*) from public.trip_payments where status='payment_details_required') as payment_details_required
from public.trips as trip cross join dashboard_clock as clock;
grant select on dashboard_baseline to authenticated;

alter table public.trips disable trigger user;
insert into public.trips(
  id,trip_number,truck_id,driver_id,daily_registration_id,loading_site_id,offloading_site_id,
  status,quantity_tonnes,opened_at,opened_by,closed_at,closed_by,cancelled_at,cancelled_by,
  cancellation_reason,truck_registration_at_loading,driver_name_at_loading
)
select ('ee000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  'DASH-TRIP-' || lpad(n::text,3,'0'),
  ('ec000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  ('eb000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  ('ed000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  'ea000000-0000-0000-0000-000000000001',
  case when n between 1 and 6 or n = 19 then 'ea000000-0000-0000-0000-000000000002'::uuid else null end,
  case when n between 1 and 6 or n = 19 then 'closed'::public.trip_status
       when n = 18 then 'cancelled'::public.trip_status else 'open'::public.trip_status end,
  case when n between 1 and 6 or n = 19 then n::numeric else null end,
  case when n between 1 and 5 then clock.start_at
       when n = 6 then clock.start_at - interval '1 day'
       when n between 7 and 16 then clock.start_at - make_interval(days => 18 - n)
       when n = 17 or n = 18 then clock.start_at
       else clock.start_at - interval '1 day' end,
  'e9000000-0000-0000-0000-000000000001',
  case when n between 1 and 5 then clock.start_at + make_interval(hours => n - 1)
       when n = 6 then clock.end_at
       when n = 19 then clock.start_at - interval '12 hours' else null end,
  case when n between 1 and 6 or n = 19 then 'e9000000-0000-0000-0000-000000000003'::uuid else null end,
  case when n = 18 then clock.start_at + interval '1 minute' else null end,
  case when n = 18 then 'e9000000-0000-0000-0000-000000000001'::uuid else null end,
  case when n = 18 then 'Test cancellation reason containing BANK-SECRET-424242' else null end,
  'DASH-' || lpad(n::text,3,'0'),'Dashboard Driver ' || n
from generate_series(1,19) as series(n) cross join dashboard_clock as clock;
alter table public.trips enable trigger user;

insert into public.trip_closure_invoices(
  id,invoice_number,trip_id,trip_number,truck_id,truck_registration,driver_id,driver_name,
  driver_phone,driver_email,bank_name,account_name,account_number,loading_site_id,loading_site_name,
  offloading_site_id,offloading_site_name,quantity_tonnes,opened_at,closed_at,issued_at,
  offloading_officer_id,offloading_officer_name
)
select ('ef000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  'INV-2026-' || lpad((123000 + n)::text,6,'0'),trip.id,trip.trip_number,trip.truck_id,
  trip.truck_registration_at_loading,trip.driver_id,trip.driver_name_at_loading,'08012345678',
  'private-driver-secret-' || n || '@example.invalid','SENTINEL BANK DATA','SENTINEL ACCOUNT NAME',
  '1234567890',trip.loading_site_id,'Dashboard Loading Site',trip.offloading_site_id,
  'Dashboard Offloading Site',trip.quantity_tonnes,trip.opened_at,trip.closed_at,trip.closed_at,
  trip.closed_by,'Dashboard Offloading Officer'
from generate_series(1,6) as series(n)
join public.trips as trip on trip.id=('ee000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
union all
select 'ef000000-0000-0000-0000-000000000019','INV-2026-123019',trip.id,trip.trip_number,
  trip.truck_id,trip.truck_registration_at_loading,trip.driver_id,trip.driver_name_at_loading,
  '08012345678','private-driver-secret-19@example.invalid','SENTINEL BANK DATA',
  'SENTINEL ACCOUNT NAME','1234567890',trip.loading_site_id,'Dashboard Loading Site',
  trip.offloading_site_id,'Dashboard Offloading Site',trip.quantity_tonnes,trip.opened_at,
  trip.closed_at,trip.closed_at,trip.closed_by,'Dashboard Offloading Officer'
from public.trips as trip where trip.id='ee000000-0000-0000-0000-000000000019';

update public.trip_closure_invoice_documents as document
set status='failed',attempts=5,failed_at=statement_timestamp(),last_error_message='PDF-SECRET-DETAIL'
where document.trip_id in (
  select ('ee000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
  from generate_series(1,6) as series(n)
);
update public.trip_closure_invoice_documents
set status='ready',attempts=1,ready_at=statement_timestamp()
where trip_id='ee000000-0000-0000-0000-000000000019';

insert into public.trip_payments(
  trip_id,truck_id,driver_id,driver_name,driver_phone,driver_email,status
)
select trip.id,trip.truck_id,trip.driver_id,trip.driver_name_at_loading,'08012345678',
  'private-payment-recipient@example.invalid','payment_details_required'
from public.trips as trip
where trip.id in (
  select ('ee000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid from generate_series(1,6) as series(n)
);
insert into public.notification_outbox(
  event_type,trip_id,audience,recipients,payload,status,last_error,updated_at,next_attempt_at
)
select 'waybill_ready',trip.id,'finance',array['private-notification-recipient@example.invalid'],
  jsonb_build_object('account_number','9876543210','bank_name','PRIVATE BANK','email','private@example.invalid'),
  'failed','PROVIDER-SECRET-ERROR',statement_timestamp(),statement_timestamp()
from public.trips as trip
where trip.id in (
  select ('ee000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid from generate_series(1,6) as series(n)
);

alter table public.exceptions disable trigger user;
insert into public.exceptions(
  id,truck_id,trip_id,exception_type,description,blocks_operations,status,reported_by,created_at,
  resolved_at,resolved_by,resolution_reason
)
select ('f1000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  trip.truck_id,trip.id,'invalid_state','EXCEPTION-SECRET-BANK-123456',false,
  case when n = 7 then 'resolved'::public.exception_status else 'open'::public.exception_status end,
  'e9000000-0000-0000-0000-000000000001',clock.start_at + make_interval(mins => n),
  case when n = 7 then clock.start_at + interval '1 hour' else null end,
  case when n = 7 then 'e9000000-0000-0000-0000-000000000001'::uuid else null end,
  case when n = 7 then 'EXCEPTION-REASON-SECRET' else null end
from generate_series(1,7) as series(n)
join public.trips as trip on trip.id=('ee000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
cross join dashboard_clock as clock;
alter table public.exceptions enable trigger user;

insert into public.audit_log(entity_name,entity_id,action,old_value,new_value,reason,actor_id,created_at)
select 'trip_payments',payment.id,'UPDATE',
  jsonb_build_object('status','pending','account_number','BANK-AUDIT-SECRET-424242'),
  jsonb_build_object('status','paid','bank_name','AUDIT-BANK-SECRET'),
  'AUDIT-REASON-SECRET', 'e9000000-0000-0000-0000-000000000003',clock.start_at + interval '3 hours'
from public.trip_payments as payment
cross join dashboard_clock as clock
where payment.trip_id='ee000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub','e9000000-0000-0000-0000-000000000001',true);
insert into dashboard_results values('summary',public.get_operations_dashboard_summary());
insert into dashboard_results values('open_trips',public.get_operations_dashboard_open_trips(10));
insert into dashboard_results values('activity',public.get_operations_dashboard_activity(50));
insert into dashboard_results values('activity_default',public.get_operations_dashboard_activity());

select pg_temp.dashboard_assert(
  (select (v->>'trips_opened_today')::bigint=baseline.opened_today+7
    and (v->>'trips_closed_today')::bigint=baseline.closed_today+5
    and (v->>'open_trips')::bigint=baseline.open_trips+11
    and (v->>'tonnage_today')::numeric=baseline.tonnage_today+15
    and (v->>'trucks_processed_today')::bigint=baseline.trucks_today+5
    and (v->>'exceptions_requiring_attention')::bigint=baseline.unresolved_exceptions+6
   from dashboard_results cross join dashboard_baseline as baseline where k='summary'),
  'summary counts Lagos-day openings regardless of status, closure boundaries, all open trips, tonnage and distinct trucks: ' ||
  (select jsonb_build_object('opened',v->>'trips_opened_today','closed',v->>'trips_closed_today',
    'open',v->>'open_trips','tonnage',v->>'tonnage_today','trucks',v->>'trucks_processed_today',
    'exceptions',v->>'exceptions_requiring_attention')::text from dashboard_results where k='summary'));
select pg_temp.dashboard_assert(
  (select (v#>>'{action_required,unresolved_exceptions,count}')::bigint=baseline.unresolved_exceptions+6
    and jsonb_array_length(v#>'{action_required,unresolved_exceptions,items}')=5
    and (v#>>'{action_required,failed_waybill_pdfs,count}')::bigint=baseline.failed_pdfs+6
    and jsonb_array_length(v#>'{action_required,failed_waybill_pdfs,items}')=5
    and (v#>>'{action_required,failed_waybill_emails,count}')::bigint=baseline.failed_emails+6
    and jsonb_array_length(v#>'{action_required,failed_waybill_emails,items}')=5
    and (v#>>'{action_required,payment_details_required,count}')::bigint=baseline.payment_details_required+6
    and jsonb_array_length(v#>'{action_required,payment_details_required,items}')=5
   from dashboard_results cross join dashboard_baseline as baseline where k='summary'),
  'Action Required returns exact counts and at most five safe previews per category');
select pg_temp.dashboard_assert(
  (select jsonb_array_length(v->'items')=10
    and v->'items'->0->>'trip_number'='DASH-TRIP-007'
    and v->'items'->1->>'trip_number'='DASH-TRIP-008'
    and v->'items'->0->>'status'='open'
    and (v->'items'->0->>'duration_seconds')::bigint>0
    and v->>'as_of' is not null
   from dashboard_results where k='open_trips'),
  'open preview is capped, oldest-first with deterministic tie-breaking and authoritative duration/as-of');
select pg_temp.dashboard_assert(
  (select jsonb_array_length(v->'items')<=50
    and (select bool_and(item->>'event_type' = any(array[
      'trip_opened','trip_closed','trip_cancelled','exception_raised','exception_resolved',
      'waybill_issued','pdf_ready','payment_status_changed']))
      from jsonb_array_elements(v->'items') as item)
    and (select count(*) from jsonb_array_elements(v->'items') as item where item->>'event_type'='pdf_ready')=1
    and (select count(*) from jsonb_array_elements(v->'items') as item where item->>'event_type'='payment_status_changed')>=1
    and v->>'as_of' is not null
   from dashboard_results where k='activity'),
  'activity is bounded and contains only explicitly supported event types, including PDF-ready and status changes: ' ||
  (select jsonb_build_object('count',jsonb_array_length(v->'items'),
    'pdf_ready',(select count(*) from jsonb_array_elements(v->'items') as item where item->>'event_type'='pdf_ready'),
    'payment_status',(select count(*) from jsonb_array_elements(v->'items') as item where item->>'event_type'='payment_status_changed'),
    'types', (select jsonb_agg(distinct item->>'event_type') from jsonb_array_elements(v->'items') as item))::text
    from dashboard_results where k='activity'));
select pg_temp.dashboard_assert(
  (select jsonb_array_length(v->'items')<=20 from dashboard_results where k='activity_default'),
  'activity default batch is capped at 20');
select pg_temp.dashboard_assert(
  (select (v::text !~* '1234567890|9876543210|424242|SECRET|private@example|recipient@example|PROVIDER')
   from dashboard_results where k='summary')
  and (select v::text !~* '1234567890|9876543210|424242|SECRET|private@example|recipient@example|PROVIDER'
   from dashboard_results where k='activity'),
  'banking, recipient, payload, description, reason and provider-error data never appear in dashboard output');

select pg_temp.dashboard_expect_state('select public.get_operations_dashboard_open_trips(11)','22023');
select pg_temp.dashboard_expect_state('select public.get_operations_dashboard_open_trips(0)','22023');
select pg_temp.dashboard_expect_state('select public.get_operations_dashboard_activity(51)','22023');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','e9000000-0000-0000-0000-000000000002',true);
select pg_temp.dashboard_expect_state('select public.get_operations_dashboard_summary()','42501');
select set_config('request.jwt.claim.sub','e9000000-0000-0000-0000-000000000003',true);
select pg_temp.dashboard_expect_state('select public.get_operations_dashboard_open_trips(10)','42501');
select set_config('request.jwt.claim.sub','e9000000-0000-0000-0000-000000000004',true);
select pg_temp.dashboard_expect_state('select public.get_operations_dashboard_activity(20)','42501');
select set_config('request.jwt.claim.sub','e9000000-0000-0000-0000-000000000005',true);
select pg_temp.dashboard_expect_state('select public.get_operations_dashboard_summary()','42501');
select set_config('request.jwt.claim.sub','e9000000-0000-0000-0000-000000000006',true);
select pg_temp.dashboard_expect_state('select public.get_operations_dashboard_summary()','42501');
select set_config('request.jwt.claim.sub','e9000000-0000-0000-0000-000000000007',true);
select pg_temp.dashboard_expect_state('select public.get_operations_dashboard_summary()','42501');
reset role;

set local role anon;
select pg_temp.dashboard_expect_state('select public.get_operations_dashboard_summary()','42501');
reset role;
set local role service_role;
select pg_temp.dashboard_expect_state('select public.get_operations_dashboard_summary()','42501');
reset role;

rollback;
