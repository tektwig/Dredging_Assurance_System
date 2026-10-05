begin;

create or replace function public.get_operations_analytics(
  p_filters jsonb default '{}'::jsonb,
  p_performance_dimension text default 'truck',
  p_performance_metric text default 'trips'
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_filters jsonb;
  v_base jsonb;
  v_driver_daily jsonb;
  v_summaries jsonb;
  v_from date;
  v_to date;
  v_start timestamptz;
  v_end timestamptz;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  v_filters:=private.validate_operations_analytics_filters(p_filters);
  v_from:=(v_filters->>'date_from')::date;
  v_to:=(v_filters->>'date_to')::date;
  v_start:=v_from::timestamp at time zone 'Africa/Lagos';
  v_end:=((v_to+1)::timestamp at time zone 'Africa/Lagos');

  -- The base RPC validates the caller's original filters. Passing v_filters
  -- here would pass its normalized dates and make preset requests look like
  -- caller-supplied custom dates on the second validation.
  v_base:=private.get_operations_analytics_base(p_filters,p_performance_dimension,p_performance_metric);

  if v_filters ? 'driver_id' then
    with days as (
      select value::date as day
      from generate_series(v_from::timestamp,v_to::timestamp,interval '1 day') as series(value)
    ), trip_rows as materialized (
      select trip.opened_at,trip.closed_at,trip.trip_status,trip.actual_tonnage_tonnes
      from private.operations_analytics_trips(v_filters) as trip
    ), opened as (
      select (trip.opened_at at time zone 'Africa/Lagos')::date as day,count(*)::bigint as trips_opened
      from trip_rows as trip
      where trip.opened_at>=v_start and trip.opened_at<v_end
      group by 1
    ), closed as (
      select (trip.closed_at at time zone 'Africa/Lagos')::date as day,count(*)::bigint as trips_closed,
        coalesce(sum(trip.actual_tonnage_tonnes),0::numeric) as actual_tonnage_tonnes,
        avg(trip.actual_tonnage_tonnes) as average_tonnage_per_trip_tonnes,
        count(trip.actual_tonnage_tonnes)::bigint as average_tonnage_trip_count,
        avg(extract(epoch from (trip.closed_at-trip.opened_at))) filter (
          where trip.opened_at is not null and trip.closed_at is not null
        ) as average_turnaround_seconds,
        count(*) filter (where trip.opened_at is not null and trip.closed_at is not null)::bigint
          as average_turnaround_trip_count
      from trip_rows as trip
      where trip.trip_status='closed' and trip.closed_at>=v_start and trip.closed_at<v_end
      group by 1
    ), series as (
      select days.day,coalesce(opened.trips_opened,0)::bigint as trips_opened,
        coalesce(closed.trips_closed,0)::bigint as trips_closed,
        coalesce(closed.actual_tonnage_tonnes,0::numeric) as actual_tonnage_tonnes,
        closed.average_tonnage_per_trip_tonnes,
        coalesce(closed.average_tonnage_trip_count,0)::bigint as average_tonnage_trip_count,
        closed.average_turnaround_seconds,
        coalesce(closed.average_turnaround_trip_count,0)::bigint as average_turnaround_trip_count
      from days left join opened on opened.day=days.day left join closed on closed.day=days.day
    )
    select jsonb_build_object('selected_driver_id',v_filters->>'driver_id',
      'days',coalesce(jsonb_agg(jsonb_build_object('date',series.day,
        'trips_opened',series.trips_opened,'trips_closed',series.trips_closed,
        'actual_tonnage_tonnes',series.actual_tonnage_tonnes,
        'average_tonnage_per_trip_tonnes',series.average_tonnage_per_trip_tonnes,
        'average_tonnage_trip_count',series.average_tonnage_trip_count,
        'average_turnaround_seconds',series.average_turnaround_seconds,
        'average_turnaround_trip_count',series.average_turnaround_trip_count
      ) order by series.day),'[]'::jsonb))
    into v_driver_daily from series;
  else
    v_driver_daily:=jsonb_build_object('selected_driver_id',null,'days','[]'::jsonb);
  end if;

  v_summaries:=private.operations_analytics_period_summaries(v_filters);

  return v_base || jsonb_build_object(
    'driver_performance_daily',v_driver_daily,
    'period_summaries',v_summaries
  );
end;
$$;

revoke all on function public.get_operations_analytics(jsonb,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.get_operations_analytics(jsonb,text,text) to authenticated;

commit;
