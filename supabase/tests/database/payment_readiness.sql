-- Local disposable database only; no real credentials or external email.
begin;
create function pg_temp.assert_true(value boolean, message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'Assertion failed: %', message; end if; end;
$$;
create function pg_temp.expect_error(command text, expected_state text) returns void language plpgsql as $$
begin
  begin execute command;
  exception when others then
    if sqlstate = expected_state then return; end if;
    raise exception 'Expected SQLSTATE %, received %: %', expected_state, sqlstate, sqlerrm;
  end;
  raise exception 'Expected SQLSTATE %, but command succeeded: %', expected_state, command;
end;
$$;
insert into auth.users(id,email,raw_user_meta_data)
select ('00000000-0000-0000-0000-00000000000'||n)::uuid, 'role'||n||'@example.invalid','{}'::jsonb from generate_series(1,6) n;
update public.profiles set is_active=true, role=case right(id::text,1)
 when '1' then 'system_administrator'::public.app_role when '2' then 'loading_officer'::public.app_role
 when '3' then 'offloading_officer'::public.app_role when '4' then 'finance_officer'::public.app_role
 when '5' then 'audit_reviewer'::public.app_role else 'operations_manager'::public.app_role end;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
insert into public.sites(id,name,site_type) values
 ('10000000-0000-0000-0000-000000000001','Loading','loading'),
 ('10000000-0000-0000-0000-000000000002','Offloading','offloading');
insert into public.drivers(id,full_name,phone_number,email) values
 ('20000000-0000-0000-0000-000000000001','Driver without bank details','08000000001','driver@example.invalid');
insert into public.trucks(id,registration_number,driver_id) values
 ('30000000-0000-0000-0000-000000000001','TEST-123','20000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select pg_temp.assert_true(public.create_loading_trip('test 123')->>'ok'='true','trip opens without banking prerequisites');
select set_config('test.delivery',(select id::text from public.trips where status='open'),true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select pg_temp.assert_true(public.close_trip(current_setting('test.delivery')::uuid,'10000000-0000-0000-0000-000000000002',12.34)->>'ok'='true','trip closes without bank details');
select pg_temp.assert_true((select status='closed' and quantity_tonnes=12.34 and closed_at is not null and closed_by=auth.uid() from public.trips where id=current_setting('test.delivery')::uuid),'physical delivery retained with quantity, actor and timestamp');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select pg_temp.assert_true(public.create_loading_trip('TEST123')->>'ok'='true','truck immediately free for next trip');
select set_config('test.delivery_two',(select id::text from public.trips where status='open'),true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select pg_temp.assert_true(public.close_trip(current_setting('test.delivery_two')::uuid,'10000000-0000-0000-0000-000000000002',20)->>'ok'='true','another physical delivery can complete before banking resolution');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
select pg_temp.assert_true((select count(*)=1 from public.trip_payments where trip_id=current_setting('test.delivery')::uuid),'exactly one payment record for first trip');
select set_config('test.payment',(select id::text from public.trip_payments where trip_id=current_setting('test.delivery')::uuid),true);
select set_config('test.payment_two',(select id::text from public.trip_payments where trip_id=current_setting('test.delivery_two')::uuid),true);
select pg_temp.assert_true((select status='payment_details_required' and driver_name='Driver without bank details' and driver_phone='08000000001' and driver_email='driver@example.invalid'
 and account_name is null and account_number is null and bank_name is null and supplied_account_number is null and payment_ready_at is null
 from public.trip_payments where id=current_setting('test.payment')::uuid),'contact snapshot retained and missing banking explicitly null');
select pg_temp.assert_true((select count(*)=1 from public.notification_outbox where trip_id=current_setting('test.delivery')::uuid and audience='finance'
 and payload->>'payment_status'='payment_details_required'),'finance notification queued for missing details');
select pg_temp.assert_true((select count(*)=1 from public.notification_outbox where trip_id=current_setting('test.delivery')::uuid and audience='driver'),'valid email gets appropriate driver notification');
select pg_temp.expect_error($q$select public.mark_trip_payment_paid(current_setting('test.payment')::uuid,'CANNOT-PAY-YET')$q$,'22023');
select pg_temp.expect_error($q$select public.complete_trip_payment_details(current_setting('test.payment')::uuid,'Driver','invalid','Bank','Invalid account')$q$,'23514');
select pg_temp.assert_true((select count(*)=0 from public.driver_payment_details),'invalid completion leaves no bank row');
select pg_temp.assert_true((select status='payment_details_required' from public.trip_payments where id=current_setting('test.payment')::uuid),'invalid completion leaves readiness unchanged');
reset role;
select pg_temp.assert_true((select private.trip_email(payload,array['finance@example.invalid'],'sender@example.invalid')->>'text' like '%Trip physically completed.%payment could not be processed%'
 from public.notification_outbox where trip_id=current_setting('test.delivery')::uuid and audience='finance'),'missing-details email conveys completion and payment blockage');
select pg_temp.assert_true((select private.trip_email(payload,recipients,'sender@example.invalid')->>'text' like '%Not provided at closure%'
 from public.notification_outbox where trip_id=current_setting('test.delivery')::uuid and audience='driver'),'driver email does not fabricate bank details');
select pg_temp.expect_error($q$update public.trip_payments set status='paid',payment_reference='BYPASS' where id=current_setting('test.payment')::uuid$q$,'23514');

-- Every non-finance application role is denied payment-details completion.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select pg_temp.expect_error($q$select public.complete_trip_payment_details(current_setting('test.payment')::uuid,'Driver','0123456789','Bank','Denied')$q$,'42501');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select pg_temp.expect_error($q$select public.complete_trip_payment_details(current_setting('test.payment')::uuid,'Driver','0123456789','Bank','Denied')$q$,'42501');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
select pg_temp.expect_error($q$select public.complete_trip_payment_details(current_setting('test.payment')::uuid,'Driver','0123456789','Bank','Denied')$q$,'42501');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',true);
select pg_temp.expect_error($q$select public.complete_trip_payment_details(current_setting('test.payment')::uuid,'Driver','0123456789','Bank','Denied')$q$,'42501');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
select public.complete_trip_payment_details(current_setting('test.payment')::uuid,'Driver Account','0123456789','Test Bank','Finance confirmed supplied details');
select pg_temp.assert_true((select status='pending' and account_name is null and account_number is null and bank_name is null
 and supplied_account_name='Driver Account' and supplied_account_number='0123456789' and supplied_bank_name='Test Bank'
 and payment_ready_at is not null and payment_ready_by=auth.uid() from public.trip_payments where id=current_setting('test.payment')::uuid),'completion preserves original unknowns and records later information with actor/time');
select pg_temp.assert_true((select count(*)=1 from public.audit_log where entity_name='trip_payments' and entity_id=current_setting('test.payment')::uuid
 and old_value->>'status'='payment_details_required' and new_value->>'status'='pending' and actor_id=auth.uid() and reason='Finance confirmed supplied details'),'readiness transition audited');
select pg_temp.assert_true((select account_number='0123456789' from public.driver_payment_details where driver_id='20000000-0000-0000-0000-000000000001'),'driver bank details populated atomically');
select pg_temp.assert_true((select status='payment_details_required' from public.trip_payments where id=current_setting('test.payment_two')::uuid),'other affected payments are not silently rewritten');
select pg_temp.assert_true((select payload->>'payment_status'='payment_details_required' and payload->>'account_number' is null from public.notification_outbox
 where trip_id=current_setting('test.delivery')::uuid and audience='finance'),'original closure notification remains historical');
select pg_temp.expect_error($q$select public.complete_trip_payment_details(current_setting('test.payment')::uuid,'Changed','9999999999','Other Bank','Cannot re-complete')$q$,'22023');
select public.mark_trip_payment_paid(current_setting('test.payment')::uuid,'BANK-PAYMENT-001');
select pg_temp.assert_true((select status='paid' and paid_at is not null and paid_by=auth.uid() from public.trip_payments where id=current_setting('test.payment')::uuid),'pending-to-paid still works after readiness completion');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select public.complete_trip_payment_details(current_setting('test.payment_two')::uuid,'Driver Updated Account','9999999999','Other Bank','Administrator confirmed details for second payment');
select pg_temp.assert_true((select status='pending' and payment_ready_by=auth.uid() from public.trip_payments where id=current_setting('test.payment_two')::uuid),'administrator may also complete details');
select pg_temp.assert_true((select supplied_account_number='0123456789' from public.trip_payments where id=current_setting('test.payment')::uuid),'later bank updates cannot change already supplied payment information');
select public.create_loading_trip('TEST123');
select set_config('test.complete_bank_trip',(select id::text from public.trips where status='open'),true);
select public.close_trip(current_setting('test.complete_bank_trip')::uuid,'10000000-0000-0000-0000-000000000002',30);
select pg_temp.assert_true((select status='pending' and account_number='9999999999' and supplied_account_number is null and payment_ready_at is not null
 from public.trip_payments where trip_id=current_setting('test.complete_bank_trip')::uuid),'subsequent complete-bank closure snapshots bank and starts pending');
reset role;
select pg_temp.expect_error($q$update public.trip_payments set supplied_account_number='8888888888' where id=current_setting('test.payment')::uuid$q$,'23514');
select pg_temp.expect_error($q$update public.trip_payments set account_number='8888888888' where id=current_setting('test.payment_two')::uuid$q$,'23514');

-- Re-check catalog grants and the complete six-role visibility matrix, including
-- the newly supplied account fields and their sensitive audit records.
select pg_temp.assert_true(not exists (
 select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.prosecdef
 and not ('search_path=""'=any(coalesce(p.proconfig,array[]::text[])))
),'all definer functions use empty search paths');
select pg_temp.assert_true(not has_function_privilege('anon','public.complete_trip_payment_details(uuid,text,text,text,text)','EXECUTE'),'new RPC is not anonymous');
select pg_temp.assert_true(not has_function_privilege('service_role','public.complete_trip_payment_details(uuid,text,text,text,text)','EXECUTE'),'worker role cannot complete banking');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.trip_payments','INSERT,UPDATE,DELETE'),'readiness cannot be bypassed by direct client writes');
create function pg_temp.assert_visibility(finance_access boolean) returns void language plpgsql as $$
begin
  perform pg_temp.assert_true((select count(*) > 0 from public.trips),'active role sees operational trips');
  perform pg_temp.assert_true((select count(*) > 0 from public.driver_payment_details)=finance_access,'bank details visibility');
  perform pg_temp.assert_true((select count(*) > 0 from public.trip_payments where supplied_account_number is not null)=finance_access,'later-supplied banking visibility');
  perform pg_temp.assert_true((select count(*) > 0 from public.notification_outbox)=finance_access,'outbox visibility');
  perform pg_temp.assert_true((select count(*) > 0 from public.audit_log where entity_name in ('driver_payment_details','trip_payments','notification_outbox'))=finance_access,'sensitive audit visibility');
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select pg_temp.assert_visibility(true); -- administrator
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select pg_temp.assert_visibility(false); -- loading officer
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select pg_temp.assert_visibility(false); -- offloading officer
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
select pg_temp.assert_visibility(true); -- finance officer
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
select pg_temp.assert_visibility(false); -- audit reviewer
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',true);
select pg_temp.assert_visibility(false); -- operations manager
reset role;
rollback;
