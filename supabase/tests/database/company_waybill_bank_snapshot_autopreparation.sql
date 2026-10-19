begin;

create function pg_temp.assert_true(p_value boolean,p_message text) returns void language plpgsql as $$
begin
  if p_value is distinct from true then raise exception 'Company Waybill recovery assertion failed: %',p_message; end if;
  raise notice 'ASSERTION PASS: %',p_message;
end;
$$;

create function pg_temp.expect_sqlstate(p_query text,p_expected text) returns void language plpgsql as $$
begin
  begin
    execute p_query;
  exception when others then
    if sqlstate=p_expected then
      raise notice 'ASSERTION PASS: expected SQLSTATE %',p_expected;
      return;
    end if;
    raise exception 'Expected SQLSTATE %, got %',p_expected,sqlstate;
  end;
  raise exception 'Expected SQLSTATE %',p_expected;
end;
$$;

select pg_temp.assert_true((
  select count(*)=3 from public.trip_closure_invoices
  where invoice_number between 'WB-2026-000040' and 'WB-2026-000042'
),'the three targeted Waybills remain present after migration');

select pg_temp.assert_true((
  select count(*)=3
  from public.trip_closure_invoices invoice
  join public.trip_closure_invoice_bank_snapshots snapshot on snapshot.invoice_id=invoice.id
  join public.trip_closure_invoice_bank_submissions submission
    on submission.id=snapshot.source_submission_id and submission.invoice_id=invoice.id
      and submission.trip_id=invoice.trip_id and submission.source_kind='registration_capture'
  join private.loading_registration_bank_captures capture
    on capture.id=snapshot.source_registration_capture_id
      and capture.driver_id=invoice.driver_id
  where invoice.invoice_number between 'WB-2026-000040' and 'WB-2026-000042'
    and snapshot.version=1 and snapshot.source_kind='registration_capture'
    and snapshot.verified_by is null and snapshot.verified_at is null
    and snapshot.bank_name=capture.bank_name and snapshot.account_name=capture.account_name
    and snapshot.account_number=capture.account_number
    and snapshot.submitted_by=capture.captured_by and snapshot.submitted_at=capture.captured_at
    and submission.bank_name=capture.bank_name and submission.account_name=capture.account_name
    and submission.account_number=capture.account_number
    and submission.submitted_by=capture.captured_by and submission.submitted_at=capture.captured_at
),'historical recovery creates invoice snapshots from the correct driver captures with original provenance and no fabricated verification');

select pg_temp.assert_true((
  select count(*)=3 from public.trip_closure_invoices invoice
  join public.trip_closure_invoice_bank_detail_events event on event.invoice_id=invoice.id
  join public.trip_closure_invoice_bank_submissions submission on submission.id=event.submission_id
  join private.loading_registration_bank_captures capture
    on capture.id=submission.source_registration_capture_id
  where invoice.invoice_number between 'WB-2026-000040' and 'WB-2026-000042'
    and event.event_type='registration_capture_snapshotted'
    and event.actor_id=capture.captured_by
),'each recovered Waybill records a source-attributed audit event');

select pg_temp.assert_true((
  select count(*)=3 from public.trip_closure_invoices invoice
  join public.trip_closure_invoice_pdf_copies copy on copy.invoice_id=invoice.id
  join public.trip_closure_invoice_bank_snapshots snapshot
    on snapshot.id=copy.bank_snapshot_id and snapshot.invoice_id=invoice.id
  where invoice.invoice_number between 'WB-2026-000040' and 'WB-2026-000042'
    and copy.copy_kind='company' and copy.copy_version=1 and copy.status='pending'
    and copy.storage_bucket='waybill-company-copies'
),'migration releases only the existing Company PDF version into the pending queue');

select pg_temp.assert_true((
  select count(*)=3 from public.trip_closure_invoices invoice
  join public.trip_closure_invoice_pdf_copies copy on copy.invoice_id=invoice.id
  where invoice.invoice_number between 'WB-2026-000040' and 'WB-2026-000042'
    and copy.copy_kind='driver' and copy.copy_version=1 and copy.status='pending'
    and copy.bank_snapshot_id is null and copy.storage_bucket='waybill-driver-copies'
),'Driver PDF jobs remain independent and contain no bank snapshot');

select pg_temp.assert_true((
  select count(*)=6 from public.trip_closure_invoices invoice
  join public.trip_closure_invoice_pdf_copies copy on copy.invoice_id=invoice.id
  where invoice.invoice_number between 'WB-2026-000040' and 'WB-2026-000042'
),'migration creates no duplicate Driver or Company PDF versions');

