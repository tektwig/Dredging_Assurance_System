begin;

do $migration$
begin
  if to_regclass('private.loading_registration_bank_captures') is null
    or to_regclass('public.trip_closure_invoice_bank_submissions') is null
    or to_regclass('public.trip_closure_invoice_bank_detail_events') is null
    or to_regclass('public.trip_closure_invoice_bank_snapshots') is null
    or to_regclass('public.trip_closure_invoice_pdf_copies') is null
    or to_regprocedure('private.secure_waybill_copy_storage_path(text,text,integer)') is null
    or to_regprocedure('private.require_role(public.app_role[])') is null then
    raise exception 'Registration captures and secure Waybill foundation are required';
  end if;
end;
$migration$;

alter table public.trip_closure_invoice_bank_submissions
  add column source_kind text not null default 'operations_manager',
  add column source_registration_capture_id uuid
    references private.loading_registration_bank_captures(id) on delete restrict,
  add constraint trip_closure_invoice_bank_submission_source_check check (
    (source_kind='registration_capture' and source_registration_capture_id is not null)
    or (source_kind='operations_manager' and source_registration_capture_id is null)
  ),
  add constraint trip_closure_invoice_bank_submission_source_key
    unique (id,invoice_id,trip_id,source_kind);

alter table public.trip_closure_invoice_bank_snapshots
  add column source_kind text not null default 'operations_manager',
  add column source_registration_capture_id uuid
    references private.loading_registration_bank_captures(id) on delete restrict,
  alter column verified_by drop not null,
  alter column verified_at drop not null,
  add constraint trip_closure_invoice_bank_snapshot_source_check check (
    (source_kind='registration_capture' and source_registration_capture_id is not null
      and verified_by is null and verified_at is null)
    or (source_kind='operations_manager' and source_registration_capture_id is null
      and verified_by is not null and verified_at is not null)
  ),
  add constraint trip_closure_invoice_bank_snapshot_submission_source_fk
    foreign key (source_submission_id,invoice_id,trip_id,source_kind)
    references public.trip_closure_invoice_bank_submissions(id,invoice_id,trip_id,source_kind)
    on delete restrict;

alter table public.trip_closure_invoice_bank_detail_events
  drop constraint trip_closure_invoice_bank_detail_events_event_type_check,
  drop constraint trip_closure_invoice_bank_detail_events_check,
  add constraint trip_closure_invoice_bank_detail_events_event_type_check check (event_type in (
    'submitted','correction_submitted','review_viewed','verified','correction_verified','rejected',
    'registration_capture_snapshotted','bank_details_saved','bank_details_corrected','superseded'
  )),
  add constraint trip_closure_invoice_bank_detail_events_check check (
    (event_type in ('submitted','correction_submitted','review_viewed',
      'registration_capture_snapshotted','bank_details_saved','bank_details_corrected')
      and reason_code is null)
    or (event_type in ('verified','correction_verified')
      and reason_code is not null and reason_code='verified')
    or (event_type='superseded' and reason_code is not null
      and reason_code='superseded_by_single_step_save')
    or (event_type='rejected' and reason_code is not null and reason_code in (
      'mismatch','invalid_account_name','invalid_account_number','unsupported_bank'
    ))
  );

create unique index trip_closure_invoice_bank_one_atomic_event
  on public.trip_closure_invoice_bank_detail_events(submission_id)
  where event_type in ('registration_capture_snapshotted','bank_details_saved',
    'bank_details_corrected','superseded');

create table private.waybill_company_bank_save_receipts (
  invoice_id uuid not null,
  trip_id uuid not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  request_id uuid not null,
  source_submission_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (invoice_id,actor_id,request_id),
  foreign key (invoice_id,trip_id)
    references public.trip_closure_invoices(id,trip_id) on delete restrict,
  foreign key (source_submission_id,invoice_id,trip_id)
    references public.trip_closure_invoice_bank_submissions(id,invoice_id,trip_id) on delete restrict
);
alter table private.waybill_company_bank_save_receipts enable row level security;
revoke all on private.waybill_company_bank_save_receipts from public,anon,authenticated,service_role;
create trigger waybill_company_bank_save_receipts_immutable
before update or delete on private.waybill_company_bank_save_receipts
for each row execute function private.reject_secure_waybill_mutation();

