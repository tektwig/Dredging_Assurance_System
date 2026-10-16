-- Synthetic fixture only. Apply to the unlinked local project produced by
-- scripts/materialize-hybrid-cutover-test.mjs, before copying migrations
-- 20261009000000 and later into that project's migration directory.
begin;

insert into auth.users(id,email,raw_user_meta_data) values
  ('f1000000-0000-4000-8000-000000000001','hybrid-admin@example.invalid','{}'),
  ('f1000000-0000-4000-8000-000000000002','hybrid-loader@example.invalid','{}'),
  ('f1000000-0000-4000-8000-000000000003','hybrid-offloader@example.invalid','{}'),
  ('f1000000-0000-4000-8000-000000000004','hybrid-operations@example.invalid','{}'),
  ('f1000000-0000-4000-8000-000000000005','hybrid-finance@example.invalid','{}');
update public.profiles set role=case id
    when 'f1000000-0000-4000-8000-000000000001' then 'system_administrator'::public.app_role
    when 'f1000000-0000-4000-8000-000000000002' then 'loading_officer'::public.app_role
    when 'f1000000-0000-4000-8000-000000000003' then 'offloading_officer'::public.app_role
    when 'f1000000-0000-4000-8000-000000000004' then 'operations_manager'::public.app_role
    when 'f1000000-0000-4000-8000-000000000005' then 'finance_officer'::public.app_role end,
  display_name=case id
    when 'f1000000-0000-4000-8000-000000000001' then 'Synthetic Administrator'
    when 'f1000000-0000-4000-8000-000000000002' then 'Synthetic Loading Officer'
    when 'f1000000-0000-4000-8000-000000000003' then 'Synthetic Offloading Officer'
    when 'f1000000-0000-4000-8000-000000000004' then 'Synthetic Operations Manager'
    else 'Synthetic Existing Finance Officer' end,
  is_active=true
where id::text like 'f1000000-0000-4000-8000-00000000000%';

insert into auth.sessions(id,user_id,created_at) values
  ('f2000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000002',statement_timestamp()),
  ('f2000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000003',statement_timestamp());
insert into public.sites(id,name,site_type,is_active) values
  ('f3000000-0000-4000-8000-000000000001','Synthetic Loading Yard','loading',true),
  ('f3000000-0000-4000-8000-000000000002','Synthetic Offloading Yard','offloading',true);

select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.assign_user_site('f1000000-0000-4000-8000-000000000002','f3000000-0000-4000-8000-000000000001');
select public.assign_user_site('f1000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000002');
reset role;

insert into storage.objects(bucket_id,name,owner_id,metadata) values
  ('loading-plate-evidence','f1000000-0000-4000-8000-000000000002/f5000000-0000-4000-8000-000000000001.jpg',
    'f1000000-0000-4000-8000-000000000002','{"mimetype":"image/jpeg","size":1000}'),
  ('loading-plate-evidence','f1000000-0000-4000-8000-000000000002/f5000000-0000-4000-8000-000000000002.jpg',
    'f1000000-0000-4000-8000-000000000002','{"mimetype":"image/jpeg","size":1000}'),
  ('loading-plate-evidence','f1000000-0000-4000-8000-000000000002/f5000000-0000-4000-8000-000000000003.jpg',
    'f1000000-0000-4000-8000-000000000002','{"mimetype":"image/jpeg","size":1000}'),
  ('offloading-plate-evidence','f1000000-0000-4000-8000-000000000003/f6000000-0000-4000-8000-000000000001.jpg',
    'f1000000-0000-4000-8000-000000000003','{"mimetype":"image/jpeg","size":1000}'),
  ('offloading-plate-evidence','f1000000-0000-4000-8000-000000000003/f6000000-0000-4000-8000-000000000002.jpg',
    'f1000000-0000-4000-8000-000000000003','{"mimetype":"image/jpeg","size":1000}'),
  ('offloading-plate-evidence','f1000000-0000-4000-8000-000000000003/f6000000-0000-4000-8000-000000000003.jpg',
    'f1000000-0000-4000-8000-000000000003','{"mimetype":"image/jpeg","size":1000}');

create table public.trip_payments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null unique references public.trips(id) on delete restrict,
  amount numeric(12,2) not null,
  status text not null,
  payment_reference text not null unique,
  created_at timestamptz not null default statement_timestamp()
);

