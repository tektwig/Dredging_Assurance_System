begin;

lock table public.notification_outbox in share row exclusive mode;

create table private.waybill_email_historical_allowlist (
  invoice_id uuid primary key references public.trip_closure_invoices(id) on delete restrict,
  invoice_number text not null unique check (invoice_number in (
    'WB-2026-000041','WB-2026-000042','WB-2026-000043','WB-2026-000044','WB-2026-000045'
  )),
  trip_id uuid not null unique references public.trips(id) on delete restrict,
  closed_at timestamptz not null check (closed_at <= '2026-10-20T21:34:05.976714Z'::timestamptz),
  recorded_at timestamptz not null default statement_timestamp()
);
alter table private.waybill_email_historical_allowlist enable row level security;
revoke all on private.waybill_email_historical_allowlist from public,anon,authenticated,service_role;

create function private.prevent_waybill_email_allowlist_mutation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'The fixed historical email allowlist is immutable.' using errcode='42501';
end;
$$;
create trigger waybill_email_allowlist_row_immutable
before update or delete on private.waybill_email_historical_allowlist
for each row execute function private.prevent_waybill_email_allowlist_mutation();
create trigger waybill_email_allowlist_truncate_immutable
before truncate on private.waybill_email_historical_allowlist
for each statement execute function private.prevent_waybill_email_allowlist_mutation();
revoke all on function private.prevent_waybill_email_allowlist_mutation() from public,anon,authenticated,service_role;

do $resolve_historical$
declare
  v_count integer;
  v_latest timestamptz;
  v_cutoff constant timestamptz := '2026-10-20T21:34:05.976714Z'::timestamptz;
begin
  with expected(invoice_number) as (
    values ('WB-2026-000041'),('WB-2026-000042'),('WB-2026-000043'),
      ('WB-2026-000044'),('WB-2026-000045')
  )
  select count(*) into v_count
  from expected join public.trip_closure_invoices invoice using (invoice_number);
  if v_count<>5 then
    raise exception 'The fixed historical Waybill set must resolve to exactly five invoices.';
  end if;

  if exists (
    with expected(invoice_number) as (
      values ('WB-2026-000041'),('WB-2026-000042'),('WB-2026-000043'),
        ('WB-2026-000044'),('WB-2026-000045')
    )
    select 1 from expected
    left join public.trip_closure_invoices invoice using (invoice_number)
    left join public.trips trip on trip.id=invoice.trip_id
    where invoice.id is null or trip.id is null or trip.status<>'closed'
      or invoice.closed_at is distinct from trip.closed_at or invoice.closed_at>v_cutoff
  ) then
    raise exception 'A fixed historical Waybill is missing, open, or outside the approved closure cutoff.';
  end if;

  select max(invoice.closed_at) into v_latest
  from public.trip_closure_invoices invoice
  where invoice.invoice_number in (
    'WB-2026-000041','WB-2026-000042','WB-2026-000043','WB-2026-000044','WB-2026-000045'
  );
  if v_latest is distinct from v_cutoff then
    raise exception 'The fixed historical Waybill set does not match the approved latest closure timestamp.';
  end if;

  insert into private.waybill_email_historical_allowlist(invoice_id,invoice_number,trip_id,closed_at)
  select invoice.id,invoice.invoice_number,invoice.trip_id,invoice.closed_at
  from public.trip_closure_invoices invoice
  where invoice.invoice_number in (
    'WB-2026-000041','WB-2026-000042','WB-2026-000043','WB-2026-000044','WB-2026-000045'
  );
  if (select count(*) from private.waybill_email_historical_allowlist)<>5 then
    raise exception 'The fixed historical Waybill allowlist was not recorded exactly once.';
  end if;
end;
$resolve_historical$;

create table private.waybill_notification_canary_runs (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.trip_closure_invoices(id) on delete restrict,
  trip_id uuid not null references public.trips(id) on delete restrict,
  purpose text not null check (purpose='synthetic_development_test'),
  selected_by text not null default session_user,
  armed_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  disarmed_at timestamptz,
  check (expires_at>armed_at)
);
create unique index waybill_notification_canary_one_armed_run
  on private.waybill_notification_canary_runs((true)) where disarmed_at is null;
alter table private.waybill_notification_canary_runs enable row level security;
revoke all on private.waybill_notification_canary_runs from public,anon,authenticated,service_role;