create function private.validate_waybill_bank_snapshot_source() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_submission_source text;
  v_submission_capture_id uuid;
  v_submission_bank_name text;
  v_submission_account_name text;
  v_submission_account_number text;
  v_submission_actor uuid;
  v_submission_at timestamptz;
  v_driver_id uuid;
  v_capture_bank_name text;
  v_capture_account_name text;
  v_capture_account_number text;
  v_capture_driver_id uuid;
  v_capture_actor uuid;
  v_capture_at timestamptz;
begin
  select submission.source_kind,submission.source_registration_capture_id,
    submission.bank_name,submission.account_name,submission.account_number,
    submission.submitted_by,submission.submitted_at,invoice.driver_id
    into v_submission_source,v_submission_capture_id,v_submission_bank_name,
      v_submission_account_name,v_submission_account_number,v_submission_actor,
      v_submission_at,v_driver_id
  from public.trip_closure_invoice_bank_submissions submission
  join public.trip_closure_invoices invoice
    on invoice.id=submission.invoice_id and invoice.trip_id=submission.trip_id
  where submission.id=new.source_submission_id
    and submission.invoice_id=new.invoice_id and submission.trip_id=new.trip_id;
  if not found or v_submission_source is distinct from new.source_kind
    or v_submission_capture_id is distinct from new.source_registration_capture_id
    or v_submission_bank_name is distinct from new.bank_name
    or v_submission_account_name is distinct from new.account_name
    or v_submission_account_number is distinct from new.account_number
    or v_submission_actor is distinct from new.submitted_by
    or v_submission_at is distinct from new.submitted_at then
    raise exception 'Bank snapshot source does not match its immutable submission' using errcode='23514';
  end if;
  if new.source_kind='registration_capture' then
    select capture.driver_id,capture.bank_name,capture.account_name,capture.account_number,
      capture.captured_by,capture.captured_at
      into v_capture_driver_id,v_capture_bank_name,v_capture_account_name,
        v_capture_account_number,v_capture_actor,v_capture_at
    from private.loading_registration_bank_captures capture
    where capture.id=new.source_registration_capture_id;
    if not found or v_capture_driver_id is distinct from v_driver_id then
      raise exception 'Registration bank capture is not associated with this Waybill driver' using errcode='23514';
    end if;
    if v_capture_bank_name is distinct from new.bank_name
      or v_capture_account_name is distinct from new.account_name
      or v_capture_account_number is distinct from new.account_number
      or v_capture_actor is distinct from new.submitted_by
      or v_capture_at is distinct from new.submitted_at then
      raise exception 'Registration bank snapshot must preserve captured values and attribution' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger waybill_bank_snapshot_source_valid
before insert on public.trip_closure_invoice_bank_snapshots
for each row execute function private.validate_waybill_bank_snapshot_source();
revoke all on function private.validate_waybill_bank_snapshot_source() from public,anon,authenticated,service_role;

