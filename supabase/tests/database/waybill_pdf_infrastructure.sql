begin;

create function pg_temp.pdf_assert(v boolean,m text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'Waybill PDF assertion failed: %',m; end if; end $$;
create function pg_temp.pdf_expect_error(q text,expected_state text) returns void language plpgsql as $$
declare actual_state text;
begin
  begin execute q;
  exception when others then
    get stacked diagnostics actual_state=returned_sqlstate;
    if actual_state=expected_state then return; end if;
    raise exception 'Expected SQLSTATE %, got %',expected_state,actual_state;
  end;
  raise exception 'Expected SQLSTATE %, statement succeeded',expected_state;
end $$;
create temp table pdf_state(k text primary key,v jsonb);
grant all on pdf_state to authenticated;

select pg_temp.pdf_assert((select public=false and file_size_limit=10485760
  and allowed_mime_types=array['application/pdf'] from storage.buckets where id='waybills'),
  'Waybill bucket is private and accepts only bounded PDF objects');
select pg_temp.pdf_assert(not has_table_privilege('anon','public.trip_closure_invoice_documents','SELECT')
  and has_table_privilege('authenticated','public.trip_closure_invoice_documents','SELECT')
  and not has_table_privilege('authenticated','public.trip_closure_invoice_documents','INSERT')
  and not has_table_privilege('authenticated','public.trip_closure_invoice_documents','UPDATE')
  and not has_table_privilege('authenticated','public.trip_closure_invoice_documents','DELETE'),
  'document state is read-only to authenticated users');
select pg_temp.pdf_assert(not has_table_privilege('service_role','public.trip_closure_invoices','SELECT')
  and has_function_privilege('service_role','public.get_waybill_pdf_snapshot(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.get_waybill_pdf_snapshot(uuid,uuid)','EXECUTE'),
  'worker can read snapshots only through its lease-scoped RPC');
select pg_temp.pdf_assert(has_function_privilege('service_role','public.enqueue_waybill_ready_notifications()','EXECUTE')
  and not has_function_privilege('anon','public.enqueue_waybill_ready_notifications()','EXECUTE')
  and not has_function_privilege('authenticated','public.enqueue_waybill_ready_notifications()','EXECUTE')
  and has_function_privilege('service_role','public.enqueue_waybill_ready_notifications(text[])','EXECUTE')
  and not has_function_privilege('anon','public.enqueue_waybill_ready_notifications(text[])','EXECUTE')
  and not has_function_privilege('authenticated','public.enqueue_waybill_ready_notifications(text[])','EXECUTE')
  and has_function_privilege('service_role','public.get_waybill_ready_pdf(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.get_waybill_ready_pdf(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.get_waybill_ready_pdf(uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.claim_trip_notifications(text[],text,integer,boolean)','EXECUTE')
  and not has_function_privilege('anon','public.claim_trip_notifications(text[],text,integer,boolean)','EXECUTE')
  and not has_function_privilege('authenticated','public.claim_trip_notifications(text[],text,integer,boolean)','EXECUTE')
  and has_function_privilege('service_role','public.claim_trip_notifications(text[],text,integer,boolean,boolean)','EXECUTE')
  and not has_function_privilege('authenticated','public.claim_trip_notifications(text[],text,integer,boolean,boolean)','EXECUTE')
  and has_function_privilege('service_role','public.finish_trip_notification(uuid,uuid,boolean,text,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.finish_trip_notification(uuid,uuid,boolean,text,text)','EXECUTE'),
  'Waybill notification reconciliation and PDF metadata RPCs are service-role only');

insert into auth.users(id,email,raw_user_meta_data) values
 ('fd000000-0000-0000-0000-000000000001','pdf-admin@example.invalid','{}'),
 ('fd000000-0000-0000-0000-000000000002','pdf-loader@example.invalid','{}'),
 ('fd000000-0000-0000-0000-000000000003','pdf-offloader@example.invalid','{}'),
 ('fd000000-0000-0000-0000-000000000004','pdf-ops@example.invalid','{}'),
 ('fd000000-0000-0000-0000-000000000005','pdf-finance@example.invalid','{}'),
 ('fd000000-0000-0000-0000-000000000006','pdf-audit@example.invalid','{}');
update public.profiles set display_name='PDF Test User',
 role=case right(id::text,1)
   when '1' then 'system_administrator'::public.app_role
   when '2' then 'loading_officer'::public.app_role
   when '3' then 'offloading_officer'::public.app_role
   when '4' then 'operations_manager'::public.app_role
   when '5' then 'finance_officer'::public.app_role
   else 'audit_reviewer'::public.app_role end,
 is_active=true where id::text like 'fd000000-%';
insert into public.sites(id,name,site_type,is_active) values
 ('fd100000-0000-0000-0000-000000000001','PDF Loading Site','loading',true),
 ('fd100000-0000-0000-0000-000000000002','PDF Offloading Site','offloading',true);
insert into public.drivers(id,full_name,phone_number,email,license_number) values
 ('fd200000-0000-0000-0000-000000000001','PDF Driver One','08018881001','pdf-driver@example.invalid','PDF-LIC-1'),
 ('fd200000-0000-0000-0000-000000000002','PDF Driver Two','08018881002',null,'PDF-LIC-2');
insert into public.driver_payment_details(driver_id,bank_name,account_name,account_number) values
 ('fd200000-0000-0000-0000-000000000001','PDF Bank','PDF Account','0198765432');
insert into public.trucks(id,registration_number,driver_id) values
 ('fd300000-0000-0000-0000-000000000001','PDF-101','fd200000-0000-0000-0000-000000000001'),
 ('fd300000-0000-0000-0000-000000000002','PDF-202','fd200000-0000-0000-0000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub','fd000000-0000-0000-0000-000000000001',true);
select public.assign_user_site('fd000000-0000-0000-0000-000000000002','fd100000-0000-0000-0000-000000000001');
select public.assign_user_site('fd000000-0000-0000-0000-000000000003','fd100000-0000-0000-0000-000000000002');
select set_config('request.jwt.claim.sub','fd000000-0000-0000-0000-000000000002',true);
insert into pdf_state values('opened_one',public.create_loading_trip_v2(
 'fd400000-0000-0000-0000-000000000001','PDF-101','fd200000-0000-0000-0000-000000000001',
 (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
 'MANUAL',clock_timestamp(),16.00));
insert into pdf_state values('opened_two',public.create_loading_trip_v2(
 'fd400000-0000-0000-0000-000000000002','PDF-202','fd200000-0000-0000-0000-000000000002',
 (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
 'MANUAL',clock_timestamp(),17.00));
select set_config('request.jwt.claim.sub','fd000000-0000-0000-0000-000000000003',true);
insert into pdf_state values('closed_one',public.close_trip_v2(
 'fd500000-0000-0000-0000-000000000001',
 (select (v#>>'{trip,id}')::uuid from pdf_state where k='opened_one'),'PDF-101',
 (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
 24.50,'MANUAL',clock_timestamp()));
insert into pdf_state values('closed_two',public.close_trip_v2(
 'fd500000-0000-0000-0000-000000000002',
 (select (v#>>'{trip,id}')::uuid from pdf_state where k='opened_two'),'PDF-202',
 (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
 18.25,'MANUAL',clock_timestamp()));
select pg_temp.pdf_assert((select count(*)=2 from pdf_state where k like 'closed_%' and v->>'ok'='true'),
  'trip closure succeeds while creating queued PDF work');
reset role;
insert into pdf_state values('document_count_before_replay',jsonb_build_object(
  'count',(select count(*) from public.trip_closure_invoice_documents)));
set local role authenticated;
select set_config('request.jwt.claim.sub','fd000000-0000-0000-0000-000000000003',true);
select pg_temp.pdf_assert(public.close_trip_v2(
  'fd500000-0000-0000-0000-000000000001',
  (select (v#>>'{trip,id}')::uuid from pdf_state where k='opened_one'),
  'CHANGED-PAYLOAD',null,99,'OCR',clock_timestamp())=(select v from pdf_state where k='closed_one'),
  'idempotent close replay preserves the original Waybill response');
reset role;
select pg_temp.pdf_assert((select count(*)=(select (v->>'count')::integer
  from pdf_state where k='document_count_before_replay') from public.trip_closure_invoice_documents),
  'close replay does not queue another PDF document');
create temp table pdf_test_trips(id uuid primary key);
grant select on pdf_test_trips to authenticated;
insert into pdf_test_trips
select (v#>>'{trip,id}')::uuid from pdf_state where k in ('opened_one','opened_two');
insert into pdf_state values('expected_document_count',jsonb_build_object(
  'count',(select count(*) from public.trip_closure_invoice_documents)));
update public.trip_closure_invoice_documents
set status='ready',ready_at=clock_timestamp(),failed_at=null,lease_token=null,lease_until=null
where trip_id not in (select id from pdf_test_trips);

select pg_temp.pdf_assert((select count(*)=2 from public.trip_closure_invoice_documents d
  join public.trip_closure_invoices i on i.id=d.invoice_id and i.trip_id=d.trip_id
  where d.trip_id in (select id from pdf_test_trips) and d.status='pending' and d.attempts=0
    and d.storage_path=private.waybill_storage_path(i.invoice_number)),
  'one deterministic pending PDF document is queued per closed Waybill');
select pg_temp.pdf_expect_error($q$
 insert into public.trip_closure_invoice_documents(invoice_id,trip_id,invoice_number,storage_path)
 select invoice_id,trip_id,invoice_number,storage_path from public.trip_closure_invoice_documents limit 1
$q$,'23505');
select pg_temp.pdf_assert((select count(*)=(select (v->>'count')::integer from pdf_state where k='expected_document_count')
  from public.trip_closure_invoice_documents),
  'duplicate insertion cannot create a second logical PDF document');
select pg_temp.pdf_assert((select count(*)=0 from information_schema.columns
  where table_schema='public' and table_name='trip_closure_invoice_documents'
    and column_name in ('bank_name','account_name','account_number')),
  'mutable PDF state stores no banking snapshot');

insert into storage.objects(bucket_id,name,owner_id,metadata)
select 'waybills',storage_path,'fd000000-0000-0000-0000-000000000001',
  jsonb_build_object('mimetype','application/pdf','size',1234)
from public.trip_closure_invoice_documents where trip_id in (select id from pdf_test_trips)
order by created_at limit 1;

set local role authenticated;
select set_config('request.jwt.claim.sub','fd000000-0000-0000-0000-000000000002',true);
select pg_temp.pdf_assert((select count(*)=0 from public.trip_closure_invoice_documents
  where trip_id in (select id from pdf_test_trips)),
  'Loading Officer cannot read PDF document state');
select pg_temp.pdf_assert((select count(*)=0 from storage.objects where bucket_id='waybills'),
  'Loading Officer cannot read or download Waybill PDFs');
select set_config('request.jwt.claim.sub','fd000000-0000-0000-0000-000000000003',true);
select pg_temp.pdf_assert((select count(*)=0 from public.trip_closure_invoice_documents
  where trip_id in (select id from pdf_test_trips)),
  'Offloading Officer cannot read PDF document state');
select pg_temp.pdf_assert((select count(*)=0 from storage.objects where bucket_id='waybills'),
  'Offloading Officer cannot read or download Waybill PDFs');
select pg_temp.pdf_expect_error($q$
 insert into storage.objects(bucket_id,name,owner_id,metadata)
 values('waybills','2026/forbidden.pdf',auth.uid()::text,'{"mimetype":"application/pdf"}')
$q$,'42501');
select set_config('request.jwt.claim.sub','fd000000-0000-0000-0000-000000000004',true);
select pg_temp.pdf_assert((select count(*)=2 from public.trip_closure_invoice_documents
  where trip_id in (select id from pdf_test_trips)),
  'Operations Manager can read PDF document state');
select pg_temp.pdf_assert((select count(*)=1 from storage.objects where bucket_id='waybills'),
  'Operations Manager can read Waybill PDFs');
select set_config('request.jwt.claim.sub','fd000000-0000-0000-0000-000000000005',true);
select pg_temp.pdf_assert((select count(*)=2 from public.trip_closure_invoice_documents
  where trip_id in (select id from pdf_test_trips)),
  'Finance Officer can read PDF document state');
select pg_temp.pdf_assert((select count(*)=1 from storage.objects where bucket_id='waybills'),
  'Finance Officer can read Waybill PDFs');
select set_config('request.jwt.claim.sub','fd000000-0000-0000-0000-000000000006',true);
select pg_temp.pdf_assert((select count(*)=2 from public.trip_closure_invoice_documents
  where trip_id in (select id from pdf_test_trips)),
  'Audit Reviewer can read PDF document state');
select pg_temp.pdf_assert((select count(*)=1 from storage.objects where bucket_id='waybills'),
  'Audit Reviewer can read Waybill PDFs');
select set_config('request.jwt.claim.sub','fd000000-0000-0000-0000-000000000001',true);
select pg_temp.pdf_assert((select count(*)=2 from public.trip_closure_invoice_documents
  where trip_id in (select id from pdf_test_trips)),
  'System Administrator can read PDF document state');
select pg_temp.pdf_assert((select count(*)=1 from storage.objects where bucket_id='waybills'),
  'System Administrator can read Waybill PDFs');
reset role;
grant select on storage.objects to anon;
set local role anon;
select pg_temp.pdf_assert((select count(*)=0 from storage.objects where bucket_id='waybills'),
  'anonymous users cannot read private Waybill PDFs');
reset role;

create temp table claimed_pdf(id uuid,invoice_id uuid,trip_id uuid,invoice_number text,
  storage_path text,lease_token uuid,attempts integer);
grant select on claimed_pdf to authenticated;
insert into claimed_pdf
select id,invoice_id,trip_id,invoice_number,storage_path,lease_token,attempts
from public.claim_waybill_pdf_jobs(1);
select pg_temp.pdf_assert((select count(*)=1 and min(attempts)=1 from claimed_pdf),
  'claim moves one queued document into processing and increments attempts');
select pg_temp.pdf_assert((select count(*)=1 from public.get_waybill_pdf_snapshot(
  (select id from claimed_pdf),(select lease_token from claimed_pdf))),
  'worker can read exactly its Waybill snapshot while holding the current lease');
update public.trip_closure_invoice_documents
set lease_until=clock_timestamp()-interval '1 second'
where id=(select id from claimed_pdf);
select pg_temp.pdf_assert((select count(*)=0 from public.get_waybill_pdf_snapshot(
  (select id from claimed_pdf),(select lease_token from claimed_pdf))),
  'expired worker cannot fetch the Waybill snapshot before another claim');
select pg_temp.pdf_assert(not public.finish_waybill_pdf_job(
  (select id from claimed_pdf),(select lease_token from claimed_pdf),true,null),
  'expired worker cannot mark a PDF ready before another claim');
select pg_temp.pdf_assert(not public.finish_waybill_pdf_job(
  (select id from claimed_pdf),(select lease_token from claimed_pdf),false,'storage_upload_failed'),
  'expired worker cannot fail a PDF job before another claim');
select pg_temp.pdf_assert((select status='processing' and attempts=1
  and lease_token=(select lease_token from claimed_pdf) and lease_until < clock_timestamp()
  from public.trip_closure_invoice_documents where id=(select id from claimed_pdf)),
  'rejected expired-worker operations leave the leased job unchanged');
update public.trip_closure_invoice_documents
set lease_until=clock_timestamp()+interval '5 minutes'
where id=(select id from claimed_pdf);
select pg_temp.pdf_assert(not public.finish_waybill_pdf_job(
  (select id from claimed_pdf),gen_random_uuid(),true,null),
  'stale lease cannot mark a PDF ready');
select pg_temp.pdf_assert(public.finish_waybill_pdf_job(
  (select id from claimed_pdf),(select lease_token from claimed_pdf),true,null),
  'successful upload marks the existing document ready');
select pg_temp.pdf_assert((select status='ready' and ready_at is not null and attempts=1
  from public.trip_closure_invoice_documents where id=(select id from claimed_pdf)),
  'ready state has timestamp and preserves its single document row');

create temp table waybill_enqueue_count as
select public.enqueue_waybill_ready_notifications() as inserted;
select pg_temp.pdf_assert((select inserted>=2 from waybill_enqueue_count),
  'ready Waybill reconciliation also backfills existing ready documents; observed count=' ||
    (select inserted::text from waybill_enqueue_count));
select pg_temp.pdf_assert(public.enqueue_waybill_ready_notifications()=0
  and public.enqueue_waybill_ready_notifications(array['ignored@example.invalid'])=0,
  'reconciliation is idempotent and does not duplicate ready events');
select pg_temp.pdf_assert((select count(*)=2 from public.notification_outbox
  where trip_id=(select trip_id from claimed_pdf) and event_type='waybill_ready'),
  'only driver and target-company Waybill-ready events exist once each');
select pg_temp.pdf_assert((select recipients=array['pdf-driver@example.invalid']
  and payload->>'invoice_number'=(select invoice_number from claimed_pdf)
  and payload->>'storage_path'=(select storage_path from claimed_pdf)
  and not (payload ?| array['bank_name','account_name','account_number','driver_email'])
  from public.notification_outbox where trip_id=(select trip_id from claimed_pdf)
    and event_type='waybill_ready' and audience='driver'),
  'driver message targets only its immutable email and has no bank/address metadata leakage');
select pg_temp.pdf_assert((select count(*)=0 from public.notification_outbox
  where trip_id=(select trip_id from claimed_pdf) and event_type='waybill_ready' and audience='finance'),
  'Operations and Finance do not receive an automatic Waybill email row');
select pg_temp.pdf_assert((select recipients is null
  and not (payload ?| array['recipient','recipients','email','client_email'])
  from public.notification_outbox where trip_id=(select trip_id from claimed_pdf)
    and event_type='waybill_ready' and audience='client'),
  'target-company address remains outside the browser-readable outbox row');
select pg_temp.pdf_assert((select count(*)=0 from public.notification_outbox
  where trip_id in (select id from pdf_test_trips where id<>(select trip_id from claimed_pdf))
    and event_type='waybill_ready'),
  'unready PDF documents do not enqueue notification events');

create temp table claimed_without_waybill as
select * from public.claim_trip_notifications(
  array['legacy-finance@example.invalid'],'sender@example.invalid',10);
select pg_temp.pdf_assert((select count(*)=0 from claimed_without_waybill where event_type='waybill_ready')
  and not exists(select 1 from claimed_without_waybill where event_type<>'trip_closed'),
  'legacy claim callers continue to lease only trip_closed notifications');
create temp table claimed_waybill_notifications as
select * from public.claim_trip_notifications(
  array['legacy-finance@example.invalid'],'sender@example.invalid',10,true,false);
select pg_temp.pdf_assert((select count(*)=1 from claimed_waybill_notifications
    where event_type='waybill_ready' and audience='driver' and trip_id=(select trip_id from claimed_pdf))
  and not exists(select 1 from claimed_waybill_notifications
    where event_type='waybill_ready' and audience='client')
  and (select status='pending' and recipients is null from public.notification_outbox
    where trip_id=(select trip_id from claimed_pdf) and event_type='waybill_ready' and audience='client'),
  'missing target-company configuration still claims driver mail and leaves target copy pending');
do $$
declare v_count integer; batch_number integer;
begin
  for batch_number in 1..10 loop
    insert into claimed_waybill_notifications
    select * from public.claim_trip_notifications(
      array['legacy-finance@example.invalid'],'sender@example.invalid',10,true,true);
    get diagnostics v_count=row_count;
    exit when v_count=0;
  end loop;
end $$;
select pg_temp.pdf_assert((select count(*)=2 from claimed_waybill_notifications
    where event_type='waybill_ready' and trip_id=(select trip_id from claimed_pdf))
  and (select count(*)=1 from claimed_waybill_notifications
    where event_type='waybill_ready' and audience='driver' and trip_id=(select trip_id from claimed_pdf))
  and (select count(*)=1 from claimed_waybill_notifications
    where event_type='waybill_ready' and audience='client' and trip_id=(select trip_id from claimed_pdf)),
  'worker claims driver and target-company ready events through the existing outbox');
select pg_temp.pdf_assert((select recipients=array[]::text[] and email_request->'to'='[]'::jsonb
  from claimed_waybill_notifications where audience='client' and trip_id=(select trip_id from claimed_pdf)),
  'claimed target-company row persists no target address');
select pg_temp.pdf_assert((select count(*)=2 from claimed_waybill_notifications
  where event_type='waybill_ready' and trip_id=(select trip_id from claimed_pdf)
    and email_request->>'subject'=('Waybill ' || (payload->>'invoice_number') || ' for trip ' || (payload->>'trip_number'))
    and email_request->>'text'=('The issued Waybill PDF is attached.' || E'\nWaybill Number: ' || (payload->>'invoice_number')
      || E'\nTrip Number: ' || (payload->>'trip_number'))),
  'generated driver and target-company templates use Waybill terminology and stored references');
select pg_temp.pdf_assert((select count(*)=1 from public.get_waybill_ready_pdf(
  (select id from claimed_waybill_notifications where event_type='waybill_ready' and trip_id=(select trip_id from claimed_pdf) limit 1),
  (select lease_token from claimed_waybill_notifications where event_type='waybill_ready' and trip_id=(select trip_id from claimed_pdf) limit 1))),
  'PDF attachment metadata requires and validates the active outbox lease');

set local role authenticated;
select set_config('request.jwt.claim.sub','fd000000-0000-0000-0000-000000000002',true);
select pg_temp.pdf_assert((select count(*)=0 from public.notification_outbox
  where trip_id=(select trip_id from claimed_pdf) and event_type='waybill_ready'),
  'Loading Officer cannot read Waybill notification/document state');
select set_config('request.jwt.claim.sub','fd000000-0000-0000-0000-000000000003',true);
select pg_temp.pdf_assert((select count(*)=0 from public.notification_outbox
  where trip_id=(select trip_id from claimed_pdf) and event_type='waybill_ready'),
  'Offloading Officer cannot read Waybill notification/document state');
reset role;

select pg_temp.pdf_assert(public.finish_trip_notification(
  (select id from claimed_waybill_notifications where event_type='waybill_ready' and trip_id=(select trip_id from claimed_pdf) limit 1),
  (select lease_token from claimed_waybill_notifications where event_type='waybill_ready' and trip_id=(select trip_id from claimed_pdf) limit 1),
  false,null,'Waybill PDF attachment unavailable'),
  'email attachment failure updates only the existing notification job');
select pg_temp.pdf_assert((select status='ready' and ready_at is not null
  from public.trip_closure_invoice_documents where trip_id=(select trip_id from claimed_pdf))
  and (select status='closed' from public.trips where id=(select trip_id from claimed_pdf))
  and (select count(*)=1 from public.trip_closure_invoices where trip_id=(select trip_id from claimed_pdf)),
  'notification failure preserves the ready PDF, immutable Waybill, and closed trip');

delete from claimed_pdf;
insert into claimed_pdf
select id,invoice_id,trip_id,invoice_number,storage_path,lease_token,attempts
from public.claim_waybill_pdf_jobs(1);
do $$
declare
  attempt integer;
  v_job record;
begin
  for attempt in 1..5 loop
    if attempt=1 then
      select * into v_job from claimed_pdf;
    else
      select * into v_job from public.claim_waybill_pdf_jobs(1);
    end if;
    if not found then raise exception 'PDF retry job was not claimable'; end if;
    perform pg_temp.pdf_assert(v_job.id=(select id from claimed_pdf),'worker claims the same document on retry');
    perform pg_temp.pdf_assert(public.finish_waybill_pdf_job(
      v_job.id,v_job.lease_token,false,'storage_upload_failed'),'PDF failure acknowledgement succeeds');
    update public.trip_closure_invoice_documents set next_attempt_at=clock_timestamp()
      where id=v_job.id and status='pending';
  end loop;
end $$;
select pg_temp.pdf_assert((select status='failed' and attempts=5 and failed_at is not null
  and last_error_code='attempt_limit_exhausted'
  and last_error_message !~ '0198765432|PDF Bank|PDF Account'
  from public.trip_closure_invoice_documents where id=(select id from claimed_pdf)),
  'repeated Storage failure ends in sanitized failed state');
select pg_temp.pdf_assert((select count(*)=(select (v->>'count')::integer from pdf_state where k='expected_document_count')
  from public.trip_closure_invoice_documents),
  'retries keep the original one-job-per-Waybill count');
select pg_temp.pdf_assert((select count(*)=2 from public.trips where status='closed' and id in
  (select id from pdf_test_trips))
  and (select count(*)=2 from public.trip_closure_invoices where trip_id in (select id from pdf_test_trips)),
  'PDF failure leaves closed trips and immutable Waybill snapshots intact');

set local role authenticated;
select set_config('request.jwt.claim.sub','fd000000-0000-0000-0000-000000000002',true);
select pg_temp.pdf_expect_error($q$select public.retry_waybill_pdf(
  (select id from public.trip_closure_invoice_documents where status='failed' limit 1),'unauthorized')$q$,'42501');
select set_config('request.jwt.claim.sub','fd000000-0000-0000-0000-000000000001',true);
select public.retry_waybill_pdf((select id from public.trip_closure_invoice_documents where status='failed' limit 1),
  'Verified that the private PDF object can be regenerated');
reset role;
select pg_temp.pdf_assert((select status='pending' and attempts=0 and failed_at is null
  from public.trip_closure_invoice_documents where id=(select id from claimed_pdf)),
  'administrator retry resets state on the same document identity');
select pg_temp.pdf_assert((select count(*)=2 from public.trip_closure_invoice_documents
  where trip_id in (select id from pdf_test_trips)),
  'administrator retry does not create another document');
select pg_temp.pdf_assert((select count(*)=1 from public.audit_log
  where entity_name='trip_closure_invoice_documents' and entity_id=(select id from claimed_pdf)),
  'administrator retry is audited');

update public.trip_closure_invoice_documents
set status='ready',ready_at=clock_timestamp(),failed_at=null,lease_token=null,lease_until=null
where trip_id=(select trip_id from public.trip_closure_invoices
  where trip_id in (select id from pdf_test_trips) and driver_email is null limit 1);
create temp table missing_driver_enqueue_result as
select public.enqueue_waybill_ready_notifications(array['ignored@example.invalid']) as inserted;
select pg_temp.pdf_assert((select inserted=1 from missing_driver_enqueue_result),
  'missing immutable driver_email still queues only the target-company copy');
select pg_temp.pdf_assert((select driver_email is null from public.trip_closure_invoices
  where trip_id=(select trip_id from public.trip_closure_invoices
    where trip_id in (select id from pdf_test_trips) and driver_email is null limit 1))
  and (select count(*)=0 from public.notification_outbox n
    where n.trip_id=(select trip_id from public.trip_closure_invoices
      where trip_id in (select id from pdf_test_trips) and driver_email is null limit 1)
      and n.event_type='waybill_ready' and n.audience='driver')
  and (select count(*)=1 from public.notification_outbox n
    where n.trip_id=(select trip_id from public.trip_closure_invoices
      where trip_id in (select id from pdf_test_trips) and driver_email is null limit 1)
      and n.event_type='waybill_ready' and n.audience='client'),
  'missing immutable driver_email suppresses driver mail while target-company delivery remains queued');

rollback;
