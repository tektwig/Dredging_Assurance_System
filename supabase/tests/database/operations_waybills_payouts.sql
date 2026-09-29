begin;

create function pg_temp.waybill_ops_assert(condition boolean,message text) returns void language plpgsql as $$
begin if condition is distinct from true then raise exception 'Operations Waybill assertion failed: %',message; end if; end $$;
create function pg_temp.waybill_ops_error(query text,state text) returns void language plpgsql as $$
declare actual text;
begin
  begin execute query;
  exception when others then
    get stacked diagnostics actual=returned_sqlstate;
    if actual=state then return; end if;
    raise exception 'Expected SQLSTATE %, got %',state,actual;
  end;
  raise exception 'Expected SQLSTATE %',state;
end $$;

select pg_temp.waybill_ops_assert((select count(*)=7 and bool_and(
  has_function_privilege('authenticated',p.oid,'EXECUTE')
  and not has_function_privilege('anon',p.oid,'EXECUTE')
  and not has_function_privilege('service_role',p.oid,'EXECUTE'))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in ('get_operations_waybills','get_operations_waybill_detail',
    'get_operations_waybill_delivery_history','resend_operations_waybill','retry_operations_waybill_delivery',
    'complete_operations_payment_details','mark_operations_payment_paid')),
  'Operations RPCs have authenticated-only EXECUTE grants');
select pg_temp.waybill_ops_assert(
  has_function_privilege('service_role','public.claim_trip_notifications(text[],text,integer,boolean,text[])','EXECUTE')
  and not has_function_privilege('authenticated','public.claim_trip_notifications(text[],text,integer,boolean,text[])','EXECUTE')
  and not has_function_privilege('anon','public.claim_trip_notifications(text[],text,integer,boolean,text[])','EXECUTE'),
  'expanded worker claim remains service-role only');

insert into auth.users(id,email,raw_user_meta_data) values
 ('c8110000-0000-0000-0000-000000000001','waybill-ops@example.invalid','{}'),
 ('c8110000-0000-0000-0000-000000000002','waybill-loading@example.invalid','{}'),
 ('c8110000-0000-0000-0000-000000000003','waybill-offloading@example.invalid','{}'),
 ('c8110000-0000-0000-0000-000000000004','waybill-finance@example.invalid','{}'),
 ('c8110000-0000-0000-0000-000000000005','waybill-audit@example.invalid','{}'),
 ('c8110000-0000-0000-0000-000000000006','waybill-admin@example.invalid','{}'),
 ('c8110000-0000-0000-0000-000000000007','waybill-inactive@example.invalid','{}');
update public.profiles set role=case right(id::text,1)
  when '1' then 'operations_manager'::public.app_role when '2' then 'loading_officer'::public.app_role
  when '3' then 'offloading_officer'::public.app_role when '4' then 'finance_officer'::public.app_role
  when '5' then 'audit_reviewer'::public.app_role when '6' then 'system_administrator'::public.app_role
  else 'operations_manager'::public.app_role end,
  is_active=right(id::text,1)<>'7' where id::text like 'c8110000-%';
insert into public.sites(id,name,site_type) values
 ('c8120000-0000-0000-0000-000000000001','Waybill Loading','loading'),
 ('c8120000-0000-0000-0000-000000000002','Waybill Offloading','offloading');
insert into public.drivers(id,full_name,phone_number,email) values
 ('c8130000-0000-0000-0000-000000000001','Paid Driver','08017000001','immutable-driver@example.invalid'),
 ('c8130000-0000-0000-0000-000000000002','Missing Bank Driver','08017000002',null);
insert into public.driver_payment_details(driver_id,account_name,account_number,bank_name)
values ('c8130000-0000-0000-0000-000000000002','Master Account','1111111111','Master Bank');
insert into public.trucks(id,registration_number,driver_id) values
 ('c8140000-0000-0000-0000-000000000001','WAY-001','c8130000-0000-0000-0000-000000000001'),
 ('c8140000-0000-0000-0000-000000000002','WAY-002','c8130000-0000-0000-0000-000000000002');
