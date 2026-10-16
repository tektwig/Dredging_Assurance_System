begin;

create function pg_temp.bank_save_assert(v boolean,m text) returns void language plpgsql as $$
begin
  if v is distinct from true then raise exception 'Bank-save assertion failed: %',m; end if;
end
$$;
create function pg_temp.bank_save_expect_error(q text,expected_state text) returns void language plpgsql as $$
declare actual_state text;
begin
  begin
    execute q;
  exception when others then
    get stacked diagnostics actual_state=returned_sqlstate;
    if actual_state=expected_state then return; end if;
    raise exception 'Expected SQLSTATE %, got %',expected_state,actual_state;
  end;
  raise exception 'Expected SQLSTATE %, statement succeeded',expected_state;
end
$$;
create temp table bank_save_state(k text primary key,v jsonb);
grant all on bank_save_state to authenticated,service_role;
insert into bank_save_state values('baseline',jsonb_build_object(
  'submissions',(select count(*) from public.trip_closure_invoice_bank_submissions),
  'snapshots',(select count(*) from public.trip_closure_invoice_bank_snapshots),
  'events',(select count(*) from public.trip_closure_invoice_bank_detail_events),
  'pdf_copies',(select count(*) from public.trip_closure_invoice_pdf_copies),
  'legacy_documents',(select count(*) from public.trip_closure_invoice_documents),
  'notifications',(select count(*) from public.notification_outbox)
));

select pg_temp.bank_save_assert(
  has_function_privilege('authenticated','public.save_waybill_company_bank_details(uuid,text,text,text)','EXECUTE')
  and not has_function_privilege('anon','public.save_waybill_company_bank_details(uuid,text,text,text)','EXECUTE')
  and not has_function_privilege('service_role','public.save_waybill_company_bank_details(uuid,text,text,text)','EXECUTE')
  and not has_table_privilege('authenticated','public.trip_closure_invoice_bank_submissions','SELECT')
  and not has_table_privilege('authenticated','public.trip_closure_invoice_bank_detail_events','INSERT')
  and not has_table_privilege('authenticated','public.trip_closure_invoice_bank_detail_events','SELECT')
  and not has_table_privilege('authenticated','public.trip_closure_invoice_bank_snapshots','SELECT'),
  'bank values remain behind the authenticated RPC and private table permissions'
);

insert into auth.users(id,email,raw_user_meta_data) values
  ('d9910000-0000-0000-0000-000000000001','bank-save-manager@example.invalid','{}'),
  ('d9910000-0000-0000-0000-000000000002','bank-save-admin@example.invalid','{}'),
  ('d9910000-0000-0000-0000-000000000003','bank-save-finance@example.invalid','{}'),
  ('d9910000-0000-0000-0000-000000000004','bank-save-loader@example.invalid','{}'),
  ('d9910000-0000-0000-0000-000000000005','bank-save-offloader@example.invalid','{}'),
  ('d9910000-0000-0000-0000-000000000006','bank-save-audit-reader@example.invalid','{}');
update public.profiles
set display_name=case id
    when 'd9910000-0000-0000-0000-000000000001' then 'Synthetic Bank Operations Manager'
    when 'd9910000-0000-0000-0000-000000000006' then 'Synthetic Audit Reader'
    else 'Synthetic Bank Test User' end,
  role=case id
    when 'd9910000-0000-0000-0000-000000000001' then 'operations_manager'::public.app_role
    when 'd9910000-0000-0000-0000-000000000006' then 'operations_manager'::public.app_role
    when 'd9910000-0000-0000-0000-000000000002' then 'system_administrator'::public.app_role
    when 'd9910000-0000-0000-0000-000000000003' then 'finance_officer'::public.app_role
    when 'd9910000-0000-0000-0000-000000000004' then 'loading_officer'::public.app_role
    else 'offloading_officer'::public.app_role end,
  is_active=true
where id::text like 'd9910000-%';

