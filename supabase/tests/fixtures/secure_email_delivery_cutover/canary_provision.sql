begin;

create function pg_temp.canary_assert(p_value boolean,p_message text) returns void language plpgsql as $$
begin
  if p_value is distinct from true then raise exception 'Synthetic canary fixture assertion failed: %',p_message; end if;
  raise notice 'ASSERTION PASS: %',p_message;
end;
$$;

create function pg_temp.canary_assert_close_response(
  p_closure_kind text,p_request_id uuid,p_trip_id uuid,p_expected_invoice_number text,
  p_expect_non_reserved boolean default false
) returns void language plpgsql as $$
declare
  v_response jsonb;
  v_ok text;
  v_code text;
  v_request_id_matches boolean;
  v_trip_id_matches boolean;
  v_trip_status text;
  v_invoice_number text;
  v_waybill_invoice_present boolean;
  v_waybill_invoice_matches boolean;
begin
  select response into v_response from phase3b_close_responses where closure_kind=p_closure_kind;
  v_ok:=v_response->>'ok';
  v_code:=v_response->>'code';
  v_request_id_matches:=coalesce(v_response->>'request_id'=p_request_id::text,false);
  v_trip_id_matches:=coalesce(v_response#>>'{trip,id}'=p_trip_id::text,false);
  v_trip_status:=v_response#>>'{trip,status}';
  v_invoice_number:=v_response#>>'{waybill,invoice_number}';
  v_waybill_invoice_present:=coalesce((v_response->'waybill') ? 'invoice_number',false);
  v_waybill_invoice_matches:=not v_waybill_invoice_present or (
    case when p_expect_non_reserved then v_invoice_number is not null and v_invoice_number<>'WB-9999-999999'
      else v_invoice_number is not distinct from p_expected_invoice_number end
    and exists(select 1 from public.trip_closure_invoices invoice
      where invoice.trip_id=p_trip_id and invoice.invoice_number=v_invoice_number)
  );

  if coalesce(v_ok='true',false) and v_request_id_matches
    and v_trip_id_matches and v_trip_status='closed' and v_waybill_invoice_matches then
    raise notice 'ASSERTION PASS: % synthetic closure response contract',p_closure_kind;
    return;
  end if;

  raise exception 'Synthetic closure response diagnostic: closure_kind=% response.ok=% response.code=% request_id_matches=% trip_id_matches=% trip.status=% waybill.invoice_number=%',
    case when p_closure_kind in ('reserved','ordinary') then p_closure_kind else '<invalid-kind>' end,
    case when v_ok in ('true','false') then v_ok else '<missing-or-invalid>' end,
    case when v_code is null then '<none>' when v_code ~ '^[A-Z0-9_]{1,64}$' then v_code else '<invalid-format>' end,
    v_request_id_matches,
    v_trip_id_matches,
    case when v_trip_status ~ '^[a-z_]{1,32}$' then v_trip_status else '<missing-or-invalid>' end,
    case when not v_waybill_invoice_present then '<absent>'
      when v_invoice_number ~ '^[A-Z0-9-]{1,64}$' then v_invoice_number else '<invalid-format>' end;
end;
$$;

create function pg_temp.canary_expect_sqlstate(p_statement text,p_expected text,p_message text)
returns void language plpgsql as $$
declare v_state text;
begin
  begin
    execute p_statement;
  exception when others then
    get stacked diagnostics v_state=returned_sqlstate;
    if v_state=p_expected then
      raise notice 'ASSERTION PASS: %',p_message;
      return;
    end if;
    raise exception 'Synthetic canary fixture expected SQLSTATE %, got %: %',p_expected,v_state,p_message;
  end;
  raise exception 'Synthetic canary fixture expected SQLSTATE % but statement succeeded: %',p_expected,p_message;
end;
$$;

insert into auth.users(id,email,raw_user_meta_data) values
  ('c0000000-0000-4000-8000-000000000001','phase3b-admin@example.invalid','{}'),
  ('c0000000-0000-4000-8000-000000000002','phase3b-loading@example.invalid','{}'),
  ('c0000000-0000-4000-8000-000000000003','phase3b-offloading@example.invalid','{}'),
  ('c0000000-0000-4000-8000-000000000004','phase3b-operations@example.invalid','{}');

update public.profiles set
  role=case right(id::text,1)
    when '1' then 'system_administrator'::public.app_role
    when '2' then 'loading_officer'::public.app_role
    when '3' then 'offloading_officer'::public.app_role
    else 'operations_manager'::public.app_role end,
  display_name='Phase 3B synthetic actor',is_active=true
where id::text like 'c0000000-%';

insert into auth.sessions(id,user_id,created_at) values
  ('c2000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000002',statement_timestamp()),
  ('c2000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000003',statement_timestamp());

insert into public.sites(id,name,site_type) values
  ('c1000000-0000-4000-8000-000000000001','Phase 3B Synthetic Loading Site','loading'),
  ('c1000000-0000-4000-8000-000000000002','Phase 3B Synthetic Offloading Site','offloading');

select set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','c0000000-0000-4000-8000-000000000001'
)::text,true);
set local role authenticated;
select pg_temp.canary_assert((public.assign_user_site(
  'c0000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001'
)->>'ok')::boolean,'synthetic administrator assigns the Loading Officer to the test site');
select pg_temp.canary_assert((public.assign_user_site(
  'c0000000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000002'
)->>'ok')::boolean,'synthetic administrator assigns the Offloading Officer to the test site');
reset role;

