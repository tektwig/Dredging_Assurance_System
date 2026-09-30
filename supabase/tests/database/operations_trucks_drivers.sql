begin;

create function pg_temp.asset_assert(p_condition boolean, p_message text) returns void
language plpgsql as $$
begin
  if p_condition is distinct from true then raise exception 'Operations asset assertion failed: %', p_message; end if;
end;
$$;
create function pg_temp.asset_expect(p_query text, p_state text) returns void
language plpgsql as $$
declare v_state text;
begin
  begin execute p_query;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state=p_state then return; end if;
    raise exception 'Expected SQLSTATE %, got %',p_state,v_state;
  end;
  raise exception 'Expected SQLSTATE %',p_state;
end;
$$;

select pg_temp.asset_assert(
  has_function_privilege('authenticated','public.get_operations_trucks(integer,integer,text,boolean,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.update_operations_driver_master(uuid,timestamptz,text,text,text,text,text)','EXECUTE')
  and not has_function_privilege('anon','public.get_operations_drivers(integer,integer,text,boolean)','EXECUTE')
  and not has_function_privilege('service_role','public.set_operations_truck_active(uuid,boolean,timestamptz,text)','EXECUTE')
  and not has_function_privilege('authenticated','private.operations_master_reason(text,text[])','EXECUTE'),
  'RPC grants are least privilege and helper is private');
select pg_temp.asset_assert((select count(*)=11 and bool_and(
  has_function_privilege('authenticated',p.oid,'EXECUTE')
  and not has_function_privilege('anon',p.oid,'EXECUTE')
  and not has_function_privilege('service_role',p.oid,'EXECUTE'))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in ('get_operations_trucks','get_operations_drivers','get_operations_truck_detail',
    'get_operations_driver_detail','get_operations_asset_trips','update_operations_truck_master',
    'correct_operations_truck_plate','set_operations_truck_regular_driver','set_operations_truck_active',
    'update_operations_driver_master','set_operations_driver_active')),
  'every new RPC has the same least-privilege grant boundary');

insert into auth.users(id,email,raw_user_meta_data) values
 ('b8110000-0000-0000-0000-000000000001','ops-assets@example.invalid','{}'),
 ('b8110000-0000-0000-0000-000000000002','loading-assets@example.invalid','{}'),
 ('b8110000-0000-0000-0000-000000000003','offloading-assets@example.invalid','{}'),
 ('b8110000-0000-0000-0000-000000000004','finance-assets@example.invalid','{}'),
 ('b8110000-0000-0000-0000-000000000005','audit-assets@example.invalid','{}'),
 ('b8110000-0000-0000-0000-000000000006','admin-assets@example.invalid','{}'),
 ('b8110000-0000-0000-0000-000000000007','inactive-assets@example.invalid','{}');
update public.profiles set role=case right(id::text,1)
  when '1' then 'operations_manager'::public.app_role when '2' then 'loading_officer'::public.app_role
  when '3' then 'offloading_officer'::public.app_role when '4' then 'finance_officer'::public.app_role
  when '5' then 'audit_reviewer'::public.app_role when '6' then 'system_administrator'::public.app_role
  else 'operations_manager'::public.app_role end,
  is_active=right(id::text,1)<>'7' where id::text like 'b8110000-%';
insert into public.sites(id,name,site_type) values
 ('b8120000-0000-0000-0000-000000000001','Asset Loading','loading');
insert into public.drivers(id,full_name,phone_number,email) values
 ('b8130000-0000-0000-0000-000000000001','Historical Actual Driver','08014000001','historical@example.invalid'),
 ('b8130000-0000-0000-0000-000000000002','Replacement Driver','08014000002','replacement@example.invalid'),
 ('b8130000-0000-0000-0000-000000000003','Spare Driver','08014000003',null);
insert into public.driver_payment_details(driver_id,account_name,account_number,bank_name)
 values('b8130000-0000-0000-0000-000000000001','BANK SECRET OWNER','1234567890','BANK SECRET');
insert into public.trucks(id,registration_number,driver_id,truck_type,capacity,capacity_unit) values
 ('b8140000-0000-0000-0000-000000000001','ASSET-001','b8130000-0000-0000-0000-000000000001','Tipper',20,'tonnes'),
 ('b8140000-0000-0000-0000-000000000002','ASSET-002','b8130000-0000-0000-0000-000000000001','Tipper',22,'tonnes'),
 ('b8140000-0000-0000-0000-000000000003','ASSET-003','b8130000-0000-0000-0000-000000000003','Tipper',24,'tonnes');
