begin;

-- Realtime lets an offloading terminal see a newly opened trip (and every
-- other signed-in terminal see its closure) without refreshing the page.
alter table public.trips replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trips'
  ) then
    alter publication supabase_realtime add table public.trips;
  end if;
end;
$$;

commit;
