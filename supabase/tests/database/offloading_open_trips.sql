begin;

-- PGlite does not ship Supabase Auth's session table or jwt() helper. Model the
-- minimum session claims used by the production field-session authorization.
create table if not exists auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  created_at timestamptz not null
);
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;
grant execute on function auth.jwt() to authenticated, anon, service_role;

create function pg_temp.offloading_open_assert(v boolean, m text) returns void language plpgsql as $$
begin
  if v is distinct from true then raise exception 'Offloading Open Trips assertion failed: %', m; end if;
end;
$$;
create function pg_temp.offloading_open_expect_unauthorized(q text) returns void language plpgsql as $$
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

select pg_temp.offloading_open_assert(
  has_function_privilege('authenticated', 'public.get_offloading_open_trips()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_offloading_open_trips()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.get_offloading_open_trips()', 'EXECUTE')
  and to_regprocedure('public.get_offloading_open_trips(uuid)') is null,
  'read RPC is actor-derived, authenticated-only, and accepts no actor or site argument');

insert into auth.users(id,email,raw_user_meta_data) values
 ('ed100000-0000-0000-0000-000000000001','open-admin@example.invalid','{}'),
 ('ed100000-0000-0000-0000-000000000002','open-loader@example.invalid','{}'),
 ('ed100000-0000-0000-0000-000000000003','open-offloader-a@example.invalid','{}'),
 ('ed100000-0000-0000-0000-000000000004','open-offloader-b@example.invalid','{}'),
 ('ed100000-0000-0000-0000-000000000005','open-unassigned@example.invalid','{}'),
 ('ed100000-0000-0000-0000-000000000006','open-operations@example.invalid','{}');
insert into auth.sessions(id,user_id,created_at) values
 ('ed200000-0000-0000-0000-000000000001','ed100000-0000-0000-0000-000000000001',statement_timestamp()),
 ('ed200000-0000-0000-0000-000000000002','ed100000-0000-0000-0000-000000000002',statement_timestamp()),
 ('ed200000-0000-0000-0000-000000000003','ed100000-0000-0000-0000-000000000003',statement_timestamp()),
 ('ed200000-0000-0000-0000-000000000004','ed100000-0000-0000-0000-000000000004',statement_timestamp()),
 ('ed200000-0000-0000-0000-000000000005','ed100000-0000-0000-0000-000000000005',statement_timestamp()),
 ('ed200000-0000-0000-0000-000000000006','ed100000-0000-0000-0000-000000000006',statement_timestamp());
update public.profiles set role=case right(id::text,1)
  when '1' then 'system_administrator'::public.app_role
  when '2' then 'loading_officer'::public.app_role
  when '3' then 'offloading_officer'::public.app_role
  when '4' then 'offloading_officer'::public.app_role
  when '5' then 'offloading_officer'::public.app_role
  else 'operations_manager'::public.app_role end, is_active=true
where id::text like 'ed100000-%';
insert into public.sites(id,name,site_type,is_active) values
 ('ed300000-0000-0000-0000-000000000001','Open Trips Loading','loading',true),
 ('ed300000-0000-0000-0000-000000000002','Open Trips Offloading A','offloading',true),
 ('ed300000-0000-0000-0000-000000000003','Open Trips Offloading B','offloading',true),
 ('ed300000-0000-0000-0000-000000000004','Open Trips Inactive Site','offloading',true);
insert into public.drivers(id,full_name,phone_number,email) values
 ('ed400000-0000-0000-0000-000000000001','Open Trips Driver','08016660001','private@example.invalid');
insert into public.trucks(id,registration_number,driver_id) values
 ('ed500000-0000-0000-0000-000000000001','OPEN-101','ed400000-0000-0000-0000-000000000001'),
 ('ed500000-0000-0000-0000-000000000002','OPEN-202','ed400000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub','ed100000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"ed100000-0000-0000-0000-000000000001","session_id":"ed200000-0000-0000-0000-000000000001"}',true);
select public.assign_user_site('ed100000-0000-0000-0000-000000000002','ed300000-0000-0000-0000-000000000001');
select public.assign_user_site('ed100000-0000-0000-0000-000000000003','ed300000-0000-0000-0000-000000000002');
select public.assign_user_site('ed100000-0000-0000-0000-000000000004','ed300000-0000-0000-0000-000000000003');