create function private.snapshot_registration_bank_capture_for_invoice(p_invoice_id uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_invoice public.trip_closure_invoices%rowtype;
  v_capture private.loading_registration_bank_captures%rowtype;
  v_existing_snapshot_id uuid;
  v_submission_id uuid;
  v_snapshot_id uuid;
begin
  if p_invoice_id is null then return null; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('waybill-bank:'||p_invoice_id::text,0)
  );
  select * into v_invoice from public.trip_closure_invoices
  where id=p_invoice_id for update;
  if not found then return null; end if;

  select snapshot.id into v_existing_snapshot_id
  from public.trip_closure_invoice_bank_snapshots snapshot
  where snapshot.invoice_id=v_invoice.id
  order by snapshot.version desc limit 1 for update;
  if v_existing_snapshot_id is not null then return v_existing_snapshot_id; end if;

  if exists (
    select 1 from public.trip_closure_invoice_bank_submissions submission
    where submission.invoice_id=v_invoice.id
      and not exists (
        select 1 from public.trip_closure_invoice_bank_detail_events event
        where event.submission_id=submission.id
          and event.event_type in ('verified','correction_verified','rejected',
            'registration_capture_snapshotted','bank_details_saved','bank_details_corrected','superseded')
      )
  ) then
    return null;
  end if;

  select * into v_capture from private.loading_registration_bank_captures capture
  where capture.driver_id=v_invoice.driver_id for share;
  if not found then return null; end if;
  if v_capture.bank_name<>btrim(v_capture.bank_name)
    or length(v_capture.bank_name) not between 1 and 200
    or v_capture.account_name<>btrim(v_capture.account_name)
    or length(v_capture.account_name) not between 1 and 200
    or v_capture.account_number !~ '^[0-9]{10}$' then
    raise exception 'Stored registration bank capture is invalid' using errcode='23514';
  end if;

  insert into public.trip_closure_invoice_bank_submissions(
    invoice_id,trip_id,bank_name,account_name,account_number,submitted_by,submitted_at,
    source_kind,source_registration_capture_id
  ) values (
    v_invoice.id,v_invoice.trip_id,v_capture.bank_name,v_capture.account_name,v_capture.account_number,
    v_capture.captured_by,v_capture.captured_at,'registration_capture',v_capture.id
  ) returning id into v_submission_id;

  insert into public.trip_closure_invoice_bank_detail_events(
    submission_id,invoice_id,trip_id,event_type,actor_id
  ) values (
    v_submission_id,v_invoice.id,v_invoice.trip_id,'registration_capture_snapshotted',v_capture.captured_by
  );

  insert into public.trip_closure_invoice_bank_snapshots(
    invoice_id,trip_id,version,supersedes_snapshot_id,source_submission_id,
    bank_name,account_name,account_number,submitted_by,submitted_at,verified_by,verified_at,
    source_kind,source_registration_capture_id
  ) values (
    v_invoice.id,v_invoice.trip_id,1,null,v_submission_id,
    v_capture.bank_name,v_capture.account_name,v_capture.account_number,
    v_capture.captured_by,v_capture.captured_at,null,null,
    'registration_capture',v_capture.id
  ) returning id into v_snapshot_id;

  return v_snapshot_id;
end;
$$;
revoke all on function private.snapshot_registration_bank_capture_for_invoice(uuid)
  from public,anon,authenticated,service_role;

create or replace function private.queue_secure_waybill_pdf_copies() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_snapshot_id uuid;
begin
  v_snapshot_id:=private.snapshot_registration_bank_capture_for_invoice(new.id);
  insert into public.trip_closure_invoice_pdf_copies(
    invoice_id,trip_id,invoice_number,copy_kind,copy_version,status,storage_bucket,storage_path,
    bank_snapshot_id,notification_eligible
  ) values
    (new.id,new.trip_id,new.invoice_number,'driver',1,'pending','waybill-driver-copies',
      private.secure_waybill_copy_storage_path(new.invoice_number,'driver',1),null,true),
    (new.id,new.trip_id,new.invoice_number,'company',1,
      case when v_snapshot_id is null then 'blocked_missing_bank_details' else 'pending' end,
      'waybill-company-copies',
      private.secure_waybill_copy_storage_path(new.invoice_number,'company',1),v_snapshot_id,true)
  on conflict (invoice_id,copy_kind,copy_version) do nothing;
  return null;
end;
$$;
revoke all on function private.queue_secure_waybill_pdf_copies() from public,anon,authenticated,service_role;

