begin;

-- Keep the established Operations analytics calculations and authorization,
-- but remove the payout cohort from the browser-facing response. The old
-- aggregate is private and will be removed after both migration lanes pass
-- isolated parity verification.
alter function public.get_operations_analytics(jsonb,text,text) set schema private;
alter function private.get_operations_analytics(jsonb,text,text) rename to get_operations_analytics_payment_legacy;
revoke all on function private.get_operations_analytics_payment_legacy(jsonb,text,text)
  from public,anon,authenticated,service_role;

create function public.get_operations_analytics(
  p_filters jsonb default '{}'::jsonb,
  p_performance_dimension text default 'truck',
  p_performance_metric text default 'trips'
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb; v_distribution jsonb;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  v_result:=private.get_operations_analytics_payment_legacy(p_filters,p_performance_dimension,p_performance_metric);
  v_distribution:=v_result->'status_distributions';
  return v_result||jsonb_build_object('status_distributions',jsonb_build_object(
    'trip',v_distribution->'trip','exception',v_distribution->'exception'));
end;
$$;
revoke all on function public.get_operations_analytics(jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_operations_analytics(jsonb,text,text) to authenticated;

-- Payment filters are rejected and the report response contains only the
-- independent driver and parent-company delivery states.
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
    when 'waybills' then array['date_from','date_to','pdf_status','delivery_status']
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
    if v_basis='open' and not (v_filters ? 'date_from') and not (v_filters ? 'date_to') then v_from:=null; v_to:=null;
    else v_from:=coalesce((v_filters->>'date_from')::date,v_today-29); v_to:=coalesce((v_filters->>'date_to')::date,v_today); end if;
    v_filters:=v_filters||jsonb_build_object('basis',v_basis);
  elsif p_kind='performance' then
    v_dimension:=v_filters->>'dimension'; v_direction:=v_filters->>'direction';
    if v_dimension is null or v_dimension not in ('truck','driver','site') then raise exception 'Invalid performance dimension' using errcode='22023'; end if;
    if (v_dimension='site' and (v_direction is null or v_direction not in ('loading','offloading')))
      or (v_dimension<>'site' and v_direction is not null) then raise exception 'Invalid site activity direction' using errcode='22023'; end if;
    if (v_dimension in ('truck','driver') and (v_filters ? 'site_id' or v_filters ? 'direction'))
      or (v_dimension='site' and (v_filters ? 'truck_id' or v_filters ? 'driver_id')) then
      raise exception 'Incompatible performance filters' using errcode='22023'; end if;
    v_from:=coalesce((v_filters->>'date_from')::date,v_today-29); v_to:=coalesce((v_filters->>'date_to')::date,v_today);
  else v_from:=coalesce((v_filters->>'date_from')::date,v_today-29); v_to:=coalesce((v_filters->>'date_to')::date,v_today); end if;
  if v_from is not null and (not isfinite(v_from) or v_from>=date '10000-01-01')
    or v_to is not null and (not isfinite(v_to) or v_to>=date '10000-01-01')
    or (v_from is null)<>(v_to is null) or (v_from is not null and v_to is not null and (v_from>v_to or v_to-v_from>89)) then
    raise exception 'Reporting period must be at most 90 inclusive days' using errcode='22023'; end if;
  foreach v_value in array array['truck_id','driver_id','loading_site_id','offloading_site_id','site_id'] loop
    if v_filters ? v_value then begin perform (v_filters->>v_value)::uuid;
      exception when others then raise exception 'Invalid report filter identifier' using errcode='22023'; end; end if;
  end loop;
  if p_kind='waybills' then
    foreach v_status in array array['pdf_status','delivery_status'] loop
      if v_filters ? v_status then
        v_value:=v_filters->>v_status;
        if (v_status='pdf_status' and v_value not in ('pending','processing','ready','failed'))
          or (v_status='delivery_status' and v_value not in
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
    select i.id,i.invoice_number,i.trip_number,i.truck_registration,i.driver_name,i.quantity_tonnes,i.issued_at,
      doc.status pdf_status,driver_job.status driver_delivery_status,company_job.status company_delivery_status,
      case when driver_job.status='failed' or company_job.status='failed' then 'failed'
        when driver_job.status='blocked_missing_email' or company_job.status='blocked_configuration' then 'blocked'
        when driver_job.status='processing' or company_job.status='processing' then 'processing'
        when driver_job.status='pending' or company_job.status='pending' then 'pending'
        when driver_job.status='sent' or company_job.status='sent' then 'sent' else 'not_queued' end delivery_state
    from public.trip_closure_invoices i
    left join public.trip_closure_invoice_documents doc on doc.invoice_id=i.id and doc.trip_id=i.trip_id
    left join lateral (select n.status from public.notification_outbox n where n.trip_id=i.trip_id
      and n.event_type='waybill_ready' and n.audience='driver'
      order by case when n.status in ('pending','processing','blocked_missing_email') then 0 else 1 end,
        n.delivery_sequence desc,n.updated_at desc,n.created_at desc,n.id desc limit 1) driver_job on true
    left join lateral (select n.status from public.notification_outbox n where n.trip_id=i.trip_id
      and n.event_type='waybill_ready' and n.audience='client'
      order by case when n.status in ('pending','processing','blocked_configuration') then 0 else 1 end,
        n.delivery_sequence desc,n.updated_at desc,n.created_at desc,n.id desc limit 1) company_job on true
    where i.issued_at>=v_from and i.issued_at<v_until
      and (p_filters->>'pdf_status' is null or doc.status=p_filters->>'pdf_status')
      and (p_filters->>'delivery_status' is null or p_filters->>'delivery_status' in
        (coalesce(driver_job.status,'not_queued'),coalesce(company_job.status,'not_queued')))
  ), page_rows as (select * from filtered order by issued_at desc,id desc limit p_limit offset p_offset)
  select count(*),jsonb_build_object('waybills',count(*),'pdf_failed',count(*) filter(where pdf_status='failed'),
    'delivery_failed',count(*) filter(where delivery_state='failed'),
    'blocked_missing_email',count(*) filter(where driver_delivery_status='blocked_missing_email'),
    'blocked_configuration',count(*) filter(where company_delivery_status='blocked_configuration')),
    coalesce((select jsonb_agg(jsonb_build_object('invoice_id',id,'invoice_number',invoice_number,'trip_number',trip_number,
      'truck_plate',truck_registration,'driver_name',driver_name,'tonnage_tonnes',quantity_tonnes,'issued_at',issued_at,
      'pdf_status',pdf_status,'driver_delivery_status',driver_delivery_status,
      'company_delivery_status',company_delivery_status) order by issued_at desc,id desc) from page_rows),'[]'::jsonb)
  into v_total,v_summary,v_items from filtered;
  return jsonb_build_object('summary',v_summary,'items',v_items,'total_count',v_total);
end;
$$;

commit;
