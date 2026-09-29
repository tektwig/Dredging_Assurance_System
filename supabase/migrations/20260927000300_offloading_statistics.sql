begin;

create function public.get_offloading_statistics() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_assignment jsonb;
  v_day date;
  v_start timestamptz;
  v_end timestamptz;
  v_closed bigint;
  v_open bigint;
  v_tonnage numeric;
  v_trucks bigint;
begin
  perform private.require_role(array['offloading_officer']::public.app_role[]);
  v_assignment := private.offloading_assignment_readonly();
  if not coalesce((v_assignment->>'ok')::boolean, false) then
    return v_assignment;
  end if;

  v_day := (statement_timestamp() at time zone 'Africa/Lagos')::date;
  v_start := v_day::timestamp at time zone 'Africa/Lagos';
  v_end := (v_day + 1)::timestamp at time zone 'Africa/Lagos';

  select
    count(*) filter (
      where t.status = 'closed'
        and t.closed_by = auth.uid()
        and t.closed_at >= v_start
        and t.closed_at < v_end
    ),
    count(*) filter (where t.status = 'open'),
    coalesce(sum(t.quantity_tonnes) filter (
      where t.status = 'closed'
        and t.closed_by = auth.uid()
        and t.closed_at >= v_start
        and t.closed_at < v_end
    ), 0::numeric),
    count(distinct t.truck_id) filter (
      where t.status = 'closed'
        and t.closed_by = auth.uid()
        and t.closed_at >= v_start
        and t.closed_at < v_end
    )
  into v_closed, v_open, v_tonnage, v_trucks
  from public.trips as t;

  return jsonb_build_object(
    'trips_closed_today', v_closed,
    'open_trips', v_open,
    'tonnage_processed_today', v_tonnage,
    'trucks_processed_today', v_trucks
  );
end;
$$;

revoke all on function public.get_offloading_statistics() from public, anon, authenticated, service_role;
grant execute on function public.get_offloading_statistics() to authenticated;

commit;
