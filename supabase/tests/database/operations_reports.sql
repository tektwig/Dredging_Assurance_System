begin;

create function pg_temp.report_assert(condition boolean,message text) returns void language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'Operations report assertion failed: %',message; end if;
  raise notice 'ASSERTION PASS: %',message;
end $$;
create function pg_temp.report_error(query text,state text) returns void language plpgsql as $$
declare actual text;
begin
  begin execute query;
  exception when others then
    get stacked diagnostics actual=returned_sqlstate;
    if actual=state then
      raise notice 'ASSERTION PASS: expected SQLSTATE %',state;
      return;
    end if;
    raise exception 'Expected SQLSTATE %, got %',state,actual;
  end;
  raise exception 'Expected SQLSTATE %',state;
end $$;

select pg_temp.report_assert(has_function_privilege('authenticated','public.get_operations_report(text,jsonb,integer,integer)','EXECUTE')
  and has_function_privilege('authenticated','public.export_operations_report(text,jsonb,text)','EXECUTE')
  and not has_function_privilege('anon','public.get_operations_report(text,jsonb,integer,integer)','EXECUTE')
  and not has_function_privilege('service_role','public.get_operations_report(text,jsonb,integer,integer)','EXECUTE'),
  'report RPC grants are authenticated only');

insert into auth.users(id,email,raw_user_meta_data) values
 ('f7310000-0000-0000-0000-000000000001','reports-ops@example.invalid','{}'),
 ('f7310000-0000-0000-0000-000000000002','reports-loading@example.invalid','{}'),
 ('f7310000-0000-0000-0000-000000000003','reports-finance@example.invalid','{}'),
 ('f7310000-0000-0000-0000-000000000004','reports-inactive@example.invalid','{}');
update public.profiles set role=case right(id::text,1)
  when '1' then 'operations_manager'::public.app_role
  when '2' then 'loading_officer'::public.app_role
  when '3' then 'finance_officer'::public.app_role
  else 'operations_manager'::public.app_role end,
  is_active=right(id::text,1)<>'4' where id::text like 'f7310000-%';
insert into public.sites(id,name,site_type) values
 ('f7320000-0000-0000-0000-000000000001','Reports Loading','loading'),
 ('f7320000-0000-0000-0000-000000000002','Reports Offloading','offloading');
insert into public.drivers(id,full_name,phone_number,email) values
 ('f7330000-0000-0000-0000-000000000001','Regular Driver','08017000001','regular@example.invalid'),
 ('f7330000-0000-0000-0000-000000000002','Actual Trip Driver','08017000002','actual@example.invalid');
insert into public.trucks(id,registration_number,driver_id) values
 ('f7340000-0000-0000-0000-000000000001','RPT-001','f7330000-0000-0000-0000-000000000001'),
 ('f7340000-0000-0000-0000-000000000002','RPT-002','f7330000-0000-0000-0000-000000000002');

alter table public.daily_registrations disable trigger user;
insert into public.daily_registrations(id,truck_id,initial_driver_id,operational_date,registered_at,registered_by) values
 ('f7350000-0000-0000-0000-000000000001','f7340000-0000-0000-0000-000000000001','f7330000-0000-0000-0000-000000000001',
  date '2000-01-01',timestamp with time zone '2000-01-01 10:00 Africa/Lagos','f7310000-0000-0000-0000-000000000001'),
  ('f7350000-0000-0000-0000-000000000002','f7340000-0000-0000-0000-000000000002','f7330000-0000-0000-0000-000000000002',
  date '2000-01-01',timestamp with time zone '2000-01-01 10:00 Africa/Lagos','f7310000-0000-0000-0000-000000000001'),
  ('f7350000-0000-0000-0000-000000000003','f7340000-0000-0000-0000-000000000002','f7330000-0000-0000-0000-000000000002',
  date '2000-01-02',timestamp with time zone '2000-01-02 10:00 Africa/Lagos','f7310000-0000-0000-0000-000000000001');
alter table public.daily_registrations enable trigger user;

alter table public.trips disable trigger user;
insert into public.trips(id,trip_number,truck_id,driver_id,daily_registration_id,loading_site_id,offloading_site_id,
  status,quantity_tonnes,estimated_quantity_tonnes,opened_at,opened_by,closed_at,closed_by,cancelled_at,cancelled_by,cancellation_reason,
  truck_registration_at_loading,driver_name_at_loading)
