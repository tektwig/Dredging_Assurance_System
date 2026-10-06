-- Disposable local database ONLY. Session rows/claims model Supabase Auth.
begin;
create function pg_temp.field_day_assert(v boolean, message text) returns void language plpgsql as $$
begin
  if v is distinct from true then raise exception 'Field operational-day assertion failed: %',message; end if;
end $$;

insert into auth.users(id,email,raw_user_meta_data) values
 ('fa000000-0000-0000-0000-000000000001','field-day-loader@example.invalid','{}'),
 ('fa000000-0000-0000-0000-000000000002','field-day-offloader@example.invalid','{}'),
 ('fa000000-0000-0000-0000-000000000003','field-day-operations@example.invalid','{}');
insert into auth.sessions(id,user_id,created_at) values
 ('fb000000-0000-0000-0000-000000000001','fa000000-0000-0000-0000-000000000001',statement_timestamp()),
 ('fb000000-0000-0000-0000-000000000002','fa000000-0000-0000-0000-000000000002',statement_timestamp()),
 ('fb000000-0000-0000-0000-000000000003','fa000000-0000-0000-0000-000000000003',statement_timestamp());

update public.profiles set role=case right(id::text,1)
  when '1' then 'loading_officer'::public.app_role
  when '2' then 'offloading_officer'::public.app_role
  else 'operations_manager'::public.app_role end,is_active=true
where id::text like 'fa000000-%';

select set_config('test.loading_session','fb000000-0000-0000-0000-000000000001',true);
select set_config('test.offloading_session','fb000000-0000-0000-0000-000000000002',true);
select set_config('test.manager_session','fb000000-0000-0000-0000-000000000003',true);
select set_config('test.new_loading_session','fb000000-0000-0000-0000-000000000004',true);
select set_config('request.jwt.claim.sub','fa000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims',jsonb_build_object('sub','fa000000-0000-0000-0000-000000000001',
  'session_id',current_setting('test.loading_session'),'iat',extract(epoch from statement_timestamp())::bigint)::text,true);
set local role authenticated;
select pg_temp.field_day_assert(public.get_field_session_status()->>'status'='valid',
  'same-day Loading Officer login is valid');
select pg_temp.field_day_assert(public.get_field_session_status()->>'operational_date'
  = (statement_timestamp() at time zone 'Africa/Lagos')::date::text,
  'session is assigned the current Africa/Lagos operational date');
select pg_temp.field_day_assert(private.has_role(array['loading_officer']::public.app_role[]),
  'same-day Loading Officer authorization is active');

-- Simulate token refresh while preserving the session id and original
-- auth.sessions.created_at. This iat is intentionally far in the future.
select set_config('request.jwt.claims',jsonb_build_object('sub','fa000000-0000-0000-0000-000000000001',
  'session_id',current_setting('test.loading_session'),
  'iat',extract(epoch from (statement_timestamp()+interval '5 days'))::bigint)::text,true);
select pg_temp.field_day_assert(public.get_field_session_status()->>'status'='valid',
  'token refresh does not change a valid same-day session');

-- Move the original login to 23:55 Lagos time on the previous date. It is
-- valid until the next Lagos midnight and expired at that exact boundary.
reset role;
update auth.sessions set created_at=
  (((statement_timestamp() at time zone 'Africa/Lagos')::date::timestamp at time zone 'Africa/Lagos')
    - interval '5 minutes')
where id=current_setting('test.loading_session')::uuid;
do $$ declare v_started_at timestamptz:=(select created_at from auth.sessions
    where id=current_setting('test.loading_session')::uuid);
  v_midnight timestamptz;
begin
  v_midnight:=((v_started_at at time zone 'Africa/Lagos')::date+1)::timestamp at time zone 'Africa/Lagos';
  if not private.field_session_is_current(v_midnight-interval '1 microsecond') then
    raise exception 'Loading session expired before Lagos midnight'; end if;
  if private.field_session_is_current(v_midnight) then
    raise exception 'Loading session remained valid after the Lagos operational date changed'; end if;
end $$;
set local role authenticated;
select pg_temp.field_day_assert(public.get_field_session_status()->>'status'='expired',
  'Loading session from the previous Lagos operational day is rejected');
