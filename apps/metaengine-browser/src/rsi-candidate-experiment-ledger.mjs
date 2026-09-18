import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  RSI_ARTIFACT_EVALUATION_ROUTING_REQUEST_SCHEMA,
  RSI_EVALUATION_BUDGET_PLAN_SCHEMA,
  RSI_EVALUATION_ROUTING_REQUEST_SCHEMA,
  verifyRsiEvaluationBudgetPlan,
  verifyRsiEvaluationBudgetRequest,
} from './rsi-evaluation-budget-router.mjs';

export const RSI_CANDIDATE_EXPERIMENT_INTENT_SCHEMA='metaengine.rsi.candidate-experiment-intent.v1';
export const RSI_CANDIDATE_EXPERIMENT_RECEIPT_SCHEMA='metaengine.rsi.candidate-experiment-receipt.v1';
export const RSI_CANDIDATE_EXPERIMENT_LEDGER_SCHEMA='metaengine.rsi.candidate-experiment-ledger.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_ROWS=1024;
const METRIC_KEYS=Object.freeze([
  'task_utility',
  'safety',
  'security',
  'process_integrity',
  'outcome_integrity',
  'efficiency',
]);

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error(`rsi_experiment_${l}_sha_invalid`);return x;}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_experiment_${l}_digest_invalid`);return x;}
function id(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error(`rsi_experiment_${l}_invalid`);return x;}
function boundedInt(v,l,max){const n=Number(v);if(!Number.isSafeInteger(n)||n<0||n>max)throw new Error(`rsi_experiment_${l}_invalid`);return n;}
function score(v,l){const n=Number(v);if(!Number.isFinite(n)||n<0||n>1)throw new Error(`rsi_experiment_${l}_invalid`);return n;}
function assertZero(v,l){for(const f of ['execution_authority','browser_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_experiment_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_experiment_${l}_retry_invalid`);}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false});}
function metrics(v,l){
  if(!v||typeof v!=='object'||Array.isArray(v))throw new Error(`rsi_experiment_${l}_metrics_invalid`);
  const keys=Object.keys(v).sort();
  if(keys.length!==METRIC_KEYS.length||METRIC_KEYS.some(k=>!keys.includes(k)))throw new Error(`rsi_experiment_${l}_metric_set_invalid`);
  return Object.freeze(Object.fromEntries(METRIC_KEYS.map(k=>[k,score(v[k],`${l}_${k}`)])));
}
function compareMetrics(control,treatment){
  const regressions=METRIC_KEYS.filter(k=>treatment[k]<control[k]).sort();
  const improvements=METRIC_KEYS.filter(k=>treatment[k]>control[k]).sort();
  return Object.freeze({
    no_regression:regressions.length===0,
    strict_improvement:improvements.length>0,
    regressed_metrics:Object.freeze(regressions),
    improved_metrics:Object.freeze(improvements),
  });
}
function verifySelectedRouting({request,plan,plan_requests,hypothesis,admission}={}){
  if(!request||![RSI_EVALUATION_ROUTING_REQUEST_SCHEMA,RSI_ARTIFACT_EVALUATION_ROUTING_REQUEST_SCHEMA].includes(request.schema))throw new Error('rsi_experiment_routing_request_invalid');
  if(!plan||plan.schema!==RSI_EVALUATION_BUDGET_PLAN_SCHEMA)throw new Error('rsi_experiment_budget_plan_invalid');
  const checkedRequest=verifyRsiEvaluationBudgetRequest(request,{hypothesis,admission});
  const checkedPlan=verifyRsiEvaluationBudgetPlan(plan,{requests:plan_requests});
  if(checkedPlan.source_sha!==checkedRequest.source_sha)throw new Error('rsi_experiment_source_mismatch');
  if(!checkedPlan.selected_request_digests.includes(checkedRequest.request_digest))throw new Error('rsi_experiment_request_not_selected');
  return Object.freeze({request:checkedRequest,plan:checkedPlan});
}

