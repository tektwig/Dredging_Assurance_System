-- ==============================================================================
-- Allow Offloading Officers to Read In-Transit Open Trips & Execute Closure
-- ==============================================================================
begin;

-- Expose diagnostic function to view active policies on trips
create or replace function public.get_trip_policies()
returns table(polname text, polcmd text, polpermissive text, polqual text)
language sql security definer set search_path = '' as $$
  select policyname::text, cmd::text, permissive::text, qual::text
  from pg_catalog.pg_policies
  where tablename = 'trips';
$$;
revoke all on function public.get_trip_policies() from public, anon, authenticated, service_role;
grant execute on function public.get_trip_policies() to authenticated;

-- Drop the restrictive fence and old policies that block offload officers
drop policy if exists trips_field_read_fence on public.trips;
drop policy if exists trips_read_offloading_own_closed on public.trips;
drop policy if exists trips_read_loading_own on public.trips;
drop policy if exists trips_read_other_operational_roles on public.trips;
drop policy if exists trips_read_offloading on public.trips;
drop policy if exists trips_read_offloading_own on public.trips;
drop policy if exists operational_read on public.trips;
drop policy if exists "Field officers and managers can read trips" on public.trips;

-- 1. Loading Officers see their own dispatched trips
create policy trips_read_loading_own on public.trips
for select to authenticated using (
  private.has_role(array['loading_officer']::public.app_role[])
  and opened_by = auth.uid()
);

-- 2. Offloading Officers see in-transit open trips to receive/close them,
--    as well as historical trips they personally closed
create policy trips_read_offloading on public.trips
for select to authenticated using (
  private.has_role(array['offloading_officer']::public.app_role[])
  and (status = 'open' or closed_by = auth.uid())
);

-- 3. Managers, Admin, Finance, Audit see all operational trips
create policy trips_read_management on public.trips
for select to authenticated using (
  private.has_role(array['system_administrator','operations_manager','finance_officer','audit_reviewer']::public.app_role[])
);

-- 4. Ensure close_trip allows both system_administrator and offloading_officer
create or replace function public.close_trip(
  p_trip_id uuid,
  p_offloading_site_id uuid,
  p_quantity_tonnes numeric
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_trip public.trips%rowtype;
  v_truck uuid;
begin
  perform private.require_role(array['system_administrator','offloading_officer']::public.app_role[]);

  select truck_id into v_truck from public.trips where id = p_trip_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'TRIP_NOT_FOUND');
  end if;

  perform 1 from public.trucks where id = v_truck for update;
  select * into v_trip from public.trips where id = p_trip_id for update;

  if v_trip.status <> 'open' then
    return jsonb_build_object('ok', false, 'code', 'TRIP_NOT_OPEN');
  end if;

  if p_quantity_tonnes is null or p_quantity_tonnes::text in ('NaN','Infinity','-Infinity')
    or p_quantity_tonnes <= 0 or p_quantity_tonnes >= 100000000 or p_quantity_tonnes <> round(p_quantity_tonnes, 2) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_QUANTITY');
  end if;

  perform 1 from public.sites where id = p_offloading_site_id and site_type = 'offloading' and is_active for share;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'INVALID_OFFLOADING_SITE');
  end if;

  perform 1 from public.drivers where id = v_trip.driver_id for share;

  update public.trips
  set status = 'closed',
      offloading_site_id = p_offloading_site_id,
      quantity_tonnes = p_quantity_tonnes,
      closed_at = clock_timestamp(),
      closed_by = auth.uid()
  where id = p_trip_id
  returning * into v_trip;

  return jsonb_build_object('ok', true, 'trip', to_jsonb(v_trip), 'notification_queued', true);
end;
$$;

revoke all on function public.close_trip(uuid,uuid,numeric) from public, anon, authenticated, service_role;
grant execute on function public.close_trip(uuid,uuid,numeric) to authenticated;

commit;
