-- Harden the legacy trip closure RPC.
--
-- Field/offloading closure must use close_trip_v2(), which enforces the
-- operational-day session, active site assignment, plate verification,
-- capture evidence, idempotency and audit controls.
--
-- Keep the legacy function for compatibility/history, but do not expose it
-- as an authenticated client RPC.

revoke execute on function public.close_trip(uuid, uuid, numeric) from public;
revoke execute on function public.close_trip(uuid, uuid, numeric) from anon;
revoke execute on function public.close_trip(uuid, uuid, numeric) from authenticated;

grant execute on function public.close_trip(uuid, uuid, numeric) to service_role;