alter table public.notification_outbox drop constraint notification_outbox_event_type_check;
alter table public.notification_outbox drop constraint notification_outbox_audience_check;
alter table public.notification_outbox drop constraint notification_outbox_status_check;
alter table public.notification_outbox
  add constraint notification_outbox_event_type_check check (event_type in ('trip_closed','waybill_ready')),
  add constraint notification_outbox_audience_check check (audience in ('driver','finance','client')),
  add constraint notification_outbox_status_check check (status in ('pending','processing','sent','failed'));

create or replace function private.snapshot_closed_trip() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status='open' and new.status='closed' then
    insert into public.trip_payments(trip_id,amount,status,payment_reference)
      values(new.id,new.quantity_tonnes,'pending','SYNTHETIC-'||new.trip_number);
    insert into public.notification_outbox(trip_id,event_type,audience,delivery_sequence,
      recipients,payload,status,sent_at)
    values(new.id,'trip_closed','finance',0,array['historical-finance@example.invalid'],
      jsonb_build_object('event','synthetic_historical_payment_notice'),
      case when new.truck_registration_at_loading='HYB-101' then 'sent' else 'pending' end,
      case when new.truck_registration_at_loading='HYB-101' then statement_timestamp() else null end);
  end if;
  return null;
end;
$$;
create trigger snapshot_closed_trip after update on public.trips
for each row when (old.status='open' and new.status='closed')
execute function private.snapshot_closed_trip();

create function public.claim_trip_notifications(p_limit integer default 5)
returns setof public.notification_outbox language sql security definer set search_path = '' as $$
  select n.* from public.notification_outbox n where n.event_type='trip_closed' limit p_limit;
$$;
grant execute on function public.claim_trip_notifications(integer) to service_role;
create function public.enqueue_waybill_ready_notifications(p_recipients text[])
returns integer language sql security definer set search_path = '' as $$ select 0; $$;
grant execute on function public.enqueue_waybill_ready_notifications(text[]) to service_role;
create function public.record_trip_payment(p_trip_id uuid,p_reference text)
returns void language plpgsql security definer set search_path = '' as $$ begin return; end; $$;
grant execute on function public.record_trip_payment(uuid,text) to authenticated;

-- These represent pre-cutover operational records on the hybrid schema. The
-- payment-free registration RPC is introduced only by migration 20261011.
insert into public.drivers(id,full_name,phone_number,email,license_number) values
  ('f7000000-0000-4000-8000-000000000001','Synthetic Driver Missing Email','08010000001',null,null),
  ('f7000000-0000-4000-8000-000000000002','Synthetic Driver With Email','08010000002','hybrid-driver@example.invalid',null),
  ('f7000000-0000-4000-8000-000000000003','Synthetic Driver For Post Cutover','08010000003',null,null);
insert into public.trucks(id,registration_number,driver_id,capacity,capacity_unit,truck_type,owner_name,owner_contact) values
  ('f7100000-0000-4000-8000-000000000001','HYB-101','f7000000-0000-4000-8000-000000000001',30,'tonnes','Tanker','Synthetic Owner 1',null),
  ('f7100000-0000-4000-8000-000000000002','HYB-102','f7000000-0000-4000-8000-000000000002',30,'tonnes','Tanker','Synthetic Owner 2',null),
  ('f7100000-0000-4000-8000-000000000003','HYB-103','f7000000-0000-4000-8000-000000000003',30,'tonnes','Tanker','Synthetic Owner 3',null);

