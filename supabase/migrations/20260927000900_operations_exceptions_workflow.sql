begin;

alter table public.exceptions
  add column review_started_at timestamptz,
  add column review_started_by uuid references public.profiles(id) on delete restrict;

do $$ declare v_constraint text; begin
  select conname into v_constraint from pg_constraint
  where conrelid='public.exceptions'::regclass and contype='c'
    and pg_get_constraintdef(oid) like '%resolution_reason%'
    and pg_get_constraintdef(oid) like '%resolved_at%';
  if v_constraint is null then raise exception 'Exception lifecycle constraint not found'; end if;
  execute format('alter table public.exceptions drop constraint %I',v_constraint);
end $$;

alter table public.exceptions add constraint exceptions_lifecycle_check check (
  (review_started_at is null) = (review_started_by is null)
  and (
    (status='open' and review_started_at is null and resolved_at is null
      and resolved_by is null and resolution_reason is null)
    or (status='in_review' and review_started_at is not null and resolved_at is null
      and resolved_by is null and resolution_reason is null)
    or (status='resolved' and resolved_at is not null and resolved_by is not null
      and resolution_reason is not null and length(btrim(resolution_reason))>0)
  )
);

create or replace function private.exception_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'Exceptions cannot be deleted' using errcode='23514'; end if;
  if new.truck_id is not null then perform 1 from public.trucks where id=new.truck_id for update; end if;
  if new.trip_id is not null and not exists
    (select 1 from public.trips where id=new.trip_id and truck_id=new.truck_id) then
    raise exception 'Exception truck/trip mismatch' using errcode='23514';
  end if;
  if tg_op='INSERT' then
    new.reported_by:=auth.uid();
    if new.status<>'open' or new.review_started_at is not null or new.review_started_by is not null
      or new.resolved_at is not null or new.resolved_by is not null or new.resolution_reason is not null then
      raise exception 'Exceptions must start open' using errcode='23514';
    end if;
  elsif old.status='open' and new.status='in_review' then
    if (to_jsonb(new)-array['status','review_started_at','review_started_by','updated_at']) is distinct from
      (to_jsonb(old)-array['status','review_started_at','review_started_by','updated_at']) then
      raise exception 'Only explicit exception review is permitted' using errcode='23514';
    end if;
    new.review_started_at:=clock_timestamp(); new.review_started_by:=auth.uid();
  elsif old.status='in_review' and new.status='resolved' then
    if (to_jsonb(new)-array['status','resolved_at','resolved_by','resolution_reason','updated_at']) is distinct from
      (to_jsonb(old)-array['status','resolved_at','resolved_by','resolution_reason','updated_at'])
      or new.resolution_reason is null or new.resolution_reason not in
        ('issue_verified_resolved','operational_action_completed','referred_for_correction',
          'duplicate_exception','no_action_required') then
      raise exception 'Approved resolution code required' using errcode='23514';
    end if;
    new.resolved_at:=clock_timestamp(); new.resolved_by:=auth.uid();
  else
    raise exception 'Invalid exception transition' using errcode='23514';
  end if;
  return new;
end;
$$;

