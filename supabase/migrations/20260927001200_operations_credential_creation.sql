begin;

create or replace function public.get_operational_credential_creator(p_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('role', profile.role::text, 'is_active', profile.is_active)
  from public.profiles as profile where profile.id = p_profile_id;
$$;

create or replace function public.complete_operational_user_setup(
  p_profile_id uuid,
  p_display_name text,
  p_role text,
  p_site_id uuid,
  p_created_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator public.profiles%rowtype;
  v_profile public.profiles%rowtype;
  v_site public.sites%rowtype;
  v_role public.app_role;
  v_assignment_id uuid;
begin
  select * into v_creator from public.profiles where id = p_created_by for share;
  if not found or not v_creator.is_active or v_creator.role is distinct from 'operations_manager'::public.app_role then
    return jsonb_build_object('ok', false, 'code', 'CALLER_NOT_AUTHORIZED');
  end if;

  if p_role is null or p_role not in ('loading_officer', 'offloading_officer') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ROLE');
  end if;
  v_role := p_role::public.app_role;

  if p_display_name is null or length(btrim(p_display_name)) not between 1 and 200 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_NAME');
  end if;

  select * into v_site from public.sites where id = p_site_id for share;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SITE_NOT_FOUND');
  end if;

  select * into v_profile from public.profiles where id = p_profile_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND');
  end if;
  if v_profile.is_active or v_profile.role is not null then
    select id into v_assignment_id from public.user_site_assignments
      where profile_id = p_profile_id and site_id = p_site_id and ended_at is null;
    if v_profile.is_active and v_profile.role = v_role and v_assignment_id is not null
      and exists (select 1 from public.audit_log where entity_name = 'operational_user_credentials'
        and entity_id = p_profile_id and actor_id = p_created_by
        and new_value->>'role' = v_role::text and new_value->>'site_id' = p_site_id::text) then
      return jsonb_build_object('ok', true, 'profile_id', p_profile_id,
        'display_name', v_profile.display_name, 'role', v_role::text,
        'site_id', v_site.id, 'site_name', v_site.name, 'assignment_id', v_assignment_id);
    end if;
    return jsonb_build_object('ok', false, 'code', 'PROFILE_ALREADY_CONFIGURED');
  end if;

  if not v_site.is_active then
    return jsonb_build_object('ok', false, 'code', 'INACTIVE_SITE');
  end if;
  if (v_role = 'loading_officer' and v_site.site_type <> 'loading')
    or (v_role = 'offloading_officer' and v_site.site_type <> 'offloading') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_SITE_ASSIGNMENT');
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', p_created_by::text, true);
  perform pg_catalog.set_config('app.audit_reason', 'Operational account created', true);
  update public.profiles
  set display_name = btrim(p_display_name), role = v_role, is_active = true
  where id = p_profile_id;

  insert into public.user_site_assignments(profile_id, site_id, assigned_by)
  values (p_profile_id, p_site_id, p_created_by)
  returning id into v_assignment_id;

  insert into public.audit_log(entity_name, entity_id, action, new_value, reason, actor_id)
  values (
    'operational_user_credentials',
    p_profile_id,
    'INSERT',
    jsonb_build_object(
      'profile_id', p_profile_id,
      'display_name', btrim(p_display_name),
      'role', v_role::text,
      'site_id', v_site.id,
      'site_name', v_site.name,
      'assignment_id', v_assignment_id
    ),
    'Operational account created',
    p_created_by
  );

  return jsonb_build_object(
    'ok', true,
    'profile_id', p_profile_id,
    'display_name', btrim(p_display_name),
    'role', v_role::text,
    'site_id', v_site.id,
    'site_name', v_site.name,
    'assignment_id', v_assignment_id
  );
end;
$$;

create or replace function public.discard_incomplete_operational_user(p_profile_id uuid, p_created_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
begin
  select * into v_profile from public.profiles where id = p_profile_id for update;
  if not found then return jsonb_build_object('ok', true); end if;
  if v_profile.is_active or v_profile.role is not null
    or exists (select 1 from public.user_site_assignments where profile_id = p_profile_id)
    or exists (select 1 from public.audit_log where actor_id = p_profile_id) then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_INCOMPLETE');
  end if;

  if not exists (select 1 from public.profiles where id = p_created_by) then
    return jsonb_build_object('ok', false, 'code', 'CREATOR_NOT_FOUND');
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub', p_created_by::text, true);
  perform pg_catalog.set_config('app.audit_reason', 'Incomplete operational account creation cleanup', true);
  delete from public.profiles where id = p_profile_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.get_operational_credential_creator(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_operational_credential_creator(uuid) to service_role;
revoke all on function public.complete_operational_user_setup(uuid, text, text, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_operational_user_setup(uuid, text, text, uuid, uuid)
  to service_role;
revoke all on function public.discard_incomplete_operational_user(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.discard_incomplete_operational_user(uuid, uuid)
  to service_role;

commit;
