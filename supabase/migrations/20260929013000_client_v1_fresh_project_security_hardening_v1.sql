-- METAENGINE Client V1 fresh-project security/performance hardening.
-- Findings are from Supabase advisors after the fresh Browser/DevOS bootstrap.

-- SECURITY DEFINER RPCs are Edge/service boundaries, not public PostgREST APIs.
revoke all on function public.h205f22_a2_browser_self_update_observe_v1(text)
  from public, anon, authenticated;
grant execute on function public.h205f22_a2_browser_self_update_observe_v1(text)
  to service_role;

revoke all on function public.h205f22_a2_supervisor_mesh_heartbeat_v1(text,text,text)
  from public, anon, authenticated;
grant execute on function public.h205f22_a2_supervisor_mesh_heartbeat_v1(text,text,text)
  to service_role;

-- Platform event-trigger helper must never be callable through the exposed API.
-- Guarded: public.rls_auto_enable() is defined nowhere in this chain (live-only
-- platform helper). Per the documented fresh-project contract
-- (supabase/operations/20261005191500) a missing function skips with NOTICE
-- instead of failing the fresh migration run.
do $guard$
begin
  if to_regprocedure('public.rls_auto_enable()') is null then
    raise notice 'skip: public.rls_auto_enable() is defined nowhere in this chain (live-only object)';
  else
    revoke all on function public.rls_auto_enable()
      from public, anon, authenticated;
  end if;
end
$guard$;

-- Trigger function uses only explicitly qualified realtime.send plus pg_catalog helpers.
alter function public.glm_browser_pulse_notify_v1()
  set search_path = pg_catalog, public, realtime;
revoke all on function public.glm_browser_pulse_notify_v1()
  from public, anon, authenticated;

-- Cover the owner-gate FK used when commands are pruned/reconciled.
create index if not exists a2_owner_gate_source_command_idx
  on public.compute_fabric_a2_owner_gate_override_h205f22(source_command_id);
