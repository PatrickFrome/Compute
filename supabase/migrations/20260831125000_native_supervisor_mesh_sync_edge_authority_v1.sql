-- Native Browser supervisor Edge-only mesh sync authority.
-- Browser devices authenticate at the Edge boundary. Direct database execution remains
-- service-role only so authenticated/anon callers cannot forge persisted mesh state.
--
-- Guarded: public.h205f22_a2_supervisor_mesh_sync_v1(text,jsonb) is created later
-- in the chain (20260902205500_supervisor_mesh_terminal_freshness_v1). Per the
-- documented fresh-project contract (supabase/operations/20261005191500:
-- "Historical migration IDs are intentionally not replayed ... ordering assumed
-- pre-existing R1 objects") a missing function skips with NOTICE instead of
-- failing the fresh migration run.

do $guard$
begin
  if to_regprocedure('public.h205f22_a2_supervisor_mesh_sync_v1(text,jsonb)') is null then
    raise notice 'skip: public.h205f22_a2_supervisor_mesh_sync_v1(text,jsonb) not created yet (20260902205500)';
  else
    revoke all on function public.h205f22_a2_supervisor_mesh_sync_v1(text,jsonb)
      from public, anon, authenticated;

    grant execute on function public.h205f22_a2_supervisor_mesh_sync_v1(text,jsonb)
      to service_role;

    comment on function public.h205f22_a2_supervisor_mesh_sync_v1(text,jsonb) is
      'Server-only Native Browser Edge mesh state synchronization. Browser devices authenticate at Edge; only service_role may invoke the database RPC directly.';
  end if;
end
$guard$;
