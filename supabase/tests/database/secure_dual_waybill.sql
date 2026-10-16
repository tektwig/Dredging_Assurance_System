begin;

create function pg_temp.secure_waybill_assert(v boolean,m text) returns void language plpgsql as $$
begin
  if v is distinct from true then raise exception 'Secure Waybill assertion failed: %',m; end if;
  raise notice 'ASSERTION PASS: %',m;
end
$$;
create function pg_temp.secure_waybill_expect_error(q text,expected_state text) returns void language plpgsql as $$
declare actual_state text;
begin
  begin
    execute q;
  exception when others then
    get stacked diagnostics actual_state=returned_sqlstate;
    if actual_state=expected_state then
      raise notice 'ASSERTION PASS: expected SQLSTATE %',expected_state;
      return;
    end if;
    raise exception 'Expected SQLSTATE %, got %',expected_state,actual_state;
  end;
  raise exception 'Expected SQLSTATE %, statement succeeded',expected_state;
end
$$;
create temp table secure_waybill_state(k text primary key,v jsonb);
grant all on secure_waybill_state to authenticated,service_role;

select pg_temp.secure_waybill_assert(
  (select count(*)=2 and bool_and(not public) and bool_and(file_size_limit=10485760)
    from storage.buckets where id in ('waybill-driver-copies','waybill-company-copies')),
  'driver and company copy buckets are distinct private PDF-only buckets'
);
select pg_temp.secure_waybill_assert(
  not has_table_privilege('authenticated','public.trip_closure_invoice_bank_submissions','SELECT')
  and not has_table_privilege('authenticated','public.trip_closure_invoice_bank_detail_events','SELECT')
  and not has_table_privilege('authenticated','public.trip_closure_invoice_bank_snapshots','SELECT')
  and not has_table_privilege('authenticated','public.trip_closure_invoice_pdf_copies','SELECT')
  and not exists (select 1 from pg_attribute column_info
    where column_info.attrelid='public.trip_closure_invoices'::regclass
      and column_info.attname in ('account_number','account_name','bank_name')
      and not column_info.attisdropped
      and has_column_privilege('authenticated',column_info.attrelid,column_info.attname,'SELECT'))
  and has_column_privilege('authenticated','public.trip_closure_invoices','invoice_number','SELECT'),
  'bank tables and invoice bank columns are not directly readable; safe invoice columns remain available'
);
select pg_temp.secure_waybill_assert(
  not has_function_privilege('anon','public.submit_waybill_company_bank_details(uuid,text,text,text)','EXECUTE')
  and has_function_privilege('authenticated','public.submit_waybill_company_bank_details(uuid,text,text,text)','EXECUTE')
  and has_function_privilege('authenticated','public.verify_waybill_company_bank_details(uuid,boolean,text)','EXECUTE')
  and has_function_privilege('authenticated','public.get_waybill_company_bank_submission_for_review(uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.get_operations_waybill_copy_management_state(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.get_operations_waybill_copy_management_state(uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.get_operations_waybill_copy_management_state(uuid)','EXECUTE')
  and has_function_privilege('service_role','public.claim_driver_waybill_pdf_jobs(integer,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.claim_company_waybill_pdf_jobs(integer,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.claim_driver_waybill_pdf_jobs(integer,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.get_driver_waybill_pdf_snapshot(uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.get_waybill_notification_pdf(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.get_waybill_notification_pdf(uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.claim_waybill_notifications(text,integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.claim_waybill_notifications(text,integer)','EXECUTE')
  and not has_function_privilege('anon','public.claim_waybill_notifications(text,integer)','EXECUTE')
  and has_function_privilege('service_role','public.enqueue_waybill_ready_notifications(text)','EXECUTE')
  and not has_function_privilege('authenticated','public.enqueue_waybill_ready_notifications(text)','EXECUTE')
  and not has_function_privilege('anon','public.enqueue_waybill_ready_notifications(text)','EXECUTE')
  and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='claim_trip_notifications')
  and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prokind='f'
      and p.oid is distinct from to_regprocedure('private.trip_email(jsonb,text[],text)')
      and position('private.trip_email' in lower(pg_get_functiondef(p.oid)))>0)
  and (to_regprocedure('private.trip_email(jsonb,text[],text)') is null
    or not has_function_privilege('service_role',to_regprocedure('private.trip_email(jsonb,text[],text)'),'EXECUTE'))
  and not exists (select 1 from pg_trigger trigger_info
    where not trigger_info.tgisinternal
      and trigger_info.tgfoid=to_regprocedure('private.snapshot_closed_trip()'))
  and not has_function_privilege('service_role','public.claim_waybill_pdf_jobs(integer)','EXECUTE')
  and not has_function_privilege('service_role','public.get_waybill_pdf_snapshot(uuid,uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.get_waybill_ready_pdf(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.retry_waybill_pdf(uuid,text)','EXECUTE'),
  'new worker operations are purpose-specific and legacy bank-bearing worker paths are disabled'
);

insert into auth.users(id,email,raw_user_meta_data) values
  ('d9000000-0000-0000-0000-000000000001','secure-admin@example.invalid','{}'),
  ('d9000000-0000-0000-0000-000000000002','secure-loader@example.invalid','{}'),
  ('d9000000-0000-0000-0000-000000000003','secure-offloader@example.invalid','{}'),
  ('d9000000-0000-0000-0000-000000000004','secure-operations@example.invalid','{}'),
  ('d9000000-0000-0000-0000-000000000005','secure-finance@example.invalid','{}'),
  ('d9000000-0000-0000-0000-000000000006','secure-audit@example.invalid','{}');
update public.profiles
set display_name='Secure Waybill Test User',
  role=case right(id::text,1)
    when '1' then 'system_administrator'::public.app_role
    when '2' then 'loading_officer'::public.app_role
    when '3' then 'offloading_officer'::public.app_role
    when '4' then 'operations_manager'::public.app_role
    when '5' then 'finance_officer'::public.app_role
    else 'audit_reviewer'::public.app_role end,
  is_active=true
where id::text like 'd9000000-%';
insert into public.sites(id,name,site_type,is_active) values
  ('d9100000-0000-0000-0000-000000000001','Secure Test Loading Site','loading',true),
  ('d9100000-0000-0000-0000-000000000002','Secure Test Offloading Site','offloading',true);
insert into public.drivers(id,full_name,phone_number,email,license_number) values
  ('d9200000-0000-0000-0000-000000000001','Synthetic Waybill Driver','08000000000','secure-driver@example.invalid','SYNTHETIC-LIC');
insert into public.trucks(id,registration_number,driver_id,truck_type,capacity,capacity_unit,owner_name) values
  ('d9300000-0000-0000-0000-000000000001','SYN-001','d9200000-0000-0000-0000-000000000001','Synthetic Truck',20,'tonnes','Synthetic Owner');

