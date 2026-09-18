import crypto from 'node:crypto';

import {
  createRsiExperienceCase,
  createRsiExperienceGraphSnapshot,
  extendRsiExperienceGraphSnapshot,
  verifyRsiExperienceCase,
  verifyRsiExperienceGraphSnapshot,
} from './rsi-experience-graph.mjs';
import { verifyRsiReleaseAuthorityConvergence } from './rsi-release-authority-convergence.mjs';
import { verifyRsiReleaseEffectReconciliation } from './rsi-release-effect-reconciliation.mjs';
import { verifyRsiReleaseAuthorityHandoff } from './rsi-release-authority-handoff.mjs';
import { verifyRsiExternalPromotionReviewResult } from './rsi-external-promotion-review.mjs';

export const RSI_POST_DEPLOYMENT_LEARNING_RECEIPT_SCHEMA='metaengine.rsi.post-deployment-learning-receipt.v1';
export const RSI_POST_DEPLOYMENT_EXPERIENCE_ADMISSION_SCHEMA='metaengine.rsi.post-deployment-experience-admission.v1';
export const RSI_POST_DEPLOYMENT_LEARNING_ROOT_SCHEMA='metaengine.rsi.post-deployment-learning-root.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const CANDIDATE_ID_RE=/^candidate_sha256_[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE=/^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_TAGS=24;
const MAX_REFS=32;
const MAX_PAYLOAD_BYTES=48*1024;

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
    if(Object.hasOwn(value||{},key)&&value[key]!==false)throw new Error(`rsi_post_deploy_${label}_${key}_invalid`);
  }
  if(Object.hasOwn(value||{},'automatic_retry_allowed')&&value.automatic_retry_allowed!==false)throw new Error(`rsi_post_deploy_${label}_retry_invalid`);
}
function sha(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA40_RE.test(out))throw new Error(`rsi_post_deploy_${label}_sha_invalid`);return out}
function sha256(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA256_RE.test(out))throw new Error(`rsi_post_deploy_${label}_digest_invalid`);return out}
function candidateId(value){const out=String(value||'').trim().toLowerCase();if(!CANDIDATE_ID_RE.test(out))throw new Error('rsi_post_deploy_candidate_id_invalid');return out}
function safeId(value,label){const out=String(value||'').trim();if(!SAFE_ID_RE.test(out))throw new Error(`rsi_post_deploy_${label}_invalid`);return out}
function token(value,label){const out=String(value||'').trim().toUpperCase();if(!SAFE_TOKEN_RE.test(out))throw new Error(`rsi_post_deploy_${label}_invalid`);return out}
function iso(value,label){const raw=String(value||'').trim();const parsed=Date.parse(raw);if(!raw||!Number.isFinite(parsed))throw new Error(`rsi_post_deploy_${label}_time_invalid`);return new Date(parsed).toISOString()}
function unit(value,label){const out=Number(value);if(!Number.isFinite(out)||out<0||out>1)throw new Error(`rsi_post_deploy_${label}_invalid`);return Math.round(out*1_000_000)/1_000_000}
function positive(value,label){const out=Number(value);if(!Number.isSafeInteger(out)||out<1||out>1_000_000)throw new Error(`rsi_post_deploy_${label}_invalid`);return out}
function tokens(value,label){
  if(!Array.isArray(value)||value.length>MAX_TAGS)throw new Error(`rsi_post_deploy_${label}_invalid`);
  const out=value.map(v=>token(v,label)).sort();
  if(new Set(out).size!==out.length)throw new Error(`rsi_post_deploy_${label}_duplicate`);
  return Object.freeze(out);
}
function digests(value,label){
  if(!Array.isArray(value)||value.length>MAX_REFS)throw new Error(`rsi_post_deploy_${label}_invalid`);
  const out=value.map(v=>sha256(v,label)).sort();
  if(new Set(out).size!==out.length)throw new Error(`rsi_post_deploy_${label}_duplicate`);
  return Object.freeze(out);
}
function refs(value){
  if(!Array.isArray(value)||value.length<1||value.length>MAX_REFS)throw new Error('rsi_post_deploy_evidence_refs_invalid');
  const out=value.map(v=>safeId(v,'evidence_ref')).sort();
  if(new Set(out).size!==out.length)throw new Error('rsi_post_deploy_evidence_ref_duplicate');
  return Object.freeze(out);
}