create function private.guard_waybill_notification_canary_run() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_invoice_closed_at timestamptz; v_trip_closed_at timestamptz; v_trip_status text; v_invoice_number text;
begin
  if tg_op='TRUNCATE' then
    raise exception 'Notification canary history cannot be truncated.' using errcode='42501';
  end if;
  if tg_op='DELETE' then
    raise exception 'Notification canary history cannot be deleted.' using errcode='42501';
  end if;
  if tg_op='UPDATE' then
    if old.disarmed_at is not null or new.disarmed_at is null
      or new.id is distinct from old.id or new.invoice_id is distinct from old.invoice_id
      or new.trip_id is distinct from old.trip_id or new.purpose is distinct from old.purpose
      or new.selected_by is distinct from old.selected_by or new.armed_at is distinct from old.armed_at
      or new.expires_at is distinct from old.expires_at then
      raise exception 'A canary run may only be disarmed once.' using errcode='42501';
    end if;
    lock table public.notification_outbox in share row exclusive mode;
    if exists (select 1 from public.notification_outbox notification
      where notification.trip_id=old.trip_id and notification.event_type='waybill_ready'
        and notification.status='processing'
        ) then
      raise exception 'Cannot disarm a canary while a notification remains processing or ambiguous.' using errcode='55000';
    end if;
    return new;
  end if;

  lock table public.notification_outbox in share row exclusive mode;
  if exists (
    select 1 from public.notification_outbox notification
    where notification.event_type in ('trip_closed','waybill_ready')
      and notification.status='processing'
  ) then
    raise exception 'Cannot arm a notification canary while a notification remains processing or ambiguous.' using errcode='55000';
  end if;

  if new.disarmed_at is not null or new.purpose<>'synthetic_development_test'
    or new.expires_at<=statement_timestamp()
    or new.expires_at>statement_timestamp()+interval '30 minutes' then
    raise exception 'Canary selection must be explicit and expire within thirty minutes.' using errcode='22023';
  end if;

  select invoice.closed_at,trip.closed_at,trip.status::text,invoice.invoice_number
  into v_invoice_closed_at,v_trip_closed_at,v_trip_status,v_invoice_number
  from public.trip_closure_invoices invoice
  join public.trips trip on trip.id=invoice.trip_id
  where invoice.id=new.invoice_id and invoice.trip_id=new.trip_id;

  if not found or v_trip_status<>'closed'
    or v_invoice_closed_at is distinct from v_trip_closed_at
    or v_invoice_closed_at<='2026-10-20T21:34:05.976714Z'::timestamptz
    or v_invoice_number<>'WB-9999-999999'
    or exists (select 1 from private.waybill_email_historical_allowlist allowlist
      where allowlist.invoice_id=new.invoice_id) then
    raise exception 'Canary must target one closed, post-cutoff invoice outside the historical allowlist.' using errcode='42501';
  end if;
  return new;
end;
$$;

create trigger waybill_notification_canary_run_guard
before insert or update or delete on private.waybill_notification_canary_runs
for each row execute function private.guard_waybill_notification_canary_run();
create trigger waybill_notification_canary_run_truncate_guard
before truncate on private.waybill_notification_canary_runs
for each statement execute function private.guard_waybill_notification_canary_run();
revoke all on function private.guard_waybill_notification_canary_run() from public,anon,authenticated,service_role;

create function private.waybill_email_regular_delivery_allowed(p_invoice_id uuid,p_trip_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
      select 1 from private.waybill_notification_canary_runs canary
      where canary.disarmed_at is null and canary.expires_at>statement_timestamp()
    )
    and exists (
      select 1 from public.trip_closure_invoices invoice
      join public.trips trip on trip.id=invoice.trip_id
      where invoice.id=p_invoice_id and invoice.trip_id=p_trip_id
        and trip.status='closed' and invoice.closed_at=trip.closed_at
        and (
          exists (select 1 from private.waybill_email_historical_allowlist allowlist
            where allowlist.invoice_id=invoice.id and allowlist.trip_id=invoice.trip_id
              and allowlist.invoice_number=invoice.invoice_number and allowlist.closed_at=invoice.closed_at)
          or (invoice.invoice_number<>'WB-9999-999999'
            and invoice.closed_at>'2026-10-20T21:34:05.976714Z'::timestamptz
            and not exists (select 1 from private.waybill_email_historical_allowlist allowlist
              where allowlist.invoice_id=invoice.id))
        )
    );
$$;

create function private.waybill_email_canary_delivery_allowed(p_invoice_id uuid,p_trip_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from private.waybill_notification_canary_runs canary
    join public.trip_closure_invoices invoice on invoice.id=canary.invoice_id and invoice.trip_id=canary.trip_id
    join public.trips trip on trip.id=invoice.trip_id
    where canary.invoice_id=p_invoice_id and canary.trip_id=p_trip_id
      and canary.disarmed_at is null and canary.expires_at>statement_timestamp()
      and canary.purpose='synthetic_development_test'
      and trip.status='closed' and invoice.closed_at=trip.closed_at
      and invoice.invoice_number='WB-9999-999999'
      and invoice.closed_at>'2026-10-20T21:34:05.976714Z'::timestamptz
      and not exists (select 1 from private.waybill_email_historical_allowlist allowlist
        where allowlist.invoice_id=invoice.id)
  );
$$;

create function private.waybill_email_notification_allowed(p_trip_id uuid,payload jsonb)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trip_closure_invoices invoice
    where invoice.trip_id=p_trip_id and invoice.id::text=payload->>'invoice_id'
      and invoice.invoice_number=payload->>'invoice_number'
      and (private.waybill_email_regular_delivery_allowed(invoice.id,invoice.trip_id)
        or private.waybill_email_canary_delivery_allowed(invoice.id,invoice.trip_id))
  );
