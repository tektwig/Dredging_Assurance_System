\set ON_ERROR_STOP on
begin;

create function pg_temp.assert_true(p_value boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_value is distinct from true then
    raise exception 'V4 browser E2E persistence assertion failed: %', p_message;
  end if;
  raise notice 'ASSERTION PASS: %', p_message;
end;
$$;

select pg_temp.assert_true((
  select count(*) = 1
  from public.drivers driver
  where driver.full_name = 'Synthetic E2E Browser Driver'
    and driver.phone_number = '08025550101'
), 'one synthetic driver was persisted');

select pg_temp.assert_true((
  select count(*) = 1
  from public.trucks truck
  join public.drivers driver on driver.id = truck.driver_id
  where truck.normalized_registration = 'KJA102AB'
    and driver.full_name = 'Synthetic E2E Browser Driver'
), 'new-driver registration created one truck linked to the synthetic driver');

select pg_temp.assert_true((
  select count(*) = 1
  from private.loading_request_receipts receipt
  where receipt.actor_id = :'loading_id'::uuid
    and receipt.request_id = :'new_registration_request_id'::uuid
    and receipt.operation = 'register_loading_participant_payment_free_v3'
), 'V4 registration retained exactly one v3 idempotency receipt');

select pg_temp.assert_true((
  select count(*) = 1
  from private.loading_registration_bank_captures capture
  join public.drivers driver on driver.id = capture.driver_id
  where capture.captured_by = :'loading_id'::uuid
    and capture.registration_request_id = :'new_registration_request_id'::uuid
    and driver.full_name = 'Synthetic E2E Browser Driver'
    and capture.bank_name = 'Synthetic E2E Bank'
    and capture.account_number = '9081726354'
    and capture.account_name = 'Synthetic E2E Account Holder'
), 'one restricted bank capture was atomically persisted for new-driver registration');

select pg_temp.assert_true((
  select count(*) = 1
  from private.loading_request_receipts receipt
  where receipt.actor_id = :'loading_id'::uuid
    and receipt.request_id = :'existing_driver_request_id'::uuid
    and receipt.operation = 'register_loading_participant_payment_free_v3'
), 'existing-driver selection has its own idempotent registration receipt');

select pg_temp.assert_true((
  select count(*) = 2
    and count(distinct truck.driver_id) = 1
  from public.trucks truck
  join public.drivers driver on driver.id = truck.driver_id
  where truck.normalized_registration in ('KJA102AB', 'KJA103AB')
    and driver.full_name = 'Synthetic E2E Browser Driver'
), 'existing-driver selection created the second truck without duplicating the driver');

select pg_temp.assert_true((
  select count(*) = 1
  from private.loading_registration_bank_captures capture
  join public.drivers driver on driver.id = capture.driver_id
  where driver.full_name = 'Synthetic E2E Browser Driver'
), 'existing-driver selection did not create a second bank capture');

select pg_temp.assert_true((
  select count(*) = 1
  from public.trips trip
  join public.trucks truck on truck.id = trip.truck_id
  join public.drivers driver on driver.id = trip.driver_id
  where truck.normalized_registration = 'KJA102AB'
    and driver.full_name = 'Synthetic E2E Browser Driver'
    and trip.status = 'open'
    and trip.quantity_tonnes is null
    and trip.closed_at is null
), 'Loading Portal opened one trip and did not close it');

select pg_temp.assert_true((
  select count(*) = 1
  from public.trips trip
  join public.trucks truck on truck.id = trip.truck_id
  join public.trip_loading_evidence evidence on evidence.trip_id = trip.id
  join storage.objects object on object.bucket_id = 'loading-plate-evidence'
    and object.name = evidence.image_path
  where truck.normalized_registration = 'KJA102AB'
    and evidence.captured_by = :'loading_id'::uuid
    and evidence.capture_method = 'OCR'
    and object.owner_id = :'loading_id'
    and object.metadata->>'mimetype' = 'image/jpeg'
), 'trip opening linked the authenticated user-owned image stored in the private Loading evidence bucket');

select pg_temp.assert_true(not exists (
  select 1 from public.audit_log audit
  where to_jsonb(audit)::text like '%Synthetic E2E Bank%'
     or to_jsonb(audit)::text like '%9081726354%'
     or to_jsonb(audit)::text like '%Synthetic E2E Account Holder%'
), 'synthetic bank values were not copied into the ordinary audit log');

rollback;
