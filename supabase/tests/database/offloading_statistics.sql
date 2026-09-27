begin;

create function pg_temp.statistics_assert(v boolean, m text) returns void language plpgsql as $$
begin
  if v is distinct from true then raise exception 'Offloading statistics assertion failed: %', m; end if;
end;
$$;

create function pg_temp.statistics_expect_unauthorized(q text) returns void language plpgsql as $$
declare actual_state text;
begin
  begin execute q;
  exception when others then
    get stacked diagnostics actual_state = returned_sqlstate;
    if actual_state = '42501' then return; end if;
    raise exception 'Expected SQLSTATE 42501, got %', actual_state;
  end;
  raise exception 'Expected SQLSTATE 42501';
end;
$$;

create temp table statistics_state(k text primary key, v jsonb);
grant all on statistics_state to authenticated;

select pg_temp.statistics_assert(
  has_function_privilege('authenticated','public.get_offloading_statistics()','EXECUTE')
  and not has_function_privilege('anon','public.get_offloading_statistics()','EXECUTE')
  and not has_function_privilege('service_role','public.get_offloading_statistics()','EXECUTE')
  and to_regprocedure('public.get_offloading_statistics(uuid)') is null,
  'statistics RPC is authenticated-only and accepts no actor/site argument');

insert into auth.users(id,email,raw_user_meta_data) values
 ('e0000000-0000-0000-0000-000000000001','stats-admin@example.invalid','{}'),
 ('e0000000-0000-0000-0000-000000000002','stats-loader@example.invalid','{}'),
 ('e0000000-0000-0000-0000-000000000003','stats-offloader-a@example.invalid','{}'),
 ('e0000000-0000-0000-0000-000000000004','stats-offloader-b@example.invalid','{}'),
 ('e0000000-0000-0000-0000-000000000005','stats-unassigned@example.invalid','{}'),
 ('e0000000-0000-0000-0000-000000000006','stats-operations@example.invalid','{}');
update public.profiles set is_active=true,role=case right(id::text,1)
  when '1' then 'system_administrator'::public.app_role
  when '2' then 'loading_officer'::public.app_role
  when '3' then 'offloading_officer'::public.app_role
  when '4' then 'offloading_officer'::public.app_role
  when '5' then 'offloading_officer'::public.app_role
  else 'operations_manager'::public.app_role end
where id::text like 'e0000000-%';

insert into public.sites(id,name,site_type,is_active) values
 ('e1000000-0000-0000-0000-000000000001','Statistics Loading','loading',true),
 ('e1000000-0000-0000-0000-000000000002','Statistics Offloading A','offloading',true),
 ('e1000000-0000-0000-0000-000000000003','Statistics Offloading B','offloading',true),
 ('e1000000-0000-0000-0000-000000000004','Statistics Inactive Offloading','offloading',false);
insert into public.drivers(id,full_name,phone_number,email) values
 ('e2000000-0000-0000-0000-000000000001','Statistics Driver','08010000001','stats-driver@example.invalid');
insert into public.trucks(id,registration_number,driver_id) values
 ('e3000000-0000-0000-0000-000000000001','STAT-101','e2000000-0000-0000-0000-000000000001'),
 ('e3000000-0000-0000-0000-000000000002','STAT-202','e2000000-0000-0000-0000-000000000001'),
 ('e3000000-0000-0000-0000-000000000003','STAT-303','e2000000-0000-0000-0000-000000000001'),
 ('e3000000-0000-0000-0000-000000000004','STAT-404','e2000000-0000-0000-0000-000000000001'),
 ('e3000000-0000-0000-0000-000000000005','STAT-505','e2000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000001',true);
select public.assign_user_site('e0000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000001');
select public.assign_user_site('e0000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000002');
select public.assign_user_site('e0000000-0000-0000-0000-000000000004','e1000000-0000-0000-0000-000000000003');

reset role;
insert into statistics_state values('open_baseline',jsonb_build_object(
  'count',(select count(*) from public.trips where status='open')));
set local role authenticated;
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000003',true);
insert into statistics_state values('zero',public.get_offloading_statistics());
select pg_temp.statistics_assert(
  (select (select count(*) from jsonb_each(v))=4 and v->>'trips_closed_today'='0'
    and v->>'open_trips'=(select v->>'count' from statistics_state where k='open_baseline')
    and v->>'tonnage_processed_today'='0' and v->>'trucks_processed_today'='0'
   from statistics_state where k='zero'),
  'zero closure state returns zero work metrics and the open-pool baseline: ' ||
    (select v::text from statistics_state where k='zero'));

select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000005',true);
insert into statistics_state values('missing_assignment',public.get_offloading_statistics());
select pg_temp.statistics_assert((select v->>'ok'='false' and v->>'code'='SITE_ASSIGNMENT_REQUIRED'
  from statistics_state where k='missing_assignment'), 'offloading assignment is required');
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000006',true);
select pg_temp.statistics_expect_unauthorized('select public.get_offloading_statistics()');
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000002',true);
select pg_temp.statistics_expect_unauthorized('select public.get_offloading_statistics()');

