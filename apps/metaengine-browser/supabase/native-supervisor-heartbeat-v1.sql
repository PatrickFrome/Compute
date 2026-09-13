begin;

create or replace function public.h205f22_a2_browser_supervisor_heartbeat_v1(
  p_workspace_id uuid,
  p_client_id text,
  p_authority_effect boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seen_at timestamptz;
begin
  if p_authority_effect is distinct from false then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'AUTHORITY_EFFECT_FORBIDDEN',
      'automatic_retry_allowed', false,
      'authority_effect', false
    );
  end if;

  if p_workspace_id is null
     or p_client_id is null
     or length(btrim(p_client_id)) < 1
     or length(p_client_id) > 160 then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'IDENTITY_INVALID',
      'automatic_retry_allowed', false,
      'authority_effect', false
    );
  end if;

  update public.compute_fabric_a2_browser_supervisor_state_h205f22
     set last_seen_at = clock_timestamp()
   where client_id = p_client_id
     and workspace_id = p_workspace_id
  returning last_seen_at into v_seen_at;

  if not found then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'STATE_NOT_REGISTERED',
      'automatic_retry_allowed', false,
      'authority_effect', false
    );
  end if;

  return jsonb_build_object(
    'schema', 'metaengine.native-supervisor.heartbeat-db-ack.v1',
    'accepted', true,
    'client_id', p_client_id,
    'workspace_id', p_workspace_id,
    'last_seen_at', v_seen_at,
    'state_mutated', false,
    'command_leasing', false,
    'control_authority', false,
    'automatic_retry_allowed', false,
    'authority_effect', false
  );
end;
$$;

revoke all on function public.h205f22_a2_browser_supervisor_heartbeat_v1(uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_heartbeat_v1(uuid,text,boolean) to service_role;

commit;