values
 ('f7360000-0000-0000-0000-000000000001','RPT-TRIP-CLOSED','f7340000-0000-0000-0000-000000000001',
  'f7330000-0000-0000-0000-000000000002','f7350000-0000-0000-0000-000000000001',
  'f7320000-0000-0000-0000-000000000001','f7320000-0000-0000-0000-000000000002','closed',12.50,10.25,
  timestamp with time zone '1999-12-31 22:59:00+00','f7310000-0000-0000-0000-000000000002',
  timestamp with time zone '1999-12-31 23:00:00+00','f7310000-0000-0000-0000-000000000003',null,null,null,'RPT-001','Actual Trip Driver'),
 ('f7360000-0000-0000-0000-000000000002','RPT-TRIP-CANCELLED','f7340000-0000-0000-0000-000000000002',
  'f7330000-0000-0000-0000-000000000002','f7350000-0000-0000-0000-000000000002',
  'f7320000-0000-0000-0000-000000000001',null,'cancelled',null,null,
  timestamp with time zone '2000-01-01 10:00 Africa/Lagos','f7310000-0000-0000-0000-000000000002',
  null,null,timestamp with time zone '2000-01-01 23:00 Africa/Lagos','f7310000-0000-0000-0000-000000000002','Cancel secret',
  'RPT-002','Actual Trip Driver'),
  ('f7360000-0000-0000-0000-000000000003','RPT-TRIP-OLD-OPEN','f7340000-0000-0000-0000-000000000001',
   'f7330000-0000-0000-0000-000000000002','f7350000-0000-0000-0000-000000000001',
   'f7320000-0000-0000-0000-000000000001',null,'open',null,null,
  timestamp with time zone '1999-12-01 10:00 Africa/Lagos','f7310000-0000-0000-0000-000000000002',
  null,null,null,null,null,'RPT-001','Actual Trip Driver'),
  ('f7360000-0000-0000-0000-000000000004','RPT-TRIP-NO-SECURE-COPY','f7340000-0000-0000-0000-000000000002',
   'f7330000-0000-0000-0000-000000000002','f7350000-0000-0000-0000-000000000003',
   'f7320000-0000-0000-0000-000000000001','f7320000-0000-0000-0000-000000000002','closed',14.25,13.00,
   timestamp with time zone '2000-01-02 09:00+00','f7310000-0000-0000-0000-000000000002',
   timestamp with time zone '2000-01-02 10:00+00','f7310000-0000-0000-0000-000000000003',null,null,null,'RPT-002','Actual Trip Driver');
alter table public.trips enable trigger user;

insert into public.trip_closure_invoices(id,invoice_number,trip_id,trip_number,truck_id,truck_registration,
  driver_id,driver_name,driver_email,loading_site_id,loading_site_name,offloading_site_id,offloading_site_name,
  loading_officer_id,loading_officer_name,offloading_officer_id,offloading_officer_name,
  quantity_tonnes,opened_at,closed_at,issued_at)
values ('f7370000-0000-0000-0000-000000000001','INV-2026-999991','f7360000-0000-0000-0000-000000000001',
  'RPT-TRIP-CLOSED','f7340000-0000-0000-0000-000000000001','RPT-001','f7330000-0000-0000-0000-000000000002',
  'Actual Trip Driver','actual@example.invalid','f7320000-0000-0000-0000-000000000001','Reports Loading',
  'f7320000-0000-0000-0000-000000000002','Reports Offloading',
  'f7310000-0000-0000-0000-000000000002','Reports Loading Officer',
  'f7310000-0000-0000-0000-000000000003','Reports Offloading Officer',12.50,
  timestamp with time zone '1999-12-31 22:59:00+00',timestamp with time zone '1999-12-31 23:00:00+00',
  timestamp with time zone '2000-01-01 00:30:00+00');
insert into public.trip_closure_invoice_bank_submissions(
  id,invoice_id,trip_id,bank_name,account_name,account_number,submitted_by,submitted_at)
values ('f7390000-0000-0000-0000-000000000001','f7370000-0000-0000-0000-000000000001',
  'f7360000-0000-0000-0000-000000000001','Sensitive Bank','Sensitive Account','1111111111',
  'f7310000-0000-0000-0000-000000000001',timestamp with time zone '2000-01-01 00:30:00+00');
insert into public.trip_closure_invoice_bank_detail_events(
  submission_id,invoice_id,trip_id,event_type,actor_id,occurred_at)
