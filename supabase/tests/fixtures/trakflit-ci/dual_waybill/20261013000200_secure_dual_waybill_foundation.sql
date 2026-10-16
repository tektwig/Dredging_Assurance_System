begin;

create function private.secure_waybill_copy_storage_path(
  p_invoice_number text,p_copy_kind text,p_copy_version integer
) returns text
language sql immutable strict set search_path = '' as $$
  select case
    when p_copy_version=1 then private.waybill_storage_path(p_invoice_number)
    when p_copy_kind='company' and p_copy_version>1 then
      pg_catalog.replace(private.waybill_storage_path(p_invoice_number),'.pdf',
        pg_catalog.format('-company-v%s.pdf',p_copy_version))
    else null
  end;
$$;

create table public.trip_closure_invoice_bank_submissions (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null,
  trip_id uuid not null,
  bank_name text not null check (bank_name=btrim(bank_name) and length(bank_name) between 1 and 200),
  account_name text not null check (account_name=btrim(account_name) and length(account_name) between 1 and 200),
  account_number text not null check (account_number ~ '^[0-9]{10}$'),
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  submitted_at timestamptz not null default clock_timestamp(),
  unique (id,invoice_id,trip_id),
  foreign key (invoice_id,trip_id)
    references public.trip_closure_invoices(id,trip_id) on delete restrict
);

create table public.trip_closure_invoice_bank_detail_events (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null,
  invoice_id uuid not null,
  trip_id uuid not null,
  event_type text not null check (event_type in (
    'submitted','correction_submitted','review_viewed','verified','correction_verified','rejected'
  )),
  reason_code text,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  occurred_at timestamptz not null default clock_timestamp(),
  check (
    (event_type in ('submitted','correction_submitted','review_viewed') and reason_code is null)
    or (event_type in ('verified','correction_verified') and reason_code is not null and reason_code='verified')
    or (event_type='rejected' and reason_code is not null
      and reason_code in ('mismatch','invalid_account_name','invalid_account_number','unsupported_bank'))
  ),
  foreign key (submission_id,invoice_id,trip_id)
    references public.trip_closure_invoice_bank_submissions(id,invoice_id,trip_id) on delete restrict
);
create unique index trip_closure_invoice_bank_one_submission_event
  on public.trip_closure_invoice_bank_detail_events(submission_id)
  where event_type in ('submitted','correction_submitted');
create unique index trip_closure_invoice_bank_one_terminal_event
  on public.trip_closure_invoice_bank_detail_events(submission_id)
  where event_type in ('verified','correction_verified','rejected');
create index trip_closure_invoice_bank_events_invoice_idx
  on public.trip_closure_invoice_bank_detail_events(invoice_id,occurred_at,id);

create table public.trip_closure_invoice_bank_snapshots (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null,
  trip_id uuid not null,
  version integer not null check (version>0),
  supersedes_snapshot_id uuid,
  source_submission_id uuid not null unique,
  bank_name text not null check (bank_name=btrim(bank_name) and length(bank_name) between 1 and 200),
  account_name text not null check (account_name=btrim(account_name) and length(account_name) between 1 and 200),
  account_number text not null check (account_number ~ '^[0-9]{10}$'),
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  submitted_at timestamptz not null,
  verified_by uuid not null references public.profiles(id) on delete restrict,
  verified_at timestamptz not null default clock_timestamp(),
  unique (invoice_id,version),
  unique (id,invoice_id,trip_id),
  check (verified_at>=submitted_at),
  check ((version=1 and supersedes_snapshot_id is null) or (version>1 and supersedes_snapshot_id is not null)),
  foreign key (invoice_id,trip_id)
    references public.trip_closure_invoices(id,trip_id) on delete restrict,
  foreign key (supersedes_snapshot_id,invoice_id,trip_id)
    references public.trip_closure_invoice_bank_snapshots(id,invoice_id,trip_id) on delete restrict,
  foreign key (source_submission_id,invoice_id,trip_id)
    references public.trip_closure_invoice_bank_submissions(id,invoice_id,trip_id) on delete restrict
);

alter table public.trip_closure_invoice_bank_submissions
  add column correction_of_snapshot_id uuid;
alter table public.trip_closure_invoice_bank_submissions
  add constraint trip_closure_invoice_bank_submissions_correction_fk
  foreign key (correction_of_snapshot_id,invoice_id,trip_id)
  references public.trip_closure_invoice_bank_snapshots(id,invoice_id,trip_id) on delete restrict;

