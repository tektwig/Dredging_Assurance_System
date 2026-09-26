begin;

-- Historical invoices remain unchanged. New closures snapshot these values at
-- issue time; missing banking and legacy officer identities remain NULL.
alter table public.trip_closure_invoices
  add column driver_email text,
  add column bank_name text,
  add column account_name text,
  add column account_number text,
  add column loading_officer_id uuid references public.profiles(id) on delete restrict,
  add column loading_officer_name text,
  add column offloading_officer_id uuid references public.profiles(id) on delete restrict,
  add column offloading_officer_name text;

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
  v_number := 'INV-' || to_char(new.closed_at at time zone 'Africa/Lagos','YYYY') || '-' ||
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

-- Both are AFTER UPDATE row triggers for OPEN -> CLOSED. PostgreSQL runs
-- same-kind triggers by name: create_trip_closure_invoice precedes
-- snapshot_closed_trip. The invoice freezes banking once; payment creation
-- consumes those same fields, including NULL when no bank row existed. The
-- STRICT lookup makes a missing invoice a hard transactional failure. Do not
-- rename either trigger without revisiting this order.
create or replace function private.snapshot_closed_trip() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_driver public.drivers%rowtype;
  v_payment public.trip_payments%rowtype;
  v_invoice_id uuid;
  v_invoice_number text;
  v_bank_name text;
  v_account_name text;
  v_account_number text;
  v_payload jsonb;
begin
  if new.status <> 'closed' then return null; end if;
  select id,invoice_number,bank_name,account_name,account_number
    into strict v_invoice_id,v_invoice_number,v_bank_name,v_account_name,v_account_number
    from public.trip_closure_invoices where trip_id=new.id;
  select * into strict v_driver from public.drivers where id = new.driver_id for share;
  insert into public.trip_payments(trip_id, truck_id, driver_id, driver_name, driver_phone, driver_email, account_name, account_number, bank_name, status)
  values (new.id, new.truck_id, new.driver_id, v_driver.full_name, v_driver.phone_number, v_driver.email, v_account_name, v_account_number, v_bank_name,
    case when v_account_number is null then 'payment_details_required'::public.payment_status else 'pending'::public.payment_status end)
  returning * into v_payment;
  select jsonb_build_object(
    'trip_number', new.trip_number, 'truck_id', new.truck_id, 'registration_number', t.registration_number,
    'driver_name', v_payment.driver_name, 'driver_phone', v_payment.driver_phone, 'driver_email', v_payment.driver_email,
    'account_name', v_payment.account_name, 'account_number', v_payment.account_number, 'bank_name', v_payment.bank_name,
    'payment_status', v_payment.status,
    'quantity_tonnes', new.quantity_tonnes, 'loading_site', l.name, 'offloading_site', o.name,
    'opened_at', new.opened_at, 'closed_at', new.closed_at,
    'invoice_id', v_invoice_id, 'invoice_number', v_invoice_number
  ) into v_payload from public.trucks t, public.sites l, public.sites o
  where t.id = new.truck_id and l.id = new.loading_site_id and o.id = new.offloading_site_id;
  insert into public.notification_outbox(trip_id, audience, payload) values (new.id, 'finance', v_payload);
  if v_payment.driver_email is not null then
    insert into public.notification_outbox(trip_id, audience, recipients, payload)
    values (new.id, 'driver', array[v_payment.driver_email], v_payload);
  end if;
  return null;
end;
$$;

