create or replace function public.h205f22_a2_browser_supervisor_lease_v2(
  p_workspace_id uuid,
  p_client_id text,
  p_lease_timeout_seconds integer default 120
) returns jsonb
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  select public.h205f22_a2_browser_supervisor_lease_control_v4(
    p_workspace_id,
    p_client_id,
    p_lease_timeout_seconds
  );
$$;

revoke all on function public.h205f22_a2_browser_supervisor_lease_v2(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_lease_v2(uuid,text,integer) to service_role;
comment on function public.h205f22_a2_browser_supervisor_lease_v2(uuid,text,integer) is 'Compatibility route to lease_control_v4; SET_SUPERVISOR_MODE is reserved for bootstrap authority.';
