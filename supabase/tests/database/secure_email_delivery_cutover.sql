begin;

create function pg_temp.assert_true(p_value boolean,p_message text) returns void language plpgsql as $$
begin
  if p_value is distinct from true then raise exception 'Secure email cutover assertion failed: %',p_message; end if;
  raise notice 'ASSERTION PASS: %',p_message;
end;
$$;

create function pg_temp.assert_sqlstate(p_sql text,p_expected_state text,p_message text) returns void language plpgsql as $$
declare v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state=returned_sqlstate;
    if v_state=p_expected_state then
      raise notice 'ASSERTION PASS: %',p_message;
      return;
    end if;
    raise exception 'Secure email cutover assertion failed: % (unexpected SQLSTATE)',p_message;
  end;
  raise exception 'Secure email cutover assertion failed: % (operation succeeded)',p_message;
end;
$$;

create temporary table excluded_notification_snapshot on commit drop as
select notification.id,to_jsonb(notification) as row_data
from public.notification_outbox notification
join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id
where invoice.invoice_number in ('WB-2026-000039','WB-2026-000040');

select pg_temp.assert_true((
  select count(*)=5 and array_agg(invoice_number order by invoice_number)=array[
    'WB-2026-000041','WB-2026-000042','WB-2026-000043','WB-2026-000044','WB-2026-000045'
  ]::text[] from private.waybill_email_historical_allowlist
),'the fixed historical allowlist contains exactly Waybills 041 through 045');

select pg_temp.assert_true((
  select bool_and(private.waybill_email_regular_delivery_allowed(invoice.id,invoice.trip_id))
  from public.trip_closure_invoices invoice
  where invoice.invoice_number in ('WB-2026-000041','WB-2026-000042','WB-2026-000043','WB-2026-000044','WB-2026-000045')
),'all five approved historical Waybills satisfy the historical scope predicate');
select pg_temp.assert_true(not private.waybill_email_regular_delivery_allowed(
  'e7000000-0000-4000-8000-000000000040','e6000000-0000-4000-8000-000000000040'
),'WB-2026-000040 is excluded even though it is a closed Waybill');
select pg_temp.assert_true(not private.waybill_email_regular_delivery_allowed(
  'e7000000-0000-4000-8000-000000000039','e6000000-0000-4000-8000-000000000039'
),'WB-2026-000039 and older non-allowlisted records remain excluded');
select pg_temp.assert_true((
  select private.waybill_email_regular_delivery_allowed(invoice.id,invoice.trip_id)
  from public.trip_closure_invoices invoice where invoice.invoice_number='WB-2026-000046'
),'a trip closed strictly after the fixed cutoff is included in the future scope');
select pg_temp.assert_true(not private.waybill_email_regular_delivery_allowed(
  'e7000000-0000-4000-8000-000000999999','e6000000-0000-4000-8000-000000999999'
),'the synthetic canary invoice cannot enter the regular delivery scope');
select pg_temp.assert_true((
  select max(closed_at)='2026-10-20T21:34:05.976714Z'::timestamptz
  from private.waybill_email_historical_allowlist
),'the fixed historical allowlist ends at the approved closure timestamp');

select pg_temp.assert_true((
  select count(*)=9 from public.notification_outbox notification
  join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id
  where invoice.invoice_number in ('WB-2026-000041','WB-2026-000042','WB-2026-000043','WB-2026-000044','WB-2026-000045')
    and notification.event_type='waybill_ready' and notification.status in ('pending','processing')
),'only the nine recipient-eligible potential messages across the five approved Waybills are claim candidates');
select pg_temp.assert_true(exists (
  select 1 from public.notification_outbox notification
  join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id
  where invoice.invoice_number='WB-2026-000045' and notification.event_type='waybill_ready'
    and notification.audience='driver' and notification.status='blocked_missing_email'
    and notification.recipients is null
),'the missing Driver email remains blocked');
select pg_temp.assert_true(exists (
  select 1 from public.trip_closure_invoice_pdf_copies copy
  join public.trip_closure_invoices invoice on invoice.id=copy.invoice_id
  where invoice.invoice_number='WB-2026-000046' and copy.copy_kind='company'
    and copy.status='blocked_missing_bank_details' and copy.bank_snapshot_id is null
),'a future trip with a blocked Company PDF is not made deliverable by the cutover');
select pg_temp.assert_true(not exists (
  select 1 from public.notification_outbox notification
  join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id
  where invoice.invoice_number='WB-2026-000046' and notification.audience='client'
    and notification.event_type='waybill_ready' and notification.status in ('pending','processing')
),'no Company notification bypasses the blocked PDF or missing bank snapshot');

