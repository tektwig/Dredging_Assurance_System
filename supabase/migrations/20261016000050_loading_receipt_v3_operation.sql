begin;

do $migration$
declare
  v_constraint_definition text;
  v_allowed_operations text[];
begin
  if to_regclass('private.loading_request_receipts') is null then
    raise exception 'Loading request receipts must exist before adding the v3 operation';
  end if;

  select pg_get_constraintdef(constraint_row.oid)
    into v_constraint_definition
  from pg_constraint constraint_row
  where constraint_row.conrelid='private.loading_request_receipts'::regclass
    and constraint_row.conname='loading_request_receipts_operation_check'
    and constraint_row.contype='c';

  if v_constraint_definition is null then
    raise exception 'Expected loading_request_receipts_operation_check was not found';
  end if;

  select array_agg(match[1] order by match[1])
    into v_allowed_operations
  from regexp_matches(v_constraint_definition, '''([^'']+)''', 'g') as match;

  if v_allowed_operations is distinct from array[
    'create_loading_trip_v2',
    'register_loading_participant'
  ]::text[] then
    raise exception 'Unexpected loading receipt operation constraint; expected the original two-operation DEVELOPMENT baseline, found %',
      v_constraint_definition;
  end if;

  if exists (
    select 1
    from private.loading_request_receipts receipt
    where receipt.operation not in ('register_loading_participant','create_loading_trip_v2')
  ) then
    raise exception 'Unexpected historical loading receipt operation; refusing constraint replacement';
  end if;
end;
$migration$;

alter table private.loading_request_receipts
  drop constraint loading_request_receipts_operation_check;

alter table private.loading_request_receipts
  add constraint loading_request_receipts_operation_check
  check (operation in (
    'register_loading_participant',
    'create_loading_trip_v2',
    'register_loading_participant_payment_free_v3'
  ));

commit;
