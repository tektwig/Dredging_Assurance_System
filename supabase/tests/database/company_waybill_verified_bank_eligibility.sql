begin;

create function pg_temp.assert_true(p_value boolean,p_message text)
returns void language plpgsql as $$
begin
  if p_value is distinct from true then
    raise exception 'Company verified-bank eligibility assertion failed: %',p_message;
  end if;
  raise notice 'ASSERTION PASS: %',p_message;
end;
$$;

create function pg_temp.expect_sqlstate(p_query text,p_expected text,p_message text)
returns void language plpgsql as $$
declare v_state text;
begin
  begin
    execute p_query;
  exception when others then
    get stacked diagnostics v_state=returned_sqlstate;
    if v_state=p_expected then
      raise notice 'ASSERTION PASS: %',p_message;
      return;
    end if;
    raise exception 'Expected SQLSTATE % but received %: %',p_expected,v_state,p_message;
  end;
  raise exception 'Expected SQLSTATE % but statement succeeded: %',p_expected,p_message;
end;
$$;

create temporary table phase3c_unverified_notifications_before on commit drop as
select notification.id,to_jsonb(notification) as row_data
from public.notification_outbox notification
join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id
where invoice.invoice_number in ('WB-2026-000041','WB-2026-000042')
  and notification.event_type='waybill_ready' and notification.audience='client';

create temporary table phase3c_unverified_company_copy_before on commit drop as
select copy.id,to_jsonb(copy) as row_data
from public.trip_closure_invoice_pdf_copies copy
join public.trip_closure_invoices invoice on invoice.id=copy.invoice_id
where invoice.invoice_number='WB-2026-000041' and copy.copy_kind='company';

create temporary table phase3c_notification_leases(
  id uuid primary key,trip_id uuid,audience text,lease_token uuid,payload jsonb
);
grant insert,select on phase3c_notification_leases to service_role;

create temporary table phase3c_notification_attachments(
  notification_id uuid,invoice_id uuid,invoice_number text,audience text,
  copy_kind text,storage_bucket text,storage_path text
);
grant insert,select on phase3c_notification_attachments to service_role;

create temporary table phase3c_company_pdf_leases(
  copy_id uuid,invoice_id uuid,trip_id uuid,invoice_number text,
  storage_bucket text,storage_path text,attempts integer,lease_token uuid,lease_until timestamptz
);
grant insert,select on phase3c_company_pdf_leases to service_role;

create temporary table phase3c_company_pdf_snapshots(copy_id uuid,payload jsonb);
grant insert,select on phase3c_company_pdf_snapshots to service_role;

create temporary table phase3c_driver_pdf_leases(
  copy_id uuid,invoice_id uuid,trip_id uuid,invoice_number text,
  storage_bucket text,storage_path text,attempts integer,lease_token uuid,lease_until timestamptz
);
grant insert,select on phase3c_driver_pdf_leases to service_role;

create temporary table phase3c_driver_pdf_snapshots(copy_id uuid,payload jsonb);
grant insert,select on phase3c_driver_pdf_snapshots to service_role;

create temporary table phase3c_followup_claims(
  id uuid primary key,trip_id uuid,audience text,lease_token uuid,payload jsonb
);
grant insert,select on phase3c_followup_claims to service_role;

select pg_temp.assert_true((
  select count(*)=8 and bool_and(function_row.prosecdef
    and function_row.proconfig @> array['search_path=""']::text[])
  from (values
    ('private.waybill_company_copy_verification_eligible(uuid,uuid,uuid,uuid)'::regprocedure),
    ('private.waybill_company_copy_email_eligible(uuid,uuid,uuid)'::regprocedure),
    ('private.waybill_company_storage_object_read_allowed(text)'::regprocedure),
    ('private.waybill_company_invoice_has_processing_delivery(uuid)'::regprocedure),
    ('private.guard_waybill_company_copy_transition()'::regprocedure),
    ('private.waybill_notification_audience_eligible(uuid,jsonb,text,boolean)'::regprocedure),
    ('private.claim_waybill_pdf_copy_jobs(text,integer,uuid)'::regprocedure),
    ('private.guard_notification_delivery_cutover()'::regprocedure)
  ) expected(function_oid)
  join pg_catalog.pg_proc function_row on function_row.oid=expected.function_oid
),'Company eligibility, trigger, claim and storage helpers are SECURITY DEFINER with an empty search_path');

