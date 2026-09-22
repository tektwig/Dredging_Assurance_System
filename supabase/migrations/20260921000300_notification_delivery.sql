begin;

create function private.trip_email(p_payload jsonb, p_recipients text[], p_sender text) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('from', p_sender, 'to', to_jsonb(p_recipients),
    'subject', 'Completed trip ' || (p_payload->>'trip_number') ||
      case when p_payload->>'payment_status' = 'payment_details_required' then ' - payment details required' else ' - payment reconciliation' end,
    'text', concat_ws(E'\n',
      case when p_payload->>'payment_status' = 'payment_details_required'
        then 'Trip physically completed. At closure, payment could not be processed because bank details were missing. Finance/admin must complete the payment details. Check the current payment record for any subsequent resolution.'
        else 'Trip completed. At closure, payment was pending reconciliation; this is not confirmation of payment.' end,
      'Trip Number: ' || (p_payload->>'trip_number'),
      'Truck ID: ' || (p_payload->>'truck_id'),
      'Registration Number: ' || (p_payload->>'registration_number'),
      'Driver Name: ' || (p_payload->>'driver_name'),
      'Driver Phone: ' || (p_payload->>'driver_phone'),
      'Driver Email: ' || coalesce(p_payload->>'driver_email', 'Not provided'),
      'Payment Status at Closure: ' || (p_payload->>'payment_status'),
      'Account Name: ' || coalesce(p_payload->>'account_name', 'Not provided at closure'),
      'Account Number: ' || coalesce(p_payload->>'account_number', 'Not provided at closure'),
      'Bank Name: ' || coalesce(p_payload->>'bank_name', 'Not provided at closure'),
      'Delivered Quantity (Tonnes): ' || (p_payload->>'quantity_tonnes'),
      'Loading Site: ' || (p_payload->>'loading_site'),
      'Offloading Site: ' || (p_payload->>'offloading_site'),
      'Opened At (ISO timestamp with offset): ' || (p_payload->>'opened_at'),
      'Closed At (ISO timestamp with offset): ' || (p_payload->>'closed_at')
    ));
$$;

-- Service-role-only worker interface. Does not grant unrestricted table access.
create function public.claim_trip_notifications(p_finance_recipients text[], p_sender text, p_limit integer default 5)
returns setof public.notification_outbox language plpgsql security definer set search_path = '' as $$
declare v_job public.notification_outbox%rowtype; v_recipients text[];
begin
  if p_sender is null or length(btrim(p_sender)) = 0 or p_sender ~ E'[\r\n]' then
    raise exception 'Sender configuration required' using errcode = '22023';
  end if;
  if p_finance_recipients is null or cardinality(p_finance_recipients) not between 1 and 50 or exists (
    select 1 from unnest(p_finance_recipients) r where r is null or length(r) > 254 or r !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then raise exception 'Valid finance recipients required' using errcode = '22023'; end if;
  if p_limit is null or p_limit not between 1 and 10 then raise exception 'Batch size must be 1..10' using errcode = '22023'; end if;

  -- Resend deduplicates for 24 hours. Stop automatic retries before that window
  -- expires; an operator must investigate ambiguous acceptance before replay.
  update public.notification_outbox set status = 'failed', lease_token = null, lease_until = null,
    last_error = 'Retry limit or idempotency window reached; reconcile provider delivery before manual retry'
  where status in ('pending','processing')
    and (status = 'pending' or lease_until < clock_timestamp())
    and (attempts >= 8 or first_attempt_at < clock_timestamp() - interval '23 hours');

  for v_job in select * from public.notification_outbox
    where (status = 'pending' and next_attempt_at <= clock_timestamp())
      or (status = 'processing' and lease_until < clock_timestamp())
    order by created_at for update skip locked limit p_limit
  loop
    v_recipients := coalesce(v_job.recipients, p_finance_recipients);
    update public.notification_outbox set recipients = v_recipients,
      email_request = coalesce(email_request, private.trip_email(payload, v_recipients, p_sender)),
      status = 'processing', attempts = attempts + 1,
      first_attempt_at = coalesce(first_attempt_at, clock_timestamp()),
      lease_token = gen_random_uuid(), lease_until = clock_timestamp() + interval '5 minutes'
    where id = v_job.id returning * into v_job;
    return next v_job;
  end loop;
end;
$$;

create function public.finish_trip_notification(p_id uuid, p_lease_token uuid, p_sent boolean,
  p_provider_message_id text default null, p_error text default null) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_sent is null or (p_sent and nullif(btrim(p_provider_message_id), '') is null) then
    raise exception 'Successful delivery requires a provider message ID' using errcode = '22023';
  end if;
  update public.notification_outbox set
    status = case when p_sent then 'sent' when attempts >= 8 then 'failed' else 'pending' end,
    sent_at = case when p_sent then clock_timestamp() else null end,
    provider_message_id = case when p_sent then p_provider_message_id else provider_message_id end,
    last_error = case when p_sent then null else left(coalesce(p_error, 'Delivery failed'), 500) end,
    next_attempt_at = clock_timestamp() + make_interval(secs => least(3600, (30 * power(2, attempts))::integer)),
    lease_token = null, lease_until = null
  where id = p_id and status = 'processing' and lease_token = p_lease_token;
  return found;
end;
$$;

create function public.retry_trip_notification(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_job public.notification_outbox%rowtype;
begin
  perform private.require_role(array['system_administrator','finance_officer']::public.app_role[]);
  if p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then raise exception 'Provider reconciliation reason required' using errcode = '22023'; end if;
  select * into v_job from public.notification_outbox where id = p_id for update;
  if not found or v_job.status <> 'failed' then raise exception 'Failed notification not found' using errcode = '22023'; end if;
  -- Never extend the original provider deduplication boundary, even on manual retry.
  if v_job.first_attempt_at <= clock_timestamp() - interval '23 hours' then
    raise exception 'Original delivery-attempt window expired; ordinary retry is not safe' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', p_reason, true);
  update public.notification_outbox set status = 'pending', attempts = 0,
    next_attempt_at = clock_timestamp(), last_error = null where id = p_id;
  insert into public.audit_log(entity_name, entity_id, action, old_value, new_value, reason, actor_id)
  values ('notification_outbox', p_id, 'UPDATE', jsonb_build_object('status', v_job.status, 'attempts', v_job.attempts, 'first_attempt_at', v_job.first_attempt_at),
    jsonb_build_object('status','pending', 'attempts', 0, 'first_attempt_at', v_job.first_attempt_at), p_reason, auth.uid());
end;
$$;

-- Outbox payloads contain banking snapshots; keep the audit visibility aligned.
drop policy audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (
  private.has_role(array['system_administrator']::public.app_role[])
  or (entity_name in ('driver_payment_details','trip_payments','notification_outbox') and private.has_role(array['finance_officer']::public.app_role[]))
  or (entity_name not in ('driver_payment_details','trip_payments','notification_outbox') and private.has_role(array['operations_manager','audit_reviewer']::public.app_role[]))
);
revoke all on function private.trip_email(jsonb,text[],text) from public, anon, authenticated, service_role;
revoke all on function public.claim_trip_notifications(text[],text,integer) from public, anon, authenticated, service_role;
revoke all on function public.finish_trip_notification(uuid,uuid,boolean,text,text) from public, anon, authenticated, service_role;
revoke all on function public.retry_trip_notification(uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.claim_trip_notifications(text[],text,integer) to service_role;
grant execute on function public.finish_trip_notification(uuid,uuid,boolean,text,text) to service_role;
grant execute on function public.retry_trip_notification(uuid,text) to authenticated;
commit;
