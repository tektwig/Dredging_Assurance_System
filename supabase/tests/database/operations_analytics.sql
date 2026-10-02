begin;

create function pg_temp.analytics_assert(condition boolean,message text) returns void language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'Operations Analytics assertion failed: %',message; end if;
end;
$$;
create function pg_temp.analytics_error(query text,state text) returns void language plpgsql as $$
declare actual text;
begin
  begin execute query;
  exception when others then
    get stacked diagnostics actual=returned_sqlstate;
    if actual=state then return; end if;
    raise exception 'Expected SQLSTATE %, got %',state,actual;
  end;
  raise exception 'Expected SQLSTATE %',state;
end;
$$;

select pg_temp.analytics_assert(
  has_function_privilege('authenticated','public.get_operations_analytics(jsonb,text,text)','EXECUTE')
    and has_function_privilege('authenticated','public.get_operations_analytics_filter_options(text,text,integer)','EXECUTE')
    and not has_function_privilege('anon','public.get_operations_analytics(jsonb,text,text)','EXECUTE')
    and not has_function_privilege('service_role','public.get_operations_analytics(jsonb,text,text)','EXECUTE')
    and not has_function_privilege('anon','public.get_operations_analytics_filter_options(text,text,integer)','EXECUTE')
    and not has_function_privilege('service_role','public.get_operations_analytics_filter_options(text,text,integer)','EXECUTE'),
  'Analytics RPCs are Operations-authorized and authenticated-only');

insert into auth.users(id,email,raw_user_meta_data) values
 ('d1000000-0000-0000-0000-000000000001','analytics-ops@example.invalid','{}'),
 ('d1000000-0000-0000-0000-000000000002','analytics-loading@example.invalid','{}'),
 ('d1000000-0000-0000-0000-000000000003','analytics-offloading@example.invalid','{}');
update public.profiles set role=case right(id::text,1)
  when '1' then 'operations_manager'::public.app_role
  when '2' then 'loading_officer'::public.app_role
  else 'offloading_officer'::public.app_role end,
  is_active=true where id::text like 'd1000000-%';

insert into public.sites(id,name,site_type,is_active) values
 ('d2000000-0000-0000-0000-000000000001','Analytics Loading','loading',true),
 ('d2000000-0000-0000-0000-000000000002','Inactive Analytics Loading','loading',false),
 ('d2000000-0000-0000-0000-000000000003','Analytics Offloading','offloading',true),
 ('d2000000-0000-0000-0000-000000000004','Inactive Analytics Offloading','offloading',false);
insert into public.drivers(id,full_name,phone_number,email,is_active) values
 ('d3000000-0000-0000-0000-000000000001','Analytics Driver One','08012340001','analytics-one@example.invalid',true),
 ('d3000000-0000-0000-0000-000000000002','Inactive Analytics Driver','08012340002','analytics-two@example.invalid',false);

