-- C3 authority-surface hardening.
-- These SECURITY DEFINER RPCs are supervisor/control-plane helpers and must not be directly
-- executable through exposed anon/authenticated Data API roles. Trusted server-side callers
-- retain owner/service-role execution semantics.

revoke execute on function public.coordination_read_barrier_h205f22() from public;
revoke execute on function public.coordination_read_barrier_h205f22() from anon;
revoke execute on function public.coordination_read_barrier_h205f22() from authenticated;

revoke execute on function public.h205f22_a2_browser_supervisor_continue_if_needed_v1(uuid, text, jsonb) from public;
revoke execute on function public.h205f22_a2_browser_supervisor_continue_if_needed_v1(uuid, text, jsonb) from anon;
revoke execute on function public.h205f22_a2_browser_supervisor_continue_if_needed_v1(uuid, text, jsonb) from authenticated;

revoke execute on function public.h205f22_a2_browser_supervisor_continuity_trigger_v1() from public;
revoke execute on function public.h205f22_a2_browser_supervisor_continuity_trigger_v1() from anon;
revoke execute on function public.h205f22_a2_browser_supervisor_continuity_trigger_v1() from authenticated;
