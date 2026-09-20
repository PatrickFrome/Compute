-- METAENGINE Browser emergency lane + emergency lease v1 (2026-09-21).
--
-- Closed-loop audit fix: the DEVELOPER_EMERGENCY_UPDATE command action was
-- admitted (CHECK constraint + dedicated service-role issuer, migration
-- 20260918015500) but the regenerated lane classification (migration
-- 20260919030000) dropped it into the GLOBAL_MUTATION else-branch. Two
-- consequences: (1) an emergency intent contended on the 'global:control-plane'
-- effect key with ordinary control-plane mutations and could be starved behind
-- the exclusive-lane gate; (2) the staged emergency wait route
-- (/v1/commands/wait-emergency) had no real lease RPC — its function existed
-- only as a rollback-wrapped qualification artifact that additionally leased
-- just DISARM / SET_SUPERVISOR_MODE(OFF).
--
-- This migration:
--   1. reclassifies DEVELOPER_EMERGENCY_UPDATE into the EMERGENCY lane with
--      effect_key 'global:emergency' (lane priority 0 in lease_batch_v1 —
--      the browser's normal wait-batch leases it ahead of everything else);
--   2. creates the real h205f22_a2_browser_supervisor_lease_emergency_v1
--      function (single-command, EMERGENCY-lane-only, transaction-fenced),
--      completing the emergency transport end-to-end: dedicated issuer ->
--      PENDING command -> lease (batch or emergency route) -> the browser's
--      auto-wired Guardian handler (independent owner/device/release/effect-
--      journal verification; no blind retry).
--
-- No execution, staging, download or installer authority is granted here.

-- 1) Regenerate the lane/effect classification: DEVELOPER_EMERGENCY_UPDATE
--    joins DISARM and SET_SUPERVISOR_MODE(OFF) in the EMERGENCY lane.
alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  drop column if exists command_lane;
alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  drop column if exists effect_key;

alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  add column command_lane text generated always as (
    case
      when action in (
        'POLL','CAPTURE','CAPTURE_VIEW','CONTROL_CAPABILITIES',
        'PROCESS_CENSUS','PROCESS_EVENTS','SEMANTIC_CENSUS','SEMANTIC_EVENTS','CONTROL_LATENCY_STATUS',
        'TAB_TELEMETRY','SYSTEM_TELEMETRY','READ_TRANSCRIPT',
        'DEV_PLANE_STATUS','DEV_PLANE_HEALTH','DEV_PLANE_CAPABILITIES','DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD',
        'DOWNLOAD_STATUS','SELF_UPDATE_STATUS','GATE_STATUS','TAB_CENSUS','FLEET_STATUS'
      ) then 'READ_ONLY'
      when action in ('DISARM','DEVELOPER_EMERGENCY_UPDATE')
        or (action='SET_SUPERVISOR_MODE' and upper(coalesce(payload->>'mode',''))='OFF') then 'EMERGENCY'
      when action in (
        'STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','RESOLVE_PROMPT','TYPED_CLICK','PRESS_KEY',
        'SELECT_TAB','CLOSE_TAB','NAVIGATE','BACK','FORWARD','RELOAD'
      ) and coalesce(payload->>'tab_id','') ~ '^tab_[0-9A-Fa-f-]{36}$' then 'TAB_MUTATION'
      else 'GLOBAL_MUTATION'
    end
  ) stored;

