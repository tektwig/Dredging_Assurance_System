-- Disposable PostgreSQL/Supabase-compatible database only. All writes roll back.
begin;

create function pg_temp.assert_true(p_value boolean,p_message text) returns void language plpgsql as $$
begin
  if p_value is distinct from true then raise exception 'Bank-capture assertion failed: %',p_message; end if;
  raise notice 'ASSERTION PASS: %',p_message;
end;
$$;
create function pg_temp.assert_code(p_value jsonb,p_code text) returns void language plpgsql as $$
begin
  perform pg_temp.assert_true(p_value->>'ok'='false' and p_value->>'code'=p_code,
    'expected business code '||p_code);
end;
$$;
create function pg_temp.expect_sqlstate(p_query text,p_expected text) returns void language plpgsql as $$
begin
  begin
    execute p_query;
  exception when others then
    if sqlstate=p_expected then
      raise notice 'ASSERTION PASS: expected SQLSTATE %',p_expected;
      return;
    end if;
    raise exception 'Expected SQLSTATE %, got %',p_expected,sqlstate;
  end;
  raise exception 'Expected SQLSTATE %',p_expected;
end;
$$;
create temp table bank_test_state(key text primary key,value jsonb);
grant all on bank_test_state to authenticated;
create function pg_temp.registration_side_effect_counts() returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object(
    'drivers',(select count(*) from public.drivers),
    'trucks',(select count(*) from public.trucks),
    'bank_captures',(select count(*) from private.loading_registration_bank_captures),
    'receipts',(select count(*) from private.loading_request_receipts),
    'audit',(select count(*) from public.audit_log)
  );
$$;

insert into auth.users(id,email,raw_user_meta_data) values
  ('d0000000-0000-0000-0000-000000000001','bank-capture-admin@example.invalid','{}'),
  ('d0000000-0000-0000-0000-000000000002','bank-capture-loading@example.invalid','{}'),
  ('d0000000-0000-0000-0000-000000000003','bank-capture-operations@example.invalid','{}'),
  ('d0000000-0000-0000-0000-000000000004','bank-capture-finance@example.invalid','{}'),
  ('d0000000-0000-0000-0000-000000000005','bank-capture-unassigned@example.invalid','{}');
update public.profiles set role=case right(id::text,1)
    when '1' then 'system_administrator'::public.app_role
    when '2' then 'loading_officer'::public.app_role
    when '3' then 'operations_manager'::public.app_role
    when '5' then 'loading_officer'::public.app_role
    else 'finance_officer'::public.app_role end,
  is_active=true
where id::text like 'd0000000-%';
insert into public.sites(id,name,site_type) values
  ('d1000000-0000-0000-0000-000000000001','Bank Capture Loading Site','loading'),
  ('d1000000-0000-0000-0000-000000000002','Bank Capture Offloading Site','offloading');

select set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select pg_temp.assert_true((public.assign_user_site(
  'd0000000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000001'
)->>'ok')::boolean,'administrator assigns Loading Officer to loading site');
reset role;

insert into auth.sessions(id,user_id,created_at) values
  ('d2000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000002',statement_timestamp()),
  ('d2000000-0000-0000-0000-000000000006','d0000000-0000-0000-0000-000000000002',
    (((statement_timestamp() at time zone 'Africa/Lagos')::date-1)::timestamp+interval '12 hours') at time zone 'Africa/Lagos'),
  ('d2000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000005',statement_timestamp());
select set_config('test.loading_assignment',(
  select id::text from public.user_site_assignments
  where profile_id='d0000000-0000-0000-0000-000000000002' and ended_at is null
),true);
select set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','d0000000-0000-0000-0000-000000000002',
  'session_id','d2000000-0000-0000-0000-000000000002',
  'iat',extract(epoch from statement_timestamp())::bigint
)::text,true);
set local role authenticated;

select pg_temp.assert_true(has_function_privilege('authenticated',
  'public.register_loading_participant_v4(uuid,text,uuid,uuid,text,text,text,text,text,text,numeric,text,text,text,text)','EXECUTE'),
  'authenticated can call the versioned registration RPC');
