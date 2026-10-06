begin;

-- Historical INV references stay stored as issued. New closures use the
-- Waybill prefix while retaining the existing Lagos year and sequence.
create or replace function private.waybill_storage_path(p_number text) returns text
language sql immutable strict set search_path = '' as $$
  select (regexp_match(p_number, '^(INV|WB)-([0-9]{4})-[0-9]{6,}$'))[2]
    || '/' || p_number || '.pdf';
$$;
revoke all on function private.waybill_storage_path(text) from public,anon,authenticated,service_role;
grant execute on function private.waybill_storage_path(text) to authenticated,service_role;

do $$
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
$$;

alter table public.trip_closure_invoice_documents
  add constraint trip_closure_invoice_documents_waybill_number_check
    check (invoice_number ~ '^(INV|WB)-[0-9]{4}-[0-9]{6,}$'),
  add constraint trip_closure_invoice_documents_waybill_path_check
    check (storage_path=private.waybill_storage_path(invoice_number));

create or replace function private.queue_trip_closure_invoice_pdf() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.trip_closure_invoice_documents(invoice_id,trip_id,invoice_number,storage_path)
  values (new.id,new.trip_id,new.invoice_number,private.waybill_storage_path(new.invoice_number))
  on conflict (invoice_id) do nothing;
  return null;
end;
$$;

create or replace function private.create_trip_closure_invoice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_loading_name text;
  v_offloading_name text;
  v_loading_officer_name text;
  v_offloading_officer_name text;
  v_driver_email text;
  v_bank public.driver_payment_details%rowtype;
  v_number text;
begin
  if new.status <> 'closed' then return null; end if;

  select name into strict v_loading_name from public.sites where id = new.loading_site_id;
  select name into strict v_offloading_name from public.sites where id = new.offloading_site_id;
  select nullif(btrim(display_name),'') into v_loading_officer_name
    from public.profiles where id = new.opened_by;
  select nullif(btrim(display_name),'') into v_offloading_officer_name
    from public.profiles where id = new.closed_by;
  v_loading_officer_name := coalesce(v_loading_officer_name,
    'Loading Officer (' || new.opened_by::text || ')');
  v_offloading_officer_name := coalesce(v_offloading_officer_name,
    'Offloading Officer (' || new.closed_by::text || ')');
  select email into strict v_driver_email from public.drivers where id = new.driver_id for share;
  select * into v_bank from public.driver_payment_details where driver_id = new.driver_id for share;
  v_number := 'WB-' || to_char(new.closed_at at time zone 'Africa/Lagos','YYYY') || '-' ||
    lpad(nextval('private.trip_closure_invoice_seq')::text,6,'0');

  insert into public.trip_closure_invoices(
    invoice_number,trip_id,trip_number,truck_id,truck_registration,truck_type,
    truck_capacity_tonnes,truck_owner_name,driver_id,driver_name,driver_phone,
    driver_license,driver_email,bank_name,account_name,account_number,
    loading_site_id,loading_site_name,offloading_site_id,offloading_site_name,
    loading_officer_id,loading_officer_name,offloading_officer_id,offloading_officer_name,
    quantity_tonnes,opened_at,closed_at,issued_at
  ) values (
    v_number,new.id,new.trip_number,new.truck_id,new.truck_registration_at_loading,
    new.truck_type_at_loading,new.truck_capacity_at_loading,new.truck_owner_at_loading,
    new.driver_id,new.driver_name_at_loading,new.driver_phone_at_loading,
    new.driver_license_at_loading,v_driver_email,v_bank.bank_name,v_bank.account_name,v_bank.account_number,
    new.loading_site_id,v_loading_name,new.offloading_site_id,v_offloading_name,
    new.opened_by,v_loading_officer_name,new.closed_by,v_offloading_officer_name,
    new.quantity_tonnes,new.opened_at,new.closed_at,new.closed_at
  ) on conflict (trip_id) do nothing;
  return null;
end;
$$;

-- Keep the existing read models and their authorization intact. Replace only
-- the legacy year-offset expression in each current document-path validator.
do $$
declare
  v_function regprocedure;
  v_definition text;
  v_updated text;
begin
  foreach v_function in array array[
    'public.enqueue_waybill_ready_notifications(text[])'::regprocedure,
    'public.get_waybill_ready_pdf(uuid,uuid)'::regprocedure,
    'public.get_operations_waybill_detail(uuid)'::regprocedure,
    'public.resend_operations_waybill(uuid,text,uuid,text,boolean)'::regprocedure
  ] loop
    v_definition:=pg_get_functiondef(v_function);
    v_updated:=v_definition;
    v_updated:=replace(v_updated,
      'substring(invoice.invoice_number from 5 for 4) || ''/'' || invoice.invoice_number || ''.pdf''',
      'private.waybill_storage_path(invoice.invoice_number)');
    v_updated:=replace(v_updated,
      'substring(invoice.invoice_number from 5 for 4)||''/''||invoice.invoice_number||''.pdf''',
      'private.waybill_storage_path(invoice.invoice_number)');
    v_updated:=replace(v_updated,
      'substring(v_invoice.invoice_number from 5 for 4)||''/''||v_invoice.invoice_number||''.pdf''',
      'private.waybill_storage_path(v_invoice.invoice_number)');
    if v_updated=v_definition then
      raise exception 'No legacy Waybill path expression found in %',v_function;
    end if;
    execute v_updated;
  end loop;
end;
$$;

commit;
