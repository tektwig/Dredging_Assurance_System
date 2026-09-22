begin;

-- Expected operational failures are committed as issues, not thrown after INSERT.
create function private.reject_loading(p_code text, p_type public.exception_type, p_plate text, p_truck uuid default null, p_trip uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.exceptions(truck_id, trip_id, entered_plate, exception_type, description)
  values (p_truck, p_trip, left(p_plate, 64), p_type, p_code) returning id into v_id;
  return jsonb_build_object('ok', false, 'code', p_code, 'exception_id', v_id);
end;
$$;

create function public.create_loading_trip(p_plate text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_truck public.trucks%rowtype;
  v_driver public.drivers%rowtype;
  v_registration public.daily_registrations%rowtype;
  v_trip public.trips%rowtype;
  v_loading_site uuid;
  v_existing uuid;
  v_day date := (statement_timestamp() at time zone 'Africa/Lagos')::date;
  v_plate text := public.normalize_plate(p_plate);
begin
  perform private.require_role(array['system_administrator','loading_officer']::public.app_role[]);
  if p_plate is null or length(p_plate) > 64 or v_plate !~ '^[A-Z0-9]{1,32}$' then
    return private.reject_loading('INVALID_PLATE', 'unknown_truck', p_plate);
  end if;
  -- All truck-scoped operational writes take this lock first.
  select * into v_truck from public.trucks where normalized_registration = v_plate for update;
  if not found then return private.reject_loading('UNKNOWN_TRUCK', 'unknown_truck', p_plate); end if;
  if not v_truck.is_active then return private.reject_loading('INACTIVE_TRUCK', 'invalid_state', p_plate, v_truck.id); end if;

  select * into v_registration from public.daily_registrations where truck_id = v_truck.id and operational_date = v_day;
  -- Today's registration is authoritative even after an administrative reassignment.
  select * into v_driver from public.drivers where id = coalesce(v_registration.driver_id, v_truck.driver_id) for share;
  if not found or not v_driver.is_active then
    return private.reject_loading('INVALID_DRIVER', 'invalid_driver', p_plate, v_truck.id);
  end if;
  select id into v_loading_site from public.sites where site_type = 'loading' and is_active for share;
  if not found then return private.reject_loading('NO_ACTIVE_LOADING_SITE', 'invalid_state', p_plate, v_truck.id); end if;

  select id into v_existing from public.trips where truck_id = v_truck.id and status = 'open';
  if found then
    -- The open trip itself blocks. Do not leave a second permanent blocking issue.
    return private.reject_loading('OPEN_TRIP_EXISTS', 'open_trip_conflict', p_plate, v_truck.id, v_existing);
  end if;
  select id into v_existing from public.exceptions where truck_id = v_truck.id and status = 'open' and blocks_operations limit 1;
  if found then return jsonb_build_object('ok', false, 'code', 'BLOCKING_EXCEPTION', 'exception_id', v_existing); end if;

  if v_registration.id is null then
    insert into public.daily_registrations(truck_id, driver_id, operational_date, registered_by)
    values (v_truck.id, v_driver.id, v_day, auth.uid()) returning * into v_registration;
  end if;
  insert into public.trips(truck_id, driver_id, daily_registration_id, loading_site_id, opened_by)
  values (v_truck.id, v_registration.driver_id, v_registration.id, v_loading_site, auth.uid()) returning * into v_trip;
  return jsonb_build_object('ok', true, 'trip', to_jsonb(v_trip));
end;
$$;

create function private.payment_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_trip public.trips%rowtype;
begin
  if tg_op = 'DELETE' then raise exception 'Payment snapshots cannot be deleted' using errcode = '23514'; end if;
  if tg_op = 'INSERT' then
    select * into v_trip from public.trips where id = new.trip_id and status = 'closed';
    if not found or new.status not in ('payment_details_required','pending')
      or new.supplied_account_name is not null or new.supplied_account_number is not null or new.supplied_bank_name is not null then
      raise exception 'Payment requires a closed trip and its original closure snapshot' using errcode = '23514';
    end if;
    if new.status = 'pending' then
      new.payment_ready_at := v_trip.closed_at; new.payment_ready_by := v_trip.closed_by;
    else
      new.payment_ready_at := null; new.payment_ready_by := null;
    end if;
  else
    if old.status = 'payment_details_required' and new.status = 'pending' then
      if (to_jsonb(new) - array['status','supplied_account_name','supplied_account_number','supplied_bank_name','payment_ready_at','payment_ready_by','updated_at']) is distinct from
         (to_jsonb(old) - array['status','supplied_account_name','supplied_account_number','supplied_bank_name','payment_ready_at','payment_ready_by','updated_at']) then
        raise exception 'Closure-time payment snapshot is immutable' using errcode = '23514';
      end if;
      new.payment_ready_at := clock_timestamp(); new.payment_ready_by := auth.uid();
    elsif old.status = 'pending' and new.status = 'paid' then
      if (to_jsonb(new) - array['status','paid_at','paid_by','payment_reference','updated_at']) is distinct from
         (to_jsonb(old) - array['status','paid_at','paid_by','payment_reference','updated_at']) then
        raise exception 'Payment snapshots are immutable' using errcode = '23514';
      end if;
      new.paid_at := clock_timestamp(); new.paid_by := auth.uid();
    else
      raise exception 'Invalid payment transition; payment readiness is required before payment' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger payment_guard before insert or update or delete on public.trip_payments for each row execute function private.payment_guard();

-- Runs in the same transaction as closure, even for privileged database writes.
create function private.snapshot_closed_trip() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_driver public.drivers%rowtype;
  v_bank public.driver_payment_details%rowtype;
  v_payment public.trip_payments%rowtype;
  v_payload jsonb;
begin
  if new.status <> 'closed' then return null; end if;
  select * into strict v_driver from public.drivers where id = new.driver_id for share;
  select * into v_bank from public.driver_payment_details where driver_id = new.driver_id for share;
  insert into public.trip_payments(trip_id, truck_id, driver_id, driver_name, driver_phone, driver_email, account_name, account_number, bank_name, status)
  values (new.id, new.truck_id, new.driver_id, v_driver.full_name, v_driver.phone_number, v_driver.email, v_bank.account_name, v_bank.account_number, v_bank.bank_name,
    case when v_bank.driver_id is null then 'payment_details_required'::public.payment_status else 'pending'::public.payment_status end)
  returning * into v_payment;
  select jsonb_build_object(
    'trip_number', new.trip_number, 'truck_id', new.truck_id, 'registration_number', t.registration_number,
    'driver_name', v_payment.driver_name, 'driver_phone', v_payment.driver_phone, 'driver_email', v_payment.driver_email,
    'account_name', v_payment.account_name, 'account_number', v_payment.account_number, 'bank_name', v_payment.bank_name,
    'payment_status', v_payment.status,
    'quantity_tonnes', new.quantity_tonnes, 'loading_site', l.name, 'offloading_site', o.name,
    'opened_at', new.opened_at, 'closed_at', new.closed_at
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
create trigger snapshot_closed_trip after update on public.trips for each row
when (old.status = 'open' and new.status = 'closed') execute function private.snapshot_closed_trip();

create function public.close_trip(p_trip_id uuid, p_offloading_site_id uuid, p_quantity_tonnes numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_trip public.trips%rowtype; v_truck uuid;
begin
  perform private.require_role(array['system_administrator','offloading_officer']::public.app_role[]);
  select truck_id into v_truck from public.trips where id = p_trip_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'TRIP_NOT_FOUND'); end if;
  perform 1 from public.trucks where id = v_truck for update;
  select * into v_trip from public.trips where id = p_trip_id for update;
  if v_trip.status <> 'open' then return jsonb_build_object('ok', false, 'code', 'TRIP_NOT_OPEN'); end if;
  if p_quantity_tonnes is null or p_quantity_tonnes::text in ('NaN','Infinity','-Infinity')
    or p_quantity_tonnes <= 0 or p_quantity_tonnes >= 100000000 or p_quantity_tonnes <> round(p_quantity_tonnes, 2) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_QUANTITY');
  end if;
  perform 1 from public.sites where id = p_offloading_site_id and site_type = 'offloading' and is_active for share;
  if not found then return jsonb_build_object('ok', false, 'code', 'INVALID_OFFLOADING_SITE'); end if;
  -- Lock the frozen driver before snapshotting. Missing bank data never blocks delivery.
  perform 1 from public.drivers where id = v_trip.driver_id for share;
  update public.trips set status = 'closed', offloading_site_id = p_offloading_site_id, quantity_tonnes = p_quantity_tonnes
    where id = p_trip_id returning * into v_trip;
  -- Operational response deliberately excludes the payment snapshot and outbox.
  return jsonb_build_object('ok', true, 'trip', to_jsonb(v_trip), 'notification_queued', true);
end;
$$;

create function public.raise_trip_exception(p_type public.exception_type, p_description text, p_truck_id uuid default null,
  p_trip_id uuid default null, p_entered_plate text default null, p_blocks_operations boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_truck uuid := p_truck_id; v_trip_truck uuid; v_id uuid;
begin
  perform private.require_role(array['system_administrator','loading_officer','offloading_officer','operations_manager']::public.app_role[]);
  if p_trip_id is not null then
    select truck_id into v_trip_truck from public.trips where id = p_trip_id;
    if not found or (v_truck is not null and v_truck <> v_trip_truck) then raise exception 'Invalid trip/truck reference' using errcode = '22023'; end if;
    v_truck := v_trip_truck;
  end if;
  if v_truck is not null then perform 1 from public.trucks where id = v_truck for update; end if;
  insert into public.exceptions(truck_id, trip_id, entered_plate, exception_type, description, blocks_operations)
  values (v_truck, p_trip_id, p_entered_plate, p_type, p_description, p_blocks_operations) returning id into v_id;
  return v_id;
end;
$$;

create function public.resolve_trip_exception(p_exception_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_truck uuid;
begin
  perform private.require_role(array['system_administrator','operations_manager']::public.app_role[]);
  if p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then raise exception 'Resolution reason required' using errcode = '22023'; end if;
  select truck_id into v_truck from public.exceptions where id = p_exception_id;
  if v_truck is not null then perform 1 from public.trucks where id = v_truck for update; end if;
  perform set_config('app.audit_reason', p_reason, true);
  update public.exceptions set status = 'resolved', resolution_reason = p_reason where id = p_exception_id and status = 'open';
  if not found then raise exception 'Open exception not found' using errcode = '22023'; end if;
end;
$$;

create function public.cancel_trip(p_trip_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_truck uuid;
begin
  perform private.require_role(array['system_administrator','operations_manager']::public.app_role[]);
  if p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then raise exception 'Cancellation reason required' using errcode = '22023'; end if;
  select truck_id into v_truck from public.trips where id = p_trip_id;
  if not found then raise exception 'Trip not found' using errcode = '22023'; end if;
  perform 1 from public.trucks where id = v_truck for update;
  perform set_config('app.audit_reason', p_reason, true);
  update public.trips set status = 'cancelled', cancellation_reason = p_reason where id = p_trip_id and status = 'open';
  if not found then raise exception 'Trip is not open' using errcode = '22023'; end if;
end;
$$;

create function public.mark_trip_payment_paid(p_payment_id uuid, p_payment_reference text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_role(array['system_administrator','finance_officer']::public.app_role[]);
  if p_payment_reference is null or length(btrim(p_payment_reference)) not between 1 and 200 then raise exception 'Payment reference required' using errcode = '22023'; end if;
  perform set_config('app.audit_reason', 'External payment reconciled: ' || p_payment_reference, true);
  update public.trip_payments set status = 'paid', payment_reference = btrim(p_payment_reference) where id = p_payment_id and status = 'pending';
  if not found then raise exception 'Pending payment not found' using errcode = '22023'; end if;
end;
$$;

create function public.complete_trip_payment_details(p_payment_id uuid, p_account_name text,
  p_account_number text, p_bank_name text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_driver uuid; v_payment public.trip_payments%rowtype;
begin
  perform private.require_role(array['system_administrator','finance_officer']::public.app_role[]);
  if p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then
    raise exception 'Payment details completion reason required' using errcode = '22023';
  end if;
  select driver_id into v_driver from public.trip_payments where id = p_payment_id;
  if not found then raise exception 'Payment not found' using errcode = '22023'; end if;
  -- Serialize with closure's driver snapshot before locking the payment and bank row.
  perform 1 from public.drivers where id = v_driver for update;
  select * into v_payment from public.trip_payments where id = p_payment_id for update;
  if v_payment.status <> 'payment_details_required' then
    raise exception 'Payment does not require details' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', p_reason, true);
  insert into public.driver_payment_details(driver_id, account_name, account_number, bank_name)
  values (v_driver, btrim(p_account_name), btrim(p_account_number), btrim(p_bank_name))
  on conflict (driver_id) do update set account_name = excluded.account_name,
    account_number = excluded.account_number, bank_name = excluded.bank_name;
  update public.trip_payments set status = 'pending', supplied_account_name = btrim(p_account_name),
    supplied_account_number = btrim(p_account_number), supplied_bank_name = btrim(p_bank_name)
  where id = p_payment_id;
end;
$$;

-- A site's historical type and master-data identifiers cannot be repurposed.
create function private.master_identity_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new)->>'id') is distinct from (to_jsonb(old)->>'id')
    or (tg_table_name = 'driver_payment_details' and (to_jsonb(new)->>'driver_id') is distinct from (to_jsonb(old)->>'driver_id'))
    or (tg_table_name = 'sites' and (to_jsonb(new)->>'site_type') is distinct from (to_jsonb(old)->>'site_type')) then
    raise exception 'Master-data identity cannot be changed' using errcode = '23514';
  end if;
  return new;
end;
$$;
do $$ declare t text; begin
  foreach t in array array['sites','drivers','trucks','driver_payment_details'] loop
    execute format('create trigger master_identity_guard before update on public.%I for each row execute function private.master_identity_guard()', t);
  end loop;
end; $$;

revoke all on all functions in schema private from public, anon, authenticated, service_role;
grant execute on function private.has_role(public.app_role[]) to authenticated;
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_loading_trip','close_trip','raise_trip_exception','resolve_trip_exception','cancel_trip','mark_trip_payment_paid','complete_trip_payment_details') loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end; $$;
commit;