select pg_temp.assert_true(not has_function_privilege('anon',
  'public.register_loading_participant_v4(uuid,text,uuid,uuid,text,text,text,text,text,text,numeric,text,text,text,text)','EXECUTE')
  and not has_function_privilege('service_role',
  'public.register_loading_participant_v4(uuid,text,uuid,uuid,text,text,text,text,text,text,numeric,text,text,text,text)','EXECUTE'),
  'anonymous and service roles cannot call registration RPC');
select pg_temp.assert_true(not has_function_privilege('authenticated',
  'public.register_loading_participant_v3(uuid,text,uuid,uuid,text,text,text,numeric,text,text,text,text)','EXECUTE'),
  'direct v3 registration is retired after the v4 cutover');
select pg_temp.assert_true(not has_table_privilege('authenticated',
  'private.loading_registration_bank_captures','SELECT')
  and not has_table_privilege('anon','private.loading_registration_bank_captures','SELECT')
  and not has_table_privilege('service_role','private.loading_registration_bank_captures','SELECT'),
  'bank captures have no direct API-role table access');
select pg_temp.assert_true(exists (
  select 1
  from pg_proc v4, pg_proc v3
  where v4.oid='public.register_loading_participant_v4(uuid,text,uuid,uuid,text,text,text,text,text,text,numeric,text,text,text,text)'::regprocedure
    and v3.oid='public.register_loading_participant_v3(uuid,text,uuid,uuid,text,text,text,numeric,text,text,text,text)'::regprocedure
    and v4.prosecdef
    and has_function_privilege(v4.proowner,v3.oid,'EXECUTE')
), 'the v4 SECURITY DEFINER owner retains EXECUTE on nested v3');
select pg_temp.assert_true(exists (
  select 1 from pg_constraint constraint_row
  where constraint_row.conrelid='private.loading_request_receipts'::regclass
    and constraint_row.conname='loading_request_receipts_operation_check'
    and constraint_row.contype='c'
    and pg_get_constraintdef(constraint_row.oid) like '%register_loading_participant%'
    and pg_get_constraintdef(constraint_row.oid) like '%create_loading_trip_v2%'
    and pg_get_constraintdef(constraint_row.oid) like '%register_loading_participant_payment_free_v3%'
), 'receipt constraint preserves both historical operations and accepts payment-free v3 replay');

select set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-000000000003',true);
select set_config('request.jwt.claims',jsonb_build_object('sub','d0000000-0000-0000-0000-000000000003')::text,true);
select pg_temp.expect_sqlstate($q$select public.register_loading_participant_v4(
  'd3000000-0000-0000-0000-000000000008','BANKUNAUTH1',null,null,'Unauthorized Bank Driver','08020000008',null,
  'Test Bank','1234567894','Unauthorized Bank Driver')$q$,'42501');
select set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-000000000004',true);
select set_config('request.jwt.claims',jsonb_build_object('sub','d0000000-0000-0000-0000-000000000004')::text,true);
select pg_temp.expect_sqlstate($q$select public.register_loading_participant_v4(
  'd3000000-0000-0000-0000-000000000009','BANKUNAUTH2',null,null,'Unauthorized Bank Driver Two','08020000009',null,
  'Test Bank','1234567895','Unauthorized Bank Driver Two')$q$,'42501');
select set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-000000000005',true);
select set_config('request.jwt.claims',jsonb_build_object('sub','d0000000-0000-0000-0000-000000000005',
  'session_id','d2000000-0000-0000-0000-000000000005',
  'iat',extract(epoch from statement_timestamp())::bigint)::text,true);
select pg_temp.assert_code(public.register_loading_participant_v4(
  'd3000000-0000-0000-0000-000000000010','BANKNOSITE1',null,null,'Unassigned Bank Driver','08020000010',null,
  'Test Bank','1234567896','Unassigned Bank Driver'
),'SITE_ASSIGNMENT_REQUIRED');
select set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims',jsonb_build_object('sub','d0000000-0000-0000-0000-000000000002',
  'session_id','d2000000-0000-0000-0000-000000000002',
  'iat',extract(epoch from statement_timestamp())::bigint)::text,true);
