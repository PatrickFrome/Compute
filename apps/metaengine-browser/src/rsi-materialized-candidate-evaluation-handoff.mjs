import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  RSI_BOUNDED_REVISION_ARTIFACT_RECEIPT_SCHEMA,
  verifyRsiBoundedRevisionArtifactReceipt,
} from './rsi-bounded-revision-devos-bridge.mjs';
import {
  createRsiArtifactEvaluationRoutingRequest,
  verifyRsiArtifactEvaluationRoutingRequest,
  verifyRsiEvaluationBudgetPlan,
} from './rsi-evaluation-budget-router.mjs';
import {
  createRsiCandidateExperimentIntent,
  verifyRsiCandidateExperimentIntent,
} from './rsi-candidate-experiment-ledger.mjs';

export const RSI_MATERIALIZED_CANDIDATE_EVALUATION_HANDOFF_SCHEMA='metaengine.rsi.materialized-candidate-evaluation-handoff.v1';
export const RSI_MATERIALIZED_CANDIDATE_EVALUATION_HANDOFF_LEDGER_SCHEMA='metaengine.rsi.materialized-candidate-evaluation-handoff-ledger.v1';
export const RSI_EVALUATOR_GENERATION_ROTATION_SCHEMA='metaengine.rsi.evaluator-generation-rotation.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_HANDOFF_ROWS=2048;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error(`rsi_materialized_eval_${l}_sha_invalid`);return x;}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_materialized_eval_${l}_digest_invalid`);return x;}
function positiveInt(v,l){const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw new Error(`rsi_materialized_eval_${l}_invalid`);return n;}
function safeId(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error(`rsi_materialized_eval_${l}_invalid`);return x;}
function assertZero(v,l){for(const f of ['execution_authority','browser_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_materialized_eval_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_materialized_eval_${l}_retry_invalid`);}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false});}

function verifyArtifact(artifact_receipt,artifact_verification){
  if(!artifact_receipt||artifact_receipt.schema!==RSI_BOUNDED_REVISION_ARTIFACT_RECEIPT_SCHEMA)throw new Error('rsi_materialized_eval_artifact_receipt_invalid');
  const receipt=verifyRsiBoundedRevisionArtifactReceipt(artifact_receipt,artifact_verification||{});
  const envelope=artifact_verification?.envelope;
  const experimentIntent=artifact_verification?.experiment_intent;
  if(!envelope||envelope.envelope_digest!==receipt.envelope_digest)throw new Error('rsi_materialized_eval_phase27_envelope_binding_required');
  if(!experimentIntent||experimentIntent.intent_digest!==artifact_verification?.experiment_receipt?.intent_digest)throw new Error('rsi_materialized_eval_phase26_experiment_binding_required');
  if(receipt.eligible_for_fresh_paired_evaluation!==true||receipt.eligible_for_promotion!==false
    ||receipt.candidate_artifact_is_active!==false||receipt.candidate_artifact_replaces_parent!==false
    ||receipt.external_attestor!==true||receipt.authored_by_candidate!==false)throw new Error('rsi_materialized_eval_artifact_not_evaluation_eligible');
  return Object.freeze({receipt,envelope,experimentIntent});
}

export function createRsiMaterializedCandidateEvaluationHandoff({
  artifact_receipt,
  artifact_verification,
  evaluator_root_digest,
  evaluator_generation_digest,
  evaluator_generation_seq,
  evaluator_generation_history_anchor_digest,
  evaluation_epoch_digest,
  evaluation_epoch_seq,
  sealed_task_set_digest,
  evaluation_harness_digest,
  trial_worker_image_digest,
  resource_budget_digest,
  task_order_digest,
  acceptance_policy_digest,
  stopping_policy_digest,
  hidden_holdout_root_digest,
  safety_suite_root_digest,
  security_suite_root_digest,
  external_measurement_digest,
  proxy_score_digest,
  uncertainty,
  decision_closeness,
  proxy_reliability_gap,
  evaluator_cost_units,
  expected_information_gain,
  external_evaluation_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_evaluation_owner!==true||authored_by_candidate!==false)throw new Error('rsi_materialized_eval_external_owner_required');
  const {receipt,envelope,experimentIntent}=verifyArtifact(artifact_receipt,artifact_verification);
  const evaluator=exactDigest(evaluator_root_digest,'evaluator_root');
  const generation=exactDigest(evaluator_generation_digest,'evaluator_generation');
  const generationSeq=positiveInt(evaluator_generation_seq,'evaluator_generation_seq');
  const generationHistoryAnchor=exactDigest(evaluator_generation_history_anchor_digest,'evaluator_generation_history_anchor');
  const epoch=exactDigest(evaluation_epoch_digest,'evaluation_epoch');
  const epochSeq=positiveInt(evaluation_epoch_seq,'evaluation_epoch_seq');
  const taskSet=exactDigest(sealed_task_set_digest,'sealed_task_set');
  const harness=exactDigest(evaluation_harness_digest,'evaluation_harness');
  const trialWorker=exactDigest(trial_worker_image_digest,'trial_worker');
  const resourceBudget=exactDigest(resource_budget_digest,'resource_budget');
  const taskOrder=exactDigest(task_order_digest,'task_order');
  const acceptance=exactDigest(acceptance_policy_digest,'acceptance_policy');
  const stopping=exactDigest(stopping_policy_digest,'stopping_policy');
  const hiddenHoldout=exactDigest(hidden_holdout_root_digest,'hidden_holdout');
  const safetySuite=exactDigest(safety_suite_root_digest,'safety_suite');
  const securitySuite=exactDigest(security_suite_root_digest,'security_suite');
  const externalMeasurement=exactDigest(external_measurement_digest,'external_measurement');
  const proxyScore=exactDigest(proxy_score_digest,'proxy_score');

  if(trialWorker===receipt.worker_image_digest)throw new Error('rsi_materialized_eval_build_and_evaluation_worker_must_differ');
  const evaluationRoots=[
    evaluator,generation,generationHistoryAnchor,epoch,taskSet,harness,trialWorker,resourceBudget,taskOrder,acceptance,stopping,
    hiddenHoldout,safetySuite,securitySuite,externalMeasurement,proxyScore,
  ];
  if(new Set(evaluationRoots).size!==evaluationRoots.length)throw new Error('rsi_materialized_eval_independent_evaluation_roots_required');
  const artifactRoots=[
    receipt.artifact_receipt_digest,receipt.artifact_digest,receipt.provenance_attestation_digest,
    receipt.signature_bundle_digest,receipt.transparency_log_entry_digest,receipt.reproducibility_evidence_digest,
    receipt.builder_identity_digest,receipt.worker_image_digest,receipt.toolchain_image_digest,
    receipt.dependency_material_manifest_digest,receipt.harness_manifest_digest,receipt.capability_manifest_digest,
  ];
  if(evaluationRoots.some(root=>artifactRoots.includes(root)))throw new Error('rsi_materialized_eval_evaluation_root_aliases_build_provenance');

  const provenanceRoot=digest({
    artifact_receipt_digest:receipt.artifact_receipt_digest,
    artifact_digest:receipt.artifact_digest,
    provenance_attestation_digest:receipt.provenance_attestation_digest,
    signature_bundle_digest:receipt.signature_bundle_digest,
    transparency_log_entry_digest:receipt.transparency_log_entry_digest,
    reproducibility_evidence_digest:receipt.reproducibility_evidence_digest,
    builder_identity_digest:receipt.builder_identity_digest,
    worker_image_digest:receipt.worker_image_digest,
    toolchain_image_digest:receipt.toolchain_image_digest,
    dependency_material_manifest_digest:receipt.dependency_material_manifest_digest,
    harness_manifest_digest:receipt.harness_manifest_digest,
    capability_manifest_digest:receipt.capability_manifest_digest,
    workspace_id:receipt.workspace_id,
    workspace_generation:receipt.workspace_generation,
    lease_generation:receipt.lease_generation,
  });
  const seed={artifact_receipt_digest:receipt.artifact_receipt_digest,evaluator_root_digest:evaluator,evaluator_generation_digest:generation,evaluation_epoch_digest:epoch,provenance_root_digest:provenanceRoot};
  const request=createRsiArtifactEvaluationRoutingRequest({
    request_id:`phase29.eval.${crypto.createHash('sha256').update(JSON.stringify(stable(seed)),'utf8').digest('hex').slice(0,24)}`,
    source_sha:receipt.source_sha,
    phase28_artifact_receipt_digest:receipt.artifact_receipt_digest,
    parent_artifact_digest:envelope.parent_candidate_artifact_digest,
    candidate_artifact_digest:receipt.artifact_digest,
    provenance_root_digest:provenanceRoot,
    evaluator_root_digest:evaluator,
    evaluator_generation_digest:generation,
    evaluator_generation_seq:generationSeq,
    evaluator_generation_history_anchor_digest:generationHistoryAnchor,
    evaluation_epoch_digest:epoch,
    evaluation_epoch_seq:epochSeq,
    sealed_task_set_digest:taskSet,
    harness_digest:harness,
    trial_worker_image_digest:trialWorker,
    resource_budget_digest:resourceBudget,
    task_order_digest:taskOrder,
    threshold_policy_digest:acceptance,
    stopping_policy_digest:stopping,
    hidden_holdout_root_digest:hiddenHoldout,
    safety_suite_root_digest:safetySuite,
    security_suite_root_digest:securitySuite,
    external_measurement_digest:externalMeasurement,
    proxy_score_digest:proxyScore,
    uncertainty,decision_closeness,proxy_reliability_gap,evaluator_cost_units,expected_information_gain,
    scope_tags:['HIDDEN_HOLDOUT','MATERIALIZED_CANDIDATE','SAFETY','SECURITY'],
    recipient_group_tags:['RSI_CANDIDATE_VALIDATION'],
    external_measurement_owner:true,
    authored_by_candidate:false,
  });
  verifyRsiArtifactEvaluationRoutingRequest(request);
  const core=zero({
    schema:RSI_MATERIALIZED_CANDIDATE_EVALUATION_HANDOFF_SCHEMA,
    version:1,
    source_sha:receipt.source_sha,
    phase28_artifact_receipt_digest:receipt.artifact_receipt_digest,
    phase27_envelope_digest:receipt.envelope_digest,
    phase27_proposal_digest:receipt.proposal_digest,
    prior_phase26_plan_digest:experimentIntent.plan_digest,
    parent_artifact_digest:envelope.parent_candidate_artifact_digest,
    candidate_artifact_digest:receipt.artifact_digest,
    provenance_root_digest:provenanceRoot,
    evaluator_root_digest:evaluator,
    evaluator_generation_digest:generation,
    evaluation_epoch_digest:epoch,
    sealed_task_set_digest:taskSet,
    evaluation_harness_digest:harness,
    trial_worker_image_digest:trialWorker,
    resource_budget_digest:resourceBudget,
    task_order_digest:taskOrder,
    acceptance_policy_digest:acceptance,
    stopping_policy_digest:stopping,
    hidden_holdout_root_digest:hiddenHoldout,
    safety_suite_root_digest:safetySuite,
    security_suite_root_digest:securitySuite,
    fresh_evaluation_request:request,
    state:'READY_FOR_FRESH_EVALUATION_BUDGET_ROUTING',
    fresh_budget_epoch_required:true,
    previous_budget_plan_reuse_allowed:false,
    evaluator_generation_frozen:true,
    evaluator_dependent_verdict_reuse_allowed:false,
    evaluator_generation_history_append_only:true,
    evaluator_generation_seq_external:true,
    evaluation_epoch_seq_external:true,
    generation_history_anchor_external:true,
    build_and_evaluation_workers_distinct:true,
    existing_evaluation_budget_router_only:true,
    existing_candidate_experiment_ledger_only:true,
    candidate_can_choose_evaluator:false,
    candidate_can_choose_evaluator_generation:false,
    candidate_can_choose_task_set:false,
    candidate_can_choose_harness:false,
    candidate_can_choose_trial_worker:false,
    candidate_can_choose_resource_budget:false,
    candidate_can_choose_task_order:false,
    candidate_can_choose_acceptance_policy:false,
    candidate_can_choose_stopping_policy:false,
    candidate_can_choose_hidden_holdout:false,
    candidate_can_choose_safety_suite:false,
    candidate_can_choose_security_suite:false,
    candidate_can_choose_budget:false,
    handoff_can_schedule_evaluation:false,
    handoff_can_execute_evaluation:false,
    handoff_can_promote:false,
    external_evaluation_owner:true,
    authored_by_candidate:false,
    second_evaluation_router_created:false,
    second_experiment_ledger_created:false,
  });
  return Object.freeze({...core,evaluation_handoff_digest:digest(core)});
}

export function verifyRsiMaterializedCandidateEvaluationHandoff(row,args={}){
  if(!row||row.schema!==RSI_MATERIALIZED_CANDIDATE_EVALUATION_HANDOFF_SCHEMA||row.version!==1)throw new Error('rsi_materialized_eval_handoff_invalid');
  assertZero(row,'handoff');
  if(row.state!=='READY_FOR_FRESH_EVALUATION_BUDGET_ROUTING'
    ||row.fresh_budget_epoch_required!==true||row.previous_budget_plan_reuse_allowed!==false
    ||row.evaluator_generation_frozen!==true||row.evaluator_dependent_verdict_reuse_allowed!==false
    ||row.evaluator_generation_history_append_only!==true||row.evaluator_generation_seq_external!==true
    ||row.evaluation_epoch_seq_external!==true||row.generation_history_anchor_external!==true
    ||row.build_and_evaluation_workers_distinct!==true
    ||row.existing_evaluation_budget_router_only!==true||row.existing_candidate_experiment_ledger_only!==true
    ||row.candidate_can_choose_evaluator!==false||row.candidate_can_choose_evaluator_generation!==false
    ||row.candidate_can_choose_task_set!==false||row.candidate_can_choose_harness!==false
    ||row.candidate_can_choose_trial_worker!==false||row.candidate_can_choose_resource_budget!==false
    ||row.candidate_can_choose_task_order!==false||row.candidate_can_choose_acceptance_policy!==false
    ||row.candidate_can_choose_stopping_policy!==false||row.candidate_can_choose_hidden_holdout!==false
    ||row.candidate_can_choose_safety_suite!==false||row.candidate_can_choose_security_suite!==false
    ||row.candidate_can_choose_budget!==false||row.handoff_can_schedule_evaluation!==false
    ||row.handoff_can_execute_evaluation!==false||row.handoff_can_promote!==false
    ||row.external_evaluation_owner!==true||row.authored_by_candidate!==false
    ||row.second_evaluation_router_created!==false||row.second_experiment_ledger_created!==false)throw new Error('rsi_materialized_eval_handoff_policy_invalid');
  const canonical=createRsiMaterializedCandidateEvaluationHandoff({
    ...args,
    evaluator_root_digest:row.evaluator_root_digest,
    evaluator_generation_digest:row.evaluator_generation_digest,
    evaluator_generation_seq:row.evaluator_generation_seq,
    evaluator_generation_history_anchor_digest:row.evaluator_generation_history_anchor_digest,
    evaluation_epoch_digest:row.evaluation_epoch_digest,
    evaluation_epoch_seq:row.evaluation_epoch_seq,
    sealed_task_set_digest:row.sealed_task_set_digest,
    evaluation_harness_digest:row.evaluation_harness_digest,
    trial_worker_image_digest:row.trial_worker_image_digest,
    resource_budget_digest:row.resource_budget_digest,
    task_order_digest:row.task_order_digest,
    acceptance_policy_digest:row.acceptance_policy_digest,
    stopping_policy_digest:row.stopping_policy_digest,
    hidden_holdout_root_digest:row.hidden_holdout_root_digest,
    safety_suite_root_digest:row.safety_suite_root_digest,
    security_suite_root_digest:row.security_suite_root_digest,
    external_measurement_digest:row.fresh_evaluation_request.external_measurement_digest,
    proxy_score_digest:row.fresh_evaluation_request.proxy_score_digest,
    uncertainty:row.fresh_evaluation_request.uncertainty,
    decision_closeness:row.fresh_evaluation_request.decision_closeness,
    proxy_reliability_gap:row.fresh_evaluation_request.proxy_reliability_gap,
    evaluator_cost_units:row.fresh_evaluation_request.evaluator_cost_units,
    expected_information_gain:row.fresh_evaluation_request.expected_information_gain,
    external_evaluation_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.evaluation_handoff_digest!==exactDigest(row.evaluation_handoff_digest,'handoff'))throw new Error('rsi_materialized_eval_handoff_digest_mismatch');
  return canonical;
}

export function createRsiMaterializedCandidateExperimentIntent({
  handoff,
  handoff_verification,
  fresh_budget_plan,
  fresh_plan_requests,
  intent_id,
  external_experiment_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_experiment_owner!==true||authored_by_candidate!==false)throw new Error('rsi_materialized_eval_external_experiment_owner_required');
  const checkedHandoff=verifyRsiMaterializedCandidateEvaluationHandoff(handoff,handoff_verification||{});
  const plan=verifyRsiEvaluationBudgetPlan(fresh_budget_plan,{requests:fresh_plan_requests??fresh_budget_plan?.request_snapshots});
  const request=checkedHandoff.fresh_evaluation_request;
  if(plan.plan_digest===checkedHandoff.prior_phase26_plan_digest)throw new Error('rsi_materialized_eval_prior_budget_reuse_forbidden');
  if(!plan.selected_request_digests.includes(request.request_digest))throw new Error('rsi_materialized_eval_request_not_selected');
  if(plan.state!=='EVALUATION_BUDGET_ROUTED'||plan.safety_floor_satisfied!==true)throw new Error('rsi_materialized_eval_protected_scope_floor_required');
  const intent=createRsiCandidateExperimentIntent({
    intent_id,
    request,
    plan,
    plan_requests:fresh_plan_requests??plan.request_snapshots,
    baseline_artifact_digest:checkedHandoff.parent_artifact_digest,
    candidate_artifact_digest:checkedHandoff.candidate_artifact_digest,
    sealed_task_set_digest:checkedHandoff.sealed_task_set_digest,
    harness_digest:checkedHandoff.evaluation_harness_digest,
    evaluator_root_digest:checkedHandoff.evaluator_root_digest,
    trial_worker_image_digest:checkedHandoff.trial_worker_image_digest,
    resource_budget_digest:checkedHandoff.resource_budget_digest,
    task_order_digest:checkedHandoff.task_order_digest,
    external_experiment_owner:true,
    authored_by_candidate:false,
  });
  const checkedIntent=verifyRsiCandidateExperimentIntent(intent);
  if(checkedIntent.evaluator_generation_digest!==checkedHandoff.evaluator_generation_digest
    ||checkedIntent.evaluation_epoch_digest!==checkedHandoff.evaluation_epoch_digest
    ||checkedIntent.phase28_artifact_receipt_digest!==checkedHandoff.phase28_artifact_receipt_digest
    ||checkedIntent.provenance_root_digest!==checkedHandoff.provenance_root_digest
    ||checkedIntent.threshold_policy_digest!==checkedHandoff.acceptance_policy_digest
    ||checkedIntent.stopping_policy_digest!==checkedHandoff.stopping_policy_digest
    ||checkedIntent.hidden_holdout_root_digest!==checkedHandoff.hidden_holdout_root_digest
    ||checkedIntent.safety_suite_root_digest!==checkedHandoff.safety_suite_root_digest
    ||checkedIntent.security_suite_root_digest!==checkedHandoff.security_suite_root_digest
    ||checkedIntent.acceptance_assets_frozen!==true)throw new Error('rsi_materialized_eval_intent_lineage_mismatch');
  return checkedIntent;
}



export function createRsiEvaluatorGenerationRotation({
  rotation_id,
  source_sha,
  previous_evaluator_root_digest,
  previous_evaluator_generation_digest,
  previous_evaluator_generation_seq,
  previous_evaluation_epoch_digest,
  previous_evaluation_epoch_seq,
  next_evaluator_root_digest,
  next_evaluator_generation_digest,
  next_evaluator_generation_seq,
  next_evaluation_epoch_digest,
  next_evaluation_epoch_seq,
  next_generation_history_anchor_digest,
  anchor_recalibration_digest,
  external_rotation_receipt_digest,
  external_generation_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_generation_owner!==true||authored_by_candidate!==false)throw new Error('rsi_materialized_eval_external_generation_owner_required');
  const roots=[
    exactDigest(previous_evaluator_root_digest,'rotation_previous_root'),
    exactDigest(previous_evaluator_generation_digest,'rotation_previous_generation'),
    exactDigest(previous_evaluation_epoch_digest,'rotation_previous_epoch'),
    exactDigest(next_evaluator_root_digest,'rotation_next_root'),
    exactDigest(next_evaluator_generation_digest,'rotation_next_generation'),
    exactDigest(next_evaluation_epoch_digest,'rotation_next_epoch'),
    exactDigest(next_generation_history_anchor_digest,'rotation_history_anchor'),
    exactDigest(anchor_recalibration_digest,'rotation_anchor_recalibration'),
    exactDigest(external_rotation_receipt_digest,'rotation_external_receipt'),
  ];
  if(new Set(roots).size!==roots.length)throw new Error('rsi_materialized_eval_rotation_independent_roots_required');
  const previousGenerationSeq=positiveInt(previous_evaluator_generation_seq,'rotation_previous_generation_seq');
  const previousEpochSeq=positiveInt(previous_evaluation_epoch_seq,'rotation_previous_epoch_seq');
  const nextGenerationSeq=positiveInt(next_evaluator_generation_seq,'rotation_next_generation_seq');
  const nextEpochSeq=positiveInt(next_evaluation_epoch_seq,'rotation_next_epoch_seq');
  if(nextGenerationSeq!==previousGenerationSeq+1)throw new Error('rsi_materialized_eval_rotation_generation_sequence_invalid');
  if(nextEpochSeq!==1)throw new Error('rsi_materialized_eval_rotation_new_generation_epoch_invalid');
  if(roots[0]===roots[3]||roots[1]===roots[4])throw new Error('rsi_materialized_eval_rotation_identity_must_change');
  const core=zero({
    schema:RSI_EVALUATOR_GENERATION_ROTATION_SCHEMA,
    version:1,
    rotation_id:safeId(rotation_id,'rotation_id'),
    source_sha:exactSha(source_sha,'rotation_source'),
    previous_evaluator_root_digest:roots[0],
    previous_evaluator_generation_digest:roots[1],
    previous_evaluator_generation_seq:previousGenerationSeq,
    previous_evaluation_epoch_digest:roots[2],
    previous_evaluation_epoch_seq:previousEpochSeq,
    next_evaluator_root_digest:roots[3],
    next_evaluator_generation_digest:roots[4],
    next_evaluator_generation_seq:nextGenerationSeq,
    next_evaluation_epoch_digest:roots[5],
    next_evaluation_epoch_seq:nextEpochSeq,
    next_generation_history_anchor_digest:roots[6],
    anchor_recalibration_digest:roots[7],
    external_rotation_receipt_digest:roots[8],
    transition_kind:'EXTERNAL_ROTATION',
    external_generation_owner:true,
    authored_by_candidate:false,
    candidate_can_rotate_evaluator:false,
    candidate_can_choose_anchor:false,
    rotation_can_execute_evaluation:false,
    rotation_can_activate_candidate:false,
  });
  return Object.freeze({...core,rotation_digest:digest(core)});
}

export function verifyRsiEvaluatorGenerationRotation(row){
  if(!row||row.schema!==RSI_EVALUATOR_GENERATION_ROTATION_SCHEMA||row.version!==1)throw new Error('rsi_materialized_eval_rotation_invalid');
  assertZero(row,'rotation');
  if(row.transition_kind!=='EXTERNAL_ROTATION'||row.external_generation_owner!==true||row.authored_by_candidate!==false
    ||row.candidate_can_rotate_evaluator!==false||row.candidate_can_choose_anchor!==false
    ||row.rotation_can_execute_evaluation!==false||row.rotation_can_activate_candidate!==false){
    throw new Error('rsi_materialized_eval_rotation_policy_invalid');
  }
  const canonical=createRsiEvaluatorGenerationRotation({
    rotation_id:row.rotation_id,
    source_sha:row.source_sha,
    previous_evaluator_root_digest:row.previous_evaluator_root_digest,
    previous_evaluator_generation_digest:row.previous_evaluator_generation_digest,
    previous_evaluator_generation_seq:row.previous_evaluator_generation_seq,
    previous_evaluation_epoch_digest:row.previous_evaluation_epoch_digest,
    previous_evaluation_epoch_seq:row.previous_evaluation_epoch_seq,
    next_evaluator_root_digest:row.next_evaluator_root_digest,
    next_evaluator_generation_digest:row.next_evaluator_generation_digest,
    next_evaluator_generation_seq:row.next_evaluator_generation_seq,
    next_evaluation_epoch_digest:row.next_evaluation_epoch_digest,
    next_evaluation_epoch_seq:row.next_evaluation_epoch_seq,
    next_generation_history_anchor_digest:row.next_generation_history_anchor_digest,
    anchor_recalibration_digest:row.anchor_recalibration_digest,
    external_rotation_receipt_digest:row.external_rotation_receipt_digest,
    external_generation_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.rotation_digest!==exactDigest(row.rotation_digest,'rotation'))throw new Error('rsi_materialized_eval_rotation_digest_mismatch');
  return canonical;
}

function verifyPersistedHandoffEvidence({handoff,artifact_receipt,artifact_verification}={}){
  const checked=verifyRsiMaterializedCandidateEvaluationHandoff(handoff,{artifact_receipt,artifact_verification});
  if(checked.phase28_artifact_receipt_digest!==artifact_receipt?.artifact_receipt_digest)throw new Error('rsi_materialized_eval_history_artifact_binding_mismatch');
  return Object.freeze({
    handoff:checked,
    artifact_receipt:Object.freeze(structuredClone(artifact_receipt)),
    artifact_verification:Object.freeze(structuredClone(artifact_verification)),
  });
}

function verifyStoredMaterializedCandidateEvaluationHandoff(row){
  if(!row||row.schema!==RSI_MATERIALIZED_CANDIDATE_EVALUATION_HANDOFF_SCHEMA||row.version!==1)throw new Error('rsi_materialized_eval_handoff_invalid');
  assertZero(row,'stored_handoff');
  if(row.state!=='READY_FOR_FRESH_EVALUATION_BUDGET_ROUTING'
    ||row.fresh_budget_epoch_required!==true||row.previous_budget_plan_reuse_allowed!==false
    ||row.evaluator_generation_frozen!==true||row.evaluator_dependent_verdict_reuse_allowed!==false
    ||row.evaluator_generation_history_append_only!==true||row.evaluator_generation_seq_external!==true
    ||row.evaluation_epoch_seq_external!==true||row.generation_history_anchor_external!==true
    ||row.build_and_evaluation_workers_distinct!==true
    ||row.existing_evaluation_budget_router_only!==true||row.existing_candidate_experiment_ledger_only!==true
    ||row.candidate_can_choose_evaluator!==false||row.candidate_can_choose_evaluator_generation!==false
    ||row.candidate_can_choose_task_set!==false||row.candidate_can_choose_harness!==false
    ||row.candidate_can_choose_trial_worker!==false||row.candidate_can_choose_resource_budget!==false
    ||row.candidate_can_choose_task_order!==false||row.candidate_can_choose_acceptance_policy!==false
    ||row.candidate_can_choose_stopping_policy!==false||row.candidate_can_choose_hidden_holdout!==false
    ||row.candidate_can_choose_safety_suite!==false||row.candidate_can_choose_security_suite!==false
    ||row.candidate_can_choose_budget!==false||row.handoff_can_schedule_evaluation!==false
    ||row.handoff_can_execute_evaluation!==false||row.handoff_can_promote!==false
    ||row.external_evaluation_owner!==true||row.authored_by_candidate!==false
    ||row.second_evaluation_router_created!==false||row.second_experiment_ledger_created!==false)throw new Error('rsi_materialized_eval_handoff_policy_invalid');
  exactSha(row.source_sha,'stored_handoff_source');
  positiveInt(row.evaluator_generation_seq,'stored_generation_seq');
  positiveInt(row.evaluation_epoch_seq,'stored_epoch_seq');
  exactDigest(row.evaluator_generation_history_anchor_digest,'stored_generation_history_anchor');
  const request=verifyRsiArtifactEvaluationRoutingRequest(row.fresh_evaluation_request);
  const bindings=[
    ['source_sha',row.source_sha],
    ['phase28_artifact_receipt_digest',row.phase28_artifact_receipt_digest],
    ['parent_artifact_digest',row.parent_artifact_digest],
    ['candidate_artifact_digest',row.candidate_artifact_digest],
    ['provenance_root_digest',row.provenance_root_digest],
    ['evaluator_root_digest',row.evaluator_root_digest],
    ['evaluator_generation_digest',row.evaluator_generation_digest],
    ['evaluation_epoch_digest',row.evaluation_epoch_digest],
    ['sealed_task_set_digest',row.sealed_task_set_digest],
    ['harness_digest',row.evaluation_harness_digest],
    ['trial_worker_image_digest',row.trial_worker_image_digest],
    ['resource_budget_digest',row.resource_budget_digest],
    ['task_order_digest',row.task_order_digest],
    ['threshold_policy_digest',row.acceptance_policy_digest],
    ['stopping_policy_digest',row.stopping_policy_digest],
    ['hidden_holdout_root_digest',row.hidden_holdout_root_digest],
    ['safety_suite_root_digest',row.safety_suite_root_digest],
    ['security_suite_root_digest',row.security_suite_root_digest],
  ];
  for(const [field,value] of bindings){
    if(request[field]!==value)throw new Error(`rsi_materialized_eval_stored_request_${field}_mismatch`);
  }
  const clone=structuredClone(row);delete clone.evaluation_handoff_digest;
  if(digest(clone)!==exactDigest(row.evaluation_handoff_digest,'stored_handoff'))throw new Error('rsi_materialized_eval_handoff_digest_mismatch');
  return Object.freeze(structuredClone(row));
}

export function rsiMaterializedEvaluatorGenerationPredecessorAnchor(previousHandoff){
  const previous=verifyStoredMaterializedCandidateEvaluationHandoff(previousHandoff);
  return digest({
    previous_evaluator_generation_seq:previous.evaluator_generation_seq,
    previous_evaluator_root_digest:previous.evaluator_root_digest,
    previous_evaluator_generation_digest:previous.evaluator_generation_digest,
    previous_evaluation_epoch_seq:previous.evaluation_epoch_seq,
    previous_evaluation_epoch_digest:previous.evaluation_epoch_digest,
    previous_handoff_digest:previous.evaluation_handoff_digest,
    previous_history_anchor_digest:previous.evaluator_generation_history_anchor_digest,
  });
}

function assertGenerationTransition(previous,current){
  if(!previous)return;
  if(current.evaluator_generation_seq===previous.evaluator_generation_seq){
    if(current.evaluator_root_digest!==previous.evaluator_root_digest
      ||current.evaluator_generation_digest!==previous.evaluator_generation_digest
      ||current.evaluator_generation_history_anchor_digest!==previous.evaluator_generation_history_anchor_digest){
      throw new Error('rsi_materialized_eval_generation_identity_drift');
    }
    if(current.evaluation_epoch_seq===previous.evaluation_epoch_seq){
      if(current.evaluation_epoch_digest!==previous.evaluation_epoch_digest)throw new Error('rsi_materialized_eval_epoch_identity_drift');
    }else if(current.evaluation_epoch_seq===previous.evaluation_epoch_seq+1){
      if(current.evaluation_epoch_digest===previous.evaluation_epoch_digest)throw new Error('rsi_materialized_eval_new_epoch_digest_required');
    }else{
      throw new Error('rsi_materialized_eval_epoch_sequence_gap');
    }
    return;
  }
  if(current.evaluator_generation_seq!==previous.evaluator_generation_seq+1)throw new Error('rsi_materialized_eval_generation_sequence_gap');
  if(current.evaluation_epoch_seq!==1)throw new Error('rsi_materialized_eval_new_generation_epoch_must_start_at_one');
  if(current.evaluator_generation_digest===previous.evaluator_generation_digest)throw new Error('rsi_materialized_eval_new_generation_digest_required');
  const expected=rsiMaterializedEvaluatorGenerationPredecessorAnchor(previous);
  if(current.evaluator_generation_history_anchor_digest!==expected)throw new Error('rsi_materialized_eval_generation_history_anchor_mismatch');
}

function handoffLedgerState(sourceSha,rows){
  const handoffs=rows.map(row=>row.handoff);
  const generations=[...new Set(handoffs.map(row=>row.evaluator_generation_seq))];
  const latest=handoffs.at(-1)||null;
  const core=zero({
    schema:RSI_MATERIALIZED_CANDIDATE_EVALUATION_HANDOFF_LEDGER_SCHEMA,
    version:1,
    source_sha:sourceSha,
    rows,
    row_count:rows.length,
    generation_count:generations.length,
    latest_generation_seq:latest?.evaluator_generation_seq??null,
    latest_epoch_seq:latest?.evaluation_epoch_seq??null,
    append_only:true,
    durable_before_visible:true,
    generation_history_monotonic:true,
    generation_transition_contiguous:true,
    epoch_transition_contiguous:true,
    exact_phase28_evidence_replay_required:true,
    external_rotation_receipt_required:true,
    anchor_recalibration_required_on_rotation:true,
    experiment_results_stored_here:false,
    existing_candidate_experiment_ledger_owns_outcomes:true,
    candidate_can_delete:false,
    candidate_can_rewrite:false,
    ledger_can_schedule_evaluation:false,
    ledger_can_execute_evaluation:false,
    ledger_can_promote:false,
  });
  return {...core,state_digest:digest(core)};
}

export class RsiMaterializedCandidateEvaluationHandoffLedger{
  #path;#sourceSha;#rows=[];#initialized=false;
  constructor({statePath,source_sha}={}){
    if(!statePath)throw new Error('rsi_materialized_eval_handoff_ledger_path_required');
    this.#path=path.resolve(statePath);
    this.#sourceSha=exactSha(source_sha,'handoff_ledger_source');
  }
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const persisted=JSON.parse(await fs.readFile(this.#path,'utf8'));
      assertZero(persisted,'handoff_ledger');
      if(persisted.schema!==RSI_MATERIALIZED_CANDIDATE_EVALUATION_HANDOFF_LEDGER_SCHEMA||persisted.version!==1
        ||persisted.source_sha!==this.#sourceSha||persisted.append_only!==true||persisted.durable_before_visible!==true
        ||persisted.generation_history_monotonic!==true||persisted.generation_transition_contiguous!==true
        ||persisted.epoch_transition_contiguous!==true||persisted.exact_phase28_evidence_replay_required!==true
        ||persisted.external_rotation_receipt_required!==true||persisted.anchor_recalibration_required_on_rotation!==true
        ||persisted.experiment_results_stored_here!==false
        ||persisted.existing_candidate_experiment_ledger_owns_outcomes!==true||persisted.candidate_can_delete!==false
        ||persisted.candidate_can_rewrite!==false||persisted.ledger_can_schedule_evaluation!==false
        ||persisted.ledger_can_execute_evaluation!==false||persisted.ledger_can_promote!==false)throw new Error('rsi_materialized_eval_handoff_ledger_state_invalid');
      const clone=structuredClone(persisted);delete clone.state_digest;
      if(digest(clone)!==exactDigest(persisted.state_digest,'handoff_ledger'))throw new Error('rsi_materialized_eval_handoff_ledger_digest_mismatch');
      if(!Array.isArray(persisted.rows)||persisted.rows.length>MAX_HANDOFF_ROWS)throw new Error('rsi_materialized_eval_handoff_ledger_rows_invalid');
      const checked=[];
      const digests=new Set();
      const identities=new Set();
      let previous=null;
      for(let i=0;i<persisted.rows.length;i+=1){
        const raw=persisted.rows[i];
        if(!raw||raw.handoff_seq!==i+1)throw new Error('rsi_materialized_eval_handoff_sequence_gap');
        const evidence=verifyPersistedHandoffEvidence(raw);
        const handoff=evidence.handoff;
        if(handoff.source_sha!==this.#sourceSha)throw new Error('rsi_materialized_eval_handoff_ledger_source_mismatch');
        if(digests.has(handoff.evaluation_handoff_digest))throw new Error('rsi_materialized_eval_handoff_duplicate');
        const identity=`${handoff.phase28_artifact_receipt_digest}:${handoff.evaluator_generation_seq}:${handoff.evaluation_epoch_seq}`;
        if(identities.has(identity))throw new Error('rsi_materialized_eval_handoff_identity_duplicate');
        assertGenerationTransition(previous,handoff);
        let rotation=null;
        if(previous&&handoff.evaluator_generation_seq!==previous.evaluator_generation_seq){
          rotation=verifyRsiEvaluatorGenerationRotation(raw.rotation);
          if(rotation.source_sha!==this.#sourceSha
            ||rotation.previous_evaluator_root_digest!==previous.evaluator_root_digest
            ||rotation.previous_evaluator_generation_digest!==previous.evaluator_generation_digest
            ||rotation.previous_evaluator_generation_seq!==previous.evaluator_generation_seq
            ||rotation.previous_evaluation_epoch_digest!==previous.evaluation_epoch_digest
            ||rotation.previous_evaluation_epoch_seq!==previous.evaluation_epoch_seq
            ||rotation.next_evaluator_root_digest!==handoff.evaluator_root_digest
            ||rotation.next_evaluator_generation_digest!==handoff.evaluator_generation_digest
            ||rotation.next_evaluator_generation_seq!==handoff.evaluator_generation_seq
            ||rotation.next_evaluation_epoch_digest!==handoff.evaluation_epoch_digest
            ||rotation.next_evaluation_epoch_seq!==handoff.evaluation_epoch_seq
            ||rotation.next_generation_history_anchor_digest!==handoff.evaluator_generation_history_anchor_digest){
            throw new Error('rsi_materialized_eval_rotation_binding_mismatch');
          }
        }else if(raw.rotation!==null&&raw.rotation!==undefined){
          throw new Error('rsi_materialized_eval_rotation_unexpected');
        }
        digests.add(handoff.evaluation_handoff_digest);
        identities.add(identity);
        checked.push(Object.freeze({
          handoff_seq:i+1,
          handoff,
          artifact_receipt:evidence.artifact_receipt,
          artifact_verification:evidence.artifact_verification,
          rotation:rotation?Object.freeze(structuredClone(rotation)):null,
        }));
        previous=handoff;
      }
      const canonical=handoffLedgerState(this.#sourceSha,checked);
      if(canonical.row_count!==persisted.row_count||canonical.generation_count!==persisted.generation_count
        ||canonical.latest_generation_seq!==persisted.latest_generation_seq||canonical.latest_epoch_seq!==persisted.latest_epoch_seq){
        throw new Error('rsi_materialized_eval_handoff_ledger_derived_state_mismatch');
      }
      this.#rows=checked;
    }catch(error){if(error?.code!=='ENOENT')throw error;}
    this.#initialized=true;
    return this.snapshot();
  }
  async #persist(rows){
    const state=handoffLedgerState(this.#sourceSha,rows);
    const tmp=`${this.#path}.tmp`;
    const handle=await fs.open(tmp,'w',0o600);
    try{await handle.writeFile(`${JSON.stringify(state)}\n`,'utf8');await handle.sync();}finally{await handle.close();}
    await fs.rename(tmp,this.#path);
  }
  async add({handoff,artifact_receipt,artifact_verification,rotation=null}={}){
    if(!this.#initialized)throw new Error('rsi_materialized_eval_handoff_ledger_not_initialized');
    const evidence=verifyPersistedHandoffEvidence({handoff,artifact_receipt,artifact_verification});
    const checked=evidence.handoff;
    if(checked.source_sha!==this.#sourceSha)throw new Error('rsi_materialized_eval_handoff_ledger_source_mismatch');
    const existing=this.#rows.find(row=>row.handoff.evaluation_handoff_digest===checked.evaluation_handoff_digest);
    if(existing)return zero({state:'IDEMPOTENT',handoff_seq:existing.handoff_seq,evaluation_handoff_digest:checked.evaluation_handoff_digest});
    const identity=`${checked.phase28_artifact_receipt_digest}:${checked.evaluator_generation_seq}:${checked.evaluation_epoch_seq}`;
    if(this.#rows.some(row=>`${row.handoff.phase28_artifact_receipt_digest}:${row.handoff.evaluator_generation_seq}:${row.handoff.evaluation_epoch_seq}`===identity)){
      throw new Error('rsi_materialized_eval_handoff_identity_conflict');
    }
    if(this.#rows.length>=MAX_HANDOFF_ROWS)throw new Error('rsi_materialized_eval_handoff_ledger_capacity_exceeded');
    const previous=this.#rows.at(-1)?.handoff??null;
    assertGenerationTransition(previous,checked);
    let checkedRotation=null;
    if(previous&&checked.evaluator_generation_seq!==previous.evaluator_generation_seq){
      checkedRotation=verifyRsiEvaluatorGenerationRotation(rotation);
      if(checkedRotation.source_sha!==this.#sourceSha
        ||checkedRotation.previous_evaluator_root_digest!==previous.evaluator_root_digest
        ||checkedRotation.previous_evaluator_generation_digest!==previous.evaluator_generation_digest
        ||checkedRotation.previous_evaluator_generation_seq!==previous.evaluator_generation_seq
        ||checkedRotation.previous_evaluation_epoch_digest!==previous.evaluation_epoch_digest
        ||checkedRotation.previous_evaluation_epoch_seq!==previous.evaluation_epoch_seq
        ||checkedRotation.next_evaluator_root_digest!==checked.evaluator_root_digest
        ||checkedRotation.next_evaluator_generation_digest!==checked.evaluator_generation_digest
        ||checkedRotation.next_evaluator_generation_seq!==checked.evaluator_generation_seq
        ||checkedRotation.next_evaluation_epoch_digest!==checked.evaluation_epoch_digest
        ||checkedRotation.next_evaluation_epoch_seq!==checked.evaluation_epoch_seq
        ||checkedRotation.next_generation_history_anchor_digest!==checked.evaluator_generation_history_anchor_digest){
        throw new Error('rsi_materialized_eval_rotation_binding_mismatch');
      }
    }else if(rotation!==null&&rotation!==undefined){
      throw new Error('rsi_materialized_eval_rotation_unexpected');
    }
    const next=[...this.#rows,Object.freeze({
      handoff_seq:this.#rows.length+1,
      handoff:structuredClone(checked),
      artifact_receipt:structuredClone(evidence.artifact_receipt),
      artifact_verification:structuredClone(evidence.artifact_verification),
      rotation:checkedRotation?structuredClone(checkedRotation):null,
    })];
    await this.#persist(next);
    this.#rows=next;
    return zero({state:'HANDOFF_RECORDED_EXTERNAL_EVALUATION_REQUIRED',handoff_seq:next.length,evaluation_handoff_digest:checked.evaluation_handoff_digest});
  }
  snapshot(){
    const state=handoffLedgerState(this.#sourceSha,this.#rows);
    return Object.freeze({
      schema:state.schema,version:state.version,source_sha:state.source_sha,initialized:this.#initialized,
      row_count:state.row_count,generation_count:state.generation_count,latest_generation_seq:state.latest_generation_seq,
      latest_epoch_seq:state.latest_epoch_seq,append_only:true,durable_before_visible:true,generation_history_monotonic:true,
      generation_transition_contiguous:true,epoch_transition_contiguous:true,exact_phase28_evidence_replay_required:true,
      external_rotation_receipt_required:true,anchor_recalibration_required_on_rotation:true,experiment_results_stored_here:false,
      existing_candidate_experiment_ledger_owns_outcomes:true,ledger_can_schedule_evaluation:false,
      ledger_can_execute_evaluation:false,ledger_can_promote:false,authority_effect:false,
    });
  }
}

export function rsiMaterializedCandidateEvaluationHandoffTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.materialized-candidate-evaluation-handoff-root.v1',
    version:1,
    verified_phase28_artifact_receipt_required:true,
    fresh_budget_epoch_required:true,
    prior_budget_reuse_allowed:false,
    protected_scope_floor_required:true,
    evaluator_generation_frozen_per_epoch:true,
    evaluator_dependent_verdict_reuse_allowed:false,
    evaluator_generation_history_append_only:true,
    evaluator_generation_sequence_external:true,
    evaluation_epoch_sequence_external:true,
    generation_transition_must_be_contiguous:true,
    evaluation_epoch_transition_must_be_contiguous:true,
    generation_history_anchor_external:true,
    exact_phase28_evidence_replay_required:true,
    external_rotation_receipt_required:true,
    anchor_recalibration_required_on_rotation:true,
    build_and_evaluation_workers_must_differ:true,
    sealed_task_set_external:true,
    evaluation_harness_external:true,
    resource_budget_external:true,
    task_order_external:true,
    acceptance_policy_external:true,
    stopping_policy_external:true,
    hidden_holdout_external:true,
    safety_suite_external:true,
    security_suite_external:true,
    underlying_artifact_request_binds_all_acceptance_assets:true,
    underlying_paired_intent_rechecks_all_acceptance_assets:true,
    existing_evaluation_budget_router_only:true,
    existing_candidate_experiment_ledger_only:true,
    one_attempt_per_arm:true,
    blind_retry_forbidden:true,
    execution_authority:false,
    browser_authority:false,
    task_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,handoff_root_digest:digest(root)});
}
