-- A2 supervisor: reject stale lease completion atomically.
-- This remains a non-authority command/result transport boundary.

create or replace function public.h205f22_a2_browser_supervisor_complete_v4(
  p_workspace_id uuid,
  p_command_id uuid,
  p_client_id text,
  p_ok boolean,
  p_receipt jsonb default '{}'::jsonb,
  p_error text default null,
  p_authority_effect boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.compute_fabric_a2_browser_supervisor_command_h205f22%rowtype;
  v_client text := left(trim(coalesce(p_client_id, '')), 160);
  v_error text := left(coalesce(p_error, 'command_failed'), 500);
  v_authority boolean := false;
begin
  if p_workspace_id is null or p_command_id is null or v_client = '' then
    raise exception 'supervisor_result_identity_invalid';
  end if;

  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set status = case when coalesce(p_ok, false) then 'COMPLETED' else 'FAILED' end,
         completed_at = clock_timestamp(),
         receipt = case when coalesce(p_ok, false) then coalesce(p_receipt, '{}'::jsonb) else null end,
         error = case when coalesce(p_ok, false) then null else v_error end,
         authority_effect = coalesce(p_authority_effect, false)
   where workspace_id = p_workspace_id
     and command_id = p_command_id
     and status = 'LEASED'
     and leased_by = v_client
     and expires_at > clock_timestamp()
     and leased_at is not null
     and leased_at > clock_timestamp() - interval '10 minutes'
  returning * into v_row;

  if found then
    return jsonb_build_object('accepted', true, 'status', v_row.status, 'authority_effect', v_row.authority_effect);
  end if;

  select * into v_row
    from public.compute_fabric_a2_browser_supervisor_command_h205f22
   where workspace_id = p_workspace_id and command_id = p_command_id;
  if not found then raise exception 'supervisor_command_not_found'; end if;
  if v_row.status = 'LEASED' and v_row.leased_by = v_client then
    return jsonb_build_object('accepted', false, 'status', 'EXPIRED', 'error', 'supervisor_lease_expired', 'authority_effect', false);
  end if;
  return jsonb_build_object('accepted', false, 'status', v_row.status, 'error', 'supervisor_lease_not_current', 'authority_effect', false);
end;
$$;

revoke all on function public.h205f22_a2_browser_supervisor_complete_v4(uuid,uuid,text,boolean,jsonb,text,boolean) from public, anon, authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_complete_v4(uuid,uuid,text,boolean,jsonb,text,boolean) to service_role;

comment on function public.h205f22_a2_browser_supervisor_complete_v4(uuid,uuid,text,boolean,jsonb,text,boolean) is
  'Atomically completes only a current, unexpired A2 supervisor lease.';
