begin;

-- Final recipient policy: Driver and Target Company receive Waybills;
-- Operations and Finance use the authenticated portal. Keep finance in the
-- constraint for historical delivery rows, but do not create or claim new ones.
do $$
declare v_constraint record;
begin
  for v_constraint in
    select conname from pg_constraint
    where conrelid='public.notification_outbox'::regclass
      and contype='c' and pg_get_constraintdef(oid) ilike '%audience%'
  loop
    execute format('alter table public.notification_outbox drop constraint %I',v_constraint.conname);
  end loop;
end;
$$;

alter table public.notification_outbox
  add constraint notification_outbox_audience_event_check check (
    (event_type='trip_closed' and audience in ('driver','finance'))
    or (event_type='waybill_ready' and audience in ('driver','finance','client'))
  );

-- Retire unsent internal Waybill jobs. Sent history remains available in the
-- Operations Portal. Ordinary trip_closed Finance jobs are unaffected.
update public.notification_outbox
set status='failed',lease_token=null,lease_until=null,
  last_error='Waybill email delivery retired; use Operations Portal'
where event_type='waybill_ready' and audience='finance' and status in ('pending','processing');

-- The client destination is loaded by the Edge worker at send time. Store no
-- company address in the outbox payload or recipients column.
create or replace function public.enqueue_waybill_ready_notifications() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_inserted integer := 0; v_count integer;
begin
  insert into public.notification_outbox(trip_id,event_type,audience,recipients,payload)
  select invoice.trip_id,'waybill_ready','driver',array[invoice.driver_email],
    jsonb_build_object('invoice_id',invoice.id,'invoice_number',invoice.invoice_number,
      'trip_number',invoice.trip_number,'storage_path',document.storage_path)
  from public.trip_closure_invoice_documents document
  join public.trip_closure_invoices invoice on invoice.id=document.invoice_id and invoice.trip_id=document.trip_id
  where document.status='ready' and document.ready_at is not null
    and document.invoice_number=invoice.invoice_number
    and document.storage_path=private.waybill_storage_path(invoice.invoice_number)
    and invoice.driver_email is not null
  on conflict (trip_id,event_type,audience,delivery_sequence) do nothing;
  get diagnostics v_count=row_count; v_inserted:=v_inserted+v_count;

  insert into public.notification_outbox(trip_id,event_type,audience,recipients,payload)
  select invoice.trip_id,'waybill_ready','client',null,
    jsonb_build_object('invoice_id',invoice.id,'invoice_number',invoice.invoice_number,
      'trip_number',invoice.trip_number,'storage_path',document.storage_path)
  from public.trip_closure_invoice_documents document
  join public.trip_closure_invoices invoice on invoice.id=document.invoice_id and invoice.trip_id=document.trip_id
  where document.status='ready' and document.ready_at is not null
    and document.invoice_number=invoice.invoice_number
    and document.storage_path=private.waybill_storage_path(invoice.invoice_number)
  on conflict (trip_id,event_type,audience,delivery_sequence) do nothing;
  get diagnostics v_count=row_count; v_inserted:=v_inserted+v_count;
  return v_inserted;
end;
$$;

-- Preserve the old enqueue signature during the Edge Function rollout while
-- ignoring its former internal-recipient argument.
create or replace function public.enqueue_waybill_ready_notifications(p_internal_recipients text[]) returns integer
language sql security definer set search_path = '' as $$
  select public.enqueue_waybill_ready_notifications();
$$;

