begin;

do $preflight$
begin
  if to_regclass('vault.decrypted_secrets') is null
    or to_regclass('private.waybill_notification_canary_runs') is null
    or to_regclass('private.waybill_email_historical_allowlist') is null
    or to_regclass('private.loading_registration_bank_captures') is null
    or to_regclass('public.trip_closure_invoice_pdf_copies') is null then
    raise exception 'Vault, registration capture, secure PDF, and email-cutover prerequisites are required.';
  end if;
  if exists (select 1 from public.trip_closure_invoices where invoice_number='WB-9999-999999') then
    raise exception 'Reserved synthetic Waybill number already exists; migration stopped without changing it.';
  end if;
end;
$preflight$;

create function private.waybill_email_canary_environment_enabled()
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  return exists (
    select 1 from vault.decrypted_secrets secret
    where secret.name='trakflit_email_canary_project_ref'
      and secret.decrypted_secret='pidxlopbxlapfmakmtjt'
  ) and exists (
    select 1 from vault.decrypted_secrets secret
    where secret.name='trakflit_email_canary_enabled'
      and secret.decrypted_secret='true'
  );
exception when others then
  return false;
end;
$$;

create table private.waybill_synthetic_email_canary_permits (
  trip_id uuid primary key references public.trips(id) on delete restrict,
  driver_id uuid not null references public.drivers(id) on delete restrict,
  truck_id uuid not null references public.trucks(id) on delete restrict,
  bank_capture_id uuid not null references private.loading_registration_bank_captures(id) on delete restrict,
  driver_recipient text not null check (driver_recipient='synthetic-driver@example.invalid'),
  company_recipient text not null check (company_recipient='synthetic-company@example.invalid'),
  authorized_by text not null,
  authorized_at timestamptz not null default statement_timestamp(),
  invoice_id uuid unique references public.trip_closure_invoices(id) on delete restrict,
  consumed_at timestamptz,
  check ((invoice_id is null and consumed_at is null) or (invoice_id is not null and consumed_at is not null))
);
create unique index waybill_synthetic_email_canary_one_unconsumed
  on private.waybill_synthetic_email_canary_permits((true)) where invoice_id is null;
alter table private.waybill_synthetic_email_canary_permits enable row level security;
revoke all on private.waybill_synthetic_email_canary_permits from public,anon,authenticated,service_role;

create function private.guard_waybill_synthetic_email_canary_permit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_trip public.trips%rowtype;
begin
  if tg_op='DELETE' or tg_op='TRUNCATE' then
    raise exception 'Synthetic canary authorization history is immutable.' using errcode='42501';
  end if;
  if tg_op='UPDATE' then
    if old.invoice_id is not null or new.trip_id is distinct from old.trip_id
      or new.driver_id is distinct from old.driver_id or new.truck_id is distinct from old.truck_id
      or new.bank_capture_id is distinct from old.bank_capture_id
      or new.driver_recipient is distinct from old.driver_recipient
      or new.company_recipient is distinct from old.company_recipient
      or new.authorized_by is distinct from old.authorized_by
      or new.authorized_at is distinct from old.authorized_at
      or new.invoice_id is null or new.consumed_at is null
      or not exists (select 1 from public.trip_closure_invoices invoice
        where invoice.id=new.invoice_id and invoice.trip_id=new.trip_id
          and invoice.invoice_number='WB-9999-999999') then
      raise exception 'A synthetic canary permit can only be consumed by its reserved invoice.' using errcode='42501';
    end if;
    return new;
  end if;

  if not private.waybill_email_canary_environment_enabled() then
    raise exception 'Synthetic email canary is not enabled for the bound DEVELOPMENT project.' using errcode='42501';
  end if;
  select trip.* into v_trip from public.trips trip
  join public.trucks truck on truck.id=trip.truck_id and truck.driver_id=trip.driver_id
  join public.drivers driver on driver.id=trip.driver_id
  join public.user_site_assignments assignment on assignment.id=trip.loading_assignment_id
    and assignment.profile_id=trip.opened_by and assignment.site_id=trip.loading_site_id
    and assignment.ended_at is null
  join private.loading_registration_bank_captures capture on capture.driver_id=trip.driver_id
    and capture.id=new.bank_capture_id
  where trip.id=new.trip_id and trip.status='open'
    and trip.opened_at>'2026-10-20T21:34:05.976714Z'::timestamptz
    and driver.id=new.driver_id and driver.full_name='Synthetic Email Canary Driver'
    and driver.email=new.driver_recipient and driver.phone_number='08000000000'
    and truck.id=new.truck_id and truck.normalized_registration='SYNTHCANARY999'
    and capture.bank_name='Synthetic Test Bank'
    and capture.account_number='0000000000'
    and capture.account_name='Synthetic Test Only'
    and exists (select 1 from private.loading_request_receipts receipt
      where receipt.actor_id=capture.captured_by
        and receipt.operation='register_loading_participant_payment_free_v3'
        and receipt.request_id=capture.registration_request_id)
    and exists (select 1 from public.profiles loader
      where loader.id=capture.captured_by and loader.role='loading_officer' and loader.is_active)
    and not exists (select 1 from public.trips other_trip
      where other_trip.id<>trip.id and (other_trip.driver_id=trip.driver_id or other_trip.truck_id=trip.truck_id))
    and not exists (select 1 from public.trip_closure_invoices invoice
      where invoice.driver_id=trip.driver_id or invoice.truck_id=trip.truck_id);
  if not found then
    raise exception 'Trip does not satisfy the isolated synthetic canary requirements.' using errcode='42501';
  end if;
  return new;
