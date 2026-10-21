begin;

create function pg_temp.canary_assert(p_value boolean,p_message text) returns void language plpgsql as $$
begin
  if p_value is distinct from true then raise exception 'Synthetic email canary assertion failed: %',p_message; end if;
  raise notice 'ASSERTION PASS: %',p_message;
end;
$$;

create function pg_temp.canary_expect_sqlstate(p_statement text,p_expected text,p_message text)
returns void language plpgsql as $$
declare v_state text;
begin
  begin
    execute p_statement;
  exception when others then
    get stacked diagnostics v_state=returned_sqlstate;
    if v_state=p_expected then
      raise notice 'ASSERTION PASS: %',p_message;
      return;
    end if;
    raise exception 'Synthetic email canary expected SQLSTATE %, got %: %',p_expected,v_state,p_message;
  end;
  raise exception 'Synthetic email canary expected SQLSTATE % but statement succeeded: %',p_expected,p_message;
end;
$$;

select set_config('test.phase3b_invoice_id',(
  select invoice.id::text from public.trip_closure_invoices invoice
  where invoice.invoice_number='WB-9999-999999'
),true);
select set_config('test.phase3b_trip_id',(
  select invoice.trip_id::text from public.trip_closure_invoices invoice
  where invoice.invoice_number='WB-9999-999999'
),true);
select set_config('test.phase3b_ordinary_trip_id',(
  select trip.id::text from public.trips trip
  join public.drivers driver on driver.id=trip.driver_id
  where driver.full_name='Synthetic Ordinary Control Driver' and trip.status='open'
),true);

create temporary table canary_outbox_before as
select notification.id,to_jsonb(notification) as row_data
from public.notification_outbox notification
where not exists (
  select 1 from public.trip_closure_invoices invoice
  where invoice.trip_id=notification.trip_id and invoice.invoice_number='WB-9999-999999'
);

create temporary table canary_notification_claims(
  id uuid,audience text,invoice_id uuid,invoice_number text,recipient text,lease_token uuid
);
grant insert,select on canary_notification_claims to service_role;
create temporary table regular_claim_results(id uuid);
grant insert,select on regular_claim_results to service_role;
create temporary table regular_pdf_claim_results(
  copy_id uuid,invoice_id uuid,trip_id uuid,invoice_number text,storage_bucket text,storage_path text,
  attempts integer,lease_token uuid,lease_until timestamptz
);
grant insert,select on regular_pdf_claim_results to service_role;

select pg_temp.canary_assert((
  select count(*)=1 from public.trip_closure_invoices invoice
  join public.trips trip on trip.id=invoice.trip_id
  where invoice.id=current_setting('test.phase3b_invoice_id')::uuid
    and invoice.invoice_number='WB-9999-999999' and trip.status='closed'
    and invoice.opened_at<trip.closed_at and invoice.closed_at=trip.closed_at and invoice.issued_at=trip.closed_at
),'reserved number belongs to one correctly closed synthetic trip');
select pg_temp.canary_assert((
  select count(*)=1 from private.waybill_synthetic_email_canary_permits permit
  where permit.invoice_id=current_setting('test.phase3b_invoice_id')::uuid
    and permit.trip_id=current_setting('test.phase3b_trip_id')::uuid and permit.consumed_at is not null
),'one server-authorized permit was consumed by the reserved invoice');
select pg_temp.canary_assert(not exists (
  select 1 from private.waybill_synthetic_email_canary_permits permit
  where permit.trip_id=current_setting('test.phase3b_ordinary_trip_id')::uuid
),'ordinary open trip received no reserved-number permit');
select pg_temp.canary_assert((
  select count(*)=0 from public.trip_closure_invoice_documents document
  where document.invoice_id=current_setting('test.phase3b_invoice_id')::uuid
) and (
  select count(*)=1 from public.trip_closure_invoice_pdf_copies copy
  where copy.invoice_id=current_setting('test.phase3b_invoice_id')::uuid and copy.copy_kind='driver'
) and (
  select count(*)=2 from public.trip_closure_invoice_pdf_copies copy
  where copy.invoice_id=current_setting('test.phase3b_invoice_id')::uuid and copy.copy_kind='company'
),'reserved invoice uses only secure PDF copies and no legacy PDF record');

