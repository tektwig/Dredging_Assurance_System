begin;
create function pg_temp.credential_assert(value boolean, message text) returns void
language plpgsql as $$ begin if value is distinct from true then raise exception 'Credential assertion failed: %', message; end if; end $$;

insert into auth.users(id, email, raw_user_meta_data) values
  ('f1000000-0000-4000-8000-000000000001', 'credential-ops@example.invalid', '{}'),
  ('f1000000-0000-4000-8000-000000000002', 'credential-finance@example.invalid', '{}'),
  ('f1000000-0000-4000-8000-000000000003', 'credential-inactive@example.invalid', '{}'),
  ('f1000000-0000-4000-8000-000000000004', 'credential-target@example.invalid', '{}'),
  ('f1000000-0000-4000-8000-000000000005', 'credential-target-two@example.invalid', '{}'),
  ('f1000000-0000-4000-8000-000000000006', 'credential-cleanup@example.invalid', '{}');
update public.profiles set role = 'operations_manager', is_active = true
  where id = 'f1000000-0000-4000-8000-000000000001';
update public.profiles set role = 'finance_officer', is_active = true
  where id = 'f1000000-0000-4000-8000-000000000002';
update public.profiles set role = 'operations_manager', is_active = false
  where id = 'f1000000-0000-4000-8000-000000000003';
insert into public.sites(id, name, site_type, is_active) values
  ('f2000000-0000-4000-8000-000000000001', 'Credential Loading', 'loading', true),
  ('f2000000-0000-4000-8000-000000000002', 'Credential Offloading', 'offloading', true),
  ('f2000000-0000-4000-8000-000000000003', 'Credential Inactive', 'loading', false);

select pg_temp.credential_assert(not has_table_privilege('service_role', 'public.profiles', 'SELECT'),
  'credential flow does not widen direct profile table privileges');
grant select on public.profiles, public.user_site_assignments, public.audit_log to service_role;

select pg_temp.credential_assert(has_function_privilege('service_role',
  'public.get_operational_credential_creator(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated',
  'public.get_operational_credential_creator(uuid)', 'EXECUTE')
  and not has_function_privilege('anon',
  'public.get_operational_credential_creator(uuid)', 'EXECUTE'),
  'credential creator read model is service-role-only');
select pg_temp.credential_assert(has_function_privilege('service_role',
  'public.complete_operational_user_setup(uuid,text,text,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated',
  'public.complete_operational_user_setup(uuid,text,text,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon',
  'public.complete_operational_user_setup(uuid,text,text,uuid,uuid)', 'EXECUTE'),
  'account finalization is service-role-only');
select pg_temp.credential_assert(has_function_privilege('service_role',
  'public.discard_incomplete_operational_user(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated',
  'public.discard_incomplete_operational_user(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon',
  'public.discard_incomplete_operational_user(uuid,uuid)', 'EXECUTE'),
  'incomplete account cleanup is service-role-only');

set local role service_role;
select pg_temp.credential_assert(public.get_operational_credential_creator(
  'f1000000-0000-4000-8000-000000000001')->>'role' = 'operations_manager'
  and public.get_operational_credential_creator('f1000000-0000-4000-8000-000000000001')->>'is_active' = 'true',
  'narrow server-side creator projection returns only role and active status');
select pg_temp.credential_assert(public.complete_operational_user_setup(
  'f1000000-0000-4000-8000-000000000001', 'No Target', 'loading_officer',
  'f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001')->>'code' = 'PROFILE_ALREADY_CONFIGURED',
  'configured profile cannot be reused');
select pg_temp.credential_assert(public.complete_operational_user_setup(
  'f1000000-0000-4000-8000-000000000004', 'Field Officer', 'loading_officer',
  'f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001')->>'code' = 'INVALID_SITE_ASSIGNMENT',
  'loading role cannot receive an offloading site');
select pg_temp.credential_assert(public.complete_operational_user_setup(
  'f1000000-0000-4000-8000-000000000004', 'Field Officer', 'loading_officer',
  'f2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001')->>'code' = 'INACTIVE_SITE',
  'inactive site rejected');
