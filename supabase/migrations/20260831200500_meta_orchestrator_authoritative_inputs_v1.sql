-- METAENGINE Meta-Orchestrator authoritative provider projection v1.
-- Branch-local migration only. Do not apply to production from this convergence task.
--
-- This function is a read-only projection membrane for the existing native supervisor.
-- It exposes only roadmap identity, active durable plan state, Meta routing metadata,
-- bounded roadmap receipt metadata, and fail-closed capacity. It never schedules work,
-- leases a task, exposes worker result text, or grants Browser/release authority.

create or replace function public.meta_orchestrator_authoritative_inputs_v1(
  p_workspace_id uuid,
  p_roadmap_id text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, destruktion_meta, public, pg_temp
as $$
declare
  v_roadmap_id text := lower(trim(coalesce(p_roadmap_id,'')));
  v_auth destruktion_meta.metaengine_devos_roadmap_authority_h205f22%rowtype;
  v_plan jsonb;
  v_tasks jsonb := '[]'::jsonb;
  v_receipts jsonb := '[]'::jsonb;
  v_generation bigint := 0;
begin
  if p_workspace_id is null then raise exception 'meta_inputs_workspace_required'; end if;
  if v_roadmap_id !~ '^[a-z0-9][a-z0-9._:-]{2,159}$' then
    raise exception 'meta_inputs_roadmap_invalid';
  end if;

  select * into v_auth
    from destruktion_meta.metaengine_devos_roadmap_authority_h205f22
   where roadmap_id = v_roadmap_id
   order by updated_at desc
   limit 1;
  if not found then raise exception 'meta_inputs_roadmap_authority_missing'; end if;

  v_plan := public.meta_orchestrator_plan_snapshot_v1(p_workspace_id, v_roadmap_id);
  if coalesce((v_plan->>'found')::boolean,false) then
    v_generation := coalesce((v_plan->>'plan_generation')::bigint,0);
  end if;

  if v_generation > 0 then
    select coalesce(jsonb_agg(row_value order by updated_at, task_id), '[]'::jsonb)
      into v_tasks
      from (
        select
          t.updated_at,
          t.task_id,
          jsonb_build_object(
            'task_id', t.task_id,
            'point_id', t.point_id,
            'role', t.role,
            'base_sha', t.base_sha,
            'state', t.state,
            'lease_generation', t.lease_generation,
            'updated_at', t.updated_at,
            'authority_effect', t.authority_effect,
            'task_spec', jsonb_build_object(
              'meta_orchestrator', jsonb_build_object(
                'roadmap_id', t.task_spec #>> '{meta_orchestrator,roadmap_id}',
                'alignment_epoch', t.task_spec #>> '{meta_orchestrator,alignment_epoch}',
                'plan_generation', t.task_spec #>> '{meta_orchestrator,plan_generation}',
                'parent_plan_point', t.task_spec #>> '{meta_orchestrator,parent_plan_point}',
                'parent_point_id', t.task_spec #>> '{meta_orchestrator,parent_point_id}'
              )
            )
          ) as row_value
        from destruktion_meta.devos_fleet_task_h205f22 t
        where t.workspace_id = p_workspace_id
          and jsonb_typeof(t.task_spec->'meta_orchestrator') = 'object'
          and lower(coalesce(t.task_spec #>> '{meta_orchestrator,roadmap_id}','')) = v_roadmap_id
          and coalesce(t.task_spec #>> '{meta_orchestrator,alignment_epoch}','') ~ '^[0-9]+$'
          and (t.task_spec #>> '{meta_orchestrator,alignment_epoch}')::bigint = v_auth.alignment_epoch
          and coalesce(t.task_spec #>> '{meta_orchestrator,plan_generation}','') ~ '^[0-9]+$'
          and (t.task_spec #>> '{meta_orchestrator,plan_generation}')::bigint = v_generation
        order by t.updated_at desc, t.task_id
        limit 512
      ) q;
  end if;

  select coalesce(jsonb_agg(row_value order by receipt_id), '[]'::jsonb)
    into v_receipts
    from (
      select
        r.receipt_id,
        jsonb_build_object(
          'receipt_id', r.receipt_id,
          'roadmap_id', r.roadmap_id,
          'milestone_key', r.milestone_key,
          'step_kind', r.step_kind,
          'status', r.status,
          'result_checkpoint_id', r.result_checkpoint_id,
          'created_at', r.created_at,
          'authority_effect', false
        ) as row_value
      from destruktion_meta.compute_fabric_roadmap_step_receipt_h205f22 r
      where r.roadmap_id = v_roadmap_id
      order by r.receipt_id desc
      limit 512
    ) q;

  return jsonb_build_object(
    'schema','metaengine.meta-orchestrator.authoritative-inputs.v1',
    'workspace_id',p_workspace_id,
    'roadmap_id',v_auth.roadmap_id,
    'roadmap_authority',jsonb_build_object(
      'authority_key',v_auth.authority_key,
      'roadmap_id',v_auth.roadmap_id,
      'active_milestone_key',v_auth.active_milestone_key,
      'integration_line',v_auth.integration_line,
      'baseline_sha',v_auth.baseline_sha,
      'alignment_epoch',v_auth.alignment_epoch,
      'updated_at',v_auth.updated_at
    ),
    'plan_state',v_plan,
    'tasks',v_tasks,
    'roadmap_receipts',v_receipts,
    -- Current DevOS snapshot does not expose a scheduler-owned slot count. Do not infer
    -- capacity from Browser/worker telemetry here; fail closed until an authoritative
    -- capacity projection exists in the single scheduler control plane.
    'capacity',jsonb_build_object(
      'source','UNSPECIFIED_FAIL_CLOSED',
      'available_slots',0,
      'authority_effect',false
    ),
    'task_meta_projection_only',true,
    'task_payload_exposed',false,
    'result_summary_exposed',false,
    'scheduler_identity_exposed',false,
    'receipt_summary_exposed',false,
    'receipt_evidence_exposed',false,
    'automatic_retry_allowed',false,
    'task_content_authority',false,
    'scheduler_authority',false,
    'browser_authority',false,
    'release_authority',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.meta_orchestrator_authoritative_inputs_v1(uuid,text) from public, anon, authenticated;
grant execute on function public.meta_orchestrator_authoritative_inputs_v1(uuid,text) to service_role;