create function private.reject_secure_waybill_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Waybill bank audit and snapshot rows are immutable' using errcode='23514';
end;
$$;
create trigger trip_closure_invoice_bank_submissions_immutable
before update or delete on public.trip_closure_invoice_bank_submissions
for each row execute function private.reject_secure_waybill_mutation();
create trigger trip_closure_invoice_bank_events_immutable
before update or delete on public.trip_closure_invoice_bank_detail_events
for each row execute function private.reject_secure_waybill_mutation();
create trigger trip_closure_invoice_bank_snapshots_immutable
before update or delete on public.trip_closure_invoice_bank_snapshots
for each row execute function private.reject_secure_waybill_mutation();

create table public.trip_closure_invoice_pdf_copies (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null,
  trip_id uuid not null,
  invoice_number text not null,
  copy_kind text not null check (copy_kind in ('driver','company')),
  copy_version integer not null default 1 check (copy_version>0),
  status text not null check (status in (
    'pending','processing','ready','failed','blocked_missing_bank_details',
    'blocked_bank_details_unverified'
  )),
  storage_bucket text not null,
  storage_path text not null,
  bank_snapshot_id uuid,
  notification_eligible boolean not null default false,
  attempts integer not null default 0 check (attempts>=0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  next_attempt_at timestamptz not null default clock_timestamp(),
  processing_started_at timestamptz,
  lease_until timestamptz,
  lease_token uuid,
  ready_at timestamptz,
  failed_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code in (
    'snapshot_unavailable','invalid_snapshot','pdf_generation_failed','storage_upload_failed','attempt_limit_exhausted'
  )),
  unique (invoice_id,copy_kind,copy_version),
  unique (storage_bucket,storage_path),
  foreign key (invoice_id,trip_id)
    references public.trip_closure_invoices(id,trip_id) on delete restrict,
  foreign key (bank_snapshot_id,invoice_id,trip_id)
    references public.trip_closure_invoice_bank_snapshots(id,invoice_id,trip_id) on delete restrict,
  check (invoice_number ~ '^(INV|WB)-[0-9]{4}-[0-9]{6,}$'),
  check (storage_path=private.secure_waybill_copy_storage_path(invoice_number,copy_kind,copy_version)),
  check (
    (copy_kind='driver' and storage_bucket='waybill-driver-copies'
      and copy_version=1 and bank_snapshot_id is null and status not in (
        'blocked_missing_bank_details','blocked_bank_details_unverified'
      ))
    or (copy_kind='company' and storage_bucket='waybill-company-copies'
      and (
        (status in ('blocked_missing_bank_details','blocked_bank_details_unverified') and bank_snapshot_id is null)
        or (status in ('pending','processing','ready','failed') and bank_snapshot_id is not null)
      ))
  ),
  check (
    (status='processing' and lease_token is not null and lease_until is not null)
    or (status<>'processing' and lease_token is null and lease_until is null)
  ),
  check (
    (status='ready' and ready_at is not null and failed_at is null)
    or (status='failed' and ready_at is null and failed_at is not null)
    or (status not in ('ready','failed') and ready_at is null and failed_at is null)
  )
);
create index trip_closure_invoice_pdf_copies_pending_idx
  on public.trip_closure_invoice_pdf_copies(copy_kind,next_attempt_at,created_at)
  where status in ('pending','processing');
create trigger trip_closure_invoice_pdf_copies_timestamps
before insert or update on public.trip_closure_invoice_pdf_copies
for each row execute function private.set_timestamps();

create function private.protect_waybill_pdf_copy_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.invoice_id is distinct from old.invoice_id
    or new.trip_id is distinct from old.trip_id
    or new.invoice_number is distinct from old.invoice_number
    or new.copy_kind is distinct from old.copy_kind
    or new.copy_version is distinct from old.copy_version
    or new.storage_bucket is distinct from old.storage_bucket
    or new.storage_path is distinct from old.storage_path
    or new.notification_eligible is distinct from old.notification_eligible
    or (old.bank_snapshot_id is not null and new.bank_snapshot_id is distinct from old.bank_snapshot_id) then
    raise exception 'Waybill copy identity is immutable' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger trip_closure_invoice_pdf_copy_identity_immutable