export function createRsiCandidateExperimentIntent({
  intent_id,
  request,
  plan,
  plan_requests,
  hypothesis,
  admission,
  baseline_artifact_digest,
  candidate_artifact_digest,
  sealed_task_set_digest,
  harness_digest,
  evaluator_root_digest,
  trial_worker_image_digest,
  resource_budget_digest,
  task_order_digest,
  external_experiment_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_experiment_owner!==true||authored_by_candidate!==false)throw new Error('rsi_experiment_external_owner_required');
  const routed=verifySelectedRouting({request,plan,plan_requests,hypothesis,admission});
  const roots=[
    exactDigest(baseline_artifact_digest,'baseline_artifact'),
    exactDigest(candidate_artifact_digest,'candidate_artifact'),
    exactDigest(sealed_task_set_digest,'sealed_task_set'),
    exactDigest(harness_digest,'harness'),
    exactDigest(evaluator_root_digest,'evaluator_root'),
    exactDigest(trial_worker_image_digest,'trial_worker_image'),
    exactDigest(resource_budget_digest,'resource_budget'),
    exactDigest(task_order_digest,'task_order'),
  ];
  if(new Set(roots).size!==roots.length)throw new Error('rsi_experiment_independent_roots_required');
  if(roots[0]===roots[1])throw new Error('rsi_experiment_distinct_candidate_required');
  const artifactRequest=routed.request.schema===RSI_ARTIFACT_EVALUATION_ROUTING_REQUEST_SCHEMA;
  if(artifactRequest){
    if(roots[0]!==routed.request.parent_artifact_digest)throw new Error('rsi_experiment_artifact_baseline_mismatch');
    if(roots[1]!==routed.request.candidate_artifact_digest)throw new Error('rsi_experiment_artifact_candidate_mismatch');
    if(roots[2]!==routed.request.sealed_task_set_digest)throw new Error('rsi_experiment_artifact_sealed_tasks_mismatch');
    if(roots[3]!==routed.request.harness_digest)throw new Error('rsi_experiment_artifact_harness_mismatch');
    if(roots[4]!==routed.request.evaluator_root_digest)throw new Error('rsi_experiment_artifact_evaluator_mismatch');
    if(roots[5]!==routed.request.trial_worker_image_digest)throw new Error('rsi_experiment_artifact_worker_mismatch');
    if(roots[6]!==routed.request.resource_budget_digest)throw new Error('rsi_experiment_artifact_resource_budget_mismatch');
    if(roots[7]!==routed.request.task_order_digest)throw new Error('rsi_experiment_artifact_task_order_mismatch');
  }
  const identity={
    source_sha:routed.request.source_sha,
    request_digest:routed.request.request_digest,
    plan_digest:routed.plan.plan_digest,
    hypothesis_digest:artifactRequest?routed.request.evaluation_subject_digest:routed.request.hypothesis_digest,
    baseline_artifact_digest:roots[0],
    candidate_artifact_digest:roots[1],
    sealed_task_set_digest:roots[2],
    harness_digest:roots[3],
    evaluator_root_digest:roots[4],
    trial_worker_image_digest:roots[5],
    resource_budget_digest:roots[6],
    task_order_digest:roots[7],
    ...(artifactRequest?{
      evaluation_request_kind:'MATERIALIZED_CANDIDATE',
      phase28_artifact_receipt_digest:routed.request.phase28_artifact_receipt_digest,
      provenance_root_digest:routed.request.provenance_root_digest,
      evaluator_generation_digest:routed.request.evaluator_generation_digest,
      evaluation_epoch_digest:routed.request.evaluation_epoch_digest,
      threshold_policy_digest:routed.request.threshold_policy_digest,
      stopping_policy_digest:routed.request.stopping_policy_digest,
      hidden_holdout_root_digest:routed.request.hidden_holdout_root_digest,
      safety_suite_root_digest:routed.request.safety_suite_root_digest,
      security_suite_root_digest:routed.request.security_suite_root_digest,
      acceptance_assets_frozen:true,
      fresh_budget_epoch_required:true,
    }:{}),
  };
  const core=zero({
    schema:RSI_CANDIDATE_EXPERIMENT_INTENT_SCHEMA,
    version:1,
    intent_id:id(intent_id,'intent_id'),
    ...identity,
    experiment_identity_digest:digest(identity),
    evaluator_cost_units:routed.request.evaluator_cost_units,
    request_snapshot:routed.request,
    plan_snapshot:routed.plan,
    max_attempts_per_arm:1,
    max_retries:0,
    paired_control_treatment:true,
    same_sealed_tasks_required:true,
    same_task_order_required:true,
    same_harness_required:true,
    same_resource_budget_required:true,
    from_scratch_worker_per_arm_required:true,
    external_evaluator_required:true,
    baseline_artifact_read_only:true,
    candidate_artifact_read_only:true,
    experiment_execution_external:true,
    authored_by_candidate:false,
    external_experiment_owner:true,
    candidate_can_execute_experiment:false,
    candidate_can_choose_evaluator:false,
    candidate_can_choose_task_set:false,
    candidate_can_choose_baseline:false,
    candidate_can_retry_ambiguous_effect:false,
    intent_is_execution_authority:false,
    intent_is_scheduler_authority:false,
  });
  return Object.freeze({...core,intent_digest:digest(core)});
}

