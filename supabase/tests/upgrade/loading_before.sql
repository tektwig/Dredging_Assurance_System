-- Disposable local upgrade fixture, deliberately committed across the migration.
-- Never run against hosted data. IDs are distinct from ordinary rolled-back tests.
begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('90000000-0000-0000-0000-000000000001','upgrade-admin@example.invalid','{}'),
 ('90000000-0000-0000-0000-000000000002','upgrade-loader@example.invalid','{}'),
 ('90000000-0000-0000-0000-000000000003','upgrade-offloader@example.invalid','{}');
update public.profiles set is_active=true,role=case right(id::text,1)
 when '1' then 'system_administrator'::public.app_role when '2' then 'loading_officer'::public.app_role
 else 'offloading_officer'::public.app_role end where id::text like '90000000-%';
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
insert into public.sites(id,name,site_type) values
 ('91000000-0000-0000-0000-000000000001','Upgrade loading','loading'),
 ('91000000-0000-0000-0000-000000000002','Upgrade offloading','offloading');
insert into public.drivers(id,full_name,phone_number) values
 ('92000000-0000-0000-0000-000000000001','Upgrade driver','08099999999'),
 ('92000000-0000-0000-0000-000000000002','Unnormalizable legacy driver','legacy phone');
insert into public.driver_payment_details(driver_id,account_name,account_number,bank_name)
 values('92000000-0000-0000-0000-000000000001','UPGRADE_PRIVATE_NAME','0199999999','UPGRADE_PRIVATE_BANK');
insert into public.trucks(id,registration_number,driver_id)
 values('93000000-0000-0000-0000-000000000001','UPGRADE-1','92000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000002',true);
select public.create_loading_trip('UPGRADE1');
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000003',true);
select public.close_trip((select id from public.trips where truck_id='93000000-0000-0000-0000-000000000001' and status='open'),
 '91000000-0000-0000-0000-000000000002',10);
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
select public.mark_trip_payment_paid((select id from public.trip_payments where trip_id=(select id from public.trips where truck_id='93000000-0000-0000-0000-000000000001' and status='closed')),'RECON-2026-001');
-- Simulate a failed provider delivery, then preserve its investigated retry history.
update public.notification_outbox set status='failed',first_attempt_at=clock_timestamp(),last_error='Provider temporary SMTP failure'
 where id=(select id from public.notification_outbox where trip_id=(select id from public.trips where truck_id='93000000-0000-0000-0000-000000000001' and status='closed') order by id limit 1);
select public.retry_trip_notification((select id from public.notification_outbox where trip_id=(select id from public.trips where truck_id='93000000-0000-0000-0000-000000000001' and status='closed') order by id limit 1),
 'Provider investigation: SMTP delay resolved; retry approved');
-- Historical free text with a labelled account number must be selectively scrubbed.
insert into public.audit_log(entity_name,entity_id,action,old_value,new_value,reason,actor_id)
 select 'trip_payments',id,'UPDATE',jsonb_build_object('status','pending','account_number','0199999999','bank_name','UPGRADE_PRIVATE_BANK'),
 jsonb_build_object('status','paid','payment_reference','RECON-2026-001','account_name','UPGRADE_PRIVATE_NAME'),
 'Provider investigated account_number=0199999999; payment reconciled after review',
 '90000000-0000-0000-0000-000000000001'::uuid from public.trip_payments limit 1;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000002',true);
select public.create_loading_trip('UPGRADE1');
-- Record original immutable fields for exact comparison after upgrade.
create table private.upgrade_expected as select id,driver_id,loading_site_id,daily_registration_id,opened_by,opened_at from public.trips;
create table private.upgrade_open_trip as select id from public.trips where truck_id='93000000-0000-0000-0000-000000000001' and status='open';
create table private.upgrade_payments_expected as select id,account_name,account_number,bank_name from public.trip_payments;
create table private.upgrade_audit_expected as select id,entity_name,entity_id,action,actor_id,created_at,reason,old_value,new_value
 from public.audit_log where reason like '%Provider investigation:%' or reason like '%payment reconciled after review%'
 or reason like '%RECON-2026-001%';
commit;