select pg_temp.assert_true((
  select count(*)=0 from pg_catalog.pg_proc function
  join pg_catalog.pg_namespace schema on schema.oid=function.pronamespace
  where schema.nspname='public' and function.proname in ('claim_trip_notifications','retry_trip_notification')
    and (has_function_privilege('anon',function.oid,'EXECUTE')
      or has_function_privilege('authenticated',function.oid,'EXECUTE')
      or has_function_privilege('service_role',function.oid,'EXECUTE'))
),'legacy claim and retry functions are not executable by API roles or service_role');
select pg_temp.assert_true(not has_function_privilege('service_role','public.get_waybill_ready_pdf(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.get_waybill_ready_pdf(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.get_waybill_ready_pdf(uuid,uuid)','EXECUTE'),
  'the legacy PDF attachment RPC is inaccessible to all delivery roles');
select pg_temp.assert_true((
  select count(*)=0 from pg_catalog.pg_proc function
  join pg_catalog.pg_namespace schema on schema.oid=function.pronamespace
  where schema.nspname='public' and function.proname='enqueue_waybill_ready_notifications'
    and function.oid not in ('public.enqueue_waybill_ready_notifications()'::regprocedure,
      'public.enqueue_waybill_ready_notifications(text)'::regprocedure)
    and (has_function_privilege('anon',function.oid,'EXECUTE')
      or has_function_privilege('authenticated',function.oid,'EXECUTE')
      or has_function_privilege('service_role',function.oid,'EXECUTE'))
),'legacy reconciliation overloads cannot bypass the scoped functions');
select pg_temp.assert_true(has_function_privilege('service_role','public.claim_waybill_notifications(text,integer)','EXECUTE')
  and not has_function_privilege('anon','public.claim_waybill_notifications(text,integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.claim_waybill_notifications(text,integer)','EXECUTE'),
  'regular secure claims are service-role-only');
select pg_temp.assert_true(has_function_privilege('service_role','public.claim_waybill_notification_canary(text,uuid,text,integer)','EXECUTE')
  and not has_function_privilege('anon','public.claim_waybill_notification_canary(text,uuid,text,integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.claim_waybill_notification_canary(text,uuid,text,integer)','EXECUTE'),
  'canary claims are service-role-only');
select pg_temp.assert_true(not has_table_privilege('service_role','public.notification_outbox','INSERT')
  and not has_table_privilege('service_role','public.notification_outbox','UPDATE')
  and not has_table_privilege('service_role','public.notification_outbox','DELETE'),
  'service_role cannot bypass notification RPC guards with direct table writes');
select pg_temp.assert_true(not has_table_privilege('service_role','private.waybill_notification_canary_runs','INSERT')
  and not has_table_privilege('service_role','private.waybill_notification_canary_runs','UPDATE'),
  'service_role cannot arm or disarm a canary by direct table DML');