export function verifyRsiCandidateExperimentIntent(intent,{request,plan,plan_requests,hypothesis,admission}={}){
  if(!intent||intent.schema!==RSI_CANDIDATE_EXPERIMENT_INTENT_SCHEMA||intent.version!==1)throw new Error('rsi_experiment_intent_invalid');
  assertZero(intent,'intent');
  if(intent.max_attempts_per_arm!==1||intent.max_retries!==0||intent.paired_control_treatment!==true
    ||intent.same_sealed_tasks_required!==true||intent.same_task_order_required!==true||intent.same_harness_required!==true
    ||intent.same_resource_budget_required!==true||intent.from_scratch_worker_per_arm_required!==true
    ||intent.external_evaluator_required!==true||intent.baseline_artifact_read_only!==true||intent.candidate_artifact_read_only!==true
    ||intent.experiment_execution_external!==true||intent.authored_by_candidate!==false||intent.external_experiment_owner!==true
    ||intent.candidate_can_execute_experiment!==false||intent.candidate_can_choose_evaluator!==false
    ||intent.candidate_can_choose_task_set!==false||intent.candidate_can_choose_baseline!==false
    ||intent.candidate_can_retry_ambiguous_effect!==false||intent.intent_is_execution_authority!==false
    ||intent.intent_is_scheduler_authority!==false)throw new Error('rsi_experiment_intent_policy_invalid');
  const embeddedRequest=request??intent.request_snapshot;
  const embeddedPlan=plan??intent.plan_snapshot;
  const embeddedPlanRequests=plan_requests??embeddedPlan?.request_snapshots;
  const artifactRequest=embeddedRequest?.schema===RSI_ARTIFACT_EVALUATION_ROUTING_REQUEST_SCHEMA;
  const embeddedHypothesis=hypothesis??embeddedRequest?.hypothesis_snapshot;
  const embeddedAdmission=admission??embeddedRequest?.admission_snapshot;
  if(!embeddedRequest||!embeddedPlan||!embeddedPlanRequests||(!artifactRequest&&(!embeddedHypothesis||!embeddedAdmission)))throw new Error('rsi_experiment_embedded_routing_evidence_required');
  if(artifactRequest){
    if(intent.evaluation_request_kind!=='MATERIALIZED_CANDIDATE'
      ||intent.phase28_artifact_receipt_digest!==embeddedRequest.phase28_artifact_receipt_digest
      ||intent.provenance_root_digest!==embeddedRequest.provenance_root_digest
      ||intent.evaluator_generation_digest!==embeddedRequest.evaluator_generation_digest
      ||intent.evaluation_epoch_digest!==embeddedRequest.evaluation_epoch_digest
      ||intent.threshold_policy_digest!==embeddedRequest.threshold_policy_digest
      ||intent.stopping_policy_digest!==embeddedRequest.stopping_policy_digest
      ||intent.hidden_holdout_root_digest!==embeddedRequest.hidden_holdout_root_digest
      ||intent.safety_suite_root_digest!==embeddedRequest.safety_suite_root_digest
      ||intent.security_suite_root_digest!==embeddedRequest.security_suite_root_digest
      ||intent.acceptance_assets_frozen!==true
      ||intent.fresh_budget_epoch_required!==true)throw new Error('rsi_experiment_artifact_request_binding_invalid');
  }
  const canonical=createRsiCandidateExperimentIntent({
    intent_id:intent.intent_id,request:embeddedRequest,plan:embeddedPlan,plan_requests:embeddedPlanRequests,
    hypothesis:artifactRequest?undefined:embeddedHypothesis,admission:artifactRequest?undefined:embeddedAdmission,
    baseline_artifact_digest:intent.baseline_artifact_digest,candidate_artifact_digest:intent.candidate_artifact_digest,
    sealed_task_set_digest:intent.sealed_task_set_digest,harness_digest:intent.harness_digest,
    evaluator_root_digest:intent.evaluator_root_digest,trial_worker_image_digest:intent.trial_worker_image_digest,
    resource_budget_digest:intent.resource_budget_digest,task_order_digest:intent.task_order_digest,
    external_experiment_owner:true,authored_by_candidate:false,
  });
  if(canonical.intent_digest!==exactDigest(intent.intent_digest,'intent'))throw new Error('rsi_experiment_intent_digest_mismatch');
  return canonical;
}

