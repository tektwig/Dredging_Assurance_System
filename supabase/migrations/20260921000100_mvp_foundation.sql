-- Online MVP. No remote resources, credentials, or production seed data.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create type public.app_role as enum ('system_administrator', 'loading_officer', 'offloading_officer', 'operations_manager', 'finance_officer', 'audit_reviewer');
create type public.site_type as enum ('loading', 'offloading');
create type public.trip_status as enum ('open', 'closed', 'cancelled');
create type public.exception_type as enum ('unknown_truck', 'invalid_driver', 'open_trip_conflict', 'offloading_mismatch', 'invalid_state', 'dispute');
create type public.exception_status as enum ('open', 'resolved');
create type public.payment_status as enum ('payment_details_required', 'pending', 'paid');

create function public.normalize_plate(p_plate text) returns text
language sql immutable strict set search_path = '' as $$
  select pg_catalog.regexp_replace(pg_catalog.upper(p_plate collate "C"), '[[:space:]-]+', '', 'g');
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null default '',
  role public.app_role,
  is_active boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (not is_active or role is not null)
);
create table public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  site_type public.site_type not null,
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create unique index one_active_loading_site on public.sites (site_type) where site_type = 'loading' and is_active;

create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(btrim(full_name)) between 1 and 200),
  phone_number text not null check (length(btrim(phone_number)) between 1 and 40),
  email text check (email is null or (length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
-- Banking is deliberately absent from operational driver rows.
create table public.driver_payment_details (
  driver_id uuid primary key references public.drivers(id) on delete restrict,
  account_name text not null check (length(btrim(account_name)) between 1 and 200),
  account_number text not null check (account_number ~ '^[0-9]{10}$'),
  bank_name text not null check (length(btrim(bank_name)) between 1 and 200),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create table public.trucks (
  id uuid primary key default gen_random_uuid(),
  registration_number text not null check (length(registration_number) between 1 and 32),
  normalized_registration text generated always as (public.normalize_plate(registration_number)) stored,
  driver_id uuid not null references public.drivers(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (normalized_registration),
  check (normalized_registration ~ '^[A-Z0-9]+$')
);
create index trucks_driver_idx on public.trucks(driver_id);

create table public.daily_registrations (
  id uuid primary key default gen_random_uuid(),
  truck_id uuid not null references public.trucks(id) on delete restrict,
  driver_id uuid not null references public.drivers(id) on delete restrict,
  operational_date date not null,
  registered_at timestamptz not null default clock_timestamp(),
  registered_by uuid not null references public.profiles(id) on delete restrict,
  unique (truck_id, operational_date),
  unique (id, truck_id, driver_id),
  check (operational_date = (registered_at at time zone 'Africa/Lagos')::date)
);
create index daily_registration_driver_date_idx on public.daily_registrations(driver_id, operational_date);
create index daily_registration_actor_idx on public.daily_registrations(registered_by);

create sequence private.trip_number_seq as bigint;
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  trip_number text not null unique,
  truck_id uuid not null references public.trucks(id) on delete restrict,
  driver_id uuid not null references public.drivers(id) on delete restrict,
  daily_registration_id uuid not null,
  loading_site_id uuid not null references public.sites(id) on delete restrict,
  offloading_site_id uuid references public.sites(id) on delete restrict,
  status public.trip_status not null default 'open',
  quantity_tonnes numeric(10,2),
  opened_at timestamptz not null default clock_timestamp(),
  opened_by uuid not null references public.profiles(id) on delete restrict,
  closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete restrict,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete restrict,
  cancellation_reason text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (daily_registration_id, truck_id, driver_id) references public.daily_registrations(id, truck_id, driver_id) on delete restrict,
  unique (id, truck_id, driver_id),
  check (quantity_tonnes is null or (quantity_tonnes > 0 and quantity_tonnes <> 'NaN'::numeric)),
  check (closed_at is null or closed_at >= opened_at),
  check (cancelled_at is null or cancelled_at >= opened_at),
  check ((status = 'closed' and quantity_tonnes is not null and offloading_site_id is not null and closed_at is not null and closed_by is not null)
    or (status <> 'closed' and quantity_tonnes is null and offloading_site_id is null and closed_at is null and closed_by is null)),
  check ((status = 'cancelled' and cancelled_at is not null and cancelled_by is not null and cancellation_reason is not null and length(btrim(cancellation_reason)) > 0)
    or (status <> 'cancelled' and cancelled_at is null and cancelled_by is null and cancellation_reason is null))
);
create unique index one_open_trip_per_truck on public.trips(truck_id) where status = 'open';
create index trips_driver_opened_idx on public.trips(driver_id, opened_at);
create index trips_truck_opened_idx on public.trips(truck_id, opened_at);
create index trips_status_opened_idx on public.trips(status, opened_at);
create index trips_closed_idx on public.trips(closed_at) where status = 'closed';
create index trips_registration_idx on public.trips(daily_registration_id);
create index trips_loading_site_idx on public.trips(loading_site_id);
create index trips_offloading_site_idx on public.trips(offloading_site_id);
create index trips_opened_by_idx on public.trips(opened_by);
create index trips_closed_by_idx on public.trips(closed_by);
create index trips_cancelled_by_idx on public.trips(cancelled_by);

create table public.exceptions (
  id uuid primary key default gen_random_uuid(),
  truck_id uuid references public.trucks(id) on delete restrict,
  trip_id uuid references public.trips(id) on delete restrict,
  entered_plate text check (length(entered_plate) <= 64),
  exception_type public.exception_type not null,
  description text not null check (length(btrim(description)) between 1 and 2000),
  blocks_operations boolean not null default false,
  status public.exception_status not null default 'open',
  reported_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete restrict,
  resolution_reason text,
  check (trip_id is null or truck_id is not null),
  check (not blocks_operations or truck_id is not null),
  check ((status = 'open' and resolved_at is null and resolved_by is null and resolution_reason is null)
    or (status = 'resolved' and resolved_at is not null and resolved_by is not null and resolution_reason is not null and length(btrim(resolution_reason)) > 0))
);
create index blocking_exceptions_truck_idx on public.exceptions(truck_id) where status = 'open' and blocks_operations;
create index exceptions_trip_idx on public.exceptions(trip_id);
create index exceptions_truck_idx on public.exceptions(truck_id);
create index exceptions_reported_by_idx on public.exceptions(reported_by);
create index exceptions_resolved_by_idx on public.exceptions(resolved_by);

create table public.trip_payments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null unique,
  truck_id uuid not null,
  driver_id uuid not null,
  driver_name text not null,
  driver_phone text not null,
  driver_email text,
  -- Immutable closure-time bank snapshot; NULL means unknown at closure.
  account_name text check (account_name is null or length(btrim(account_name)) between 1 and 200),
  account_number text check (account_number is null or account_number ~ '^[0-9]{10}$'),
  bank_name text check (bank_name is null or length(btrim(bank_name)) between 1 and 200),
  -- Filled once by finance/admin only when the closure snapshot was missing.
  supplied_account_name text check (supplied_account_name is null or length(btrim(supplied_account_name)) between 1 and 200),
  supplied_account_number text check (supplied_account_number is null or supplied_account_number ~ '^[0-9]{10}$'),
  supplied_bank_name text check (supplied_bank_name is null or length(btrim(supplied_bank_name)) between 1 and 200),
  payment_ready_at timestamptz,
  payment_ready_by uuid references public.profiles(id) on delete restrict,
  status public.payment_status not null default 'pending',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  paid_at timestamptz,
  paid_by uuid references public.profiles(id) on delete restrict,
  payment_reference text,
  foreign key (trip_id, truck_id, driver_id) references public.trips(id, truck_id, driver_id) on delete restrict,
  check ((account_name is null and account_number is null and bank_name is null)
    or (account_name is not null and account_number is not null and bank_name is not null)),
  check ((supplied_account_name is null and supplied_account_number is null and supplied_bank_name is null)
    or (supplied_account_name is not null and supplied_account_number is not null and supplied_bank_name is not null)),
  check (account_number is null or supplied_account_number is null),
  check ((status = 'payment_details_required' and account_number is null and supplied_account_number is null and payment_ready_at is null and payment_ready_by is null)
    or (status in ('pending','paid') and coalesce(account_number, supplied_account_number) is not null and payment_ready_at is not null and payment_ready_by is not null)),
  check ((status <> 'paid' and paid_at is null and paid_by is null and payment_reference is null)
    or (status = 'paid' and paid_at is not null and paid_by is not null and payment_reference is not null and length(btrim(payment_reference)) > 0))
);
create index trip_payments_pending_idx on public.trip_payments(created_at) where status = 'pending';
create index trip_payments_details_required_idx on public.trip_payments(created_at) where status = 'payment_details_required';
create index trip_payments_driver_idx on public.trip_payments(driver_id);
create index trip_payments_truck_idx on public.trip_payments(truck_id);
create index trip_payments_paid_by_idx on public.trip_payments(paid_by);
create index trip_payments_ready_by_idx on public.trip_payments(payment_ready_by);

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null default 'trip_closed' check (event_type = 'trip_closed'),
  trip_id uuid not null references public.trip_payments(trip_id) on delete restrict,
  audience text not null check (audience in ('driver', 'finance')),
  recipients text[],
  payload jsonb not null,
  -- The exact provider request is frozen on first claim for safe retries.
  email_request jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  provider_message_id text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  first_attempt_at timestamptz,
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_until timestamptz,
  lease_token uuid,
  sent_at timestamptz,
  unique (trip_id, audience),
  check ((status = 'sent') = (sent_at is not null))
);
create index outbox_pending_idx on public.notification_outbox(next_attempt_at) where status in ('pending', 'processing');

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  entity_name text not null,
  entity_id uuid not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_value jsonb,
  new_value jsonb,
  reason text,
  actor_id uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);