create or replace function public.submit_waybill_company_bank_details(
  p_invoice_id uuid,p_bank_name text,p_account_name text,p_account_number text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_submission_id uuid;
  v_previous_snapshot public.trip_closure_invoice_bank_snapshots%rowtype;
  v_event_type text;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_invoice_id is null or p_bank_name is null or length(btrim(p_bank_name)) not between 1 and 200
    or p_account_name is null or length(btrim(p_account_name)) not between 1 and 200
    or p_account_number is null or btrim(p_account_number) !~ '^[0-9]{10}$' then
    raise exception 'Valid Waybill bank details are required' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('waybill-bank:'||p_invoice_id::text,0)
  );
  if not exists (select 1 from public.trip_closure_invoices where id=p_invoice_id) then
    raise exception 'Closed Waybill not found' using errcode='22023';
  end if;
  select * into v_previous_snapshot from public.trip_closure_invoice_bank_snapshots
  where invoice_id=p_invoice_id order by version desc limit 1 for update;
  if exists (
    select 1 from public.trip_closure_invoice_bank_submissions submission
    where submission.invoice_id=p_invoice_id
      and not exists (
        select 1 from public.trip_closure_invoice_bank_detail_events event
        where event.submission_id=submission.id
          and event.event_type in ('verified','correction_verified','rejected',
            'registration_capture_snapshotted','bank_details_saved','bank_details_corrected','superseded')
      )
  ) then
    raise exception 'Waybill bank details already have an unresolved submission' using errcode='P4091';
  end if;
  insert into public.trip_closure_invoice_bank_submissions(
    invoice_id,trip_id,bank_name,account_name,account_number,submitted_by,submitted_at,
    correction_of_snapshot_id,source_kind
  ) select id,trip_id,btrim(p_bank_name),btrim(p_account_name),btrim(p_account_number),
      auth.uid(),clock_timestamp(),v_previous_snapshot.id,'operations_manager'
    from public.trip_closure_invoices where id=p_invoice_id
  returning id into v_submission_id;
  v_event_type:=case when v_previous_snapshot.id is null then 'submitted' else 'correction_submitted' end;
  insert into public.trip_closure_invoice_bank_detail_events(
    submission_id,invoice_id,trip_id,event_type,actor_id
  ) select id,invoice_id,trip_id,v_event_type,auth.uid()
    from public.trip_closure_invoice_bank_submissions where id=v_submission_id;
  if v_previous_snapshot.id is null then
    update public.trip_closure_invoice_pdf_copies
    set status='blocked_bank_details_unverified'
    where invoice_id=p_invoice_id and copy_kind='company' and copy_version=1
      and status in ('blocked_missing_bank_details','blocked_bank_details_unverified')
      and bank_snapshot_id is null;
    if not found then raise exception 'Company Waybill copy is unavailable' using errcode='22023'; end if;
  end if;
  return v_submission_id;
end;
$$;