select pg_temp.assert_true(
  not has_function_privilege('anon','private.waybill_company_copy_verification_eligible(uuid,uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','private.waybill_company_copy_verification_eligible(uuid,uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('service_role','private.waybill_company_copy_verification_eligible(uuid,uuid,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','private.waybill_company_storage_object_read_allowed(text)','EXECUTE')
  and not has_function_privilege('service_role','private.waybill_company_storage_object_read_allowed(text)','EXECUTE'),
  'private verification predicates are not directly callable by API roles while the Storage policy wrapper is authenticated-only');

select pg_temp.assert_true((
  select count(*)=5 and array_agg(allowlist.invoice_number order by allowlist.invoice_number)=array[
    'WB-2026-000041','WB-2026-000042','WB-2026-000043','WB-2026-000044','WB-2026-000045'
  ]::text[]
  from private.waybill_email_historical_allowlist allowlist
) and (
  select count(*)=5 and bool_and(
    allowlist.invoice_id=invoice.id
    and allowlist.trip_id=invoice.trip_id
    and allowlist.invoice_number=invoice.invoice_number
    and allowlist.closed_at=invoice.closed_at
    and allowlist.closed_at=trip.closed_at
  )
  from private.waybill_email_historical_allowlist allowlist
  join public.trip_closure_invoices invoice
    on invoice.id=allowlist.invoice_id and invoice.trip_id=allowlist.trip_id
  join public.trips trip on trip.id=invoice.trip_id
  where allowlist.invoice_number in (
    'WB-2026-000041','WB-2026-000042','WB-2026-000043','WB-2026-000044','WB-2026-000045'
  )
),'the immutable allowlist contains exactly Waybills 041 through 045 with matching invoice, trip, and closure timestamps');
select pg_temp.assert_true(not exists (
  select 1 from private.waybill_email_historical_allowlist allowlist
  where allowlist.invoice_number in ('WB-2026-000039','WB-2026-000040')
),'Waybill 040 and the older synthetic control are absent from the fixed historical allowlist');
select pg_temp.assert_true(
  exists (
    select 1 from private.waybill_notification_canary_runs canary
    join public.trip_closure_invoices invoice
      on invoice.id=canary.invoice_id and invoice.trip_id=canary.trip_id
    where invoice.invoice_number='WB-9999-999999'
      and canary.disarmed_at is null
      and canary.expires_at>statement_timestamp()
      and canary.purpose='synthetic_development_test'
  )
  and not private.waybill_email_regular_delivery_allowed(
    (select invoice.id from public.trip_closure_invoices invoice where invoice.invoice_number='WB-2026-000041'),
    (select invoice.trip_id from public.trip_closure_invoices invoice where invoice.invoice_number='WB-2026-000041')
  ),
  'regular email delivery remains disabled while the synthetic canary is armed');

select pg_temp.assert_true((
  select count(*)=3 and bool_and(private.waybill_company_copy_verification_eligible(
    invoice.id,invoice.trip_id,copy.id,copy.bank_snapshot_id))
  from public.trip_closure_invoices invoice
  join public.trip_closure_invoice_pdf_copies copy
    on copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id and copy.copy_kind='company'
  where invoice.invoice_number in ('WB-2026-000043','WB-2026-000044','WB-2026-000045')
),'latest invoice-matched Company copies with verified Operations Manager provenance pass the eligibility predicate');

select pg_temp.assert_true((
  select count(*)=2 and bool_and(
    snapshot.source_kind='registration_capture'
    and submission.source_kind='registration_capture'
    and snapshot.verified_by is null and snapshot.verified_at is null
    and not private.waybill_company_copy_verification_eligible(
      invoice.id,invoice.trip_id,copy.id,copy.bank_snapshot_id)
  )
  from public.trip_closure_invoices invoice
  join public.trip_closure_invoice_pdf_copies copy
    on copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id and copy.copy_kind='company'
  join public.trip_closure_invoice_bank_snapshots snapshot
    on snapshot.id=copy.bank_snapshot_id and snapshot.invoice_id=copy.invoice_id
      and snapshot.trip_id=copy.trip_id
  join public.trip_closure_invoice_bank_submissions submission
    on submission.id=snapshot.source_submission_id and submission.invoice_id=snapshot.invoice_id
      and submission.trip_id=snapshot.trip_id
  where invoice.invoice_number in ('WB-2026-000041','WB-2026-000042')
),'registration captures without verification provenance are ineligible for Company copies');

select pg_temp.assert_true(not private.waybill_company_copy_verification_eligible(
  (select invoice.id from public.trip_closure_invoices invoice where invoice.invoice_number='WB-2026-000043'),
  (select invoice.trip_id from public.trip_closure_invoices invoice where invoice.invoice_number='WB-2026-000043'),
  (select copy.id from public.trip_closure_invoice_pdf_copies copy join public.trip_closure_invoices invoice on invoice.id=copy.invoice_id where invoice.invoice_number='WB-2026-000043' and copy.copy_kind='company'),
  null
),'a missing bank snapshot cannot satisfy Company-copy verification');
select pg_temp.assert_true(not private.waybill_company_copy_verification_eligible(
  (select invoice.id from public.trip_closure_invoices invoice where invoice.invoice_number='WB-2026-000043'),
  (select invoice.trip_id from public.trip_closure_invoices invoice where invoice.invoice_number='WB-2026-000043'),
  (select copy.id from public.trip_closure_invoice_pdf_copies copy join public.trip_closure_invoices invoice on invoice.id=copy.invoice_id where invoice.invoice_number='WB-2026-000043' and copy.copy_kind='company'),
  (select snapshot.id from public.trip_closure_invoice_bank_snapshots snapshot join public.trip_closure_invoices invoice on invoice.id=snapshot.invoice_id where invoice.invoice_number='WB-2026-000044')
),'a snapshot belonging to a different invoice is rejected');
select pg_temp.assert_true(not private.waybill_company_copy_verification_eligible(
  (select invoice.id from public.trip_closure_invoices invoice where invoice.invoice_number='WB-2026-000043'),
  'e6000000-0000-4000-8000-000000000044',
  (select copy.id from public.trip_closure_invoice_pdf_copies copy join public.trip_closure_invoices invoice on invoice.id=copy.invoice_id where invoice.invoice_number='WB-2026-000043' and copy.copy_kind='company'),
  (select copy.bank_snapshot_id from public.trip_closure_invoice_pdf_copies copy join public.trip_closure_invoices invoice on invoice.id=copy.invoice_id where invoice.invoice_number='WB-2026-000043' and copy.copy_kind='company')
),'a mismatched closed trip cannot authorize a Company copy');

update public.profiles set is_active=false where id='e0000000-0000-4000-8000-000000000003';
select pg_temp.assert_true((
  select private.waybill_company_copy_verification_eligible(invoice.id,invoice.trip_id,copy.id,copy.bank_snapshot_id)
  from public.trip_closure_invoices invoice
  join public.trip_closure_invoice_pdf_copies copy on copy.invoice_id=invoice.id
    and copy.trip_id=invoice.trip_id and copy.copy_kind='company'
  where invoice.invoice_number='WB-2026-000043'
),'a valid immutable historical verification remains valid if its verifier profile is now inactive');
update public.profiles set is_active=true where id='e0000000-0000-4000-8000-000000000003';

select set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000004',true);
select set_config('request.jwt.claims',jsonb_build_object('sub','c0000000-0000-4000-8000-000000000004')::text,true);
select pg_temp.assert_true((
  select count(*)=1 from public.trip_closure_invoices invoice
  where invoice.invoice_number='WB-9999-999999'
), 'the reserved synthetic invoice resolves exactly once before the service-role disarm call');
select set_config('phase3c.reserved_invoice_id',(
  select invoice.id::text from public.trip_closure_invoices invoice
  where invoice.invoice_number='WB-9999-999999'
),true);
set local role service_role;
select pg_temp.assert_true(public.disarm_waybill_synthetic_email_canary(
  current_setting('phase3c.reserved_invoice_id')::uuid
),'CI transaction disarms the synthetic canary before exercising regular delivery paths');
reset role;

select pg_temp.assert_true((
  select private.waybill_company_copy_verification_eligible(invoice.id,invoice.trip_id,copy.id,copy.bank_snapshot_id)
    and not private.waybill_company_copy_email_eligible(invoice.id,invoice.trip_id,copy.id)
    and not private.waybill_email_regular_delivery_allowed(invoice.id,invoice.trip_id)
    and copy.notification_eligible=false
  from public.trip_closure_invoices invoice
  join public.trip_closure_invoice_pdf_copies copy
    on copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id
      and copy.copy_kind='company' and copy.copy_version=2
  where invoice.invoice_number='WB-9999-999999'
),'notification_eligible=false remains a hard regular-email exclusion even for a verified synthetic canary copy');

insert into storage.objects(bucket_id,name,owner_id,metadata)
select copy.storage_bucket,copy.storage_path,'c0000000-0000-4000-8000-000000000004',
  jsonb_build_object('mimetype','application/pdf','size',2048)
from public.trip_closure_invoice_pdf_copies copy
join public.trip_closure_invoices invoice on invoice.id=copy.invoice_id
where invoice.invoice_number in ('WB-2026-000042','WB-2026-000043') and copy.copy_kind='company'
  and not exists (
    select 1 from storage.objects existing
    where existing.bucket_id=copy.storage_bucket and existing.name=copy.storage_path
  );

select pg_temp.assert_true((
  select count(*)=2 and count(distinct invoice.id)=2 and bool_and(
    copy.storage_bucket is not null and copy.storage_path is not null
    and (
      (invoice.invoice_number='WB-2026-000042'
        and not private.waybill_company_copy_verification_eligible(
          invoice.id,invoice.trip_id,copy.id,copy.bank_snapshot_id))
      or (invoice.invoice_number='WB-2026-000043'
        and private.waybill_company_copy_verification_eligible(
          invoice.id,invoice.trip_id,copy.id,copy.bank_snapshot_id))
    )
    and (select count(*) from storage.objects object
      where object.bucket_id=copy.storage_bucket and object.name=copy.storage_path)=1
  )
  from public.trip_closure_invoices invoice
  join public.trip_closure_invoice_pdf_copies copy
    on copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id and copy.copy_kind='company'
  where invoice.invoice_number in ('WB-2026-000042','WB-2026-000043')
), 'both synthetic Company Storage objects exist before authenticated RLS checks');
select set_config('phase3c.company_verified_invoice_id',(
  select invoice.id::text from public.trip_closure_invoices invoice
  where invoice.invoice_number='WB-2026-000043'
),true);
select set_config('phase3c.company_verified_bucket',(
  select copy.storage_bucket from public.trip_closure_invoice_pdf_copies copy
  where copy.invoice_id=current_setting('phase3c.company_verified_invoice_id')::uuid
    and copy.copy_kind='company'
),true);
select set_config('phase3c.company_verified_path',(
  select copy.storage_path from public.trip_closure_invoice_pdf_copies copy
  where copy.invoice_id=current_setting('phase3c.company_verified_invoice_id')::uuid
    and copy.copy_kind='company'
),true);
select set_config('phase3c.company_unverified_invoice_id',(
  select invoice.id::text from public.trip_closure_invoices invoice
  where invoice.invoice_number='WB-2026-000042'
),true);
select set_config('phase3c.company_unverified_bucket',(
  select copy.storage_bucket from public.trip_closure_invoice_pdf_copies copy
  where copy.invoice_id=current_setting('phase3c.company_unverified_invoice_id')::uuid
    and copy.copy_kind='company'
),true);
select set_config('phase3c.company_unverified_path',(
  select copy.storage_path from public.trip_closure_invoice_pdf_copies copy
  where copy.invoice_id=current_setting('phase3c.company_unverified_invoice_id')::uuid
    and copy.copy_kind='company'
),true);

select pg_temp.assert_true(exists(
  select 1 from public.profiles profile
  where profile.id='e0000000-0000-4000-8000-000000000003'
    and profile.role='operations_manager'::public.app_role and profile.is_active
), 'the authenticated Company access checks use a seeded active Operations Manager');
select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims',jsonb_build_object('sub','e0000000-0000-4000-8000-000000000003')::text,true);
set local role authenticated;
select pg_temp.assert_true(exists(
  select 1 from storage.objects object
  where object.bucket_id=current_setting('phase3c.company_verified_bucket')
    and object.name=current_setting('phase3c.company_verified_path')
),'Operations Managers can read the current verified private Company object through Storage RLS');
select pg_temp.assert_true(not exists (
  select 1 from storage.objects object
  where object.bucket_id=current_setting('phase3c.company_unverified_bucket')
    and object.name=current_setting('phase3c.company_unverified_path')
),'Operations Managers cannot read a Company object backed only by an unverified registration capture through Storage RLS');
select pg_temp.assert_true((
  select count(*)=1 from public.get_operations_waybill_pdf_copy(
    current_setting('phase3c.company_verified_invoice_id')::uuid,'company')
),'Operations Manager download RPC returns exactly the current eligible Company copy');
select pg_temp.assert_true(not exists (
  select 1 from public.get_operations_waybill_pdf_copy(
    current_setting('phase3c.company_unverified_invoice_id')::uuid,'company')
),'Operations Manager download RPC withholds a ready but unverified Company copy');
reset role;

select pg_temp.assert_true((
  exists (
    select 1
    from public.profiles profile
    join auth.sessions session on session.user_id=profile.id
    join public.user_site_assignments assignment on assignment.profile_id=profile.id
    where profile.id='c0000000-0000-4000-8000-000000000005'
      and profile.role='loading_officer'::public.app_role and profile.is_active
      and session.id='c2000000-0000-4000-8000-000000000005'
      and assignment.site_id='c1000000-0000-4000-8000-000000000001'
      and assignment.ended_at is null
  )
), 'the Storage denial identity is an active, assigned Loading Officer with a seeded session');
select set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000005',true);
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','c0000000-0000-4000-8000-000000000005',
  'session_id','c2000000-0000-4000-8000-000000000005',
  'iat',extract(epoch from statement_timestamp())::bigint
)::text,true);
set local role authenticated;
select pg_temp.assert_true(not exists (
  select 1 from storage.objects object
  where object.bucket_id=current_setting('phase3c.company_verified_bucket')
    and object.name=current_setting('phase3c.company_verified_path')
),'an active Loading Officer cannot read a verified Company object through Storage RLS');
select pg_temp.expect_sqlstate($q$select * from public.get_operations_waybill_pdf_copy(
  current_setting('phase3c.company_verified_invoice_id')::uuid,'company')$q$,
  '42501','a Loading Officer cannot use the Operations Manager Company download RPC');
