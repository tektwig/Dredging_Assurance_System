-- Disposable local database only. Exercises the post-00500 Waybill contract.
begin;
create function pg_temp.waybill_assert(v boolean,m text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'Waybill assertion failed: %',m; end if; end $$;
create function pg_temp.waybill_counts() returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object('waybills',(select count(*) from public.trip_closure_invoices),
    'payments',(select count(*) from public.trip_payments),
    'evidence',(select count(*) from public.trip_offloading_evidence),
    'notifications',(select count(*) from public.notification_outbox),
    'receipts',(select count(*) from private.offloading_request_receipts));
$$;
create function pg_temp.waybill_mutation_denied(q text) returns void language plpgsql as $$
begin
  begin execute q; exception when check_violation then return; end;
  raise exception 'Waybill mutation unexpectedly succeeded';
end $$;
create temp table waybill_state(k text primary key,v jsonb);
grant all on waybill_state to authenticated;

-- Existing rows are not rewritten or assigned invented banking/officer values.
select pg_temp.waybill_assert((select bool_and(is_nullable='YES') from information_schema.columns
  where table_schema='public' and table_name='trip_closure_invoices'
    and column_name in ('driver_email','bank_name','account_name','account_number',
      'loading_officer_id','loading_officer_name','offloading_officer_id','offloading_officer_name')),
  'new historical snapshot columns remain nullable');
select pg_temp.waybill_assert((select count(*)=8 from information_schema.columns
  where table_schema='public' and table_name='trip_closure_invoices'
    and column_name in ('driver_email','bank_name','account_name','account_number',
      'loading_officer_id','loading_officer_name','offloading_officer_id','offloading_officer_name')),
  'all eight snapshot columns exist');
select pg_temp.waybill_assert((select count(*)=2 from pg_trigger
  where tgrelid='public.trips'::regclass and not tgisinternal and tgenabled='O'
    and tgname in ('create_trip_closure_invoice','snapshot_closed_trip')),
  'both closure triggers remain enabled');
select pg_temp.waybill_assert('create_trip_closure_invoice' < 'snapshot_closed_trip',
  'invoice trigger executes before notification snapshot by trigger name');
-- An absent bank row cannot be locked. Payment must consume the immutable
-- invoice snapshot, not query driver_payment_details a second time.
select pg_temp.waybill_assert(
  position('driver_payment_details' in pg_get_functiondef('private.snapshot_closed_trip()'::regprocedure))=0
  and position('from public.trip_closure_invoices' in
    pg_get_functiondef('private.snapshot_closed_trip()'::regprocedure))>0,
  'payment trigger consumes the invoice bank snapshot without a second live-bank read');
select pg_temp.waybill_assert(
  not has_table_privilege('anon','public.trip_closure_invoices','SELECT')
  and has_table_privilege('authenticated','public.trip_closure_invoices','SELECT')
  and not has_table_privilege('authenticated','public.trip_closure_invoices','INSERT')
  and not has_table_privilege('authenticated','public.trip_closure_invoices','UPDATE')
  and not has_table_privilege('authenticated','public.trip_closure_invoices','DELETE'),
  'table grants permit RLS-controlled reads only for authenticated users');

insert into auth.users(id,email,raw_user_meta_data) values
 ('f9000000-0000-0000-0000-000000000001','wb-admin@example.invalid','{}'),
 ('f9000000-0000-0000-0000-000000000002','wb-loader@example.invalid','{}'),
 ('f9000000-0000-0000-0000-000000000003','wb-offloader@example.invalid','{}'),
 ('f9000000-0000-0000-0000-000000000004','wb-ops@example.invalid','{}'),
 ('f9000000-0000-0000-0000-000000000005','wb-finance@example.invalid','{}'),
 ('f9000000-0000-0000-0000-000000000006','wb-audit@example.invalid','{}');
update public.profiles set display_name=case right(id::text,1)
 when '1' then 'Waybill Administrator' when '2' then 'Loading Officer Snapshot'
 when '3' then 'Offloading Officer Snapshot' when '4' then 'Operations Manager'
 when '5' then 'Finance Officer' else 'Audit Reviewer' end,
 role=case right(id::text,1)
 when '1' then 'system_administrator'::public.app_role when '2' then 'loading_officer'::public.app_role
 when '3' then 'offloading_officer'::public.app_role when '4' then 'operations_manager'::public.app_role
 when '5' then 'finance_officer'::public.app_role else 'audit_reviewer'::public.app_role end,
 is_active=true where id::text like 'f9000000-%';
select set_config('request.jwt.claim.sub','f9000000-0000-0000-0000-000000000001',true);
insert into public.sites(id,name,site_type,is_active) values
 ('f9100000-0000-0000-0000-000000000001','Waybill Loading','loading',true),
 ('f9100000-0000-0000-0000-000000000002','Waybill Offloading','offloading',true);
insert into public.drivers(id,full_name,phone_number,email,license_number) values
 ('f9200000-0000-0000-0000-000000000001','Banked Driver','08018880001','wb-driver@example.invalid','LIC-WB-1'),
 ('f9200000-0000-0000-0000-000000000002','No Bank Driver','08018880002',null,'LIC-WB-2');
insert into public.driver_payment_details(driver_id,bank_name,account_name,account_number) values
 ('f9200000-0000-0000-0000-000000000001','Waybill Bank','Waybill Account','0123456789');
insert into public.trucks(id,registration_number,driver_id) values
 ('f9300000-0000-0000-0000-000000000001','WB-101','f9200000-0000-0000-0000-000000000001'),
 ('f9300000-0000-0000-0000-000000000002','WB-202','f9200000-0000-0000-0000-000000000002');
set local role authenticated;
select public.assign_user_site('f9000000-0000-0000-0000-000000000002','f9100000-0000-0000-0000-000000000001');
select public.assign_user_site('f9000000-0000-0000-0000-000000000003','f9100000-0000-0000-0000-000000000002');
select set_config('request.jwt.claim.sub','f9000000-0000-0000-0000-000000000002',true);
insert into waybill_state values('opened_bank',public.create_loading_trip_v2(
 'f9400000-0000-0000-0000-000000000001','WB-101','f9200000-0000-0000-0000-000000000001',
 (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
 'MANUAL',clock_timestamp(),15.00));
insert into waybill_state values('opened_missing',public.create_loading_trip_v2(
 'f9400000-0000-0000-0000-000000000002','WB-202','f9200000-0000-0000-0000-000000000002',
 (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
 'MANUAL',clock_timestamp(),14.00));
select pg_temp.waybill_assert((select count(*)=2 from waybill_state where v->>'ok'='true'),
  'both trips opened through loading contract');
select set_config('request.jwt.claim.sub','f9000000-0000-0000-0000-000000000003',true);
insert into waybill_state values('closed_bank',public.close_trip_v2(
 'f9500000-0000-0000-0000-000000000001',
 (select (v#>>'{trip,id}')::uuid from waybill_state where k='opened_bank'),'WB-101',
 (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
 25.50,'MANUAL',clock_timestamp()));
insert into waybill_state values('closed_missing',public.close_trip_v2(
 'f9500000-0000-0000-0000-000000000002',
 (select (v#>>'{trip,id}')::uuid from waybill_state where k='opened_missing'),'WB-202',
 (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
 10.25,'MANUAL',clock_timestamp()));
select pg_temp.waybill_assert((select count(*)=2 from waybill_state
  where k like 'closed_%' and v->>'ok'='true' and v#>>'{trip,status}'='closed'
    and v#>>'{waybill,invoice_number}' ~ '^INV-[0-9]{4}-[0-9]{6}$'
    and v::text !~ '0123456789|Waybill Bank|Waybill Account|account_number|bank_name|account_name'),
  'both narrow closure responses include invoice number but no banking');
insert into waybill_state values('counts_before_replay',pg_temp.waybill_counts());
select pg_temp.waybill_assert(public.close_trip_v2(
 'f9500000-0000-0000-0000-000000000001',
 (select (v#>>'{trip,id}')::uuid from waybill_state where k='opened_bank'),
 'CHANGED-PAYLOAD',null,99,'OCR',clock_timestamp())=(select v from waybill_state where k='closed_bank'),
 'successful request ID replays the original response and Waybill number');
select pg_temp.waybill_assert((select v=pg_temp.waybill_counts() from waybill_state where k='counts_before_replay'),
 'replay creates no second invoice, payment, evidence, outbox item or receipt');
select pg_temp.waybill_assert((select count(*)=0 from public.trip_closure_invoices),
 'offloading officer cannot directly read bank-bearing Waybill rows');
select set_config('request.jwt.claim.sub','f9000000-0000-0000-0000-000000000002',true);
select pg_temp.waybill_assert((select count(*)=0 from public.trip_closure_invoices),
 'loading officer cannot directly read bank-bearing Waybill rows');

reset role;
select pg_temp.waybill_assert((select count(*)=1 from public.trip_closure_invoices i
 join waybill_state s on s.k='closed_bank' and s.v#>>'{waybill,invoice_number}'=i.invoice_number
 where i.trip_id=(select (v#>>'{trip,id}')::uuid from waybill_state where k='opened_bank')
   and i.bank_name='Waybill Bank' and i.account_name='Waybill Account'
   and i.account_number='0123456789' and i.driver_email='wb-driver@example.invalid'
   and i.driver_license='LIC-WB-1'
   and i.loading_officer_id='f9000000-0000-0000-0000-000000000002'
   and i.loading_officer_name='Loading Officer Snapshot'
   and i.offloading_officer_id='f9000000-0000-0000-0000-000000000003'
   and i.offloading_officer_name='Offloading Officer Snapshot'),
 'banked Waybill freezes trusted bank, driver and officer data');
select pg_temp.waybill_assert((select count(*)=1 from public.trip_closure_invoices i
 where i.trip_id=(select (v#>>'{trip,id}')::uuid from waybill_state where k='opened_missing')
   and i.bank_name is null and i.account_name is null and i.account_number is null),
 'missing banking leaves the initial immutable Waybill bank fields NULL');
select pg_temp.waybill_assert((select count(*)=1 from public.trip_payments p
 where p.trip_id=(select (v#>>'{trip,id}')::uuid from waybill_state where k='opened_bank')
   and p.status='pending' and p.account_number='0123456789'),
 'banked payment remains pending');
select pg_temp.waybill_assert((select count(*)=1 from public.trip_payments p
  where p.trip_id=(select (v#>>'{trip,id}')::uuid from waybill_state where k='opened_missing')
    and p.status='payment_details_required' and p.account_number is null),
  'missing banking retains payment-details-required workflow');
select pg_temp.waybill_assert((select count(*)=2 from public.trip_closure_invoices i
  join public.trip_payments p on p.trip_id=i.trip_id
  where i.trip_id in (select (v#>>'{trip,id}')::uuid from waybill_state where k like 'opened_%')
    and i.bank_name is not distinct from p.bank_name
    and i.account_name is not distinct from p.account_name
    and i.account_number is not distinct from p.account_number),
  'banked and missing-bank closures produce identical initial invoice/payment bank snapshots');
select pg_temp.waybill_assert((select count(*)=1 from public.notification_outbox n
 where n.trip_id=(select (v#>>'{trip,id}')::uuid from waybill_state where k='opened_bank')
   and n.audience='finance' and n.payload->>'invoice_number'=(select v#>>'{waybill,invoice_number}'
     from waybill_state where k='closed_bank') and n.payload->>'payment_status'='pending'),
 'banked finance notification includes Waybill number and payment status');
select pg_temp.waybill_assert((select count(*)=1 from public.notification_outbox n
 where n.trip_id=(select (v#>>'{trip,id}')::uuid from waybill_state where k='opened_missing')
   and n.audience='finance' and n.payload->>'invoice_number'=(select v#>>'{waybill,invoice_number}'
     from waybill_state where k='closed_missing')
   and n.payload->>'payment_status'='payment_details_required'),
 'missing-bank closure still queues Waybill notification');
select pg_temp.waybill_assert((select private.trip_email(n.payload,array['finance@example.invalid'],'sender@example.invalid')->>'text'
  like '%Waybill Number: INV-%' and private.trip_email(n.payload,array['finance@example.invalid'],
    'sender@example.invalid')->>'text' like '%payment could not be processed%'
  from public.notification_outbox n where n.trip_id=(select (v#>>'{trip,id}')::uuid
    from waybill_state where k='opened_missing') and n.audience='finance'),
  'email includes Waybill reference and retains missing-payment explanation');
update public.driver_payment_details set bank_name='Changed After Closure',account_number='9999999999'
  where driver_id='f9200000-0000-0000-0000-000000000001';
update public.profiles set display_name='Changed Loading Name'
  where id='f9000000-0000-0000-0000-000000000002';
select pg_temp.waybill_assert((select count(*)=1 from public.trip_closure_invoices
  where trip_id=(select (v#>>'{trip,id}')::uuid from waybill_state where k='opened_bank')
    and bank_name='Waybill Bank' and account_number='0123456789'
    and loading_officer_name='Loading Officer Snapshot'),
  'later master-data edits cannot rewrite issued banking or officer snapshots');
set local role authenticated;
select set_config('request.jwt.claim.sub','f9000000-0000-0000-0000-000000000005',true);
select public.complete_trip_payment_details(
  (select id from public.trip_payments where trip_id=(select (v#>>'{trip,id}')::uuid
    from waybill_state where k='opened_missing')),
  'Later Finance Account','1234567890','Later Finance Bank','Finance resolved missing bank details');
reset role;
select pg_temp.waybill_assert((select count(*)=1 from public.trip_closure_invoices
  where trip_id=(select (v#>>'{trip,id}')::uuid from waybill_state where k='opened_missing')
    and bank_name is null and account_name is null and account_number is null),
  'later payment-details completion does not revise the initial Waybill');
select pg_temp.waybill_assert((select count(*)=1 from public.trip_payments
  where trip_id=(select (v#>>'{trip,id}')::uuid from waybill_state where k='opened_missing')
    and status='pending' and supplied_account_number='1234567890'),
  'existing Finance completion still moves payment_details_required to pending');
select pg_temp.waybill_mutation_denied('update public.trip_closure_invoices set bank_name=''changed'' where trip_id='''||
  (select (v#>>'{trip,id}')::uuid from waybill_state where k='opened_bank')||'''');
select pg_temp.waybill_mutation_denied('delete from public.trip_closure_invoices where trip_id='''||
  (select (v#>>'{trip,id}')::uuid from waybill_state where k='opened_bank')||'''');

-- A hostile permissive policy cannot bypass the restrictive role fence.
create policy test_waybill_broad_read on public.trip_closure_invoices for select to authenticated using (true);
set local role authenticated;
select set_config('request.jwt.claim.sub','f9000000-0000-0000-0000-000000000003',true);
select pg_temp.waybill_assert((select count(*)=0 from public.trip_closure_invoices),
  'restrictive policy resists another permissive invoice policy');
select set_config('request.jwt.claim.sub','f9000000-0000-0000-0000-000000000004',true);
select pg_temp.waybill_assert((select count(*)=2 from public.trip_closure_invoices
  where trip_id in (select (v#>>'{trip,id}')::uuid from waybill_state where k like 'opened_%')),
  'operations reads authorized Waybills');
select set_config('request.jwt.claim.sub','f9000000-0000-0000-0000-000000000005',true);
select pg_temp.waybill_assert((select count(*)=2 from public.trip_closure_invoices
  where trip_id in (select (v#>>'{trip,id}')::uuid from waybill_state where k like 'opened_%')),
  'finance reads authorized Waybills');
select set_config('request.jwt.claim.sub','f9000000-0000-0000-0000-000000000006',true);
select pg_temp.waybill_assert((select count(*)=2 from public.trip_closure_invoices
  where trip_id in (select (v#>>'{trip,id}')::uuid from waybill_state where k like 'opened_%')),
  'audit reads authorized Waybills');
select set_config('request.jwt.claim.sub','f9000000-0000-0000-0000-000000000001',true);
select pg_temp.waybill_assert((select count(*)=2 from public.trip_closure_invoices
  where trip_id in (select (v#>>'{trip,id}')::uuid from waybill_state where k like 'opened_%')),
  'admin reads authorized Waybills');
-- Empty and whitespace-only names must produce stable, identifying document
-- labels without blocking closure or fabricating a person's name.
reset role;
update public.profiles set display_name='' where id='f9000000-0000-0000-0000-000000000002';
update public.profiles set display_name='   ' where id='f9000000-0000-0000-0000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','f9000000-0000-0000-0000-000000000002',true);
insert into waybill_state values('opened_blank_names',public.create_loading_trip_v2(
  'f9400000-0000-0000-0000-000000000003','WB-101','f9200000-0000-0000-0000-000000000001',
  (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
  'MANUAL',clock_timestamp(),13.00));
select pg_temp.waybill_assert((select v->>'ok'='true' from waybill_state where k='opened_blank_names'),
  'blank-name test trip opens');
select set_config('request.jwt.claim.sub','f9000000-0000-0000-0000-000000000003',true);
insert into waybill_state values('closed_blank_names',public.close_trip_v2(
  'f9500000-0000-0000-0000-000000000003',
  (select (v#>>'{trip,id}')::uuid from waybill_state where k='opened_blank_names'),'WB-101',
  (select id from public.user_site_assignments where profile_id=auth.uid() and ended_at is null),
  8.75,'MANUAL',clock_timestamp()));
select pg_temp.waybill_assert((select v->>'ok'='true' from waybill_state where k='closed_blank_names'),
  'blank-name test trip closes');
reset role;
select pg_temp.waybill_assert((select count(*)=1 from public.trip_closure_invoices
  where trip_id=(select (v#>>'{trip,id}')::uuid from waybill_state where k='opened_blank_names')
    and loading_officer_id='f9000000-0000-0000-0000-000000000002'
    and loading_officer_name='Loading Officer (f9000000-0000-0000-0000-000000000002)'
    and offloading_officer_id='f9000000-0000-0000-0000-000000000003'
    and offloading_officer_name='Offloading Officer (f9000000-0000-0000-0000-000000000003)'),
  'blank and whitespace officer names use deterministic ID-bearing labels');
rollback;
