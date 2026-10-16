-- Synthetic fixture assertions only. Run in the same disposable local project
-- after all DEVELOPMENT migrations through 20261013000100 have been applied.
begin;

create function pg_temp.hybrid_assert(value boolean,message text) returns void
language plpgsql as $$
begin
  if value is distinct from true then raise exception 'Hybrid cutover assertion failed: %',message; end if;
  raise notice 'ASSERTION PASS: %',message;
end;
$$;
create function pg_temp.hybrid_error(command text,expected_state text) returns void
language plpgsql as $$
declare actual_state text;
begin
  begin execute command;
  exception when others then
    get stacked diagnostics actual_state=returned_sqlstate;
    if actual_state=expected_state then
      raise notice 'ASSERTION PASS: expected SQLSTATE %',expected_state;
      return;
    end if;
    raise exception 'Expected SQLSTATE %, received %',expected_state,actual_state;
  end;
  raise exception 'Expected SQLSTATE %, command succeeded',expected_state;
end;
$$;
create function pg_temp.hybrid_trip_id(registration text) returns uuid
language sql stable security definer set search_path = '' as $$
  select trip.id from public.trips trip join public.trucks truck on truck.id=trip.truck_id
  where truck.normalized_registration=public.normalize_plate(registration)
$$;

select pg_temp.hybrid_assert((select count(*)=2 from public.trip_payments
    where trip_id in (pg_temp.hybrid_trip_id('HYB-101'),pg_temp.hybrid_trip_id('HYB-102'))),
  'historical synthetic financial records remain intact');
select pg_temp.hybrid_assert((select sum(amount)=54 and count(*)=2 from public.trip_payments),
  'historical payment amounts remain unchanged');
select pg_temp.hybrid_assert((select count(*)=2 from public.trip_closure_invoices
    where trip_id in (pg_temp.hybrid_trip_id('HYB-101'),pg_temp.hybrid_trip_id('HYB-102')))
  and (select count(*)=2 from public.trip_closure_invoice_documents
    where trip_id in (pg_temp.hybrid_trip_id('HYB-101'),pg_temp.hybrid_trip_id('HYB-102'))),
  'existing Waybill snapshots and PDF queue rows remain intact');
select pg_temp.hybrid_assert(not exists(
    select 1 from public.trip_closure_invoice_pdf_copies copy
    join public.trip_closure_invoices invoice on invoice.id=copy.invoice_id
    join public.trucks truck on truck.id=invoice.truck_id
    where truck.normalized_registration in (public.normalize_plate('HYB-101'),public.normalize_plate('HYB-102'))),
  'migration creates no Driver or Company PDF-copy rows for historical Waybills');
select pg_temp.hybrid_assert((select count(*)=2
    from storage.objects object
    join public.trip_closure_invoice_documents document
      on object.bucket_id='waybills' and object.name=document.storage_path
    join public.trip_closure_invoices invoice on invoice.id=document.invoice_id
    join public.trucks truck on truck.id=invoice.truck_id
    where truck.normalized_registration in (public.normalize_plate('HYB-101'),public.normalize_plate('HYB-102'))),
  'historical PDF Storage objects and document paths remain unchanged');
select pg_temp.hybrid_assert((select count(*)=7 from public.notification_outbox),
  'all historical notification rows remain intact');
select pg_temp.hybrid_assert(not exists(
    select 1 from public.notification_outbox notification
    join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id
    join public.trucks truck on truck.id=invoice.truck_id
    join lateral (
      select candidate.* from public.trip_closure_invoice_pdf_copies candidate
      where candidate.invoice_id=invoice.id and candidate.trip_id=invoice.trip_id
        and candidate.copy_kind=case notification.audience
          when 'driver' then 'driver' when 'client' then 'company' else null end
      order by candidate.copy_version desc limit 1
    ) copy on true
    where truck.normalized_registration in (public.normalize_plate('HYB-101'),public.normalize_plate('HYB-102'))
      and notification.event_type='waybill_ready' and notification.audience in ('driver','client')
      and notification.status in ('pending','processing')
      and copy.status='ready' and copy.ready_at is not null and copy.notification_eligible
      and (copy.copy_kind<>'company' or copy.bank_snapshot_id is not null)),
  'historical notifications cannot qualify for the new copy-bound delivery worker');
