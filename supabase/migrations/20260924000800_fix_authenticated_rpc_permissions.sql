begin;

-- Keep the browser client on the authenticated path. These explicit grants
-- make the RPC contract resilient to older migration order/role state.
grant usage on schema public to authenticated;
grant execute on function public.lookup_loading_truck(text) to authenticated;
grant execute on function public.register_loading_participant(uuid,text,uuid,uuid,text,text,text,text,text,text) to authenticated;
grant execute on function public.create_loading_trip_v2(uuid,text,uuid,uuid,text,timestamptz,text,numeric,text,boolean) to authenticated;
grant execute on function public.close_trip(uuid,uuid,numeric) to authenticated;
grant execute on function public.raise_trip_exception(public.exception_type,text,uuid,uuid,text,boolean) to authenticated;
grant execute on function public.resolve_trip_exception(uuid,text) to authenticated;

commit;