select pg_temp.canary_assert(has_function_privilege('service_role',
  'public.authorize_waybill_synthetic_email_canary_trip(uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.authorize_waybill_synthetic_email_canary_trip(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.authorize_waybill_synthetic_email_canary_trip(uuid)','EXECUTE'),
  'only service_role can authorize a synthetic trip');
select pg_temp.canary_assert(has_function_privilege('service_role',
  'public.claim_waybill_synthetic_canary_pdf_jobs(uuid,text)','EXECUTE')
  and has_function_privilege('service_role','public.arm_waybill_synthetic_email_canary(uuid,integer)','EXECUTE')
  and has_function_privilege('service_role','public.provision_waybill_synthetic_email_canary_notifications(uuid,text)','EXECUTE')
  and has_function_privilege('service_role','public.disarm_waybill_synthetic_email_canary(uuid)','EXECUTE')
  and has_function_privilege('service_role','public.recover_expired_waybill_synthetic_email_canary(uuid)','EXECUTE'),
  'all canary mutation and claim RPCs are service-role callable');
select pg_temp.canary_assert(not has_table_privilege('service_role',
  'private.waybill_synthetic_email_canary_permits','SELECT')
  and not has_table_privilege('authenticated','private.waybill_synthetic_email_canary_permits','SELECT')
  and not has_table_privilege('service_role','public.notification_outbox','INSERT'),
  'API roles cannot read permit internals or directly insert notification rows');

select set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.canary_expect_sqlstate(format(
  'select public.authorize_waybill_synthetic_email_canary_trip(%L::uuid)',
  current_setting('test.phase3b_trip_id')),'42501','Loading Officer cannot authorize a synthetic canary');
select pg_temp.canary_expect_sqlstate(format(
  'select * from public.claim_waybill_synthetic_canary_pdf_jobs(%L::uuid,%L)',
  current_setting('test.phase3b_invoice_id'),'driver'),'42501',
  'Loading Officer cannot claim synthetic PDF jobs');
select pg_temp.canary_expect_sqlstate(format(
  'select public.arm_waybill_synthetic_email_canary(%L::uuid,60)',
  current_setting('test.phase3b_invoice_id')),'42501','Loading Officer cannot arm email delivery');
reset role;

select pg_temp.canary_expect_sqlstate(format(
  'select public.claim_waybill_synthetic_canary_pdf_jobs(%L::uuid,%L)',
  current_setting('test.phase3b_ordinary_trip_id'),'driver'),'42501',
  'invoice-scoped PDF claim rejects an ordinary open trip');
select pg_temp.canary_expect_sqlstate(format(
  'select public.provision_waybill_synthetic_email_canary_notifications(%L::uuid,%L)',
  (select invoice.id from public.trip_closure_invoices invoice
   where invoice.invoice_number='WB-2026-000046'),'synthetic-company@example.invalid'),'42501',
  'notification provisioning rejects a non-reserved invoice');

select pg_temp.canary_assert((
  select count(*)=2 and count(distinct notification.audience)=2
  from public.notification_outbox notification
  where notification.trip_id=current_setting('test.phase3b_trip_id')::uuid
    and notification.event_type='waybill_ready' and notification.delivery_sequence=0
),'exactly two fixed-audience canary notification records exist');
select pg_temp.canary_assert((
  select count(*)=1 from public.notification_outbox notification
  where notification.trip_id=current_setting('test.phase3b_trip_id')::uuid
    and notification.event_type='waybill_ready' and notification.audience='driver'
    and notification.recipients=array['synthetic-driver@example.invalid']::text[]
    and notification.payload->>'invoice_number'='WB-9999-999999'
) and (
  select count(*)=1 from public.notification_outbox notification
  where notification.trip_id=current_setting('test.phase3b_trip_id')::uuid
    and notification.event_type='waybill_ready' and notification.audience='client'
    and notification.recipients=array['synthetic-company@example.invalid']::text[]
    and notification.payload->>'invoice_number'='WB-9999-999999'
),'canary recipients and invoice payloads are fixed to synthetic identities');
select pg_temp.canary_assert((
  select not (notification.payload ?| array[
    'bank_name','account_name','account_number','bank_snapshot','bank_details'
  ])
  from public.notification_outbox notification
  where notification.trip_id=current_setting('test.phase3b_trip_id')::uuid
    and notification.event_type='waybill_ready' limit 1
),'canary notification payloads contain no bank information');

