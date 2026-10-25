begin;

do $preflight$
begin
  if to_regclass('public.trip_closure_invoice_bank_snapshots') is null
    or to_regclass('public.trip_closure_invoice_pdf_copies') is null
    or to_regclass('public.notification_outbox') is null
    or to_regprocedure('private.create_trip_closure_invoice()') is null
    or to_regprocedure('private.waybill_synthetic_canary_company_copy_allowed(uuid,uuid,integer,uuid)') is null
    or to_regprocedure('private.waybill_email_regular_delivery_allowed(uuid,uuid)') is null then
    raise exception 'Secure Waybill and email-cutover prerequisites are required';
  end if;
end;
$preflight$;

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
  return null;
end;
$$;

create or replace function private.waybill_company_copy_verification_eligible(
  p_invoice_id uuid,p_trip_id uuid,p_copy_id uuid,p_bank_snapshot_id uuid
) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_invoice_id is not null and p_trip_id is not null
    and p_copy_id is not null and p_bank_snapshot_id is not null
    and exists (
      select 1
      from public.trip_closure_invoice_pdf_copies copy
      join public.trip_closure_invoices invoice
        on invoice.id=copy.invoice_id and invoice.trip_id=copy.trip_id
      join public.trips trip
        on trip.id=invoice.trip_id and trip.status='closed' and trip.closed_at=invoice.closed_at
      join public.trip_closure_invoice_bank_snapshots snapshot
        on snapshot.id=copy.bank_snapshot_id and snapshot.invoice_id=copy.invoice_id
          and snapshot.trip_id=copy.trip_id
      join public.trip_closure_invoice_bank_submissions submission
        on submission.id=snapshot.source_submission_id and submission.invoice_id=snapshot.invoice_id
          and submission.trip_id=snapshot.trip_id
      where copy.id=p_copy_id and copy.invoice_id=p_invoice_id and copy.trip_id=p_trip_id
        and copy.copy_kind='company' and copy.bank_snapshot_id=p_bank_snapshot_id
        and copy.copy_version=(
          select max(latest.copy_version) from public.trip_closure_invoice_pdf_copies latest
          where latest.invoice_id=copy.invoice_id and latest.trip_id=copy.trip_id
            and latest.copy_kind='company')
        and snapshot.version=copy.copy_version
        and snapshot.version=(
          select max(latest.version) from public.trip_closure_invoice_bank_snapshots latest
          where latest.invoice_id=snapshot.invoice_id and latest.trip_id=snapshot.trip_id)
        and snapshot.source_kind='operations_manager'
        and snapshot.source_registration_capture_id is null
        and submission.source_kind='operations_manager'
        and submission.source_registration_capture_id is null
        and snapshot.verified_by is not null and snapshot.verified_at is not null
        and snapshot.verified_at<=statement_timestamp()
        and exists (
          select 1 from public.trip_closure_invoice_bank_detail_events event
          where event.submission_id=submission.id and event.invoice_id=invoice.id
            and event.trip_id=trip.id and event.actor_id=snapshot.verified_by
            and event.occurred_at>=snapshot.verified_at
            and ((event.event_type in ('verified','correction_verified') and event.reason_code='verified')
              or (event.event_type in ('bank_details_saved','bank_details_corrected')
                and event.reason_code is null))
        )
    );
$$;
revoke all on function private.waybill_company_copy_verification_eligible(uuid,uuid,uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function private.waybill_company_copy_email_eligible(
  p_invoice_id uuid,p_trip_id uuid,p_copy_id uuid
) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trip_closure_invoice_pdf_copies copy
    where copy.id=p_copy_id and copy.invoice_id=p_invoice_id and copy.trip_id=p_trip_id
      and copy.copy_kind='company' and copy.status='ready' and copy.ready_at is not null
      and copy.notification_eligible
      and private.waybill_company_copy_verification_eligible(
        copy.invoice_id,copy.trip_id,copy.id,copy.bank_snapshot_id)
  );
$$;
revoke all on function private.waybill_company_copy_email_eligible(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function private.waybill_company_storage_object_read_allowed(p_storage_path text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trip_closure_invoice_pdf_copies copy
    where copy.storage_bucket='waybill-company-copies' and copy.storage_path=p_storage_path
      and copy.copy_kind='company' and copy.status='ready' and copy.ready_at is not null
      and private.has_role(array['operations_manager']::public.app_role[])
      and private.waybill_company_copy_verification_eligible(
        copy.invoice_id,copy.trip_id,copy.id,copy.bank_snapshot_id)
  );
$$;
revoke all on function private.waybill_company_storage_object_read_allowed(text)
  from public,anon,service_role;
grant execute on function private.waybill_company_storage_object_read_allowed(text) to authenticated;

create or replace function private.waybill_company_invoice_has_processing_delivery(p_invoice_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trip_closure_invoice_pdf_copies copy
    where copy.invoice_id=p_invoice_id and copy.copy_kind='company' and copy.status='processing'
  ) or exists (
    select 1 from public.trip_closure_invoices invoice
    join public.notification_outbox notification on notification.trip_id=invoice.trip_id
    where invoice.id=p_invoice_id and notification.event_type='waybill_ready'
      and notification.audience='client' and notification.status='processing'
      and notification.payload->>'invoice_id'=invoice.id::text
      and notification.payload->>'invoice_number'=invoice.invoice_number
  );
$$;
revoke all on function private.waybill_company_invoice_has_processing_delivery(uuid)
  from public,anon,authenticated,service_role;

create or replace function private.guard_waybill_company_copy_transition() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.copy_kind='company' and (
    new.status='processing'
    or (old.status='processing' and new.status in ('ready','pending','failed'))
  ) then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('waybill-bank:'||new.invoice_id::text,0)
    );
    if not private.waybill_company_copy_verification_eligible(
      new.invoice_id,new.trip_id,new.id,new.bank_snapshot_id) then
      raise exception 'Company PDF requires the latest verified Operations Manager bank snapshot'
        using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.get_waybill_notification_pdf(p_notification_id uuid,p_lease_token uuid)
returns table(invoice_id uuid,invoice_number text,copy_kind text,storage_bucket text,storage_path text)
language plpgsql volatile security definer set search_path = '' as $$
begin
  return query
  select invoice.id,invoice.invoice_number,copy.copy_kind,copy.storage_bucket,copy.storage_path
  from public.notification_outbox notification
  join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id
  join public.trip_closure_invoice_pdf_copies copy
    on copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id
      and copy.copy_kind=case notification.audience when 'driver' then 'driver' when 'client' then 'company' else null end
  where notification.id=p_notification_id and notification.event_type='waybill_ready'
    and notification.audience in ('driver','client') and notification.status='processing'
    and notification.lease_token=p_lease_token and notification.lease_until>clock_timestamp()
    and notification.payload->>'invoice_id'=invoice.id::text
    and notification.payload->>'invoice_number'=invoice.invoice_number
    and private.waybill_notification_audience_eligible(
      notification.trip_id,notification.payload,notification.audience)
    and copy.status='ready' and copy.ready_at is not null
    and copy.copy_version=(select max(latest.copy_version)
      from public.trip_closure_invoice_pdf_copies latest
      where latest.invoice_id=invoice.id and latest.trip_id=invoice.trip_id
        and latest.copy_kind=copy.copy_kind)
    and copy.storage_bucket=case copy.copy_kind when 'driver' then 'waybill-driver-copies'
      when 'company' then 'waybill-company-copies' else null end
    and copy.storage_path=private.secure_waybill_copy_storage_path(
      invoice.invoice_number,copy.copy_kind,copy.copy_version)
    and (copy.notification_eligible or (notification.audience='client'
      and private.waybill_email_canary_delivery_allowed(invoice.id,invoice.trip_id)
      and private.waybill_synthetic_canary_company_copy_allowed(
        invoice.id,invoice.trip_id,copy.copy_version,copy.bank_snapshot_id)));