reset role;

select pg_temp.assert_true((
  select count(*)=1 from public.trip_closure_invoices invoice
  where invoice.invoice_number='WB-2026-000041'
), 'the unverified Company invoice resolves exactly once before service-role claim tests');
select set_config('phase3c.unverified_company_invoice_id',(
  select invoice.id::text from public.trip_closure_invoices invoice
  where invoice.invoice_number='WB-2026-000041'
),true);
select pg_temp.assert_true((
  select count(*)=1 from public.trip_closure_invoice_pdf_copies copy
  where copy.invoice_id=current_setting('phase3c.unverified_company_invoice_id')::uuid
    and copy.copy_kind='company'
), 'the unverified Company PDF ID resolves exactly once before service-role snapshot testing');
select set_config('phase3c.unverified_company_copy_id',(
  select copy.id::text from public.trip_closure_invoice_pdf_copies copy
  where copy.invoice_id=current_setting('phase3c.unverified_company_invoice_id')::uuid
    and copy.copy_kind='company'
),true);
set local role service_role;
select pg_temp.assert_true((
  select count(*)=0 from public.claim_company_waybill_pdf_jobs(
    1,current_setting('phase3c.unverified_company_invoice_id')::uuid)
),'an unverified Company PDF cannot be claimed');
select pg_temp.assert_true(
  public.get_company_waybill_pdf_snapshot(
    current_setting('phase3c.unverified_company_copy_id')::uuid,
    gen_random_uuid()) is null,
  'an unclaimed unverified Company copy returns scalar SQL NULL; bank eligibility is asserted by claim denial');
