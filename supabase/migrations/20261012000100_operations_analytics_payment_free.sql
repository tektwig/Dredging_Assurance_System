begin;

-- Replace the payment-dependent aggregate with the operational calculations,

-- using trips and exceptions only. The payout distribution is retired.

create or replace function private.get_operations_analytics_base(
  p_filters jsonb default '{}'::jsonb,
  p_performance_dimension text default 'truck',
  p_performance_metric text default 'trips'
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_filters jsonb;
  v_from date;
  v_to date;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_as_of timestamptz := statement_timestamp();
  v_total_trips bigint;
  v_actual_tonnage numeric;
  v_closed_trips bigint;
  v_avg_tonnage numeric;
  v_avg_turnaround numeric;
  v_turnaround_trips bigint;
  v_avg_variance numeric;
  v_total_variance numeric;
  v_variance_trips bigint;
  v_estimate_coverage numeric;
  v_trips_trend jsonb;
  v_tonnage_trend jsonb;
  v_variance_trend jsonb;
  v_performance_count bigint;
  v_performance_items jsonb;
  v_trip_status jsonb;
  v_exception_status jsonb;
  v_truck_variance jsonb;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_performance_dimension is null or p_performance_dimension not in ('truck','driver','loading_site','offloading_site')
    or p_performance_metric is null or p_performance_metric not in ('trips','actual_tonnage','average_tonnage','average_turnaround') then
    raise exception 'Invalid Analytics comparison request' using errcode = '22023';
  end if;

  v_filters := private.validate_operations_analytics_filters(p_filters);
  v_from := (v_filters->>'date_from')::date;
  v_to := (v_filters->>'date_to')::date;
  v_starts_at := v_from::timestamp at time zone 'Africa/Lagos';
  v_ends_at := (v_to + 1)::timestamp at time zone 'Africa/Lagos';

  select count(*) filter (where trip.opened_at >= v_starts_at and trip.opened_at < v_ends_at),
    coalesce(sum(trip.actual_tonnage_tonnes) filter (
      where trip.trip_status = 'closed' and trip.closed_at >= v_starts_at and trip.closed_at < v_ends_at
    ),0::numeric),
    count(*) filter (where trip.trip_status = 'closed' and trip.closed_at >= v_starts_at and trip.closed_at < v_ends_at
      and trip.actual_tonnage_tonnes is not null),
    avg(trip.actual_tonnage_tonnes) filter (
      where trip.trip_status = 'closed' and trip.closed_at >= v_starts_at and trip.closed_at < v_ends_at
    ),
    avg(extract(epoch from (trip.closed_at - trip.opened_at))) filter (
      where trip.trip_status = 'closed' and trip.closed_at >= v_starts_at and trip.closed_at < v_ends_at
        and trip.opened_at is not null and trip.closed_at is not null
    ),
    count(*) filter (where trip.trip_status = 'closed' and trip.closed_at >= v_starts_at and trip.closed_at < v_ends_at
      and trip.opened_at is not null and trip.closed_at is not null),
    avg(trip.actual_tonnage_tonnes - trip.estimated_tonnage_tonnes) filter (
      where trip.trip_status = 'closed' and trip.closed_at >= v_starts_at and trip.closed_at < v_ends_at
        and trip.actual_tonnage_tonnes is not null and trip.estimated_tonnage_tonnes is not null
    ),
    sum(trip.actual_tonnage_tonnes - trip.estimated_tonnage_tonnes) filter (
      where trip.trip_status = 'closed' and trip.closed_at >= v_starts_at and trip.closed_at < v_ends_at
        and trip.actual_tonnage_tonnes is not null and trip.estimated_tonnage_tonnes is not null
    ),
    count(*) filter (where trip.trip_status = 'closed' and trip.closed_at >= v_starts_at
      and trip.closed_at < v_ends_at and trip.actual_tonnage_tonnes is not null and trip.estimated_tonnage_tonnes is not null),
    (count(*) filter (where trip.trip_status = 'closed' and trip.closed_at >= v_starts_at
      and trip.closed_at < v_ends_at and trip.actual_tonnage_tonnes is not null and trip.estimated_tonnage_tonnes is not null))::numeric
      / nullif(count(*) filter (where trip.trip_status = 'closed' and trip.closed_at >= v_starts_at
        and trip.closed_at < v_ends_at and trip.actual_tonnage_tonnes is not null),0)
  into v_total_trips,v_actual_tonnage,v_closed_trips,v_avg_tonnage,v_avg_turnaround,v_turnaround_trips,
    v_avg_variance,v_total_variance,v_variance_trips,v_estimate_coverage
  from private.operations_analytics_trips(v_filters) as trip;

  with days as (
    select value::date as day from generate_series(v_from::timestamp,v_to::timestamp,interval '1 day') as series(value)
  ), events as (
    select (trip.opened_at at time zone 'Africa/Lagos')::date as day,'opened'::text as event_type
    from private.operations_analytics_trips(v_filters) as trip
    where trip.opened_at >= v_starts_at and trip.opened_at < v_ends_at
    union all
    select (trip.closed_at at time zone 'Africa/Lagos')::date,'closed'::text
    from private.operations_analytics_trips(v_filters) as trip
    where trip.trip_status = 'closed' and trip.closed_at >= v_starts_at and trip.closed_at < v_ends_at
  ), daily as (
    select day,count(*) filter (where event_type='opened') as opened,
      count(*) filter (where event_type='closed') as closed
    from events group by day
  )
  select coalesce(jsonb_agg(jsonb_build_object('date',to_char(days.day,'YYYY-MM-DD'),
      'opened',coalesce(daily.opened,0),'closed',coalesce(daily.closed,0)) order by days.day),'[]'::jsonb)
  into v_trips_trend
  from days left join daily on daily.day = days.day;

  with days as (
    select value::date as day from generate_series(v_from::timestamp,v_to::timestamp,interval '1 day') as series(value)
  ), paired as (
    select (trip.closed_at at time zone 'Africa/Lagos')::date as day,count(*) as paired_trips,
      sum(trip.estimated_tonnage_tonnes) as estimated_tonnage,
      sum(trip.actual_tonnage_tonnes) as actual_tonnage,
      sum(trip.actual_tonnage_tonnes - trip.estimated_tonnage_tonnes) as variance
    from private.operations_analytics_trips(v_filters) as trip
    where trip.trip_status='closed' and trip.closed_at >= v_starts_at and trip.closed_at < v_ends_at
      and trip.actual_tonnage_tonnes is not null and trip.estimated_tonnage_tonnes is not null
    group by 1
  ), series as (
    select days.day,coalesce(paired.paired_trips,0) as paired_trips,
      case when paired.paired_trips is null then null else paired.estimated_tonnage end as estimated_tonnage,
      case when paired.paired_trips is null then null else paired.actual_tonnage end as actual_tonnage,
      case when paired.paired_trips is null then null else paired.variance end as variance
    from days left join paired on paired.day = days.day
  )
  select coalesce(jsonb_agg(jsonb_build_object('date',to_char(day,'YYYY-MM-DD'),
      'estimated_tonnage_tonnes',estimated_tonnage,'actual_tonnage_tonnes',actual_tonnage,
      'paired_trip_count',paired_trips) order by day),'[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('date',to_char(day,'YYYY-MM-DD'),
      'variance_tonnes',variance,'paired_trip_count',paired_trips) order by day),'[]'::jsonb)
  into v_tonnage_trend,v_variance_trend from series;

  with groups as materialized (
    select case p_performance_dimension
        when 'truck' then trip.truck_id when 'driver' then trip.driver_id
        when 'loading_site' then trip.loading_site_id else trip.offloading_site_id end as entity_id,
      case p_performance_dimension
        when 'truck' then trip.truck_label when 'driver' then trip.driver_label
        when 'loading_site' then trip.loading_site_label else trip.offloading_site_label end as label,
      count(*) filter (where trip.opened_at >= v_starts_at and trip.opened_at < v_ends_at) as trip_count,
      count(*) filter (where trip.trip_status='closed' and trip.closed_at >= v_starts_at and trip.closed_at < v_ends_at) as closed_trip_count,
      sum(trip.actual_tonnage_tonnes) filter (where trip.trip_status='closed'
        and trip.closed_at >= v_starts_at and trip.closed_at < v_ends_at) as actual_tonnage,
      avg(trip.actual_tonnage_tonnes) filter (where trip.trip_status='closed'
        and trip.closed_at >= v_starts_at and trip.closed_at < v_ends_at) as average_tonnage,
      avg(extract(epoch from (trip.closed_at-trip.opened_at))) filter (
        where trip.trip_status='closed' and trip.closed_at >= v_starts_at and trip.closed_at < v_ends_at
          and trip.opened_at is not null and trip.closed_at is not null
      ) as average_turnaround
    from private.operations_analytics_trips(v_filters) as trip
    where p_performance_dimension <> 'offloading_site' or trip.offloading_site_id is not null
    group by 1,2
  ), ranked as (
    select groups.*,
      case p_performance_metric when 'trips' then trip_count::numeric
        when 'actual_tonnage' then actual_tonnage
        when 'average_tonnage' then average_tonnage
        else average_turnaround end as metric_value
    from groups
    where (p_performance_metric='trips' and trip_count > 0)
      or (p_performance_metric='actual_tonnage' and actual_tonnage is not null)
      or (p_performance_metric='average_tonnage' and average_tonnage is not null)
      or (p_performance_metric='average_turnaround' and average_turnaround is not null)
  )
  select (select count(*) from ranked),
    coalesce((select jsonb_agg(jsonb_build_object('entity_id',selected.entity_id,'label',selected.label,
      'trip_count',selected.trip_count,'closed_trip_count',selected.closed_trip_count,
      'actual_tonnage_tonnes',selected.actual_tonnage,'average_tonnage_tonnes',selected.average_tonnage,
      'average_turnaround_seconds',selected.average_turnaround)
      order by selected.metric_value desc nulls last,selected.entity_id)
      from (select * from ranked order by metric_value desc nulls last,entity_id limit 10) as selected),'[]'::jsonb)
  into v_performance_count,v_performance_items;

  with counts as (
    select trip.trip_status as status,count(*) as record_count
    from private.operations_analytics_trips(v_filters) as trip
    where trip.opened_at >= v_starts_at and trip.opened_at < v_ends_at
    group by trip.trip_status
  ), scored as (select counts.*,sum(record_count) over () as denominator from counts)
  select jsonb_build_object('denominator',coalesce(max(denominator),0),
    'slices',coalesce(jsonb_agg(jsonb_build_object('status',status,'count',record_count,
      'share',record_count::numeric/nullif(denominator,0)) order by status),'[]'::jsonb))
  into v_trip_status from scored;



  with filtered as (
    select exception.status::text as status
    from public.exceptions as exception
    left join public.trips as trip on trip.id=exception.trip_id
    where exception.created_at >= v_starts_at and exception.created_at < v_ends_at
      and (v_filters->>'truck_id' is null or exception.truck_id=(v_filters->>'truck_id')::uuid)
      and (v_filters->>'driver_id' is null or trip.driver_id=(v_filters->>'driver_id')::uuid)
      and (v_filters->>'loading_site_id' is null or trip.loading_site_id=(v_filters->>'loading_site_id')::uuid)
      and (v_filters->>'offloading_site_id' is null or trip.offloading_site_id=(v_filters->>'offloading_site_id')::uuid)
  ), counts as (select status,count(*) as record_count from filtered group by status),
  scored as (select counts.*,sum(record_count) over () as denominator from counts)
  select jsonb_build_object('denominator',coalesce(max(denominator),0),
    'slices',coalesce(jsonb_agg(jsonb_build_object('status',status,'count',record_count,
      'share',record_count::numeric/nullif(denominator,0)) order by status),'[]'::jsonb))
  into v_exception_status from scored;

  with grouped as (
    select trip.truck_id,trip.truck_label,
      avg(trip.actual_tonnage_tonnes-trip.estimated_tonnage_tonnes) as average_variance,
      sum(trip.actual_tonnage_tonnes-trip.estimated_tonnage_tonnes) as total_variance,
      count(*) as paired_trip_count
    from private.operations_analytics_trips(v_filters) as trip
    where trip.trip_status='closed' and trip.closed_at >= v_starts_at and trip.closed_at < v_ends_at
      and trip.actual_tonnage_tonnes is not null and trip.estimated_tonnage_tonnes is not null
    group by trip.truck_id,trip.truck_label
  )
  select coalesce(jsonb_agg(jsonb_build_object('entity_id',selected.truck_id,'label',selected.truck_label,
      'average_variance_tonnes',selected.average_variance,'total_variance_tonnes',selected.total_variance,
      'paired_trip_count',selected.paired_trip_count)
      order by abs(selected.average_variance) desc,selected.truck_id),'[]'::jsonb)
  into v_truck_variance
  from (select * from grouped order by abs(average_variance) desc,truck_id limit 10) as selected;

  return jsonb_build_object(
    'as_of',v_as_of,'range_start',v_from,'range_end',v_to,'time_zone','Africa/Lagos',
    'period',v_filters->>'period',
    'kpis',jsonb_build_object(
      'total_trips',v_total_trips,
      'actual_tonnage_tonnes',v_actual_tonnage,
      'actual_tonnage_closed_trip_count',v_closed_trips,
      'average_tonnage_per_trip_tonnes',v_avg_tonnage,
      'average_tonnage_trip_count',v_closed_trips,
      'average_turnaround_seconds',v_avg_turnaround,
      'average_turnaround_trip_count',v_turnaround_trips,
      'average_tonnage_variance_tonnes',v_avg_variance,
      'total_tonnage_variance_tonnes',v_total_variance,
      'variance_trip_count',v_variance_trips,
      'estimate_coverage',v_estimate_coverage
    ),
    'trips_trend',v_trips_trend,
    'tonnage_trend',v_tonnage_trend,
    'performance',jsonb_build_object('dimension',p_performance_dimension,'metric',p_performance_metric,
      'entity_count',v_performance_count,'items',v_performance_items),
    'status_distributions',jsonb_build_object(
      'trip',v_trip_status,'exception',v_exception_status
    ),
    'variance',jsonb_build_object('total_variance_tonnes',v_total_variance,
      'average_variance_tonnes',v_avg_variance,'paired_trip_count',v_variance_trips,
      'estimate_coverage',v_estimate_coverage,'daily',v_variance_trend,'trucks',v_truck_variance)
  );
end;
$$;


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


drop function if exists private.get_operations_analytics_payment_legacy(jsonb,text,text);

revoke all on function private.get_operations_analytics_base(jsonb,text,text) from public,anon,authenticated,service_role;

revoke all on function public.get_operations_analytics(jsonb,text,text) from public,anon,authenticated,service_role;

grant execute on function public.get_operations_analytics(jsonb,text,text) to authenticated;

commit;