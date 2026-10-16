-- Loading Portal read scope. Forward-only follow-up to Loading Alignment 2B.
begin;
-- Preserve the original broad operational read contract for other roles while
-- enforcing an officer's own history at the database boundary. An officer who
-- moves sites still retains their own historical trips for reporting.
drop policy operational_read on public.trips;
create policy trips_read_loading_own on public.trips for select to authenticated using (
  private.has_role(array['loading_officer']::public.app_role[])
  and opened_by=auth.uid()
);
create policy trips_read_other_operational_roles on public.trips for select to authenticated using (
  private.has_role(array['system_administrator','offloading_officer','operations_manager',
    'finance_officer','audit_reviewer']::public.app_role[])
);
-- Assignment RLS already limits Loading Officers to their own assignments.
-- This policy cannot recurse: assignment_read references profile/role, not sites.
drop policy operational_read on public.sites;
create policy sites_read_loading_current on public.sites for select to authenticated using (
  private.has_role(array['loading_officer']::public.app_role[])
  and is_active
  and exists (select 1 from public.user_site_assignments a
    where a.profile_id=auth.uid() and a.site_id=sites.id and a.ended_at is null)
);
create policy sites_read_other_operational_roles on public.sites for select to authenticated using (
  private.has_role(array['system_administrator','offloading_officer','operations_manager',
    'finance_officer','audit_reviewer']::public.app_role[])
);
create function public.get_loading_statistics() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_assignment jsonb; v_day date; v_start timestamptz; v_end timestamptz;
  v_opened bigint; v_open bigint; v_closed bigint; v_trucks bigint;
begin
  perform private.require_role(array['loading_officer']::public.app_role[]);
  v_assignment:=private.loading_assignment();
  if not (v_assignment->>'ok')::boolean then return v_assignment; end if;

  v_day:=(statement_timestamp() at time zone 'Africa/Lagos')::date;
  v_start:=v_day::timestamp at time zone 'Africa/Lagos';
  v_end:=(v_day+1)::timestamp at time zone 'Africa/Lagos';
  select count(*) filter(where t.opened_at>=v_start and t.opened_at<v_end),
    count(*) filter(where t.status='open'),
    count(*) filter(where t.status='closed' and t.closed_at>=v_start and t.closed_at<v_end),
    count(distinct t.truck_id) filter(where t.opened_at>=v_start and t.opened_at<v_end)
  into v_opened,v_open,v_closed,v_trucks
  from public.trips t where t.opened_by=auth.uid();

  return jsonb_build_object('ok',true,'trips_opened',v_opened,'open_trips',v_open,
    'trips_closed',v_closed,'trucks_processed',v_trucks);
end;
$$;
revoke all on function public.get_loading_statistics() from public,anon,authenticated,service_role;
grant execute on function public.get_loading_statistics() to authenticated;
commit;
