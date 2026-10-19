begin;
create function pg_temp.assert_true(p_value boolean,p_message text) returns void language plpgsql as $$
begin
  if p_value is distinct from true then raise exception 'Concurrent bank-save assertion failed: %',p_message; end if;
  raise notice 'ASSERTION PASS: %',p_message;
end;
$$;

select pg_temp.assert_true((
  select count(*)=1 from public.trip_closure_invoice_bank_snapshots
  where invoice_id='e7000000-0000-4000-8000-000000000043' and version=1
),'concurrent same-request calls create one immutable bank snapshot');
select pg_temp.assert_true((
  select count(*)=1 from private.waybill_company_bank_save_receipts
  where invoice_id='e7000000-0000-4000-8000-000000000043'
    and actor_id='e0000000-0000-4000-8000-000000000003'
    and request_id='e9000000-0000-4000-8000-000000000001'
),'concurrent same-request calls persist one idempotency receipt');
select pg_temp.assert_true((
  select count(*)=1 from public.trip_closure_invoice_bank_detail_events event
  join public.trip_closure_invoice_bank_submissions submission on submission.id=event.submission_id
  where submission.invoice_id='e7000000-0000-4000-8000-000000000043'
    and event.event_type='bank_details_saved'
),'concurrent same-request calls persist one initial audit event');
select pg_temp.assert_true((
  select count(*)=1 from public.trip_closure_invoice_pdf_copies
  where invoice_id='e7000000-0000-4000-8000-000000000043' and copy_kind='company'
    and copy_version=1 and status='pending'
),'concurrent same-request calls release one Company PDF version');
select pg_temp.assert_true((
  select count(*)=1 from public.trip_closure_invoice_pdf_copies
  where invoice_id='e7000000-0000-4000-8000-000000000043' and copy_kind='driver'
    and copy_version=1 and status='pending' and bank_snapshot_id is null
),'concurrent bank saving leaves the Driver PDF unchanged and bank-free');
rollback;