values ('f7390000-0000-0000-0000-000000000001','f7370000-0000-0000-0000-000000000001',
  'f7360000-0000-0000-0000-000000000001','submitted','f7310000-0000-0000-0000-000000000001',
  timestamp with time zone '2000-01-01 00:30:00+00');
update public.trip_closure_invoice_documents set status='ready',ready_at=clock_timestamp()
where invoice_id='f7370000-0000-0000-0000-000000000001';
alter table public.trip_closure_invoices disable trigger queue_secure_waybill_pdf_copies;
insert into public.trip_closure_invoices(id,invoice_number,trip_id,trip_number,truck_id,truck_registration,
  driver_id,driver_name,driver_email,loading_site_id,loading_site_name,offloading_site_id,offloading_site_name,
  loading_officer_id,loading_officer_name,offloading_officer_id,offloading_officer_name,
  quantity_tonnes,opened_at,closed_at,issued_at)
values ('f7370000-0000-0000-0000-000000000002','INV-2026-999992','f7360000-0000-0000-0000-000000000004',
  'RPT-TRIP-NO-SECURE-COPY','f7340000-0000-0000-0000-000000000002','RPT-002','f7330000-0000-0000-0000-000000000002',
  'Actual Trip Driver','actual@example.invalid','f7320000-0000-0000-0000-000000000001','Reports Loading',
  'f7320000-0000-0000-0000-000000000002','Reports Offloading',
  'f7310000-0000-0000-0000-000000000002','Reports Loading Officer',
  'f7310000-0000-0000-0000-000000000003','Reports Offloading Officer',14.25,
  timestamp with time zone '2000-01-02 09:00+00',timestamp with time zone '2000-01-02 10:00+00',
  timestamp with time zone '2000-01-02 10:30+00');
alter table public.trip_closure_invoices enable trigger queue_secure_waybill_pdf_copies;
select pg_temp.report_assert((select tgenabled='O' from pg_trigger
  where tgrelid='public.trip_closure_invoices'::regclass and tgname='queue_secure_waybill_pdf_copies'),
  'synthetic no-copy fixture restores the secure copy queue trigger');
insert into public.trip_closure_invoice_pdf_copies(
  invoice_id,trip_id,invoice_number,copy_kind,copy_version,status,storage_bucket,storage_path)
values ('f7370000-0000-0000-0000-000000000001','f7360000-0000-0000-0000-000000000001',
  'INV-2026-999991','company',2,'blocked_bank_details_unverified','waybill-company-copies',
  private.secure_waybill_copy_storage_path('INV-2026-999991','company',2));
set local role authenticated;
select set_config('request.jwt.claim.sub','f7310000-0000-0000-0000-000000000001',true);
select set_config('test.exception_id',public.raise_trip_exception('dispute','EXCEPTION-FREE-TEXT-SECRET',
  'f7340000-0000-0000-0000-000000000002','f7360000-0000-0000-0000-000000000002',null,true)::text,true);
reset role;

select pg_temp.report_assert((public.get_operations_report('trips',
  '{"basis":"closed","date_from":"2000-01-01","date_to":"2000-01-01","truck_id":"f7340000-0000-0000-0000-000000000001"}',1,25)->>'total_count')::integer=1,
  'closed-trip report filters by the Lagos closed_at day including its midnight boundary');
