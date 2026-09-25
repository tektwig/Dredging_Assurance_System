begin;

-- Remove only the known client/seed demo fleet. Real operational records are
-- intentionally left untouched. Temporary ID sets let dependent immutable
-- ledger rows be removed precisely and in referential order.
create temporary table demo_truck_ids on commit drop as
select id, driver_id
from public.trucks
where normalized_registration = any(array[
  'KJA482XY', 'APP914AA', 'EPE303ZZ', 'BDG708BB', 'LND551CF',
  'APP482XA', 'KJA918YD', 'LSR234BC', 'EKY701LG', 'BDG551ZZ'
]);

create temporary table demo_trip_ids on commit drop as
select id, daily_registration_id
from public.trips
where truck_id in (select id from demo_truck_ids);

-- These tables are protected from normal historical deletion. This controlled
-- migration disables user triggers only for the exact demo rows and restores
-- them before committing.
alter table public.notification_outbox disable trigger user;
alter table public.trip_payments disable trigger user;
alter table public.exceptions disable trigger user;
alter table public.trip_loading_evidence disable trigger user;
alter table public.trips disable trigger user;
alter table public.daily_registrations disable trigger user;
alter table public.trucks disable trigger user;
alter table public.driver_payment_details disable trigger user;
alter table public.drivers disable trigger user;
alter table public.audit_log disable trigger user;

delete from public.notification_outbox
where trip_id in (select id from demo_trip_ids);

delete from public.trip_payments
where trip_id in (select id from demo_trip_ids);

delete from public.exceptions
where trip_id in (select id from demo_trip_ids)
   or truck_id in (select id from demo_truck_ids)
   or public.normalize_plate(coalesce(entered_plate, '')) = any(array[
     'KJA482XY', 'APP914AA', 'EPE303ZZ', 'BDG708BB', 'LND551CF',
     'APP482XA', 'KJA918YD', 'LSR234BC', 'EKY701LG', 'BDG551ZZ'
   ]);

delete from public.trip_loading_evidence
where trip_id in (select id from demo_trip_ids);

delete from public.trips
where id in (select id from demo_trip_ids);

delete from public.daily_registrations
where truck_id in (select id from demo_truck_ids);

delete from public.trucks
where id in (select id from demo_truck_ids);

delete from public.driver_payment_details as payment
where payment.driver_id in (select driver_id from demo_truck_ids)
  and not exists (select 1 from public.trucks where driver_id = payment.driver_id)
  and not exists (select 1 from public.trips where driver_id = payment.driver_id)
  and not exists (select 1 from public.daily_registrations where initial_driver_id = payment.driver_id);

delete from public.drivers as driver
where driver.id in (select driver_id from demo_truck_ids)
  and not exists (select 1 from public.trucks where driver_id = driver.id)
  and not exists (select 1 from public.trips where driver_id = driver.id)
  and not exists (select 1 from public.daily_registrations where initial_driver_id = driver.id);

delete from public.audit_log
where entity_id in (
  select id from demo_truck_ids
  union
  select driver_id from demo_truck_ids
  union
  select id from demo_trip_ids
  union
  select daily_registration_id from demo_trip_ids
);

alter table public.notification_outbox enable trigger user;
alter table public.trip_payments enable trigger user;
alter table public.exceptions enable trigger user;
alter table public.trip_loading_evidence enable trigger user;
alter table public.trips enable trigger user;
alter table public.daily_registrations enable trigger user;
alter table public.trucks enable trigger user;
alter table public.driver_payment_details enable trigger user;
alter table public.drivers enable trigger user;
alter table public.audit_log enable trigger user;

-- Self-registration records a requested role for administrator review. It
-- never grants that role and every new profile remains inactive by default.
alter table public.profiles
  add column if not exists email text,
  add column if not exists requested_role public.app_role;

update public.profiles as profile
set email = lower(auth_user.email)
from auth.users as auth_user
where profile.id = auth_user.id
  and profile.email is null;

create or replace function private.new_auth_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_display_name text;
  v_requested_role public.app_role;
begin
  v_display_name := left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 200);
  v_requested_role := case new.raw_user_meta_data ->> 'requested_role'
    when 'loading_officer' then 'loading_officer'::public.app_role
    when 'offloading_officer' then 'offloading_officer'::public.app_role
    when 'operations_manager' then 'operations_manager'::public.app_role
    when 'finance_officer' then 'finance_officer'::public.app_role
    else null
  end;

  insert into public.profiles(id, email, display_name, requested_role, role, is_active)
  values(new.id, lower(new.email), v_display_name, v_requested_role, null, false)
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on column public.profiles.requested_role is
  'Untrusted self-service role request. An administrator must assign role and activate the profile.';

create or replace function public.approve_signup(
  p_profile_id uuid,
  p_role public.app_role,
  p_site_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles%rowtype;
  v_site_type public.site_type;
begin
  perform private.require_role(array['system_administrator']::public.app_role[]);

  if p_role not in (
    'loading_officer'::public.app_role,
    'offloading_officer'::public.app_role,
    'operations_manager'::public.app_role,
    'finance_officer'::public.app_role
  ) then
    raise exception 'Unsupported self-service role approval' using errcode = '22023';
  end if;

  select * into v_profile
  from public.profiles
  where id = p_profile_id
  for update;

  if not found or v_profile.requested_role is null or v_profile.is_active then
    raise exception 'Pending signup not found' using errcode = '22023';
  end if;

  if p_role in ('loading_officer'::public.app_role, 'offloading_officer'::public.app_role) then
    if p_site_id is null then
      raise exception 'A site is required for field access' using errcode = '22023';
    end if;
    select site_type into v_site_type
    from public.sites
    where id = p_site_id and is_active;
    if not found
      or (p_role = 'loading_officer'::public.app_role and v_site_type <> 'loading'::public.site_type)
      or (p_role = 'offloading_officer'::public.app_role and v_site_type <> 'offloading'::public.site_type) then
      raise exception 'The selected site does not match the approved role' using errcode = '22023';
    end if;
  end if;

  update public.profiles
  set role = p_role,
      is_active = true,
      requested_role = null
  where id = p_profile_id;

  if p_role in ('loading_officer'::public.app_role, 'offloading_officer'::public.app_role) then
    update public.user_site_assignments
    set ended_at = clock_timestamp(), ended_by = auth.uid()
    where profile_id = p_profile_id and ended_at is null;

    insert into public.user_site_assignments(profile_id, site_id, assigned_by)
    values(p_profile_id, p_site_id, auth.uid());
  end if;

  return jsonb_build_object(
    'ok', true,
    'profile_id', p_profile_id,
    'role', p_role,
    'site_id', p_site_id
  );
end;
$$;

revoke all on function public.approve_signup(uuid, public.app_role, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.approve_signup(uuid, public.app_role, uuid)
  to authenticated;

commit;
