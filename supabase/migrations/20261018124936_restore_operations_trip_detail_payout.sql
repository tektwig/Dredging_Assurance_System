begin;

do $$
begin
  if to_regprocedure('public.get_operations_trip_detail(uuid)') is null then
    raise exception 'Expected Operations trip detail RPC is missing';
  end if;
end;
$$;

create or replace function public.get_operations_trip_detail(p_trip_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  select jsonb_build_object(
    'trip', jsonb_build_object(
      'trip_id', trip.id,'trip_number', trip.trip_number,'status', trip.status::text,
      'truck_id', trip.truck_id,'truck_registration', trip.truck_registration_at_loading,
      'driver_id', trip.driver_id,'driver_name', trip.driver_name_at_loading,
      'loading_site_id', trip.loading_site_id,
      'loading_site_name', coalesce(nullif(btrim(invoice.loading_site_name), ''), loading_site.name),
      'opened_at', trip.opened_at,'estimated_quantity_tonnes', trip.estimated_quantity_tonnes,
      'loading_officer', case when trip.opened_by is null then null else jsonb_build_object(
        'officer_id', trip.opened_by,'display_name', coalesce(nullif(btrim(invoice.loading_officer_name), ''), nullif(btrim(loading_profile.display_name), '')),
        'role', loading_profile.role::text) end,
      'offloading_site_id', trip.offloading_site_id,
      'offloading_site_name', coalesce(nullif(btrim(invoice.offloading_site_name), ''), offloading_site.name),
      'closed_at', trip.closed_at,'quantity_tonnes', trip.quantity_tonnes,
      'offloading_officer', case when trip.closed_by is null then null else jsonb_build_object(
        'officer_id', trip.closed_by,'display_name', coalesce(nullif(btrim(invoice.offloading_officer_name), ''), nullif(btrim(offloading_profile.display_name), '')),
        'role', offloading_profile.role::text) end,
      'cancelled_at', trip.cancelled_at,
      'cancelled_officer', case when trip.cancelled_by is null then null else jsonb_build_object(
        'officer_id', trip.cancelled_by,'display_name', nullif(btrim(cancelling_profile.display_name), ''),
        'role', cancelling_profile.role::text) end
    ),
    'waybill', case when invoice.id is null then null else jsonb_build_object(
      'invoice_number', invoice.invoice_number,'issued_at', invoice.issued_at,'pdf_status', document.status) end,
    'payout', case when payment.id is null then null else jsonb_build_object(
      'status', payment.status::text,'created_at', payment.created_at,
      'payment_ready_at', payment.payment_ready_at,'paid_at', payment.paid_at) end,
    'exceptions', coalesce(exception_rows.items, '[]'::jsonb)
  ) into v_result
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
    select jsonb_agg(jsonb_build_object('exception_id', exception.id,
      'exception_type', exception.exception_type::text,'status', exception.status::text,
      'raised_at', exception.created_at,'resolved_at', exception.resolved_at)
      order by exception.created_at, exception.id) as items
    from public.exceptions as exception where exception.trip_id = trip.id
  ) as exception_rows on true
  where trip.id = p_trip_id;
  return v_result;
end;
$$;

commit;