$$;
revoke all on function private.waybill_email_regular_delivery_allowed(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.waybill_email_canary_delivery_allowed(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.waybill_email_notification_allowed(uuid,jsonb) from public,anon,authenticated,service_role;

do $active_lease_guard$
begin
  if exists (
    select 1 from public.notification_outbox notification
    where notification.status='processing'
      and (notification.event_type='trip_closed'
        or (notification.event_type='waybill_ready'
          and not private.waybill_email_notification_allowed(notification.trip_id,notification.payload)))
  ) then
    raise exception 'An out-of-scope notification is processing or ambiguous; stop delivery and resolve it before cutover.';
  end if;
end;
$active_lease_guard$;

create function private.guard_notification_delivery_cutover() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='DELETE' then
    raise exception 'Notification outbox rows are retained and cannot be deleted.' using errcode='42501';
  end if;
  if tg_op='INSERT' then
    if new.event_type='trip_closed' then return new; end if;
    if new.event_type<>'waybill_ready' or new.audience not in ('driver','client')
      or not private.waybill_email_notification_allowed(new.trip_id,new.payload) then
      raise exception 'Notification is outside the approved Waybill email delivery scope.' using errcode='42501';
    end if;
    return new;
  end if;
  if old.event_type<>'waybill_ready'
    or not private.waybill_email_notification_allowed(old.trip_id,old.payload)
    or new.event_type<>'waybill_ready' or new.audience not in ('driver','client')
    or not private.waybill_email_notification_allowed(new.trip_id,new.payload) then
    raise exception 'Historical or out-of-scope notification rows are immutable.' using errcode='42501';
  end if;
  if new.id is distinct from old.id or new.trip_id is distinct from old.trip_id
    or new.event_type is distinct from old.event_type or new.audience is distinct from old.audience
    or new.delivery_sequence is distinct from old.delivery_sequence
    or new.payload is distinct from old.payload or new.created_at is distinct from old.created_at
    or new.resend_request_id is distinct from old.resend_request_id
    or new.requested_by is distinct from old.requested_by
    or new.requested_reason_code is distinct from old.requested_reason_code
    or new.duplicate_risk_confirmed is distinct from old.duplicate_risk_confirmed then
    raise exception 'Notification identity, payload and audit provenance are immutable.' using errcode='42501';
  end if;
  return new;
end;
$$;
create trigger notification_outbox_delivery_cutover_guard
before insert or update or delete on public.notification_outbox
for each row execute function private.guard_notification_delivery_cutover();
revoke all on function private.guard_notification_delivery_cutover() from public,anon,authenticated,service_role;

create function private.reject_notification_outbox_truncate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Notification outbox history cannot be truncated.' using errcode='42501';
end;
$$;
create trigger notification_outbox_truncate_guard
before truncate on public.notification_outbox
for each statement execute function private.reject_notification_outbox_truncate();
revoke all on function private.reject_notification_outbox_truncate() from public,anon,authenticated,service_role;
revoke insert,update,delete,truncate on table public.notification_outbox from public,anon,authenticated,service_role;

create or replace function public.enqueue_waybill_ready_notifications() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_inserted integer:=0; v_count integer;
begin
  insert into public.notification_outbox(trip_id,event_type,audience,delivery_sequence,recipients,payload)
  select i.trip_id,'waybill_ready','driver',0,array[nullif(btrim(i.driver_email),'')],
    jsonb_build_object('invoice_id',i.id,'invoice_number',i.invoice_number,'trip_number',i.trip_number)
  from public.trip_closure_invoices i
  join public.trip_closure_invoice_pdf_copies c
    on c.invoice_id=i.id and c.trip_id=i.trip_id and c.copy_kind='driver'
  where private.waybill_email_regular_delivery_allowed(i.id,i.trip_id)
    and c.status='ready' and c.ready_at is not null and c.notification_eligible
    and nullif(btrim(i.driver_email),'') is not null
  on conflict (trip_id,event_type,audience,delivery_sequence) do nothing;
  get diagnostics v_count=row_count;
  v_inserted:=v_inserted+v_count;

  insert into public.notification_outbox(trip_id,event_type,audience,delivery_sequence,recipients,payload)
  select i.trip_id,'waybill_ready','client',0,null,
    jsonb_build_object('invoice_id',i.id,'invoice_number',i.invoice_number,'trip_number',i.trip_number)
  from public.trip_closure_invoices i
  join lateral (select c.* from public.trip_closure_invoice_pdf_copies c
    where c.invoice_id=i.id and c.trip_id=i.trip_id and c.copy_kind='company'
    order by c.copy_version desc limit 1) c on true
  where private.waybill_email_regular_delivery_allowed(i.id,i.trip_id)
    and c.status='ready' and c.ready_at is not null and c.notification_eligible and c.bank_snapshot_id is not null
  on conflict (trip_id,event_type,audience,delivery_sequence) do nothing;
  get diagnostics v_count=row_count;
  return v_inserted+v_count;
end;
$$;

create or replace function public.enqueue_waybill_ready_notifications(p_company_recipient text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_recipient text:=nullif(btrim(p_company_recipient),''); v_inserted integer:=0; v_updated integer:=0;
begin
  if v_recipient is not null and (length(v_recipient)>254
    or v_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'Invalid parent company recipient configuration' using errcode='22023';
  end if;
  v_inserted:=public.enqueue_waybill_ready_notifications();
  update public.notification_outbox n
  set recipients=case when v_recipient is null then null else array[v_recipient] end,
      status=case when v_recipient is null then 'blocked_configuration' else 'pending' end,
      blocked_reason_code=case when v_recipient is null then 'company_recipient_not_configured' else null end,
      last_error=case when v_recipient is null then 'Parent company recipient must be configured' else null end,
      lease_token=null,lease_until=null,next_attempt_at=statement_timestamp()
  from public.trip_closure_invoices i
  join lateral (select c.* from public.trip_closure_invoice_pdf_copies c
    where c.invoice_id=i.id and c.trip_id=i.trip_id and c.copy_kind='company'
    order by c.copy_version desc limit 1) c on true
  where n.trip_id=i.trip_id and n.event_type='waybill_ready' and n.audience='client'
    and n.delivery_sequence=0 and private.waybill_email_regular_delivery_allowed(i.id,i.trip_id)
    and c.status='ready' and c.ready_at is not null and c.notification_eligible and c.bank_snapshot_id is not null
    and ((v_recipient is null and n.status='pending' and n.recipients is null
          and n.attempts=0 and n.first_attempt_at is null)
      or (v_recipient is not null and
          (n.status='blocked_configuration' or (n.status='pending' and n.attempts=0
            and n.first_attempt_at is null and n.recipients is distinct from array[v_recipient]))));
  get diagnostics v_updated=row_count;
  return v_inserted+v_updated;
end;
$$;

create or replace function public.claim_waybill_notifications(p_sender text,p_limit integer default 5)
returns setof public.notification_outbox
language plpgsql security definer set search_path = '' as $$
declare v_job public.notification_outbox%rowtype;
begin
  if p_sender is null or length(btrim(p_sender))=0 or p_sender ~ E'[\r\n]'
    or p_limit is null or p_limit not between 1 and 10 then
    raise exception 'Invalid Waybill notification worker configuration' using errcode='22023';
  end if;
  update public.notification_outbox n
  set status='failed',lease_token=null,lease_until=null,blocked_reason_code=null,
      last_error='Delivery retry limit reached',updated_at=statement_timestamp()
  where n.event_type='waybill_ready' and n.audience in ('driver','client')
    and n.status in ('pending','processing')
    and (n.status='pending' or n.lease_until is null or n.lease_until<statement_timestamp())
    and (n.attempts>=8 or n.first_attempt_at<statement_timestamp()-interval '23 hours')
    and n.recipients is not null and cardinality(n.recipients)=1
    and exists (
      select 1 from public.trip_closure_invoices i
      join lateral (select c.* from public.trip_closure_invoice_pdf_copies c
        where c.invoice_id=i.id and c.trip_id=i.trip_id
          and c.copy_kind=case n.audience when 'driver' then 'driver' when 'client' then 'company' else null end
        order by c.copy_version desc limit 1) c on true
      where n.trip_id=i.trip_id and n.payload->>'invoice_id'=i.id::text
        and n.payload->>'invoice_number'=i.invoice_number
        and private.waybill_email_regular_delivery_allowed(i.id,i.trip_id)
        and c.status='ready' and c.ready_at is not null and c.notification_eligible
        and (c.copy_kind<>'company' or c.bank_snapshot_id is not null)
        and ((n.audience='driver' and i.driver_email is not null and n.recipients=array[i.driver_email])
          or (n.audience='client' and n.recipients[1] ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
    );

  for v_job in
    select n.* from public.notification_outbox n
    join public.trip_closure_invoices i on i.trip_id=n.trip_id
      and n.payload->>'invoice_id'=i.id::text and n.payload->>'invoice_number'=i.invoice_number
    join lateral (select c.* from public.trip_closure_invoice_pdf_copies c
      where c.invoice_id=i.id and c.trip_id=i.trip_id
        and c.copy_kind=case n.audience when 'driver' then 'driver' when 'client' then 'company' else null end
      order by c.copy_version desc limit 1) c on true
    where n.event_type='waybill_ready' and n.audience in ('driver','client')
      and n.status in ('pending','processing') and n.recipients is not null and cardinality(n.recipients)=1
      and ((n.status='pending' and n.next_attempt_at<=statement_timestamp())
        or (n.status='processing' and (n.lease_until is null or n.lease_until<statement_timestamp())))
      and private.waybill_email_regular_delivery_allowed(i.id,i.trip_id)
      and c.status='ready' and c.ready_at is not null and c.notification_eligible
      and (c.copy_kind<>'company' or c.bank_snapshot_id is not null)
      and c.copy_version=(select max(x.copy_version) from public.trip_closure_invoice_pdf_copies x
        where x.invoice_id=i.id and x.copy_kind=c.copy_kind)
      and ((n.audience='driver' and i.driver_email is not null and n.recipients=array[i.driver_email])
        or (n.audience='client' and n.recipients[1] ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
    order by n.created_at,n.id for update of n skip locked limit p_limit
  loop
    update public.notification_outbox n
    set status='processing',attempts=n.attempts+1,
        first_attempt_at=coalesce(n.first_attempt_at,statement_timestamp()),
        lease_token=gen_random_uuid(),lease_until=statement_timestamp()+interval '5 minutes',
        updated_at=statement_timestamp()
    where n.id=v_job.id returning * into v_job;
    return next v_job;
  end loop;
end;
$$;

create function public.claim_waybill_notification_canary(
  p_sender text,p_invoice_id uuid,p_company_recipient text,p_limit integer default 2
) returns setof public.notification_outbox
language plpgsql security definer set search_path = '' as $$
declare v_invoice public.trip_closure_invoices%rowtype; v_job public.notification_outbox%rowtype;
begin
  if p_sender is null or length(btrim(p_sender))=0 or p_sender ~ E'[\r\n]'
    or p_invoice_id is null or p_limit is null or p_limit not between 1 and 2 then
    raise exception 'Invalid notification canary configuration' using errcode='22023';
  end if;
  if p_company_recipient is not null and (length(btrim(p_company_recipient))>254
    or p_company_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'Invalid notification canary recipient configuration' using errcode='22023';
  end if;
  select * into v_invoice from public.trip_closure_invoices where id=p_invoice_id;
  if not found or not private.waybill_email_canary_delivery_allowed(v_invoice.id,v_invoice.trip_id) then
    raise exception 'No active canary is armed for the selected synthetic invoice.' using errcode='42501';
  end if;

  update public.notification_outbox n
  set recipients=case when p_company_recipient is null then null else array[p_company_recipient] end,
      status=case when p_company_recipient is null then 'blocked_configuration' else 'pending' end,
      blocked_reason_code=case when p_company_recipient is null then 'company_recipient_not_configured' else null end,
      last_error=case when p_company_recipient is null then 'Parent company recipient must be configured' else null end,
      next_attempt_at=statement_timestamp()
  where n.trip_id=v_invoice.trip_id and n.event_type='waybill_ready' and n.audience='client'
    and n.delivery_sequence=0 and n.attempts=0 and n.first_attempt_at is null
    and (n.status='blocked_configuration'
      or (n.status='pending' and n.recipients is distinct from
        case when p_company_recipient is null then null else array[p_company_recipient] end))
    and exists (select 1 from public.trip_closure_invoice_pdf_copies c
      where c.invoice_id=v_invoice.id and c.trip_id=v_invoice.trip_id and c.copy_kind='company'
        and c.status='ready' and c.ready_at is not null and c.notification_eligible
        and c.bank_snapshot_id is not null
        and c.copy_version=(select max(x.copy_version) from public.trip_closure_invoice_pdf_copies x
          where x.invoice_id=v_invoice.id and x.copy_kind='company'));

  update public.notification_outbox n
  set status='failed',lease_token=null,lease_until=null,blocked_reason_code=null,
      last_error='Delivery retry limit reached',updated_at=statement_timestamp()
  where n.trip_id=v_invoice.trip_id and n.event_type='waybill_ready'
    and n.audience in ('driver','client') and n.status in ('pending','processing')
    and (n.status='pending' or n.lease_until is null or n.lease_until<statement_timestamp())
    and (n.attempts>=8 or n.first_attempt_at<statement_timestamp()-interval '23 hours')
    and n.recipients is not null and cardinality(n.recipients)=1;

  for v_job in
    select n.* from public.notification_outbox n
    join lateral (select c.* from public.trip_closure_invoice_pdf_copies c
      where c.invoice_id=v_invoice.id and c.trip_id=v_invoice.trip_id
        and c.copy_kind=case n.audience when 'driver' then 'driver' when 'client' then 'company' else null end
      order by c.copy_version desc limit 1) c on true
    where n.trip_id=v_invoice.trip_id and n.event_type='waybill_ready'
      and n.audience in ('driver','client')
      and n.payload->>'invoice_id'=v_invoice.id::text
      and n.payload->>'invoice_number'=v_invoice.invoice_number
      and n.status in ('pending','processing') and n.recipients is not null
      and cardinality(n.recipients)=1
      and ((n.status='pending' and n.next_attempt_at<=statement_timestamp())
        or (n.status='processing' and (n.lease_until is null or n.lease_until<statement_timestamp())))
      and c.status='ready' and c.ready_at is not null and c.notification_eligible
      and (c.copy_kind<>'company' or c.bank_snapshot_id is not null)
      and c.copy_version=(select max(x.copy_version) from public.trip_closure_invoice_pdf_copies x
        where x.invoice_id=v_invoice.id and x.copy_kind=c.copy_kind)
      and ((n.audience='driver' and v_invoice.driver_email is not null
          and n.recipients=array[v_invoice.driver_email])
        or (n.audience='client' and p_company_recipient is not null
          and n.recipients=array[p_company_recipient]
          and p_company_recipient ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
    order by case n.audience when 'driver' then 0 else 1 end,n.created_at,n.id
    for update of n skip locked limit p_limit
  loop
    update public.notification_outbox n
    set status='processing',attempts=n.attempts+1,
        first_attempt_at=coalesce(n.first_attempt_at,statement_timestamp()),
        lease_token=gen_random_uuid(),lease_until=statement_timestamp()+interval '5 minutes',
        updated_at=statement_timestamp()
    where n.id=v_job.id returning * into v_job;
    return next v_job;
  end loop;
end;
$$;

create or replace function public.get_waybill_notification_pdf(p_notification_id uuid,p_lease_token uuid)
returns table(invoice_id uuid,invoice_number text,copy_kind text,storage_bucket text,storage_path text)
language sql stable security definer set search_path = '' as $$
  select invoice.id,invoice.invoice_number,c.copy_kind,c.storage_bucket,c.storage_path
  from public.notification_outbox n
  join public.trip_closure_invoices invoice on invoice.trip_id=n.trip_id
  join public.trip_closure_invoice_pdf_copies c on c.invoice_id=invoice.id and c.trip_id=invoice.trip_id
  where n.id=p_notification_id and n.event_type='waybill_ready' and n.audience in ('driver','client')
    and n.status='processing' and n.lease_token=p_lease_token and n.lease_until>clock_timestamp()
    and n.payload->>'invoice_id'=invoice.id::text and n.payload->>'invoice_number'=invoice.invoice_number
    and (private.waybill_email_regular_delivery_allowed(invoice.id,invoice.trip_id)
      or private.waybill_email_canary_delivery_allowed(invoice.id,invoice.trip_id))
    and c.copy_kind=case n.audience when 'driver' then 'driver' when 'client' then 'company' else null end
    and c.status='ready' and c.ready_at is not null and c.notification_eligible
    and (c.copy_kind<>'company' or c.bank_snapshot_id is not null)
    and c.copy_version=(select max(x.copy_version) from public.trip_closure_invoice_pdf_copies x
      where x.invoice_id=invoice.id and x.copy_kind=c.copy_kind);
$$;

create or replace function public.finish_trip_notification(
  p_id uuid,p_lease_token uuid,p_sent boolean,p_provider_message_id text default null,p_error text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_sent is null or (p_sent and (p_provider_message_id is null or p_error is not null))
    or (not p_sent and (p_provider_message_id is not null or p_error is null)) then
    raise exception 'Invalid notification result' using errcode='22023';
  end if;
  update public.notification_outbox n
  set status=case when p_sent then 'sent' else 'pending' end,
      sent_at=case when p_sent then statement_timestamp() else null end,
      provider_message_id=p_provider_message_id,
      last_error=case when p_sent then null else left(p_error,255) end,
      next_attempt_at=case when p_sent then n.next_attempt_at
        else statement_timestamp()+make_interval(secs=>least(3600,(30*power(2,greatest(n.attempts-1,0)))::integer)) end,
      lease_token=null,lease_until=null,updated_at=statement_timestamp()
  where n.id=p_id and n.event_type='waybill_ready' and n.audience in ('driver','client')
    and n.status='processing' and n.lease_token=p_lease_token
    and n.lease_until>statement_timestamp()
    and private.waybill_email_notification_allowed(n.trip_id,n.payload);
  return found;
end;
$$;

create or replace function public.resend_operations_waybill(
  p_invoice_id uuid,p_audience text,p_request_id uuid,p_reason_code text,
  p_duplicate_risk_confirmed boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_invoice public.trip_closure_invoices%rowtype;
  v_copy public.trip_closure_invoice_pdf_copies%rowtype;
  v_existing public.notification_outbox%rowtype;
  v_latest public.notification_outbox%rowtype;
  v_new public.notification_outbox%rowtype;
  v_duplicate boolean;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_request_id is null or p_audience not in ('driver','client')
    or p_reason_code not in ('DRIVER_REQUEST','DELIVERY_UNCONFIRMED','CORRECTIVE_RESEND')
    or p_duplicate_risk_confirmed is null then
    raise exception 'Invalid resend request' using errcode='22023';
  end if;
  select * into v_invoice from public.trip_closure_invoices where id=p_invoice_id;
  if not found then raise exception 'Waybill not found' using errcode='22023'; end if;
  if not private.waybill_email_regular_delivery_allowed(v_invoice.id,v_invoice.trip_id) then
    raise exception 'Waybill is outside the approved email delivery scope.' using errcode='42501';
  end if;

  select * into v_existing from public.notification_outbox where resend_request_id=p_request_id;
  if found then
    if v_existing.trip_id<>v_invoice.trip_id or v_existing.audience<>p_audience
      or v_existing.requested_by<>auth.uid() or v_existing.requested_reason_code<>p_reason_code
      or v_existing.duplicate_risk_confirmed<>p_duplicate_risk_confirmed then
      raise exception 'Resend request conflict' using errcode='P4091';
    end if;
    return jsonb_build_object('sequence',v_existing.delivery_sequence,'status',v_existing.status);
  end if;

  select * into v_copy from public.trip_closure_invoice_pdf_copies c
  where c.invoice_id=v_invoice.id and c.trip_id=v_invoice.trip_id
    and c.copy_kind=case p_audience when 'driver' then 'driver' else 'company' end
    and c.status='ready' and c.ready_at is not null and c.notification_eligible
    and (c.copy_kind<>'company' or c.bank_snapshot_id is not null)
    and c.copy_version=(select max(latest.copy_version)
      from public.trip_closure_invoice_pdf_copies latest
      where latest.invoice_id=v_invoice.id and latest.copy_kind=c.copy_kind);
  if not found then raise exception 'Current eligible secure Waybill PDF required' using errcode='P4091'; end if;

  select * into v_latest from public.notification_outbox n where n.trip_id=v_invoice.trip_id
    and n.event_type='waybill_ready' and n.audience=p_audience
    order by n.delivery_sequence desc,n.created_at desc,n.id desc limit 1 for update;
  if not found or v_latest.status in ('pending','processing','blocked_missing_email','blocked_configuration') then
    raise exception 'Delivery state does not allow a resend' using errcode='P4091';
  end if;
  if v_latest.recipients is null or cardinality(v_latest.recipients)<>1
    or v_latest.recipients[1] !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Configured recipient is not available' using errcode='P4091';
  end if;
  if p_audience='driver' and v_latest.recipients[1] is distinct from v_invoice.driver_email then
    raise exception 'Driver recipient does not match the invoice snapshot' using errcode='P4091';
  end if;

  v_duplicate:=v_latest.status='sent' or (v_latest.status='failed' and
    (v_latest.first_attempt_at is null or v_latest.first_attempt_at<=statement_timestamp()-interval '23 hours'));
  if v_duplicate and not p_duplicate_risk_confirmed then
    raise exception 'Duplicate delivery risk confirmation required' using errcode='P4091';
  end if;
  if v_latest.status='failed' and not v_duplicate then
    raise exception 'Retry the existing delivery within its provider safety window' using errcode='P4091';
  end if;
  if v_latest.status='sent' and p_reason_code not in ('DRIVER_REQUEST','CORRECTIVE_RESEND') then
    raise exception 'Approved resend reason required' using errcode='22023';
  end if;

  insert into public.notification_outbox(trip_id,event_type,audience,delivery_sequence,resend_request_id,
    requested_by,requested_reason_code,duplicate_risk_confirmed,recipients,payload)
  values(v_invoice.trip_id,'waybill_ready',p_audience,v_latest.delivery_sequence+1,p_request_id,
    auth.uid(),p_reason_code,p_duplicate_risk_confirmed,v_latest.recipients,v_latest.payload)
  returning * into v_new;
  insert into public.audit_log(entity_name,entity_id,action,new_value,reason,actor_id)
  values('waybill_resend',v_new.id,'INSERT',jsonb_build_object('waybill_id',v_invoice.id,
    'audience',p_audience,'sequence',v_new.delivery_sequence,'duplicate_risk_confirmed',p_duplicate_risk_confirmed),
    p_reason_code,auth.uid());
  return jsonb_build_object('sequence',v_new.delivery_sequence,'status',v_new.status);
end;
$$;

create or replace function public.retry_operations_waybill_delivery(
  p_invoice_id uuid,p_audience text,p_reason_code text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_invoice public.trip_closure_invoices%rowtype;
  v_copy public.trip_closure_invoice_pdf_copies%rowtype;
  v_job public.notification_outbox%rowtype;
  v_email text;
  v_reason text;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_audience not in ('driver','client')
    or p_reason_code not in ('DELIVERY_UNCONFIRMED','CORRECTIVE_RESEND') then
    raise exception 'Invalid retry request' using errcode='22023';
  end if;
  select * into v_invoice from public.trip_closure_invoices where id=p_invoice_id;
  if not found then raise exception 'Waybill not found' using errcode='22023'; end if;
  if not private.waybill_email_regular_delivery_allowed(v_invoice.id,v_invoice.trip_id) then
    raise exception 'Waybill is outside the approved email delivery scope.' using errcode='42501';
  end if;

  select * into v_copy from public.trip_closure_invoice_pdf_copies c
  where c.invoice_id=v_invoice.id and c.trip_id=v_invoice.trip_id
    and c.copy_kind=case p_audience when 'driver' then 'driver' else 'company' end
    and c.status='ready' and c.ready_at is not null and c.notification_eligible
    and (c.copy_kind<>'company' or c.bank_snapshot_id is not null)
    and c.copy_version=(select max(latest.copy_version)
      from public.trip_closure_invoice_pdf_copies latest
      where latest.invoice_id=v_invoice.id and latest.copy_kind=c.copy_kind);
  if not found then raise exception 'Current eligible secure Waybill PDF required' using errcode='P4091'; end if;

  select * into v_job from public.notification_outbox n where n.trip_id=v_invoice.trip_id
    and n.event_type='waybill_ready' and n.audience=p_audience
    order by n.delivery_sequence desc,n.created_at desc,n.id desc limit 1 for update;
  if not found then raise exception 'Delivery record not found' using errcode='P4091'; end if;

  if v_job.status='blocked_missing_email' and p_audience='driver' then
    v_email:=nullif(btrim(v_invoice.driver_email),'');
    if v_email is null or v_job.recipients is not null then
      raise exception 'Driver email is unavailable in the immutable Waybill snapshot' using errcode='P4091';
    end if;
    v_reason:='WAYBILL_DRIVER_EMAIL_CORRECTED';
    update public.notification_outbox set status='pending',blocked_reason_code=null,
      recipients=array[v_email],last_error=null,attempts=0,next_attempt_at=statement_timestamp(),
      lease_token=null,lease_until=null,updated_at=statement_timestamp()
    where id=v_job.id;
  elsif v_job.status='failed' and v_job.first_attempt_at is not null
    and v_job.first_attempt_at>statement_timestamp()-interval '23 hours' then
    v_reason:=p_reason_code;
    update public.notification_outbox set status='pending',last_error=null,attempts=0,
      next_attempt_at=statement_timestamp(),lease_token=null,lease_until=null,updated_at=statement_timestamp()
    where id=v_job.id;
  else
    raise exception 'Safe delivery retry unavailable' using errcode='P4091';
  end if;

  insert into public.audit_log(entity_name,entity_id,action,old_value,new_value,reason,actor_id)
  values('waybill_delivery_retry',v_job.id,'UPDATE',
    jsonb_build_object('status',v_job.status,'sequence',v_job.delivery_sequence,'audience',v_job.audience),
    jsonb_build_object('status','pending','sequence',v_job.delivery_sequence,'audience',v_job.audience),
    v_reason,auth.uid());
  return jsonb_build_object('notification_id',v_job.id,'status','pending','sequence',v_job.delivery_sequence);
end;
$$;

revoke all on function public.enqueue_waybill_ready_notifications() from public,anon,authenticated,service_role;
grant execute on function public.enqueue_waybill_ready_notifications() to service_role;
revoke all on function public.enqueue_waybill_ready_notifications(text) from public,anon,authenticated,service_role;
grant execute on function public.enqueue_waybill_ready_notifications(text) to service_role;
revoke all on function public.claim_waybill_notifications(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.claim_waybill_notifications(text,integer) to service_role;
revoke all on function public.claim_waybill_notification_canary(text,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.claim_waybill_notification_canary(text,uuid,text,integer) to service_role;
revoke all on function public.get_waybill_notification_pdf(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_waybill_notification_pdf(uuid,uuid) to service_role;
revoke all on function public.finish_trip_notification(uuid,uuid,boolean,text,text) from public,anon,authenticated,service_role;
grant execute on function public.finish_trip_notification(uuid,uuid,boolean,text,text) to service_role;
revoke all on function public.resend_operations_waybill(uuid,text,uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.resend_operations_waybill(uuid,text,uuid,text,boolean) to authenticated;
revoke all on function public.retry_operations_waybill_delivery(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.retry_operations_waybill_delivery(uuid,text,text) to authenticated;
revoke all on function public.get_waybill_ready_pdf(uuid,uuid) from public,anon,authenticated,service_role;

do $retire_legacy_delivery$
declare v_function record;
begin
  for v_function in
    select p.oid::regprocedure as signature
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('claim_trip_notifications','retry_trip_notification')
  loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v_function.signature);
  end loop;

  for v_function in
    select p.oid::regprocedure as signature
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='enqueue_waybill_ready_notifications'
      and p.oid not in ('public.enqueue_waybill_ready_notifications()'::regprocedure,
                        'public.enqueue_waybill_ready_notifications(text)'::regprocedure)
  loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v_function.signature);
  end loop;
end;
$retire_legacy_delivery$;

do $verify_privileges$
begin
  if has_function_privilege('service_role','public.get_waybill_ready_pdf(uuid,uuid)','EXECUTE') then
    raise exception 'Legacy Waybill PDF attachment RPC remains executable by service_role.';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('claim_trip_notifications','retry_trip_notification')
      and (has_function_privilege('service_role',p.oid,'EXECUTE')
        or has_function_privilege('authenticated',p.oid,'EXECUTE')
        or has_function_privilege('anon',p.oid,'EXECUTE'))
  ) then
    raise exception 'A legacy notification claim or retry function remains callable.';
  end if;
end;
$verify_privileges$;

commit;
