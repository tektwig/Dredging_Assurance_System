begin;

insert into private.loading_request_receipts(actor_id,operation,request_id,response,created_at)
values (
  'f1000000-0000-4000-8000-000000000002',
  'register_loading_participant',
  'f4000000-0000-4000-8000-000000000099',
  '{"ok":true,"synthetic_historical_receipt":true}'::jsonb,
  '2026-10-01 12:00:00+00'::timestamptz
);

do $$
begin
  if not exists (
    select 1 from private.loading_request_receipts
    where actor_id='f1000000-0000-4000-8000-000000000002'
      and operation='register_loading_participant'
      and request_id='f4000000-0000-4000-8000-000000000099'
      and response='{"ok":true,"synthetic_historical_receipt":true}'::jsonb
      and created_at='2026-10-01 12:00:00+00'::timestamptz
  ) then
    raise exception 'Synthetic historical registration receipt was not seeded';
  end if;
  if not exists (
    select 1 from private.loading_request_receipts
    where operation='create_loading_trip_v2'
  ) then
    raise exception 'Synthetic historical trip-opening receipts were not seeded';
  end if;
end;
$$;

commit;
