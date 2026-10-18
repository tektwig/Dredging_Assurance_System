begin;

-- Loading registration accepts truck_type values up to 200 characters. The
-- legacy varchar(100) declaration silently rejected part of that contract.
-- The other legacy varchar columns remain unchanged.
do $migration$
declare
  v_type text;
  v_constraint text;
begin
  select format_type(a.atttypid, a.atttypmod)
    into v_type
  from pg_attribute a
  where a.attrelid = 'public.trucks'::regclass
    and a.attname = 'truck_type'
    and not a.attisdropped;

  if v_type is null then
    raise exception 'public.trucks.truck_type is missing';
  end if;

  if v_type = 'text' then
    return;
  end if;

  if v_type <> 'character varying(100)' then
    raise exception 'Unexpected public.trucks.truck_type type: %', v_type;
  end if;

  select c.conname
    into v_constraint
  from pg_constraint c
  join pg_attribute a
    on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
  where c.conrelid = 'public.trucks'::regclass
    and c.contype = 'c'
    and a.attname = 'truck_type'
  limit 1;

  if v_constraint is not null then
    raise exception 'Review truck_type check constraint % before widening the column', v_constraint;
  end if;
end;
$migration$;

alter table public.trucks
  alter column truck_type type text;

comment on column public.trucks.truck_type is
  'Truck classification. Uses text to match the loading registration contract (up to 200 characters).';

commit;
