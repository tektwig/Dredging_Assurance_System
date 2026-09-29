-- Disposable local database ONLY, after all migrations. Everything rolls back.
begin;
create function pg_temp.assert_true(v boolean,m text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'Assertion failed: %',m; end if; end $$;
create function pg_temp.expect_error(q text,s text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlstate=s then return; end if;
    raise exception 'Expected %, got %',s,sqlstate;
  end;
  raise exception 'Expected error %',s;
end $$;
create function pg_temp.code(v jsonb,c text) returns void language plpgsql as $$
begin perform pg_temp.assert_true(v->>'ok'='false' and v->>'code'=c and jsonb_typeof(v->'details')='object','business code '||c); end $$;
create function pg_temp.side_effect_counts(p_truck uuid default null) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('drivers',(select count(*) from public.drivers),
 'banks',(select count(*) from public.driver_payment_details),'trucks',(select count(*) from public.trucks),
 'trips',(select count(*) from public.trips),'evidence',(select count(*) from public.trip_loading_evidence),
 'audits',(select count(*) from public.audit_log),'receipts',(select count(*) from private.loading_request_receipts),
 'regular_driver',(select driver_id from public.trucks where id=p_truck)); $$;
create temp table test_state(k text primary key,v jsonb);
grant all on test_state to authenticated;
insert into auth.users(id,email,raw_user_meta_data) values
 ('a0000000-0000-0000-0000-000000000001','alignment-admin@example.invalid','{}'),
 ('a0000000-0000-0000-0000-000000000002','alignment-loader@example.invalid','{"role":"system_administrator"}'),
 ('a0000000-0000-0000-0000-000000000003','alignment-offloader@example.invalid','{}'),
 ('a0000000-0000-0000-0000-000000000004','alignment-loader2@example.invalid','{}'),
 ('a0000000-0000-0000-0000-000000000005','alignment-inactive@example.invalid','{}'),
 ('a0000000-0000-0000-0000-000000000006','alignment-operations@example.invalid','{}');
select pg_temp.assert_true((select not is_active and role is null from public.profiles where id='a0000000-0000-0000-0000-000000000002'),'Auth metadata cannot grant role');
update public.profiles set role=case right(id::text,1)
 when '1' then 'system_administrator'::public.app_role when '3' then 'offloading_officer'::public.app_role
 when '6' then 'operations_manager'::public.app_role else 'loading_officer'::public.app_role end,
 is_active=right(id::text,1)<>'5' where id::text like 'a0000000-%';
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',true);
insert into public.sites(id,name,site_type) values
 ('a1000000-0000-0000-0000-000000000001','Alignment loading','loading'),
 ('a1000000-0000-0000-0000-000000000002','Alignment other loading','loading'),
 ('a1000000-0000-0000-0000-000000000003','Alignment offloading','offloading');
set local role authenticated;
select pg_temp.code(public.assign_user_site('a0000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000003'),'INVALID_SITE_ASSIGNMENT');
insert into test_state values('assignment',public.assign_user_site('a0000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001'));
select pg_temp.assert_true((select v->>'ok'='true' from test_state where k='assignment'),'administrator assigns loader');
select public.assign_user_site('a0000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000002',true);
create function pg_temp.register_driver(p_plate text,p_phone text,p_truck uuid default null,p_name text default 'Same Name') returns jsonb
language sql as $$ select public.register_loading_participant(gen_random_uuid(),p_plate,p_truck,null,p_name,p_phone,null,'SECRET_BANK','0123456789','SECRET_ACCOUNT_NAME'); $$;
create function pg_temp.open_trip(p_plate text,p_driver uuid,p_default boolean default false) returns jsonb language sql as $$
 select public.create_loading_trip_v2(gen_random_uuid(),p_plate,p_driver,
 (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),'MANUAL',clock_timestamp(),null,null,null,p_default); $$;

select pg_temp.assert_true(public.normalize_driver_phone('0801 234-5678')='+2348012345678','local normalization');
select pg_temp.assert_true(public.normalize_driver_phone('+234 (801) 2345678')='+2348012345678','international formatting');
select pg_temp.assert_true(public.normalize_driver_phone('0801ABC2345678') is null and public.normalize_driver_phone('2348012345678') is null,'no identity guessing');
insert into test_state values('registration',public.register_loading_participant('a2000000-0000-0000-0000-000000000001','ALN-123',null,null,'Same Name','08012345678',null,'SECRET_BANK','0123456789','SECRET_ACCOUNT_NAME'));
select pg_temp.assert_true((select v->>'ok'='true' and v->>'payment_details_captured'='true' and v::text !~ 'SECRET_|0123456789|account_number|bank_name|account_name' from test_state where k='registration'),'registration safe response');
select pg_temp.assert_true(public.register_loading_participant('a2000000-0000-0000-0000-000000000001','ignored-replay')=(select v from test_state where k='registration'),'registration replay returns first success');
insert into test_state values('registration_replay_counts',pg_temp.side_effect_counts());
select public.register_loading_participant('a2000000-0000-0000-0000-000000000001','different replay payload');
select pg_temp.assert_true((select v=pg_temp.side_effect_counts() from test_state where k='registration_replay_counts'),'registration replay has no side effects');
select pg_temp.assert_true((select count(*)=0 from public.driver_payment_details),'loading cannot read banks');
select pg_temp.assert_true((select count(*)=0 from public.trip_payments),'loading cannot read payment snapshots');
select pg_temp.assert_true((select count(*)=0 from public.drivers),'loading cannot enumerate drivers');
select pg_temp.assert_true((select count(*)=1 from public.profiles),'Phase 1 self profile scope');
select pg_temp.expect_error($q$insert into public.drivers(full_name,phone_number) values('bad','08077777777')$q$,'42501');
select pg_temp.expect_error($q$insert into public.driver_payment_details(driver_id,account_name,account_number,bank_name) values(gen_random_uuid(),'bad','0123456789','bad')$q$,'42501');
select pg_temp.expect_error($q$insert into public.trucks(registration_number,driver_id) values('bad',gen_random_uuid())$q$,'42501');
select pg_temp.expect_error($q$update public.trips set status='closed'$q$,'42501');
select pg_temp.expect_error($q$select * from private.loading_request_receipts$q$,'42501');
select pg_temp.expect_error($q$select public.create_loading_trip('ALN123')$q$,'42501');
select pg_temp.expect_error($q$select public.assign_user_site(auth.uid(),'a1000000-0000-0000-0000-000000000002')$q$,'42501');
select pg_temp.code(pg_temp.register_driver(' aln 123 ','08022345678'),'PLATE_ALREADY_REGISTERED');
select pg_temp.code(pg_temp.register_driver('ALN123','08022345678'),'PLATE_ALREADY_REGISTERED');
select pg_temp.code(pg_temp.register_driver('ALN456','+2348012345678'),'DRIVER_MATCH_REQUIRES_REVIEW');
select pg_temp.code(pg_temp.register_driver('ALN456','bad'),'INVALID_PHONE');
select pg_temp.code(pg_temp.register_driver('ALN456','08022345678',null,''),'INVALID_DRIVER_NAME');
select pg_temp.code(public.register_loading_participant(gen_random_uuid(),'ALN456',null,null,'B','08022345678','bad','B','0123456789','A'),'INVALID_EMAIL');
select pg_temp.code(public.register_loading_participant(gen_random_uuid(),'ALN456',null,null,'B','08022345678'),'PAYMENT_DETAILS_REQUIRED');
select pg_temp.code(public.register_loading_participant(gen_random_uuid(),'ALN456',null,null,'B','08022345678',null,'B','123','A'),'INVALID_ACCOUNT_NUMBER');
select pg_temp.code(public.register_loading_participant(gen_random_uuid(),'ALN456',null,null,'B','08022345678',null,repeat('x',201),'0123456789','A'),'INVALID_BANK_NAME');
select pg_temp.code(public.register_loading_participant(gen_random_uuid(),'ALN456',null,null,'B','08022345678',null,'B','0123456789',repeat('x',201)),'INVALID_ACCOUNT_NAME');
select pg_temp.code(public.register_loading_participant(null,'ALN456'),'INVALID_REQUEST_ID');
select pg_temp.code(pg_temp.register_driver('!!','08022345678'),'INVALID_PLATE');

-- Same name, different normalized identity is allowed. Existing truck registration
-- does not change its regular driver before a successful trip opening.
insert into test_state values('driver_b',pg_temp.register_driver('ALN123','08022345678',(select (v#>>'{truck,id}')::uuid from test_state where k='registration')));
select pg_temp.assert_true((select v->>'ok'='true' and v#>>'{truck,created}'='false' from test_state where k='driver_b'),'existing truck/new driver');
select pg_temp.assert_true((public.lookup_loading_truck('ALN123')#>>'{default_driver,id}')=(select v#>>'{driver,id}' from test_state where k='registration'),'registration preserves regular driver');
select pg_temp.assert_true(jsonb_array_length(public.search_loading_drivers('Same Name')->'drivers')=2,'duplicate names distinguishable');
select pg_temp.assert_true((select count(*)=2 from jsonb_array_elements(public.search_loading_drivers('Same Name')->'drivers') d where d->>'full_name'='Same Name' and d->>'id' in ((select v#>>'{driver,id}' from test_state where k='registration'),(select v#>>'{driver,id}' from test_state where k='driver_b'))),'duplicate names have distinct IDs');
select pg_temp.assert_true((select count(*)=1 from jsonb_array_elements(public.search_loading_drivers('08012345678')->'drivers') d where d->>'id'=(select v#>>'{driver,id}' from test_state where k='registration')),'local phone search');
select pg_temp.assert_true((select count(*)=1 from jsonb_array_elements(public.search_loading_drivers('0801 234 5678')->'drivers') d where d->>'id'=(select v#>>'{driver,id}' from test_state where k='registration')),'formatted local phone search');
select pg_temp.assert_true((select count(*)=1 from jsonb_array_elements(public.search_loading_drivers('+2348012345678')->'drivers') d where d->>'id'=(select v#>>'{driver,id}' from test_state where k='registration')),'international phone search');
select pg_temp.assert_true((select count(*)=1 from jsonb_array_elements(public.search_loading_drivers('2348012345678')->'drivers') d where d->>'id'=(select v#>>'{driver,id}' from test_state where k='registration')),'international digits phone search');
select pg_temp.assert_true((select count(*)=1 from jsonb_array_elements(public.search_loading_drivers('8012345678')->'drivers') d where d->>'id'=(select v#>>'{driver,id}' from test_state where k='registration')),'phone fragment search');
select pg_temp.code(public.search_loading_drivers('Sa'),'INVALID_SEARCH');
select pg_temp.code(public.search_loading_drivers('Same',21),'INVALID_SEARCH');
select pg_temp.assert_true(public.search_loading_drivers('Same')::text !~ 'SECRET_|account_number|bank_name','search safe');
insert into test_state values('truck_b',public.register_loading_participant(gen_random_uuid(),'ALN456',null,(select (v#>>'{driver,id}')::uuid from test_state where k='driver_b')));
select pg_temp.assert_true((select v->>'ok'='true' and v#>>'{driver,created}'='false' from test_state where k='truck_b'),'new truck/existing driver');
select pg_temp.code(public.register_loading_participant(gen_random_uuid(),'ALN123',(select (v#>>'{truck,id}')::uuid from test_state where k='registration'),(select (v#>>'{driver,id}')::uuid from test_state where k='driver_b')),'INVALID_REGISTRATION_MODE');
select pg_temp.code(pg_temp.register_driver('MISMATCH','08032345678',(select (v#>>'{truck,id}')::uuid from test_state where k='registration')),'TRUCK_PLATE_MISMATCH');
select pg_temp.code(pg_temp.register_driver('MISSING','08032345678',gen_random_uuid()),'TRUCK_NOT_FOUND');

insert into test_state values('trip_a',public.create_loading_trip_v2('a2000000-0000-0000-0000-000000000002','ALN-123',
 (select (v#>>'{driver,id}')::uuid from test_state where k='registration'),(select (v->>'assignment_id')::uuid from test_state where k='assignment'),'MANUAL',clock_timestamp()));
select pg_temp.assert_true((select v->>'ok'='true' and v#>>'{trip,quantity_tonnes}' is null from test_state where k='trip_a'),'default-driver manual trip');
select pg_temp.assert_true(public.create_loading_trip_v2('a2000000-0000-0000-0000-000000000002',null,null,null,null,null)=(select v from test_state where k='trip_a'),'opening idempotent');
insert into test_state values('opening_replay_counts',pg_temp.side_effect_counts((select (v#>>'{truck,id}')::uuid from test_state where k='registration')));
select public.create_loading_trip_v2('a2000000-0000-0000-0000-000000000002','ALN456',(select (v#>>'{driver,id}')::uuid from test_state where k='driver_b'),null,'OCR',null,null,null,null,true);
select pg_temp.assert_true((select v=pg_temp.side_effect_counts((select (v#>>'{truck,id}')::uuid from test_state where k='registration')) from test_state where k='opening_replay_counts'),'opening replay has no side effects');
select pg_temp.code(pg_temp.open_trip('ALN123',(select (v#>>'{driver,id}')::uuid from test_state where k='driver_b'),true),'OPEN_TRIP_EXISTS');
select pg_temp.assert_true((public.lookup_loading_truck('ALN123')#>>'{default_driver,id}')=(select v#>>'{driver,id}' from test_state where k='registration'),'failed opening leaves regular driver');
select pg_temp.code(pg_temp.register_driver('ALN123','08032345678',(select (v#>>'{truck,id}')::uuid from test_state where k='registration')),'OPEN_TRIP_EXISTS');
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000003',true);
select pg_temp.assert_true(public.close_trip((select (v#>>'{trip,id}')::uuid from test_state where k='trip_a'),'a1000000-0000-0000-0000-000000000003',10)->>'ok'='true','offloading closes V2');
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000002',true);
insert into test_state values('trip_b',pg_temp.open_trip('ALN123',(select (v#>>'{driver,id}')::uuid from test_state where k='driver_b')));
select pg_temp.assert_true((select v->>'ok'='true' from test_state where k='trip_b'),'same-day different driver opens');
select pg_temp.assert_true((select driver_id=(select (v#>>'{driver,id}')::uuid from test_state where k='registration') and driver_name_at_loading='Same Name'
 from public.trips where id=(select (v#>>'{trip,id}')::uuid from test_state where k='trip_a')),'historical trip A remains A');
select pg_temp.assert_true((select count(*)=1 from public.daily_registrations where truck_id=(select (v#>>'{truck,id}')::uuid from test_state where k='registration')),'one registration per truck/day');
select pg_temp.assert_true((public.lookup_loading_truck('ALN123')#>>'{default_driver,id}')=(select v#>>'{driver,id}' from test_state where k='registration'),'different trip driver does not change regular driver');
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000003',true);
select public.close_trip((select (v#>>'{trip,id}')::uuid from test_state where k='trip_b'),'a1000000-0000-0000-0000-000000000003',11);
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000002',true);
insert into test_state values('trip_c',pg_temp.open_trip('ALN123',(select (v#>>'{driver,id}')::uuid from test_state where k='driver_b'),true));
select pg_temp.assert_true((select v->>'default_driver_changed'='true' from test_state where k='trip_c'),'regular driver changed on success');
select pg_temp.assert_true((public.lookup_loading_truck('ALN123')#>>'{default_driver,id}')=(select v#>>'{driver,id}' from test_state where k='driver_b'),'new regular driver persisted');
select pg_temp.assert_true(public.create_loading_trip_v2('a2000000-0000-0000-0000-000000000002',null,null,null,null,null)=(select v from test_state where k='trip_a'),'replay after closure returns original successful operation');

-- Full business validation without mutating master state.
create function pg_temp.try_open(p_patch jsonb default '{}') returns jsonb language plpgsql as $$
declare p jsonb:=jsonb_build_object('request',gen_random_uuid(),'plate','ALN456','driver',(select v#>>'{driver,id}' from test_state where k='driver_b'),
 'assignment',(select v->>'assignment_id' from test_state where k='assignment'),'method','MANUAL','time',clock_timestamp(),'default',false)||p_patch;
begin return public.create_loading_trip_v2((p->>'request')::uuid,p->>'plate',(p->>'driver')::uuid,(p->>'assignment')::uuid,p->>'method',(p->>'time')::timestamptz,
 p->>'ocr',(p->>'confidence')::numeric,p->>'image',(p->>'default')::boolean); end $$;
select pg_temp.code(pg_temp.try_open('{"request":null}'),'INVALID_REQUEST_ID');
select pg_temp.code(pg_temp.try_open('{"plate":"!!"}'),'INVALID_PLATE');
select pg_temp.code(pg_temp.try_open('{"driver":null}'),'DRIVER_REQUIRED');
select pg_temp.code(pg_temp.try_open('{"default":null}'),'INVALID_DEFAULT_OPTION');
select pg_temp.code(pg_temp.try_open('{"assignment":null}'),'SITE_REVIEW_REQUIRED');
select pg_temp.code(pg_temp.try_open(jsonb_build_object('assignment',gen_random_uuid())),'SITE_ASSIGNMENT_CHANGED');
select pg_temp.code(pg_temp.try_open('{"method":"CAMERA"}'),'INVALID_CAPTURE_METHOD');
select pg_temp.code(pg_temp.try_open('{"time":null}'),'INVALID_CAPTURE_TIMESTAMP');
select pg_temp.code(pg_temp.try_open('{"time":"infinity"}'),'INVALID_CAPTURE_TIMESTAMP');
select pg_temp.code(pg_temp.try_open(jsonb_build_object('time',clock_timestamp()+interval '1 hour')),'INVALID_CAPTURE_TIMESTAMP');
select pg_temp.code(pg_temp.try_open('{"ocr":"ALN456"}'),'INVALID_OCR_DATA');
select pg_temp.code(pg_temp.try_open('{"method":"OCR"}'),'INVALID_OCR_DATA');
select pg_temp.code(pg_temp.try_open('{"plate":"UNKNOWN"}'),'UNKNOWN_TRUCK');
select pg_temp.code(pg_temp.try_open(jsonb_build_object('driver',gen_random_uuid())),'DRIVER_NOT_FOUND');
select pg_temp.code(pg_temp.try_open('{"image":"someone/invalid.jpg"}'),'INVALID_IMAGE_REFERENCE');
select pg_temp.code(pg_temp.try_open('{"image":"a0000000-0000-0000-0000-000000000002/b0000000-0000-0000-0000-000000000099.jpg"}'),'IMAGE_NOT_FOUND');

-- SQL Storage metadata/policies only; no files are uploaded by this fixture.
insert into storage.objects(bucket_id,name,owner_id,metadata) values
 ('loading-plate-evidence','a0000000-0000-0000-0000-000000000002/b0000000-0000-0000-0000-000000000001.jpg',auth.uid()::text,'{"mimetype":"image/jpeg","size":1000}'),
 ('loading-plate-evidence','a0000000-0000-0000-0000-000000000002/b0000000-0000-0000-0000-000000000002.png',auth.uid()::text,'{"mimetype":"image/png","size":1000}'),
 ('loading-plate-evidence','a0000000-0000-0000-0000-000000000002/b0000000-0000-0000-0000-000000000003.jpg',auth.uid()::text,'{"mimetype":"image/jpeg","size":9999999}');
select pg_temp.code(pg_temp.try_open('{"image":"a0000000-0000-0000-0000-000000000002/b0000000-0000-0000-0000-000000000003.jpg"}'),'INVALID_IMAGE_REFERENCE');
select pg_temp.code(pg_temp.try_open('{"method":"OCR","ocr":"ALN456","confidence":2,"image":"a0000000-0000-0000-0000-000000000002/b0000000-0000-0000-0000-000000000001.jpg"}'),'INVALID_OCR_DATA');
select pg_temp.code(pg_temp.try_open('{"method":"OCR_CORRECTED","ocr":"ALN456","image":"a0000000-0000-0000-0000-000000000002/b0000000-0000-0000-0000-000000000001.jpg"}'),'INVALID_OCR_DATA');
insert into test_state values('ocr_trip',pg_temp.try_open('{"method":"OCR","ocr":"aln-456","confidence":0.95,"image":"a0000000-0000-0000-0000-000000000002/b0000000-0000-0000-0000-000000000001.jpg"}'));
select pg_temp.assert_true((select v->>'ok'='true' from test_state where k='ocr_trip'),'OCR confirmed opening');
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000003',true);
select public.close_trip((select (v#>>'{trip,id}')::uuid from test_state where k='ocr_trip'),'a1000000-0000-0000-0000-000000000003',12);
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000002',true);
select pg_temp.code(pg_temp.try_open('{"image":"a0000000-0000-0000-0000-000000000002/b0000000-0000-0000-0000-000000000001.jpg"}'),'IMAGE_ALREADY_USED');
insert into test_state values('corrected_trip',pg_temp.try_open('{"method":"OCR_CORRECTED","ocr":"ALN458","confidence":0.65,"image":"a0000000-0000-0000-0000-000000000002/b0000000-0000-0000-0000-000000000002.png"}'));
select pg_temp.assert_true((select v->>'ok'='true' from test_state where k='corrected_trip'),'OCR corrected opening');
select pg_temp.expect_error($q$update public.trip_loading_evidence set confirmed_plate='BAD'$q$,'42501');
insert into test_state values('storage_before',(select jsonb_agg(jsonb_build_object('name',name,'metadata',metadata,'owner_id',owner_id) order by name) from storage.objects where bucket_id='loading-plate-evidence'));
with attempted as (delete from storage.objects where bucket_id='loading-plate-evidence' returning id)
 select pg_temp.assert_true((select count(*)=0 from attempted),'Storage DELETE target rejected by RLS');
with attempted as (update storage.objects set metadata='{}' where bucket_id='loading-plate-evidence' returning id)
 select pg_temp.assert_true((select count(*)=0 from attempted),'Storage UPDATE target rejected by RLS');
select pg_temp.assert_true((select v is not distinct from (select jsonb_agg(jsonb_build_object('name',name,'metadata',metadata,'owner_id',owner_id) order by name) from storage.objects where bucket_id='loading-plate-evidence') from test_state where k='storage_before'),'Storage delete/update left rows unchanged');
select pg_temp.expect_error($q$insert into storage.objects(bucket_id,name,owner_id) values('loading-plate-evidence','a0000000-0000-0000-0000-000000000004/b0000000-0000-0000-0000-000000000001.jpg',auth.uid()::text)$q$,'42501');

-- Authorization and site validation.
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000004',true);
select pg_temp.code(pg_temp.try_open(),'SITE_ASSIGNMENT_REQUIRED');
select pg_temp.assert_true((select count(*)=0 from storage.objects where bucket_id='loading-plate-evidence'),'other loader cannot read images');
select pg_temp.assert_true((select count(*)=0 from public.trip_loading_evidence),'other loader cannot read evidence');
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000005',true);
select pg_temp.expect_error($q$select pg_temp.try_open()$q$,'42501');
select pg_temp.expect_error($q$select pg_temp.register_driver('NEW','08032345678')$q$,'42501');
select pg_temp.assert_true((select count(*)=0 from public.trips),'inactive operational reads denied');
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000003',true);
select pg_temp.expect_error($q$select pg_temp.try_open()$q$,'42501');
select pg_temp.expect_error($q$select pg_temp.register_driver('NEW','08032345678')$q$,'42501');
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000006',true);
select pg_temp.assert_true((select count(*)=3 from storage.objects where bucket_id='loading-plate-evidence'),'operations evidence read');
select pg_temp.expect_error($q$select pg_temp.try_open()$q$,'42501');
reset role;
select pg_temp.assert_true(pg_get_functiondef('private.lock_loading_actor()'::regprocedure) ~* 'for no key update'
 and pg_get_functiondef('public.assign_user_site(uuid,uuid)'::regprocedure) ~* 'for no key update',
 'profile serialization uses FK-compatible NO KEY UPDATE locks');

-- Privileged fixture mutations test server validation, not client capabilities.
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',true);
select public.cancel_trip((select (v#>>'{trip,id}')::uuid from test_state where k='corrected_trip'),'Fixture release');
update public.trucks set is_active=false where id=(select (v#>>'{truck,id}')::uuid from test_state where k='truck_b');
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000002',true);
select pg_temp.code(pg_temp.try_open(),'INACTIVE_TRUCK');
update public.trucks set is_active=true where id=(select (v#>>'{truck,id}')::uuid from test_state where k='truck_b');
update public.drivers set is_active=false where id=(select (v#>>'{driver,id}')::uuid from test_state where k='driver_b');
select pg_temp.code(pg_temp.try_open(),'INACTIVE_DRIVER');
update public.drivers set is_active=true where id=(select (v#>>'{driver,id}')::uuid from test_state where k='driver_b');
update public.sites set is_active=false where id='a1000000-0000-0000-0000-000000000001';
select pg_temp.code(pg_temp.try_open(),'INACTIVE_SITE');
update public.sites set is_active=true where id='a1000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',true);
select public.assign_user_site('a0000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000002');
select pg_temp.assert_true((select count(*)=2 from public.user_site_assignments where profile_id='a0000000-0000-0000-0000-000000000002'),'assignment history retained');
select pg_temp.expect_error($q$update public.user_site_assignments set site_id='a1000000-0000-0000-0000-000000000001'$q$,'23514');
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000002',true);
select pg_temp.code(pg_temp.try_open(),'SITE_ASSIGNMENT_CHANGED');
select pg_temp.assert_true((select loading_site_id='a1000000-0000-0000-0000-000000000001' from public.trips where id=(select (v#>>'{trip,id}')::uuid from test_state where k='trip_a')),'assignment move preserves trip site');
update test_state set v=jsonb_build_object('assignment_id',(select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null)) where k='assignment';
insert into test_state values('blocking',to_jsonb(public.raise_trip_exception('dispute','Fixture blocking issue',
 (select (v#>>'{truck,id}')::uuid from test_state where k='truck_b'),null,null,true)));
select pg_temp.code(pg_temp.try_open(),'BLOCKING_EXCEPTION');
select pg_temp.code(pg_temp.register_driver('ALN456','08042345678',(select (v#>>'{truck,id}')::uuid from test_state where k='truck_b')),'BLOCKING_EXCEPTION');
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',true);
select public.resolve_trip_exception((select (v#>>'{}')::uuid from test_state where k='blocking'),'Fixture resolved');
-- Administrators can be assigned either site type, but loading still requires loading.
select public.assign_user_site(auth.uid(),'a1000000-0000-0000-0000-000000000003');
select pg_temp.code(pg_temp.try_open(),'INVALID_SITE_ASSIGNMENT');
select public.assign_user_site(auth.uid(),'a1000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000002',true);
select pg_temp.expect_error($q$update public.trip_loading_evidence set confirmed_plate='BAD'$q$,'23514');
select pg_temp.expect_error($q$delete from public.trip_loading_evidence$q$,'23514');
select pg_temp.expect_error($q$update public.daily_registrations set initial_driver_id=gen_random_uuid()$q$,'23514');
select pg_temp.expect_error($q$update public.trips set driver_name_at_loading='Tampered' where status='open'$q$,'23514');
select pg_temp.expect_error($q$update public.audit_log set reason='Tampered'$q$,'23514');
update public.drivers set full_name='Changed later' where id=(select (v#>>'{driver,id}')::uuid from test_state where k='registration');
select pg_temp.assert_true((select driver_name_at_loading='Same Name' from public.trips where id=(select (v#>>'{trip,id}')::uuid from test_state where k='trip_a')),'name snapshot survives master changes');

-- Index protection independently of the friendly RPC check.
select pg_temp.expect_error($q$insert into public.trips(truck_id,driver_id,daily_registration_id,loading_site_id,opened_by,driver_name_at_loading,loading_assignment_id)
 select truck_id,driver_id,daily_registration_id,'a1000000-0000-0000-0000-000000000002',opened_by,driver_name_at_loading,
 (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null)
 from public.trips where id=(select (v#>>'{trip,id}')::uuid from test_state where k='trip_c')$q$,'23505');
select pg_temp.expect_error($q$insert into public.trips(truck_id,driver_id,daily_registration_id,loading_site_id,opened_by,driver_name_at_loading,loading_assignment_id)
 select (select (v#>>'{truck,id}')::uuid from test_state where k='truck_b'),driver_id,daily_registration_id,
 'a1000000-0000-0000-0000-000000000002',opened_by,driver_name_at_loading,
 (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null)
 from public.trips where id=(select (v#>>'{trip,id}')::uuid from test_state where k='trip_c')$q$,'23514');
alter table public.daily_registrations disable trigger registration_guard;
insert into public.daily_registrations(id,truck_id,initial_driver_id,operational_date,registered_at,registered_by)
 values('a3000000-0000-0000-0000-000000000001',(select (v#>>'{truck,id}')::uuid from test_state where k='truck_b'),
 (select (v#>>'{driver,id}')::uuid from test_state where k='driver_b'),
 ((statement_timestamp()-interval '1 day') at time zone 'Africa/Lagos')::date,statement_timestamp()-interval '1 day',auth.uid());
alter table public.daily_registrations enable trigger registration_guard;
select pg_temp.expect_error($q$insert into public.trips(truck_id,driver_id,daily_registration_id,loading_site_id,opened_by,driver_name_at_loading,loading_assignment_id)
 values((select (v#>>'{truck,id}')::uuid from test_state where k='truck_b'),(select (v#>>'{driver,id}')::uuid from test_state where k='driver_b'),
 'a3000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000002',auth.uid(),'Name',
 (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null))$q$,'23514');

-- Atomic failure injection after bank insertion proves rollback of ALL master writes.
create function pg_temp.fail_truck() returns trigger language plpgsql as $$ begin raise exception 'Injected truck failure'; end $$;
create trigger test_fail_truck before insert on public.trucks for each row execute function pg_temp.fail_truck();
select pg_temp.expect_error($q$select pg_temp.register_driver('ROLLBACK','08032345678')$q$,'P0001');
select pg_temp.assert_true(not exists(select 1 from public.drivers where normalized_phone='+2348032345678'),'no orphan driver after failure');
select pg_temp.assert_true(not exists(select 1 from public.audit_log where entity_name='drivers' and new_value->>'normalized_phone'='+2348032345678'),'audit rollback');
drop trigger test_fail_truck on public.trucks;
select pg_temp.assert_true(pg_temp.register_driver('ROLLBACK','08032345678')->>'ok'='true','failed operation does not poison future registration');

-- Receipt insertion occurs after the regular-driver UPDATE. Injecting failure there
-- proves that a Driver B -> Driver A reassignment and all earlier writes roll back.
select pg_temp.assert_true((select driver_id=(select (v#>>'{driver,id}')::uuid from test_state where k='driver_b') from public.trucks where id=(select (v#>>'{truck,id}')::uuid from test_state where k='truck_b')),'rollback setup has Driver B as regular driver');
insert into test_state values('rollback_counts',pg_temp.side_effect_counts((select (v#>>'{truck,id}')::uuid from test_state where k='truck_b')));
create function pg_temp.fail_receipt() returns trigger language plpgsql as $$ begin raise exception 'Injected receipt failure'; end $$;
create trigger test_fail_receipt before insert on private.loading_request_receipts for each row execute function pg_temp.fail_receipt();
select pg_temp.expect_error($q$select pg_temp.try_open(jsonb_build_object('request','a2000000-0000-0000-0000-000000000005','driver',(select v#>>'{driver,id}' from test_state where k='registration'),'default',true))$q$,'P0001');
select pg_temp.assert_true((select v=pg_temp.side_effect_counts((select (v#>>'{truck,id}')::uuid from test_state where k='truck_b')) from test_state where k='rollback_counts'),'failed different-driver reassignment rolled back all side effects');
drop trigger test_fail_receipt on private.loading_request_receipts;
select pg_temp.assert_true(pg_temp.try_open(jsonb_build_object('request','a2000000-0000-0000-0000-000000000005','driver',(select v#>>'{driver,id}' from test_state where k='registration'),'default',true))->>'ok'='true','same request succeeds after system failure');
select pg_temp.assert_true((select driver_id=(select (v#>>'{driver,id}')::uuid from test_state where k='registration') from public.trucks where id=(select (v#>>'{truck,id}')::uuid from test_state where k='truck_b')),'successful retry changes regular driver');
select pg_temp.assert_true(not has_function_privilege('service_role','public.create_loading_trip_v2(uuid,text,uuid,uuid,text,timestamptz,text,numeric,text,boolean)','EXECUTE'),'worker cannot open');
select pg_temp.assert_true(not has_function_privilege('authenticated','private.loading_replay(text,uuid)','EXECUTE'),'receipt helper private');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.user_site_assignments','INSERT,UPDATE,DELETE'),'assignment direct writes denied');
select pg_temp.assert_true(not exists(select 1 from public.exceptions where entered_plate in('UNKNOWN','!!')),'validation does not create operational exceptions');

select pg_temp.assert_true(not exists(select 1 from public.audit_log where
 coalesce(old_value,'{}')::text||coalesce(new_value,'{}')::text||coalesce(reason,'') ~ 'SECRET_|0123456789|UPGRADE_PRIVATE|0199999999'),'no banking values in any audit JSON/reason');
select pg_temp.assert_true(exists(select 1 from public.audit_log where entity_name='driver_payment_details' and action='INSERT'),'payment capture audited');
select pg_temp.assert_true(exists(select 1 from public.audit_log where entity_name='loading_registration'),'registration audited');
select pg_temp.assert_true(exists(select 1 from public.audit_log where entity_name='loading_trip_opened' and new_value->>'different_driver_selected'='true'),'different driver audited');
select pg_temp.assert_true(exists(select 1 from public.audit_log where entity_name='loading_trip_opened' and new_value->>'default_driver_changed'='true'),'default reassignment audited');
select pg_temp.assert_true(exists(select 1 from public.audit_log where entity_name='trip_loading_evidence' and new_value->>'capture_method'='OCR_CORRECTED'),'correction audited');
select pg_temp.assert_true(exists(select 1 from public.trip_payments where trip_id=(select (v#>>'{trip,id}')::uuid from test_state where k='trip_b') and driver_id=(select (v#>>'{driver,id}')::uuid from test_state where k='driver_b')),'closure snapshots actual driver B');
select pg_temp.assert_true(not exists(select 1 from private.loading_request_receipts where response::text ~ 'SECRET_|0123456789'),'receipts safe');
-- Fire deferred evidence constraints inside the test rather than losing them at rollback.
set constraints all immediate;
set local role anon;
select pg_temp.expect_error($q$select public.lookup_loading_truck('ALN123')$q$,'42501');
select pg_temp.expect_error($q$select public.create_loading_trip('ALN123')$q$,'42501');
reset role;
rollback;