reset role;
select pg_temp.expect_sqlstate($q$update public.trip_closure_invoice_pdf_copies copy
  set status='processing',lease_token=gen_random_uuid(),lease_until=statement_timestamp()+interval '5 minutes'
  from public.trip_closure_invoices invoice
  where copy.invoice_id=invoice.id and invoice.invoice_number='WB-2026-000041'
    and copy.copy_kind='company'$q$,'42501',
  'a direct transition cannot place an unverified Company copy into processing');
select pg_temp.assert_true(not exists (
  select 1 from phase3c_unverified_company_copy_before before_row
  left join public.trip_closure_invoice_pdf_copies copy on copy.id=before_row.id
  where copy.id is null or before_row.row_data is distinct from to_jsonb(copy)
),'unverified Company PDF attempts, status, and lease fields remain unchanged after claims and blocked transitions');

set local role service_role;
select public.enqueue_waybill_ready_notifications('synthetic-company@example.invalid');
insert into phase3c_notification_leases(id,trip_id,audience,lease_token,payload)
select notification.id,notification.trip_id,notification.audience,notification.lease_token,notification.payload
from public.claim_waybill_notifications('phase3c-verified-bank-check',10) notification;
reset role;

select pg_temp.assert_true(not exists (
  select 1 from phase3c_unverified_notifications_before before_row
  left join public.notification_outbox notification on notification.id=before_row.id
  where notification.id is null or before_row.row_data is distinct from to_jsonb(notification)
),'reconciliation does not enqueue, unblock, or mutate any unverified historical Company notification');

