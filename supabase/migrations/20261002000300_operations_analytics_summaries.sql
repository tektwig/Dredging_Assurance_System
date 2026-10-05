begin;

-- Historical status can be derived only when every trip has a valid opening
-- timestamp and a single, internally consistent terminal timestamp.
do $$
begin
  if exists (
    select 1
    from public.trips as trip
    where trip.opened_at is null
      or (trip.status = 'open' and (trip.closed_at is not null or trip.cancelled_at is not null))
      or (trip.status = 'closed' and (trip.closed_at is null or trip.cancelled_at is not null))
      or (trip.status = 'cancelled' and (trip.cancelled_at is null or trip.closed_at is not null))
      or (trip.closed_at is not null and trip.closed_at < trip.opened_at)
      or (trip.cancelled_at is not null and trip.cancelled_at < trip.opened_at)
  ) then
    raise exception 'Operations Analytics requires consistent trip lifecycle timestamps; historical outstanding summaries were not installed'
      using errcode = '23514';
  end if;
end;
$$;

-- Keep the existing aggregate as the single source for its existing response.
-- The public RPC below adds bounded datasets to that result without changing
-- its signature or its Operations Manager authorization boundary.
alter function public.get_operations_analytics(jsonb,text,text) set schema private;
alter function private.get_operations_analytics(jsonb,text,text) rename to get_operations_analytics_base;
revoke all on function private.get_operations_analytics_base(jsonb,text,text)
  from public,anon,authenticated,service_role;

create function private.operations_analytics_period_summaries(p_filters jsonb)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from date := (p_filters->>'date_from')::date;
  v_to date := (p_filters->>'date_to')::date;
  v_start timestamptz := (v_from::timestamp at time zone 'Africa/Lagos');
  v_end timestamptz := ((v_to + 1)::timestamp at time zone 'Africa/Lagos');
  v_result jsonb;