create or replace function private.trip_email(p_payload jsonb, p_recipients text[], p_sender text) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('from', p_sender, 'to', to_jsonb(p_recipients),
    'subject', 'Completed trip ' || (p_payload->>'trip_number') ||
      case when p_payload->>'payment_status' = 'payment_details_required' then ' - payment details required' else ' - payment reconciliation' end,
    'text', concat_ws(E'\n',
      case when p_payload->>'payment_status' = 'payment_details_required'
        then 'Trip physically completed. At closure, payment could not be processed because bank details were missing. Finance/admin must complete the payment details. Check the current payment record for any subsequent resolution.'
        else 'Trip completed. At closure, payment was pending reconciliation; this is not confirmation of payment.' end,
      'Trip Number: ' || (p_payload->>'trip_number'),
      'Waybill Number: ' || (p_payload->>'invoice_number'),
      'Truck ID: ' || (p_payload->>'truck_id'),
      'Registration Number: ' || (p_payload->>'registration_number'),
      'Driver Name: ' || (p_payload->>'driver_name'),
      'Driver Phone: ' || (p_payload->>'driver_phone'),
      'Driver Email: ' || coalesce(p_payload->>'driver_email', 'Not provided'),
      'Payment Status at Closure: ' || (p_payload->>'payment_status'),
      'Account Name: ' || coalesce(p_payload->>'account_name', 'Not provided at closure'),
      'Account Number: ' || coalesce(p_payload->>'account_number', 'Not provided at closure'),
      'Bank Name: ' || coalesce(p_payload->>'bank_name', 'Not provided at closure'),
      'Delivered Quantity (Tonnes): ' || (p_payload->>'quantity_tonnes'),
      'Loading Site: ' || (p_payload->>'loading_site'),
      'Offloading Site: ' || (p_payload->>'offloading_site'),
      'Opened At (ISO timestamp with offset): ' || (p_payload->>'opened_at'),
      'Closed At (ISO timestamp with offset): ' || (p_payload->>'closed_at')
    ));
$$;