select pg_temp.field_day_assert(not private.has_role(array['loading_officer']::public.app_role[]),
  'previous-day Loading session cannot pass the authorization role check');

-- Re-authentication after the date change creates a new session id and uses
-- that session's created_at operational date, regardless of refreshed iat.
reset role;
insert into auth.sessions(id,user_id,created_at) values
  (current_setting('test.new_loading_session')::uuid,
   'fa000000-0000-0000-0000-000000000001',statement_timestamp());
select set_config('request.jwt.claims',jsonb_build_object('sub','fa000000-0000-0000-0000-000000000001',
  'session_id',current_setting('test.new_loading_session'),
  'iat',extract(epoch from (statement_timestamp()+interval '5 days'))::bigint)::text,true);
set local role authenticated;
select pg_temp.field_day_assert(public.get_field_session_status()->>'status'='valid',
  'fresh login on the current Lagos date is valid');
select pg_temp.field_day_assert(public.get_field_session_status()->>'operational_date'
  = (statement_timestamp() at time zone 'Africa/Lagos')::date::text,
  'fresh login belongs to the new operational date');

-- Offloading Officers use the same boundary and authorization guard.
reset role;
select set_config('request.jwt.claim.sub','fa000000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims',jsonb_build_object('sub','fa000000-0000-0000-0000-000000000002',
  'session_id',current_setting('test.offloading_session'),
  'iat',extract(epoch from statement_timestamp())::bigint)::text,true);
set local role authenticated;
select pg_temp.field_day_assert(public.get_field_session_status()->>'status'='valid',
  'same-day Offloading Officer login is valid');
select pg_temp.field_day_assert(private.has_role(array['offloading_officer']::public.app_role[]),
  'same-day Offloading Officer authorization is active');
reset role;
update public.profiles set is_active=false where id='fa000000-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.field_day_assert(public.get_field_session_status()->>'status'='inactive',
  'deactivated Offloading Officer is rejected');
select pg_temp.field_day_assert(not private.has_role(array['offloading_officer']::public.app_role[]),
  'deactivated Offloading Officer cannot pass the authorization role check');
reset role;
update public.profiles set is_active=true where id='fa000000-0000-0000-0000-000000000002';
update auth.sessions set created_at=
  (((statement_timestamp() at time zone 'Africa/Lagos')::date::timestamp at time zone 'Africa/Lagos')
    - interval '5 minutes')
where id=current_setting('test.offloading_session')::uuid;
select set_config('request.jwt.claims',jsonb_build_object('sub','fa000000-0000-0000-0000-000000000002',
  'session_id',current_setting('test.offloading_session'),
  'iat',extract(epoch from (statement_timestamp()+interval '5 days'))::bigint)::text,true);
set local role authenticated;
select pg_temp.field_day_assert(public.get_field_session_status()->>'status'='expired',
  'previous-day Offloading session is rejected despite token refresh');
select pg_temp.field_day_assert(not private.has_role(array['offloading_officer']::public.app_role[]),
  'previous-day Offloading session cannot pass the authorization role check');

-- Operations Manager remains outside field-session enforcement.
reset role;
update auth.sessions set created_at=
  (((statement_timestamp() at time zone 'Africa/Lagos')::date::timestamp at time zone 'Africa/Lagos')
    - interval '5 minutes')
where id=current_setting('test.manager_session')::uuid;
select set_config('request.jwt.claim.sub','fa000000-0000-0000-0000-000000000003',true);
select set_config('request.jwt.claims',jsonb_build_object('sub','fa000000-0000-0000-0000-000000000003',
  'session_id',current_setting('test.manager_session'),
  'iat',extract(epoch from statement_timestamp())::bigint)::text,true);
set local role authenticated;
select pg_temp.field_day_assert(public.get_field_session_status()->>'status'='not_field',
  'Operations Manager does not receive field-session behavior');
select pg_temp.field_day_assert(private.has_role(array['operations_manager']::public.app_role[]),
  'Operations Manager authorization remains unchanged');
select pg_temp.field_day_assert(has_function_privilege('authenticated',
  'private.can_upload_loading_image(text)','EXECUTE') and has_function_privilege('authenticated',
  'private.can_upload_offloading_image(text)','EXECUTE'),
  'field evidence Storage policies retain their required helper grants');
rollback;
