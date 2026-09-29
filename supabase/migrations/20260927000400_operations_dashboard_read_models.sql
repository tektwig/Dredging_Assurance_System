begin;

create function public.get_operations_dashboard_summary() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_day date;
  v_start timestamptz;
  v_end timestamptz;
  v_opened bigint;
  v_closed bigint;
  v_open bigint;
  v_tonnage numeric;
  v_trucks bigint;
  v_exception_count bigint;
  v_pdf_count bigint;
  v_email_count bigint;
  v_payment_count bigint;
  v_exceptions jsonb;
  v_pdfs jsonb;
  v_emails jsonb;
  v_payments jsonb;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);

  v_day := (statement_timestamp() at time zone 'Africa/Lagos')::date;
  v_start := v_day::timestamp at time zone 'Africa/Lagos';
  v_end := (v_day + 1)::timestamp at time zone 'Africa/Lagos';

  select count(*) filter (where t.opened_at >= v_start and t.opened_at < v_end),
    count(*) filter (where t.status = 'closed' and t.closed_at >= v_start and t.closed_at < v_end),
    count(*) filter (where t.status = 'open'),
    coalesce(sum(t.quantity_tonnes) filter (
      where t.status = 'closed' and t.closed_at >= v_start and t.closed_at < v_end
    ), 0::numeric),
    count(distinct t.truck_id) filter (
      where t.status = 'closed' and t.closed_at >= v_start and t.closed_at < v_end
    )
  into v_opened, v_closed, v_open, v_tonnage, v_trucks
  from public.trips as t;

  select count(*) into v_exception_count
  from public.exceptions as e where e.status::text <> 'resolved';
  select coalesce(jsonb_agg(to_jsonb(preview) order by preview.created_at, preview.exception_id), '[]'::jsonb)
  into v_exceptions from (
    select e.id as exception_id, e.exception_type::text as exception_type,
      t.trip_number, truck.registration_number as truck_registration, e.created_at
    from public.exceptions as e
    left join public.trips as t on t.id = e.trip_id
    left join public.trucks as truck on truck.id = e.truck_id
    where e.status::text <> 'resolved'
    order by e.created_at, e.id limit 5
  ) as preview;

  select count(*) into v_pdf_count
  from public.trip_closure_invoice_documents as document
  where document.status = 'failed';
  select coalesce(jsonb_agg(to_jsonb(preview) order by preview.failed_at, preview.document_id), '[]'::jsonb)
  into v_pdfs from (
    select document.id as document_id, invoice.invoice_number, invoice.trip_number,
      document.failed_at
    from public.trip_closure_invoice_documents as document
    join public.trip_closure_invoices as invoice
      on invoice.id = document.invoice_id and invoice.trip_id = document.trip_id
    where document.status = 'failed'
    order by document.failed_at, document.id limit 5
  ) as preview;

  select count(*) into v_email_count
  from public.notification_outbox as notification
  where notification.event_type = 'waybill_ready' and notification.status = 'failed';
  select coalesce(jsonb_agg(to_jsonb(preview) order by preview.failed_at, preview.notification_id), '[]'::jsonb)
  into v_emails from (
    select notification.id as notification_id, invoice.invoice_number,
      invoice.trip_number, notification.updated_at as failed_at
    from public.notification_outbox as notification
    join public.trip_closure_invoices as invoice on invoice.trip_id = notification.trip_id
    where notification.event_type = 'waybill_ready' and notification.status = 'failed'
    order by notification.updated_at, notification.id limit 5
  ) as preview;

  select count(*) into v_payment_count
  from public.trip_payments as payment
  where payment.status = 'payment_details_required';
  select coalesce(jsonb_agg(to_jsonb(preview) order by preview.created_at, preview.payment_id), '[]'::jsonb)
  into v_payments from (
    select payment.id as payment_id, trip.trip_number,
      truck.registration_number as truck_registration, driver.full_name as driver_name,
      payment.created_at
    from public.trip_payments as payment
    join public.trips as trip on trip.id = payment.trip_id
    join public.trucks as truck on truck.id = payment.truck_id
    join public.drivers as driver on driver.id = payment.driver_id
    where payment.status = 'payment_details_required'
    order by payment.created_at, payment.id limit 5
  ) as preview;

  return jsonb_build_object(
    'trips_opened_today', v_opened,
    'trips_closed_today', v_closed,
    'open_trips', v_open,
    'tonnage_today', v_tonnage,
    'trucks_processed_today', v_trucks,
    'exceptions_requiring_attention', v_exception_count,
    'action_required', jsonb_build_object(
      'unresolved_exceptions', jsonb_build_object('count', v_exception_count, 'items', v_exceptions),
      'failed_waybill_pdfs', jsonb_build_object('count', v_pdf_count, 'items', v_pdfs),
      'failed_waybill_emails', jsonb_build_object('count', v_email_count, 'items', v_emails),
      'payment_details_required', jsonb_build_object('count', v_payment_count, 'items', v_payments)
    )
  );
