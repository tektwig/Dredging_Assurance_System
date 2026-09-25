begin;

-- Persist the vehicle information collected by the loading terminal. Older
-- deployments already have most of these columns; IF NOT EXISTS keeps this
-- migration safe across both schema histories.
alter table public.trucks
  add column if not exists capacity numeric(10,2),
  add column if not exists capacity_unit text default 'tonnes',
  add column if not exists truck_type text,
  add column if not exists owner_name text,
  add column if not exists owner_contact text;

alter table public.trips
  add column if not exists truck_registration_at_loading text,
  add column if not exists truck_type_at_loading text,
  add column if not exists truck_capacity_at_loading numeric(10,2),
  add column if not exists truck_owner_at_loading text,
  add column if not exists driver_phone_at_loading text,
  add column if not exists driver_license_at_loading text;

-- New live registrations now store all details that the loading form collects.
create or replace function public.register_loading_participant_v2(
  p_request_id uuid,
  p_plate text,
  p_expected_truck_id uuid default null,
  p_existing_driver_id uuid default null,
  p_full_name text default null,
  p_phone_number text default null,
  p_email text default null,
  p_bank_name text default null,
  p_account_number text default null,
  p_account_name text default null,
  p_capacity_tonnes numeric default null,
  p_truck_type text default null,
  p_owner_name text default null,
  p_owner_contact text default null,
  p_driver_license text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_truck_id uuid;
  v_driver_id uuid;
begin
  perform private.require_role(array['system_administrator','loading_officer']::public.app_role[]);

  if p_capacity_tonnes is null or p_capacity_tonnes <= 0 or p_capacity_tonnes > 200 then
    return jsonb_build_object('ok',false,'code','INVALID_TRUCK_CAPACITY');
  end if;
  if nullif(btrim(p_truck_type),'') is null or length(btrim(p_truck_type)) > 200 then
    return jsonb_build_object('ok',false,'code','INVALID_TRUCK_TYPE');
  end if;
  if nullif(btrim(p_owner_name),'') is null or length(btrim(p_owner_name)) > 255 then
    return jsonb_build_object('ok',false,'code','INVALID_TRUCK_OWNER');
  end if;
  if p_owner_contact is not null and length(btrim(p_owner_contact)) > 100 then
    return jsonb_build_object('ok',false,'code','INVALID_OWNER_CONTACT');
  end if;
  if p_driver_license is not null and length(btrim(p_driver_license)) > 100 then
    return jsonb_build_object('ok',false,'code','INVALID_DRIVER_LICENSE');
  end if;

  v_result := public.register_loading_participant(
    p_request_id,
    p_plate,
    p_expected_truck_id,
    p_existing_driver_id,
    p_full_name,
    p_phone_number,
    p_email,
    p_bank_name,
    p_account_number,
    p_account_name
  );
  if not coalesce((v_result->>'ok')::boolean,false) then return v_result; end if;

  v_truck_id := (v_result->'truck'->>'id')::uuid;
  v_driver_id := (v_result->'driver'->>'id')::uuid;

  update public.trucks
  set capacity = round(p_capacity_tonnes,2),
      capacity_unit = 'tonnes',
      truck_type = btrim(p_truck_type),
      owner_name = btrim(p_owner_name),
      owner_contact = nullif(btrim(p_owner_contact),'')
  where id = v_truck_id;

  update public.drivers
  set license_number = nullif(btrim(p_driver_license),'')
  where id = v_driver_id
    and nullif(btrim(p_driver_license),'') is not null;

  return jsonb_set(
    jsonb_set(
      v_result,
      '{truck}',
      (v_result->'truck') || jsonb_build_object(
        'capacity',round(p_capacity_tonnes,2),
        'capacity_unit','tonnes',
        'truck_type',btrim(p_truck_type),
        'owner_name',btrim(p_owner_name),
        'owner_contact',nullif(btrim(p_owner_contact),'')
      )
    ),
    '{driver}',
    (v_result->'driver') || jsonb_build_object('license_number',nullif(btrim(p_driver_license),''))
  );
end;
$$;

revoke all on function public.register_loading_participant_v2(uuid,text,uuid,uuid,text,text,text,text,text,text,numeric,text,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.register_loading_participant_v2(uuid,text,uuid,uuid,text,text,text,text,text,text,numeric,text,text,text,text)
  to authenticated;

-- Freeze the participant and vehicle identity at dispatch. Later master-data
-- edits cannot rewrite what was actually recorded for a trip.
create or replace function private.snapshot_trip_participants() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_truck public.trucks%rowtype;
  v_driver public.drivers%rowtype;
begin
  select * into strict v_truck from public.trucks where id = new.truck_id for share;
  select * into strict v_driver from public.drivers where id = new.driver_id for share;

  new.truck_registration_at_loading := v_truck.registration_number;
  new.truck_type_at_loading := v_truck.truck_type;
  new.truck_capacity_at_loading := v_truck.capacity;
  new.truck_owner_at_loading := v_truck.owner_name;
  new.driver_name_at_loading := coalesce(nullif(btrim(new.driver_name_at_loading),''),v_driver.full_name);
  new.driver_phone_at_loading := v_driver.phone_number;
  new.driver_license_at_loading := v_driver.license_number;
  return new;
end;
$$;

create trigger snapshot_trip_participants
before insert on public.trips
for each row execute function private.snapshot_trip_participants();

-- Historical trip identities are immutable during normal operation. This
-- one-time snapshot backfill is controlled and transactional, so temporarily
-- disable the user triggers, populate only the new snapshot columns, and
-- restore them before the migration commits.
alter table public.trips disable trigger user;

update public.trips as trip
set truck_registration_at_loading = coalesce(trip.truck_registration_at_loading,truck.registration_number),
    truck_type_at_loading = coalesce(trip.truck_type_at_loading,truck.truck_type),
    truck_capacity_at_loading = coalesce(trip.truck_capacity_at_loading,truck.capacity),
    truck_owner_at_loading = coalesce(trip.truck_owner_at_loading,truck.owner_name),
    driver_name_at_loading = coalesce(trip.driver_name_at_loading,driver.full_name),
    driver_phone_at_loading = coalesce(trip.driver_phone_at_loading,driver.phone_number),
    driver_license_at_loading = coalesce(trip.driver_license_at_loading,driver.license_number)
from public.trucks as truck, public.drivers as driver
where truck.id = trip.truck_id and driver.id = trip.driver_id;

alter table public.trips enable trigger user;

create sequence private.trip_closure_invoice_seq as bigint;

create table public.trip_closure_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  trip_id uuid not null unique references public.trips(id) on delete restrict,
  trip_number text not null,
  truck_id uuid not null references public.trucks(id) on delete restrict,
  truck_registration text not null,
  truck_type text,
  truck_capacity_tonnes numeric(10,2),
  truck_owner_name text,
  driver_id uuid not null references public.drivers(id) on delete restrict,
  driver_name text not null,
  driver_phone text,
  driver_license text,
  loading_site_id uuid not null references public.sites(id) on delete restrict,
  loading_site_name text not null,
  offloading_site_id uuid not null references public.sites(id) on delete restrict,
  offloading_site_name text not null,
  quantity_tonnes numeric(10,2) not null check (quantity_tonnes > 0),
  opened_at timestamptz not null,
  closed_at timestamptz not null,
  issued_at timestamptz not null default clock_timestamp()
);

create or replace function private.create_trip_closure_invoice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_loading_name text;
  v_offloading_name text;
  v_number text;
begin
  if new.status <> 'closed' then return null; end if;

  select name into strict v_loading_name from public.sites where id = new.loading_site_id;
  select name into strict v_offloading_name from public.sites where id = new.offloading_site_id;
  v_number := 'INV-' || to_char(new.closed_at at time zone 'Africa/Lagos','YYYY') || '-' ||
    lpad(nextval('private.trip_closure_invoice_seq')::text,6,'0');

  insert into public.trip_closure_invoices(
    invoice_number,trip_id,trip_number,truck_id,truck_registration,truck_type,
    truck_capacity_tonnes,truck_owner_name,driver_id,driver_name,driver_phone,
    driver_license,loading_site_id,loading_site_name,offloading_site_id,
    offloading_site_name,quantity_tonnes,opened_at,closed_at,issued_at
  ) values (
    v_number,new.id,new.trip_number,new.truck_id,new.truck_registration_at_loading,
    new.truck_type_at_loading,new.truck_capacity_at_loading,new.truck_owner_at_loading,
    new.driver_id,new.driver_name_at_loading,new.driver_phone_at_loading,
    new.driver_license_at_loading,new.loading_site_id,v_loading_name,new.offloading_site_id,
    v_offloading_name,new.quantity_tonnes,new.opened_at,new.closed_at,new.closed_at
  ) on conflict (trip_id) do nothing;
  return null;
end;
$$;

create trigger create_trip_closure_invoice
after update on public.trips
for each row when (old.status = 'open' and new.status = 'closed')
execute function private.create_trip_closure_invoice();

-- Generate invoices for trips that were already closed before this feature.
insert into public.trip_closure_invoices(
  invoice_number,trip_id,trip_number,truck_id,truck_registration,truck_type,
  truck_capacity_tonnes,truck_owner_name,driver_id,driver_name,driver_phone,
  driver_license,loading_site_id,loading_site_name,offloading_site_id,
  offloading_site_name,quantity_tonnes,opened_at,closed_at,issued_at
)
select
  'INV-' || to_char(trip.closed_at at time zone 'Africa/Lagos','YYYY') || '-' ||
    lpad(nextval('private.trip_closure_invoice_seq')::text,6,'0'),
  trip.id,trip.trip_number,trip.truck_id,coalesce(trip.truck_registration_at_loading,truck.registration_number),
  coalesce(trip.truck_type_at_loading,truck.truck_type),coalesce(trip.truck_capacity_at_loading,truck.capacity),coalesce(trip.truck_owner_at_loading,truck.owner_name),
  trip.driver_id,coalesce(trip.driver_name_at_loading,driver.full_name),coalesce(trip.driver_phone_at_loading,driver.phone_number),
  coalesce(trip.driver_license_at_loading,driver.license_number),trip.loading_site_id,loading_site.name,
  trip.offloading_site_id,offloading_site.name,trip.quantity_tonnes,trip.opened_at,
  trip.closed_at,trip.closed_at
from public.trips as trip
join public.trucks as truck on truck.id = trip.truck_id
join public.drivers as driver on driver.id = trip.driver_id
join public.sites as loading_site on loading_site.id = trip.loading_site_id
join public.sites as offloading_site on offloading_site.id = trip.offloading_site_id
where trip.status = 'closed'
  and trip.quantity_tonnes is not null
  and trip.closed_at is not null
on conflict (trip_id) do nothing;

create or replace function private.prevent_trip_invoice_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Trip closure invoices are immutable' using errcode = '23514';
end;
$$;
create trigger prevent_trip_invoice_mutation
before update or delete on public.trip_closure_invoices
for each row execute function private.prevent_trip_invoice_mutation();

alter table public.trip_closure_invoices enable row level security;
revoke all on public.trip_closure_invoices from anon,authenticated,service_role;
grant select on public.trip_closure_invoices to authenticated;
create policy trip_closure_invoice_read on public.trip_closure_invoices
for select to authenticated using (
  private.has_role(array['system_administrator','operations_manager','finance_officer','audit_reviewer']::public.app_role[])
);

revoke all on sequence private.trip_closure_invoice_seq from public,anon,authenticated,service_role;
revoke all on function private.snapshot_trip_participants() from public,anon,authenticated,service_role;
revoke all on function private.create_trip_closure_invoice() from public,anon,authenticated,service_role;
revoke all on function private.prevent_trip_invoice_mutation() from public,anon,authenticated,service_role;

commit;