create temporary table phase3b_registration_response(response jsonb);
grant insert,select on phase3b_registration_response to authenticated;
create temporary table phase3b_pdf_claims(
  copy_kind text,copy_id uuid,invoice_id uuid,trip_id uuid,invoice_number text,
  storage_bucket text,storage_path text,attempts integer,lease_token uuid,lease_until timestamptz
);
grant insert,select on phase3b_pdf_claims to service_role;
create temporary table phase3b_close_responses(
  closure_kind text primary key,response jsonb not null
);
grant insert,select on phase3b_close_responses to authenticated;

select set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','c0000000-0000-4000-8000-000000000002',
  'session_id','c2000000-0000-4000-8000-000000000002',
  'iat',extract(epoch from statement_timestamp())::bigint
)::text,true);
select set_config('test.phase3b_loading_assignment',(
  select assignment.id::text from public.user_site_assignments assignment
  where assignment.profile_id='c0000000-0000-4000-8000-000000000002'
    and assignment.site_id='c1000000-0000-4000-8000-000000000001' and assignment.ended_at is null
  order by assignment.assigned_at desc limit 1
),true);
set local role authenticated;
insert into phase3b_registration_response
select public.register_loading_participant_v4(
  'c3000000-0000-4000-8000-000000000001','SYNTHCANARY999',null,null,
  'Synthetic Email Canary Driver','08000000000','synthetic-driver@example.invalid',
  'Synthetic Test Bank','0000000000','Synthetic Test Only',30,
  'Registered tipper truck','Synthetic Canary Owner',null,null
);
select pg_temp.canary_assert((select response->>'ok'='true' from phase3b_registration_response),
  'V4 registration creates the dedicated synthetic driver, truck, and restricted bank capture');
select pg_temp.canary_assert((select not (response ?| array[
  'bank_name','account_name','account_number','bank_capture','bank_details'
]) from phase3b_registration_response),
  'registration response contains no restricted bank values or capture fields');
reset role;

select set_config('test.phase3b_driver_id',(
  select driver.id::text from public.drivers driver where driver.full_name='Synthetic Email Canary Driver'
),true);
select set_config('test.phase3b_truck_id',(
  select truck.id::text from public.trucks truck where truck.normalized_registration='SYNTHCANARY999'
),true);

set local role authenticated;
\o /dev/null
select public.create_loading_trip_v2(
  'c3000000-0000-4000-8000-000000000002','SYNTHCANARY999',
  current_setting('test.phase3b_driver_id')::uuid,
  current_setting('test.phase3b_loading_assignment')::uuid,
  'MANUAL',statement_timestamp(),10,null,null,null,false
);
\o
reset role;
select set_config('test.phase3b_trip_id',(
  select trip.id::text from public.trips trip
  where trip.truck_id=current_setting('test.phase3b_truck_id')::uuid
    and trip.driver_id=current_setting('test.phase3b_driver_id')::uuid and trip.status='open'
),true);
select pg_temp.canary_assert(current_setting('test.phase3b_trip_id') is not null,
  'the ordinary Loading workflow opens the dedicated synthetic trip');

