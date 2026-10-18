begin;

-- Payment-free operational cutover. Apply only after stopping notification
-- workers and confirming no notification row is actively leased. No rows,
-- Waybill snapshots, PDF jobs, or legacy financial records are deleted.
lock table public.trips, public.notification_outbox in share row exclusive mode;

do $migration$
begin
  if exists (
    select 1 from public.notification_outbox
    where status='processing' and (lease_until is null or lease_until>statement_timestamp())
  ) then
    raise exception 'notification_outbox has an active or ambiguous processing lease; pause workers and drain leases before cutover';
  end if;
end;
$migration$;

-- The prior FK incorrectly made a payment row a prerequisite for a trip
-- notification. Preserve all current indexes and rows. Fail closed if data
-- changed since the read-only integrity check.
do $migration$
declare
  v_outbox_trip_attnum smallint;
  v_trips_id_attnum smallint;
  v_trip_fk record;
  v_old_fk record;
begin
  if exists (
    select 1 from public.notification_outbox n
    left join public.trips t on t.id=n.trip_id
    where t.id is null
  ) then
    raise exception 'notification_outbox contains trip orphans; reconcile before cutover';
  end if;

  select attnum::smallint into v_outbox_trip_attnum
  from pg_attribute where attrelid='public.notification_outbox'::regclass
    and attname='trip_id' and not attisdropped;
  select attnum::smallint into v_trips_id_attnum
  from pg_attribute where attrelid='public.trips'::regclass
    and attname='id' and not attisdropped;
  if v_outbox_trip_attnum is null or v_trips_id_attnum is null then
    raise exception 'notification_outbox.trip_id or trips.id is missing';
  end if;

  select c.conname,c.convalidated,c.confdeltype into v_trip_fk
  from pg_constraint c
  where c.conrelid='public.notification_outbox'::regclass
    and c.contype='f' and c.confrelid='public.trips'::regclass
    and c.conkey=array[v_outbox_trip_attnum]::smallint[]
    and c.confkey=array[v_trips_id_attnum]::smallint[];

  if found then
    if v_trip_fk.confdeltype <> 'r' then
      raise exception 'existing notification trip foreign key does not use ON DELETE RESTRICT';
    end if;
    if not v_trip_fk.convalidated then
      execute format('alter table public.notification_outbox validate constraint %I',v_trip_fk.conname);
    end if;
  else
    if exists (
      select 1 from pg_constraint c
      where c.conrelid='public.notification_outbox'::regclass
        and c.contype='f' and c.confrelid='public.trips'::regclass
        and c.conkey=array[v_outbox_trip_attnum]::smallint[]
    ) then
      raise exception 'notification_outbox has an unexpected foreign key to trips; review before cutover';
    end if;
    alter table public.notification_outbox
      add constraint notification_outbox_trip_id_trips_fkey
      foreign key (trip_id) references public.trips(id) on delete restrict not valid;
    alter table public.notification_outbox
      validate constraint notification_outbox_trip_id_trips_fkey;
  end if;

  if not exists (
    select 1 from pg_constraint c
    where c.conrelid='public.notification_outbox'::regclass
      and c.contype='f' and c.confrelid='public.trips'::regclass
      and c.conkey=array[v_outbox_trip_attnum]::smallint[]
      and c.confkey=array[v_trips_id_attnum]::smallint[] and c.convalidated
      and c.confdeltype='r'
  ) then
    raise exception 'validated notification_outbox.trip_id -> trips.id foreign key was not established';
  end if;

  for v_old_fk in
    select c.conname from pg_constraint c
    where c.conrelid='public.notification_outbox'::regclass
      and c.confrelid=to_regclass('public.trip_payments') and c.contype='f'
      and c.conkey=array[v_outbox_trip_attnum]::smallint[]
  loop
    execute format('alter table public.notification_outbox drop constraint %I',v_old_fk.conname);
  end loop;
end;
$migration$;

alter table public.notification_outbox
  add column if not exists blocked_reason_code text;

-- Both the legacy MVP and canonical baseline name the inline status check
-- notification_outbox_status_check. Remove only that known four-state check;
-- unrelated CHECK constraints (including sent_at/status consistency) remain.
alter table public.notification_outbox
  drop constraint if exists notification_outbox_status_check;

alter table public.notification_outbox
  add constraint notification_outbox_status_state_check
    check (status in ('pending','processing','sent','failed','blocked_missing_email','blocked_configuration')),
  add constraint notification_outbox_blocked_reason_check
    check ((status='blocked_missing_email' and blocked_reason_code='missing_driver_email')
      or (status='blocked_configuration' and blocked_reason_code='company_recipient_not_configured')
      or (status not in ('blocked_missing_email','blocked_configuration') and blocked_reason_code is null));

-- Retire historical internal Waybill messages from the active queue while
-- retaining each row and appending a PII-free status transition to audit_log.
-- Trip-closure payment messages remain immutable history and are never
-- eligible for the new worker. Do not overwrite attempt/error history.
insert into public.audit_log(entity_name,entity_id,action,old_value,new_value,reason,actor_id)
select 'notification_outbox',n.id,'UPDATE',
  jsonb_build_object('status',n.status,'delivery_sequence',n.delivery_sequence,
    'recipient_state',case when n.recipients is null then 'null'
      when cardinality(n.recipients)=0 then 'empty' else 'present' end),
  jsonb_build_object('status','failed','transition','legacy_waybill_audience_retired'),
  'legacy_waybill_audience_retired',null
from public.notification_outbox n
where n.event_type='waybill_ready' and n.audience='finance'
  and n.status in ('pending','processing');

update public.notification_outbox
set status='failed',lease_token=null,lease_until=null,
    blocked_reason_code=null
where event_type='waybill_ready' and audience='finance'
  and status in ('pending','processing');

-- Reclassify current rows that did not capture a usable delivery address.
-- Record safe state-only audit evidence. Recipient values and provider errors
-- are not copied into audit_log or overwritten in the outbox.
insert into public.audit_log(entity_name,entity_id,action,old_value,new_value,reason,actor_id)
select 'notification_outbox',n.id,'UPDATE',
  jsonb_build_object('status',n.status,'delivery_sequence',n.delivery_sequence,'recipient_state','missing'),
  jsonb_build_object('status','blocked_missing_email','blocked_reason_code','missing_driver_email'),
  'missing_driver_email',null
from public.notification_outbox n
join public.trip_closure_invoices i on i.trip_id=n.trip_id
where n.event_type='waybill_ready' and n.audience='driver'
  and n.status in ('pending','processing')
  and (n.recipients is null or not exists (
    select 1 from unnest(n.recipients) as recipient(value)
    where nullif(btrim(recipient.value),'') is not null
  ))
  and nullif(btrim(i.driver_email),'') is null;

