-- METAENGINE Command Fabric v2 emergency lease source contract.
-- Intentionally rollback-only and outside supabase/migrations. This function is a
-- qualification artifact until the dedicated Browser emergency intake is wired and
-- physical preemption tests pass.

begin;

create or replace function public.h205f22_a2_browser_supervisor_lease_emergency_v1(
  p_workspace_id uuid,
  p_client_id text,
  p_lease_timeout_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_client text := left(trim(coalesce(p_client_id, '')), 160);
  v_now timestamptz := clock_timestamp();
  v_timeout integer := greatest(30, least(600, coalesce(p_lease_timeout_seconds, 120)));
  v_row jsonb := null;
begin
  if p_workspace_id is null or v_client = '' then
    raise exception 'supervisor_emergency_lease_identity_invalid';
  end if;

  -- Serialize only the emergency lease selection for this workspace/client. Unlike
  -- general lease_batch_v1 this path intentionally does not wait for an unrelated
  -- already-leased mutation. It can never select a non-emergency command.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || v_client || ':emergency', 0)
  );
  v_now := clock_timestamp();

  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set status = 'EXPIRED', completed_at = v_now, error = 'emergency_command_expired_before_lease'
   where workspace_id = p_workspace_id
     and status = 'PENDING'
     and command_lane = 'EMERGENCY'
     and expires_at <= v_now;

  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set status = 'EXPIRED', completed_at = v_now, error = 'emergency_lease_timeout_no_retry'
   where workspace_id = p_workspace_id
     and status = 'LEASED'
     and command_lane = 'EMERGENCY'
     and (expires_at <= v_now or leased_at is null or leased_at <= v_now - pg_catalog.make_interval(secs => v_timeout));

  with candidate as (
    select c.command_id
      from public.compute_fabric_a2_browser_supervisor_command_h205f22 c
     where c.workspace_id = p_workspace_id
       and c.status = 'PENDING'
       and c.expires_at > v_now
       and (c.target_client_id is null or c.target_client_id = v_client)
       and c.command_lane = 'EMERGENCY'
       and (
         c.action = 'DISARM'
         or (c.action = 'SET_SUPERVISOR_MODE' and upper(coalesce(c.payload->>'mode', '')) = 'OFF')
       )
     order by c.issued_at, c.command_id
     limit 1
     for update of c skip locked
  ), leased as (
    update public.compute_fabric_a2_browser_supervisor_command_h205f22 c
       set status = 'LEASED', leased_by = v_client, leased_at = v_now
      from candidate x
     where c.command_id = x.command_id and c.status = 'PENDING'
    returning c.*
  )
  select jsonb_build_object(
    'command_id', command_id,
    'idempotency_key', idempotency_key,
    'action', action,
    'platform', platform,
    'payload', payload,
    'issued_at', issued_at,
    'expires_at', expires_at,
    'issued_by', issued_by,
    'command_lane', command_lane,
    'effect_key', effect_key,
    'authority_effect', false
  ) into v_row
  from leased;

  return jsonb_build_object(
    'schema', 'metaengine.native-supervisor.emergency-command.v1',
    'command', v_row,
    'leased_count', case when v_row is null then 0 else 1 end,
    'general_mutation_lease_blocks_emergency', false,
    'transport_delivery_is_authority', false,
    'automatic_retry_allowed', false,
    'authority_effect', false
  );
end;
$$;

revoke all on function public.h205f22_a2_browser_supervisor_lease_emergency_v1(uuid,text,integer) from public;
revoke all on function public.h205f22_a2_browser_supervisor_lease_emergency_v1(uuid,text,integer) from anon;
revoke all on function public.h205f22_a2_browser_supervisor_lease_emergency_v1(uuid,text,integer) from authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_lease_emergency_v1(uuid,text,integer) to service_role;

rollback;
