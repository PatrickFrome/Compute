-- Native Browser supervisor Edge-only mesh sync authority.
-- Browser devices authenticate at the Edge boundary. Direct database execution remains
-- service-role only so authenticated/anon callers cannot forge persisted mesh state.

revoke all on function public.h205f22_a2_supervisor_mesh_sync_v1(text,jsonb)
  from public, anon, authenticated;

grant execute on function public.h205f22_a2_supervisor_mesh_sync_v1(text,jsonb)
  to service_role;

comment on function public.h205f22_a2_supervisor_mesh_sync_v1(text,jsonb) is
  'Server-only Native Browser Edge mesh state synchronization. Browser devices authenticate at Edge; only service_role may invoke the database RPC directly.';
