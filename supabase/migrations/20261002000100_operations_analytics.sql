begin;

create function private.validate_operations_analytics_filters(p_filters jsonb)
returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_today date := (statement_timestamp() at time zone 'Africa/Lagos')::date;
  v_period text;
  v_from date;
  v_to date;
  v_key text;
begin
  if jsonb_typeof(v_filters) is distinct from 'object'
    or exists (
      select 1 from jsonb_object_keys(v_filters) as keys(key)
      where key <> all(array['period','date_from','date_to','loading_site_id','offloading_site_id','truck_id','driver_id'])
    )
    or exists (select 1 from jsonb_each(v_filters) as entry(key,value) where jsonb_typeof(value) <> 'string') then
    raise exception 'Invalid Analytics filters' using errcode = '22023';
  end if;

  v_period := coalesce(v_filters->>'period', '30_days');
  if v_period = '7_days' then
    v_from := v_today - 6;
    v_to := v_today;
  elsif v_period = '30_days' then
    v_from := v_today - 29;
    v_to := v_today;
  elsif v_period = '90_days' then
    v_from := v_today - 89;
    v_to := v_today;
  elsif v_period = 'custom' then
    if not (v_filters ? 'date_from' and v_filters ? 'date_to') then
      raise exception 'Custom Analytics dates are required' using errcode = '22023';
    end if;
    begin
      v_from := (v_filters->>'date_from')::date;
      v_to := (v_filters->>'date_to')::date;
    exception when others then
      raise exception 'Invalid Analytics date range' using errcode = '22023';
    end;
  else
    raise exception 'Invalid Analytics period' using errcode = '22023';
  end if;

  if v_period <> 'custom' and (v_filters ? 'date_from' or v_filters ? 'date_to') then
    raise exception 'Preset Analytics ranges do not accept custom dates' using errcode = '22023';
  end if;
  if not isfinite(v_from) or not isfinite(v_to) or v_from >= date '10000-01-01'
    or v_to >= date '10000-01-01' or v_from > v_to or v_to > v_today or v_to - v_from > 89 then
    raise exception 'Analytics range must be at most 90 days and end no later than today in Africa/Lagos'
      using errcode = '22023';
  end if;

  foreach v_key in array array['loading_site_id','offloading_site_id','truck_id','driver_id'] loop
    if v_filters ? v_key then
      begin
        perform (v_filters->>v_key)::uuid;
      exception when others then
        raise exception 'Invalid Analytics filter identifier' using errcode = '22023';
      end;
    end if;
  end loop;

  v_filters := v_filters - 'date_from' - 'date_to';
  return v_filters || jsonb_build_object('period',v_period,'date_from',v_from,'date_to',v_to);
end;
$$;

create function private.operations_analytics_trips(p_filters jsonb)
returns table (
  trip_id uuid,
  trip_status text,
  truck_id uuid,
  truck_label text,
  driver_id uuid,
  driver_label text,
  loading_site_id uuid,
  loading_site_label text,
  offloading_site_id uuid,
  offloading_site_label text,
  opened_at timestamptz,
  closed_at timestamptz,
  actual_tonnage_tonnes numeric,
  estimated_tonnage_tonnes numeric
)
language sql stable security definer set search_path = '' as $$
  with bounds as (
    select (p_filters->>'date_from')::date::timestamp at time zone 'Africa/Lagos' as starts_at,
      ((p_filters->>'date_to')::date + 1)::timestamp at time zone 'Africa/Lagos' as ends_at
  )
  select trip.id, trip.status::text, trip.truck_id, truck.registration_number,
    trip.driver_id, driver.full_name, trip.loading_site_id, loading_site.name,
    trip.offloading_site_id, offloading_site.name, trip.opened_at, trip.closed_at,
    trip.quantity_tonnes, trip.estimated_quantity_tonnes
  from public.trips as trip
  join public.trucks as truck on truck.id = trip.truck_id
  join public.drivers as driver on driver.id = trip.driver_id
  join public.sites as loading_site on loading_site.id = trip.loading_site_id
  left join public.sites as offloading_site on offloading_site.id = trip.offloading_site_id
  cross join bounds
  where ((trip.opened_at >= bounds.starts_at and trip.opened_at < bounds.ends_at)
      or (trip.status = 'closed' and trip.closed_at >= bounds.starts_at and trip.closed_at < bounds.ends_at))
    and (p_filters->>'truck_id' is null or trip.truck_id = (p_filters->>'truck_id')::uuid)
    and (p_filters->>'driver_id' is null or trip.driver_id = (p_filters->>'driver_id')::uuid)
    and (p_filters->>'loading_site_id' is null or trip.loading_site_id = (p_filters->>'loading_site_id')::uuid)
    and (p_filters->>'offloading_site_id' is null or trip.offloading_site_id = (p_filters->>'offloading_site_id')::uuid)