select pg_temp.report_assert((public.get_operations_report('trips',
  '{"basis":"closed","date_from":"2000-01-01","date_to":"2000-01-01","truck_id":"f7340000-0000-0000-0000-000000000001"}',1,25)
  #>>'{items,0,estimated_tonnage_tonnes}')='10.25'
  and (public.get_operations_report('trips',
  '{"basis":"closed","date_from":"2000-01-01","date_to":"2000-01-01","truck_id":"f7340000-0000-0000-0000-000000000001"}',1,25)
  #>>'{items,0,tonnage_tonnes}')='12.50','Trips report keeps estimate distinct from actual tonnage');
select pg_temp.report_assert((public.get_operations_report('trips',
  '{"basis":"opened","date_from":"1999-12-31","date_to":"1999-12-31","truck_id":"f7340000-0000-0000-0000-000000000001"}',1,25)->>'total_count')::integer=1,
  'opened trip cohort uses Lagos opened_at dates');
select pg_temp.report_assert((public.get_operations_report('trips','{"basis":"open","truck_id":"f7340000-0000-0000-0000-000000000001"}',1,25)->>'total_count')::integer=1,
  'currently open report includes older open trips');
select pg_temp.report_assert((public.get_operations_report('trips',
  '{"basis":"cancelled","date_from":"2000-01-01","date_to":"2000-01-01","truck_id":"f7340000-0000-0000-0000-000000000002"}',1,25)->>'total_count')::integer=1,
  'cancelled trip report filters by cancelled_at');
select pg_temp.report_assert((public.get_operations_report('performance',
  '{"dimension":"truck","date_from":"1999-12-31","date_to":"1999-12-31","truck_id":"f7340000-0000-0000-0000-000000000001"}',1,25)#>>'{items,0,label}')='RPT-001',
  'truck performance uses opened cohort');
select pg_temp.report_assert((public.get_operations_report('performance',
  '{"dimension":"driver","date_from":"1999-12-31","date_to":"1999-12-31","driver_id":"f7330000-0000-0000-0000-000000000002"}',1,25)#>>'{items,0,label}')='Actual Trip Driver',
  'driver performance groups the actual trip driver, not regular truck driver');
select pg_temp.report_assert((public.get_operations_report('performance',
  '{"dimension":"site","direction":"loading","date_from":"1999-12-31","date_to":"1999-12-31","site_id":"f7320000-0000-0000-0000-000000000001"}',1,25)->>'total_count')::integer=1,
  'loading-site activity is based on opened_at');
select pg_temp.report_assert((public.get_operations_report('performance',
  '{"dimension":"site","direction":"offloading","date_from":"2000-01-01","date_to":"2000-01-01","site_id":"f7320000-0000-0000-0000-000000000002"}',1,25)#>>'{summary,tonnage_tonnes}')='12.50',
  'offloading-site activity and tonnage use closed_at');
select pg_temp.report_assert((public.get_operations_report('waybills',
  '{"date_from":"2000-01-01","date_to":"2000-01-01"}',1,25)->>'total_count')::integer=1,
  'Waybill report uses issued_at');
select pg_temp.report_assert((public.get_operations_report('waybills',
  '{"date_from":"2000-01-01","date_to":"2000-01-01"}',1,25)#>>'{items,0,driver_pdf_status}')='pending'
  and (public.get_operations_report('waybills','{"date_from":"2000-01-01","date_to":"2000-01-01"}',1,25)
    #>>'{items,0,company_pdf_status}')='blocked_bank_details_unverified'
  and (public.get_operations_report('waybills','{"date_from":"2000-01-01","date_to":"2000-01-01"}',1,25)
    #>>'{items,0,pdf_status}') is null,
  'secure Driver and latest Company copy states replace the ready legacy document status');
select pg_temp.report_assert((public.get_operations_report('waybills',
  '{"date_from":"2000-01-01","date_to":"2000-01-01"}',1,25)#>>'{items,0,driver_delivery_status}')='not_queued'
  and (public.get_operations_report('waybills','{"date_from":"2000-01-01","date_to":"2000-01-01"}',1,25)
    #>>'{items,0,company_delivery_status}')='not_queued'
  and (public.get_operations_report('waybills','{"date_from":"2000-01-01","date_to":"2000-01-01"}',1,25)
    #>>'{summary,driver_delivery_failed}')::integer=0
  and (public.get_operations_report('waybills','{"date_from":"2000-01-01","date_to":"2000-01-01"}',1,25)
    #>>'{summary,company_delivery_failed}')::integer=0,
  'blocked synthetic Waybill has no fabricated delivery records');
select pg_temp.report_assert((select count(*)=1 and bool_and(
    report_item.item->>'driver_delivery_status'='pending'
    and report_item.item->>'company_delivery_status'='sent')
  from jsonb_array_elements(public.get_operations_report('waybills',
    '{"date_from":"2026-10-15","date_to":"2026-10-15"}',1,100)->'items') as report_item(item)
  where report_item.item->>'invoice_number'='WB-2026-000040'),
  'persisted historical delivery records report pending Driver and sent Company states');
select pg_temp.report_assert((select count(*)=1
  from jsonb_array_elements(public.get_operations_report('waybills',
    '{"date_from":"2026-10-15","date_to":"2026-10-15","company_delivery_status":"sent"}',1,100)->'items') as report_item(item)
  where report_item.item->>'invoice_number'='WB-2026-000040'),
  'Company delivery filter includes the persisted sent notification');
select pg_temp.report_assert((public.get_operations_report('waybills',
  '{"date_from":"2000-01-02","date_to":"2000-01-02"}',1,25)#>>'{items,0,driver_pdf_status}')='unavailable'
  and (public.get_operations_report('waybills','{"date_from":"2000-01-02","date_to":"2000-01-02"}',1,25)
    #>>'{items,0,company_pdf_status}')='unavailable'
  and (public.get_operations_report('waybills','{"date_from":"2000-01-02","date_to":"2000-01-02"}',1,25)
    #>>'{items,0,driver_delivery_status}')='not_queued'
  and (public.get_operations_report('waybills','{"date_from":"2000-01-02","date_to":"2000-01-02"}',1,25)
    #>>'{items,0,company_delivery_status}')='not_queued',
  'Waybills without secure copies or audience notifications are explicitly unavailable or not queued');
select pg_temp.report_assert((public.get_operations_report('waybills',
  '{"date_from":"2000-01-01","date_to":"2000-01-01","company_pdf_status":"blocked_bank_details_unverified"}',1,25)
    ->>'total_count')::integer=1
  and (public.get_operations_report('waybills',
  '{"date_from":"2000-01-01","date_to":"2000-01-01","company_pdf_status":"blocked_missing_bank_details"}',1,25)
    ->>'total_count')::integer=0
  and (public.get_operations_report('waybills',
  '{"date_from":"2000-01-01","date_to":"2000-01-01","company_delivery_status":"sent"}',1,25)
    ->>'total_count')::integer=0,
  'status filters apply to latest secure copy and latest delivery state');
select pg_temp.report_assert((public.get_operations_report('waybills',
  '{"date_from":"2000-01-02","date_to":"2000-01-02","driver_pdf_status":"unavailable","company_delivery_status":"not_queued"}',1,25)
    ->>'total_count')::integer=1,
  'unavailable PDF and not-queued delivery filters find missing secure records');
select pg_temp.report_assert((public.get_operations_report('exceptions',
  jsonb_build_object('date_from',(statement_timestamp() at time zone 'Africa/Lagos')::date,
    'date_to',(statement_timestamp() at time zone 'Africa/Lagos')::date),1,25)->>'total_count')::integer=1,
  'Exceptions report uses created_at and includes an authorized open exception');
select pg_temp.report_error($q$select public.get_operations_report('trips',
  '{"date_from":"2026-09-01","date_to":"2026-11-30"}',1,25)$q$,'22023');
select pg_temp.report_error($q$select public.get_operations_report('performance',
  '{"dimension":"truck","site_id":"f7320000-0000-0000-0000-000000000001"}',1,25)$q$,'22023');
select pg_temp.report_error($q$select public.get_operations_report('performance','{}',1,25)$q$,'22023');
select pg_temp.report_error($q$select public.get_operations_report('performance',
  '{"dimension":"site"}',1,25)$q$,'22023');
select pg_temp.report_error($q$select public.get_operations_report('trips',
  '{"basis":"opened","unapproved":"x"}',1,25)$q$,'22023');
select pg_temp.report_error($q$select public.get_operations_report('waybills',
  '{"date_from":"2000-01-01","date_to":"2000-01-01","pdf_status":"ready"}',1,25)$q$,'22023');
select pg_temp.report_error($q$select public.get_operations_report('waybills',
  '{"date_from":"2000-01-01","date_to":"2000-01-01","delivery_status":"sent"}',1,25)$q$,'22023');
select pg_temp.report_error($q$select public.get_operations_report('waybills',
  '{"date_from":"2000-01-01","date_to":"2000-01-01","payout_status":"paid"}',1,25)$q$,'22023');
select pg_temp.report_error($q$select public.get_operations_report('waybills',
  '{"date_from":"2000-01-01","date_to":"2000-01-01","driver_pdf_status":"not_queued"}',1,25)$q$,'22023');

select pg_temp.report_assert(position('Sensitive Account' in public.get_operations_report('waybills',
  '{"date_from":"2000-01-01","date_to":"2000-01-01"}',1,25)::text)=0
  and position('Sensitive Bank' in public.get_operations_report('waybills',
  '{"date_from":"2000-01-01","date_to":"2000-01-01"}',1,25)::text)=0
  and position('1111111111' in public.get_operations_report('waybills',
  '{"date_from":"2000-01-01","date_to":"2000-01-01"}',1,25)::text)=0
  and position('actual@example.invalid' in public.get_operations_report('waybills',
  '{"date_from":"2000-01-01","date_to":"2000-01-01"}',1,25)::text)=0
  and position('EXCEPTION-FREE-TEXT-SECRET' in public.get_operations_report('exceptions',
  jsonb_build_object('date_from',(statement_timestamp() at time zone 'Africa/Lagos')::date,
    'date_to',(statement_timestamp() at time zone 'Africa/Lagos')::date),1,25)::text)=0,
  'safe report projections exclude banking, recipients, and exception free text');

create temp table report_export as select public.export_operations_report('waybills',
  '{"date_from":"2000-01-01","date_to":"2000-01-01"}','xlsx') value;
select pg_temp.report_assert((select (value->>'row_count')::integer=1 and value->>'format'='xlsx'
  and jsonb_array_length(value->'items')=1
  and value->'items'->0->>'driver_pdf_status'='pending'
  and value->'items'->0->>'company_pdf_status'='blocked_bank_details_unverified'
  and value->'items'->0->>'driver_delivery_status'='not_queued'
  and value->'items'->0->>'company_delivery_status'='not_queued'
  and position('Sensitive Account' in value::text)=0
  and position('Sensitive Bank' in value::text)=0
  and position('1111111111' in value::text)=0
  and not (value->'items'->0 ? 'pdf_status')
  and not (value->'items'->0 ? 'payout_status') from report_export,
  'XLSX export uses the secure-copy and audience-specific report projection');
select pg_temp.report_assert((select count(*)=1 from public.audit_log where entity_name='operations_report_export'
  and entity_id=(select (value->>'export_id')::uuid from report_export)
  and actor_id='f7310000-0000-0000-0000-000000000001' and new_value->>'row_count'='1'
  and new_value->>'format'='xlsx' and new_value->'filters' ? 'date_from'
  and position('Sensitive Account' in new_value::text)=0),'export audit records safe actor, filters, format, and row count only');
select pg_temp.report_assert(not exists(select 1 from public.audit_log where entity_name='operations_report_export'
  and new_value ? 'items'),'export audit does not store report rows');

reset role;
insert into public.trucks(id,registration_number,driver_id)
select md5('bulk-truck-'||n)::uuid,'BULK-'||lpad(n::text,5,'0'),'f7330000-0000-0000-0000-000000000002'
from generate_series(1,1001) n;
alter table public.daily_registrations disable trigger user;
insert into public.daily_registrations(id,truck_id,initial_driver_id,operational_date,registered_at,registered_by)
select md5('bulk-registration-'||n)::uuid,md5('bulk-truck-'||n)::uuid,'f7330000-0000-0000-0000-000000000002',
  date '2000-01-01',timestamp with time zone '2000-01-01 00:10 Africa/Lagos','f7310000-0000-0000-0000-000000000001'
from generate_series(1,1001) n;
alter table public.daily_registrations enable trigger user;
alter table public.trips disable trigger user;
insert into public.trips(id,trip_number,truck_id,driver_id,daily_registration_id,loading_site_id,status,opened_at,opened_by,
  truck_registration_at_loading,driver_name_at_loading)
select md5('bulk-trip-'||n)::uuid,'BULK-TRIP-'||n,md5('bulk-truck-'||n)::uuid,
  'f7330000-0000-0000-0000-000000000002',md5('bulk-registration-'||n)::uuid,
  'f7320000-0000-0000-0000-000000000001','open',timestamp with time zone '2000-01-01 00:10 Africa/Lagos',
  'f7310000-0000-0000-0000-000000000001','BULK-'||n,'Actual Trip Driver'
from generate_series(1,1001) n;
alter table public.trips enable trigger user;
set local role authenticated;
select pg_temp.report_error($q$select public.export_operations_report('performance',
  '{"dimension":"truck","date_from":"2000-01-01","date_to":"2000-01-01"}','csv')$q$,'P0001');
select pg_temp.report_assert((select count(*)=1 from public.audit_log where entity_name='operations_report_export'
  and new_value->>'format'='xlsx'),'oversized export is rejected without a release audit');
reset role;

set local role authenticated;
do $$ declare actor text;
begin
  foreach actor in array array['f7310000-0000-0000-0000-000000000002',
    'f7310000-0000-0000-0000-000000000003','f7310000-0000-0000-0000-000000000004'] loop
    perform set_config('request.jwt.claim.sub',actor,true);
    perform pg_temp.report_error('select public.get_operations_report(''trips'',''{}'',1,25)','42501');
    perform pg_temp.report_error('select public.export_operations_report(''trips'',''{}'',''csv'')','42501');
  end loop;
end $$;
reset role;
rollback;