select pg_temp.assert_true(exists (
  select 1 from phase3c_notification_leases lease
  join public.trip_closure_invoices invoice on invoice.trip_id=lease.trip_id
  where lease.audience='client' and invoice.invoice_number in ('WB-2026-000043','WB-2026-000044','WB-2026-000045')
),'a normal Company notification with verified bank provenance can be claimed');
select pg_temp.assert_true(not exists (
  select 1 from phase3c_notification_leases lease
  join public.trip_closure_invoices invoice on invoice.trip_id=lease.trip_id
  where lease.audience='client' and invoice.invoice_number in ('WB-2026-000041','WB-2026-000042','WB-9999-999999')
),'normal email claims exclude unverified historical copies and the notification_eligible=false canary');
select pg_temp.assert_true((
  select count(*)=0 from public.notification_outbox notification
  join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id
  where invoice.invoice_number in ('WB-2026-000041','WB-2026-000042')
    and notification.audience='client' and notification.status='processing'
),'unverified historical Company notifications remain unclaimed');

set local role service_role;
insert into phase3c_notification_attachments(
  notification_id,invoice_id,invoice_number,audience,copy_kind,storage_bucket,storage_path
)
select lease.id,attachment.invoice_id,attachment.invoice_number,lease.audience,
  attachment.copy_kind,attachment.storage_bucket,attachment.storage_path
from phase3c_notification_leases lease
cross join lateral public.get_waybill_notification_pdf(lease.id,lease.lease_token) attachment;
reset role;

select pg_temp.assert_true((
  select (select count(*) from phase3c_notification_attachments)=
    (select count(*) from phase3c_notification_leases)
),'every claimed notification resolves to one lease-bound audience-matched attachment');
select pg_temp.assert_true(not exists (
  select 1 from phase3c_notification_attachments attachment
  join phase3c_notification_leases lease on lease.id=attachment.notification_id
  join public.trip_closure_invoices invoice on invoice.id=attachment.invoice_id
  where attachment.audience='client'
    and (attachment.copy_kind<>'company' or attachment.storage_bucket<>'waybill-company-copies'
      or not exists (
        select 1 from public.trip_closure_invoice_pdf_copies copy
        where copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id
          and copy.copy_kind='company' and copy.status='ready' and copy.ready_at is not null
          and copy.copy_version=(select max(latest.copy_version)
            from public.trip_closure_invoice_pdf_copies latest
            where latest.invoice_id=invoice.id and latest.copy_kind='company')
          and copy.storage_path=attachment.storage_path
          and private.waybill_company_copy_email_eligible(invoice.id,invoice.trip_id,copy.id)
      ))
),'Company attachments are the latest ready private copies with verified bank snapshots');
select pg_temp.assert_true(not exists (
  select 1 from phase3c_notification_attachments attachment
  join phase3c_notification_leases lease on lease.id=attachment.notification_id
  join public.trip_closure_invoices invoice on invoice.id=attachment.invoice_id
  join public.trip_closure_invoice_pdf_copies copy
    on copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id
      and copy.copy_kind='driver' and copy.storage_path=attachment.storage_path
  where attachment.audience='driver'
    and (attachment.copy_kind<>'driver' or attachment.storage_bucket<>'waybill-driver-copies'
      or copy.bank_snapshot_id is not null)
),'Driver attachments use only the latest bank-free private Driver PDF');

select pg_temp.assert_true((
  select count(*)=1 from public.trip_closure_invoices invoice
  where invoice.invoice_number='WB-2026-000044'
), 'the leased-email invoice resolves exactly once before the Operations Manager mutation call');
select set_config('phase3c.email_lease_invoice_id',(
  select invoice.id::text from public.trip_closure_invoices invoice
  where invoice.invoice_number='WB-2026-000044'
),true);
select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims',jsonb_build_object('sub','e0000000-0000-4000-8000-000000000003')::text,true);
set local role authenticated;
select pg_temp.expect_sqlstate($q$select * from public.save_waybill_company_bank_details(
  current_setting('phase3c.email_lease_invoice_id')::uuid,
  'f3c00000-0000-4000-8000-000000000001','Synthetic Race Bank','Synthetic Race Account','0000000044')$q$,
  '55P03','bank correction fails closed while a Company email lease is active');
reset role;

set local role service_role;
select pg_temp.assert_true(not public.finish_trip_notification(
  (select lease.id from phase3c_notification_leases lease where lease.audience='client' limit 1),
  gen_random_uuid(),false,null,'synthetic lease mismatch')
),'notification completion rejects a mismatched lease token');
select pg_temp.assert_true((
  select bool_and(public.finish_trip_notification(lease.id,lease.lease_token,false,null,'synthetic SQL-only attachment test'))
  from phase3c_notification_leases lease
),'valid notification leases can be safely released through the existing failure/retry RPC without provider calls');
reset role;

select pg_temp.assert_true(not exists (
  select 1 from phase3c_unverified_notifications_before before_row
  left join public.notification_outbox notification on notification.id=before_row.id
  where notification.id is null or before_row.row_data is distinct from to_jsonb(notification)
),'all fields on unverified historical notification rows remain unchanged after reconciliation, claim, attachment, and retry paths');

update public.trip_closure_invoice_pdf_copies copy
set status='pending',ready_at=null,next_attempt_at=statement_timestamp()
from public.trip_closure_invoices invoice
where copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id
  and invoice.invoice_number='WB-2026-000043' and copy.copy_kind='company'
    and copy.status='ready';

