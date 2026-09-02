-- DEVOS result-ready expiry fence v1
-- Branch-local migration only. Do not apply to production without independent evidence.

create or replace function public.devos_fleet_reconcile_v1(p_workspace uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'destruktion_meta'
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_task destruktion_meta.devos_fleet_task_h205f22%rowtype;
  v_claim destruktion_meta.devos_fleet_claim_h205f22%rowtype;
  v_expired_tasks bigint := 0;
  v_expired_claims bigint := 0;
  v_reason text;
begin
  if p_workspace is null then
    raise exception 'devos_workspace_required' using errcode = '22023';
  end if;

  for v_task in
    select t.*
      from destruktion_meta.devos_fleet_task_h205f22 t
     where t.workspace_id = p_workspace
       and t.state in ('LEASED','RUNNING','RESULT_READY','BLOCKED')
       and t.lease_expires_at is not null
       and t.lease_expires_at <= v_now
     order by t.lease_expires_at, t.task_id
     for update skip locked
  loop
    v_reason := case v_task.state
      when 'RESULT_READY' then 'LEASE_EXPIRED_RESULT_UNADOPTED'
      when 'BLOCKED' then 'LEASE_EXPIRED_BLOCKED_UNRESOLVED'
      else 'LEASE_EXPIRED_EFFECT_UNKNOWN'
    end;

    update destruktion_meta.devos_fleet_task_h205f22
       set state = 'AMBIGUOUS',
           error_code = v_reason,
           updated_at = v_now
     where task_id = v_task.task_id
       and state = v_task.state
       and lease_generation = v_task.lease_generation;

    if found then
      v_expired_tasks := v_expired_tasks + 1;
      perform destruktion_meta.devos_emit_event_h205f22(
        v_task.workspace_id,
        'TASK_LEASE_EXPIRED_AMBIGUOUS',
        v_task.task_id,
        v_task.point_id,
        v_task.role,
        v_task.lease_agent_id,
        v_task.lease_generation,
        v_task.base_sha,
        jsonb_build_object(
          'reason_code', v_reason,
          'prior_state', v_task.state,
          'tab_id', v_task.lease_tab_id,
          'target_id', v_task.lease_target_id,
          'agent_generation_epoch', v_task.lease_agent_generation_epoch,
          'lease_expires_at', v_task.lease_expires_at,
          'result_sha256', v_task.result_sha256,
          'automatic_retry_allowed', false,
          'authority_effect', false
        ),
        v_task.idempotency_key || ':lease-expired:' || v_task.lease_generation
      );
    end if;
  end loop;

  for v_claim in
    select c.*
      from destruktion_meta.devos_fleet_claim_h205f22 c
     where c.workspace_id = p_workspace
       and c.state = 'ACTIVE'
       and c.expires_at <= v_now
     order by c.expires_at, c.claim_id
     for update skip locked
  loop
    update destruktion_meta.devos_fleet_claim_h205f22
       set state = 'EXPIRED',
           updated_at = v_now
     where claim_id = v_claim.claim_id
       and state = 'ACTIVE'
       and lease_generation = v_claim.lease_generation;

    if found then
      v_expired_claims := v_expired_claims + 1;
      perform destruktion_meta.devos_emit_event_h205f22(
        v_claim.workspace_id,
        'CLAIM_EXPIRED',
        v_claim.task_id,
        v_claim.point_id,
        v_claim.role,
        v_claim.agent_id,
        v_claim.lease_generation,
        v_claim.base_sha,
        jsonb_build_object(
          'claim_id', v_claim.claim_id,
          'claim_class', v_claim.claim_class,
          'tab_id', v_claim.tab_id,
          'target_id', v_claim.target_id,
          'agent_generation_epoch', v_claim.agent_generation_epoch,
          'expires_at', v_claim.expires_at,
          'automatic_retry_allowed', false,
          'authority_effect', false
        ),
        'devos:claim-expired:' || v_claim.claim_id || ':' || v_claim.lease_generation
      );
    end if;
  end loop;

  return jsonb_build_object(
    'schema', 'metaengine.devos.fleet-reconcile.v2',
    'workspace_id', p_workspace,
    'expired_tasks_fenced_ambiguous', v_expired_tasks,
    'expired_claims', v_expired_claims,
    'requeued_tasks', 0,
    'automatic_retry_allowed', false,
    'authority_effect', false
  );
end
$function$;

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
  if not pg_try_advisory_xact_lock(20522, 83101) then
    return jsonb_build_object(
      'schema','metaengine.devos.fleet-watchdog.v1',
      'skipped','CONCURRENT_WATCHDOG',
      'automatic_retry_allowed',false,
      'authority_effect',false
    );
  end if;

  update public.compute_fabric_a2_supervisor_mesh_instance_h205f22
     set status='LOST',
         tab_id=null,
         retired_at=coalesce(retired_at,clock_timestamp()),
         authority_effect=false
   where status='ACTIVE'
     and last_seen_at < clock_timestamp() - interval '5 minutes';
  get diagnostics v_mesh_lost = row_count;

  for v_workspace in
    select distinct q.workspace_id
    from (
      select t.workspace_id
        from destruktion_meta.devos_fleet_task_h205f22 t
       where t.state in ('LEASED','RUNNING','RESULT_READY','BLOCKED')
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
    v_claims := v_claims + coalesce(
      (v_result->>'expired_claims')::integer,
      (v_result->>'expired_or_orphan_claims_closed')::integer,
      0
    );
  end loop;

  return jsonb_build_object(
    'schema','metaengine.devos.fleet-watchdog.v2',
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