create index audit_entity_idx on public.audit_log(entity_name, entity_id, created_at);
create index audit_actor_idx on public.audit_log(actor_id, created_at);

create function private.has_role(p_roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active and role = any(p_roles));
$$;
create function private.require_role(p_roles public.app_role[]) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_role(p_roles) then raise exception 'Not authorized' using errcode = '42501'; end if;
end;
$$;
create function private.set_timestamps() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.created_at := clock_timestamp(); else new.created_at := old.created_at; end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create function private.capture_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_old jsonb; v_new jsonb;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  insert into public.audit_log(entity_name, entity_id, action, old_value, new_value, reason, actor_id)
  values (tg_table_name, coalesce((v_new->>'id')::uuid, (v_old->>'id')::uuid, (v_new->>'driver_id')::uuid, (v_old->>'driver_id')::uuid),
    tg_op, v_old, v_new, nullif(current_setting('app.audit_reason', true), ''), auth.uid());
  return null;
end;
$$;
create function private.reject_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'Historical records cannot be changed or deleted' using errcode = '23514'; end;
$$;
create trigger audit_immutable before update or delete on public.audit_log for each row execute function private.reject_mutation();
create trigger registration_immutable before update or delete on public.daily_registrations for each row execute function private.reject_mutation();

create function private.new_auth_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Never copy role or active status from user-controlled Auth metadata.
  insert into public.profiles(id) values (new.id);
  return new;