create or replace function public.claim_trip_notifications(
  p_finance_recipients text[],p_sender text,p_limit integer,
  p_include_waybill_ready boolean,p_include_waybill_client boolean
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
  if p_limit is null or p_limit not between 1 and 10
    or p_include_waybill_ready is null or p_include_waybill_client is null then
    raise exception 'Invalid notification claim options' using errcode='22023'; end if;

  update public.notification_outbox set status='failed',lease_token=null,lease_until=null,
    last_error='Retry limit or idempotency window reached; reconcile provider delivery before manual retry'
  where (event_type='trip_closed' or (event_type='waybill_ready' and p_include_waybill_ready
      and audience<>'finance' and (audience<>'client' or p_include_waybill_client)))
    and status in ('pending','processing') and (status='pending' or lease_until<clock_timestamp())
    and (attempts>=8 or first_attempt_at<clock_timestamp()-interval '23 hours');

  for v_job in select * from public.notification_outbox
    where (event_type='trip_closed' or (event_type='waybill_ready' and p_include_waybill_ready
        and audience<>'finance' and (audience<>'client' or p_include_waybill_client)))
      and ((status='pending' and next_attempt_at<=clock_timestamp())
        or (status='processing' and lease_until<clock_timestamp()))
    order by created_at,id for update skip locked limit p_limit
  loop
    v_recipients:=case when v_job.event_type='waybill_ready' and v_job.audience='client'
      then array[]::text[] else coalesce(v_job.recipients,p_finance_recipients) end;
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

-- Old workers can keep processing trip_closed and Driver Waybill rows. Client
-- rows remain pending until a worker opts in with valid server configuration.
create or replace function public.claim_trip_notifications(
  p_finance_recipients text[],p_sender text,p_limit integer,
  p_include_waybill_ready boolean,p_waybill_internal_recipients text[]
) returns setof public.notification_outbox
language sql security definer set search_path = '' as $$
  select * from public.claim_trip_notifications(
    p_finance_recipients,p_sender,p_limit,p_include_waybill_ready,false);
$$;

create or replace function public.claim_trip_notifications(
  p_finance_recipients text[],p_sender text,p_limit integer default 5,
  p_include_waybill_ready boolean default false
) returns setof public.notification_outbox
language sql security definer set search_path = '' as $$
  select * from public.claim_trip_notifications(
    p_finance_recipients,p_sender,p_limit,p_include_waybill_ready,false);
$$;

revoke all on function public.enqueue_waybill_ready_notifications() from public,anon,authenticated,service_role;
grant execute on function public.enqueue_waybill_ready_notifications() to service_role;
revoke all on function public.enqueue_waybill_ready_notifications(text[]) from public,anon,authenticated,service_role;
grant execute on function public.enqueue_waybill_ready_notifications(text[]) to service_role;
revoke all on function public.claim_trip_notifications(text[],text,integer,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.claim_trip_notifications(text[],text,integer,boolean,boolean) to service_role;
revoke all on function public.claim_trip_notifications(text[],text,integer,boolean,text[]) from public,anon,authenticated,service_role;
grant execute on function public.claim_trip_notifications(text[],text,integer,boolean,text[]) to service_role;
revoke all on function public.claim_trip_notifications(text[],text,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.claim_trip_notifications(text[],text,integer,boolean) to service_role;

-- Operations can resend/retry Driver copies only; Finance downloads Waybills
-- from the authenticated portal.
do $policy$
declare v_definition text; v_updated text;
begin
  v_definition:=pg_get_functiondef('public.resend_operations_waybill(uuid,text,uuid,text,boolean)'::regprocedure);
  v_updated:=regexp_replace(v_definition,
    $pattern$p_audience\s+not\s+in\s*\('driver'\s*,\s*'finance'\)$pattern$,
    $replacement$p_audience <> 'driver'$replacement$,'g');
  v_updated:=replace(v_updated,
    $old$('DRIVER_REQUEST','INTERNAL_REQUEST','DELIVERY_UNCONFIRMED','CORRECTIVE_RESEND')$old$,
    $new$('DRIVER_REQUEST','DELIVERY_UNCONFIRMED','CORRECTIVE_RESEND')$new$);
  if v_updated=v_definition then raise exception 'Could not restrict Waybill resend audience'; end if;
  execute v_updated;

  v_definition:=pg_get_functiondef('public.retry_operations_waybill_delivery(uuid,text,text)'::regprocedure);
  v_updated:=regexp_replace(v_definition,
    $pattern$p_audience\s+not\s+in\s*\('driver'\s*,\s*'finance'\)$pattern$,
    $replacement$p_audience <> 'driver'$replacement$,'g');
  if v_updated=v_definition then raise exception 'Could not restrict Waybill retry audience'; end if;
  execute v_updated;

  v_definition:=pg_get_functiondef('public.retry_trip_notification(uuid,text)'::regprocedure);
  v_updated:=replace(v_definition,
    $old$if not found or v_job.status<>'failed' then$old$,
    $new$if not found or v_job.status<>'failed'
      or (v_job.event_type='waybill_ready' and v_job.audience='finance') then$new$);
  if v_updated=v_definition then raise exception 'Could not disable legacy internal Waybill retry'; end if;
  execute v_updated;
end;
$policy$;

commit;
