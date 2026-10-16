begin;

lock table public.trip_closure_invoices in share row exclusive mode;

alter table public.trip_closure_invoices
  add constraint trip_closure_invoices_id_trip_unique unique (id, trip_id);

create table public.trip_closure_invoice_documents (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null,
  trip_id uuid not null,
  invoice_number text not null,
  status text not null default 'pending' check (status in ('pending','processing','ready','failed')),
  storage_path text not null unique,
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  next_attempt_at timestamptz not null default clock_timestamp(),
  processing_started_at timestamptz,
  lease_until timestamptz,
  lease_token uuid,
  ready_at timestamptz,
  failed_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code in (
    'invoice_snapshot_unavailable','invalid_invoice_snapshot','pdf_generation_failed',
    'storage_upload_failed','attempt_limit_exhausted'
  )),
  last_error_message text check (last_error_message is null or length(last_error_message) <= 255),
  unique (invoice_id),
  unique (trip_id),
  foreign key (invoice_id, trip_id)
    references public.trip_closure_invoices(id, trip_id) on delete restrict,
  check (invoice_number ~ '^INV-[0-9]{4}-[0-9]{6,}$'),
  check (storage_path = substring(invoice_number from 5 for 4) || '/' || invoice_number || '.pdf'),
  check (
    (status = 'pending' and ready_at is null and failed_at is null and lease_token is null and lease_until is null)
    or (status = 'processing' and ready_at is null and failed_at is null and lease_token is not null and lease_until is not null)
    or (status = 'ready' and ready_at is not null and failed_at is null and lease_token is null and lease_until is null)
    or (status = 'failed' and ready_at is null and failed_at is not null and lease_token is null and lease_until is null)
  )
);
create index trip_closure_invoice_documents_pending_idx
  on public.trip_closure_invoice_documents(next_attempt_at, created_at)
  where status in ('pending','processing');
create trigger trip_closure_invoice_documents_timestamps
before insert or update on public.trip_closure_invoice_documents
for each row execute function private.set_timestamps();

create function private.queue_trip_closure_invoice_pdf() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.trip_closure_invoice_documents(invoice_id,trip_id,invoice_number,storage_path)
  values (new.id,new.trip_id,new.invoice_number,
    substring(new.invoice_number from 5 for 4) || '/' || new.invoice_number || '.pdf')
  on conflict (invoice_id) do nothing;
  return null;
end;
$$;
create trigger queue_trip_closure_invoice_pdf
after insert on public.trip_closure_invoices
for each row execute function private.queue_trip_closure_invoice_pdf();

insert into public.trip_closure_invoice_documents(invoice_id,trip_id,invoice_number,storage_path)
select id,trip_id,invoice_number,
  substring(invoice_number from 5 for 4) || '/' || invoice_number || '.pdf'
from public.trip_closure_invoices
on conflict (invoice_id) do nothing;

