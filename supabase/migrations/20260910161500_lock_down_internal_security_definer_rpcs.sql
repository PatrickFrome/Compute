-- P0 security hardening applied to production on 2026-09-10.
-- Keep repository migration history aligned with the live authority state.

begin;

revoke all on function public.devos_transport_promotion_lease_v1(uuid,text,text,text,text,bigint) from public;
revoke all on function public.devos_transport_promotion_lease_v1(uuid,text,text,text,text,bigint) from anon;
revoke all on function public.devos_transport_promotion_lease_v1(uuid,text,text,text,text,bigint) from authenticated;
grant execute on function public.devos_transport_promotion_lease_v1(uuid,text,text,text,text,bigint) to service_role;

revoke all on function public.devos_transport_promotion_release_v1(uuid,text,uuid,text,text,text,bigint) from public;
revoke all on function public.devos_transport_promotion_release_v1(uuid,text,uuid,text,text,text,bigint) from anon;
revoke all on function public.devos_transport_promotion_release_v1(uuid,text,uuid,text,text,text,bigint) from authenticated;
grant execute on function public.devos_transport_promotion_release_v1(uuid,text,uuid,text,text,text,bigint) to service_role;

revoke all on function public.coordination_read_barrier_h205f22() from public;
revoke all on function public.coordination_read_barrier_h205f22() from anon;
revoke all on function public.coordination_read_barrier_h205f22() from authenticated;
grant execute on function public.coordination_read_barrier_h205f22() to service_role;

commit;