before update on public.trip_closure_invoice_pdf_copies
for each row execute function private.protect_waybill_pdf_copy_identity();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values
  ('waybill-driver-copies','waybill-driver-copies',false,10485760,array['application/pdf']),
  ('waybill-company-copies','waybill-company-copies',false,10485760,array['application/pdf'])
on conflict (id) do nothing;

do $$
begin
  if exists (
    select 1 from storage.buckets
    where id in ('waybill-driver-copies','waybill-company-copies')
      and (public or file_size_limit<>10485760 or allowed_mime_types<>array['application/pdf'])
  ) or (select count(*) from storage.buckets where id in ('waybill-driver-copies','waybill-company-copies'))<>2 then
    raise exception 'Waybill copy buckets must be private PDF-only buckets';
  end if;
  if not exists (select 1 from storage.buckets where id='waybills' and not public) then
    raise exception 'Legacy Waybill bucket must remain private';
  end if;
end;
$$;

alter table public.trip_closure_invoice_bank_submissions enable row level security;
alter table public.trip_closure_invoice_bank_detail_events enable row level security;
alter table public.trip_closure_invoice_bank_snapshots enable row level security;
alter table public.trip_closure_invoice_pdf_copies enable row level security;
revoke all on public.trip_closure_invoice_bank_submissions,
  public.trip_closure_invoice_bank_detail_events,
  public.trip_closure_invoice_bank_snapshots,
  public.trip_closure_invoice_pdf_copies
  from public,anon,authenticated,service_role;

revoke select on public.trip_closure_invoices from public,anon,authenticated,service_role;
grant select (
  id,invoice_number,trip_id,trip_number,truck_id,truck_registration,truck_type,
  truck_capacity_tonnes,truck_owner_name,driver_id,driver_name,driver_phone,driver_email,
  driver_license,loading_site_id,loading_site_name,offloading_site_id,offloading_site_name,
  quantity_tonnes,opened_at,closed_at,issued_at
) on public.trip_closure_invoices to authenticated;

create policy secure_waybill_copy_storage_read on storage.objects
for select to authenticated using (
  bucket_id in ('waybill-driver-copies','waybill-company-copies')
  and private.has_role(array['operations_manager']::public.app_role[])
);
create policy secure_waybill_copy_storage_read_fence on storage.objects as restrictive
for select to authenticated using (
  bucket_id not in ('waybill-driver-copies','waybill-company-copies')
  or private.has_role(array['operations_manager']::public.app_role[])
);
drop policy if exists waybill_pdf_authenticated_read on storage.objects;
create policy waybill_pdf_authenticated_read on storage.objects for select to authenticated
using (bucket_id='waybills' and private.has_role(array[
  'system_administrator','operations_manager','finance_officer','audit_reviewer'
]::public.app_role[]));
drop policy if exists waybill_pdf_authenticated_read_fence on storage.objects;
create policy waybill_pdf_authenticated_read_fence on storage.objects as restrictive
for select to authenticated using (bucket_id<>'waybills' or private.has_role(array[
  'system_administrator','operations_manager','finance_officer','audit_reviewer'
]::public.app_role[]));
create policy secure_legacy_waybill_storage_read_fence on storage.objects as restrictive
for select to authenticated using (
  bucket_id<>'waybills' or private.has_role(array[
    'system_administrator','operations_manager','finance_officer','audit_reviewer'
  ]::public.app_role[])
);
create policy secure_waybill_copy_storage_insert_fence on storage.objects as restrictive
for insert to authenticated with check (bucket_id not in ('waybill-driver-copies','waybill-company-copies'));
create policy secure_waybill_copy_storage_update_fence on storage.objects as restrictive
for update to authenticated using (bucket_id not in ('waybill-driver-copies','waybill-company-copies'))
with check (bucket_id not in ('waybill-driver-copies','waybill-company-copies'));
create policy secure_waybill_copy_storage_delete_fence on storage.objects as restrictive
for delete to authenticated using (bucket_id not in ('waybill-driver-copies','waybill-company-copies'));
create policy secure_waybill_copy_storage_anon_fence on storage.objects as restrictive
for all to anon using (bucket_id not in ('waybill-driver-copies','waybill-company-copies','waybills'))
with check (bucket_id not in ('waybill-driver-copies','waybill-company-copies','waybills'));