alter table public.daily_registrations disable trigger user;
insert into public.daily_registrations(id,truck_id,initial_driver_id,operational_date,registered_at,registered_by) values
 ('b8150000-0000-0000-0000-000000000001','b8140000-0000-0000-0000-000000000001','b8130000-0000-0000-0000-000000000001',date '2026-09-28',timestamptz '2026-09-28 00:00:00 Africa/Lagos','b8110000-0000-0000-0000-000000000002'),
 ('b8150000-0000-0000-0000-000000000002','b8140000-0000-0000-0000-000000000002','b8130000-0000-0000-0000-000000000001',date '2026-09-28',timestamptz '2026-09-28 00:00:00 Africa/Lagos','b8110000-0000-0000-0000-000000000002');
alter table public.daily_registrations enable trigger user;
alter table public.trips disable trigger user;
insert into public.trips(id,trip_number,truck_id,driver_id,daily_registration_id,loading_site_id,status,
 opened_at,opened_by,truck_registration_at_loading,driver_name_at_loading,cancelled_at,cancelled_by,cancellation_reason) values
 ('b8160000-0000-0000-0000-000000000001','ASSET-TRIP-001','b8140000-0000-0000-0000-000000000001',
  'b8130000-0000-0000-0000-000000000001','b8150000-0000-0000-0000-000000000001',
  'b8120000-0000-0000-0000-000000000001','open',now(),'b8110000-0000-0000-0000-000000000002','ASSET-001','Historical Actual Driver',null,null,null),
 ('b8160000-0000-0000-0000-000000000002','ASSET-TRIP-002','b8140000-0000-0000-0000-000000000002',
  'b8130000-0000-0000-0000-000000000001','b8150000-0000-0000-0000-000000000002',
  'b8120000-0000-0000-0000-000000000001','cancelled',now()-interval '1 day',
  'b8110000-0000-0000-0000-000000000002','ASSET-002','Historical Actual Driver',now(),
  'b8110000-0000-0000-0000-000000000001','Fixture terminal trip');
alter table public.trips enable trigger user;