end;
$$;

create or replace function public.finish_trip_notification(
  p_id uuid,p_lease_token uuid,p_sent boolean,p_provider_message_id text default null,p_error text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_invoice_id uuid;
begin
  if p_sent is null or (p_sent and (p_provider_message_id is null or p_error is not null))
    or (not p_sent and (p_provider_message_id is not null or p_error is null)) then
    raise exception 'Invalid notification result' using errcode='22023';
  end if;

  select invoice.id into v_invoice_id
  from public.notification_outbox notification
  join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id
    and notification.payload->>'invoice_id'=invoice.id::text
    and notification.payload->>'invoice_number'=invoice.invoice_number
  where notification.id=p_id and notification.event_type='waybill_ready'
    and notification.audience='client';
  if found then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('waybill-bank:'||v_invoice_id::text,0)
    );
  end if;

  update public.notification_outbox notification
  set status=case when p_sent then 'sent' else 'pending' end,
      sent_at=case when p_sent then statement_timestamp() else null end,
      provider_message_id=p_provider_message_id,
      last_error=case when p_sent then null else left(p_error,255) end,
      next_attempt_at=case when p_sent then notification.next_attempt_at
        else statement_timestamp()+make_interval(secs=>least(3600,
          (30*power(2,greatest(notification.attempts-1,0)))::integer)) end,
      lease_token=null,lease_until=null,updated_at=statement_timestamp()
  where notification.id=p_id and notification.event_type='waybill_ready'
    and notification.audience in ('driver','client') and notification.status='processing'
    and notification.lease_token=p_lease_token and notification.lease_until>statement_timestamp()
    and private.waybill_notification_audience_eligible(
      notification.trip_id,notification.payload,notification.audience);
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
  if p_audience='client' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('waybill-bank:'||v_invoice.id::text,0)
    );
  end if;
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

  select * into v_copy from public.trip_closure_invoice_pdf_copies copy
  where copy.invoice_id=v_invoice.id and copy.trip_id=v_invoice.trip_id
    and copy.copy_kind=case p_audience when 'driver' then 'driver' else 'company' end
    and copy.status='ready' and copy.ready_at is not null and copy.notification_eligible
    and copy.copy_version=(select max(latest.copy_version)
      from public.trip_closure_invoice_pdf_copies latest
      where latest.invoice_id=v_invoice.id and latest.trip_id=v_invoice.trip_id
        and latest.copy_kind=copy.copy_kind)
    and copy.storage_bucket=case p_audience when 'driver' then 'waybill-driver-copies'
      else 'waybill-company-copies' end
    and copy.storage_path=private.secure_waybill_copy_storage_path(
      v_invoice.invoice_number,copy.copy_kind,copy.copy_version)
    and (p_audience<>'client' or private.waybill_company_copy_email_eligible(
      v_invoice.id,v_invoice.trip_id,copy.id));
  if not found then raise exception 'Current eligible secure Waybill PDF required' using errcode='P4091'; end if;

  select * into v_latest from public.notification_outbox notification
  where notification.trip_id=v_invoice.trip_id and notification.event_type='waybill_ready'
    and notification.audience=p_audience
  order by notification.delivery_sequence desc,notification.created_at desc,notification.id desc
  limit 1 for update;
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
    'audience',p_audience,'sequence',v_new.delivery_sequence,
    'duplicate_risk_confirmed',p_duplicate_risk_confirmed),p_reason_code,auth.uid());
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
  if p_audience='client' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('waybill-bank:'||v_invoice.id::text,0)
    );
  end if;
  if not private.waybill_email_regular_delivery_allowed(v_invoice.id,v_invoice.trip_id) then
    raise exception 'Waybill is outside the approved email delivery scope.' using errcode='42501';
  end if;

  select * into v_copy from public.trip_closure_invoice_pdf_copies copy
  where copy.invoice_id=v_invoice.id and copy.trip_id=v_invoice.trip_id
    and copy.copy_kind=case p_audience when 'driver' then 'driver' else 'company' end
    and copy.status='ready' and copy.ready_at is not null and copy.notification_eligible
    and copy.copy_version=(select max(latest.copy_version)
      from public.trip_closure_invoice_pdf_copies latest
      where latest.invoice_id=v_invoice.id and latest.trip_id=v_invoice.trip_id
        and latest.copy_kind=copy.copy_kind)
    and copy.storage_bucket=case p_audience when 'driver' then 'waybill-driver-copies'
      else 'waybill-company-copies' end
    and copy.storage_path=private.secure_waybill_copy_storage_path(
      v_invoice.invoice_number,copy.copy_kind,copy.copy_version)
    and (p_audience<>'client' or private.waybill_company_copy_email_eligible(
      v_invoice.id,v_invoice.trip_id,copy.id));
  if not found then raise exception 'Current eligible secure Waybill PDF required' using errcode='P4091'; end if;

  select * into v_job from public.notification_outbox notification
  where notification.trip_id=v_invoice.trip_id and notification.event_type='waybill_ready'
    and notification.audience=p_audience
  order by notification.delivery_sequence desc,notification.created_at desc,notification.id desc
  limit 1 for update;
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
      next_attempt_at=statement_timestamp(),lease_token=null,lease_until=null,
      updated_at=statement_timestamp()
    where id=v_job.id;
  else
    raise exception 'Safe delivery retry unavailable' using errcode='P4091';
  end if;

  insert into public.audit_log(entity_name,entity_id,action,old_value,new_value,reason,actor_id)
  values('waybill_delivery_retry',v_job.id,'UPDATE',
    jsonb_build_object('status',v_job.status,'sequence',v_job.delivery_sequence,'audience',v_job.audience),
    jsonb_build_object('status','pending','sequence',v_job.delivery_sequence,'audience',v_job.audience),
    v_reason,auth.uid());
  return jsonb_build_object('notification_id',v_job.id,'status','pending',
    'sequence',v_job.delivery_sequence);
end;
$$;

create or replace function public.claim_waybill_notification_canary(
  p_sender text,p_invoice_id uuid,p_company_recipient text,p_limit integer default 2
) returns setof public.notification_outbox
language plpgsql security definer set search_path = '' as $$
declare
  v_invoice public.trip_closure_invoices%rowtype;
  v_job public.notification_outbox%rowtype;