alter table public.daily_registrations disable trigger user;
insert into public.daily_registrations(id,truck_id,initial_driver_id,operational_date,registered_at,registered_by)
values ('c8150000-0000-0000-0000-000000000001','c8140000-0000-0000-0000-000000000001',
  'c8130000-0000-0000-0000-000000000001',date '2026-09-28',clock_timestamp(),'c8110000-0000-0000-0000-000000000002'),
 ('c8150000-0000-0000-0000-000000000002','c8140000-0000-0000-0000-000000000002',
  'c8130000-0000-0000-0000-000000000002',date '2026-09-28',clock_timestamp(),'c8110000-0000-0000-0000-000000000002');
alter table public.daily_registrations enable trigger user;
alter table public.trips disable trigger user;
insert into public.trips(id,trip_number,truck_id,driver_id,daily_registration_id,loading_site_id,
  offloading_site_id,status,quantity_tonnes,opened_at,opened_by,closed_at,closed_by,
  truck_registration_at_loading,driver_name_at_loading)
values ('c8160000-0000-0000-0000-000000000001','WAY-TRIP-001','c8140000-0000-0000-0000-000000000001',
  'c8130000-0000-0000-0000-000000000001','c8150000-0000-0000-0000-000000000001',
  'c8120000-0000-0000-0000-000000000001','c8120000-0000-0000-0000-000000000002','closed',15,
  timestamp with time zone '2026-09-28 09:00 Africa/Lagos','c8110000-0000-0000-0000-000000000002',
  timestamp with time zone '2026-09-28 11:00 Africa/Lagos','c8110000-0000-0000-0000-000000000003','WAY-001','Paid Driver'),
 ('c8160000-0000-0000-0000-000000000002','WAY-TRIP-002','c8140000-0000-0000-0000-000000000002',
  'c8130000-0000-0000-0000-000000000002','c8150000-0000-0000-0000-000000000002',
  'c8120000-0000-0000-0000-000000000001','c8120000-0000-0000-0000-000000000002','closed',18,
  timestamp with time zone '2026-09-28 09:00 Africa/Lagos','c8110000-0000-0000-0000-000000000002',
  timestamp with time zone '2026-09-28 12:00 Africa/Lagos','c8110000-0000-0000-0000-000000000003','WAY-002','Missing Bank Driver');
alter table public.trips enable trigger user;
insert into public.trip_closure_invoices(id,invoice_number,trip_id,trip_number,truck_id,truck_registration,
  driver_id,driver_name,driver_email,loading_site_id,loading_site_name,offloading_site_id,
  offloading_site_name,quantity_tonnes,opened_at,closed_at,issued_at)
values ('c8170000-0000-0000-0000-000000000001','INV-2026-888881','c8160000-0000-0000-0000-000000000001',
  'WAY-TRIP-001','c8140000-0000-0000-0000-000000000001','WAY-001',
  'c8130000-0000-0000-0000-000000000001','Paid Driver','immutable-driver@example.invalid',
  'c8120000-0000-0000-0000-000000000001','Waybill Loading',
  'c8120000-0000-0000-0000-000000000002','Waybill Offloading',15,
  timestamp with time zone '2026-09-28 09:00 Africa/Lagos',
  timestamp with time zone '2026-09-28 11:00 Africa/Lagos',
  timestamp with time zone '2026-09-28 11:00 Africa/Lagos'),
 ('c8170000-0000-0000-0000-000000000002','INV-2026-888882','c8160000-0000-0000-0000-000000000002',
  'WAY-TRIP-002','c8140000-0000-0000-0000-000000000002','WAY-002',
  'c8130000-0000-0000-0000-000000000002','Missing Bank Driver',null,
  'c8120000-0000-0000-0000-000000000001','Waybill Loading',
  'c8120000-0000-0000-0000-000000000002','Waybill Offloading',18,
  timestamp with time zone '2026-09-28 09:00 Africa/Lagos',
  timestamp with time zone '2026-09-28 12:00 Africa/Lagos',
  timestamp with time zone '2026-09-28 12:00 Africa/Lagos');
