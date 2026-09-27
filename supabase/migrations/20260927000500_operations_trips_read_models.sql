begin;

create function public.get_operations_trips(
  p_page integer default 1,
  p_page_size integer default 25,
  p_search text default null,
  p_status public.trip_status default null,
  p_date_from date default null,
  p_date_to date default null,
  p_truck_filter text default null,
  p_driver_filter text default null,
  p_loading_site_filter text default null,
  p_offloading_site_filter text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_search text := nullif(btrim(p_search), '');
  v_plate_search text;
  v_truck_filter text := nullif(public.normalize_plate(nullif(btrim(p_truck_filter), '')), '');
  v_driver_filter text := nullif(btrim(p_driver_filter), '');
  v_loading_site_filter text := nullif(btrim(p_loading_site_filter), '');
  v_offloading_site_filter text := nullif(btrim(p_offloading_site_filter), '');
  v_from timestamptz;
  v_until timestamptz;
  v_offset bigint;
  v_total bigint;
  v_items jsonb;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);

  if p_page is null or p_page < 1 or p_page_size is null or p_page_size not between 1 and 100 then
    raise exception 'Invalid page request' using errcode = '22023';
  end if;
  if (p_date_from is not null and (not isfinite(p_date_from) or p_date_from >= date '10000-01-01'))
    or (p_date_to is not null and (not isfinite(p_date_to) or p_date_to >= date '10000-01-01')) then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;
  if p_date_from is not null and p_date_to is not null and p_date_from > p_date_to then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;
  if length(v_search) > 200 or length(btrim(p_truck_filter)) > 64
    or length(v_driver_filter) > 200 or length(v_loading_site_filter) > 200
    or length(v_offloading_site_filter) > 200 then
    raise exception 'Filter value too long' using errcode = '22023';
  end if;

  v_plate_search := nullif(public.normalize_plate(v_search), '');
  if p_date_from is not null then
    v_from := p_date_from::timestamp at time zone 'Africa/Lagos';
  end if;
  if p_date_to is not null then
    v_until := (p_date_to + 1)::timestamp at time zone 'Africa/Lagos';
  end if;
  v_offset := (p_page::bigint - 1) * p_page_size;

  with filtered as materialized (
    select trip.id, trip.trip_number, trip.status::text as status,
      trip.truck_id, trip.truck_registration_at_loading as truck_registration,
      trip.driver_id, trip.driver_name_at_loading as driver_name,
      trip.loading_site_id,
      coalesce(nullif(btrim(invoice.loading_site_name), ''), loading_site.name) as loading_site_name,
      trip.opened_at, trip.offloading_site_id,
      coalesce(nullif(btrim(invoice.offloading_site_name), ''), offloading_site.name) as offloading_site_name,
      trip.closed_at, trip.quantity_tonnes
    from public.trips as trip
    left join public.sites as loading_site on loading_site.id = trip.loading_site_id
    left join public.sites as offloading_site on offloading_site.id = trip.offloading_site_id
    left join public.trip_closure_invoices as invoice on invoice.trip_id = trip.id
    where (p_status is null or trip.status = p_status)
      and (v_from is null or trip.opened_at >= v_from)
      and (v_until is null or trip.opened_at < v_until)
      and (v_search is null or position(lower(v_search) in lower(trip.trip_number)) > 0
        or (v_plate_search is not null and position(v_plate_search in public.normalize_plate(trip.truck_registration_at_loading)) > 0)
        or position(lower(v_search) in lower(trip.driver_name_at_loading)) > 0)
      and (v_truck_filter is null or position(public.normalize_plate(v_truck_filter)
        in public.normalize_plate(trip.truck_registration_at_loading)) > 0)
      and (v_driver_filter is null or position(lower(v_driver_filter) in lower(trip.driver_name_at_loading)) > 0)
      and (v_loading_site_filter is null or position(lower(v_loading_site_filter)
        in lower(coalesce(nullif(btrim(invoice.loading_site_name), ''), loading_site.name, ''))) > 0)
      and (v_offloading_site_filter is null or position(lower(v_offloading_site_filter)
        in lower(coalesce(nullif(btrim(invoice.offloading_site_name), ''), offloading_site.name, ''))) > 0)
  ), page_rows as (
    select * from filtered order by opened_at desc, id desc limit p_page_size offset v_offset
  )
  select (select count(*) from filtered),
    coalesce((select jsonb_agg(jsonb_build_object(
      'trip_id', id,
      'trip_number', trip_number,
      'truck_id', truck_id,
      'truck_registration', truck_registration,
      'driver_id', driver_id,
      'driver_name', driver_name,
      'loading_site_id', loading_site_id,
      'loading_site_name', loading_site_name,
      'opened_at', opened_at,
      'offloading_site_id', offloading_site_id,
      'offloading_site_name', offloading_site_name,
      'closed_at', closed_at,
      'quantity_tonnes', quantity_tonnes,
      'status', status
    ) order by opened_at desc, id desc) from page_rows), '[]'::jsonb)
  into v_total, v_items;

  return jsonb_build_object(
    'items', v_items,
    'page', p_page,
    'page_size', p_page_size,
    'total_count', v_total,
    'has_next', v_offset + jsonb_array_length(v_items) < v_total
  );