begin
  if p_sender is null or length(btrim(p_sender))=0 or p_sender ~ E'[\r\n]'
    or p_invoice_id is null or p_limit is null or p_limit not between 1 and 2
    or (p_company_recipient is not null
      and p_company_recipient is distinct from 'synthetic-company@example.invalid') then
    raise exception 'Invalid notification canary configuration' using errcode='22023';
  end if;
  select * into v_invoice from public.trip_closure_invoices where id=p_invoice_id;
  if not found or not private.waybill_email_canary_delivery_allowed(v_invoice.id,v_invoice.trip_id) then
    raise exception 'No active canary is armed for the selected synthetic invoice.' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('waybill-bank:'||v_invoice.id::text,0)
  );

  update public.notification_outbox notification
  set recipients=case when p_company_recipient is null then null else array[p_company_recipient] end,
      status=case when p_company_recipient is null then 'blocked_configuration' else 'pending' end,
      blocked_reason_code=case when p_company_recipient is null then 'company_recipient_not_configured' else null end,
      last_error=case when p_company_recipient is null
        then 'Parent company recipient must be configured' else null end,
      next_attempt_at=statement_timestamp()
  where notification.trip_id=v_invoice.trip_id and notification.event_type='waybill_ready'
    and notification.audience='client' and notification.delivery_sequence=0
    and notification.payload->>'invoice_id'=v_invoice.id::text
    and notification.payload->>'invoice_number'=v_invoice.invoice_number
    and notification.attempts=0 and notification.first_attempt_at is null
    and (notification.status='blocked_configuration'
      or (notification.status='pending' and notification.recipients is distinct from
        case when p_company_recipient is null then null else array[p_company_recipient] end))
    and private.waybill_notification_audience_eligible(
      notification.trip_id,notification.payload,'client');

  update public.notification_outbox notification
  set status='failed',lease_token=null,lease_until=null,blocked_reason_code=null,
      last_error='Delivery retry limit reached',updated_at=statement_timestamp()
  where notification.trip_id=v_invoice.trip_id and notification.event_type='waybill_ready'
    and notification.audience in ('driver','client')
    and notification.payload->>'invoice_id'=v_invoice.id::text
    and notification.payload->>'invoice_number'=v_invoice.invoice_number
    and notification.status in ('pending','processing')
    and (notification.status='pending' or notification.lease_until is null
      or notification.lease_until<statement_timestamp())
    and (notification.attempts>=8
      or notification.first_attempt_at<statement_timestamp()-interval '23 hours')
    and notification.recipients is not null and cardinality(notification.recipients)=1
    and private.waybill_notification_audience_eligible(
      notification.trip_id,notification.payload,notification.audience)
    and ((notification.audience='driver' and notification.recipients=array[v_invoice.driver_email])
      or (notification.audience='client' and p_company_recipient is not null
        and notification.recipients=array[p_company_recipient]
        and p_company_recipient ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'));

  for v_job in
    select notification.* from public.notification_outbox notification
    join lateral (
      select copy.* from public.trip_closure_invoice_pdf_copies copy
      where copy.invoice_id=v_invoice.id and copy.trip_id=v_invoice.trip_id
        and copy.copy_kind=case notification.audience when 'driver' then 'driver'
          when 'client' then 'company' else null end
      order by copy.copy_version desc limit 1
    ) copy on true
    where notification.trip_id=v_invoice.trip_id and notification.event_type='waybill_ready'
      and notification.audience in ('driver','client')
      and notification.payload->>'invoice_id'=v_invoice.id::text
      and notification.payload->>'invoice_number'=v_invoice.invoice_number
      and notification.status in ('pending','processing')
      and notification.recipients is not null and cardinality(notification.recipients)=1
      and ((notification.status='pending' and notification.next_attempt_at<=statement_timestamp())
        or (notification.status='processing'
          and (notification.lease_until is null or notification.lease_until<statement_timestamp())))
      and private.waybill_notification_audience_eligible(
        notification.trip_id,notification.payload,notification.audience)
      and copy.status='ready' and copy.ready_at is not null
      and copy.copy_version=(select max(latest.copy_version)
        from public.trip_closure_invoice_pdf_copies latest
        where latest.invoice_id=v_invoice.id and latest.trip_id=v_invoice.trip_id
          and latest.copy_kind=copy.copy_kind)
      and copy.storage_bucket=case copy.copy_kind when 'driver' then 'waybill-driver-copies'
        else 'waybill-company-copies' end
      and copy.storage_path=private.secure_waybill_copy_storage_path(
        v_invoice.invoice_number,copy.copy_kind,copy.copy_version)
      and (copy.notification_eligible or (notification.audience='client'
        and private.waybill_synthetic_canary_company_copy_allowed(
          v_invoice.id,v_invoice.trip_id,copy.copy_version,copy.bank_snapshot_id)))
      and ((notification.audience='driver' and notification.recipients=array[v_invoice.driver_email])
        or (notification.audience='client' and p_company_recipient is not null
          and notification.recipients=array[p_company_recipient]
          and p_company_recipient ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
    order by case notification.audience when 'driver' then 0 else 1 end,
      notification.created_at,notification.id
    for update of notification skip locked limit p_limit
  loop
    update public.notification_outbox notification
    set status='processing',attempts=notification.attempts+1,
        first_attempt_at=coalesce(notification.first_attempt_at,statement_timestamp()),
        lease_token=gen_random_uuid(),lease_until=statement_timestamp()+interval '5 minutes',
        updated_at=statement_timestamp()
    where notification.id=v_job.id returning notification.* into v_job;
    return next v_job;
  end loop;
end;
$$;

create or replace function private.guard_notification_delivery_cutover() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_invoice_id uuid;
begin
  if tg_op='DELETE' then
    raise exception 'Notification outbox rows are retained and cannot be deleted.' using errcode='42501';
  end if;
  if tg_op='INSERT' then
    if new.event_type='trip_closed' then return new; end if;
    if new.event_type<>'waybill_ready' or new.audience not in ('driver','client')
      or not private.waybill_email_notification_allowed(new.trip_id,new.payload)
      or not private.waybill_notification_audience_eligible(new.trip_id,new.payload,new.audience) then
      raise exception 'Notification is outside the verified Waybill delivery scope.' using errcode='42501';
    end if;
    if private.waybill_email_canary_delivery_allowed(
        nullif(new.payload->>'invoice_id','')::uuid,new.trip_id)
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
    or not private.waybill_notification_audience_eligible(old.trip_id,old.payload,old.audience)
    or new.event_type<>'waybill_ready' or new.audience not in ('driver','client')
    or not private.waybill_email_notification_allowed(new.trip_id,new.payload)
    or not private.waybill_notification_audience_eligible(new.trip_id,new.payload,new.audience) then
    raise exception 'Historical, superseded, or unverified notification rows are immutable.' using errcode='42501';
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
  if new.audience='client' and old.status is distinct from new.status
    and (new.status='processing' or old.status='processing')
    and not pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtextextended('waybill-bank:'||v_invoice_id::text,0)
    ) then
    raise exception 'Company delivery lease is changing concurrently with bank details.' using errcode='55P03';
  end if;
  if private.waybill_email_canary_delivery_allowed(v_invoice_id,new.trip_id)
    and ((new.audience='driver' and new.recipients is distinct from array['synthetic-driver@example.invalid']::text[])
      or (new.audience='client' and new.recipients is distinct from array['synthetic-company@example.invalid']::text[])) then
    raise exception 'Synthetic canary recipients are fixed and cannot be overridden.' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_notification_delivery_cutover() from public,anon,authenticated,service_role;

do $verify_company_delivery_hardening$
begin
  if has_function_privilege('anon','public.claim_waybill_notifications(text,integer)','EXECUTE')
    or has_function_privilege('authenticated','public.claim_waybill_notifications(text,integer)','EXECUTE')
    or not has_function_privilege('service_role','public.claim_waybill_notifications(text,integer)','EXECUTE')
    or has_function_privilege('anon','public.get_waybill_notification_pdf(uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.get_waybill_notification_pdf(uuid,uuid)','EXECUTE')
    or not has_function_privilege('service_role','public.get_waybill_notification_pdf(uuid,uuid)','EXECUTE')
    or has_function_privilege('anon','public.finish_trip_notification(uuid,uuid,boolean,text,text)','EXECUTE')
    or has_function_privilege('authenticated','public.finish_trip_notification(uuid,uuid,boolean,text,text)','EXECUTE')
    or not has_function_privilege('service_role','public.finish_trip_notification(uuid,uuid,boolean,text,text)','EXECUTE') then
    raise exception 'Secure notification RPC grants changed during Company bank hardening';
  end if;
  if not has_function_privilege('authenticated','public.get_operations_waybill_pdf_copy(uuid,text)','EXECUTE')
    or not has_function_privilege('authenticated','public.resend_operations_waybill(uuid,text,uuid,text,boolean)','EXECUTE')
    or not has_function_privilege('authenticated','public.retry_operations_waybill_delivery(uuid,text,text)','EXECUTE') then
    raise exception 'Operations Manager Company Waybill RPC grants are missing';
  end if;
end;
$verify_company_delivery_hardening$;

revoke all on function private.guard_waybill_company_copy_transition() from public,anon,authenticated,service_role;
drop trigger if exists waybill_company_copy_verification_guard on public.trip_closure_invoice_pdf_copies;
create trigger waybill_company_copy_verification_guard
before update on public.trip_closure_invoice_pdf_copies
for each row execute function private.guard_waybill_company_copy_transition();

drop policy if exists secure_waybill_company_verified_storage_read on storage.objects;
create policy secure_waybill_company_verified_storage_read on storage.objects as restrictive
for select to authenticated using (
  bucket_id<>'waybill-company-copies'
  or (private.has_role(array['operations_manager']::public.app_role[])
    and private.waybill_company_storage_object_read_allowed(name))
);

create or replace function private.claim_waybill_pdf_copy_jobs(p_copy_kind text,p_limit integer,p_invoice_id uuid default null)
returns table(copy_id uuid,invoice_id uuid,trip_id uuid,invoice_number text,
  storage_bucket text,storage_path text,attempts integer,lease_token uuid,lease_until timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_candidate record;
  v_copy public.trip_closure_invoice_pdf_copies%rowtype;
  v_claimed integer:=0;
begin
  if p_copy_kind is null or p_copy_kind not in ('driver','company')
    or p_limit is null or p_limit not between 1 and 10 then
    raise exception 'Invalid Waybill copy claim request' using errcode='22023';
  end if;

  update public.trip_closure_invoice_pdf_copies copy
  set status='failed',failed_at=clock_timestamp(),lease_token=null,lease_until=null,
    last_error_code='attempt_limit_exhausted'
  where copy.copy_kind='driver' and copy.invoice_number<>'WB-9999-999999'
    and copy.attempts>=5 and (p_invoice_id is null or copy.invoice_id=p_invoice_id)
    and ((copy.status='pending' and copy.next_attempt_at<=clock_timestamp())
      or (copy.status='processing' and copy.lease_until<clock_timestamp()));

  if p_copy_kind='company' then
    for v_candidate in
      select copy.id,copy.invoice_id,copy.trip_id,copy.bank_snapshot_id
      from public.trip_closure_invoice_pdf_copies copy
      where copy.copy_kind='company' and copy.invoice_number<>'WB-9999-999999'
        and copy.attempts>=5 and (p_invoice_id is null or copy.invoice_id=p_invoice_id)
        and ((copy.status='pending' and copy.next_attempt_at<=clock_timestamp())
          or (copy.status='processing' and copy.lease_until<clock_timestamp()))
        and private.waybill_company_copy_verification_eligible(
          copy.invoice_id,copy.trip_id,copy.id,copy.bank_snapshot_id)
      order by copy.created_at,copy.id limit 250
    loop
      if pg_catalog.pg_try_advisory_xact_lock(
        pg_catalog.hashtextextended('waybill-bank:'||v_candidate.invoice_id::text,0)
      ) then
        update public.trip_closure_invoice_pdf_copies copy
        set status='failed',failed_at=clock_timestamp(),lease_token=null,lease_until=null,
          last_error_code='attempt_limit_exhausted'
        where copy.id=v_candidate.id and copy.copy_kind='company'
          and copy.invoice_number<>'WB-9999-999999' and copy.attempts>=5
          and ((copy.status='pending' and copy.next_attempt_at<=clock_timestamp())
            or (copy.status='processing' and copy.lease_until<clock_timestamp()))
          and private.waybill_company_copy_verification_eligible(
            copy.invoice_id,copy.trip_id,copy.id,copy.bank_snapshot_id);
      end if;
    end loop;
  end if;

  for v_candidate in
    select copy.id,copy.invoice_id,copy.trip_id,copy.bank_snapshot_id
    from public.trip_closure_invoice_pdf_copies copy
    where copy.copy_kind=p_copy_kind and copy.invoice_number<>'WB-9999-999999'
      and copy.attempts<5 and (p_invoice_id is null or copy.invoice_id=p_invoice_id)
      and ((copy.status='pending' and copy.next_attempt_at<=clock_timestamp())
        or (copy.status='processing' and copy.lease_until<clock_timestamp()))
      and (p_copy_kind<>'company' or private.waybill_company_copy_verification_eligible(
        copy.invoice_id,copy.trip_id,copy.id,copy.bank_snapshot_id))
    order by copy.created_at,copy.id limit 250
  loop
    exit when v_claimed>=p_limit;
    if p_copy_kind='company' and not pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtextextended('waybill-bank:'||v_candidate.invoice_id::text,0)
    ) then
      continue;
    end if;
    select copy.* into v_copy from public.trip_closure_invoice_pdf_copies copy
    where copy.id=v_candidate.id and copy.copy_kind=p_copy_kind
      and copy.invoice_number<>'WB-9999-999999' and copy.attempts<5
      and ((copy.status='pending' and copy.next_attempt_at<=clock_timestamp())
        or (copy.status='processing' and copy.lease_until<clock_timestamp()))
      and (p_copy_kind<>'company' or private.waybill_company_copy_verification_eligible(
        copy.invoice_id,copy.trip_id,copy.id,copy.bank_snapshot_id))
    for update skip locked;
    if not found then continue; end if;
    return query
    update public.trip_closure_invoice_pdf_copies copy
    set status='processing',attempts=copy.attempts+1,
      processing_started_at=clock_timestamp(),lease_token=gen_random_uuid(),
      lease_until=clock_timestamp()+interval '5 minutes',last_error_code=null
    where copy.id=v_copy.id
    returning copy.id,copy.invoice_id,copy.trip_id,copy.invoice_number,
      copy.storage_bucket,copy.storage_path,copy.attempts,copy.lease_token,copy.lease_until;
    v_claimed:=v_claimed+1;
  end loop;
end;
$$;
revoke all on function private.claim_waybill_pdf_copy_jobs(text,integer,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.get_company_waybill_pdf_snapshot(p_copy_id uuid,p_lease_token uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'invoice_number',invoice.invoice_number,'trip_number',invoice.trip_number,
    'truck_registration',invoice.truck_registration,'truck_type',invoice.truck_type,
    'truck_capacity_tonnes',invoice.truck_capacity_tonnes,'truck_owner_name',invoice.truck_owner_name,
    'driver_name',invoice.driver_name,'driver_phone',invoice.driver_phone,
    'driver_license',invoice.driver_license,'loading_site_name',invoice.loading_site_name,
    'offloading_site_name',invoice.offloading_site_name,
    'loading_officer_name',invoice.loading_officer_name,'offloading_officer_name',invoice.offloading_officer_name,
    'quantity_tonnes',invoice.quantity_tonnes,'opened_at',invoice.opened_at,
    'closed_at',invoice.closed_at,'issued_at',invoice.issued_at,
    'bank_name',bank.bank_name,'account_name',bank.account_name,'account_number',bank.account_number
  )
  from public.trip_closure_invoice_pdf_copies copy
  join public.trip_closure_invoices invoice on invoice.id=copy.invoice_id and invoice.trip_id=copy.trip_id
  join public.trip_closure_invoice_bank_snapshots bank
    on bank.id=copy.bank_snapshot_id and bank.invoice_id=copy.invoice_id and bank.trip_id=copy.trip_id
  where copy.id=p_copy_id and copy.copy_kind='company' and copy.status='processing'
    and copy.lease_token=p_lease_token and copy.lease_until>clock_timestamp()
    and private.waybill_company_copy_verification_eligible(
      copy.invoice_id,copy.trip_id,copy.id,copy.bank_snapshot_id);
$$;

create or replace function private.finish_waybill_pdf_copy_job(
  p_copy_kind text,p_copy_id uuid,p_lease_token uuid,p_succeeded boolean,p_failure_code text default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_rows integer;
begin
  if p_copy_kind is null or p_copy_kind not in ('driver','company') or p_succeeded is null
    or (p_succeeded and p_failure_code is not null)
    or (not p_succeeded and (p_failure_code is null or p_failure_code not in (
      'snapshot_unavailable','invalid_snapshot','pdf_generation_failed','storage_upload_failed'
    ))) then
    raise exception 'Invalid Waybill copy result' using errcode='22023';
  end if;
  update public.trip_closure_invoice_pdf_copies copy
  set status=case when p_succeeded then 'ready' when copy.attempts>=5 then 'failed' else 'pending' end,
    ready_at=case when p_succeeded then clock_timestamp() else null end,
    failed_at=case when not p_succeeded and copy.attempts>=5 then clock_timestamp() else null end,
    next_attempt_at=case when p_succeeded or copy.attempts>=5 then copy.next_attempt_at
      else clock_timestamp()+make_interval(secs=>least(3600,(30*power(2,copy.attempts-1))::integer)) end,
    last_error_code=case when p_succeeded then null when copy.attempts>=5 then 'attempt_limit_exhausted' else p_failure_code end,
    lease_token=null,lease_until=null
  where copy.id=p_copy_id and copy.copy_kind=p_copy_kind and copy.status='processing'
    and copy.lease_token=p_lease_token and copy.lease_until>clock_timestamp()
    and (p_copy_kind<>'company' or private.waybill_company_copy_verification_eligible(
      copy.invoice_id,copy.trip_id,copy.id,copy.bank_snapshot_id));
  get diagnostics v_rows=row_count;
  return v_rows=1;
end;
$$;

create or replace function public.get_operations_waybill_pdf_copy(p_invoice_id uuid,p_copy_kind text)
returns table(copy_kind text,storage_bucket text,storage_path text,ready_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_copy_kind is null or p_copy_kind not in ('driver','company') then
    raise exception 'Invalid Waybill copy kind' using errcode='22023';
  end if;
  return query
  select copy.copy_kind,copy.storage_bucket,copy.storage_path,copy.ready_at
  from public.trip_closure_invoice_pdf_copies copy
  where copy.invoice_id=p_invoice_id and copy.copy_kind=p_copy_kind
    and copy.status='ready' and copy.ready_at is not null
    and (copy.copy_kind<>'company' or private.waybill_company_copy_verification_eligible(
      copy.invoice_id,copy.trip_id,copy.id,copy.bank_snapshot_id))
    and copy.copy_version=(select max(latest.copy_version)
      from public.trip_closure_invoice_pdf_copies latest
      where latest.invoice_id=copy.invoice_id and latest.copy_kind=copy.copy_kind)
  order by copy.copy_version desc limit 1;
end;
$$;

create or replace function public.get_operations_waybill_copy_management_state(p_invoice_id uuid)
returns table(
  invoice_id uuid,invoice_number text,driver_pdf_status text,driver_pdf_ready_at timestamptz,
  company_pdf_status text,company_pdf_ready_at timestamptz,bank_verification_state text,
  pending_bank_submission_id uuid,latest_bank_snapshot_version integer,
  company_pdf_held_for_missing_bank_details boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  return query
  select invoice.id,invoice.invoice_number,
    coalesce(driver_copy.status,'not_available'),
    case when driver_copy.status='ready' then driver_copy.ready_at else null end,
    case when company_copy.status in ('pending','processing','ready','failed')
      and not private.waybill_company_copy_verification_eligible(
        invoice.id,invoice.trip_id,company_copy.id,company_copy.bank_snapshot_id)
      then 'blocked_bank_details_unverified'::text
      else coalesce(company_copy.status,'not_available') end,
    case when company_copy.status='ready'
      and private.waybill_company_copy_verification_eligible(
        invoice.id,invoice.trip_id,company_copy.id,company_copy.bank_snapshot_id)
      then company_copy.ready_at else null end,
    case
      when pending_submission.id is not null and bank_snapshot.version is not null then 'correction_pending'
      when pending_submission.id is not null then 'pending_verification'
      when bank_snapshot.source_kind='registration_capture' then 'registration_captured'
      when bank_snapshot.version is not null and private.waybill_company_copy_verification_eligible(
        invoice.id,invoice.trip_id,company_copy.id,company_copy.bank_snapshot_id) then 'verified'
      when bank_snapshot.version is not null then 'unverified'
      when latest_decision.event_type='rejected' then 'rejected'
      else 'missing'
    end,
    pending_submission.id,bank_snapshot.version,
    coalesce(company_copy.status='blocked_missing_bank_details'
      and company_copy.bank_snapshot_id is null,false)
  from public.trip_closure_invoices invoice
  left join lateral (
    select copy.id,copy.status,copy.ready_at from public.trip_closure_invoice_pdf_copies copy
    where copy.invoice_id=invoice.id and copy.copy_kind='driver'
    order by copy.copy_version desc limit 1
  ) driver_copy on true
  left join lateral (
    select copy.id,copy.trip_id,copy.status,copy.ready_at,copy.bank_snapshot_id
    from public.trip_closure_invoice_pdf_copies copy
    where copy.invoice_id=invoice.id and copy.copy_kind='company'
    order by copy.copy_version desc limit 1
  ) company_copy on true
  left join lateral (
    select snapshot.version,snapshot.source_kind
    from public.trip_closure_invoice_bank_snapshots snapshot
    where snapshot.invoice_id=invoice.id order by snapshot.version desc limit 1
  ) bank_snapshot on true
  left join lateral (
    select submission.id from public.trip_closure_invoice_bank_submissions submission
    where submission.invoice_id=invoice.id and not exists (
      select 1 from public.trip_closure_invoice_bank_detail_events event
      where event.submission_id=submission.id
        and event.event_type in ('verified','correction_verified','rejected',
          'registration_capture_snapshotted','bank_details_saved','bank_details_corrected','superseded'))
    order by submission.submitted_at desc,submission.id desc limit 1
  ) pending_submission on true
  left join lateral (
    select event.event_type from public.trip_closure_invoice_bank_detail_events event
    where event.invoice_id=invoice.id and event.event_type in ('verified','correction_verified','rejected')
    order by event.occurred_at desc,event.id desc limit 1
  ) latest_decision on true
  where invoice.id=p_invoice_id;
end;
$$;

create or replace function public.save_waybill_company_bank_details(
  p_invoice_id uuid,p_request_id uuid,p_bank_name text,p_account_name text,p_account_number text
) returns table(snapshot_version integer,company_pdf_status text,unchanged boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_invoice public.trip_closure_invoices%rowtype;
  v_submission public.trip_closure_invoice_bank_submissions%rowtype;
  v_previous_snapshot public.trip_closure_invoice_bank_snapshots%rowtype;
  v_receipt private.waybill_company_bank_save_receipts%rowtype;
  v_company_copy public.trip_closure_invoice_pdf_copies%rowtype;
  v_actor_id uuid;
  v_bank_name text;
  v_account_name text;
  v_account_number text;
  v_snapshot_id uuid;
  v_version integer;
  v_now timestamptz:=clock_timestamp();
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  v_actor_id:=auth.uid();
  if p_invoice_id is null or p_request_id is null then
    raise exception 'A Waybill and request identifier are required' using errcode='22023';
  end if;
  v_bank_name:=btrim(coalesce(p_bank_name,''));
  v_account_name:=btrim(coalesce(p_account_name,''));
  v_account_number:=btrim(coalesce(p_account_number,''));
  if length(v_bank_name) not between 1 and 200 or length(v_account_name) not between 1 and 200
    or v_account_number !~ '^[0-9]{10}$' then
    raise exception 'Valid bank name, account name, and 10-digit account number are required'
      using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('waybill-bank:'||p_invoice_id::text,0)
  );
  select * into v_invoice from public.trip_closure_invoices
  where id=p_invoice_id for update;
  if not found then raise exception 'Closed Waybill not found' using errcode='22023'; end if;

  select * into v_receipt from private.waybill_company_bank_save_receipts
  where invoice_id=p_invoice_id and actor_id=v_actor_id and request_id=p_request_id;
  if found then
    select * into v_submission from public.trip_closure_invoice_bank_submissions
    where id=v_receipt.source_submission_id and invoice_id=v_invoice.id and trip_id=v_invoice.trip_id;
    if not found or v_submission.bank_name is distinct from v_bank_name
      or v_submission.account_name is distinct from v_account_name
      or v_submission.account_number is distinct from v_account_number then
      raise exception 'This request identifier was already used with different bank details' using errcode='P4091';
    end if;
    select snapshot.version into v_version from public.trip_closure_invoice_bank_snapshots snapshot
    where snapshot.source_submission_id=v_submission.id;
    if not found then raise exception 'Saved bank snapshot is unavailable' using errcode='23514'; end if;
    select copy.* into v_company_copy from public.trip_closure_invoice_pdf_copies copy
    where copy.invoice_id=v_invoice.id and copy.copy_kind='company'
    order by copy.copy_version desc limit 1;
    if not found then raise exception 'Company PDF workflow is unavailable' using errcode='23514'; end if;
    return query select v_version,v_company_copy.status,true;
    return;
  end if;

  if private.waybill_company_invoice_has_processing_delivery(v_invoice.id) then
    raise exception 'Bank details cannot be changed while a Company PDF or email delivery is processing'
      using errcode='55P03';
  end if;

  insert into public.trip_closure_invoice_bank_detail_events(
    submission_id,invoice_id,trip_id,event_type,reason_code,actor_id
  ) select submission.id,submission.invoice_id,submission.trip_id,'superseded',
      'superseded_by_single_step_save',v_actor_id
    from public.trip_closure_invoice_bank_submissions submission
    where submission.invoice_id=v_invoice.id
      and not exists (
        select 1 from public.trip_closure_invoice_bank_detail_events event
        where event.submission_id=submission.id
          and event.event_type in ('verified','correction_verified','rejected',
            'registration_capture_snapshotted','bank_details_saved','bank_details_corrected','superseded')
      );

  select * into v_previous_snapshot from public.trip_closure_invoice_bank_snapshots snapshot
  where snapshot.invoice_id=v_invoice.id order by snapshot.version desc limit 1 for update;
  select * into v_company_copy from public.trip_closure_invoice_pdf_copies copy
  where copy.invoice_id=v_invoice.id and copy.copy_kind='company'
  order by copy.copy_version desc limit 1;
  if not found then raise exception 'Company PDF workflow is unavailable' using errcode='23514'; end if;

  if v_previous_snapshot.id is not null then
    if v_company_copy.copy_version<>v_previous_snapshot.version then
      raise exception 'Company PDF and bank snapshot versions are inconsistent' using errcode='P4091';
    end if;
    if v_previous_snapshot.bank_name=v_bank_name and v_previous_snapshot.account_name=v_account_name
      and v_previous_snapshot.account_number=v_account_number then
      insert into private.waybill_company_bank_save_receipts(
        invoice_id,trip_id,actor_id,request_id,source_submission_id
      ) values (v_invoice.id,v_invoice.trip_id,v_actor_id,p_request_id,v_previous_snapshot.source_submission_id);
      return query select v_previous_snapshot.version,v_company_copy.status,true;
      return;
    end if;
  elsif v_company_copy.copy_version<>1 or v_company_copy.bank_snapshot_id is not null
    or v_company_copy.status not in ('blocked_missing_bank_details','blocked_bank_details_unverified') then
    raise exception 'Company PDF is not waiting for its first bank snapshot' using errcode='P4091';
  end if;

  v_version:=coalesce(v_previous_snapshot.version,0)+1;
  insert into public.trip_closure_invoice_bank_submissions(
    invoice_id,trip_id,bank_name,account_name,account_number,submitted_by,submitted_at,
    correction_of_snapshot_id,source_kind
  ) values (
    v_invoice.id,v_invoice.trip_id,v_bank_name,v_account_name,v_account_number,
    v_actor_id,v_now,v_previous_snapshot.id,'operations_manager'
  ) returning * into v_submission;

  insert into public.trip_closure_invoice_bank_snapshots(
    invoice_id,trip_id,version,supersedes_snapshot_id,source_submission_id,
    bank_name,account_name,account_number,submitted_by,submitted_at,verified_by,verified_at,
    source_kind
  ) values (
    v_invoice.id,v_invoice.trip_id,v_version,v_previous_snapshot.id,v_submission.id,
    v_bank_name,v_account_name,v_account_number,v_actor_id,v_now,v_actor_id,v_now,'operations_manager'
  ) returning id into v_snapshot_id;

  insert into public.trip_closure_invoice_bank_detail_events(
    submission_id,invoice_id,trip_id,event_type,actor_id
  ) values (
    v_submission.id,v_invoice.id,v_invoice.trip_id,
    case when v_version=1 then 'bank_details_saved' else 'bank_details_corrected' end,v_actor_id
  );

  if v_version=1 then
    update public.trip_closure_invoice_pdf_copies
    set status='pending',bank_snapshot_id=v_snapshot_id,next_attempt_at=v_now
    where id=v_company_copy.id and status in ('blocked_missing_bank_details','blocked_bank_details_unverified')
      and bank_snapshot_id is null;
    if not found then raise exception 'Company PDF is no longer blocked for missing bank details' using errcode='P4091'; end if;
  else
    insert into public.trip_closure_invoice_pdf_copies(
      invoice_id,trip_id,invoice_number,copy_kind,copy_version,status,storage_bucket,
      storage_path,bank_snapshot_id,notification_eligible
    ) values (
      v_invoice.id,v_invoice.trip_id,v_invoice.invoice_number,'company',v_version,'pending',
      'waybill-company-copies',
      private.secure_waybill_copy_storage_path(v_invoice.invoice_number,'company',v_version),
      v_snapshot_id,false
    );
  end if;

  insert into private.waybill_company_bank_save_receipts(
    invoice_id,trip_id,actor_id,request_id,source_submission_id
  ) values (v_invoice.id,v_invoice.trip_id,v_actor_id,p_request_id,v_submission.id);

  return query select v_version,'pending'::text,false;
end;
$$;

create or replace function private.waybill_notification_audience_eligible(
  p_trip_id uuid,p_payload jsonb,p_audience text,p_allow_expired_canary boolean default false
) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trip_closure_invoices invoice
    join public.trips trip on trip.id=invoice.trip_id
      and trip.status='closed' and trip.closed_at=invoice.closed_at
    where invoice.trip_id=p_trip_id and invoice.id::text=p_payload->>'invoice_id'
      and invoice.invoice_number=p_payload->>'invoice_number'
      and (
        (p_audience='driver' and exists (
          select 1 from public.trip_closure_invoice_pdf_copies copy
          where copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id
            and copy.copy_kind='driver' and copy.status='ready' and copy.ready_at is not null
            and copy.notification_eligible and copy.bank_snapshot_id is null
            and copy.copy_version=(select max(latest.copy_version)
              from public.trip_closure_invoice_pdf_copies latest
              where latest.invoice_id=invoice.id and latest.trip_id=invoice.trip_id
                and latest.copy_kind='driver')
            and copy.storage_bucket='waybill-driver-copies'
            and copy.storage_path=private.secure_waybill_copy_storage_path(
              invoice.invoice_number,'driver',copy.copy_version)
            and ((private.waybill_email_regular_delivery_allowed(invoice.id,invoice.trip_id)
                and private.waybill_email_notification_allowed(p_trip_id,p_payload))
              or (private.waybill_email_canary_delivery_allowed(invoice.id,invoice.trip_id))
              or (p_allow_expired_canary and invoice.invoice_number='WB-9999-999999'
                and exists (select 1 from private.waybill_synthetic_email_canary_permits permit
                  where permit.invoice_id=invoice.id and permit.trip_id=invoice.trip_id
                    and permit.consumed_at is not null)))
        ))
        or (p_audience='client' and (
          (private.waybill_email_regular_delivery_allowed(invoice.id,invoice.trip_id)
            and exists (
              select 1 from public.trip_closure_invoice_pdf_copies copy
              where copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id
                and copy.copy_kind='company'
                and private.waybill_company_copy_email_eligible(invoice.id,invoice.trip_id,copy.id)
                and copy.copy_version=(select max(latest.copy_version)
                  from public.trip_closure_invoice_pdf_copies latest
                  where latest.invoice_id=invoice.id and latest.trip_id=invoice.trip_id
                    and latest.copy_kind='company')
            ))
          or (private.waybill_email_canary_delivery_allowed(invoice.id,invoice.trip_id)
            and exists (
              select 1 from public.trip_closure_invoice_pdf_copies copy
              where copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id
                and copy.copy_kind='company' and copy.status='ready' and copy.ready_at is not null
                and private.waybill_synthetic_canary_company_copy_allowed(
                  invoice.id,invoice.trip_id,copy.copy_version,copy.bank_snapshot_id)
            ))
          or (p_allow_expired_canary
            and private.waybill_synthetic_canary_company_copy_allowed(
              invoice.id,invoice.trip_id,2,(
                select copy.bank_snapshot_id from public.trip_closure_invoice_pdf_copies copy
                where copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id
                  and copy.copy_kind='company' and copy.copy_version=2
              ))
          )
        ))
      )
  );
$$;
revoke all on function private.waybill_notification_audience_eligible(uuid,jsonb,text,boolean)
  from public,anon,authenticated,service_role;

do $active_company_lease_preflight$
begin
  if exists (
    select 1 from public.trip_closure_invoice_pdf_copies copy
    where copy.copy_kind='company' and copy.status='processing'
      and not private.waybill_company_copy_verification_eligible(
        copy.invoice_id,copy.trip_id,copy.id,copy.bank_snapshot_id)
  ) or exists (
    select 1 from public.notification_outbox notification
    where notification.event_type='waybill_ready' and notification.audience='client'
      and notification.status='processing'
      and not private.waybill_notification_audience_eligible(
        notification.trip_id,notification.payload,'client')
  ) then
    raise exception 'An unverified or superseded Company PDF/email lease is active; resolve the ambiguous worker operation before applying this migration.'
      using errcode='55000';
  end if;
end;
$active_company_lease_preflight$;

create or replace function public.enqueue_waybill_ready_notifications() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_inserted integer:=0; v_count integer;
begin
  insert into public.notification_outbox(trip_id,event_type,audience,delivery_sequence,recipients,payload)
  select invoice.trip_id,'waybill_ready','driver',0,array[nullif(btrim(invoice.driver_email),'')],
    jsonb_build_object('invoice_id',invoice.id,'invoice_number',invoice.invoice_number,'trip_number',invoice.trip_number)
  from public.trip_closure_invoices invoice
  join public.trip_closure_invoice_pdf_copies copy
    on copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id and copy.copy_kind='driver'
  where private.waybill_email_regular_delivery_allowed(invoice.id,invoice.trip_id)
    and copy.status='ready' and copy.ready_at is not null and copy.notification_eligible
    and nullif(btrim(invoice.driver_email),'') is not null
    and private.waybill_notification_audience_eligible(invoice.trip_id,
      jsonb_build_object('invoice_id',invoice.id,'invoice_number',invoice.invoice_number), 'driver')
  on conflict (trip_id,event_type,audience,delivery_sequence) do nothing;
  get diagnostics v_count=row_count;
  v_inserted:=v_inserted+v_count;

  insert into public.notification_outbox(trip_id,event_type,audience,delivery_sequence,recipients,payload)
  select invoice.trip_id,'waybill_ready','client',0,null,
    jsonb_build_object('invoice_id',invoice.id,'invoice_number',invoice.invoice_number,'trip_number',invoice.trip_number)
  from public.trip_closure_invoices invoice
  join lateral (
    select copy.* from public.trip_closure_invoice_pdf_copies copy
    where copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id and copy.copy_kind='company'
    order by copy.copy_version desc limit 1
  ) company_copy on true
  where private.waybill_email_regular_delivery_allowed(invoice.id,invoice.trip_id)
    and private.waybill_company_copy_email_eligible(invoice.id,invoice.trip_id,company_copy.id)
    and private.waybill_notification_audience_eligible(invoice.trip_id,
      jsonb_build_object('invoice_id',invoice.id,'invoice_number',invoice.invoice_number), 'client')
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
  update public.notification_outbox notification
  set recipients=case when v_recipient is null then null else array[v_recipient] end,
      status=case when v_recipient is null then 'blocked_configuration' else 'pending' end,
      blocked_reason_code=case when v_recipient is null then 'company_recipient_not_configured' else null end,
      last_error=case when v_recipient is null then 'Parent company recipient must be configured' else null end,
      lease_token=null,lease_until=null,next_attempt_at=statement_timestamp()
  from public.trip_closure_invoices invoice
  join lateral (
    select copy.* from public.trip_closure_invoice_pdf_copies copy
    where copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id and copy.copy_kind='company'
    order by copy.copy_version desc limit 1
  ) company_copy on true
  where notification.trip_id=invoice.trip_id and notification.event_type='waybill_ready'
    and notification.audience='client' and notification.delivery_sequence=0
    and private.waybill_email_regular_delivery_allowed(invoice.id,invoice.trip_id)
    and private.waybill_company_copy_email_eligible(invoice.id,invoice.trip_id,company_copy.id)
    and private.waybill_notification_audience_eligible(notification.trip_id,notification.payload,'client')
    and ((v_recipient is null and notification.status='pending' and notification.recipients is null
          and notification.attempts=0 and notification.first_attempt_at is null)
      or (v_recipient is not null and
          (notification.status='blocked_configuration'
            or (notification.status='pending' and notification.attempts=0
              and notification.first_attempt_at is null
              and notification.recipients is distinct from array[v_recipient]))));
  get diagnostics v_updated=row_count;
  return v_inserted+v_updated;
end;
$$;

create or replace function public.claim_waybill_notifications(p_sender text,p_limit integer default 5)
returns setof public.notification_outbox
language plpgsql security definer set search_path = '' as $$
declare
  v_candidate record;
  v_job public.notification_outbox%rowtype;
  v_claimed integer:=0;
begin
  if p_sender is null or length(btrim(p_sender))=0 or p_sender ~ E'[\r\n]'
    or p_limit is null or p_limit not between 1 and 10 then
    raise exception 'Invalid Waybill notification worker configuration' using errcode='22023';
  end if;

  update public.notification_outbox notification
  set status='failed',lease_token=null,lease_until=null,blocked_reason_code=null,
      last_error='Delivery retry limit reached',updated_at=statement_timestamp()
  where notification.event_type='waybill_ready' and notification.audience='driver'
    and notification.status in ('pending','processing')
    and (notification.status='pending' or notification.lease_until is null
      or notification.lease_until<statement_timestamp())
    and (notification.attempts>=8
      or notification.first_attempt_at<statement_timestamp()-interval '23 hours')
    and notification.recipients is not null and cardinality(notification.recipients)=1
    and exists (
      select 1 from public.trip_closure_invoices invoice
      join public.trip_closure_invoice_pdf_copies copy
        on copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id and copy.copy_kind='driver'
      where notification.trip_id=invoice.trip_id
        and notification.payload->>'invoice_id'=invoice.id::text
        and notification.payload->>'invoice_number'=invoice.invoice_number
        and private.waybill_email_regular_delivery_allowed(invoice.id,invoice.trip_id)
        and copy.status='ready' and copy.ready_at is not null and copy.notification_eligible
        and private.waybill_notification_audience_eligible(notification.trip_id,notification.payload,'driver')
        and invoice.driver_email is not null and notification.recipients=array[invoice.driver_email]
    );

  for v_candidate in
    select notification.id,invoice.id as invoice_id
    from public.notification_outbox notification
    join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id
      and notification.payload->>'invoice_id'=invoice.id::text
      and notification.payload->>'invoice_number'=invoice.invoice_number
    join lateral (
      select copy.* from public.trip_closure_invoice_pdf_copies copy
      where copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id and copy.copy_kind='company'
      order by copy.copy_version desc limit 1
    ) company_copy on true
    where notification.event_type='waybill_ready' and notification.audience='client'
      and notification.status in ('pending','processing')
      and (notification.status='pending' or notification.lease_until is null
        or notification.lease_until<statement_timestamp())
      and (notification.attempts>=8
        or notification.first_attempt_at<statement_timestamp()-interval '23 hours')
      and notification.recipients is not null and cardinality(notification.recipients)=1
      and private.waybill_email_regular_delivery_allowed(invoice.id,invoice.trip_id)
      and private.waybill_company_copy_email_eligible(invoice.id,invoice.trip_id,company_copy.id)
      and private.waybill_notification_audience_eligible(notification.trip_id,notification.payload,'client')
      and notification.recipients[1] ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    order by notification.created_at,notification.id limit 250
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtextextended('waybill-bank:'||v_candidate.invoice_id::text,0)
    ) then
      continue;
    end if;
    update public.notification_outbox notification
    set status='failed',lease_token=null,lease_until=null,blocked_reason_code=null,
        last_error='Delivery retry limit reached',updated_at=statement_timestamp()
    from public.trip_closure_invoices invoice
    join lateral (
      select copy.* from public.trip_closure_invoice_pdf_copies copy
      where copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id and copy.copy_kind='company'
      order by copy.copy_version desc limit 1
    ) company_copy on true
    where notification.id=v_candidate.id and notification.trip_id=invoice.trip_id
      and notification.payload->>'invoice_id'=invoice.id::text
      and notification.payload->>'invoice_number'=invoice.invoice_number
      and notification.event_type='waybill_ready' and notification.audience='client'
      and notification.status in ('pending','processing')
      and (notification.status='pending' or notification.lease_until is null
        or notification.lease_until<statement_timestamp())
      and (notification.attempts>=8
        or notification.first_attempt_at<statement_timestamp()-interval '23 hours')
      and notification.recipients is not null and cardinality(notification.recipients)=1
      and private.waybill_email_regular_delivery_allowed(invoice.id,invoice.trip_id)
      and private.waybill_company_copy_email_eligible(invoice.id,invoice.trip_id,company_copy.id)
      and private.waybill_notification_audience_eligible(notification.trip_id,notification.payload,'client');
  end loop;

  for v_candidate in
    select notification.id,notification.audience,invoice.id as invoice_id
    from public.notification_outbox notification
    join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id
      and notification.payload->>'invoice_id'=invoice.id::text
      and notification.payload->>'invoice_number'=invoice.invoice_number
    join lateral (
      select copy.* from public.trip_closure_invoice_pdf_copies copy
      where copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id
        and copy.copy_kind=case notification.audience when 'driver' then 'driver' when 'client' then 'company' else null end
      order by copy.copy_version desc limit 1
    ) copy on true
    where notification.event_type='waybill_ready' and notification.audience in ('driver','client')
      and notification.status in ('pending','processing')
      and notification.recipients is not null and cardinality(notification.recipients)=1
      and ((notification.status='pending' and notification.next_attempt_at<=statement_timestamp())
        or (notification.status='processing'
          and (notification.lease_until is null or notification.lease_until<statement_timestamp())))
      and private.waybill_email_regular_delivery_allowed(invoice.id,invoice.trip_id)
      and copy.status='ready' and copy.ready_at is not null and copy.notification_eligible
      and private.waybill_notification_audience_eligible(notification.trip_id,notification.payload,notification.audience)
      and ((notification.audience='driver' and invoice.driver_email is not null
          and notification.recipients=array[invoice.driver_email])
        or (notification.audience='client'
          and private.waybill_company_copy_email_eligible(invoice.id,invoice.trip_id,copy.id)
          and notification.recipients[1] ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
    order by notification.created_at,notification.id limit 250
  loop
    exit when v_claimed>=p_limit;
    if v_candidate.audience='client' and not pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtextextended('waybill-bank:'||v_candidate.invoice_id::text,0)
    ) then
      continue;
    end if;
    perform 1 from public.notification_outbox notification
    where notification.id=v_candidate.id for update skip locked;
    if not found then continue; end if;
    update public.notification_outbox notification
    set status='processing',attempts=notification.attempts+1,
        first_attempt_at=coalesce(notification.first_attempt_at,statement_timestamp()),
        lease_token=gen_random_uuid(),lease_until=statement_timestamp()+interval '5 minutes',
        updated_at=statement_timestamp()
    from public.trip_closure_invoices invoice
    join lateral (
      select copy.* from public.trip_closure_invoice_pdf_copies copy
      where copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id
        and copy.copy_kind=case v_candidate.audience when 'driver' then 'driver' else 'company' end
      order by copy.copy_version desc limit 1
    ) copy on true
    where notification.id=v_candidate.id and notification.trip_id=invoice.trip_id
      and notification.payload->>'invoice_id'=invoice.id::text
      and notification.payload->>'invoice_number'=invoice.invoice_number
      and notification.event_type='waybill_ready' and notification.audience=v_candidate.audience
      and notification.status in ('pending','processing')
      and ((notification.status='pending' and notification.next_attempt_at<=statement_timestamp())
        or (notification.status='processing'
          and (notification.lease_until is null or notification.lease_until<statement_timestamp())))
      and private.waybill_email_regular_delivery_allowed(invoice.id,invoice.trip_id)
      and copy.status='ready' and copy.ready_at is not null and copy.notification_eligible
      and private.waybill_notification_audience_eligible(notification.trip_id,notification.payload,notification.audience)
      and ((notification.audience='driver' and invoice.driver_email is not null
          and notification.recipients=array[invoice.driver_email])
        or (notification.audience='client'
          and private.waybill_company_copy_email_eligible(invoice.id,invoice.trip_id,copy.id)
          and notification.recipients is not null and cardinality(notification.recipients)=1
          and notification.recipients[1] ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
    returning notification.* into v_job;
    if found then
      v_claimed:=v_claimed+1;
      return next v_job;
    end if;
  end loop;
end;
$$;

commit;
