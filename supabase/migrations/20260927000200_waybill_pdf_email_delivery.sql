begin;

alter table public.notification_outbox
  drop constraint notification_outbox_event_type_check,
  drop constraint notification_outbox_trip_id_audience_key;

alter table public.notification_outbox
  add constraint notification_outbox_event_type_check
    check (event_type in ('trip_closed','waybill_ready')),
  add constraint notification_outbox_trip_event_audience_key
    unique (trip_id,event_type,audience);

create function private.waybill_ready_email(p_payload jsonb,p_recipients text[],p_sender text) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('from',p_sender,'to',to_jsonb(p_recipients),
    'subject','Waybill ' || (p_payload->>'invoice_number') || ' for trip ' || (p_payload->>'trip_number'),
    'text',concat_ws(E'\n',
      'The issued Waybill PDF is attached.',
      'Waybill Number: ' || (p_payload->>'invoice_number'),
      'Trip Number: ' || (p_payload->>'trip_number')));
$$;

create function public.enqueue_waybill_ready_notifications(p_internal_recipients text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_recipients text[];
  v_inserted integer := 0;
  v_count integer;
begin
  if p_internal_recipients is null or cardinality(p_internal_recipients) > 50
    or exists (
      select 1 from unnest(p_internal_recipients) as recipients(address)
      where address is null or length(btrim(address)) > 254
        or btrim(address) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ) then
    raise exception 'Valid internal recipients required' using errcode = '22023';
  end if;

  select coalesce(array_agg(address order by first_position),array[]::text[])
    into v_recipients
  from (
    select btrim(recipient) as address,min(position) as first_position
    from unnest(p_internal_recipients) with ordinality as recipients(recipient,position)
    group by btrim(recipient)
  ) as normalized;

  insert into public.notification_outbox(trip_id,event_type,audience,recipients,payload)
  select invoice.trip_id,'waybill_ready','driver',array[invoice.driver_email],
    jsonb_build_object('invoice_id',invoice.id,'invoice_number',invoice.invoice_number,
      'trip_number',invoice.trip_number,'storage_path',document.storage_path)
  from public.trip_closure_invoice_documents as document
  join public.trip_closure_invoices as invoice
    on invoice.id=document.invoice_id and invoice.trip_id=document.trip_id
  where document.status='ready' and document.ready_at is not null
    and document.invoice_number=invoice.invoice_number
    and document.storage_path=substring(invoice.invoice_number from 5 for 4) || '/' || invoice.invoice_number || '.pdf'
    and invoice.driver_email is not null
  on conflict (trip_id,event_type,audience) do nothing;
  get diagnostics v_count = row_count;
  v_inserted := v_inserted + v_count;

  if cardinality(v_recipients) > 0 then
    insert into public.notification_outbox(trip_id,event_type,audience,recipients,payload)
    select invoice.trip_id,'waybill_ready','finance',v_recipients,
      jsonb_build_object('invoice_id',invoice.id,'invoice_number',invoice.invoice_number,
        'trip_number',invoice.trip_number,'storage_path',document.storage_path)
    from public.trip_closure_invoice_documents as document
    join public.trip_closure_invoices as invoice
      on invoice.id=document.invoice_id and invoice.trip_id=document.trip_id
    where document.status='ready' and document.ready_at is not null
      and document.invoice_number=invoice.invoice_number
      and document.storage_path=substring(invoice.invoice_number from 5 for 4) || '/' || invoice.invoice_number || '.pdf'
    on conflict (trip_id,event_type,audience) do nothing;
    get diagnostics v_count = row_count;
    v_inserted := v_inserted + v_count;
  end if;

  return v_inserted;
end;
$$;

drop function public.claim_trip_notifications(text[],text,integer);
create function public.claim_trip_notifications(
  p_finance_recipients text[],p_sender text,p_limit integer default 5,
  p_include_waybill_ready boolean default false
) returns setof public.notification_outbox
language plpgsql security definer set search_path = '' as $$
declare v_job public.notification_outbox%rowtype; v_recipients text[];
begin
  if p_sender is null or length(btrim(p_sender)) = 0 or p_sender ~ E'[\r\n]' then
    raise exception 'Sender configuration required' using errcode = '22023';
  end if;
  if p_finance_recipients is null or cardinality(p_finance_recipients) not between 1 and 50 or exists (
    select 1 from unnest(p_finance_recipients) r where r is null or length(r) > 254 or r !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then raise exception 'Valid finance recipients required' using errcode = '22023'; end if;
  if p_limit is null or p_limit not between 1 and 10 then raise exception 'Batch size must be 1..10' using errcode = '22023'; end if;

  update public.notification_outbox set status = 'failed', lease_token = null, lease_until = null,
    last_error = 'Retry limit or idempotency window reached; reconcile provider delivery before manual retry'
  where (event_type='trip_closed' or p_include_waybill_ready)
    and status in ('pending','processing')
    and (status = 'pending' or lease_until < clock_timestamp())
    and (attempts >= 8 or first_attempt_at < clock_timestamp() - interval '23 hours');

  for v_job in select * from public.notification_outbox
    where (event_type='trip_closed' or p_include_waybill_ready)
      and ((status = 'pending' and next_attempt_at <= clock_timestamp())
        or (status = 'processing' and lease_until < clock_timestamp()))
    order by created_at for update skip locked limit p_limit
  loop
    v_recipients := coalesce(v_job.recipients, p_finance_recipients);
    update public.notification_outbox set recipients = v_recipients,
      email_request = coalesce(email_request,
        case when v_job.event_type='waybill_ready'
          then private.waybill_ready_email(v_job.payload,v_recipients,p_sender)
          else private.trip_email(v_job.payload,v_recipients,p_sender) end),
      status = 'processing', attempts = attempts + 1,
      first_attempt_at = coalesce(first_attempt_at, clock_timestamp()),
      lease_token = gen_random_uuid(), lease_until = clock_timestamp() + interval '5 minutes'
    where id = v_job.id returning * into v_job;
    return next v_job;
  end loop;
end;
$$;

create function public.get_waybill_ready_pdf(p_notification_id uuid,p_lease_token uuid)
returns table(invoice_id uuid,invoice_number text,storage_path text)
language sql security definer set search_path = '' as $$
  select invoice.id,invoice.invoice_number,document.storage_path
  from public.notification_outbox as notification
  join public.trip_closure_invoice_documents as document
    on document.trip_id=notification.trip_id
    and document.invoice_id::text=notification.payload->>'invoice_id'
  join public.trip_closure_invoices as invoice
    on invoice.id=document.invoice_id and invoice.trip_id=document.trip_id
  where notification.id=p_notification_id and notification.event_type='waybill_ready'
    and notification.status='processing' and notification.lease_token=p_lease_token
    and notification.lease_until > clock_timestamp()
    and document.status='ready' and document.ready_at is not null
    and document.invoice_number=invoice.invoice_number
    and notification.payload->>'invoice_number'=invoice.invoice_number
    and notification.payload->>'storage_path'=document.storage_path
    and document.storage_path=substring(invoice.invoice_number from 5 for 4) || '/' || invoice.invoice_number || '.pdf';
$$;

revoke all on function private.waybill_ready_email(jsonb,text[],text) from public,anon,authenticated,service_role;
revoke all on function public.enqueue_waybill_ready_notifications(text[]) from public,anon,authenticated,service_role;
revoke all on function public.claim_trip_notifications(text[],text,integer,boolean) from public,anon,authenticated,service_role;
revoke all on function public.get_waybill_ready_pdf(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.finish_trip_notification(uuid,uuid,boolean,text,text) from public,anon,authenticated,service_role;
grant execute on function public.enqueue_waybill_ready_notifications(text[]) to service_role;
grant execute on function public.claim_trip_notifications(text[],text,integer,boolean) to service_role;
grant execute on function public.get_waybill_ready_pdf(uuid,uuid) to service_role;
grant execute on function public.finish_trip_notification(uuid,uuid,boolean,text,text) to service_role;

commit;