select pg_temp.assert_true((
  select count(*)=1 from public.trip_closure_invoices invoice
  join public.trip_closure_invoice_pdf_copies copy
    on copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id
  where invoice.invoice_number='WB-2026-000043' and copy.copy_kind='company'
), 'the verified Company invoice and copy resolve exactly once before service-role claim');
select set_config('phase3c.verified_company_claim_invoice_id',(
  select invoice.id::text from public.trip_closure_invoices invoice
  where invoice.invoice_number='WB-2026-000043'
),true);
select set_config('phase3c.verified_company_claim_copy_id',(
  select copy.id::text from public.trip_closure_invoice_pdf_copies copy
  where copy.invoice_id=current_setting('phase3c.verified_company_claim_invoice_id')::uuid
    and copy.copy_kind='company'
),true);
set local role service_role;
insert into phase3c_company_pdf_leases
select job.* from public.claim_company_waybill_pdf_jobs(
  1,current_setting('phase3c.verified_company_claim_invoice_id')::uuid) job;
select pg_temp.assert_true(
  public.get_company_waybill_pdf_snapshot(
    current_setting('phase3c.verified_company_claim_copy_id')::uuid,
    gen_random_uuid()) is null,
  'the verified Company snapshot getter returns scalar SQL NULL for an invalid lease token');
insert into phase3c_company_pdf_snapshots(copy_id,payload)
select lease.copy_id,public.get_company_waybill_pdf_snapshot(lease.copy_id,lease.lease_token)
from phase3c_company_pdf_leases lease;
reset role;

select pg_temp.assert_true((
  select count(*)=1 and bool_and(lease.copy_id=current_setting('phase3c.verified_company_claim_copy_id')::uuid
    and lease.storage_bucket='waybill-company-copies'
    and snapshot.payload ?& array['bank_name','account_name','account_number']
    and snapshot.payload->>'bank_name' is not null
    and snapshot.payload->>'account_name' is not null
    and snapshot.payload->>'account_number' is not null)
  from phase3c_company_pdf_leases lease
  join phase3c_company_pdf_snapshots snapshot on snapshot.copy_id=lease.copy_id
),'a normal verified Company PDF claim receives only its matched verified bank snapshot');

select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims',jsonb_build_object('sub','e0000000-0000-4000-8000-000000000003')::text,true);
select set_config('phase3c.verified_company_save_invoice_id',current_setting('phase3c.verified_company_claim_invoice_id'),true);
set local role authenticated;
select pg_temp.expect_sqlstate($q$select * from public.save_waybill_company_bank_details(
  current_setting('phase3c.verified_company_save_invoice_id')::uuid,
  'f3c00000-0000-4000-8000-000000000002','Synthetic Race Bank','Synthetic Race Account','0000000043')$q$,
  '55P03','bank correction fails closed while a Company PDF lease is active');
reset role;

set local role service_role;
select pg_temp.assert_true((
  select not public.finish_company_waybill_pdf_job(lease.copy_id,gen_random_uuid(),false,'storage_upload_failed')
  from phase3c_company_pdf_leases lease
),'Company PDF completion rejects a mismatched lease token');
select pg_temp.assert_true((
  select public.finish_company_waybill_pdf_job(lease.copy_id,lease.lease_token,false,'storage_upload_failed')
  from phase3c_company_pdf_leases lease
),'verified Company PDF lease can record a retryable failed upload');
reset role;
select pg_temp.assert_true((
  select copy.status='pending' and copy.attempts=lease.attempts
    and copy.lease_token is null and copy.lease_until is null
  from phase3c_company_pdf_leases lease
  join public.trip_closure_invoice_pdf_copies copy on copy.id=lease.copy_id
),'failed verified Company upload releases only its lease and preserves bounded retry state');

update public.trip_closure_invoice_pdf_copies copy
set status='pending',ready_at=null,next_attempt_at=statement_timestamp()
from public.trip_closure_invoices invoice
where copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id
  and invoice.invoice_number='WB-2026-000041' and copy.copy_kind='driver'
    and copy.status='ready';
select pg_temp.assert_true((
  select count(*)=1 from public.trip_closure_invoices invoice
  join public.trip_closure_invoice_pdf_copies copy
    on copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id
  where invoice.invoice_number='WB-2026-000041' and copy.copy_kind='driver'
), 'the Driver invoice and copy resolve exactly once before service-role claim');
select set_config('phase3c.driver_claim_invoice_id',(
  select invoice.id::text from public.trip_closure_invoices invoice
  where invoice.invoice_number='WB-2026-000041'
),true);
select set_config('phase3c.driver_claim_copy_id',(
  select copy.id::text from public.trip_closure_invoice_pdf_copies copy
  where copy.invoice_id=current_setting('phase3c.driver_claim_invoice_id')::uuid
    and copy.copy_kind='driver'
),true);
set local role service_role;
insert into phase3c_driver_pdf_leases
select job.* from public.claim_driver_waybill_pdf_jobs(
  1,current_setting('phase3c.driver_claim_invoice_id')::uuid) job;