insert into auth.users(id,email,raw_user_meta_data)
values('c0000000-0000-4000-8000-000000000005','phase3b-ordinary@example.invalid','{}');
update public.profiles set role='loading_officer'::public.app_role,is_active=true,
  display_name='Phase 3B ordinary synthetic actor'
where id='c0000000-0000-4000-8000-000000000005';
insert into auth.sessions(id,user_id,created_at)
values('c2000000-0000-4000-8000-000000000005','c0000000-0000-4000-8000-000000000005',statement_timestamp());
select set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.canary_assert((public.assign_user_site(
  'c0000000-0000-4000-8000-000000000005','c1000000-0000-4000-8000-000000000001'
)->>'ok')::boolean,'administrator assigns the ordinary negative-control Loading Officer');
reset role;
select set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000005',true);
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','c0000000-0000-4000-8000-000000000005',
  'session_id','c2000000-0000-4000-8000-000000000005',
  'iat',extract(epoch from statement_timestamp())::bigint
)::text,true);
select set_config('test.phase3b_ordinary_assignment',(
  select assignment.id::text from public.user_site_assignments assignment
  where assignment.profile_id='c0000000-0000-4000-8000-000000000005'
    and assignment.site_id='c1000000-0000-4000-8000-000000000001' and assignment.ended_at is null
  order by assignment.assigned_at desc limit 1
),true);
set local role authenticated;
\o /dev/null
select public.register_loading_participant_v4(
  'c3000000-0000-4000-8000-000000000004','ORDINARYCANARY1',null,null,
  'Synthetic Ordinary Control Driver','08000000004','ordinary-control@example.invalid',
  'Synthetic Test Bank','0000000002','Synthetic Ordinary Control',30,
  'Registered tipper truck','Synthetic Control Owner',null,null
);
\o
reset role;
select set_config('test.phase3b_ordinary_driver_id',(
  select driver.id::text from public.drivers driver where driver.full_name='Synthetic Ordinary Control Driver'
),true);
set local role authenticated;
\o /dev/null
select public.create_loading_trip_v2(
  'c3000000-0000-4000-8000-000000000005','ORDINARYCANARY1',
  current_setting('test.phase3b_ordinary_driver_id')::uuid,
  current_setting('test.phase3b_ordinary_assignment')::uuid,
  'MANUAL',statement_timestamp(),8,null,null,null,false
);
\o
reset role;
select set_config('test.phase3b_ordinary_trip_id',(
  select trip.id::text from public.trips trip
  where trip.driver_id=current_setting('test.phase3b_ordinary_driver_id')::uuid and trip.status='open'
),true);

do $vault_setup$
begin
  if exists (select 1 from vault.decrypted_secrets
    where name in ('trakflit_email_canary_project_ref','trakflit_email_canary_enabled')) then
    raise exception 'Unexpected pre-existing canary test secret in fresh disposable project.';
  end if;
  perform vault.create_secret('pidxlopbxlapfmakmtjt','trakflit_email_canary_project_ref',
    'Disposable CI canary project binding; not a credential.');
  perform vault.create_secret('true','trakflit_email_canary_enabled',
    'Disposable CI canary enablement; not a credential.');
end;
$vault_setup$;

select set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000001',true);
set local role service_role;
select pg_temp.canary_assert(public.authorize_waybill_synthetic_email_canary_trip(
  current_setting('test.phase3b_trip_id')::uuid
),'service-role provisioning authorizes only the exact marked synthetic trip');
select pg_temp.canary_expect_sqlstate(format(
  'select public.authorize_waybill_synthetic_email_canary_trip(%L::uuid)',
  current_setting('test.phase3b_ordinary_trip_id')),'42501',
  'an ordinary open trip cannot obtain the reserved invoice permit');
reset role;

