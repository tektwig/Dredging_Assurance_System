begin;
create function pg_temp.credential_management_assert(value boolean, message text) returns void
language plpgsql as $$ begin if value is distinct from true then raise exception 'Credential management assertion failed: %', message; end if; end $$;

insert into auth.users(id,email,raw_user_meta_data) values
 ('f3000000-0000-4000-8000-000000000001','manage-ops@example.invalid','{}'),
 ('f3000000-0000-4000-8000-000000000002','manage-field@example.invalid','{}'),
 ('f3000000-0000-4000-8000-000000000003','manage-admin@example.invalid','{}');
update public.profiles set role='operations_manager',is_active=true,display_name='Manage Operations'
 where id='f3000000-0000-4000-8000-000000000001';
update public.profiles set role='loading_officer',is_active=true,display_name='Managed Loading'
 where id='f3000000-0000-4000-8000-000000000002';
update public.profiles set role='system_administrator',is_active=true,display_name='Managed Admin'
 where id='f3000000-0000-4000-8000-000000000003';
insert into public.sites(id,name,site_type,is_active) values
 ('f4000000-0000-4000-8000-000000000001','Managed Loading Site','loading',true),
 ('f4000000-0000-4000-8000-000000000002','Managed Offloading Site','offloading',true);
select pg_catalog.set_config('request.jwt.claim.sub','f3000000-0000-4000-8000-000000000001',true);
insert into public.user_site_assignments(profile_id,site_id,assigned_by)
 values ('f3000000-0000-4000-8000-000000000002','f4000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001');
select pg_temp.credential_management_assert(not has_table_privilege('authenticated','public.profiles','UPDATE')
 and not has_table_privilege('authenticated','public.user_site_assignments','INSERT'),
 'management does not widen direct profile mutation or assignment access');
select pg_temp.credential_management_assert(
 has_function_privilege('service_role','public.list_operational_credential_users(uuid,text,text,boolean,integer,integer)','EXECUTE')
 and not has_function_privilege('authenticated','public.list_operational_credential_users(uuid,text,text,boolean,integer,integer)','EXECUTE')
 and not has_function_privilege('anon','public.list_operational_credential_users(uuid,text,text,boolean,integer,integer)','EXECUTE'),
 'user list projection is service-role only');
select pg_temp.credential_management_assert(
 has_function_privilege('service_role','public.update_operational_credential_profile(uuid,uuid,text,text,uuid)','EXECUTE')
 and not has_function_privilege('authenticated','public.update_operational_credential_profile(uuid,uuid,text,text,uuid)','EXECUTE'),
 'profile mutation is service-role only');

set local role service_role;
select pg_temp.credential_management_assert(public.list_operational_credential_sites(
 'f3000000-0000-4000-8000-000000000001')->>'ok'='true','active Operations Manager can obtain constrained active sites');
select pg_temp.credential_management_assert(public.list_operational_credential_sites(
 'f3000000-0000-4000-8000-000000000003')->>'code'='CALLER_NOT_AUTHORIZED','Admin is not silently added to temporary Operations authorization');
select pg_temp.credential_management_assert(public.list_operational_credential_users(
 'f3000000-0000-4000-8000-000000000001',null,null,null,1,25)->>'ok'='true',
 'active Operations Manager can list safe bounded user projection');
select pg_temp.credential_management_assert(public.list_operational_credential_users(
 'f3000000-0000-4000-8000-000000000001',null,null,null,0,25)->>'code'='INVALID_FILTER',
 'invalid list pagination rejected server-side');
select pg_temp.credential_management_assert(public.get_operational_credential_user(
 'f3000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000002')->'user'->>'email'='manage-field@example.invalid',
 'detail projection includes synchronized Auth email');
select pg_temp.credential_management_assert(not (public.get_operational_credential_user(
 'f3000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000002')::text ~* '(password|token|encrypted_password|raw_user_meta_data)'),
 'safe user projection excludes secrets and Auth internals');
select pg_temp.credential_management_assert(public.update_operational_credential_profile(
 'f3000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000002','Denied','offloading_officer',
 'f4000000-0000-4000-8000-000000000002')->>'code'='CALLER_NOT_AUTHORIZED','unauthorized mutation rejected');
select pg_temp.credential_management_assert(public.update_operational_credential_profile(
 'f3000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000002','Managed Renamed','offloading_officer',
 'f4000000-0000-4000-8000-000000000002')->>'ok'='true','valid field role/site profile update succeeds');
select pg_temp.credential_management_assert(public.update_operational_credential_profile(
 'f3000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000002','Promoted','operations_manager',
 'f4000000-0000-4000-8000-000000000002')->>'code'='INVALID_ROLE','Operations cannot grant privileged roles');
select pg_temp.credential_management_assert(public.set_operational_credential_active(
 'f3000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',false)->>'code'='SELF_DEACTIVATION_DENIED',
 'self-deactivation is rejected');
select pg_temp.credential_management_assert(public.set_operational_credential_active(
 'f3000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000002',false)->>'changed'='true',
 'managed account can be deactivated');
select pg_temp.credential_management_assert(public.set_operational_credential_active(
 'f3000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000002',true)->>'changed'='true',
 'managed account can be reactivated');
select pg_temp.credential_management_assert(public.audit_operational_credential_password_reset(
 'f3000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000002',false)->>'ok'='true'
 and public.audit_operational_credential_password_reset(
 'f3000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000002',true)->>'ok'='true',
 'password reset occurrence can be audited without receiving the password');
reset role;
select pg_temp.credential_management_assert((select count(*)=2 from public.user_site_assignments
 where profile_id='f3000000-0000-4000-8000-000000000002'),
 'site reassignment closes old history and appends a current assignment');
select pg_temp.credential_management_assert((select is_active and role='offloading_officer' and display_name='Managed Renamed'
 from public.profiles where id='f3000000-0000-4000-8000-000000000002'),
 'profile changes and reactivation preserve configured account');
select pg_temp.credential_management_assert((select count(*)>=3 from public.audit_log
 where entity_name='operational_user_credentials' and entity_id='f3000000-0000-4000-8000-000000000002'),
 'profile, role/site and activation changes are audited');
select pg_temp.credential_management_assert((select count(*)=2 from public.audit_log
 where entity_name='operational_credential_password_reset' and entity_id='f3000000-0000-4000-8000-000000000002'
 and new_value ? 'outcome' and new_value::text !~* '(password_value|token|secret)'),
 'password reset request/completion audit stores only safe outcome metadata');
rollback;