create function private.queue_secure_waybill_pdf_copies() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.trip_closure_invoice_pdf_copies(
    invoice_id,trip_id,invoice_number,copy_kind,copy_version,status,storage_bucket,storage_path,notification_eligible
  ) values
    (new.id,new.trip_id,new.invoice_number,'driver',1,'pending','waybill-driver-copies',
      private.secure_waybill_copy_storage_path(new.invoice_number,'driver',1),true),
    (new.id,new.trip_id,new.invoice_number,'company',1,'blocked_missing_bank_details',
      'waybill-company-copies',private.secure_waybill_copy_storage_path(new.invoice_number,'company',1),true)
  on conflict (invoice_id,copy_kind,copy_version) do nothing;
  return null;
end;
$$;
create trigger queue_secure_waybill_pdf_copies
after insert on public.trip_closure_invoices
for each row execute function private.queue_secure_waybill_pdf_copies();

create function public.submit_waybill_company_bank_details(
  p_invoice_id uuid,p_bank_name text,p_account_name text,p_account_number text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_submission_id uuid;
  v_previous_snapshot public.trip_closure_invoice_bank_snapshots%rowtype;
  v_event_type text;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_invoice_id is null or p_bank_name is null or length(btrim(p_bank_name)) not between 1 and 200
    or p_account_name is null or length(btrim(p_account_name)) not between 1 and 200
    or p_account_number is null or btrim(p_account_number) !~ '^[0-9]{10}$' then
    raise exception 'Valid Waybill bank details are required' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_invoice_id::text,0));
  if not exists (select 1 from public.trip_closure_invoices where id=p_invoice_id) then
    raise exception 'Closed Waybill not found' using errcode='22023';
  end if;
  select * into v_previous_snapshot
  from public.trip_closure_invoice_bank_snapshots
  where invoice_id=p_invoice_id order by version desc limit 1;
  if exists (
    select 1 from public.trip_closure_invoice_bank_submissions submission
    where submission.invoice_id=p_invoice_id
      and not exists (
        select 1 from public.trip_closure_invoice_bank_detail_events event
        where event.submission_id=submission.id
          and event.event_type in ('verified','correction_verified','rejected')
      )
  ) then
    raise exception 'A bank detail submission is already awaiting verification' using errcode='23505';
  end if;
  insert into public.trip_closure_invoice_bank_submissions(
    invoice_id,trip_id,bank_name,account_name,account_number,submitted_by,correction_of_snapshot_id
  ) select id,trip_id,btrim(p_bank_name),btrim(p_account_name),btrim(p_account_number),auth.uid(),
    v_previous_snapshot.id
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

