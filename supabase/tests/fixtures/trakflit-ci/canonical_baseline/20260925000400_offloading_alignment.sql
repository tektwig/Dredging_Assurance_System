-- Offloading V2: actor-derived site, narrow lookup/closure, immutable evidence.
begin;

create table private.offloading_request_receipts (
  actor_id uuid not null references public.profiles(id) on delete restrict,
  request_id uuid not null,
  response jsonb not null check (response->>'ok'='true'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (actor_id,request_id)
);
alter table private.offloading_request_receipts enable row level security;
revoke all on private.offloading_request_receipts from public,anon,authenticated,service_role;
create trigger offloading_receipt_immutable before update or delete on private.offloading_request_receipts
for each row execute function private.reject_mutation();

create table public.trip_offloading_evidence (
  trip_id uuid primary key references public.trips(id) on delete restrict,
  assignment_id uuid not null,
  offloading_site_id uuid not null,
  confirmed_plate text not null check (length(confirmed_plate) between 1 and 64),
  normalized_confirmed_plate text generated always as (public.normalize_plate(confirmed_plate)) stored,
  ocr_detected_plate text check (length(ocr_detected_plate) between 1 and 64),
  ocr_confidence numeric check (ocr_confidence between 0 and 1),
  capture_method text not null check (capture_method in ('MANUAL','OCR','OCR_CORRECTED')),
  image_path text unique,
  captured_at timestamptz not null check (isfinite(captured_at)),
  recorded_at timestamptz not null default clock_timestamp(),
  captured_by uuid not null references public.profiles(id) on delete restrict,
  foreign key (assignment_id,offloading_site_id,captured_by)
    references public.user_site_assignments(id,site_id,profile_id) on delete restrict,
  check (normalized_confirmed_plate ~ '^[A-Z0-9]{1,32}$'),
  check (ocr_detected_plate is null or public.normalize_plate(ocr_detected_plate) ~ '^[A-Z0-9]{1,32}$'),
  check ((capture_method='MANUAL' and ocr_detected_plate is null and ocr_confidence is null)
    or (capture_method in ('OCR','OCR_CORRECTED') and ocr_detected_plate is not null and image_path is not null
      and ((capture_method='OCR' and public.normalize_plate(ocr_detected_plate)=normalized_confirmed_plate)
        or (capture_method='OCR_CORRECTED' and public.normalize_plate(ocr_detected_plate)<>normalized_confirmed_plate))))
);
create index offloading_evidence_actor_idx on public.trip_offloading_evidence(captured_by);
create trigger offloading_evidence_immutable before update or delete on public.trip_offloading_evidence
for each row execute function private.reject_mutation();
create trigger audit_changes after insert or update or delete on public.trip_offloading_evidence
for each row execute function private.capture_audit();
alter table public.trip_offloading_evidence enable row level security;
revoke all on public.trip_offloading_evidence from public,anon,authenticated,service_role;
grant select on public.trip_offloading_evidence to authenticated;
create policy offloading_evidence_read on public.trip_offloading_evidence for select to authenticated using (
  (captured_by=auth.uid() and private.has_role(array['offloading_officer']::public.app_role[]))
  or private.has_role(array['system_administrator','operations_manager','audit_reviewer']::public.app_role[]));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('offloading-plate-evidence','offloading-plate-evidence',false,5242880,array['image/jpeg','image/png'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create function private.offloading_failure(p_code text,p_details jsonb default '{}'::jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('ok',false,'code',p_code,'details',p_details);
$$;
create function private.lock_offloading_actor() returns void
language plpgsql security definer set search_path = '' as $$
declare p public.profiles%rowtype;
begin
  select * into p from public.profiles where id=auth.uid() for no key update;
  if not found or not p.is_active or p.role<>'offloading_officer' then
    raise exception 'Not authorized' using errcode='42501';
  end if;
end;
$$;
create function private.offloading_assignment(p_expected uuid default null,p_check_expected boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.user_site_assignments%rowtype; s public.sites%rowtype;
begin
  if p_check_expected and p_expected is null then return private.offloading_failure('SITE_REVIEW_REQUIRED'); end if;
  select * into a from public.user_site_assignments where profile_id=auth.uid() and ended_at is null for share;
  if not found then return private.offloading_failure('SITE_ASSIGNMENT_REQUIRED'); end if;
  select * into s from public.sites where id=a.site_id for share;
  if not found or s.site_type<>'offloading' then return private.offloading_failure('INVALID_SITE_ASSIGNMENT'); end if;
  if not s.is_active then return private.offloading_failure('INACTIVE_SITE'); end if;
  if p_check_expected and a.id<>p_expected then return private.offloading_failure('SITE_ASSIGNMENT_CHANGED'); end if;
  return jsonb_build_object('ok',true,'assignment_id',a.id,'site_id',s.id,'site_name',s.name);
end;
$$;
create function private.offloading_assignment_readonly() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a public.user_site_assignments%rowtype; s public.sites%rowtype;
begin
  select * into a from public.user_site_assignments where profile_id=auth.uid() and ended_at is null;
  if not found then return private.offloading_failure('SITE_ASSIGNMENT_REQUIRED'); end if;
  select * into s from public.sites where id=a.site_id;
  if not found or s.site_type<>'offloading' then return private.offloading_failure('INVALID_SITE_ASSIGNMENT'); end if;
  if not s.is_active then return private.offloading_failure('INACTIVE_SITE'); end if;
  return jsonb_build_object('ok',true,'assignment_id',a.id,'site_id',s.id,'site_name',s.name);
end;
$$;
create function private.offloading_image_error(p_path text) returns text
language plpgsql security definer set search_path = '' as $$
declare o storage.objects%rowtype;
begin
  if p_path is null then return null; end if;
  if p_path !~ ('^'||auth.uid()::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$') then
    return 'INVALID_IMAGE_REFERENCE';
  end if;
  select * into o from storage.objects where bucket_id='offloading-plate-evidence' and name=p_path for share;
  if not found then return 'IMAGE_NOT_FOUND'; end if;
  if o.owner_id is distinct from auth.uid()::text
    or coalesce(o.metadata->>'mimetype','') not in ('image/jpeg','image/png')
    or coalesce(o.metadata->>'size','') !~ '^[0-9]{1,10}$' then return 'INVALID_IMAGE_REFERENCE'; end if;
  if (o.metadata->>'size')::bigint not between 1 and 5242880
    or (right(p_path,4)='.jpg' and o.metadata->>'mimetype'<>'image/jpeg')
    or (right(p_path,4)='.png' and o.metadata->>'mimetype'<>'image/png') then return 'INVALID_IMAGE_REFERENCE'; end if;
  if exists(select 1 from public.trip_offloading_evidence where image_path=p_path) then return 'IMAGE_ALREADY_USED'; end if;
  return null;
end;
$$;
create function private.can_upload_offloading_image(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role(array['offloading_officer']::public.app_role[])
    and p_name ~ ('^'||auth.uid()::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$')
    and exists(select 1 from public.user_site_assignments a join public.sites s on s.id=a.site_id
      where a.profile_id=auth.uid() and a.ended_at is null and s.site_type='offloading' and s.is_active);
$$;
create function private.offloading_evidence_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_plate text; v_actor uuid; v_site uuid; v_error text;
begin
  select t.normalized_registration,r.closed_by,r.offloading_site_id into v_plate,v_actor,v_site
  from public.trips r join public.trucks t on t.id=r.truck_id where r.id=new.trip_id and r.status='closed';
  if not found or v_actor is distinct from auth.uid() or v_site is distinct from new.offloading_site_id
    or public.normalize_plate(new.confirmed_plate) is distinct from v_plate then
    raise exception 'Offloading evidence trip/plate/actor mismatch' using errcode='23514';
  end if;
  if not exists(select 1 from public.user_site_assignments a where a.id=new.assignment_id
    and a.profile_id=auth.uid() and a.site_id=new.offloading_site_id and a.ended_at is null) then
    raise exception 'Current offloading assignment required' using errcode='23514';
  end if;
  if new.captured_at>clock_timestamp()+interval '5 minutes' then
    raise exception 'Invalid capture timestamp' using errcode='23514';
  end if;
  v_error:=private.offloading_image_error(new.image_path);
  if v_error is not null then raise exception 'Invalid offloading image' using errcode='23514'; end if;
  new.captured_by:=auth.uid(); new.recorded_at:=clock_timestamp();
  return new;
end;
$$;
create trigger offloading_evidence_guard before insert on public.trip_offloading_evidence
for each row execute function private.offloading_evidence_guard();

create policy offloading_image_upload on storage.objects for insert to authenticated
with check(bucket_id='offloading-plate-evidence' and owner_id=auth.uid()::text and private.can_upload_offloading_image(name));
create policy offloading_image_read on storage.objects for select to authenticated using (
  bucket_id='offloading-plate-evidence' and (
    (owner_id=auth.uid()::text and private.has_role(array['offloading_officer']::public.app_role[]))
    or private.has_role(array['system_administrator','operations_manager','audit_reviewer']::public.app_role[])));
create policy offloading_image_insert_fence on storage.objects as restrictive for insert to authenticated
with check(bucket_id<>'offloading-plate-evidence' or (owner_id=auth.uid()::text and private.can_upload_offloading_image(name)));
create policy offloading_image_select_fence on storage.objects as restrictive for select to authenticated using (
  bucket_id<>'offloading-plate-evidence' or ((owner_id=auth.uid()::text and private.has_role(array['offloading_officer']::public.app_role[]))
    or private.has_role(array['system_administrator','operations_manager','audit_reviewer']::public.app_role[])));
create policy offloading_image_update_fence on storage.objects as restrictive for update to authenticated
using(bucket_id<>'offloading-plate-evidence') with check(bucket_id<>'offloading-plate-evidence');
create policy offloading_image_delete_fence on storage.objects as restrictive for delete to authenticated
using(bucket_id<>'offloading-plate-evidence');
create policy offloading_image_anon_fence on storage.objects as restrictive for all to anon
using(bucket_id<>'offloading-plate-evidence') with check(bucket_id<>'offloading-plate-evidence');

-- Legacy closure remains available to administrators for existing operational
-- procedures, but cannot be called by an Offloading Officer as a V2 bypass.
create or replace function public.close_trip(p_trip_id uuid,p_offloading_site_id uuid,p_quantity_tonnes numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_trip public.trips%rowtype; v_truck uuid;
begin
  perform private.require_role(array['system_administrator']::public.app_role[]);
  select truck_id into v_truck from public.trips where id=p_trip_id;
  if not found then return jsonb_build_object('ok',false,'code','TRIP_NOT_FOUND'); end if;
  perform 1 from public.trucks where id=v_truck for update;
  select * into v_trip from public.trips where id=p_trip_id for update;
  if v_trip.status<>'open' then return jsonb_build_object('ok',false,'code','TRIP_NOT_OPEN'); end if;
  if p_quantity_tonnes is null or p_quantity_tonnes::text in ('NaN','Infinity','-Infinity')
    or p_quantity_tonnes<=0 or p_quantity_tonnes>=100000000 or p_quantity_tonnes<>round(p_quantity_tonnes,2) then
    return jsonb_build_object('ok',false,'code','INVALID_QUANTITY');
  end if;
  perform 1 from public.sites where id=p_offloading_site_id and site_type='offloading' and is_active for share;
  if not found then return jsonb_build_object('ok',false,'code','INVALID_OFFLOADING_SITE'); end if;
  perform 1 from public.drivers where id=v_trip.driver_id for share;
  update public.trips set status='closed',offloading_site_id=p_offloading_site_id,quantity_tonnes=p_quantity_tonnes
    where id=p_trip_id returning * into v_trip;
  return jsonb_build_object('ok',true,'trip',to_jsonb(v_trip),'notification_queued',true);
end;
$$;

create function public.lookup_offloading_open_trip(p_plate text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_plate text:=public.normalize_plate(p_plate); a jsonb; v jsonb;
begin
  perform private.require_role(array['offloading_officer']::public.app_role[]);
  if p_plate is null or length(p_plate)>64 or v_plate !~ '^[A-Z0-9]{1,32}$' then
    return private.offloading_failure('INVALID_PLATE');
  end if;
  a:=private.offloading_assignment_readonly();
  if not (a->>'ok')::boolean then return a; end if;
  select jsonb_build_object('id',r.id,'trip_number',r.trip_number,'truck_id',r.truck_id,
    'registration_number',t.registration_number,'normalized_registration',t.normalized_registration,
    'driver_id',r.driver_id,'driver_name',coalesce(r.driver_name_at_loading,d.full_name),
    'opened_at',r.opened_at,'loading_site_name',s.name)
  into v from public.trucks t join public.trips r on r.truck_id=t.id and r.status='open'
    join public.drivers d on d.id=r.driver_id join public.sites s on s.id=r.loading_site_id
    where t.normalized_registration=v_plate;
  if v is null then return private.offloading_failure('NO_OPEN_TRIP'); end if;
  return jsonb_build_object('ok',true,'assignment',a,'trip',v);
end;
$$;

create function public.close_trip_v2(
  p_request_id uuid,p_trip_id uuid,p_plate text,p_expected_assignment_id uuid,
  p_quantity_tonnes numeric,p_capture_method text,p_captured_at timestamptz,
  p_ocr_detected_plate text default null,p_ocr_confidence numeric default null,p_image_path text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_plate text:=public.normalize_plate(p_plate); a jsonb; result jsonb; image_error text;
  v_truck uuid; v_constraint text; t public.trucks%rowtype; r public.trips%rowtype;
begin
  perform private.lock_offloading_actor();
  if p_request_id is null then return private.offloading_failure('INVALID_REQUEST_ID'); end if;
  perform pg_advisory_xact_lock(hashtextextended('offloading-close:'||auth.uid()::text||':'||p_request_id::text,0));
  select response into result from private.offloading_request_receipts
    where actor_id=auth.uid() and request_id=p_request_id;
  if result is not null then return result; end if;
  if p_trip_id is null then return private.offloading_failure('TRIP_REQUIRED'); end if;
  if p_plate is null or length(p_plate)>64 or v_plate !~ '^[A-Z0-9]{1,32}$' then return private.offloading_failure('INVALID_PLATE'); end if;
  if p_quantity_tonnes is null or p_quantity_tonnes::text in ('NaN','Infinity','-Infinity')
    or p_quantity_tonnes<=0 or p_quantity_tonnes>=100000000 or p_quantity_tonnes<>round(p_quantity_tonnes,2) then
    return private.offloading_failure('INVALID_QUANTITY');
  end if;
  if p_capture_method is null or p_capture_method not in ('MANUAL','OCR','OCR_CORRECTED') then
    return private.offloading_failure('INVALID_CAPTURE_METHOD'); end if;
  if p_captured_at is null or not isfinite(p_captured_at) or p_captured_at>clock_timestamp()+interval '5 minutes' then
    return private.offloading_failure('INVALID_CAPTURE_TIMESTAMP'); end if;
  if (p_capture_method='MANUAL' and (p_ocr_detected_plate is not null or p_ocr_confidence is not null))
    or (p_capture_method<>'MANUAL' and (p_ocr_detected_plate is null or length(p_ocr_detected_plate) not between 1 and 64
      or public.normalize_plate(p_ocr_detected_plate) !~ '^[A-Z0-9]{1,32}$' or p_image_path is null))
    or (p_ocr_confidence is not null and (p_ocr_confidence::text in ('NaN','Infinity','-Infinity') or p_ocr_confidence not between 0 and 1))
    or (p_capture_method='OCR' and public.normalize_plate(p_ocr_detected_plate)<>v_plate)
    or (p_capture_method='OCR_CORRECTED' and public.normalize_plate(p_ocr_detected_plate)=v_plate) then
    return private.offloading_failure('INVALID_OCR_DATA'); end if;
  a:=private.offloading_assignment(p_expected_assignment_id,true);
  if not (a->>'ok')::boolean then return a; end if;
  select truck_id into v_truck from public.trips where id=p_trip_id;
  if not found then return private.offloading_failure('TRIP_NOT_FOUND'); end if;
  select * into t from public.trucks where id=v_truck for update;
  select * into r from public.trips where id=p_trip_id for update;
  if r.status<>'open' then return private.offloading_failure('TRIP_NOT_OPEN',jsonb_build_object('trip_number',r.trip_number)); end if;
  if t.normalized_registration<>v_plate then return private.offloading_failure('PLATE_MISMATCH'); end if;
  image_error:=private.offloading_image_error(p_image_path);
  if image_error is not null then return private.offloading_failure(image_error); end if;
  perform 1 from public.drivers where id=r.driver_id for share;
  begin
    update public.trips set status='closed',offloading_site_id=(a->>'site_id')::uuid,quantity_tonnes=p_quantity_tonnes
      where id=r.id returning * into r;
    insert into public.trip_offloading_evidence(trip_id,assignment_id,offloading_site_id,confirmed_plate,
      ocr_detected_plate,ocr_confidence,capture_method,image_path,captured_at,captured_by)
    values(r.id,(a->>'assignment_id')::uuid,r.offloading_site_id,p_plate,p_ocr_detected_plate,
      p_ocr_confidence,p_capture_method,p_image_path,p_captured_at,auth.uid());
    insert into public.audit_log(entity_name,entity_id,action,new_value,reason,actor_id)
    values('offloading_trip_closed',r.id,'INSERT',jsonb_build_object('request_id',p_request_id,'trip_id',r.id,
      'truck_id',r.truck_id,'assignment_id',a->>'assignment_id','site_id',r.offloading_site_id,
      'quantity_tonnes',r.quantity_tonnes,'capture_method',p_capture_method),'Offloading trip closed',auth.uid());
    result:=jsonb_build_object('ok',true,'request_id',p_request_id,
      'trip',jsonb_build_object('id',r.id,'trip_number',r.trip_number,'status',r.status,
        'truck_id',r.truck_id,'driver_id',r.driver_id,'offloading_site_id',r.offloading_site_id,
        'quantity_tonnes',r.quantity_tonnes,'closed_at',r.closed_at,'closed_by',r.closed_by),
      'capture',jsonb_build_object('confirmed_plate',p_plate,'normalized_confirmed_plate',v_plate,
        'capture_method',p_capture_method,'image_recorded',p_image_path is not null),
      'notification_queued',true);
    insert into private.offloading_request_receipts(actor_id,request_id,response) values(auth.uid(),p_request_id,result);
    return result;
  exception when unique_violation then
    get stacked diagnostics v_constraint=constraint_name;
    if v_constraint='trip_offloading_evidence_image_path_key' then
      return private.offloading_failure('IMAGE_ALREADY_USED');
    end if;
    raise;
  end;
end;
$$;

-- Reconstructed pre-MVP installations can retain permissive policies alongside
-- the MVP policies. PostgreSQL ORs permissive policies, including FOR ALL ones.
-- Remove the known legacy names explicitly; the restrictive SELECT fences below
-- also prevent any other overlapping permissive policy from widening field reads.
drop policy if exists "Field officers and managers can read trips" on public.trips;
drop policy if exists "Loading officers can insert new trips" on public.trips;
drop policy if exists "Offloading officers and managers can update trips" on public.trips;
drop policy if exists "Public authenticated read on active sites" on public.sites;
drop policy if exists "Admin full access on sites" on public.sites;
drop policy if exists "Authenticated read trucks" on public.trucks;
drop policy if exists "Admin write trucks" on public.trucks;
drop policy if exists "Authenticated read drivers" on public.drivers;
drop policy if exists "Admin write drivers" on public.drivers;
drop policy if exists "Operations and field officers read exceptions" on public.exceptions;
drop policy if exists "Field and ops can flag exceptions" on public.exceptions;
drop policy if exists "Operations managers resolve exceptions" on public.exceptions;
-- These tables belong only to the reconstructed legacy schema. If they survived
-- the MVP deployment, do not leave their global authenticated reads in place.
do $$ declare t text; p text; begin
  for t,p in select * from (values
    ('truck_driver_assignments','Authenticated read truck assignments'),
    ('trip_loading_events','Read loading events'),
    ('trip_offloading_events','Read offloading events')) as legacy(table_name,policy_name)
  loop
    if to_regclass(format('public.%I',t)) is not null then
      execute format('drop policy if exists %I on public.%I',p,t);
      execute format('drop policy if exists legacy_operational_read on public.%I',t);
      execute format('drop policy if exists legacy_operational_read_fence on public.%I',t);
      execute format('create policy legacy_operational_read on public.%I for select to authenticated using (
        private.has_role(array[''system_administrator'',''operations_manager'',
          ''finance_officer'',''audit_reviewer'']::public.app_role[]))',t);
      execute format('create policy legacy_operational_read_fence on public.%I as restrictive for select
        to authenticated using (private.has_role(array[''system_administrator'',''operations_manager'',
          ''finance_officer'',''audit_reviewer'']::public.app_role[]))',t);
    end if;
  end loop;
end $$;

-- Offloading Officers receive a safe plate lookup and their own closed history,
-- not an enumerable operational trip/site directory. Definer RPCs perform their
-- own role and assignment checks before reading otherwise hidden rows.
drop policy trips_read_other_operational_roles on public.trips;
create policy trips_read_other_operational_roles on public.trips for select to authenticated using (
  private.has_role(array['system_administrator','operations_manager','finance_officer','audit_reviewer']::public.app_role[]));
create policy trips_read_offloading_own_closed on public.trips for select to authenticated using (
  private.has_role(array['offloading_officer']::public.app_role[]) and status='closed' and closed_by=auth.uid());
drop policy sites_read_other_operational_roles on public.sites;
create policy sites_read_other_operational_roles on public.sites for select to authenticated using (
  private.has_role(array['system_administrator','operations_manager','finance_officer','audit_reviewer']::public.app_role[]));
create policy sites_read_offloading_current on public.sites for select to authenticated using (
  private.has_role(array['offloading_officer']::public.app_role[]) and is_active and site_type='offloading'
    and exists(select 1 from public.user_site_assignments a where a.profile_id=auth.uid()
      and a.site_id=sites.id and a.ended_at is null));
drop policy operational_read on public.drivers;
create policy operational_read on public.drivers for select to authenticated using (
  private.has_role(array['system_administrator','operations_manager','finance_officer','audit_reviewer']::public.app_role[]));
do $$ declare t text; begin
  foreach t in array array['trucks','daily_registrations','exceptions'] loop
    execute format('drop policy operational_read on public.%I',t);
    execute format('create policy operational_read on public.%I for select to authenticated using (
      private.has_role(array[''system_administrator'',''operations_manager'',
        ''finance_officer'',''audit_reviewer'']::public.app_role[]))',t);
  end loop;
end $$;

-- A permissive policy added by an older installation cannot bypass these
-- actor-derived boundaries. Positive role checks also deny inactive profiles.
create policy trips_field_read_fence on public.trips as restrictive for select to authenticated using (
  (private.has_role(array['loading_officer']::public.app_role[]) and opened_by=auth.uid())
  or (private.has_role(array['offloading_officer']::public.app_role[]) and status='closed' and closed_by=auth.uid())
  or private.has_role(array['system_administrator','operations_manager','finance_officer','audit_reviewer']::public.app_role[]));
create policy sites_field_read_fence on public.sites as restrictive for select to authenticated using (
  ((private.has_role(array['loading_officer']::public.app_role[]) and is_active and site_type='loading')
    or (private.has_role(array['offloading_officer']::public.app_role[]) and is_active and site_type='offloading'))
    and exists(select 1 from public.user_site_assignments a where a.profile_id=auth.uid()
      and a.site_id=sites.id and a.ended_at is null)
  or private.has_role(array['system_administrator','operations_manager','finance_officer','audit_reviewer']::public.app_role[]));
create policy drivers_field_read_fence on public.drivers as restrictive for select to authenticated using (
  private.has_role(array['system_administrator','operations_manager','finance_officer','audit_reviewer']::public.app_role[]));
create policy trucks_field_read_fence on public.trucks as restrictive for select to authenticated using (
  private.has_role(array['system_administrator','operations_manager','finance_officer','audit_reviewer']::public.app_role[]));
create policy registrations_field_read_fence on public.daily_registrations as restrictive for select to authenticated using (
  private.has_role(array['system_administrator','operations_manager','finance_officer','audit_reviewer']::public.app_role[]));
create policy exceptions_field_read_fence on public.exceptions as restrictive for select to authenticated using (
  private.has_role(array['system_administrator','operations_manager','finance_officer','audit_reviewer']::public.app_role[]));
create policy assignments_field_read_fence on public.user_site_assignments as restrictive for select to authenticated using (
  (profile_id=auth.uid() and private.has_role(array['loading_officer','offloading_officer']::public.app_role[]))
  or private.has_role(array['system_administrator','operations_manager','audit_reviewer']::public.app_role[]));

-- The team's 20260925000300 invoice policy permits every operational role to
-- read every invoice. Restrict field officers to movements they actually opened
-- or closed; preserve broad Operations, Admin, Finance and Audit review.
create policy trip_closure_invoice_field_read_fence on public.trip_closure_invoices
  as restrictive for select to authenticated using (
    private.has_role(array['system_administrator','operations_manager','finance_officer','audit_reviewer']::public.app_role[])
    or exists (select 1 from public.trips t where t.id=trip_closure_invoices.trip_id
      and ((private.has_role(array['loading_officer']::public.app_role[]) and t.opened_by=auth.uid())
        or (private.has_role(array['offloading_officer']::public.app_role[]) and t.status='closed'
          and t.closed_by=auth.uid())))
  );

revoke all on all functions in schema private from public,anon,authenticated,service_role;
grant execute on function private.has_role(public.app_role[]),private.can_upload_loading_image(text),
  private.can_upload_offloading_image(text) to authenticated;
revoke all on function public.lookup_offloading_open_trip(text),
  public.close_trip_v2(uuid,uuid,text,uuid,numeric,text,timestamptz,text,numeric,text)
  from public,anon,authenticated,service_role;
grant execute on function public.lookup_offloading_open_trip(text),
  public.close_trip_v2(uuid,uuid,text,uuid,numeric,text,timestamptz,text,numeric,text) to authenticated;

commit;
