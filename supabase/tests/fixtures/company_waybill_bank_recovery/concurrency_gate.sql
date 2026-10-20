create or replace function private.ci_company_bank_receipt_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.invoice_id='e7000000-0000-4000-8000-000000000043'::uuid
    and new.request_id='e9000000-0000-4000-8000-000000000001'::uuid then
    perform pg_catalog.pg_sleep(12);
  end if;
  return new;
end;
$$;

revoke all on function private.ci_company_bank_receipt_gate() from public, anon, authenticated, service_role;
create trigger zz_ci_company_bank_receipt_gate
before insert on private.waybill_company_bank_save_receipts
for each row execute function private.ci_company_bank_receipt_gate();