select pg_temp.canary_expect_sqlstate(format(
  'select * from public.claim_waybill_notification_canary(%L,%L::uuid,%L,2)',
  'ci-wrong-recipient',current_setting('test.phase3b_invoice_id'),'attacker@example.invalid'),
  '42501','canary claim rejects a non-synthetic Company recipient');
select pg_temp.canary_expect_sqlstate(format(
  'select * from public.claim_waybill_notification_canary(%L,%L::uuid,%L,1)',
  'ci-historical',(select invoice.id from public.trip_closure_invoices invoice
    where invoice.invoice_number='WB-2026-000040'),'synthetic-company@example.invalid'),
  '42501','canary claim rejects excluded historical Waybill 040');
select pg_temp.canary_expect_sqlstate(format(
  'select public.provision_waybill_synthetic_email_canary_notifications(%L::uuid,%L)',
  current_setting('test.phase3b_invoice_id'),'attacker@example.invalid'),'42501',
  'provisioning rejects any Company recipient other than the reserved sink');
select pg_temp.canary_expect_sqlstate(format(
  'update public.notification_outbox set recipients=array[%L]::text[] where trip_id=%L::uuid and event_type=%L and audience=%L',
  'attacker@example.invalid',current_setting('test.phase3b_trip_id'),'waybill_ready','driver'),
  '42501','database trigger rejects a changed canary Driver recipient');
select pg_temp.canary_expect_sqlstate(format(
  'update public.notification_outbox set recipients=array[%L]::text[] where trip_id=%L::uuid and event_type=%L and audience=%L',
  'attacker@example.invalid',current_setting('test.phase3b_trip_id'),'waybill_ready','client'),
  '42501','database trigger rejects a changed canary Company recipient');

select pg_temp.canary_assert((select private.waybill_email_canary_environment_enabled()),
  'Vault project binding and explicit enablement are active in this disposable test database');
create temporary table canary_binding_before on commit drop as
select id,decrypted_secret,description from vault.decrypted_secrets
where name='trakflit_email_canary_project_ref';
select pg_temp.canary_assert((select count(*)=1 from canary_binding_before),
  'the disposable database has exactly one canary project binding');
\o /dev/null
select vault.update_secret(binding.id,'not-the-approved-project',
  'trakflit_email_canary_project_ref',binding.description)
from canary_binding_before binding;
\o
select pg_temp.canary_assert(not private.waybill_email_canary_environment_enabled(),
  'a mismatched project binding fails closed');
select pg_temp.canary_expect_sqlstate(format(
  'select public.authorize_waybill_synthetic_email_canary_trip(%L::uuid)',
  current_setting('test.phase3b_trip_id')),'42501',
  'synthetic provisioning is rejected under a mismatched project binding');
select pg_temp.canary_expect_sqlstate(format(
  'select * from public.claim_waybill_synthetic_canary_pdf_jobs(%L::uuid,%L)',
  current_setting('test.phase3b_invoice_id'),'driver'),'42501',
  'invoice-scoped PDF claims are rejected under a mismatched project binding');
select pg_temp.canary_expect_sqlstate(format(
  'select public.arm_waybill_synthetic_email_canary(%L::uuid,60)',
  current_setting('test.phase3b_invoice_id')),'42501',
  'email canary arming is rejected under a mismatched project binding');
\o /dev/null
select vault.update_secret(binding.id,binding.decrypted_secret,
  'trakflit_email_canary_project_ref',binding.description)