create function public.save_waybill_company_bank_details(
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
  order by copy.copy_version desc limit 1 for update;
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

create or replace function public.get_waybill_company_bank_submission_for_review(p_submission_id uuid)
returns table(invoice_number text,bank_name text,account_name text,account_number text,
  submitted_by uuid,submitted_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_submission public.trip_closure_invoice_bank_submissions%rowtype;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  select submission.* into v_submission from public.trip_closure_invoice_bank_submissions submission
  where submission.id=p_submission_id for update;
  if not found then return; end if;
  if exists (
    select 1 from public.trip_closure_invoice_bank_detail_events event
    where event.submission_id=v_submission.id
      and event.event_type in ('verified','correction_verified','rejected',
        'registration_capture_snapshotted','bank_details_saved','bank_details_corrected','superseded')
  ) then return; end if;
  insert into public.trip_closure_invoice_bank_detail_events(
    submission_id,invoice_id,trip_id,event_type,actor_id
  ) values (v_submission.id,v_submission.invoice_id,v_submission.trip_id,'review_viewed',auth.uid());
  return query select invoice.invoice_number,v_submission.bank_name,v_submission.account_name,
      v_submission.account_number,v_submission.submitted_by,v_submission.submitted_at
    from public.trip_closure_invoices invoice
    where invoice.id=v_submission.invoice_id and invoice.trip_id=v_submission.trip_id;
end;
$$;

create or replace function public.verify_waybill_company_bank_details(
  p_submission_id uuid,p_approved boolean,p_reason_code text default null
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_submission public.trip_closure_invoice_bank_submissions%rowtype;
  v_previous_snapshot public.trip_closure_invoice_bank_snapshots%rowtype;
  v_snapshot_id uuid;
  v_version integer;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_submission_id is null or p_approved is null
    or (p_approved and p_reason_code is not null and p_reason_code<>'verified')
    or (not p_approved and (p_reason_code is null or p_reason_code not in (
      'mismatch','invalid_account_name','invalid_account_number','unsupported_bank'
    ))) then
    raise exception 'A valid verification decision is required' using errcode='22023';
  end if;
  select * into v_submission from public.trip_closure_invoice_bank_submissions
  where id=p_submission_id for update;
  if not found then raise exception 'Waybill bank submission not found' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('waybill-bank:'||v_submission.invoice_id::text,0)
  );
  select * into v_previous_snapshot from public.trip_closure_invoice_bank_snapshots
  where invoice_id=v_submission.invoice_id order by version desc limit 1 for update;
  if v_submission.correction_of_snapshot_id is distinct from v_previous_snapshot.id then
    raise exception 'Bank details changed after this submission; submit a new version' using errcode='40001';
  end if;
  if exists (
    select 1 from public.trip_closure_invoice_bank_detail_events
    where submission_id=p_submission_id and event_type in ('verified','correction_verified','rejected',
      'registration_capture_snapshotted','bank_details_saved','bank_details_corrected','superseded')
  ) then
    raise exception 'Waybill bank submission already has a final decision' using errcode='23505';
  end if;
  if p_approved then
    v_version:=coalesce(v_previous_snapshot.version,0)+1;
    insert into public.trip_closure_invoice_bank_snapshots(
      invoice_id,trip_id,version,supersedes_snapshot_id,source_submission_id,
      bank_name,account_name,account_number,submitted_by,submitted_at,verified_by,verified_at,
      source_kind
    ) values (
      v_submission.invoice_id,v_submission.trip_id,v_version,v_previous_snapshot.id,
      v_submission.id,v_submission.bank_name,v_submission.account_name,v_submission.account_number,
      v_submission.submitted_by,v_submission.submitted_at,auth.uid(),clock_timestamp(),'operations_manager'
    ) returning id into v_snapshot_id;
    insert into public.trip_closure_invoice_bank_detail_events(
      submission_id,invoice_id,trip_id,event_type,reason_code,actor_id
    ) values (v_submission.id,v_submission.invoice_id,v_submission.trip_id,
      case when v_version=1 then 'verified' else 'correction_verified' end,'verified',auth.uid());
    if v_version=1 then
      update public.trip_closure_invoice_pdf_copies
      set status='pending',bank_snapshot_id=v_snapshot_id,attempts=0,
        next_attempt_at=clock_timestamp(),failed_at=null,last_error_code=null
      where invoice_id=v_submission.invoice_id and copy_kind='company' and copy_version=1
        and status='blocked_bank_details_unverified' and bank_snapshot_id is null;
      if not found then raise exception 'Company Waybill copy is unavailable' using errcode='22023'; end if;
      return 'verified';
    end if;
    insert into public.trip_closure_invoice_pdf_copies(
      invoice_id,trip_id,invoice_number,copy_kind,copy_version,status,storage_bucket,
      storage_path,bank_snapshot_id,notification_eligible
    ) select invoice.id,invoice.trip_id,invoice.invoice_number,'company',v_version,'pending',
        'waybill-company-copies',
        private.secure_waybill_copy_storage_path(invoice.invoice_number,'company',v_version),
        v_snapshot_id,false
      from public.trip_closure_invoices invoice
      where invoice.id=v_submission.invoice_id and invoice.trip_id=v_submission.trip_id;
    if not found then raise exception 'Company Waybill copy is unavailable' using errcode='22023'; end if;
    return 'corrected';
  end if;
  insert into public.trip_closure_invoice_bank_detail_events(
    submission_id,invoice_id,trip_id,event_type,reason_code,actor_id
  ) values (v_submission.id,v_submission.invoice_id,v_submission.trip_id,'rejected',p_reason_code,auth.uid());
  return 'rejected';
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
    coalesce(company_copy.status,'not_available'),
    case when company_copy.status='ready' then company_copy.ready_at else null end,
    case
      when pending_submission.id is not null and bank_snapshot.version is not null then 'correction_pending'
      when pending_submission.id is not null then 'pending_verification'
      when bank_snapshot.source_kind='registration_capture' then 'registration_captured'
      when bank_snapshot.version is not null then 'verified'
      when latest_decision.event_type='rejected' then 'rejected'
      else 'missing'
    end,
    pending_submission.id,bank_snapshot.version,
    coalesce(company_copy.status='blocked_missing_bank_details'
      and company_copy.bank_snapshot_id is null,false)
  from public.trip_closure_invoices invoice
  left join lateral (
    select copy.status,copy.ready_at from public.trip_closure_invoice_pdf_copies copy
    where copy.invoice_id=invoice.id and copy.copy_kind='driver'
    order by copy.copy_version desc limit 1
  ) driver_copy on true
  left join lateral (
    select copy.status,copy.ready_at,copy.bank_snapshot_id from public.trip_closure_invoice_pdf_copies copy
    where copy.invoice_id=invoice.id and copy.copy_kind='company'
    order by copy.copy_version desc limit 1
  ) company_copy on true
  left join lateral (
    select snapshot.version,snapshot.source_kind from public.trip_closure_invoice_bank_snapshots snapshot
    where snapshot.invoice_id=invoice.id order by snapshot.version desc limit 1
  ) bank_snapshot on true
  left join lateral (
    select submission.id from public.trip_closure_invoice_bank_submissions submission
    where submission.invoice_id=invoice.id
      and not exists (
        select 1 from public.trip_closure_invoice_bank_detail_events event
        where event.submission_id=submission.id and event.event_type in (
          'verified','correction_verified','rejected','registration_capture_snapshotted',
          'bank_details_saved','bank_details_corrected','superseded'
        )
      )
    order by submission.submitted_at desc,submission.id desc limit 1
  ) pending_submission on true
  left join lateral (
    select event.event_type from public.trip_closure_invoice_bank_detail_events event
    where event.invoice_id=invoice.id and event.event_type in (
      'verified','correction_verified','rejected','registration_capture_snapshotted',
      'bank_details_saved','bank_details_corrected','superseded'
    )
    order by event.occurred_at desc,event.id desc limit 1
  ) latest_decision on true
  where invoice.id=p_invoice_id;
end;
$$;

create function public.get_operations_missing_bank_waybills()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_as_of timestamptz:=statement_timestamp();
  v_result jsonb;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  with missing as materialized (
    select invoice.id,invoice.invoice_number,invoice.trip_number,invoice.issued_at
    from public.trip_closure_invoices invoice
    join public.trips trip on trip.id=invoice.trip_id and trip.status='closed'
    join lateral (
      select copy.status,copy.bank_snapshot_id from public.trip_closure_invoice_pdf_copies copy
      where copy.invoice_id=invoice.id and copy.copy_kind='company'
      order by copy.copy_version desc limit 1
    ) company_copy on true
    where company_copy.status='blocked_missing_bank_details'
      and company_copy.bank_snapshot_id is null
      and not exists (
        select 1 from public.trip_closure_invoice_bank_snapshots snapshot
        where snapshot.invoice_id=invoice.id
      )
      and not exists (
        select 1 from private.loading_registration_bank_captures capture
        where capture.driver_id=invoice.driver_id
      )
      and not exists (
        select 1 from public.trip_closure_invoice_bank_submissions submission
        where submission.invoice_id=invoice.id
          and not exists (
            select 1 from public.trip_closure_invoice_bank_detail_events event
            where event.submission_id=submission.id and event.event_type in (
              'verified','correction_verified','rejected','registration_capture_snapshotted',
              'bank_details_saved','bank_details_corrected','superseded'
            )
          )
      )
  )
  select jsonb_build_object(
    'as_of',v_as_of,
    'count',(select count(*) from missing),
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'invoice_id',preview.id,'invoice_number',preview.invoice_number,
        'trip_number',preview.trip_number,'issued_at',preview.issued_at
      ) order by preview.issued_at,preview.id)
      from (select * from missing order by issued_at,id limit 10) preview
    ),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