insert into public.trucks(id,registration_number,driver_id,is_active)
select ('d4000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
  'ANL-'||lpad(n::text,3,'0'),
  case when n=12 then 'd3000000-0000-0000-0000-000000000002'::uuid
    else 'd3000000-0000-0000-0000-000000000001'::uuid end,
  n<>12
from generate_series(1,17) as series(n);

alter table public.daily_registrations disable trigger user;
insert into public.daily_registrations(id,truck_id,initial_driver_id,operational_date,registered_at,registered_by)
select ('d5000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
  ('d4000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
  case when n=12 then 'd3000000-0000-0000-0000-000000000002'::uuid
    else 'd3000000-0000-0000-0000-000000000001'::uuid end,
  date '2000-01-01',timestamp with time zone '2000-01-01 10:00 Africa/Lagos',
  'd1000000-0000-0000-0000-000000000001'
from generate_series(1,17) as series(n);
alter table public.daily_registrations enable trigger user;

alter table public.trips disable trigger user;
insert into public.trips(id,trip_number,truck_id,driver_id,daily_registration_id,loading_site_id,offloading_site_id,
  status,quantity_tonnes,estimated_quantity_tonnes,opened_at,opened_by,closed_at,closed_by,cancelled_at,cancelled_by,
  cancellation_reason,truck_registration_at_loading,driver_name_at_loading)
values
 ('d6000000-0000-0000-0000-000000000001','ANL-CLOSED-ESTIMATE','d4000000-0000-0000-0000-000000000001',
  'd3000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000001',
  'd2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000003','closed',12.50,10.25,
  timestamp with time zone '2000-01-01 00:00 Africa/Lagos','d1000000-0000-0000-0000-000000000001',
  timestamp with time zone '2000-01-01 02:00 Africa/Lagos','d1000000-0000-0000-0000-000000000001',
  null,null,null,'ANL-001','Analytics Driver One'),
 ('d6000000-0000-0000-0000-000000000002','ANL-CLOSED-NULL-ESTIMATE','d4000000-0000-0000-0000-000000000002',
  'd3000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000002',
  'd2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000003','closed',8.00,null,
  timestamp with time zone '2000-01-01 06:00 Africa/Lagos','d1000000-0000-0000-0000-000000000001',
  timestamp with time zone '2000-01-01 11:00 Africa/Lagos','d1000000-0000-0000-0000-000000000001',
  null,null,null,'ANL-002','Analytics Driver One'),
 ('d6000000-0000-0000-0000-000000000003','ANL-CANCELLED','d4000000-0000-0000-0000-000000000003',
  'd3000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000003',
  'd2000000-0000-0000-0000-000000000001',null,'cancelled',null,null,
  timestamp with time zone '2000-01-01 09:00 Africa/Lagos','d1000000-0000-0000-0000-000000000001',
  null,null,timestamp with time zone '2000-01-01 12:00 Africa/Lagos','d1000000-0000-0000-0000-000000000001',
  'TEST-REASON','ANL-003','Analytics Driver One'),
 ('d6000000-0000-0000-0000-000000000004','ANL-OPEN','d4000000-0000-0000-0000-000000000004',
  'd3000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000004',
  'd2000000-0000-0000-0000-000000000001',null,'open',null,null,
  timestamp with time zone '2000-01-01 11:00 Africa/Lagos','d1000000-0000-0000-0000-000000000001',
  null,null,null,null,null,'ANL-004','Analytics Driver One'),
 ('d6000000-0000-0000-0000-000000000017','ANL-CLOSE-END-BOUNDARY','d4000000-0000-0000-0000-000000000017',
  'd3000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000017',
  'd2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000003','closed',99.00,1.00,
  timestamp with time zone '2000-01-01 15:00 Africa/Lagos','d1000000-0000-0000-0000-000000000001',
  timestamp with time zone '2000-01-02 00:00 Africa/Lagos','d1000000-0000-0000-0000-000000000001',
  null,null,null,'ANL-017','Analytics Driver One');
insert into public.trips(id,trip_number,truck_id,driver_id,daily_registration_id,loading_site_id,offloading_site_id,
  status,quantity_tonnes,estimated_quantity_tonnes,opened_at,opened_by,closed_at,closed_by,
  truck_registration_at_loading,driver_name_at_loading)
select ('d6000000-0000-0000-0000-'||lpad((n+4)::text,12,'0'))::uuid,
  'ANL-BULK-'||n,('d4000000-0000-0000-0000-'||lpad((n+4)::text,12,'0'))::uuid,
  case when n=8 then 'd3000000-0000-0000-0000-000000000002'::uuid
    else 'd3000000-0000-0000-0000-000000000001'::uuid end,
  ('d5000000-0000-0000-0000-'||lpad((n+4)::text,12,'0'))::uuid,
  'd2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000003',
  'closed',1.00,n+1,
  timestamp with time zone '2000-01-01 08:00 Africa/Lagos','d1000000-0000-0000-0000-000000000001',
  timestamp with time zone '2000-01-01 09:00 Africa/Lagos','d1000000-0000-0000-0000-000000000001',
  'ANL-'||lpad((n+4)::text,3,'0'),
  case when n=8 then 'Inactive Analytics Driver' else 'Analytics Driver One' end
from generate_series(1,12) as series(n);
alter table public.trips enable trigger user;

insert into public.trip_payments(trip_id,truck_id,driver_id,driver_name,driver_phone,status)
values ('d6000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001',
  'd3000000-0000-0000-0000-000000000001','Analytics Driver One','08012340001','payment_details_required');
insert into public.trip_payments(trip_id,truck_id,driver_id,driver_name,driver_phone,status,account_name,
  account_number,bank_name,payment_ready_at,payment_ready_by)
values ('d6000000-0000-0000-0000-000000000002','d4000000-0000-0000-0000-000000000002',
  'd3000000-0000-0000-0000-000000000001','Analytics Driver One','08012340001','pending',
  'ANALYTICS-PRIVATE-ACCOUNT','1234567890','ANALYTICS-PRIVATE-BANK',
  timestamp with time zone '2000-01-01 11:00 Africa/Lagos','d1000000-0000-0000-0000-000000000001');

alter table public.exceptions disable trigger user;
insert into public.exceptions(id,truck_id,trip_id,exception_type,description,blocks_operations,status,reported_by,created_at,
  review_started_at,review_started_by)
values
 ('d7000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001',
  'd6000000-0000-0000-0000-000000000001','dispute','ANALYTICS-SECRET-DESCRIPTION',false,'open',
  'd1000000-0000-0000-0000-000000000001',timestamp with time zone '2000-01-01 10:00 Africa/Lagos',null,null),
 ('d7000000-0000-0000-0000-000000000002','d4000000-0000-0000-0000-000000000002',
  'd6000000-0000-0000-0000-000000000002','invalid_state','ANALYTICS-SECRET-RESOLUTION',false,'in_review',
  'd1000000-0000-0000-0000-000000000001',timestamp with time zone '2000-01-01 11:00 Africa/Lagos',
  timestamp with time zone '2000-01-01 12:00 Africa/Lagos','d1000000-0000-0000-0000-000000000001'),
 ('d7000000-0000-0000-0000-000000000003','d4000000-0000-0000-0000-000000000001',
  'd6000000-0000-0000-0000-000000000001','dispute','OUTSIDE-COHORT',false,'open',
  'd1000000-0000-0000-0000-000000000001',timestamp with time zone '2000-01-02 00:00 Africa/Lagos',null,null);
alter table public.exceptions enable trigger user;

create temp table analytics_results(key text primary key,value jsonb);
grant all on analytics_results to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-0000-0000-000000000001',true);
insert into analytics_results values ('custom',public.get_operations_analytics(
  '{"period":"custom","date_from":"2000-01-01","date_to":"2000-01-01"}','truck','trips'));
insert into analytics_results values ('filtered',public.get_operations_analytics(
  '{"period":"custom","date_from":"2000-01-01","date_to":"2000-01-01","truck_id":"d4000000-0000-0000-0000-000000000012"}',
  'driver','average_tonnage'));
insert into analytics_results values ('options_truck',public.get_operations_analytics_filter_options('truck','ANL-012',50));
insert into analytics_results values ('options_driver',public.get_operations_analytics_filter_options('driver','Inactive Analytics',50));
insert into analytics_results values ('options_site',public.get_operations_analytics_filter_options('offloading_site','Inactive Analytics',100));

select pg_temp.analytics_assert((value#>>'{kpis,total_trips}')::integer=17
  and (value#>>'{kpis,actual_tonnage_tonnes}')::numeric=32.5
  and (value#>>'{kpis,actual_tonnage_closed_trip_count}')::integer=14
  and abs((value#>>'{kpis,average_tonnage_per_trip_tonnes}')::numeric-(32.5/14))<0.000001,
  'Total Trips uses opened_at; tonnage KPIs use close dates and ignore the exact exclusive end boundary')
from analytics_results where key='custom';
select pg_temp.analytics_assert(abs((value#>>'{kpis,average_turnaround_seconds}')::numeric-(19.0*3600/14))<0.001
  and (value#>>'{kpis,average_turnaround_trip_count}')::integer=14,
  'turnaround time is the mean closed_at minus opened_at for the close-date cohort')
from analytics_results where key='custom';
select pg_temp.analytics_assert((value#>>'{kpis,variance_trip_count}')::integer=13
  and abs((value#>>'{kpis,total_tonnage_variance_tonnes}')::numeric-(-75.75))<0.001
  and abs((value#>>'{kpis,average_tonnage_variance_tonnes}')::numeric-(-75.75/13))<0.000001
  and abs((value#>>'{kpis,estimate_coverage}')::numeric-(13.0/14))<0.000001,
  'variance is signed actual minus estimate and NULL estimates are excluded from the paired denominator')
from analytics_results where key='custom';
select pg_temp.analytics_assert(jsonb_array_length(value->'trips_trend')=1
  and (value#>>'{trips_trend,0,opened}')::integer=17
  and (value#>>'{trips_trend,0,closed}')::integer=14
  and jsonb_array_length(value->'tonnage_trend')=1
  and (value#>>'{tonnage_trend,0,paired_trip_count}')::integer=13
  and (value#>>'{tonnage_trend,0,actual_tonnage_tonnes}')::numeric=24.5,
  'daily event counts and paired tonnage trend are bounded, zero-filled, and use Lagos dates')
from analytics_results where key='custom';
select pg_temp.analytics_assert((value#>>'{status_distributions,trip,denominator}')::integer=17
  and (value#>>'{status_distributions,trip,slices,0,count}')::integer=1
  and (value#>>'{status_distributions,payout,denominator}')::integer=2
  and (value#>>'{status_distributions,exception,denominator}')::integer=2,
  'each status distribution exposes the denominator for its selected-period current-state cohort')
from analytics_results where key='custom';
select pg_temp.analytics_assert((value#>>'{performance,entity_count}')::integer=17
  and jsonb_array_length(value#>'{performance,items}')=10
  and value#>>'{performance,items,0,entity_id}'='d4000000-0000-0000-0000-000000000001',
  'entity performance is deterministically sorted and capped at Top 10')
from analytics_results where key='custom';
select pg_temp.analytics_assert((value#>>'{variance,trucks,0,entity_id}')='d4000000-0000-0000-0000-000000000016'
  and (value#>>'{variance,trucks,0,average_variance_tonnes}')::numeric=-12
  and (value#>>'{variance,trucks,0,paired_trip_count}')::integer=1,
  'truck variance ranks by absolute average while preserving its negative signed value')
from analytics_results where key='custom';
select pg_temp.analytics_assert((value#>>'{kpis,actual_tonnage_closed_trip_count}')::integer=1
  and (value#>>'{kpis,actual_tonnage_tonnes}')::numeric=1
  and (value#>>'{performance,items,0,trip_count}')::integer=1,
  'global entity filters apply to all aggregates and include inactive truck and driver records')
from analytics_results where key='filtered';
select pg_temp.analytics_assert((value#>>'{items,0,is_active}')::boolean=false
  and value#>>'{items,0,label}'='ANL-012'
  and (select (options_driver.value#>>'{items,0,is_active}')::boolean=false from analytics_results options_driver where key='options_driver')
  and (select (options_site.value#>>'{items,0,is_active}')::boolean=false from analytics_results options_site where key='options_site'),
  'filter options include inactive trucks, drivers, and sites without contact or banking fields')
from analytics_results where key='options_truck';
select pg_temp.analytics_assert(position('ANALYTICS-SECRET' in (select value::text from analytics_results where key='custom'))=0
  and position('ANALYTICS-PRIVATE' in (select value::text from analytics_results where key='custom'))=0
  and position('08012340001' in (select value::text from analytics_results where key='custom'))=0,
  'Analytics projections omit exception free text, payout banking values, and driver phone numbers');

select pg_temp.analytics_error($q$select public.get_operations_analytics(
  '{"period":"custom","date_from":"2000-01-01","date_to":"2000-04-01"}','truck','trips')$q$,'22023');
select pg_temp.analytics_error($q$select public.get_operations_analytics(
  '{"period":"90_days","date_from":"2000-01-01"}','truck','trips')$q$,'22023');
select pg_temp.analytics_error($q$select public.get_operations_analytics(
  '{"period":"custom","date_from":"2000-02-01","date_to":"2000-01-01"}','truck','trips')$q$,'22023');
select pg_temp.analytics_error($q$select public.get_operations_analytics(
  jsonb_build_object('period','custom','date_from',(statement_timestamp() at time zone 'Africa/Lagos')::date,
    'date_to',((statement_timestamp() at time zone 'Africa/Lagos')::date+1)),'truck','trips')$q$,'22023');
select pg_temp.analytics_error($q$select public.get_operations_analytics(
  '{"period":"custom","date_from":"2000-01-01","date_to":"2000-01-01","unexpected":"value"}','truck','trips')$q$,'22023');
select pg_temp.analytics_error($q$select public.get_operations_analytics(
  '{"period":"custom","date_from":"2000-01-01","date_to":"2000-01-01"}','unknown','trips')$q$,'22023');
select pg_temp.analytics_error($q$select public.get_operations_analytics_filter_options('unknown',null,50)$q$,'22023');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-0000-0000-000000000002',true);
select pg_temp.analytics_error($q$select public.get_operations_analytics('{}','truck','trips')$q$,'42501');
select pg_temp.analytics_error($q$select public.get_operations_analytics_filter_options('truck',null,50)$q$,'42501');
reset role;
rollback;