create or replace function private.loading_truck_block(p_truck uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_number text;
begin
  select id,trip_number into v_id,v_number from public.trips where truck_id=p_truck and status='open';
  if found then return private.loading_failure('OPEN_TRIP_EXISTS',jsonb_build_object('trip_id',v_id,'trip_number',v_number)); end if;
  select id into v_id from public.exceptions where truck_id=p_truck and status<>'resolved'
    and blocks_operations order by created_at,id limit 1;
  if found then return private.loading_failure('BLOCKING_EXCEPTION',jsonb_build_object('exception_id',v_id)); end if;
  return null;
end;
$$;

create function public.get_operations_exceptions(p_page integer default 1,p_page_size integer default 25,
  p_search text default null,p_status public.exception_status default null,p_type public.exception_type default null,
  p_date_from date default null,p_date_to date default null,p_trip_id uuid default null,p_truck_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_search text:=nullif(btrim(p_search),''); v_plate text; v_from timestamptz; v_until timestamptz;
  v_offset bigint; v_total bigint; v_items jsonb;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_page is null or p_page<1 or p_page_size is null or p_page_size not between 1 and 100
    or length(v_search)>200 or (p_date_from is not null and not isfinite(p_date_from))
    or (p_date_to is not null and not isfinite(p_date_to))
    or (p_date_from is not null and p_date_to is not null and p_date_from>p_date_to) then
    raise exception 'Invalid exception filters' using errcode='22023';
  end if;
  v_plate:=nullif(public.normalize_plate(v_search),'');
  if p_date_from is not null then v_from:=p_date_from::timestamp at time zone 'Africa/Lagos'; end if;
  if p_date_to is not null then v_until:=(p_date_to+1)::timestamp at time zone 'Africa/Lagos'; end if;
  v_offset:=(p_page::bigint-1)*p_page_size;
  with filtered as materialized (
    select e.id as exception_id,e.exception_type::text as exception_type,e.status::text as status,
      e.blocks_operations,e.trip_id,t.trip_number,e.truck_id,
      coalesce(t.truck_registration_at_loading,truck.registration_number) as truck_registration,
      t.driver_name_at_loading as driver_name,e.created_at,e.updated_at
    from public.exceptions e left join public.trips t on t.id=e.trip_id
      left join public.trucks truck on truck.id=e.truck_id
    where (p_status is null or e.status=p_status) and (p_type is null or e.exception_type=p_type)
      and (v_from is null or e.created_at>=v_from) and (v_until is null or e.created_at<v_until)
      and (p_trip_id is null or e.trip_id=p_trip_id) and (p_truck_id is null or e.truck_id=p_truck_id)
      and (v_search is null or position(lower(v_search) in lower(e.id::text))>0
        or position(lower(v_search) in lower(coalesce(t.trip_number,'')))>0
        or (v_plate is not null and position(v_plate in public.normalize_plate(coalesce(t.truck_registration_at_loading,truck.registration_number,'')))>0)
        or position(lower(v_search) in lower(coalesce(t.driver_name_at_loading,'')))>0)
  ), page_rows as (select * from filtered order by created_at desc,exception_id desc limit p_page_size offset v_offset)
  select (select count(*) from filtered),
    coalesce((select jsonb_agg(to_jsonb(page_rows) order by created_at desc,exception_id desc) from page_rows),'[]'::jsonb)
    into v_total,v_items;
  return jsonb_build_object('items',v_items,'page',p_page,'page_size',p_page_size,
    'total_count',v_total,'has_next',v_offset+jsonb_array_length(v_items)<v_total);
end;
$$;

create function public.get_operations_exception_detail(p_exception_id uuid,p_history_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_history_limit is null or p_history_limit not between 1 and 50 then
    raise exception 'Invalid history limit' using errcode='22023'; end if;
  select jsonb_build_object(
    'exception_id',e.id,'exception_type',e.exception_type::text,'status',e.status::text,
    'blocks_operations',e.blocks_operations,'trip_id',e.trip_id,'trip_number',t.trip_number,
    'truck_id',e.truck_id,'truck_registration',coalesce(t.truck_registration_at_loading,truck.registration_number),
    'driver_name',t.driver_name_at_loading,'loading_site_name',loading_site.name,
    'offloading_site_name',offloading_site.name,'created_at',e.created_at,'updated_at',e.updated_at,
    'review_started_at',e.review_started_at,'resolved_at',e.resolved_at,
    'resolution_code',case when e.resolution_reason in
      ('issue_verified_resolved','operational_action_completed','referred_for_correction',
        'duplicate_exception','no_action_required') then e.resolution_reason else null end,
    'reporter',jsonb_build_object('officer_id',e.reported_by,'display_name',nullif(btrim(reporter.display_name),'')),
    'reviewer',case when e.review_started_by is null then null else jsonb_build_object(
      'officer_id',e.review_started_by,'display_name',nullif(btrim(reviewer.display_name),'')) end,
    'resolver',case when e.resolved_by is null then null else jsonb_build_object(
      'officer_id',e.resolved_by,'display_name',nullif(btrim(resolver.display_name),'')) end,
    'history',coalesce(history.items,'[]'::jsonb)) into v_result
  from public.exceptions e left join public.trips t on t.id=e.trip_id
    left join public.trucks truck on truck.id=e.truck_id
    left join public.sites loading_site on loading_site.id=t.loading_site_id
    left join public.sites offloading_site on offloading_site.id=t.offloading_site_id
    left join public.profiles reporter on reporter.id=e.reported_by
    left join public.profiles reviewer on reviewer.id=e.review_started_by
    left join public.profiles resolver on resolver.id=e.resolved_by
    left join lateral (
      select jsonb_agg(jsonb_build_object('occurred_at',entry.created_at,
        'from_status',entry.old_value->>'status','to_status',entry.new_value->>'status',
        'actor',case when entry.actor_id is null then null else jsonb_build_object(
          'officer_id',entry.actor_id,'display_name',nullif(btrim(actor.display_name),'')) end)
        order by entry.created_at desc,entry.id desc) as items
      from (select id,created_at,old_value,new_value,actor_id from public.audit_log
        where entity_name='exceptions' and entity_id=e.id and action in ('INSERT','UPDATE')
        order by created_at desc,id desc limit p_history_limit) entry
      left join public.profiles actor on actor.id=entry.actor_id
    ) history on true where e.id=p_exception_id;
  return v_result;
end;
$$;

create function public.start_operations_exception_review(p_exception_id uuid,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_truck uuid; v_exception public.exceptions%rowtype;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_exception_id is null or p_expected_updated_at is null then
    raise exception 'Exception and version required' using errcode='22023'; end if;
  select truck_id into v_truck from public.exceptions where id=p_exception_id;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;
  if v_truck is not null then perform 1 from public.trucks where id=v_truck for update; end if;
  select * into v_exception from public.exceptions where id=p_exception_id for update;
  if v_exception.updated_at<>p_expected_updated_at then
    return jsonb_build_object('ok',false,'code','STALE_EXCEPTION'); end if;
  if v_exception.status<>'open' then
    return jsonb_build_object('ok',false,'code','INVALID_TRANSITION'); end if;
  update public.exceptions set status='in_review' where id=p_exception_id returning * into v_exception;
  return jsonb_build_object('ok',true,'status',v_exception.status::text,'updated_at',v_exception.updated_at);
end;
$$;

create function public.resolve_operations_exception(p_exception_id uuid,p_expected_updated_at timestamptz,
  p_resolution_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_truck uuid; v_exception public.exceptions%rowtype;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);
  if p_exception_id is null or p_expected_updated_at is null or p_resolution_code is null
    or p_resolution_code not in ('issue_verified_resolved','operational_action_completed',
      'referred_for_correction','duplicate_exception','no_action_required') then
    raise exception 'Approved resolution code required' using errcode='22023'; end if;
  select truck_id into v_truck from public.exceptions where id=p_exception_id;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;
  if v_truck is not null then perform 1 from public.trucks where id=v_truck for update; end if;
  select * into v_exception from public.exceptions where id=p_exception_id for update;
  if v_exception.updated_at<>p_expected_updated_at then
    return jsonb_build_object('ok',false,'code','STALE_EXCEPTION'); end if;
  if v_exception.status<>'in_review' then
    return jsonb_build_object('ok',false,'code','INVALID_TRANSITION'); end if;
  update public.exceptions set status='resolved',resolution_reason=p_resolution_code
    where id=p_exception_id returning * into v_exception;
  return jsonb_build_object('ok',true,'status',v_exception.status::text,'updated_at',v_exception.updated_at);
end;
$$;

create or replace function public.resolve_trip_exception(p_exception_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_role(array['system_administrator']::public.app_role[]);
  raise exception 'Versioned exception resolution required' using errcode='22023';
end;
$$;

create function public.resolve_trip_exception(p_exception_id uuid,p_reason text,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_truck uuid; v_exception public.exceptions%rowtype;
begin
  perform private.require_role(array['system_administrator']::public.app_role[]);
  if p_reason is null or p_reason not in ('issue_verified_resolved','operational_action_completed',
    'referred_for_correction','duplicate_exception','no_action_required') or p_expected_updated_at is null then
    raise exception 'Approved resolution code required' using errcode='22023'; end if;
  select truck_id into v_truck from public.exceptions where id=p_exception_id;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;
  if v_truck is not null then perform 1 from public.trucks where id=v_truck for update; end if;
  select * into v_exception from public.exceptions where id=p_exception_id for update;
  if v_exception.updated_at<>p_expected_updated_at then
    return jsonb_build_object('ok',false,'code','STALE_EXCEPTION'); end if;
  if v_exception.status<>'in_review' then
    return jsonb_build_object('ok',false,'code','INVALID_TRANSITION'); end if;
  update public.exceptions set status='resolved',resolution_reason=p_reason
    where id=p_exception_id returning * into v_exception;
  return jsonb_build_object('ok',true,'status',v_exception.status::text,'updated_at',v_exception.updated_at);
end;
$$;

revoke all on function public.get_operations_exceptions(integer,integer,text,public.exception_status,public.exception_type,date,date,uuid,uuid),
  public.get_operations_exception_detail(uuid,integer),
  public.start_operations_exception_review(uuid,timestamptz),
  public.resolve_operations_exception(uuid,timestamptz,text)
  from public,anon,authenticated,service_role;
grant execute on function public.get_operations_exceptions(integer,integer,text,public.exception_status,public.exception_type,date,date,uuid,uuid),
  public.get_operations_exception_detail(uuid,integer),
  public.start_operations_exception_review(uuid,timestamptz),
  public.resolve_operations_exception(uuid,timestamptz,text) to authenticated;
revoke all on function public.resolve_trip_exception(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.resolve_trip_exception(uuid,text) to authenticated;
revoke all on function public.resolve_trip_exception(uuid,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.resolve_trip_exception(uuid,text,timestamptz) to authenticated;

commit;