export function createRsiCandidateExperimentReceipt({
  receipt_id,
  intent,
  control_metrics,
  treatment_metrics,
  control_attempts,
  treatment_attempts,
  retry_count,
  same_tasks_pass,
  same_task_order_pass,
  harness_identity_pass,
  resource_budget_identity_pass,
  evaluator_integrity_pass,
  trial_isolation_pass,
  from_scratch_replay_pass,
  contamination_clear,
  reward_hack_detected,
  blind_retry_detected,
  environment_blocker_detected,
  controllable_failure_detected,
  ambiguous_effect,
  evidence_digest,
  external_runner=false,
  external_evaluator=false,
  authored_by_candidate=true,
}={}){
  if(!intent||intent.schema!==RSI_CANDIDATE_EXPERIMENT_INTENT_SCHEMA)throw new Error('rsi_experiment_intent_invalid');
  assertZero(intent,'receipt_intent');
  const ic=structuredClone(intent);delete ic.intent_digest;
  if(digest(ic)!==exactDigest(intent.intent_digest,'receipt_intent'))throw new Error('rsi_experiment_intent_digest_mismatch');
  if(external_runner!==true||external_evaluator!==true||authored_by_candidate!==false)throw new Error('rsi_experiment_external_receipt_required');
  const control=metrics(control_metrics,'control');
  const treatment=metrics(treatment_metrics,'treatment');
  const comparison=compareMetrics(control,treatment);
  const controlAttempts=boundedInt(control_attempts,'control_attempts',1);
  const treatmentAttempts=boundedInt(treatment_attempts,'treatment_attempts',1);
  const retries=boundedInt(retry_count,'retry_count',0);
  if(controlAttempts!==1||treatmentAttempts!==1||retries!==0)throw new Error('rsi_experiment_single_attempt_required');
  const validityBlockers=[];
  if(same_tasks_pass!==true)validityBlockers.push('TASK_SET_MISMATCH');
  if(same_task_order_pass!==true)validityBlockers.push('TASK_ORDER_MISMATCH');
  if(harness_identity_pass!==true)validityBlockers.push('HARNESS_IDENTITY_MISMATCH');
  if(resource_budget_identity_pass!==true)validityBlockers.push('RESOURCE_BUDGET_MISMATCH');
  if(evaluator_integrity_pass!==true)validityBlockers.push('EVALUATOR_INTEGRITY_FAILURE');
  if(trial_isolation_pass!==true)validityBlockers.push('TRIAL_ISOLATION_FAILURE');
  if(from_scratch_replay_pass!==true)validityBlockers.push('FROM_SCRATCH_REPLAY_FAILURE');
  if(contamination_clear!==true)validityBlockers.push('CONTAMINATION_DETECTED');
  if(reward_hack_detected===true)validityBlockers.push('REWARD_HACK_DETECTED');
  if(blind_retry_detected===true)validityBlockers.push('BLIND_RETRY_DETECTED');
  if(controllable_failure_detected===true)validityBlockers.push('CONTROLLABLE_FAILURE');
  const environmentBlocked=environment_blocker_detected===true&&controllable_failure_detected!==true;
  let state='CANDIDATE_EXPERIMENT_REJECTED';
  if(environmentBlocked)state='INCONCLUSIVE_ENVIRONMENT';
  else if(ambiguous_effect===true)state='INCONCLUSIVE_AMBIGUOUS';
  else if(validityBlockers.length===0&&comparison.no_regression&&comparison.strict_improvement)state='SUPPORTED_FOR_BOUNDED_REVISION';
  else if(validityBlockers.length===0&&comparison.no_regression&&!comparison.strict_improvement)state='NO_MATERIAL_IMPROVEMENT';
  const core=zero({
    schema:RSI_CANDIDATE_EXPERIMENT_RECEIPT_SCHEMA,
    version:1,
    receipt_id:id(receipt_id,'receipt_id'),
    source_sha:intent.source_sha,
    intent_digest:intent.intent_digest,
    experiment_identity_digest:intent.experiment_identity_digest,
    request_digest:intent.request_digest,
    plan_digest:intent.plan_digest,
    hypothesis_digest:intent.hypothesis_digest,
    baseline_artifact_digest:intent.baseline_artifact_digest,
    candidate_artifact_digest:intent.candidate_artifact_digest,
    sealed_task_set_digest:intent.sealed_task_set_digest,
    harness_digest:intent.harness_digest,
    evaluator_root_digest:intent.evaluator_root_digest,
    trial_worker_image_digest:intent.trial_worker_image_digest,
    resource_budget_digest:intent.resource_budget_digest,
    task_order_digest:intent.task_order_digest,
    control_metrics:control,
    treatment_metrics:treatment,
    no_metric_regression:comparison.no_regression,
    strict_metric_improvement:comparison.strict_improvement,
    regressed_metrics:comparison.regressed_metrics,
    improved_metrics:comparison.improved_metrics,
    control_attempts:controlAttempts,
    treatment_attempts:treatmentAttempts,
    retry_count:retries,
    same_tasks_pass:same_tasks_pass===true,
    same_task_order_pass:same_task_order_pass===true,
    harness_identity_pass:harness_identity_pass===true,
    resource_budget_identity_pass:resource_budget_identity_pass===true,
    evaluator_integrity_pass:evaluator_integrity_pass===true,
    trial_isolation_pass:trial_isolation_pass===true,
    from_scratch_replay_pass:from_scratch_replay_pass===true,
    contamination_clear:contamination_clear===true,
    reward_hack_detected:reward_hack_detected===true,
    blind_retry_detected:blind_retry_detected===true,
    environment_blocker_detected:environment_blocker_detected===true,
    controllable_failure_detected:controllable_failure_detected===true,
    inconclusive_environment:environmentBlocked,
    ambiguous_effect:ambiguous_effect===true,
    validity_blockers:Object.freeze(validityBlockers.sort()),
    evidence_digest:exactDigest(evidence_digest,'evidence'),
    state,
    eligible_for_bounded_revision:state==='SUPPORTED_FOR_BOUNDED_REVISION',
    rejected_or_inconclusive:state!=='SUPPORTED_FOR_BOUNDED_REVISION',
    external_runner:true,
    external_evaluator:true,
    authored_by_candidate:false,
    receipt_can_mutate_active_state:false,
    receipt_can_retry_experiment:false,
    receipt_can_schedule_followup:false,
    receipt_is_promotion_authority:false,
  });
  return Object.freeze({...core,receipt_digest:digest(core)});
}

