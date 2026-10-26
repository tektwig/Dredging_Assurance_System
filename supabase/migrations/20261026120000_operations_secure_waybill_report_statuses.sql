begin;

do $migration$
begin
  if to_regclass('public.trip_closure_invoices') is null
    or to_regclass('public.trip_closure_invoice_pdf_copies') is null
    or to_regclass('public.notification_outbox') is null
    or to_regprocedure('private.validate_operations_report_filters(text,jsonb)') is null
    or to_regprocedure('private.operations_report_waybills(jsonb,integer,bigint)') is null
    or to_regprocedure('public.get_operations_report(text,jsonb,integer,integer)') is null
    or to_regprocedure('public.export_operations_report(text,jsonb,text)') is null then
    raise exception 'Operations report and secure Waybill schemas must be installed first';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='notification_outbox' and column_name='delivery_sequence'
  ) then
    raise exception 'Waybill delivery sequence is required for accurate Operations reporting';
  end if;
end;
$migration$;

create or replace function private.validate_operations_report_filters(p_kind text,p_filters jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_filters jsonb:=coalesce(p_filters,'{}'::jsonb);
  v_allowed text[];
  v_today date:=(statement_timestamp() at time zone 'Africa/Lagos')::date;
  v_from date; v_to date; v_basis text; v_dimension text; v_direction text; v_status text; v_value text;
begin
  if jsonb_typeof(v_filters)<>'object' then raise exception 'Invalid report filters' using errcode='22023'; end if;
  v_allowed:=case p_kind
    when 'trips' then array['basis','date_from','date_to','status','truck_id','driver_id','loading_site_id','offloading_site_id']
    when 'performance' then array['dimension','direction','date_from','date_to','truck_id','driver_id','site_id']
    when 'waybills' then array['date_from','date_to','driver_pdf_status','company_pdf_status',
      'driver_delivery_status','company_delivery_status']
    when 'exceptions' then array['date_from','date_to','exception_type','status','blocks_operations'] else null end;
  if v_allowed is null or exists(select 1 from jsonb_object_keys(v_filters) key where not key=any(v_allowed)) then
    raise exception 'Invalid report filters' using errcode='22023'; end if;
  if exists(select 1 from jsonb_each(v_filters) item where jsonb_typeof(item.value) not in ('string','boolean')) then
    raise exception 'Invalid report filter value' using errcode='22023'; end if;
  if p_kind='trips' then
    v_basis:=coalesce(v_filters->>'basis','opened');
    if v_basis not in ('opened','closed','cancelled','open') then raise exception 'Invalid trip report basis' using errcode='22023'; end if;
    if v_filters ? 'status' and coalesce(v_filters->>'status','') not in ('open','closed','cancelled') then
      raise exception 'Invalid trip status' using errcode='22023'; end if;
    if v_basis='open' and not (v_filters ? 'date_from') and not (v_filters ? 'date_to') then
      v_from:=null; v_to:=null;
    else
      v_from:=coalesce((v_filters->>'date_from')::date,v_today-29);
      v_to:=coalesce((v_filters->>'date_to')::date,v_today);
    end if;
    v_filters:=v_filters||jsonb_build_object('basis',v_basis);
  elsif p_kind='performance' then
    v_dimension:=v_filters->>'dimension'; v_direction:=v_filters->>'direction';
    if v_dimension is null or v_dimension not in ('truck','driver','site') then
      raise exception 'Invalid performance dimension' using errcode='22023'; end if;
    if (v_dimension='site' and (v_direction is null or v_direction not in ('loading','offloading')))
      or (v_dimension<>'site' and v_direction is not null) then
      raise exception 'Invalid site activity direction' using errcode='22023'; end if;
    if (v_dimension in ('truck','driver') and (v_filters ? 'site_id' or v_filters ? 'direction'))
      or (v_dimension='site' and (v_filters ? 'truck_id' or v_filters ? 'driver_id')) then
      raise exception 'Incompatible performance filters' using errcode='22023'; end if;
    v_from:=coalesce((v_filters->>'date_from')::date,v_today-29);
    v_to:=coalesce((v_filters->>'date_to')::date,v_today);
  else
    v_from:=coalesce((v_filters->>'date_from')::date,v_today-29);
    v_to:=coalesce((v_filters->>'date_to')::date,v_today);
  end if;
  if v_from is not null and (not isfinite(v_from) or v_from>=date '10000-01-01')
    or v_to is not null and (not isfinite(v_to) or v_to>=date '10000-01-01')
    or (v_from is null)<>(v_to is null)
    or (v_from is not null and v_to is not null and (v_from>v_to or v_to-v_from>89)) then
    raise exception 'Reporting period must be at most 90 inclusive days' using errcode='22023'; end if;
  foreach v_value in array array['truck_id','driver_id','loading_site_id','offloading_site_id','site_id'] loop
    if v_filters ? v_value then
      begin perform (v_filters->>v_value)::uuid;
      exception when others then raise exception 'Invalid report filter identifier' using errcode='22023'; end;
    end if;
  end loop;
  if p_kind='waybills' then
    foreach v_status in array array['driver_pdf_status','company_pdf_status','driver_delivery_status','company_delivery_status'] loop
      if v_filters ? v_status then
        v_value:=v_filters->>v_status;
        if v_value is null
          or (v_status='driver_pdf_status' and v_value not in ('unavailable','pending','processing','ready','failed'))
          or (v_status='company_pdf_status' and v_value not in ('unavailable','pending','processing','ready','failed',
            'blocked_missing_bank_details','blocked_bank_details_unverified'))
          or (v_status in ('driver_delivery_status','company_delivery_status') and v_value not in
            ('pending','processing','sent','failed','blocked_missing_email','blocked_configuration','not_queued')) then
          raise exception 'Invalid Waybill report status' using errcode='22023'; end if;
      end if;
    end loop;
  elsif p_kind='exceptions' then
    if v_filters ? 'exception_type' and coalesce(v_filters->>'exception_type','') not in
      ('unknown_truck','invalid_driver','open_trip_conflict','offloading_mismatch','invalid_state','dispute') then
      raise exception 'Invalid exception type' using errcode='22023'; end if;
    if v_filters ? 'status' and coalesce(v_filters->>'status','') not in ('open','in_review','resolved') then
      raise exception 'Invalid exception status' using errcode='22023'; end if;
  end if;
  if v_from is not null then v_filters:=v_filters||jsonb_build_object('date_from',v_from); else v_filters:=v_filters-'date_from'; end if;
  if v_to is not null then v_filters:=v_filters||jsonb_build_object('date_to',v_to); else v_filters:=v_filters-'date_to'; end if;
  return v_filters;
end;
$$;

create or replace function private.operations_report_waybills(p_filters jsonb,p_limit integer,p_offset bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz; v_until timestamptz; v_total bigint; v_summary jsonb; v_items jsonb;
begin
  v_from:=(p_filters->>'date_from')::date::timestamp at time zone 'Africa/Lagos';
  v_until:=((p_filters->>'date_to')::date+1)::timestamp at time zone 'Africa/Lagos';
  with filtered as materialized (
    select invoice.id,invoice.invoice_number,invoice.trip_number,invoice.truck_registration,invoice.driver_name,
      invoice.quantity_tonnes,invoice.issued_at,
      coalesce(driver_copy.status,'unavailable') driver_pdf_status,
      coalesce(company_copy.status,'unavailable') company_pdf_status,
      coalesce(driver_job.status,'not_queued') driver_delivery_status,
      coalesce(company_job.status,'not_queued') company_delivery_status
    from public.trip_closure_invoices invoice
    left join lateral (
      select copy.status from public.trip_closure_invoice_pdf_copies copy
      where copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id and copy.invoice_number=invoice.invoice_number
        and copy.copy_kind='driver'
      order by copy.copy_version desc,copy.created_at desc,copy.id desc limit 1
    ) driver_copy on true
    left join lateral (
      select copy.status from public.trip_closure_invoice_pdf_copies copy
      where copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id and copy.invoice_number=invoice.invoice_number
        and copy.copy_kind='company'
      order by copy.copy_version desc,copy.created_at desc,copy.id desc limit 1
    ) company_copy on true
    left join lateral (
      select notification.status from public.notification_outbox notification
      where notification.trip_id=invoice.trip_id and notification.event_type='waybill_ready'
        and notification.audience='driver'
        and notification.payload->>'invoice_id'=invoice.id::text
        and notification.payload->>'invoice_number'=invoice.invoice_number
      order by notification.delivery_sequence desc,notification.updated_at desc,
        notification.created_at desc,notification.id desc limit 1
    ) driver_job on true
    left join lateral (
      select notification.status from public.notification_outbox notification
      where notification.trip_id=invoice.trip_id and notification.event_type='waybill_ready'
        and notification.audience='client'
        and notification.payload->>'invoice_id'=invoice.id::text
        and notification.payload->>'invoice_number'=invoice.invoice_number
      order by notification.delivery_sequence desc,notification.updated_at desc,
        notification.created_at desc,notification.id desc limit 1
    ) company_job on true
    where invoice.issued_at>=v_from and invoice.issued_at<v_until
      and (p_filters->>'driver_pdf_status' is null or coalesce(driver_copy.status,'unavailable')=p_filters->>'driver_pdf_status')
      and (p_filters->>'company_pdf_status' is null or coalesce(company_copy.status,'unavailable')=p_filters->>'company_pdf_status')
      and (p_filters->>'driver_delivery_status' is null or coalesce(driver_job.status,'not_queued')=p_filters->>'driver_delivery_status')
      and (p_filters->>'company_delivery_status' is null or coalesce(company_job.status,'not_queued')=p_filters->>'company_delivery_status')
  ), page_rows as (
    select * from filtered order by issued_at desc,id desc limit p_limit offset p_offset
  )
  select count(*),jsonb_build_object(
    'waybills',count(*),
    'driver_pdf_failed',count(*) filter(where driver_pdf_status='failed'),
    'company_pdf_failed',count(*) filter(where company_pdf_status='failed'),
    'company_pdf_blocked_missing_bank_details',count(*) filter(where company_pdf_status='blocked_missing_bank_details'),
    'company_pdf_blocked_bank_details_unverified',count(*) filter(where company_pdf_status='blocked_bank_details_unverified'),
    'driver_delivery_failed',count(*) filter(where driver_delivery_status='failed'),
    'company_delivery_failed',count(*) filter(where company_delivery_status='failed'),
    'blocked_missing_email',count(*) filter(where driver_delivery_status='blocked_missing_email'),
    'blocked_configuration',count(*) filter(where company_delivery_status='blocked_configuration')),
    coalesce((select jsonb_agg(jsonb_build_object(
      'invoice_id',id,'invoice_number',invoice_number,'trip_number',trip_number,'truck_plate',truck_registration,
      'driver_name',driver_name,'tonnage_tonnes',quantity_tonnes,'issued_at',issued_at,
      'driver_pdf_status',driver_pdf_status,'company_pdf_status',company_pdf_status,
      'driver_delivery_status',driver_delivery_status,'company_delivery_status',company_delivery_status
    ) order by issued_at desc,id desc) from page_rows),'[]'::jsonb)
  into v_total,v_summary,v_items from filtered;
  return jsonb_build_object('summary',v_summary,'items',v_items,'total_count',v_total);
end;
$$;

revoke all on function private.validate_operations_report_filters(text,jsonb),
  private.operations_report_waybills(jsonb,integer,bigint) from public,anon,authenticated,service_role;

commit;
