-- Disposable local database ONLY, after all migrations. All fixture writes roll back.
begin;
create function pg_temp.scope_assert(v boolean,m text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'Read-scope assertion failed: %',m; end if; end $$;
create function pg_temp.scope_expect_unauthorized(q text) returns void language plpgsql as $$
begin
  begin execute q; exception when insufficient_privilege then return; end;
  raise exception 'Expected SQLSTATE 42501';
end $$;

insert into auth.users(id,email,raw_user_meta_data) values
 ('c0000000-0000-0000-0000-000000000001','scope-admin@example.invalid','{}'),
 ('c0000000-0000-0000-0000-000000000002','scope-loader-a@example.invalid','{}'),
 ('c0000000-0000-0000-0000-000000000003','scope-loader-b@example.invalid','{}'),
 ('c0000000-0000-0000-0000-000000000004','scope-unassigned@example.invalid','{}'),
 ('c0000000-0000-0000-0000-000000000005','scope-offloader@example.invalid','{}'),
 ('c0000000-0000-0000-0000-000000000006','scope-operations@example.invalid','{}'),
 ('c0000000-0000-0000-0000-000000000007','scope-finance@example.invalid','{}'),
 ('c0000000-0000-0000-0000-000000000008','scope-audit@example.invalid','{}');
update public.profiles set is_active=true,role=case right(id::text,1)
 when '1' then 'system_administrator'::public.app_role
 when '5' then 'offloading_officer'::public.app_role
 when '6' then 'operations_manager'::public.app_role
 when '7' then 'finance_officer'::public.app_role
 when '8' then 'audit_reviewer'::public.app_role
 else 'loading_officer'::public.app_role end where id::text like 'c0000000-%';
select set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000001',true);
insert into public.sites(id,name,site_type) values
 ('c1000000-0000-0000-0000-000000000001','Scope loading A','loading'),
 ('c1000000-0000-0000-0000-000000000002','Scope loading B','loading'),
 ('c1000000-0000-0000-0000-000000000003','Scope offloading','offloading');
insert into public.user_site_assignments(id,profile_id,site_id,assigned_by) values
 ('c6000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001'),
 ('c6000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001');
insert into public.drivers(id,full_name,phone_number) values
 ('c2000000-0000-0000-0000-000000000001','Scope driver','08011111111');
insert into public.trucks(id,registration_number,driver_id) values
 ('c3000000-0000-0000-0000-000000000001','SCOPE-A1','c2000000-0000-0000-0000-000000000001'),
 ('c3000000-0000-0000-0000-000000000002','SCOPE-A2','c2000000-0000-0000-0000-000000000001'),
 ('c3000000-0000-0000-0000-000000000003','SCOPE-A3','c2000000-0000-0000-0000-000000000001'),
 ('c3000000-0000-0000-0000-000000000004','SCOPE-A4','c2000000-0000-0000-0000-000000000001'),
 ('c3000000-0000-0000-0000-000000000005','SCOPE-B1','c2000000-0000-0000-0000-000000000001'),
 ('c3000000-0000-0000-0000-000000000006','SCOPE-B2','c2000000-0000-0000-0000-000000000001');

-- Fixture timestamps are explicit to distinguish the four aggregations. Disable
-- only lifecycle insert triggers for these synthetic rows; FKs/checks remain on.
alter table public.daily_registrations disable trigger registration_guard;
alter table public.trips disable trigger trip_guard;
alter table public.trips disable trigger y_loading_trip_guard;
alter table public.trips disable trigger loading_evidence_required;
do $$ declare d date:=(statement_timestamp() at time zone 'Africa/Lagos')::date;
  t timestamptz; y timestamptz;
begin
  t:=d::timestamp at time zone 'Africa/Lagos';
  y:=(d-1)::timestamp at time zone 'Africa/Lagos';
  insert into public.daily_registrations(id,truck_id,initial_driver_id,operational_date,registered_at,registered_by) values
   ('c4000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001',d,t+interval '1 minute','c0000000-0000-0000-0000-000000000002'),
   ('c4000000-0000-0000-0000-000000000002','c3000000-0000-0000-0000-000000000002','c2000000-0000-0000-0000-000000000001',d,t+interval '1 minute','c0000000-0000-0000-0000-000000000002'),
   ('c4000000-0000-0000-0000-000000000003','c3000000-0000-0000-0000-000000000003','c2000000-0000-0000-0000-000000000001',d-1,y+interval '1 minute','c0000000-0000-0000-0000-000000000002'),
   ('c4000000-0000-0000-0000-000000000004','c3000000-0000-0000-0000-000000000004','c2000000-0000-0000-0000-000000000001',d-1,y+interval '1 minute','c0000000-0000-0000-0000-000000000002'),
   ('c4000000-0000-0000-0000-000000000005','c3000000-0000-0000-0000-000000000005','c2000000-0000-0000-0000-000000000001',d,t+interval '1 minute','c0000000-0000-0000-0000-000000000003'),
   ('c4000000-0000-0000-0000-000000000006','c3000000-0000-0000-0000-000000000006','c2000000-0000-0000-0000-000000000001',d-1,y+interval '1 minute','c0000000-0000-0000-0000-000000000003');
  insert into public.trips(id,trip_number,truck_id,driver_id,daily_registration_id,loading_site_id,
    offloading_site_id,status,quantity_tonnes,opened_at,opened_by,closed_at,closed_by,driver_name_at_loading,loading_assignment_id) values
   ('c5000000-0000-0000-0000-000000000001','SCOPE-1','c3000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000003','closed',10,t+interval '2 minutes','c0000000-0000-0000-0000-000000000002',t+interval '3 minutes','c0000000-0000-0000-0000-000000000005','Scope driver','c6000000-0000-0000-0000-000000000001'),
   ('c5000000-0000-0000-0000-000000000002','SCOPE-2','c3000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001',null,'open',null,t+interval '4 minutes','c0000000-0000-0000-0000-000000000002',null,null,'Scope driver','c6000000-0000-0000-0000-000000000001'),
   ('c5000000-0000-0000-0000-000000000003','SCOPE-3','c3000000-0000-0000-0000-000000000002','c2000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000003','closed',10,t+interval '2 minutes','c0000000-0000-0000-0000-000000000002',t+interval '3 minutes','c0000000-0000-0000-0000-000000000005','Scope driver','c6000000-0000-0000-0000-000000000001'),
   ('c5000000-0000-0000-0000-000000000004','SCOPE-4','c3000000-0000-0000-0000-000000000003','c2000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000001',null,'open',null,y+interval '2 minutes','c0000000-0000-0000-0000-000000000002',null,null,'Scope driver','c6000000-0000-0000-0000-000000000001'),
   ('c5000000-0000-0000-0000-000000000005','SCOPE-5','c3000000-0000-0000-0000-000000000004','c2000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000004','c1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000003','closed',10,y+interval '2 minutes','c0000000-0000-0000-0000-000000000002',t+interval '3 minutes','c0000000-0000-0000-0000-000000000005','Scope driver','c6000000-0000-0000-0000-000000000001'),
   ('c5000000-0000-0000-0000-000000000006','SCOPE-6','c3000000-0000-0000-0000-000000000005','c2000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000005','c1000000-0000-0000-0000-000000000002',null,'open',null,t+interval '2 minutes','c0000000-0000-0000-0000-000000000003',null,null,'Scope driver','c6000000-0000-0000-0000-000000000002'),
   ('c5000000-0000-0000-0000-000000000007','SCOPE-7','c3000000-0000-0000-0000-000000000006','c2000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000006','c1000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000003','closed',10,y+interval '2 minutes','c0000000-0000-0000-0000-000000000003',t+interval '3 minutes','c0000000-0000-0000-0000-000000000005','Scope driver','c6000000-0000-0000-0000-000000000002');
end $$;
alter table public.daily_registrations enable trigger registration_guard;
alter table public.trips enable trigger trip_guard;
alter table public.trips enable trigger y_loading_trip_guard;
alter table public.trips enable trigger loading_evidence_required;

set local role authenticated;
select set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000002',true);
select pg_temp.scope_assert((select count(*)=5 from public.trips where trip_number like 'SCOPE-%'),'Officer A sees all five own trips');
select pg_temp.scope_assert((select count(*)=0 from public.trips where opened_by='c0000000-0000-0000-0000-000000000003'),'Officer A cannot read Officer B trips');
select pg_temp.scope_assert((select count(*)=1 from public.sites where id in('c1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000003')),'Officer A sees one assigned site');
select pg_temp.scope_assert((select count(*)=0 from public.sites where id='c1000000-0000-0000-0000-000000000002'),'Officer A cannot enumerate Officer B site');
select pg_temp.scope_assert((select count(*)=0 from public.user_site_assignments where profile_id='c0000000-0000-0000-0000-000000000003'),'Officer A cannot read Officer B assignment');
do $$ declare v jsonb:=public.get_loading_statistics(); begin
  if (v->>'ok',v->>'trips_opened',v->>'open_trips',v->>'trips_closed',v->>'trucks_processed')
    is distinct from ('true','3','2','3','2') then raise exception 'Officer A statistics mismatch: %',v; end if;
end $$;
select set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000003',true);
do $$ declare v jsonb:=public.get_loading_statistics(); begin
  if (v->>'ok',v->>'trips_opened',v->>'open_trips',v->>'trips_closed',v->>'trucks_processed')
    is distinct from ('true','1','1','1','1') then raise exception 'Officer B statistics mismatch: %',v; end if;
end $$;
select pg_temp.scope_assert((select count(*)=2 from public.trips where trip_number like 'SCOPE-%'),'Officer B sees only two own trips');

select set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000004',true);
select pg_temp.scope_assert(public.get_loading_statistics()->>'code'='SITE_ASSIGNMENT_REQUIRED','Unassigned loader denied statistics');
select pg_temp.scope_assert((select count(*)=0 from public.sites where id in('c1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002')),'Unassigned loader sees no loading sites');

-- Preserve the broader read contract for the other five operational roles.
do $$ declare v_id uuid; begin
  foreach v_id in array array[
    'c0000000-0000-0000-0000-000000000001'::uuid,
    'c0000000-0000-0000-0000-000000000005'::uuid,
    'c0000000-0000-0000-0000-000000000006'::uuid,
    'c0000000-0000-0000-0000-000000000007'::uuid,
    'c0000000-0000-0000-0000-000000000008'::uuid] loop
    perform set_config('request.jwt.claim.sub',v_id::text,true);
    if (select count(*) from public.trips where trip_number like 'SCOPE-%') is distinct from 7
      or (select count(*) from public.sites where id in('c1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000003')) is distinct from 3 then
      raise exception 'Broader role visibility regressed for %',v_id;
    end if;
    perform pg_temp.scope_expect_unauthorized('select public.get_loading_statistics()');
  end loop;
end $$;
select pg_temp.scope_assert(not has_function_privilege('anon','public.get_loading_statistics()','EXECUTE')
  and not has_function_privilege('service_role','public.get_loading_statistics()','EXECUTE'),
  'Only authenticated application role can execute statistics RPC');
select pg_temp.scope_assert(to_regprocedure('public.get_loading_statistics(uuid)') is null,'Statistics RPC accepts no actor parameter');

-- Moving an officer changes current site visibility, but not their own history.
select set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000001',true);
select public.assign_user_site('c0000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000002');
select set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000002',true);
select pg_temp.scope_assert((select count(*)=1 from public.sites where id='c1000000-0000-0000-0000-000000000002'),'Reassigned officer sees new site');
select pg_temp.scope_assert((select count(*)=0 from public.sites where id='c1000000-0000-0000-0000-000000000001'),'Reassigned officer cannot read old site');
select pg_temp.scope_assert((select count(*)=5 from public.trips where trip_number like 'SCOPE-%'),'Reassignment preserves own trip visibility');
select pg_temp.scope_assert(public.get_loading_statistics()->>'trips_opened'='3','Reassignment preserves own statistics');

reset role;
select set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000001',true);
update public.sites set is_active=false where id='c1000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000002',true);
select pg_temp.scope_assert((select count(*)=0 from public.sites where id='c1000000-0000-0000-0000-000000000002'),'Inactive assigned site hidden');
select pg_temp.scope_assert(public.get_loading_statistics()->>'code'='INACTIVE_SITE','Inactive site blocks statistics');
reset role;
select set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000001',true);
update public.sites set is_active=true where id='c1000000-0000-0000-0000-000000000002';
-- A wrong-type assignment cannot be created through administrator RPCs; seed
-- this corrupted-assignment case with only the assignment guard disabled.
alter table public.user_site_assignments disable trigger assignment_guard;
update public.user_site_assignments set site_id='c1000000-0000-0000-0000-000000000003'
 where profile_id='c0000000-0000-0000-0000-000000000002' and ended_at is null;
alter table public.user_site_assignments enable trigger assignment_guard;
set local role authenticated;
select set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000002',true);
select pg_temp.scope_assert(public.get_loading_statistics()->>'code'='INVALID_SITE_ASSIGNMENT','Wrong site type blocks statistics');
reset role;
alter table public.user_site_assignments disable trigger assignment_guard;
update public.user_site_assignments set site_id='c1000000-0000-0000-0000-000000000002'
 where profile_id='c0000000-0000-0000-0000-000000000002' and ended_at is null;
alter table public.user_site_assignments enable trigger assignment_guard;
update public.profiles set is_active=false where id='c0000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000002',true);
select pg_temp.scope_expect_unauthorized('select public.get_loading_statistics()');
select pg_temp.scope_assert((select count(*)=0 from public.trips where trip_number like 'SCOPE-%')
  and (select count(*)=0 from public.sites where id in('c1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002')),
  'Inactive loader cannot directly read trips or sites');
rollback;