select pg_temp.credential_assert(public.complete_operational_user_setup(
  'f1000000-0000-4000-8000-000000000004', 'Field Officer', 'system_administrator',
  'f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001')->>'code' = 'INVALID_ROLE',
  'privileged non-operational role is not creatable');
select pg_temp.credential_assert(public.complete_operational_user_setup(
  'f1000000-0000-4000-8000-000000000004', 'Field Officer', 'loading_officer',
  'f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002')->>'code' = 'CALLER_NOT_AUTHORIZED',
  'wrong creator role rejected');
select pg_temp.credential_assert(public.complete_operational_user_setup(
  'f1000000-0000-4000-8000-000000000004', 'Field Officer', 'loading_officer',
  'f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003')->>'code' = 'CALLER_NOT_AUTHORIZED',
  'inactive Operations Manager rejected');
select pg_temp.credential_assert((select not is_active and role is null from public.profiles
  where id = 'f1000000-0000-4000-8000-000000000004')
  and not exists (select 1 from public.user_site_assignments
    where profile_id = 'f1000000-0000-4000-8000-000000000004'),
  'rejected callers, roles and sites do not partially configure target accounts');

create temp table credential_setup_result(result jsonb);
grant all on credential_setup_result to service_role;
insert into credential_setup_result values (public.complete_operational_user_setup(
  'f1000000-0000-4000-8000-000000000004', 'Field Officer', 'loading_officer',
  'f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001'));
reset role;
select pg_temp.credential_assert((select result->>'ok' = 'true'
  and result->>'site_name' = 'Credential Loading' from credential_setup_result),
  'valid creation returns safe confirmation projection');
select pg_temp.credential_assert((select p.is_active and p.role = 'loading_officer'
  and p.display_name = 'Field Officer' from public.profiles p
  where p.id = 'f1000000-0000-4000-8000-000000000004'), 'new profile activated with allowlisted role');
select pg_temp.credential_assert((select a.site_id = 'f2000000-0000-4000-8000-000000000001'
  and a.assigned_by = 'f1000000-0000-4000-8000-000000000001' and a.ended_at is null
  from public.user_site_assignments a where a.profile_id = 'f1000000-0000-4000-8000-000000000004'),
  'site assignment is current and audited to the creator');
select pg_temp.credential_assert((select count(*) = 1 from public.audit_log
  where entity_name = 'operational_user_credentials' and entity_id = 'f1000000-0000-4000-8000-000000000004'
    and actor_id = 'f1000000-0000-4000-8000-000000000001'
    and new_value->>'role' = 'loading_officer' and new_value->>'site_id' = 'f2000000-0000-4000-8000-000000000001'),
  'successful credential creation has immutable safe audit metadata');
select pg_temp.credential_assert((select count(*) = 0 from public.audit_log
  where entity_name = 'operational_user_credentials'
    and new_value::text ilike '%Strong-demo-password%'), 'credential secrets are absent from audit');
set local role service_role;
select pg_temp.credential_assert(public.complete_operational_user_setup(
  'f1000000-0000-4000-8000-000000000004', 'Field Officer', 'loading_officer',
  'f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001')->>'ok' = 'true'
  and (select count(*) = 1 from public.audit_log where entity_name = 'operational_user_credentials'
    and entity_id = 'f1000000-0000-4000-8000-000000000004'),
  'ambiguous setup retry returns the original account without duplicate audit events');

select pg_temp.credential_assert(public.complete_operational_user_setup(
  'f1000000-0000-4000-8000-000000000005', 'Offloading Officer', 'offloading_officer',
  'f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001')->>'ok' = 'true',
  'offloading role accepts an active offloading site');
select pg_temp.credential_assert(public.discard_incomplete_operational_user(
  'f1000000-0000-4000-8000-000000000005', 'f1000000-0000-4000-8000-000000000001')->>'ok' = 'false',
  'cleanup cannot delete configured accounts');
select pg_temp.credential_assert(public.discard_incomplete_operational_user(
  'f1000000-0000-4000-8000-000000000006', 'f1000000-0000-4000-8000-000000000001')->>'ok' = 'true',
  'cleanup removes only incomplete inactive profiles');
reset role;
select pg_temp.credential_assert(not exists (select 1 from public.profiles
  where id = 'f1000000-0000-4000-8000-000000000006'), 'incomplete profile removed for Auth compensation');

rollback;
