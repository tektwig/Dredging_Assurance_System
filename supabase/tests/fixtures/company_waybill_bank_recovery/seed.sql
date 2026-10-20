begin;

create function pg_temp.assert_true(p_value boolean,p_message text) returns void language plpgsql as $$
begin
  if p_value is distinct from true then raise exception 'Recovery fixture assertion failed: %',p_message; end if;
  raise notice 'ASSERTION PASS: %',p_message;
end;
$$;

insert into auth.users(id,email,raw_user_meta_data) values
  ('e0000000-0000-4000-8000-000000000001','recovery-admin@example.invalid','{}'),
  ('e0000000-0000-4000-8000-000000000002','recovery-loading@example.invalid','{}'),
  ('e0000000-0000-4000-8000-000000000003','recovery-operations@example.invalid','{}'),
  ('e0000000-0000-4000-8000-000000000004','recovery-finance@example.invalid','{}');

update public.profiles
set role=case right(id::text,1)
    when '1' then 'system_administrator'::public.app_role
    when '2' then 'loading_officer'::public.app_role
    when '3' then 'operations_manager'::public.app_role
    else 'finance_officer'::public.app_role end,
  display_name='Synthetic recovery actor',is_active=true
where id::text like 'e0000000-%';

insert into public.sites(id,name,site_type) values
  ('e1000000-0000-4000-8000-000000000001','Synthetic Recovery Loading Site','loading'),
  ('e1000000-0000-4000-8000-000000000002','Synthetic Recovery Offloading Site','offloading');

select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.assert_true((public.assign_user_site(
  'e0000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000001'
)->>'ok')::boolean,'synthetic administrator assigns the Loading Officer to the test site');
reset role;

insert into public.drivers(id,full_name,phone_number)
select ('e3000000-0000-4000-8000-'||lpad(value::text,12,'0'))::uuid,
  'Synthetic recovery driver '||value,'08090000'||value::text
from generate_series(40,43) value;

insert into public.trucks(id,registration_number,driver_id,capacity,capacity_unit,truck_type,owner_name)
select ('e4000000-0000-4000-8000-'||lpad(value::text,12,'0'))::uuid,
  'BANKREC'||value,
  ('e3000000-0000-4000-8000-'||lpad(value::text,12,'0'))::uuid,
  30,'tonnes','Registered tipper truck','Synthetic recovery owner'
from generate_series(40,43) value;

insert into private.loading_registration_bank_captures(
  registration_request_id,driver_id,bank_name,account_number,account_name,captured_by
)
select ('e8000000-0000-4000-8000-'||lpad(value::text,12,'0'))::uuid,
  ('e3000000-0000-4000-8000-'||lpad(value::text,12,'0'))::uuid,
  'CI Synthetic Bank','92000000'||lpad(value::text,2,'0'),'Synthetic recovery driver '||value,
  'e0000000-0000-4000-8000-000000000002'
from generate_series(40,42) value;

alter table public.daily_registrations disable trigger user;
insert into public.daily_registrations(id,truck_id,initial_driver_id,operational_date,registered_at,registered_by)
select ('e5000000-0000-4000-8000-'||lpad(value::text,12,'0'))::uuid,
  ('e4000000-0000-4000-8000-'||lpad(value::text,12,'0'))::uuid,
  ('e3000000-0000-4000-8000-'||lpad(value::text,12,'0'))::uuid,
  ((statement_timestamp()-((value-40)||' days')::interval) at time zone 'Africa/Lagos')::date,
  statement_timestamp()-((value-40)||' days')::interval,
  'e0000000-0000-4000-8000-000000000002'
from generate_series(40,43) value;
alter table public.daily_registrations enable trigger user;