end;
$$;

create function public.get_operations_dashboard_open_trips(p_limit integer default 10) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_as_of timestamptz := statement_timestamp();
  v_items jsonb;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_limit is null or p_limit not between 1 and 10 then
    raise exception 'Limit must be 1..10' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.opened_at, row_data.trip_id), '[]'::jsonb)
  into v_items from (
    select trip.id as trip_id, trip.trip_number,
      truck.registration_number as truck_registration, driver.full_name as driver_name,
      site.name as loading_site_name, trip.opened_at,
      greatest(0, floor(extract(epoch from (v_as_of - trip.opened_at))))::bigint as duration_seconds,
      'open'::text as status
    from public.trips as trip
    join public.trucks as truck on truck.id = trip.truck_id
    join public.drivers as driver on driver.id = trip.driver_id
    join public.sites as site on site.id = trip.loading_site_id
    where trip.status = 'open'
    order by trip.opened_at, trip.id
    limit p_limit
  ) as row_data;

  return jsonb_build_object('as_of', v_as_of, 'items', v_items);
end;
$$;

create function public.get_operations_dashboard_activity(p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_as_of timestamptz := statement_timestamp();
  v_items jsonb;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'Limit must be 1..50' using errcode = '22023';
  end if;

  with activity as (
    (select 'trip-opened:' || trip.id::text as event_id, 'trip_opened'::text as event_type,
      trip.opened_at as occurred_at, trip.trip_number, truck.registration_number as truck_registration,
      trip.opened_by as officer_id, null::text as snapshot_officer_name,
      site.name as site_name, null::text as payment_status
    from public.trips as trip
    join public.trucks as truck on truck.id = trip.truck_id
    join public.sites as site on site.id = trip.loading_site_id
    order by trip.opened_at desc, trip.id desc limit p_limit)
    union all
    (select 'trip-closed:' || trip.id::text, 'trip_closed', trip.closed_at, trip.trip_number,
      truck.registration_number, trip.closed_by, null::text, site.name, null::text
    from public.trips as trip
    join public.trucks as truck on truck.id = trip.truck_id
    join public.sites as site on site.id = trip.offloading_site_id
    where trip.status = 'closed' and trip.closed_at is not null
    order by trip.closed_at desc, trip.id desc limit p_limit)
    union all
    (select 'trip-cancelled:' || trip.id::text, 'trip_cancelled', trip.cancelled_at, trip.trip_number,
      truck.registration_number, trip.cancelled_by, null::text, site.name, null::text
    from public.trips as trip
    join public.trucks as truck on truck.id = trip.truck_id
    join public.sites as site on site.id = trip.loading_site_id
    where trip.status = 'cancelled' and trip.cancelled_at is not null
    order by trip.cancelled_at desc, trip.id desc limit p_limit)
    union all
    (select 'exception-raised:' || exception.id::text, 'exception_raised', exception.created_at,
      trip.trip_number, truck.registration_number, exception.reported_by, null::text,
      site.name, null::text
    from public.exceptions as exception
    left join public.trips as trip on trip.id = exception.trip_id
    left join public.trucks as truck on truck.id = exception.truck_id
    left join public.sites as site on site.id = trip.loading_site_id
    order by exception.created_at desc, exception.id desc limit p_limit)
    union all
    (select 'exception-resolved:' || exception.id::text, 'exception_resolved', exception.resolved_at,
      trip.trip_number, truck.registration_number, exception.resolved_by, null::text,
      site.name, null::text
    from public.exceptions as exception
    left join public.trips as trip on trip.id = exception.trip_id
    left join public.trucks as truck on truck.id = exception.truck_id
    left join public.sites as site on site.id = trip.loading_site_id
    where exception.status = 'resolved' and exception.resolved_at is not null
    order by exception.resolved_at desc, exception.id desc limit p_limit)
    union all
    (select 'waybill-issued:' || invoice.id::text, 'waybill_issued', invoice.issued_at,
      invoice.trip_number, invoice.truck_registration, invoice.offloading_officer_id,
      invoice.offloading_officer_name, invoice.offloading_site_name, null::text
    from public.trip_closure_invoices as invoice
    order by invoice.issued_at desc, invoice.id desc limit p_limit)
    union all
    (select 'pdf-ready:' || document.id::text, 'pdf_ready', document.ready_at,
      invoice.trip_number, invoice.truck_registration, null::uuid, null::text,
      invoice.offloading_site_name, null::text
    from public.trip_closure_invoice_documents as document
    join public.trip_closure_invoices as invoice
      on invoice.id = document.invoice_id and invoice.trip_id = document.trip_id
    where document.status = 'ready' and document.ready_at is not null
    order by document.ready_at desc, document.id desc limit p_limit)
    union all
    (select 'payment-status:' || log.id::text, 'payment_status_changed', log.created_at,
      trip.trip_number, truck.registration_number, log.actor_id, null::text,
      site.name, log.new_value->>'status'
    from public.audit_log as log
    join public.trip_payments as payment on payment.id = log.entity_id
    join public.trips as trip on trip.id = payment.trip_id
    join public.trucks as truck on truck.id = trip.truck_id
    join public.sites as site on site.id = trip.offloading_site_id
    where log.entity_name = 'trip_payments' and log.action = 'UPDATE'
      and log.old_value->>'status' is distinct from log.new_value->>'status'
    order by log.created_at desc, log.id desc limit p_limit)
  ), enriched as (
    select activity.*, profile.display_name as current_officer_name, profile.role as officer_role
    from activity left join public.profiles as profile on profile.id = activity.officer_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'event_id', event_id,
    'event_type', event_type,
    'occurred_at', occurred_at,
    'trip_number', trip_number,
    'truck_registration', truck_registration,
    'officer_id', officer_id,
    'officer_name', coalesce(nullif(btrim(snapshot_officer_name), ''), nullif(btrim(current_officer_name), '')),
    'officer_role', officer_role,
    'site_name', site_name,
    'payment_status', payment_status
  ) order by occurred_at desc, event_id desc), '[]'::jsonb)
  into v_items from (select * from enriched order by occurred_at desc, event_id desc limit p_limit) as item;

  return jsonb_build_object('as_of', v_as_of, 'items', v_items);
end;
$$;

revoke all on function public.get_operations_dashboard_summary() from public, anon, authenticated, service_role;
revoke all on function public.get_operations_dashboard_open_trips(integer) from public, anon, authenticated, service_role;
revoke all on function public.get_operations_dashboard_activity(integer) from public, anon, authenticated, service_role;
grant execute on function public.get_operations_dashboard_summary() to authenticated;
grant execute on function public.get_operations_dashboard_open_trips(integer) to authenticated;
grant execute on function public.get_operations_dashboard_activity(integer) to authenticated;

commit;