do $migration$
declare
  v_waybill_number text;
  v_invoice_id uuid;
  v_snapshot_id uuid;
  v_copy_status text;
  v_copy_snapshot_id uuid;
begin
  foreach v_waybill_number in array array[
    'WB-2026-000040','WB-2026-000041','WB-2026-000042'
  ] loop
    select invoice.id into v_invoice_id from public.trip_closure_invoices invoice
    where invoice.invoice_number=v_waybill_number;
    if not found then continue; end if;

    if not exists (
      select 1 from public.trip_closure_invoice_pdf_copies copy
      where copy.invoice_id=v_invoice_id and copy.copy_kind='company'
    ) then
      raise exception 'Company PDF copy missing for targeted Waybill %',v_waybill_number;
    end if;

    select snapshot.id into v_snapshot_id
    from public.trip_closure_invoice_bank_snapshots snapshot
    where snapshot.invoice_id=v_invoice_id order by snapshot.version desc limit 1;
    if v_snapshot_id is null then
      if not exists (
        select 1 from public.trip_closure_invoices invoice
        join private.loading_registration_bank_captures capture on capture.driver_id=invoice.driver_id
        where invoice.id=v_invoice_id
      ) then
        raise exception 'Expected registration bank capture is missing for targeted Waybill %',v_waybill_number;
      end if;
      v_snapshot_id:=private.snapshot_registration_bank_capture_for_invoice(v_invoice_id);
      if v_snapshot_id is null then
        raise exception 'Registration bank capture could not be snapshotted for targeted Waybill %',v_waybill_number;
      end if;
    end if;

    update public.trip_closure_invoice_pdf_copies copy
    set status='pending',bank_snapshot_id=v_snapshot_id,next_attempt_at=clock_timestamp()
    where copy.invoice_id=v_invoice_id and copy.copy_kind='company'
      and copy.copy_version=1 and copy.status='blocked_missing_bank_details'
      and copy.bank_snapshot_id is null;
    if not found then
      select copy.status,copy.bank_snapshot_id into v_copy_status,v_copy_snapshot_id
      from public.trip_closure_invoice_pdf_copies copy
      where copy.invoice_id=v_invoice_id and copy.copy_kind='company'
      order by copy.copy_version desc limit 1;
      if not found or v_copy_snapshot_id is distinct from v_snapshot_id
        or v_copy_status not in ('pending','processing','ready','failed') then
        raise exception 'Historical Company PDF state is inconsistent for targeted Waybill %',v_waybill_number;
      end if;
    end if;
  end loop;
end;
$migration$;

revoke all on function public.save_waybill_company_bank_details(uuid,uuid,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.save_waybill_company_bank_details(uuid,uuid,text,text,text)
  to authenticated;
revoke all on function public.get_operations_missing_bank_waybills()
  from public,anon,authenticated,service_role;
grant execute on function public.get_operations_missing_bank_waybills()
  to authenticated;
revoke all on function private.snapshot_registration_bank_capture_for_invoice(uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.queue_secure_waybill_pdf_copies()
  from public,anon,authenticated,service_role;

commit;