export function createRsiPostDeploymentLearningReceipt({
  source_sha,
  release_authority_convergence,
  release_effect_reconciliation,
  release_handoff,
  promotion_review_result,
  promotion_review_request,
  assessment,
}={}){
  const source=sha(source_sha,'source');
  const convergence=verifyRsiReleaseAuthorityConvergence(release_authority_convergence);
  const reconciliation=verifyRsiReleaseEffectReconciliation(release_effect_reconciliation);
  verifyRsiExternalPromotionReviewResult(promotion_review_result,promotion_review_request);
  const handoff=verifyRsiReleaseAuthorityHandoff(release_handoff,promotion_review_result,promotion_review_request);
  if(convergence.candidate_sha!==source)throw new Error('rsi_post_deploy_source_not_converged_candidate');
  if(
    convergence.release_effect_reconciliation_digest!==reconciliation.reconciliation_digest
    || convergence.release_handoff_digest!==handoff.handoff_digest
    || convergence.promotion_review_result_digest!==promotion_review_result.result_digest
    || convergence.candidate_sha!==handoff.candidate_sha
    || convergence.candidate_sha!==reconciliation.candidate_sha
  )throw new Error('rsi_post_deploy_upstream_binding_mismatch');
  if(convergence.state!=='EXTERNAL_RELEASE_AUTHORITY_CONVERGED'||convergence.post_deployment_learning_allowed_from_verified_outcome!==true){
    throw new Error('rsi_post_deploy_convergence_not_learning_eligible');
  }
  if(!assessment||typeof assessment!=='object'||Array.isArray(assessment))throw new Error('rsi_post_deploy_assessment_invalid');
  if(assessment.external_learning_assigner!==true||assessment.authored_by_candidate!==false||assessment.candidate_can_self_reward!==false){
    throw new Error('rsi_post_deploy_external_assigner_required');
  }
  const mechanismTags=[...new Set(['EXTERNAL_AUTHORITY_CONVERGED','PHYSICAL_SUCCESSOR_QUALIFIED','POST_DEPLOYMENT',...tokens(assessment.mechanism_tags||[],'mechanism_tag')])].sort();
  if(mechanismTags.length>MAX_TAGS)throw new Error('rsi_post_deploy_mechanism_tag_budget_exceeded');
  const evidenceRefs=[...new Set([
    safeId(convergence.authority_journal_ref,'authority_journal_ref'),
    ...refs(assessment.evidence_refs),
  ])].sort();
  if(evidenceRefs.length>MAX_REFS)throw new Error('rsi_post_deploy_evidence_refs_invalid');
  const attemptIndex=positive(reconciliation.transaction_readback?.transaction?.attempt_count||1,'attempt_index');
  const core=zeroAuthority({
    schema:RSI_POST_DEPLOYMENT_LEARNING_RECEIPT_SCHEMA,
    version:1,
    source_sha:source,
    assessment_id:safeId(assessment.assessment_id,'assessment_id'),
    observed_at:iso(assessment.observed_at,'observed_at'),
    candidate_id:candidateId(promotion_review_result.candidate_id),
    candidate_sha:convergence.candidate_sha,
    predecessor_sha:convergence.predecessor_sha,
    deployment_outcome:'SUCCESS',
    release_version:convergence.release_version,
    release_tag:convergence.release_tag,
    browser_generation:convergence.browser_generation,
    attempt_index:attemptIndex,
    release_authority_convergence_digest:convergence.convergence_digest,
    release_effect_reconciliation_digest:reconciliation.reconciliation_digest,
    release_handoff_digest:handoff.handoff_digest,
    promotion_review_result_digest:promotion_review_result.result_digest,
    external_authority_readback_digest:convergence.external_authority_readback_digest,
    authority_journal_digest:convergence.authority_journal_digest,
    environment_fingerprint:safeId(assessment.environment_fingerprint,'environment_fingerprint'),
    challenge_family:token(assessment.challenge_family||'POST_DEPLOYMENT_RELEASE','challenge_family'),
    confidence:unit(assessment.confidence,'confidence'),
    mechanism_tags:Object.freeze(mechanismTags),
    lesson_digests:digests(assessment.lesson_digests||[],'lesson'),
    evidence_refs:Object.freeze(evidenceRefs),
    external_learning_assigner:true,
    authored_by_candidate:false,
    candidate_can_self_reward:false,
    candidate_global_score_delta:null,
    reward_scalar:null,
    deployment_success_is_contextual_not_global_truth:true,
    terminal_task_reward_is_step_credit:false,
    raw_trajectory_stored:false,
    raw_page_text_stored:false,
    raw_user_input_stored:false,
    secret_material_stored:false,
    page_model_text_authority:false,
    physical_effect_replay_allowed:false,
  });
  const payloadBytes=bytes(core);
  if(payloadBytes>MAX_PAYLOAD_BYTES)throw new Error('rsi_post_deploy_receipt_budget_exceeded');
  return Object.freeze({...core,payload_bytes:payloadBytes,max_payload_bytes:MAX_PAYLOAD_BYTES,learning_receipt_digest:digest(core)});
}