$$;

create function public.get_operations_analytics_filter_options(
  p_kind text,
  p_search text default null,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_search text := nullif(btrim(p_search), '');
  v_plate_search text;
  v_items jsonb;
  v_has_more boolean;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_kind is null or p_kind not in ('loading_site','offloading_site','truck','driver')
    or p_limit is null or p_limit not between 1 and 100
    or length(v_search) > 100 or position(chr(10) in coalesce(p_search,'')) > 0
    or position(chr(13) in coalesce(p_search,'')) > 0 then
    raise exception 'Invalid Analytics option request' using errcode = '22023';
  end if;
  v_plate_search := nullif(public.normalize_plate(v_search), '');

  with options as materialized (
    select site.id, site.name as label, site.is_active, lower(site.name) as sort_label
    from public.sites as site
    where p_kind in ('loading_site','offloading_site')
      and site.site_type::text = case p_kind when 'loading_site' then 'loading' else 'offloading' end
      and (v_search is null or position(lower(v_search) in lower(site.name)) > 0)
    union all
    select truck.id, truck.registration_number, truck.is_active, lower(truck.normalized_registration)
    from public.trucks as truck
    where p_kind = 'truck'
      and (v_plate_search is null or position(v_plate_search in truck.normalized_registration) > 0)
    union all
    select driver.id, driver.full_name, driver.is_active, lower(driver.full_name)
    from public.drivers as driver
    where p_kind = 'driver'
      and (v_search is null or position(lower(v_search) in lower(driver.full_name)) > 0)
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object('id',selected.id,'label',selected.label,
      'is_active',selected.is_active) order by selected.sort_label,selected.id), '[]'::jsonb)
      from (select * from options order by sort_label,id limit p_limit) as selected),
    (select count(*) > p_limit from options)
  into v_items,v_has_more;

  return jsonb_build_object('kind',p_kind,'items',v_items,'has_more',v_has_more);
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
  v_payout_status jsonb;
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

  with counts as (
    select payment.status::text as status,count(*) as record_count
    from private.operations_analytics_trips(v_filters) as trip
    join public.trip_payments as payment on payment.trip_id=trip.trip_id
    where trip.trip_status='closed' and trip.closed_at >= v_starts_at and trip.closed_at < v_ends_at
    group by payment.status
  ), scored as (select counts.*,sum(record_count) over () as denominator from counts)
  select jsonb_build_object('denominator',coalesce(max(denominator),0),
    'slices',coalesce(jsonb_agg(jsonb_build_object('status',status,'count',record_count,
      'share',record_count::numeric/nullif(denominator,0)) order by status),'[]'::jsonb))
  into v_payout_status from scored;

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
      'trip',v_trip_status,'payout',v_payout_status,'exception',v_exception_status
    ),
    'variance',jsonb_build_object('total_variance_tonnes',v_total_variance,
      'average_variance_tonnes',v_avg_variance,'paired_trip_count',v_variance_trips,
      'estimate_coverage',v_estimate_coverage,'daily',v_variance_trend,'trucks',v_truck_variance)
  );
end;
$$;

revoke all on function private.validate_operations_analytics_filters(jsonb),
  private.operations_analytics_trips(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.get_operations_analytics_filter_options(text,text,integer),
  public.get_operations_analytics(jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_operations_analytics_filter_options(text,text,integer),
  public.get_operations_analytics(jsonb,text,text) to authenticated;

commit;
