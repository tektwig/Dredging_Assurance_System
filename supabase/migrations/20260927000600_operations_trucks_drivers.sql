begin;

create function private.operations_master_reason(p_reason text, p_allowed text[]) returns text
language plpgsql immutable set search_path = '' as $$
declare v_reason text := btrim(p_reason);
begin
  if v_reason is null or length(v_reason) > 40 or not v_reason = any(p_allowed) then
    raise exception 'Invalid change reason' using errcode = '22023';
  end if;
  return v_reason;
end;
$$;
revoke all on function private.operations_master_reason(text,text[]) from public, anon, authenticated, service_role;

create function public.get_operations_trucks(
  p_page integer default 1, p_page_size integer default 25, p_search text default null,
  p_active boolean default null, p_regular_driver_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_search text := nullif(public.normalize_plate(btrim(p_search)), '');
  v_total bigint; v_items jsonb;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size not between 1 and 100
    or length(p_search) > 64 then raise exception 'Invalid page request' using errcode = '22023'; end if;

  select count(*) into v_total from public.trucks t
  where (p_active is null or t.is_active = p_active)
    and (p_regular_driver_id is null or t.driver_id = p_regular_driver_id)
    and (v_search is null or position(v_search in t.normalized_registration) > 0);
  select coalesce(jsonb_agg(jsonb_build_object(
    'truck_id', page.id, 'plate', page.registration_number, 'truck_type', page.truck_type,
    'capacity', page.capacity, 'capacity_unit', page.capacity_unit,
    'regular_driver_id', page.driver_id, 'regular_driver_name', driver.full_name,
    'is_active', page.is_active, 'registered_at', page.created_at,
    'total_trips', (select count(*) from public.trips trip where trip.truck_id = page.id),
    'open_trips', (select count(*) from public.trips trip where trip.truck_id = page.id and trip.status = 'open'),
    'last_trip_at', (select max(trip.opened_at) from public.trips trip where trip.truck_id = page.id)
  ) order by page.normalized_registration, page.id), '[]'::jsonb) into v_items
  from (select * from public.trucks t
    where (p_active is null or t.is_active = p_active)
      and (p_regular_driver_id is null or t.driver_id = p_regular_driver_id)
      and (v_search is null or position(v_search in t.normalized_registration) > 0)
    order by t.normalized_registration, t.id limit p_page_size offset (p_page::bigint - 1) * p_page_size
  ) page join public.drivers driver on driver.id = page.driver_id;
  return jsonb_build_object('items',v_items,'page',p_page,'page_size',p_page_size,
    'total_count',v_total,'has_next',(p_page::bigint * p_page_size < v_total));
end;
$$;

create function public.get_operations_drivers(
  p_page integer default 1, p_page_size integer default 25, p_search text default null,
  p_active boolean default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_search text := nullif(btrim(p_search), ''); v_phone text; v_canonical_phone text;
  v_total bigint; v_items jsonb;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size not between 1 and 100
    or length(v_search) > 200 then raise exception 'Invalid page request' using errcode = '22023'; end if;
  v_phone := regexp_replace(coalesce(v_search, ''), '[^0-9]', '', 'g');
  v_canonical_phone := public.normalize_driver_phone(v_search);
  select count(*) into v_total from public.drivers d
  where (p_active is null or d.is_active = p_active)
    and (v_search is null or position(lower(v_search) in lower(d.full_name)) > 0
      or (v_canonical_phone is not null and d.normalized_phone=v_canonical_phone)
      or (length(v_phone) >= 3 and position(v_phone in regexp_replace(coalesce(d.normalized_phone,d.phone_number),'[^0-9]','','g')) > 0));
  select coalesce(jsonb_agg(jsonb_build_object(
    'driver_id', page.id, 'name', page.full_name, 'phone', page.phone_number,
    'email', page.email, 'is_active', page.is_active, 'registered_at', page.created_at,
    'regular_trucks', (select count(*) from public.trucks truck where truck.driver_id = page.id),
    'total_trips', (select count(*) from public.trips trip where trip.driver_id = page.id),
    'open_trips', (select count(*) from public.trips trip where trip.driver_id = page.id and trip.status = 'open'),
    'last_trip_at', (select max(trip.opened_at) from public.trips trip where trip.driver_id = page.id)
  ) order by lower(page.full_name), page.id), '[]'::jsonb) into v_items
  from (select * from public.drivers d
    where (p_active is null or d.is_active = p_active)
      and (v_search is null or position(lower(v_search) in lower(d.full_name)) > 0
        or (v_canonical_phone is not null and d.normalized_phone=v_canonical_phone)
        or (length(v_phone) >= 3 and position(v_phone in regexp_replace(coalesce(d.normalized_phone,d.phone_number),'[^0-9]','','g')) > 0))
    order by lower(d.full_name), d.id limit p_page_size offset (p_page::bigint - 1) * p_page_size
  ) page;
  return jsonb_build_object('items',v_items,'page',p_page,'page_size',p_page_size,
    'total_count',v_total,'has_next',(p_page::bigint * p_page_size < v_total));
end;
$$;

create function public.get_operations_truck_detail(p_truck_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  select jsonb_build_object('truck_id',t.id,'plate',t.registration_number,
    'truck_type',t.truck_type,'capacity',t.capacity,'capacity_unit',t.capacity_unit,
    'owner_name',t.owner_name,'owner_contact',t.owner_contact,'is_active',t.is_active,
    'registered_at',t.created_at,'updated_at',t.updated_at,
    'regular_driver',jsonb_build_object('driver_id',d.id,'name',d.full_name,'is_active',d.is_active),
    'total_trips',(select count(*) from public.trips trip where trip.truck_id=t.id),
    'open_trips',(select count(*) from public.trips trip where trip.truck_id=t.id and trip.status='open'))
  into v_result from public.trucks t join public.drivers d on d.id=t.driver_id where t.id=p_truck_id;
  return v_result;
end;
$$;

create function public.get_operations_driver_detail(p_driver_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  select jsonb_build_object('driver_id',d.id,'name',d.full_name,'phone',d.phone_number,
    'email',d.email,'license_number',d.license_number,'is_active',d.is_active,
    'registered_at',d.created_at,'updated_at',d.updated_at,
    'regular_trucks',(select count(*) from public.trucks t where t.driver_id=d.id),
    'active_regular_trucks',(select count(*) from public.trucks t where t.driver_id=d.id and t.is_active),
    'regular_truck_preview',coalesce((select jsonb_agg(jsonb_build_object(
      'truck_id',t.id,'plate',t.registration_number,'is_active',t.is_active) order by t.normalized_registration,t.id)
      from (select id,registration_number,normalized_registration,is_active from public.trucks
        where driver_id=d.id order by normalized_registration,id limit 10) t),'[]'::jsonb),
    'total_trips',(select count(*) from public.trips trip where trip.driver_id=d.id),
    'open_trips',(select count(*) from public.trips trip where trip.driver_id=d.id and trip.status='open'))
  into v_result from public.drivers d where d.id=p_driver_id;
  return v_result;
end;
$$;

create function public.get_operations_asset_trips(
  p_kind text, p_asset_id uuid, p_page integer default 1, p_page_size integer default 25
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_total bigint; v_items jsonb;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_kind not in ('truck','driver') or p_kind is null or p_asset_id is null
    or p_page is null or p_page < 1 or p_page_size is null or p_page_size not between 1 and 100 then
    raise exception 'Invalid history request' using errcode = '22023';
  end if;
  select count(*) into v_total from public.trips trip
  where (p_kind='truck' and trip.truck_id=p_asset_id) or (p_kind='driver' and trip.driver_id=p_asset_id);
  select coalesce(jsonb_agg(jsonb_build_object('trip_id',page.id,'trip_number',page.trip_number,
    'plate',page.truck_registration_at_loading,'driver_name',page.driver_name_at_loading,
    'opened_at',page.opened_at,'closed_at',page.closed_at,'status',page.status::text,
    'tonnage',page.quantity_tonnes) order by page.opened_at desc,page.id desc),'[]'::jsonb)
  into v_items from (select * from public.trips trip
    where (p_kind='truck' and trip.truck_id=p_asset_id) or (p_kind='driver' and trip.driver_id=p_asset_id)
    order by trip.opened_at desc,trip.id desc limit p_page_size offset (p_page::bigint-1)*p_page_size) page;
  return jsonb_build_object('items',v_items,'page',p_page,'page_size',p_page_size,
    'total_count',v_total,'has_next',(p_page::bigint*p_page_size<v_total));
end;
$$;

create function public.update_operations_truck_master(
  p_truck_id uuid, p_expected_updated_at timestamptz, p_truck_type text,
  p_capacity numeric, p_owner_name text, p_owner_contact text, p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_truck public.trucks%rowtype;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  perform private.operations_master_reason(p_reason,array['record_correction','ownership_update','vehicle_specification_update']);
  if (p_truck_type is not null and length(btrim(p_truck_type)) not between 1 and 200)
    or (p_capacity is not null and (p_capacity <= 0 or p_capacity > 200 or round(p_capacity,2) <= 0
      or p_capacity = 'NaN'::numeric))
    or (p_owner_name is not null and length(btrim(p_owner_name)) not between 1 and 255)
    or (p_owner_contact is not null and length(btrim(p_owner_contact)) > 100) then
    raise exception 'Invalid truck data' using errcode='22023'; end if;
  select * into v_truck from public.trucks where id=p_truck_id for update;
  if not found then return null; end if;
  if p_expected_updated_at is null or v_truck.updated_at<>p_expected_updated_at then
    raise exception 'Master record has changed' using errcode='P4090'; end if;
  if exists(select 1 from public.trips where truck_id=p_truck_id and status='open') then
    raise exception 'Open trip prevents change' using errcode='P4091'; end if;
  if (v_truck.truck_type,v_truck.capacity,v_truck.capacity_unit,v_truck.owner_name,v_truck.owner_contact) is not distinct from
    (nullif(btrim(p_truck_type),''),round(p_capacity,2),'tonnes',nullif(btrim(p_owner_name),''),nullif(btrim(p_owner_contact),'')) then
    return jsonb_build_object('outcome','unchanged','updated_at',v_truck.updated_at); end if;
  perform set_config('app.audit_reason',p_reason,true);
  update public.trucks set truck_type=nullif(btrim(p_truck_type),''),capacity=round(p_capacity,2),capacity_unit='tonnes',
    owner_name=nullif(btrim(p_owner_name),''),owner_contact=nullif(btrim(p_owner_contact),'')
  where id=p_truck_id returning * into v_truck;
  return jsonb_build_object('outcome','updated','updated_at',v_truck.updated_at);
end;
$$;

create function public.correct_operations_truck_plate(
  p_truck_id uuid, p_expected_updated_at timestamptz, p_plate text, p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_truck public.trucks%rowtype; v_plate text := public.normalize_plate(p_plate);
  v_old_plate text;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  perform private.operations_master_reason(p_reason,array['identity_correction']);
  if p_plate is null or length(btrim(p_plate)) not between 1 and 32
    or length(v_plate) not between 1 and 32 or v_plate !~ '^[A-Z0-9]+$' then
    raise exception 'Invalid plate' using errcode='22023'; end if;
  select normalized_registration into v_old_plate from public.trucks where id=p_truck_id;
  if not found then return null; end if;
  if v_old_plate <= v_plate then
    perform pg_advisory_xact_lock(hashtextextended('loading-plate:'||v_old_plate,0));
    if v_old_plate <> v_plate then
      perform pg_advisory_xact_lock(hashtextextended('loading-plate:'||v_plate,0)); end if;
  else
    perform pg_advisory_xact_lock(hashtextextended('loading-plate:'||v_plate,0));
    perform pg_advisory_xact_lock(hashtextextended('loading-plate:'||v_old_plate,0));
  end if;
  select * into v_truck from public.trucks where id=p_truck_id for update;
  if not found then return null; end if;
  if p_expected_updated_at is null or v_truck.updated_at<>p_expected_updated_at
    or v_truck.normalized_registration<>v_old_plate then
    raise exception 'Master record has changed' using errcode='P4090'; end if;
  if exists(select 1 from public.trips where truck_id=p_truck_id and status='open') then
    raise exception 'Open trip prevents change' using errcode='P4091'; end if;
  if v_truck.registration_number=btrim(p_plate) then
    return jsonb_build_object('outcome','unchanged','updated_at',v_truck.updated_at); end if;
  perform set_config('app.audit_reason',p_reason,true);
  update public.trucks set registration_number=btrim(p_plate) where id=p_truck_id returning * into v_truck;
  return jsonb_build_object('outcome','updated','updated_at',v_truck.updated_at);
end;
$$;

create function public.set_operations_truck_regular_driver(
  p_truck_id uuid, p_driver_id uuid, p_expected_updated_at timestamptz, p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_truck public.trucks%rowtype; v_driver public.drivers%rowtype;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  perform private.operations_master_reason(p_reason,array['regular_driver_change']);
  select * into v_truck from public.trucks where id=p_truck_id for update;
  if not found then return null; end if;
  if p_expected_updated_at is null or v_truck.updated_at<>p_expected_updated_at then
    raise exception 'Master record has changed' using errcode='P4090'; end if;
  if exists(select 1 from public.trips where status='open' and
    (truck_id=p_truck_id or driver_id in (v_truck.driver_id,p_driver_id))) then
    raise exception 'Open trip prevents change' using errcode='P4091'; end if;
  select * into v_driver from public.drivers where id=p_driver_id for share;
  if not found or not v_driver.is_active then
    raise exception 'Regular driver must be active' using errcode='P4092'; end if;
  if v_truck.driver_id=p_driver_id then
    return jsonb_build_object('outcome','unchanged','updated_at',v_truck.updated_at); end if;
  perform set_config('app.audit_reason',p_reason,true);
  update public.trucks set driver_id=p_driver_id where id=p_truck_id returning * into v_truck;
  return jsonb_build_object('outcome','updated','updated_at',v_truck.updated_at);
end;
$$;

create function public.set_operations_truck_active(
  p_truck_id uuid, p_active boolean, p_expected_updated_at timestamptz, p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_truck public.trucks%rowtype; v_driver_active boolean;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  perform private.operations_master_reason(p_reason,array['deactivate','reactivate']);
  if p_active is null or (p_active and p_reason<>'reactivate') or (not p_active and p_reason<>'deactivate') then
    raise exception 'Invalid status change' using errcode='22023'; end if;
  select * into v_truck from public.trucks where id=p_truck_id for update;
  if not found then return null; end if;
  if p_expected_updated_at is null or v_truck.updated_at<>p_expected_updated_at then
    raise exception 'Master record has changed' using errcode='P4090'; end if;
  if exists(select 1 from public.trips where truck_id=p_truck_id and status='open') then
    raise exception 'Open trip prevents change' using errcode='P4091'; end if;
  if p_active then
    select is_active into v_driver_active from public.drivers where id=v_truck.driver_id for share;
    if not coalesce(v_driver_active,false) then raise exception 'Regular driver must be active' using errcode='P4092'; end if;
  end if;
  if v_truck.is_active=p_active then
    return jsonb_build_object('outcome','unchanged','updated_at',v_truck.updated_at); end if;
  perform set_config('app.audit_reason',p_reason,true);
  update public.trucks set is_active=p_active where id=p_truck_id returning * into v_truck;
  return jsonb_build_object('outcome','updated','updated_at',v_truck.updated_at);
end;
$$;

create function public.update_operations_driver_master(
  p_driver_id uuid, p_expected_updated_at timestamptz, p_name text, p_phone text,
  p_email text, p_license_number text, p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_driver public.drivers%rowtype; v_email text := nullif(btrim(p_email),'');
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  perform private.operations_master_reason(p_reason,array['record_correction','contact_update']);
  if p_name is null or length(btrim(p_name)) not between 1 and 200
    or p_phone is null or length(btrim(p_phone)) not between 1 and 40
    or (v_email is not null and (length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
    or (p_license_number is not null and length(btrim(p_license_number))>100) then
    raise exception 'Invalid driver data' using errcode='22023'; end if;
  select * into v_driver from public.drivers where id=p_driver_id for update;
  if not found then return null; end if;
  if p_expected_updated_at is null or v_driver.updated_at<>p_expected_updated_at then
    raise exception 'Master record has changed' using errcode='P4090'; end if;
  if btrim(p_phone) is distinct from v_driver.phone_number
    and public.normalize_driver_phone(btrim(p_phone)) is null then
    raise exception 'Invalid driver phone' using errcode='22023'; end if;
  if exists(select 1 from public.trips where driver_id=p_driver_id and status='open') then
    raise exception 'Open trip prevents change' using errcode='P4091'; end if;
  if (v_driver.full_name,v_driver.phone_number,v_driver.email,v_driver.license_number) is not distinct from
    (btrim(p_name),btrim(p_phone),v_email,nullif(btrim(p_license_number),'')) then
    return jsonb_build_object('outcome','unchanged','updated_at',v_driver.updated_at); end if;
  perform set_config('app.audit_reason',p_reason,true);
  update public.drivers set full_name=btrim(p_name),phone_number=btrim(p_phone),email=v_email,
    license_number=nullif(btrim(p_license_number),'') where id=p_driver_id returning * into v_driver;
  return jsonb_build_object('outcome','updated','updated_at',v_driver.updated_at);
end;
$$;

create function public.set_operations_driver_active(
  p_driver_id uuid, p_active boolean, p_expected_updated_at timestamptz, p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_driver public.drivers%rowtype;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  perform private.operations_master_reason(p_reason,array['deactivate','reactivate']);
  if p_active is null or (p_active and p_reason<>'reactivate') or (not p_active and p_reason<>'deactivate') then
    raise exception 'Invalid status change' using errcode='22023'; end if;
  select * into v_driver from public.drivers where id=p_driver_id for update;
  if not found then return null; end if;
  if p_expected_updated_at is null or v_driver.updated_at<>p_expected_updated_at then
    raise exception 'Master record has changed' using errcode='P4090'; end if;
  if exists(select 1 from public.trips where driver_id=p_driver_id and status='open') then
    raise exception 'Open trip prevents change' using errcode='P4091'; end if;
  if not p_active and exists(select 1 from public.trucks where driver_id=p_driver_id and is_active) then
    raise exception 'Active trucks must be reassigned' using errcode='P4092'; end if;
  if v_driver.is_active=p_active then
    return jsonb_build_object('outcome','unchanged','updated_at',v_driver.updated_at); end if;
  perform set_config('app.audit_reason',p_reason,true);
  update public.drivers set is_active=p_active where id=p_driver_id returning * into v_driver;
  return jsonb_build_object('outcome','updated','updated_at',v_driver.updated_at);
end;
$$;

do $$
declare v_function regprocedure;
begin
  for v_function in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'get_operations_trucks','get_operations_drivers','get_operations_truck_detail',
      'get_operations_driver_detail','get_operations_asset_trips','update_operations_truck_master',
      'correct_operations_truck_plate','set_operations_truck_regular_driver','set_operations_truck_active',
      'update_operations_driver_master','set_operations_driver_active') loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role',v_function);
    execute format('grant execute on function %s to authenticated',v_function);
  end loop;
end;
$$;

commit;
