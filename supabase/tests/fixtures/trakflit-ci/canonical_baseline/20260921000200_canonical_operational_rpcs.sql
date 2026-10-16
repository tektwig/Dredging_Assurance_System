begin;

create function public.raise_trip_exception(
  p_type public.exception_type,
  p_description text,
  p_truck_id uuid default null,
  p_trip_id uuid default null,
  p_entered_plate text default null,
  p_blocks_operations boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_truck uuid:=p_truck_id; v_trip_truck uuid; v_id uuid;
begin
  perform private.require_role(array[
    'system_administrator','loading_officer','offloading_officer','operations_manager'
  ]::public.app_role[]);
  if p_trip_id is not null then
    select truck_id into v_trip_truck from public.trips where id=p_trip_id;
    if not found or (v_truck is not null and v_truck<>v_trip_truck) then
      raise exception 'Invalid trip/truck reference' using errcode='22023';
    end if;
    v_truck:=v_trip_truck;
  end if;
  if v_truck is not null then perform 1 from public.trucks where id=v_truck for update; end if;
  insert into public.exceptions(truck_id,trip_id,entered_plate,exception_type,description,blocks_operations)
  values(v_truck,p_trip_id,p_entered_plate,p_type,p_description,p_blocks_operations)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.resolve_trip_exception(p_exception_id uuid,p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_truck uuid;
begin
  perform private.require_role(array['system_administrator','operations_manager']::public.app_role[]);
  if p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then
    raise exception 'Resolution reason required' using errcode='22023';
  end if;
  select truck_id into v_truck from public.exceptions where id=p_exception_id;
  if v_truck is not null then perform 1 from public.trucks where id=v_truck for update; end if;
  perform set_config('app.audit_reason',p_reason,true);
  update public.exceptions set status='resolved',resolution_reason=p_reason
  where id=p_exception_id and status='open';
  if not found then raise exception 'Open exception not found' using errcode='22023'; end if;
end;
$$;

create function public.cancel_trip(p_trip_id uuid,p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_truck uuid;
begin
  perform private.require_role(array['system_administrator','operations_manager']::public.app_role[]);
  if p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then
    raise exception 'Cancellation reason required' using errcode='22023';
  end if;
  select truck_id into v_truck from public.trips where id=p_trip_id;
  if not found then raise exception 'Trip not found' using errcode='22023'; end if;
  perform 1 from public.trucks where id=v_truck for update;
  perform set_config('app.audit_reason',p_reason,true);
  update public.trips set status='cancelled',cancellation_reason=p_reason
  where id=p_trip_id and status='open';
  if not found then raise exception 'Trip is not open' using errcode='22023'; end if;
end;
$$;

revoke all on function public.raise_trip_exception(public.exception_type,text,uuid,uuid,text,boolean),
  public.resolve_trip_exception(uuid,text),public.cancel_trip(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.raise_trip_exception(public.exception_type,text,uuid,uuid,text,boolean),
  public.resolve_trip_exception(uuid,text),public.cancel_trip(uuid,text) to authenticated;

commit;