select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000002',true);
insert into statistics_state values('open_one',public.create_loading_trip_v2(
 'e4000000-0000-0000-0000-000000000001','STAT-101','e2000000-0000-0000-0000-000000000001',
 (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
 'MANUAL',clock_timestamp()));
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000003',true);
insert into statistics_state values('closed_a',public.close_trip_v2(
 'e5000000-0000-0000-0000-000000000001',(select (v#>>'{trip,id}')::uuid from statistics_state where k='open_one'),
 'STAT-101',(select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
 12.50,'MANUAL',clock_timestamp()));
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000002',true);
insert into statistics_state values('open_two',public.create_loading_trip_v2(
 'e4000000-0000-0000-0000-000000000002','STAT-101','e2000000-0000-0000-0000-000000000001',
 (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
 'MANUAL',clock_timestamp()));
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000003',true);
insert into statistics_state values('closed_b',public.close_trip_v2(
 'e5000000-0000-0000-0000-000000000002',(select (v#>>'{trip,id}')::uuid from statistics_state where k='open_two'),
 'STAT-101',(select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
 7.50,'MANUAL',clock_timestamp()));
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000002',true);
insert into statistics_state values('open_three',public.create_loading_trip_v2(
 'e4000000-0000-0000-0000-000000000003','STAT-202','e2000000-0000-0000-0000-000000000001',
 (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
 'MANUAL',clock_timestamp()));
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000003',true);
insert into statistics_state values('closed_outside_day',public.close_trip_v2(
 'e5000000-0000-0000-0000-000000000003',(select (v#>>'{trip,id}')::uuid from statistics_state where k='open_three'),
 'STAT-202',(select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
 5.25,'MANUAL',clock_timestamp()));
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000002',true);
insert into statistics_state values('open_four',public.create_loading_trip_v2(
 'e4000000-0000-0000-0000-000000000004','STAT-303','e2000000-0000-0000-0000-000000000001',
 (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
 'MANUAL',clock_timestamp()));
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000004',true);
insert into statistics_state values('closed_other_officer',public.close_trip_v2(
 'e5000000-0000-0000-0000-000000000004',(select (v#>>'{trip,id}')::uuid from statistics_state where k='open_four'),
 'STAT-303',(select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
 100.00,'MANUAL',clock_timestamp()));
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000002',true);
insert into statistics_state values('open_five',public.create_loading_trip_v2(
 'e4000000-0000-0000-0000-000000000005','STAT-404','e2000000-0000-0000-0000-000000000001',
 (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
 'MANUAL',clock_timestamp()));
select pg_temp.statistics_assert((select bool_and(v->>'ok'='true')
  from statistics_state where k like 'closed_%')
  and (select bool_and(v->>'ok'='true') from statistics_state where k like 'open_%'),
  'loading fixtures open and close successfully');

reset role;
set constraints all immediate;
do $$
declare
  v_today timestamptz;
  v_tomorrow timestamptz;
begin
  v_today := ((statement_timestamp() at time zone 'Africa/Lagos')::date)::timestamp at time zone 'Africa/Lagos';
  v_tomorrow := (((statement_timestamp() at time zone 'Africa/Lagos')::date + 1)::timestamp at time zone 'Africa/Lagos');
  alter table public.trips disable trigger user;
  update public.trips set opened_at=v_today-interval '1 day',closed_at=v_today
    where id=(select (v#>>'{trip,id}')::uuid from statistics_state where k='closed_a');
  update public.trips set opened_at=v_today-interval '1 day',closed_at=v_tomorrow-interval '1 microsecond'
    where id=(select (v#>>'{trip,id}')::uuid from statistics_state where k='closed_b');
  update public.trips set opened_at=v_today-interval '1 day',closed_at=v_tomorrow
    where id=(select (v#>>'{trip,id}')::uuid from statistics_state where k='closed_outside_day');
  update public.trips set opened_at=v_today-interval '1 day',closed_at=v_today+interval '1 hour'
    where id=(select (v#>>'{trip,id}')::uuid from statistics_state where k='closed_other_officer');
  update public.trips set opened_at=v_today-interval '2 days'
    where id=(select (v#>>'{trip,id}')::uuid from statistics_state where k='open_five');
  alter table public.trips enable trigger user;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000003',true);
insert into statistics_state values('metrics_a',public.get_offloading_statistics());
select pg_temp.statistics_assert((select (select count(*) from jsonb_each(v))=4
  and v->>'trips_closed_today'='2'
  and v->>'open_trips'=(select ((v->>'count')::integer+1)::text from statistics_state where k='open_baseline')
  and v->>'tonnage_processed_today'='20.00' and v->>'trucks_processed_today'='1'
  from statistics_state where k='metrics_a'),
  'Lagos day includes day-start and last microsecond, sums only own closures, distincts truck, and counts open pool');
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000004',true);
insert into statistics_state values('metrics_b',public.get_offloading_statistics());
select pg_temp.statistics_assert((select v->>'trips_closed_today'='1'
  and v->>'tonnage_processed_today'='100.00' and v->>'trucks_processed_today'='1'
  from statistics_state where k='metrics_b'), 'officer B sees only their own closure metrics');

select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000001',true);
select public.assign_user_site('e0000000-0000-0000-0000-000000000005','e1000000-0000-0000-0000-000000000002');
reset role;
update public.sites set is_active=false where id='e1000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000005',true);
insert into statistics_state values('inactive_assignment',public.get_offloading_statistics());
select pg_temp.statistics_assert((select v->>'ok'='false' and v->>'code'='INACTIVE_SITE'
  from statistics_state where k='inactive_assignment'), 'inactive assigned site blocks statistics');
reset role;
update public.sites set is_active=true where id='e1000000-0000-0000-0000-000000000002';
alter table public.sites disable trigger user;
update public.sites set site_type='loading' where id='e1000000-0000-0000-0000-000000000002';
alter table public.sites enable trigger user;
set local role authenticated;
insert into statistics_state values('wrong_site_type',public.get_offloading_statistics());
select pg_temp.statistics_assert((select v->>'ok'='false' and v->>'code'='INVALID_SITE_ASSIGNMENT'
  from statistics_state where k='wrong_site_type'), 'wrong-type assigned site blocks statistics');
reset role;

rollback;
