begin;

-- Offloading officers close the trip and must be able to review or download
-- the immutable receipt they just generated. Keep the same row-level scope for
-- every operational role that can legitimately inspect a closed movement.
drop policy if exists trip_closure_invoice_read on public.trip_closure_invoices;
create policy trip_closure_invoice_read on public.trip_closure_invoices
for select to authenticated using (
  private.has_role(array[
    'system_administrator',
    'loading_officer',
    'offloading_officer',
    'operations_manager',
    'finance_officer',
    'audit_reviewer'
  ]::public.app_role[])
);

commit;
