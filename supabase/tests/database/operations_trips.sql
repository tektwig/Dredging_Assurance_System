begin;

create function pg_temp.operations_trips_assert(p_condition boolean, p_message text) returns void
language plpgsql as $$
begin
  if p_condition is distinct from true then
    raise exception 'Operations Trips assertion failed: %', p_message;
  end if;
end;
$$;

create function pg_temp.operations_trips_expect_state(p_query text, p_expected text) returns void
language plpgsql as $$
declare
  v_state text;
begin
  begin
    execute p_query;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state = p_expected then return; end if;
    raise exception 'Expected SQLSTATE %, got %', p_expected, v_state;
  end;
  raise exception 'Expected SQLSTATE %', p_expected;
end;
$$;

select pg_temp.operations_trips_assert(
  has_function_privilege('authenticated',
    'public.get_operations_trips(integer,integer,text,public.trip_status,date,date,text,text,text,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.get_operations_trip_detail(uuid)', 'EXECUTE')
    and not has_function_privilege('anon',
      'public.get_operations_trips(integer,integer,text,public.trip_status,date,date,text,text,text,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_operations_trip_detail(uuid)', 'EXECUTE')
    and not has_function_privilege('service_role',
      'public.get_operations_trips(integer,integer,text,public.trip_status,date,date,text,text,text,text)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.get_operations_trip_detail(uuid)', 'EXECUTE')
    and to_regprocedure('public.get_operations_trips(integer,integer,text,public.trip_status,date,date,text,text,text,text,uuid)') is null
    and to_regprocedure('public.get_operations_trip_detail(uuid,uuid)') is null,
  'read RPCs have least-privilege grants and no actor/site parameters');

insert into auth.users(id,email,raw_user_meta_data) values
  ('a8110000-0000-0000-0000-000000000001','ops-trips@example.invalid','{}'),
  ('a8110000-0000-0000-0000-000000000002','loading-trips@example.invalid','{}'),
  ('a8110000-0000-0000-0000-000000000003','offloading-trips@example.invalid','{}'),
  ('a8110000-0000-0000-0000-000000000004','finance-trips@example.invalid','{}'),
  ('a8110000-0000-0000-0000-000000000005','audit-trips@example.invalid','{}'),
  ('a8110000-0000-0000-0000-000000000006','admin-trips@example.invalid','{}'),
  ('a8110000-0000-0000-0000-000000000007','inactive-trips@example.invalid','{}');
update public.profiles set role = case right(id::text,1)
  when '1' then 'operations_manager'::public.app_role
  when '2' then 'loading_officer'::public.app_role
  when '3' then 'offloading_officer'::public.app_role
  when '4' then 'finance_officer'::public.app_role
  when '5' then 'audit_reviewer'::public.app_role
  when '6' then 'system_administrator'::public.app_role
  else 'operations_manager'::public.app_role end,
  is_active = right(id::text,1) <> '7',
  display_name = 'Trip Test Officer ' || right(id::text,1)
where id::text like 'a8110000-%';

insert into public.sites(id,name,site_type,is_active) values
  ('a8120000-0000-0000-0000-000000000001','Operations Loading Site','loading',true),
  ('a8120000-0000-0000-0000-000000000002','Operations Offloading Site','offloading',true);
insert into public.drivers(id,full_name,phone_number,email) values
  ('a8130000-0000-0000-0000-000000000001','Current Master Driver','08012000001','current-driver@example.invalid'),
  ('a8130000-0000-0000-0000-000000000002','Second Driver','08012000002','second-driver@example.invalid'),
  ('a8130000-0000-0000-0000-000000000003','Third Driver','08012000003','third-driver@example.invalid'),
  ('a8130000-0000-0000-0000-000000000004','Fourth Driver','08012000004','fourth-driver@example.invalid'),
  ('a8130000-0000-0000-0000-000000000005','Fifth Driver','08012000005','fifth-driver@example.invalid');
insert into public.trucks(id,registration_number,driver_id) values
  ('a8140000-0000-0000-0000-000000000001','AB-C 001','a8130000-0000-0000-0000-000000000001'),
  ('a8140000-0000-0000-0000-000000000002','TRIP-002','a8130000-0000-0000-0000-000000000002'),
  ('a8140000-0000-0000-0000-000000000003','TRIP-003','a8130000-0000-0000-0000-000000000003'),
  ('a8140000-0000-0000-0000-000000000004','TRIP-004','a8130000-0000-0000-0000-000000000004'),
  ('a8140000-0000-0000-0000-000000000005','TRIP-005','a8130000-0000-0000-0000-000000000005');

