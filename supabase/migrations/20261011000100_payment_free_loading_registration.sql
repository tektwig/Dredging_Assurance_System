begin;

-- New registrations carry only operational driver identity and truck identity.
-- Defaults match the existing loading terminal's established 30-tonne fallback;
-- the owner is explicitly marked unprovided until Operations updates the master.
create function public.register_loading_participant_v3(
  p_request_id uuid,
  p_plate text,
  p_expected_truck_id uuid default null,
  p_existing_driver_id uuid default null,
  p_full_name text default null,
  p_phone_number text default null,
  p_email text default null,
  p_capacity_tonnes numeric default 30,
  p_truck_type text default 'Registered tipper truck',
  p_owner_name text default 'Not provided',
  p_owner_contact text default null,
  p_driver_license text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_plate text:=public.normalize_plate(p_plate);
  v_phone text;
  v_result jsonb;
  v_assignment jsonb;
  v_truck public.trucks%rowtype;
  v_driver public.drivers%rowtype;
  v_constraint text;
begin
  perform private.lock_loading_actor();
  if p_request_id is null then return private.loading_failure('INVALID_REQUEST_ID'); end if;
  v_result:=private.loading_replay('register_loading_participant_payment_free_v3',p_request_id);
  if v_result is not null then return v_result; end if;
  if p_plate is null or length(p_plate)>64 or v_plate !~ '^[A-Z0-9]{1,32}$' then
    return private.loading_failure('INVALID_PLATE');
  end if;
  if p_existing_driver_id is not null and (p_expected_truck_id is not null
    or p_full_name is not null or p_phone_number is not null or p_email is not null) then
    return private.loading_failure('INVALID_REGISTRATION_MODE');
  end if;
  if p_capacity_tonnes is null or p_capacity_tonnes<=0 or p_capacity_tonnes>200
    or p_truck_type is null or length(btrim(p_truck_type)) not between 1 and 200
    or p_owner_name is null or length(btrim(p_owner_name)) not between 1 and 255
    or p_owner_contact is not null and length(btrim(p_owner_contact))>100
    or p_driver_license is not null and length(btrim(p_driver_license))>100 then
    return private.loading_failure('INVALID_TRUCK_DETAILS');
  end if;

  v_assignment:=private.loading_assignment();
  if not coalesce((v_assignment->>'ok')::boolean,false) then return v_assignment; end if;
  perform pg_advisory_xact_lock(hashtextextended('loading-plate:'||v_plate,0));
  if p_expected_truck_id is null then
    if exists(select 1 from public.trucks where normalized_registration=v_plate) then
      return private.loading_failure('PLATE_ALREADY_REGISTERED');
    end if;
  else
    select * into v_truck from public.trucks where id=p_expected_truck_id for update;
    if not found then return private.loading_failure('TRUCK_NOT_FOUND'); end if;
    if v_truck.normalized_registration<>v_plate then return private.loading_failure('TRUCK_PLATE_MISMATCH'); end if;
    if not v_truck.is_active then return private.loading_failure('INACTIVE_TRUCK'); end if;
    v_result:=private.loading_truck_block(v_truck.id);
    if v_result is not null then return v_result; end if;
  end if;

  if p_existing_driver_id is not null then
    select * into v_driver from public.drivers where id=p_existing_driver_id for share;
    if not found then return private.loading_failure('DRIVER_NOT_FOUND'); end if;
    if not v_driver.is_active then return private.loading_failure('INACTIVE_DRIVER'); end if;
  else
    if p_full_name is null or length(btrim(p_full_name)) not between 1 and 200 then
      return private.loading_failure('INVALID_DRIVER_NAME');
    end if;
    v_phone:=public.normalize_driver_phone(p_phone_number);
    if v_phone is null then return private.loading_failure('INVALID_PHONE'); end if;
    if p_email is not null and (length(btrim(p_email))>254
      or btrim(p_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
      return private.loading_failure('INVALID_EMAIL');
    end if;
    perform pg_advisory_xact_lock(hashtextextended('loading-phone:'||v_phone,0));
    if exists(select 1 from public.drivers where normalized_phone=v_phone) then
      return private.loading_failure('DRIVER_MATCH_REQUIRES_REVIEW');
    end if;
  end if;

  begin
    perform set_config('app.audit_reason','Loading participant registered',true);
    if p_existing_driver_id is null then
      insert into public.drivers(full_name,phone_number,email,license_number)
      values(btrim(p_full_name),btrim(p_phone_number),nullif(btrim(p_email),''),nullif(btrim(p_driver_license),''))
      returning * into v_driver;
    end if;
    if p_expected_truck_id is null then
      insert into public.trucks(registration_number,driver_id,capacity,capacity_unit,truck_type,owner_name,owner_contact)
      values(case when length(btrim(p_plate))<=32 then btrim(p_plate) else v_plate end,v_driver.id,
        round(p_capacity_tonnes,2),'tonnes',btrim(p_truck_type),btrim(p_owner_name),nullif(btrim(p_owner_contact),''))
      returning * into v_truck;
    end if;
    v_result:=jsonb_build_object('ok',true,'request_id',p_request_id,
      'truck',jsonb_build_object('id',v_truck.id,'registration_number',v_truck.registration_number,
        'normalized_registration',v_truck.normalized_registration,'created',p_expected_truck_id is null),
      'driver',jsonb_build_object('id',v_driver.id,'full_name',v_driver.full_name,
        'phone_number',v_driver.phone_number,'email',v_driver.email,'created',p_existing_driver_id is null),
      'default_driver_changed',false);
    insert into public.audit_log(entity_name,entity_id,action,new_value,reason,actor_id)
    values('loading_registration',v_driver.id,'INSERT',jsonb_build_object('request_id',p_request_id,
      'truck_id',v_truck.id,'driver_id',v_driver.id,'driver_created',p_existing_driver_id is null,
      'truck_created',p_expected_truck_id is null),'Loading participant registered',auth.uid());
    insert into private.loading_request_receipts(actor_id,operation,request_id,response)
    values(auth.uid(),'register_loading_participant_payment_free_v3',p_request_id,v_result);
    return v_result;
  exception when unique_violation then
    get stacked diagnostics v_constraint=constraint_name;
    if v_constraint='trucks_normalized_registration_key' then return private.loading_failure('PLATE_ALREADY_REGISTERED'); end if;
    if v_constraint='driver_phone_review' then return private.loading_failure('DRIVER_MATCH_REQUIRES_REVIEW'); end if;
    raise;
  end;
end;
$$;

-- Historical registration overloads require payment details. Keep their
-- definitions for migration lineage but make them unusable by all API roles.
do $migration$
declare v_function record;
begin
  for v_function in
    select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('register_loading_participant','register_loading_participant_v2')
  loop execute format('revoke all on function %s from public,anon,authenticated,service_role',v_function.signature); end loop;
end;
$migration$;
revoke all on function public.register_loading_participant_v3(uuid,text,uuid,uuid,text,text,text,numeric,text,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.register_loading_participant_v3(uuid,text,uuid,uuid,text,text,text,numeric,text,text,text,text)
  to authenticated;

commit;