update public.notification_outbox n
set status='blocked_missing_email',lease_token=null,lease_until=null,
    blocked_reason_code='missing_driver_email',recipients=null
from public.trip_closure_invoices i
where n.trip_id=i.trip_id and n.event_type='waybill_ready' and n.audience='driver'
  and n.status in ('pending','processing')
  and (n.recipients is null or not exists (
    select 1 from unnest(n.recipients) as recipient(value)
    where nullif(btrim(recipient.value),'') is not null
  ))
  and nullif(btrim(i.driver_email),'') is null;

insert into public.audit_log(entity_name,entity_id,action,old_value,new_value,reason,actor_id)
select 'notification_outbox',n.id,'UPDATE',
  jsonb_build_object('status',n.status,'delivery_sequence',n.delivery_sequence,'recipient_state','missing'),
  jsonb_build_object('status','pending','recipient_source','waybill_snapshot'),
  'driver_delivery_address_recovered_from_waybill_snapshot',null
from public.notification_outbox n
join public.trip_closure_invoices i on i.trip_id=n.trip_id
where n.event_type='waybill_ready' and n.audience='driver'
  and n.status in ('pending','processing')
  and (n.recipients is null or not exists (
    select 1 from unnest(n.recipients) as recipient(value)
    where nullif(btrim(recipient.value),'') is not null
  ))
  and nullif(btrim(i.driver_email),'') is not null;

update public.notification_outbox n
set status='pending',lease_token=null,lease_until=null,blocked_reason_code=null,
    recipients=array[nullif(btrim(i.driver_email),'')],
    next_attempt_at=statement_timestamp()
from public.trip_closure_invoices i
where n.trip_id=i.trip_id and n.event_type='waybill_ready' and n.audience='driver'
  and n.status in ('pending','processing')
  and (n.recipients is null or not exists (
    select 1 from unnest(n.recipients) as recipient(value)
    where nullif(btrim(recipient.value),'') is not null
  ))
  and nullif(btrim(i.driver_email),'') is not null;

insert into public.audit_log(entity_name,entity_id,action,old_value,new_value,reason,actor_id)
select 'notification_outbox',n.id,'UPDATE',
  jsonb_build_object('status',n.status,'delivery_sequence',n.delivery_sequence,'recipient_state','missing'),
  jsonb_build_object('status','blocked_configuration','blocked_reason_code','company_recipient_not_configured'),
  'company_recipient_not_configured',null
from public.notification_outbox n
where n.event_type='waybill_ready' and n.audience='client'
  and n.status in ('pending','processing')
  and (n.recipients is null or not exists (
    select 1 from unnest(n.recipients) as recipient(value)
    where nullif(btrim(recipient.value),'') is not null
  ));

update public.notification_outbox
set status='blocked_configuration',lease_token=null,lease_until=null,
    blocked_reason_code='company_recipient_not_configured',recipients=null
where event_type='waybill_ready' and audience='client'
  and status in ('pending','processing')
  and (recipients is null or not exists (
    select 1 from unnest(recipients) as recipient(value)
    where nullif(btrim(recipient.value),'') is not null
  ));

-- A trip closure produces one immutable, payment-free Waybill snapshot and
-- its PDF queue row. Driver and parent-company records are independent. The
-- company row remains visibly blocked until the worker supplies the explicit
-- configured company address to enqueue_waybill_ready_notifications.
create or replace function private.create_trip_closure_invoice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_loading_name text;
  v_offloading_name text;
  v_loading_officer_name text;
  v_offloading_officer_name text;
  v_driver_email text;
  v_number text;
  v_invoice public.trip_closure_invoices%rowtype;
  v_document public.trip_closure_invoice_documents%rowtype;
  v_payload jsonb;
begin
  if new.status <> 'closed' then return null; end if;

  select name into strict v_loading_name from public.sites where id=new.loading_site_id;
  select name into strict v_offloading_name from public.sites where id=new.offloading_site_id;
  select coalesce(nullif(btrim(display_name),''),'Loading Officer ('||new.opened_by::text||')')
    into strict v_loading_officer_name from public.profiles where id=new.opened_by;
  select coalesce(nullif(btrim(display_name),''),'Offloading Officer ('||new.closed_by::text||')')
    into strict v_offloading_officer_name from public.profiles where id=new.closed_by;
  select email into strict v_driver_email from public.drivers where id=new.driver_id for share;
  v_driver_email:=nullif(btrim(v_driver_email),'');

  v_number := 'WB-' || to_char(new.closed_at at time zone 'Africa/Lagos','YYYY') || '-' ||
    lpad(nextval('private.trip_closure_invoice_seq')::text,6,'0');

  insert into public.trip_closure_invoices(
    invoice_number,trip_id,trip_number,truck_id,truck_registration,truck_type,
    truck_capacity_tonnes,truck_owner_name,driver_id,driver_name,driver_phone,
    driver_license,driver_email,loading_site_id,loading_site_name,offloading_site_id,
    offloading_site_name,loading_officer_id,loading_officer_name,
    offloading_officer_id,offloading_officer_name,quantity_tonnes,opened_at,closed_at,issued_at
  ) values (
    v_number,new.id,new.trip_number,new.truck_id,new.truck_registration_at_loading,
    new.truck_type_at_loading,new.truck_capacity_at_loading,new.truck_owner_at_loading,
    new.driver_id,new.driver_name_at_loading,new.driver_phone_at_loading,
    new.driver_license_at_loading,v_driver_email,new.loading_site_id,v_loading_name,
    new.offloading_site_id,v_offloading_name,new.opened_by,v_loading_officer_name,
    new.closed_by,v_offloading_officer_name,new.quantity_tonnes,new.opened_at,new.closed_at,new.closed_at
  ) on conflict (trip_id) do nothing;

  select * into strict v_invoice from public.trip_closure_invoices where trip_id=new.id;
  select * into strict v_document from public.trip_closure_invoice_documents
    where invoice_id=v_invoice.id and trip_id=v_invoice.trip_id;
  v_payload:=jsonb_build_object('invoice_id',v_invoice.id,'invoice_number',v_invoice.invoice_number,
    'trip_number',v_invoice.trip_number,'storage_path',v_document.storage_path);

  insert into public.notification_outbox(trip_id,event_type,audience,delivery_sequence,
    recipients,payload,status,blocked_reason_code)
  values (new.id,'waybill_ready','driver',0,
    case when v_driver_email is null then null else array[v_driver_email] end,v_payload,
    case when v_driver_email is null then 'blocked_missing_email' else 'pending' end,
    case when v_driver_email is null then 'missing_driver_email' else null end)
  on conflict (trip_id,event_type,audience,delivery_sequence) do nothing;

  insert into public.notification_outbox(trip_id,event_type,audience,delivery_sequence,
    recipients,payload,status,blocked_reason_code,last_error)
  values (new.id,'waybill_ready','client',0,null,v_payload,'blocked_configuration',
    'company_recipient_not_configured','Parent company recipient must be configured')
  on conflict (trip_id,event_type,audience,delivery_sequence) do nothing;
  return null;