select set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','c0000000-0000-4000-8000-000000000003',
  'session_id','c2000000-0000-4000-8000-000000000003',
  'iat',extract(epoch from statement_timestamp())::bigint
)::text,true);
select set_config('test.phase3b_offloading_assignment',(
  select assignment.id::text from public.user_site_assignments assignment
  where assignment.profile_id='c0000000-0000-4000-8000-000000000003'
    and assignment.site_id='c1000000-0000-4000-8000-000000000002' and assignment.ended_at is null
  order by assignment.assigned_at desc limit 1
),true);
set local role authenticated;
insert into phase3b_close_responses(closure_kind,response)
select 'reserved',public.close_trip_v2(
  'c3000000-0000-4000-8000-000000000003',
  current_setting('test.phase3b_trip_id')::uuid,'SYNTHCANARY999',
  current_setting('test.phase3b_offloading_assignment')::uuid,9,
  'MANUAL',statement_timestamp(),null,null,null
);
reset role;
select pg_temp.canary_assert_close_response(
  'reserved','c3000000-0000-4000-8000-000000000003',
  current_setting('test.phase3b_trip_id')::uuid,'WB-9999-999999');

set local role authenticated;
insert into phase3b_close_responses(closure_kind,response)
select 'ordinary',public.close_trip_v2(
  'c3000000-0000-4000-8000-000000000006',
  current_setting('test.phase3b_ordinary_trip_id')::uuid,'ORDINARYCANARY1',
  current_setting('test.phase3b_offloading_assignment')::uuid,8,
  'MANUAL',statement_timestamp(),null,null,null
);
reset role;
select pg_temp.canary_assert_close_response(
  'ordinary','c3000000-0000-4000-8000-000000000006',
  current_setting('test.phase3b_ordinary_trip_id')::uuid,null,true);
select pg_temp.canary_assert((
  select count(*)=1
    and bool_and(invoice.invoice_number<>'WB-9999-999999'
      and trip.status='closed' and invoice.closed_at=trip.closed_at
      and (select count(*)=1 from public.trip_closure_invoice_documents document where document.invoice_id=invoice.id)
      and (select count(*)=2 from public.notification_outbox notification
        where notification.trip_id=trip.id and notification.event_type='waybill_ready'))
  from public.trip_closure_invoices invoice
  join public.trips trip on trip.id=invoice.trip_id
  where trip.id=current_setting('test.phase3b_ordinary_trip_id')::uuid
),'ordinary trip is closed and has exactly one normal invoice, document, and notification pair');
select set_config('test.phase3b_ordinary_invoice_id',(
  select invoice.id::text from public.trip_closure_invoices invoice
  where invoice.trip_id=current_setting('test.phase3b_ordinary_trip_id')::uuid
),true);

select pg_temp.canary_assert((
  select count(*)=1 and bool_and(invoice.invoice_number='WB-9999-999999'
    and trip.status='closed' and invoice.closed_at=trip.closed_at)
  from public.trip_closure_invoices invoice
  join public.trips trip on trip.id=invoice.trip_id
  where trip.id=current_setting('test.phase3b_trip_id')::uuid
),'reserved trip has exactly one matching invoice with the reserved number and matching closure timestamps');
select set_config('test.phase3b_invoice_id',(
  select invoice.id::text from public.trip_closure_invoices invoice
  where invoice.trip_id=current_setting('test.phase3b_trip_id')::uuid
),true);
select pg_temp.canary_assert((
  select trip.status='closed' and invoice.closed_at=trip.closed_at
    and invoice.issued_at=trip.closed_at and invoice.opened_at<trip.closed_at
  from public.trip_closure_invoices invoice join public.trips trip on trip.id=invoice.trip_id
  where invoice.id=current_setting('test.phase3b_invoice_id')::uuid
),'reserved invoice is generated by the normal close lifecycle with consistent timestamps');
select pg_temp.canary_assert((
  select count(*)=1 and bool_and(invoice.invoice_number='WB-9999-999999')
  from public.trip_closure_invoices invoice
  where invoice.trip_id=current_setting('test.phase3b_trip_id')::uuid
),'reserved synthetic trip produces exactly one invoice and it uses only the reserved number');
select pg_temp.canary_assert(not exists (
  select 1 from public.trip_closure_invoice_documents document
  where document.invoice_id=current_setting('test.phase3b_invoice_id')::uuid
) and not exists (
  select 1 from public.notification_outbox notification
  join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id
  where invoice.id=current_setting('test.phase3b_invoice_id')::uuid and notification.event_type='waybill_ready'
),'reserved invoice bypasses legacy PDF and email queue creation only');
select pg_temp.canary_assert((
  select count(*)=1 and bool_and(snapshot.source_kind='registration_capture'
    and snapshot.source_registration_capture_id is not null
    and snapshot.verified_by is null and snapshot.verified_at is null
    and company_copy.status='pending'
    and company_copy.bank_snapshot_id=snapshot.id)
  from public.trip_closure_invoice_bank_snapshots snapshot
  join public.trip_closure_invoice_pdf_copies company_copy
    on company_copy.invoice_id=snapshot.invoice_id and company_copy.trip_id=snapshot.trip_id
      and company_copy.copy_kind='company' and company_copy.copy_version=1
  where snapshot.invoice_id=current_setting('test.phase3b_invoice_id')::uuid
    and snapshot.version=1
),'registration capture creates an unverified version-1 snapshot referenced by a pending Company copy');
create temporary table phase3b_unverified_company_copy_before on commit drop as
select id,status,attempts,lease_token,lease_until
from public.trip_closure_invoice_pdf_copies
where invoice_id=current_setting('test.phase3b_invoice_id')::uuid
  and copy_kind='company' and copy_version=1;
