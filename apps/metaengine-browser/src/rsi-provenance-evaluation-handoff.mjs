import crypto from 'node:crypto';

import {
  verifyRsiBoundedRevisionArtifactReceipt,
} from './rsi-bounded-revision-devos-bridge.mjs';
import {
  createRsiArtifactEvaluationRoutingRequest,
  verifyRsiArtifactEvaluationRoutingRequest,
  createRsiEvaluationBudgetPlan,
  verifyRsiEvaluationBudgetPlan,
} from './rsi-evaluation-budget-router.mjs';
import {
  verifyRsiCandidateExperimentIntent,
  createRsiCandidateExperimentIntent,
} from './rsi-candidate-experiment-ledger.mjs';

export const RSI_PROVENANCE_EVALUATION_HANDOFF_SCHEMA='metaengine.rsi.provenance-evaluation-handoff.v1';

const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;}
function exactDigest(v,l){
  const x=String(v||'').trim().toLowerCase();
  if(!SHA256_RE.test(x))throw new Error(`rsi_eval_handoff_${l}_digest_invalid`);
  return x;
}
function id(v,l){
  const x=String(v||'').trim();
  if(!SAFE_ID_RE.test(x))throw new Error(`rsi_eval_handoff_${l}_invalid`);
  return x;
}
function assertZero(v,l){
  for(const f of [
    'execution_authority','production_mutation_authority','promotion_authority',
    'self_update_authority','scheduler_authority','authority_effect',
  ]){
    if(v?.[f]!==false)throw new Error(`rsi_eval_handoff_${l}_${f}_invalid`);
  }
  if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_eval_handoff_${l}_retry_invalid`);
}
function verifyDigestObject(row){
  if(!row||row.schema!==RSI_PROVENANCE_EVALUATION_HANDOFF_SCHEMA||row.version!==1){
    throw new Error('rsi_eval_handoff_invalid');
  }
  assertZero(row,'handoff');
  const core=structuredClone(row);delete core.handoff_digest;
  if(digest(core)!==exactDigest(row.handoff_digest,'handoff'))throw new Error('rsi_eval_handoff_digest_mismatch');
  return Object.freeze(structuredClone(row));
}
function verifiedOriginalIntent(intent){
  return verifyRsiCandidateExperimentIntent(intent);
}
function provenanceRoot(receipt){
  return digest({
    artifact_receipt_digest:receipt.artifact_receipt_digest,
    bridge_digest:receipt.bridge_digest,
    envelope_digest:receipt.envelope_digest,
    proposal_digest:receipt.proposal_digest,
    source_sha:receipt.source_sha,
    candidate_sha:receipt.candidate_sha,
    artifact_digest:receipt.artifact_digest,
    workspace_id:receipt.workspace_id,
    workspace_generation:receipt.workspace_generation,
    lease_generation:receipt.lease_generation,
    output_manifest_digest:receipt.output_manifest_digest,
    builder_identity_digest:receipt.builder_identity_digest,
    worker_image_digest:receipt.worker_image_digest,
    toolchain_image_digest:receipt.toolchain_image_digest,
    dependency_material_manifest_digest:receipt.dependency_material_manifest_digest,
    harness_manifest_digest:receipt.harness_manifest_digest,
    capability_manifest_digest:receipt.capability_manifest_digest,
    build_provenance_digest:receipt.build_provenance_digest,
    artifact_signature_digest:receipt.artifact_signature_digest,
    transparency_log_inclusion_digest:receipt.transparency_log_inclusion_digest,
    artifact_reconstruction_digest:receipt.artifact_reconstruction_digest,
    protected_root_diff_audit_digest:receipt.protected_root_diff_audit_digest,
    preserved_behavior_review_digest:receipt.preserved_behavior_review_digest,
  });
}
function assertExternalEvaluationRoots(receipt,{
  sealed_task_set_digest,
  harness_digest,
  evaluator_root_digest,
  evaluator_generation_digest,
  evaluation_epoch_digest,
  trial_worker_image_digest,
  resource_budget_digest,
  task_order_digest,
}={}){
  const evalRoots=[
    exactDigest(sealed_task_set_digest,'sealed_task_set'),
    exactDigest(harness_digest,'evaluation_harness'),
    exactDigest(evaluator_root_digest,'evaluator_root'),
    exactDigest(evaluator_generation_digest,'evaluator_generation'),
    exactDigest(evaluation_epoch_digest,'evaluation_epoch'),
    exactDigest(trial_worker_image_digest,'trial_worker_image'),
    exactDigest(resource_budget_digest,'resource_budget'),
    exactDigest(task_order_digest,'task_order'),
  ];
  if(new Set(evalRoots).size!==evalRoots.length)throw new Error('rsi_eval_handoff_evaluation_roots_must_be_distinct');
  const buildRoots=new Set([
    receipt.artifact_digest,
    receipt.builder_identity_digest,
    receipt.worker_image_digest,
    receipt.toolchain_image_digest,
    receipt.dependency_material_manifest_digest,
    receipt.harness_manifest_digest,
    receipt.capability_manifest_digest,
    receipt.build_provenance_policy_digest,
    receipt.artifact_signature_policy_digest,
    receipt.transparency_log_policy_digest,
  ].filter(Boolean).map(x=>String(x).toLowerCase()));
  for(const root of evalRoots){
    if(buildRoots.has(root))throw new Error('rsi_eval_handoff_build_and_evaluation_roots_must_be_independent');
  }
  if(exactDigest(trial_worker_image_digest,'trial_worker_image')===receipt.worker_image_digest){
    throw new Error('rsi_eval_handoff_build_and_evaluation_workers_must_be_distinct');
  }
  return Object.freeze(evalRoots);
}

export function createRsiProvenanceEvaluationHandoff({
  handoff_id,
  artifact_receipt,
  bridge,
  envelope,
  proposal,
  original_experiment_intent,
  original_experiment_receipt,
  build_plan,
  materialization_receipt,
  external_measurement_digest,
  proxy_score_digest,
  uncertainty,
  decision_closeness,
  proxy_reliability_gap,
  evaluator_cost_units,
  expected_information_gain,
  epoch_budget_units,
  sealed_task_set_digest,
  harness_digest,
  evaluator_root_digest,
  evaluator_generation_digest,
  evaluation_epoch_digest,
  trial_worker_image_digest,
  resource_budget_digest,
  task_order_digest,
  external_evaluation_controller=false,
  authored_by_candidate=true,
}={}){
  if(external_evaluation_controller!==true||authored_by_candidate!==false){
    throw new Error('rsi_eval_handoff_external_controller_required');
  }
  const receipt=verifyRsiBoundedRevisionArtifactReceipt(artifact_receipt,{
    bridge,
    envelope,
    proposal,
    experiment_intent:original_experiment_intent,
    experiment_receipt:original_experiment_receipt,
    build_plan,
    materialization_receipt,
  });
  if(
    receipt.eligible_for_fresh_paired_evaluation!==true
    ||receipt.eligible_for_promotion!==false
    ||receipt.candidate_artifact_is_active!==false
    ||receipt.candidate_artifact_replaces_parent!==false
  )throw new Error('rsi_eval_handoff_artifact_not_evaluation_only');

  const originalIntent=verifiedOriginalIntent(original_experiment_intent);
  if(originalIntent.source_sha!==receipt.source_sha){
    throw new Error('rsi_eval_handoff_lineage_source_mismatch');
  }
  if(!envelope||envelope.envelope_digest!==receipt.envelope_digest){
    throw new Error('rsi_eval_handoff_phase27_envelope_binding_required');
  }

  const handoffId=id(handoff_id,'handoff_id');
  const provenance=provenanceRoot(receipt);
  const evalRoots=assertExternalEvaluationRoots(receipt,{
    sealed_task_set_digest,
    harness_digest,
    evaluator_root_digest,
    evaluator_generation_digest,
    evaluation_epoch_digest,
    trial_worker_image_digest,
    resource_budget_digest,
    task_order_digest,
  });
  const routingRequest=createRsiArtifactEvaluationRoutingRequest({
    request_id:`${handoffId}.routing`,
    source_sha:receipt.source_sha,
    phase28_artifact_receipt_digest:receipt.artifact_receipt_digest,
    parent_artifact_digest:envelope.parent_candidate_artifact_digest,
    candidate_artifact_digest:receipt.artifact_digest,
    provenance_root_digest:provenance,
    evaluator_root_digest:evalRoots[2],
    evaluator_generation_digest:evalRoots[3],
    evaluation_epoch_digest:evalRoots[4],
    external_measurement_digest,
    proxy_score_digest,
    uncertainty,
    decision_closeness,
    proxy_reliability_gap,
    evaluator_cost_units,
    expected_information_gain,
    scope_tags:['HIDDEN_HOLDOUT','MATERIALIZED_CANDIDATE','SAFETY','SECURITY'],
    recipient_group_tags:['RSI_CANDIDATE_VALIDATION'],
    external_measurement_owner:true,
    authored_by_candidate:false,
  });
  verifyRsiArtifactEvaluationRoutingRequest(routingRequest);
  if(routingRequest.source_sha!==receipt.source_sha){
    throw new Error('rsi_eval_handoff_routing_source_mismatch');
  }

  const budgetPlan=createRsiEvaluationBudgetPlan({
    plan_id:`${handoffId}.budget`,
    source_sha:receipt.source_sha,
    requests:[routingRequest],
    epoch_budget_units,
    external_budget_owner:true,
    authored_by_candidate:false,
  });
  verifyRsiEvaluationBudgetPlan(budgetPlan,{requests:[routingRequest]});
  if(
    budgetPlan.state!=='EVALUATION_BUDGET_ROUTED'
    ||budgetPlan.safety_floor_satisfied!==true
    ||!budgetPlan.selected_request_digests.includes(routingRequest.request_digest)
  )throw new Error('rsi_eval_handoff_fresh_request_not_selected');

  const experimentIntent=createRsiCandidateExperimentIntent({
    intent_id:`${handoffId}.paired`,
    request:routingRequest,
    plan:budgetPlan,
    plan_requests:[routingRequest],
    baseline_artifact_digest:envelope.parent_candidate_artifact_digest,
    candidate_artifact_digest:receipt.artifact_digest,
    sealed_task_set_digest,
    harness_digest,
    evaluator_root_digest:evalRoots[2],
    trial_worker_image_digest:evalRoots[5],
    resource_budget_digest:evalRoots[6],
    task_order_digest:evalRoots[7],
    external_experiment_owner:true,
    authored_by_candidate:false,
  });
  verifyRsiCandidateExperimentIntent(experimentIntent);

  const lineageCore={
    phase28_artifact_receipt_digest:receipt.artifact_receipt_digest,
    phase28_bridge_digest:receipt.bridge_digest,
    phase27_envelope_digest:receipt.envelope_digest,
    phase27_proposal_digest:receipt.proposal_digest,
    parent_source_sha:receipt.source_sha,
    child_candidate_sha:receipt.candidate_sha,
    child_artifact_digest:receipt.artifact_digest,
    provenance_root_digest:provenance,
    evaluator_root_digest:routingRequest.evaluator_root_digest,
    evaluator_generation_digest:routingRequest.evaluator_generation_digest,
    evaluation_epoch_digest:routingRequest.evaluation_epoch_digest,
    build_plan_digest:receipt.build_plan_digest,
    candidate_handoff_digest:receipt.candidate_handoff_digest,
    workspace_id:receipt.workspace_id,
    workspace_generation:receipt.workspace_generation,
    lease_generation:receipt.lease_generation,
    original_experiment_intent_digest:originalIntent.intent_digest,
    fresh_routing_request_digest:routingRequest.request_digest,
    fresh_budget_plan_digest:budgetPlan.plan_digest,
    fresh_paired_experiment_intent_digest:experimentIntent.intent_digest,
  };

  const core={
    schema:RSI_PROVENANCE_EVALUATION_HANDOFF_SCHEMA,
    version:1,
    handoff_id:handoffId,
    source_sha:receipt.source_sha,
    candidate_sha:receipt.candidate_sha,
    candidate_artifact_digest:receipt.artifact_digest,
    artifact_receipt_digest:receipt.artifact_receipt_digest,
    bridge_digest:receipt.bridge_digest,
    envelope_digest:receipt.envelope_digest,
    proposal_digest:receipt.proposal_digest,
    original_experiment_intent_digest:originalIntent.intent_digest,
    provenance_root_digest:provenance,
    evaluator_generation_digest:routingRequest.evaluator_generation_digest,
    evaluation_epoch_digest:routingRequest.evaluation_epoch_digest,
    lineage_digest:digest(lineageCore),
    routing_request:routingRequest,
    routing_request_digest:routingRequest.request_digest,
    budget_plan:budgetPlan,
    budget_plan_digest:budgetPlan.plan_digest,
    paired_experiment_intent:experimentIntent,
    paired_experiment_intent_digest:experimentIntent.intent_digest,
    baseline_artifact_digest:experimentIntent.baseline_artifact_digest,
    sealed_task_set_digest:experimentIntent.sealed_task_set_digest,
    harness_digest:experimentIntent.harness_digest,
    evaluator_root_digest:experimentIntent.evaluator_root_digest,
    trial_worker_image_digest:experimentIntent.trial_worker_image_digest,
    resource_budget_digest:experimentIntent.resource_budget_digest,
    task_order_digest:experimentIntent.task_order_digest,
    state:'ELIGIBLE_FOR_EXTERNAL_PAIRED_EVALUATION',
    fresh_evaluation_budget_required:true,
    previous_evaluation_budget_reuse_allowed:false,
    fresh_external_measurement_required:true,
    evaluator_generation_frozen:true,
    evaluator_dependent_verdict_reuse_across_generation_allowed:false,
    anchor_provenance_survives_evaluator_rotation:true,
    sealed_exogenous_acceptance_required:true,
    build_and_evaluation_roots_independent:true,
    build_worker_and_evaluation_worker_distinct:true,
    parent_child_identity_bound:true,
    phase27_lineage_bound:true,
    phase28_provenance_bound:true,
    same_incumbent_child_pair_required:true,
    candidate_can_choose_evaluator:false,
    candidate_can_choose_evaluator_generation:false,
    candidate_can_choose_evaluation_epoch:false,
    candidate_can_choose_task_set:false,
    candidate_can_choose_harness:false,
    candidate_can_choose_trial_worker:false,
    candidate_can_choose_resource_budget:false,
    candidate_can_choose_task_order:false,
    candidate_can_choose_thresholds:false,
    candidate_can_choose_stopping_rule:false,
    handoff_can_schedule_evaluation:false,
    handoff_can_execute_evaluation:false,
    second_evaluator_created:false,
    second_scheduler_created:false,
    active_artifact_replaced:false,
    direct_promotion_allowed:false,
    deployment_evidence_still_required_for_trusted_learning:true,
    external_evaluation_controller:true,
    authored_by_candidate:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,handoff_digest:digest(core)});
}

export function verifyRsiProvenanceEvaluationHandoff(row,args={}){
  const handoff=verifyDigestObject(row);
  if(
    handoff.state!=='ELIGIBLE_FOR_EXTERNAL_PAIRED_EVALUATION'
    ||handoff.fresh_evaluation_budget_required!==true
    ||handoff.previous_evaluation_budget_reuse_allowed!==false
    ||handoff.fresh_external_measurement_required!==true
    ||handoff.evaluator_generation_frozen!==true
    ||handoff.evaluator_dependent_verdict_reuse_across_generation_allowed!==false
    ||handoff.anchor_provenance_survives_evaluator_rotation!==true
    ||handoff.sealed_exogenous_acceptance_required!==true
    ||handoff.build_and_evaluation_roots_independent!==true
    ||handoff.build_worker_and_evaluation_worker_distinct!==true
    ||handoff.parent_child_identity_bound!==true
    ||handoff.phase27_lineage_bound!==true
    ||handoff.phase28_provenance_bound!==true
    ||handoff.same_incumbent_child_pair_required!==true
    ||handoff.candidate_can_choose_evaluator!==false
    ||handoff.candidate_can_choose_evaluator_generation!==false
    ||handoff.candidate_can_choose_evaluation_epoch!==false
    ||handoff.candidate_can_choose_task_set!==false
    ||handoff.candidate_can_choose_harness!==false
    ||handoff.candidate_can_choose_trial_worker!==false
    ||handoff.candidate_can_choose_resource_budget!==false
    ||handoff.candidate_can_choose_task_order!==false
    ||handoff.candidate_can_choose_thresholds!==false
    ||handoff.candidate_can_choose_stopping_rule!==false
    ||handoff.handoff_can_schedule_evaluation!==false
    ||handoff.handoff_can_execute_evaluation!==false
    ||handoff.second_evaluator_created!==false
    ||handoff.second_scheduler_created!==false
    ||handoff.active_artifact_replaced!==false
    ||handoff.direct_promotion_allowed!==false
    ||handoff.deployment_evidence_still_required_for_trusted_learning!==true
    ||handoff.external_evaluation_controller!==true
    ||handoff.authored_by_candidate!==false
  )throw new Error('rsi_eval_handoff_policy_invalid');
  const canonical=createRsiProvenanceEvaluationHandoff({
    ...args,
    handoff_id:handoff.handoff_id,
    external_measurement_digest:handoff.routing_request.external_measurement_digest,
    proxy_score_digest:handoff.routing_request.proxy_score_digest,
    uncertainty:handoff.routing_request.uncertainty,
    decision_closeness:handoff.routing_request.decision_closeness,
    proxy_reliability_gap:handoff.routing_request.proxy_reliability_gap,
    evaluator_cost_units:handoff.routing_request.evaluator_cost_units,
    expected_information_gain:handoff.routing_request.expected_information_gain,
    epoch_budget_units:handoff.budget_plan.epoch_budget_units,
    sealed_task_set_digest:handoff.sealed_task_set_digest,
    harness_digest:handoff.harness_digest,
    evaluator_root_digest:handoff.evaluator_root_digest,
    evaluator_generation_digest:handoff.evaluator_generation_digest,
    evaluation_epoch_digest:handoff.evaluation_epoch_digest,
    trial_worker_image_digest:handoff.trial_worker_image_digest,
    resource_budget_digest:handoff.resource_budget_digest,
    task_order_digest:handoff.task_order_digest,
    external_evaluation_controller:true,
    authored_by_candidate:false,
  });
  if(canonical.handoff_digest!==handoff.handoff_digest)throw new Error('rsi_eval_handoff_mismatch');
  return canonical;
}

export function rsiProvenanceEvaluationHandoffTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.provenance-evaluation-handoff-root.v1',
    version:1,
    strongest_phase28_provenance_receipt_required:true,
    existing_evaluation_budget_router_only:true,
    existing_paired_candidate_experiment_ledger_only:true,
    fresh_external_measurement_required:true,
    fresh_evaluation_budget_required:true,
    previous_evaluation_budget_reuse_allowed:false,
    evaluator_generation_binding_required:true,
    evaluation_epoch_binding_required:true,
    evaluator_generation_frozen_per_epoch:true,
    evaluator_dependent_verdict_reuse_across_generation_allowed:false,
    anchor_provenance_survives_evaluator_rotation:true,
    materialized_artifact_request_required:true,
    protected_scope_floor_required:true,
    sealed_exogenous_acceptance_required:true,
    full_phase27_phase28_lineage_binding_required:true,
    build_and_evaluation_roots_independent:true,
    build_worker_and_evaluation_worker_distinct:true,
    candidate_can_choose_evaluator:false,
    candidate_can_choose_evaluator_generation:false,
    candidate_can_choose_evaluation_epoch:false,
    candidate_can_choose_task_set:false,
    candidate_can_choose_harness:false,
    candidate_can_choose_trial_worker:false,
    candidate_can_choose_resource_budget:false,
    candidate_can_choose_task_order:false,
    candidate_can_choose_thresholds:false,
    candidate_can_choose_stopping_rule:false,
    second_evaluator_allowed:false,
    second_scheduler_allowed:false,
    direct_active_replacement_allowed:false,
    direct_promotion_allowed:false,
    deployment_evidence_required_for_trusted_learning:true,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,handoff_root_digest:digest(root)});
}
