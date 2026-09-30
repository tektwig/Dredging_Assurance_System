begin;

create or replace function private.is_credential_manager(p_actor_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = p_actor_id
    and p.is_active and p.role = 'operations_manager'::public.app_role);
$$;
revoke all on function private.is_credential_manager(uuid) from public, anon, authenticated, service_role;

create or replace function public.list_operational_credential_sites(p_actor_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_credential_manager(p_actor_id) then
    return jsonb_build_object('ok', false, 'code', 'CALLER_NOT_AUTHORIZED');
  end if;
  return jsonb_build_object('ok', true, 'sites', coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'site_type', s.site_type)
      order by s.name, s.id)
    from public.sites s where s.is_active and s.site_type in ('loading', 'offloading')
  ), '[]'::jsonb));
end;
$$;

create or replace function public.list_operational_credential_users(
  p_actor_id uuid, p_search text default null, p_role text default null,
  p_active boolean default null, p_page integer default 1, p_page_size integer default 25
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_search text := nullif(btrim(p_search), ''); v_total bigint; v_users jsonb;
begin
  if not private.is_credential_manager(p_actor_id) then
    return jsonb_build_object('ok', false, 'code', 'CALLER_NOT_AUTHORIZED');
  end if;
  if p_page not between 1 and 100000 or p_page_size not between 1 and 100
    or (p_role is not null and p_role not in ('loading_officer','offloading_officer',
      'operations_manager','system_administrator','finance_officer','audit_reviewer'))
    or length(coalesce(v_search, '')) > 100 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_FILTER');
  end if;
  with matching as (
    select p.id, p.display_name, p.role::text as role, p.is_active, u.email,
      a.site_id, s.name as site_name
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.user_site_assignments a on a.profile_id = p.id and a.ended_at is null
    left join public.sites s on s.id = a.site_id
    where p.role is not null and (v_search is null or p.display_name ilike '%' || v_search || '%'
      or u.email ilike '%' || v_search || '%')
      and (p_role is null or p.role::text = p_role)
      and (p_active is null or p.is_active = p_active)
  )
  select count(*) into v_total from matching;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'full_name', display_name, 'email', email, 'role', role,
    'is_active', is_active, 'site_id', site_id, 'site_name', site_name
  ) order by lower(display_name), id), '[]'::jsonb)
  into v_users from (select p.id, p.display_name, p.role::text as role, p.is_active, u.email,
      a.site_id, s.name as site_name
    from public.profiles p join auth.users u on u.id = p.id
    left join public.user_site_assignments a on a.profile_id = p.id and a.ended_at is null
    left join public.sites s on s.id = a.site_id
    where p.role is not null and (v_search is null or p.display_name ilike '%' || v_search || '%' or u.email ilike '%' || v_search || '%')
      and (p_role is null or p.role::text = p_role) and (p_active is null or p.is_active = p_active)
    order by lower(p.display_name), p.id offset (p_page - 1) * p_page_size limit p_page_size) page_rows;

  return jsonb_build_object('ok', true, 'page', p_page, 'page_size', p_page_size,
    'total', v_total, 'users', v_users);
end;
$$;