select public.enqueue_waybill_ready_notifications('synthetic-company@example.invalid');
select pg_temp.assert_true(not exists (
  select 1 from excluded_notification_snapshot before_row
  left join public.notification_outbox after_row on after_row.id=before_row.id
  where after_row.id is null or before_row.row_data is distinct from to_jsonb(after_row)
) and not exists (
  select 1 from public.notification_outbox after_row
  join public.trip_closure_invoices invoice on invoice.trip_id=after_row.trip_id
  left join excluded_notification_snapshot before_row on before_row.id=after_row.id
  where invoice.invoice_number in ('WB-2026-000039','WB-2026-000040') and before_row.id is null
) and (
  select count(*) from excluded_notification_snapshot
)= (
  select count(*) from public.notification_outbox after_row
  join public.trip_closure_invoices invoice on invoice.trip_id=after_row.trip_id
  where invoice.invoice_number in ('WB-2026-000039','WB-2026-000040')
),'reconciliation creates no excluded rows, unblocks none, and preserves every complete historical notification row');
select pg_temp.assert_true(
  exists (select 1 from excluded_notification_snapshot where row_data->>'status'='pending')
  and exists (select 1 from excluded_notification_snapshot where row_data->>'status'='sent')
  and (
    select count(*) from excluded_notification_snapshot where row_data->>'status'='pending'
  )=(
    select count(*) from excluded_notification_snapshot before_row
    join public.notification_outbox after_row on after_row.id=before_row.id
    where before_row.row_data->>'status'='pending' and after_row.status='pending'
  )
  and (
    select count(*) from excluded_notification_snapshot where row_data->>'status'='sent'
  )=(
    select count(*) from excluded_notification_snapshot before_row
    join public.notification_outbox after_row on after_row.id=before_row.id
    where before_row.row_data->>'status'='sent' and after_row.status='sent'
  ),'previously pending and sent excluded notifications retain their original states');

create temporary table regular_claims on commit drop as
select id,trip_id,audience,lease_token from public.claim_waybill_notifications('secure-email-sql-test',2);
select pg_temp.assert_true((select count(*)=2 from regular_claims),
  'regular claim recovers the expired eligible lease and claims the next eligible message');
select pg_temp.assert_true(not exists (
  select 1 from regular_claims claimed join public.trip_closure_invoices invoice on invoice.trip_id=claimed.trip_id
  where invoice.invoice_number in ('WB-2026-000039','WB-2026-000040')
),'regular claims cannot reclaim excluded WB-2026-000040');
select pg_temp.assert_true((
  select count(*)=1 from regular_claims claimed join public.trip_closure_invoices invoice on invoice.trip_id=claimed.trip_id
  where invoice.invoice_number='WB-2026-000041' and claimed.audience='driver'
),'an expired eligible lease is retried without changing scope');
select pg_temp.assert_true(not exists (
  select 1 from regular_claims claimed join public.notification_outbox notification on notification.id=claimed.id
  where notification.event_type='trip_closed'
),'regular claims never consume legacy trip_closed events');
select pg_temp.assert_true((
  select count(*)=1 from public.notification_outbox notification
  join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id
  where invoice.invoice_number='WB-2026-000040' and notification.audience='client'
    and notification.status='sent' and notification.sent_at is not null
),'an already-sent excluded historical notification remains sent');
select pg_temp.assert_true(not exists (
  select 1 from excluded_notification_snapshot before_row
  left join public.notification_outbox after_row on after_row.id=before_row.id
  where after_row.id is null or before_row.row_data is distinct from to_jsonb(after_row)
) and not exists (
  select 1 from public.notification_outbox after_row
  join public.trip_closure_invoices invoice on invoice.trip_id=after_row.trip_id
  left join excluded_notification_snapshot before_row on before_row.id=after_row.id
  where invoice.invoice_number in ('WB-2026-000039','WB-2026-000040') and before_row.id is null
) and (
  select count(*) from excluded_notification_snapshot
)= (
  select count(*) from public.notification_outbox after_row
  join public.trip_closure_invoices invoice on invoice.trip_id=after_row.trip_id
  where invoice.invoice_number in ('WB-2026-000039','WB-2026-000040')
),'all excluded notification rows and fields remain unchanged after reconciliation and claim');

select pg_temp.assert_sqlstate(
  'update public.notification_outbox set last_error=''must not mutate'' where id=(select notification.id from public.notification_outbox notification join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id where invoice.invoice_number in (''WB-2026-000039'',''WB-2026-000040'') limit 1)',
  '42501','direct mutation of excluded historical notification is rejected');
select pg_temp.assert_sqlstate(
  'delete from public.notification_outbox where id=(select notification.id from public.notification_outbox notification join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id where invoice.invoice_number in (''WB-2026-000039'',''WB-2026-000040'') limit 1)',
  '42501','deletion of excluded historical notification is rejected');

select pg_temp.assert_true((
  select count(*)=0 from public.notification_outbox notification
  join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id
  where invoice.invoice_number='WB-2026-000045' and notification.audience='driver'
    and notification.status in ('pending','processing')
),'the missing-email Driver notification is never claimed');