export function verifyRsiCandidateExperimentReceipt(receipt,{intent}={}){
  if(!receipt||receipt.schema!==RSI_CANDIDATE_EXPERIMENT_RECEIPT_SCHEMA||receipt.version!==1)throw new Error('rsi_experiment_receipt_invalid');
  assertZero(receipt,'receipt');
  if(receipt.external_runner!==true||receipt.external_evaluator!==true||receipt.authored_by_candidate!==false
    ||receipt.receipt_can_mutate_active_state!==false||receipt.receipt_can_retry_experiment!==false
    ||receipt.receipt_can_schedule_followup!==false||receipt.receipt_is_promotion_authority!==false
    ||receipt.control_attempts!==1||receipt.treatment_attempts!==1||receipt.retry_count!==0)throw new Error('rsi_experiment_receipt_policy_invalid');
  if(receipt.intent_digest!==intent?.intent_digest)throw new Error('rsi_experiment_receipt_intent_mismatch');
  const canonical=createRsiCandidateExperimentReceipt({
    receipt_id:receipt.receipt_id,intent,
    control_metrics:receipt.control_metrics,treatment_metrics:receipt.treatment_metrics,
    control_attempts:receipt.control_attempts,treatment_attempts:receipt.treatment_attempts,retry_count:receipt.retry_count,
    same_tasks_pass:receipt.same_tasks_pass,same_task_order_pass:receipt.same_task_order_pass,
    harness_identity_pass:receipt.harness_identity_pass,resource_budget_identity_pass:receipt.resource_budget_identity_pass,
    evaluator_integrity_pass:receipt.evaluator_integrity_pass,trial_isolation_pass:receipt.trial_isolation_pass,
    from_scratch_replay_pass:receipt.from_scratch_replay_pass,contamination_clear:receipt.contamination_clear,
    reward_hack_detected:receipt.reward_hack_detected,blind_retry_detected:receipt.blind_retry_detected,
    environment_blocker_detected:receipt.environment_blocker_detected,controllable_failure_detected:receipt.controllable_failure_detected,
    ambiguous_effect:receipt.ambiguous_effect,evidence_digest:receipt.evidence_digest,
    external_runner:true,external_evaluator:true,authored_by_candidate:false,
  });
  if(canonical.receipt_digest!==exactDigest(receipt.receipt_digest,'receipt'))throw new Error('rsi_experiment_receipt_digest_mismatch');
  return canonical;
}

const MATERIALIZED_OUTCOME_STATES=Object.freeze([
  'SUPPORTED_FOR_BOUNDED_REVISION',
  'NO_MATERIAL_IMPROVEMENT',
  'CANDIDATE_EXPERIMENT_REJECTED',
  'INCONCLUSIVE_ENVIRONMENT',
  'INCONCLUSIVE_AMBIGUOUS',
]);