reset role;
select pg_temp.assert_true(not exists (select 1 from public.drivers
  where phone_number in ('08020000008','08020000009','08020000010'))
  and not exists (select 1 from private.loading_registration_bank_captures
    where registration_request_id in (
      'd3000000-0000-0000-0000-000000000008',
      'd3000000-0000-0000-0000-000000000009',
      'd3000000-0000-0000-0000-000000000010'
    )),
  'unauthorized and unassigned registration attempts create no records');
set local role authenticated;

insert into bank_test_state values('before_stale_session',pg_temp.registration_side_effect_counts());
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','d0000000-0000-0000-0000-000000000002',
  'session_id','d2000000-0000-0000-0000-000000000006',
  'iat',extract(epoch from statement_timestamp())::bigint
)::text,true);
select pg_temp.expect_sqlstate($q$select public.register_loading_participant_v4(
  'd3000000-0000-0000-0000-000000000006','BANKSTALE1',null,null,'Stale Session Driver','08020000006',null,
  'Test Bank','1234567897','Stale Session Driver')$q$,'42501');
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','d0000000-0000-0000-0000-000000000002',
  'session_id','d2000000-0000-0000-0000-000000000002',
  'iat',extract(epoch from statement_timestamp())::bigint
)::text,true);
select pg_temp.assert_true(pg_temp.registration_side_effect_counts()=
  (select value from bank_test_state where key='before_stale_session'),
  'expired field session rejects v4 without registration side effects');
insert into bank_test_state values('before_invalid',pg_temp.registration_side_effect_counts());
select pg_temp.assert_code(public.register_loading_participant_v4(
  'd3000000-0000-0000-0000-000000000001','BANKBAD1',null,null,'Invalid Bank Driver','08020000001',null,
  'Test Bank','123456789','Invalid Bank Driver'
),'INVALID_ACCOUNT_NUMBER');
select pg_temp.assert_code(public.register_loading_participant_v4(
  'd3000000-0000-0000-0000-000000000002','BANKBAD2',null,null,'Invalid Bank Driver Two','08020000002',null,
  ' ','1234567890','Invalid Bank Driver Two'
),'INVALID_BANK_NAME');
select pg_temp.assert_true(pg_temp.registration_side_effect_counts()=
  (select value from bank_test_state where key='before_invalid'),
  'invalid required bank data creates no driver, truck, receipt or audit event');

insert into bank_test_state values('registration',public.register_loading_participant_v4(
  'd3000000-0000-0000-0000-000000000003','BANKCAPTURE1',null,null,'Synthetic Bank Driver','08020000003',null,
  'Test Bank','1234567890','Synthetic Bank Driver'
));
select pg_temp.assert_true((select value->>'ok'='true'
  and value::text !~ 'Test Bank|1234567890'
  and value::text !~* '"[^"]*(bank.?name|bank.?account|bank.?details|bank.?data|bank.?info|bank.?capture|banking|account.?number|account.?no|account.?name|account.?holder|payment.?details|registration.?bank)[^"]*"[[:space:]]*:'
  from bank_test_state where key='registration'),
  'successful registration response excludes all banking values');
reset role;
select pg_temp.assert_true(exists (
  select 1 from private.loading_request_receipts
  where actor_id='d0000000-0000-0000-0000-000000000002'
    and operation='register_loading_participant_payment_free_v3'
    and request_id='d3000000-0000-0000-0000-000000000003'
), 'v4 successfully executes v3 and stores its payment-free idempotency receipt');
set local role authenticated;
insert into bank_test_state values('before_duplicate',pg_temp.registration_side_effect_counts());
select pg_temp.assert_code(public.register_loading_participant_v4(
  'd3000000-0000-0000-0000-000000000007','BANKDUPLICATE1',null,null,'Possible Duplicate Driver','08020000003',null,
  'Test Bank','1234567893','Possible Duplicate Driver'
),'DRIVER_MATCH_REQUIRES_REVIEW');
reset role;
select pg_temp.assert_true(pg_temp.registration_side_effect_counts()=
  (select value from bank_test_state where key='before_duplicate')
  and not exists (select 1 from private.loading_registration_bank_captures
    where registration_request_id='d3000000-0000-0000-0000-000000000007'),
  'existing duplicate-phone protection prevents a second registration and bank capture');