export function verifyRsiPostDeploymentLearningReceipt(row){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_POST_DEPLOYMENT_LEARNING_RECEIPT_SCHEMA||row.version!==1)throw new Error('rsi_post_deploy_receipt_invalid');
  assertZeroAuthority(row,'receipt');
  if(
    row.deployment_outcome!=='SUCCESS'
    || row.external_learning_assigner!==true
    || row.authored_by_candidate!==false
    || row.candidate_can_self_reward!==false
    || row.candidate_global_score_delta!==null
    || row.reward_scalar!==null
    || row.deployment_success_is_contextual_not_global_truth!==true
    || row.terminal_task_reward_is_step_credit!==false
    || row.raw_trajectory_stored!==false
    || row.raw_page_text_stored!==false
    || row.raw_user_input_stored!==false
    || row.secret_material_stored!==false
    || row.page_model_text_authority!==false
    || row.physical_effect_replay_allowed!==false
  )throw new Error('rsi_post_deploy_receipt_policy_invalid');
  sha(row.source_sha,'source');candidateId(row.candidate_id);sha(row.candidate_sha,'candidate');sha(row.predecessor_sha,'predecessor');
  safeId(row.assessment_id,'assessment_id');iso(row.observed_at,'observed_at');safeId(row.environment_fingerprint,'environment_fingerprint');
  safeId(row.release_version,'release_version');safeId(row.release_tag,'release_tag');
  token(row.challenge_family,'challenge_family');unit(row.confidence,'confidence');positive(row.attempt_index,'attempt_index');
  tokens(row.mechanism_tags,'mechanism_tag');digests(row.lesson_digests,'lesson');refs(row.evidence_refs);
  for(const [value,label] of [
    [row.release_authority_convergence_digest,'convergence'],
    [row.release_effect_reconciliation_digest,'reconciliation'],
    [row.release_handoff_digest,'handoff'],
    [row.promotion_review_result_digest,'promotion_review'],
    [row.external_authority_readback_digest,'authority_readback'],
    [row.authority_journal_digest,'authority_journal'],
  ])sha256(value,label);
  const core={...structuredClone(row)};delete core.payload_bytes;delete core.max_payload_bytes;delete core.learning_receipt_digest;
  const payloadBytes=bytes(core);
  if(payloadBytes!==Number(row.payload_bytes)||payloadBytes>Number(row.max_payload_bytes)||Number(row.max_payload_bytes)!==MAX_PAYLOAD_BYTES)throw new Error('rsi_post_deploy_receipt_size_mismatch');
  if(digest(core)!==sha256(row.learning_receipt_digest,'receipt'))throw new Error('rsi_post_deploy_receipt_digest_mismatch');
  return row;
}

