-- Synthetic test-only setup. Run after the historical hybrid seed and payment-free
-- cutover migrations, immediately before 20261013000200 is applied.
insert into storage.objects(bucket_id,name,owner_id,metadata)
select 'waybills',legacy.storage_path,'f1000000-0000-4000-8000-000000000003',
  jsonb_build_object('mimetype','application/pdf','size',256)
from (
  select distinct document.storage_path
from public.trip_closure_invoice_documents document
join public.trip_closure_invoices invoice on invoice.id=document.invoice_id
join public.trucks truck on truck.id=invoice.truck_id
where truck.normalized_registration in (public.normalize_plate('HYB-101'),public.normalize_plate('HYB-102'))
    and document.storage_path is not null
) legacy
where not exists (
  select 1
  from storage.objects existing
  where existing.bucket_id='waybills'
    and existing.name=legacy.storage_path
    and existing.archived_at is null
);