select set_config('app.test_historical_invoice_id',
  (select id::text from public.trip_closure_invoices where trip_id=pg_temp.hybrid_trip_id('HYB-101')),true);
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000004',true);
select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.hybrid_error(format(
  'select public.submit_waybill_company_bank_details(%L::uuid,%L,%L,%L)',
  current_setting('app.test_historical_invoice_id'),
  'Synthetic Test Bank','Synthetic Test Account','1111111111'), '22023');
reset role;
select pg_temp.hybrid_assert(not exists(
    select 1 from public.trip_closure_invoice_bank_submissions submission
    where submission.invoice_id=(select id from public.trip_closure_invoices
      where trip_id=pg_temp.hybrid_trip_id('HYB-101')))
  and not exists(select 1 from public.trip_closure_invoice_pdf_copies copy
    where copy.invoice_id=(select id from public.trip_closure_invoices
      where trip_id=pg_temp.hybrid_trip_id('HYB-101'))),
  'bank corrections cannot enroll a historical Waybill in the dual-copy workflow');

select pg_temp.hybrid_assert((select status='blocked_missing_email'
    and blocked_reason_code='missing_driver_email' and recipients is null
    and attempts=2 and last_error='synthetic driver attempt history'
    from public.notification_outbox where trip_id=pg_temp.hybrid_trip_id('HYB-101')
      and event_type='waybill_ready' and audience='driver'),
  'NULL and empty driver recipient history becomes blocked without losing attempts or errors');
select pg_temp.hybrid_assert((select status='pending' and recipients=array['hybrid-driver@example.invalid']::text[]
    and attempts=1 and last_error='synthetic driver attempt history'
    from public.notification_outbox where trip_id=pg_temp.hybrid_trip_id('HYB-102')
      and event_type='waybill_ready' and audience='driver'),
  'empty driver recipients are recovered from the existing Waybill snapshot');
select pg_temp.hybrid_assert((select count(*)=2 from public.notification_outbox
    where event_type='waybill_ready' and audience='client' and status='blocked_configuration'
      and blocked_reason_code='company_recipient_not_configured' and recipients is null
      and last_error in ('synthetic company history','synthetic company attempt history')),
  'NULL and empty company recipient arrays become visible configuration blocks');
select pg_temp.hybrid_assert((select status='failed' and attempts=3
    and last_error='synthetic finance delivery history' and lease_token is null and lease_until is null
    from public.notification_outbox where trip_id=pg_temp.hybrid_trip_id('HYB-102')
      and event_type='waybill_ready' and audience='finance'),
  'retired Finance Waybill work is failed without overwriting delivery history');
select pg_temp.hybrid_assert((select count(*)=2
    and count(*) filter(where status='sent' and sent_at is not null)=1
    and count(*) filter(where status='pending' and sent_at is null)=1
    from public.notification_outbox where event_type='trip_closed' and audience='finance'),
  'historical payment notification states and sent timestamps remain unchanged');
select pg_temp.hybrid_assert((select count(*)=5 from public.audit_log
    where entity_name='notification_outbox'
      and reason in ('legacy_waybill_audience_retired','missing_driver_email',
        'driver_delivery_address_recovered_from_waybill_snapshot','company_recipient_not_configured')),
  'each cutover notification-state transition has an audit event');
select pg_temp.hybrid_assert(not exists(select 1 from public.audit_log
    where entity_name='notification_outbox'
      and reason in ('legacy_waybill_audience_retired','missing_driver_email',
        'driver_delivery_address_recovered_from_waybill_snapshot','company_recipient_not_configured')
      and (coalesce(old_value::text,'')||coalesce(new_value::text,'')) like '%@%'),
  'cutover audit evidence excludes recipient addresses');

