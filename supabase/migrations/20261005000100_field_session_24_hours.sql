begin;

-- A field session lasts 24 hours from its Auth session creation, including
-- logins close to midnight in Africa/Lagos. Access-token refreshes do not
-- change this boundary.
create function private.field_session_started_at() returns timestamptz
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
  return v_started_at;
end;
$$;

create or replace function private.field_session_is_current(
  p_at timestamptz default statement_timestamp()
) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_started_at timestamptz := private.field_session_started_at();
begin
  return coalesce(p_at >= v_started_at and p_at < v_started_at + interval '24 hours', false);
end;
$$;

create or replace function public.get_field_session_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.app_role; v_active boolean;
  v_now timestamptz := statement_timestamp();
  v_started_at timestamptz; v_expires_at timestamptz;
begin
  if auth.uid() is null then return jsonb_build_object('status','inactive'); end if;
  select p.role,p.is_active into v_role,v_active from public.profiles p where p.id=auth.uid();
  if not found or not v_active then return jsonb_build_object('status','inactive'); end if;
  if v_role not in ('loading_officer','offloading_officer') then
    return jsonb_build_object('status','not_field');
  end if;
  v_started_at := private.field_session_started_at();
  v_expires_at := v_started_at + interval '24 hours';
  if v_started_at is null or v_now < v_started_at or v_now >= v_expires_at then
    return jsonb_build_object('status','expired');
  end if;
  return jsonb_build_object('status','valid',
    'operational_date',(v_started_at at time zone 'Africa/Lagos')::date,
    'expires_in_ms',greatest(0,ceil(extract(epoch from (v_expires_at-v_now))*1000))::bigint);
end;
$$;

revoke all on function private.field_session_started_at() from public,anon,authenticated,service_role;

commit;