create temp table hybrid_trip_ids(tag text primary key,trip_id uuid not null);
grant select,insert on pg_temp.hybrid_trip_ids to authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"f2000000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
insert into pg_temp.hybrid_trip_ids values ('HYB101',(public.create_loading_trip_v2('f4000000-0000-4000-8000-000000000001','HYB-101',
  'f7000000-0000-4000-8000-000000000001',
  (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
  'OCR',statement_timestamp(),28,'HYB101',0.98,
  'f1000000-0000-4000-8000-000000000002/f5000000-0000-4000-8000-000000000001.jpg',false)#>>'{trip,id}')::uuid);
insert into pg_temp.hybrid_trip_ids values ('HYB102',(public.create_loading_trip_v2('f4000000-0000-4000-8000-000000000002','HYB-102',
  'f7000000-0000-4000-8000-000000000002',
  (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
  'OCR',statement_timestamp(),28,'HYB102',0.98,
  'f1000000-0000-4000-8000-000000000002/f5000000-0000-4000-8000-000000000002.jpg',false)#>>'{trip,id}')::uuid);
insert into pg_temp.hybrid_trip_ids values ('HYB103',(public.create_loading_trip_v2('f4000000-0000-4000-8000-000000000003','HYB-103',
  'f7000000-0000-4000-8000-000000000003',
  (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
  'OCR',statement_timestamp(),28,'HYB103',0.98,
  'f1000000-0000-4000-8000-000000000002/f5000000-0000-4000-8000-000000000003.jpg',false)#>>'{trip,id}')::uuid);
reset role;

select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"f1000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"f2000000-0000-4000-8000-000000000003"}',true);
set local role authenticated;
select public.close_trip_v2('f8000000-0000-4000-8000-000000000001',
  (select trip_id from pg_temp.hybrid_trip_ids where tag='HYB101'),
  'HYB-101',(select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
  27,'OCR',statement_timestamp(),'HYB101',0.99,
  'f1000000-0000-4000-8000-000000000003/f6000000-0000-4000-8000-000000000001.jpg');
select public.close_trip_v2('f8000000-0000-4000-8000-000000000002',
  (select trip_id from pg_temp.hybrid_trip_ids where tag='HYB102'),
  'HYB-102',(select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
  27,'OCR',statement_timestamp(),'HYB102',0.99,
  'f1000000-0000-4000-8000-000000000003/f6000000-0000-4000-8000-000000000002.jpg');
reset role;

-- Trip closure queues deferred audit/lifecycle work; commit before altering
-- constraints on those tables, then build synthetic pre-cutover queue history.
commit;
begin;
insert into public.notification_outbox(trip_id,event_type,audience,delivery_sequence,recipients,payload,
  status,attempts,last_error,lease_token,lease_until)
values
  ((select trip_id from pg_temp.hybrid_trip_ids where tag='HYB101'),'waybill_ready','driver',0,array[]::text[],
    '{"kind":"synthetic_waybill"}','pending',2,'synthetic driver attempt history',null,null),
  ((select trip_id from pg_temp.hybrid_trip_ids where tag='HYB101'),'waybill_ready','client',0,null,
    '{"kind":"synthetic_waybill"}','pending',0,'synthetic company history',null,null),
  ((select trip_id from pg_temp.hybrid_trip_ids where tag='HYB102'),'waybill_ready','driver',0,array[]::text[],
    '{"kind":"synthetic_waybill"}','pending',1,'synthetic driver attempt history',null,null),
  ((select trip_id from pg_temp.hybrid_trip_ids where tag='HYB102'),'waybill_ready','client',0,array[]::text[],
    '{"kind":"synthetic_waybill"}','processing',4,'synthetic company attempt history',
    'f9000000-0000-4000-8000-000000000002',statement_timestamp()-interval '1 hour'),
  ((select trip_id from pg_temp.hybrid_trip_ids where tag='HYB102'),'waybill_ready','finance',0,
    array['legacy-finance@example.invalid'],'{"kind":"synthetic_waybill"}','pending',3,
    'synthetic finance delivery history',null,null);
update public.notification_outbox set status='processing',attempts=3,
  lease_token='f9000000-0000-4000-8000-000000000001',
  lease_until=statement_timestamp()-interval '1 hour',
  last_error='synthetic finance delivery history'
where trip_id=(select trip_id from pg_temp.hybrid_trip_ids where tag='HYB102')
  and event_type='waybill_ready' and audience='finance';

commit;
begin;
alter table public.notification_outbox drop constraint notification_outbox_trip_id_fkey;
alter table public.notification_outbox add constraint notification_outbox_trip_id_fkey
  foreign key (trip_id) references public.trip_payments(trip_id) on delete restrict;

-- Match the checked DEVELOPMENT truck type and the three bounded legacy fields.
alter table public.trucks
  alter column truck_type type character varying(100),
  alter column capacity_unit type character varying(100),
  alter column owner_name type character varying(100),
  alter column owner_contact type character varying(100);

commit;
