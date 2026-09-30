begin;

alter table public.notification_outbox
  drop constraint notification_outbox_trip_event_audience_key;
alter table public.notification_outbox
  add column delivery_sequence integer not null default 0,
  add column resend_request_id uuid,
  add column requested_by uuid references public.profiles(id) on delete restrict,
  add column requested_reason_code text,
  add column duplicate_risk_confirmed boolean not null default false,
  add constraint notification_delivery_sequence_check check (delivery_sequence >= 0),
  add constraint notification_resend_metadata_check check (
    (delivery_sequence = 0 and resend_request_id is null and requested_by is null
      and requested_reason_code is null and not duplicate_risk_confirmed)
    or (delivery_sequence > 0 and event_type = 'waybill_ready' and resend_request_id is not null
      and requested_by is not null and requested_reason_code is not null)
  ),
  add constraint notification_outbox_delivery_key unique (trip_id,event_type,audience,delivery_sequence),
  add constraint notification_outbox_resend_request_key unique (resend_request_id);

create or replace function public.enqueue_waybill_ready_notifications(p_internal_recipients text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_recipients text[]; v_inserted integer := 0; v_count integer;
begin
  if p_internal_recipients is null or cardinality(p_internal_recipients) > 50
    or exists (select 1 from unnest(p_internal_recipients) as r(address)
      where address is null or length(btrim(address)) > 254
        or btrim(address) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'Valid internal recipients required' using errcode='22023';
  end if;
  select coalesce(array_agg(address order by first_position),array[]::text[]) into v_recipients
  from (select btrim(recipient) as address,min(position) as first_position
    from unnest(p_internal_recipients) with ordinality as r(recipient,position)
    group by btrim(recipient)) as normalized;
  insert into public.notification_outbox(trip_id,event_type,audience,recipients,payload)
  select invoice.trip_id,'waybill_ready','driver',array[invoice.driver_email],
    jsonb_build_object('invoice_id',invoice.id,'invoice_number',invoice.invoice_number,
      'trip_number',invoice.trip_number,'storage_path',document.storage_path)
  from public.trip_closure_invoice_documents document
  join public.trip_closure_invoices invoice on invoice.id=document.invoice_id and invoice.trip_id=document.trip_id
  where document.status='ready' and document.ready_at is not null
    and document.invoice_number=invoice.invoice_number
    and document.storage_path=substring(invoice.invoice_number from 5 for 4) || '/' || invoice.invoice_number || '.pdf'
    and invoice.driver_email is not null
  on conflict (trip_id,event_type,audience,delivery_sequence) do nothing;
  get diagnostics v_count=row_count; v_inserted:=v_inserted+v_count;
  if cardinality(v_recipients)>0 then
    insert into public.notification_outbox(trip_id,event_type,audience,recipients,payload)
    select invoice.trip_id,'waybill_ready','finance',v_recipients,
      jsonb_build_object('invoice_id',invoice.id,'invoice_number',invoice.invoice_number,
        'trip_number',invoice.trip_number,'storage_path',document.storage_path)
    from public.trip_closure_invoice_documents document
    join public.trip_closure_invoices invoice on invoice.id=document.invoice_id and invoice.trip_id=document.trip_id
    where document.status='ready' and document.ready_at is not null
      and document.invoice_number=invoice.invoice_number
      and document.storage_path=substring(invoice.invoice_number from 5 for 4) || '/' || invoice.invoice_number || '.pdf'
    on conflict (trip_id,event_type,audience,delivery_sequence) do nothing;
    get diagnostics v_count=row_count; v_inserted:=v_inserted+v_count;
  end if;
  return v_inserted;
end;
$$;

drop function public.claim_trip_notifications(text[],text,integer,boolean);
create function public.claim_trip_notifications(
  p_finance_recipients text[],p_sender text,p_limit integer,
  p_include_waybill_ready boolean,p_waybill_internal_recipients text[]
) returns setof public.notification_outbox
language plpgsql security definer set search_path = '' as $$
declare v_job public.notification_outbox%rowtype; v_recipients text[];
begin
  if p_sender is null or length(btrim(p_sender))=0 or p_sender ~ E'[\r\n]' then
    raise exception 'Sender configuration required' using errcode='22023'; end if;
  if p_finance_recipients is null or cardinality(p_finance_recipients) not between 1 and 50
    or exists (select 1 from unnest(p_finance_recipients) r
      where r is null or length(r)>254 or r !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'Valid finance recipients required' using errcode='22023'; end if;
  if p_waybill_internal_recipients is not null and (cardinality(p_waybill_internal_recipients)>50
    or exists (select 1 from unnest(p_waybill_internal_recipients) r
      where r is null or length(r)>254 or r !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')) then
    raise exception 'Invalid Waybill recipients' using errcode='22023'; end if;
  if p_limit is null or p_limit not between 1 and 10 then
    raise exception 'Batch size must be 1..10' using errcode='22023'; end if;
  update public.notification_outbox set status='failed',lease_token=null,lease_until=null,
    last_error='Retry limit or idempotency window reached; reconcile provider delivery before manual retry'
  where (event_type='trip_closed' or p_include_waybill_ready)
    and status in ('pending','processing') and (status='pending' or lease_until<clock_timestamp())
    and (attempts>=8 or first_attempt_at<clock_timestamp()-interval '23 hours');
  for v_job in select * from public.notification_outbox
    where (event_type='trip_closed' or p_include_waybill_ready)
      and (event_type<>'waybill_ready' or audience<>'finance' or delivery_sequence=0
        or recipients is not null or cardinality(p_waybill_internal_recipients)>0)
      and ((status='pending' and next_attempt_at<=clock_timestamp())
        or (status='processing' and lease_until<clock_timestamp()))
    order by created_at,id for update skip locked limit p_limit
  loop
    v_recipients:=coalesce(v_job.recipients,
      case when v_job.event_type='waybill_ready' and v_job.audience='finance'
        then p_waybill_internal_recipients else p_finance_recipients end);
    update public.notification_outbox set recipients=v_recipients,
      email_request=coalesce(email_request,
        case when v_job.event_type='waybill_ready'
          then private.waybill_ready_email(v_job.payload,v_recipients,p_sender)
          else private.trip_email(v_job.payload,v_recipients,p_sender) end),
      status='processing',attempts=attempts+1,
      first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),
      lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes'
    where id=v_job.id returning * into v_job;
    return next v_job;
  end loop;
end;
$$;

create function public.claim_trip_notifications(p_finance_recipients text[],p_sender text,
  p_limit integer default 5,p_include_waybill_ready boolean default false)
returns setof public.notification_outbox language sql security definer set search_path='' as $$
  select * from public.claim_trip_notifications(p_finance_recipients,p_sender,p_limit,p_include_waybill_ready,null::text[]);
$$;

create function public.get_operations_waybills(
  p_page integer default 1,p_page_size integer default 25,p_search text default null,
  p_quick_filter text default null,p_date_from date default null,p_date_to date default null,
  p_pdf_status text default null,p_delivery_status text default null,p_payout_status text default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_from timestamptz; v_until timestamptz; v_offset bigint; v_total bigint; v_items jsonb;
  v_search text; v_plate_search text;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_page is null or p_page<1 or p_page_size is null or p_page_size not between 1 and 100
    or length(p_search)>200 or p_quick_filter is not null and p_quick_filter not in
      ('awaiting_payment','paid','payment_details_required','waybill_failed','delivery_failed')
    or p_pdf_status is not null and p_pdf_status not in ('pending','processing','ready','failed')
    or p_delivery_status is not null and p_delivery_status not in ('pending','processing','sent','failed','not_queued')
    or p_payout_status is not null and p_payout_status not in ('pending','paid','payment_details_required')
    or p_date_from is not null and (not isfinite(p_date_from) or p_date_from>=date '10000-01-01')
    or p_date_to is not null and (not isfinite(p_date_to) or p_date_to>=date '10000-01-01')
    or p_date_from is not null and p_date_to is not null and p_date_from>p_date_to then
    raise exception 'Invalid Waybill filters' using errcode='22023'; end if;
  v_search:=nullif(btrim(p_search),'');
  v_plate_search:=nullif(public.normalize_plate(v_search),'');
  if p_date_from is not null then v_from:=p_date_from::timestamp at time zone 'Africa/Lagos'; end if;
  if p_date_to is not null then v_until:=(p_date_to+1)::timestamp at time zone 'Africa/Lagos'; end if;
  v_offset:=(p_page::bigint-1)*p_page_size;
  with filtered as materialized (
    select invoice.id,invoice.invoice_number,invoice.trip_id,invoice.trip_number,
      invoice.truck_registration,invoice.driver_name,invoice.quantity_tonnes,invoice.closed_at,
      document.status as pdf_status,payment.status::text as payout_status,
      driver_delivery.status as driver_delivery_status,internal_delivery.status as internal_delivery_status,
      (driver_delivery.status='failed' or internal_delivery.status='failed') as delivery_failed
    from public.trip_closure_invoices invoice
    join public.trip_closure_invoice_documents document on document.invoice_id=invoice.id and document.trip_id=invoice.trip_id
    join public.trip_payments payment on payment.trip_id=invoice.trip_id
    left join lateral (select status from public.notification_outbox
      where trip_id=invoice.trip_id and event_type='waybill_ready' and audience='driver'
      order by delivery_sequence desc limit 1) driver_delivery on true
    left join lateral (select status from public.notification_outbox
      where trip_id=invoice.trip_id and event_type='waybill_ready' and audience='finance'
      order by delivery_sequence desc limit 1) internal_delivery on true
    where (v_from is null or invoice.closed_at>=v_from) and (v_until is null or invoice.closed_at<v_until)
      and (v_search is null or position(lower(v_search) in lower(invoice.invoice_number))>0
        or position(lower(v_search) in lower(invoice.trip_number))>0
        or v_plate_search is not null and position(v_plate_search in public.normalize_plate(invoice.truck_registration))>0
        or position(lower(v_search) in lower(invoice.driver_name))>0)
      and (p_pdf_status is null or document.status=p_pdf_status)
      and (p_delivery_status is null or p_delivery_status='not_queued' and driver_delivery.status is null and internal_delivery.status is null
        or driver_delivery.status=p_delivery_status or internal_delivery.status=p_delivery_status)
      and (p_payout_status is null or payment.status::text=p_payout_status)
      and (p_quick_filter is null
        or p_quick_filter='awaiting_payment' and payment.status='pending'
        or p_quick_filter='paid' and payment.status='paid'
        or p_quick_filter='payment_details_required' and payment.status='payment_details_required'
        or p_quick_filter='waybill_failed' and document.status='failed'
        or p_quick_filter='delivery_failed' and (driver_delivery.status='failed' or internal_delivery.status='failed'))
  ), page_rows as (select * from filtered order by closed_at desc,id desc limit p_page_size offset v_offset)
  select (select count(*) from filtered),
    coalesce((select jsonb_agg(jsonb_build_object(
      'invoice_id',id,'invoice_number',invoice_number,'trip_id',trip_id,'trip_number',trip_number,
      'truck_registration',truck_registration,'driver_name',driver_name,'quantity_tonnes',quantity_tonnes,
      'closed_at',closed_at,'pdf_status',pdf_status,'payout_status',payout_status,
      'driver_delivery_status',driver_delivery_status,'internal_delivery_status',internal_delivery_status)
      order by closed_at desc,id desc) from page_rows),'[]'::jsonb)
  into v_total,v_items;
  return jsonb_build_object('items',v_items,'page',p_page,'page_size',p_page_size,
    'total_count',v_total,'has_next',v_offset+jsonb_array_length(v_items)<v_total);
end;
$$;

create function public.get_operations_waybill_detail(p_invoice_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  select jsonb_build_object(
    'invoice',jsonb_build_object('id',invoice.id,'invoice_number',invoice.invoice_number,
      'trip_id',invoice.trip_id,'trip_number',invoice.trip_number,'truck_registration',invoice.truck_registration,
      'truck_type',invoice.truck_type,'truck_capacity_tonnes',invoice.truck_capacity_tonnes,
      'truck_owner_name',invoice.truck_owner_name,'driver_name',invoice.driver_name,
      'driver_phone',invoice.driver_phone,'driver_email_available',invoice.driver_email is not null,
      'driver_license',invoice.driver_license,'loading_site_name',invoice.loading_site_name,
      'offloading_site_name',invoice.offloading_site_name,'loading_officer_name',invoice.loading_officer_name,
      'offloading_officer_name',invoice.offloading_officer_name,'opened_at',invoice.opened_at,
      'closed_at',invoice.closed_at,'issued_at',invoice.issued_at,'quantity_tonnes',invoice.quantity_tonnes,
      'closure_account_name',invoice.account_name,'closure_account_number',invoice.account_number,
      'closure_bank_name',invoice.bank_name),
    'document',jsonb_build_object('status',document.status,
      'storage_path',case when document.status='ready' and document.ready_at is not null
        and document.invoice_number=invoice.invoice_number
        and document.storage_path=substring(invoice.invoice_number from 5 for 4)||'/'||invoice.invoice_number||'.pdf'
        then document.storage_path else null end,'ready_at',document.ready_at),
    'payment',jsonb_build_object('id',payment.id,'status',payment.status,
      'updated_at',payment.updated_at,'account_name',coalesce(payment.supplied_account_name,payment.account_name),
      'account_number',coalesce(payment.supplied_account_number,payment.account_number),
      'bank_name',coalesce(payment.supplied_bank_name,payment.bank_name),
      'payment_ready_at',payment.payment_ready_at,'paid_at',payment.paid_at,
      'payment_reference',payment.payment_reference),
    'delivery',jsonb_build_object('driver',driver_delivery.status,'internal',internal_delivery.status)) into v_result
  from public.trip_closure_invoices invoice
  join public.trip_closure_invoice_documents document on document.invoice_id=invoice.id and document.trip_id=invoice.trip_id
  join public.trip_payments payment on payment.trip_id=invoice.trip_id
  left join lateral (select status from public.notification_outbox where trip_id=invoice.trip_id
    and event_type='waybill_ready' and audience='driver' order by delivery_sequence desc limit 1) driver_delivery on true
  left join lateral (select status from public.notification_outbox where trip_id=invoice.trip_id
    and event_type='waybill_ready' and audience='finance' order by delivery_sequence desc limit 1) internal_delivery on true
  where invoice.id=p_invoice_id;
  return v_result;
end;
$$;

create function public.get_operations_waybill_delivery_history(p_invoice_id uuid,p_page integer default 1,p_page_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_trip uuid; v_total bigint; v_items jsonb; v_offset bigint;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_page is null or p_page<1 or p_page_size is null or p_page_size not between 1 and 100 then
    raise exception 'Invalid page request' using errcode='22023'; end if;
  select trip_id into v_trip from public.trip_closure_invoices where id=p_invoice_id;
  if v_trip is null then return null; end if;
  v_offset:=(p_page::bigint-1)*p_page_size;
  select count(*) into v_total from public.notification_outbox
    where trip_id=v_trip and event_type='waybill_ready';
  select coalesce(jsonb_agg(jsonb_build_object('notification_id',id,'audience',audience,
    'sequence',delivery_sequence,'status',status,'attempts',attempts,'created_at',created_at,
    'sent_at',sent_at,'requested_reason_code',requested_reason_code)
    order by created_at desc,id desc),'[]'::jsonb) into v_items
  from (select id,audience,delivery_sequence,status,attempts,created_at,sent_at,requested_reason_code
    from public.notification_outbox where trip_id=v_trip and event_type='waybill_ready'
    order by created_at desc,id desc limit p_page_size offset v_offset) rows;
  return jsonb_build_object('items',v_items,'page',p_page,'page_size',p_page_size,
    'total_count',v_total,'has_next',v_offset+jsonb_array_length(v_items)<v_total);
end;
$$;

create function public.resend_operations_waybill(p_invoice_id uuid,p_audience text,p_request_id uuid,
  p_reason_code text,p_duplicate_risk_confirmed boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_invoice public.trip_closure_invoices%rowtype; v_document public.trip_closure_invoice_documents%rowtype;
  v_existing public.notification_outbox%rowtype; v_latest public.notification_outbox%rowtype; v_new public.notification_outbox%rowtype;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_request_id is null or p_audience not in ('driver','finance') or p_audience is null
    or p_reason_code is null or p_reason_code not in ('DRIVER_REQUEST','INTERNAL_REQUEST','DELIVERY_UNCONFIRMED','CORRECTIVE_RESEND')
    or p_duplicate_risk_confirmed is null then
    raise exception 'Invalid resend request' using errcode='22023'; end if;
  select * into v_invoice from public.trip_closure_invoices where id=p_invoice_id for update;
  if not found then raise exception 'Waybill not found' using errcode='22023'; end if;
  select * into v_existing from public.notification_outbox where resend_request_id=p_request_id;
  if found then
    if v_existing.trip_id<>v_invoice.trip_id or v_existing.audience<>p_audience
      or v_existing.requested_by<>auth.uid() or v_existing.requested_reason_code<>p_reason_code
      or v_existing.duplicate_risk_confirmed<>p_duplicate_risk_confirmed then
      raise exception 'Resend request conflict' using errcode='P4091'; end if;
    return jsonb_build_object('sequence',v_existing.delivery_sequence,'status',v_existing.status);
  end if;
  select * into v_document from public.trip_closure_invoice_documents
    where invoice_id=v_invoice.id and trip_id=v_invoice.trip_id and status='ready' and ready_at is not null
      and invoice_number=v_invoice.invoice_number
      and storage_path=substring(v_invoice.invoice_number from 5 for 4)||'/'||v_invoice.invoice_number||'.pdf';
  if not found then raise exception 'Ready Waybill PDF required' using errcode='P4091'; end if;
  if p_audience='driver' and v_invoice.driver_email is null then
    raise exception 'Driver email unavailable' using errcode='P4091'; end if;
  select * into v_latest from public.notification_outbox
    where trip_id=v_invoice.trip_id and event_type='waybill_ready' and audience=p_audience
    order by delivery_sequence desc limit 1 for update;
  if found and v_latest.status in ('pending','processing') then
    raise exception 'Delivery already active' using errcode='P4091'; end if;
  if not found then raise exception 'Original delivery not queued' using errcode='P4091'; end if;
  if found and v_latest.status='failed' and v_latest.first_attempt_at is not null
    and v_latest.first_attempt_at>clock_timestamp()-interval '23 hours' then
    raise exception 'Retry existing delivery within provider safety window' using errcode='P4091'; end if;
  if found and v_latest.status='failed' and not p_duplicate_risk_confirmed then
    raise exception 'Duplicate delivery risk confirmation required' using errcode='P4091'; end if;
  if found and v_latest.status='failed' and p_reason_code not in ('DELIVERY_UNCONFIRMED','CORRECTIVE_RESEND') then
    raise exception 'Approved duplicate-risk reason required' using errcode='22023'; end if;
  insert into public.notification_outbox(trip_id,event_type,audience,delivery_sequence,resend_request_id,
    requested_by,requested_reason_code,duplicate_risk_confirmed,recipients,payload)
  values (v_invoice.trip_id,'waybill_ready',p_audience,coalesce(v_latest.delivery_sequence,-1)+1,
    p_request_id,auth.uid(),p_reason_code,p_duplicate_risk_confirmed,
    case when p_audience='driver' then array[v_invoice.driver_email] else null end,
    jsonb_build_object('invoice_id',v_invoice.id,'invoice_number',v_invoice.invoice_number,
      'trip_number',v_invoice.trip_number,'storage_path',v_document.storage_path)) returning * into v_new;
  insert into public.audit_log(entity_name,entity_id,action,new_value,reason,actor_id)
  values ('waybill_resend',v_new.id,'INSERT',jsonb_build_object('invoice_id',v_invoice.id,
    'audience',p_audience,'sequence',v_new.delivery_sequence,'duplicate_risk_confirmed',p_duplicate_risk_confirmed),
    p_reason_code,auth.uid());
  return jsonb_build_object('sequence',v_new.delivery_sequence,'status',v_new.status);
end;
$$;

create function public.retry_operations_waybill_delivery(p_invoice_id uuid,p_audience text,p_reason_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_invoice public.trip_closure_invoices%rowtype; v_job public.notification_outbox%rowtype;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_audience is null or p_audience not in ('driver','finance') or p_reason_code is null
    or p_reason_code not in ('DELIVERY_UNCONFIRMED','CORRECTIVE_RESEND') then
    raise exception 'Invalid retry request' using errcode='22023'; end if;
  select * into v_invoice from public.trip_closure_invoices where id=p_invoice_id for update;
  if not found then raise exception 'Waybill not found' using errcode='22023'; end if;
  select * into v_job from public.notification_outbox where trip_id=v_invoice.trip_id
    and event_type='waybill_ready' and audience=p_audience order by delivery_sequence desc limit 1 for update;
  if not found or v_job.status<>'failed' or v_job.first_attempt_at is null
    or v_job.first_attempt_at<=clock_timestamp()-interval '23 hours' then
    raise exception 'Safe retry unavailable' using errcode='P4091'; end if;
  update public.notification_outbox set status='pending',attempts=0,
    next_attempt_at=clock_timestamp(),last_error=null where id=v_job.id;
  insert into public.audit_log(entity_name,entity_id,action,new_value,reason,actor_id)
  values ('waybill_delivery_retry',v_job.id,'INSERT',jsonb_build_object('invoice_id',p_invoice_id,
    'audience',p_audience,'sequence',v_job.delivery_sequence),p_reason_code,auth.uid());
  return jsonb_build_object('sequence',v_job.delivery_sequence,'status','pending');
end;
$$;

create or replace function public.retry_trip_notification(p_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare v_job public.notification_outbox%rowtype;
begin
  perform private.require_role(array['system_administrator','finance_officer']::public.app_role[]);
  if p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then
    raise exception 'Provider reconciliation reason required' using errcode='22023'; end if;
  select * into v_job from public.notification_outbox where id=p_id for update;
  if not found or v_job.status<>'failed' then raise exception 'Failed notification not found' using errcode='22023'; end if;
  if v_job.event_type='waybill_ready' and exists (select 1 from public.notification_outbox
    where trip_id=v_job.trip_id and event_type='waybill_ready' and audience=v_job.audience
      and delivery_sequence>v_job.delivery_sequence) then
    raise exception 'Superseded delivery cannot be retried' using errcode='22023'; end if;
  if v_job.first_attempt_at<=clock_timestamp()-interval '23 hours' then
    raise exception 'Original delivery-attempt window expired; ordinary retry is not safe' using errcode='22023'; end if;
  perform set_config('app.audit_reason',p_reason,true);
  update public.notification_outbox set status='pending',attempts=0,next_attempt_at=clock_timestamp(),last_error=null where id=p_id;
  insert into public.audit_log(entity_name,entity_id,action,old_value,new_value,reason,actor_id)
  values ('notification_outbox',p_id,'UPDATE',jsonb_build_object('status',v_job.status,'attempts',v_job.attempts,
    'first_attempt_at',v_job.first_attempt_at),jsonb_build_object('status','pending','attempts',0,
    'first_attempt_at',v_job.first_attempt_at),p_reason,auth.uid());
end;
$$;

create function public.complete_operations_payment_details(p_payment_id uuid,p_expected_updated_at timestamptz,
  p_account_name text,p_account_number text,p_bank_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_payment public.trip_payments%rowtype;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_expected_updated_at is null or p_account_name is null or length(btrim(p_account_name)) not between 1 and 200
    or p_account_number is null or btrim(p_account_number) !~ '^[0-9]{10}$'
    or p_bank_name is null or length(btrim(p_bank_name)) not between 1 and 200 then
    raise exception 'Invalid payment details' using errcode='22023'; end if;
  select * into v_payment from public.trip_payments where id=p_payment_id for update;
  if not found then raise exception 'Payment not found' using errcode='22023'; end if;
  if v_payment.status<>'payment_details_required' or v_payment.updated_at<>p_expected_updated_at then
    raise exception 'Payment state changed' using errcode='P4091'; end if;
  perform set_config('app.audit_reason','OPERATIONS_PAYMENT_DETAILS_COMPLETED',true);
  update public.trip_payments set status='pending',supplied_account_name=btrim(p_account_name),
    supplied_account_number=btrim(p_account_number),supplied_bank_name=btrim(p_bank_name)
  where id=p_payment_id returning * into v_payment;
  return jsonb_build_object('payment_id',v_payment.id,'status',v_payment.status,'updated_at',v_payment.updated_at);
end;
$$;

create function public.mark_operations_payment_paid(p_payment_id uuid,p_expected_updated_at timestamptz,
  p_payment_reference text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_payment public.trip_payments%rowtype; v_reference text:=btrim(p_payment_reference);
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_expected_updated_at is null or v_reference is null or length(v_reference) not between 1 and 200
    or v_reference ~ E'[\r\n]' then raise exception 'Invalid payment reference' using errcode='22023'; end if;
  select * into v_payment from public.trip_payments where id=p_payment_id for update;
  if not found then raise exception 'Payment not found' using errcode='22023'; end if;
  if v_payment.status='paid' then
    if v_payment.payment_reference=v_reference then
      return jsonb_build_object('payment_id',v_payment.id,'status',v_payment.status,
        'updated_at',v_payment.updated_at,'paid_at',v_payment.paid_at,'replayed',true); end if;
    raise exception 'Payment already paid with a different reference' using errcode='P4091';
  end if;
  if v_payment.status<>'pending' or v_payment.updated_at<>p_expected_updated_at then
    raise exception 'Payment state changed' using errcode='P4091'; end if;
  perform set_config('app.audit_reason','OPERATIONS_PAYMENT_MARKED_PAID',true);
  update public.trip_payments set status='paid',payment_reference=v_reference
    where id=p_payment_id returning * into v_payment;
  return jsonb_build_object('payment_id',v_payment.id,'status',v_payment.status,
    'updated_at',v_payment.updated_at,'paid_at',v_payment.paid_at,'replayed',false);
end;
$$;

create or replace function public.get_operations_dashboard_summary() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_day date; v_start timestamptz; v_end timestamptz;
  v_opened bigint; v_closed bigint; v_open bigint; v_tonnage numeric; v_trucks bigint;
  v_exception_count bigint; v_pdf_count bigint; v_email_count bigint; v_payment_count bigint;
  v_exceptions jsonb; v_pdfs jsonb; v_emails jsonb; v_payments jsonb;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  v_day:=(statement_timestamp() at time zone 'Africa/Lagos')::date;
  v_start:=v_day::timestamp at time zone 'Africa/Lagos';
  v_end:=(v_day+1)::timestamp at time zone 'Africa/Lagos';
  select count(*) filter (where opened_at>=v_start and opened_at<v_end),
    count(*) filter (where status='closed' and closed_at>=v_start and closed_at<v_end),
    count(*) filter (where status='open'),
    coalesce(sum(quantity_tonnes) filter (where status='closed' and closed_at>=v_start and closed_at<v_end),0),
    count(distinct truck_id) filter (where status='closed' and closed_at>=v_start and closed_at<v_end)
  into v_opened,v_closed,v_open,v_tonnage,v_trucks from public.trips;
  select count(*) into v_exception_count from public.exceptions where status::text<>'resolved';
  select coalesce(jsonb_agg(to_jsonb(preview) order by created_at,exception_id),'[]'::jsonb) into v_exceptions
  from (select e.id as exception_id,e.exception_type::text as exception_type,t.trip_number,
    truck.registration_number as truck_registration,e.created_at from public.exceptions e
    left join public.trips t on t.id=e.trip_id left join public.trucks truck on truck.id=e.truck_id
    where e.status::text<>'resolved' order by e.created_at,e.id limit 5) preview;
  select count(*) into v_pdf_count from public.trip_closure_invoice_documents where status='failed';
  select coalesce(jsonb_agg(to_jsonb(preview) order by failed_at,document_id),'[]'::jsonb) into v_pdfs
  from (select document.id as document_id,invoice.invoice_number,invoice.trip_number,document.failed_at
    from public.trip_closure_invoice_documents document
    join public.trip_closure_invoices invoice on invoice.id=document.invoice_id and invoice.trip_id=document.trip_id
    where document.status='failed' order by document.failed_at,document.id limit 5) preview;
  with latest as (select distinct on (trip_id,audience) id,trip_id,updated_at,status
    from public.notification_outbox where event_type='waybill_ready'
    order by trip_id,audience,delivery_sequence desc)
  select count(*) into v_email_count from latest where status='failed';
  with latest as (select distinct on (trip_id,audience) id,trip_id,updated_at,status
    from public.notification_outbox where event_type='waybill_ready'
    order by trip_id,audience,delivery_sequence desc)
  select coalesce(jsonb_agg(to_jsonb(preview) order by failed_at,notification_id),'[]'::jsonb) into v_emails
  from (select n.id as notification_id,invoice.invoice_number,invoice.trip_number,n.updated_at as failed_at
    from latest n join public.trip_closure_invoices invoice on invoice.trip_id=n.trip_id
    where n.status='failed' order by n.updated_at,n.id limit 5) preview;
  select count(*) into v_payment_count from public.trip_payments where status='payment_details_required';
  select coalesce(jsonb_agg(to_jsonb(preview) order by created_at,payment_id),'[]'::jsonb) into v_payments
  from (select payment.id as payment_id,trip.trip_number,truck.registration_number as truck_registration,
    driver.full_name as driver_name,payment.created_at from public.trip_payments payment
    join public.trips trip on trip.id=payment.trip_id
    join public.trucks truck on truck.id=payment.truck_id
    join public.drivers driver on driver.id=payment.driver_id
    where payment.status='payment_details_required' order by payment.created_at,payment.id limit 5) preview;
  return jsonb_build_object('trips_opened_today',v_opened,'trips_closed_today',v_closed,
    'open_trips',v_open,'tonnage_today',v_tonnage,'trucks_processed_today',v_trucks,
    'exceptions_requiring_attention',v_exception_count,
    'action_required',jsonb_build_object(
      'unresolved_exceptions',jsonb_build_object('count',v_exception_count,'items',v_exceptions),
      'failed_waybill_pdfs',jsonb_build_object('count',v_pdf_count,'items',v_pdfs),
      'failed_waybill_emails',jsonb_build_object('count',v_email_count,'items',v_emails),
      'payment_details_required',jsonb_build_object('count',v_payment_count,'items',v_payments)));
end;
$$;

do $$ declare v_function regprocedure;
begin
  for v_function in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('get_operations_waybills','get_operations_waybill_detail',
      'get_operations_waybill_delivery_history','resend_operations_waybill','retry_operations_waybill_delivery',
      'complete_operations_payment_details','mark_operations_payment_paid') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v_function);
    execute format('grant execute on function %s to authenticated',v_function);
  end loop;
end $$;
revoke all on function public.claim_trip_notifications(text[],text,integer,boolean,text[]) from public,anon,authenticated,service_role;
grant execute on function public.claim_trip_notifications(text[],text,integer,boolean,text[]) to service_role;
revoke all on function public.claim_trip_notifications(text[],text,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.claim_trip_notifications(text[],text,integer,boolean) to service_role;

commit;
