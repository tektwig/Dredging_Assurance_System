begin;

do $migration$
begin
  if to_regprocedure('public.register_loading_participant_v3(uuid,text,uuid,uuid,text,text,text,numeric,text,text,text,text)') is null then
    raise exception 'Payment-free registration v3 must be installed before registration bank capture';
  end if;
  if to_regclass('private.loading_request_receipts') is null
    or to_regprocedure('private.lock_loading_actor()') is null
    or to_regprocedure('private.loading_failure(text)') is null
    or to_regprocedure('private.require_role(public.app_role[])') is null then
    raise exception 'Payment-free authorization and request-replay helpers are required';
  end if;
  if not exists (
    select 1 from pg_constraint constraint_row
    where constraint_row.conrelid='private.loading_request_receipts'::regclass
      and constraint_row.conname='loading_request_receipts_operation_check'
      and constraint_row.contype='c'
      and pg_get_constraintdef(constraint_row.oid) like '%register_loading_participant_payment_free_v3%'
  ) then
    raise exception 'Loading receipt operation constraint must be upgraded before registration bank capture';
  end if;
  if to_regclass('public.trip_closure_invoices') is null
    or to_regclass('public.trip_closure_invoice_bank_snapshots') is null
    or to_regclass('public.trip_closure_invoice_bank_submissions') is null
    or to_regclass('public.trip_closure_invoice_pdf_copies') is null then
    raise exception 'Secure dual-Waybill foundation must be installed before registration bank capture';
  end if;
end;
$migration$;

create table private.loading_registration_bank_captures (
  id uuid primary key default gen_random_uuid(),
  registration_request_id uuid not null,
  driver_id uuid not null unique references public.drivers(id) on delete restrict,
  bank_name text not null check (bank_name=btrim(bank_name) and length(bank_name) between 1 and 200),
  account_number text not null check (account_number ~ '^[0-9]{10}$'),
  account_name text not null check (account_name=btrim(account_name) and length(account_name) between 1 and 200),
  captured_by uuid not null references public.profiles(id) on delete restrict,
  captured_at timestamptz not null default clock_timestamp(),
  unique (captured_by,registration_request_id)
);

alter table private.loading_registration_bank_captures enable row level security;
revoke all on private.loading_registration_bank_captures from public,anon,authenticated,service_role;

create function private.reject_loading_registration_bank_capture_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Loading registration bank captures are immutable' using errcode='23514';
end;
$$;
revoke all on function private.reject_loading_registration_bank_capture_mutation() from public,anon,authenticated,service_role;

create trigger loading_registration_bank_captures_immutable
before update or delete on private.loading_registration_bank_captures
for each row execute function private.reject_loading_registration_bank_capture_mutation();

