begin;

create function private.validate_operations_report_filters(p_kind text,p_filters jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare
  v_filters jsonb:=coalesce(p_filters,'{}'::jsonb);
  v_allowed text[];
  v_today date:=(statement_timestamp() at time zone 'Africa/Lagos')::date;
  v_from date;
  v_to date;
  v_basis text;
  v_dimension text;
  v_direction text;
  v_status text;
  v_value text;
begin
  if jsonb_typeof(v_filters)<>'object' then raise exception 'Invalid report filters' using errcode='22023'; end if;
  v_allowed:=case p_kind
    when 'trips' then array['basis','date_from','date_to','status','truck_id','driver_id','loading_site_id','offloading_site_id']
    when 'performance' then array['dimension','direction','date_from','date_to','truck_id','driver_id','site_id']
    when 'waybills' then array['date_from','date_to','pdf_status','delivery_status','payout_status']
    when 'exceptions' then array['date_from','date_to','exception_type','status','blocks_operations']
    else null end;
  if v_allowed is null or exists(select 1 from jsonb_object_keys(v_filters) key where not key=any(v_allowed)) then
    raise exception 'Invalid report filters' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_each(v_filters) item where jsonb_typeof(item.value) not in ('string','boolean')) then
    raise exception 'Invalid report filter value' using errcode='22023';
  end if;
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
    v_dimension:=v_filters->>'dimension';
    v_direction:=v_filters->>'direction';
    if v_dimension is null or v_dimension not in ('truck','driver','site') then raise exception 'Invalid performance dimension' using errcode='22023'; end if;
    if v_dimension='site' and (v_direction is null or v_direction not in ('loading','offloading'))
      or v_dimension<>'site' and v_direction is not null then
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
    raise exception 'Reporting period must be at most 90 inclusive days' using errcode='22023';
  end if;
  foreach v_value in array array['truck_id','driver_id','loading_site_id','offloading_site_id','site_id'] loop
    if v_filters ? v_value then
      begin perform (v_filters->>v_value)::uuid;
      exception when others then raise exception 'Invalid report filter identifier' using errcode='22023'; end;
    end if;
  end loop;
  if p_kind='waybills' then
    foreach v_status in array array['pdf_status','delivery_status','payout_status'] loop
      if v_filters ? v_status then
        v_value:=v_filters->>v_status;
        if (v_status='pdf_status' and v_value not in ('pending','processing','ready','failed'))
          or (v_status='delivery_status' and v_value not in ('pending','processing','sent','failed','not_queued','not_applicable'))
          or (v_status='payout_status' and v_value not in ('payment_details_required','pending','paid')) then
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

