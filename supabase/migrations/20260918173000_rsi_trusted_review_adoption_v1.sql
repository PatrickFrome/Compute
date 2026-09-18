-- METAENGINE RSI trusted advisory review -> existing DevOS IMPLEMENTER intake v1
-- Source-only migration. Not applied by this change.
--
-- This is deliberately NOT reachable from the Browser Edge. A trusted service-role
-- coordinator must first verify the zero-authority adoption envelope in source code,
-- re-read the review result digest, and then call this function. The function only
-- enqueues one branch-local IMPLEMENTER task through the existing DevOS scheduler.
-- It grants no production, Browser, promotion, or self-update authority.

create or replace function public.h205f22_rsi_adopt_frontier_review_v1(
  p_review_task uuid,
  p_expected_result_sha256 text,
  p_adoption jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','destruktion_meta','extensions'
as $function$
declare
  v_task destruktion_meta.devos_fleet_task_h205f22%rowtype;
  v_review jsonb;
  v_spec jsonb;
  v_source text;
  v_branch text;
  v_adoption_digest text;
  v_point text;
  v_key text;
  v_enqueue jsonb;
begin
  if p_review_task is null
     or lower(coalesce(p_expected_result_sha256,'')) !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(coalesce(p_adoption,'{}'::jsonb)) <> 'object' then
    raise exception 'rsi_review_adoption_request_invalid';
  end if;

  select * into v_task
    from destruktion_meta.devos_fleet_task_h205f22
   where task_id=p_review_task
   for update;

  if not found
     or v_task.state <> 'COMPLETED'
     or v_task.role <> 'PLANNER'
     or v_task.claim_class <> 'ADVISORY'
     or v_task.result_summary is null
     or lower(coalesce(v_task.result_sha256,'')) <> lower(p_expected_result_sha256)
     or v_task.task_spec ->> 'source' <> 'NATIVE_BROWSER_RSI_FRONTIER'
     or v_task.task_spec ->> 'required_result_schema' <> 'metaengine.rsi.frontier-review-result.v1' then
    raise exception 'rsi_review_adoption_review_task_invalid';
  end if;

  v_review := v_task.result_summary;
  if v_review ->> 'schema' <> 'metaengine.rsi.frontier-review-result.v1'
     or coalesce((v_review ->> 'version')::integer,0) <> 1
     or upper(coalesce(v_review ->> 'verdict','')) <> 'ACCEPT'
     or coalesce((v_review ->> 'reviewed_by_external_agent')::boolean,false) is not true
     or coalesce((v_review ->> 'authored_by_candidate')::boolean,true) is not false
     or coalesce((v_review ->> 'candidate_materialization_performed')::boolean,true) is not false
     or coalesce((v_review ->> 'implementation_dispatched')::boolean,true) is not false
     or coalesce((v_review ->> 'review_is_execution_authority')::boolean,true) is not false
     or coalesce((v_review ->> 'execution_authority')::boolean,true) is not false
     or coalesce((v_review ->> 'production_mutation_authority')::boolean,true) is not false
     or coalesce((v_review ->> 'promotion_authority')::boolean,true) is not false
     or coalesce((v_review ->> 'self_update_authority')::boolean,true) is not false
     or coalesce((v_review ->> 'automatic_retry_allowed')::boolean,true) is not false
     or coalesce((v_review ->> 'authority_effect')::boolean,true) is not false then
    raise exception 'rsi_review_adoption_review_policy_invalid';
  end if;

  v_source := lower(coalesce(v_review ->> 'source_sha',''));
  if v_source !~ '^[0-9a-f]{40}$'
     or v_source <> v_task.base_sha
     or v_review ->> 'opportunity_id' <> v_task.task_spec ->> 'rsi_opportunity_id'
     or v_review ->> 'hypothesis_digest' <> v_task.task_spec ->> 'rsi_hypothesis_digest'
     or v_review ->> 'plan_digest' <> v_task.task_spec ->> 'rsi_plan_digest'
     or lower(coalesce(v_review #>> '{experiment_plan,source_sha}','')) <> v_source
     or v_review #>> '{experiment_plan,plan_digest}' <> v_review ->> 'plan_digest'
     or v_review #>> '{hypothesis,hypothesis_digest}' <> v_review ->> 'hypothesis_digest'
     or v_review #>> '{mutation_contract,contract_digest}' <> v_review ->> 'mutation_contract_digest' then
    raise exception 'rsi_review_adoption_review_binding_invalid';
  end if;

  if p_adoption ->> 'schema' <> 'metaengine.rsi.devos-implementation-adoption.v1'
     or coalesce((p_adoption ->> 'version')::integer,0) <> 1
     or lower(coalesce(p_adoption ->> 'source_sha','')) <> v_source
     or p_adoption ->> 'opportunity_id' <> v_review ->> 'opportunity_id'
     or p_adoption ->> 'review_digest' <> v_review ->> 'review_digest'
     or p_adoption ->> 'hypothesis_digest' <> v_review ->> 'hypothesis_digest'
     or p_adoption ->> 'plan_digest' <> v_review ->> 'plan_digest'
     or p_adoption ->> 'mutation_contract_digest' <> v_review ->> 'mutation_contract_digest'
     or coalesce((p_adoption ->> 'existing_devos_scheduler_required')::boolean,false) is not true
     or coalesce((p_adoption ->> 'implementation_task_not_yet_enqueued')::boolean,false) is not true
     or coalesce((p_adoption ->> 'candidate_not_yet_materialized')::boolean,false) is not true
     or coalesce((p_adoption ->> 'external_scheduler_must_revalidate_current_source')::boolean,false) is not true
     or coalesce((p_adoption ->> 'execution_authority')::boolean,true) is not false
     or coalesce((p_adoption ->> 'production_mutation_authority')::boolean,true) is not false
     or coalesce((p_adoption ->> 'promotion_authority')::boolean,true) is not false
     or coalesce((p_adoption ->> 'self_update_authority')::boolean,true) is not false
     or coalesce((p_adoption ->> 'automatic_retry_allowed')::boolean,true) is not false
     or coalesce((p_adoption ->> 'authority_effect')::boolean,true) is not false then
    raise exception 'rsi_review_adoption_envelope_invalid';
  end if;

  v_branch := coalesce(p_adoption ->> 'target_branch','');
  if v_branch !~ '^work/rsi/[a-z0-9][a-z0-9-]{1,199}$'
     or v_branch <> coalesce(v_review #>> '{experiment_plan,target_branch}','') then
    raise exception 'rsi_review_adoption_branch_invalid';
  end if;

  v_adoption_digest := lower(coalesce(p_adoption ->> 'adoption_digest',''));
  if v_adoption_digest !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'rsi_review_adoption_digest_invalid';
  end if;

  v_spec := p_adoption -> 'implementation_task_spec';
  if jsonb_typeof(v_spec) <> 'object'
     or v_spec ->> 'schema' <> 'metaengine.rsi.implementation-task.v1'
     or lower(coalesce(v_spec ->> 'source_sha','')) <> v_source
     or v_spec ->> 'target_branch' <> v_branch
     or v_spec ->> 'hypothesis_digest' <> v_review ->> 'hypothesis_digest'
     or v_spec ->> 'experiment_plan_digest' <> v_review ->> 'plan_digest'
     or v_spec ->> 'mutation_contract_digest' <> v_review ->> 'mutation_contract_digest'
     or coalesce((v_spec ->> 'isolated_candidate_builder_required')::boolean,false) is not true
     or coalesce((v_spec ->> 'verification_sandbox_required')::boolean,false) is not true
     or coalesce((v_spec ->> 'external_evaluator_required')::boolean,false) is not true
     or coalesce((v_spec ->> 'benchmark_provenance_required')::boolean,false) is not true
     or coalesce((v_spec ->> 'evaluation_integrity_required')::boolean,false) is not true
     or coalesce((v_spec ->> 'no_second_scheduler')::boolean,false) is not true
     or coalesce((v_spec ->> 'no_blind_retry_after_ambiguous_effect')::boolean,false) is not true
     or coalesce((v_spec ->> 'candidate_can_invoke_self_update')::boolean,true) is not false
     or coalesce((v_spec ->> 'no_main_or_production_promotion')::boolean,false) is not true
     or coalesce((v_spec ->> 'execution_authority')::boolean,true) is not false
     or coalesce((v_spec ->> 'production_mutation_authority')::boolean,true) is not false
     or coalesce((v_spec ->> 'promotion_authority')::boolean,true) is not false
     or coalesce((v_spec ->> 'self_update_authority')::boolean,true) is not false
     or coalesce((v_spec ->> 'automatic_retry_allowed')::boolean,true) is not false
     or coalesce((v_spec ->> 'authority_effect')::boolean,true) is not false then
    raise exception 'rsi_review_adoption_task_spec_invalid';
  end if;

  v_point := 'rsi.implement.' || substr(v_adoption_digest,8,24);
  v_key := left('rsi-implementation:' || p_review_task::text || ':' || substr(v_adoption_digest,8),160);

  v_spec := v_spec || jsonb_build_object(
    'parent_review_task_id',p_review_task,
    'parent_review_result_sha256',lower(p_expected_result_sha256),
    'adoption_digest',v_adoption_digest,
    'claim_class','MUTATING',
    'continuous_role',false,
    'reconcile_previous_before_effect',true,
    'automatic_retry_after_ambiguous_effect',false,
    'page_model_worker_authority',false,
    'can_promote_production',false,
    'authority_effect',false
  );

  v_enqueue := public.devos_fleet_enqueue_v1(
    v_task.workspace_id,
    v_point,
    'IMPLEMENTER',
    v_source,
    v_spec,
    v_key,
    v_branch,
    greatest(v_task.priority,90)
  );

  return jsonb_build_object(
    'accepted',true,
    'review_task_id',p_review_task,
    'source_sha',v_source,
    'target_branch',v_branch,
    'adoption_digest',v_adoption_digest,
    'dispatch',v_enqueue,
    'scheduler','DEVOS_EXISTING_ONLY',
    'browser_enqueue_authority',false,
    'candidate_materialization_performed',false,
    'production_promotion_authorized',false,
    'self_update_authorized',false,
    'automatic_retry_allowed',false,
    'authority_effect',false
  );
end
$function$;

revoke all on function public.h205f22_rsi_adopt_frontier_review_v1(uuid,text,jsonb) from public;
revoke all on function public.h205f22_rsi_adopt_frontier_review_v1(uuid,text,jsonb) from anon;
revoke all on function public.h205f22_rsi_adopt_frontier_review_v1(uuid,text,jsonb) from authenticated;
grant execute on function public.h205f22_rsi_adopt_frontier_review_v1(uuid,text,jsonb) to service_role;