insert into phase3c_driver_pdf_snapshots(copy_id,payload)
select lease.copy_id,public.get_driver_waybill_pdf_snapshot(lease.copy_id,lease.lease_token)
from phase3c_driver_pdf_leases lease;
reset role;
select pg_temp.assert_true((
  select count(*)=1 and bool_and(lease.copy_id=current_setting('phase3c.driver_claim_copy_id')::uuid
    and lease.storage_bucket='waybill-driver-copies'
    and not (snapshot.payload ?| array['bank_name','account_name','account_number','bank_snapshot_id']))
  from phase3c_driver_pdf_leases lease
  join phase3c_driver_pdf_snapshots snapshot on snapshot.copy_id=lease.copy_id
),'Driver PDF processing remains independent of unverified bank details and exposes no bank fields');
set local role service_role;
select pg_temp.assert_true((
  select public.finish_driver_waybill_pdf_job(lease.copy_id,lease.lease_token,false,'storage_upload_failed')
  from phase3c_driver_pdf_leases lease
),'Driver PDF lease preserves its existing retry workflow');
reset role;

insert into public.trip_closure_invoice_bank_submissions(
  id,invoice_id,trip_id,bank_name,account_name,account_number,submitted_by,submitted_at,
  correction_of_snapshot_id,source_kind
)
select 'f3c00000-0000-4000-8000-000000000044',invoice.id,invoice.trip_id,
  'Synthetic Future Bank','Synthetic Future Account','0000000044',
  'e0000000-0000-4000-8000-000000000003',statement_timestamp(),snapshot.id,'operations_manager'
from public.trip_closure_invoices invoice
join public.trip_closure_invoice_bank_snapshots snapshot on snapshot.invoice_id=invoice.id
  and snapshot.trip_id=invoice.trip_id and snapshot.version=1
where invoice.invoice_number='WB-2026-000044';

insert into public.trip_closure_invoice_bank_snapshots(
  id,invoice_id,trip_id,version,supersedes_snapshot_id,source_submission_id,
  bank_name,account_name,account_number,submitted_by,submitted_at,verified_by,verified_at,source_kind
)
select 'f3c00000-0000-4000-8000-000000000045',submission.invoice_id,submission.trip_id,2,
  submission.correction_of_snapshot_id,submission.id,submission.bank_name,submission.account_name,
  submission.account_number,submission.submitted_by,submission.submitted_at,
  submission.submitted_by,statement_timestamp()+interval '2 days','operations_manager'
from public.trip_closure_invoice_bank_submissions submission
where submission.id='f3c00000-0000-4000-8000-000000000044';

insert into public.trip_closure_invoice_bank_detail_events(
  submission_id,invoice_id,trip_id,event_type,reason_code,actor_id,occurred_at
)
select submission.id,submission.invoice_id,submission.trip_id,'correction_verified','verified',
  submission.submitted_by,statement_timestamp()+interval '3 days'
from public.trip_closure_invoice_bank_submissions submission
where submission.id='f3c00000-0000-4000-8000-000000000044';

insert into public.trip_closure_invoice_pdf_copies(
  invoice_id,trip_id,invoice_number,copy_kind,copy_version,status,storage_bucket,
  storage_path,bank_snapshot_id,notification_eligible
)
select invoice.id,invoice.trip_id,invoice.invoice_number,'company',2,'pending',
  'waybill-company-copies',
  private.secure_waybill_copy_storage_path(invoice.invoice_number,'company',2),
  snapshot.id,false
from public.trip_closure_invoices invoice
join public.trip_closure_invoice_bank_snapshots snapshot on snapshot.invoice_id=invoice.id
  and snapshot.trip_id=invoice.trip_id and snapshot.version=2
where invoice.invoice_number='WB-2026-000044';

create temporary table phase3c_future_company_copy_before on commit drop as
select copy.id,to_jsonb(copy) as row_data
from public.trip_closure_invoice_pdf_copies copy
join public.trip_closure_invoices invoice on invoice.id=copy.invoice_id
where invoice.invoice_number='WB-2026-000044' and copy.copy_kind='company' and copy.copy_version=2;

select pg_temp.assert_true((
  select count(*)=1 from public.trip_closure_invoices invoice
  join public.trip_closure_invoice_pdf_copies copy
    on copy.invoice_id=invoice.id and copy.trip_id=invoice.trip_id
  where invoice.invoice_number='WB-2026-000044' and copy.copy_kind='company' and copy.copy_version=2
), 'the future-version invoice and PDF resolve exactly once before service-role claim');
select set_config('phase3c.future_company_invoice_id',(
  select invoice.id::text from public.trip_closure_invoices invoice
  where invoice.invoice_number='WB-2026-000044'
),true);
select set_config('phase3c.future_company_copy_id',(
  select copy.id::text from public.trip_closure_invoice_pdf_copies copy
  where copy.invoice_id=current_setting('phase3c.future_company_invoice_id')::uuid
    and copy.copy_kind='company' and copy.copy_version=2
),true);