export function createRsiPostDeploymentExperienceAdmission({ learning_receipt, release_handoff }={}){
  const receipt=verifyRsiPostDeploymentLearningReceipt(learning_receipt);
  const manifestDigest=`sha256:${String(release_handoff?.trusted_release?.manifest_sha256||'').toLowerCase()}`;
  sha256(manifestDigest,'manifest');
  const taskId=`release:${receipt.candidate_sha.slice(0,24)}`;
  const taskAnchor=Object.freeze({
    task_id:taskId,
    task_signature_digest:receipt.release_authority_convergence_digest,
    challenge_family:receipt.challenge_family,
    hidden_manifest_digest:manifestDigest,
    external_writer:true,
    authored_by_candidate:false,
  });
  const experienceCase=createRsiExperienceCase({
    case_id:`rsi_release_case_${receipt.learning_receipt_digest.slice('sha256:'.length,'sha256:'.length+24)}`,
    task_id:taskId,
    task_signature_digest:receipt.release_authority_convergence_digest,
    attempt_index:receipt.attempt_index,
    candidate_id:receipt.candidate_id,
    candidate_sha:receipt.candidate_sha,
    outcome:'SUCCESS',
    environment_fingerprint:receipt.environment_fingerprint,
    model_family:'DEPLOYED_RSI',
    execution_signature_digest:receipt.release_effect_reconciliation_digest,
    failure_codes:[],
    mechanism_tags:receipt.mechanism_tags,
    lesson_digests:receipt.lesson_digests,
    attribution_digests:[
      receipt.learning_receipt_digest,
      receipt.release_authority_convergence_digest,
      receipt.promotion_review_result_digest,
    ].sort(),
    transfer_receipt_digests:[],
    evidence_digest:receipt.release_authority_convergence_digest,
    evidence_refs:receipt.evidence_refs,
    external_writer:true,
    authored_by_candidate:false,
  });
  const core=zeroAuthority({
    schema:RSI_POST_DEPLOYMENT_EXPERIENCE_ADMISSION_SCHEMA,
    version:1,
    source_sha:receipt.source_sha,
    release_authority_convergence_digest:receipt.release_authority_convergence_digest,
    learning_receipt:receipt,
    task_anchor:taskAnchor,
    experience_case:experienceCase,
    append_only_graph_admission:true,
    candidate_can_write_graph:false,
    candidate_can_edit_case:false,
    candidate_can_self_reward:false,
    deployment_success_is_contextual_not_global_truth:true,
    direct_candidate_score_mutation:false,
    raw_trajectory_stored:false,
    raw_page_text_stored:false,
    raw_user_input_stored:false,
    secret_material_stored:false,
  });
  return Object.freeze({...core,admission_digest:digest(core)});
}