end;
$$;
create trigger waybill_synthetic_email_canary_permit_guard
before insert or update or delete on private.waybill_synthetic_email_canary_permits
for each row execute function private.guard_waybill_synthetic_email_canary_permit();
create trigger waybill_synthetic_email_canary_permit_truncate_guard
before truncate on private.waybill_synthetic_email_canary_permits
for each statement execute function private.guard_waybill_synthetic_email_canary_permit();
revoke all on function private.guard_waybill_synthetic_email_canary_permit() from public,anon,authenticated,service_role;

create function public.authorize_waybill_synthetic_email_canary_trip(p_trip_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_capture private.loading_registration_bank_captures%rowtype;
begin
  if p_trip_id is null or not private.waybill_email_canary_environment_enabled() then
    raise exception 'Synthetic email canary is not authorized in this project.' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('synthetic-email-canary:'||p_trip_id::text,0));
  select capture.* into v_capture
  from public.trips trip
  join private.loading_registration_bank_captures capture on capture.driver_id=trip.driver_id
  where trip.id=p_trip_id and trip.status='open'
    and trip.opened_at>'2026-10-20T21:34:05.976714Z'::timestamptz
    and not exists (select 1 from public.trip_closure_invoices invoice
      where invoice.trip_id=trip.id or invoice.invoice_number='WB-9999-999999')
  for share of trip,capture;
  if not found then
    raise exception 'No eligible open synthetic trip exists.' using errcode='42501';
  end if;
  insert into private.waybill_synthetic_email_canary_permits(
    trip_id,driver_id,truck_id,bank_capture_id,driver_recipient,company_recipient,authorized_by
  )
  select trip.id,trip.driver_id,trip.truck_id,v_capture.id,
    'synthetic-driver@example.invalid','synthetic-company@example.invalid',session_user::text
  from public.trips trip where trip.id=p_trip_id;
  insert into public.audit_log(entity_name,entity_id,action,new_value,reason,actor_id)
  values('waybill_synthetic_email_canary',p_trip_id,'INSERT',
    jsonb_build_object('purpose','synthetic_development_test'),
    'development_synthetic_canary_authorized',null);
  return true;
end;
$$;
revoke all on function public.authorize_waybill_synthetic_email_canary_trip(uuid) from public,anon,authenticated,service_role;
grant execute on function public.authorize_waybill_synthetic_email_canary_trip(uuid) to service_role;

create or replace function private.queue_trip_closure_invoice_pdf() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.invoice_number='WB-9999-999999' and exists (
    select 1 from private.waybill_synthetic_email_canary_permits permit
    where permit.trip_id=new.trip_id and permit.driver_id=new.driver_id
      and permit.truck_id=new.truck_id and (permit.invoice_id is null or permit.invoice_id=new.id)
  ) then
    return null;
  end if;
  insert into public.trip_closure_invoice_documents(invoice_id,trip_id,invoice_number,storage_path)
  values(new.id,new.trip_id,new.invoice_number,private.waybill_storage_path(new.invoice_number))
  on conflict(invoice_id) do nothing;
  return null;
end;
$$;