create or replace function public.get_operational_credential_user(p_actor_id uuid, p_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  if not private.is_credential_manager(p_actor_id) then
    return jsonb_build_object('ok', false, 'code', 'CALLER_NOT_AUTHORIZED');
  end if;
  select jsonb_build_object('ok', true, 'user', jsonb_build_object(
    'id', p.id, 'full_name', p.display_name, 'email', u.email, 'role', p.role::text,
    'is_active', p.is_active, 'site_id', a.site_id, 'site_name', s.name,
    'site_type', s.site_type, 'created_at', p.created_at, 'updated_at', p.updated_at
  )) into v_result
  from public.profiles p join auth.users u on u.id = p.id
  left join public.user_site_assignments a on a.profile_id = p.id and a.ended_at is null
  left join public.sites s on s.id = a.site_id
  where p.id = p_user_id and p.role is not null;
  return coalesce(v_result, jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'));
end;
$$;

create or replace function public.complete_operational_user_setup(
  p_profile_id uuid, p_display_name text, p_role text, p_site_id uuid, p_created_by uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_site public.sites%rowtype; v_profile public.profiles%rowtype;
  v_role public.app_role; v_assignment_id uuid;
begin
  if not private.is_credential_manager(p_created_by) then
    return jsonb_build_object('ok',false,'code','CALLER_NOT_AUTHORIZED');
  end if;
  if p_role is null or p_role not in ('loading_officer','offloading_officer') then
    return jsonb_build_object('ok',false,'code','INVALID_ROLE');
  end if;
  v_role := p_role::public.app_role;
  if p_display_name is null or length(btrim(p_display_name)) not between 1 and 200 then
    return jsonb_build_object('ok',false,'code','INVALID_NAME');
  end if;
  select * into v_site from public.sites where id = p_site_id for share;
  if not found then return jsonb_build_object('ok',false,'code','SITE_NOT_FOUND'); end if;
  select * into v_profile from public.profiles where id = p_profile_id for update;
  if not found then return jsonb_build_object('ok',false,'code','PROFILE_NOT_FOUND'); end if;
  if v_profile.is_active or v_profile.role is not null then
    select id into v_assignment_id from public.user_site_assignments
      where profile_id = p_profile_id and site_id = p_site_id and ended_at is null;
    if v_profile.is_active and v_profile.role = v_role and v_assignment_id is not null
      and exists (select 1 from public.audit_log where entity_name = 'operational_user_credentials'
        and entity_id = p_profile_id and actor_id = p_created_by
        and new_value->>'role' = v_role::text and new_value->>'site_id' = p_site_id::text) then
      return jsonb_build_object('ok',true,'profile_id',p_profile_id,
        'display_name',v_profile.display_name,'role',v_role::text,
        'site_id',v_site.id,'site_name',v_site.name,'assignment_id',v_assignment_id);
    end if;
    return jsonb_build_object('ok',false,'code','PROFILE_ALREADY_CONFIGURED');
  end if;
  if not v_site.is_active then return jsonb_build_object('ok',false,'code','INACTIVE_SITE'); end if;
  if (v_role = 'loading_officer' and v_site.site_type <> 'loading')
    or (v_role = 'offloading_officer' and v_site.site_type <> 'offloading') then
    return jsonb_build_object('ok',false,'code','INVALID_SITE_ASSIGNMENT');
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub',p_created_by::text,true);
  perform pg_catalog.set_config('app.audit_reason','Operational account created',true);
  update public.profiles set display_name=btrim(p_display_name),role=v_role,is_active=true where id=p_profile_id;
  insert into public.user_site_assignments(profile_id,site_id,assigned_by)
    values (p_profile_id,p_site_id,p_created_by) returning id into v_assignment_id;
  insert into public.audit_log(entity_name,entity_id,action,new_value,reason,actor_id)
    values ('operational_user_credentials',p_profile_id,'INSERT',jsonb_build_object(
      'profile_id',p_profile_id,'display_name',btrim(p_display_name),'role',v_role::text,
      'site_id',v_site.id,'site_name',v_site.name,'assignment_id',v_assignment_id),
      'Operational account created',p_created_by);
  return jsonb_build_object('ok',true,'profile_id',p_profile_id,'display_name',btrim(p_display_name),
    'role',v_role::text,'site_id',v_site.id,'site_name',v_site.name,'assignment_id',v_assignment_id);
end;
$$;

create or replace function public.update_operational_credential_profile(
  p_actor_id uuid, p_user_id uuid, p_full_name text, p_role text, p_site_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_creator public.profiles%rowtype; v_target public.profiles%rowtype;
  v_site public.sites%rowtype; v_assignment public.user_site_assignments%rowtype;
  v_old jsonb; v_new jsonb; v_expected_type text;
begin
  select * into v_creator from public.profiles where id = p_actor_id for share;
  if not found or not private.is_credential_manager(p_actor_id) then
    return jsonb_build_object('ok', false, 'code', 'CALLER_NOT_AUTHORIZED');
  end if;
  if p_user_id = p_actor_id then return jsonb_build_object('ok', false, 'code', 'SELF_EDIT_DENIED'); end if;
  if p_role is null or p_role not in ('loading_officer','offloading_officer') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ROLE');
  end if;
  if length(btrim(coalesce(p_full_name,''))) not between 1 and 200 or p_site_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST');
  end if;
  select * into v_target from public.profiles where id = p_user_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND'); end if;
  if v_target.role is null or v_target.role not in ('loading_officer'::public.app_role,'offloading_officer'::public.app_role) then
    return jsonb_build_object('ok', false, 'code', 'TARGET_NOT_MANAGEABLE');
  end if;
  select * into v_site from public.sites where id = p_site_id for share;
  if not found or not v_site.is_active then return jsonb_build_object('ok', false, 'code', 'INVALID_SITE'); end if;
  v_expected_type := case p_role when 'loading_officer' then 'loading' else 'offloading' end;
  if v_site.site_type::text <> v_expected_type then return jsonb_build_object('ok', false, 'code', 'INVALID_SITE'); end if;
  select * into v_assignment from public.user_site_assignments where profile_id = p_user_id and ended_at is null for update;
  v_old := jsonb_build_object('full_name',v_target.display_name,'role',v_target.role::text,
    'site_id',v_assignment.site_id);
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor_id::text, true);
  perform pg_catalog.set_config('app.audit_reason', 'Operational credential profile updated', true);
  update public.profiles set display_name = btrim(p_full_name), role = p_role::public.app_role
    where id = p_user_id;
  if v_assignment.site_id is distinct from p_site_id then
    update public.user_site_assignments set ended_at = clock_timestamp(), ended_by = p_actor_id where id = v_assignment.id;
    insert into public.user_site_assignments(profile_id, site_id, assigned_by)
      values (p_user_id, p_site_id, p_actor_id);
  end if;
  v_new := jsonb_build_object('full_name',btrim(p_full_name),'role',p_role,'site_id',p_site_id);
  insert into public.audit_log(entity_name,entity_id,action,old_value,new_value,reason,actor_id)
    values ('operational_user_credentials',p_user_id,'UPDATE',v_old,v_new,
      'Operational credential profile updated',p_actor_id);
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function public.set_operational_credential_active(
  p_actor_id uuid, p_user_id uuid, p_is_active boolean
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_creator public.profiles%rowtype; v_target public.profiles%rowtype;
begin
  select * into v_creator from public.profiles where id = p_actor_id for share;
  if not found or not private.is_credential_manager(p_actor_id) then
    return jsonb_build_object('ok', false, 'code', 'CALLER_NOT_AUTHORIZED');
  end if;
  if p_user_id = p_actor_id and not p_is_active then
    return jsonb_build_object('ok',false,'code','SELF_DEACTIVATION_DENIED');
  end if;
  if p_is_active is null then return jsonb_build_object('ok',false,'code','INVALID_REQUEST'); end if;
  select * into v_target from public.profiles where id = p_user_id for update;
  if not found then return jsonb_build_object('ok',false,'code','USER_NOT_FOUND'); end if;
  if v_target.role is null or v_target.role not in ('loading_officer'::public.app_role,'offloading_officer'::public.app_role) then
    return jsonb_build_object('ok',false,'code','TARGET_NOT_MANAGEABLE');
  end if;
  if v_target.is_active = p_is_active then return jsonb_build_object('ok',true,'changed',false); end if;
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor_id::text, true);
  perform pg_catalog.set_config('app.audit_reason', case when p_is_active then 'Operational user reactivated' else 'Operational user deactivated' end, true);
  update public.profiles set is_active = p_is_active where id = p_user_id;
  insert into public.audit_log(entity_name,entity_id,action,old_value,new_value,reason,actor_id)
    values ('operational_user_credentials',p_user_id,'UPDATE',
      jsonb_build_object('is_active',v_target.is_active),jsonb_build_object('is_active',p_is_active),
      case when p_is_active then 'Operational user reactivated' else 'Operational user deactivated' end,p_actor_id);
  return jsonb_build_object('ok',true,'changed',true);
end;
$$;

create or replace function public.audit_operational_credential_password_reset(
  p_actor_id uuid, p_user_id uuid, p_completed boolean
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_creator public.profiles%rowtype; v_target public.profiles%rowtype;
begin
  select * into v_creator from public.profiles where id = p_actor_id for share;
  if not found or not private.is_credential_manager(p_actor_id) then
    return jsonb_build_object('ok',false,'code','CALLER_NOT_AUTHORIZED');
  end if;
  select * into v_target from public.profiles where id = p_user_id for share;
  if not found or v_target.role is null or v_target.role not in ('loading_officer'::public.app_role,'offloading_officer'::public.app_role) then
    return jsonb_build_object('ok',false,'code','TARGET_NOT_MANAGEABLE');
  end if;
  insert into public.audit_log(entity_name,entity_id,action,new_value,reason,actor_id)
    values ('operational_credential_password_reset',p_user_id,'INSERT',
      jsonb_build_object('outcome',case when p_completed then 'completed' else 'requested' end),
      case when p_completed then 'Operational password reset completed' else 'Operational password reset requested' end,p_actor_id);
  return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.list_operational_credential_sites(uuid) from public, anon, authenticated, service_role;
revoke all on function public.list_operational_credential_users(uuid,text,text,boolean,integer,integer) from public, anon, authenticated, service_role;
revoke all on function public.get_operational_credential_user(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.update_operational_credential_profile(uuid,uuid,text,text,uuid) from public, anon, authenticated, service_role;
revoke all on function public.set_operational_credential_active(uuid,uuid,boolean) from public, anon, authenticated, service_role;
revoke all on function public.audit_operational_credential_password_reset(uuid,uuid,boolean) from public, anon, authenticated, service_role;
grant execute on function public.list_operational_credential_sites(uuid) to service_role;
grant execute on function public.list_operational_credential_users(uuid,text,text,boolean,integer,integer) to service_role;
grant execute on function public.get_operational_credential_user(uuid,uuid) to service_role;
grant execute on function public.update_operational_credential_profile(uuid,uuid,text,text,uuid) to service_role;
grant execute on function public.set_operational_credential_active(uuid,uuid,boolean) to service_role;
grant execute on function public.audit_operational_credential_password_reset(uuid,uuid,boolean) to service_role;

commit;
