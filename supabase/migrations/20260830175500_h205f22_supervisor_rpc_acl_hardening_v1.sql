-- C3 authority-surface hardening.
-- Distinguish the intentional zero-authority coordination read plane from supervisor RPCs
-- that can advance continuity state. Do not break authenticated read-plane consumers merely
-- to silence an advisor: instead keep the read barrier explicitly authenticated, remove anon/
-- PUBLIC execution, and harden its SECURITY DEFINER search_path. Effect-capable supervisor
-- helpers remain service-role/owner only.

-- Read-plane contract: authenticated agents may observe a bounded, zero-authority snapshot.
-- The function body already schema-qualifies non-pg_catalog relations; an empty search_path
-- removes caller-controlled name resolution from this SECURITY DEFINER boundary.
alter function public.coordination_read_barrier_h205f22() set search_path = '';
revoke execute on function public.coordination_read_barrier_h205f22() from public;
revoke execute on function public.coordination_read_barrier_h205f22() from anon;
grant execute on function public.coordination_read_barrier_h205f22() to authenticated;
grant execute on function public.coordination_read_barrier_h205f22() to service_role;

-- Effect-capable supervisor continuity paths are never a browser/user/worker authority surface.
revoke execute on function public.h205f22_a2_browser_supervisor_continue_if_needed_v1(uuid, text, jsonb) from public;
revoke execute on function public.h205f22_a2_browser_supervisor_continue_if_needed_v1(uuid, text, jsonb) from anon;
revoke execute on function public.h205f22_a2_browser_supervisor_continue_if_needed_v1(uuid, text, jsonb) from authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_continue_if_needed_v1(uuid, text, jsonb) to service_role;

revoke execute on function public.h205f22_a2_browser_supervisor_continuity_trigger_v1() from public;
revoke execute on function public.h205f22_a2_browser_supervisor_continuity_trigger_v1() from anon;
revoke execute on function public.h205f22_a2_browser_supervisor_continuity_trigger_v1() from authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_continuity_trigger_v1() to service_role;