select pg_temp.assert_true((
  select count(*)=1 from public.trip_closure_invoices invoice
  join public.trip_closure_invoice_pdf_copies copy on copy.invoice_id=invoice.id
  where invoice.invoice_number='WB-2026-000043' and copy.copy_kind='company'
    and copy.copy_version=1 and copy.status='blocked_missing_bank_details'
    and copy.bank_snapshot_id is null
),'a Waybill without captured bank details remains held while targeted histories recover');
select pg_temp.assert_true(not exists (
  select 1 from public.trip_closure_invoice_bank_snapshots snapshot
  join public.trip_closure_invoices invoice on invoice.id=snapshot.invoice_id
  where invoice.invoice_number='WB-2026-000043'
),'missing bank details do not create a fabricated snapshot');

select pg_temp.assert_true((
  select count(*)=9 from (values
    ('private.validate_waybill_bank_snapshot_source()'::regprocedure),
    ('private.snapshot_registration_bank_capture_for_invoice(uuid)'::regprocedure),
    ('private.queue_secure_waybill_pdf_copies()'::regprocedure),
    ('public.submit_waybill_company_bank_details(uuid,text,text,text)'::regprocedure),
    ('public.save_waybill_company_bank_details(uuid,uuid,text,text,text)'::regprocedure),
    ('public.get_waybill_company_bank_submission_for_review(uuid)'::regprocedure),
    ('public.verify_waybill_company_bank_details(uuid,boolean,text)'::regprocedure),
    ('public.get_operations_waybill_copy_management_state(uuid)'::regprocedure),
    ('public.get_operations_missing_bank_waybills()'::regprocedure)
  ) expected(function_oid)
  join pg_proc function_row on function_row.oid=expected.function_oid
  where function_row.prosecdef and function_row.proconfig @> array['search_path=""']::text[]
),'all nine changed privileged SQL functions are SECURITY DEFINER with an empty search_path');

select pg_temp.assert_true(not has_table_privilege('authenticated',
  'private.waybill_company_bank_save_receipts','SELECT')
  and not has_table_privilege('service_role','private.waybill_company_bank_save_receipts','SELECT')
  and has_function_privilege('authenticated',
    'public.save_waybill_company_bank_details(uuid,uuid,text,text,text)','EXECUTE')
  and not has_function_privilege('anon',
    'public.save_waybill_company_bank_details(uuid,uuid,text,text,text)','EXECUTE')
  and not has_function_privilege('service_role',
    'public.save_waybill_company_bank_details(uuid,uuid,text,text,text)','EXECUTE'),
  'save receipts remain inaccessible and only authenticated callers reach the role-checked OPM RPC');

select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select pg_temp.assert_true((
  select value#>>'{items,0,invoice_number}'='WB-2026-000043'
  from (select public.get_operations_missing_bank_waybills() value) result
),'Operations Manager queue reports only the synthetic Waybill still missing bank data');
select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000004',true);
select pg_temp.expect_sqlstate($q$select public.get_operations_missing_bank_waybills()$q$,'42501');
select pg_temp.expect_sqlstate($q$select * from public.save_waybill_company_bank_details(
  'e7000000-0000-4000-8000-000000000043','e9000000-0000-4000-8000-000000000002',
  'CI Denied Bank','Synthetic recovery driver 43','9300000043')$q$,'42501');
select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000001',true);
select pg_temp.expect_sqlstate($q$select public.get_operations_missing_bank_waybills()$q$,'42501');
reset role;

select pg_temp.expect_sqlstate($q$update public.trip_closure_invoice_bank_snapshots
  set bank_name='Changed synthetic value'
  where invoice_id='e7000000-0000-4000-8000-000000000040'$q$,'23514');
select pg_temp.expect_sqlstate($q$delete from public.trip_closure_invoice_bank_snapshots
  where invoice_id='e7000000-0000-4000-8000-000000000041'$q$,'23514');
select pg_temp.expect_sqlstate($q$update public.trip_closure_invoice_bank_submissions
  set bank_name='Changed synthetic value'
  where invoice_id='e7000000-0000-4000-8000-000000000042'$q$,'23514');
select pg_temp.expect_sqlstate($q$delete from public.trip_closure_invoice_bank_detail_events
  where invoice_id='e7000000-0000-4000-8000-000000000040'$q$,'23514');

rollback;