function deriveEvaluationGenerationHistory(rows){
  const history=[];
  const seenGenerations=new Set();
  let current=null;
  let materializedOutcomeCount=0;
  for(const row of rows){
    const intent=row.intent;
    const receipt=row.receipt;
    if(intent?.evaluation_request_kind!=='MATERIALIZED_CANDIDATE')continue;
    materializedOutcomeCount+=1;
    const generation=exactDigest(intent.evaluator_generation_digest,'history_evaluator_generation');
    const evaluatorRoot=exactDigest(intent.evaluator_root_digest,'history_evaluator_root');
    const epoch=exactDigest(intent.evaluation_epoch_digest,'history_evaluation_epoch');
    const artifactReceipt=exactDigest(intent.phase28_artifact_receipt_digest,'history_artifact_receipt');
    const provenance=exactDigest(intent.provenance_root_digest,'history_provenance_root');
    const hiddenHoldout=exactDigest(intent.hidden_holdout_root_digest,'history_hidden_holdout');
    const safetySuite=exactDigest(intent.safety_suite_root_digest,'history_safety_suite');
    const securitySuite=exactDigest(intent.security_suite_root_digest,'history_security_suite');
    if(intent.acceptance_assets_frozen!==true||intent.fresh_budget_epoch_required!==true)throw new Error('rsi_experiment_generation_history_phase29_policy_invalid');
    if(!MATERIALIZED_OUTCOME_STATES.includes(receipt.state))throw new Error('rsi_experiment_generation_history_outcome_state_invalid');

    if(!current||current.evaluator_generation_digest!==generation){
      if(seenGenerations.has(generation))throw new Error('rsi_experiment_generation_history_rollback_detected');
      seenGenerations.add(generation);
      current={
        generation_sequence:history.length+1,
        evaluator_generation_digest:generation,
        evaluator_root_digest:evaluatorRoot,
        evaluation_epoch_digests:[],
        artifact_receipt_digests:[],
        provenance_root_digests:[],
        protected_suite_root_sets:[],
        receipt_digests:[],
        state_counts:{
          supported:0,
          no_material_improvement:0,
          rejected:0,
          inconclusive_environment:0,
          inconclusive_ambiguous:0,
        },
        evaluator_dependent_verdict_reuse_across_generation_allowed:false,
        negative_outcomes_retained:true,
      };
      history.push(current);
    }else if(current.evaluator_root_digest!==evaluatorRoot){
      throw new Error('rsi_experiment_generation_history_evaluator_root_drift');
    }

    if(!current.evaluation_epoch_digests.includes(epoch))current.evaluation_epoch_digests.push(epoch);
    if(!current.artifact_receipt_digests.includes(artifactReceipt))current.artifact_receipt_digests.push(artifactReceipt);
    if(!current.provenance_root_digests.includes(provenance))current.provenance_root_digests.push(provenance);
    const suiteSet=digest({hidden_holdout_root_digest:hiddenHoldout,safety_suite_root_digest:safetySuite,security_suite_root_digest:securitySuite});
    if(!current.protected_suite_root_sets.includes(suiteSet))current.protected_suite_root_sets.push(suiteSet);
    current.receipt_digests.push(receipt.receipt_digest);
    if(receipt.state==='SUPPORTED_FOR_BOUNDED_REVISION')current.state_counts.supported+=1;
    else if(receipt.state==='NO_MATERIAL_IMPROVEMENT')current.state_counts.no_material_improvement+=1;
    else if(receipt.state==='CANDIDATE_EXPERIMENT_REJECTED')current.state_counts.rejected+=1;
    else if(receipt.state==='INCONCLUSIVE_ENVIRONMENT')current.state_counts.inconclusive_environment+=1;
    else if(receipt.state==='INCONCLUSIVE_AMBIGUOUS')current.state_counts.inconclusive_ambiguous+=1;
  }

  const frozen=history.map(entry=>Object.freeze({
    ...entry,
    evaluation_epoch_digests:Object.freeze([...entry.evaluation_epoch_digests]),
    artifact_receipt_digests:Object.freeze([...entry.artifact_receipt_digests]),
    provenance_root_digests:Object.freeze([...entry.provenance_root_digests]),
    protected_suite_root_sets:Object.freeze([...entry.protected_suite_root_sets]),
    receipt_digests:Object.freeze([...entry.receipt_digests]),
    state_counts:Object.freeze({...entry.state_counts}),
    outcome_count:entry.receipt_digests.length,
  }));
  return Object.freeze({
    generation_history:Object.freeze(frozen),
    generation_count:frozen.length,
    materialized_outcome_count:materializedOutcomeCount,
  });
}