alter table public.compute_fabric_a2_browser_supervisor_command_h205f22
  add column effect_key text generated always as (
    case
      when action in (
        'POLL','CAPTURE','CAPTURE_VIEW','CONTROL_CAPABILITIES',
        'PROCESS_CENSUS','PROCESS_EVENTS','SEMANTIC_CENSUS','SEMANTIC_EVENTS','CONTROL_LATENCY_STATUS',
        'TAB_TELEMETRY','SYSTEM_TELEMETRY','READ_TRANSCRIPT',
        'DEV_PLANE_STATUS','DEV_PLANE_HEALTH','DEV_PLANE_CAPABILITIES','DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD',
        'DOWNLOAD_STATUS','SELF_UPDATE_STATUS','GATE_STATUS','TAB_CENSUS','FLEET_STATUS'
      ) then null
      when action in ('DISARM','DEVELOPER_EMERGENCY_UPDATE')
        or (action='SET_SUPERVISOR_MODE' and upper(coalesce(payload->>'mode',''))='OFF') then 'global:emergency'
      when action in (
        'STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','RESOLVE_PROMPT','TYPED_CLICK','PRESS_KEY',
        'SELECT_TAB','CLOSE_TAB','NAVIGATE','BACK','FORWARD','RELOAD'
      ) and coalesce(payload->>'tab_id','') ~ '^tab_[0-9A-Fa-f-]{36}$' then 'tab:' || lower(payload->>'tab_id')
      else 'global:control-plane'
    end
  ) stored;

-- 2) Real emergency lease: exactly one EMERGENCY-lane PENDING command per
--    call, fenced per (workspace, client). Reuses the lease_batch expiry and
--    fencing semantics; never touches other lanes.
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
  v_client text := left(trim(coalesce(p_client_id,'')),160);
  v_now timestamptz := clock_timestamp();
  v_timeout integer := greatest(30,least(600,coalesce(p_lease_timeout_seconds,120)));
  v_command public.compute_fabric_a2_browser_supervisor_command_h205f22%rowtype;
begin
  if p_workspace_id is null or v_client='' then raise exception 'supervisor_emergency_lease_identity_invalid'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || v_client, 0)
  );
  v_now := clock_timestamp();

  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set status='EXPIRED',completed_at=v_now,error='command_expired_before_lease'
   where workspace_id=p_workspace_id and status='PENDING' and expires_at<=v_now;

  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set status='EXPIRED',completed_at=v_now,error='lease_timeout_no_retry'
   where workspace_id=p_workspace_id and status='LEASED'
     and (expires_at<=v_now or leased_at is null or leased_at<=v_now-pg_catalog.make_interval(secs=>v_timeout));

  select * into v_command
    from public.compute_fabric_a2_browser_supervisor_command_h205f22
   where workspace_id=p_workspace_id
     and (target_client_id is null or target_client_id=v_client)
     and status='PENDING'
     and command_lane='EMERGENCY'
     and expires_at>v_now
   order by issued_at,command_id
   limit 1
   for update skip locked;

  if not found then
    return jsonb_build_object(
      'schema','metaengine.native-supervisor.emergency-lease.v1',
      'command',null,
      'leased_count',0,
      'command_leasing',false,
      'execution_authority',false,
      'automatic_retry_allowed',false,
      'authority_effect',false
    );
  end if;

  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set status='LEASED',leased_by=v_client,leased_at=v_now
   where command_id=v_command.command_id
   returning * into v_command;

  return jsonb_build_object(
    'schema','metaengine.native-supervisor.emergency-lease.v1',
    'command',jsonb_build_object(
      'command_id',v_command.command_id,
      'action',v_command.action,
      'platform',v_command.platform,
      'payload',v_command.payload,
      'issued_by',v_command.issued_by,
      'issued_at',v_command.issued_at,
      'expires_at',v_command.expires_at,
      'command_lane',v_command.command_lane,
      'effect_key',v_command.effect_key
    ),
    'leased_count',1,
    'command_leasing',false,
    'execution_authority',false,
    'installer_dispatch_authority',false,
    'automatic_retry_allowed',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.h205f22_a2_browser_supervisor_lease_emergency_v1(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_lease_emergency_v1(uuid,text,integer) to service_role;

comment on function public.h205f22_a2_browser_supervisor_lease_emergency_v1(uuid,text,integer) is
  'Leases exactly one EMERGENCY-lane PENDING command (DISARM, SET_SUPERVISOR_MODE OFF, DEVELOPER_EMERGENCY_UPDATE) for a Browser client. Emergency-lane priority without general scheduler contention; Browser-side Guardian handler performs independent verification and forbids blind retry.';
