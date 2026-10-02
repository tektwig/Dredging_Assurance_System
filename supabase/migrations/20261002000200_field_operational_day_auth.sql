begin;

create or replace function private.field_session_operational_date() returns date
language plpgsql stable security definer set search_path = '' as $$
declare v_session_id uuid; v_started_at timestamptz;
begin
  begin
    v_session_id := nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then
    return null;
  end;
  if v_session_id is null or auth.uid() is null then return null; end if;
  select s.created_at into v_started_at from auth.sessions s
    where s.id=v_session_id and s.user_id=auth.uid();
  if not found then return null; end if;
  return (v_started_at at time zone 'Africa/Lagos')::date;
end;
$$;

create or replace function private.field_session_is_current(
  p_at timestamptz default statement_timestamp()
) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.field_session_operational_date()
    = (p_at at time zone 'Africa/Lagos')::date, false);
$$;

create or replace function private.has_role(p_roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id=auth.uid() and p.is_active and p.role=any(p_roles)
      and (p.role not in ('loading_officer','offloading_officer')
        or private.field_session_is_current())
  );
$$;

create or replace function private.lock_loading_actor() returns void
language plpgsql security definer set search_path = '' as $$
declare v public.profiles%rowtype;
begin
  select * into v from public.profiles where id=auth.uid() for no key update;
  if not found or not v.is_active or v.role not in ('loading_officer','system_administrator')
    or (v.role='loading_officer' and not private.field_session_is_current()) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
end;
$$;

create or replace function private.lock_offloading_actor() returns void
language plpgsql security definer set search_path = '' as $$
declare v public.profiles%rowtype;
begin
  select * into v from public.profiles where id=auth.uid() for no key update;
  if not found or not v.is_active or v.role<>'offloading_officer'
    or not private.field_session_is_current() then
    raise exception 'Not authorized' using errcode='42501';
  end if;
end;
$$;

create function public.get_field_session_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.app_role; v_active boolean; v_session_day date;
  v_now timestamptz:=statement_timestamp(); v_lagos_day date; v_next_boundary timestamptz;
begin
  if auth.uid() is null then return jsonb_build_object('status','inactive'); end if;
  select p.role,p.is_active into v_role,v_active from public.profiles p where p.id=auth.uid();
  if not found or not v_active then return jsonb_build_object('status','inactive'); end if;
  if v_role not in ('loading_officer','offloading_officer') then
    return jsonb_build_object('status','not_field');
  end if;
  v_session_day:=private.field_session_operational_date();
  v_lagos_day:=(v_now at time zone 'Africa/Lagos')::date;
  if v_session_day is null or v_session_day<>v_lagos_day then
    return jsonb_build_object('status','expired');
  end if;
  v_next_boundary:=((v_lagos_day+1)::timestamp at time zone 'Africa/Lagos');
  return jsonb_build_object('status','valid','operational_date',v_session_day,
    'expires_in_ms',greatest(0,ceil(extract(epoch from (v_next_boundary-v_now))*1000))::bigint);
end;
$$;

create function public.lookup_loading_driver_by_id(p_driver_id uuid,p_expected_assignment_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a jsonb; d public.drivers%rowtype;
begin
  perform private.lock_loading_actor();
  if p_driver_id is null or p_expected_assignment_id is null then
    return private.loading_failure('DRIVER_NOT_FOUND');
  end if;
  a:=private.loading_assignment(p_expected_assignment_id,true);
  if not coalesce((a->>'ok')::boolean,false) then return a; end if;
  select * into d from public.drivers where id=p_driver_id;
  if not found then return private.loading_failure('DRIVER_NOT_FOUND'); end if;
  if not d.is_active then return private.loading_failure('INACTIVE_DRIVER'); end if;
  return jsonb_build_object('ok',true,'assignment_id',a->>'assignment_id',
    'driver',jsonb_build_object('id',d.id,'full_name',d.full_name,'phone_number',d.phone_number,
      'email',d.email,'is_active',d.is_active));
end;
$$;

revoke all on all functions in schema private from public,anon,authenticated,service_role;
grant execute on function private.has_role(public.app_role[]),
  private.can_upload_loading_image(text),private.can_upload_offloading_image(text) to authenticated;
revoke all on function public.get_field_session_status(),
  public.lookup_loading_driver_by_id(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_field_session_status(),
  public.lookup_loading_driver_by_id(uuid,uuid) to authenticated;

commit;