select pg_temp.hybrid_assert(exists(select 1 from pg_constraint c
    where c.conrelid='public.notification_outbox'::regclass and c.confrelid='public.trips'::regclass
      and c.contype='f' and c.convalidated and c.confdeltype='r'
      and c.conkey=array[(select attnum from pg_attribute where attrelid='public.notification_outbox'::regclass
        and attname='trip_id')]::smallint[]
      and c.confkey=array[(select attnum from pg_attribute where attrelid='public.trips'::regclass
        and attname='id')]::smallint[])
    and not exists(select 1 from pg_constraint where conrelid='public.notification_outbox'::regclass
      and confrelid='public.trip_payments'::regclass and contype='f'),
  'validated trips foreign key replaces the payment-dependent foreign key');
select pg_temp.hybrid_assert((select count(*)=4 from information_schema.columns
    where table_schema='public' and table_name='trucks'
      and ((column_name='truck_type' and data_type='text' and character_maximum_length is null)
        or (column_name in ('capacity_unit','owner_name','owner_contact') and data_type='character varying'))),
  'truck_type uses text while the other legacy truck metadata columns remain varchar');
select pg_temp.hybrid_assert(not exists(select 1 from pg_trigger t
    join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace
    where t.tgrelid='public.trips'::regclass and not t.tgisinternal
      and n.nspname='private' and p.proname='snapshot_closed_trip')
    and to_regprocedure('private.snapshot_closed_trip()') is not null,
  'payment closure trigger is retired while its historical function is preserved');
select pg_temp.hybrid_assert(to_regprocedure('public.claim_trip_notifications(integer)') is null
    and to_regprocedure('public.enqueue_waybill_ready_notifications(text[])') is null
    and has_function_privilege('service_role','public.enqueue_waybill_ready_notifications(text)','EXECUTE')
    and not has_function_privilege('authenticated','public.enqueue_waybill_ready_notifications(text)','EXECUTE'),
  'obsolete notification overloads are removed and only the worker enqueue RPC remains');
select pg_temp.hybrid_assert(not exists (
    select 1 from pg_proc routine
    join pg_namespace namespace on namespace.oid=routine.pronamespace
    where namespace.nspname='public'
      and (routine.proname ilike '%paystack%' or routine.proname ilike '%payout%'
        or routine.proname ilike '%payment%' or routine.proname='retry_trip_notification')
      and (
        has_function_privilege('authenticated',routine.oid,'EXECUTE')
        or has_function_privilege('service_role',routine.oid,'EXECUTE')
        or exists (
          select 1 from aclexplode(coalesce(routine.proacl,acldefault('f',routine.proowner))) acl
          where acl.grantee=0 and acl.privilege_type='EXECUTE'
        )
      )
  )
    and not has_table_privilege('authenticated','public.trip_payments','SELECT'),
  'historical payment records remain while existing payment routines deny authenticated, service-role, and PUBLIC execution');
select pg_temp.hybrid_assert((select role='finance_officer' and is_active from public.profiles
    where id='f1000000-0000-4000-8000-000000000005'),
  'existing Finance Officer identity is preserved');
select pg_temp.hybrid_assert(not has_function_privilege('authenticated','public.retry_waybill_pdf(uuid,text)','EXECUTE')
    and has_function_privilege('authenticated','public.get_operations_dashboard_queue_health()','EXECUTE')
    and not has_function_privilege('anon','public.get_operations_dashboard_queue_health()','EXECUTE'),
  'retired PDF retry access is denied while authenticated queue-health access remains available');

