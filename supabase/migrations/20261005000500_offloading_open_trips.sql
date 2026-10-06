begin;

-- Open trips do not yet carry a destination Offloading Site: offloading_site_id
-- remains NULL until close_trip_v2 records the officer's active assignment.
-- The officer's current active Offloading assignment is therefore the server-
-- validated processing scope for this in-transit pool.
create or replace function public.get_offloading_open_trips() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_assignment public.user_site_assignments%rowtype;
  v_site public.sites%rowtype;
  v_trips jsonb;
begin
  perform private.require_role(array['offloading_officer']::public.app_role[]);

  select * into v_assignment
  from public.user_site_assignments
  where profile_id = auth.uid() and ended_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SITE_ASSIGNMENT_REQUIRED');
  end if;

  select * into v_site from public.sites where id = v_assignment.site_id;
  if not found or v_site.site_type <> 'offloading' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_SITE_ASSIGNMENT');
  end if;
  if not v_site.is_active then
    return jsonb_build_object('ok', false, 'code', 'INACTIVE_SITE');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', trip.id,
    'trip_number', trip.trip_number,
    'truck_id', trip.truck_id,
    'registration_number', truck.registration_number,
    'normalized_registration', truck.normalized_registration,
    'opened_at', trip.opened_at,
    'loading_site_name', loading_site.name
  ) order by trip.opened_at asc, trip.id asc), '[]'::jsonb)
  into v_trips
  from public.trips as trip
  join public.trucks as truck on truck.id = trip.truck_id
  join public.sites as loading_site on loading_site.id = trip.loading_site_id
  where trip.status = 'open' and trip.offloading_site_id is null;

  return jsonb_build_object(
    'ok', true,
    'assignment', jsonb_build_object(
      'assignment_id', v_assignment.id,
      'site_id', v_site.id,
      'site_name', v_site.name
    ),
    'trips', v_trips
  );
end;
$$;

revoke all on function public.get_offloading_open_trips() from public, anon, authenticated, service_role;
grant execute on function public.get_offloading_open_trips() to authenticated;

commit;