insert into public.sites(id,name,site_type,is_active) values
  ('d9920000-0000-0000-0000-000000000001','Synthetic Bank Loading Site','loading',true),
  ('d9920000-0000-0000-0000-000000000002','Synthetic Bank Offloading Site','offloading',true);
insert into public.drivers(id,full_name,phone_number,email,license_number) values
  ('d9930000-0000-0000-0000-000000000001','Synthetic Bank Driver','08000000000','bank-driver@example.invalid','SYNTHETIC-BANK-LIC');
insert into public.trucks(id,registration_number,driver_id,truck_type,capacity,capacity_unit,owner_name) values
  ('d9940000-0000-0000-0000-000000000001','BANK-SYN-001','d9930000-0000-0000-0000-000000000001',
   'Synthetic Truck',20,'tonnes','Synthetic Owner');

set local role authenticated;
select set_config('request.jwt.claim.sub','d9910000-0000-0000-0000-000000000002',true);
select public.assign_user_site('d9910000-0000-0000-0000-000000000004','d9920000-0000-0000-0000-000000000001');
select public.assign_user_site('d9910000-0000-0000-0000-000000000005','d9920000-0000-0000-0000-000000000002');
select set_config('request.jwt.claim.sub','d9910000-0000-0000-0000-000000000004',true);
insert into bank_save_state values('opened',public.create_loading_trip_v2(
  'd9950000-0000-0000-0000-000000000001','BANK-SYN-001','d9930000-0000-0000-0000-000000000001',
  (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
  'MANUAL',clock_timestamp(),12.50));
select set_config('request.jwt.claim.sub','d9910000-0000-0000-0000-000000000005',true);
insert into bank_save_state values('closed',public.close_trip_v2(
  'd9960000-0000-0000-0000-000000000001',
  (select (v#>>'{trip,id}')::uuid from bank_save_state where k='opened'),
  'BANK-SYN-001',(select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
  12.50,'MANUAL',clock_timestamp()));
reset role;

insert into bank_save_state
select 'invoice',jsonb_build_object('id',invoice.id,'trip_id',invoice.trip_id,'invoice_number',invoice.invoice_number)
from public.trip_closure_invoices invoice
where invoice.trip_id=(select (v#>>'{trip,id}')::uuid from bank_save_state where k='opened');
select pg_temp.bank_save_assert((select count(*)=1 from bank_save_state where k='invoice'),
  'synthetic trip closure created exactly one Waybill for the workflow');
select pg_temp.bank_save_assert((
  select count(*)=2
    and count(*) filter(where copy_kind='driver' and status='pending' and bank_snapshot_id is null)=1
    and count(*) filter(where copy_kind='company' and status='blocked_missing_bank_details'
      and bank_snapshot_id is null)=1
  from public.trip_closure_invoice_pdf_copies
  where invoice_id=(select (v->>'id')::uuid from bank_save_state where k='invoice')
), 'closure keeps Driver PDF generation independent and holds only the Company PDF');

set local role authenticated;
select set_config('request.jwt.claim.sub','d9910000-0000-0000-0000-000000000002',true);
select pg_temp.bank_save_expect_error(format(
  'select public.save_waybill_company_bank_details(%L,%L,%L,%L)',
  (select v->>'id' from bank_save_state where k='invoice'),'Synthetic Bank','Synthetic Account','1234567890'
), '42501');
select set_config('request.jwt.claim.sub','d9910000-0000-0000-0000-000000000003',true);
select pg_temp.bank_save_expect_error(format(
  'select public.save_waybill_company_bank_details(%L,%L,%L,%L)',
  (select v->>'id' from bank_save_state where k='invoice'),'Synthetic Bank','Synthetic Account','1234567890'
), '42501');
reset role;
select pg_temp.bank_save_assert(
  (select count(*)=0 from public.trip_closure_invoice_bank_submissions)
  and (select count(*)=0 from public.trip_closure_invoice_bank_snapshots)
  and (select count(*)=0 from public.trip_closure_invoice_bank_detail_events),
  'System Administrator and Finance Officer denials create no bank or audit rows'
);

set local role service_role;
insert into bank_save_state
select 'driver_job',to_jsonb(job)
from public.claim_driver_waybill_pdf_jobs(1,(select (v->>'id')::uuid from bank_save_state where k='invoice')) job;
insert into bank_save_state
select 'driver_snapshot',public.get_driver_waybill_pdf_snapshot(
  (select (v->>'copy_id')::uuid from bank_save_state where k='driver_job'),
  (select (v->>'lease_token')::uuid from bank_save_state where k='driver_job'));
reset role;
select pg_temp.bank_save_assert((
  select v ? 'invoice_number'
    and not (v ?| array['driver_phone','bank_name','account_name','account_number'])
  from bank_save_state where k='driver_snapshot'
), 'the Driver PDF snapshot excludes phone and all banking fields');

set local role authenticated;
select set_config('request.jwt.claim.sub','d9910000-0000-0000-0000-000000000001',true);
insert into bank_save_state values('first_save',to_jsonb(public.save_waybill_company_bank_details(
  (select (v->>'id')::uuid from bank_save_state where k='invoice'),
  'Synthetic Bank One','Synthetic Account One','1234567890')));
insert into bank_save_state
select 'first_management_state',to_jsonb(state)
from public.get_operations_waybill_copy_management_state(
  (select (v->>'id')::uuid from bank_save_state where k='invoice')) state;
insert into bank_save_state
select 'first_audit',to_jsonb(event)
from public.get_operations_waybill_bank_audit(
  (select (v->>'id')::uuid from bank_save_state where k='invoice')) event;
select pg_temp.bank_save_assert((
  select v->>'bank_verification_state'='verified'
    and v->>'latest_bank_snapshot_version'='1'
    and v->>'company_pdf_status'='pending'
    and not (v ?| array['bank_name','account_name','account_number','storage_path','storage_bucket'])
  from bank_save_state where k='first_management_state'
), 'one save atomically verifies the bank snapshot and queues only the Company PDF');
select pg_temp.bank_save_assert((
  select count(*)=1
    and count(*) filter(where event_type='verified'
      and actor_display_name='Synthetic Bank Operations Manager'
      and actor_role='operations_manager'
      and not (to_jsonb(audit_event) ?| array['actor_id','bank_name','account_name','account_number','storage_path']))=1
  from public.get_operations_waybill_bank_audit(
    (select (v->>'id')::uuid from bank_save_state where k='invoice')) audit_event
), 'one initial save produces one human-readable, privacy-limited audit event');
select pg_temp.bank_save_assert((
  select count(*)=1 and min(copy.status)='processing'
  from public.trip_closure_invoice_pdf_copies copy
  where copy.invoice_id=(select (v->>'id')::uuid from bank_save_state where k='invoice')
    and copy.copy_kind='driver'
), 'saving company bank details leaves the Driver PDF job independent');
reset role;

select pg_temp.bank_save_assert((
  select count(*)=1 and min(snapshot.version)=1
    and bool_and(snapshot.submitted_by=snapshot.verified_by)
    and bool_and(snapshot.verified_at>=snapshot.submitted_at)
    and bool_and(snapshot.account_number='1234567890')
  from public.trip_closure_invoice_bank_snapshots snapshot
  where snapshot.invoice_id=(select (v->>'id')::uuid from bank_save_state where k='invoice')
), 'initial save creates one immediately verified immutable bank snapshot');

insert into public.trip_closure_invoice_pdf_copies(
  invoice_id,trip_id,invoice_number,copy_kind,copy_version,status,storage_bucket,storage_path,
  bank_snapshot_id,notification_eligible
)
select invoice.id,invoice.trip_id,invoice.invoice_number,'company',2,'pending','waybill-company-copies',
  private.secure_waybill_copy_storage_path(invoice.invoice_number,'company',2),snapshot.id,false
from public.trip_closure_invoices invoice
join public.trip_closure_invoice_bank_snapshots snapshot
  on snapshot.invoice_id=invoice.id and snapshot.version=1
where invoice.id=(select (v->>'id')::uuid from bank_save_state where k='invoice');
select pg_temp.bank_save_expect_error(format(
  'select public.save_waybill_company_bank_details(%L,%L,%L,%L)',
  (select v->>'id' from bank_save_state where k='invoice'),
  'Synthetic Bank Two','Synthetic Account Two','2222222222'
), '23505');
select pg_temp.bank_save_assert(
  (select count(*)=1 from public.trip_closure_invoice_bank_submissions
   where invoice_id=(select (v->>'id')::uuid from bank_save_state where k='invoice'))
  and (select count(*)=1 from public.trip_closure_invoice_bank_snapshots
   where invoice_id=(select (v->>'id')::uuid from bank_save_state where k='invoice'))
  and (select count(*)=1 from public.trip_closure_invoice_bank_detail_events
   where invoice_id=(select (v->>'id')::uuid from bank_save_state where k='invoice')),
  'a failure after audit/snapshot writes rolls back the whole correction RPC statement'
);
delete from public.trip_closure_invoice_pdf_copies
where invoice_id=(select (v->>'id')::uuid from bank_save_state where k='invoice')
  and copy_kind='company' and copy_version=2;

set local role authenticated;
select set_config('request.jwt.claim.sub','d9910000-0000-0000-0000-000000000001',true);
insert into bank_save_state values('correction_save',to_jsonb(public.save_waybill_company_bank_details(
  (select (v->>'id')::uuid from bank_save_state where k='invoice'),
  'Synthetic Bank Two','Synthetic Account Two','2222222222')));
insert into bank_save_state
select 'final_management_state',to_jsonb(state)
from public.get_operations_waybill_copy_management_state(
  (select (v->>'id')::uuid from bank_save_state where k='invoice')) state;
insert into bank_save_state
select 'final_audit',to_jsonb(event)
from public.get_operations_waybill_bank_audit(
  (select (v->>'id')::uuid from bank_save_state where k='invoice')) event;
reset role;

select pg_temp.bank_save_assert((
  select count(*)=2
    and count(*) filter(where version=1 and account_number='1234567890'
      and supersedes_snapshot_id is null)=1
    and count(*) filter(where version=2 and account_number='2222222222'
      and supersedes_snapshot_id is not null)=1
  from public.trip_closure_invoice_bank_snapshots
  where invoice_id=(select (v->>'id')::uuid from bank_save_state where k='invoice')
), 'a correction creates a new immutable snapshot version without replacing the prior one');
select pg_temp.bank_save_assert((
  select count(*)=2
    and count(*) filter(where copy_version=1 and bank_snapshot_id=(
      select id from public.trip_closure_invoice_bank_snapshots where invoice_id=copy.invoice_id and version=1
    ))=1
    and count(*) filter(where copy_version=2 and notification_eligible=false and status='pending'
      and bank_snapshot_id=(select id from public.trip_closure_invoice_bank_snapshots
        where invoice_id=copy.invoice_id and version=2))=1
  from public.trip_closure_invoice_pdf_copies copy
  where copy.invoice_id=(select (v->>'id')::uuid from bank_save_state where k='invoice')
    and copy.copy_kind='company'
), 'correction queues a new Company PDF version, preserves the prior copy, and does not auto-notify');
select pg_temp.bank_save_assert((
  select v->>'bank_verification_state'='verified'
    and v->>'latest_bank_snapshot_version'='2'
    and v->>'company_pdf_status'='pending'
    and v->>'driver_pdf_status'='processing'
  from bank_save_state where k='final_management_state'
), 'management state reports the current Company version without changing Driver status');
select pg_temp.bank_save_assert((
  select count(*)=2
    and count(*) filter(where event_type='verified'
      and actor_display_name='Synthetic Bank Operations Manager'
      and actor_role='operations_manager')=1
    and count(*) filter(where event_type='correction_verified'
      and actor_display_name='Synthetic Bank Operations Manager'
      and actor_role='operations_manager')=1
  from public.get_operations_waybill_bank_audit(
    (select (v->>'id')::uuid from bank_save_state where k='invoice'))
), 'initial save and correction each produce one attributed audit event');

update public.profiles
set role='finance_officer'::public.app_role
where id='d9910000-0000-0000-0000-000000000001';
alter table public.trip_closure_invoice_bank_detail_events
  disable trigger trip_closure_invoice_bank_detail_events_capture_actor_role;
insert into public.trip_closure_invoice_bank_detail_events(
  submission_id,invoice_id,trip_id,event_type,reason_code,actor_id,occurred_at,actor_role_at_event
)
select submission.id,submission.invoice_id,submission.trip_id,'review_viewed',null,
  'd9910000-0000-0000-0000-000000000001',clock_timestamp()-interval '1 day',null
from public.trip_closure_invoice_bank_submissions submission
where submission.invoice_id=(select (v->>'id')::uuid from bank_save_state where k='invoice')
order by submission.submitted_at,submission.id
limit 1;
alter table public.trip_closure_invoice_bank_detail_events
  enable trigger trip_closure_invoice_bank_detail_events_capture_actor_role;

set local role authenticated;
select set_config('request.jwt.claim.sub','d9910000-0000-0000-0000-000000000006',true);
insert into bank_save_state
select 'role_change_audit',coalesce(jsonb_agg(to_jsonb(audit_event)),'[]'::jsonb)
from public.get_operations_waybill_bank_audit(
  (select (v->>'id')::uuid from bank_save_state where k='invoice')) audit_event;
reset role;
select pg_temp.bank_save_assert((
  (select role='finance_officer' from public.profiles
    where id='d9910000-0000-0000-0000-000000000001')
  and (select count(*)=3
    and count(*) filter(where value->>'event_type'='verified'
      and value->>'actor_role'='operations_manager')=1
    and count(*) filter(where value->>'event_type'='correction_verified'
      and value->>'actor_role'='operations_manager')=1
    and count(*) filter(where value->>'event_type'='review_viewed'
      and value->>'actor_role'='Role not recorded')=1
    from jsonb_array_elements((select v from bank_save_state where k='role_change_audit')) value)
), 'audit preserves event-time role after a profile role change and labels legacy events without a snapshot');
update public.profiles
set role='operations_manager'::public.app_role
where id='d9910000-0000-0000-0000-000000000001';

select pg_temp.bank_save_expect_error(format(
  'update public.trip_closure_invoice_bank_snapshots set account_name=%L where invoice_id=%L and version=1',
  'Mutated Synthetic Account',(select v->>'id' from bank_save_state where k='invoice')
), '23514');
select pg_temp.bank_save_expect_error(format(
  'update public.trip_closure_invoice_bank_detail_events set reason_code=%L where invoice_id=%L',
  'mutated',(select v->>'id' from bank_save_state where k='invoice')
), '23514');
select pg_temp.bank_save_assert(
  (select count(*)=(select (v->>'submissions')::bigint+2 from bank_save_state where k='baseline')
    from public.trip_closure_invoice_bank_submissions)
  and (select count(*)=(select (v->>'snapshots')::bigint+2 from bank_save_state where k='baseline')
    from public.trip_closure_invoice_bank_snapshots)
  and (select count(*)=(select (v->>'events')::bigint+3 from bank_save_state where k='baseline')
    from public.trip_closure_invoice_bank_detail_events)
  and (select count(*)=(select (v->>'pdf_copies')::bigint+3 from bank_save_state where k='baseline')
    from public.trip_closure_invoice_pdf_copies)
  and (select count(*)=(select (v->>'legacy_documents')::bigint+1 from bank_save_state where k='baseline')
    from public.trip_closure_invoice_documents)
  and (select count(*)=(select (v->>'notifications')::bigint+2 from bank_save_state where k='baseline')
    from public.notification_outbox),
  'only the expected synthetic Waybill, copy versions, audit events, and notifications are added'
);

rollback;