export function verifyRsiPostDeploymentExperienceAdmission(row){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_POST_DEPLOYMENT_EXPERIENCE_ADMISSION_SCHEMA||row.version!==1)throw new Error('rsi_post_deploy_admission_invalid');
  assertZeroAuthority(row,'admission');
  if(
    row.append_only_graph_admission!==true
    || row.candidate_can_write_graph!==false
    || row.candidate_can_edit_case!==false
    || row.candidate_can_self_reward!==false
    || row.deployment_success_is_contextual_not_global_truth!==true
    || row.direct_candidate_score_mutation!==false
    || row.raw_trajectory_stored!==false
    || row.raw_page_text_stored!==false
    || row.raw_user_input_stored!==false
    || row.secret_material_stored!==false
  )throw new Error('rsi_post_deploy_admission_policy_invalid');
  const receipt=verifyRsiPostDeploymentLearningReceipt(row.learning_receipt);
  const experienceCase=verifyRsiExperienceCase(row.experience_case);
  const expectedTaskId=`release:${receipt.candidate_sha.slice(0,24)}`;
  createRsiExperienceGraphSnapshot({
    graph_id:`rsi.runtime.experience.${receipt.source_sha.slice(0,16)}`,
    epoch:1,
    predecessor_snapshot_digest:null,
    task_anchors:[row.task_anchor],
    cases:[experienceCase],
    similarity_edges:[],
    correction_edges:[],
    utility_receipts:[],
  });
  if(
    receipt.source_sha!==row.source_sha
    || receipt.release_authority_convergence_digest!==row.release_authority_convergence_digest
    || row.task_anchor?.task_id!==expectedTaskId
    || row.task_anchor?.task_signature_digest!==receipt.release_authority_convergence_digest
    || row.task_anchor?.challenge_family!==receipt.challenge_family
    || experienceCase.task_id!==expectedTaskId
    || experienceCase.task_signature_digest!==receipt.release_authority_convergence_digest
    || experienceCase.candidate_id!==receipt.candidate_id
    || experienceCase.candidate_sha!==receipt.candidate_sha
    || experienceCase.evidence_digest!==receipt.release_authority_convergence_digest
    || experienceCase.execution_signature_digest!==receipt.release_effect_reconciliation_digest
  )throw new Error('rsi_post_deploy_admission_binding_mismatch');
  const expected={...row};delete expected.admission_digest;
  if(digest(expected)!==sha256(row.admission_digest,'admission'))throw new Error('rsi_post_deploy_admission_digest_mismatch');
  return row;
}

export function applyRsiPostDeploymentExperienceAdmission({ previous_snapshot=null, admission }={}){
  const checked=verifyRsiPostDeploymentExperienceAdmission(admission);
  const graphId=`rsi.runtime.experience.${checked.source_sha.slice(0,16)}`;
  if(!previous_snapshot){
    return createRsiExperienceGraphSnapshot({
      graph_id:graphId,
      epoch:1,
      predecessor_snapshot_digest:null,
      task_anchors:[checked.task_anchor],
      cases:[checked.experience_case],
      similarity_edges:[],
      correction_edges:[],
      utility_receipts:[],
    });
  }
  const previous=verifyRsiExperienceGraphSnapshot(previous_snapshot);
  if(previous.graph_id!==graphId)throw new Error('rsi_post_deploy_graph_source_mismatch');
  const existingAnchor=previous.task_anchors.find(row=>row.task_id===checked.task_anchor.task_id)||null;
  if(existingAnchor&&(
    existingAnchor.task_signature_digest!==checked.task_anchor.task_signature_digest
    || existingAnchor.challenge_family!==checked.task_anchor.challenge_family
    || existingAnchor.hidden_manifest_digest!==checked.task_anchor.hidden_manifest_digest
  ))throw new Error('rsi_post_deploy_task_anchor_drift');
  return extendRsiExperienceGraphSnapshot({
    previous_snapshot:previous,
    task_anchors:existingAnchor?[]:[checked.task_anchor],
    cases:[checked.experience_case],
    similarity_edges:[],
    correction_edges:[],
    utility_receipts:[],
  });
}

export function rsiPostDeploymentLearningTrustRootSnapshot(){
  const root=zeroAuthority({
    schema:RSI_POST_DEPLOYMENT_LEARNING_ROOT_SCHEMA,
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-post-deployment-learning.mjs',
    exact_external_release_authority_convergence_required:true,
    exact_qualified_successor_required:true,
    running_source_must_equal_converged_candidate:true,
    contextual_deployment_success_only:true,
    external_learning_assigner_required:true,
    candidate_can_self_reward:false,
    candidate_global_score_delta_allowed:false,
    scalar_reward_from_deployment_success_allowed:false,
    append_only_existing_experience_graph_only:true,
    direct_candidate_score_mutation:false,
    raw_trajectory_stored:false,
    raw_page_text_stored:false,
    raw_user_input_stored:false,
    secret_material_stored:false,
    post_deployment_learning_is_release_authority:false,
    effect_reexecution_authorized:false,
    no_second_scheduler:true,
    max_payload_bytes:MAX_PAYLOAD_BYTES,
  });
  return Object.freeze({...root,post_deployment_learning_root_digest:digest(root)});
}