select pg_temp.canary_assert((
  select driver_copy.status='pending' and driver_copy.bank_snapshot_id is null
    and driver_copy.notification_eligible
  from public.trip_closure_invoice_pdf_copies driver_copy
  where driver_copy.invoice_id=current_setting('test.phase3b_invoice_id')::uuid
    and driver_copy.copy_kind='driver' and driver_copy.copy_version=1
),'Driver PDF remains independently eligible without banking data');

set local role service_role;
select pg_temp.canary_assert(not exists (
  select 1 from public.claim_waybill_synthetic_canary_pdf_jobs(
    current_setting('test.phase3b_invoice_id')::uuid,'company')
),'unverified Company bank snapshot cannot be claimed');
reset role;
select pg_temp.canary_assert((
  select count(*)=1 and bool_and(copy.status=before_row.status
    and copy.attempts=before_row.attempts
    and copy.lease_token is not distinct from before_row.lease_token
    and copy.lease_until is not distinct from before_row.lease_until)
  from phase3b_unverified_company_copy_before before_row
  join public.trip_closure_invoice_pdf_copies copy on copy.id=before_row.id
),'blocked Company claim leaves status, attempts and lease unchanged');
set local role service_role;
insert into phase3b_pdf_claims
select 'driver',job.* from public.claim_waybill_synthetic_canary_pdf_jobs(
  current_setting('test.phase3b_invoice_id')::uuid,'driver') job;
select pg_temp.canary_assert((select count(*)=1 from phase3b_pdf_claims where copy_kind='driver'),
  'invoice-scoped PDF RPC claims only the synthetic Driver copy');
select pg_temp.canary_assert(not exists (
  select 1 from public.claim_driver_waybill_pdf_jobs(10,current_setting('test.phase3b_invoice_id')::uuid)
),'normal PDF worker claim cannot consume the reserved canary invoice');
reset role;

insert into storage.objects(bucket_id,name,owner_id,metadata)
select storage_bucket,storage_path,'c0000000-0000-4000-8000-000000000004',
  jsonb_build_object('mimetype','application/pdf','size',4096)
from phase3b_pdf_claims where copy_kind='driver';
set local role service_role;
select pg_temp.canary_assert((
  select not (public.get_driver_waybill_pdf_snapshot(copy_id,lease_token) ?| array[
    'driver_phone','bank_name','account_name','account_number'
  ]) from phase3b_pdf_claims where copy_kind='driver'
),'Driver PDF snapshot contains no bank fields or driver phone');
select pg_temp.canary_assert((
  select public.finish_driver_waybill_pdf_job(copy_id,lease_token,true,null)
  from phase3b_pdf_claims where copy_kind='driver'
),'Driver PDF lease completes only after the synthetic private object metadata is present');
reset role;