end;
$$;
create trigger create_auth_profile after insert on auth.users for each row execute function private.new_auth_profile();
insert into public.profiles(id) select id from auth.users on conflict do nothing;

create function private.registration_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.registered_at := statement_timestamp();
  new.operational_date := (new.registered_at at time zone 'Africa/Lagos')::date;
  new.registered_by := auth.uid();
  return new;
end;
$$;
create trigger registration_guard before insert on public.daily_registrations for each row execute function private.registration_guard();

create function private.trip_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_seq text;
begin
  if tg_op = 'DELETE' then raise exception 'Trips cannot be deleted' using errcode = '23514'; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'open' then raise exception 'Trips must start open' using errcode = '23514'; end if;
    v_seq := nextval('private.trip_number_seq'::regclass)::text;
    new.trip_number := 'TRP-' || lpad(v_seq, greatest(10, length(v_seq)), '0');
    new.opened_at := statement_timestamp(); new.opened_by := auth.uid();
    if not exists (select 1 from public.sites where id = new.loading_site_id and is_active and site_type = 'loading') then
      raise exception 'Active loading site required' using errcode = '23514';
    end if;
  else
    if old.status <> 'open' or new.status not in ('closed', 'cancelled') then
      raise exception 'Invalid trip transition' using errcode = '23514';
    end if;
    if (to_jsonb(new) - array['status','quantity_tonnes','offloading_site_id','closed_at','closed_by','cancelled_at','cancelled_by','cancellation_reason','updated_at'])
       is distinct from (to_jsonb(old) - array['status','quantity_tonnes','offloading_site_id','closed_at','closed_by','cancelled_at','cancelled_by','cancellation_reason','updated_at']) then
      raise exception 'Trip identity is immutable' using errcode = '23514';
    end if;
    if new.status = 'closed' then
      new.closed_at := clock_timestamp(); new.closed_by := auth.uid();
      if not exists (select 1 from public.sites where id = new.offloading_site_id and is_active and site_type = 'offloading') then
        raise exception 'Active offloading site required' using errcode = '23514';
      end if;
    else new.cancelled_at := clock_timestamp(); new.cancelled_by := auth.uid(); end if;
  end if;
  return new;
end;
$$;
create trigger trip_guard before insert or update or delete on public.trips for each row execute function private.trip_guard();