set local role authenticated;
select set_config('request.jwt.claim.sub','b8110000-0000-0000-0000-000000000001',true);
select pg_temp.asset_assert(
  (public.get_operations_trucks(1,1)->>'total_count')::integer >= 3
  and jsonb_array_length(public.get_operations_trucks(1,1)->'items')=1
  and (public.get_operations_trucks(1,25,'asset 002')#>>'{items,0,plate}')='ASSET-002'
  and (public.get_operations_drivers(1,25,'08014000001')#>>'{items,0,name}')='Historical Actual Driver'
  and (public.get_operations_drivers(1,25,'historical')#>>'{items,0,name}')='Historical Actual Driver'
  and (public.get_operations_trucks(1,25,null,null,'b8130000-0000-0000-0000-000000000001')->>'total_count')::integer=2,
  'bounded list, normalized search and many-trucks-per-driver');
select pg_temp.asset_assert(
  public.get_operations_driver_detail('b8130000-0000-0000-0000-000000000001')::text !~* 'BANK SECRET|1234567890'
  and public.get_operations_drivers(1,25)::text !~* 'BANK SECRET|1234567890'
  and public.get_operations_truck_detail('b8140000-0000-0000-0000-000000000001')::text !~* 'BANK SECRET|1234567890'
  and (public.get_operations_asset_trips('driver','b8130000-0000-0000-0000-000000000001',1,1)->>'total_count')::integer=2,
  'detail and bounded histories exclude banking');
select pg_temp.asset_expect('select public.get_operations_trucks(0,25)','22023');
select pg_temp.asset_expect('select public.get_operations_drivers(1,101)','22023');
select pg_temp.asset_expect('select public.get_operations_asset_trips(''bank'',''b8130000-0000-0000-0000-000000000001'')','22023');

select pg_temp.asset_expect($q$select public.correct_operations_truck_plate('b8140000-0000-0000-0000-000000000001',
 (select updated_at from public.trucks where id='b8140000-0000-0000-0000-000000000001'),'OPEN-PLATE','identity_correction')$q$,'P4091');
select pg_temp.asset_expect($q$select public.update_operations_driver_master('b8130000-0000-0000-0000-000000000001',
 (select updated_at from public.drivers where id='b8130000-0000-0000-0000-000000000001'),
 'Changed','08014000001',null,null,'record_correction')$q$,'P4091');
select pg_temp.asset_expect($q$select public.set_operations_driver_active('b8130000-0000-0000-0000-000000000001',false,
 (select updated_at from public.drivers where id='b8130000-0000-0000-0000-000000000001'),'deactivate')$q$,'P4091');
select pg_temp.asset_expect($q$select public.set_operations_truck_regular_driver('b8140000-0000-0000-0000-000000000001',
 'b8130000-0000-0000-0000-000000000002',(select updated_at from public.trucks where id='b8140000-0000-0000-0000-000000000001'),
 'regular_driver_change')$q$,'P4091');
select pg_temp.asset_expect($q$select public.set_operations_truck_active('b8140000-0000-0000-0000-000000000001',false,
 (select updated_at from public.trucks where id='b8140000-0000-0000-0000-000000000001'),'deactivate')$q$,'P4091');
select pg_temp.asset_expect($q$select public.update_operations_truck_master('b8140000-0000-0000-0000-000000000001',
 (select updated_at from public.trucks where id='b8140000-0000-0000-0000-000000000001'),
 'Tipper',20,'Owner','Contact','record_correction')$q$,'P4091');
select pg_temp.asset_expect($q$select public.set_operations_truck_regular_driver('b8140000-0000-0000-0000-000000000002',
 'b8130000-0000-0000-0000-000000000002',(select updated_at from public.trucks where id='b8140000-0000-0000-0000-000000000002'),
 'regular_driver_change')$q$,'P4091');
select public.cancel_trip('b8160000-0000-0000-0000-000000000001','Finish open-trip safeguard fixture');

select pg_temp.asset_expect($q$select public.correct_operations_truck_plate('b8140000-0000-0000-0000-000000000002',
 '2020-01-01T00:00:00Z','NEW-PLATE','identity_correction')$q$,'P4090');
select pg_temp.asset_expect($q$select public.correct_operations_truck_plate('b8140000-0000-0000-0000-000000000002',
 (select updated_at from public.trucks where id='b8140000-0000-0000-0000-000000000002'),'ASSET-003','identity_correction')$q$,'23505');
select pg_temp.asset_expect($q$select public.correct_operations_truck_plate('b8140000-0000-0000-0000-000000000002',
 (select updated_at from public.trucks where id='b8140000-0000-0000-0000-000000000002'),'NEW-PLATE','free text')$q$,'22023');
select public.correct_operations_truck_plate('b8140000-0000-0000-0000-000000000002',
 (select updated_at from public.trucks where id='b8140000-0000-0000-0000-000000000002'),'NEW-PLATE','identity_correction');
select pg_temp.asset_assert(
  (select normalized_registration='NEWPLATE' from public.trucks where id='b8140000-0000-0000-0000-000000000002')
  and (select truck_registration_at_loading='ASSET-002' from public.trips where id='b8160000-0000-0000-0000-000000000002')
  and (select count(*)=1 from public.audit_log where entity_name='trucks'
    and entity_id='b8140000-0000-0000-0000-000000000002' and action='UPDATE'
    and actor_id='b8110000-0000-0000-0000-000000000001' and reason='identity_correction'),
  'plate correction is unique, audited and does not rewrite historical trip plate');
select pg_temp.asset_expect($q$select public.set_operations_driver_active('b8130000-0000-0000-0000-000000000001',false,
 (select updated_at from public.drivers where id='b8130000-0000-0000-0000-000000000001'),'deactivate')$q$,'P4092');
select public.set_operations_truck_regular_driver('b8140000-0000-0000-0000-000000000002',
 'b8130000-0000-0000-0000-000000000002',
 (select updated_at from public.trucks where id='b8140000-0000-0000-0000-000000000002'),'regular_driver_change');
select pg_temp.asset_assert(
  (select driver_id='b8130000-0000-0000-0000-000000000002' from public.trucks where id='b8140000-0000-0000-0000-000000000002')
  and (select driver_id='b8130000-0000-0000-0000-000000000001' from public.trips where id='b8160000-0000-0000-0000-000000000002')
  and (select initial_driver_id='b8130000-0000-0000-0000-000000000001' from public.daily_registrations where id='b8150000-0000-0000-0000-000000000002'),
  'regular-driver change affects only future default, not actual historical driver or registration');
select public.update_operations_truck_master('b8140000-0000-0000-0000-000000000003',
 (select updated_at from public.trucks where id='b8140000-0000-0000-0000-000000000003'),
 'Flatbed',18.5,'Fleet Owner','08014000009','vehicle_specification_update');
select pg_temp.asset_assert(
  (select truck_type='Flatbed' and capacity=18.5 and owner_name='Fleet Owner'
    from public.trucks where id='b8140000-0000-0000-0000-000000000003')
  and (select count(*)=1 from public.audit_log where entity_name='trucks'
    and entity_id='b8140000-0000-0000-0000-000000000003' and action='UPDATE'
    and reason='vehicle_specification_update' and actor_id='b8110000-0000-0000-0000-000000000001'),
  'truck master allowlist is audited');
select pg_temp.asset_assert(
  (public.update_operations_truck_master('b8140000-0000-0000-0000-000000000003',
    (select updated_at from public.trucks where id='b8140000-0000-0000-0000-000000000003'),
    'Flatbed',18.5,'Fleet Owner','08014000009','record_correction')->>'outcome')='unchanged'
  and (select count(*)=1 from public.audit_log where entity_name='trucks'
    and entity_id='b8140000-0000-0000-0000-000000000003' and action='UPDATE'),
  'idempotent no-op creates no duplicate audit row');
select pg_temp.asset_expect($q$select public.update_operations_truck_master('b8140000-0000-0000-0000-000000000003',
 '2020-01-01T00:00:00Z','Flatbed',18.5,'Fleet Owner','08014000009','record_correction')$q$,'P4090');
select public.set_operations_truck_active('b8140000-0000-0000-0000-000000000003',false,
 (select updated_at from public.trucks where id='b8140000-0000-0000-0000-000000000003'),'deactivate');
select public.set_operations_truck_active('b8140000-0000-0000-0000-000000000003',true,
 (select updated_at from public.trucks where id='b8140000-0000-0000-0000-000000000003'),'reactivate');
select public.update_operations_driver_master('b8130000-0000-0000-0000-000000000002',
 (select updated_at from public.drivers where id='b8130000-0000-0000-0000-000000000002'),
 'Replacement Driver Updated','08014000004','updated@example.invalid','LIC-UPDATED','contact_update');
select pg_temp.asset_assert(
  (select full_name='Replacement Driver Updated' and normalized_phone='+2348014000004' and license_number='LIC-UPDATED'
    from public.drivers where id='b8130000-0000-0000-0000-000000000002')
  and (select count(*)=1 from public.audit_log where entity_name='drivers'
    and entity_id='b8130000-0000-0000-0000-000000000002' and action='UPDATE'
    and reason='contact_update' and actor_id='b8110000-0000-0000-0000-000000000001'),
  'driver master allowlist and phone normalization are audited');
select pg_temp.asset_expect($q$select public.update_operations_driver_master('b8130000-0000-0000-0000-000000000002',
 (select updated_at from public.drivers where id='b8130000-0000-0000-0000-000000000002'),
 'Replacement Driver Updated','not-a-phone',null,null,'contact_update')$q$,'22023');
select pg_temp.asset_expect($q$select public.update_operations_driver_master('b8130000-0000-0000-0000-000000000002',
 (select updated_at from public.drivers where id='b8130000-0000-0000-0000-000000000002'),
 'Replacement Driver Updated','08014000003',null,null,'contact_update')$q$,'23505');
select public.set_operations_truck_regular_driver('b8140000-0000-0000-0000-000000000001',
 'b8130000-0000-0000-0000-000000000002',
 (select updated_at from public.trucks where id='b8140000-0000-0000-0000-000000000001'),'regular_driver_change');
select public.set_operations_driver_active('b8130000-0000-0000-0000-000000000001',false,
 (select updated_at from public.drivers where id='b8130000-0000-0000-0000-000000000001'),'deactivate');
select pg_temp.asset_assert((select not is_active from public.drivers where id='b8130000-0000-0000-0000-000000000001'),
  'deactivation succeeds only after active Regular Trucks are reassigned');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','b8110000-0000-0000-0000-000000000002',true);
select pg_temp.asset_expect('select public.get_operations_trucks()','42501');
select pg_temp.asset_expect($q$select public.set_operations_truck_active('b8140000-0000-0000-0000-000000000003',false,now(),'deactivate')$q$,'42501');
select set_config('request.jwt.claim.sub','b8110000-0000-0000-0000-000000000003',true);
select pg_temp.asset_expect('select public.get_operations_drivers()','42501');
select set_config('request.jwt.claim.sub','b8110000-0000-0000-0000-000000000004',true);
select pg_temp.asset_expect('select public.get_operations_truck_detail(null)','42501');
select set_config('request.jwt.claim.sub','b8110000-0000-0000-0000-000000000005',true);
select pg_temp.asset_expect('select public.get_operations_asset_trips(''driver'',''b8130000-0000-0000-0000-000000000001'')','42501');
select set_config('request.jwt.claim.sub','b8110000-0000-0000-0000-000000000006',true);
select pg_temp.asset_expect('select public.get_operations_driver_detail(null)','42501');
select set_config('request.jwt.claim.sub','b8110000-0000-0000-0000-000000000007',true);
select pg_temp.asset_expect('select public.get_operations_trucks()','42501');
reset role;
set local role anon;
select pg_temp.asset_expect('select public.get_operations_trucks()','42501');
reset role;

rollback;