update public.trip_closure_invoice_documents set status='ready',ready_at=clock_timestamp()
where invoice_id='c8170000-0000-0000-0000-000000000001';
insert into public.trip_payments(trip_id,truck_id,driver_id,driver_name,driver_phone,
  account_name,account_number,bank_name,status)
values ('c8160000-0000-0000-0000-000000000001','c8140000-0000-0000-0000-000000000001',
  'c8130000-0000-0000-0000-000000000001','Paid Driver','08017000001','Payout Account','2222222222','Payout Bank','pending'),
 ('c8160000-0000-0000-0000-000000000002','c8140000-0000-0000-0000-000000000002',
  'c8130000-0000-0000-0000-000000000002','Missing Bank Driver','08017000002',null,null,null,'payment_details_required');
select pg_temp.waybill_ops_assert(public.enqueue_waybill_ready_notifications(array['ops@example.invalid'])>=2,
  'ready document enqueues original deliveries');
create temp table waybill_ops_payment as select id,updated_at from public.trip_payments
  where trip_id='c8160000-0000-0000-0000-000000000001';
create temp table waybill_ops_missing_payment as select id,updated_at from public.trip_payments
  where trip_id='c8160000-0000-0000-0000-000000000002';
grant select on waybill_ops_payment,waybill_ops_missing_payment to authenticated;
select pg_temp.waybill_ops_assert((select count(*)=1 from waybill_ops_payment)
  and (select count(*)=1 from waybill_ops_missing_payment),'payment fixtures selected');

set local role authenticated;
select set_config('request.jwt.claim.sub','c8110000-0000-0000-0000-000000000001',true);
select pg_temp.waybill_ops_assert((public.get_operations_waybills(1,25,'INV-2026-888881')->>'total_count')::integer=1,
  'server register filters by Waybill number');
select pg_temp.waybill_ops_assert((public.get_operations_waybills(1,25,'WAY001')->>'total_count')::integer=1
  and (public.get_operations_waybills(1,25,'Missing Bank')->>'total_count')::integer=1,
  'server register searches normalized snapshot plate and snapshot driver');
select pg_temp.waybill_ops_assert((public.get_operations_waybills(1,25,'WAY-TRIP',null,
  date '2026-09-28',date '2026-09-28')->>'total_count')::integer=2
  and (public.get_operations_waybills(1,25,'WAY-TRIP',null,date '2026-09-27',date '2026-09-27')
  ->>'total_count')::integer=0,'closed-date range uses inclusive Lagos days');
select pg_temp.waybill_ops_assert((public.get_operations_waybills(1,25,null,
  'payment_details_required')->>'total_count')::integer=1
  and (public.get_operations_waybills(1,25,null,'waybill_failed')->>'total_count')::integer=0,
  'quick filters use payment and PDF document status');
select pg_temp.waybill_ops_error('select public.get_operations_waybills(0,25)','22023');
select pg_temp.waybill_ops_assert(position('2222222222' in public.get_operations_waybills(1,25)::text)=0
  and position('immutable-driver@example.invalid' in public.get_operations_waybills(1,25)::text)=0,
  'register hides banking and recipients');