create function private.exception_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Exceptions cannot be deleted' using errcode = '23514'; end if;
  if new.truck_id is not null then perform 1 from public.trucks where id = new.truck_id for update; end if;
  if new.trip_id is not null and not exists (select 1 from public.trips where id = new.trip_id and truck_id = new.truck_id) then
    raise exception 'Exception truck/trip mismatch' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    new.reported_by := auth.uid();
    if new.status <> 'open' then raise exception 'Exceptions must start open' using errcode = '23514'; end if;
  else
    if old.status <> 'open' or new.status <> 'resolved' or
      (to_jsonb(new) - array['status','resolved_at','resolved_by','resolution_reason','updated_at']) is distinct from
      (to_jsonb(old) - array['status','resolved_at','resolved_by','resolution_reason','updated_at']) then
      raise exception 'Only explicit exception resolution is permitted' using errcode = '23514';
    end if;
    new.resolved_at := clock_timestamp(); new.resolved_by := auth.uid();
  end if;
  return new;
end;
$$;
create trigger exception_guard before insert or update or delete on public.exceptions for each row execute function private.exception_guard();

-- All material records are audited. Payment audit rows are restricted below.
do $$
declare t text;
begin
  foreach t in array array['profiles','sites','drivers','driver_payment_details','trucks','daily_registrations','trips','exceptions','trip_payments'] loop
    execute format('create trigger audit_changes after insert or update or delete on public.%I for each row execute function private.capture_audit()', t);
    if t <> 'daily_registrations' then
      execute format('create trigger z_set_timestamps before insert or update on public.%I for each row execute function private.set_timestamps()', t);
    end if;
  end loop;
end;
$$;
create trigger z_set_timestamps before insert or update on public.notification_outbox for each row execute function private.set_timestamps();

-- Explicit grants replace Supabase's permissive defaults for these objects.
do $$
declare t text;
begin
  foreach t in array array['profiles','sites','drivers','driver_payment_details','trucks','daily_registrations','trips','exceptions','trip_payments','notification_outbox','audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  foreach t in array array['sites','drivers','trucks','daily_registrations','trips','exceptions'] loop
    execute format('create policy operational_read on public.%I for select to authenticated using (private.has_role(array[''system_administrator'',''loading_officer'',''offloading_officer'',''operations_manager'',''finance_officer'',''audit_reviewer'']::public.app_role[]))', t);
  end loop;
  foreach t in array array['sites','drivers','trucks'] loop
    execute format('grant insert, update on public.%I to authenticated', t);
    execute format('create policy admin_insert on public.%I for insert to authenticated with check (private.has_role(array[''system_administrator'']::public.app_role[]))', t);
    execute format('create policy admin_update on public.%I for update to authenticated using (private.has_role(array[''system_administrator'']::public.app_role[])) with check (private.has_role(array[''system_administrator'']::public.app_role[]))', t);
  end loop;
  foreach t in array array['driver_payment_details','trip_payments','notification_outbox'] loop
    execute format('create policy finance_read on public.%I for select to authenticated using (private.has_role(array[''system_administrator'',''finance_officer'']::public.app_role[]))', t);
  end loop;
end;
$$;
grant update (display_name, role, is_active) on public.profiles to authenticated;
create policy profile_read on public.profiles for select to authenticated using (id = (select auth.uid()) or private.has_role(array['system_administrator']::public.app_role[]));
create policy profile_admin_update on public.profiles for update to authenticated using (private.has_role(array['system_administrator']::public.app_role[])) with check (private.has_role(array['system_administrator']::public.app_role[]));
grant insert, update on public.driver_payment_details to authenticated;
create policy bank_insert on public.driver_payment_details for insert to authenticated with check (private.has_role(array['system_administrator','finance_officer']::public.app_role[]));
create policy bank_update on public.driver_payment_details for update to authenticated using (private.has_role(array['system_administrator','finance_officer']::public.app_role[])) with check (private.has_role(array['system_administrator','finance_officer']::public.app_role[]));
create policy audit_read on public.audit_log for select to authenticated using (
  private.has_role(array['system_administrator']::public.app_role[])
  or (entity_name in ('driver_payment_details','trip_payments') and private.has_role(array['finance_officer']::public.app_role[]))
  or (entity_name not in ('driver_payment_details','trip_payments') and private.has_role(array['operations_manager','audit_reviewer']::public.app_role[]))
);
revoke all on all functions in schema private from public, anon, authenticated, service_role;
grant execute on function private.has_role(public.app_role[]) to authenticated;
revoke all on function public.normalize_plate(text) from public, anon, authenticated, service_role;
grant execute on function public.normalize_plate(text) to authenticated;
revoke all on sequence private.trip_number_seq from public, anon, authenticated, service_role;

commit;
