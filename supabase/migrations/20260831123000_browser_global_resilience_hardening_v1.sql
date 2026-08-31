-- METAENGINE Browser global resilience hardening v1.
-- Branch-local release-candidate migration. No production authority is granted here.
-- Goals:
--   * Browser/DevOS lease recovery must continue even when every Browser process is gone.
--   * stale supervisor rows must not masquerade as healthy runtime.
--   * effect-capable supervisor RPC/table surfaces stay server-only.
--   * reconciliation never retries an effect whose outcome is unknown.

-- ---------------------------------------------------------------------------
-- 1. Supervisor RPC least-authority hardening.
-- ---------------------------------------------------------------------------

alter function public.coordination_read_barrier_h205f22() set search_path = '';
revoke execute on function public.coordination_read_barrier_h205f22() from public;
revoke execute on function public.coordination_read_barrier_h205f22() from anon;
grant execute on function public.coordination_read_barrier_h205f22() to authenticated;
grant execute on function public.coordination_read_barrier_h205f22() to service_role;

alter function public.h205f22_a2_browser_supervisor_continue_if_needed_v1(uuid, text, jsonb) set search_path = '';
revoke execute on function public.h205f22_a2_browser_supervisor_continue_if_needed_v1(uuid, text, jsonb) from public;
revoke execute on function public.h205f22_a2_browser_supervisor_continue_if_needed_v1(uuid, text, jsonb) from anon;
revoke execute on function public.h205f22_a2_browser_supervisor_continue_if_needed_v1(uuid, text, jsonb) from authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_continue_if_needed_v1(uuid, text, jsonb) to service_role;

alter function public.h205f22_a2_browser_supervisor_continuity_trigger_v1() set search_path = '';
revoke execute on function public.h205f22_a2_browser_supervisor_continuity_trigger_v1() from public;
revoke execute on function public.h205f22_a2_browser_supervisor_continuity_trigger_v1() from anon;
revoke execute on function public.h205f22_a2_browser_supervisor_continuity_trigger_v1() from authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_continuity_trigger_v1() to service_role;

-- ---------------------------------------------------------------------------
-- 2. Supervisor storage least-authority hardening.
-- ---------------------------------------------------------------------------

alter table public.compute_fabric_a2_supervisor_mesh_instance_h205f22 enable row level security;
alter table public.compute_fabric_a2_supervisor_actuation_lease_h205f22 enable row level security;
alter table public.compute_fabric_development_gate_policy_h205f22 enable row level security;

revoke all privileges on table public.compute_fabric_a2_supervisor_mesh_instance_h205f22 from public, anon, authenticated;
revoke all privileges on table public.compute_fabric_a2_supervisor_actuation_lease_h205f22 from public, anon, authenticated;
revoke all privileges on table public.compute_fabric_development_gate_policy_h205f22 from public, anon, authenticated;

grant select, insert, update, delete on table public.compute_fabric_a2_supervisor_mesh_instance_h205f22 to service_role;
grant select, insert, update, delete on table public.compute_fabric_a2_supervisor_actuation_lease_h205f22 to service_role;
grant select, insert, update, delete on table public.compute_fabric_development_gate_policy_h205f22 to service_role;

-- Cover the composite FK used during coordinator handoff/release. The unique active-client
-- index cannot serve this lookup because it is keyed by target_client_id instead.
create index if not exists a2_supervisor_actuation_holder_fk_idx
  on public.compute_fabric_a2_supervisor_actuation_lease_h205f22
  (workspace_id, holder_supervisor_instance_id);

-- ---------------------------------------------------------------------------
-- 3. Explicit RPC authority for the Browser Edge service only.
--    The v1 migration intentionally removed public/browser execution but omitted this
--    explicit grant. Keep the function invokable through the authenticated Edge service.
-- ---------------------------------------------------------------------------

revoke all on function public.devos_fleet_reconcile_v1(uuid) from public, anon, authenticated;
grant execute on function public.devos_fleet_reconcile_v1(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. DB-native recovery watchdog.
--    This is deliberately NOT a scheduler: it never leases READY work and never performs
--    Browser effects. It only fences expired unknown effects as AMBIGUOUS and closes stale
--    claims by delegating to the same reconciliation primitive used by Browser heartbeat.
-- ---------------------------------------------------------------------------

create or replace function destruktion_meta.devos_fleet_watchdog_h205f22()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'destruktion_meta', 'public', 'extensions'
as $function$
declare
  v_workspace uuid;
  v_result jsonb;
  v_workspaces integer := 0;
  v_tasks integer := 0;
  v_claims integer := 0;
  v_mesh_lost integer := 0;
begin
  -- One recovery authority even if a manual invocation overlaps pg_cron.
  if not pg_try_advisory_xact_lock(20522, 83101) then
    return jsonb_build_object(
      'schema','metaengine.devos.fleet-watchdog.v1',
      'skipped','CONCURRENT_WATCHDOG',
      'automatic_retry_allowed',false,
      'authority_effect',false
    );
  end if;

  -- Make persisted mesh health truthful. Freshness is already enforced by issue_mesh_v1;
  -- this cleanup only prevents long-dead rows from presenting as ACTIVE in readback.
  update public.compute_fabric_a2_supervisor_mesh_instance_h205f22
     set status='LOST',
         tab_id=null,
         retired_at=coalesce(retired_at,clock_timestamp()),
         authority_effect=false
   where status='ACTIVE'
     and last_seen_at < clock_timestamp() - interval '5 minutes';
  get diagnostics v_mesh_lost = row_count;

  -- Reconcile only workspaces that actually contain expired non-terminal Browser work.
  -- public.devos_fleet_reconcile_v1 never returns an expired unknown effect to READY.
  for v_workspace in
    select distinct q.workspace_id
    from (
      select t.workspace_id
        from destruktion_meta.devos_fleet_task_h205f22 t
       where t.state in ('LEASED','RUNNING')
         and t.lease_expires_at <= clock_timestamp()
      union
      select c.workspace_id
        from destruktion_meta.devos_fleet_claim_h205f22 c
       where c.state='ACTIVE'
         and c.expires_at <= clock_timestamp()
    ) q
  loop
    v_result := public.devos_fleet_reconcile_v1(v_workspace);
    v_workspaces := v_workspaces + 1;
    v_tasks := v_tasks + coalesce((v_result->>'expired_tasks_fenced_ambiguous')::integer,0);
    v_claims := v_claims + coalesce((v_result->>'expired_or_orphan_claims_closed')::integer,0);
  end loop;

  return jsonb_build_object(
    'schema','metaengine.devos.fleet-watchdog.v1',
    'workspaces_reconciled',v_workspaces,
    'expired_tasks_fenced_ambiguous',v_tasks,
    'expired_or_orphan_claims_closed',v_claims,
    'stale_mesh_instances_marked_lost',v_mesh_lost,
    'leases_ready_work',false,
    'scheduler_source','NONE_RECOVERY_ONLY',
    'automatic_retry_allowed',false,
    'authority_effect',false
  );
end
$function$;

revoke all on function destruktion_meta.devos_fleet_watchdog_h205f22() from public, anon, authenticated, service_role;

-- Idempotently install exactly one DB-native recovery event source.
do $block$
declare
  v_jobid bigint;
begin
  for v_jobid in
    select jobid from cron.job where jobname='metaengine-h205f22-devos-fleet-watchdog'
  loop
    perform cron.unschedule(v_jobid);
  end loop;

  perform cron.schedule(
    'metaengine-h205f22-devos-fleet-watchdog',
    '30 seconds',
    'select destruktion_meta.devos_fleet_watchdog_h205f22();'
  );
end
$block$;