from canary_binding_before binding;
\o
select pg_temp.canary_assert(private.waybill_email_canary_environment_enabled(),
  'restoring the exact Vault project binding restores fail-closed canary eligibility');

create temporary table canary_outbox_after_reconciliation as
select notification.id,to_jsonb(notification) as row_data
from public.notification_outbox notification;
set local role service_role;
select pg_temp.canary_assert(public.enqueue_waybill_ready_notifications('synthetic-company@example.invalid')=0,
  'regular reconciliation creates or unblocks no jobs while the canary is armed');
insert into regular_claim_results
select notification.id from public.claim_waybill_notifications('ci-regular-blocked',10) notification;
select pg_temp.canary_assert((select count(*)=0 from regular_claim_results),
  'regular claims are blocked while the synthetic canary is armed');
insert into regular_pdf_claim_results
select job.copy_id,job.invoice_id,job.trip_id,job.invoice_number,job.storage_bucket,job.storage_path,
  job.attempts,job.lease_token,job.lease_until
from public.claim_driver_waybill_pdf_jobs(1,current_setting('test.phase3b_ordinary_invoice_id')::uuid) job;
select pg_temp.canary_assert((select count(*)=1
  and bool_and(invoice_number<>'WB-9999-999999')
  and bool_and(storage_bucket='waybill-driver-copies')
  from regular_pdf_claim_results),
  'normal PDF processing still claims an eligible non-canary Driver copy while canary email mode is armed');
select pg_temp.canary_assert(not exists (
  select 1 from public.claim_company_waybill_pdf_jobs(1,current_setting('test.phase3b_ordinary_invoice_id')::uuid)
), 'normal Company PDF eligibility remains blocked until a verified bank snapshot exists');
select pg_temp.canary_assert(not exists (
  (select before_row.id,before_row.row_data from canary_outbox_after_reconciliation before_row
   where not exists (select 1 from public.trip_closure_invoices invoice
     where invoice.trip_id=(before_row.row_data->>'trip_id')::uuid and invoice.invoice_number='WB-9999-999999')
   except
   select notification.id,to_jsonb(notification) from public.notification_outbox notification
   where not exists (select 1 from public.trip_closure_invoices invoice
     where invoice.trip_id=notification.trip_id and invoice.invoice_number='WB-9999-999999'))
  union all
  (select notification.id,to_jsonb(notification) from public.notification_outbox notification
   where not exists (select 1 from public.trip_closure_invoices invoice
     where invoice.trip_id=notification.trip_id and invoice.invoice_number='WB-9999-999999')
   except
   select before_row.id,before_row.row_data from canary_outbox_after_reconciliation before_row
   where not exists (select 1 from public.trip_closure_invoices invoice
     where invoice.trip_id=(before_row.row_data->>'trip_id')::uuid and invoice.invoice_number='WB-9999-999999'))
),'regular reconciliation and claims preserve every non-canary outbox field');
reset role;

select set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000004',true);
set local role authenticated;
select pg_temp.canary_expect_sqlstate(format(
  'select public.retry_operations_waybill_delivery(%L::uuid,%L,%L)',
  current_setting('test.phase3b_invoice_id'),'driver','DELIVERY_UNCONFIRMED'),'42501',
  'Operations Manager retry cannot bypass the active canary fence');
select pg_temp.canary_expect_sqlstate(format(
  'select public.retry_operations_waybill_delivery(%L::uuid,%L,%L)',
  (select invoice.id from public.trip_closure_invoices invoice
   where invoice.invoice_number='WB-2026-000040'),'driver','DELIVERY_UNCONFIRMED'),'42501',
  'Operations Manager retry cannot make excluded historical Waybill 040 eligible');
reset role;

select pg_temp.canary_assert(not exists (
  select 1 from pg_catalog.pg_proc function_row
  join pg_catalog.pg_namespace namespace_row on namespace_row.oid=function_row.pronamespace
  where namespace_row.nspname='public' and function_row.proname in ('claim_trip_notifications','retry_trip_notification')
    and has_function_privilege('service_role',function_row.oid,'EXECUTE')
),
  'legacy notification claim and retry routines remain inaccessible');