select pg_temp.hybrid_assert(exists(select 1 from pg_policies where schemaname='public'
    and tablename='trip_closure_invoice_documents' and policyname='trip_closure_invoice_documents_read'
    and cmd='SELECT' and qual not ilike '%finance_officer%')
  and exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
    and policyname='waybill_pdf_authenticated_read'
    and qual ilike '%system_administrator%' and qual ilike '%operations_manager%'
    and qual ilike '%finance_officer%' and qual ilike '%audit_reviewer%'
    and qual not ilike '%loading_officer%' and qual not ilike '%offloading_officer%')
  and exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
    and policyname='waybill_pdf_authenticated_read_fence' and permissive='RESTRICTIVE'
    and qual ilike '%system_administrator%' and qual ilike '%operations_manager%'
    and qual ilike '%finance_officer%' and qual ilike '%audit_reviewer%'
    and qual not ilike '%loading_officer%' and qual not ilike '%offloading_officer%')
  and exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
    and policyname='secure_legacy_waybill_storage_read_fence' and permissive='RESTRICTIVE'
    and qual ilike '%system_administrator%' and qual ilike '%operations_manager%'
    and qual ilike '%finance_officer%' and qual ilike '%audit_reviewer%'
    and qual not ilike '%loading_officer%' and qual not ilike '%offloading_officer%'),
  'legacy Waybill Storage policies preserve the four-role historical authorization matrix');

select pg_temp.hybrid_assert(not has_table_privilege('authenticated','public.trip_closure_invoice_documents','SELECT'),
  'direct document-table access remains revoked after the cutover');
grant select on public.trip_closure_invoice_documents to authenticated;

select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000005',true);
select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.hybrid_assert((select count(*)=0 from public.trip_closure_invoice_documents),
  'Finance Officer cannot read Waybill document metadata');
select pg_temp.hybrid_assert((select count(*)=2 from storage.objects where bucket_id='waybills'),
  'Finance Officer retains historical private Waybill Storage access');
select pg_temp.hybrid_error('select public.get_operations_dashboard_queue_health()','42501');
reset role;

select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000004',true);
select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.hybrid_assert((select count(*)=2 from public.trip_closure_invoice_documents),
  'Operations Manager retains authorized Waybill document access under RLS');
select pg_temp.hybrid_assert((select count(*)=2 from storage.objects object
    join public.trip_closure_invoice_documents document
      on object.bucket_id='waybills' and object.name=document.storage_path
    join public.trip_closure_invoices invoice on invoice.id=document.invoice_id
    join public.trucks truck on truck.id=invoice.truck_id
    where truck.normalized_registration in (public.normalize_plate('HYB-101'),public.normalize_plate('HYB-102'))),
  'Operations Manager retains authorized private Waybill Storage access');
select pg_temp.hybrid_assert((select value->>'as_of' is not null
    and (value#>>'{notifications,pending_total}')::integer=1
    and (value#>>'{notifications,blocked_missing_email}')::integer=1
    and (value#>>'{notifications,blocked_configuration}')::integer=2
    and (value#>>'{notifications,provider_accepted}')::integer=0
    and position('synthetic' in value::text)=0
    from public.get_operations_dashboard_queue_health() value),
  'A1.2 queue health reports current Waybill deliveries without payload or history data');
reset role;

select pg_temp.hybrid_assert((select role='system_administrator' and is_active
    from public.profiles where id='f1000000-0000-4000-8000-000000000001'),
  'System Administrator test identity is active');
insert into auth.users(id,email,raw_user_meta_data)
values ('f1000000-0000-4000-8000-000000000006','hybrid-audit@example.invalid','{}')
on conflict (id) do nothing;
update public.profiles set role='audit_reviewer',is_active=true
where id='f1000000-0000-4000-8000-000000000006';
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.hybrid_assert((select count(*)=2 from storage.objects where bucket_id='waybills'),
  'System Administrator retains historical private Waybill Storage access');
reset role;

select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000006',true);
select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.hybrid_assert((select count(*)=2 from storage.objects where bucket_id='waybills'),
  'Audit Reviewer retains both historical private Waybill Storage objects');
reset role;

select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"f2000000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select pg_temp.hybrid_assert((select count(*)=0 from storage.objects where bucket_id='waybills'),
  'Loading Officer cannot read private Waybill Storage objects');
reset role;

select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.hybrid_assert((select count(*)=0 from storage.objects where bucket_id='waybills'),
  'Offloading Officer cannot read private Waybill Storage objects');
reset role;

set local role anon;
select pg_temp.hybrid_assert((select count(*)=0 from storage.objects where bucket_id='waybills'),
  'Anonymous callers cannot read private Waybill Storage objects');
reset role;

-- Close the third synthetic trip after the legacy payment trigger is removed.
select pg_temp.hybrid_assert(not exists(select 1 from public.trip_closure_invoices
    where trip_id=pg_temp.hybrid_trip_id('HYB-103'))
  and not exists(select 1 from public.trip_closure_invoice_pdf_copies
    where trip_id=pg_temp.hybrid_trip_id('HYB-103')),
  'an open trip has no PDF-copy jobs before its post-migration closure');
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"f2000000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select pg_temp.hybrid_assert((public.register_loading_participant_v3(
  'f7000000-0000-4000-8000-000000000004','HYB-104',null,null,
  'Synthetic Post Cutover Driver','08010000004',null,30,'Tanker','Synthetic Owner 4',null,null)->>'ok')::boolean,
  'payment-free registration accepts missing email and no bank details');