alter table public.daily_registrations disable trigger user;
insert into public.daily_registrations(id,truck_id,initial_driver_id,operational_date,registered_at,registered_by)
select ('a8150000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  ('a8140000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  ('a8130000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  date '2026-09-27',timestamp with time zone '2026-09-27 00:00:00 Africa/Lagos',
  'a8110000-0000-0000-0000-000000000002'
from generate_series(1,5) as series(n);
alter table public.daily_registrations enable trigger user;

alter table public.trips disable trigger user;
insert into public.trips(
  id,trip_number,truck_id,driver_id,daily_registration_id,loading_site_id,offloading_site_id,
  status,quantity_tonnes,opened_at,opened_by,closed_at,closed_by,cancelled_at,cancelled_by,
  cancellation_reason,truck_registration_at_loading,driver_name_at_loading
)
values
  ('a8160000-0000-0000-0000-000000000001','OPS-TRIP-001','a8140000-0000-0000-0000-000000000001',
   'a8130000-0000-0000-0000-000000000001','a8150000-0000-0000-0000-000000000001',
   'a8120000-0000-0000-0000-000000000001',null,'open',null,
   timestamp with time zone '2026-09-27 00:00:00 Africa/Lagos',
   'a8110000-0000-0000-0000-000000000002',null,null,null,null,null,'AB-C 001','Driver At Loading'),
  ('a8160000-0000-0000-0000-000000000002','OPS-TRIP-002','a8140000-0000-0000-0000-000000000002',
   'a8130000-0000-0000-0000-000000000002','a8150000-0000-0000-0000-000000000002',
   'a8120000-0000-0000-0000-000000000001','a8120000-0000-0000-0000-000000000002','closed',12.50,
   timestamp with time zone '2026-09-27 00:00:00 Africa/Lagos',
   'a8110000-0000-0000-0000-000000000002',
   timestamp with time zone '2026-09-27 15:00:00 Africa/Lagos',
   'a8110000-0000-0000-0000-000000000003',null,null,null,'TRIP-002','Second Driver'),
  ('a8160000-0000-0000-0000-000000000003','OPS-TRIP-003','a8140000-0000-0000-0000-000000000003',
   'a8130000-0000-0000-0000-000000000003','a8150000-0000-0000-0000-000000000003',
   'a8120000-0000-0000-0000-000000000001',null,'cancelled',null,
   timestamp with time zone '2026-09-27 23:59:59.999999 Africa/Lagos',
   'a8110000-0000-0000-0000-000000000002',null,null,
   timestamp with time zone '2026-09-27 23:59:59.999999 Africa/Lagos',
   'a8110000-0000-0000-0000-000000000001','Cancellation test reason BANK-SECRET-2468','TRIP-003','Third Driver'),
  ('a8160000-0000-0000-0000-000000000004','OPS-TRIP-004','a8140000-0000-0000-0000-000000000004',
   'a8130000-0000-0000-0000-000000000004','a8150000-0000-0000-0000-000000000004',
   'a8120000-0000-0000-0000-000000000001',null,'open',null,
   timestamp with time zone '2026-09-28 00:00:00 Africa/Lagos',
   'a8110000-0000-0000-0000-000000000002',null,null,null,null,null,'TRIP-004','Fourth Driver'),
  ('a8160000-0000-0000-0000-000000000005','OPS-TRIP-005','a8140000-0000-0000-0000-000000000005',
   'a8130000-0000-0000-0000-000000000005','a8150000-0000-0000-0000-000000000005',
   'a8120000-0000-0000-0000-000000000001',null,'open',null,
   timestamp with time zone '2026-09-26 09:00:00 Africa/Lagos',
   'a8110000-0000-0000-0000-000000000002',null,null,null,null,null,'TRIP-005','Fifth Driver');
alter table public.trips enable trigger user;

insert into public.trip_closure_invoices(
  id,invoice_number,trip_id,trip_number,truck_id,truck_registration,driver_id,driver_name,
  driver_phone,driver_email,bank_name,account_name,account_number,loading_site_id,loading_site_name,
  offloading_site_id,offloading_site_name,loading_officer_id,loading_officer_name,
  offloading_officer_id,offloading_officer_name,quantity_tonnes,opened_at,closed_at,issued_at
) values (
  'a8170000-0000-0000-0000-000000000001','INV-2026-654321',
  'a8160000-0000-0000-0000-000000000002','OPS-TRIP-002',
  'a8140000-0000-0000-0000-000000000002','TRIP-002','a8130000-0000-0000-0000-000000000002',
  'Second Driver','08012000002','driver-secret@example.invalid','BANK-SECRET-4321','ACCOUNT-SECRET',
  '1234567890','a8120000-0000-0000-0000-000000000001','Snapshot Loading Site',
  'a8120000-0000-0000-0000-000000000002','Snapshot Offloading Site',
  'a8110000-0000-0000-0000-000000000002','Snapshot Loading Officer',
  'a8110000-0000-0000-0000-000000000003','Snapshot Offloading Officer',12.50,
  timestamp with time zone '2026-09-27 00:00:00 Africa/Lagos',
  timestamp with time zone '2026-09-27 15:00:00 Africa/Lagos',
  timestamp with time zone '2026-09-27 15:00:00 Africa/Lagos'
);
update public.trip_closure_invoice_documents set status='ready',ready_at=clock_timestamp()
where trip_id='a8160000-0000-0000-0000-000000000002';

insert into public.trip_payments(
  trip_id,truck_id,driver_id,driver_name,driver_phone,driver_email,account_name,account_number,
  bank_name,payment_ready_at,payment_ready_by,status
) values (
  'a8160000-0000-0000-0000-000000000002','a8140000-0000-0000-0000-000000000002',
  'a8130000-0000-0000-0000-000000000002','Second Driver','08012000002','payout-secret@example.invalid',
  'PAYOUT-ACCOUNT-SECRET','9876543210','PAYOUT-BANK-SECRET',
  timestamp with time zone '2026-09-27 15:00:00 Africa/Lagos',
  'a8110000-0000-0000-0000-000000000006','pending'
);
insert into public.notification_outbox(trip_id,audience,recipients,payload)
values('a8160000-0000-0000-0000-000000000002','finance',array['outbox-secret@example.invalid'],
  jsonb_build_object('account_number','OUTBOX-SECRET-5555','bank_name','OUTBOX-BANK-SECRET'));

select set_config('request.jwt.claim.sub','a8110000-0000-0000-0000-000000000003',true);
insert into public.exceptions(
  id,truck_id,trip_id,exception_type,description,blocks_operations,status,reported_by,created_at
) values (
  'a8180000-0000-0000-0000-000000000001','a8140000-0000-0000-0000-000000000002',
  'a8160000-0000-0000-0000-000000000002','dispute','EXCEPTION-DESCRIPTION-SECRET',false,'open',
  'a8110000-0000-0000-0000-000000000003',timestamp with time zone '2026-09-27 16:00:00 Africa/Lagos'
);
insert into public.exceptions(
  id,truck_id,trip_id,exception_type,description,blocks_operations,status,reported_by,created_at
) values (
  'a8180000-0000-0000-0000-000000000002','a8140000-0000-0000-0000-000000000002',
  'a8160000-0000-0000-0000-000000000002','invalid_state','RESOLVED-EXCEPTION-SECRET',false,'open',
  'a8110000-0000-0000-0000-000000000003',timestamp with time zone '2026-09-27 16:01:00 Africa/Lagos'
);
set local role authenticated;
select set_config('request.jwt.claim.sub','a8110000-0000-0000-0000-000000000001',true);
select public.resolve_trip_exception('a8180000-0000-0000-0000-000000000002','RESOLUTION-SECRET');
reset role;

create temp table operations_trip_results(key text primary key, value jsonb);
grant all on operations_trip_results to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','a8110000-0000-0000-0000-000000000001',true);
insert into operations_trip_results values
  ('page_one',public.get_operations_trips(1,2,null,null,'2026-09-27','2026-09-27',null,null,null,null)),
  ('page_two',public.get_operations_trips(2,2,null,null,'2026-09-27','2026-09-27',null,null,null,null)),
  ('search_driver',public.get_operations_trips(1,25,'Driver At Loading',null,null,null,null,null,null,null)),
  ('search_current_driver',public.get_operations_trips(1,25,'Current Master Driver',null,null,null,null,null,null,null)),
  ('trip_search',public.get_operations_trips(1,25,'OPS-TRIP-002',null,null,null,null,null,null,null)),
  ('search_plate',public.get_operations_trips(1,25,'abc 001',null,null,null,null,null,null,null)),
  ('truck_filter',public.get_operations_trips(1,25,null,null,null,null,'abc 001',null,null,null)),
  ('driver_filter',public.get_operations_trips(1,25,null,null,null,null,null,'Second Driver',null,null)),
  ('loading_filter',public.get_operations_trips(1,25,null,null,null,null,null,null,'Snapshot Loading',null)),
  ('offloading_filter',public.get_operations_trips(1,25,null,null,null,null,null,null,null,'Snapshot Offloading')),
  ('closed_filter',public.get_operations_trips(1,25,null,'closed',null,null,null,null,null,null)),
  ('open_filter',public.get_operations_trips(1,25,null,'open','2026-09-27','2026-09-27',null,null,null,null)),
  ('cancelled_filter',public.get_operations_trips(1,25,null,'cancelled','2026-09-27','2026-09-27',null,null,null,null)),
  ('closed_detail',public.get_operations_trip_detail('a8160000-0000-0000-0000-000000000002')),
  ('cancelled_detail',public.get_operations_trip_detail('a8160000-0000-0000-0000-000000000003')),
  ('open_detail',public.get_operations_trip_detail('a8160000-0000-0000-0000-000000000001'));

select pg_temp.operations_trips_assert(
  (select (value->>'page')::integer=1 and (value->>'page_size')::integer=2
    and (value->>'total_count')::integer=3 and (value->>'has_next')::boolean
    and jsonb_array_length(value->'items')=2
    and value#>>'{items,0,trip_number}'='OPS-TRIP-003'
    and value#>>'{items,1,trip_number}'='OPS-TRIP-002'
   from operations_trip_results where key='page_one')
  and (select (value->>'total_count')::integer=3 and not (value->>'has_next')::boolean
    and jsonb_array_length(value->'items')=1 and value#>>'{items,0,trip_number}'='OPS-TRIP-001'
   from operations_trip_results where key='page_two'),
  'pagination is bounded, date-to is inclusive using Lagos next-day exclusive upper bound, and order is opened_at DESC then id DESC');
select pg_temp.operations_trips_assert(
  (select bool_and(jsonb_array_length(value->'items')=1 and value#>>'{items,0,trip_number}'='OPS-TRIP-001')
    from operations_trip_results where key in ('search_driver','search_plate','truck_filter'))
  and (select value#>>'{items,0,trip_number}'='OPS-TRIP-002' from operations_trip_results where key='trip_search')
  and (select (value->>'total_count')::integer=0 from operations_trip_results where key='search_current_driver')
  and (select value#>>'{items,0,driver_name}'='Second Driver' from operations_trip_results where key='driver_filter')
  and (select value#>>'{items,0,loading_site_name}'='Snapshot Loading Site' from operations_trip_results where key='loading_filter')
  and (select value#>>'{items,0,offloading_site_name}'='Snapshot Offloading Site' from operations_trip_results where key='offloading_filter')
  and (select value#>>'{items,0,status}'='closed' from operations_trip_results where key='closed_filter')
  and (select value#>>'{items,0,status}'='open' from operations_trip_results where key='open_filter')
  and (select value#>>'{items,0,status}'='cancelled' from operations_trip_results where key='cancelled_filter'),
  'search uses trip number, normalized plate, and loading-time driver snapshot; independent filters are server-side');
select pg_temp.operations_trips_assert(
  (select jsonb_typeof(value->'waybill')='object'
    and value#>>'{waybill,invoice_number}'='INV-2026-654321'
    and value#>>'{waybill,pdf_status}'='ready'
    and value#>>'{trip,loading_site_name}'='Snapshot Loading Site'
    and value#>>'{trip,loading_officer,display_name}'='Snapshot Loading Officer'
    and value#>>'{trip,offloading_officer,display_name}'='Snapshot Offloading Officer'
    and value#>>'{payout,status}'='pending'
    and value#>>'{payout,payment_ready_at}' is not null
    and jsonb_array_length(value->'exceptions')=2
    and value#>>'{exceptions,0,exception_type}'='dispute'
    and value#>>'{exceptions,1,status}'='resolved'
    and value#>>'{exceptions,1,resolved_at}' is not null
    and value::text !~* 'BANK-SECRET|ACCOUNT-SECRET|1234567890|9876543210|payout-secret|driver-secret|outbox-secret|EXCEPTION-DESCRIPTION|RESOLVED-EXCEPTION|RESOLUTION-SECRET|OUTBOX-SECRET|PAYOUT-ACCOUNT|PAYOUT-BANK|recipient@example'
    from operations_trip_results where key='closed_detail')
  and (select value#>>'{trip,status}'='cancelled'
    and value#>>'{trip,cancelled_at}' is not null
    and value#>>'{trip,cancelled_officer,officer_id}'='a8110000-0000-0000-0000-000000000001'
    and value->'waybill'='null'::jsonb and value->'payout'='null'::jsonb
    and value#>>'{trip,closed_at}' is null and value->'exceptions'='[]'::jsonb
    and value::text !~* 'BANK-SECRET|2468'
    from operations_trip_results where key='cancelled_detail')
  and (select value#>>'{trip,status}'='open' and value->'waybill'='null'::jsonb
    and value#>>'{trip,offloading_site_id}' is null and value->'payout'='null'::jsonb
    from operations_trip_results where key='open_detail'),
  'detail projects safe lifecycle data only and represents cancellation without closure, reasons, banking, outbox, or exception text');

select pg_temp.operations_trips_expect_state('select public.get_operations_trips(0,25)', '22023');
select pg_temp.operations_trips_expect_state('select public.get_operations_trips(1,101)', '22023');
select pg_temp.operations_trips_expect_state('select public.get_operations_trips(1,25,null,null,''2026-09-28'',''2026-09-27'')', '22023');
select pg_temp.operations_trips_expect_state('select public.get_operations_trips(1,25,''x'',null,null,null,''too-long-plate-filter-value-that-exceeds-the-limit-123456789012345678901234567890'')', '22023');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','a8110000-0000-0000-0000-000000000002',true);
select pg_temp.operations_trips_expect_state('select public.get_operations_trips()', '42501');
select pg_temp.operations_trips_expect_state('select public.get_operations_trip_detail(''a8160000-0000-0000-0000-000000000002'')', '42501');
select set_config('request.jwt.claim.sub','a8110000-0000-0000-0000-000000000003',true);
select pg_temp.operations_trips_expect_state('select public.get_operations_trips()', '42501');
select set_config('request.jwt.claim.sub','a8110000-0000-0000-0000-000000000004',true);
select pg_temp.operations_trips_expect_state('select public.get_operations_trip_detail(''a8160000-0000-0000-0000-000000000002'')', '42501');
select set_config('request.jwt.claim.sub','a8110000-0000-0000-0000-000000000005',true);
select pg_temp.operations_trips_expect_state('select public.get_operations_trips()', '42501');
select set_config('request.jwt.claim.sub','a8110000-0000-0000-0000-000000000006',true);
select pg_temp.operations_trips_expect_state('select public.get_operations_trip_detail(''a8160000-0000-0000-0000-000000000002'')', '42501');
select set_config('request.jwt.claim.sub','a8110000-0000-0000-0000-000000000007',true);
select pg_temp.operations_trips_expect_state('select public.get_operations_trips()', '42501');
reset role;
set local role anon;
select pg_temp.operations_trips_expect_state('select public.get_operations_trips()', '42501');
reset role;
set local role service_role;
select pg_temp.operations_trips_expect_state('select public.get_operations_trip_detail(''a8160000-0000-0000-0000-000000000002'')', '42501');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','a8110000-0000-0000-0000-000000000001',true);
select pg_temp.operations_trips_expect_state('select public.cancel_trip(''a8160000-0000-0000-0000-000000000001'',''   '')', '22023');
select public.cancel_trip('a8160000-0000-0000-0000-000000000001','Operations cancellation regression reason');
reset role;
select pg_temp.operations_trips_assert(
  (select status='cancelled' and cancelled_by='a8110000-0000-0000-0000-000000000001'
    and cancelled_at is not null and closed_at is null
   from public.trips where id='a8160000-0000-0000-0000-000000000001')
  and (select count(*)=1 and min(reason)='Operations cancellation regression reason'
    from public.audit_log where entity_name='trips' and entity_id='a8160000-0000-0000-0000-000000000001'
      and action='UPDATE' and actor_id='a8110000-0000-0000-0000-000000000001'),
  'existing cancellation RPC requires a reason and commits actor/reason audit while preserving lifecycle immutability');
set local role authenticated;
select set_config('request.jwt.claim.sub','a8110000-0000-0000-0000-000000000001',true);
select pg_temp.operations_trips_expect_state('select public.cancel_trip(''a8160000-0000-0000-0000-000000000001'',''duplicate'')', '22023');
select pg_temp.operations_trips_expect_state('select public.cancel_trip(''a8160000-0000-0000-0000-000000000002'',''closed trip'')', '22023');
select set_config('request.jwt.claim.sub','a8110000-0000-0000-0000-000000000006',true);
select public.cancel_trip('a8160000-0000-0000-0000-000000000005','System Administrator legitimate cancellation');
reset role;
select pg_temp.operations_trips_assert(
  (select status='cancelled' and cancelled_by='a8110000-0000-0000-0000-000000000006'
   from public.trips where id='a8160000-0000-0000-0000-000000000005'),
  'existing System Administrator cancellation authorization remains intact');

rollback;