create or replace function public.close_trip_v2(
  p_request_id uuid,p_trip_id uuid,p_plate text,p_expected_assignment_id uuid,
  p_quantity_tonnes numeric,p_capture_method text,p_captured_at timestamptz,
  p_ocr_detected_plate text default null,p_ocr_confidence numeric default null,p_image_path text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_plate text:=public.normalize_plate(p_plate); a jsonb; result jsonb; image_error text;
  v_truck uuid; v_constraint text; v_invoice_number text;
  t public.trucks%rowtype; r public.trips%rowtype;
begin
  perform private.lock_offloading_actor();
  if p_request_id is null then return private.offloading_failure('INVALID_REQUEST_ID'); end if;
  perform pg_advisory_xact_lock(hashtextextended('offloading-close:'||auth.uid()::text||':'||p_request_id::text,0));
  select response into result from private.offloading_request_receipts
    where actor_id=auth.uid() and request_id=p_request_id;
  if result is not null then return result; end if;
  if p_trip_id is null then return private.offloading_failure('TRIP_REQUIRED'); end if;
  if p_plate is null or length(p_plate)>64 or v_plate !~ '^[A-Z0-9]{1,32}$' then return private.offloading_failure('INVALID_PLATE'); end if;
  if p_quantity_tonnes is null or p_quantity_tonnes::text in ('NaN','Infinity','-Infinity')
    or p_quantity_tonnes<=0 or p_quantity_tonnes>=100000000 or p_quantity_tonnes<>round(p_quantity_tonnes,2) then
    return private.offloading_failure('INVALID_QUANTITY');
  end if;
  if p_capture_method is null or p_capture_method not in ('MANUAL','OCR','OCR_CORRECTED') then
    return private.offloading_failure('INVALID_CAPTURE_METHOD'); end if;
  if p_captured_at is null or not isfinite(p_captured_at) or p_captured_at>clock_timestamp()+interval '5 minutes' then
    return private.offloading_failure('INVALID_CAPTURE_TIMESTAMP'); end if;
  if (p_capture_method='MANUAL' and (p_ocr_detected_plate is not null or p_ocr_confidence is not null))
    or (p_capture_method<>'MANUAL' and (p_ocr_detected_plate is null or length(p_ocr_detected_plate) not between 1 and 64
      or public.normalize_plate(p_ocr_detected_plate) !~ '^[A-Z0-9]{1,32}$' or p_image_path is null))
    or (p_ocr_confidence is not null and (p_ocr_confidence::text in ('NaN','Infinity','-Infinity') or p_ocr_confidence not between 0 and 1))
    or (p_capture_method='OCR' and public.normalize_plate(p_ocr_detected_plate)<>v_plate)
    or (p_capture_method='OCR_CORRECTED' and public.normalize_plate(p_ocr_detected_plate)=v_plate) then
    return private.offloading_failure('INVALID_OCR_DATA'); end if;
  a:=private.offloading_assignment(p_expected_assignment_id,true);
  if not (a->>'ok')::boolean then return a; end if;
  select truck_id into v_truck from public.trips where id=p_trip_id;
  if not found then return private.offloading_failure('TRIP_NOT_FOUND'); end if;
  select * into t from public.trucks where id=v_truck for update;
  select * into r from public.trips where id=p_trip_id for update;
  if r.status<>'open' then return private.offloading_failure('TRIP_NOT_OPEN',jsonb_build_object('trip_number',r.trip_number)); end if;
  if t.normalized_registration<>v_plate then return private.offloading_failure('PLATE_MISMATCH'); end if;
  image_error:=private.offloading_image_error(p_image_path);
  if image_error is not null then return private.offloading_failure(image_error); end if;
  perform 1 from public.drivers where id=r.driver_id for share;
  begin
    update public.trips set status='closed',offloading_site_id=(a->>'site_id')::uuid,quantity_tonnes=p_quantity_tonnes
      where id=r.id returning * into r;
    -- The existing invoice trigger runs before snapshot_closed_trip. Both are
    -- in this UPDATE statement and transaction, so this lookup is authoritative.
    select invoice_number into strict v_invoice_number
      from public.trip_closure_invoices where trip_id=r.id;
    insert into public.trip_offloading_evidence(trip_id,assignment_id,offloading_site_id,confirmed_plate,
      ocr_detected_plate,ocr_confidence,capture_method,image_path,captured_at,captured_by)
    values(r.id,(a->>'assignment_id')::uuid,r.offloading_site_id,p_plate,p_ocr_detected_plate,
      p_ocr_confidence,p_capture_method,p_image_path,p_captured_at,auth.uid());
    insert into public.audit_log(entity_name,entity_id,action,new_value,reason,actor_id)
    values('offloading_trip_closed',r.id,'INSERT',jsonb_build_object('request_id',p_request_id,'trip_id',r.id,
      'truck_id',r.truck_id,'assignment_id',a->>'assignment_id','site_id',r.offloading_site_id,
      'quantity_tonnes',r.quantity_tonnes,'capture_method',p_capture_method),'Offloading trip closed',auth.uid());
    result:=jsonb_build_object('ok',true,'request_id',p_request_id,
      'trip',jsonb_build_object('id',r.id,'trip_number',r.trip_number,'status',r.status,
        'truck_id',r.truck_id,'driver_id',r.driver_id,'offloading_site_id',r.offloading_site_id,
        'quantity_tonnes',r.quantity_tonnes,'closed_at',r.closed_at,'closed_by',r.closed_by),
      'capture',jsonb_build_object('confirmed_plate',p_plate,'normalized_confirmed_plate',v_plate,
        'capture_method',p_capture_method,'image_recorded',p_image_path is not null),
      'waybill',jsonb_build_object('invoice_number',v_invoice_number),
      'notification_queued',true);
    insert into private.offloading_request_receipts(actor_id,request_id,response) values(auth.uid(),p_request_id,result);
    return result;
  exception when unique_violation then
    get stacked diagnostics v_constraint=constraint_name;
    if v_constraint='trip_offloading_evidence_image_path_key' then
      return private.offloading_failure('IMAGE_ALREADY_USED');
    end if;
    raise;
  end;
end;
$$;

-- The database role is shared by all signed-in users. Keep SELECT grant only
-- for authenticated, and enforce app-role authorization in both a permissive
-- policy and a restrictive fence (so another permissive policy cannot widen it).
revoke all on public.trip_closure_invoices from public,anon,authenticated,service_role;
grant select on public.trip_closure_invoices to authenticated;
drop policy if exists trip_closure_invoice_read on public.trip_closure_invoices;
drop policy if exists trip_closure_invoice_field_read_fence on public.trip_closure_invoices;
create policy trip_closure_invoice_read on public.trip_closure_invoices
for select to authenticated using (
  private.has_role(array['system_administrator','operations_manager','finance_officer','audit_reviewer']::public.app_role[])
);
create policy trip_closure_invoice_field_read_fence on public.trip_closure_invoices
as restrictive for select to authenticated using (
  private.has_role(array['system_administrator','operations_manager','finance_officer','audit_reviewer']::public.app_role[])
);

revoke all on function private.create_trip_closure_invoice(),private.snapshot_closed_trip(),
  private.trip_email(jsonb,text[],text) from public,anon,authenticated,service_role;
revoke all on function public.close_trip_v2(uuid,uuid,text,uuid,numeric,text,timestamptz,text,numeric,text)
  from public,anon,authenticated,service_role;
grant execute on function public.close_trip_v2(uuid,uuid,text,uuid,numeric,text,timestamptz,text,numeric,text)
  to authenticated;

commit;
