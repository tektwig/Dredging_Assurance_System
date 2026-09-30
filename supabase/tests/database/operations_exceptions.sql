begin;

create function pg_temp.exception_assert(p_ok boolean,p_message text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception 'Exceptions assertion failed: %',p_message; end if; end $$;
create function pg_temp.exception_error(p_sql text,p_state text) returns void language plpgsql as $$
declare v_state text;
begin
  begin execute p_sql; exception when others then
    get stacked diagnostics v_state=returned_sqlstate;
    if v_state=p_state then return; end if;
    raise exception 'Expected %, got %',p_state,v_state;
  end;
  raise exception 'Expected SQLSTATE %',p_state;
end $$;

select pg_temp.exception_assert(
  has_function_privilege('authenticated','public.get_operations_exceptions(integer,integer,text,public.exception_status,public.exception_type,date,date,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.get_operations_exception_detail(uuid,integer)','EXECUTE')
  and has_function_privilege('authenticated','public.start_operations_exception_review(uuid,timestamptz)','EXECUTE')
  and has_function_privilege('authenticated','public.resolve_operations_exception(uuid,timestamptz,text)','EXECUTE')
  and has_function_privilege('authenticated','public.resolve_trip_exception(uuid,text,timestamptz)','EXECUTE')
  and not has_function_privilege('anon','public.get_operations_exception_detail(uuid,integer)','EXECUTE')
  and not has_function_privilege('service_role','public.resolve_operations_exception(uuid,timestamptz,text)','EXECUTE')
  and not has_function_privilege('anon','public.resolve_trip_exception(uuid,text,timestamptz)','EXECUTE'),
  'least-privilege grants');

insert into auth.users(id,email,raw_user_meta_data) values
  ('c9600000-0000-0000-0000-000000000001','exceptions-ops@example.invalid','{}'),
  ('c9600000-0000-0000-0000-000000000002','exceptions-admin@example.invalid','{}'),
  ('c9600000-0000-0000-0000-000000000003','exceptions-loading@example.invalid','{}'),
  ('c9600000-0000-0000-0000-000000000004','exceptions-offloading@example.invalid','{}'),
  ('c9600000-0000-0000-0000-000000000005','exceptions-finance@example.invalid','{}'),
  ('c9600000-0000-0000-0000-000000000006','exceptions-audit@example.invalid','{}'),
  ('c9600000-0000-0000-0000-000000000007','exceptions-inactive@example.invalid','{}');
update public.profiles set role=case right(id::text,1)
  when '1' then 'operations_manager'::public.app_role
  when '2' then 'system_administrator'::public.app_role
  when '3' then 'loading_officer'::public.app_role
  when '4' then 'offloading_officer'::public.app_role
  when '5' then 'finance_officer'::public.app_role
  when '6' then 'audit_reviewer'::public.app_role
  else 'operations_manager'::public.app_role end,
  is_active=right(id::text,1)<>'7',display_name='Exception Officer '||right(id::text,1)
where id::text like 'c9600000-%';
insert into public.drivers(id,full_name,phone_number) values
  ('c9610000-0000-0000-0000-000000000001','Exception Driver','08019990001');
insert into public.trucks(id,registration_number,driver_id) values
  ('c9620000-0000-0000-0000-000000000001','EXC-001','c9610000-0000-0000-0000-000000000001');
insert into public.sites(id,name,site_type) values
  ('c9650000-0000-0000-0000-000000000001','Exception Loading','loading'),
  ('c9650000-0000-0000-0000-000000000002','Exception Offloading','offloading');
alter table public.daily_registrations disable trigger user;
insert into public.daily_registrations(id,truck_id,initial_driver_id,operational_date,registered_at,registered_by)
values('c9660000-0000-0000-0000-000000000001','c9620000-0000-0000-0000-000000000001',
  'c9610000-0000-0000-0000-000000000001',
  (statement_timestamp() at time zone 'Africa/Lagos')::date,statement_timestamp(),
  'c9600000-0000-0000-0000-000000000003');
alter table public.daily_registrations enable trigger user;
alter table public.trips disable trigger user;
insert into public.trips(id,trip_number,truck_id,driver_id,daily_registration_id,loading_site_id,
  offloading_site_id,status,quantity_tonnes,opened_at,opened_by,closed_at,closed_by,
  truck_registration_at_loading,driver_name_at_loading)
values('c9640000-0000-0000-0000-000000000001','EXC-TRIP-001',
  'c9620000-0000-0000-0000-000000000001','c9610000-0000-0000-0000-000000000001',
  'c9660000-0000-0000-0000-000000000001','c9650000-0000-0000-0000-000000000001',
  'c9650000-0000-0000-0000-000000000002','closed',12.50,
  statement_timestamp()-interval '1 hour','c9600000-0000-0000-0000-000000000003',
  statement_timestamp(),'c9600000-0000-0000-0000-000000000004','EXC-001','Actual Exception Driver');
alter table public.trips enable trigger user;
select set_config('test.trip_version',(select updated_at::text from public.trips
  where id='c9640000-0000-0000-0000-000000000001'),true);
select set_config('test.truck_version',(select updated_at::text from public.trucks
  where id='c9620000-0000-0000-0000-000000000001'),true);
select set_config('test.waybill_count',(select count(*)::text from public.trip_closure_invoices),true);
select set_config('test.document_count',(select count(*)::text from public.trip_closure_invoice_documents),true);
select set_config('test.payment_count',(select count(*)::text from public.trip_payments),true);

set local role authenticated;
select set_config('request.jwt.claim.sub','c9600000-0000-0000-0000-000000000001',true);
select set_config('test.attention_count',(public.get_operations_dashboard_summary()->>'exceptions_requiring_attention'),true);
select set_config('test.exception_id',public.raise_trip_exception('dispute','HISTORICAL-NOTE-SECRET-BANK-999',
  null,'c9640000-0000-0000-0000-000000000001',null,true)::text,true);
select pg_temp.exception_assert((public.get_operations_dashboard_summary()->>'exceptions_requiring_attention')::integer
  =current_setting('test.attention_count')::integer+1,'open adds one dashboard attention item');
select set_config('test.exception_version',(select updated_at::text from public.exceptions
  where id=current_setting('test.exception_id')::uuid),true);
reset role;
select pg_temp.exception_assert(private.loading_truck_block('c9620000-0000-0000-0000-000000000001')->>'code'='BLOCKING_EXCEPTION',
  'open blocking issue stops Loading');
set local role authenticated;
select pg_temp.exception_assert((public.get_operations_exceptions(1,25,null,'open',null,null,null,null,
  'c9620000-0000-0000-0000-000000000001')->>'total_count')::integer=1,'bounded register truck filter');
select pg_temp.exception_assert((public.get_operations_exceptions(1,25,null,'open',null,null,null,
  'c9640000-0000-0000-0000-000000000001',null)->>'total_count')::integer=1,'trip filter');
select pg_temp.exception_assert((public.get_operations_exceptions(1,25,'EXC-001',null,'dispute',null,null,null,null)->>'total_count')::integer>=1,
  'server-side plate and type search');
select pg_temp.exception_assert((public.get_operations_exceptions(1,25,null,'open',null,
  (statement_timestamp() at time zone 'Africa/Lagos')::date,
  (statement_timestamp() at time zone 'Africa/Lagos')::date,null,
  'c9620000-0000-0000-0000-000000000001')->>'total_count')::integer=1,'Lagos inclusive date');
select pg_temp.exception_assert(position('HISTORICAL-NOTE-SECRET' in
  public.get_operations_exception_detail(current_setting('test.exception_id')::uuid,20)::text)=0,
  'detail withholds uncontrolled historical text');
select pg_temp.exception_assert(position('HISTORICAL-NOTE-SECRET' in
  public.get_operations_exceptions(1,25,null,null,null,null,null,null,
    'c9620000-0000-0000-0000-000000000001')::text)=0,
  'register withholds uncontrolled historical text');
select pg_temp.exception_error(format('update public.exceptions set status=''resolved'',resolution_reason=''no_action_required'' where id=%L',
  current_setting('test.exception_id')::uuid),'42501');
reset role;
select pg_temp.exception_error(format('update public.exceptions set status=''resolved'',resolution_reason=''no_action_required'' where id=%L',
  current_setting('test.exception_id')::uuid),'23514');
set local role authenticated;
select pg_temp.exception_assert((public.start_operations_exception_review(current_setting('test.exception_id')::uuid,
  current_setting('test.exception_version')::timestamptz)->>'status')='in_review','review transition');
reset role;
select pg_temp.exception_assert(private.loading_truck_block('c9620000-0000-0000-0000-000000000001')->>'code'='BLOCKING_EXCEPTION',
  'in-review blocking issue still stops Loading');
set local role authenticated;
select pg_temp.exception_assert((public.get_operations_dashboard_summary()->>'exceptions_requiring_attention')::integer
  =current_setting('test.attention_count')::integer+1,'in_review remains one attention item');
select pg_temp.exception_assert((public.get_operations_exceptions(1,25,null,'in_review',null,null,null,null,
  'c9620000-0000-0000-0000-000000000001')->>'total_count')::integer=1,'review filter');
select pg_temp.exception_assert(public.start_operations_exception_review(current_setting('test.exception_id')::uuid,
  current_setting('test.exception_version')::timestamptz)->>'code'='STALE_EXCEPTION','stale review rejected');
select pg_temp.exception_assert(public.resolve_operations_exception(current_setting('test.exception_id')::uuid,
  current_setting('test.exception_version')::timestamptz,'no_action_required')->>'code'='STALE_EXCEPTION',
  'stale resolution rejected');
select pg_temp.exception_assert((select count(*)=2 from public.audit_log where entity_name='exceptions'
  and entity_id=current_setting('test.exception_id')::uuid),'stale requests do not audit');
select pg_temp.exception_error(format('select public.resolve_operations_exception(%L,%L,''CUSTOM_FREE_TEXT'')',
  current_setting('test.exception_id')::uuid,
  (select updated_at from public.exceptions where id=current_setting('test.exception_id')::uuid)),'22023');
select pg_temp.exception_assert((public.resolve_operations_exception(current_setting('test.exception_id')::uuid,
  (select updated_at from public.exceptions where id=current_setting('test.exception_id')::uuid),
  'referred_for_correction')->>'status')='resolved','approved resolution transition');
reset role;
select pg_temp.exception_assert(private.loading_truck_block('c9620000-0000-0000-0000-000000000001') is null,
  'resolved blocker clears');
set local role authenticated;
select pg_temp.exception_assert(public.resolve_operations_exception(current_setting('test.exception_id')::uuid,
  (select updated_at from public.exceptions where id=current_setting('test.exception_id')::uuid),
  'no_action_required')->>'code'='INVALID_TRANSITION','repeat resolution rejected');
select pg_temp.exception_assert((select count(*)=3 from public.audit_log where entity_name='exceptions'
  and entity_id=current_setting('test.exception_id')::uuid),'one audit event per transition');
select pg_temp.exception_assert((public.get_operations_dashboard_summary()->>'exceptions_requiring_attention')::integer
  =current_setting('test.attention_count')::integer,'resolved leaves dashboard attention');
select pg_temp.exception_assert(position('HISTORICAL-NOTE-SECRET' in
  public.get_operations_exception_detail(current_setting('test.exception_id')::uuid,20)::text)=0
  and position('old_value' in public.get_operations_exception_detail(current_setting('test.exception_id')::uuid,20)::text)=0
  and position('resolution_reason' in public.get_operations_exception_detail(current_setting('test.exception_id')::uuid,20)::text)=0,
  'safe bounded history excludes raw audit JSON and reasons');
select pg_temp.exception_assert(jsonb_array_length(public.get_operations_exception_detail(
  current_setting('test.exception_id')::uuid,2)->'history')=2,'history bounded');
select pg_temp.exception_error('select public.get_operations_exceptions(1,101)','22023');
select pg_temp.exception_error(format('select public.get_operations_exception_detail(%L,51)',
  current_setting('test.exception_id')::uuid),'22023');
reset role;
select pg_temp.exception_error(format('delete from public.exceptions where id=%L',
  current_setting('test.exception_id')::uuid),'23514');
select pg_temp.exception_error(format('update public.exceptions set status=''open'' where id=%L',
  current_setting('test.exception_id')::uuid),'23514');
set local role authenticated;
select pg_temp.exception_assert((select status='closed' and updated_at=current_setting('test.trip_version')::timestamptz
    from public.trips where id='c9640000-0000-0000-0000-000000000001'),
  'resolution does not mutate related trip');
select pg_temp.exception_assert((select registration_number='EXC-001' and updated_at=current_setting('test.truck_version')::timestamptz
    from public.trucks where id='c9620000-0000-0000-0000-000000000001'),
  'resolution does not mutate truck master');
reset role;
select pg_temp.exception_assert((select count(*) from public.trip_closure_invoices)=current_setting('test.waybill_count')::integer
  and (select count(*) from public.trip_closure_invoice_documents)=current_setting('test.document_count')::integer
  and (select count(*) from public.trip_payments)=current_setting('test.payment_count')::integer,
  'resolution does not mutate Waybills, PDFs or payouts');
set local role authenticated;

select set_config('request.jwt.claim.sub','c9600000-0000-0000-0000-000000000002',true);
select pg_temp.exception_error(format('select public.resolve_trip_exception(%L,''no_action_required'')',
  current_setting('test.exception_id')::uuid),'22023');
select pg_temp.exception_error('select public.get_operations_exception_detail(gen_random_uuid(),20)','42501');
select set_config('request.jwt.claim.sub','c9600000-0000-0000-0000-000000000001',true);
select set_config('test.admin_exception',public.raise_trip_exception('invalid_state','ADMIN-COMPAT-SECRET',
  'c9620000-0000-0000-0000-000000000001',null,null,false)::text,true);
select pg_temp.exception_error(format('select public.resolve_trip_exception(%L,''no_action_required'',clock_timestamp())',
  current_setting('test.admin_exception')::uuid),'42501');
select set_config('request.jwt.claim.sub','c9600000-0000-0000-0000-000000000002',true);
select pg_temp.exception_error(format('select public.resolve_trip_exception(%L,''no_action_required'')',
  current_setting('test.admin_exception')::uuid),'22023');
select pg_temp.exception_assert(public.resolve_trip_exception(current_setting('test.admin_exception')::uuid,
  'no_action_required',(select updated_at from public.exceptions
    where id=current_setting('test.admin_exception')::uuid))->>'code'='INVALID_TRANSITION',
  'Admin cannot resolve open exception with versioned API');
select set_config('request.jwt.claim.sub','c9600000-0000-0000-0000-000000000001',true);
select public.start_operations_exception_review(current_setting('test.admin_exception')::uuid,
  (select updated_at from public.exceptions where id=current_setting('test.admin_exception')::uuid));
select set_config('request.jwt.claim.sub','c9600000-0000-0000-0000-000000000002',true);
select pg_temp.exception_assert(public.resolve_trip_exception(current_setting('test.admin_exception')::uuid,
  'no_action_required',current_setting('test.exception_version')::timestamptz)->>'code'='STALE_EXCEPTION',
  'Admin stale version rejected');
select public.resolve_trip_exception(current_setting('test.admin_exception')::uuid,'no_action_required',
  (select updated_at from public.exceptions where id=current_setting('test.admin_exception')::uuid));
select pg_temp.exception_assert((select status='resolved' and resolved_by=auth.uid() from public.exceptions
  where id=current_setting('test.admin_exception')::uuid),'Admin retains reviewed-resolution capability');
select set_config('request.jwt.claim.sub','c9600000-0000-0000-0000-000000000003',true);
select pg_temp.exception_error('select public.get_operations_exceptions()','42501');
select pg_temp.exception_error('select public.start_operations_exception_review(gen_random_uuid(),clock_timestamp())','42501');
select pg_temp.exception_assert((select count(*) from public.exceptions where id=current_setting('test.exception_id')::uuid)=0,
  'Loading cannot directly read exception rows');
select set_config('request.jwt.claim.sub','c9600000-0000-0000-0000-000000000004',true);
select pg_temp.exception_error('select public.get_operations_exception_detail(gen_random_uuid(),20)','42501');
select set_config('request.jwt.claim.sub','c9600000-0000-0000-0000-000000000005',true);
select pg_temp.exception_error('select public.get_operations_exceptions()','42501');
select set_config('request.jwt.claim.sub','c9600000-0000-0000-0000-000000000006',true);
select pg_temp.exception_error('select public.resolve_operations_exception(gen_random_uuid(),clock_timestamp(),''no_action_required'')','42501');
select set_config('request.jwt.claim.sub','c9600000-0000-0000-0000-000000000007',true);
select pg_temp.exception_error('select public.get_operations_exceptions()','42501');
reset role;
set local role anon;
select pg_temp.exception_error('select public.get_operations_exceptions()','42501');
reset role;

alter table public.exceptions disable trigger user;
insert into public.exceptions(id,truck_id,exception_type,description,blocks_operations,status,
  reported_by,resolved_at,resolved_by,resolution_reason)
values('c9630000-0000-0000-0000-000000000001','c9620000-0000-0000-0000-000000000001',
  'dispute','LEGACY-SECRET-DESCRIPTION',false,'resolved',
  'c9600000-0000-0000-0000-000000000002',clock_timestamp(),
  'c9600000-0000-0000-0000-000000000002','LEGACY-SECRET-RESOLUTION');
alter table public.exceptions enable trigger user;
set local role authenticated;
select set_config('request.jwt.claim.sub','c9600000-0000-0000-0000-000000000001',true);
select pg_temp.exception_assert((select review_started_at is null and status='resolved' from public.exceptions
  where id='c9630000-0000-0000-0000-000000000001')
  and position('LEGACY-SECRET' in public.get_operations_exception_detail(
    'c9630000-0000-0000-0000-000000000001',20)::text)=0,'legacy resolved record remains valid and safe');
select pg_temp.exception_error('select public.resolve_trip_exception(''c9630000-0000-0000-0000-000000000001'',''no_action_required'')','42501');
rollback;