select pg_temp.waybill_ops_assert((public.get_operations_waybill_detail('c8170000-0000-0000-0000-000000000001')
  #>>'{payment,account_number}')='2222222222', 'selected payout detail exposes only its bank');
select pg_temp.waybill_ops_assert((public.get_operations_waybill_detail('c8170000-0000-0000-0000-000000000002')
  #>>'{payment,account_number}') is null,'missing payout bank not borrowed from driver master');
select pg_temp.waybill_ops_assert((select id::text=public.get_operations_waybill_detail(
  'c8170000-0000-0000-0000-000000000001')#>>'{payment,id}' from waybill_ops_payment),
  'selected payment ID visible in temporary fixture');
select pg_temp.waybill_ops_error($q$select public.resend_operations_waybill(
  'c8170000-0000-0000-0000-000000000002','driver','c8180000-0000-0000-0000-000000000001','DRIVER_REQUEST',false)$q$,'P4091');
reset role;
update public.trip_closure_invoice_documents set status='ready',ready_at=clock_timestamp()
where invoice_id='c8170000-0000-0000-0000-000000000002';
select public.enqueue_waybill_ready_notifications(array['ops@example.invalid']);
set local role authenticated;
select set_config('request.jwt.claim.sub','c8110000-0000-0000-0000-000000000001',true);
select pg_temp.waybill_ops_error($q$select public.resend_operations_waybill(
  'c8170000-0000-0000-0000-000000000002','driver','c8180000-0000-0000-0000-000000000001','DRIVER_REQUEST',false)$q$,'P4091');
select pg_temp.waybill_ops_assert((public.get_operations_waybill_detail('c8170000-0000-0000-0000-000000000002')
  #>>'{invoice,driver_email_available}')='false','missing immutable driver email cannot be selected');
select pg_temp.waybill_ops_error($q$select public.resend_operations_waybill(
  'c8170000-0000-0000-0000-000000000001','driver','c8180000-0000-0000-0000-000000000002','UNAPPROVED',false)$q$,'22023');
select pg_temp.waybill_ops_error($q$select public.resend_operations_waybill(
  'c8170000-0000-0000-0000-000000000001','driver','c8180000-0000-0000-0000-000000000002','DRIVER_REQUEST',false)$q$,'P4091');
select pg_temp.waybill_ops_error($q$select public.mark_operations_payment_paid(
  (select id from waybill_ops_payment),
  clock_timestamp(),'REF-001')$q$,'P4091');
select pg_temp.waybill_ops_assert((public.mark_operations_payment_paid(
  (select id from waybill_ops_payment),(select updated_at from waybill_ops_payment),'REF-001')->>'status')='paid',
  'pending payout can be marked paid');
select pg_temp.waybill_ops_assert((public.mark_operations_payment_paid(
  (select id from waybill_ops_payment),(select updated_at from waybill_ops_payment),'REF-001')->>'replayed')='true',
  'same-reference replay returns paid result');
select pg_temp.waybill_ops_error($q$select public.mark_operations_payment_paid(
  (select id from waybill_ops_payment),(select updated_at from waybill_ops_payment),'REF-002')$q$,'P4091');
select pg_temp.waybill_ops_assert((public.complete_operations_payment_details(
  (select id from waybill_ops_missing_payment),(select updated_at from waybill_ops_missing_payment),
  'Specific Account','3333333333','Specific Bank')->>'status')='pending',
  'Operations completes only the selected missing payout');
select pg_temp.waybill_ops_error($q$select public.complete_operations_payment_details(
  (select id from waybill_ops_missing_payment),(select updated_at from waybill_ops_missing_payment),
  'Different Account','4444444444','Different Bank')$q$,'P4091');
reset role;
select pg_temp.waybill_ops_assert((select account_number='1111111111' from public.driver_payment_details
  where driver_id='c8130000-0000-0000-0000-000000000002'),
  'Operations payout completion does not change driver master banking');
select pg_temp.waybill_ops_assert((select count(*)=1 from public.audit_log where entity_name='trip_payments'
  and entity_id=(select id from waybill_ops_payment) and action='UPDATE'),
  'paid replay creates no second update audit');

update public.notification_outbox set status='sent',sent_at=clock_timestamp()
where trip_id='c8160000-0000-0000-0000-000000000001' and event_type='waybill_ready' and audience='driver';
set local role authenticated;
select set_config('request.jwt.claim.sub','c8110000-0000-0000-0000-000000000001',true);
select pg_temp.waybill_ops_assert((public.resend_operations_waybill(
  'c8170000-0000-0000-0000-000000000001','driver','c8180000-0000-0000-0000-000000000003',
  'DRIVER_REQUEST',false)->>'sequence')='1','explicit resend appends sequence one');
select pg_temp.waybill_ops_assert((public.resend_operations_waybill(
  'c8170000-0000-0000-0000-000000000001','driver','c8180000-0000-0000-0000-000000000003',
  'DRIVER_REQUEST',false)->>'sequence')='1','request UUID replay is idempotent');
select pg_temp.waybill_ops_error($q$select public.resend_operations_waybill(
  'c8170000-0000-0000-0000-000000000001','finance','c8180000-0000-0000-0000-000000000003',
  'DRIVER_REQUEST',false)$q$,'P4091');
select pg_temp.waybill_ops_assert(position('immutable-driver@example.invalid' in
  public.get_operations_waybill_delivery_history('c8170000-0000-0000-0000-000000000001')::text)=0,
  'history omits recipients');
reset role;
select pg_temp.waybill_ops_assert((select count(*)=2 and count(*) filter (where delivery_sequence=0 and status='sent')=1
  from public.notification_outbox where trip_id='c8160000-0000-0000-0000-000000000001'
    and event_type='waybill_ready' and audience='driver'),'original sent delivery remains immutable');
select pg_temp.waybill_ops_assert((select count(*)=1 from public.audit_log where entity_name='waybill_resend'
  and entity_id=(select id from public.notification_outbox where resend_request_id='c8180000-0000-0000-0000-000000000003')),
  'resend is audited once');
select pg_temp.waybill_ops_assert((select recipients=array['immutable-driver@example.invalid']
  from public.notification_outbox where resend_request_id='c8180000-0000-0000-0000-000000000003'),
  'resend driver recipient is immutable snapshot email');
update public.notification_outbox set status='failed',first_attempt_at=clock_timestamp()-interval '24 hours'
where resend_request_id='c8180000-0000-0000-0000-000000000003';
update public.notification_outbox set status='sent',sent_at=clock_timestamp()
where trip_id='c8160000-0000-0000-0000-000000000001'
  and event_type='waybill_ready' and audience='finance' and delivery_sequence=0;
set local role authenticated;
select set_config('request.jwt.claim.sub','c8110000-0000-0000-0000-000000000001',true);
select pg_temp.waybill_ops_error($q$select public.retry_operations_waybill_delivery(
  'c8170000-0000-0000-0000-000000000001','driver','DELIVERY_UNCONFIRMED')$q$,'P4091');
select pg_temp.waybill_ops_error($q$select public.resend_operations_waybill(
  'c8170000-0000-0000-0000-000000000001','driver','c8180000-0000-0000-0000-000000000004',
  'DELIVERY_UNCONFIRMED',false)$q$,'P4091');
select pg_temp.waybill_ops_assert((public.resend_operations_waybill(
  'c8170000-0000-0000-0000-000000000001','driver','c8180000-0000-0000-0000-000000000004',
  'DELIVERY_UNCONFIRMED',true)->>'sequence')='2',
  'explicit duplicate-risk confirmation appends a new driver attempt');
select pg_temp.waybill_ops_assert((public.resend_operations_waybill(
  'c8170000-0000-0000-0000-000000000001','finance','c8180000-0000-0000-0000-000000000005',
  'INTERNAL_REQUEST',false)->>'sequence')='1',
  'internal audience can be resent independently');
select pg_temp.waybill_ops_assert((public.get_operations_dashboard_summary()
  #>>'{action_required,failed_waybill_emails,count}')::integer=0,
  'Dashboard ignores superseded failed delivery');
reset role;
select pg_temp.waybill_ops_assert((select recipients is null and email_request is null
  from public.notification_outbox where resend_request_id='c8180000-0000-0000-0000-000000000005'),
  'internal recipients are deferred to trusted worker configuration');
select pg_temp.waybill_ops_assert((select count(*)=1 from public.claim_trip_notifications(
  array['legacy-finance@example.invalid'],'sender@example.invalid',10,true,
  array['current-ops@example.invalid']) where resend_request_id='c8180000-0000-0000-0000-000000000005'),
  'worker claims internal resend with current configured recipients');
select pg_temp.waybill_ops_assert((select recipients=array['current-ops@example.invalid']
  from public.notification_outbox where resend_request_id='c8180000-0000-0000-0000-000000000005'),
  'first claim freezes internal recipients');
update public.notification_outbox set status='sent',sent_at=clock_timestamp(),lease_token=null,lease_until=null
where resend_request_id='c8180000-0000-0000-0000-000000000005';
set local role authenticated;
select set_config('request.jwt.claim.sub','c8110000-0000-0000-0000-000000000001',true);
select pg_temp.waybill_ops_assert((public.resend_operations_waybill(
  'c8170000-0000-0000-0000-000000000001','finance','c8180000-0000-0000-0000-000000000006',
  'INTERNAL_REQUEST',false)->>'sequence')='2','later internal resend preserves sent history');
reset role;
select pg_temp.waybill_ops_assert((select count(*)=0 from public.claim_trip_notifications(
  array['legacy-finance@example.invalid'],'sender@example.invalid',10,true,array[]::text[])
  where resend_request_id='c8180000-0000-0000-0000-000000000006'),
  'unconfigured internal resend is not claimed');
set local role authenticated;
select set_config('request.jwt.claim.sub','c8110000-0000-0000-0000-000000000004',true);
select pg_temp.waybill_ops_error($q$select public.retry_trip_notification(
  (select id from public.notification_outbox where resend_request_id='c8180000-0000-0000-0000-000000000003'),
  'Provider reconciled')$q$,'22023');
reset role;

set local role authenticated;
do $$ declare actor text;
begin
  foreach actor in array array['c8110000-0000-0000-0000-000000000002',
    'c8110000-0000-0000-0000-000000000003','c8110000-0000-0000-0000-000000000004',
    'c8110000-0000-0000-0000-000000000005','c8110000-0000-0000-0000-000000000006',
    'c8110000-0000-0000-0000-000000000007'] loop
    perform set_config('request.jwt.claim.sub',actor,true);
    perform pg_temp.waybill_ops_error('select public.get_operations_waybills()', '42501');
    perform pg_temp.waybill_ops_error('select public.get_operations_waybill_detail(''c8170000-0000-0000-0000-000000000001'')', '42501');
    perform pg_temp.waybill_ops_error('select public.get_operations_waybill_delivery_history(''c8170000-0000-0000-0000-000000000001'')', '42501');
    perform pg_temp.waybill_ops_error('select public.resend_operations_waybill(''c8170000-0000-0000-0000-000000000001'',''driver'',gen_random_uuid(),''DRIVER_REQUEST'',false)', '42501');
    perform pg_temp.waybill_ops_error('select public.retry_operations_waybill_delivery(''c8170000-0000-0000-0000-000000000001'',''driver'',''DELIVERY_UNCONFIRMED'')', '42501');
    perform pg_temp.waybill_ops_error('select public.complete_operations_payment_details((select id from waybill_ops_missing_payment),clock_timestamp(),''Name'',''5555555555'',''Bank'')', '42501');
    perform pg_temp.waybill_ops_error('select public.mark_operations_payment_paid((select id from waybill_ops_payment),clock_timestamp(),''REF'')', '42501');
  end loop;
end $$;
reset role;
rollback;
