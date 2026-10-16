begin;

-- Historical Finance Officer role identities are retained, but do not grant
-- access to current Waybill PDFs or document queue rows through this product.
drop policy if exists trip_closure_invoice_documents_read
  on public.trip_closure_invoice_documents;
create policy trip_closure_invoice_documents_read
  on public.trip_closure_invoice_documents for select to authenticated using (
    private.has_role(array['system_administrator','operations_manager','audit_reviewer']::public.app_role[])
  );

drop policy if exists waybill_pdf_authenticated_read on storage.objects;
create policy waybill_pdf_authenticated_read on storage.objects for select to authenticated
using (bucket_id='waybills' and private.has_role(array[
  'system_administrator','operations_manager','audit_reviewer'
]::public.app_role[]));

drop policy if exists waybill_pdf_authenticated_read_fence on storage.objects;
create policy waybill_pdf_authenticated_read_fence on storage.objects as restrictive
for select to authenticated using (bucket_id<>'waybills' or private.has_role(array[
  'system_administrator','operations_manager','audit_reviewer'
]::public.app_role[]));

commit;