create or replace function private.claim_waybill_pdf_copy_jobs(p_copy_kind text,p_limit integer,p_invoice_id uuid default null)
returns table(copy_id uuid,invoice_id uuid,trip_id uuid,invoice_number text,
  storage_bucket text,storage_path text,attempts integer,lease_token uuid,lease_until timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_job record;
begin
  if p_copy_kind is null or p_copy_kind not in ('driver','company')
    or p_limit is null or p_limit not between 1 and 10 then
    raise exception 'Invalid Waybill copy claim request' using errcode='22023';
  end if;
  update public.trip_closure_invoice_pdf_copies pdf_copy
  set status='failed',failed_at=clock_timestamp(),lease_token=null,lease_until=null,
    last_error_code='attempt_limit_exhausted'
  where pdf_copy.copy_kind=p_copy_kind and pdf_copy.invoice_number<>'WB-9999-999999'
    and pdf_copy.attempts>=5 and (p_invoice_id is null or pdf_copy.invoice_id=p_invoice_id)
    and ((pdf_copy.status='pending' and pdf_copy.next_attempt_at<=clock_timestamp())
      or (pdf_copy.status='processing' and pdf_copy.lease_until<clock_timestamp()));
  for v_job in
    select pdf_copy.id from public.trip_closure_invoice_pdf_copies pdf_copy
    where pdf_copy.copy_kind=p_copy_kind and pdf_copy.invoice_number<>'WB-9999-999999'
      and pdf_copy.attempts<5 and (p_invoice_id is null or pdf_copy.invoice_id=p_invoice_id)
      and ((pdf_copy.status='pending' and pdf_copy.next_attempt_at<=clock_timestamp())
        or (pdf_copy.status='processing' and pdf_copy.lease_until<clock_timestamp()))
      and (pdf_copy.copy_kind<>'company' or pdf_copy.bank_snapshot_id is not null)
    order by pdf_copy.created_at,pdf_copy.id for update skip locked limit p_limit
  loop
    return query
    update public.trip_closure_invoice_pdf_copies pdf_copy
    set status='processing',attempts=pdf_copy.attempts+1,
      processing_started_at=clock_timestamp(),lease_token=gen_random_uuid(),
      lease_until=clock_timestamp()+interval '5 minutes',last_error_code=null
    where pdf_copy.id=v_job.id
    returning pdf_copy.id,pdf_copy.invoice_id,pdf_copy.trip_id,pdf_copy.invoice_number,
      pdf_copy.storage_bucket,pdf_copy.storage_path,pdf_copy.attempts,pdf_copy.lease_token,pdf_copy.lease_until;
  end loop;
end;
$$;

revoke all on function private.claim_waybill_pdf_copy_jobs(text,integer,uuid) from public,anon,authenticated,service_role;

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
  v_permit private.waybill_synthetic_email_canary_permits%rowtype;
  v_synthetic boolean:=false;
begin
  if new.status<>'closed' then return null; end if;
  select permit.* into v_permit from private.waybill_synthetic_email_canary_permits permit
  where permit.trip_id=new.id and permit.invoice_id is null for update;
  v_synthetic:=found;

  select name into strict v_loading_name from public.sites where id=new.loading_site_id;
  select name into strict v_offloading_name from public.sites where id=new.offloading_site_id;
  select coalesce(nullif(btrim(display_name),''),'Loading Officer ('||new.opened_by::text||')')
    into strict v_loading_officer_name from public.profiles where id=new.opened_by;
  select coalesce(nullif(btrim(display_name),''),'Offloading Officer ('||new.closed_by::text||')')
    into strict v_offloading_officer_name from public.profiles where id=new.closed_by;
  select email into strict v_driver_email from public.drivers where id=new.driver_id for share;
  v_driver_email:=nullif(btrim(v_driver_email),'');

  if v_synthetic then
    if not private.waybill_email_canary_environment_enabled()
      or new.driver_id is distinct from v_permit.driver_id
      or new.truck_id is distinct from v_permit.truck_id
      or new.closed_at<='2026-10-20T21:34:05.976714Z'::timestamptz
      or exists(select 1 from public.trip_closure_invoices where invoice_number='WB-9999-999999') then
      raise exception 'Reserved synthetic invoice closure failed its DEVELOPMENT isolation checks.' using errcode='42501';
    end if;
    v_number:='WB-9999-999999';
  else
    v_number:='WB-'||to_char(new.closed_at at time zone 'Africa/Lagos','YYYY')||'-'||
      lpad(nextval('private.trip_closure_invoice_seq')::text,6,'0');
  end if;

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
  ) on conflict(trip_id) do nothing;
  select * into strict v_invoice from public.trip_closure_invoices where trip_id=new.id;

  if v_synthetic then
    if v_invoice.invoice_number<>'WB-9999-999999' then
      raise exception 'Synthetic trip did not produce its reserved invoice.' using errcode='23514';
    end if;
    update private.waybill_synthetic_email_canary_permits
    set invoice_id=v_invoice.id,consumed_at=statement_timestamp()
    where trip_id=new.id and invoice_id is null;
    if not found then raise exception 'Synthetic invoice permit was not consumed.' using errcode='23514'; end if;
    insert into public.audit_log(entity_name,entity_id,action,new_value,reason,actor_id)
    values('waybill_synthetic_email_canary',new.id,'INSERT',
      jsonb_build_object('invoice_number','WB-9999-999999'),
      'development_synthetic_canary_invoice_created',null);
    return null;
  end if;

  select * into strict v_document from public.trip_closure_invoice_documents
  where invoice_id=v_invoice.id and trip_id=v_invoice.trip_id;
  v_payload:=jsonb_build_object('invoice_id',v_invoice.id,'invoice_number',v_invoice.invoice_number,
    'trip_number',v_invoice.trip_number,'storage_path',v_document.storage_path);
  insert into public.notification_outbox(trip_id,event_type,audience,delivery_sequence,
    recipients,payload,status,blocked_reason_code)
  values(new.id,'waybill_ready','driver',0,
    case when v_driver_email is null then null else array[v_driver_email] end,v_payload,
    case when v_driver_email is null then 'blocked_missing_email' else 'pending' end,
    case when v_driver_email is null then 'missing_driver_email' else null end)
  on conflict(trip_id,event_type,audience,delivery_sequence) do nothing;
  insert into public.notification_outbox(trip_id,event_type,audience,delivery_sequence,
    recipients,payload,status,blocked_reason_code,last_error)
  values(new.id,'waybill_ready','client',0,null,v_payload,'blocked_configuration',
    'company_recipient_not_configured','Parent company recipient must be configured')
  on conflict(trip_id,event_type,audience,delivery_sequence) do nothing;
  return null;
