begin;

alter table public.trips
  add column estimated_quantity_tonnes numeric(10,2);

alter table public.trips
  add constraint trips_estimated_quantity_tonnes_valid check (
    estimated_quantity_tonnes is null or (
      estimated_quantity_tonnes::text not in ('NaN', 'Infinity', '-Infinity')
      and estimated_quantity_tonnes > 0
      and estimated_quantity_tonnes < 100000000
    )
  );

create or replace function public.create_loading_trip_v2(
  p_request_id uuid,p_plate text,p_driver_id uuid,p_expected_assignment_id uuid,
  p_capture_method text,p_captured_at timestamptz,p_ocr_detected_plate text default null,
  p_ocr_confidence numeric default null,p_image_path text default null,p_make_default_driver boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform private.lock_loading_actor();
  if p_request_id is null then return private.loading_failure('INVALID_REQUEST_ID'); end if;
  v_result:=private.loading_replay('create_loading_trip_v2',p_request_id);
  if v_result is not null then return v_result; end if;
  return private.loading_failure('ESTIMATED_TONNAGE_REQUIRED');
end;
$$;

create function public.create_loading_trip_v2(
  p_request_id uuid,p_plate text,p_driver_id uuid,p_expected_assignment_id uuid,
  p_capture_method text,p_captured_at timestamptz,p_estimated_quantity_tonnes numeric,
  p_ocr_detected_plate text default null,p_ocr_confidence numeric default null,
  p_image_path text default null,p_make_default_driver boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_plate text:=public.normalize_plate(p_plate); a jsonb; v_result jsonb; v_error text; v_constraint text;
  t public.trucks%rowtype; d public.drivers%rowtype; r public.daily_registrations%rowtype; v public.trips%rowtype;
  v_day date:=(statement_timestamp() at time zone 'Africa/Lagos')::date; v_changed boolean;
begin
  perform private.lock_loading_actor();
  if p_request_id is null then return private.loading_failure('INVALID_REQUEST_ID'); end if;
  v_result:=private.loading_replay('create_loading_trip_v2',p_request_id);
  if v_result is not null then
    if (v_result#>>'{trip,estimated_quantity_tonnes}')::numeric is distinct from p_estimated_quantity_tonnes then
      return private.loading_failure('REQUEST_PAYLOAD_CONFLICT');
    end if;
    return v_result;
  end if;
  if p_estimated_quantity_tonnes is null
    or p_estimated_quantity_tonnes::text in ('NaN','Infinity','-Infinity')
    or p_estimated_quantity_tonnes<=0 or p_estimated_quantity_tonnes>=100000000
    or p_estimated_quantity_tonnes<>round(p_estimated_quantity_tonnes,2) then
    return private.loading_failure('INVALID_ESTIMATED_TONNAGE');
  end if;
  if p_plate is null or length(p_plate)>64 or v_plate !~ '^[A-Z0-9]{1,32}$' then return private.loading_failure('INVALID_PLATE'); end if;
  if p_driver_id is null then return private.loading_failure('DRIVER_REQUIRED'); end if;
  if p_make_default_driver is null then return private.loading_failure('INVALID_DEFAULT_OPTION'); end if;
  if p_capture_method is null or p_capture_method not in ('OCR','OCR_CORRECTED','MANUAL') then return private.loading_failure('INVALID_CAPTURE_METHOD'); end if;
  if p_captured_at is null or not isfinite(p_captured_at) or p_captured_at>clock_timestamp()+interval '5 minutes' then return private.loading_failure('INVALID_CAPTURE_TIMESTAMP'); end if;
  if (p_capture_method='MANUAL' and (p_ocr_detected_plate is not null or p_ocr_confidence is not null))
    or (p_capture_method<>'MANUAL' and (p_ocr_detected_plate is null or length(p_ocr_detected_plate) not between 1 and 64 or p_image_path is null))
    or (p_ocr_confidence is not null and (p_ocr_confidence::text in ('NaN','Infinity','-Infinity') or p_ocr_confidence not between 0 and 1))
    or (p_capture_method='OCR' and public.normalize_plate(p_ocr_detected_plate)<>v_plate)
    or (p_capture_method='OCR_CORRECTED' and public.normalize_plate(p_ocr_detected_plate)=v_plate) then
    return private.loading_failure('INVALID_OCR_DATA');
  end if;
  a:=private.loading_assignment(p_expected_assignment_id,true);
  if not (a->>'ok')::boolean then return a; end if;
  select * into t from public.trucks where normalized_registration=v_plate for update;
  if not found then return private.loading_failure('UNKNOWN_TRUCK'); end if;
  if not t.is_active then return private.loading_failure('INACTIVE_TRUCK'); end if;
  v_result:=private.loading_truck_block(t.id);
  if v_result is not null then return v_result; end if;
  select * into d from public.drivers where id=p_driver_id for share;
  if not found then return private.loading_failure('DRIVER_NOT_FOUND'); end if;
  if not d.is_active then return private.loading_failure('INACTIVE_DRIVER'); end if;
  v_error:=private.loading_image_error(p_image_path);
  if v_error is not null then return private.loading_failure(v_error); end if;
  begin
    perform set_config('app.audit_reason','Loading trip opened',true);
    select * into r from public.daily_registrations where truck_id=t.id and operational_date=v_day;
    if not found then
      insert into public.daily_registrations(truck_id,initial_driver_id,operational_date,registered_by)
        values(t.id,d.id,v_day,auth.uid()) returning * into r;
    end if;
    insert into public.trips(truck_id,driver_id,daily_registration_id,loading_site_id,opened_by,
      driver_name_at_loading,loading_assignment_id,estimated_quantity_tonnes)
      values(t.id,d.id,r.id,(a->>'site_id')::uuid,auth.uid(),d.full_name,(a->>'assignment_id')::uuid,
        p_estimated_quantity_tonnes) returning * into v;
    insert into public.trip_loading_evidence(trip_id,confirmed_plate,ocr_detected_plate,ocr_confidence,capture_method,image_path,captured_at,captured_by)
      values(v.id,p_plate,p_ocr_detected_plate,p_ocr_confidence,p_capture_method,p_image_path,p_captured_at,auth.uid());
    v_changed:=p_make_default_driver and t.driver_id<>d.id;
    if v_changed then update public.trucks set driver_id=d.id where id=t.id; end if;
    insert into public.audit_log(entity_name,entity_id,action,new_value,reason,actor_id)
      values('loading_trip_opened',v.id,'INSERT',jsonb_build_object('request_id',p_request_id,'trip_id',v.id,'truck_id',t.id,
        'old_default_driver_id',t.driver_id,'actual_driver_id',d.id,'new_default_driver_id',case when v_changed then d.id else t.driver_id end,
        'different_driver_selected',t.driver_id<>d.id,'default_driver_changed',v_changed,'assignment_id',v.loading_assignment_id,
        'site_id',v.loading_site_id,'capture_method',p_capture_method,
        'estimated_quantity_tonnes',v.estimated_quantity_tonnes),'Loading trip opened',auth.uid());
    v_result:=jsonb_build_object('ok',true,'request_id',p_request_id,
      'trip',jsonb_build_object('id',v.id,'trip_number',v.trip_number,'status',v.status,'truck_id',v.truck_id,'driver_id',v.driver_id,
        'driver_name_at_loading',v.driver_name_at_loading,'daily_registration_id',v.daily_registration_id,'loading_site_id',v.loading_site_id,
        'loading_assignment_id',v.loading_assignment_id,'opened_at',v.opened_at,'opened_by',v.opened_by,'quantity_tonnes',null,
        'estimated_quantity_tonnes',v.estimated_quantity_tonnes),
      'capture',jsonb_build_object('confirmed_plate',p_plate,'normalized_confirmed_plate',v_plate,'capture_method',p_capture_method,'image_recorded',p_image_path is not null),
      'default_driver_changed',v_changed);
    insert into private.loading_request_receipts(actor_id,operation,request_id,response)
      values(auth.uid(),'create_loading_trip_v2',p_request_id,v_result);
    return v_result;
  exception when unique_violation then
    get stacked diagnostics v_constraint=constraint_name;
    if v_constraint='one_open_trip_per_truck' then return private.loading_truck_block(t.id); end if;
    if v_constraint='trip_loading_evidence_image_path_key' then return private.loading_failure('IMAGE_ALREADY_USED'); end if;
    raise;
  end;
end;
$$;

create or replace function public.lookup_offloading_open_trip(p_plate text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_plate text:=public.normalize_plate(p_plate); a jsonb; v jsonb;
begin
  perform private.require_role(array['offloading_officer']::public.app_role[]);
  if p_plate is null or length(p_plate)>64 or v_plate !~ '^[A-Z0-9]{1,32}$' then
    return private.offloading_failure('INVALID_PLATE');
  end if;
  a:=private.offloading_assignment_readonly();
  if not (a->>'ok')::boolean then return a; end if;
  select jsonb_build_object('id',r.id,'trip_number',r.trip_number,'truck_id',r.truck_id,
    'registration_number',t.registration_number,'normalized_registration',t.normalized_registration,
    'driver_id',r.driver_id,'driver_name',coalesce(r.driver_name_at_loading,d.full_name),
    'opened_at',r.opened_at,'loading_site_name',s.name,
    'estimated_quantity_tonnes',r.estimated_quantity_tonnes)
  into v from public.trucks t join public.trips r on r.truck_id=t.id and r.status='open'
    join public.drivers d on d.id=r.driver_id join public.sites s on s.id=r.loading_site_id
    where t.normalized_registration=v_plate;
  if v is null then return private.offloading_failure('NO_OPEN_TRIP'); end if;
  return jsonb_build_object('ok',true,'assignment',a,'trip',v);
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

create or replace function private.operations_report_trips(p_filters jsonb,p_limit integer,p_offset bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_from timestamptz; v_until timestamptz; v_basis text:=p_filters->>'basis'; v_total bigint; v_summary jsonb; v_items jsonb;
begin
  if p_filters ? 'date_from' then v_from:=(p_filters->>'date_from')::date::timestamp at time zone 'Africa/Lagos'; end if;
  if p_filters ? 'date_to' then v_until:=((p_filters->>'date_to')::date+1)::timestamp at time zone 'Africa/Lagos'; end if;
  with filtered as materialized (
    select t.id,t.trip_number,t.status::text status,t.truck_id,t.driver_id,
      coalesce(i.truck_registration,t.truck_registration_at_loading,truck.registration_number) truck_plate,
      t.driver_name_at_loading driver_name,t.loading_site_id,coalesce(i.loading_site_name,loading.name) loading_site,
      t.offloading_site_id,coalesce(i.offloading_site_name,offloading.name) offloading_site,
      t.opened_at,t.closed_at,t.cancelled_at,t.estimated_quantity_tonnes,t.quantity_tonnes,
      case v_basis when 'opened' then t.opened_at when 'closed' then t.closed_at
        when 'cancelled' then t.cancelled_at else t.opened_at end event_at
    from public.trips t join public.trucks truck on truck.id=t.truck_id
    left join public.sites loading on loading.id=t.loading_site_id
    left join public.sites offloading on offloading.id=t.offloading_site_id
    left join public.trip_closure_invoices i on i.trip_id=t.id
    where (p_filters->>'status' is null or t.status::text=p_filters->>'status')
      and (p_filters->>'truck_id' is null or t.truck_id=(p_filters->>'truck_id')::uuid)
      and (p_filters->>'driver_id' is null or t.driver_id=(p_filters->>'driver_id')::uuid)
      and (p_filters->>'loading_site_id' is null or t.loading_site_id=(p_filters->>'loading_site_id')::uuid)
      and (p_filters->>'offloading_site_id' is null or t.offloading_site_id=(p_filters->>'offloading_site_id')::uuid)
      and (v_basis<>'closed' or t.status='closed') and (v_basis<>'cancelled' or t.status='cancelled')
      and (v_basis<>'open' or t.status='open')
      and (v_from is null or (case v_basis when 'closed' then t.closed_at when 'cancelled' then t.cancelled_at else t.opened_at end)>=v_from)
      and (v_until is null or (case v_basis when 'closed' then t.closed_at when 'cancelled' then t.cancelled_at else t.opened_at end)<v_until)
  ), page_rows as (select * from filtered order by event_at desc,id desc limit p_limit offset p_offset)
  select count(*),jsonb_build_object('rows',count(*),'trips_opened',count(*) filter(where v_basis='opened'),
      'trips_closed',count(*) filter(where status='closed'),'trips_cancelled',count(*) filter(where status='cancelled'),
      'open_trips',count(*) filter(where status='open'),'tonnage_tonnes',coalesce(sum(quantity_tonnes) filter(where status='closed'),0)),
    coalesce((select jsonb_agg(jsonb_build_object('trip_id',id,'trip_number',trip_number,'truck_id',truck_id,
      'truck_plate',truck_plate,'driver_id',driver_id,'driver_name',driver_name,'loading_site_id',loading_site_id,
      'loading_site',loading_site,'offloading_site_id',offloading_site_id,'offloading_site',offloading_site,
      'opened_at',opened_at,'closed_at',closed_at,'cancelled_at',cancelled_at,
      'estimated_tonnage_tonnes',estimated_quantity_tonnes,'tonnage_tonnes',quantity_tonnes,'status',status)
      order by event_at desc,id desc) from page_rows),'[]'::jsonb)
    into v_total,v_summary,v_items from filtered;
  return jsonb_build_object('summary',v_summary,'items',v_items,'total_count',v_total);
end;
$$;

revoke all on function public.create_loading_trip_v2(uuid,text,uuid,uuid,text,timestamptz,text,numeric,text,boolean)
  from public,anon,authenticated,service_role;
revoke all on function public.create_loading_trip_v2(uuid,text,uuid,uuid,text,timestamptz,numeric,text,numeric,text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.create_loading_trip_v2(uuid,text,uuid,uuid,text,timestamptz,text,numeric,text,boolean)
  to authenticated;
grant execute on function public.create_loading_trip_v2(uuid,text,uuid,uuid,text,timestamptz,numeric,text,numeric,text,boolean)
  to authenticated;

commit;
