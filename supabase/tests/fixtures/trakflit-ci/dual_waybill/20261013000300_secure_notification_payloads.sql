begin;

create or replace function public.enqueue_waybill_ready_notifications(p_company_recipient text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_recipient text:=nullif(btrim(p_company_recipient),'');
  v_inserted integer:=0;
  v_updated integer:=0;
begin
  if v_recipient is not null and (length(v_recipient)>254
    or v_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'Invalid parent company recipient configuration' using errcode='22023';
  end if;

  v_inserted:=public.enqueue_waybill_ready_notifications();
  if v_recipient is null then
    update public.notification_outbox notification
    set status='blocked_configuration',blocked_reason_code='company_recipient_not_configured',
        lease_token=null,lease_until=null,last_error='Parent company recipient must be configured',
        next_attempt_at=statement_timestamp()
    from public.trip_closure_invoices invoice
    join lateral (
      select candidate.* from public.trip_closure_invoice_pdf_copies candidate
      where candidate.invoice_id=invoice.id and candidate.trip_id=invoice.trip_id
        and candidate.copy_kind='company'
      order by candidate.copy_version desc limit 1
    ) pdf_copy on true
    where notification.trip_id=invoice.trip_id and notification.event_type='waybill_ready'
      and notification.audience='client' and notification.delivery_sequence=0
      and notification.status='pending' and notification.recipients is null
      and notification.attempts=0 and notification.first_attempt_at is null
      and pdf_copy.status='ready' and pdf_copy.ready_at is not null
      and pdf_copy.notification_eligible and pdf_copy.bank_snapshot_id is not null;
    get diagnostics v_updated=row_count;
    return v_inserted+v_updated;
  end if;

  update public.notification_outbox notification
  set recipients=array[v_recipient],status='pending',blocked_reason_code=null,
      next_attempt_at=statement_timestamp(),last_error=null
  from public.trip_closure_invoices invoice
  join lateral (
    select candidate.* from public.trip_closure_invoice_pdf_copies candidate
    where candidate.invoice_id=invoice.id and candidate.trip_id=invoice.trip_id
      and candidate.copy_kind='company'
    order by candidate.copy_version desc limit 1
  ) pdf_copy on true
  where notification.trip_id=invoice.trip_id and notification.event_type='waybill_ready'
    and notification.audience='client' and notification.delivery_sequence=0
    and (notification.status='blocked_configuration'
      or (notification.status='pending' and notification.attempts=0
        and notification.first_attempt_at is null
        and notification.recipients is distinct from array[v_recipient]))
    and pdf_copy.status='ready' and pdf_copy.ready_at is not null
    and pdf_copy.notification_eligible and pdf_copy.bank_snapshot_id is not null;
  get diagnostics v_updated=row_count;
  return v_inserted+v_updated;
end;
$$;

create or replace function public.claim_waybill_notifications(p_sender text,p_limit integer default 5)
returns setof public.notification_outbox
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.notification_outbox%rowtype;
begin
  if p_sender is null or length(btrim(p_sender))=0 or p_sender ~ E'[\r\n]'
    or p_limit is null or p_limit not between 1 and 10 then
    raise exception 'Invalid Waybill notification worker configuration' using errcode='22023';
  end if;

  update public.notification_outbox notification
  set status='failed',lease_token=null,lease_until=null,blocked_reason_code=null,
      last_error='Delivery retry limit reached',updated_at=statement_timestamp()
  where notification.event_type='waybill_ready' and notification.audience in ('driver','client')
    and notification.status in ('pending','processing')
    and (notification.status='pending' or notification.lease_until is null
      or notification.lease_until<statement_timestamp())
    and (notification.attempts>=8
      or notification.first_attempt_at<statement_timestamp()-interval '23 hours')
    and notification.recipients is not null and cardinality(notification.recipients)=1
    and exists (
      select 1
      from public.trip_closure_invoices invoice
      join lateral (
        select candidate.* from public.trip_closure_invoice_pdf_copies candidate
        where candidate.invoice_id=invoice.id and candidate.trip_id=invoice.trip_id
          and candidate.copy_kind=case notification.audience
            when 'driver' then 'driver' when 'client' then 'company' else null end
        order by candidate.copy_version desc limit 1
      ) pdf_copy on true
      where notification.trip_id=invoice.trip_id
        and notification.payload->>'invoice_id'=invoice.id::text
        and notification.payload->>'invoice_number'=invoice.invoice_number
        and pdf_copy.status='ready' and pdf_copy.ready_at is not null
        and pdf_copy.notification_eligible
        and (pdf_copy.copy_kind<>'company' or pdf_copy.bank_snapshot_id is not null)
        and ((notification.audience='driver' and invoice.driver_email is not null
            and notification.recipients=array[invoice.driver_email])
          or (notification.audience='client'
            and notification.recipients[1] ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
    );

  for v_job in
    select notification.*
    from public.notification_outbox notification
    join public.trip_closure_invoices invoice
      on invoice.trip_id=notification.trip_id
      and notification.payload->>'invoice_id'=invoice.id::text
      and notification.payload->>'invoice_number'=invoice.invoice_number
    join lateral (
      select candidate.* from public.trip_closure_invoice_pdf_copies candidate
      where candidate.invoice_id=invoice.id and candidate.trip_id=invoice.trip_id
        and candidate.copy_kind=case notification.audience
          when 'driver' then 'driver' when 'client' then 'company' else null end
      order by candidate.copy_version desc limit 1
    ) pdf_copy on true
    where notification.event_type='waybill_ready' and notification.audience in ('driver','client')
      and notification.status in ('pending','processing')
      and notification.recipients is not null and cardinality(notification.recipients)=1
      and ((notification.status='pending' and notification.next_attempt_at<=statement_timestamp())
        or (notification.status='processing'
          and (notification.lease_until is null or notification.lease_until<statement_timestamp())))
      and pdf_copy.status='ready' and pdf_copy.ready_at is not null
      and pdf_copy.notification_eligible
      and (pdf_copy.copy_kind<>'company' or pdf_copy.bank_snapshot_id is not null)
      and pdf_copy.copy_version=(
        select max(latest.copy_version) from public.trip_closure_invoice_pdf_copies latest
        where latest.invoice_id=invoice.id and latest.copy_kind=pdf_copy.copy_kind
      )
      and ((notification.audience='driver' and invoice.driver_email is not null
          and notification.recipients=array[invoice.driver_email])
        or (notification.audience='client'
          and notification.recipients[1] ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
    order by notification.created_at,notification.id
    for update of notification skip locked limit p_limit
  loop
    update public.notification_outbox notification
    set status='processing',attempts=notification.attempts+1,
        first_attempt_at=coalesce(notification.first_attempt_at,statement_timestamp()),
        lease_token=gen_random_uuid(),lease_until=statement_timestamp()+interval '5 minutes',
        updated_at=statement_timestamp()
    where notification.id=v_job.id returning * into v_job;
    return next v_job;
  end loop;
end;
$$;

revoke all on function public.enqueue_waybill_ready_notifications(text) from public,anon,authenticated,service_role;
grant execute on function public.enqueue_waybill_ready_notifications(text) to service_role;
revoke all on function public.claim_waybill_notifications(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.claim_waybill_notifications(text,integer) to service_role;
revoke all on function public.get_waybill_notification_pdf(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_waybill_notification_pdf(uuid,uuid) to service_role;
revoke all on function public.finish_trip_notification(uuid,uuid,boolean,text,text) from public,anon,authenticated,service_role;
grant execute on function public.finish_trip_notification(uuid,uuid,boolean,text,text) to service_role;

commit;
