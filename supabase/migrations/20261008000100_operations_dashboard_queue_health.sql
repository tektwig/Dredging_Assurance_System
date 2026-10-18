create function public.get_operations_dashboard_queue_health() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_as_of timestamptz := statement_timestamp();
  v_result jsonb;
begin
  perform private.require_role(array['operations_manager']::public.app_role[]);

  with pdf_rows as (
    select document.status::text as status, document.next_attempt_at,
      document.lease_until, document.updated_at, document.created_at, document.id
    from public.trip_closure_invoice_documents as document
  ),
  pdf_metrics as (
    select
      count(*) filter (where status = 'pending') as pending_total,
      count(*) filter (where status = 'pending' and next_attempt_at is not null
        and next_attempt_at <= v_as_of) as due_pending,
      count(*) filter (where status = 'processing') as processing_total,
      count(*) filter (where status = 'processing' and lease_until >= v_as_of) as active_processing,
      count(*) filter (where status = 'processing'
        and (lease_until is null or lease_until < v_as_of)) as expired_processing_leases,
      count(*) filter (where status = 'failed') as failed,
      count(*) filter (where status = 'ready') as ready,
      count(*) filter (where status not in ('pending', 'processing', 'failed', 'ready')) as unexpected_status
    from pdf_rows
  )
  select jsonb_build_object(
    'as_of', v_as_of,
    'pdf', jsonb_build_object(
      'pending_total', metrics.pending_total,
      'due_pending', metrics.due_pending,
      'processing_total', metrics.processing_total,
      'active_processing', metrics.active_processing,
      'expired_processing_leases', metrics.expired_processing_leases,
      'failed', metrics.failed,
      'ready', metrics.ready,
      'unexpected_status', metrics.unexpected_status,
      'latest_status', (select case status
        when 'pending' then 'pending' when 'processing' then 'processing'
        when 'failed' then 'failed' when 'ready' then 'ready' else 'unknown' end
        from pdf_rows order by updated_at desc, created_at desc, id desc limit 1),
      'latest_updated_at', (select updated_at
        from pdf_rows order by updated_at desc, created_at desc, id desc limit 1)
    )
  )
  into v_result
  from pdf_metrics as metrics;

  with eligible_notifications as (
    select notification.trip_id, notification.event_type, notification.audience,
      notification.delivery_sequence, notification.status::text as status,
      notification.next_attempt_at, notification.lease_until,
      notification.updated_at, notification.created_at, notification.id
    from public.notification_outbox as notification
    where (notification.event_type = 'trip_closed'
        and notification.audience in ('driver', 'finance'))
      or (notification.event_type = 'waybill_ready'
        and notification.audience in ('driver', 'client'))
  ),
  active_notifications as (
    -- Preserve every outstanding row, even if inconsistent historical data has
    -- a newer terminal retry sequence for the same trip/event/audience.
    select * from eligible_notifications where status in ('pending', 'processing')
  ),
  latest_terminal_notifications as (
    select distinct on (trip_id, event_type, audience) *
    from eligible_notifications
    where status not in ('pending', 'processing')
    order by trip_id, event_type, audience,
      delivery_sequence desc, created_at desc, updated_at desc, id desc
  ),
  current_notifications as (
    select * from active_notifications
    union all
    select latest.*
    from latest_terminal_notifications as latest
    where not exists (
      select 1 from active_notifications as active
      where active.trip_id = latest.trip_id
        and active.event_type = latest.event_type
        and active.audience = latest.audience
    )
  ),
  notification_metrics as (
    select
      count(*) filter (where status = 'pending') as pending_total,
      count(*) filter (where status = 'pending' and next_attempt_at is not null
        and next_attempt_at <= v_as_of) as due_pending,
      count(*) filter (where status = 'processing') as processing_total,
      count(*) filter (where status = 'processing' and lease_until >= v_as_of) as active_processing,
      count(*) filter (where status = 'processing'
        and (lease_until is null or lease_until < v_as_of)) as expired_processing_leases,
      count(*) filter (where status = 'failed') as failed,
      count(*) filter (where status = 'sent') as provider_accepted,
      count(*) filter (where status not in ('pending', 'processing', 'failed', 'sent')) as unexpected_status
    from current_notifications
  )
  select v_result || jsonb_build_object(
    'notifications', jsonb_build_object(
      'pending_total', metrics.pending_total,
      'due_pending', metrics.due_pending,
      'processing_total', metrics.processing_total,
      'active_processing', metrics.active_processing,
      'expired_processing_leases', metrics.expired_processing_leases,
      'failed', metrics.failed,
      'provider_accepted', metrics.provider_accepted,
      'unexpected_status', metrics.unexpected_status,
      'latest_status', (select case status
        when 'pending' then 'pending' when 'processing' then 'processing'
        when 'failed' then 'failed' when 'sent' then 'provider_accepted' else 'unknown' end
        from current_notifications
        order by updated_at desc, delivery_sequence desc, created_at desc, id desc limit 1),
      'latest_updated_at', (select updated_at
        from current_notifications
        order by updated_at desc, delivery_sequence desc, created_at desc, id desc limit 1)
    )
  )
  into v_result
  from notification_metrics as metrics;

  return v_result;
end;
$$;

revoke all on function public.get_operations_dashboard_queue_health()
  from public, anon, authenticated, service_role;
grant execute on function public.get_operations_dashboard_queue_health() to authenticated;

comment on function public.get_operations_dashboard_queue_health() is
  'Returns aggregate-only queue metrics to active Operations Managers. due_pending is a subset of pending_total; expired_processing_leases is a subset of processing_total, and active plus expired processing partitions processing_total (a lease equal to as_of remains active). A NULL notification lease is expired. Notification pending/processing rows are retained across retry sequences so valid outstanding work cannot be hidden; terminal rows report only the latest sequence when that stream has no outstanding row. waybill_ready finance rows are retired and excluded. provider_accepted reflects the persisted sent state, not confirmed email delivery. This snapshot does not report worker execution health.';
