begin;

-- Auth identities are provisioned through the Auth Admin API. This migration
-- assigns only trusted application roles and never stores account passwords.
update public.profiles as profile
set display_name = seed.display_name,
    role = seed.role::public.app_role,
    is_active = true
from auth.users as auth_user
join (
  values
    ('admin@tektwig.com', 'System Administrator', 'system_administrator'),
    ('ops@tektwig.com', 'Operations Manager', 'operations_manager'),
    ('agent@tektwig.com', 'Loading Site Agent', 'loading_officer')
) as seed(email, display_name, role)
  on lower(auth_user.email) = seed.email
where profile.id = auth_user.id;

do $$
declare
  admin_profile_id uuid;
  agent_profile_id uuid;
  loading_site_id uuid;
  assignment_result jsonb;
begin
  select auth_user.id
  into admin_profile_id
  from auth.users as auth_user
  where lower(auth_user.email) = 'admin@tektwig.com';

  select auth_user.id
  into agent_profile_id
  from auth.users as auth_user
  where lower(auth_user.email) = 'agent@tektwig.com';

  if admin_profile_id is null or agent_profile_id is null then
    raise exception 'Required operational Auth users were not provisioned';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = admin_profile_id
      and role = 'system_administrator'
      and is_active
  ) or not exists (
    select 1
    from public.profiles
    where id = agent_profile_id
      and role = 'loading_officer'
      and is_active
  ) or not exists (
    select 1
    from public.profiles as profile
    join auth.users as auth_user on auth_user.id = profile.id
    where lower(auth_user.email) = 'ops@tektwig.com'
      and profile.role = 'operations_manager'
      and profile.is_active
  ) then
    raise exception 'Operational profiles could not be activated';
  end if;

  select site.id
  into loading_site_id
  from public.sites as site
  where site.site_type = 'loading'
    and site.is_active
  order by site.created_at, site.id
  limit 1;

  if loading_site_id is null then
    raise exception 'An active loading site is required for the site agent';
  end if;

  -- The assignment function intentionally relies on auth.uid(). Set the
  -- trusted administrator identity only within this migration transaction.
  perform set_config('request.jwt.claim.sub', admin_profile_id::text, true);
  assignment_result := public.assign_user_site(agent_profile_id, loading_site_id);

  if not coalesce((assignment_result ->> 'ok')::boolean, false) then
    raise exception 'Agent site assignment failed: %', assignment_result;
  end if;
end;
$$;

commit;
