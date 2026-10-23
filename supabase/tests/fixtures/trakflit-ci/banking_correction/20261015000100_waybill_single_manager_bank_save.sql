begin;

alter table public.trip_closure_invoice_bank_detail_events
  add column actor_role_at_event public.app_role;

create function private.capture_waybill_bank_audit_actor_role() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor_role public.app_role;
begin
  if new.actor_id is distinct from auth.uid() then
    raise exception 'Bank audit actor must match the authenticated user' using errcode='42501';
  end if;

  select profile.role into v_actor_role
  from public.profiles profile
  where profile.id=auth.uid() and profile.is_active;
  if not found or v_actor_role is null then
    raise exception 'An active profile is required for bank audit events' using errcode='42501';
  end if;

  new.actor_role_at_event:=v_actor_role;
  return new;
end;
$$;

revoke all on function private.capture_waybill_bank_audit_actor_role()
  from public,anon,authenticated,service_role;

create trigger trip_closure_invoice_bank_detail_events_capture_actor_role
before insert on public.trip_closure_invoice_bank_detail_events
for each row execute function private.capture_waybill_bank_audit_actor_role();

create function public.save_waybill_company_bank_details(
  p_invoice_id uuid,p_bank_name text,p_account_name text,p_account_number text
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_invoice public.trip_closure_invoices%rowtype;
  v_previous_snapshot public.trip_closure_invoice_bank_snapshots%rowtype;
  v_submission_id uuid;
  v_snapshot_id uuid;
  v_version integer;
  v_saved_at timestamptz;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_invoice_id is null
    or p_bank_name is null or length(btrim(p_bank_name)) not between 1 and 200
    or p_account_name is null or length(btrim(p_account_name)) not between 1 and 200
    or p_account_number is null or btrim(p_account_number) !~ '^[0-9]{10}$' then
    raise exception 'Valid Waybill bank details are required' using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_invoice_id::text,0)
  );
  select invoice.* into v_invoice
  from public.trip_closure_invoices invoice
  where invoice.id=p_invoice_id
  for update;
  if not found then
    raise exception 'Closed Waybill not found' using errcode='22023';
  end if;

  select snapshot.* into v_previous_snapshot
  from public.trip_closure_invoice_bank_snapshots snapshot
  where snapshot.invoice_id=p_invoice_id
  order by snapshot.version desc
  limit 1
  for update;
  v_version:=coalesce(v_previous_snapshot.version,0)+1;
  v_saved_at:=clock_timestamp();

  insert into public.trip_closure_invoice_bank_submissions(
    invoice_id,trip_id,bank_name,account_name,account_number,
    submitted_by,submitted_at,correction_of_snapshot_id
  ) values (
    v_invoice.id,v_invoice.trip_id,btrim(p_bank_name),btrim(p_account_name),btrim(p_account_number),
    auth.uid(),v_saved_at,v_previous_snapshot.id
  ) returning id into v_submission_id;

  insert into public.trip_closure_invoice_bank_snapshots(
    invoice_id,trip_id,version,supersedes_snapshot_id,source_submission_id,
    bank_name,account_name,account_number,submitted_by,submitted_at,verified_by,verified_at
  ) values (
    v_invoice.id,v_invoice.trip_id,v_version,v_previous_snapshot.id,v_submission_id,
    btrim(p_bank_name),btrim(p_account_name),btrim(p_account_number),
    auth.uid(),v_saved_at,auth.uid(),v_saved_at
  ) returning id into v_snapshot_id;

  insert into public.trip_closure_invoice_bank_detail_events(
    submission_id,invoice_id,trip_id,event_type,reason_code,actor_id,occurred_at
  ) values (
    v_submission_id,v_invoice.id,v_invoice.trip_id,
    case when v_version=1 then 'verified' else 'correction_verified' end,
    'verified',auth.uid(),v_saved_at
  );

  if v_version=1 then
    update public.trip_closure_invoice_pdf_copies
    set status='pending',bank_snapshot_id=v_snapshot_id,attempts=0,
      next_attempt_at=v_saved_at,processing_started_at=null,lease_token=null,lease_until=null,
      ready_at=null,failed_at=null,last_error_code=null
    where invoice_id=v_invoice.id and copy_kind='company' and copy_version=1
      and bank_snapshot_id is null
      and status in ('blocked_missing_bank_details','blocked_bank_details_unverified');
    if not found then
      raise exception 'Company Waybill copy is unavailable' using errcode='22023';
    end if;
    return 'saved';
  end if;

  insert into public.trip_closure_invoice_pdf_copies(
    invoice_id,trip_id,invoice_number,copy_kind,copy_version,status,storage_bucket,
    storage_path,bank_snapshot_id,notification_eligible
  ) values (
    v_invoice.id,v_invoice.trip_id,v_invoice.invoice_number,'company',v_version,'pending',
    'waybill-company-copies',
    private.secure_waybill_copy_storage_path(v_invoice.invoice_number,'company',v_version),
    v_snapshot_id,false
  );
  return 'updated';
