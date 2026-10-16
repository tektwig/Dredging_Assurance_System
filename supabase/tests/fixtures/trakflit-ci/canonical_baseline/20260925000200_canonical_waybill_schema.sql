begin;

-- Operational master-data fields used by loading, offloading and Waybills.
alter table public.drivers
  add column license_number text;

alter table public.trucks
  add column capacity numeric(10,2),
  add column capacity_unit text not null default 'tonnes',
  add column truck_type text,
  add column owner_name text,
  add column owner_contact text;

alter table public.trips
  add column truck_registration_at_loading text,
  add column truck_type_at_loading text,
  add column truck_capacity_at_loading numeric(10,2),
  add column truck_owner_at_loading text,
  add column driver_phone_at_loading text,
  add column driver_license_at_loading text,
  add column estimated_quantity_tonnes numeric(10,2),
  add constraint trips_estimated_quantity_tonnes_valid check (
    estimated_quantity_tonnes is null or (
      estimated_quantity_tonnes::text not in ('NaN','Infinity','-Infinity')
      and estimated_quantity_tonnes > 0 and estimated_quantity_tonnes < 100000000
    )
  );

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
  driver_email text,
  loading_site_id uuid not null references public.sites(id) on delete restrict,
  loading_site_name text not null,
  offloading_site_id uuid not null references public.sites(id) on delete restrict,
  offloading_site_name text not null,
  loading_officer_id uuid not null references public.profiles(id) on delete restrict,
  loading_officer_name text not null,
  offloading_officer_id uuid not null references public.profiles(id) on delete restrict,
  offloading_officer_name text not null,
  quantity_tonnes numeric(10,2) not null check (quantity_tonnes > 0),
  opened_at timestamptz not null,
  closed_at timestamptz not null,
  issued_at timestamptz not null
);

create or replace function private.snapshot_trip_participants() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_truck public.trucks%rowtype;
  v_driver public.drivers%rowtype;
begin
  select * into strict v_truck from public.trucks where id=new.truck_id for share;
  select * into strict v_driver from public.drivers where id=new.driver_id for share;
  new.truck_registration_at_loading:=v_truck.registration_number;
  new.truck_type_at_loading:=v_truck.truck_type;
  new.truck_capacity_at_loading:=v_truck.capacity;
  new.truck_owner_at_loading:=v_truck.owner_name;
  new.driver_name_at_loading:=coalesce(nullif(btrim(new.driver_name_at_loading),''),v_driver.full_name);
  new.driver_phone_at_loading:=v_driver.phone_number;
  new.driver_license_at_loading:=v_driver.license_number;
  return new;
end;
$$;
create trigger snapshot_trip_participants
before insert on public.trips
for each row execute function private.snapshot_trip_participants();

create or replace function private.create_trip_closure_invoice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_loading_name text;
  v_offloading_name text;
  v_loading_officer_name text;
  v_offloading_officer_name text;
  v_driver_email text;
  v_number text;
begin
  if new.status <> 'closed' then return null; end if;
  select name into strict v_loading_name from public.sites where id=new.loading_site_id;
  select name into strict v_offloading_name from public.sites where id=new.offloading_site_id;
  select coalesce(nullif(btrim(display_name),''),'Loading Officer ('||new.opened_by::text||')')
    into strict v_loading_officer_name from public.profiles where id=new.opened_by;
  select coalesce(nullif(btrim(display_name),''),'Offloading Officer ('||new.closed_by::text||')')
    into strict v_offloading_officer_name from public.profiles where id=new.closed_by;
  select email into strict v_driver_email from public.drivers where id=new.driver_id for share;
  v_number:='WB-'||to_char(new.closed_at at time zone 'Africa/Lagos','YYYY')||'-'||
    lpad(nextval('private.trip_closure_invoice_seq')::text,6,'0');
  insert into public.trip_closure_invoices(
    invoice_number,trip_id,trip_number,truck_id,truck_registration,truck_type,
    truck_capacity_tonnes,truck_owner_name,driver_id,driver_name,driver_phone,
    driver_license,driver_email,loading_site_id,loading_site_name,offloading_site_id,
    offloading_site_name,loading_officer_id,loading_officer_name,
    offloading_officer_id,offloading_officer_name,quantity_tonnes,opened_at,closed_at,issued_at
  ) values (
    v_number,new.id,new.trip_number,new.truck_id,new.truck_registration_at_loading,
    new.truck_type_at_loading,new.truck_capacity_at_loading,new.truck_owner_at_loading,
    new.driver_id,new.driver_name_at_loading,new.driver_phone_at_loading,
    new.driver_license_at_loading,v_driver_email,new.loading_site_id,v_loading_name,
    new.offloading_site_id,v_offloading_name,new.opened_by,v_loading_officer_name,
    new.closed_by,v_offloading_officer_name,new.quantity_tonnes,new.opened_at,new.closed_at,new.closed_at
  ) on conflict (trip_id) do nothing;
  return null;
end;
$$;
create trigger create_trip_closure_invoice
after update on public.trips
for each row when (old.status='open' and new.status='closed')
execute function private.create_trip_closure_invoice();

create function private.prevent_trip_invoice_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Waybill snapshots are immutable' using errcode='23514';
end;
$$;
create trigger prevent_trip_invoice_mutation
before update or delete on public.trip_closure_invoices
for each row execute function private.prevent_trip_invoice_mutation();

alter table public.trip_closure_invoices enable row level security;
revoke all on public.trip_closure_invoices from public,anon,authenticated,service_role;
grant select on public.trip_closure_invoices to authenticated;
create policy trip_closure_invoice_read on public.trip_closure_invoices
for select to authenticated using (
  private.has_role(array['system_administrator','loading_officer','offloading_officer',
    'operations_manager','audit_reviewer']::public.app_role[])
);
revoke all on sequence private.trip_closure_invoice_seq from public,anon,authenticated,service_role;
revoke all on function private.snapshot_trip_participants(),
  private.create_trip_closure_invoice(),private.prevent_trip_invoice_mutation()
  from public,anon,authenticated,service_role;

commit;
