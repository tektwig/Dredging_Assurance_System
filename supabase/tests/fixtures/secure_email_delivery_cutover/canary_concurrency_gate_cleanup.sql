drop trigger if exists zz_ci_synthetic_email_canary_overlap on public.notification_outbox;
drop function if exists public.ci_hold_synthetic_email_canary_claim();
