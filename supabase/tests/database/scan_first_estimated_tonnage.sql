begin;
create function pg_temp.estimate_assert(v boolean,m text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'Scan-first estimate assertion failed: %',m; end if; end $$;
create function pg_temp.estimate_code(v jsonb,c text) returns void language plpgsql as $$
begin perform pg_temp.estimate_assert(v->>'ok'='false' and v->>'code'=c,c); end $$;
insert into auth.users(id,email,raw_user_meta_data) values
 ('ee000000-0000-0000-0000-000000000001','scan-admin@example.invalid','{}'),
 ('ee000000-0000-0000-0000-000000000002','scan-loader@example.invalid','{}'),
 ('ee000000-0000-0000-0000-000000000003','scan-ops@example.invalid','{}');
update public.profiles set role=case right(id::text,1)
  when '1' then 'system_administrator'::public.app_role
  when '2' then 'loading_officer'::public.app_role
  else 'operations_manager'::public.app_role end,is_active=true
where id::text like 'ee000000-%';
select set_config('request.jwt.claim.sub','ee000000-0000-0000-0000-000000000001',true);
insert into public.sites(id,name,site_type,is_active) values
 ('ee100000-0000-0000-0000-000000000001','Estimate Loading','loading',true);
insert into public.drivers(id,full_name,phone_number) values
 ('ee200000-0000-0000-0000-000000000001','Estimate Driver','08017770001');
insert into public.trucks(id,registration_number,driver_id) values
 ('ee300000-0000-0000-0000-000000000001','EST-123','ee200000-0000-0000-0000-000000000001');
insert into public.user_site_assignments(profile_id,site_id)
 values('ee000000-0000-0000-0000-000000000002','ee100000-0000-0000-0000-000000000001');
insert into storage.objects(bucket_id,name,owner_id,metadata) values
 ('loading-plate-evidence','ee000000-0000-0000-0000-000000000002/ee500000-0000-0000-0000-000000000001.jpg',
  'ee000000-0000-0000-0000-000000000002','{"mimetype":"image/jpeg","size":1000}');

select pg_temp.estimate_assert(has_function_privilege('authenticated',
  'public.create_loading_trip_v2(uuid,text,uuid,uuid,text,timestamptz,numeric,text,numeric,text,boolean)','EXECUTE')
  and not has_function_privilege('anon',
  'public.create_loading_trip_v2(uuid,text,uuid,uuid,text,timestamptz,numeric,text,numeric,text,boolean)','EXECUTE')
  and not has_function_privilege('service_role',
  'public.create_loading_trip_v2(uuid,text,uuid,uuid,text,timestamptz,numeric,text,numeric,text,boolean)','EXECUTE'),
  'estimate opening RPC keeps authenticated-only grant');

set local role authenticated;
select set_config('request.jwt.claim.sub','ee000000-0000-0000-0000-000000000002',true);
create temp table estimate_results(name text primary key,result jsonb);
grant all on estimate_results to authenticated;
insert into estimate_results values('legacy',public.create_loading_trip_v2(
  'ee400000-0000-0000-0000-000000000001','EST-123','ee200000-0000-0000-0000-000000000001',
  (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
  'MANUAL',clock_timestamp()));
select pg_temp.estimate_code((select result from estimate_results where name='legacy'),'ESTIMATED_TONNAGE_REQUIRED');
select pg_temp.estimate_assert((select count(*)=0 from public.trips where truck_id='ee300000-0000-0000-0000-000000000001'),
  'legacy signature cannot open a trip without an estimate');

select pg_temp.estimate_code(public.create_loading_trip_v2(gen_random_uuid(),'EST-123',
  'ee200000-0000-0000-0000-000000000001',(select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
  'MANUAL',clock_timestamp(),0),'INVALID_ESTIMATED_TONNAGE');
select pg_temp.estimate_code(public.create_loading_trip_v2(gen_random_uuid(),'EST-123',
  'ee200000-0000-0000-0000-000000000001',(select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
  'MANUAL',clock_timestamp(),10.001),'INVALID_ESTIMATED_TONNAGE');
select pg_temp.estimate_code(public.create_loading_trip_v2(gen_random_uuid(),'EST-123',
  'ee200000-0000-0000-0000-000000000001',(select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
  'MANUAL',clock_timestamp(),100000000),'INVALID_ESTIMATED_TONNAGE');
insert into estimate_results values('opened',public.create_loading_trip_v2(
  'ee400000-0000-0000-0000-000000000002','EST-123','ee200000-0000-0000-0000-000000000001',
  (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
  'OCR',clock_timestamp(),12.34,'EST-123',0.9,
  'ee000000-0000-0000-0000-000000000002/ee500000-0000-0000-0000-000000000001.jpg'));
select pg_temp.estimate_assert((select result->>'ok'='true'
  and result#>>'{trip,estimated_quantity_tonnes}'='12.34' from estimate_results where name='opened'),
  'valid estimate is atomically returned from authoritative open');
select pg_temp.estimate_assert(public.create_loading_trip_v2(
  'ee400000-0000-0000-0000-000000000002',null,null,null,null,null,12.34)
  =(select result from estimate_results where name='opened'),'same request and estimate replay the authoritative response');
select pg_temp.estimate_code(public.create_loading_trip_v2(
  'ee400000-0000-0000-0000-000000000002',null,null,null,null,null,12.35),'REQUEST_PAYLOAD_CONFLICT');
select pg_temp.estimate_assert((select estimated_quantity_tonnes=12.34 and quantity_tonnes is null
  from public.trips where id=(select (result#>>'{trip,id}')::uuid from estimate_results where name='opened')),
  'estimate is stored separately from actual tonnage');

reset role;
do $$ begin
  begin update public.trips set estimated_quantity_tonnes=15
    where id=(select (result#>>'{trip,id}')::uuid from estimate_results where name='opened');
    raise exception 'Estimate mutation unexpectedly succeeded';
  exception when check_violation then null;
  end;
end $$;
select pg_temp.estimate_assert((select estimated_quantity_tonnes=12.34 from public.trips
  where id=(select (result#>>'{trip,id}')::uuid from estimate_results where name='opened')),
  'trip guard prevents estimate changes after opening');

set local role authenticated;
select set_config('request.jwt.claim.sub','ee000000-0000-0000-0000-000000000003',true);
select pg_temp.estimate_assert(public.get_operations_trip_detail(
  (select (result#>>'{trip,id}')::uuid from estimate_results where name='opened'))#>>'{trip,estimated_quantity_tonnes}'='12.34',
  'Operations detail returns estimate separately');
select pg_temp.estimate_assert((public.get_operations_report('trips',
  (select jsonb_build_object('basis','open',
    'date_from',to_char((opened_at at time zone 'Africa/Lagos')::date,'YYYY-MM-DD'),
    'date_to',to_char((opened_at at time zone 'Africa/Lagos')::date,'YYYY-MM-DD'))
    from public.trips where id=(select (result#>>'{trip,id}')::uuid from estimate_results where name='opened')),
  1,25)
  #>>'{items,0,estimated_tonnage_tonnes}')='12.34',
  'Trips report projection includes estimate without changing actual tonnage fields');
select pg_temp.estimate_assert((select count(*)=0 from public.trip_closure_invoices where trip_id=(
  select (result#>>'{trip,id}')::uuid from estimate_results where name='opened')),
  'opening estimate does not create or mutate this trip Waybill');
rollback;