function ledgerState(sourceSha,rows){
  const counts=Object.freeze({
    supported:rows.filter(r=>r.receipt.state==='SUPPORTED_FOR_BOUNDED_REVISION').length,
    no_material_improvement:rows.filter(r=>r.receipt.state==='NO_MATERIAL_IMPROVEMENT').length,
    rejected:rows.filter(r=>r.receipt.state==='CANDIDATE_EXPERIMENT_REJECTED').length,
    inconclusive_environment:rows.filter(r=>r.receipt.state==='INCONCLUSIVE_ENVIRONMENT').length,
    inconclusive_ambiguous:rows.filter(r=>r.receipt.state==='INCONCLUSIVE_AMBIGUOUS').length,
  });
  const generationHistory=deriveEvaluationGenerationHistory(rows);
  const core=zero({
    schema:RSI_CANDIDATE_EXPERIMENT_LEDGER_SCHEMA,
    version:1,
    source_sha:sourceSha,
    rows,
    row_count:rows.length,
    state_counts:counts,
    evaluation_generation_history:generationHistory.generation_history,
    evaluation_generation_count:generationHistory.generation_count,
    materialized_candidate_outcome_count:generationHistory.materialized_outcome_count,
    generation_history_append_only:true,
    evaluator_generation_rollback_allowed:false,
    evaluator_dependent_verdict_reuse_across_generation_allowed:false,
    all_materialized_outcome_classes_retained:true,
    append_only:true,
    rejected_evidence_retained:true,
    inconclusive_evidence_retained:true,
    ledger_can_mutate_active_state:false,
    ledger_can_retry_experiment:false,
    ledger_can_schedule_followup:false,
    candidate_can_delete:false,
    candidate_can_rewrite:false,
  });
  return {...core,state_digest:digest(core)};
}