create temp table offloading_open_state(k text primary key, v jsonb);
grant all on offloading_open_state to authenticated;
select set_config('request.jwt.claim.sub','ed100000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"ed100000-0000-0000-0000-000000000002","session_id":"ed200000-0000-0000-0000-000000000002"}',true);
insert into offloading_open_state values('trip_a',public.create_loading_trip_v2(
 'ed600000-0000-0000-0000-000000000001','OPEN-101','ed400000-0000-0000-0000-000000000001',
 (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
 'MANUAL',clock_timestamp(),10.00));
insert into offloading_open_state values('trip_b',public.create_loading_trip_v2(
 'ed600000-0000-0000-0000-000000000002','OPEN-202','ed400000-0000-0000-0000-000000000001',
 (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
 'MANUAL',clock_timestamp(),11.00));
select pg_temp.offloading_open_assert((select bool_and(v->>'ok'='true') from offloading_open_state),
  'fixture trips are created through the authoritative Loading RPC');

reset role;
alter table public.trips disable trigger user;
update public.trips set opened_at=clock_timestamp()-interval '2 days'
where id=(select (v#>>'{trip,id}')::uuid from offloading_open_state where k='trip_a');
update public.trips set opened_at=clock_timestamp()-interval '1 day'
where id=(select (v#>>'{trip,id}')::uuid from offloading_open_state where k='trip_b');
alter table public.trips enable trigger user;

set local role authenticated;
select set_config('request.jwt.claim.sub','ed100000-0000-0000-0000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"ed100000-0000-0000-0000-000000000003","session_id":"ed200000-0000-0000-0000-000000000003"}',true);
insert into offloading_open_state values('list_a',public.get_offloading_open_trips());
select pg_temp.offloading_open_assert((select v->>'ok'='true'
  and v#>>'{assignment,site_id}'='ed300000-0000-0000-0000-000000000002'
  and jsonb_array_length(v->'trips')=2
  and v#>>'{trips,0,trip_number}'=(select v#>>'{trip,trip_number}' from offloading_open_state where k='trip_a')
  and v#>>'{trips,1,trip_number}'=(select v#>>'{trip,trip_number}' from offloading_open_state where k='trip_b')
  and (v->'trips'->0) ?& array['id','trip_number','truck_id','registration_number',
    'normalized_registration','opened_at','loading_site_name']
  and not ((v->'trips'->0) ?| array['driver_name','driver_email','account_number','bank_name','payment_status'])
  and (select bool_and(t.offloading_site_id is null and t.status='open') from public.trips t
    where t.id in (select (x->>'id')::uuid from jsonb_array_elements(v->'trips') x))
  from offloading_open_state where k='list_a'),
  'assigned officer receives oldest-first OPEN trips with a minimal projection and no trip mutation');

select set_config('request.jwt.claim.sub','ed100000-0000-0000-0000-000000000004',true);
select set_config('request.jwt.claims','{"sub":"ed100000-0000-0000-0000-000000000004","session_id":"ed200000-0000-0000-0000-000000000004"}',true);
insert into offloading_open_state values('list_b',public.get_offloading_open_trips());
select pg_temp.offloading_open_assert((select v#>>'{assignment,site_id}'='ed300000-0000-0000-0000-000000000003'
  and v->'trips'=(select v->'trips' from offloading_open_state where k='list_a')
  from offloading_open_state where k='list_b'),
  'all in-transit trips are processable at the active assigned Offloading Site because OPEN records have no destination site');

reset role;
alter table public.trips disable trigger user;
update public.trips set status='closed',offloading_site_id='ed300000-0000-0000-0000-000000000002',
  quantity_tonnes=1.00,closed_at=clock_timestamp(),closed_by='ed100000-0000-0000-0000-000000000003'
where id=(select (v#>>'{trip,id}')::uuid from offloading_open_state where k='trip_a');
alter table public.trips enable trigger user;
set local role authenticated;
select set_config('request.jwt.claim.sub','ed100000-0000-0000-0000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"ed100000-0000-0000-0000-000000000003","session_id":"ed200000-0000-0000-0000-000000000003"}',true);
insert into offloading_open_state values('after_close',public.get_offloading_open_trips());
select pg_temp.offloading_open_assert((select jsonb_array_length(v->'trips')=1
  and v#>>'{trips,0,id}'=(select v#>>'{trip,id}' from offloading_open_state where k='trip_b')
  from offloading_open_state where k='after_close'),
  'a closed trip disappears from the refreshed Open Trips read model');

select set_config('request.jwt.claim.sub','ed100000-0000-0000-0000-000000000005',true);
select set_config('request.jwt.claims','{"sub":"ed100000-0000-0000-0000-000000000005","session_id":"ed200000-0000-0000-0000-000000000005"}',true);
insert into offloading_open_state values('missing_assignment',public.get_offloading_open_trips());
select pg_temp.offloading_open_assert((select v->>'ok'='false' and v->>'code'='SITE_ASSIGNMENT_REQUIRED'
  from offloading_open_state where k='missing_assignment'), 'unassigned officer sees no trips');

select set_config('request.jwt.claim.sub','ed100000-0000-0000-0000-000000000006',true);
select set_config('request.jwt.claims','{"sub":"ed100000-0000-0000-0000-000000000006","session_id":"ed200000-0000-0000-0000-000000000006"}',true);
select pg_temp.offloading_open_expect_unauthorized('select public.get_offloading_open_trips()');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','ed100000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"ed100000-0000-0000-0000-000000000001","session_id":"ed200000-0000-0000-0000-000000000001"}',true);
select public.assign_user_site('ed100000-0000-0000-0000-000000000005','ed300000-0000-0000-0000-000000000004');
reset role;
update public.sites set is_active=false where id='ed300000-0000-0000-0000-000000000004';
set local role authenticated;
select set_config('request.jwt.claim.sub','ed100000-0000-0000-0000-000000000005',true);
select set_config('request.jwt.claims','{"sub":"ed100000-0000-0000-0000-000000000005","session_id":"ed200000-0000-0000-0000-000000000005"}',true);
insert into offloading_open_state values('inactive_assignment',public.get_offloading_open_trips());
select pg_temp.offloading_open_assert((select v->>'ok'='false' and v->>'code'='INACTIVE_SITE'
  from offloading_open_state where k='inactive_assignment'), 'inactive assigned site blocks the read model');

rollback;