reset role;

select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"f2000000-0000-4000-8000-000000000003"}',true);
set local role authenticated;
select public.close_trip_v2('f8000000-0000-4000-8000-000000000003',pg_temp.hybrid_trip_id('HYB-103'),
  'HYB-103',(select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
  27,'OCR',statement_timestamp(),'HYB103',0.99,
  'f1000000-0000-4000-8000-000000000003/f6000000-0000-4000-8000-000000000003.jpg');
reset role;
select pg_temp.hybrid_assert((select status='closed' from public.trips
    where id=pg_temp.hybrid_trip_id('HYB-103'))
  and (select count(*)=2 from public.trip_payments)
  and (select count(*)=2 from public.notification_outbox
    where trip_id=pg_temp.hybrid_trip_id('HYB-103') and event_type='waybill_ready')
  and not exists(select 1 from public.notification_outbox
    where trip_id=pg_temp.hybrid_trip_id('HYB-103') and event_type='trip_closed'),
  'post-cutover closure creates its original Waybill deliveries without a payment row or payment notification');
select pg_temp.hybrid_assert((select count(*)=3 from public.trip_closure_invoices
    where trip_id in (pg_temp.hybrid_trip_id('HYB-101'),pg_temp.hybrid_trip_id('HYB-102'),pg_temp.hybrid_trip_id('HYB-103')))
  and (select count(*)=3 from public.trip_closure_invoice_documents
    where trip_id in (pg_temp.hybrid_trip_id('HYB-101'),pg_temp.hybrid_trip_id('HYB-102'),pg_temp.hybrid_trip_id('HYB-103'))),
  'each closed trip has exactly one authoritative Waybill snapshot and PDF job');
select pg_temp.hybrid_assert((select count(*)=2
    and count(*) filter (where copy_kind='driver' and status='pending'
      and storage_bucket='waybill-driver-copies' and bank_snapshot_id is null and notification_eligible)=1
    and count(*) filter (where copy_kind='company' and status='blocked_missing_bank_details'
      and storage_bucket='waybill-company-copies' and bank_snapshot_id is null and notification_eligible)=1
    from public.trip_closure_invoice_pdf_copies
    where invoice_id=(select id from public.trip_closure_invoices
      where trip_id=pg_temp.hybrid_trip_id('HYB-103'))),
  'post-migration closure creates independent Driver and held Company PDF jobs');
select pg_temp.hybrid_assert(not exists(
    select 1 from public.notification_outbox notification
    join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id
    join public.trip_closure_invoice_pdf_copies copy on copy.invoice_id=invoice.id
      and copy.copy_kind=case notification.audience when 'driver' then 'driver' when 'client' then 'company' end
    where notification.trip_id=pg_temp.hybrid_trip_id('HYB-103')
      and notification.event_type='waybill_ready' and notification.audience in ('driver','client')
      and copy.status='ready' and copy.ready_at is not null and copy.notification_eligible
      and (copy.copy_kind<>'company' or copy.bank_snapshot_id is not null)),
  'new trip notifications cannot deliver until their audience-specific copy is ready');

rollback;