set local role authenticated;

-- Same request and payload replays without a second capture or audit entry.
insert into bank_test_state values('before_replay',pg_temp.registration_side_effect_counts());
select pg_temp.assert_true(public.register_loading_participant_v4(
  'd3000000-0000-0000-0000-000000000003','IGNORED-REPLAY',null,null,'Synthetic Bank Driver','08020000003',null,
  'Test Bank','1234567890','Synthetic Bank Driver'
)=(select value from bank_test_state where key='registration'),'same request returns the original safe response');
reset role;
select pg_temp.assert_true((select count(*)=1 from private.loading_registration_bank_captures
  where registration_request_id='d3000000-0000-0000-0000-000000000003'),
  'same request creates exactly one private capture');
set local role authenticated;
select pg_temp.assert_code(public.register_loading_participant_v4(
  'd3000000-0000-0000-0000-000000000003','BANKCAPTURE1',null,null,'Synthetic Bank Driver','08020000003',null,
  'Different Bank','1234567890','Synthetic Bank Driver'
),'REQUEST_PAYLOAD_CONFLICT');
insert into bank_test_state values('existing_driver_mode',public.register_loading_participant_v4(
  'd3000000-0000-0000-0000-000000000005','BANKEXISTING1',null,
  ((select value#>>'{driver,id}' from bank_test_state where key='registration')::uuid),
  null,null,null,null,null,null
));
reset role;
select pg_temp.assert_true((select value->>'ok'='true' and value#>>'{driver,created}'='false'
  from bank_test_state where key='existing_driver_mode')
  and (select count(*)=1 from private.loading_registration_bank_captures
    where driver_id=((select value#>>'{driver,id}' from bank_test_state where key='registration')::uuid)),
  'new truck with existing driver remains available and creates no second bank capture');
reset role;
insert into private.loading_request_receipts(actor_id,operation,request_id,response)
values ('d0000000-0000-0000-0000-000000000002','register_loading_participant_payment_free_v3',
  'd3000000-0000-0000-0000-000000000006',
  jsonb_build_object('ok',true,'request_id','d3000000-0000-0000-0000-000000000006'));
set local role authenticated;
select set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-000000000002',true);
select pg_temp.assert_code(public.register_loading_participant_v4(
  'd3000000-0000-0000-0000-000000000006','BANKSTALE1',null,null,'Stale Receipt Driver','08020000006',null,
  'Test Bank','1234567892','Stale Receipt Driver'
),'REQUEST_PAYLOAD_CONFLICT');
reset role;
select pg_temp.assert_true(not exists (select 1 from private.loading_registration_bank_captures
    where registration_request_id='d3000000-0000-0000-0000-000000000006')
  and not exists (select 1 from public.drivers where full_name='Stale Receipt Driver'),
  'legacy v3 replay receipt cannot be reused to add a bank capture');
select pg_temp.assert_true((select count(*)=1 and min(bank_name)='Test Bank'
  from private.loading_registration_bank_captures
  where registration_request_id='d3000000-0000-0000-0000-000000000003'),
  'replay conflict cannot overwrite the immutable captured values');
select pg_temp.expect_sqlstate($q$update private.loading_registration_bank_captures
  set bank_name='Changed Bank' where registration_request_id='d3000000-0000-0000-0000-000000000003'$q$,'23514');
select pg_temp.expect_sqlstate($q$delete from private.loading_registration_bank_captures
  where registration_request_id='d3000000-0000-0000-0000-000000000003'$q$,'23514');
select pg_temp.assert_true(not exists (
  select 1 from public.audit_log
  where entity_name='loading_registration'
    and (new_value::text ~ 'Test Bank|1234567890'
      or new_value::text ~* '"[^"]*(bank.?name|bank.?account|bank.?details|bank.?data|bank.?info|bank.?capture|banking|account.?number|account.?no|account.?name|account.?holder|payment.?details|registration.?bank)[^"]*"[[:space:]]*:')
),'registration audit metadata contains no banking values');

-- A capture-table failure must roll back the earlier v3 driver/truck/audit/receipt work.
create function pg_temp.fail_registration_bank_capture() returns trigger language plpgsql as $$
begin
  if new.registration_request_id='d3000000-0000-0000-0000-000000000004'::uuid then
    raise exception 'synthetic bank-capture insert failure' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger test_fail_registration_bank_capture
before insert on private.loading_registration_bank_captures
for each row execute function pg_temp.fail_registration_bank_capture();
insert into bank_test_state values('before_atomic_failure',pg_temp.registration_side_effect_counts());
do $$
begin
  begin
    perform public.register_loading_participant_v4(
      'd3000000-0000-0000-0000-000000000004','BANKROLLBACK1',null,null,'Rollback Bank Driver','08020000004',null,
      'Test Bank','1234567891','Rollback Bank Driver'
    );
    raise exception 'expected synthetic bank-capture failure';
  exception when check_violation then
    raise notice 'ASSERTION PASS: injected bank-capture failure was raised';
    null;
  end;
end;
$$;
drop trigger test_fail_registration_bank_capture on private.loading_registration_bank_captures;
select pg_temp.assert_true(pg_temp.registration_side_effect_counts()=
  (select value from bank_test_state where key='before_atomic_failure'),
  'capture failure rolls back registration, audit and request receipt');
select pg_temp.assert_true(not exists (select 1 from public.drivers where phone_number='08020000004')
  and not exists (select 1 from public.trucks where normalized_registration='BANKROLLBACK1')
  and not exists (select 1 from private.loading_request_receipts
    where request_id='d3000000-0000-0000-0000-000000000004'),
  'atomic failure leaves no partial driver, truck or replay receipt');

-- A new synthetic closed Waybill proves only Operations Managers can review a capture.
do $$
declare
  v_driver uuid:=(select (value#>>'{driver,id}')::uuid from bank_test_state where key='registration');
  v_truck uuid:=(select (value#>>'{truck,id}')::uuid from bank_test_state where key='registration');
  v_assignment uuid:=current_setting('test.loading_assignment')::uuid;
  v_loading_officer uuid:='d0000000-0000-0000-0000-000000000002';
  v_offloading_officer uuid:='d0000000-0000-0000-0000-000000000003';
  v_opened timestamptz:=statement_timestamp()-interval '2 hours';
  v_closed timestamptz:=statement_timestamp()-interval '1 hour';
begin
  alter table public.daily_registrations disable trigger user;
  insert into public.daily_registrations(id,truck_id,initial_driver_id,operational_date,registered_at,registered_by)
  values ('d4000000-0000-0000-0000-000000000001',v_truck,v_driver,
    (statement_timestamp() at time zone 'Africa/Lagos')::date,
    statement_timestamp(),'d0000000-0000-0000-0000-000000000002');
  alter table public.daily_registrations enable trigger user;

  alter table public.trips disable trigger user;
  insert into public.trips(
    id,trip_number,truck_id,driver_id,daily_registration_id,loading_site_id,offloading_site_id,
    status,quantity_tonnes,opened_at,opened_by,closed_at,closed_by,
    truck_registration_at_loading,truck_type_at_loading,truck_capacity_at_loading,truck_owner_at_loading,
    driver_phone_at_loading,driver_license_at_loading,driver_name_at_loading,loading_assignment_id
  ) values (
    'd5000000-0000-0000-0000-000000000001','BANK-CAPTURE-TRIP-1',v_truck,v_driver,
    'd4000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000002','closed',12,v_opened,
    'd0000000-0000-0000-0000-000000000002',v_closed,'d0000000-0000-0000-0000-000000000001',
    'BANKCAPTURE1','Registered tipper truck',30,'Not provided','08020000003',null,
    'Synthetic Bank Driver',v_assignment
  );
  alter table public.trips enable trigger user;

  insert into public.trip_closure_invoices(
    id,invoice_number,trip_id,trip_number,truck_id,truck_registration,truck_type,
    truck_capacity_tonnes,truck_owner_name,driver_id,driver_name,driver_phone,driver_license,
    loading_site_id,loading_site_name,offloading_site_id,offloading_site_name,
    loading_officer_id,loading_officer_name,offloading_officer_id,offloading_officer_name,
    quantity_tonnes,opened_at,closed_at,issued_at
  ) values (
    'd6000000-0000-0000-0000-000000000001','WB-2099-999999999','d5000000-0000-0000-0000-000000000001',
    'BANK-CAPTURE-TRIP-1',v_truck,'BANKCAPTURE1','Registered tipper truck',30,'Not provided',
    v_driver,'Synthetic Bank Driver','08020000003',null,'d1000000-0000-0000-0000-000000000001',
    'Bank Capture Loading Site','d1000000-0000-0000-0000-000000000002',
    'Bank Capture Offloading Site',v_loading_officer,'Synthetic Loading Officer',
    v_offloading_officer,'Synthetic Operations Manager',12,v_opened,v_closed,v_closed
  );
end;
$$;

select set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select pg_temp.expect_sqlstate($q$select * from public.get_operations_waybill_registration_bank_capture(
  'd6000000-0000-0000-0000-000000000001')$q$,'42501');

select set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-000000000004',true);
select pg_temp.expect_sqlstate($q$select * from public.get_operations_waybill_registration_bank_capture(
  'd6000000-0000-0000-0000-000000000001')$q$,'42501');
select set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-000000000001',true);
select pg_temp.expect_sqlstate($q$select * from public.get_operations_waybill_registration_bank_capture(
  'd6000000-0000-0000-0000-000000000001')$q$,'42501');

select set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-000000000003',true);
insert into bank_test_state
select 'manager_capture',to_jsonb(capture)
from public.get_operations_waybill_registration_bank_capture('d6000000-0000-0000-0000-000000000001') capture;
select pg_temp.assert_true((select value->>'bank_name'='Test Bank'
  and value->>'account_number'='1234567890' and value->>'account_name'='Synthetic Bank Driver'
  and value ? 'captured_at' from bank_test_state where key='manager_capture'),
  'Operations Manager can review the captured values and capture time');
select pg_temp.assert_true((select count(*)=1 from public.get_operations_waybill_copy_management_state(
  'd6000000-0000-0000-0000-000000000001') state
  where state.driver_pdf_status='pending' and state.company_pdf_status='blocked_missing_bank_details'
    and state.bank_verification_state='missing'),
  'registration capture does not verify bank data or alter independent PDF queue states');

select pg_temp.assert_true((select count(*)=0 from public.get_operations_waybill_copy_management_state(
  'd6000000-0000-0000-0000-000000000001') state
  where to_jsonb(state)::text ~ '1234567890|Test Bank|account_number|bank_name'),
  'generic Waybill management state does not expose captured bank values');

-- One Operations Manager explicitly submits, reviews and verifies; capture itself did not verify.
insert into bank_test_state values('submission',jsonb_build_object('id',
  public.submit_waybill_company_bank_details(
    'd6000000-0000-0000-0000-000000000001',
    (select value->>'bank_name' from bank_test_state where key='manager_capture'),
    (select value->>'account_name' from bank_test_state where key='manager_capture'),
    (select value->>'account_number' from bank_test_state where key='manager_capture')
  )::text));
select pg_temp.assert_true((select count(*)=0 from public.get_operations_waybill_registration_bank_capture(
  'd6000000-0000-0000-0000-000000000001')),
  'active bank submission uses the existing review RPC instead of exposing a second source');
insert into bank_test_state
select 'review',to_jsonb(reviewed)
from public.get_waybill_company_bank_submission_for_review(
  ((select value->>'id' from bank_test_state where key='submission')::uuid)
) reviewed;
reset role;
select pg_temp.assert_true(exists (
  select 1 from private.loading_registration_bank_captures capture
  where capture.driver_id=((select value#>>'{driver,id}' from bank_test_state where key='registration')::uuid)
    and capture.captured_by='d0000000-0000-0000-0000-000000000002'
),'initial registration capture preserves Loading Officer attribution');
set local role authenticated;
select pg_temp.assert_true((select value->>'bank_name'='Test Bank'
  and value->>'account_number'='1234567890'
  and value->>'submitted_by'='d0000000-0000-0000-0000-000000000003'
  from bank_test_state where key='review'),'review RPC records the authenticated Operations Manager as submission actor');
select pg_temp.assert_true(public.verify_waybill_company_bank_details(
  ((select value->>'id' from bank_test_state where key='submission')::uuid),true,'verified'
)='verified','Operations Manager explicitly verifies the captured bank data');
select pg_temp.assert_true((select count(*)=1 from public.get_operations_waybill_copy_management_state(
  'd6000000-0000-0000-0000-000000000001') state
  where state.driver_pdf_status='pending' and state.company_pdf_status='pending'
    and state.bank_verification_state='verified' and state.latest_bank_snapshot_version=1),
  'verification creates Company snapshot/job while Driver copy stays bank-free');
select pg_temp.assert_true((select count(*)=0 from public.get_operations_waybill_registration_bank_capture(
  'd6000000-0000-0000-0000-000000000001')),
  'verified Waybill no longer returns the older registration capture');

-- The worker-specific Driver snapshot remains structurally free of bank/phone fields.
reset role;
update public.trip_closure_invoice_pdf_copies
set status='processing',lease_token='d7000000-0000-0000-0000-000000000001',
  lease_until=clock_timestamp()+interval '5 minutes',attempts=1
where invoice_id='d6000000-0000-0000-0000-000000000001' and copy_kind='driver' and copy_version=1;
insert into bank_test_state values('driver_pdf_snapshot',public.get_driver_waybill_pdf_snapshot(
  (select id from public.trip_closure_invoice_pdf_copies
    where invoice_id='d6000000-0000-0000-0000-000000000001' and copy_kind='driver'),
  'd7000000-0000-0000-0000-000000000001'
));
select pg_temp.assert_true((select value is not null
  and value::text !~ '1234567890|08020000003|Test Bank|account_number|bank_name|account_name'
  from bank_test_state where key='driver_pdf_snapshot'),
  'Driver PDF renderer snapshot contains no bank data or driver phone');

-- Corrections remain immutable, versioned, and isolated to Company copies.
set local role authenticated;
select set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-000000000003',true);
insert into bank_test_state values('correction_submission',jsonb_build_object('id',
  public.submit_waybill_company_bank_details(
    'd6000000-0000-0000-0000-000000000001','Corrected Test Bank','Corrected Synthetic Name','0987654321'
  )::text));
insert into bank_test_state
select 'correction_review',to_jsonb(reviewed)
from public.get_waybill_company_bank_submission_for_review(
  ((select value->>'id' from bank_test_state where key='correction_submission')::uuid)
) reviewed;
select pg_temp.assert_true((select value->>'bank_name'='Corrected Test Bank'
  and value->>'account_number'='0987654321'
  and value->>'submitted_by'='d0000000-0000-0000-0000-000000000003'
  from bank_test_state where key='correction_review'),
  'Operations Manager correction review is asserted without printing bank values');
select pg_temp.assert_true(public.verify_waybill_company_bank_details(
  ((select value->>'id' from bank_test_state where key='correction_submission')::uuid),true,'verified'
)='corrected','Operations Manager can verify a correction');
reset role;
select pg_temp.assert_true((select count(*)=2 and min(version)=1 and max(version)=2
  from public.trip_closure_invoice_bank_snapshots where invoice_id='d6000000-0000-0000-0000-000000000001')
  and (select count(*)=2 from public.trip_closure_invoice_pdf_copies
    where invoice_id='d6000000-0000-0000-0000-000000000001' and copy_kind='company')
  and (select count(*)=1 from public.trip_closure_invoice_pdf_copies
    where invoice_id='d6000000-0000-0000-0000-000000000001' and copy_kind='driver'),
  'correction preserves prior snapshot and creates only a new Company PDF version');

rollback;
