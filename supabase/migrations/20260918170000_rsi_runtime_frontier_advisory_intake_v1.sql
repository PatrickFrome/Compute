-- METAENGINE RSI runtime frontier -> existing DevOS advisory intake v1
-- Source-only migration. This does not create a scheduler, execution authority,
-- production promotion authority, or Browser task-enqueue authority.
--
-- The authenticated Browser may publish a bounded zero-authority RSI frontier in
-- its existing native supervisor state. This server-side policy validates that
-- projection and may materialize only ADVISORY PLANNER work through the already
-- existing devos_fleet_enqueue_v1 scheduler surface. A later independently leased
-- Meta-Governor/worker must validate the plan before any implementation task can
-- exist.

create or replace function public.h205f22_rsi_runtime_frontier_intake_v1(
  p_workspace uuid,
  p_client text,
  p_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','destruktion_meta','extensions'
as $function$
declare
  v_rsi jsonb;
  v_frontier jsonb;
  v_entry jsonb;
  v_hypothesis jsonb;
  v_plan jsonb;
  v_source_sha text;
  v_plan_digest text;
  v_opportunity_id text;
  v_priority text;
  v_point text;
  v_key text;
  v_branch text;
  v_spec jsonb;
  v_enqueue jsonb;
  v_seen integer := 0;
  v_enqueued integer := 0;
  v_duplicates integer := 0;
  v_results jsonb := '[]'::jsonb;
begin
  if p_workspace is null
     or coalesce(trim(p_client),'') = ''
     or length(p_client) > 160
     or jsonb_typeof(coalesce(p_state,'{}'::jsonb)) <> 'object' then
    raise exception 'rsi_frontier_intake_invalid_request';
  end if;

  v_rsi := p_state -> 'rsi';
  if v_rsi is null then
    return jsonb_build_object(
      'accepted',true,
      'state','NO_FRONTIER',
      'seen',0,
      'enqueued',0,
      'duplicates',0,
      'scheduler','DEVOS_EXISTING_ONLY',
      'browser_enqueue_authority',false,
      'execution_authority',false,
      'promotion_authority',false,
      'self_update_authority',false,
      'automatic_retry_allowed',false,
      'authority_effect',false
    );
  end if;

  if jsonb_typeof(v_rsi) <> 'object'
     or v_rsi ->> 'schema' <> 'metaengine.rsi.runtime-control-projection.v1'
     or coalesce((v_rsi ->> 'source_binding_exact')::boolean,false) is not true
     or coalesce((v_rsi ->> 'existing_devos_scheduler_required')::boolean,false) is not true
     or coalesce((v_rsi ->> 'browser_can_enqueue_devos_tasks')::boolean,true) is not false
     or coalesce((v_rsi ->> 'direct_execution_enabled')::boolean,true) is not false
     or coalesce((v_rsi ->> 'direct_promotion_enabled')::boolean,true) is not false
     or coalesce((v_rsi ->> 'direct_self_update_enabled')::boolean,true) is not false
     or coalesce((v_rsi ->> 'execution_authority')::boolean,true) is not false
     or coalesce((v_rsi ->> 'production_mutation_authority')::boolean,true) is not false
     or coalesce((v_rsi ->> 'promotion_authority')::boolean,true) is not false
     or coalesce((v_rsi ->> 'self_update_authority')::boolean,true) is not false
     or coalesce((v_rsi ->> 'automatic_retry_allowed')::boolean,true) is not false
     or coalesce((v_rsi ->> 'authority_effect')::boolean,true) is not false then
    raise exception 'rsi_frontier_intake_projection_policy_invalid';
  end if;

  v_source_sha := lower(coalesce(v_rsi ->> 'source_sha',''));
  if v_source_sha !~ '^[0-9a-f]{40}$' then
    raise exception 'rsi_frontier_intake_source_sha_invalid';
  end if;

  v_frontier := coalesce(v_rsi -> 'frontier','[]'::jsonb);
  if jsonb_typeof(v_frontier) <> 'array' or jsonb_array_length(v_frontier) > 4 then
    raise exception 'rsi_frontier_intake_capacity_invalid';
  end if;

  for v_entry in select value from jsonb_array_elements(v_frontier)
  loop
    v_seen := v_seen + 1;
    if jsonb_typeof(v_entry) <> 'object'
       or coalesce((v_entry ->> 'execution_authority')::boolean,true) is not false
       or coalesce((v_entry ->> 'promotion_authority')::boolean,true) is not false
       or coalesce((v_entry ->> 'self_update_authority')::boolean,true) is not false
       or coalesce((v_entry ->> 'automatic_retry_allowed')::boolean,true) is not false
       or coalesce((v_entry ->> 'authority_effect')::boolean,true) is not false then
      raise exception 'rsi_frontier_intake_entry_policy_invalid';
    end if;

    v_opportunity_id := coalesce(v_entry ->> 'opportunity_id','');
    if v_opportunity_id !~ '^opp:[0-9a-f]{24}$' then
      raise exception 'rsi_frontier_intake_opportunity_invalid';
    end if;

    v_hypothesis := v_entry -> 'hypothesis';
    v_plan := v_entry -> 'experiment_plan';
    if jsonb_typeof(v_hypothesis) <> 'object'
       or v_hypothesis ->> 'schema' <> 'metaengine.rsi.experiment-hypothesis.v1'
       or lower(coalesce(v_hypothesis ->> 'source_sha','')) <> v_source_sha
       or coalesce((v_hypothesis ->> 'shadow_only')::boolean,false) is not true
       or coalesce((v_hypothesis ->> 'candidate_can_modify_hypothesis')::boolean,true) is not false
       or coalesce((v_hypothesis ->> 'candidate_can_modify_acceptance_contract')::boolean,true) is not false
       or coalesce((v_hypothesis ->> 'requires_existing_devos_scheduler')::boolean,false) is not true
       or coalesce((v_hypothesis ->> 'requires_independent_evaluator')::boolean,false) is not true
       or coalesce((v_hypothesis ->> 'execution_authority')::boolean,true) is not false
       or coalesce((v_hypothesis ->> 'production_mutation_authority')::boolean,true) is not false
       or coalesce((v_hypothesis ->> 'promotion_authority')::boolean,true) is not false
       or coalesce((v_hypothesis ->> 'self_update_authority')::boolean,true) is not false
       or coalesce((v_hypothesis ->> 'automatic_retry_allowed')::boolean,true) is not false
       or coalesce((v_hypothesis ->> 'authority_effect')::boolean,true) is not false then
      raise exception 'rsi_frontier_intake_hypothesis_invalid';
    end if;

    if jsonb_typeof(v_plan) <> 'object'
       or v_plan ->> 'schema' <> 'metaengine.rsi.devos-experiment-plan.v1'
       or lower(coalesce(v_plan ->> 'source_sha','')) <> v_source_sha
       or coalesce((v_plan ->> 'requires_existing_devos_scheduler')::boolean,false) is not true
       or coalesce((v_plan ->> 'lease_created')::boolean,true) is not false
       or coalesce((v_plan ->> 'agent_assigned')::boolean,true) is not false
       or coalesce((v_plan ->> 'workspace_bound')::boolean,true) is not false
       or coalesce((v_plan ->> 'command_created')::boolean,true) is not false
       or coalesce((v_plan ->> 'execution_authority')::boolean,true) is not false
       or coalesce((v_plan ->> 'production_mutation_authority')::boolean,true) is not false
       or coalesce((v_plan ->> 'promotion_authority')::boolean,true) is not false
       or coalesce((v_plan ->> 'self_update_authority')::boolean,true) is not false
       or coalesce((v_plan ->> 'automatic_retry_allowed')::boolean,true) is not false
       or coalesce((v_plan ->> 'authority_effect')::boolean,true) is not false then
      raise exception 'rsi_frontier_intake_plan_invalid';
    end if;

    if coalesce(v_plan ->> 'hypothesis_id','') <> coalesce(v_hypothesis ->> 'hypothesis_id','')
       or coalesce(v_plan ->> 'hypothesis_digest','') <> coalesce(v_hypothesis ->> 'hypothesis_digest','')
       or coalesce(v_plan #>> '{task_spec,rsi,opportunity_id}','') <> v_opportunity_id
       or lower(coalesce(v_plan #>> '{task_spec,rsi,source_sha}','')) <> v_source_sha then
      raise exception 'rsi_frontier_intake_plan_binding_invalid';
    end if;

    v_plan_digest := lower(coalesce(v_plan ->> 'plan_digest',''));
    if v_plan_digest !~ '^[0-9a-f]{64}$' then
      raise exception 'rsi_frontier_intake_plan_digest_invalid';
    end if;
    v_branch := coalesce(v_plan ->> 'target_branch','');
    if v_branch !~ '^work/rsi/[a-z0-9][a-z0-9-]{1,199}$' then
      raise exception 'rsi_frontier_intake_branch_invalid';
    end if;

    v_priority := upper(coalesce(v_entry ->> 'priority','P3'));
    v_point := 'rsi.frontier.' || left(v_plan_digest,24);
    v_key := left('rsi-frontier:' || lower(p_client) || ':' || v_plan_digest,160);

    -- The Browser proposal is untrusted data. The server-created task objective is
    -- fixed and review-only; the original envelope is included as evidence, not as
    -- execution instructions or authority.
    v_spec := jsonb_build_object(
      'schema','metaengine.rsi.frontier-review-task.v1',
      'objective','Independently validate this bounded RSI hypothesis/experiment proposal against exact source, current GitHub/Supabase evidence and the immutable acceptance contract. Persist acceptance or blocker evidence only. Do not implement, promote, deploy, self-update, or replay an ambiguous effect.',
      'source','NATIVE_BROWSER_RSI_FRONTIER',
      'source_client_id',lower(p_client),
      'source_workspace_id',p_workspace,
      'source_base_sha',v_source_sha,
      'base_policy','EXACT',
      'rsi_opportunity_id',v_opportunity_id,
      'rsi_plan_digest',v_plan_digest,
      'rsi_hypothesis_digest',v_hypothesis ->> 'hypothesis_digest',
      'rsi_hypothesis',v_hypothesis,
      'rsi_experiment_plan',v_plan,
      'claim_class','ADVISORY',
      'requires_independent_review',true,
      'candidate_materialization_allowed',false,
      'implementation_dispatch_allowed',false,
      'existing_devos_scheduler_only',true,
      'page_model_worker_authority',false,
      'can_promote_production',false,
      'can_direct_browser_effects',false,
      'reconcile_previous_before_effect',true,
      'automatic_retry_after_ambiguous_effect',false,
      'authority_effect',false
    );

    v_enqueue := public.devos_fleet_enqueue_v1(
      p_workspace,
      v_point,
      'PLANNER',
      v_source_sha,
      v_spec,
      v_key,
      null,
      case v_priority when 'P0' then 95 when 'P1' then 85 when 'P2' then 70 else 60 end
    );

    if coalesce((v_enqueue ->> 'duplicate')::boolean,false) then
      v_duplicates := v_duplicates + 1;
    else
      v_enqueued := v_enqueued + 1;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'opportunity_id',v_opportunity_id,
      'plan_digest',v_plan_digest,
      'point_id',v_point,
      'dispatch',v_enqueue,
      'authority_effect',false
    ));
  end loop;

  return jsonb_build_object(
    'accepted',true,
    'state','ADVISORY_REVIEW_MATERIALIZED',
    'source_sha',v_source_sha,
    'seen',v_seen,
    'enqueued',v_enqueued,
    'duplicates',v_duplicates,
    'results',v_results,
    'scheduler','DEVOS_EXISTING_ONLY',
    'browser_enqueue_authority',false,
    'candidate_materialization_allowed',false,
    'implementation_dispatch_allowed',false,
    'execution_authority',false,
    'promotion_authority',false,
    'self_update_authority',false,
    'automatic_retry_allowed',false,
    'authority_effect',false
  );
end
$function$;

revoke all on function public.h205f22_rsi_runtime_frontier_intake_v1(uuid,text,jsonb) from public;
revoke all on function public.h205f22_rsi_runtime_frontier_intake_v1(uuid,text,jsonb) from anon;
revoke all on function public.h205f22_rsi_runtime_frontier_intake_v1(uuid,text,jsonb) from authenticated;
grant execute on function public.h205f22_rsi_runtime_frontier_intake_v1(uuid,text,jsonb) to service_role;