create function private.operations_report_trips(p_filters jsonb,p_limit integer,p_offset bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_from timestamptz; v_until timestamptz; v_basis text:=p_filters->>'basis'; v_total bigint; v_summary jsonb; v_items jsonb;
begin
  if p_filters ? 'date_from' then v_from:=(p_filters->>'date_from')::date::timestamp at time zone 'Africa/Lagos'; end if;
  if p_filters ? 'date_to' then v_until:=((p_filters->>'date_to')::date+1)::timestamp at time zone 'Africa/Lagos'; end if;
  with filtered as materialized (
    select t.id,t.trip_number,t.status::text status,t.truck_id,t.driver_id,
      coalesce(i.truck_registration,t.truck_registration_at_loading,truck.registration_number) truck_plate,
      t.driver_name_at_loading driver_name,t.loading_site_id,
      coalesce(i.loading_site_name,loading.name) loading_site,
      t.offloading_site_id,coalesce(i.offloading_site_name,offloading.name) offloading_site,
      t.opened_at,t.closed_at,t.cancelled_at,t.quantity_tonnes,
      case v_basis when 'opened' then t.opened_at when 'closed' then t.closed_at
        when 'cancelled' then t.cancelled_at else t.opened_at end event_at
    from public.trips t
    join public.trucks truck on truck.id=t.truck_id
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
  select count(*),
    jsonb_build_object('rows',count(*),'trips_opened',count(*) filter(where v_basis='opened'),
      'trips_closed',count(*) filter(where status='closed'),'trips_cancelled',count(*) filter(where status='cancelled'),
      'open_trips',count(*) filter(where status='open'),'tonnage_tonnes',coalesce(sum(quantity_tonnes) filter(where status='closed'),0)),
    coalesce((select jsonb_agg(jsonb_build_object('trip_id',id,'trip_number',trip_number,'truck_id',truck_id,
      'truck_plate',truck_plate,'driver_id',driver_id,'driver_name',driver_name,'loading_site_id',loading_site_id,
      'loading_site',loading_site,'offloading_site_id',offloading_site_id,'offloading_site',offloading_site,
      'opened_at',opened_at,'closed_at',closed_at,'cancelled_at',cancelled_at,'tonnage_tonnes',quantity_tonnes,
      'status',status) order by event_at desc,id desc) from page_rows),'[]'::jsonb)
    into v_total,v_summary,v_items from filtered;
  return jsonb_build_object('summary',v_summary,'items',v_items,'total_count',v_total);
end;
$$;

create function private.operations_report_performance(p_filters jsonb,p_limit integer,p_offset bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_from timestamptz; v_until timestamptz; v_dimension text:=p_filters->>'dimension';
  v_direction text:=p_filters->>'direction'; v_total bigint; v_summary jsonb; v_items jsonb;
begin
  v_from:=(p_filters->>'date_from')::date::timestamp at time zone 'Africa/Lagos';
  v_until:=((p_filters->>'date_to')::date+1)::timestamp at time zone 'Africa/Lagos';
  if v_dimension='site' and v_direction='offloading' then
    with filtered as materialized (select t.* from public.trips t where t.status='closed'
      and t.closed_at>=v_from and t.closed_at<v_until
      and (p_filters->>'site_id' is null or t.offloading_site_id=(p_filters->>'site_id')::uuid)),
    grouped as (select t.offloading_site_id entity_id,s.name label,count(*) trip_count,count(*) closed_count,
      coalesce(sum(t.quantity_tonnes),0) tonnage_tonnes from filtered t join public.sites s on s.id=t.offloading_site_id
      group by t.offloading_site_id,s.name), page_rows as (select * from grouped order by trip_count desc,entity_id limit p_limit offset p_offset)
    select count(*),jsonb_build_object('entities',count(*),'trip_count',coalesce(sum(trip_count),0),
      'closed_count',coalesce(sum(closed_count),0),'tonnage_tonnes',coalesce(sum(tonnage_tonnes),0)),
      coalesce((select jsonb_agg(jsonb_build_object('entity_id',entity_id,'label',label,'trip_count',trip_count,
        'closed_count',closed_count,'tonnage_tonnes',tonnage_tonnes) order by trip_count desc,entity_id) from page_rows),'[]'::jsonb)
      into v_total,v_summary,v_items from grouped;
  elsif v_dimension='site' then
    with filtered as materialized (select t.* from public.trips t where t.opened_at>=v_from and t.opened_at<v_until
      and (p_filters->>'site_id' is null or t.loading_site_id=(p_filters->>'site_id')::uuid)),
    grouped as (select t.loading_site_id entity_id,s.name label,count(*) trip_count,
      count(*) filter(where t.status='closed') closed_count,coalesce(sum(t.quantity_tonnes) filter(where t.status='closed'),0) tonnage_tonnes
      from filtered t join public.sites s on s.id=t.loading_site_id group by t.loading_site_id,s.name),
    page_rows as (select * from grouped order by trip_count desc,entity_id limit p_limit offset p_offset)
    select count(*),jsonb_build_object('entities',count(*),'trip_count',coalesce(sum(trip_count),0),
      'closed_count',coalesce(sum(closed_count),0),'tonnage_tonnes',coalesce(sum(tonnage_tonnes),0)),
      coalesce((select jsonb_agg(jsonb_build_object('entity_id',entity_id,'label',label,'trip_count',trip_count,
        'closed_count',closed_count,'tonnage_tonnes',tonnage_tonnes) order by trip_count desc,entity_id) from page_rows),'[]'::jsonb)
      into v_total,v_summary,v_items from grouped;
  elsif v_dimension='truck' then
    with filtered as materialized (select t.* from public.trips t where t.opened_at>=v_from and t.opened_at<v_until
      and (p_filters->>'truck_id' is null or t.truck_id=(p_filters->>'truck_id')::uuid)
      and (p_filters->>'driver_id' is null or t.driver_id=(p_filters->>'driver_id')::uuid)),
    grouped as (select t.truck_id entity_id,max(tr.registration_number) label,count(*) trip_count,
      count(*) filter(where t.status='closed') closed_count,coalesce(sum(t.quantity_tonnes) filter(where t.status='closed'),0) tonnage_tonnes
      from filtered t join public.trucks tr on tr.id=t.truck_id group by t.truck_id),
    page_rows as (select * from grouped order by trip_count desc,entity_id limit p_limit offset p_offset)
    select count(*),jsonb_build_object('entities',count(*),'trip_count',coalesce(sum(trip_count),0),
      'closed_count',coalesce(sum(closed_count),0),'tonnage_tonnes',coalesce(sum(tonnage_tonnes),0)),
      coalesce((select jsonb_agg(jsonb_build_object('entity_id',entity_id,'label',label,'trip_count',trip_count,
        'closed_count',closed_count,'tonnage_tonnes',tonnage_tonnes) order by trip_count desc,entity_id) from page_rows),'[]'::jsonb)
      into v_total,v_summary,v_items from grouped;
  else
    with filtered as materialized (select t.* from public.trips t where t.opened_at>=v_from and t.opened_at<v_until
      and (p_filters->>'driver_id' is null or t.driver_id=(p_filters->>'driver_id')::uuid)
      and (p_filters->>'truck_id' is null or t.truck_id=(p_filters->>'truck_id')::uuid)),
    grouped as (select t.driver_id entity_id,max(d.full_name) label,count(*) trip_count,
      count(*) filter(where t.status='closed') closed_count,coalesce(sum(t.quantity_tonnes) filter(where t.status='closed'),0) tonnage_tonnes
      from filtered t join public.drivers d on d.id=t.driver_id group by t.driver_id),
    page_rows as (select * from grouped order by trip_count desc,entity_id limit p_limit offset p_offset)
    select count(*),jsonb_build_object('entities',count(*),'trip_count',coalesce(sum(trip_count),0),
      'closed_count',coalesce(sum(closed_count),0),'tonnage_tonnes',coalesce(sum(tonnage_tonnes),0)),
      coalesce((select jsonb_agg(jsonb_build_object('entity_id',entity_id,'label',label,'trip_count',trip_count,
        'closed_count',closed_count,'tonnage_tonnes',tonnage_tonnes) order by trip_count desc,entity_id) from page_rows),'[]'::jsonb)
      into v_total,v_summary,v_items from grouped;
  end if;
  return jsonb_build_object('summary',v_summary,'items',v_items,'total_count',v_total);
end;
$$;

create function private.operations_report_waybills(p_filters jsonb,p_limit integer,p_offset bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_from timestamptz; v_until timestamptz; v_total bigint; v_summary jsonb; v_items jsonb;
begin
  v_from:=(p_filters->>'date_from')::date::timestamp at time zone 'Africa/Lagos';
  v_until:=((p_filters->>'date_to')::date+1)::timestamp at time zone 'Africa/Lagos';
  with filtered as materialized (
    select i.id,i.invoice_number,i.trip_number,i.truck_registration,i.driver_name,i.quantity_tonnes,i.issued_at,
      doc.status pdf_status,p.status::text payout_status,
      case when i.driver_email is null then 'not_applicable' else coalesce(driver_delivery.status,'not_queued') end driver_delivery_status,
      coalesce(internal_delivery.status,'not_queued') internal_delivery_status,
      case when driver_delivery.status='failed' or internal_delivery.status='failed' then 'failed'
        when driver_delivery.status='processing' or internal_delivery.status='processing' then 'processing'
        when driver_delivery.status='pending' or internal_delivery.status='pending' then 'pending'
        when driver_delivery.status='sent' or internal_delivery.status='sent' then 'sent'
        else 'not_queued' end latest_delivery_status
    from public.trip_closure_invoices i
    left join public.trip_closure_invoice_documents doc on doc.invoice_id=i.id and doc.trip_id=i.trip_id
    left join public.trip_payments p on p.trip_id=i.trip_id
    left join lateral (select status from public.notification_outbox n where n.trip_id=i.trip_id and n.event_type='waybill_ready' and n.audience='driver'
      order by delivery_sequence desc limit 1) driver_delivery on true
    left join lateral (select status from public.notification_outbox n where n.trip_id=i.trip_id and n.event_type='waybill_ready' and n.audience='finance'
      order by delivery_sequence desc limit 1) internal_delivery on true
    where i.issued_at>=v_from and i.issued_at<v_until
      and (p_filters->>'pdf_status' is null or doc.status=p_filters->>'pdf_status')
      and (p_filters->>'payout_status' is null or p.status::text=p_filters->>'payout_status')
      and (p_filters->>'delivery_status' is null or p_filters->>'delivery_status' in
        (case when i.driver_email is null then 'not_applicable' else coalesce(driver_delivery.status,'not_queued') end,
          coalesce(internal_delivery.status,'not_queued')))
  ), page_rows as (select * from filtered order by issued_at desc,id desc limit p_limit offset p_offset)
  select count(*),jsonb_build_object('waybills',count(*),
    'pdf_failed',count(*) filter(where pdf_status='failed'),'delivery_failed',count(*) filter(where latest_delivery_status='failed'),
    'payment_details_required',count(*) filter(where payout_status='payment_details_required'),
    'pending_payout',count(*) filter(where payout_status='pending'),'paid',count(*) filter(where payout_status='paid')),
    coalesce((select jsonb_agg(jsonb_build_object('invoice_id',id,'invoice_number',invoice_number,'trip_number',trip_number,
    'truck_plate',truck_registration,'driver_name',driver_name,'tonnage_tonnes',quantity_tonnes,'issued_at',issued_at,
    'pdf_status',pdf_status,'driver_delivery_status',driver_delivery_status,'internal_delivery_status',internal_delivery_status,
    'payout_status',payout_status) order by issued_at desc,id desc) from page_rows),'[]'::jsonb)
    into v_total,v_summary,v_items from filtered;
  return jsonb_build_object('summary',v_summary,'items',v_items,'total_count',v_total);
end;
$$;

create function private.operations_report_exceptions(p_filters jsonb,p_limit integer,p_offset bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_from timestamptz; v_until timestamptz; v_total bigint; v_summary jsonb; v_items jsonb;
begin
  v_from:=(p_filters->>'date_from')::date::timestamp at time zone 'Africa/Lagos';
  v_until:=((p_filters->>'date_to')::date+1)::timestamp at time zone 'Africa/Lagos';
  with grouped as materialized (
    select exception_type::text exception_type,status::text status,blocks_operations,count(*)::bigint exception_count,
      min(created_at) first_raised_at,max(created_at) last_raised_at
    from public.exceptions where created_at>=v_from and created_at<v_until
      and (p_filters->>'exception_type' is null or exception_type::text=p_filters->>'exception_type')
      and (p_filters->>'status' is null or status::text=p_filters->>'status')
      and (not (p_filters ? 'blocks_operations') or blocks_operations=(p_filters->>'blocks_operations')::boolean)
    group by exception_type,status,blocks_operations
  ), page_rows as (select * from grouped order by exception_count desc,exception_type,status,blocks_operations limit p_limit offset p_offset)
  select count(*),jsonb_build_object('groups',count(*),'exceptions',coalesce(sum(exception_count),0),
    'requiring_attention',coalesce(sum(exception_count) filter(where status in ('open','in_review')),0),
    'blocking',coalesce(sum(exception_count) filter(where blocks_operations and status in ('open','in_review')),0)),
    coalesce((select jsonb_agg(jsonb_build_object('exception_type',exception_type,'status',status,
      'blocks_operations',blocks_operations,'count',exception_count,'first_raised_at',first_raised_at,
      'last_raised_at',last_raised_at) order by exception_count desc,exception_type,status,blocks_operations) from page_rows),'[]'::jsonb)
    into v_total,v_summary,v_items from grouped;
  return jsonb_build_object('summary',v_summary,'items',v_items,'total_count',v_total);
end;
$$;

create function private.operations_report_data(p_kind text,p_filters jsonb,p_limit integer,p_offset bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if p_kind='trips' then return private.operations_report_trips(p_filters,p_limit,p_offset); end if;
  if p_kind='performance' then return private.operations_report_performance(p_filters,p_limit,p_offset); end if;
  if p_kind='waybills' then return private.operations_report_waybills(p_filters,p_limit,p_offset); end if;
  if p_kind='exceptions' then return private.operations_report_exceptions(p_filters,p_limit,p_offset); end if;
  raise exception 'Invalid report kind' using errcode='22023';
end;
$$;

create function public.get_operations_report(p_kind text,p_filters jsonb default '{}'::jsonb,p_page integer default 1,p_page_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_filters jsonb; v_result jsonb; v_offset bigint;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_page is null or p_page<1 or p_page_size is null or p_page_size not between 1 and 100 then
    raise exception 'Invalid report page' using errcode='22023'; end if;
  v_filters:=private.validate_operations_report_filters(p_kind,p_filters);
  v_offset:=(p_page::bigint-1)*p_page_size;
  v_result:=private.operations_report_data(p_kind,v_filters,p_page_size,v_offset);
  return v_result||jsonb_build_object('page',p_page,'page_size',p_page_size,'has_next',v_offset+jsonb_array_length(v_result->'items')<(v_result->>'total_count')::bigint);
end;
$$;

create function public.export_operations_report(p_kind text,p_filters jsonb,p_format text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_filters jsonb; v_result jsonb; v_rows integer; v_export_id uuid:=gen_random_uuid(); v_created timestamptz:=clock_timestamp();
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_format not in ('csv','xlsx') then raise exception 'Invalid export format' using errcode='22023'; end if;
  v_filters:=private.validate_operations_report_filters(p_kind,p_filters);
  v_result:=private.operations_report_data(p_kind,v_filters,1001,0);
  if (v_result->>'total_count')::bigint>1000 then
    raise exception 'Export exceeds 1000 rows; narrow the report filters' using errcode='P0001',detail='EXPORT_LIMIT_EXCEEDED'; end if;
  v_rows:=jsonb_array_length(v_result->'items');
  insert into public.audit_log(entity_name,entity_id,action,new_value,actor_id,created_at)
  values('operations_report_export',v_export_id,'INSERT',jsonb_build_object('report_kind',p_kind,'format',p_format,
    'filters',v_filters,'row_count',v_rows,'generated_at',v_created),auth.uid(),v_created);
  return jsonb_build_object('export_id',v_export_id,'report_kind',p_kind,'format',p_format,
    'filters',v_filters,'summary',v_result->'summary','items',v_result->'items','row_count',v_rows,'generated_at',v_created);
end;
$$;

revoke all on function private.validate_operations_report_filters(text,jsonb),
  private.operations_report_trips(jsonb,integer,bigint),private.operations_report_performance(jsonb,integer,bigint),
  private.operations_report_waybills(jsonb,integer,bigint),private.operations_report_exceptions(jsonb,integer,bigint),
  private.operations_report_data(text,jsonb,integer,bigint) from public,anon,authenticated,service_role;
revoke all on function public.get_operations_report(text,jsonb,integer,integer),
  public.export_operations_report(text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.get_operations_report(text,jsonb,integer,integer),
  public.export_operations_report(text,jsonb,text) to authenticated;

commit;