create function public.register_loading_participant_v4(
  p_request_id uuid,
  p_plate text,
  p_expected_truck_id uuid default null,
  p_existing_driver_id uuid default null,
  p_full_name text default null,
  p_phone_number text default null,
  p_email text default null,
  p_bank_name text default null,
  p_account_number text default null,
  p_account_name text default null,
  p_capacity_tonnes numeric default 30,
  p_truck_type text default 'Registered tipper truck',
  p_owner_name text default 'Not provided',
  p_owner_contact text default null,
  p_driver_license text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_driver_id uuid;
  v_capture_id uuid;
  v_existing private.loading_registration_bank_captures%rowtype;
begin
  perform private.lock_loading_actor();

  if p_request_id is null then
    return private.loading_failure('INVALID_REQUEST_ID');
  end if;

  if p_existing_driver_id is not null then
    if p_bank_name is not null or p_account_number is not null or p_account_name is not null then
      return private.loading_failure('INVALID_REGISTRATION_MODE');
    end if;
  else
    if p_bank_name is null or length(btrim(p_bank_name)) not between 1 and 200 then
      return private.loading_failure('INVALID_BANK_NAME');
    end if;
    if p_account_number is null or p_account_number !~ '^[0-9]{10}$' then
      return private.loading_failure('INVALID_ACCOUNT_NUMBER');
    end if;
    if p_account_name is null or length(btrim(p_account_name)) not between 1 and 200 then
      return private.loading_failure('INVALID_ACCOUNT_NAME');
    end if;
  end if;

  if p_existing_driver_id is null and exists (
    select 1 from private.loading_request_receipts receipt
    where receipt.actor_id=auth.uid()
      and receipt.operation='register_loading_participant_payment_free_v3'
      and receipt.request_id=p_request_id
      and not exists (
        select 1 from private.loading_registration_bank_captures capture
        where capture.captured_by=auth.uid() and capture.registration_request_id=p_request_id
      )
  ) then
    return private.loading_failure('REQUEST_PAYLOAD_CONFLICT');
  end if;

  v_result:=public.register_loading_participant_v3(
    p_request_id,p_plate,p_expected_truck_id,p_existing_driver_id,p_full_name,p_phone_number,p_email,
    p_capacity_tonnes,p_truck_type,p_owner_name,p_owner_contact,p_driver_license
  );
  if coalesce((v_result->>'ok')::boolean,false) is not true then
    return v_result;
  end if;

  if p_existing_driver_id is null then
    v_driver_id:=(v_result#>>'{driver,id}')::uuid;
    insert into private.loading_registration_bank_captures(
      registration_request_id,driver_id,bank_name,account_number,account_name,captured_by
    ) values (
      p_request_id,v_driver_id,btrim(p_bank_name),p_account_number,btrim(p_account_name),auth.uid()
    ) on conflict (captured_by,registration_request_id) do nothing
    returning id into v_capture_id;

    if v_capture_id is null then
      select * into v_existing
      from private.loading_registration_bank_captures
      where captured_by=auth.uid() and registration_request_id=p_request_id;
      if not found or v_existing.driver_id is distinct from v_driver_id
        or v_existing.bank_name is distinct from btrim(p_bank_name)
        or v_existing.account_number is distinct from p_account_number
        or v_existing.account_name is distinct from btrim(p_account_name) then
        return private.loading_failure('REQUEST_PAYLOAD_CONFLICT');
      end if;
    end if;
  end if;

  return v_result;
end;
$$;

create function public.get_operations_waybill_registration_bank_capture(p_invoice_id uuid)
returns table(bank_name text,account_number text,account_name text,captured_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_invoice_id is null then return; end if;

  return query
  select capture.bank_name,capture.account_number,capture.account_name,capture.captured_at
  from public.trip_closure_invoices invoice
  join private.loading_registration_bank_captures capture on capture.driver_id=invoice.driver_id
  where invoice.id=p_invoice_id
    and exists (
      select 1 from public.trip_closure_invoice_pdf_copies company_copy
      where company_copy.invoice_id=invoice.id and company_copy.copy_kind='company'
        and company_copy.bank_snapshot_id is null
        and company_copy.status in ('blocked_missing_bank_details','blocked_bank_details_unverified')
    )
    and not exists (
      select 1 from public.trip_closure_invoice_bank_snapshots snapshot
      where snapshot.invoice_id=invoice.id
    )
    and not exists (
      select 1 from public.trip_closure_invoice_bank_submissions submission
      where submission.invoice_id=invoice.id
        and not exists (
          select 1 from public.trip_closure_invoice_bank_detail_events event
          where event.submission_id=submission.id
            and event.event_type in ('verified','correction_verified','rejected')
        )
    );
end;
$$;

revoke all on function public.register_loading_participant_v4(
  uuid,text,uuid,uuid,text,text,text,text,text,text,numeric,text,text,text,text
) from public,anon,authenticated,service_role;
grant execute on function public.register_loading_participant_v4(
  uuid,text,uuid,uuid,text,text,text,text,text,text,numeric,text,text,text,text
) to authenticated;

revoke all on function public.register_loading_participant_v3(
  uuid,text,uuid,uuid,text,text,text,numeric,text,text,text,text
) from public,anon,authenticated,service_role;

revoke all on function public.get_operations_waybill_registration_bank_capture(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_operations_waybill_registration_bank_capture(uuid)
  to authenticated;

commit;