select pg_temp.assert_true((
  select snapshot.verified_at>statement_timestamp()
    and not private.waybill_company_copy_verification_eligible(
      invoice.id,invoice.trip_id,copy.id,copy.bank_snapshot_id)
    and not private.waybill_company_copy_email_eligible(invoice.id,invoice.trip_id,copy.id)
  from public.trip_closure_invoices invoice
  join public.trip_closure_invoice_pdf_copies copy on copy.invoice_id=invoice.id
    and copy.trip_id=invoice.trip_id and copy.copy_kind='company' and copy.copy_version=2
  join public.trip_closure_invoice_bank_snapshots snapshot
    on snapshot.id=copy.bank_snapshot_id and snapshot.invoice_id=copy.invoice_id
      and snapshot.trip_id=copy.trip_id
  where invoice.invoice_number='WB-2026-000044'
),'future-dated verification evidence cannot authorize a Company PDF or email');
select pg_temp.assert_true(not private.waybill_company_copy_verification_eligible(
  (select invoice.id from public.trip_closure_invoices invoice where invoice.invoice_number='WB-2026-000044'),
  (select invoice.trip_id from public.trip_closure_invoices invoice where invoice.invoice_number='WB-2026-000044'),
  (select copy.id from public.trip_closure_invoice_pdf_copies copy join public.trip_closure_invoices invoice on invoice.id=copy.invoice_id where invoice.invoice_number='WB-2026-000044' and copy.copy_version=1 and copy.copy_kind='company'),
  (select copy.bank_snapshot_id from public.trip_closure_invoice_pdf_copies copy join public.trip_closure_invoices invoice on invoice.id=copy.invoice_id where invoice.invoice_number='WB-2026-000044' and copy.copy_version=1 and copy.copy_kind='company')
),'a previously eligible Company copy becomes ineligible when superseded by a newer bank snapshot and PDF version');
select pg_temp.assert_true(not private.waybill_company_copy_verification_eligible(
  (select invoice.id from public.trip_closure_invoices invoice where invoice.invoice_number='WB-2026-000044'),
  (select invoice.trip_id from public.trip_closure_invoices invoice where invoice.invoice_number='WB-2026-000044'),
  (select copy.id from public.trip_closure_invoice_pdf_copies copy join public.trip_closure_invoices invoice on invoice.id=copy.invoice_id where invoice.invoice_number='WB-2026-000044' and copy.copy_version=2 and copy.copy_kind='company'),
  (select snapshot.id from public.trip_closure_invoice_bank_snapshots snapshot join public.trip_closure_invoices invoice on invoice.id=snapshot.invoice_id where invoice.invoice_number='WB-2026-000043')
),'a snapshot copied from another invoice cannot match the current Company version');

set local role service_role;
select pg_temp.assert_true((
  select count(*)=0 from public.claim_company_waybill_pdf_jobs(
    1,current_setting('phase3c.future_company_invoice_id')::uuid)
),'the Company PDF worker cannot claim a future-verified or superseded Company copy');
reset role;
select pg_temp.assert_true(not exists (
  select 1 from phase3c_future_company_copy_before before_row
  left join public.trip_closure_invoice_pdf_copies copy on copy.id=before_row.id
  where copy.id is null or before_row.row_data is distinct from to_jsonb(copy)
),'a blocked Company claim leaves future-version status, attempts, and lease unchanged');

create temporary table phase3c_superseded_notification_before on commit drop as
select notification.id,to_jsonb(notification) as row_data
from public.notification_outbox notification
join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id
where invoice.invoice_number='WB-2026-000044'
  and notification.event_type='waybill_ready' and notification.audience='client';

select pg_temp.assert_true((
  select count(*)=1 from phase3c_superseded_notification_before
),'the synthetic latest Company notification exists before the superseded-version rejection checks');

set local role service_role;
select public.enqueue_waybill_ready_notifications('synthetic-company@example.invalid');
insert into phase3c_followup_claims
select notification.id,notification.trip_id,notification.audience,notification.lease_token,notification.payload
from public.claim_waybill_notifications('phase3c-superseded-copy-check',10) notification;
reset role;

select pg_temp.assert_true(not exists (
  select 1 from phase3c_followup_claims lease
  join public.trip_closure_invoices invoice on invoice.trip_id=lease.trip_id
  where invoice.invoice_number='WB-2026-000044' and lease.audience='client'
),'superseded and future-verified Company PDFs cannot be enqueued or claimed for email');
select set_config('phase3c.superseded_invoice_id',current_setting('phase3c.future_company_invoice_id'),true);
set local role authenticated;
select pg_temp.expect_sqlstate($q$select public.retry_operations_waybill_delivery(
  current_setting('phase3c.superseded_invoice_id')::uuid,
  'client','DELIVERY_UNCONFIRMED')$q$,'P4091',
  'Operations Manager retry cannot release an email for a superseded or future-verified Company copy');
select pg_temp.expect_sqlstate($q$select public.resend_operations_waybill(
  current_setting('phase3c.superseded_invoice_id')::uuid,
  'client','f3c00000-0000-4000-8000-000000000003','CORRECTIVE_RESEND',false)$q$,'P4091',
  'Operations Manager resend cannot release an email for a superseded or future-verified Company copy');
reset role;
select pg_temp.assert_true(not exists (
  select 1 from public.get_operations_waybill_pdf_copy(
    (select invoice.id from public.trip_closure_invoices invoice where invoice.invoice_number='WB-2026-000044'),'company')
),'Operations Manager downloads withhold a pending, future-verified latest Company version');
select pg_temp.assert_true(not exists (
  select 1 from phase3c_superseded_notification_before before_row
  left join public.notification_outbox notification on notification.id=before_row.id
  where notification.id is null or before_row.row_data is distinct from to_jsonb(notification)
),'the complete existing outbox row is unchanged when its Company copy is superseded or future-verified');

set local role service_role;
select pg_temp.assert_true((
  select bool_and(public.finish_trip_notification(lease.id,lease.lease_token,false,null,'synthetic unrelated follow-up release'))
  from phase3c_followup_claims lease
),'unrelated eligible follow-up claim leases are released without provider invocation');
reset role;

select pg_temp.assert_true(not exists (
  select 1 from public.notification_outbox notification
  join public.trip_closure_invoices invoice on invoice.trip_id=notification.trip_id
  where invoice.invoice_number='WB-2026-000044' and notification.audience='client'
    and notification.status='processing'
),'no Company email lease remains active after the rejection tests');

rollback;
