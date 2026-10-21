create function public.ci_hold_synthetic_email_canary_claim() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status='processing'
    and new.event_type='waybill_ready'
    and new.payload->>'invoice_number'='WB-9999-999999'
    and current_setting('application_name',true) like 'sedc-canary-%' then
    perform pg_catalog.pg_sleep(12);
  end if;
  return new;
end;
$$;

create trigger zz_ci_synthetic_email_canary_overlap
before update on public.notification_outbox
for each row execute function public.ci_hold_synthetic_email_canary_claim();