end;
$$;

-- This second closure trigger created trip_payments and trip_closed emails.
-- Remove only its trigger; keep its function/table history for restricted
-- retention until a separate approved archival decision.
do $migration$
declare v_trigger record;
begin
  for v_trigger in
    select t.tgname from pg_trigger t
    join pg_proc p on p.oid=t.tgfoid
    join pg_namespace n on n.oid=p.pronamespace
    where t.tgrelid='public.trips'::regclass and not t.tgisinternal
      and n.nspname='private' and p.proname='snapshot_closed_trip'
  loop
    execute format('drop trigger %I on public.trips',v_trigger.tgname);
  end loop;
end;
$migration$;

-- The worker sees a strict payment-free allow-list rather than the complete
-- historical snapshot row. Drop/recreate because PostgreSQL cannot change a
-- function's return type with CREATE OR REPLACE.
drop function if exists public.get_waybill_pdf_snapshot(uuid,uuid);
create function public.get_waybill_pdf_snapshot(p_document_id uuid,p_lease_token uuid)
returns table(
  invoice_number text,trip_number text,truck_registration text,truck_type text,
  truck_capacity_tonnes numeric,truck_owner_name text,driver_name text,driver_phone text,
  driver_email text,driver_license text,loading_site_name text,offloading_site_name text,
  quantity_tonnes numeric,opened_at timestamptz,closed_at timestamptz,
  loading_officer_name text,offloading_officer_name text,issued_at timestamptz
)
language sql security definer set search_path = '' as $$
  select invoice.invoice_number,invoice.trip_number,invoice.truck_registration,invoice.truck_type,
    invoice.truck_capacity_tonnes,invoice.truck_owner_name,invoice.driver_name,invoice.driver_phone,
    invoice.driver_email,invoice.driver_license,invoice.loading_site_name,invoice.offloading_site_name,
    invoice.quantity_tonnes,invoice.opened_at,invoice.closed_at,invoice.loading_officer_name,
    invoice.offloading_officer_name,invoice.issued_at
  from public.trip_closure_invoice_documents document
  join public.trip_closure_invoices invoice
    on invoice.id=document.invoice_id and invoice.trip_id=document.trip_id
  where document.id=p_document_id and document.status='processing'
    and document.lease_token=p_lease_token and document.lease_until>clock_timestamp();
