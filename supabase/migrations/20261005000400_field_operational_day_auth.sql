begin;

-- Field access follows the operational calendar day of the original Supabase
-- Auth session. Refreshing access tokens keeps the same auth.sessions.id and
-- therefore cannot extend the session into another Africa/Lagos date.
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

create or replace function public.get_field_session_status() returns jsonb
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

drop function if exists private.field_session_started_at();

revoke all on function private.field_session_operational_date(),
  private.field_session_is_current(timestamptz),
  public.get_field_session_status() from public,anon,authenticated,service_role;
grant execute on function public.get_field_session_status() to authenticated;

commit;
