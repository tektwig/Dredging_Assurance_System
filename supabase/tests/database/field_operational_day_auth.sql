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
update public.profiles set role=case right(id::text,1)
  when '1' then 'loading_officer'::public.app_role
  when '2' then 'offloading_officer'::public.app_role
  else 'operations_manager'::public.app_role end,is_active=true
where id::text like 'fa000000-%';

select set_config('test.loading_session',(
  select id::text from auth.sessions where user_id='fa000000-0000-0000-0000-000000000001'),true);
select set_config('test.offloading_session',(
  select id::text from auth.sessions where user_id='fa000000-0000-0000-0000-000000000002'),true);
select set_config('test.manager_session',(
  select id::text from auth.sessions where user_id='fa000000-0000-0000-0000-000000000003'),true);
select set_config('request.jwt.claim.sub','fa000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims',jsonb_build_object('sub','fa000000-0000-0000-0000-000000000001',
  'session_id',current_setting('test.loading_session'),'iat',extract(epoch from statement_timestamp())::bigint)::text,true);
set local role authenticated;
select pg_temp.field_day_assert(public.get_field_session_status()->>'status'='valid',
  'same-day loading login is valid');
select pg_temp.field_day_assert(private.has_role(array['loading_officer']::public.app_role[]),
  'same-day field authorization is active');

-- Updating token issued-at simulates a refreshed access token. The original
-- auth.sessions.created_at and session_id remain the authority for the day.
select set_config('request.jwt.claims',jsonb_build_object('sub','fa000000-0000-0000-0000-000000000001',
  'session_id',current_setting('test.loading_session'),
  'iat',extract(epoch from (statement_timestamp()+interval '1 day'))::bigint)::text,true);
select pg_temp.field_day_assert(public.get_field_session_status()->>'status'='valid',
  'token refresh does not reset or extend the original session day');

-- Explicitly check the instant immediately before and at the next Lagos date.
reset role;
do $$ declare d date:=(statement_timestamp() at time zone 'Africa/Lagos')::date;
  v_before timestamptz:=((d+1)::timestamp at time zone 'Africa/Lagos')-interval '1 microsecond';
  v_boundary timestamptz:=((d+1)::timestamp at time zone 'Africa/Lagos');
begin
  if not private.field_session_is_current(v_before) then raise exception 'Session expired before Lagos midnight'; end if;
  if private.field_session_is_current(v_boundary) then raise exception 'Session remained valid at Lagos midnight'; end if;
end $$;

-- A previous Lagos day is rejected even when a refreshed token has a newer iat.
update auth.sessions set created_at=(((statement_timestamp() at time zone 'Africa/Lagos')::date-1)::timestamp
  at time zone 'Africa/Lagos')+interval '12 hours' where id=current_setting('test.loading_session')::uuid;
set local role authenticated;
select pg_temp.field_day_assert(public.get_field_session_status()->>'status'='expired',
  'previous-day loading session is rejected');
select pg_temp.field_day_assert(not private.has_role(array['loading_officer']::public.app_role[]),
  'expired loading session cannot pass the authorization role check');

select set_config('request.jwt.claim.sub','fa000000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims',jsonb_build_object('sub','fa000000-0000-0000-0000-000000000002',
  'session_id',current_setting('test.offloading_session'),'iat',extract(epoch from statement_timestamp())::bigint)::text,true);
select pg_temp.field_day_assert(public.get_field_session_status()->>'status'='valid',
  'same-day offloading login is valid');
reset role;
update public.profiles set is_active=false where id=auth.uid();
set local role authenticated;
select pg_temp.field_day_assert(public.get_field_session_status()->>'status'='inactive',
  'deactivated field officer is rejected');
select pg_temp.field_day_assert(not private.has_role(array['offloading_officer']::public.app_role[]),
  'deactivated field officer cannot pass the authorization role check');

-- Operations Manager authorization continues to depend on the active profile,
-- not the field operational-day rule.
reset role;
update auth.sessions set created_at=(((statement_timestamp() at time zone 'Africa/Lagos')::date-1)::timestamp
  at time zone 'Africa/Lagos')+interval '12 hours' where id=current_setting('test.manager_session')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','fa000000-0000-0000-0000-000000000003',true);
select set_config('request.jwt.claims',jsonb_build_object('sub','fa000000-0000-0000-0000-000000000003',
  'session_id',current_setting('test.manager_session'),
  'iat',extract(epoch from statement_timestamp())::bigint)::text,true);
select pg_temp.field_day_assert(public.get_field_session_status()->>'status'='not_field',
  'Operations Manager does not receive field-session behavior');
select pg_temp.field_day_assert(private.has_role(array['operations_manager']::public.app_role[]),
  'Operations Manager authorization remains unchanged');
select pg_temp.field_day_assert(has_function_privilege('authenticated',
  'private.can_upload_loading_image(text)','EXECUTE') and has_function_privilege('authenticated',
  'private.can_upload_offloading_image(text)','EXECUTE'),
  'field evidence Storage policies retain their required helper grants');
rollback;
