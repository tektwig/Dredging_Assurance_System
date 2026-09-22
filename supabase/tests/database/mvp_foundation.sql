-- DISPOSABLE LOCAL database only, with migrations applied. All fixtures roll back.
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/database/mvp_foundation.sql
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

insert into auth.users(id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000001','admin@example.invalid','{"role":"system_administrator","is_active":true}'),
 ('00000000-0000-0000-0000-000000000002','loading@example.invalid','{}'),
 ('00000000-0000-0000-0000-000000000003','offloading@example.invalid','{}'),
 ('00000000-0000-0000-0000-000000000004','finance@example.invalid','{}'),
 ('00000000-0000-0000-0000-000000000005','audit@example.invalid','{}'),
 ('00000000-0000-0000-0000-000000000006','manager@example.invalid','{}'),
 ('00000000-0000-0000-0000-000000000007','disabled@example.invalid','{}');
select pg_temp.assert_true((select not is_active and role is null from public.profiles where id='00000000-0000-0000-0000-000000000001'), 'Auth metadata cannot grant a role');
update public.profiles set role = case right(id::text,1)
 when '1' then 'system_administrator'::public.app_role when '2' then 'loading_officer'::public.app_role
 when '3' then 'offloading_officer'::public.app_role when '4' then 'finance_officer'::public.app_role
 when '5' then 'audit_reviewer'::public.app_role when '6' then 'operations_manager'::public.app_role end,
 is_active = right(id::text,1) <> '7';

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
insert into public.sites(id,name,site_type,is_active) values
 ('10000000-0000-0000-0000-000000000001','Loading A','loading',true),
 ('10000000-0000-0000-0000-000000000002','Offloading A','offloading',true),
 ('10000000-0000-0000-0000-000000000003','Inactive offloading','offloading',false);
select pg_temp.expect_error($q$insert into public.sites(name,site_type) values ('Second loader','loading')$q$, '23505');
insert into public.drivers(id,full_name,phone_number,email) values
 ('20000000-0000-0000-0000-000000000001','Test Driver One','08000000001','driver@example.invalid'),
 ('20000000-0000-0000-0000-000000000002','Test Driver Two','08000000002',null);
insert into public.trucks(id,registration_number,driver_id) values
 ('30000000-0000-0000-0000-000000000001','ABC-123 XY','20000000-0000-0000-0000-000000000001'),
 ('30000000-0000-0000-0000-000000000002','XYZ-456 AB','20000000-0000-0000-0000-000000000002');
select pg_temp.assert_true(public.normalize_plate(' abc-123 xy ')='ABC123XY','deterministic plate normalization');
select pg_temp.expect_error($q$insert into public.trucks(registration_number,driver_id) values ('abc123xy','20000000-0000-0000-0000-000000000001')$q$,'23505');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select pg_temp.assert_true(public.create_loading_trip('UNKNOWN')->>'code'='UNKNOWN_TRUCK','unknown truck rejected');
select pg_temp.assert_true(public.create_loading_trip('abc 123-xy')->>'ok'='true','first trip opened');
select set_config('test.trip_one',(select id::text from public.trips where truck_id='30000000-0000-0000-0000-000000000001' and status='open'),true);
select pg_temp.assert_true(public.create_loading_trip('ABC123XY')->>'code'='OPEN_TRIP_EXISTS','duplicate arrival rejected');
select pg_temp.assert_true((select count(*)=1 from public.daily_registrations),'one daily registration');
select pg_temp.assert_true((select operational_date=(registered_at at time zone 'Africa/Lagos')::date from public.daily_registrations limit 1),'Lagos operational date');
select pg_temp.assert_true((select trip_number ~ '^TRP-[0-9]{10,}$' and quantity_tonnes is null from public.trips where id=current_setting('test.trip_one')::uuid),'generated number and no loading quantity');
select pg_temp.expect_error($q$update public.trips set status='closed'$q$,'42501');
select pg_temp.expect_error($q$insert into public.daily_registrations(truck_id,driver_id,operational_date,registered_by) values ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','2000-01-01','00000000-0000-0000-0000-000000000002')$q$,'42501');
select pg_temp.expect_error($q$select public.close_trip(current_setting('test.trip_one')::uuid,'10000000-0000-0000-0000-000000000002',10)$q$,'42501');
select pg_temp.expect_error($q$select public.claim_trip_notifications(array['finance@example.invalid'],'sender@example.invalid',5)$q$,'42501');
select pg_temp.expect_error($q$insert into public.drivers(full_name,phone_number) values ('Unauthorized','08000000000')$q$,'42501');
update public.profiles set role='system_administrator' where id='00000000-0000-0000-0000-000000000002';
select pg_temp.assert_true((select role='loading_officer' from public.profiles where id='00000000-0000-0000-0000-000000000002'),'cannot self-promote');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select pg_temp.assert_true(public.close_trip(current_setting('test.trip_one')::uuid,'10000000-0000-0000-0000-000000000001',10)->>'code'='INVALID_OFFLOADING_SITE','loading site cannot be used for closure');
select pg_temp.assert_true(public.close_trip(current_setting('test.trip_one')::uuid,'10000000-0000-0000-0000-000000000003',10)->>'code'='INVALID_OFFLOADING_SITE','inactive offloading site rejected');
select pg_temp.assert_true(public.close_trip(current_setting('test.trip_one')::uuid,'10000000-0000-0000-0000-000000000002',0)->>'code'='INVALID_QUANTITY','zero rejected');
select pg_temp.assert_true(public.close_trip(current_setting('test.trip_one')::uuid,'10000000-0000-0000-0000-000000000002',1.001)->>'code'='INVALID_QUANTITY','excess precision rejected');
select pg_temp.assert_true(public.close_trip(current_setting('test.trip_one')::uuid,'10000000-0000-0000-0000-000000000002','NaN')->>'code'='INVALID_QUANTITY','NaN rejected');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
insert into public.driver_payment_details(driver_id,account_name,account_number,bank_name) values
 ('20000000-0000-0000-0000-000000000001','Driver One','0123456789','Test Bank'),
 ('20000000-0000-0000-0000-000000000002','Driver Two','0123456788','Test Bank');
select pg_temp.expect_error($q$select public.create_loading_trip('ABC123XY')$q$,'42501');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select pg_temp.assert_true(public.close_trip(current_setting('test.trip_one')::uuid,'10000000-0000-0000-0000-000000000002',40.25)->>'ok'='true','closure succeeds');
select pg_temp.assert_true(public.close_trip(current_setting('test.trip_one')::uuid,'10000000-0000-0000-0000-000000000002',40.25)->>'code'='TRIP_NOT_OPEN','repeat closure rejected');
select pg_temp.assert_true((select count(*)=0 from public.trip_payments),'offloading cannot read payment snapshot');
select pg_temp.assert_true((select count(*)=0 from public.notification_outbox),'offloading cannot read banking payload');
select pg_temp.assert_true((select count(*)=0 from public.driver_payment_details),'offloading cannot read bank details');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
select pg_temp.assert_true((select count(*)=1 from public.trip_payments),'one payment per completed trip');
select pg_temp.assert_true((select status='pending' and payment_ready_at is not null and payment_ready_by='00000000-0000-0000-0000-000000000003' and supplied_account_number is null from public.trip_payments limit 1),'complete closure-time bank snapshot starts payment-ready');
select pg_temp.assert_true((select count(*)=2 from public.notification_outbox),'separate driver and finance messages');
update public.driver_payment_details set account_number='9999999999' where driver_id='20000000-0000-0000-0000-000000000001';
select pg_temp.assert_true((select account_number='0123456789' from public.trip_payments limit 1),'bank snapshot survives master-data change');
select pg_temp.expect_error($q$update public.trip_payments set account_number='9999999999'$q$,'42501');
select set_config('test.payment',(select id::text from public.trip_payments limit 1),true);
select public.mark_trip_payment_paid(current_setting('test.payment')::uuid,'BANK-TEST-001');
select pg_temp.assert_true((select status='paid' and paid_by='00000000-0000-0000-0000-000000000004' and paid_at is not null from public.trip_payments limit 1),'payment has actor and timestamp');
select pg_temp.expect_error($q$select public.mark_trip_payment_paid(current_setting('test.payment')::uuid,'DUPLICATE')$q$,'22023');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
update public.trucks set driver_id='20000000-0000-0000-0000-000000000002' where id='30000000-0000-0000-0000-000000000001';
select pg_temp.assert_true(public.create_loading_trip('ABC123XY')->>'ok'='true','subsequent trip opens');
select pg_temp.assert_true((select driver_id='20000000-0000-0000-0000-000000000001' from public.trips where status='open' and truck_id='30000000-0000-0000-0000-000000000001'),'daily driver remains frozen');
select set_config('test.trip_two',(select id::text from public.trips where status='open' and truck_id='30000000-0000-0000-0000-000000000001'),true);
select public.cancel_trip(current_setting('test.trip_two')::uuid,'Test cancellation');
select set_config('test.exception',public.raise_trip_exception('dispute','Investigate unresolved movement','30000000-0000-0000-0000-000000000001',null,null,true)::text,true);
select pg_temp.assert_true(public.create_loading_trip('ABC123XY')->>'code'='BLOCKING_EXCEPTION','blocking exception prevents new trip');
select public.resolve_trip_exception(current_setting('test.exception')::uuid,'Investigation complete');
select pg_temp.assert_true(public.create_loading_trip('ABC123XY')->>'ok'='true','resolved exception permits trip');
select set_config('test.trip_three',(select id::text from public.trips where status='open' and truck_id='30000000-0000-0000-0000-000000000001'),true);
select public.raise_trip_exception('dispute','Nonblocking note','30000000-0000-0000-0000-000000000001',current_setting('test.trip_three')::uuid,null,false);
select pg_temp.assert_true((select status='open' from public.trips where id=current_setting('test.trip_three')::uuid),'exception does not change trip status');
select public.close_trip(current_setting('test.trip_three')::uuid,'10000000-0000-0000-0000-000000000002',30);
select pg_temp.assert_true(public.create_loading_trip('ABC123XY')->>'ok'='true','nonblocking issue allows next trip');
select pg_temp.assert_true((select count(*)=4 from public.trips where truck_id='30000000-0000-0000-0000-000000000001'),'four distinct trips');
select pg_temp.assert_true((select count(*)=1 from public.daily_registrations where truck_id='30000000-0000-0000-0000-000000000001'),'one registration reused');
select public.create_loading_trip('XYZ456AB');
select public.close_trip((select id from public.trips where status='open' and truck_id='30000000-0000-0000-0000-000000000002'),'10000000-0000-0000-0000-000000000002',20);
select pg_temp.assert_true((select count(*)=1 from public.notification_outbox n join public.trips t on t.id=n.trip_id where t.truck_id='30000000-0000-0000-0000-000000000002'),'driver without email produces finance message only');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
select pg_temp.assert_true((select count(*)>0 from public.audit_log),'auditor sees operational audit');
select pg_temp.assert_true((select count(*)=0 from public.audit_log where entity_name in ('driver_payment_details','trip_payments')),'audit does not leak banking');
select pg_temp.assert_true((select count(*)=0 from public.trip_payments),'auditor cannot read banking snapshot');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000007',true);
select pg_temp.assert_true((select count(*)=0 from public.trips),'inactive profile cannot read trips');
select pg_temp.expect_error($q$select public.create_loading_trip('ABC123XY')$q$,'42501');

reset role;
-- Exercise database constraints independently of the normal RPC rejection path.
select pg_temp.expect_error($q$insert into public.trips(truck_id,driver_id,daily_registration_id,loading_site_id,opened_by)
 select truck_id,driver_id,daily_registration_id,loading_site_id,opened_by from public.trips where status='open' limit 1$q$,'23505');
select pg_temp.expect_error($q$insert into public.trips(truck_id,driver_id,daily_registration_id,loading_site_id,opened_by)
 select truck_id,'20000000-0000-0000-0000-000000000001',daily_registration_id,loading_site_id,opened_by
 from public.trips where truck_id='30000000-0000-0000-0000-000000000002' limit 1$q$,'23503');
select pg_temp.expect_error($q$update public.audit_log set reason='tampered'$q$,'23514');
select pg_temp.expect_error($q$update public.daily_registrations set operational_date=operational_date-1$q$,'23514');
select pg_temp.expect_error($q$update public.trips set quantity_tonnes=1 where id=current_setting('test.trip_one')::uuid$q$,'23514');
select pg_temp.expect_error($q$update public.trip_payments set account_number='8888888888' where id=current_setting('test.payment')::uuid$q$,'23514');
select pg_temp.assert_true((select count(*)=0 from public.trips t left join public.trip_payments p on p.trip_id=t.id where t.status='closed' and p.id is null),'all closed trips have snapshots');

-- Force an enqueue failure AFTER closure/snapshot logic starts. All changes must roll back.
create function pg_temp.fail_queue() returns trigger language plpgsql as $$
begin raise exception 'Injected queue failure'; end;
$$;
create trigger test_fail_queue before insert on public.notification_outbox for each row execute function pg_temp.fail_queue();
select set_config('test.rollback_trip',(select id::text from public.trips where status='open' limit 1),true);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select pg_temp.expect_error($q$select public.close_trip(current_setting('test.rollback_trip')::uuid,'10000000-0000-0000-0000-000000000002',10)$q$,'P0001');
select pg_temp.assert_true((select status='open' and closed_at is null from public.trips where id=current_setting('test.rollback_trip')::uuid),'enqueue failure rolls back trip closure');
select pg_temp.assert_true((select count(*)=0 from public.trip_payments where trip_id=current_setting('test.rollback_trip')::uuid),'enqueue failure rolls back payment');
select pg_temp.assert_true((select count(*)=0 from public.audit_log where entity_id=current_setting('test.rollback_trip')::uuid and new_value->>'status'='closed'),'enqueue failure rolls back closure audit');
reset role;
drop trigger test_fail_queue on public.notification_outbox;

set local role service_role;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.assert_true((select count(*)=5 from public.claim_trip_notifications(array['finance@example.invalid'],'sender@example.invalid',5)),'worker claims queued messages');
reset role;
select set_config('test.job',(select id::text from public.notification_outbox where status='processing' limit 1),true);
select set_config('test.lease',(select lease_token::text from public.notification_outbox where id=current_setting('test.job')::uuid),true);
select set_config('test.first_attempt',(select first_attempt_at::text from public.notification_outbox where id=current_setting('test.job')::uuid),true);
select pg_temp.assert_true((select first_attempt_at is not null from public.notification_outbox where id=current_setting('test.job')::uuid),'first claim sets original delivery-attempt boundary');
select pg_temp.assert_true((select email_request->'to' is not null and email_request->>'text' like '%Account Number:%' from public.notification_outbox where id=current_setting('test.job')::uuid),'provider request includes snapshot');
set local role service_role;
select pg_temp.assert_true(not public.finish_trip_notification(current_setting('test.job')::uuid,gen_random_uuid(),true,'wrong-lease',null),'wrong lease cannot acknowledge');
select pg_temp.assert_true(public.finish_trip_notification(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,false,null,'Provider HTTP 503'),'failed send queued for retry');
reset role;
select pg_temp.assert_true((select status='pending' and attempts=1 and last_error is not null from public.notification_outbox where id=current_setting('test.job')::uuid),'retry state retained');
select pg_temp.assert_true((select t.status='closed' from public.notification_outbox n join public.trips t on t.id=n.trip_id where n.id=current_setting('test.job')::uuid),'email failure leaves trip closed');

-- Manual retry inside the original window keeps identity and original timestamp.
update public.notification_outbox set status='failed',attempts=8 where id=current_setting('test.job')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
select public.retry_trip_notification(current_setting('test.job')::uuid,'Provider investigated within original window');
select pg_temp.assert_true((select status='pending' and attempts=0 and first_attempt_at=current_setting('test.first_attempt')::timestamptz from public.notification_outbox where id=current_setting('test.job')::uuid),'manual retry preserves original boundary and row identity');
reset role;
set local role service_role;
select pg_temp.assert_true((select count(*)=1 from public.claim_trip_notifications(array['finance@example.invalid'],'sender@example.invalid',1)),'manually retried notification eligible within original window');
reset role;
select pg_temp.assert_true((select first_attempt_at=current_setting('test.first_attempt')::timestamptz from public.notification_outbox where id=current_setting('test.job')::uuid),'reclaim does not change original boundary');
select set_config('test.lease',(select lease_token::text from public.notification_outbox where id=current_setting('test.job')::uuid),true);
set local role service_role;
select public.finish_trip_notification(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,false,null,'Provider HTTP 503');
reset role;

-- Expired leases are recoverable with the original provider request and new token.
select set_config('test.expired_job',(select id::text from public.notification_outbox where status='processing' limit 1),true);
select set_config('test.old_lease',(select lease_token::text from public.notification_outbox where id=current_setting('test.expired_job')::uuid),true);
select set_config('test.email_request',(select email_request::text from public.notification_outbox where id=current_setting('test.expired_job')::uuid),true);
update public.notification_outbox set lease_until=clock_timestamp()-interval '1 minute' where id=current_setting('test.expired_job')::uuid;
set local role service_role;
select pg_temp.assert_true((select count(*)=1 from public.claim_trip_notifications(array['new-finance@example.invalid'],'new-sender@example.invalid',5)),'expired lease reclaimed');
select pg_temp.assert_true(not public.finish_trip_notification(current_setting('test.expired_job')::uuid,current_setting('test.old_lease')::uuid,true,'stale',null),'replaced lease cannot acknowledge');
reset role;
select pg_temp.assert_true((select email_request=current_setting('test.email_request')::jsonb and attempts=2 from public.notification_outbox where id=current_setting('test.expired_job')::uuid),'retry freezes original recipients and message');
select set_config('test.new_lease',(select lease_token::text from public.notification_outbox where id=current_setting('test.expired_job')::uuid),true);
set local role service_role;
select pg_temp.assert_true(public.finish_trip_notification(current_setting('test.expired_job')::uuid,current_setting('test.new_lease')::uuid,true,'provider-success',null),'successful send acknowledged');
reset role;
select pg_temp.assert_true((select status='sent' and sent_at is not null from public.notification_outbox where id=current_setting('test.expired_job')::uuid),'sent state recorded');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
select pg_temp.expect_error($q$select public.retry_trip_notification(current_setting('test.expired_job')::uuid,'Ordinary retry of sent message')$q$,'22023');
reset role;
-- Stop retries outside the provider deduplication window.
update public.notification_outbox set first_attempt_at=clock_timestamp()-interval '24 hours' where id=current_setting('test.job')::uuid;
set local role service_role;
select count(*) from public.claim_trip_notifications(array['finance@example.invalid'],'sender@example.invalid',5);
reset role;
select pg_temp.assert_true((select status='failed' from public.notification_outbox where id=current_setting('test.job')::uuid),'old ambiguous delivery requires manual review');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
select pg_temp.expect_error($q$select public.retry_trip_notification(current_setting('test.job')::uuid,'Provider checked after window expiry')$q$,'22023');
select pg_temp.assert_true((select status='failed' and first_attempt_at < clock_timestamp()-interval '23 hours' from public.notification_outbox where id=current_setting('test.job')::uuid),'expired original boundary cannot be reset by manual retry');
select pg_temp.assert_true((select count(*)=1 from public.audit_log where entity_name='notification_outbox' and entity_id=current_setting('test.job')::uuid),'manual retry audited');
reset role;
set local role anon;
select pg_temp.expect_error($q$select * from public.trips$q$,'42501');
select pg_temp.expect_error($q$select public.create_loading_trip('ABC123XY')$q$,'42501');
reset role;
rollback;
