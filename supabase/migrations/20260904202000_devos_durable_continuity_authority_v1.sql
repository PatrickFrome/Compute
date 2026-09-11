-- METAENGINE Development OS: durable continuity authority v1.
--
-- Reliability boundary:
--   * Browser heartbeat/terminal observations are observed-state input only.
--   * Durable desired-state reconciliation owns successor creation.
--   * This legacy RPC/trigger must never enqueue a Browser physical effect or
--     become a second scheduler beside the durable controller.
--   * Supervisor/process restart policy is intentionally independent from
--     at-most-once physical-effect retry/ambiguity quarantine.
--
-- This migration is source-controlled recovery for live functions that
-- previously delegated continuity to Browser keepalive and could enqueue a
-- SEMANTIC_TYPE continuation command from the heartbeat trigger.

create or replace function public.h205f22_a2_browser_supervisor_continue_if_needed_v1(
  p_workspace_id uuid,
  p_client_id text,
  p_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- The heartbeat row has already persisted the observation before this
  -- AFTER-trigger compatibility hook runs. Do not derive desired state, lease
  -- work, enqueue commands, or perform any Browser/task effect here.
  return jsonb_build_object(
    'issued', false,
    'reason', 'DURABLE_CONTROLLER_OWNS_CONTINUITY',
    'observed_only', true,
    'workspace_id', p_workspace_id,
    'client_id', nullif(left(trim(coalesce(p_client_id, '')), 160), ''),
    'authority_effect', false
  );
end;
$$;

create or replace function public.h205f22_a2_browser_supervisor_continuity_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Compatibility/readback only. The callee is deliberately side-effect free;
  -- durable reconciliation owns any successor-cycle transition.
  perform public.h205f22_a2_browser_supervisor_continue_if_needed_v1(
    new.workspace_id,
    new.client_id,
    new.state
  );
  return new;
exception when others then
  -- Observation persistence must never fail because a compatibility hook did.
  return new;
end;
$$;

revoke all on function public.h205f22_a2_browser_supervisor_continue_if_needed_v1(uuid,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.h205f22_a2_browser_supervisor_continuity_trigger_v1()
  from public, anon, authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_continue_if_needed_v1(uuid,text,jsonb)
  to service_role;
grant execute on function public.h205f22_a2_browser_supervisor_continuity_trigger_v1()
  to service_role;

comment on function public.h205f22_a2_browser_supervisor_continue_if_needed_v1(uuid,text,jsonb)
is 'Observed-state compatibility boundary only. Durable desired-state controller owns continuity/successor creation; never enqueue Browser effects here.';

-- Migration-local semantic guard: fail closed if a future edit accidentally
-- reintroduces the legacy heartbeat-issued continuation authority.
do $$
declare
  v_body text;
  v_probe jsonb;
begin
  select pg_get_functiondef(p.oid)
    into v_body
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'h205f22_a2_browser_supervisor_continue_if_needed_v1'
    and pg_get_function_identity_arguments(p.oid) = 'p_workspace_id uuid, p_client_id text, p_state jsonb';

  if v_body is null then
    raise exception 'devos_continuity_source_body_missing';
  end if;
  if v_body ilike '%LOCAL_RUNTIME_OWNS_CONTINUITY%'
     or v_body ilike '%insert into public.compute_fabric_a2_browser_supervisor_command_h205f22%'
     or v_body ilike '%SEMANTIC_TYPE%' then
    raise exception 'devos_continuity_legacy_browser_authority_present';
  end if;

  v_probe := public.h205f22_a2_browser_supervisor_continue_if_needed_v1(
    '00000000-0000-0000-0000-000000000000'::uuid,
    'source-contract-probe',
    '{}'::jsonb
  );
  if coalesce((v_probe->>'issued')::boolean, true)
     or v_probe->>'reason' <> 'DURABLE_CONTROLLER_OWNS_CONTINUITY'
     or coalesce((v_probe->>'observed_only')::boolean, false) is not true
     or coalesce((v_probe->>'authority_effect')::boolean, true) then
    raise exception 'devos_continuity_observed_only_contract_failed';
  end if;
end;
$$;
