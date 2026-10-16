\set ON_ERROR_STOP on
begin;

update public.profiles
set display_name = case id
    when :'loading_id'::uuid then 'Synthetic E2E Loading Officer'
    when :'operations_id'::uuid then 'Synthetic E2E Operations Manager'
    when :'finance_id'::uuid then 'Synthetic E2E Finance Officer'
    when :'unassigned_id'::uuid then 'Synthetic E2E Unassigned Loading Officer'
  end,
  role = case id
    when :'loading_id'::uuid then 'loading_officer'::public.app_role
    when :'operations_id'::uuid then 'operations_manager'::public.app_role
    when :'finance_id'::uuid then 'finance_officer'::public.app_role
    when :'unassigned_id'::uuid then 'loading_officer'::public.app_role
  end,
  is_active = true
where id in (:'loading_id'::uuid, :'operations_id'::uuid, :'finance_id'::uuid, :'unassigned_id'::uuid);

select count(*) = 4 as profiles_ready
from public.profiles
where id in (:'loading_id'::uuid, :'operations_id'::uuid, :'finance_id'::uuid, :'unassigned_id'::uuid)
  and is_active and role is not null
\gset
\if :profiles_ready
\else
\echo Synthetic profile setup failed.
\quit 1
\endif

select set_config('request.jwt.claim.sub', :'operations_id', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', :'operations_id', 'role', 'authenticated'
)::text, true);
set local role authenticated;
select (public.assign_user_site(:'loading_id'::uuid, 'f3000000-0000-4000-8000-000000000001'::uuid)->>'ok')::boolean as assignment_ready
\gset
\if :assignment_ready
\else
\echo Synthetic Loading Officer site assignment failed.
\quit 1
\endif
reset role;
commit;

select 'PASS: synthetic role profiles and Loading site assignment ready.' as result;