select bool_and(public.finish_trip_notification(claimed.id,claimed.lease_token,false,null,'synthetic test failure'))
from regular_claims claimed;

create temporary table canary_outbox_snapshot on commit drop as
select id,to_jsonb(notification) as row_data from public.notification_outbox notification;
insert into private.waybill_notification_canary_runs(invoice_id,trip_id,purpose,expires_at)
values ('e7000000-0000-4000-8000-000000999999','e6000000-0000-4000-8000-000000999999',
  'synthetic_development_test',statement_timestamp()+interval '10 minutes');
select pg_temp.assert_sqlstate(
  'insert into private.waybill_notification_canary_runs(invoice_id,trip_id,purpose,expires_at) values (''e7000000-0000-4000-8000-000000000046'',''e6000000-0000-4000-8000-000000000046'',''synthetic_development_test'',statement_timestamp()+interval ''10 minutes'')',
  '42501','a canary cannot be armed for an operational future invoice');
select pg_temp.assert_sqlstate(
  'select * from public.claim_waybill_notification_canary(''ci-sender'', ''e7000000-0000-4000-8000-000000000040'', ''synthetic-company@example.invalid'', 2)',
  '42501','canary claims cannot access excluded historical WB-2026-000040');
select pg_temp.assert_true(public.enqueue_waybill_ready_notifications('synthetic-company@example.invalid')=0,
  'regular reconciliation is blocked while the canary is armed');
create temporary table regular_during_canary on commit drop as
select id from public.claim_waybill_notifications('secure-email-normal-during-canary',2);
select pg_temp.assert_true((select count(*)=0 from regular_during_canary),
  'regular delivery claims cannot consume backlog during an armed canary');
select pg_temp.assert_true(not exists (
  select 1 from canary_outbox_snapshot before_row join public.notification_outbox after_row on after_row.id=before_row.id
  where before_row.row_data is distinct from to_jsonb(after_row)
),'arming and normal claim attempts do not mutate any notification while canary mode is active');

create temporary table canary_claims on commit drop as
select id,trip_id,audience,lease_token from public.claim_waybill_notification_canary(
  'synthetic-development-sender','e7000000-0000-4000-8000-000000999999',
  'synthetic-company@example.invalid',2);
select pg_temp.assert_true((select count(*)=2 from canary_claims),
  'canary claims its two eligible synthetic Driver and Company messages');
select pg_temp.assert_true(not exists (
  select 1 from canary_claims claimed join public.trip_closure_invoices invoice on invoice.trip_id=claimed.trip_id
  where invoice.invoice_number<>'WB-9999-999999'
),'every canary claim belongs to the one explicitly selected synthetic invoice');
select pg_temp.assert_true((select count(distinct audience)=2 from canary_claims),
  'canary independently processes Driver and Company notification audiences');
select bool_and(public.finish_trip_notification(claimed.id,claimed.lease_token,false,null,'synthetic canary test'))
from canary_claims claimed;
update private.waybill_notification_canary_runs set disarmed_at=statement_timestamp() where disarmed_at is null;
select pg_temp.assert_true(not exists (select 1 from private.waybill_notification_canary_runs where disarmed_at is null),
  'canary run is disarmed after all test leases are acknowledged');

select pg_temp.assert_true((
  select count(*)=1 from public.notification_outbox notification
  join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id
  where invoice.invoice_number='WB-2026-000040' and notification.event_type='trip_closed'
    and notification.audience='finance' and notification.status='pending'
),'unrelated historical trip_closed events remain pending and untouched');

select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select pg_temp.assert_sqlstate(
  'select public.retry_operations_waybill_delivery(''e7000000-0000-4000-8000-000000000040'',''driver'',''DELIVERY_UNCONFIRMED'')',
  '42501','Operations Manager retry cannot access excluded historical WB-2026-000040');
select pg_temp.assert_sqlstate(
  'select public.resend_operations_waybill(''e7000000-0000-4000-8000-000000000040'',''driver'',''e9000000-0000-4000-8000-000000000040'',''CORRECTIVE_RESEND'',true)',
  '42501','Operations Manager resend cannot access excluded historical WB-2026-000040');
reset role;

rollback;
