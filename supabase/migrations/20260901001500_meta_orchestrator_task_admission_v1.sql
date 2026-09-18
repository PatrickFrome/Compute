-- METAENGINE Meta-Orchestrator durable task admission v1.
-- Branch-local migration only. Do not apply to production from this convergence task.
--
-- The Meta brain never supplies privileged task content here. It names only an exact
-- ACTIVE durable plan generation and point. This RPC rereads roadmap + plan authority,
-- reconstructs the canonical task from the stored plan node, then reuses the one existing
-- devos_fleet_enqueue_v1 scheduler ingress. It does not lease, claim, dispatch or actuate Browser UI.

create or replace function public.meta_orchestrator_task_admit_v1(
  p_workspace_id uuid,
  p_roadmap_id text,
  p_plan_generation bigint,
  p_point_id text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, destruktion_meta, public, pg_temp
as $$
declare
  v_roadmap_id text := lower(trim(coalesce(p_roadmap_id,'')));
  v_point_id text := lower(trim(coalesce(p_point_id,'')));
  v_parent_point text;
  v_variant text := 'PRIMARY';
  v_plan destruktion_meta.meta_orchestrator_plan_state_h205f22%rowtype;
  v_auth destruktion_meta.metaengine_devos_roadmap_authority_h205f22%rowtype;
  v_node jsonb;
  v_role text;
  v_risk text;
  v_objective text;
  v_priority integer;
  v_source_branch text;
  v_target_branch text;
  v_deliverable text;
  v_constraints jsonb;
  v_task_spec jsonb;
  v_key text;
  v_enqueue jsonb;
begin
  if p_workspace_id is null then raise exception 'meta_admit_workspace_required' using errcode = '22023'; end if;
  if v_roadmap_id !~ '^[a-z0-9][a-z0-9._:-]{2,159}$' then raise exception 'meta_admit_roadmap_invalid' using errcode = '22023'; end if;
  if coalesce(p_plan_generation,0) < 1 then raise exception 'meta_admit_plan_generation_invalid' using errcode = '22023'; end if;
  if v_point_id !~ '^[a-z0-9][a-z0-9._:-]{2,191}$' then raise exception 'meta_admit_point_invalid' using errcode = '22023'; end if;

  -- Serialize admission for one semantic point. The downstream enqueue also has a stable
  -- idempotency key, so crash/restart can read back a duplicate without creating two tasks.
  perform pg_advisory_xact_lock(hashtextextended(
    'meta-task-admit:' || p_workspace_id::text || ':' || v_roadmap_id || ':' || p_plan_generation::text || ':' || v_point_id,
    0
  ));

  select * into v_auth
    from destruktion_meta.metaengine_devos_roadmap_authority_h205f22
   where roadmap_id = v_roadmap_id
   order by updated_at desc
   limit 1;
  if not found then raise exception 'meta_admit_roadmap_authority_missing'; end if;

  select * into v_plan
    from destruktion_meta.meta_orchestrator_plan_state_h205f22
   where workspace_id = p_workspace_id
     and roadmap_id = v_roadmap_id
     and plan_generation = p_plan_generation
     and state = 'ACTIVE'
   limit 1;
  if not found then raise exception 'meta_admit_active_plan_missing'; end if;

  if v_plan.alignment_epoch <> v_auth.alignment_epoch
     or v_plan.baseline_sha <> v_auth.baseline_sha
     or v_plan.plan_spec->>'roadmap_id' <> v_auth.roadmap_id
     or v_plan.plan_spec->>'active_milestone_key' <> v_auth.active_milestone_key
     or v_plan.plan_spec->>'integration_line' <> v_auth.integration_line then
    raise exception 'meta_admit_plan_authority_drift';
  end if;

  -- Companion points are deterministic derivatives of one parent node and its risk.
  if right(v_point_id,7) = '.critic' then
    v_variant := 'CRITIC';
    v_parent_point := left(v_point_id,length(v_point_id)-7);
  elsif right(v_point_id,10) = '.falsifier' then
    v_variant := 'FALSIFIER';
    v_parent_point := left(v_point_id,length(v_point_id)-10);
  else
    v_parent_point := v_point_id;
  end if;

  select n.value into v_node
    from jsonb_array_elements(coalesce(v_plan.plan_spec->'nodes','[]'::jsonb)) as n(value)
   where lower(coalesce(n.value->>'point_id','')) = v_parent_point
   limit 1;
  if not found then raise exception 'meta_admit_plan_point_missing'; end if;

  if coalesce(v_node->>'point_id','') <> v_parent_point
     or lower(coalesce(v_node->>'base_sha','')) <> v_auth.baseline_sha
     or coalesce(v_node->>'objective','') = ''
     or coalesce(v_node->>'role','') !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    raise exception 'meta_admit_plan_node_invalid';
  end if;

  v_risk := upper(coalesce(v_node->>'risk','NORMAL'));
  if v_variant = 'CRITIC' and v_risk not in ('HIGH','CRITICAL') then raise exception 'meta_admit_critic_not_required'; end if;
  if v_variant = 'FALSIFIER' and v_risk <> 'CRITICAL' then raise exception 'meta_admit_falsifier_not_required'; end if;

  v_role := case when v_variant = 'PRIMARY' then upper(v_node->>'role') else v_variant end;
  v_objective := case
    when v_variant = 'PRIMARY' then v_node->>'objective'
    else v_variant || ' independently evaluate ' || v_parent_point || ': ' || (v_node->>'objective')
  end;
  v_priority := coalesce((v_node->>'priority')::integer,50) - case when v_variant = 'PRIMARY' then 0 else 1 end;
  v_source_branch := left(coalesce(v_node->>'source_branch',''),240);
  v_target_branch := case when v_variant = 'PRIMARY' then left(coalesce(v_node->>'target_branch',''),240) else '' end;
  v_deliverable := left(coalesce(v_node->>'deliverable',''),4000);
  v_constraints := case when jsonb_typeof(v_node->'constraints')='array' then v_node->'constraints' else '[]'::jsonb end;
  v_constraints := v_constraints || jsonb_build_array(
    'Use the existing DevOS scheduler; do not allocate leases or choose agent/tab/target identity.',
    'Do not blindly retry ambiguous effects.'
  );

  v_task_spec := jsonb_build_object(
    'schema','metaengine.devos.meta-task-spec.v1',
    'objective',v_objective,
    'constraints',v_constraints,
    'deliverable',v_deliverable,
    'source_branch',v_source_branch,
    'target_branch',v_target_branch,
    'required_capabilities',case when jsonb_typeof(v_node->'required_capabilities')='array' then v_node->'required_capabilities' else '[]'::jsonb end,
    'evidence_contract',case when jsonb_typeof(v_node->'evidence_contract')='object' then v_node->'evidence_contract' else jsonb_build_object('required','[]'::jsonb,'min_verified',0) end,
    'meta_orchestrator',jsonb_build_object(
      'roadmap_id',v_auth.roadmap_id,
      'alignment_epoch',v_auth.alignment_epoch,
      'plan_generation',v_plan.plan_generation,
      'parent_plan_point',v_parent_point,
      'parent_point_id',case when v_variant='PRIMARY' then null else v_parent_point end
    ),
    'automatic_retry_allowed',false,
    'page_data_authority',false,
    'model_output_authority',false,
    'task_content_authority',false,
    'scheduler_authority',false,
    'browser_authority',false,
    'release_authority',false,
    'authority_effect',false
  );

  if jsonb_path_exists(v_task_spec,'$.**.agent_id')
     or jsonb_path_exists(v_task_spec,'$.**.tab_id')
     or jsonb_path_exists(v_task_spec,'$.**.target_id')
     or jsonb_path_exists(v_task_spec,'$.**.lease_generation')
     or jsonb_path_exists(v_task_spec,'$.**.claim_id') then
    raise exception 'meta_admit_scheduler_identity_forbidden';
  end if;

  v_key := 'meta:' || v_auth.roadmap_id || ':' || v_auth.alignment_epoch::text || ':' || v_plan.plan_generation::text || ':' || v_point_id;
  v_enqueue := public.devos_fleet_enqueue_v1(
    p_workspace_id,
    v_point_id,
    v_role,
    v_auth.baseline_sha,
    v_task_spec,
    v_key,
    nullif(v_target_branch,''),
    v_priority
  );

  return jsonb_build_object(
    'schema','metaengine.meta-orchestrator.task-admission.v1',
    'workspace_id',p_workspace_id,
    'roadmap_id',v_auth.roadmap_id,
    'alignment_epoch',v_auth.alignment_epoch,
    'plan_generation',v_plan.plan_generation,
    'point_id',v_point_id,
    'parent_plan_point',v_parent_point,
    'variant',v_variant,
    'task_id',v_enqueue->>'task_id',
    'duplicate',coalesce((v_enqueue->>'duplicate')::boolean,false),
    'task_spec_sha256',v_enqueue->>'task_spec_sha256',
    'task_payload_returned',false,
    'scheduler_identity_returned',false,
    'automatic_retry_allowed',false,
    'task_content_authority',false,
    'scheduler_authority',false,
    'browser_authority',false,
    'release_authority',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.meta_orchestrator_task_admit_v1(uuid,text,bigint,text) from public, anon, authenticated;
grant execute on function public.meta_orchestrator_task_admit_v1(uuid,text,bigint,text) to service_role;