end;
$$;

create function public.claim_waybill_synthetic_canary_pdf_jobs(p_invoice_id uuid,p_copy_kind text)
returns table(copy_id uuid,invoice_id uuid,trip_id uuid,invoice_number text,
  storage_bucket text,storage_path text,attempts integer,lease_token uuid,lease_until timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_invoice public.trip_closure_invoices%rowtype;
begin
  if p_invoice_id is null or p_copy_kind is null or p_copy_kind not in ('driver','company')
    or not private.waybill_email_canary_environment_enabled() then
    raise exception 'Synthetic PDF canary is not enabled.' using errcode='42501';
  end if;
  select invoice.* into v_invoice from public.trip_closure_invoices invoice
  join public.trips trip on trip.id=invoice.trip_id and trip.status='closed' and trip.closed_at=invoice.closed_at
  join private.waybill_synthetic_email_canary_permits permit
    on permit.invoice_id=invoice.id and permit.trip_id=trip.id and permit.consumed_at is not null
  where invoice.id=p_invoice_id and invoice.invoice_number='WB-9999-999999';
  if not found then raise exception 'Invoice is not the authorized synthetic canary.' using errcode='42501'; end if;
  if p_copy_kind='company' and not exists (
    select 1 from public.trip_closure_invoice_pdf_copies copy
    join public.trip_closure_invoice_bank_snapshots snapshot
      on snapshot.id=copy.bank_snapshot_id and snapshot.invoice_id=copy.invoice_id and snapshot.trip_id=copy.trip_id
    where copy.invoice_id=p_invoice_id and copy.copy_kind='company'
      and snapshot.verified_by is not null and snapshot.verified_at is not null
  ) then return; end if;
  update public.trip_closure_invoice_pdf_copies copy
  set status='failed',failed_at=clock_timestamp(),lease_token=null,lease_until=null,
    last_error_code='attempt_limit_exhausted'
  where copy.invoice_id=p_invoice_id and copy.copy_kind=p_copy_kind and copy.attempts>=5
    and ((copy.status='pending' and copy.next_attempt_at<=clock_timestamp())
      or (copy.status='processing' and copy.lease_until<clock_timestamp()));
  return query
  with candidate as (
    select copy.id from public.trip_closure_invoice_pdf_copies copy
    where copy.invoice_id=p_invoice_id and copy.copy_kind=p_copy_kind and copy.attempts<5
      and copy.copy_version=(select max(latest.copy_version)
        from public.trip_closure_invoice_pdf_copies latest
        where latest.invoice_id=copy.invoice_id and latest.copy_kind=copy.copy_kind)
      and copy.storage_bucket=case p_copy_kind when 'driver' then 'waybill-driver-copies' else 'waybill-company-copies' end
      and copy.storage_path=private.secure_waybill_copy_storage_path(v_invoice.invoice_number,p_copy_kind,copy.copy_version)
      and (p_copy_kind<>'driver' or copy.bank_snapshot_id is null)
      and (p_copy_kind<>'company' or exists (
        select 1 from public.trip_closure_invoice_bank_snapshots snapshot
        where snapshot.id=copy.bank_snapshot_id and snapshot.invoice_id=copy.invoice_id
          and snapshot.trip_id=copy.trip_id and snapshot.verified_by is not null and snapshot.verified_at is not null
      ))
      and ((copy.status='pending' and copy.next_attempt_at<=clock_timestamp())
        or (copy.status='processing' and copy.lease_until<clock_timestamp()))
    order by copy.copy_version desc for update skip locked limit 1
  )
  update public.trip_closure_invoice_pdf_copies copy
  set status='processing',attempts=copy.attempts+1,processing_started_at=clock_timestamp(),
    lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes',last_error_code=null
  from candidate where copy.id=candidate.id
  returning copy.id,copy.invoice_id,copy.trip_id,copy.invoice_number,copy.storage_bucket,
    copy.storage_path,copy.attempts,copy.lease_token,copy.lease_until;
end;
$$;
revoke all on function public.claim_waybill_synthetic_canary_pdf_jobs(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_waybill_synthetic_canary_pdf_jobs(uuid,text) to service_role;

create function private.waybill_synthetic_canary_company_copy_allowed(
  p_invoice_id uuid,p_trip_id uuid,p_copy_version integer,p_bank_snapshot_id uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select p_invoice_id is not null and p_trip_id is not null
    and p_copy_version=2 and p_bank_snapshot_id is not null
    and private.waybill_email_canary_environment_enabled()
    and exists (
      select 1 from public.trip_closure_invoices invoice
      join public.trips trip on trip.id=invoice.trip_id
        and trip.status='closed' and trip.closed_at=invoice.closed_at
      join private.waybill_synthetic_email_canary_permits permit
        on permit.trip_id=trip.id and permit.invoice_id=invoice.id and permit.consumed_at is not null
      join public.trip_closure_invoice_pdf_copies company_copy
        on company_copy.invoice_id=invoice.id and company_copy.trip_id=trip.id
          and company_copy.copy_kind='company' and company_copy.copy_version=2
      join public.trip_closure_invoice_bank_snapshots snapshot
        on snapshot.id=company_copy.bank_snapshot_id and snapshot.invoice_id=invoice.id
          and snapshot.trip_id=trip.id and snapshot.version=2
      where invoice.id=p_invoice_id and invoice.trip_id=p_trip_id
        and invoice.invoice_number='WB-9999-999999'
        and invoice.closed_at>'2026-10-20T21:34:05.976714Z'::timestamptz
        and company_copy.bank_snapshot_id=p_bank_snapshot_id
        and company_copy.notification_eligible=false
        and company_copy.status='ready' and company_copy.ready_at is not null
        and company_copy.storage_bucket='waybill-company-copies'
        and company_copy.storage_path=private.secure_waybill_copy_storage_path(
          invoice.invoice_number,'company',company_copy.copy_version)
        and snapshot.source_kind='operations_manager'
        and snapshot.verified_by is not null and snapshot.verified_at is not null
    );
$$;

create function private.waybill_synthetic_email_canary_pdfs_ready(p_invoice_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.waybill_email_canary_environment_enabled() and exists (
    select 1 from public.trip_closure_invoices invoice
    join public.trips trip on trip.id=invoice.trip_id and trip.status='closed' and trip.closed_at=invoice.closed_at
    join private.waybill_synthetic_email_canary_permits permit
      on permit.invoice_id=invoice.id and permit.trip_id=trip.id and permit.consumed_at is not null
    join public.trip_closure_invoice_pdf_copies driver_copy
      on driver_copy.invoice_id=invoice.id and driver_copy.trip_id=trip.id and driver_copy.copy_kind='driver'
    join public.trip_closure_invoice_pdf_copies company_copy
      on company_copy.invoice_id=invoice.id and company_copy.trip_id=trip.id and company_copy.copy_kind='company'
    join public.trip_closure_invoice_bank_snapshots snapshot
      on snapshot.id=company_copy.bank_snapshot_id and snapshot.invoice_id=invoice.id and snapshot.trip_id=trip.id
    where invoice.id=p_invoice_id and invoice.invoice_number='WB-9999-999999'
      and driver_copy.copy_version=(select max(copy_version) from public.trip_closure_invoice_pdf_copies
        where invoice_id=invoice.id and copy_kind='driver')
      and company_copy.copy_version=(select max(copy_version) from public.trip_closure_invoice_pdf_copies
        where invoice_id=invoice.id and copy_kind='company')
      and driver_copy.status='ready' and driver_copy.ready_at is not null and driver_copy.notification_eligible
      and driver_copy.bank_snapshot_id is null
      and driver_copy.storage_bucket='waybill-driver-copies'
      and driver_copy.storage_path=private.secure_waybill_copy_storage_path(invoice.invoice_number,'driver',driver_copy.copy_version)
      and company_copy.status='ready' and company_copy.ready_at is not null
      and (company_copy.notification_eligible or private.waybill_synthetic_canary_company_copy_allowed(
        invoice.id,trip.id,company_copy.copy_version,company_copy.bank_snapshot_id))
      and company_copy.storage_bucket='waybill-company-copies'
      and company_copy.storage_path=private.secure_waybill_copy_storage_path(invoice.invoice_number,'company',company_copy.copy_version)
      and snapshot.verified_by is not null and snapshot.verified_at is not null
      and invoice.driver_email='synthetic-driver@example.invalid'
      and exists (select 1 from storage.objects object
        where object.bucket_id=driver_copy.storage_bucket and object.name=driver_copy.storage_path
          and object.metadata->>'mimetype'='application/pdf'
          and coalesce((object.metadata->>'size')::bigint,0)>0)
      and exists (select 1 from storage.objects object
        where object.bucket_id=company_copy.storage_bucket and object.name=company_copy.storage_path
          and object.metadata->>'mimetype'='application/pdf'
          and coalesce((object.metadata->>'size')::bigint,0)>0)
  );
$$;

create or replace function private.waybill_email_canary_delivery_allowed(p_invoice_id uuid,p_trip_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.waybill_synthetic_email_canary_pdfs_ready(p_invoice_id) and exists (
    select 1 from private.waybill_notification_canary_runs canary
    where canary.invoice_id=p_invoice_id and canary.trip_id=p_trip_id
      and canary.disarmed_at is null and canary.expires_at>statement_timestamp()
      and canary.purpose='synthetic_development_test'
  );
$$;

create or replace function public.claim_waybill_notification_canary(
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
        and c.status='ready' and c.ready_at is not null
        and (c.notification_eligible or private.waybill_synthetic_canary_company_copy_allowed(
          v_invoice.id,v_invoice.trip_id,c.copy_version,c.bank_snapshot_id))
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
      and c.status='ready' and c.ready_at is not null
      and (c.notification_eligible or (n.audience='client'
        and private.waybill_synthetic_canary_company_copy_allowed(
          v_invoice.id,v_invoice.trip_id,c.copy_version,c.bank_snapshot_id)))
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
    and c.status='ready' and c.ready_at is not null
    and (c.notification_eligible or (c.copy_kind='company'
      and private.waybill_email_canary_delivery_allowed(invoice.id,invoice.trip_id)
      and private.waybill_synthetic_canary_company_copy_allowed(
        invoice.id,invoice.trip_id,c.copy_version,c.bank_snapshot_id)))
    and (c.copy_kind<>'company' or c.bank_snapshot_id is not null)
    and c.copy_version=(select max(x.copy_version) from public.trip_closure_invoice_pdf_copies x
      where x.invoice_id=invoice.id and x.copy_kind=c.copy_kind);
$$;

create or replace function private.guard_waybill_notification_canary_run() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_invoice_number text;
begin
  if tg_op in ('TRUNCATE','DELETE') then
    raise exception 'Notification canary history cannot be deleted or truncated.' using errcode='42501';
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
        and notification.status='processing') then
      raise exception 'Cannot disarm a canary while an email lease is active or ambiguous.' using errcode='55000';
    end if;
    return new;
  end if;
  lock table public.notification_outbox in share row exclusive mode;
  if not private.waybill_email_canary_environment_enabled()
    or exists (select 1 from public.notification_outbox notification
      where notification.event_type in ('trip_closed','waybill_ready') and notification.status='processing') then
    raise exception 'Canary requires the bound DEVELOPMENT project and no active notification leases.' using errcode='55000';
  end if;
  select invoice.invoice_number into v_invoice_number
  from public.trip_closure_invoices invoice
  join private.waybill_synthetic_email_canary_permits permit
    on permit.invoice_id=invoice.id and permit.trip_id=invoice.trip_id
  where invoice.id=new.invoice_id and invoice.trip_id=new.trip_id;
  if new.disarmed_at is not null or new.purpose<>'synthetic_development_test'
    or new.expires_at<=statement_timestamp()+interval '30 seconds'
    or new.expires_at>statement_timestamp()+interval '10 minutes'
    or v_invoice_number<>'WB-9999-999999'
    or not private.waybill_synthetic_email_canary_pdfs_ready(new.invoice_id) then
    raise exception 'Canary requires the reserved synthetic invoice and both verified private PDFs.' using errcode='42501';
  end if;
  return new;
end;
$$;

create or replace function private.guard_notification_delivery_cutover() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_invoice_id uuid; v_run_expired boolean:=false;
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
    if private.waybill_email_canary_delivery_allowed((new.payload->>'invoice_id')::uuid,new.trip_id)
      and ((new.audience='driver' and new.recipients is distinct from array['synthetic-driver@example.invalid']::text[])
        or (new.audience='client' and new.recipients is distinct from array['synthetic-company@example.invalid']::text[])) then
      raise exception 'Synthetic canary recipients are fixed and cannot be overridden.' using errcode='42501';
    end if;
    return new;
  end if;
  v_invoice_id:=nullif(old.payload->>'invoice_id','')::uuid;
  if old.event_type='waybill_ready' and old.audience in ('driver','client')
    and old.payload->>'invoice_number'='WB-9999-999999'
    and new.status='pending' and old.status='processing'
    and old.lease_until is not null and old.lease_until<=statement_timestamp()
    and new.lease_token is null and new.lease_until is null
    and (to_jsonb(new)-array['status','lease_token','lease_until','next_attempt_at','updated_at'])
      is not distinct from (to_jsonb(old)-array['status','lease_token','lease_until','next_attempt_at','updated_at'])
    and exists (select 1 from private.waybill_notification_canary_runs canary
      where canary.invoice_id=v_invoice_id and canary.trip_id=old.trip_id
        and canary.disarmed_at is null and canary.expires_at<=statement_timestamp())
    and exists (select 1 from private.waybill_synthetic_email_canary_permits permit
      where permit.invoice_id=v_invoice_id and permit.trip_id=old.trip_id) then
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
  if private.waybill_email_canary_delivery_allowed((new.payload->>'invoice_id')::uuid,new.trip_id)
    and ((new.audience='driver' and new.recipients is distinct from array['synthetic-driver@example.invalid']::text[])
      or (new.audience='client' and new.recipients is distinct from array['synthetic-company@example.invalid']::text[])) then
    raise exception 'Synthetic canary recipients are fixed and cannot be overridden.' using errcode='42501';
  end if;
  return new;
end;
$$;

create function public.arm_waybill_synthetic_email_canary(p_invoice_id uuid,p_duration_seconds integer default 300)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_run_id uuid; v_existing private.waybill_notification_canary_runs%rowtype;
begin
  if p_duration_seconds is null or p_duration_seconds not between 60 and 600
    or not private.waybill_email_canary_environment_enabled()
    or not private.waybill_synthetic_email_canary_pdfs_ready(p_invoice_id) then
    raise exception 'Canary prerequisites are not satisfied.' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('email-canary:'||p_invoice_id::text,0));
  select * into v_existing from private.waybill_notification_canary_runs
  where disarmed_at is null for update;
  if found then
    if v_existing.expires_at>statement_timestamp() then
      raise exception 'Another notification canary is active.' using errcode='55000';
    end if;
    perform public.recover_expired_waybill_synthetic_email_canary(v_existing.invoice_id);
  end if;
  insert into private.waybill_notification_canary_runs(invoice_id,trip_id,purpose,expires_at)
  select invoice.id,invoice.trip_id,'synthetic_development_test',
    statement_timestamp()+make_interval(secs=>p_duration_seconds)
  from public.trip_closure_invoices invoice where invoice.id=p_invoice_id
  returning id into v_run_id;
  if v_run_id is null then raise exception 'Synthetic invoice was not found.' using errcode='42501'; end if;
  return v_run_id;
end;
$$;
revoke all on function public.arm_waybill_synthetic_email_canary(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.arm_waybill_synthetic_email_canary(uuid,integer) to service_role;

create function public.provision_waybill_synthetic_email_canary_notifications(
  p_invoice_id uuid,p_company_recipient text default 'synthetic-company@example.invalid'
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_invoice public.trip_closure_invoices%rowtype; v_existing integer; v_inserted integer;
begin
  if p_company_recipient is distinct from 'synthetic-company@example.invalid'
    or not private.waybill_email_canary_environment_enabled()
    or not private.waybill_synthetic_email_canary_pdfs_ready(p_invoice_id) then
    raise exception 'Synthetic notification provisioning is not authorized.' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('email-canary:'||p_invoice_id::text,0));
  select invoice.* into v_invoice from public.trip_closure_invoices invoice
  join private.waybill_notification_canary_runs canary on canary.invoice_id=invoice.id
    and canary.trip_id=invoice.trip_id and canary.disarmed_at is null
    and canary.expires_at>statement_timestamp()
  join private.waybill_synthetic_email_canary_permits permit on permit.invoice_id=invoice.id
    and permit.trip_id=invoice.trip_id and permit.driver_recipient=invoice.driver_email
  where invoice.id=p_invoice_id and invoice.invoice_number='WB-9999-999999'
  for update of invoice;
  if not found then raise exception 'No valid active canary is armed for the selected invoice.' using errcode='42501'; end if;
  select count(*) into v_existing from public.notification_outbox notification
  where notification.trip_id=v_invoice.trip_id and notification.event_type='waybill_ready';
  if v_existing=2 and exists (
    select 1 from public.notification_outbox notification
    where notification.trip_id=v_invoice.trip_id and notification.event_type='waybill_ready'
      and notification.delivery_sequence=0 and notification.audience='driver'
      and notification.recipients=array['synthetic-driver@example.invalid']::text[]
      and notification.payload=jsonb_build_object('invoice_id',v_invoice.id,'invoice_number',v_invoice.invoice_number,'trip_number',v_invoice.trip_number)
  ) and exists (
    select 1 from public.notification_outbox notification
    where notification.trip_id=v_invoice.trip_id and notification.event_type='waybill_ready'
      and notification.delivery_sequence=0 and notification.audience='client'
      and notification.recipients=array['synthetic-company@example.invalid']::text[]
      and notification.payload=jsonb_build_object('invoice_id',v_invoice.id,'invoice_number',v_invoice.invoice_number,'trip_number',v_invoice.trip_number)
  ) then return 0; end if;
  if v_existing<>0 then raise exception 'Canary notification rows are partial, duplicate, or inconsistent.' using errcode='23505'; end if;
  insert into public.notification_outbox(trip_id,event_type,audience,delivery_sequence,recipients,payload,status)
  values
    (v_invoice.trip_id,'waybill_ready','driver',0,array['synthetic-driver@example.invalid'],
      jsonb_build_object('invoice_id',v_invoice.id,'invoice_number',v_invoice.invoice_number,'trip_number',v_invoice.trip_number),'pending'),
    (v_invoice.trip_id,'waybill_ready','client',0,array['synthetic-company@example.invalid'],
      jsonb_build_object('invoice_id',v_invoice.id,'invoice_number',v_invoice.invoice_number,'trip_number',v_invoice.trip_number),'pending');
  get diagnostics v_inserted=row_count;
  if v_inserted<>2 then raise exception 'Exactly two canary notification rows were not provisioned.' using errcode='23514'; end if;
  return v_inserted;
end;
$$;
revoke all on function public.provision_waybill_synthetic_email_canary_notifications(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.provision_waybill_synthetic_email_canary_notifications(uuid,text) to service_role;

create function public.disarm_waybill_synthetic_email_canary(p_invoice_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_invoice_id is null or not private.waybill_email_canary_environment_enabled() then
    raise exception 'Synthetic canary disarm is not authorized.' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('email-canary:'||p_invoice_id::text,0));
  update private.waybill_notification_canary_runs canary
  set disarmed_at=statement_timestamp()
  where canary.invoice_id=p_invoice_id and canary.disarmed_at is null
    and not exists (select 1 from public.notification_outbox notification
      where notification.trip_id=canary.trip_id and notification.event_type='waybill_ready'
        and notification.status='processing');
  if not found then raise exception 'Canary is missing or has active notification leases.' using errcode='55000'; end if;
  return true;
end;
$$;
revoke all on function public.disarm_waybill_synthetic_email_canary(uuid) from public,anon,authenticated,service_role;
grant execute on function public.disarm_waybill_synthetic_email_canary(uuid) to service_role;

create function public.recover_expired_waybill_synthetic_email_canary(p_invoice_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_trip_id uuid; v_count integer;
begin
  if p_invoice_id is null or not private.waybill_email_canary_environment_enabled() then
    raise exception 'Synthetic canary recovery is not authorized.' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('email-canary:'||p_invoice_id::text,0));
  select canary.trip_id into v_trip_id from private.waybill_notification_canary_runs canary
  join private.waybill_synthetic_email_canary_permits permit on permit.invoice_id=canary.invoice_id
    and permit.trip_id=canary.trip_id
  where canary.invoice_id=p_invoice_id and canary.disarmed_at is null
    and canary.expires_at<=statement_timestamp() for update of canary;
  if not found then raise exception 'No expired undisarmed synthetic canary exists.' using errcode='55000'; end if;
  update public.notification_outbox notification
  set status='pending',lease_token=null,lease_until=null,next_attempt_at=statement_timestamp()
  where notification.trip_id=v_trip_id and notification.event_type='waybill_ready'
    and notification.status='processing' and notification.lease_until<=statement_timestamp()
    and notification.payload->>'invoice_id'=p_invoice_id::text
    and notification.payload->>'invoice_number'='WB-9999-999999';
  get diagnostics v_count=row_count;
  update private.waybill_notification_canary_runs
  set disarmed_at=statement_timestamp() where invoice_id=p_invoice_id and disarmed_at is null;
  if not found then raise exception 'Expired canary could not be disarmed.' using errcode='55000'; end if;
  return v_count;
end;
$$;
revoke all on function public.recover_expired_waybill_synthetic_email_canary(uuid) from public,anon,authenticated,service_role;
grant execute on function public.recover_expired_waybill_synthetic_email_canary(uuid) to service_role;

revoke all on function private.waybill_email_canary_environment_enabled() from public,anon,authenticated,service_role;
revoke all on function private.guard_waybill_synthetic_email_canary_permit() from public,anon,authenticated,service_role;
revoke all on function private.waybill_synthetic_email_canary_pdfs_ready(uuid) from public,anon,authenticated,service_role;
revoke all on function private.waybill_synthetic_canary_company_copy_allowed(uuid,uuid,integer,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.waybill_email_canary_delivery_allowed(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.guard_waybill_notification_canary_run() from public,anon,authenticated,service_role;
revoke all on function private.guard_notification_delivery_cutover() from public,anon,authenticated,service_role;

commit;