select set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000004',true);
select set_config('request.jwt.claims',jsonb_build_object('sub','c0000000-0000-4000-8000-000000000004')::text,true);
set local role authenticated;
\o /dev/null
select * from public.save_waybill_company_bank_details(
  current_setting('test.phase3b_invoice_id')::uuid,'c3000000-0000-4000-8000-000000000006',
  'Synthetic Verified Bank','Synthetic Verified Account','0000000001'
);
\o
reset role;
select pg_temp.canary_assert((
  select snapshot.version=2 and snapshot.verified_by='c0000000-0000-4000-8000-000000000004'
    and snapshot.verified_at is not null and snapshot.source_kind='operations_manager'
    and company_copy.copy_version=2 and not company_copy.notification_eligible
    and company_copy.status='pending' and company_copy.bank_snapshot_id=snapshot.id
  from public.trip_closure_invoice_bank_snapshots snapshot
  join public.trip_closure_invoice_pdf_copies company_copy
    on company_copy.bank_snapshot_id=snapshot.id and company_copy.invoice_id=snapshot.invoice_id
  where snapshot.invoice_id=current_setting('test.phase3b_invoice_id')::uuid
    and snapshot.version=2 and company_copy.copy_kind='company'
),'Operations Manager save creates the verified versioned Company PDF snapshot');

set local role service_role;
insert into phase3b_pdf_claims
select 'company',job.* from public.claim_waybill_synthetic_canary_pdf_jobs(
  current_setting('test.phase3b_invoice_id')::uuid,'company') job;
select pg_temp.canary_assert((select count(*)=1 from phase3b_pdf_claims where copy_kind='company'),
  'invoice-scoped PDF RPC claims only the verified Company copy');
reset role;

insert into storage.objects(bucket_id,name,owner_id,metadata)
select storage_bucket,storage_path,'c0000000-0000-4000-8000-000000000004',
  jsonb_build_object('mimetype','application/pdf','size',6144)
from phase3b_pdf_claims where copy_kind='company';
set local role service_role;
select pg_temp.canary_assert((
  select (public.get_company_waybill_pdf_snapshot(copy_id,lease_token)->>'account_number')='0000000001'
    and (public.get_company_waybill_pdf_snapshot(copy_id,lease_token)->>'bank_name')='Synthetic Verified Bank'
  from phase3b_pdf_claims where copy_kind='company'
),'Company PDF snapshot contains only the verified synthetic bank snapshot');
select pg_temp.canary_assert((
  select public.finish_company_waybill_pdf_job(copy_id,lease_token,true,null)
  from phase3b_pdf_claims where copy_kind='company'
),'Company PDF lease completes only after its private object metadata exists');
reset role;

select pg_temp.canary_assert(private.waybill_synthetic_email_canary_pdfs_ready(
  current_setting('test.phase3b_invoice_id')::uuid
),'both latest private PDF copies are ready with verified object metadata');
select pg_temp.canary_assert((
  select not company_copy.notification_eligible
    and private.waybill_synthetic_email_canary_pdfs_ready(invoice.id)
    and not private.waybill_email_regular_delivery_allowed(invoice.id,invoice.trip_id)
  from public.trip_closure_invoices invoice
  join public.trip_closure_invoice_pdf_copies company_copy
    on company_copy.invoice_id=invoice.id and company_copy.trip_id=invoice.trip_id
      and company_copy.copy_kind='company' and company_copy.copy_version=2
  where invoice.id=current_setting('test.phase3b_invoice_id')::uuid
),'verified Company v2 is eligible only through the reserved canary path and remains ineligible for normal delivery');
set local role service_role;
select public.arm_waybill_synthetic_email_canary(current_setting('test.phase3b_invoice_id')::uuid,60);
select pg_temp.canary_assert(public.provision_waybill_synthetic_email_canary_notifications(
  current_setting('test.phase3b_invoice_id')::uuid,'synthetic-company@example.invalid')=2,
  'active canary creates exactly two fixed-recipient Driver and Company notification rows');
select pg_temp.canary_assert(public.provision_waybill_synthetic_email_canary_notifications(
  current_setting('test.phase3b_invoice_id')::uuid,'synthetic-company@example.invalid')=0,
  'repeated canary notification provisioning is idempotent');
reset role;

select pg_temp.canary_assert((
  select count(*)=2 and count(distinct audience)=2
  from public.notification_outbox notification
  where notification.trip_id=current_setting('test.phase3b_trip_id')::uuid
    and notification.event_type='waybill_ready' and notification.delivery_sequence=0
),'fixture ends with exactly one Driver and one Company canary notification');

commit;
