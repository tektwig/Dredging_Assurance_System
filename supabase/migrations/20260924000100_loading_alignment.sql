-- Loading Alignment 2B. Forward-only; preserves existing operational records.
begin;
-- Apply only in a controlled, quiesced-write maintenance window (see deployment
-- instructions). Keep the explicit audit lock/redaction at the end of the migration.
create function private.audit_bank_tokens(p_value jsonb) returns setof text
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb;
begin
  if jsonb_typeof(p_value)='object' then
    for k,v in select key,value from jsonb_each(p_value) loop
      if k in ('bank_name','account_number','account_name','supplied_bank_name','supplied_account_number','supplied_account_name')
        and jsonb_typeof(v)='string' and length(btrim(v#>>'{}'))>0 then
        return next v#>>'{}';
      elsif jsonb_typeof(v) in ('object','array') then
        return query select * from private.audit_bank_tokens(v);
      end if;
    end loop;
  elsif jsonb_typeof(p_value)='array' then
    for v in select value from jsonb_array_elements(p_value) loop
      return query select * from private.audit_bank_tokens(v);
    end loop;
  end if;
end;
$$;
create function private.audit_bank_values(p_entity text,p_id uuid,p_old jsonb,p_new jsonb) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_driver uuid; v_trip uuid; v_values text[];
begin
  if p_entity='driver_payment_details' then v_driver:=p_id;
  elsif p_entity='trip_payments' then
    select driver_id into v_driver from public.trip_payments where id=p_id;
  elsif p_entity='notification_outbox' then
    select trip_id into v_trip from public.notification_outbox where id=p_id;
    v_trip:=coalesce(v_trip,(p_new->>'trip_id')::uuid,(p_old->>'trip_id')::uuid);
    select driver_id into v_driver from public.trip_payments where trip_id=v_trip;
  end if;
  v_driver:=coalesce(v_driver,(p_new->>'driver_id')::uuid,(p_old->>'driver_id')::uuid);
  select array_agg(distinct token) into v_values from (
    select * from private.audit_bank_tokens(p_old)
    union all select * from private.audit_bank_tokens(p_new)
    union all select t.* from public.driver_payment_details d cross join lateral private.audit_bank_tokens(to_jsonb(d)) t where d.driver_id=v_driver
    union all select t.* from public.trip_payments p cross join lateral private.audit_bank_tokens(to_jsonb(p)) t where p.driver_id=v_driver
  ) x(token);
  return coalesce(v_values,array[]::text[]);
end;
$$;
create function private.audit_redact_text(p_text text,p_tokens text[]) returns text
language plpgsql immutable set search_path = '' as $$
declare v_text text:=p_text; v_token text; v_rest text; v_result text; v_pos integer; v_before text; v_after text;
begin
  if p_text is null then return null; end if;
  for v_token in select distinct t from unnest(p_tokens) t where length(t)>0 order by t loop
    v_rest:=v_text; v_result:='';
    loop
      v_pos:=strpos(lower(v_rest),lower(v_token)); exit when v_pos=0;
      v_before:=case when v_pos>1 then substr(v_rest,v_pos-1,1) else '' end;
      v_after:=substr(v_rest,v_pos+length(v_token),1);
      -- Whole-word boundaries for names avoid redacting incidental substrings.
      -- Known account numbers are removed even inside a composite reference.
      v_result:=v_result||substr(v_rest,1,v_pos-1)||case
        when v_token ~ '^[0-9]+$' or not (
          (left(v_token,1) ~ '[[:alnum:]_]' and v_before ~ '[[:alnum:]_]') or
          (right(v_token,1) ~ '[[:alnum:]_]' and v_after ~ '[[:alnum:]_]')) then '[REDACTED]'
        else substr(v_rest,v_pos,length(v_token)) end;
      v_rest:=substr(v_rest,v_pos+length(v_token));
    end loop;
    v_text:=v_result||v_rest;
  end loop;
  -- Also redact explicitly labelled values, without discarding the surrounding
  -- investigation/reconciliation explanation. Unrelated bare reference IDs survive.
  return regexp_replace(v_text,'((bank[ _-]*name|account[ _-]*(name|number))[[:space:]]*[:=][[:space:]]*)[^;\n|,]+','\1[REDACTED]','gi');
end;
$$;
create function private.audit_redact_json(p_value jsonb,p_tokens text[]) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v_result jsonb; k text; v jsonb;
begin
  if jsonb_typeof(p_value)='string' then return to_jsonb(private.audit_redact_text(p_value#>>'{}',p_tokens)); end if;
  if jsonb_typeof(p_value)='object' then
    v_result:='{}';
    for k,v in select key,value from jsonb_each(p_value) loop
      v_result:=v_result||jsonb_build_object(k,private.audit_redact_json(v,p_tokens));
    end loop;
    return v_result;
  elsif jsonb_typeof(p_value)='array' then
    select coalesce(jsonb_agg(private.audit_redact_json(value,p_tokens) order by ord),'[]') into v_result
      from jsonb_array_elements(p_value) with ordinality x(value,ord);
    return v_result;
  end if;
  return p_value;
end;
$$;
create function private.audit_projection(p_entity text,p_value jsonb,p_tokens text[] default array[]::text[]) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v_keys text[]; v_result jsonb;
begin
  if p_value is null then return null; end if;
  case p_entity
    when 'driver_payment_details' then v_keys:=array['driver_id','created_at','updated_at'];
    when 'trip_payments' then v_keys:=array['id','payment_id','trip_id','driver_id','truck_id',
      'driver_name','driver_phone','driver_email','status','created_at','updated_at',
      'payment_ready_at','payment_ready_by','paid_at','paid_by','payment_reference'];
    when 'notification_outbox' then v_keys:=array['id','notification_id','event_type','trip_id','audience','recipients',
      'status','attempts','last_error','provider_message_id','created_at','updated_at','first_attempt_at',
      'next_attempt_at','lease_until','sent_at'];
    else return p_value;
  end case;
  select coalesce(jsonb_object_agg(key,value),'{}') into v_result from jsonb_each(p_value) where key=any(v_keys);
  v_result:=private.audit_redact_json(v_result,p_tokens);
  -- Names of changed fields are metadata, not their values (including bank fields).
  if p_value ? 'changed_fields' then v_result:=v_result||jsonb_build_object('changed_fields',p_value->'changed_fields'); end if;
  return v_result;
end;
$$;
create function private.sanitize_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_tokens text[];
begin
  if new.entity_name in ('driver_payment_details','trip_payments','notification_outbox') then
    v_tokens:=private.audit_bank_values(new.entity_name,new.entity_id,new.old_value,new.new_value);
    new.old_value:=private.audit_projection(new.entity_name,new.old_value,v_tokens);
    new.new_value:=private.audit_projection(new.entity_name,new.new_value,v_tokens);
    new.reason:=private.audit_redact_text(new.reason,v_tokens);
  end if;
  return new;
end;
$$;
create trigger sanitize_audit before insert on public.audit_log
for each row execute function private.sanitize_audit();
create or replace function private.capture_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_old jsonb; v_new jsonb; v_id uuid; v_changed jsonb;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  v_id := coalesce((v_new->>'id')::uuid, (v_old->>'id')::uuid,
    (v_new->>'trip_id')::uuid, (v_old->>'trip_id')::uuid,
    (v_new->>'driver_id')::uuid, (v_old->>'driver_id')::uuid);
  if tg_table_name in ('driver_payment_details','trip_payments','notification_outbox') and v_new is not null then
    select coalesce(jsonb_agg(k order by k),'[]') into v_changed from jsonb_object_keys(v_new) k
      where v_new->k is distinct from v_old->k;
    v_new:=v_new||jsonb_build_object('changed_fields',v_changed);
  end if;
  insert into public.audit_log(entity_name,entity_id,action,old_value,new_value,reason,actor_id)
  -- The BEFORE INSERT sanitizer receives both versions, so even superseded banking
  -- tokens can be scrubbed from free text before anything is stored in audit_log.
  values(tg_table_name,v_id,tg_op,v_old,v_new,nullif(current_setting('app.audit_reason',true),''),auth.uid());
  return null;
end;
$$;
-- Replace only the FK which incorrectly made a daily driver authoritative.
do $$ declare v_name text; begin
  select conname into strict v_name from pg_constraint
    where conrelid='public.trips'::regclass and confrelid='public.daily_registrations'::regclass and contype='f';
  execute format('alter table public.trips drop constraint %I',v_name);
  select conname into strict v_name from pg_constraint
    where conrelid='public.daily_registrations'::regclass and contype='u' and array_length(conkey,1)=3;
  execute format('alter table public.daily_registrations drop constraint %I',v_name);
end $$;
alter table public.daily_registrations rename column driver_id to initial_driver_id;
alter table public.daily_registrations add constraint registration_id_truck_unique unique(id,truck_id);
alter table public.trips add constraint trip_daily_truck_fk foreign key(daily_registration_id,truck_id)
  references public.daily_registrations(id,truck_id) on delete restrict;
comment on column public.daily_registrations.initial_driver_id is 'First successful trip driver; not binding on later trips.';
create table public.user_site_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  assigned_at timestamptz not null default clock_timestamp(),
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  ended_at timestamptz,
  ended_by uuid references public.profiles(id) on delete restrict,
  check ((ended_at is null and ended_by is null) or (ended_at >= assigned_at and ended_by is not null)),
  unique(id,site_id,profile_id)
);
create unique index one_current_site_assignment on public.user_site_assignments(profile_id) where ended_at is null;
create index assignments_site_idx on public.user_site_assignments(site_id);
create index assignments_assigned_by_idx on public.user_site_assignments(assigned_by);
create index assignments_ended_by_idx on public.user_site_assignments(ended_by);
drop index public.one_active_loading_site;
alter table public.trips add column driver_name_at_loading text,
  add column loading_assignment_id uuid;
alter table public.trips add constraint trip_loading_assignment_fk
  foreign key(loading_assignment_id,loading_site_id,opened_by)
  references public.user_site_assignments(id,site_id,profile_id) on delete restrict;
create index trips_loading_assignment_idx on public.trips(loading_assignment_id);
-- Formatting only: never strip arbitrary letters, guess countries, or merge people.
create function public.normalize_driver_phone(p_phone text) returns text
language plpgsql immutable strict set search_path = '' as $$
declare v text;
begin
  if length(p_phone)>40 or p_phone !~ '^[+0-9[:space:]().-]+$' then return null; end if;
  v := regexp_replace(p_phone,'[[:space:]().-]','','g');
  if v ~ '^0[789][01][0-9]{8}$' then return '+234'||substr(v,2); end if;
  if v ~ '^\+[1-9][0-9]{7,14}$' then return v; end if;
  return null;
end;
$$;
alter table public.drivers add column normalized_phone text
  generated always as (public.normalize_driver_phone(phone_number)) stored;
create index drivers_normalized_phone_idx on public.drivers(normalized_phone) where normalized_phone is not null;
create function private.driver_phone_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if tg_op='UPDATE' and new.phone_number is not distinct from old.phone_number then return new; end if;
  v := public.normalize_driver_phone(new.phone_number);
  if v is not null then
    perform pg_advisory_xact_lock(hashtextextended('loading-phone:'||v,0));
    if exists(select 1 from public.drivers where normalized_phone=v and id<>new.id) then
      raise exception 'Driver phone requires identity review' using errcode='23505', constraint='driver_phone_review';
    end if;
  end if;
  return new;
end;
$$;
create trigger driver_phone_guard before insert or update on public.drivers
for each row execute function private.driver_phone_guard();
create table private.loading_request_receipts (
  actor_id uuid not null references public.profiles(id) on delete restrict,
  operation text not null check(operation in ('register_loading_participant','create_loading_trip_v2')),
  request_id uuid not null,
  response jsonb not null check(response->>'ok'='true'),
  created_at timestamptz not null default clock_timestamp(),
  primary key(actor_id,operation,request_id)
);
revoke all on private.loading_request_receipts from public,anon,authenticated,service_role;
alter table private.loading_request_receipts enable row level security;
create trigger receipt_immutable before update or delete on private.loading_request_receipts
for each row execute function private.reject_mutation();
create table public.trip_loading_evidence (
  trip_id uuid primary key references public.trips(id) on delete restrict,
  confirmed_plate text not null check(length(confirmed_plate) between 1 and 64),
  normalized_confirmed_plate text generated always as(public.normalize_plate(confirmed_plate)) stored,
  ocr_detected_plate text check(length(ocr_detected_plate) between 1 and 64),
  ocr_confidence numeric check(ocr_confidence between 0 and 1),
  capture_method text not null check(capture_method in ('OCR','OCR_CORRECTED','MANUAL')),
  image_path text unique,
  captured_at timestamptz not null check(isfinite(captured_at)),
  recorded_at timestamptz not null default clock_timestamp(),
  captured_by uuid not null references public.profiles(id) on delete restrict,
  check(normalized_confirmed_plate ~ '^[A-Z0-9]{1,32}$'),
  check((capture_method='MANUAL' and ocr_detected_plate is null and ocr_confidence is null)
    or (capture_method in ('OCR','OCR_CORRECTED') and ocr_detected_plate is not null and image_path is not null
      and ((capture_method='OCR' and public.normalize_plate(ocr_detected_plate)=normalized_confirmed_plate)
        or (capture_method='OCR_CORRECTED' and public.normalize_plate(ocr_detected_plate)<>normalized_confirmed_plate))))
);
create index evidence_actor_idx on public.trip_loading_evidence(captured_by);
create trigger evidence_immutable before update or delete on public.trip_loading_evidence
for each row execute function private.reject_mutation();
create function private.loading_failure(p_code text,p_details jsonb default '{}'::jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('ok',false,'code',p_code,'details',p_details);
$$;
create function private.lock_loading_actor() returns void
language plpgsql security definer set search_path = '' as $$
declare v public.profiles%rowtype;
begin
  select * into v from public.profiles where id=auth.uid() for no key update;
  if not found or not v.is_active or v.role not in ('loading_officer','system_administrator') then
    raise exception 'Not authorized' using errcode='42501';
  end if;
end;
$$;
create function private.loading_assignment(p_expected uuid default null,p_check_expected boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.user_site_assignments%rowtype; s public.sites%rowtype;
begin
  if p_check_expected and p_expected is null then return private.loading_failure('SITE_REVIEW_REQUIRED'); end if;
  select * into a from public.user_site_assignments where profile_id=auth.uid() and ended_at is null for share;
  if not found then return private.loading_failure('SITE_ASSIGNMENT_REQUIRED'); end if;
  select * into s from public.sites where id=a.site_id for share;
  if not found or s.site_type<>'loading' then return private.loading_failure('INVALID_SITE_ASSIGNMENT'); end if;
  if not s.is_active then return private.loading_failure('INACTIVE_SITE'); end if;
  if p_check_expected and a.id<>p_expected then return private.loading_failure('SITE_ASSIGNMENT_CHANGED'); end if;
  return jsonb_build_object('ok',true,'assignment_id',a.id,'site_id',s.id,'site_name',s.name);
end;
$$;
create function private.loading_replay(p_operation text,p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('loading-request:'||auth.uid()::text||':'||p_operation||':'||p_request::text,0));
  select response into v from private.loading_request_receipts
    where actor_id=auth.uid() and operation=p_operation and request_id=p_request;
  return v;
end;
$$;
create function private.loading_truck_block(p_truck uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_number text;
begin
  select id,trip_number into v_id,v_number from public.trips where truck_id=p_truck and status='open';
  if found then return private.loading_failure('OPEN_TRIP_EXISTS',jsonb_build_object('trip_id',v_id,'trip_number',v_number)); end if;
  select id into v_id from public.exceptions where truck_id=p_truck and status='open' and blocks_operations order by created_at,id limit 1;
  if found then return private.loading_failure('BLOCKING_EXCEPTION',jsonb_build_object('exception_id',v_id)); end if;
  return null;
end;
$$;
create function private.assignment_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_role public.app_role; v_type public.site_type;
begin
  if tg_op='DELETE' then raise exception 'Assignment history is immutable' using errcode='23514'; end if;
  if tg_op='UPDATE' then
    if old.ended_at is not null or new.ended_at is null or new.ended_by is distinct from auth.uid()
      or (to_jsonb(new)-array['ended_at','ended_by']) is distinct from (to_jsonb(old)-array['ended_at','ended_by']) then
      raise exception 'Only ending a current assignment is permitted' using errcode='23514';
    end if;
    new.ended_at:=clock_timestamp();
  else
    select role into v_role from public.profiles where id=new.profile_id for no key update;
    select site_type into v_type from public.sites where id=new.site_id and is_active for share;
    if v_type is null or not coalesce((v_role='loading_officer' and v_type='loading')
      or (v_role='offloading_officer' and v_type='offloading') or v_role='system_administrator',false) then
      raise exception 'Invalid assignment' using errcode='23514';
    end if;
    new.assigned_at:=clock_timestamp(); new.assigned_by:=auth.uid();
    if new.ended_at is not null or new.ended_by is not null then raise exception 'New assignment must be current' using errcode='23514'; end if;
  end if;
  return new;
end;
$$;
create trigger assignment_guard before insert or update or delete on public.user_site_assignments
for each row execute function private.assignment_guard();
create function public.assign_user_site(p_profile_id uuid,p_site_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.profiles%rowtype; s public.sites%rowtype; a public.user_site_assignments%rowtype;
begin
  -- Consistent UUID order when administrator and target differ.
  perform 1 from public.profiles where id in(auth.uid(),p_profile_id) order by id for no key update;
  perform private.require_role(array['system_administrator']::public.app_role[]);
  select * into p from public.profiles where id=p_profile_id;
  if not found then return private.loading_failure('PROFILE_NOT_FOUND'); end if;
  select * into s from public.sites where id=p_site_id for share;
  if not found then return private.loading_failure('SITE_NOT_FOUND'); end if;
  if not s.is_active then return private.loading_failure('INACTIVE_SITE'); end if;
  if not coalesce((p.role='loading_officer' and s.site_type='loading') or
    (p.role='offloading_officer' and s.site_type='offloading') or p.role='system_administrator',false) then
    return private.loading_failure('INVALID_SITE_ASSIGNMENT');
  end if;
  select * into a from public.user_site_assignments where profile_id=p_profile_id and ended_at is null;
  if a.site_id is distinct from p_site_id then
    perform set_config('app.audit_reason','Site assignment changed',true);
    update public.user_site_assignments set ended_at=clock_timestamp(),ended_by=auth.uid() where id=a.id;
    insert into public.user_site_assignments(profile_id,site_id,assigned_by) values(p_profile_id,p_site_id,auth.uid()) returning * into a;
  end if;
  return jsonb_build_object('ok',true,'assignment_id',a.id,'profile_id',a.profile_id,'site_id',a.site_id);
end;
$$;
-- Keep original lifecycle trigger, including its future-column identity protection.
-- Additional insert guard validates attendance and V2-only opening fields.
create function private.loading_trip_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.daily_registrations where id=new.daily_registration_id
    and truck_id=new.truck_id and operational_date=(new.opened_at at time zone 'Africa/Lagos')::date) then
    raise exception 'Trip registration truck/date mismatch' using errcode='23514';
  end if;
  if new.loading_assignment_id is null or nullif(btrim(new.driver_name_at_loading),'') is null then
    raise exception 'Loading assignment and driver snapshot required' using errcode='23514';
  end if;
  if not exists(select 1 from public.user_site_assignments a join public.sites s on s.id=a.site_id
    where a.id=new.loading_assignment_id and a.profile_id=new.opened_by and a.site_id=new.loading_site_id
      and a.ended_at is null and s.is_active and s.site_type='loading') then
    raise exception 'Current loading assignment required' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger y_loading_trip_guard before insert on public.trips
for each row execute function private.loading_trip_guard();
create function private.require_loading_evidence() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.trip_loading_evidence where trip_id=new.id) then
    raise exception 'Loading evidence required' using errcode='23514';
  end if;
  return null;
end;
$$;
create constraint trigger loading_evidence_required after insert on public.trips
deferrable initially deferred for each row execute function private.require_loading_evidence();
-- Retained as a non-executable tombstone, avoiding a broken legacy column reference.
create or replace function public.create_loading_trip(p_plate text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin raise exception 'Use create_loading_trip_v2' using errcode='42501'; end;
$$;
revoke all on function public.create_loading_trip(text) from public,anon,authenticated,service_role;
-- Supabase-managed Storage schema must already exist. No remote/API operation here.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('loading-plate-evidence','loading-plate-evidence',false,5242880,array['image/jpeg','image/png'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create function private.loading_image_error(p_path text) returns text
language plpgsql security definer set search_path = '' as $$
declare o storage.objects%rowtype;
begin
  if p_path is null then return null; end if;
  if p_path !~ ('^'||auth.uid()::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$') then
    return 'INVALID_IMAGE_REFERENCE';
  end if;
  select * into o from storage.objects where bucket_id='loading-plate-evidence' and name=p_path for share;
  if not found then return 'IMAGE_NOT_FOUND'; end if;
  if o.owner_id is distinct from auth.uid()::text
    or coalesce(o.metadata->>'mimetype','') not in ('image/jpeg','image/png')
    or coalesce(o.metadata->>'size','') !~ '^[0-9]{1,10}$' then return 'INVALID_IMAGE_REFERENCE'; end if;
  if (o.metadata->>'size')::bigint not between 1 and 5242880
    or (right(p_path,4)='.jpg' and o.metadata->>'mimetype'<>'image/jpeg')
    or (right(p_path,4)='.png' and o.metadata->>'mimetype'<>'image/png') then return 'INVALID_IMAGE_REFERENCE'; end if;
  if exists(select 1 from public.trip_loading_evidence where image_path=p_path) then return 'IMAGE_ALREADY_USED'; end if;
  return null;
end;
$$;
create function private.evidence_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_plate text; v_actor uuid; v_error text;
begin
  select t.normalized_registration,r.opened_by into v_plate,v_actor from public.trips r
    join public.trucks t on t.id=r.truck_id where r.id=new.trip_id;
  if not found or v_actor is distinct from auth.uid() or public.normalize_plate(new.confirmed_plate) is distinct from v_plate then
    raise exception 'Evidence trip/plate/actor mismatch' using errcode='23514';
  end if;
  if new.captured_at > clock_timestamp()+interval '5 minutes' then raise exception 'Invalid capture timestamp' using errcode='23514'; end if;
  v_error:=private.loading_image_error(new.image_path);
  if v_error is not null then raise exception 'Invalid evidence image' using errcode='23514'; end if;
  new.captured_by:=auth.uid(); new.recorded_at:=clock_timestamp();
  return new;
end;
$$;
create trigger evidence_guard before insert on public.trip_loading_evidence
for each row execute function private.evidence_guard();
create function public.register_loading_participant(
  p_request_id uuid,p_plate text,p_expected_truck_id uuid default null,p_existing_driver_id uuid default null,
  p_full_name text default null,p_phone_number text default null,p_email text default null,
  p_bank_name text default null,p_account_number text default null,p_account_name text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_plate text:=public.normalize_plate(p_plate); v_phone text; v_result jsonb; v_assignment jsonb;
  t public.trucks%rowtype; d public.drivers%rowtype; v_constraint text;
begin
  perform private.lock_loading_actor();
  if p_request_id is null then return private.loading_failure('INVALID_REQUEST_ID'); end if;
  v_result:=private.loading_replay('register_loading_participant',p_request_id);
  if v_result is not null then return v_result; end if;
  if p_plate is null or length(p_plate)>64 or v_plate !~ '^[A-Z0-9]{1,32}$' then return private.loading_failure('INVALID_PLATE'); end if;
  if (p_existing_driver_id is not null and (p_expected_truck_id is not null or p_full_name is not null or p_phone_number is not null
    or p_email is not null or p_bank_name is not null or p_account_number is not null or p_account_name is not null)) then
    return private.loading_failure('INVALID_REGISTRATION_MODE');
  end if;
  v_assignment:=private.loading_assignment();
  if not (v_assignment->>'ok')::boolean then return v_assignment; end if;
  perform pg_advisory_xact_lock(hashtextextended('loading-plate:'||v_plate,0));
  if p_expected_truck_id is null then
    if exists(select 1 from public.trucks where normalized_registration=v_plate) then return private.loading_failure('PLATE_ALREADY_REGISTERED'); end if;
  else
    select * into t from public.trucks where id=p_expected_truck_id for update;
    if not found then return private.loading_failure('TRUCK_NOT_FOUND'); end if;
    if t.normalized_registration<>v_plate then return private.loading_failure('TRUCK_PLATE_MISMATCH'); end if;
    if not t.is_active then return private.loading_failure('INACTIVE_TRUCK'); end if;
    v_result:=private.loading_truck_block(t.id);
    if v_result is not null then return v_result; end if;
  end if;
  if p_existing_driver_id is not null then
    select * into d from public.drivers where id=p_existing_driver_id for share;
    if not found then return private.loading_failure('DRIVER_NOT_FOUND'); end if;
    if not d.is_active then return private.loading_failure('INACTIVE_DRIVER'); end if;
  else
    if p_full_name is null or length(btrim(p_full_name)) not between 1 and 200 then return private.loading_failure('INVALID_DRIVER_NAME'); end if;
    v_phone:=public.normalize_driver_phone(p_phone_number);
    if v_phone is null then return private.loading_failure('INVALID_PHONE'); end if;
    if p_email is not null and (length(btrim(p_email))>254 or btrim(p_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
      return private.loading_failure('INVALID_EMAIL');
    end if;
    if nullif(btrim(p_bank_name),'') is null or nullif(btrim(p_account_name),'') is null or nullif(btrim(p_account_number),'') is null then
      return private.loading_failure('PAYMENT_DETAILS_REQUIRED');
    end if;
    if length(btrim(p_bank_name))>200 then return private.loading_failure('INVALID_BANK_NAME'); end if;
    if btrim(p_account_number) !~ '^[0-9]{10}$' then return private.loading_failure('INVALID_ACCOUNT_NUMBER'); end if;
    if length(btrim(p_account_name))>200 then return private.loading_failure('INVALID_ACCOUNT_NAME'); end if;
    perform pg_advisory_xact_lock(hashtextextended('loading-phone:'||v_phone,0));
    if exists(select 1 from public.drivers where normalized_phone=v_phone) then return private.loading_failure('DRIVER_MATCH_REQUIRES_REVIEW'); end if;
  end if;
  -- Recognized late duplicate races roll back this entire mutation block, including audits.
  begin
    perform set_config('app.audit_reason','Loading participant registered',true);
    if p_existing_driver_id is null then
      insert into public.drivers(full_name,phone_number,email) values(btrim(p_full_name),btrim(p_phone_number),case when p_email is null then null else btrim(p_email) end) returning * into d;
      insert into public.driver_payment_details(driver_id,bank_name,account_number,account_name)
        values(d.id,btrim(p_bank_name),btrim(p_account_number),btrim(p_account_name));
    end if;
    if p_expected_truck_id is null then
      -- Master display field is 32 characters; evidence preserves the exact submitted text.
      insert into public.trucks(registration_number,driver_id) values(case when length(btrim(p_plate))<=32 then btrim(p_plate) else v_plate end,d.id) returning * into t;
    end if;
    v_result:=jsonb_build_object('ok',true,'request_id',p_request_id,
      'truck',jsonb_build_object('id',t.id,'registration_number',t.registration_number,'normalized_registration',t.normalized_registration,'created',p_expected_truck_id is null),
      'driver',jsonb_build_object('id',d.id,'full_name',d.full_name,'phone_number',d.phone_number,'email',d.email,'created',p_existing_driver_id is null),
      'payment_details_captured',p_existing_driver_id is null,'default_driver_changed',false);
    insert into public.audit_log(entity_name,entity_id,action,new_value,reason,actor_id)
      values('loading_registration',d.id,'INSERT',jsonb_build_object('request_id',p_request_id,'truck_id',t.id,'driver_id',d.id,
        'driver_created',p_existing_driver_id is null,'truck_created',p_expected_truck_id is null,'payment_details_captured',p_existing_driver_id is null),
        'Loading participant registered',auth.uid());
    insert into private.loading_request_receipts(actor_id,operation,request_id,response)
      values(auth.uid(),'register_loading_participant',p_request_id,v_result);
    return v_result;
  exception when unique_violation then
    get stacked diagnostics v_constraint=constraint_name;
    if v_constraint='trucks_normalized_registration_key' then return private.loading_failure('PLATE_ALREADY_REGISTERED'); end if;
    if v_constraint='driver_phone_review' then return private.loading_failure('DRIVER_MATCH_REQUIRES_REVIEW'); end if;
    raise;
  end;
end;
$$;
create function public.create_loading_trip_v2(
  p_request_id uuid,p_plate text,p_driver_id uuid,p_expected_assignment_id uuid,
  p_capture_method text,p_captured_at timestamptz,p_ocr_detected_plate text default null,
  p_ocr_confidence numeric default null,p_image_path text default null,p_make_default_driver boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_plate text:=public.normalize_plate(p_plate); a jsonb; v_result jsonb; v_error text; v_constraint text;
  t public.trucks%rowtype; d public.drivers%rowtype; r public.daily_registrations%rowtype; v public.trips%rowtype;
  v_day date:=(statement_timestamp() at time zone 'Africa/Lagos')::date; v_changed boolean;
begin
  perform private.lock_loading_actor();
  if p_request_id is null then return private.loading_failure('INVALID_REQUEST_ID'); end if;
  v_result:=private.loading_replay('create_loading_trip_v2',p_request_id);
  if v_result is not null then return v_result; end if;
  if p_plate is null or length(p_plate)>64 or v_plate !~ '^[A-Z0-9]{1,32}$' then return private.loading_failure('INVALID_PLATE'); end if;
  if p_driver_id is null then return private.loading_failure('DRIVER_REQUIRED'); end if;
  if p_make_default_driver is null then return private.loading_failure('INVALID_DEFAULT_OPTION'); end if;
  if p_capture_method is null or p_capture_method not in ('OCR','OCR_CORRECTED','MANUAL') then return private.loading_failure('INVALID_CAPTURE_METHOD'); end if;
  if p_captured_at is null or not isfinite(p_captured_at) or p_captured_at>clock_timestamp()+interval '5 minutes' then return private.loading_failure('INVALID_CAPTURE_TIMESTAMP'); end if;
  if (p_capture_method='MANUAL' and (p_ocr_detected_plate is not null or p_ocr_confidence is not null))
    or (p_capture_method<>'MANUAL' and (p_ocr_detected_plate is null or length(p_ocr_detected_plate) not between 1 and 64 or p_image_path is null))
    or (p_ocr_confidence is not null and (p_ocr_confidence::text in ('NaN','Infinity','-Infinity') or p_ocr_confidence not between 0 and 1))
    or (p_capture_method='OCR' and public.normalize_plate(p_ocr_detected_plate)<>v_plate)
    or (p_capture_method='OCR_CORRECTED' and public.normalize_plate(p_ocr_detected_plate)=v_plate) then
    return private.loading_failure('INVALID_OCR_DATA');
  end if;
  a:=private.loading_assignment(p_expected_assignment_id,true);
  if not (a->>'ok')::boolean then return a; end if;
  select * into t from public.trucks where normalized_registration=v_plate for update;
  if not found then return private.loading_failure('UNKNOWN_TRUCK'); end if;
  if not t.is_active then return private.loading_failure('INACTIVE_TRUCK'); end if;
  v_result:=private.loading_truck_block(t.id);
  if v_result is not null then return v_result; end if;
  select * into d from public.drivers where id=p_driver_id for share;
  if not found then return private.loading_failure('DRIVER_NOT_FOUND'); end if;
  if not d.is_active then return private.loading_failure('INACTIVE_DRIVER'); end if;
  v_error:=private.loading_image_error(p_image_path);
  if v_error is not null then return private.loading_failure(v_error); end if;
  begin
    perform set_config('app.audit_reason','Loading trip opened',true);
    select * into r from public.daily_registrations where truck_id=t.id and operational_date=v_day;
    if not found then
      insert into public.daily_registrations(truck_id,initial_driver_id,operational_date,registered_by)
        values(t.id,d.id,v_day,auth.uid()) returning * into r;
    end if;
    insert into public.trips(truck_id,driver_id,daily_registration_id,loading_site_id,opened_by,driver_name_at_loading,loading_assignment_id)
      values(t.id,d.id,r.id,(a->>'site_id')::uuid,auth.uid(),d.full_name,(a->>'assignment_id')::uuid) returning * into v;
    insert into public.trip_loading_evidence(trip_id,confirmed_plate,ocr_detected_plate,ocr_confidence,capture_method,image_path,captured_at,captured_by)
      values(v.id,p_plate,p_ocr_detected_plate,p_ocr_confidence,p_capture_method,p_image_path,p_captured_at,auth.uid());
    v_changed:=p_make_default_driver and t.driver_id<>d.id;
    if v_changed then update public.trucks set driver_id=d.id where id=t.id; end if;
    insert into public.audit_log(entity_name,entity_id,action,new_value,reason,actor_id)
      values('loading_trip_opened',v.id,'INSERT',jsonb_build_object('request_id',p_request_id,'trip_id',v.id,'truck_id',t.id,
        'old_default_driver_id',t.driver_id,'actual_driver_id',d.id,'new_default_driver_id',case when v_changed then d.id else t.driver_id end,
        'different_driver_selected',t.driver_id<>d.id,'default_driver_changed',v_changed,'assignment_id',v.loading_assignment_id,
        'site_id',v.loading_site_id,'capture_method',p_capture_method),'Loading trip opened',auth.uid());
    v_result:=jsonb_build_object('ok',true,'request_id',p_request_id,
      'trip',jsonb_build_object('id',v.id,'trip_number',v.trip_number,'status',v.status,'truck_id',v.truck_id,'driver_id',v.driver_id,
        'driver_name_at_loading',v.driver_name_at_loading,'daily_registration_id',v.daily_registration_id,'loading_site_id',v.loading_site_id,
        'loading_assignment_id',v.loading_assignment_id,'opened_at',v.opened_at,'opened_by',v.opened_by,'quantity_tonnes',null),
      'capture',jsonb_build_object('confirmed_plate',p_plate,'normalized_confirmed_plate',v_plate,'capture_method',p_capture_method,'image_recorded',p_image_path is not null),
      'default_driver_changed',v_changed);
    insert into private.loading_request_receipts(actor_id,operation,request_id,response) values(auth.uid(),'create_loading_trip_v2',p_request_id,v_result);
    return v_result;
  exception when unique_violation then
    get stacked diagnostics v_constraint=constraint_name;
    if v_constraint='one_open_trip_per_truck' then return private.loading_truck_block(t.id); end if;
    if v_constraint='trip_loading_evidence_image_path_key' then return private.loading_failure('IMAGE_ALREADY_USED'); end if;
    raise;
  end;
end;
$$;
create function public.search_loading_drivers(p_query text,p_limit integer default 10) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a jsonb; v_query text:=btrim(p_query); v_phone text; v_canonical text; v_rows jsonb;
begin
  perform private.lock_loading_actor();
  a:=private.loading_assignment(); if not (a->>'ok')::boolean then return a; end if;
  if p_limit is null or p_limit not between 1 and 20 or v_query is null or length(v_query) not between 3 and 200 then
    return private.loading_failure('INVALID_SEARCH');
  end if;
  v_phone:=regexp_replace(v_query,'[^0-9]','','g');
  v_canonical:=public.normalize_driver_phone(v_query);
  -- A country-code form without '+' is a search alias, not a registration guess.
  if v_canonical is null and v_query ~ '^[0-9[:space:]().-]+$' and v_phone ~ '^234[789][01][0-9]{8}$' then
    v_canonical:=public.normalize_driver_phone('+'||v_phone);
  end if;
  select coalesce(jsonb_agg(x.payload order by x.full_name,x.id),'[]'::jsonb) into v_rows from (
    select id,full_name,jsonb_build_object('id',id,'full_name',full_name,'phone_number',phone_number,'email',email,'is_active',is_active) payload
    from public.drivers where position(lower(v_query) in lower(full_name))>0
      or (v_canonical is not null and normalized_phone=v_canonical)
      or (v_canonical is null and v_query ~ '^[+0-9[:space:]().-]+$' and length(v_phone) between 4 and 10
        and normalized_phone is not null and position(v_phone in normalized_phone)>0)
    order by full_name,id limit p_limit
  ) x;
  return jsonb_build_object('ok',true,'drivers',v_rows);
end;
$$;
create function public.lookup_loading_truck(p_plate text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a jsonb; t public.trucks%rowtype; d public.drivers%rowtype; v_plate text:=public.normalize_plate(p_plate); b jsonb;
begin
  perform private.lock_loading_actor();
  a:=private.loading_assignment(); if not (a->>'ok')::boolean then return a; end if;
  if p_plate is null or length(p_plate)>64 or v_plate !~ '^[A-Z0-9]{1,32}$' then return private.loading_failure('INVALID_PLATE'); end if;
  select * into t from public.trucks where normalized_registration=v_plate;
  if not found then return jsonb_build_object('ok',true,'found',false,'assignment',a); end if;
  select * into d from public.drivers where id=t.driver_id;
  b:=private.loading_truck_block(t.id);
  return jsonb_build_object('ok',true,'found',true,'assignment',a,
    'truck',jsonb_build_object('id',t.id,'registration_number',t.registration_number,'normalized_registration',t.normalized_registration,'is_active',t.is_active),
    'default_driver',jsonb_build_object('id',d.id,'full_name',d.full_name,'phone_number',d.phone_number,'email',d.email,'is_active',d.is_active),
    'block',b);
end;
$$;
-- New tables have no client write grants. Existing administrator master writes stay.
alter table public.user_site_assignments enable row level security;
alter table public.trip_loading_evidence enable row level security;
revoke all on public.user_site_assignments,public.trip_loading_evidence from public,anon,authenticated,service_role;
grant select on public.user_site_assignments,public.trip_loading_evidence to authenticated;
create policy assignment_read on public.user_site_assignments for select to authenticated using (
  (profile_id=auth.uid() and private.has_role(array['loading_officer','offloading_officer']::public.app_role[]))
  or private.has_role(array['system_administrator','operations_manager','audit_reviewer']::public.app_role[]));
create policy evidence_read on public.trip_loading_evidence for select to authenticated using (
  (captured_by=auth.uid() and private.has_role(array['loading_officer']::public.app_role[]))
  or private.has_role(array['system_administrator','operations_manager','audit_reviewer']::public.app_role[]));
drop policy operational_read on public.drivers;
create policy operational_read on public.drivers for select to authenticated using (
  private.has_role(array['system_administrator','offloading_officer','operations_manager','finance_officer','audit_reviewer']::public.app_role[]));
create trigger audit_changes after insert or update or delete on public.user_site_assignments
for each row execute function private.capture_audit();
create trigger audit_changes after insert or update or delete on public.trip_loading_evidence
for each row execute function private.capture_audit();
-- An active assignment is required for uploads, but a later reassignment does not
-- remove an officer's ability to read their own historical evidence.
create function private.can_upload_loading_image(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role(array['loading_officer','system_administrator']::public.app_role[])
    and p_name ~ ('^'||auth.uid()::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$')
    and exists(select 1 from public.user_site_assignments a join public.sites s on s.id=a.site_id
      where a.profile_id=auth.uid() and a.ended_at is null and s.site_type='loading' and s.is_active);
$$;
create policy loading_evidence_upload on storage.objects for insert to authenticated
with check(bucket_id='loading-plate-evidence' and owner_id=auth.uid()::text and private.can_upload_loading_image(name));
create policy loading_evidence_read on storage.objects for select to authenticated using (
  bucket_id='loading-plate-evidence' and (
    (owner_id=auth.uid()::text and private.has_role(array['loading_officer']::public.app_role[]))
    or private.has_role(array['system_administrator','operations_manager','audit_reviewer']::public.app_role[])));
-- Restrictive fences prevent unrelated permissive Storage policies from granting
-- this bucket overwrite/delete or cross-owner access in an existing installation.
create policy loading_evidence_insert_fence on storage.objects as restrictive for insert to authenticated
with check(bucket_id<>'loading-plate-evidence' or (owner_id=auth.uid()::text and private.can_upload_loading_image(name)));
create policy loading_evidence_select_fence on storage.objects as restrictive for select to authenticated using (
  bucket_id<>'loading-plate-evidence' or ((owner_id=auth.uid()::text and private.has_role(array['loading_officer']::public.app_role[]))
    or private.has_role(array['system_administrator','operations_manager','audit_reviewer']::public.app_role[])));
create policy loading_evidence_update_fence on storage.objects as restrictive for update to authenticated
using(bucket_id<>'loading-plate-evidence') with check(bucket_id<>'loading-plate-evidence');
create policy loading_evidence_delete_fence on storage.objects as restrictive for delete to authenticated using(bucket_id<>'loading-plate-evidence');
create policy loading_evidence_anon_fence on storage.objects as restrictive for all to anon
using(bucket_id<>'loading-plate-evidence') with check(bucket_id<>'loading-plate-evidence');
revoke all on all functions in schema private from public,anon,authenticated,service_role;
grant execute on function private.has_role(public.app_role[]),private.can_upload_loading_image(text) to authenticated;
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('normalize_driver_phone','assign_user_site','register_loading_participant','create_loading_trip_v2','search_loading_drivers','lookup_loading_truck') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
    execute format('grant execute on function %s to authenticated',f);
  end loop;
end $$;
-- Last schema operation: protect the one-time rewrite while holding this strongest
-- audit lock for as little of the migration as practical. Maintenance window required.
lock table public.audit_log in access exclusive mode;
alter table public.audit_log disable trigger audit_immutable;
alter table public.audit_log disable trigger audit_immutable;
alter table public.audit_log disable trigger trg_protect_audit_log;
with history as materialized (
  -- Read historic bank values once, rather than rescanning audit_log for each row
  -- while ACCESS EXCLUSIVE is held. Old values may no longer be current master data.
  select driver_id,array_agg(distinct token) tokens from (
    select coalesce(p.driver_id,case when a.entity_name='driver_payment_details' then a.entity_id end) driver_id,x.token
    from public.audit_log a
    left join public.trip_payments p on a.entity_name='trip_payments' and p.id=a.entity_id
    cross join lateral private.audit_bank_tokens(jsonb_build_array(a.old_value,a.new_value)) x(token)
    where a.entity_name in ('driver_payment_details','trip_payments')
  ) h where driver_id is not null group by driver_id
), source as materialized (
  select a.id,a.entity_name,a.old_value,a.new_value,a.reason,
    private.audit_bank_values(a.entity_name,a.entity_id,a.old_value,a.new_value)||coalesce(h.tokens,array[]::text[]) tokens
  from public.audit_log a
  left join public.trip_payments p on a.entity_name='trip_payments' and p.id=a.entity_id
  left join public.notification_outbox n on a.entity_name='notification_outbox' and n.id=a.entity_id
  left join public.trip_payments np on np.trip_id=n.trip_id
  left join history h on h.driver_id=coalesce(p.driver_id,np.driver_id,
    case when a.entity_name='driver_payment_details' then a.entity_id end)
  where a.entity_name in ('driver_payment_details','trip_payments','notification_outbox')
)
update public.audit_log a set old_value=private.audit_projection(s.entity_name,s.old_value,s.tokens),
  new_value=private.audit_projection(s.entity_name,s.new_value,s.tokens),
  reason=private.audit_redact_text(s.reason,s.tokens)
from source s where a.id=s.id;
-- Restore normal audit-log immutability.
alter table public.audit_log enable trigger trg_protect_audit_log;
alter table public.audit_log enable trigger audit_immutable;
alter table public.audit_log enable trigger audit_immutable;
commit;