begin
  with granularities(granularity) as materialized (
    values ('week'::text),('month'::text)
  ), buckets as materialized (
    select granularity.granularity,period.period_start::date as natural_start,
      greatest(period.period_start::date,v_from) as bucket_start,
      least(case when granularity.granularity='week' then period.period_start::date+6
        else (period.period_start + interval '1 month')::date-1 end,v_to) as bucket_end
    from granularities as granularity
    cross join lateral generate_series(
      date_trunc(granularity.granularity,v_from::timestamp),
      date_trunc(granularity.granularity,v_to::timestamp),
      case when granularity.granularity='week' then interval '1 week' else interval '1 month' end
    ) as period(period_start)
  ), trip_rows as materialized (
    select trip.trip_status,trip.truck_id,trip.driver_id,trip.loading_site_id,
      trip.opened_at,trip.closed_at,trip.actual_tonnage_tonnes
    from private.operations_analytics_trips(p_filters) as trip
  ), opened as (
    select granularity.granularity,
      date_trunc(granularity.granularity,(trip.opened_at at time zone 'Africa/Lagos'))::date as natural_start,
      count(*)::bigint as trips_opened
    from trip_rows as trip cross join granularities as granularity
    where trip.opened_at>=v_start and trip.opened_at<v_end
    group by 1,2
  ), closed as (
    select granularity.granularity,
      date_trunc(granularity.granularity,(trip.closed_at at time zone 'Africa/Lagos'))::date as natural_start,
      count(*)::bigint as trips_closed,
      coalesce(sum(trip.actual_tonnage_tonnes),0::numeric) as actual_tonnage_tonnes,
      avg(trip.actual_tonnage_tonnes) as average_tonnage_per_trip_tonnes,
      count(trip.actual_tonnage_tonnes)::bigint as average_tonnage_trip_count,
      avg(extract(epoch from (trip.closed_at-trip.opened_at))) filter (
        where trip.opened_at is not null and trip.closed_at is not null
      ) as average_turnaround_seconds,
      count(*) filter (where trip.opened_at is not null and trip.closed_at is not null)::bigint
        as average_turnaround_trip_count
    from trip_rows as trip cross join granularities as granularity
    where trip.trip_status='closed' and trip.closed_at>=v_start and trip.closed_at<v_end
    group by 1,2
  ), lifecycle_trips as materialized (
    -- Offloading site is deliberately omitted here. At the historical point
    -- when a trip is still open, that site has not yet been assigned. Keep
    -- this candidate set to current open trips and terminal events in-range:
    -- older terminal rows cannot contribute to any selected-period balance.
    select candidates.trip_status,candidates.opened_at,candidates.closed_at,candidates.cancelled_at
    from (
      select trip.status::text as trip_status,trip.opened_at,trip.closed_at,trip.cancelled_at
      from public.trips as trip
      where trip.status='open' and trip.opened_at<v_end
        and (p_filters->>'truck_id' is null or trip.truck_id=(p_filters->>'truck_id')::uuid)
        and (p_filters->>'driver_id' is null or trip.driver_id=(p_filters->>'driver_id')::uuid)
        and (p_filters->>'loading_site_id' is null or trip.loading_site_id=(p_filters->>'loading_site_id')::uuid)
      union all
      select trip.status::text,trip.opened_at,trip.closed_at,trip.cancelled_at
      from public.trips as trip
      where trip.status='closed' and trip.closed_at>=v_start and trip.opened_at<v_end
        and (p_filters->>'truck_id' is null or trip.truck_id=(p_filters->>'truck_id')::uuid)
        and (p_filters->>'driver_id' is null or trip.driver_id=(p_filters->>'driver_id')::uuid)
        and (p_filters->>'loading_site_id' is null or trip.loading_site_id=(p_filters->>'loading_site_id')::uuid)
      union all
      select trip.status::text,trip.opened_at,trip.closed_at,trip.cancelled_at
      from public.trips as trip
      where trip.status='cancelled' and trip.cancelled_at>=v_start and trip.opened_at<v_end
        and (p_filters->>'truck_id' is null or trip.truck_id=(p_filters->>'truck_id')::uuid)
        and (p_filters->>'driver_id' is null or trip.driver_id=(p_filters->>'driver_id')::uuid)
        and (p_filters->>'loading_site_id' is null or trip.loading_site_id=(p_filters->>'loading_site_id')::uuid)
    ) as candidates
  ), results as (
    select bucket.granularity,bucket.natural_start,bucket.bucket_start,bucket.bucket_end,
      coalesce(opened.trips_opened,0)::bigint as trips_opened,
      coalesce(closed.trips_closed,0)::bigint as trips_closed,
      coalesce(closed.actual_tonnage_tonnes,0::numeric) as actual_tonnage_tonnes,
      closed.average_tonnage_per_trip_tonnes,
      coalesce(closed.average_tonnage_trip_count,0)::bigint as average_tonnage_trip_count,
      closed.average_turnaround_seconds,
      coalesce(closed.average_turnaround_trip_count,0)::bigint as average_turnaround_trip_count,
      (select count(*)::bigint from lifecycle_trips as lifecycle
        where lifecycle.opened_at < ((bucket.bucket_end+1)::timestamp at time zone 'Africa/Lagos')
          and (lifecycle.trip_status='open'
            or (lifecycle.trip_status='closed'
              and lifecycle.closed_at >= ((bucket.bucket_end+1)::timestamp at time zone 'Africa/Lagos'))
            or (lifecycle.trip_status='cancelled'
              and lifecycle.cancelled_at >= ((bucket.bucket_end+1)::timestamp at time zone 'Africa/Lagos')))
      ) as historical_open_count
    from buckets as bucket
    left join opened on opened.granularity=bucket.granularity and opened.natural_start=bucket.natural_start
    left join closed on closed.granularity=bucket.granularity and closed.natural_start=bucket.natural_start
  )
  select jsonb_build_object(
    'weekly',coalesce(jsonb_agg(jsonb_build_object(
      'period_start',result.bucket_start,'period_end',result.bucket_end,
      'trips_opened',result.trips_opened,'trips_closed',result.trips_closed,
      'outstanding_at_period_end',case when p_filters ? 'offloading_site_id' then 0 else result.historical_open_count end,
      'outstanding_excluded_unassigned_offloading_site_count',
        case when p_filters ? 'offloading_site_id' then result.historical_open_count else 0 end,
      'actual_tonnage_tonnes',result.actual_tonnage_tonnes,
      'average_tonnage_per_trip_tonnes',result.average_tonnage_per_trip_tonnes,
      'average_tonnage_trip_count',result.average_tonnage_trip_count,
      'average_turnaround_seconds',result.average_turnaround_seconds,
      'average_turnaround_trip_count',result.average_turnaround_trip_count
    ) order by result.bucket_start) filter (where result.granularity='week'),'[]'::jsonb),
    'monthly',coalesce(jsonb_agg(jsonb_build_object(
      'period_start',result.bucket_start,'period_end',result.bucket_end,
      'trips_opened',result.trips_opened,'trips_closed',result.trips_closed,
      'outstanding_at_period_end',case when p_filters ? 'offloading_site_id' then 0 else result.historical_open_count end,
      'outstanding_excluded_unassigned_offloading_site_count',
        case when p_filters ? 'offloading_site_id' then result.historical_open_count else 0 end,
      'actual_tonnage_tonnes',result.actual_tonnage_tonnes,
      'average_tonnage_per_trip_tonnes',result.average_tonnage_per_trip_tonnes,
      'average_tonnage_trip_count',result.average_tonnage_trip_count,
      'average_turnaround_seconds',result.average_turnaround_seconds,
      'average_turnaround_trip_count',result.average_turnaround_trip_count
    ) order by result.bucket_start) filter (where result.granularity='month'),'[]'::jsonb),
    'outstanding_definition','open_at_end_of_last_included_lagos_operational_date',
    'offloading_site_filter_scope',case when p_filters ? 'offloading_site_id'
      then 'excludes_unassigned_at_period_end' else 'all_matching_trips' end
  ) into v_result from results as result;
  return v_result;
end;
$$;

create function public.get_operations_analytics(
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
  v_base:=private.get_operations_analytics_base(v_filters,p_performance_dimension,p_performance_metric);

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

revoke all on function private.operations_analytics_period_summaries(jsonb),
  public.get_operations_analytics(jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_operations_analytics(jsonb,text,text) to authenticated;

commit;
