-- DevOS fleet lease reconciliation. Branch-local source checkpoint only until explicitly deployed.
-- Expired work is fenced as AMBIGUOUS; it is never returned to READY automatically.

create or replace function public.devos_fleet_reconcile_v1(p_workspace uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'destruktion_meta', 'extensions'
as $function$
declare
  v_task record;
  v_task_count integer := 0;
  v_claim_count integer := 0;
begin
  for v_task in
    update destruktion_meta.devos_fleet_task_h205f22
       set state = 'AMBIGUOUS',
           error_code = 'LEASE_EXPIRED_EFFECT_UNKNOWN',
           updated_at = clock_timestamp()
     where workspace_id = p_workspace
       and state in ('LEASED','RUNNING')
       and lease_expires_at <= clock_timestamp()
     returning task_id, workspace_id, point_id, role, lease_agent_id,
               lease_generation, base_sha, idempotency_key
  loop
    v_task_count := v_task_count + 1;
    update destruktion_meta.devos_fleet_claim_h205f22
       set state = 'FENCED', updated_at = clock_timestamp()
     where task_id = v_task.task_id
       and lease_generation = v_task.lease_generation
       and state = 'ACTIVE';

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
        'error_code','LEASE_EXPIRED_EFFECT_UNKNOWN',
        'automatic_retry_allowed',false,
        'authority_effect',false
      ),
      v_task.idempotency_key || ':lease-expired:' || v_task.lease_generation
    );
  end loop;

  update destruktion_meta.devos_fleet_claim_h205f22
     set state = 'EXPIRED', updated_at = clock_timestamp()
   where workspace_id = p_workspace
     and state = 'ACTIVE'
     and expires_at <= clock_timestamp();
  get diagnostics v_claim_count = row_count;

  return jsonb_build_object(
    'schema','metaengine.devos.fleet-reconcile.v1',
    'expired_tasks_fenced_ambiguous',v_task_count,
    'expired_or_orphan_claims_closed',v_claim_count,
    'automatic_retry_allowed',false,
    'authority_effect',false
  );
end
$function$;

revoke all on function public.devos_fleet_reconcile_v1(uuid) from public, anon, authenticated;