create function public.verify_waybill_company_bank_details(
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
    pg_catalog.hashtextextended(v_submission.invoice_id::text,0)
  );
  select * into v_previous_snapshot
  from public.trip_closure_invoice_bank_snapshots
  where invoice_id=v_submission.invoice_id order by version desc limit 1 for update;
  if v_submission.correction_of_snapshot_id is distinct from v_previous_snapshot.id then
    raise exception 'Bank details changed after this submission; submit a new version' using errcode='40001';
  end if;
  if exists (select 1 from public.trip_closure_invoice_bank_detail_events
    where submission_id=p_submission_id and event_type in ('verified','correction_verified','rejected')) then
    raise exception 'Waybill bank submission already has a final decision' using errcode='23505';
  end if;
  if p_approved then
    v_version:=coalesce(v_previous_snapshot.version,0)+1;
    insert into public.trip_closure_invoice_bank_snapshots(
      invoice_id,trip_id,version,supersedes_snapshot_id,source_submission_id,
      bank_name,account_name,account_number,submitted_by,submitted_at,verified_by
    ) values (
      v_submission.invoice_id,v_submission.trip_id,v_version,v_previous_snapshot.id,
      v_submission.id,v_submission.bank_name,
      v_submission.account_name,v_submission.account_number,v_submission.submitted_by,
      v_submission.submitted_at,auth.uid()
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

create function public.get_waybill_bank_detail_audit(p_invoice_id uuid)
returns table(event_type text,occurred_at timestamptz,actor_id uuid,reason_code text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  return query
  select event.event_type,event.occurred_at,event.actor_id,event.reason_code
  from public.trip_closure_invoice_bank_detail_events event
  where event.invoice_id=p_invoice_id order by event.occurred_at,event.id;
end;
$$;

create function public.get_waybill_company_bank_submission_for_review(p_submission_id uuid)
returns table(invoice_number text,bank_name text,account_name text,account_number text,
  submitted_by uuid,submitted_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_submission public.trip_closure_invoice_bank_submissions%rowtype;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  select submission.* into v_submission
  from public.trip_closure_invoice_bank_submissions submission
  where submission.id=p_submission_id for update;
  if not found then return; end if;
  if exists (select 1 from public.trip_closure_invoice_bank_detail_events event
    where event.submission_id=v_submission.id
      and event.event_type in ('verified','correction_verified','rejected')) then
    return;
  end if;
  insert into public.trip_closure_invoice_bank_detail_events(
    submission_id,invoice_id,trip_id,event_type,actor_id
  ) values (v_submission.id,v_submission.invoice_id,v_submission.trip_id,'review_viewed',auth.uid());
  return query
  select invoice.invoice_number,v_submission.bank_name,v_submission.account_name,
    v_submission.account_number,v_submission.submitted_by,v_submission.submitted_at
  from public.trip_closure_invoices invoice
  where invoice.id=v_submission.invoice_id and invoice.trip_id=v_submission.trip_id;
end;
$$;

create function private.claim_waybill_pdf_copy_jobs(p_copy_kind text,p_limit integer,p_invoice_id uuid default null)
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
  where pdf_copy.copy_kind=p_copy_kind and pdf_copy.attempts>=5
    and (p_invoice_id is null or pdf_copy.invoice_id=p_invoice_id)
    and ((pdf_copy.status='pending' and pdf_copy.next_attempt_at<=clock_timestamp())
      or (pdf_copy.status='processing' and pdf_copy.lease_until<clock_timestamp()));
  for v_job in
    select pdf_copy.id from public.trip_closure_invoice_pdf_copies pdf_copy
    where pdf_copy.copy_kind=p_copy_kind and pdf_copy.attempts<5
      and (p_invoice_id is null or pdf_copy.invoice_id=p_invoice_id)
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

create function public.claim_driver_waybill_pdf_jobs(p_limit integer default 5,p_invoice_id uuid default null)
returns table(copy_id uuid,invoice_id uuid,trip_id uuid,invoice_number text,
  storage_bucket text,storage_path text,attempts integer,lease_token uuid,lease_until timestamptz)
language sql security definer set search_path = '' as $$
  select * from private.claim_waybill_pdf_copy_jobs('driver',p_limit,p_invoice_id);
$$;
create function public.claim_company_waybill_pdf_jobs(p_limit integer default 5,p_invoice_id uuid default null)
returns table(copy_id uuid,invoice_id uuid,trip_id uuid,invoice_number text,
  storage_bucket text,storage_path text,attempts integer,lease_token uuid,lease_until timestamptz)
language sql security definer set search_path = '' as $$
  select * from private.claim_waybill_pdf_copy_jobs('company',p_limit,p_invoice_id);
$$;

create function public.get_driver_waybill_pdf_snapshot(p_copy_id uuid,p_lease_token uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'invoice_number',invoice.invoice_number,'trip_number',invoice.trip_number,
    'truck_registration',invoice.truck_registration,'truck_type',invoice.truck_type,
    'truck_capacity_tonnes',invoice.truck_capacity_tonnes,'truck_owner_name',invoice.truck_owner_name,
    'driver_name',invoice.driver_name,'driver_license',invoice.driver_license,
    'loading_site_name',invoice.loading_site_name,'offloading_site_name',invoice.offloading_site_name,
    'loading_officer_name',invoice.loading_officer_name,'offloading_officer_name',invoice.offloading_officer_name,
    'quantity_tonnes',invoice.quantity_tonnes,'opened_at',invoice.opened_at,
    'closed_at',invoice.closed_at,'issued_at',invoice.issued_at
  )
  from public.trip_closure_invoice_pdf_copies pdf_copy
  join public.trip_closure_invoices invoice on invoice.id=pdf_copy.invoice_id and invoice.trip_id=pdf_copy.trip_id
  where pdf_copy.id=p_copy_id and pdf_copy.copy_kind='driver' and pdf_copy.status='processing'
    and pdf_copy.lease_token=p_lease_token and pdf_copy.lease_until>clock_timestamp();
$$;
create function public.get_company_waybill_pdf_snapshot(p_copy_id uuid,p_lease_token uuid) returns jsonb
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
  from public.trip_closure_invoice_pdf_copies pdf_copy
  join public.trip_closure_invoices invoice on invoice.id=pdf_copy.invoice_id and invoice.trip_id=pdf_copy.trip_id
  join public.trip_closure_invoice_bank_snapshots bank
    on bank.id=pdf_copy.bank_snapshot_id and bank.invoice_id=pdf_copy.invoice_id and bank.trip_id=pdf_copy.trip_id
  where pdf_copy.id=p_copy_id and pdf_copy.copy_kind='company' and pdf_copy.status='processing'
    and pdf_copy.lease_token=p_lease_token and pdf_copy.lease_until>clock_timestamp();
$$;

create function private.finish_waybill_pdf_copy_job(
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
  update public.trip_closure_invoice_pdf_copies pdf_copy
  set status=case when p_succeeded then 'ready' when pdf_copy.attempts>=5 then 'failed' else 'pending' end,
    ready_at=case when p_succeeded then clock_timestamp() else null end,
    failed_at=case when not p_succeeded and pdf_copy.attempts>=5 then clock_timestamp() else null end,
    next_attempt_at=case when p_succeeded or pdf_copy.attempts>=5 then pdf_copy.next_attempt_at
      else clock_timestamp()+make_interval(secs=>least(3600,(30*power(2,pdf_copy.attempts-1))::integer)) end,
    last_error_code=case when p_succeeded then null when pdf_copy.attempts>=5 then 'attempt_limit_exhausted' else p_failure_code end,
    lease_token=null,lease_until=null
  where pdf_copy.id=p_copy_id and pdf_copy.copy_kind=p_copy_kind and pdf_copy.status='processing'
    and pdf_copy.lease_token=p_lease_token and pdf_copy.lease_until>clock_timestamp()
    and (p_copy_kind<>'company' or pdf_copy.bank_snapshot_id is not null);
  get diagnostics v_rows=row_count;
  return v_rows=1;
end;
$$;
create function public.finish_driver_waybill_pdf_job(
  p_copy_id uuid,p_lease_token uuid,p_succeeded boolean,p_failure_code text default null
) returns boolean
language sql security definer set search_path = '' as $$
  select private.finish_waybill_pdf_copy_job('driver',p_copy_id,p_lease_token,p_succeeded,p_failure_code);
$$;
create function public.finish_company_waybill_pdf_job(
  p_copy_id uuid,p_lease_token uuid,p_succeeded boolean,p_failure_code text default null
) returns boolean
language sql security definer set search_path = '' as $$
  select private.finish_waybill_pdf_copy_job('company',p_copy_id,p_lease_token,p_succeeded,p_failure_code);
$$;

create function public.get_operations_waybill_pdf_copy(p_invoice_id uuid,p_copy_kind text)
returns table(copy_kind text,storage_bucket text,storage_path text,ready_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_copy_kind is null or p_copy_kind not in ('driver','company') then
    raise exception 'Invalid Waybill copy kind' using errcode='22023';
  end if;
  return query
  select pdf_copy.copy_kind,pdf_copy.storage_bucket,pdf_copy.storage_path,pdf_copy.ready_at
  from public.trip_closure_invoice_pdf_copies pdf_copy
  where pdf_copy.invoice_id=p_invoice_id and pdf_copy.copy_kind=p_copy_kind
    and pdf_copy.status='ready' and pdf_copy.ready_at is not null
    and (pdf_copy.copy_kind<>'company' or pdf_copy.bank_snapshot_id is not null)
    and pdf_copy.copy_version=(
      select max(latest.copy_version) from public.trip_closure_invoice_pdf_copies latest
      where latest.invoice_id=pdf_copy.invoice_id and latest.copy_kind=pdf_copy.copy_kind
    )
  order by pdf_copy.copy_version desc limit 1;
end;
$$;

create function public.get_operations_waybill_copy_management_state(p_invoice_id uuid)
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

create function public.get_waybill_notification_pdf(p_notification_id uuid,p_lease_token uuid)
returns table(invoice_id uuid,invoice_number text,copy_kind text,storage_bucket text,storage_path text)
language sql stable security definer set search_path = '' as $$
  select invoice.id,invoice.invoice_number,pdf_copy.copy_kind,pdf_copy.storage_bucket,pdf_copy.storage_path
  from public.notification_outbox notification
  join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id
  join public.trip_closure_invoice_pdf_copies pdf_copy on pdf_copy.invoice_id=invoice.id and pdf_copy.trip_id=invoice.trip_id
  where notification.id=p_notification_id and notification.event_type='waybill_ready'
    and notification.status='processing' and notification.lease_token=p_lease_token
    and notification.lease_until>clock_timestamp()
    and notification.payload->>'invoice_id'=invoice.id::text
    and notification.payload->>'invoice_number'=invoice.invoice_number
    and pdf_copy.copy_kind=case notification.audience when 'driver' then 'driver' when 'client' then 'company' else null end
    and pdf_copy.status='ready' and pdf_copy.ready_at is not null
    and pdf_copy.notification_eligible
    and (pdf_copy.copy_kind<>'company' or pdf_copy.bank_snapshot_id is not null)
    and pdf_copy.copy_version=(
      select max(latest.copy_version) from public.trip_closure_invoice_pdf_copies latest
      where latest.invoice_id=invoice.id and latest.copy_kind=pdf_copy.copy_kind
    );
$$;

create or replace function public.enqueue_waybill_ready_notifications() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_inserted integer:=0; v_count integer;
begin
  insert into public.notification_outbox(trip_id,event_type,audience,recipients,payload)
  select invoice.trip_id,'waybill_ready','driver',array[invoice.driver_email],
    jsonb_build_object('invoice_id',invoice.id,'invoice_number',invoice.invoice_number,'trip_number',invoice.trip_number)
  from public.trip_closure_invoices invoice
  join public.trip_closure_invoice_pdf_copies pdf_copy
    on pdf_copy.invoice_id=invoice.id and pdf_copy.trip_id=invoice.trip_id and pdf_copy.copy_kind='driver'
  where pdf_copy.status='ready' and pdf_copy.ready_at is not null and pdf_copy.notification_eligible
    and invoice.driver_email is not null
  on conflict (trip_id,event_type,audience,delivery_sequence) do nothing;
  get diagnostics v_count=row_count;
  v_inserted:=v_inserted+v_count;
  insert into public.notification_outbox(trip_id,event_type,audience,recipients,payload)
  select invoice.trip_id,'waybill_ready','client',null,
    jsonb_build_object('invoice_id',invoice.id,'invoice_number',invoice.invoice_number,'trip_number',invoice.trip_number)
  from public.trip_closure_invoices invoice
  join lateral (
    select candidate.* from public.trip_closure_invoice_pdf_copies candidate
    where candidate.invoice_id=invoice.id and candidate.trip_id=invoice.trip_id and candidate.copy_kind='company'
    order by candidate.copy_version desc limit 1
  ) pdf_copy on true
  where pdf_copy.status='ready' and pdf_copy.ready_at is not null and pdf_copy.notification_eligible
    and pdf_copy.bank_snapshot_id is not null
  on conflict (trip_id,event_type,audience,delivery_sequence) do nothing;
  get diagnostics v_count=row_count;
  return v_inserted+v_count;
end;
$$;

create or replace function public.get_operations_waybill_detail(p_invoice_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  select jsonb_build_object(
    'invoice',jsonb_build_object(
      'id',invoice.id,'invoice_number',invoice.invoice_number,'trip_id',invoice.trip_id,
      'trip_number',invoice.trip_number,'driver_id',invoice.driver_id,
      'truck_registration',invoice.truck_registration,'truck_type',invoice.truck_type,
      'truck_capacity_tonnes',invoice.truck_capacity_tonnes,'truck_owner_name',invoice.truck_owner_name,
      'driver_name',invoice.driver_name,'driver_phone',invoice.driver_phone,
      'driver_email_available',invoice.driver_email is not null,'driver_license',invoice.driver_license,
      'loading_site_name',invoice.loading_site_name,'offloading_site_name',invoice.offloading_site_name,
      'loading_officer_name',invoice.loading_officer_name,'offloading_officer_name',invoice.offloading_officer_name,
      'opened_at',invoice.opened_at,'closed_at',invoice.closed_at,'issued_at',invoice.issued_at,
      'quantity_tonnes',invoice.quantity_tonnes
    ),
    'document',jsonb_build_object(
      'status',coalesce(document.status,'pending'),
      'storage_path',case when document.status='ready' and document.ready_at is not null
        and document.invoice_number=invoice.invoice_number
        and document.storage_path=private.waybill_storage_path(invoice.invoice_number)
        then document.storage_path else null end,
      'ready_at',document.ready_at
    ),
    'delivery',jsonb_build_object('driver',driver_delivery.status,'company',company_delivery.status)
  ) into v_result
  from public.trip_closure_invoices invoice
  left join public.trip_closure_invoice_documents document
    on document.invoice_id=invoice.id and document.trip_id=invoice.trip_id
  left join lateral (
    select notification.status from public.notification_outbox notification
    where notification.trip_id=invoice.trip_id and notification.event_type='waybill_ready'
      and notification.audience='driver' order by notification.delivery_sequence desc limit 1
  ) driver_delivery on true
  left join lateral (
    select notification.status from public.notification_outbox notification
    where notification.trip_id=invoice.trip_id and notification.event_type='waybill_ready'
      and notification.audience='client' order by notification.delivery_sequence desc limit 1
  ) company_delivery on true
  where invoice.id=p_invoice_id;
  return v_result;
end;
$$;

revoke all on function private.reject_secure_waybill_mutation() from public,anon,authenticated,service_role;
revoke all on function private.secure_waybill_copy_storage_path(text,text,integer) from public,anon,authenticated,service_role;
revoke all on function private.protect_waybill_pdf_copy_identity() from public,anon,authenticated,service_role;
revoke all on function private.queue_secure_waybill_pdf_copies() from public,anon,authenticated,service_role;
revoke all on function private.claim_waybill_pdf_copy_jobs(text,integer,uuid) from public,anon,authenticated,service_role;
revoke all on function private.finish_waybill_pdf_copy_job(text,uuid,uuid,boolean,text) from public,anon,authenticated,service_role;

revoke all on function public.submit_waybill_company_bank_details(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.submit_waybill_company_bank_details(uuid,text,text,text) to authenticated;
revoke all on function public.verify_waybill_company_bank_details(uuid,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.verify_waybill_company_bank_details(uuid,boolean,text) to authenticated;
revoke all on function public.get_waybill_bank_detail_audit(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_waybill_bank_detail_audit(uuid) to authenticated;
revoke all on function public.get_waybill_company_bank_submission_for_review(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_waybill_company_bank_submission_for_review(uuid) to authenticated;

revoke all on function public.claim_driver_waybill_pdf_jobs(integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.claim_driver_waybill_pdf_jobs(integer,uuid) to service_role;
revoke all on function public.claim_company_waybill_pdf_jobs(integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.claim_company_waybill_pdf_jobs(integer,uuid) to service_role;
revoke all on function public.get_driver_waybill_pdf_snapshot(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_driver_waybill_pdf_snapshot(uuid,uuid) to service_role;
revoke all on function public.get_company_waybill_pdf_snapshot(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_company_waybill_pdf_snapshot(uuid,uuid) to service_role;
revoke all on function public.finish_driver_waybill_pdf_job(uuid,uuid,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.finish_driver_waybill_pdf_job(uuid,uuid,boolean,text) to service_role;
revoke all on function public.finish_company_waybill_pdf_job(uuid,uuid,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.finish_company_waybill_pdf_job(uuid,uuid,boolean,text) to service_role;
revoke all on function public.get_waybill_notification_pdf(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_waybill_notification_pdf(uuid,uuid) to service_role;
revoke all on function public.get_operations_waybill_pdf_copy(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.get_operations_waybill_pdf_copy(uuid,text) to authenticated;
revoke all on function public.get_operations_waybill_copy_management_state(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_operations_waybill_copy_management_state(uuid) to authenticated;
revoke all on function public.get_operations_waybill_detail(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_operations_waybill_detail(uuid) to authenticated;
revoke all on function public.enqueue_waybill_ready_notifications() from public,anon,authenticated,service_role;
grant execute on function public.enqueue_waybill_ready_notifications() to service_role;

do $$
declare v_function regprocedure;
begin
  foreach v_function in array array[
    to_regprocedure('public.claim_waybill_pdf_jobs(integer)'),
    to_regprocedure('public.get_waybill_pdf_snapshot(uuid,uuid)'),
    to_regprocedure('public.finish_waybill_pdf_job(uuid,uuid,boolean,text)'),
    to_regprocedure('public.retry_waybill_pdf(uuid,text)'),
    to_regprocedure('public.get_waybill_ready_pdf(uuid,uuid)')
  ] loop
    if v_function is not null then
      execute format('revoke all on function %s from public,anon,authenticated,service_role',v_function);
    end if;
  end loop;
end;
$$;

commit;
