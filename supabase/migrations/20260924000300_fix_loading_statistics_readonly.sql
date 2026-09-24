begin;
-- Read-only Loading assignment resolver.
--
-- get_loading_statistics() is STABLE and therefore must not invoke
-- SELECT ... FOR SHARE through private.loading_assignment().
--
-- Write workflows continue using private.loading_assignment(), which
-- retains its locking semantics.

create or replace function private.loading_assignment_readonly()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.user_site_assignments%rowtype;
  s public.sites%rowtype;
begin
  select *
  into a
  from public.user_site_assignments
  where profile_id = auth.uid()
    and ended_at is null;

  if not found then
    return private.loading_failure('SITE_ASSIGNMENT_REQUIRED');
  end if;

  select *
  into s
  from public.sites
  where id = a.site_id;

  if not found or s.site_type <> 'loading' then
    return private.loading_failure('INVALID_SITE_ASSIGNMENT');
  end if;

  if not s.is_active then
    return private.loading_failure('INACTIVE_SITE');
  end if;

  return jsonb_build_object(
    'ok', true,
    'assignment_id', a.id,
    'site_id', s.id,
    'site_name', s.name
  );
end;
$$;
create or replace function public.get_loading_statistics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_assignment jsonb;
  v_day date;
  v_start timestamptz;
  v_end timestamptz;
  v_opened bigint;
  v_open bigint;
  v_closed bigint;
  v_trucks bigint;
begin
  perform private.require_role(
    array['loading_officer']::public.app_role[]
  );

  -- Statistics are read-only, so use the non-locking assignment resolver.
  v_assignment := private.loading_assignment_readonly();

  if not (v_assignment->>'ok')::boolean then
    return v_assignment;
  end if;

  v_day := (
    statement_timestamp() at time zone 'Africa/Lagos'
  )::date;

  v_start :=
    v_day::timestamp at time zone 'Africa/Lagos';

  v_end :=
    (v_day + 1)::timestamp at time zone 'Africa/Lagos';

  select
    count(*) filter (
      where t.opened_at >= v_start
        and t.opened_at < v_end
    ),
    count(*) filter (
      where t.status = 'open'
    ),
    count(*) filter (
      where t.status = 'closed'
        and t.closed_at >= v_start
        and t.closed_at < v_end
    ),
    count(distinct t.truck_id) filter (
      where t.opened_at >= v_start
        and t.opened_at < v_end
    )
  into
    v_opened,
    v_open,
    v_closed,
    v_trucks
  from public.trips t
  where t.opened_by = auth.uid();

  return jsonb_build_object(
    'ok', true,
    'trips_opened', v_opened,
    'open_trips', v_open,
    'trips_closed', v_closed,
    'trucks_processed', v_trucks
  );
end;
$$;
-- Keep helper private.
revoke all on function private.loading_assignment_readonly() from public;
revoke all on function private.loading_assignment_readonly() from anon;
revoke all on function private.loading_assignment_readonly() from authenticated;
-- Preserve the existing public RPC execution boundary.
revoke all on function public.get_loading_statistics() from public;
revoke all on function public.get_loading_statistics() from anon;
grant execute on function public.get_loading_statistics() to authenticated;
commit;