select pg_temp.canary_assert(not has_function_privilege('authenticated',
  'public.claim_waybill_notifications(text,integer)','EXECUTE')
  and has_function_privilege('service_role','public.claim_waybill_notifications(text,integer)','EXECUTE'),
  'regular claim RPC remains service-role-only');

insert into canary_notification_claims
select notification.id,notification.audience,(notification.payload->>'invoice_id')::uuid,
  notification.payload->>'invoice_number',notification.recipients[1],notification.lease_token
from public.claim_waybill_notification_canary(
  'ci-canary-claim',current_setting('test.phase3b_invoice_id')::uuid,
  'synthetic-company@example.invalid',2) notification;
select pg_temp.canary_assert((select count(*)=2 and count(distinct audience)=2
  and count(distinct invoice_id)=1 and min(invoice_number)='WB-9999-999999'
  and bool_and(recipient in ('synthetic-driver@example.invalid','synthetic-company@example.invalid'))
  and count(*) filter(where lease_token is not null)=2
  from canary_notification_claims),
  'canary claims lease exactly the two reserved-invoice notifications with audience-specific recipients');
select pg_temp.canary_assert(not exists (
  select 1 from canary_notification_claims claim
  where claim.invoice_id is distinct from current_setting('test.phase3b_invoice_id')::uuid
    or claim.invoice_number is distinct from 'WB-9999-999999'
),'no unrelated or historical notification was claimed by canary mode');
select pg_temp.canary_assert((
  select count(*)=2 and bool_and(
    attachment.invoice_id=claim.invoice_id
    and attachment.invoice_number='WB-9999-999999'
    and attachment.copy_kind=case claim.audience when 'driver' then 'driver' else 'company' end
    and attachment.storage_bucket=case claim.audience when 'driver' then 'waybill-driver-copies' else 'waybill-company-copies' end
    and attachment.storage_path=copy.storage_path
    and (claim.audience<>'driver' or copy.bank_snapshot_id is null)
  )
  from canary_notification_claims claim
  cross join lateral public.get_waybill_notification_pdf(claim.id,claim.lease_token) attachment
  join public.trip_closure_invoice_pdf_copies copy
    on copy.invoice_id=claim.invoice_id and copy.copy_kind=attachment.copy_kind
    and copy.status='ready' and copy.notification_eligible
),'each canary notification resolves only its audience-matched ready secure PDF without Driver bank data');

select pg_temp.canary_assert((select count(*)>0 from canary_outbox_before),
  'the seeded pre-cutover notification baseline is captured before canary operations');
select pg_temp.canary_assert(not exists (
  (select before_row.id,before_row.row_data from canary_outbox_before before_row
   except select notification.id,to_jsonb(notification) from public.notification_outbox notification
   where not exists (select 1 from public.trip_closure_invoices invoice
     where invoice.trip_id=notification.trip_id and invoice.invoice_number='WB-9999-999999'))
  union all
  (select notification.id,to_jsonb(notification) from public.notification_outbox notification
   where not exists (select 1 from public.trip_closure_invoices invoice
     where invoice.trip_id=notification.trip_id and invoice.invoice_number='WB-9999-999999')
   except select before_row.id,before_row.row_data from canary_outbox_before before_row)
),'all pre-existing outbox rows retain their complete status, recipients, payload, attempts, timestamps, and audit fields');
select pg_temp.canary_assert(not exists (
  select 1 from public.notification_outbox notification
  where notification.trip_id=current_setting('test.phase3b_trip_id')::uuid
    and notification.event_type='trip_closed' and notification.status<>'pending'
),'the lifecycle trip_closed event remains pending and is never claimed or changed by canary mode');

select pg_temp.canary_expect_sqlstate(format(
  'select public.disarm_waybill_synthetic_email_canary(%L::uuid)',
  current_setting('test.phase3b_invoice_id')),'55000',
  'an active leased canary cannot be disarmed before its work is resolved');

rollback;