set local role authenticated;
select set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-000000000001',true);
select public.assign_user_site('d9000000-0000-0000-0000-000000000002','d9100000-0000-0000-0000-000000000001');
select public.assign_user_site('d9000000-0000-0000-0000-000000000003','d9100000-0000-0000-0000-000000000002');
select set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-000000000002',true);
insert into secure_waybill_state values('opened',public.create_loading_trip_v2(
  'd9400000-0000-0000-0000-000000000001','SYN-001','d9200000-0000-0000-0000-000000000001',
  (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
  'MANUAL',clock_timestamp(),12.50));
select set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-000000000003',true);
insert into secure_waybill_state values('closed',public.close_trip_v2(
  'd9500000-0000-0000-0000-000000000001',
  (select (v#>>'{trip,id}')::uuid from secure_waybill_state where k='opened'),
  'SYN-001',(select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
  12.50,'MANUAL',clock_timestamp()));
reset role;

select pg_temp.secure_waybill_assert((
  select count(*)=2 and bool_and(event_type='waybill_ready')
    and bool_and(audience in ('driver','client'))
    and bool_and(not (payload ?| array['bank_name','account_name','account_number',
      'payment_status','driver_phone','driver_email']))
  from public.notification_outbox
  where trip_id=(select (v#>>'{trip,id}')::uuid from secure_waybill_state where k='opened')
), 'closure produces only sanitized driver and company Waybill-ready notifications');

insert into secure_waybill_state
select 'invoice',jsonb_build_object('id',invoice.id,'trip_id',invoice.trip_id,'invoice_number',invoice.invoice_number,
  'trip_number',invoice.trip_number,'closed_at',invoice.closed_at,'quantity_tonnes',invoice.quantity_tonnes)
from public.trip_closure_invoices invoice
where invoice.trip_id=(select (v#>>'{trip,id}')::uuid from secure_waybill_state where k='opened');
select pg_temp.secure_waybill_assert((select count(*)=1 from secure_waybill_state where k='invoice'),
  'synthetic trip closed successfully with no bank details and obtained an immutable Waybill');
alter table public.trip_closure_invoices disable trigger prevent_trip_invoice_mutation;
update public.trip_closure_invoices
set driver_phone=null
where id=(select (v->>'id')::uuid from secure_waybill_state where k='invoice');
alter table public.trip_closure_invoices enable trigger prevent_trip_invoice_mutation;
select pg_temp.secure_waybill_assert((
  select invoice.driver_phone is null and copy.status='blocked_missing_bank_details'
  from public.trip_closure_invoices invoice
  join public.trip_closure_invoice_pdf_copies copy on copy.invoice_id=invoice.id
  where invoice.id=(select (v->>'id')::uuid from secure_waybill_state where k='invoice')
    and copy.copy_kind='company'
), 'a missing phone does not block the company copy; only missing bank details do');
select pg_temp.secure_waybill_assert((
  select count(*)=2 and count(*) filter (where copy_kind='driver' and status='pending'
    and storage_bucket='waybill-driver-copies' and bank_snapshot_id is null and notification_eligible)=1
    and count(*) filter (where copy_kind='company' and status='blocked_missing_bank_details'
      and storage_bucket='waybill-company-copies' and bank_snapshot_id is null and notification_eligible)=1
  from public.trip_closure_invoice_pdf_copies
  where invoice_id=(select (v->>'id')::uuid from secure_waybill_state where k='invoice')
), 'closure queues separate copies and missing bank details block only the company copy');
select pg_temp.secure_waybill_assert((
  select document.storage_path=private.waybill_storage_path(invoice.invoice_number)
  from public.trip_closure_invoices invoice
  join public.trip_closure_invoice_documents document on document.invoice_id=invoice.id
  where invoice.id=(select (v->>'id')::uuid from secure_waybill_state where k='invoice')
), 'the legacy Waybill document row and storage path remain intact');

set local role service_role;
insert into secure_waybill_state
select 'blocked_company_claim',jsonb_build_object('count',count(*))
from public.claim_company_waybill_pdf_jobs(5,(select (v->>'id')::uuid from secure_waybill_state where k='invoice'));
select pg_temp.secure_waybill_assert((select (v->>'count')::integer=0
  from secure_waybill_state where k='blocked_company_claim'),
  'company worker cannot claim a Waybill before verified bank details exist');
insert into secure_waybill_state
select 'driver_claim',to_jsonb(job)
from public.claim_driver_waybill_pdf_jobs(1,(select (v->>'id')::uuid from secure_waybill_state where k='invoice')) job;
insert into secure_waybill_state
select 'driver_snapshot',public.get_driver_waybill_pdf_snapshot(
  (select (v->>'copy_id')::uuid from secure_waybill_state where k='driver_claim'),
  (select (v->>'lease_token')::uuid from secure_waybill_state where k='driver_claim'));
select pg_temp.secure_waybill_assert((
  select v ? 'invoice_number' and not (v ? 'driver_phone')
    and not (v ? 'bank_name') and not (v ? 'account_name') and not (v ? 'account_number')
  from secure_waybill_state where k='driver_snapshot'
), 'driver worker snapshot excludes phone and all bank details');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-000000000004',true);
insert into secure_waybill_state
select 'management_driver_processing',to_jsonb(state)
from public.get_operations_waybill_copy_management_state(
  (select (v->>'id')::uuid from secure_waybill_state where k='invoice')) state;
select pg_temp.secure_waybill_assert((
  select v->>'driver_pdf_status'='processing'
    and v->>'company_pdf_status'='blocked_missing_bank_details'
    and v->>'bank_verification_state'='missing'
  from secure_waybill_state where k='management_driver_processing'
), 'Driver PDF processing is visible independently while the Company PDF remains held');
reset role;
set local role service_role;
select pg_temp.secure_waybill_assert(public.finish_driver_waybill_pdf_job(
  (select (v->>'copy_id')::uuid from secure_waybill_state where k='driver_claim'),
  (select (v->>'lease_token')::uuid from secure_waybill_state where k='driver_claim'),false,'pdf_generation_failed'),
  'driver failure is recorded against its own lease');
reset role;
select pg_temp.secure_waybill_assert((
  select attempts=1 and status='pending' from public.trip_closure_invoice_pdf_copies
  where invoice_id=(select (v->>'id')::uuid from secure_waybill_state where k='invoice') and copy_kind='driver'
), 'a driver retry is scheduled independently while the company copy remains blocked');
reset role;
update public.trip_closure_invoice_pdf_copies set next_attempt_at=clock_timestamp()
where invoice_id=(select (v->>'id')::uuid from secure_waybill_state where k='invoice') and copy_kind='driver';
set local role service_role;
insert into secure_waybill_state
select 'driver_retry_claim',to_jsonb(job)
from public.claim_driver_waybill_pdf_jobs(1,(select (v->>'id')::uuid from secure_waybill_state where k='invoice')) job;
select pg_temp.secure_waybill_assert((
  select (v->>'attempts')::integer=2 and v->>'lease_token'<>
    (select v->>'lease_token' from secure_waybill_state where k='driver_claim')
  from secure_waybill_state where k='driver_retry_claim'
), 'driver retry receives an independent attempt count and fresh lease');
select pg_temp.secure_waybill_assert(public.finish_driver_waybill_pdf_job(
  (select (v->>'copy_id')::uuid from secure_waybill_state where k='driver_retry_claim'),
  (select (v->>'lease_token')::uuid from secure_waybill_state where k='driver_retry_claim'),true,null),
  'driver copy completes only with its active lease');
select pg_temp.secure_waybill_assert(public.get_driver_waybill_pdf_snapshot(
  (select (v->>'copy_id')::uuid from secure_waybill_state where k='driver_retry_claim'),
  (select (v->>'lease_token')::uuid from secure_waybill_state where k='driver_retry_claim')) is null,
  'a completed or stale driver lease cannot read the PDF snapshot again');
reset role;
insert into secure_waybill_state
select 'legacy_notification_before_claim',to_jsonb(notification)
from public.notification_outbox notification
join public.trips historical_trip on historical_trip.id=notification.trip_id
join public.trucks historical_truck on historical_truck.id=historical_trip.truck_id
where historical_truck.normalized_registration='HYB102'
  and notification.event_type='waybill_ready' and notification.audience='driver'
limit 1;
update public.notification_outbox notification
set status='pending',recipients=array[invoice.driver_email],attempts=8,
    first_attempt_at=statement_timestamp()-interval '24 hours',
    next_attempt_at=statement_timestamp()-interval '24 hours',lease_token=null,lease_until=null,
    blocked_reason_code=null,last_error='synthetic historical retry-limit state',
    payload=notification.payload||jsonb_build_object('invoice_id',invoice.id,'invoice_number',invoice.invoice_number)
from public.trip_closure_invoices invoice
where notification.id=(select (v->>'id')::uuid from secure_waybill_state
  where k='legacy_notification_before_claim')
  and invoice.trip_id=notification.trip_id;
update secure_waybill_state
set v=(select to_jsonb(notification) from public.notification_outbox notification
  where notification.id=(select (v->>'id')::uuid from secure_waybill_state
    where k='legacy_notification_before_claim'))
where k='legacy_notification_before_claim';
select pg_temp.secure_waybill_assert((
  select notification.status='pending' and notification.attempts=8
    and notification.first_attempt_at<statement_timestamp()-interval '23 hours'
    and invoice.driver_email is not null and notification.recipients=array[invoice.driver_email]
    and notification.payload->>'invoice_id'=invoice.id::text
    and notification.payload->>'invoice_number'=invoice.invoice_number
    and not exists(select 1 from public.trip_closure_invoice_pdf_copies copy
      where copy.invoice_id=invoice.id and copy.copy_kind='driver')
  from secure_waybill_state historical_state
  join public.notification_outbox notification on notification.id=(historical_state.v->>'id')::uuid
  join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id
  where historical_state.k='legacy_notification_before_claim'
), 'historical Waybill notification is stale and lacks a dual-copy workflow');
set local role service_role;
insert into secure_waybill_state
select 'driver_notification',to_jsonb(job)
from public.claim_waybill_notifications('TRAKFLIT <notify@example.invalid>',5) job;
reset role;
select pg_temp.secure_waybill_assert((
  select to_jsonb(notification)=historical_state.v
  from secure_waybill_state historical_state
  join public.notification_outbox notification on notification.id=(historical_state.v->>'id')::uuid
  where historical_state.k='legacy_notification_before_claim'
), 'claiming new work does not fail, retry, lease, or otherwise mutate a stale historical waybill_ready notification');
select pg_temp.secure_waybill_assert((
  select count(*)=1 and bool_and(v->>'audience'='driver')
    and bool_and(v->>'event_type'='waybill_ready')
  from secure_waybill_state where k='driver_notification'
), 'ready driver PDF can be claimed while missing verified bank data keeps company delivery held');
set local role service_role;
insert into secure_waybill_state
select 'driver_notification_pdf',to_jsonb(metadata)
from public.get_waybill_notification_pdf(
  (select (v->>'id')::uuid from secure_waybill_state where k='driver_notification'),
  (select (v->>'lease_token')::uuid from secure_waybill_state where k='driver_notification')) metadata;
select pg_temp.secure_waybill_assert((
  select v->>'copy_kind'='driver' and v->>'storage_bucket'='waybill-driver-copies'
    and not (v ? 'account_number')
  from secure_waybill_state where k='driver_notification_pdf'
), 'driver notification resolves only its safe, lease-bound PDF');
select pg_temp.secure_waybill_assert(public.finish_trip_notification(
  (select (v->>'id')::uuid from secure_waybill_state where k='driver_notification'),
  (select (v->>'lease_token')::uuid from secure_waybill_state where k='driver_notification'),
  true,'synthetic-driver-delivery',null),
  'driver notification acknowledgement completes only its own leased row');
reset role;
select pg_temp.secure_waybill_assert((
  select (select status from public.notification_outbox where id=(v->>'id')::uuid)='sent'
    and (select status from public.notification_outbox where trip_id=(select (v->>'trip_id')::uuid
      from secure_waybill_state where k='invoice') and event_type='waybill_ready' and audience='client')='blocked_configuration'
  from secure_waybill_state where k='driver_notification'
), 'driver delivery completion leaves the independent Company notification held');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-000000000001',true);
select pg_temp.secure_waybill_expect_error(format(
  'select public.submit_waybill_company_bank_details(%L,%L,%L,%L)',
  (select v->>'id' from secure_waybill_state where k='invoice'),'Synthetic Bank','Synthetic Account','1234567890'
), '42501');
select pg_temp.secure_waybill_expect_error(format(
  'select * from public.get_operations_waybill_copy_management_state(%L)',
  (select v->>'id' from secure_waybill_state where k='invoice')
), '42501');
select pg_temp.secure_waybill_expect_error(format(
  'select * from public.get_operations_waybill_pdf_copy(%L,%L)',
  (select v->>'id' from secure_waybill_state where k='invoice'),'company'
), '42501');
select pg_temp.secure_waybill_expect_error(format(
  'select * from public.get_waybill_bank_detail_audit(%L)',
  (select v->>'id' from secure_waybill_state where k='invoice')
), '42501');
select pg_temp.secure_waybill_expect_error('select * from public.trip_closure_invoice_bank_submissions','42501');
select pg_temp.secure_waybill_expect_error('select * from public.trip_closure_invoice_bank_snapshots','42501');
select set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-000000000005',true);
select pg_temp.secure_waybill_expect_error(format(
  'select public.submit_waybill_company_bank_details(%L,%L,%L,%L)',
  (select v->>'id' from secure_waybill_state where k='invoice'),'Synthetic Bank','Synthetic Account','1234567890'
), '42501');
select pg_temp.secure_waybill_expect_error(format(
  'select * from public.get_operations_waybill_copy_management_state(%L)',
  (select v->>'id' from secure_waybill_state where k='invoice')
), '42501');
select set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-000000000004',true);
insert into secure_waybill_state
select 'management_missing',to_jsonb(state)
from public.get_operations_waybill_copy_management_state(
  (select (v->>'id')::uuid from secure_waybill_state where k='invoice')) state;
select pg_temp.secure_waybill_assert((
  select v->>'invoice_id'=(select v->>'id' from secure_waybill_state where k='invoice')
    and v->>'driver_pdf_status'='ready' and v->>'company_pdf_status'='blocked_missing_bank_details'
    and v->>'bank_verification_state'='missing' and v->>'pending_bank_submission_id' is null
    and v->>'latest_bank_snapshot_version' is null
    and v->>'company_pdf_held_for_missing_bank_details'='true'
    and v->>'driver_pdf_ready_at' is not null and v->>'company_pdf_ready_at' is null
    and not (v ?| array['bank_name','account_name','account_number','storage_path','storage_bucket'])
  from secure_waybill_state where k='management_missing'
), 'Operations Manager state reports missing banking and separate initial PDF statuses without sensitive values or paths');
insert into secure_waybill_state values('detail',public.get_operations_waybill_detail(
  (select (v->>'id')::uuid from secure_waybill_state where k='invoice')));
select pg_temp.secure_waybill_assert((
  select v ? 'invoice' and v ? 'document' and v ? 'delivery'
    and not (v ? 'payment') and not ((v->'invoice') ? 'bank_name')
    and not ((v->'invoice') ? 'account_name') and not ((v->'invoice') ? 'account_number')
  from secure_waybill_state where k='detail'
), 'generic Operations Waybill response contains no payment or banking fields');
insert into secure_waybill_state
select 'submission',jsonb_build_object('id',public.submit_waybill_company_bank_details(
  (select (v->>'id')::uuid from secure_waybill_state where k='invoice'),
  'Synthetic Bank','Synthetic Account','1234567890'));
insert into secure_waybill_state
select 'management_pending',to_jsonb(state)
from public.get_operations_waybill_copy_management_state(
  (select (v->>'id')::uuid from secure_waybill_state where k='invoice')) state;
select pg_temp.secure_waybill_assert((
  select v->>'bank_verification_state'='pending_verification'
    and v->>'pending_bank_submission_id'=(select v->>'id' from secure_waybill_state where k='submission')
    and v->>'company_pdf_status'='blocked_bank_details_unverified'
    and v->>'company_pdf_held_for_missing_bank_details'='false'
    and not (v ?| array['bank_name','account_name','account_number','storage_path','storage_bucket'])
  from secure_waybill_state where k='management_pending'
), 'pending verification can be resumed by submission ID without returning bank values or PDF paths');
reset role;
select pg_temp.secure_waybill_assert((
  select status='blocked_bank_details_unverified'
  from public.trip_closure_invoice_pdf_copies
  where invoice_id=(select (v->>'id')::uuid from secure_waybill_state where k='invoice')
    and copy_kind='company'
), 'submission alone does not release the company PDF');
set local role authenticated;
select set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-000000000001',true);
select pg_temp.secure_waybill_expect_error(format(
  'select public.verify_waybill_company_bank_details(%L,true,null)',
  (select v->>'id' from secure_waybill_state where k='submission')
), '42501');
select pg_temp.secure_waybill_expect_error(format(
  'select * from public.get_waybill_company_bank_submission_for_review(%L)',
  (select v->>'id' from secure_waybill_state where k='submission')
), '42501');
select pg_temp.secure_waybill_expect_error(format(
  'select * from public.get_waybill_bank_detail_audit(%L)',
  (select v->>'id' from secure_waybill_state where k='invoice')
), '42501');
select set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-000000000005',true);
select pg_temp.secure_waybill_expect_error(format(
  'select public.verify_waybill_company_bank_details(%L,true,null)',
  (select v->>'id' from secure_waybill_state where k='submission')
), '42501');
select pg_temp.secure_waybill_expect_error(format(
  'select * from public.get_waybill_company_bank_submission_for_review(%L)',
  (select v->>'id' from secure_waybill_state where k='submission')
), '42501');
select set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-000000000004',true);
insert into secure_waybill_state
select 'bank_review',to_jsonb(review)
from public.get_waybill_company_bank_submission_for_review(
  (select (v->>'id')::uuid from secure_waybill_state where k='submission')) review;
select pg_temp.secure_waybill_assert((
  select v ? 'bank_name' and v ? 'account_name' and v ? 'account_number'
    and v ? 'submitted_by' and v ? 'submitted_at'
  from secure_waybill_state where k='bank_review'
), 'the submitting Operations Manager can review details and the review is audited');
insert into secure_waybill_state
select 'rejection',to_jsonb(public.verify_waybill_company_bank_details(
  (select (v->>'id')::uuid from secure_waybill_state where k='submission'),false,'mismatch'));
insert into secure_waybill_state
select 'management_rejected',to_jsonb(state)
from public.get_operations_waybill_copy_management_state(
  (select (v->>'id')::uuid from secure_waybill_state where k='invoice')) state;
select pg_temp.secure_waybill_assert((
  select v->>'bank_verification_state'='rejected'
    and v->>'company_pdf_status'='blocked_bank_details_unverified'
    and v->>'company_pdf_held_for_missing_bank_details'='false'
    and v->>'pending_bank_submission_id' is null
  from secure_waybill_state where k='management_rejected'
), 'rejected bank details remain held as unverified rather than incorrectly marked missing');
reset role;
select pg_temp.secure_waybill_assert((
  select status='blocked_bank_details_unverified'
  from public.trip_closure_invoice_pdf_copies
  where invoice_id=(select (v->>'id')::uuid from secure_waybill_state where k='invoice')
    and copy_kind='company'
), 'a rejected submission keeps only the company PDF blocked');
set local role authenticated;
select set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-000000000004',true);
insert into secure_waybill_state
select 'resubmission',jsonb_build_object('id',public.submit_waybill_company_bank_details(
  (select (v->>'id')::uuid from secure_waybill_state where k='invoice'),
  'Synthetic Bank','Synthetic Account','1111111111'));
reset role;

set local role anon;
select pg_temp.secure_waybill_assert((select count(*)=0 from storage.objects
  where bucket_id in ('waybill-driver-copies','waybill-company-copies','waybills')),
  'Anonymous callers cannot access any Waybill Storage bucket');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-000000000004',true);
insert into secure_waybill_state
select 'resubmission_review',to_jsonb(review)
from public.get_waybill_company_bank_submission_for_review(
  (select (v->>'id')::uuid from secure_waybill_state where k='resubmission')) review;
insert into secure_waybill_state
select 'verification',to_jsonb(public.verify_waybill_company_bank_details(
  (select (v->>'id')::uuid from secure_waybill_state where k='resubmission'),true,null));
insert into secure_waybill_state
select 'management_verified',to_jsonb(state)
from public.get_operations_waybill_copy_management_state(
  (select (v->>'id')::uuid from secure_waybill_state where k='invoice')) state;
select pg_temp.secure_waybill_assert((
  select v->>'bank_verification_state'='verified'
    and v->>'latest_bank_snapshot_version'='1'
    and v->>'company_pdf_status'='pending'
    and v->>'company_pdf_held_for_missing_bank_details'='false'
    and v->>'pending_bank_submission_id' is null
  from secure_waybill_state where k='management_verified'
), 'verified bank snapshot state and first Company PDF pending status are reported without bank values');
select pg_temp.secure_waybill_assert((select count(*)=6 from public.get_waybill_bank_detail_audit(
  (select (v->>'id')::uuid from secure_waybill_state where k='invoice'))),
  'the same Operations Manager submit/review/reject/resubmit/review/verify events are auditable');
select pg_temp.secure_waybill_expect_error('select * from public.trip_closure_invoice_bank_snapshots','42501');
select pg_temp.secure_waybill_assert((
  select count(*)=0 from public.get_operations_waybill_pdf_copy(
    (select (v->>'id')::uuid from secure_waybill_state where k='invoice'),'company')
), 'Operations Manager cannot download a Company PDF before a ready copy exists');
reset role;

select pg_temp.secure_waybill_assert((
  select copy.status='pending' and copy.bank_snapshot_id=snapshot.id
    and snapshot.submitted_by=snapshot.verified_by and snapshot.verified_at>=snapshot.submitted_at
    and invoice.closed_at=(select (v->>'closed_at')::timestamptz from secure_waybill_state where k='invoice')
    and invoice.quantity_tonnes=(select (v->>'quantity_tonnes')::numeric from secure_waybill_state where k='invoice')
  from public.trip_closure_invoice_pdf_copies copy
  join public.trip_closure_invoice_bank_snapshots snapshot
    on snapshot.id=copy.bank_snapshot_id and snapshot.invoice_id=copy.invoice_id
  join public.trip_closure_invoices invoice on invoice.id=copy.invoice_id
  where copy.invoice_id=(select (v->>'id')::uuid from secure_waybill_state where k='invoice')
    and copy.copy_kind='company'
), 'verified bank details are snapshotted separately and do not rewrite closed Waybill facts');
select pg_temp.secure_waybill_expect_error(format(
  'update public.trip_closure_invoice_bank_snapshots set account_name=%L where invoice_id=%L',
  'Changed Synthetic Account',(select v->>'id' from secure_waybill_state where k='invoice')
), '23514');
select pg_temp.secure_waybill_expect_error(format(
  'update public.trip_closure_invoice_bank_detail_events set reason_code=%L where invoice_id=%L and event_type=%L',
  'changed',(select v->>'id' from secure_waybill_state where k='invoice'),'submitted'
), '23514');

set local role service_role;
insert into secure_waybill_state
select 'company_claim',to_jsonb(job)
from public.claim_company_waybill_pdf_jobs(1,(select (v->>'id')::uuid from secure_waybill_state where k='invoice')) job;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-000000000004',true);
insert into secure_waybill_state
select 'management_company_processing',to_jsonb(state)
from public.get_operations_waybill_copy_management_state(
  (select (v->>'id')::uuid from secure_waybill_state where k='invoice')) state;
select pg_temp.secure_waybill_assert((
  select v->>'driver_pdf_status'='ready' and v->>'company_pdf_status'='processing'
    and v->>'bank_verification_state'='verified'
    and v->>'latest_bank_snapshot_version'='1'
  from secure_waybill_state where k='management_company_processing'
), 'Company PDF processing is reported separately from the ready Driver PDF');
reset role;
set local role service_role;
insert into secure_waybill_state
select 'company_snapshot',public.get_company_waybill_pdf_snapshot(
  (select (v->>'copy_id')::uuid from secure_waybill_state where k='company_claim'),
  (select (v->>'lease_token')::uuid from secure_waybill_state where k='company_claim'));
select pg_temp.secure_waybill_assert((
  select v ? 'driver_phone' and v ? 'bank_name' and v ? 'account_name' and v ? 'account_number'
    and v->'driver_phone'='null'::jsonb
  from secure_waybill_state where k='company_snapshot'
), 'company worker snapshot permits a missing phone and contains the verified bank snapshot');
select pg_temp.secure_waybill_assert(public.finish_company_waybill_pdf_job(
  (select (v->>'copy_id')::uuid from secure_waybill_state where k='company_claim'),
  (select (v->>'lease_token')::uuid from secure_waybill_state where k='company_claim'),true,null),
  'company copy completes only with a verified snapshot and active lease');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-000000000004',true);
insert into secure_waybill_state
select 'management_company_ready',to_jsonb(state)
from public.get_operations_waybill_copy_management_state(
  (select (v->>'id')::uuid from secure_waybill_state where k='invoice')) state;
select pg_temp.secure_waybill_assert((
  select v->>'driver_pdf_status'='ready' and v->>'company_pdf_status'='ready'
    and v->>'company_pdf_ready_at' is not null and v->>'latest_bank_snapshot_version'='1'
  from secure_waybill_state where k='management_company_ready'
), 'both ready timestamps appear only after each independent PDF completes');
reset role;
update public.notification_outbox notification
set payload=payload||jsonb_build_object('storage_path','legacy/untrusted-bank-bearing.pdf'),
    status='pending',recipients=null,blocked_reason_code=null,last_error=null
where notification.trip_id=(select (v->>'trip_id')::uuid from secure_waybill_state where k='invoice')
  and notification.event_type='waybill_ready' and notification.audience='client';
set local role service_role;
select public.enqueue_waybill_ready_notifications(null);
reset role;
select pg_temp.secure_waybill_assert((
  select status='blocked_configuration' and blocked_reason_code='company_recipient_not_configured'
  from public.notification_outbox
  where trip_id=(select (v->>'trip_id')::uuid from secure_waybill_state where k='invoice')
    and event_type='waybill_ready' and audience='client'
), 'Company delivery without a configured recipient remains explicitly blocked');
set local role service_role;
select public.enqueue_waybill_ready_notifications('synthetic-company@example.invalid');
insert into secure_waybill_state
select 'company_notification',to_jsonb(job)
from public.claim_waybill_notifications('TRAKFLIT <notify@example.invalid>',5) job;
reset role;

select pg_temp.secure_waybill_assert((
  select count(*)=1 and bool_and(v->>'audience'='client') and bool_and(v->>'event_type'='waybill_ready')
    and bool_and(v->'recipients'='["synthetic-company@example.invalid"]'::jsonb)
  from secure_waybill_state where k='company_notification'
), 'company notification is independently claimable only after a verified Company PDF is ready');

set local role service_role;
insert into secure_waybill_state
select 'company_attachment',to_jsonb(metadata)
from public.get_waybill_notification_pdf(
  (select (v->>'id')::uuid from secure_waybill_state where k='company_notification'),
  (select (v->>'lease_token')::uuid from secure_waybill_state where k='company_notification')) metadata;
select pg_temp.secure_waybill_assert((
  select count(*)=0 from public.get_waybill_notification_pdf(
    (select (v->>'id')::uuid from secure_waybill_state where k='company_notification'),
    'd9600000-0000-0000-0000-000000000009')
), 'an incorrect notification lease cannot obtain any copy path');
reset role;
select pg_temp.secure_waybill_assert((
  select (select v->>'copy_kind' from secure_waybill_state where k='company_attachment')='company'
    and (select v->>'storage_bucket' from secure_waybill_state where k='company_attachment')='waybill-company-copies'
    and (select v->>'storage_path' from secure_waybill_state where k='company_attachment')
      =private.secure_waybill_copy_storage_path(
        (select v->>'invoice_number' from secure_waybill_state where k='invoice'),'company',1)
    and not exists (select 1 from secure_waybill_state where k='company_attachment' and v ? 'account_number')
    and (select v->>'copy_kind' from secure_waybill_state where k='driver_notification_pdf')='driver'
    and (select v->>'storage_bucket' from secure_waybill_state where k='driver_notification_pdf')='waybill-driver-copies'
    and not exists (select 1 from secure_waybill_state where k='driver_notification_pdf' and v ? 'account_number')
), 'recipient notification leases resolve only their own secure copy and ignore legacy payload paths');
select pg_temp.secure_waybill_assert(public.finish_trip_notification(
  (select (v->>'id')::uuid from secure_waybill_state where k='company_notification'),
  (select (v->>'lease_token')::uuid from secure_waybill_state where k='company_notification'),
  true,'synthetic-company-delivery',null),
  'Company acknowledgement completes only its own leased recipient job');
reset role;
select pg_temp.secure_waybill_assert((
  select count(*)=2 and bool_and(status='sent')
  from public.notification_outbox
  where trip_id=(select (v->>'trip_id')::uuid from secure_waybill_state where k='invoice')
    and event_type='waybill_ready' and audience in ('driver','client')
), 'driver and Company notifications complete independently with preserved recipient-specific statuses');

insert into storage.objects(bucket_id,name,owner_id,metadata)
select copy.storage_bucket,copy.storage_path,'d9000000-0000-0000-0000-000000000001',
  jsonb_build_object('mimetype','application/pdf','size',1234)
from public.trip_closure_invoice_pdf_copies copy
where copy.invoice_id=(select (v->>'id')::uuid from secure_waybill_state where k='invoice')
union all
select 'waybills',document.storage_path,'d9000000-0000-0000-0000-000000000001',
  jsonb_build_object('mimetype','application/pdf','size',1234)
from public.trip_closure_invoice_documents document
where document.invoice_id=(select (v->>'id')::uuid from secure_waybill_state where k='invoice');

set local role anon;
select pg_temp.secure_waybill_assert((select count(*)=0 from storage.objects where bucket_id='waybills'),
  'Anonymous callers cannot read seeded legacy Waybill Storage objects');
select pg_temp.secure_waybill_assert((select count(*)=0 from storage.objects where bucket_id='waybill-driver-copies'),
  'Anonymous callers cannot read seeded Driver PDF Storage objects');
select pg_temp.secure_waybill_assert((select count(*)=0 from storage.objects where bucket_id='waybill-company-copies'),
  'Anonymous callers cannot read seeded Company PDF Storage objects');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-000000000004',true);
insert into secure_waybill_state
select 'company_download',to_jsonb(copy)
from public.get_operations_waybill_pdf_copy(
  (select (v->>'id')::uuid from secure_waybill_state where k='invoice'),'company') copy;
select pg_temp.secure_waybill_assert((
  select v->>'storage_bucket'='waybill-company-copies'
    and v->>'storage_path'=private.waybill_storage_path((select v->>'invoice_number' from secure_waybill_state where k='invoice'))
  from secure_waybill_state where k='company_download'
), 'Operations Manager obtains a company path only through its purpose-specific RPC');
select pg_temp.secure_waybill_assert((
  select count(*)=1 from storage.objects
  where bucket_id='waybill-company-copies'
    and name=(select v->>'storage_path' from secure_waybill_state where k='company_download')
), 'Operations Manager can access the private company-copy Storage object');
select pg_temp.secure_waybill_assert((
  select count(*)=1 from storage.objects
  where bucket_id='waybill-driver-copies'
    and name=(select v->>'storage_path' from secure_waybill_state where k='driver_claim')
), 'Operations Manager can access the private driver-copy Storage object');
select pg_temp.secure_waybill_assert((
  select count(*)=1 from storage.objects where bucket_id='waybills'
    and name=private.waybill_storage_path((select v->>'invoice_number' from secure_waybill_state where k='invoice'))
), 'Operations Manager retains access to existing legacy Waybill files');
select set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-000000000001',true);
select pg_temp.secure_waybill_expect_error(format(
  'select * from public.get_operations_waybill_pdf_copy(%L,%L)',
  (select v->>'id' from secure_waybill_state where k='invoice'),'company'
), '42501');
select pg_temp.secure_waybill_assert((select count(*)=0 from storage.objects
  where bucket_id in ('waybill-driver-copies','waybill-company-copies')),
  'System Administrator cannot access either new dual-copy bucket');
select pg_temp.secure_waybill_assert((select count(*)=0 from storage.objects where bucket_id='waybill-driver-copies'),
  'System Administrator cannot read seeded Driver PDF Storage objects');
select pg_temp.secure_waybill_assert((select count(*)=0 from storage.objects where bucket_id='waybill-company-copies'),
  'System Administrator cannot read seeded Company PDF Storage objects');
select pg_temp.secure_waybill_assert((select count(*)=1 from storage.objects
  where bucket_id='waybills'
    and name=private.waybill_storage_path((select v->>'invoice_number' from secure_waybill_state where k='invoice'))),
  'System Administrator retains the historical legacy Waybill Storage grant');
select set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-000000000005',true);
select pg_temp.secure_waybill_assert((select count(*)=0 from storage.objects
  where bucket_id in ('waybill-driver-copies','waybill-company-copies')),
  'Finance Officer cannot access either new dual-copy bucket');
select pg_temp.secure_waybill_assert((select count(*)=0 from storage.objects where bucket_id='waybill-driver-copies'),
  'Finance Officer cannot read seeded Driver PDF Storage objects');
select pg_temp.secure_waybill_assert((select count(*)=0 from storage.objects where bucket_id='waybill-company-copies'),
  'Finance Officer cannot read seeded Company PDF Storage objects');
select pg_temp.secure_waybill_expect_error(format(
  'select * from public.get_operations_waybill_pdf_copy(%L,%L)',
  (select v->>'id' from secure_waybill_state where k='invoice'),'company'
), '42501');
select pg_temp.secure_waybill_assert((select count(*)=1 from storage.objects
  where bucket_id='waybills'
    and name=private.waybill_storage_path((select v->>'invoice_number' from secure_waybill_state where k='invoice'))),
  'Finance Officer retains the historical legacy Waybill Storage grant');
select set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-000000000006',true);
select pg_temp.secure_waybill_assert((select count(*)=0 from storage.objects
  where bucket_id in ('waybill-driver-copies','waybill-company-copies')),
  'Audit Reviewer cannot access either new dual-copy bucket');
select pg_temp.secure_waybill_assert((select count(*)=0 from storage.objects where bucket_id='waybill-driver-copies'),
  'Audit Reviewer cannot read seeded Driver PDF Storage objects');
select pg_temp.secure_waybill_assert((select count(*)=0 from storage.objects where bucket_id='waybill-company-copies'),
  'Audit Reviewer cannot read seeded Company PDF Storage objects');
select pg_temp.secure_waybill_expect_error(format(
  'select * from public.get_operations_waybill_pdf_copy(%L,%L)',
  (select v->>'id' from secure_waybill_state where k='invoice'),'company'
), '42501');
select pg_temp.secure_waybill_assert((select count(*)=1 from storage.objects
  where bucket_id='waybills'
    and name=private.waybill_storage_path((select v->>'invoice_number' from secure_waybill_state where k='invoice'))),
  'Audit Reviewer retains the historical legacy Waybill Storage grant');
select set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-000000000002',true);
select pg_temp.secure_waybill_assert((select count(*)=0 from storage.objects
  where bucket_id in ('waybill-driver-copies','waybill-company-copies','waybills')),
  'Loading Officer cannot download either Waybill copy');
select pg_temp.secure_waybill_assert((select count(*)=0 from storage.objects where bucket_id='waybill-driver-copies'),
  'Loading Officer cannot read seeded Driver PDF Storage objects');
select pg_temp.secure_waybill_assert((select count(*)=0 from storage.objects where bucket_id='waybill-company-copies'),
  'Loading Officer cannot read seeded Company PDF Storage objects');
select pg_temp.secure_waybill_assert((select count(*)=0 from storage.objects where bucket_id='waybills'),
  'Loading Officer cannot read seeded legacy Waybill Storage objects');
select set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-000000000003',true);
select pg_temp.secure_waybill_assert((select count(*)=0 from storage.objects
  where bucket_id in ('waybill-driver-copies','waybill-company-copies','waybills')),
  'Offloading Officer cannot download either Waybill copy');
select pg_temp.secure_waybill_assert((select count(*)=0 from storage.objects where bucket_id='waybill-driver-copies'),
  'Offloading Officer cannot read seeded Driver PDF Storage objects');
select pg_temp.secure_waybill_assert((select count(*)=0 from storage.objects where bucket_id='waybill-company-copies'),
  'Offloading Officer cannot read seeded Company PDF Storage objects');
select pg_temp.secure_waybill_assert((select count(*)=0 from storage.objects where bucket_id='waybills'),
  'Offloading Officer cannot read seeded legacy Waybill Storage objects');
select pg_temp.secure_waybill_expect_error(format(
  'insert into storage.objects(bucket_id,name,owner_id,metadata) values(%L,%L,auth.uid()::text,%L::jsonb)',
  'waybill-company-copies','forbidden.pdf','{"mimetype":"application/pdf"}'
), '42501');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-000000000004',true);
insert into secure_waybill_state
select 'correction',jsonb_build_object('id',public.submit_waybill_company_bank_details(
  (select (v->>'id')::uuid from secure_waybill_state where k='invoice'),
  'Corrected Synthetic Bank','Corrected Synthetic Account','2222222222'));
insert into secure_waybill_state
select 'management_correction_review_pending',to_jsonb(state)
from public.get_operations_waybill_copy_management_state(
  (select (v->>'id')::uuid from secure_waybill_state where k='invoice')) state;
select pg_temp.secure_waybill_assert((
  select v->>'bank_verification_state'='correction_pending'
    and v->>'pending_bank_submission_id'=(select v->>'id' from secure_waybill_state where k='correction')
    and v->>'latest_bank_snapshot_version'='1' and v->>'company_pdf_status'='ready'
  from secure_waybill_state where k='management_correction_review_pending'
), 'an unfinished correction is resumable while the prior verified snapshot and Company PDF remain current');
insert into secure_waybill_state
select 'correction_review',to_jsonb(review)
from public.get_waybill_company_bank_submission_for_review(
  (select (v->>'id')::uuid from secure_waybill_state where k='correction')) review;
insert into secure_waybill_state
select 'correction_verification',to_jsonb(public.verify_waybill_company_bank_details(
  (select (v->>'id')::uuid from secure_waybill_state where k='correction'),true,null));
insert into secure_waybill_state
select 'management_correction_pending',to_jsonb(state)
from public.get_operations_waybill_copy_management_state(
  (select (v->>'id')::uuid from secure_waybill_state where k='invoice')) state;
select pg_temp.secure_waybill_assert((
  select v->>'bank_verification_state'='verified'
    and v->>'latest_bank_snapshot_version'='2'
    and v->>'company_pdf_status'='pending'
    and v->>'pending_bank_submission_id' is null
  from secure_waybill_state where k='management_correction_pending'
), 'verified corrections advance the bank snapshot version and expose the new Company PDF generation state');
select pg_temp.secure_waybill_assert((
  select v='"corrected"'::jsonb from secure_waybill_state where k='correction_verification'
), 'the Operations Manager verifies a correction as a new version');
reset role;

select pg_temp.secure_waybill_assert((
  select count(*)=2
    and count(*) filter (where version=1 and supersedes_snapshot_id is null
      and account_number='1111111111')=1
    and count(*) filter (where version=2 and supersedes_snapshot_id is not null
      and account_number='2222222222')=1
  from public.trip_closure_invoice_bank_snapshots
  where invoice_id=(select (v->>'id')::uuid from secure_waybill_state where k='invoice')
), 'corrections append a new verified snapshot and preserve historical bank values');
select pg_temp.secure_waybill_assert((
  select count(*)=2
    and count(*) filter (where copy_version=1 and status='ready'
      and storage_path=private.waybill_storage_path(invoice_number))=1
    and count(*) filter (where copy_version=2 and status='pending'
      and not notification_eligible
      and storage_path<>private.waybill_storage_path(invoice_number))=1
  from public.trip_closure_invoice_pdf_copies
  where invoice_id=(select (v->>'id')::uuid from secure_waybill_state where k='invoice')
    and copy_kind='company'
), 'correction generation uses a separate versioned path and leaves the prior PDF untouched');

set local role service_role;
insert into secure_waybill_state
select 'correction_claim',to_jsonb(job)
from public.claim_company_waybill_pdf_jobs(1,(select (v->>'id')::uuid from secure_waybill_state where k='invoice')) job;
insert into secure_waybill_state
select 'correction_snapshot',public.get_company_waybill_pdf_snapshot(
  (select (v->>'copy_id')::uuid from secure_waybill_state where k='correction_claim'),
  (select (v->>'lease_token')::uuid from secure_waybill_state where k='correction_claim'));
select pg_temp.secure_waybill_assert((
  select v->>'account_number'='2222222222' and v->'driver_phone'='null'::jsonb
  from secure_waybill_state where k='correction_snapshot'
), 'corrected company PDF uses the new snapshot without requiring a driver phone');
select pg_temp.secure_waybill_assert(public.finish_company_waybill_pdf_job(
  (select (v->>'copy_id')::uuid from secure_waybill_state where k='correction_claim'),
  (select (v->>'lease_token')::uuid from secure_waybill_state where k='correction_claim'),true,null),
  'corrected company PDF completes without changing the prior version');
select pg_temp.secure_waybill_assert((select count(*)=0 from public.get_waybill_notification_pdf(
  (select (v->>'id')::uuid from secure_waybill_state where k='company_notification'),
  'd9600000-0000-0000-0000-000000000002')),
  'a correction cannot silently replace the PDF in an already queued company notification');
reset role;
insert into storage.objects(bucket_id,name,owner_id,metadata)
select copy.storage_bucket,copy.storage_path,'d9000000-0000-0000-0000-000000000001',
  jsonb_build_object('mimetype','application/pdf','size',1234)
from public.trip_closure_invoice_pdf_copies copy
where copy.invoice_id=(select (v->>'id')::uuid from secure_waybill_state where k='invoice')
  and copy.copy_kind='company' and copy.copy_version=2;
set local role authenticated;
select set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-000000000004',true);
insert into secure_waybill_state
select 'management_correction_ready',to_jsonb(state)
from public.get_operations_waybill_copy_management_state(
  (select (v->>'id')::uuid from secure_waybill_state where k='invoice')) state;
select pg_temp.secure_waybill_assert((
  select v->>'company_pdf_status'='ready' and v->>'company_pdf_ready_at' is not null
    and v->>'latest_bank_snapshot_version'='2'
  from secure_waybill_state where k='management_correction_ready'
), 'the management state follows the ready corrected Company PDF version');
insert into secure_waybill_state
select 'latest_company_download',to_jsonb(copy)
from public.get_operations_waybill_pdf_copy(
  (select (v->>'id')::uuid from secure_waybill_state where k='invoice'),'company') copy;
select pg_temp.secure_waybill_assert((
  select v->>'storage_path'<>
      (select v->>'storage_path' from secure_waybill_state where k='company_download')
    and v->>'storage_path' like '%-company-v2.pdf'
  from secure_waybill_state where k='latest_company_download'
), 'Operations Manager download resolves to the latest ready correction version');
select pg_temp.secure_waybill_assert((
  select count(*)=2 from storage.objects
  where bucket_id='waybill-company-copies'
    and name in (
      (select v->>'storage_path' from secure_waybill_state where k='company_download'),
      (select v->>'storage_path' from secure_waybill_state where k='latest_company_download')
    )
), 'both historical and corrected company PDF objects remain stored');
select pg_temp.secure_waybill_assert((
  select count(*)=9 from public.get_waybill_bank_detail_audit(
    (select (v->>'id')::uuid from secure_waybill_state where k='invoice'))
), 'audit history is available to Operations Managers');
reset role;

select pg_temp.secure_waybill_assert((
  select count(*)=9 and count(*) filter (where audit.event_type='submitted')=2
    and count(*) filter (where audit.event_type='correction_submitted')=1
    and count(*) filter (where audit.event_type='review_viewed')=3
    and count(*) filter (where audit.event_type='rejected')=1
    and count(*) filter (where audit.event_type='verified')=1
    and count(*) filter (where audit.event_type='correction_verified')=1
    and bool_and(audit.actor_id='d9000000-0000-0000-0000-000000000004'::uuid)
    and bool_and(audit.occurred_at is not null)
  from public.get_waybill_bank_detail_audit(
    (select (v->>'id')::uuid from secure_waybill_state where k='invoice')) audit
), 'audit projection records submission, review, verification, and correction actors and timestamps');

update public.trip_closure_invoice_pdf_copies
set status='failed',ready_at=null,failed_at=clock_timestamp(),lease_token=null,lease_until=null,
  last_error_code='attempt_limit_exhausted'
where invoice_id=(select (v->>'id')::uuid from secure_waybill_state where k='invoice')
  and copy_kind='driver';
set local role authenticated;
select set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-000000000004',true);
insert into secure_waybill_state
select 'management_failed',to_jsonb(state)
from public.get_operations_waybill_copy_management_state(
  (select (v->>'id')::uuid from secure_waybill_state where k='invoice')) state;
select pg_temp.secure_waybill_assert((
  select v->>'driver_pdf_status'='failed' and v->>'company_pdf_status'='ready'
    and v->>'latest_bank_snapshot_version'='2'
  from secure_waybill_state where k='management_failed'
), 'a failed Driver PDF does not overwrite or hide the ready corrected Company PDF state');
reset role;
update public.trip_closure_invoice_pdf_copies
set status='failed',ready_at=null,failed_at=clock_timestamp(),lease_token=null,lease_until=null,
  last_error_code='attempt_limit_exhausted'
where invoice_id=(select (v->>'id')::uuid from secure_waybill_state where k='invoice')
  and copy_kind='company';
set local role authenticated;
select set_config('request.jwt.claim.sub','d9000000-0000-0000-0000-000000000004',true);
insert into secure_waybill_state
select 'management_both_failed',to_jsonb(state)
from public.get_operations_waybill_copy_management_state(
  (select (v->>'id')::uuid from secure_waybill_state where k='invoice')) state;
select pg_temp.secure_waybill_assert((
  select v->>'driver_pdf_status'='failed' and v->>'company_pdf_status'='failed'
    and v->>'latest_bank_snapshot_version'='2'
  from secure_waybill_state where k='management_both_failed'
), 'failed statuses are reported independently for both copy types');
reset role;

rollback;