alter table public.trips disable trigger user;
insert into public.trips(
  id,trip_number,truck_id,driver_id,daily_registration_id,loading_site_id,offloading_site_id,
  status,quantity_tonnes,opened_at,opened_by,closed_at,closed_by,
  truck_registration_at_loading,truck_type_at_loading,truck_capacity_at_loading,truck_owner_at_loading,
  driver_phone_at_loading,driver_license_at_loading,driver_name_at_loading,loading_assignment_id
)
select ('e6000000-0000-4000-8000-'||lpad(value::text,12,'0'))::uuid,
  'BANKREC-TRIP-'||value,
  ('e4000000-0000-4000-8000-'||lpad(value::text,12,'0'))::uuid,
  ('e3000000-0000-4000-8000-'||lpad(value::text,12,'0'))::uuid,
  ('e5000000-0000-4000-8000-'||lpad(value::text,12,'0'))::uuid,
  'e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002',
  'closed',12,
  statement_timestamp()-interval '2 hours','e0000000-0000-4000-8000-000000000002',
  statement_timestamp()-interval '1 hour','e0000000-0000-4000-8000-000000000001',
  'BANKREC'||value,'Registered tipper truck',30,'Synthetic recovery owner',
  '08090000'||value::text,null,'Synthetic recovery driver '||value,
  assignment.id
from generate_series(40,43) value
cross join lateral (
  select id from public.user_site_assignments
  where profile_id='e0000000-0000-4000-8000-000000000002'
    and site_id='e1000000-0000-4000-8000-000000000001'
    and ended_at is null order by assigned_at desc limit 1
) assignment;
alter table public.trips enable trigger user;

insert into public.trip_closure_invoices(
  id,invoice_number,trip_id,trip_number,truck_id,truck_registration,truck_type,
  truck_capacity_tonnes,truck_owner_name,driver_id,driver_name,driver_phone,driver_license,
  loading_site_id,loading_site_name,offloading_site_id,offloading_site_name,
  quantity_tonnes,opened_at,closed_at,issued_at
)
select ('e7000000-0000-4000-8000-'||lpad(value::text,12,'0'))::uuid,
  'WB-2026-'||lpad(value::text,6,'0'),
  ('e6000000-0000-4000-8000-'||lpad(value::text,12,'0'))::uuid,
  'BANKREC-TRIP-'||value,
  ('e4000000-0000-4000-8000-'||lpad(value::text,12,'0'))::uuid,
  'BANKREC'||value,'Registered tipper truck',30,'Synthetic recovery owner',
  ('e3000000-0000-4000-8000-'||lpad(value::text,12,'0'))::uuid,
  'Synthetic recovery driver '||value,'08090000'||value::text,null,
  'e1000000-0000-4000-8000-000000000001','Synthetic Recovery Loading Site',
  'e1000000-0000-4000-8000-000000000002','Synthetic Recovery Offloading Site',
  12,statement_timestamp()-interval '2 hours',statement_timestamp()-interval '1 hour',
  statement_timestamp()-interval '1 hour'
from generate_series(40,43) value;

select pg_temp.assert_true((
  select count(*)=4 from public.trip_closure_invoices
  where invoice_number between 'WB-2026-000040' and 'WB-2026-000043'
),'four synthetic historical-style Waybills are available before the recovery migration');
select pg_temp.assert_true((
  select count(*)=3 from private.loading_registration_bank_captures capture
  join public.trip_closure_invoices invoice on invoice.driver_id=capture.driver_id
  where invoice.invoice_number between 'WB-2026-000040' and 'WB-2026-000042'
),'the three targeted Waybills have existing associated registration captures');
select pg_temp.assert_true((
  select count(*)=4 from public.trip_closure_invoice_pdf_copies copy
  join public.trip_closure_invoices invoice on invoice.id=copy.invoice_id
  where invoice.invoice_number between 'WB-2026-000040' and 'WB-2026-000043'
    and copy.copy_kind='company' and copy.status='blocked_missing_bank_details'
    and copy.bank_snapshot_id is null
),'all four pre-migration Company copies begin blocked without an invoice snapshot');
select pg_temp.assert_true(not exists (
  select 1 from public.trip_closure_invoice_bank_snapshots snapshot
  join public.trip_closure_invoices invoice on invoice.id=snapshot.invoice_id
  where invoice.invoice_number between 'WB-2026-000040' and 'WB-2026-000043'
),'historical-style fixture starts without invoice-specific snapshots');

commit;