export class RsiCandidateExperimentLedger{
  #path;#sourceSha;#rows=[];#initialized=false;
  constructor({statePath,source_sha}={}){if(!statePath)throw new Error('rsi_experiment_ledger_path_required');this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'ledger_source');}
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const p=JSON.parse(await fs.readFile(this.#path,'utf8'));assertZero(p,'ledger');
      if(p.schema!==RSI_CANDIDATE_EXPERIMENT_LEDGER_SCHEMA||p.version!==1||p.source_sha!==this.#sourceSha||p.append_only!==true
        ||p.rejected_evidence_retained!==true||p.inconclusive_evidence_retained!==true
        ||(p.evaluation_generation_history!==undefined&&(
          p.generation_history_append_only!==true
          ||p.evaluator_generation_rollback_allowed!==false
          ||p.evaluator_dependent_verdict_reuse_across_generation_allowed!==false
          ||p.all_materialized_outcome_classes_retained!==true
        ))
        ||p.ledger_can_mutate_active_state!==false||p.ledger_can_retry_experiment!==false||p.ledger_can_schedule_followup!==false
        ||p.candidate_can_delete!==false||p.candidate_can_rewrite!==false)throw new Error('rsi_experiment_ledger_state_invalid');
      const clone=structuredClone(p);delete clone.state_digest;if(digest(clone)!==exactDigest(p.state_digest,'ledger'))throw new Error('rsi_experiment_ledger_digest_mismatch');
      if(!Array.isArray(p.rows)||p.rows.length>MAX_ROWS)throw new Error('rsi_experiment_ledger_rows_invalid');
      const ids=new Set();
      const receiptIds=new Set();
      const checkedRows=[];
      for(const raw of p.rows){
        if(raw.source_sha!==this.#sourceSha)throw new Error('rsi_experiment_ledger_source_mismatch');
        const intent=verifyRsiCandidateExperimentIntent(raw.intent);
        const receipt=verifyRsiCandidateExperimentReceipt(raw.receipt,{intent});
        if(intent.source_sha!==this.#sourceSha||receipt.source_sha!==this.#sourceSha)throw new Error('rsi_experiment_ledger_source_mismatch');
        if(ids.has(intent.intent_digest))throw new Error('rsi_experiment_ledger_intent_duplicate');
        if(receiptIds.has(receipt.receipt_id))throw new Error('rsi_experiment_ledger_receipt_duplicate');
        ids.add(intent.intent_digest);receiptIds.add(receipt.receipt_id);
        checkedRows.push(Object.freeze({source_sha:this.#sourceSha,intent,receipt}));
      }
      const canonical=ledgerState(this.#sourceSha,checkedRows);
      if(p.evaluation_generation_history!==undefined){
        if(canonical.state_digest!==p.state_digest)throw new Error('rsi_experiment_ledger_derived_state_mismatch');
      }else if(p.row_count!==canonical.row_count||JSON.stringify(p.state_counts)!==JSON.stringify(canonical.state_counts)){
        throw new Error('rsi_experiment_ledger_summary_mismatch');
      }
      this.#rows=checkedRows;
    }catch(error){if(error?.code!=='ENOENT')throw error;}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(rows=this.#rows){const s=ledgerState(this.#sourceSha,rows);const tmp=`${this.#path}.tmp`;const h=await fs.open(tmp,'w',0o600);try{await h.writeFile(`${JSON.stringify(s)}\n`,'utf8');await h.sync();}finally{await h.close();}await fs.rename(tmp,this.#path);}
  async add({intent,receipt}={}){
    if(!this.#initialized)throw new Error('rsi_experiment_ledger_not_initialized');
    const checkedIntent=verifyRsiCandidateExperimentIntent(intent);
    const checkedReceipt=verifyRsiCandidateExperimentReceipt(receipt,{intent:checkedIntent});
    if(checkedIntent.source_sha!==this.#sourceSha||checkedReceipt.source_sha!==this.#sourceSha)throw new Error('rsi_experiment_ledger_binding_mismatch');
    const existing=this.#rows.find(r=>r.intent.intent_digest===checkedIntent.intent_digest||r.receipt.receipt_id===checkedReceipt.receipt_id);
    if(existing){
      if(existing.intent.intent_digest!==checkedIntent.intent_digest||existing.receipt.receipt_digest!==checkedReceipt.receipt_digest)throw new Error('rsi_experiment_ledger_identity_conflict');
      return zero({state:'IDEMPOTENT',receipt_digest:checkedReceipt.receipt_digest});
    }
    if(this.#rows.length>=MAX_ROWS)throw new Error('rsi_experiment_ledger_capacity_exceeded');
    const nextRows=[...this.#rows,Object.freeze({source_sha:this.#sourceSha,intent:structuredClone(checkedIntent),receipt:structuredClone(checkedReceipt)})];
    await this.#persist(nextRows);
    this.#rows=nextRows;
    return zero({state:checkedReceipt.state,receipt_digest:checkedReceipt.receipt_digest});
  }
  supported(){if(!this.#initialized)throw new Error('rsi_experiment_ledger_not_initialized');return Object.freeze(this.#rows.filter(r=>r.receipt.eligible_for_bounded_revision===true).map(r=>Object.freeze(structuredClone(r.receipt))));}
  rejectedOrInconclusive(){if(!this.#initialized)throw new Error('rsi_experiment_ledger_not_initialized');return Object.freeze(this.#rows.filter(r=>r.receipt.rejected_or_inconclusive===true).map(r=>Object.freeze(structuredClone(r.receipt))));}
  evaluationGenerationHistory(){if(!this.#initialized)throw new Error('rsi_experiment_ledger_not_initialized');return ledgerState(this.#sourceSha,this.#rows).evaluation_generation_history;}
  snapshot(){const s=ledgerState(this.#sourceSha,this.#rows);return Object.freeze({schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,row_count:s.row_count,state_counts:s.state_counts,evaluation_generation_history:s.evaluation_generation_history,evaluation_generation_count:s.evaluation_generation_count,materialized_candidate_outcome_count:s.materialized_candidate_outcome_count,generation_history_append_only:true,evaluator_generation_rollback_allowed:false,evaluator_dependent_verdict_reuse_across_generation_allowed:false,all_materialized_outcome_classes_retained:true,append_only:true,rejected_evidence_retained:true,inconclusive_evidence_retained:true,ledger_can_mutate_active_state:false,ledger_can_retry_experiment:false,ledger_can_schedule_followup:false,authority_effect:false});}
}

export function rsiCandidateExperimentLedgerTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.candidate-experiment-ledger-root.v1',
    version:1,
    selected_routing_request_required:true,
    materialized_candidate_request_supported:true,
    phase28_artifact_receipt_binding_required:true,
    fresh_budget_epoch_required_for_materialized_candidate:true,
    evaluator_generation_binding_required:true,
    evaluator_root_binding_required:true,
    sealed_task_set_binding_required:true,
    harness_binding_required:true,
    trial_worker_binding_required:true,
    resource_budget_binding_required:true,
    task_order_binding_required:true,
    threshold_policy_binding_required:true,
    stopping_policy_binding_required:true,
    hidden_holdout_binding_required:true,
    safety_suite_binding_required:true,
    security_suite_binding_required:true,
    evaluation_generation_history_append_only:true,
    evaluator_generation_rollback_allowed:false,
    evaluator_dependent_verdict_reuse_across_generation_allowed:false,
    all_materialized_outcome_classes_retained:true,
    paired_control_treatment_required:true,
    unchanged_baseline_artifact_required:true,
    same_sealed_tasks_required:true,
    same_task_order_required:true,
    same_harness_required:true,
    same_resource_budget_required:true,
    from_scratch_trial_worker_required:true,
    one_attempt_per_arm:true,
    blind_retry_forbidden:true,
    external_runner_required:true,
    external_evaluator_required:true,
    environment_blocker_separate_from_candidate_failure:true,
    ambiguous_effect_requires_new_external_intent:true,
    no_metric_regression_required:true,
    at_least_one_metric_improvement_required:true,
    rejected_evidence_retained:true,
    inconclusive_evidence_retained:true,
    supported_result_only_eligible_for_bounded_revision:true,
    ledger_can_mutate_active_state:false,
    ledger_can_retry_experiment:false,
    ledger_can_schedule_followup:false,
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
  return Object.freeze({...root,candidate_experiment_ledger_root_digest:digest(root)});
}