$$;
revoke all on function public.get_waybill_pdf_snapshot(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_waybill_pdf_snapshot(uuid,uuid) to service_role;

-- Replace all historic claim overloads. None can continue claiming trip_closed
-- payment notices or finance deliveries after cutover.
do $migration$
declare v_function record;
begin
  for v_function in
    select p.oid::regprocedure as signature from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('claim_trip_notifications','enqueue_waybill_ready_notifications')
  loop
    execute format('drop function %s',v_function.signature);
  end loop;
end;
$migration$;

create function public.enqueue_waybill_ready_notifications(p_company_recipient text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_recipient text:=nullif(btrim(p_company_recipient),''); v_updated integer:=0;
begin
  if v_recipient is not null and (length(v_recipient)>254
    or v_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'Invalid parent company recipient configuration' using errcode='22023';
  end if;

  if v_recipient is null then return 0; end if;
  update public.notification_outbox n
  set recipients=array[v_recipient],status='pending',blocked_reason_code=null,
      next_attempt_at=statement_timestamp(),last_error=null
  from public.trip_closure_invoice_documents d
  where n.trip_id=d.trip_id and n.event_type='waybill_ready' and n.audience='client'
    and n.delivery_sequence=0 and n.status='blocked_configuration'
    and d.status='ready' and d.ready_at is not null
    and d.storage_path=private.waybill_storage_path(d.invoice_number);
  get diagnostics v_updated=row_count;
  return v_updated;
end;
$$;
revoke all on function public.enqueue_waybill_ready_notifications(text) from public,anon,authenticated,service_role;
grant execute on function public.enqueue_waybill_ready_notifications(text) to service_role;

create function public.claim_waybill_notifications(p_sender text,p_limit integer default 5)
returns setof public.notification_outbox
language plpgsql security definer set search_path = '' as $$
declare v_job public.notification_outbox%rowtype;
begin
  if p_sender is null or length(btrim(p_sender))=0 or p_sender ~ E'[\r\n]'
    or p_limit is null or p_limit not between 1 and 10 then
    raise exception 'Invalid Waybill notification worker configuration' using errcode='22023';
  end if;
  update public.notification_outbox n
  set status='failed',lease_token=null,lease_until=null,last_error='Delivery retry limit reached',updated_at=statement_timestamp()
  where n.event_type='waybill_ready' and n.audience in ('driver','client')
    and n.status in ('pending','processing')
    and (n.status='pending' or n.lease_until is null or n.lease_until<statement_timestamp())
    and (n.attempts>=8 or n.first_attempt_at<statement_timestamp()-interval '23 hours');
  for v_job in
    select n.* from public.notification_outbox n
    join public.trip_closure_invoice_documents d on d.trip_id=n.trip_id
    where n.event_type='waybill_ready' and n.audience in ('driver','client')
      and n.status in ('pending','processing') and n.recipients is not null and cardinality(n.recipients)>0
      and ((n.status='pending' and n.next_attempt_at<=statement_timestamp())
        or (n.status='processing' and (n.lease_until is null or n.lease_until<statement_timestamp())))
      and d.status='ready' and d.ready_at is not null
      and d.invoice_number=n.payload->>'invoice_number'
      and d.storage_path=n.payload->>'storage_path'
      and d.storage_path=private.waybill_storage_path(d.invoice_number)
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
revoke all on function public.claim_waybill_notifications(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.claim_waybill_notifications(text,integer) to service_role;

create or replace function public.get_waybill_ready_pdf(p_notification_id uuid,p_lease_token uuid)
returns table(invoice_id uuid,invoice_number text,storage_path text)
language sql security definer set search_path = '' as $$
  select i.id,i.invoice_number,d.storage_path
  from public.notification_outbox n
  join public.trip_closure_invoice_documents d on d.trip_id=n.trip_id
    and d.invoice_id::text=n.payload->>'invoice_id'
  join public.trip_closure_invoices i on i.id=d.invoice_id and i.trip_id=d.trip_id
  where n.id=p_notification_id and n.event_type='waybill_ready' and n.audience in ('driver','client')
    and n.status='processing' and n.lease_token=p_lease_token and n.lease_until>clock_timestamp()
    and d.status='ready' and d.ready_at is not null
    and d.invoice_number=i.invoice_number and n.payload->>'invoice_number'=i.invoice_number
    and n.payload->>'storage_path'=d.storage_path
    and d.storage_path=private.waybill_storage_path(i.invoice_number);
$$;
revoke all on function public.get_waybill_ready_pdf(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_waybill_ready_pdf(uuid,uuid) to service_role;

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
    and n.lease_until>statement_timestamp();
  return found;
end;
$$;
revoke all on function public.finish_trip_notification(uuid,uuid,boolean,text,text) from public,anon,authenticated,service_role;
grant execute on function public.finish_trip_notification(uuid,uuid,boolean,text,text) to service_role;

-- Replace the PDF retry read model with aggregate/safe metadata functions.
create function public.get_admin_failed_waybill_pdfs()
returns table(document_id uuid,waybill_number text,trip_number text,status text,
  attempt_count integer,last_attempt_at timestamptz,failure_classification text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_role(array['system_administrator']::public.app_role[]);
  return query
  select d.id,i.invoice_number,i.trip_number,d.status::text,d.attempts,
    coalesce(d.processing_started_at,d.failed_at,d.updated_at),
    case d.last_error_code
      when 'invoice_snapshot_unavailable' then 'snapshot_unavailable'
      when 'invalid_invoice_snapshot' then 'snapshot_invalid'
      when 'pdf_generation_failed' then 'pdf_generation_failed'
      when 'storage_upload_failed' then 'storage_upload_failed'
      when 'attempt_limit_exhausted' then 'attempt_limit_exhausted'
      else 'unclassified' end
  from public.trip_closure_invoice_documents d
  join public.trip_closure_invoices i on i.id=d.invoice_id and i.trip_id=d.trip_id
  where d.status='failed' order by coalesce(d.failed_at,d.updated_at) desc,d.id;
end;
$$;

create function public.get_admin_waybill_pdf_status(p_document_id uuid)
returns table(document_id uuid,status text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_role(array['system_administrator']::public.app_role[]);
  return query select d.id,d.status::text from public.trip_closure_invoice_documents d where d.id=p_document_id;
end;
$$;
revoke all on function public.get_admin_failed_waybill_pdfs() from public,anon,authenticated,service_role;
revoke all on function public.get_admin_waybill_pdf_status(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_admin_failed_waybill_pdfs() to authenticated;
grant execute on function public.get_admin_waybill_pdf_status(uuid) to authenticated;

-- Remove payout rows from the Operations summary and activity feed while
-- preserving existing trip, exception, Waybill and PDF metrics.
create or replace function public.get_operations_dashboard_summary() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_day date; v_start timestamptz; v_end timestamptz; v_opened bigint; v_closed bigint;
  v_open bigint; v_tonnage numeric; v_trucks bigint; v_exception_count bigint;
  v_pdf_count bigint; v_email_count bigint; v_exceptions jsonb; v_pdfs jsonb; v_emails jsonb;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  v_day:=(statement_timestamp() at time zone 'Africa/Lagos')::date;
  v_start:=v_day::timestamp at time zone 'Africa/Lagos'; v_end:=(v_day+1)::timestamp at time zone 'Africa/Lagos';
  select count(*) filter(where opened_at>=v_start and opened_at<v_end),
    count(*) filter(where status='closed' and closed_at>=v_start and closed_at<v_end),
    count(*) filter(where status='open'),
    coalesce(sum(quantity_tonnes) filter(where status='closed' and closed_at>=v_start and closed_at<v_end),0),
    count(distinct truck_id) filter(where status='closed' and closed_at>=v_start and closed_at<v_end)
  into v_opened,v_closed,v_open,v_tonnage,v_trucks from public.trips;
  select count(*) into v_exception_count from public.exceptions where status::text<>'resolved';
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.exception_id),'[]'::jsonb) into v_exceptions
  from (select e.id exception_id,e.exception_type::text exception_type,t.trip_number,
    truck.registration_number truck_registration,e.created_at from public.exceptions e
    left join public.trips t on t.id=e.trip_id left join public.trucks truck on truck.id=e.truck_id
    where e.status::text<>'resolved' order by e.created_at,e.id limit 5) x;
  select count(*) into v_pdf_count from public.trip_closure_invoice_documents where status='failed';
  select coalesce(jsonb_agg(to_jsonb(x) order by x.failed_at,x.document_id),'[]'::jsonb) into v_pdfs
  from (select d.id document_id,i.invoice_number,i.trip_number,d.failed_at
    from public.trip_closure_invoice_documents d join public.trip_closure_invoices i
      on i.id=d.invoice_id and i.trip_id=d.trip_id
    where d.status='failed' order by d.failed_at,d.id limit 5) x;
  with latest as (select distinct on (trip_id,audience) id,trip_id,updated_at,status
    from public.notification_outbox where event_type='waybill_ready' and audience in ('driver','client')
    order by trip_id,audience,delivery_sequence desc,created_at desc,id desc)
  select count(*) into v_email_count from latest where status='failed';
  with latest as (select distinct on (trip_id,audience) id,trip_id,updated_at,status
    from public.notification_outbox where event_type='waybill_ready' and audience in ('driver','client')
    order by trip_id,audience,delivery_sequence desc,created_at desc,id desc)
  select coalesce(jsonb_agg(to_jsonb(x) order by x.failed_at,x.notification_id),'[]'::jsonb) into v_emails
  from (select n.id notification_id,i.invoice_number,i.trip_number,n.updated_at failed_at
    from latest n join public.trip_closure_invoices i on i.trip_id=n.trip_id
    where n.status='failed' order by n.updated_at,n.id limit 5) x;
  return jsonb_build_object('trips_opened_today',v_opened,'trips_closed_today',v_closed,
    'open_trips',v_open,'tonnage_today',v_tonnage,'trucks_processed_today',v_trucks,
    'exceptions_requiring_attention',v_exception_count,'action_required',jsonb_build_object(
      'unresolved_exceptions',jsonb_build_object('count',v_exception_count,'items',v_exceptions),
      'failed_waybill_pdfs',jsonb_build_object('count',v_pdf_count,'items',v_pdfs),
      'failed_waybill_emails',jsonb_build_object('count',v_email_count,'items',v_emails)));
end;
$$;

create or replace function public.get_operations_dashboard_activity(p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_as_of timestamptz:=statement_timestamp(); v_items jsonb;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_limit is null or p_limit not between 1 and 50 then raise exception 'Limit must be 1..50' using errcode='22023'; end if;
  with activity as (
    (select 'trip-opened:'||t.id::text event_id,'trip_opened'::text event_type,t.opened_at occurred_at,
      t.trip_number,tr.registration_number truck_registration,t.opened_by officer_id,null::text snapshot_officer_name,s.name site_name
     from public.trips t join public.trucks tr on tr.id=t.truck_id join public.sites s on s.id=t.loading_site_id
     order by t.opened_at desc,t.id desc limit p_limit)
    union all
    (select 'trip-closed:'||t.id::text,'trip_closed',t.closed_at,t.trip_number,tr.registration_number,t.closed_by,
      null::text,s.name from public.trips t join public.trucks tr on tr.id=t.truck_id
      join public.sites s on s.id=t.offloading_site_id where t.status='closed' and t.closed_at is not null
      order by t.closed_at desc,t.id desc limit p_limit)
    union all
    (select 'trip-cancelled:'||t.id::text,'trip_cancelled',t.cancelled_at,t.trip_number,tr.registration_number,t.cancelled_by,
      null::text,s.name from public.trips t join public.trucks tr on tr.id=t.truck_id
      join public.sites s on s.id=t.loading_site_id where t.status='cancelled' and t.cancelled_at is not null
      order by t.cancelled_at desc,t.id desc limit p_limit)
    union all
    (select 'exception-raised:'||e.id::text,'exception_raised',e.created_at,t.trip_number,tr.registration_number,
      e.reported_by,null::text,s.name from public.exceptions e left join public.trips t on t.id=e.trip_id
      left join public.trucks tr on tr.id=e.truck_id left join public.sites s on s.id=t.loading_site_id
      order by e.created_at desc,e.id desc limit p_limit)
    union all
    (select 'exception-resolved:'||e.id::text,'exception_resolved',e.resolved_at,t.trip_number,tr.registration_number,
      e.resolved_by,null::text,s.name from public.exceptions e left join public.trips t on t.id=e.trip_id
      left join public.trucks tr on tr.id=e.truck_id left join public.sites s on s.id=t.loading_site_id
      where e.status='resolved' and e.resolved_at is not null order by e.resolved_at desc,e.id desc limit p_limit)
    union all
    (select 'waybill-issued:'||i.id::text,'waybill_issued',i.issued_at,i.trip_number,i.truck_registration,
      i.offloading_officer_id,i.offloading_officer_name,i.offloading_site_name from public.trip_closure_invoices i
      order by i.issued_at desc,i.id desc limit p_limit)
    union all
    (select 'pdf-ready:'||d.id::text,'pdf_ready',d.ready_at,i.trip_number,i.truck_registration,null::uuid,
      null::text,i.offloading_site_name from public.trip_closure_invoice_documents d
      join public.trip_closure_invoices i on i.id=d.invoice_id and i.trip_id=d.trip_id
      where d.status='ready' and d.ready_at is not null order by d.ready_at desc,d.id desc limit p_limit)
  ), enriched as (
    select a.*,p.display_name current_officer_name,p.role officer_role from activity a
    left join public.profiles p on p.id=a.officer_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('event_id',event_id,'event_type',event_type,
    'occurred_at',occurred_at,'trip_number',trip_number,'truck_registration',truck_registration,
    'officer_id',officer_id,'officer_name',coalesce(nullif(btrim(snapshot_officer_name),''),nullif(btrim(current_officer_name),'')),
    'officer_role',officer_role,'site_name',site_name) order by occurred_at desc,event_id desc),'[]'::jsonb)
  into v_items from (select * from enriched order by occurred_at desc,event_id desc limit p_limit) x;
  return jsonb_build_object('as_of',v_as_of,'items',v_items);
end;
$$;

-- All operations Waybill reads are explicit allow-lists with no payment data,
-- provider errors, addresses, payloads, or storage paths.
drop function if exists public.get_operations_waybills(integer,integer,text,text,date,date,text,text,text);
create function public.get_operations_waybills(
  p_page integer default 1,p_page_size integer default 25,p_search text default null,
  p_quick_filter text default null,p_date_from date default null,p_date_to date default null,
  p_pdf_status text default null,p_delivery_status text default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_search text:=nullif(btrim(p_search),''); v_plate text; v_from timestamptz; v_until timestamptz;
  v_total bigint; v_items jsonb; v_offset bigint;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_page is null or p_page<1 or p_page_size is null or p_page_size not between 1 and 100
    or (p_date_from is not null and p_date_to is not null and p_date_from>p_date_to) then
    raise exception 'Invalid Waybill filters' using errcode='22023'; end if;
  if p_quick_filter is not null and p_quick_filter not in
    ('waybill_failed','delivery_failed','blocked_missing_email','blocked_configuration') then
    raise exception 'Invalid Waybill filter' using errcode='22023'; end if;
  if p_pdf_status is not null and p_pdf_status not in ('pending','processing','ready','failed') then
    raise exception 'Invalid PDF status' using errcode='22023'; end if;
  if p_delivery_status is not null and p_delivery_status not in
    ('not_queued','pending','processing','sent','failed','blocked_missing_email','blocked_configuration') then
    raise exception 'Invalid delivery status' using errcode='22023'; end if;
  v_plate:=case when v_search is null then null else public.normalize_plate(v_search) end;
  if p_date_from is not null then v_from:=p_date_from::timestamp at time zone 'Africa/Lagos'; end if;
  if p_date_to is not null then v_until:=(p_date_to+1)::timestamp at time zone 'Africa/Lagos'; end if;
  v_offset:=(p_page::bigint-1)*p_page_size;
  with rows as materialized (
    select i.id as invoice_id,i.invoice_number,i.trip_id,i.trip_number,i.truck_registration,
      i.driver_name,i.quantity_tonnes,i.closed_at,d.status as pdf_status,
      driver_job.status as driver_delivery_status,company_job.status as company_delivery_status
    from public.trip_closure_invoices i
    join public.trip_closure_invoice_documents d on d.invoice_id=i.id and d.trip_id=i.trip_id
    left join lateral (select n.status from public.notification_outbox n where n.trip_id=i.trip_id
      and n.event_type='waybill_ready' and n.audience='driver'
      order by n.delivery_sequence desc,n.created_at desc,n.id desc limit 1) driver_job on true
    left join lateral (select n.status from public.notification_outbox n where n.trip_id=i.trip_id
      and n.event_type='waybill_ready' and n.audience='client'
      order by n.delivery_sequence desc,n.created_at desc,n.id desc limit 1) company_job on true
    where (v_from is null or i.closed_at>=v_from) and (v_until is null or i.closed_at<v_until)
      and (v_search is null or position(lower(v_search) in lower(i.invoice_number))>0
        or position(lower(v_search) in lower(i.trip_number))>0
        or (v_plate is not null and position(v_plate in public.normalize_plate(i.truck_registration))>0)
        or position(lower(v_search) in lower(i.driver_name))>0)
      and (p_pdf_status is null or d.status=p_pdf_status)
      and (p_delivery_status is null or (p_delivery_status='not_queued' and driver_job.status is null and company_job.status is null)
        or driver_job.status=p_delivery_status or company_job.status=p_delivery_status)
      and (p_quick_filter is null
        or p_quick_filter='waybill_failed' and d.status='failed'
        or p_quick_filter='delivery_failed' and (driver_job.status='failed' or company_job.status='failed')
        or p_quick_filter='blocked_missing_email' and driver_job.status='blocked_missing_email'
        or p_quick_filter='blocked_configuration' and company_job.status='blocked_configuration')
  ), page_rows as (select * from rows order by closed_at desc,invoice_id desc limit p_page_size offset v_offset)
  select (select count(*) from rows),coalesce((select jsonb_agg(jsonb_build_object(
    'invoice_id',invoice_id,'invoice_number',invoice_number,'trip_id',trip_id,'trip_number',trip_number,
    'truck_registration',truck_registration,'driver_name',driver_name,'quantity_tonnes',quantity_tonnes,
    'closed_at',closed_at,'pdf_status',pdf_status,'driver_delivery_status',driver_delivery_status,
    'company_delivery_status',company_delivery_status) order by closed_at desc,invoice_id desc) from page_rows),'[]'::jsonb)
  into v_total,v_items;
  return jsonb_build_object('items',v_items,'page',p_page,'page_size',p_page_size,
    'total_count',v_total,'has_next',v_offset+jsonb_array_length(v_items)<v_total);
end;
$$;

create or replace function public.get_operations_waybill_detail(p_invoice_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  select jsonb_build_object(
    'invoice',jsonb_build_object('id',i.id,'invoice_number',i.invoice_number,'trip_id',i.trip_id,
      'trip_number',i.trip_number,'truck_registration',i.truck_registration,'truck_type',i.truck_type,
      'truck_capacity_tonnes',i.truck_capacity_tonnes,'truck_owner_name',i.truck_owner_name,
      'driver_id',i.driver_id,'driver_name',i.driver_name,'driver_phone',i.driver_phone,
      'driver_email_available',exists(select 1 from public.drivers d where d.id=i.driver_id and d.email is not null),
      'driver_license',i.driver_license,'loading_site_name',i.loading_site_name,
      'offloading_site_name',i.offloading_site_name,'loading_officer_name',i.loading_officer_name,
      'offloading_officer_name',i.offloading_officer_name,'opened_at',i.opened_at,
      'closed_at',i.closed_at,'issued_at',i.issued_at,'quantity_tonnes',i.quantity_tonnes),
    'document',jsonb_build_object('status',d.status,
      'storage_path',case when d.status='ready' and d.ready_at is not null
        and d.invoice_number=i.invoice_number and d.storage_path=private.waybill_storage_path(i.invoice_number)
        then d.storage_path else null end,'ready_at',d.ready_at),
    'delivery',jsonb_build_object('driver',driver_job.status,'company',company_job.status)) into v_result
  from public.trip_closure_invoices i
  join public.trip_closure_invoice_documents d on d.invoice_id=i.id and d.trip_id=i.trip_id
  left join lateral (select n.status from public.notification_outbox n where n.trip_id=i.trip_id
    and n.event_type='waybill_ready' and n.audience='driver'
    order by n.delivery_sequence desc,n.created_at desc,n.id desc limit 1) driver_job on true
  left join lateral (select n.status from public.notification_outbox n where n.trip_id=i.trip_id
    and n.event_type='waybill_ready' and n.audience='client'
    order by n.delivery_sequence desc,n.created_at desc,n.id desc limit 1) company_job on true
  where i.id=p_invoice_id;
  return v_result;
end;
$$;

create or replace function public.get_operations_trip_detail(p_trip_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  select jsonb_build_object(
    'trip',jsonb_build_object('trip_id',t.id,'trip_number',t.trip_number,'status',t.status::text,
      'truck_id',t.truck_id,'truck_registration',t.truck_registration_at_loading,
      'driver_id',t.driver_id,'driver_name',t.driver_name_at_loading,'loading_site_id',t.loading_site_id,
      'loading_site_name',coalesce(nullif(btrim(i.loading_site_name),''),ls.name),'opened_at',t.opened_at,
      'loading_officer',case when t.opened_by is null then null else jsonb_build_object(
        'officer_id',t.opened_by,'display_name',coalesce(nullif(btrim(i.loading_officer_name),''),nullif(btrim(lp.display_name),'')),
        'role',lp.role::text) end,
      'offloading_site_id',t.offloading_site_id,
      'offloading_site_name',coalesce(nullif(btrim(i.offloading_site_name),''),os.name),
      'closed_at',t.closed_at,'quantity_tonnes',t.quantity_tonnes,
      'estimated_quantity_tonnes',t.estimated_quantity_tonnes,
      'offloading_officer',case when t.closed_by is null then null else jsonb_build_object(
        'officer_id',t.closed_by,'display_name',coalesce(nullif(btrim(i.offloading_officer_name),''),nullif(btrim(op.display_name),'')),
        'role',op.role::text) end,
      'cancelled_at',t.cancelled_at,'cancelled_officer',case when t.cancelled_by is null then null else jsonb_build_object(
        'officer_id',t.cancelled_by,'display_name',nullif(btrim(cp.display_name),''),'role',cp.role::text) end),
    'waybill',case when i.id is null then null else jsonb_build_object(
      'invoice_number',i.invoice_number,'issued_at',i.issued_at,'pdf_status',d.status) end,
    'exceptions',coalesce(exceptions.items,'[]'::jsonb)) into v_result
  from public.trips t
  left join public.profiles lp on lp.id=t.opened_by
  left join public.profiles op on op.id=t.closed_by
  left join public.profiles cp on cp.id=t.cancelled_by
  left join public.sites ls on ls.id=t.loading_site_id
  left join public.sites os on os.id=t.offloading_site_id
  left join public.trip_closure_invoices i on i.trip_id=t.id and t.status='closed'
  left join public.trip_closure_invoice_documents d on d.trip_id=t.id and d.invoice_id=i.id and t.status='closed'
  left join lateral (select jsonb_agg(jsonb_build_object('exception_id',e.id,
    'exception_type',e.exception_type::text,'status',e.status::text,'raised_at',e.created_at,
    'resolved_at',e.resolved_at) order by e.created_at,e.id) items
    from public.exceptions e where e.trip_id=t.id) exceptions on true
  where t.id=p_trip_id;
  return v_result;
end;
$$;

create or replace function public.get_operations_waybill_delivery_history(
  p_invoice_id uuid,p_page integer default 1,p_page_size integer default 25
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_trip uuid; v_total bigint; v_items jsonb; v_offset bigint;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_page is null or p_page<1 or p_page_size is null or p_page_size not between 1 and 100 then
    raise exception 'Invalid page request' using errcode='22023'; end if;
  select trip_id into v_trip from public.trip_closure_invoices where id=p_invoice_id;
  if v_trip is null then return null; end if;
  v_offset:=(p_page::bigint-1)*p_page_size;
  select count(*) into v_total from public.notification_outbox
    where trip_id=v_trip and event_type='waybill_ready' and audience in ('driver','client');
  select coalesce(jsonb_agg(jsonb_build_object('notification_id',id,'audience',audience,
    'sequence',delivery_sequence,'status',status,'attempts',attempts,'created_at',created_at,
    'sent_at',sent_at,'requested_reason_code',requested_reason_code,
    'blocked_reason_code',blocked_reason_code) order by created_at desc,id desc),'[]'::jsonb) into v_items
  from (select id,audience,delivery_sequence,status,attempts,created_at,sent_at,
    requested_reason_code,blocked_reason_code from public.notification_outbox
    where trip_id=v_trip and event_type='waybill_ready' and audience in ('driver','client')
    order by created_at desc,id desc limit p_page_size offset v_offset) page_rows;
  return jsonb_build_object('items',v_items,'page',p_page,'page_size',p_page_size,
    'total_count',v_total,'has_next',v_offset+jsonb_array_length(v_items)<v_total);
end;
$$;

create or replace function public.resend_operations_waybill(
  p_invoice_id uuid,p_audience text,p_request_id uuid,p_reason_code text,
  p_duplicate_risk_confirmed boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_invoice public.trip_closure_invoices%rowtype; v_document public.trip_closure_invoice_documents%rowtype;
  v_existing public.notification_outbox%rowtype; v_latest public.notification_outbox%rowtype;
  v_new public.notification_outbox%rowtype; v_duplicate boolean;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_request_id is null or p_audience not in ('driver','client')
    or p_reason_code not in ('DRIVER_REQUEST','DELIVERY_UNCONFIRMED','CORRECTIVE_RESEND')
    or p_duplicate_risk_confirmed is null then raise exception 'Invalid resend request' using errcode='22023'; end if;
  select * into v_invoice from public.trip_closure_invoices where id=p_invoice_id;
  if not found then raise exception 'Waybill not found' using errcode='22023'; end if;
  select * into v_existing from public.notification_outbox where resend_request_id=p_request_id;
  if found then
    if v_existing.trip_id<>v_invoice.trip_id or v_existing.audience<>p_audience
      or v_existing.requested_by<>auth.uid() or v_existing.requested_reason_code<>p_reason_code
      or v_existing.duplicate_risk_confirmed<>p_duplicate_risk_confirmed then
      raise exception 'Resend request conflict' using errcode='P4091'; end if;
    return jsonb_build_object('sequence',v_existing.delivery_sequence,'status',v_existing.status);
  end if;
  select * into v_document from public.trip_closure_invoice_documents d
  where d.invoice_id=v_invoice.id and d.trip_id=v_invoice.trip_id and d.status='ready'
    and d.ready_at is not null and d.invoice_number=v_invoice.invoice_number
    and d.storage_path=private.waybill_storage_path(v_invoice.invoice_number);
  if not found then raise exception 'Ready Waybill PDF required' using errcode='P4091'; end if;
  select * into v_latest from public.notification_outbox n where n.trip_id=v_invoice.trip_id
    and n.event_type='waybill_ready' and n.audience=p_audience
    order by n.delivery_sequence desc,n.created_at desc,n.id desc limit 1 for update;
  if not found or v_latest.status in ('pending','processing','blocked_missing_email','blocked_configuration') then
    raise exception 'Delivery state does not allow a resend' using errcode='P4091'; end if;
  if v_latest.recipients is null or cardinality(v_latest.recipients)<>1 then
    raise exception 'Configured recipient is not available' using errcode='P4091'; end if;
  v_duplicate:=v_latest.status='sent' or (v_latest.status='failed' and
    (v_latest.first_attempt_at is null or v_latest.first_attempt_at<=statement_timestamp()-interval '23 hours'));
  if v_duplicate and not p_duplicate_risk_confirmed then
    raise exception 'Duplicate delivery risk confirmation required' using errcode='P4091'; end if;
  if v_latest.status='failed' and not v_duplicate then
    raise exception 'Retry the existing delivery within its provider safety window' using errcode='P4091'; end if;
  if v_latest.status='sent' and p_reason_code not in ('DRIVER_REQUEST','CORRECTIVE_RESEND') then
    raise exception 'Approved resend reason required' using errcode='22023'; end if;
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
declare v_invoice public.trip_closure_invoices%rowtype; v_job public.notification_outbox%rowtype;
  v_email text; v_reason text;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_audience not in ('driver','client') or p_reason_code not in ('DELIVERY_UNCONFIRMED','CORRECTIVE_RESEND') then
    raise exception 'Invalid retry request' using errcode='22023'; end if;
  select * into v_invoice from public.trip_closure_invoices where id=p_invoice_id;
  if not found then raise exception 'Waybill not found' using errcode='22023'; end if;
  select * into v_job from public.notification_outbox where trip_id=v_invoice.trip_id
    and event_type='waybill_ready' and audience=p_audience
    order by delivery_sequence desc,created_at desc,id desc limit 1 for update;
  if not found then raise exception 'Delivery record not found' using errcode='P4091'; end if;
  if v_job.status='blocked_missing_email' and p_audience='driver' then
    select nullif(btrim(email),'') into v_email from public.drivers where id=v_invoice.driver_id for share;
    if v_email is null then raise exception 'Driver email is still missing' using errcode='P4091'; end if;
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
  values('waybill_delivery_retry',v_job.id,'UPDATE',jsonb_build_object('status',v_job.status,
    'sequence',v_job.delivery_sequence,'audience',v_job.audience),
    jsonb_build_object('status','pending','sequence',v_job.delivery_sequence,'audience',v_job.audience),
    v_reason,auth.uid());
  return jsonb_build_object('notification_id',v_job.id,'status','pending','sequence',v_job.delivery_sequence);
end;
$$;

-- A1.2 response remains backward-compatible and adds separate blocked counts.
create or replace function public.get_operations_dashboard_queue_health() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_as_of timestamptz:=statement_timestamp(); v_result jsonb;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  with pdf as (
    select d.status::text status,d.next_attempt_at,d.lease_until,d.updated_at,d.created_at,d.id
    from public.trip_closure_invoice_documents d
  ), metrics as (
    select count(*) filter(where status='pending') pending_total,
      count(*) filter(where status='pending' and next_attempt_at is not null and next_attempt_at<=v_as_of) due_pending,
      count(*) filter(where status='processing') processing_total,
      count(*) filter(where status='processing' and lease_until>=v_as_of) active_processing,
      count(*) filter(where status='processing' and (lease_until is null or lease_until<v_as_of)) expired_processing_leases,
      count(*) filter(where status='failed') failed,count(*) filter(where status='ready') ready,
      count(*) filter(where status not in ('pending','processing','failed','ready')) unexpected_status
    from pdf
  )
  select jsonb_build_object('as_of',v_as_of,'pdf',jsonb_build_object(
    'pending_total',m.pending_total,'due_pending',m.due_pending,'processing_total',m.processing_total,
    'active_processing',m.active_processing,'expired_processing_leases',m.expired_processing_leases,
    'failed',m.failed,'ready',m.ready,'unexpected_status',m.unexpected_status,
    'latest_status',(select status from pdf order by updated_at desc,created_at desc,id desc limit 1),
    'latest_updated_at',(select updated_at from pdf order by updated_at desc,created_at desc,id desc limit 1)))
  into v_result from metrics m;

  with applicable as (
    select n.trip_id,n.event_type,n.audience,n.delivery_sequence,n.status::text status,
      n.next_attempt_at,n.lease_until,n.updated_at,n.created_at,n.id,n.blocked_reason_code
    from public.notification_outbox n where n.event_type='waybill_ready' and n.audience in ('driver','client')
  ), active as (select * from applicable where status in ('pending','processing')),
  blocked as (select * from applicable where status in ('blocked_missing_email','blocked_configuration')),
  terminal as (select distinct on (trip_id,event_type,audience) * from applicable
    where status not in ('pending','processing','blocked_missing_email','blocked_configuration')
    order by trip_id,event_type,audience,delivery_sequence desc,created_at desc,updated_at desc,id desc),
  current_rows as (
    select * from active union all select * from blocked
    union all select t.* from terminal t where not exists(select 1 from active a where a.trip_id=t.trip_id and a.event_type=t.event_type and a.audience=t.audience)
      and not exists(select 1 from blocked b where b.trip_id=t.trip_id and b.event_type=t.event_type and b.audience=t.audience)
  ), nmetrics as (
    select count(*) filter(where status='pending') pending_total,
      count(*) filter(where status='pending' and next_attempt_at is not null and next_attempt_at<=v_as_of) due_pending,
      count(*) filter(where status='processing') processing_total,
      count(*) filter(where status='processing' and lease_until>=v_as_of) active_processing,
      count(*) filter(where status='processing' and (lease_until is null or lease_until<v_as_of)) expired_processing_leases,
      count(*) filter(where status='failed') failed,count(*) filter(where status='sent') provider_accepted,
      count(*) filter(where status='blocked_missing_email') blocked_missing_email,
      count(*) filter(where status='blocked_configuration') blocked_configuration,
      count(*) filter(where status not in ('pending','processing','failed','sent','blocked_missing_email','blocked_configuration')) unexpected_status
    from current_rows
  )
  select v_result||jsonb_build_object('notifications',jsonb_build_object(
    'pending_total',m.pending_total,'due_pending',m.due_pending,'processing_total',m.processing_total,
    'active_processing',m.active_processing,'expired_processing_leases',m.expired_processing_leases,
    'failed',m.failed,'provider_accepted',m.provider_accepted,
    'blocked_missing_email',m.blocked_missing_email,'blocked_configuration',m.blocked_configuration,
    'unexpected_status',m.unexpected_status,
    'latest_status',(select case status when 'sent' then 'provider_accepted' else status end from current_rows
      order by updated_at desc,delivery_sequence desc,created_at desc,id desc limit 1),
    'latest_updated_at',(select updated_at from current_rows order by updated_at desc,delivery_sequence desc,created_at desc,id desc limit 1)))
  into v_result from nmetrics m;
  return v_result;
end;
$$;

-- Payment tables and routines remain for historical retention but are not an
-- application or service-role API. No active worker may keep using them.
do $migration$
declare v_function record; v_table text;
begin
  for v_function in
    select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname ilike '%paystack%' or p.proname ilike '%payout%'
      or p.proname ilike '%payment%' or p.proname in ('retry_trip_notification'))
  loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v_function.signature);
  end loop;
  foreach v_table in array array['trip_payments','driver_payment_details','payment_profiles','payout_batches','payout_items'] loop
    if to_regclass('public.'||v_table) is not null then
      execute format('revoke all on table public.%I from public,anon,authenticated,service_role',v_table);
    end if;
  end loop;
end;
$migration$;

revoke all on public.trip_closure_invoices,public.trip_closure_invoice_documents,public.notification_outbox
  from public,anon,authenticated,service_role;
revoke all on function public.get_operations_waybills(integer,integer,text,text,date,date,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.get_operations_waybill_detail(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_operations_waybill_delivery_history(uuid,integer,integer) from public,anon,authenticated,service_role;
revoke all on function public.resend_operations_waybill(uuid,text,uuid,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.retry_operations_waybill_delivery(uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.get_operations_dashboard_queue_health() from public,anon,authenticated,service_role;
grant execute on function public.get_operations_waybills(integer,integer,text,text,date,date,text,text) to authenticated;
grant execute on function public.get_operations_waybill_detail(uuid) to authenticated;
grant execute on function public.get_operations_waybill_delivery_history(uuid,integer,integer) to authenticated;
grant execute on function public.resend_operations_waybill(uuid,text,uuid,text,boolean) to authenticated;
grant execute on function public.retry_operations_waybill_delivery(uuid,text,text) to authenticated;
grant execute on function public.get_operations_dashboard_queue_health() to authenticated;

comment on function public.get_operations_dashboard_queue_health() is
  'Server-time queue snapshot for active Operations Managers. due_pending is a subset of pending_total; expired_processing_leases is a subset of processing_total. Notification counts include only current waybill_ready driver/client streams; blocked_missing_email and blocked_configuration are separate from pending, processing, failed, and provider_accepted. provider_accepted is not confirmed mailbox delivery. Queue status does not establish worker execution health.';

commit;
