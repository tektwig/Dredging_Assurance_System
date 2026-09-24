begin;
do $$ begin
  if exists(select 1 from private.upgrade_expected e left join public.trips t using(id)
    where t.id is null or (e.driver_id,e.loading_site_id,e.daily_registration_id,e.opened_by,e.opened_at)
      is distinct from (t.driver_id,t.loading_site_id,t.daily_registration_id,t.opened_by,t.opened_at)) then
    raise exception 'Upgrade changed legacy trip identity'; end if;
  if exists(select 1 from public.trips where driver_name_at_loading is not null or loading_assignment_id is not null)
    or exists(select 1 from public.trip_loading_evidence) then raise exception 'Upgrade invented history'; end if;
  if not exists(select 1 from public.daily_registrations where initial_driver_id='92000000-0000-0000-0000-000000000001') then
    raise exception 'Initial driver not preserved'; end if;
  if not exists(select 1 from public.drivers where id='92000000-0000-0000-0000-000000000002' and phone_number='legacy phone' and normalized_phone is null) then
    raise exception 'Legacy phone was guessed/changed'; end if;
  if exists(select 1 from public.audit_log where coalesce(old_value,'{}')::text||coalesce(new_value,'{}')::text||coalesce(reason,'')
    ~ 'UPGRADE_PRIVATE|0199999999') then raise exception 'Legacy audit banking not redacted'; end if;
  if (select count(*) from private.upgrade_audit_expected) < 3 then raise exception 'Upgrade fixture omitted operational audit history'; end if;
  if exists(select 1 from private.upgrade_audit_expected e left join public.audit_log a using(id)
    where a.id is null or (a.entity_name,a.entity_id,a.action,a.actor_id,a.created_at)
      is distinct from (e.entity_name,e.entity_id,e.action,e.actor_id,e.created_at)) then
    raise exception 'Upgrade changed audit identity or provenance'; end if;
  if not exists(select 1 from public.audit_log where reason='Provider investigation: SMTP delay resolved; retry approved'
    and entity_name='notification_outbox' and new_value->>'status'='pending'
    and old_value->>'status'='failed') then raise exception 'Provider retry audit history lost'; end if;
  if not exists(select 1 from public.audit_log where reason='External payment reconciled: RECON-2026-001'
    and entity_name='trip_payments' and new_value->>'payment_reference'='RECON-2026-001'
    and new_value->>'status'='paid') then raise exception 'Finance reconciliation audit history lost'; end if;
  if not exists(select 1 from public.audit_log where reason='Provider investigated account_number=[REDACTED]; payment reconciled after review'
    and old_value->>'status'='pending' and new_value->>'status'='paid'
    and new_value->>'payment_reference'='RECON-2026-001') then raise exception 'Selective audit redaction lost safe context'; end if;
  if not exists(select 1 from public.driver_payment_details where account_number='0199999999') then raise exception 'Actual banking was changed'; end if;
  if exists(select 1 from private.upgrade_payments_expected e left join public.trip_payments p using(id)
    where p.id is null or (p.account_name,p.account_number,p.bank_name) is distinct from (e.account_name,e.account_number,e.bank_name)) then
    raise exception 'Historical payment snapshot changed'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000002',true);
do $$ begin
  if public.create_loading_trip_v2(gen_random_uuid(),'UPGRADE1','92000000-0000-0000-0000-000000000001',gen_random_uuid(),'MANUAL',clock_timestamp())->>'code'
    is distinct from 'SITE_ASSIGNMENT_REQUIRED' then raise exception 'Legacy loader assignment requirement missing'; end if;
end $$;
select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000003',true);
do $$ declare v jsonb; v_trip uuid; begin
  select id into v_trip from public.trips where truck_id='93000000-0000-0000-0000-000000000001' and status='open';
  if v_trip is null then raise exception 'Legacy open trip fixture missing'; end if;
  v:=public.close_trip(v_trip,
    '91000000-0000-0000-0000-000000000002',12.5);
  if v->>'ok' is distinct from 'true' then raise exception 'Legacy offloading closure failed'; end if;
end $$;
reset role;
do $$ declare v_trip uuid; begin
  select id into v_trip from private.upgrade_open_trip;
  if v_trip is null or not exists(select 1 from public.trips where id=v_trip and status='closed')
    or not exists(select 1 from public.trip_payments where trip_id=v_trip and driver_id='92000000-0000-0000-0000-000000000001' and account_number='0199999999')
    or not exists(select 1 from public.notification_outbox where trip_id=v_trip and audience='finance') then
    raise exception 'Specific legacy closure payment/notification regression'; end if;
end $$;
rollback;
