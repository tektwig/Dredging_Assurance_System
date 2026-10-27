begin;

-- Canonical installs issue WB numbers from their first closed trip. This is
-- the operational subset of the legacy prefix migration; no payment-aware
-- closure function or legacy RPC rewriting is carried into Lane A.
create or replace function private.waybill_storage_path(p_number text) returns text
language sql immutable strict set search_path = '' as $$
  select (regexp_match(p_number,'^(INV|WB)-([0-9]{4})-[0-9]{6,}$'))[2]
    || '/' || p_number || '.pdf';
$$;
revoke all on function private.waybill_storage_path(text) from public,anon,authenticated,service_role;
grant execute on function private.waybill_storage_path(text) to authenticated,service_role;

do $migration$
declare v_constraint record;
begin
  for v_constraint in
    select conname from pg_constraint
    where conrelid='public.trip_closure_invoice_documents'::regclass
      and contype='c'
      and (pg_get_constraintdef(oid) ilike '%invoice_number%'
        or pg_get_constraintdef(oid) ilike '%storage_path%')
  loop
    execute format('alter table public.trip_closure_invoice_documents drop constraint %I',v_constraint.conname);
  end loop;
end;
$migration$;

alter table public.trip_closure_invoice_documents
  add constraint trip_closure_invoice_documents_waybill_number_check
    check (invoice_number ~ '^(INV|WB)-[0-9]{4}-[0-9]{6,}$'),
  add constraint trip_closure_invoice_documents_waybill_path_check
    check (storage_path=private.waybill_storage_path(invoice_number));

create or replace function private.queue_trip_closure_invoice_pdf() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.trip_closure_invoice_documents(invoice_id,trip_id,invoice_number,storage_path)
  values(new.id,new.trip_id,new.invoice_number,private.waybill_storage_path(new.invoice_number))
  on conflict(invoice_id) do nothing;
  return null;
end;
$$;

commit;