end;
$$;

create function public.get_operations_trip_detail(p_trip_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);

  select jsonb_build_object(
    'trip', jsonb_build_object(
      'trip_id', trip.id,
      'trip_number', trip.trip_number,
      'status', trip.status::text,
      'truck_id', trip.truck_id,
      'truck_registration', trip.truck_registration_at_loading,
      'driver_id', trip.driver_id,
      'driver_name', trip.driver_name_at_loading,
      'loading_site_id', trip.loading_site_id,
      'loading_site_name', coalesce(nullif(btrim(invoice.loading_site_name), ''), loading_site.name),
      'opened_at', trip.opened_at,
      'loading_officer', case when trip.opened_by is null then null else jsonb_build_object(
        'officer_id', trip.opened_by,
        'display_name', coalesce(nullif(btrim(invoice.loading_officer_name), ''), nullif(btrim(loading_profile.display_name), '')),
        'role', loading_profile.role::text
      ) end,
      'offloading_site_id', trip.offloading_site_id,
      'offloading_site_name', coalesce(nullif(btrim(invoice.offloading_site_name), ''), offloading_site.name),
      'closed_at', trip.closed_at,
      'quantity_tonnes', trip.quantity_tonnes,
      'offloading_officer', case when trip.closed_by is null then null else jsonb_build_object(
        'officer_id', trip.closed_by,
        'display_name', coalesce(nullif(btrim(invoice.offloading_officer_name), ''), nullif(btrim(offloading_profile.display_name), '')),
        'role', offloading_profile.role::text
      ) end,
      'cancelled_at', trip.cancelled_at,
      'cancelled_officer', case when trip.cancelled_by is null then null else jsonb_build_object(
        'officer_id', trip.cancelled_by,
        'display_name', nullif(btrim(cancelling_profile.display_name), ''),
        'role', cancelling_profile.role::text
      ) end
    ),
    'waybill', case when invoice.id is null then null else jsonb_build_object(
      'invoice_number', invoice.invoice_number,
      'issued_at', invoice.issued_at,
      'pdf_status', document.status
    ) end,
    'payout', case when payment.id is null then null else jsonb_build_object(
      'status', payment.status::text,
      'created_at', payment.created_at,
      'payment_ready_at', payment.payment_ready_at,
      'paid_at', payment.paid_at
    ) end,
    'exceptions', coalesce(exception_rows.items, '[]'::jsonb)
  )
  into v_result
  from public.trips as trip
  left join public.profiles as loading_profile on loading_profile.id = trip.opened_by
  left join public.profiles as offloading_profile on offloading_profile.id = trip.closed_by
  left join public.profiles as cancelling_profile on cancelling_profile.id = trip.cancelled_by
  left join public.sites as loading_site on loading_site.id = trip.loading_site_id
  left join public.sites as offloading_site on offloading_site.id = trip.offloading_site_id
  left join public.trip_closure_invoices as invoice on invoice.trip_id = trip.id and trip.status = 'closed'
  left join public.trip_closure_invoice_documents as document
    on document.trip_id = trip.id and document.invoice_id = invoice.id and trip.status = 'closed'
  left join public.trip_payments as payment on payment.trip_id = trip.id and trip.status = 'closed'
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'exception_id', exception.id,
      'exception_type', exception.exception_type::text,
      'status', exception.status::text,
      'raised_at', exception.created_at,
      'resolved_at', exception.resolved_at
    ) order by exception.created_at, exception.id) as items
    from public.exceptions as exception
    where exception.trip_id = trip.id
  ) as exception_rows on true
  where trip.id = p_trip_id;

  return v_result;
end;
$$;

revoke all on function public.get_operations_trips(integer,integer,text,public.trip_status,date,date,text,text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_operations_trip_detail(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_operations_trips(integer,integer,text,public.trip_status,date,date,text,text,text,text)
  to authenticated;
grant execute on function public.get_operations_trip_detail(uuid) to authenticated;

commit;
