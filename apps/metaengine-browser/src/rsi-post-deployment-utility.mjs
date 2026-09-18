import crypto from 'node:crypto';

import {
  createRsiExperienceUtilityReceipt,
  verifyRsiExperienceUtilityReceipt,
  extendRsiExperienceGraphSnapshot,
  verifyRsiExperienceGraphSnapshot,
} from './rsi-experience-graph.mjs';
import {
  verifyRsiPostDeploymentExperienceAdmission,
} from './rsi-post-deployment-learning.mjs';

export const RSI_POST_DEPLOYMENT_UTILITY_ADMISSION_SCHEMA='metaengine.rsi.post-deployment-utility-admission.v1';
export const RSI_POST_DEPLOYMENT_UTILITY_ROOT_SCHEMA='metaengine.rsi.post-deployment-utility-root.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const OUTCOMES=new Set(['HELPFUL','HARMFUL','NEUTRAL']);
const MIN_WINDOW_MS=60_000;
const MAX_WINDOW_MS=30*24*60*60*1000;
const MAX_REFS=32;
const MAX_PAYLOAD_BYTES=32*1024;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
}
function digest(value){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`}
function bytes(value){return Buffer.byteLength(JSON.stringify(stable(value)),'utf8')}
function zeroAuthority(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,scheduler_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,release_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false})}
function assertZeroAuthority(value,label){
  for(const key of ['execution_authority','browser_authority','scheduler_authority','task_authority','production_mutation_authority','promotion_authority','release_authority','self_update_authority','authority_effect']){
    if(Object.hasOwn(value||{},key)&&value[key]!==false)throw new Error(`rsi_post_deploy_utility_${label}_${key}_invalid`);
  }
  if(Object.hasOwn(value||{},'automatic_retry_allowed')&&value.automatic_retry_allowed!==false)throw new Error(`rsi_post_deploy_utility_${label}_retry_invalid`);
}
function sha(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA40_RE.test(out))throw new Error(`rsi_post_deploy_utility_${label}_sha_invalid`);return out}
function sha256(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA256_RE.test(out))throw new Error(`rsi_post_deploy_utility_${label}_digest_invalid`);return out}
function safeId(value,label){const out=String(value||'').trim();if(!SAFE_ID_RE.test(out))throw new Error(`rsi_post_deploy_utility_${label}_invalid`);return out}
function iso(value,label){const raw=String(value||'').trim();const parsed=Date.parse(raw);if(!raw||!Number.isFinite(parsed))throw new Error(`rsi_post_deploy_utility_${label}_time_invalid`);return new Date(parsed).toISOString()}
function refs(value){
  if(!Array.isArray(value)||value.length<1||value.length>MAX_REFS)throw new Error('rsi_post_deploy_utility_evidence_refs_invalid');
  const out=value.map(v=>safeId(v,'evidence_ref')).sort();
  if(new Set(out).size!==out.length)throw new Error('rsi_post_deploy_utility_evidence_ref_duplicate');
  return Object.freeze(out);
}
function utilityOutcome(value){
  const out=String(value||'').trim().toUpperCase();
  if(!OUTCOMES.has(out))throw new Error('rsi_post_deploy_utility_outcome_invalid');
  return out;
}

export function createRsiPostDeploymentUtilityAdmission({
  post_deployment_learning_admission,
  assessment,
}={}){
  const learning=verifyRsiPostDeploymentExperienceAdmission(post_deployment_learning_admission);
  if(!assessment||typeof assessment!=='object'||Array.isArray(assessment))throw new Error('rsi_post_deploy_utility_assessment_invalid');
  if(
    assessment.external_evaluator!==true
    || assessment.authored_by_candidate!==false
    || assessment.candidate_can_rate_self!==false
  )throw new Error('rsi_post_deploy_utility_external_evaluator_required');

  const assessmentId=safeId(assessment.assessment_id,'assessment_id');
  const evaluatorId=safeId(assessment.evaluator_id,'evaluator_id');
  const observedAt=iso(assessment.observed_at,'observed_at');
  const windowStartedAt=iso(assessment.window_started_at,'window_started_at');
  const windowEndedAt=iso(assessment.window_ended_at,'window_ended_at');
  const startMs=Date.parse(windowStartedAt);
  const endMs=Date.parse(windowEndedAt);
  const observedMs=Date.parse(observedAt);
  const learningObservedMs=Date.parse(learning.learning_receipt.observed_at);
  const windowMs=endMs-startMs;
  if(startMs<learningObservedMs)throw new Error('rsi_post_deploy_utility_window_before_learning');
  if(windowMs<MIN_WINDOW_MS||windowMs>MAX_WINDOW_MS)throw new Error('rsi_post_deploy_utility_window_invalid');
  if(observedMs<endMs)throw new Error('rsi_post_deploy_utility_observed_before_window_end');

  const outcome=utilityOutcome(assessment.outcome);
  const evidenceDigest=sha256(assessment.evidence_digest,'evidence');
  const evidenceRefs=refs(assessment.evidence_refs);
  const caseRow=learning.experience_case;
  const targetContextCore={
    source_sha:learning.source_sha,
    candidate_sha:learning.learning_receipt.candidate_sha,
    release_version:learning.learning_receipt.release_version,
    release_tag:learning.learning_receipt.release_tag,
    browser_generation:learning.learning_receipt.browser_generation,
    environment_fingerprint:learning.learning_receipt.environment_fingerprint,
    case_id:caseRow.case_id,
    case_digest:caseRow.case_digest,
    window_started_at:windowStartedAt,
    window_ended_at:windowEndedAt,
    evaluator_id:evaluatorId,
  };
  const targetContextDigest=digest(targetContextCore);
  const receipt=createRsiExperienceUtilityReceipt({
    receipt_id:`rsi_release_utility_${digest({assessment_id:assessmentId,learning_admission_digest:learning.admission_digest}).slice('sha256:'.length,'sha256:'.length+24)}`,
    case_id:caseRow.case_id,
    target_context_digest:targetContextDigest,
    outcome,
    evidence_digest:evidenceDigest,
    evidence_refs:evidenceRefs,
    external_evaluator:true,
    authored_by_candidate:false,
  });
  verifyRsiExperienceUtilityReceipt(receipt);

  const core=zeroAuthority({
    schema:RSI_POST_DEPLOYMENT_UTILITY_ADMISSION_SCHEMA,
    version:1,
    source_sha:sha(learning.source_sha,'source'),
    candidate_sha:sha(learning.learning_receipt.candidate_sha,'candidate'),
    post_deployment_learning_admission_digest:sha256(learning.admission_digest,'learning_admission'),
    release_authority_convergence_digest:sha256(learning.release_authority_convergence_digest,'convergence'),
    case_id:caseRow.case_id,
    case_digest:sha256(caseRow.case_digest,'case'),
    assessment_id:assessmentId,
    evaluator_id:evaluatorId,
    observed_at:observedAt,
    window_started_at:windowStartedAt,
    window_ended_at:windowEndedAt,
    observation_window_ms:windowMs,
    outcome,
    evidence_digest:evidenceDigest,
    evidence_refs:evidenceRefs,
    target_context_digest:targetContextDigest,
    utility_receipt:receipt,
    utility_receipt_digest:receipt.receipt_digest,
    external_evaluator:true,
    authored_by_candidate:false,
    candidate_can_rate_self:false,
    candidate_can_edit_prior_case:false,
    utility_is_contextual_not_global_truth:true,
    harmful_utility_remains_queryable:true,
    utility_can_trigger_rollback:false,
    utility_can_trigger_self_update:false,
    utility_can_trigger_promotion:false,
    utility_can_mutate_candidate_score:false,
    scalar_reward:null,
    global_candidate_score_delta:null,
    graph_append_only:true,
    raw_trajectory_stored:false,
    raw_page_text_stored:false,
    raw_user_input_stored:false,
    secret_material_stored:false,
  });
  const payloadBytes=bytes(core);
  if(payloadBytes>MAX_PAYLOAD_BYTES)throw new Error('rsi_post_deploy_utility_payload_budget_exceeded');
  return Object.freeze({...core,payload_bytes:payloadBytes,max_payload_bytes:MAX_PAYLOAD_BYTES,admission_digest:digest(core)});
}

export function verifyRsiPostDeploymentUtilityAdmission(row){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_POST_DEPLOYMENT_UTILITY_ADMISSION_SCHEMA||row.version!==1)throw new Error('rsi_post_deploy_utility_admission_invalid');
  assertZeroAuthority(row,'admission');
  if(
    row.external_evaluator!==true
    || row.authored_by_candidate!==false
    || row.candidate_can_rate_self!==false
    || row.candidate_can_edit_prior_case!==false
    || row.utility_is_contextual_not_global_truth!==true
    || row.harmful_utility_remains_queryable!==true
    || row.utility_can_trigger_rollback!==false
    || row.utility_can_trigger_self_update!==false
    || row.utility_can_trigger_promotion!==false
    || row.utility_can_mutate_candidate_score!==false
    || row.scalar_reward!==null
    || row.global_candidate_score_delta!==null
    || row.graph_append_only!==true
    || row.raw_trajectory_stored!==false
    || row.raw_page_text_stored!==false
    || row.raw_user_input_stored!==false
    || row.secret_material_stored!==false
  )throw new Error('rsi_post_deploy_utility_policy_invalid');
  sha(row.source_sha,'source');sha(row.candidate_sha,'candidate');
  for(const [value,label] of [
    [row.post_deployment_learning_admission_digest,'learning_admission'],
    [row.release_authority_convergence_digest,'convergence'],
    [row.case_digest,'case'],
    [row.evidence_digest,'evidence'],
    [row.target_context_digest,'target_context'],
    [row.utility_receipt_digest,'utility_receipt'],
  ])sha256(value,label);
  safeId(row.case_id,'case_id');safeId(row.assessment_id,'assessment_id');safeId(row.evaluator_id,'evaluator_id');
  const start=Date.parse(iso(row.window_started_at,'window_started_at'));
  const end=Date.parse(iso(row.window_ended_at,'window_ended_at'));
  const observed=Date.parse(iso(row.observed_at,'observed_at'));
  if(end-start!==Number(row.observation_window_ms)||end-start<MIN_WINDOW_MS||end-start>MAX_WINDOW_MS||observed<end)throw new Error('rsi_post_deploy_utility_window_invalid');
  utilityOutcome(row.outcome);refs(row.evidence_refs);
  const utility=verifyRsiExperienceUtilityReceipt(row.utility_receipt);
  if(
    utility.receipt_digest!==row.utility_receipt_digest
    || utility.case_id!==row.case_id
    || utility.target_context_digest!==row.target_context_digest
    || utility.outcome!==row.outcome
    || utility.evidence_digest!==row.evidence_digest
    || JSON.stringify(utility.evidence_refs)!==JSON.stringify(row.evidence_refs)
  )throw new Error('rsi_post_deploy_utility_receipt_binding_mismatch');
  const core={...structuredClone(row)};delete core.payload_bytes;delete core.max_payload_bytes;delete core.admission_digest;
  const payloadBytes=bytes(core);
  if(payloadBytes!==Number(row.payload_bytes)||payloadBytes>Number(row.max_payload_bytes)||Number(row.max_payload_bytes)!==MAX_PAYLOAD_BYTES)throw new Error('rsi_post_deploy_utility_size_mismatch');
  if(digest(core)!==sha256(row.admission_digest,'admission'))throw new Error('rsi_post_deploy_utility_digest_mismatch');
  return row;
}

export function applyRsiPostDeploymentUtilityAdmission({previous_snapshot,admission}={}){
  const checked=verifyRsiPostDeploymentUtilityAdmission(admission);
  const previous=verifyRsiExperienceGraphSnapshot(previous_snapshot);
  const caseRow=previous.cases.find(row=>row.case_id===checked.case_id)||null;
  if(!caseRow)throw new Error('rsi_post_deploy_utility_case_missing');
  if(caseRow.case_digest!==checked.case_digest||caseRow.candidate_sha!==checked.candidate_sha)throw new Error('rsi_post_deploy_utility_case_binding_mismatch');
  if(previous.utility_receipts.some(row=>row.receipt_id===checked.utility_receipt.receipt_id||row.receipt_digest===checked.utility_receipt_digest)){
    throw new Error('rsi_post_deploy_utility_duplicate');
  }
  return extendRsiExperienceGraphSnapshot({
    previous_snapshot:previous,
    task_anchors:[],
    cases:[],
    similarity_edges:[],
    correction_edges:[],
    utility_receipts:[checked.utility_receipt],
  });
}

export function rsiPostDeploymentUtilityTrustRootSnapshot(){
  const root=zeroAuthority({
    schema:RSI_POST_DEPLOYMENT_UTILITY_ROOT_SCHEMA,
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-post-deployment-utility.mjs',
    persisted_post_deployment_case_required:true,
    delayed_external_observation_required:true,
    minimum_observation_window_ms:MIN_WINDOW_MS,
    maximum_observation_window_ms:MAX_WINDOW_MS,
    outcomes:[...OUTCOMES].sort(),
    external_evaluator_required:true,
    candidate_can_rate_self:false,
    candidate_can_edit_prior_case:false,
    append_only_existing_experience_graph_only:true,
    utility_is_contextual_not_global_truth:true,
    harmful_utility_remains_queryable:true,
    scalar_reward_allowed:false,
    global_candidate_score_delta_allowed:false,
    utility_can_trigger_rollback:false,
    utility_can_trigger_self_update:false,
    utility_can_trigger_promotion:false,
    effect_reexecution_authorized:false,
    raw_trajectory_stored:false,
    raw_page_text_stored:false,
    raw_user_input_stored:false,
    secret_material_stored:false,
    no_second_scheduler:true,
    max_payload_bytes:MAX_PAYLOAD_BYTES,
  });
  return Object.freeze({...root,post_deployment_utility_root_digest:digest(root)});
}
