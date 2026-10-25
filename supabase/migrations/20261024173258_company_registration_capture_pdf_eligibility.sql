begin;

do $migration$
begin
  if to_regprocedure('private.waybill_company_copy_verification_eligible(uuid,uuid,uuid,uuid)') is null
    or to_regprocedure('private.claim_waybill_pdf_copy_jobs(text,integer,uuid)') is null
    or to_regprocedure('public.get_company_waybill_pdf_snapshot(uuid,uuid)') is null
    or to_regprocedure('private.finish_waybill_pdf_copy_job(text,uuid,uuid,boolean,text)') is null
    or to_regprocedure('private.waybill_company_copy_email_eligible(uuid,uuid,uuid)') is null
    or to_regprocedure('private.waybill_company_storage_object_read_allowed(text)') is null then
    raise exception 'Secure Company Waybill verification migration 20261022085737 must be installed first';
  end if;

  if position('waybill_company_copy_verification_eligible' in pg_catalog.pg_get_functiondef(
       'private.claim_waybill_pdf_copy_jobs(text,integer,uuid)'::regprocedure))=0
    or position('waybill_company_copy_verification_eligible' in pg_catalog.pg_get_functiondef(
       'public.get_company_waybill_pdf_snapshot(uuid,uuid)'::regprocedure))=0
    or position('waybill_company_copy_verification_eligible' in pg_catalog.pg_get_functiondef(
       'private.finish_waybill_pdf_copy_job(text,uuid,uuid,boolean,text)'::regprocedure))=0 then
    raise exception 'Secure Company Waybill verification consumers do not match the expected migration lineage';
  end if;
end;
$migration$;

create or replace function private.waybill_company_copy_verification_eligible(
  p_invoice_id uuid,p_trip_id uuid,p_copy_id uuid,p_bank_snapshot_id uuid
) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_invoice_id is not null and p_trip_id is not null
    and p_copy_id is not null and p_bank_snapshot_id is not null
    and exists (
      select 1
      from public.trip_closure_invoice_pdf_copies copy
      join public.trip_closure_invoices invoice
        on invoice.id=copy.invoice_id and invoice.trip_id=copy.trip_id
      join public.trips trip
        on trip.id=invoice.trip_id and trip.status='closed' and trip.closed_at=invoice.closed_at
      join public.trip_closure_invoice_bank_snapshots snapshot
        on snapshot.id=copy.bank_snapshot_id and snapshot.invoice_id=copy.invoice_id
          and snapshot.trip_id=copy.trip_id
      join public.trip_closure_invoice_bank_submissions submission
        on submission.id=snapshot.source_submission_id and submission.invoice_id=snapshot.invoice_id
          and submission.trip_id=snapshot.trip_id
      where copy.id=p_copy_id and copy.invoice_id=p_invoice_id and copy.trip_id=p_trip_id
        and copy.copy_kind='company' and copy.bank_snapshot_id=p_bank_snapshot_id
        and copy.copy_version=(
          select max(latest.copy_version) from public.trip_closure_invoice_pdf_copies latest
          where latest.invoice_id=copy.invoice_id and latest.trip_id=copy.trip_id
            and latest.copy_kind='company')
        and snapshot.version=copy.copy_version
        and snapshot.version=(
          select max(latest.version) from public.trip_closure_invoice_bank_snapshots latest
          where latest.invoice_id=snapshot.invoice_id and latest.trip_id=snapshot.trip_id)
        and snapshot.bank_name=submission.bank_name
        and snapshot.account_name=submission.account_name
        and snapshot.account_number=submission.account_number
        and snapshot.submitted_by=submission.submitted_by
        and snapshot.submitted_at=submission.submitted_at
        and snapshot.bank_name=btrim(snapshot.bank_name)
        and length(snapshot.bank_name) between 1 and 200
        and snapshot.account_name=btrim(snapshot.account_name)
        and length(snapshot.account_name) between 1 and 200
        and snapshot.account_number ~ '^[0-9]{10}$'
        and (
          (
            snapshot.source_kind='registration_capture'
            and snapshot.version=1
            and snapshot.source_registration_capture_id is not null
            and snapshot.verified_by is null and snapshot.verified_at is null
            and submission.source_kind='registration_capture'
            and submission.source_registration_capture_id=snapshot.source_registration_capture_id
            and exists (
              select 1
              from private.loading_registration_bank_captures capture
              where capture.id=snapshot.source_registration_capture_id
                and capture.driver_id=invoice.driver_id
                and capture.captured_at<=statement_timestamp()
                and capture.bank_name=snapshot.bank_name
                and capture.account_name=snapshot.account_name
                and capture.account_number=snapshot.account_number
                and capture.captured_by=snapshot.submitted_by
                and capture.captured_at=snapshot.submitted_at
                and capture.bank_name=btrim(capture.bank_name)
                and length(capture.bank_name) between 1 and 200
                and capture.account_name=btrim(capture.account_name)
                and length(capture.account_name) between 1 and 200
                and capture.account_number ~ '^[0-9]{10}$'
                and exists (
                  select 1
                  from public.trip_closure_invoice_bank_detail_events event
                  where event.submission_id=submission.id
                    and event.invoice_id=invoice.id and event.trip_id=trip.id
                    and event.event_type='registration_capture_snapshotted'
                    and event.actor_id=capture.captured_by
                    and event.reason_code is null
                    and event.occurred_at>=capture.captured_at
                )
            )
          )
          or (
            snapshot.source_kind='operations_manager'
            and snapshot.source_registration_capture_id is null
            and submission.source_kind='operations_manager'
            and submission.source_registration_capture_id is null
            and snapshot.verified_by is not null and snapshot.verified_at is not null
            and snapshot.verified_at<=statement_timestamp()
            and exists (
              select 1 from public.trip_closure_invoice_bank_detail_events event
              where event.submission_id=submission.id and event.invoice_id=invoice.id
                and event.trip_id=trip.id and event.actor_id=snapshot.verified_by
                and event.occurred_at>=snapshot.verified_at
                and ((event.event_type in ('verified','correction_verified') and event.reason_code='verified')
                  or (event.event_type in ('bank_details_saved','bank_details_corrected')
                    and event.reason_code is null))
            )
          )
        )
    );
$$;

revoke all on function private.waybill_company_copy_verification_eligible(uuid,uuid,uuid,uuid)
  from public,anon,authenticated,service_role;

commit;
