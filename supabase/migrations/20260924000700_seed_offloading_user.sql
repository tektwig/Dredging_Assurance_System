begin;

update public.profiles as profile
set display_name = 'Offloading Site Agent',
    role = 'offloading_officer',
    is_active = true
from auth.users as auth_user
where profile.id = auth_user.id
  and lower(auth_user.email) = 'offload@tektwig.com';

do $$
declare
  admin_profile_id uuid;
  offloading_profile_id uuid;
  offloading_site_id uuid;
  assignment_result jsonb;
begin
  select auth_user.id into admin_profile_id
  from auth.users as auth_user
  where lower(auth_user.email) = 'admin@tektwig.com';

  select auth_user.id into offloading_profile_id
  from auth.users as auth_user
  where lower(auth_user.email) = 'offload@tektwig.com';

  select site.id into offloading_site_id
  from public.sites as site
  where site.site_type = 'offloading'
    and site.is_active
  order by site.created_at, site.id
  limit 1;

  if admin_profile_id is null or offloading_profile_id is null or offloading_site_id is null then
    raise exception 'Admin, offloading user, and an active offloading site are required';
  end if;

  perform set_config('request.jwt.claim.sub', admin_profile_id::text, true);
  assignment_result := public.assign_user_site(offloading_profile_id, offloading_site_id);

  if not coalesce((assignment_result ->> 'ok')::boolean, false) then
    raise exception 'Offloading site assignment failed: %', assignment_result;
  end if;
end;
$$;

commit;