alter table public.trip_closure_invoice_documents enable row level security;
revoke all on public.trip_closure_invoice_documents from public,anon,authenticated,service_role;
grant select on public.trip_closure_invoice_documents to authenticated;
create policy trip_closure_invoice_documents_read on public.trip_closure_invoice_documents
for select to authenticated using (
  private.has_role(array['system_administrator','operations_manager','finance_officer','audit_reviewer']::public.app_role[])
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('waybills','waybills',false,10485760,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create policy waybill_pdf_authenticated_read on storage.objects for select to authenticated
using (bucket_id='waybills' and private.has_role(array[
  'system_administrator','operations_manager','finance_officer','audit_reviewer'
]::public.app_role[]));
create policy waybill_pdf_authenticated_read_fence on storage.objects as restrictive for select to authenticated
using (bucket_id<>'waybills' or private.has_role(array[
  'system_administrator','operations_manager','finance_officer','audit_reviewer'
]::public.app_role[]));
create policy waybill_pdf_authenticated_insert_fence on storage.objects as restrictive for insert to authenticated
with check (bucket_id<>'waybills');
create policy waybill_pdf_authenticated_update_fence on storage.objects as restrictive for update to authenticated
using (bucket_id<>'waybills') with check (bucket_id<>'waybills');
create policy waybill_pdf_authenticated_delete_fence on storage.objects as restrictive for delete to authenticated
using (bucket_id<>'waybills');
create policy waybill_pdf_anon_fence on storage.objects as restrictive for all to anon
using (bucket_id<>'waybills') with check (bucket_id<>'waybills');

create function public.claim_waybill_pdf_jobs(p_limit integer default 5)
returns setof public.trip_closure_invoice_documents
language plpgsql security definer set search_path = '' as $$
declare
  v_document public.trip_closure_invoice_documents%rowtype;
begin
  if p_limit is null or p_limit not between 1 and 10 then
    raise exception 'Batch size must be 1..10' using errcode = '22023';
  end if;

  update public.trip_closure_invoice_documents
  set status='failed', failed_at=clock_timestamp(), lease_token=null, lease_until=null,
      last_error_code='attempt_limit_exhausted',
      last_error_message='Automatic PDF processing attempt limit reached.'
  where attempts >= 5 and (
    (status='pending' and next_attempt_at <= clock_timestamp())
    or (status='processing' and lease_until < clock_timestamp())
  );

  for v_document in
    select * from public.trip_closure_invoice_documents
    where attempts < 5 and (
      (status='pending' and next_attempt_at <= clock_timestamp())
      or (status='processing' and lease_until < clock_timestamp())
    )
    order by created_at
    for update skip locked
    limit p_limit
  loop
    update public.trip_closure_invoice_documents
    set status='processing', attempts=attempts+1,
        processing_started_at=clock_timestamp(), lease_token=gen_random_uuid(),
        lease_until=clock_timestamp()+interval '5 minutes',
        last_error_code=null, last_error_message=null
    where id=v_document.id
    returning * into v_document;
    return next v_document;
  end loop;
end;
$$;

create function public.get_waybill_pdf_snapshot(p_document_id uuid, p_lease_token uuid)
returns setof public.trip_closure_invoices
language sql security definer set search_path = '' as $$
  select invoice.*
  from public.trip_closure_invoice_documents as document
  join public.trip_closure_invoices as invoice
    on invoice.id=document.invoice_id and invoice.trip_id=document.trip_id
  where document.id=p_document_id and document.status='processing'
    and document.lease_token=p_lease_token
    and document.lease_until > clock_timestamp();
$$;

create function public.finish_waybill_pdf_job(
  p_id uuid,
  p_lease_token uuid,
  p_succeeded boolean,
  p_failure_code text default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_error_message text;
begin
  if p_succeeded is null or (p_succeeded and p_failure_code is not null)
    or (not p_succeeded and (p_failure_code is null or p_failure_code not in (
      'invoice_snapshot_unavailable','invalid_invoice_snapshot','pdf_generation_failed','storage_upload_failed'
    ))) then
    raise exception 'Invalid PDF job result' using errcode = '22023';
  end if;

  v_error_message := case p_failure_code
    when 'invoice_snapshot_unavailable' then 'Immutable invoice snapshot unavailable.'
    when 'invalid_invoice_snapshot' then 'Immutable invoice snapshot validation failed.'
    when 'pdf_generation_failed' then 'PDF generation failed.'
    when 'storage_upload_failed' then 'Private PDF storage upload failed.'
    else null
  end;

  update public.trip_closure_invoice_documents
  set status=case when p_succeeded then 'ready' when attempts >= 5 then 'failed' else 'pending' end,
      ready_at=case when p_succeeded then clock_timestamp() else null end,
      failed_at=case when not p_succeeded and attempts >= 5 then clock_timestamp() else null end,
      next_attempt_at=case when p_succeeded or attempts >= 5 then next_attempt_at
        else clock_timestamp()+make_interval(secs => least(3600,(30*power(2,attempts-1))::integer)) end,
      last_error_code=case when p_succeeded then null when attempts >= 5 then 'attempt_limit_exhausted' else p_failure_code end,
      last_error_message=case when p_succeeded then null when attempts >= 5
        then 'Automatic PDF processing attempt limit reached.' else v_error_message end,
      lease_token=null, lease_until=null
  where id=p_id and status='processing' and lease_token=p_lease_token
    and lease_until > clock_timestamp();
  return found;
end;
$$;

create function public.retry_waybill_pdf(p_document_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_document public.trip_closure_invoice_documents%rowtype;
begin
  perform private.require_role(array['system_administrator']::public.app_role[]);
  if p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then
    raise exception 'Retry reason required' using errcode = '22023';
  end if;
  select * into v_document from public.trip_closure_invoice_documents
  where id=p_document_id for update;
  if not found or v_document.status<>'failed' then
    raise exception 'Failed Waybill PDF job not found' using errcode = '22023';
  end if;

  perform set_config('app.audit_reason',p_reason,true);
  update public.trip_closure_invoice_documents
  set status='pending', attempts=0, next_attempt_at=clock_timestamp(),
      failed_at=null, last_error_code=null, last_error_message=null
  where id=p_document_id;
  insert into public.audit_log(entity_name,entity_id,action,old_value,new_value,reason,actor_id)
  values ('trip_closure_invoice_documents',p_document_id,'UPDATE',
    jsonb_build_object('status',v_document.status,'attempts',v_document.attempts),
    jsonb_build_object('status','pending','attempts',0),p_reason,auth.uid());
end;
$$;

revoke all on function private.queue_trip_closure_invoice_pdf() from public,anon,authenticated,service_role;
revoke all on function public.claim_waybill_pdf_jobs(integer) from public,anon,authenticated,service_role;
revoke all on function public.get_waybill_pdf_snapshot(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.finish_waybill_pdf_job(uuid,uuid,boolean,text) from public,anon,authenticated,service_role;
revoke all on function public.retry_waybill_pdf(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_waybill_pdf_jobs(integer) to service_role;
grant execute on function public.get_waybill_pdf_snapshot(uuid,uuid) to service_role;
grant execute on function public.finish_waybill_pdf_job(uuid,uuid,boolean,text) to service_role;
grant execute on function public.retry_waybill_pdf(uuid,text) to authenticated;

commit;
