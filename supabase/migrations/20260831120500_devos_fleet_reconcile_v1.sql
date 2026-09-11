create or replace function public.devos_fleet_reconcile_v1(p_workspace uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'destruktion_meta'
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_task destruktion_meta.devos_fleet_task_h205f22%rowtype;
  v_claim destruktion_meta.devos_fleet_claim_h205f22%rowtype;
  v_expired_tasks bigint := 0;
  v_expired_claims bigint := 0;
begin
  if p_workspace is null then
    raise exception 'devos_workspace_required' using errcode = '22023';
  end if;

  for v_task in
    select t.*
      from destruktion_meta.devos_fleet_task_h205f22 t
     where t.workspace_id = p_workspace
       and t.state in ('LEASED','RUNNING')
       and t.lease_expires_at is not null
       and t.lease_expires_at <= v_now
     order by t.lease_expires_at, t.task_id
     for update skip locked
  loop
    update destruktion_meta.devos_fleet_task_h205f22
       set state = 'AMBIGUOUS',
           error_code = 'LEASE_EXPIRED_EFFECT_UNKNOWN',
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
          'reason_code', 'LEASE_EXPIRED_EFFECT_UNKNOWN',
          'prior_state', v_task.state,
          'tab_id', v_task.lease_tab_id,
          'target_id', v_task.lease_target_id,
          'agent_generation_epoch', v_task.lease_agent_generation_epoch,
          'lease_expires_at', v_task.lease_expires_at,
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
    'schema', 'metaengine.devos.fleet-reconcile.v1',
    'workspace_id', p_workspace,
    'expired_tasks_fenced_ambiguous', v_expired_tasks,
    'expired_claims', v_expired_claims,
    'requeued_tasks', 0,
    'automatic_retry_allowed', false,
    'authority_effect', false
  );
end
$$;

revoke all on function public.devos_fleet_reconcile_v1(uuid) from public;
revoke all on function public.devos_fleet_reconcile_v1(uuid) from anon;
revoke all on function public.devos_fleet_reconcile_v1(uuid) from authenticated;
grant execute on function public.devos_fleet_reconcile_v1(uuid) to service_role;
