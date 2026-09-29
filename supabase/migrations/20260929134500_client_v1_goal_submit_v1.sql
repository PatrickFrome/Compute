-- Client V1 C4 typed user-goal submission.
-- Atomically activates exactly one dependency-free semantic plan point and
-- admits that point through the existing DevOS scheduler ingress. The function
-- allocates no lease/agent/tab/target, performs no Browser actuation, and grants
-- no retry/release/scheduler authority.

create or replace function public.client_v1_goal_submit_v1(
  p_workspace_id uuid,
  p_roadmap_id text,
  p_expected_current_generation bigint,
  p_plan jsonb,
  p_point_id text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, destruktion_meta, extensions, pg_temp
as $$
declare
  v_roadmap_id text := lower(trim(coalesce(p_roadmap_id,'')));
  v_point_id text := lower(trim(coalesce(p_point_id,'')));
  v_nodes jsonb;
  v_node jsonb;
  v_activation jsonb;
  v_admission jsonb;
  v_generation bigint;
  v_task_id text;
begin
  if p_workspace_id is null then
    raise exception 'client_v1_goal_workspace_required' using errcode='22023';
  end if;
  if v_roadmap_id <> 'metaengine-client-v1' then
    raise exception 'client_v1_goal_roadmap_invalid' using errcode='22023';
  end if;
  if coalesce(p_expected_current_generation,-1) < 0 then
    raise exception 'client_v1_goal_expected_generation_invalid' using errcode='22023';
  end if;
  if jsonb_typeof(p_plan) <> 'object'
     or p_plan->>'schema' <> 'metaengine.meta-orchestrator.plan.v1'
     or p_plan->>'roadmap_id' <> v_roadmap_id
     or p_plan->>'automatic_retry_allowed' <> 'false'
     or p_plan->>'task_content_authority' <> 'false'
     or p_plan->>'scheduler_authority' <> 'false'
     or p_plan->>'browser_authority' <> 'false'
     or p_plan->>'release_authority' <> 'false'
     or p_plan->>'authority_effect' <> 'false' then
    raise exception 'client_v1_goal_plan_invalid' using errcode='22023';
  end if;
  if v_point_id !~ '^[a-z0-9][a-z0-9._:-]{2,191}$' then
    raise exception 'client_v1_goal_point_invalid' using errcode='22023';
  end if;

  v_nodes := p_plan->'nodes';
  if jsonb_typeof(v_nodes) <> 'array' or jsonb_array_length(v_nodes) <> 1 then
    raise exception 'client_v1_goal_single_point_required' using errcode='22023';
  end if;
  v_node := v_nodes->0;
  if jsonb_typeof(v_node) <> 'object'
     or lower(coalesce(v_node->>'point_id','')) <> v_point_id
     or coalesce(v_node->>'objective','') = ''
     or jsonb_typeof(coalesce(v_node->'dependencies','[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(v_node->'dependencies','[]'::jsonb)) <> 0 then
    raise exception 'client_v1_goal_initial_point_invalid' using errcode='22023';
  end if;

  -- Nested SECURITY DEFINER RPCs execute in the same Postgres transaction.
  -- Any admission failure rolls back the plan activation too, so the typed
  -- Client cannot observe an activated-but-unadmitted one-point goal.
  v_activation := public.meta_orchestrator_plan_activate_v1(
    p_workspace_id,
    v_roadmap_id,
    p_expected_current_generation,
    p_plan
  );

  if v_activation->>'schema' <> 'metaengine.meta-orchestrator.plan-state.v1'
     or v_activation->>'state' <> 'ACTIVE'
     or coalesce((v_activation->>'authority_effect')::boolean,true) <> false
     or coalesce((v_activation->>'scheduler_authority')::boolean,true) <> false
     or coalesce((v_activation->>'browser_authority')::boolean,true) <> false
     or coalesce((v_activation->>'release_authority')::boolean,true) <> false then
    raise exception 'client_v1_goal_activation_readback_invalid';
  end if;

  v_generation := (v_activation->>'plan_generation')::bigint;
  v_admission := public.meta_orchestrator_task_admit_v1(
    p_workspace_id,
    v_roadmap_id,
    v_generation,
    v_point_id
  );

  if v_admission->>'schema' <> 'metaengine.meta-orchestrator.task-admission.v1'
     or v_admission->>'point_id' <> v_point_id
     or coalesce((v_admission->>'authority_effect')::boolean,true) <> false
     or coalesce((v_admission->>'scheduler_authority')::boolean,true) <> false
     or coalesce((v_admission->>'browser_authority')::boolean,true) <> false
     or coalesce((v_admission->>'release_authority')::boolean,true) <> false
     or coalesce((v_admission->>'task_payload_returned')::boolean,true) <> false
     or coalesce((v_admission->>'scheduler_identity_returned')::boolean,true) <> false then
    raise exception 'client_v1_goal_admission_readback_invalid';
  end if;

  v_task_id := v_admission->>'task_id';
  if v_task_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'client_v1_goal_task_id_invalid';
  end if;

  return jsonb_build_object(
    'schema','metaengine.client-v1.goal-submit.v1',
    'workspace_id',p_workspace_id,
    'roadmap_id',v_roadmap_id,
    'plan_generation',v_generation,
    'point_id',v_point_id,
    'task_id',v_task_id,
    'activation',v_activation,
    'admission',v_admission,
    'atomic_plan_and_admission',true,
    'operator_initiated',true,
    'task_payload_returned',false,
    'scheduler_identity_returned',false,
    'automatic_retry_allowed',false,
    'scheduler_authority',false,
    'browser_authority',false,
    'release_authority',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.client_v1_goal_submit_v1(uuid,text,bigint,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.client_v1_goal_submit_v1(uuid,text,bigint,jsonb,text)
  to service_role;

comment on function public.client_v1_goal_submit_v1(uuid,text,bigint,jsonb,text) is
  'Client V1 one-point goal submission: plan activation + canonical DevOS task admission in one transaction; no lease, Browser actuation, promotion, or automatic retry authority.';