end;
$$;

create or replace function public.get_operations_waybill_copy_management_state(p_invoice_id uuid)
returns table(
  invoice_id uuid,
  invoice_number text,
  driver_pdf_status text,
  driver_pdf_ready_at timestamptz,
  company_pdf_status text,
  company_pdf_ready_at timestamptz,
  bank_verification_state text,
  pending_bank_submission_id uuid,
  latest_bank_snapshot_version integer,
  company_pdf_held_for_missing_bank_details boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  return query
  select invoice.id,
    invoice.invoice_number,
    coalesce(driver_copy.status,'not_available'),
    case when driver_copy.status='ready' then driver_copy.ready_at else null end,
    coalesce(company_copy.status,'not_available'),
    case when company_copy.status='ready' then company_copy.ready_at else null end,
    case
      when pending_submission.id is not null and bank_snapshot.version is not null then 'correction_pending'
      when pending_submission.id is not null then 'pending_verification'
      when bank_snapshot.version is not null then 'verified'
      when latest_decision.event_type='rejected' then 'rejected'
      else 'missing'
    end,
    pending_submission.id,
    bank_snapshot.version,
    coalesce(company_copy.status='blocked_missing_bank_details'
      and company_copy.bank_snapshot_id is null,false)
  from public.trip_closure_invoices invoice
  left join lateral (
    select copy.status,copy.ready_at
    from public.trip_closure_invoice_pdf_copies copy
    where copy.invoice_id=invoice.id and copy.copy_kind='driver'
    order by copy.copy_version desc limit 1
  ) driver_copy on true
  left join lateral (
    select copy.status,copy.ready_at,copy.bank_snapshot_id
    from public.trip_closure_invoice_pdf_copies copy
    where copy.invoice_id=invoice.id and copy.copy_kind='company'
    order by copy.copy_version desc limit 1
  ) company_copy on true
  left join lateral (
    select snapshot.version
    from public.trip_closure_invoice_bank_snapshots snapshot
    where snapshot.invoice_id=invoice.id
    order by snapshot.version desc limit 1
  ) bank_snapshot on true
  left join lateral (
    select submission.id
    from public.trip_closure_invoice_bank_submissions submission
    where submission.invoice_id=invoice.id
      and not exists (
        select 1 from public.trip_closure_invoice_bank_detail_events event
        where event.submission_id=submission.id
          and event.event_type in ('verified','correction_verified','rejected')
      )
      and not exists (
        select 1 from public.trip_closure_invoice_bank_snapshots newer_snapshot
        where newer_snapshot.invoice_id=submission.invoice_id
          and newer_snapshot.verified_at>=submission.submitted_at
      )
    order by submission.submitted_at desc,submission.id desc limit 1
  ) pending_submission on true
  left join lateral (
    select event.event_type
    from public.trip_closure_invoice_bank_detail_events event
    where event.invoice_id=invoice.id
      and event.event_type in ('verified','correction_verified','rejected')
    order by event.occurred_at desc,event.id desc limit 1
  ) latest_decision on true
  where invoice.id=p_invoice_id;
end;
$$;

create function public.get_operations_waybill_bank_audit(p_invoice_id uuid)
returns table(
  event_type text,
  occurred_at timestamptz,
  actor_display_name text,
  actor_role text,
  reason_code text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  return query
  select event.event_type,
    event.occurred_at,
    coalesce(nullif(btrim(actor.display_name),''),
      case when actor.id is null then 'Former user' else 'Unknown user' end),
    coalesce(event.actor_role_at_event::text,'Role not recorded'),
    event.reason_code
  from public.trip_closure_invoice_bank_detail_events event
  left join public.profiles actor on actor.id=event.actor_id
  where event.invoice_id=p_invoice_id
  order by event.occurred_at,event.id;
end;
$$;

revoke all on function public.save_waybill_company_bank_details(uuid,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.save_waybill_company_bank_details(uuid,text,text,text)
  to authenticated;

revoke all on function public.get_operations_waybill_bank_audit(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_operations_waybill_bank_audit(uuid)
  to authenticated;

commit;
