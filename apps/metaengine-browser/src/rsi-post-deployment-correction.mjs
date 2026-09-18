import crypto from 'node:crypto';

import {
  createRsiExperienceCase,
  createRsiExperienceGraphSnapshot,
  extendRsiExperienceGraphSnapshot,
  verifyRsiExperienceGraphSnapshot,
} from './rsi-experience-graph.mjs';
import { verifyRsiPostDeploymentExperienceAdmission } from './rsi-post-deployment-learning.mjs';
import { verifyRsiPostDeploymentUtilityAdmission } from './rsi-post-deployment-utility.mjs';

export const RSI_POST_DEPLOYMENT_CORRECTION_ADMISSION_SCHEMA='metaengine.rsi.post-deployment-correction-admission.v1';
export const RSI_POST_DEPLOYMENT_CORRECTION_ROOT_SCHEMA='metaengine.rsi.post-deployment-correction-root.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
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
    if(Object.hasOwn(value||{},key)&&value[key]!==false)throw new Error(`rsi_post_deploy_correction_${label}_${key}_invalid`);
  }
  if(Object.hasOwn(value||{},'automatic_retry_allowed')&&value.automatic_retry_allowed!==false)throw new Error(`rsi_post_deploy_correction_${label}_retry_invalid`);
}
function sha(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA40_RE.test(out))throw new Error(`rsi_post_deploy_correction_${label}_sha_invalid`);return out}
function sha256(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA256_RE.test(out))throw new Error(`rsi_post_deploy_correction_${label}_digest_invalid`);return out}
function safeId(value,label){const out=String(value||'').trim();if(!SAFE_ID_RE.test(out))throw new Error(`rsi_post_deploy_correction_${label}_invalid`);return out}
function isoMs(value,label){const parsed=Date.parse(String(value||''));if(!Number.isFinite(parsed))throw new Error(`rsi_post_deploy_correction_${label}_time_invalid`);return parsed}
function uniqueRefs(...rows){
  const out=[...new Set(rows.flat().map(v=>safeId(v,'evidence_ref')))].sort();
  if(out.length<1||out.length>32)throw new Error('rsi_post_deploy_correction_evidence_refs_invalid');
  return Object.freeze(out);
}

export function createRsiPostDeploymentCorrectionAdmission({
  post_deployment_learning_admission,
  harmful_utility_admission,
  helpful_utility_admission,
}={}){
  const learning=verifyRsiPostDeploymentExperienceAdmission(post_deployment_learning_admission);
  const harmful=verifyRsiPostDeploymentUtilityAdmission(harmful_utility_admission);
  const helpful=verifyRsiPostDeploymentUtilityAdmission(helpful_utility_admission);
  if(harmful.outcome!=='HARMFUL')throw new Error('rsi_post_deploy_correction_harmful_utility_required');
  if(helpful.outcome!=='HELPFUL')throw new Error('rsi_post_deploy_correction_helpful_utility_required');
  if(
    harmful.post_deployment_learning_admission_digest!==learning.admission_digest
    || helpful.post_deployment_learning_admission_digest!==learning.admission_digest
    || harmful.case_id!==learning.experience_case.case_id
    || helpful.case_id!==learning.experience_case.case_id
    || harmful.case_digest!==learning.experience_case.case_digest
    || helpful.case_digest!==learning.experience_case.case_digest
    || harmful.candidate_sha!==learning.learning_receipt.candidate_sha
    || helpful.candidate_sha!==learning.learning_receipt.candidate_sha
  )throw new Error('rsi_post_deploy_correction_learning_binding_mismatch');
  if(
    isoMs(helpful.window_started_at,'helpful_window_start')<isoMs(harmful.window_ended_at,'harmful_window_end')
    || isoMs(helpful.observed_at,'helpful_observed')<=isoMs(harmful.observed_at,'harmful_observed')
  )throw new Error('rsi_post_deploy_correction_temporal_order_invalid');

  const candidateSha=sha(learning.learning_receipt.candidate_sha,'candidate');
  const pairDigest=digest({
    learning_admission_digest:learning.admission_digest,
    harmful_utility_admission_digest:harmful.admission_digest,
    helpful_utility_admission_digest:helpful.admission_digest,
    candidate_sha:candidateSha,
  });
  const taskId=`release-correction:${candidateSha.slice(0,16)}:${pairDigest.slice(7,19)}`;
  const taskSignatureDigest=digest({
    schema:'metaengine.rsi.post-deployment-correction-task.v1',
    candidate_sha:candidateSha,
    post_deployment_learning_admission_digest:learning.admission_digest,
    harmful_context_digest:harmful.target_context_digest,
    helpful_context_digest:helpful.target_context_digest,
  });
  const taskAnchor=Object.freeze({
    task_id:taskId,
    task_signature_digest:taskSignatureDigest,
    challenge_family:'POST_DEPLOYMENT_CORRECTION',
    hidden_manifest_digest:digest({
      convergence_digest:learning.release_authority_convergence_digest,
      harmful_utility_receipt_digest:harmful.utility_receipt_digest,
      helpful_utility_receipt_digest:helpful.utility_receipt_digest,
    }),
    external_writer:true,
    authored_by_candidate:false,
  });
  const sharedRefs=uniqueRefs(harmful.evidence_refs,helpful.evidence_refs);
  const failureCase=createRsiExperienceCase({
    case_id:`rsi_release_regression_${pairDigest.slice(7,31)}`,
    task_id:taskId,
    task_signature_digest:taskSignatureDigest,
    attempt_index:1,
    candidate_id:learning.learning_receipt.candidate_id,
    candidate_sha:candidateSha,
    outcome:'FAILURE',
    environment_fingerprint:learning.learning_receipt.environment_fingerprint,
    model_family:'DEPLOYED_RSI',
    execution_signature_digest:harmful.utility_receipt_digest,
    failure_codes:['POST_DEPLOYMENT_REGRESSION'],
    mechanism_tags:['DELAYED_UTILITY','POST_DEPLOYMENT','REGRESSION'],
    lesson_digests:learning.learning_receipt.lesson_digests,
    attribution_digests:[harmful.admission_digest,learning.admission_digest].sort(),
    transfer_receipt_digests:[],
    evidence_digest:harmful.admission_digest,
    evidence_refs:harmful.evidence_refs,
    external_writer:true,
    authored_by_candidate:false,
  });
  const successCase=createRsiExperienceCase({
    case_id:`rsi_release_recovery_${pairDigest.slice(7,31)}`,
    task_id:taskId,
    task_signature_digest:taskSignatureDigest,
    attempt_index:2,
    candidate_id:learning.learning_receipt.candidate_id,
    candidate_sha:candidateSha,
    outcome:'SUCCESS',
    environment_fingerprint:learning.learning_receipt.environment_fingerprint,
    model_family:'DEPLOYED_RSI',
    execution_signature_digest:helpful.utility_receipt_digest,
    failure_codes:[],
    mechanism_tags:['DELAYED_UTILITY','POST_DEPLOYMENT','RECOVERY'],
    lesson_digests:learning.learning_receipt.lesson_digests,
    attribution_digests:[helpful.admission_digest,learning.admission_digest].sort(),
    transfer_receipt_digests:[],
    evidence_digest:helpful.admission_digest,
    evidence_refs:helpful.evidence_refs,
    external_writer:true,
    authored_by_candidate:false,
  });
  const correctionEdge=Object.freeze({
    from_case_id:failureCase.case_id,
    to_case_id:successCase.case_id,
    evidence_digest:digest({
      harmful_utility_admission_digest:harmful.admission_digest,
      helpful_utility_admission_digest:helpful.admission_digest,
      temporal_order_verified:true,
    }),
    external_verifier:true,
    authored_by_candidate:false,
    fixed_by_relation_is_authority:false,
  });

  // Validate the derived trace with the existing Experience Graph contract
  // before it can be admitted into the live append-only graph.
  createRsiExperienceGraphSnapshot({
    graph_id:`rsi.correction.projection.${pairDigest.slice(7,23)}`,
    epoch:1,
    predecessor_snapshot_digest:null,
    task_anchors:[taskAnchor],
    cases:[failureCase,successCase],
    similarity_edges:[],
    correction_edges:[correctionEdge],
    utility_receipts:[],
  });

  const core=zeroAuthority({
    schema:RSI_POST_DEPLOYMENT_CORRECTION_ADMISSION_SCHEMA,
    version:1,
    source_sha:sha(learning.source_sha,'source'),
    candidate_sha:candidateSha,
    post_deployment_learning_admission_digest:sha256(learning.admission_digest,'learning_admission'),
    harmful_utility_admission_digest:sha256(harmful.admission_digest,'harmful_utility'),
    helpful_utility_admission_digest:sha256(helpful.admission_digest,'helpful_utility'),
    harmful_utility_receipt_digest:sha256(harmful.utility_receipt_digest,'harmful_receipt'),
    helpful_utility_receipt_digest:sha256(helpful.utility_receipt_digest,'helpful_receipt'),
    pair_digest:pairDigest,
    task_anchor:taskAnchor,
    failure_case:failureCase,
    success_case:successCase,
    correction_edge:correctionEdge,
    evidence_refs:sharedRefs,
    harmful_then_helpful_temporal_order_verified:true,
    original_deployment_case_preserved:true,
    derived_trace_only:true,
    correction_edge_is_retrieval_signal_only:true,
    correction_edge_is_authority:false,
    candidate_can_edit_trace:false,
    candidate_can_self_certify_recovery:false,
    rollback_triggered:false,
    self_update_triggered:false,
    promotion_triggered:false,
    candidate_score_mutated:false,
    scalar_reward:null,
    raw_trajectory_stored:false,
    raw_page_text_stored:false,
    raw_user_input_stored:false,
    secret_material_stored:false,
  });
  const payloadBytes=bytes(core);
  if(payloadBytes>MAX_PAYLOAD_BYTES)throw new Error('rsi_post_deploy_correction_payload_budget_exceeded');
  return Object.freeze({...core,payload_bytes:payloadBytes,max_payload_bytes:MAX_PAYLOAD_BYTES,admission_digest:digest(core)});
}

export function verifyRsiPostDeploymentCorrectionAdmission(row){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_POST_DEPLOYMENT_CORRECTION_ADMISSION_SCHEMA||row.version!==1)throw new Error('rsi_post_deploy_correction_admission_invalid');
  assertZeroAuthority(row,'admission');
  if(
    row.harmful_then_helpful_temporal_order_verified!==true
    || row.original_deployment_case_preserved!==true
    || row.derived_trace_only!==true
    || row.correction_edge_is_retrieval_signal_only!==true
    || row.correction_edge_is_authority!==false
    || row.candidate_can_edit_trace!==false
    || row.candidate_can_self_certify_recovery!==false
    || row.rollback_triggered!==false
    || row.self_update_triggered!==false
    || row.promotion_triggered!==false
    || row.candidate_score_mutated!==false
    || row.scalar_reward!==null
    || row.raw_trajectory_stored!==false
    || row.raw_page_text_stored!==false
    || row.raw_user_input_stored!==false
    || row.secret_material_stored!==false
  )throw new Error('rsi_post_deploy_correction_policy_invalid');
  sha(row.source_sha,'source');sha(row.candidate_sha,'candidate');
  for(const [value,label] of [
    [row.post_deployment_learning_admission_digest,'learning_admission'],
    [row.harmful_utility_admission_digest,'harmful_utility'],
    [row.helpful_utility_admission_digest,'helpful_utility'],
    [row.harmful_utility_receipt_digest,'harmful_receipt'],
    [row.helpful_utility_receipt_digest,'helpful_receipt'],
    [row.pair_digest,'pair'],
  ])sha256(value,label);
  uniqueRefs(row.evidence_refs);
  const projection=createRsiExperienceGraphSnapshot({
    graph_id:`rsi.correction.verify.${row.pair_digest.slice(7,23)}`,
    epoch:1,
    predecessor_snapshot_digest:null,
    task_anchors:[row.task_anchor],
    cases:[row.failure_case,row.success_case],
    similarity_edges:[],
    correction_edges:[row.correction_edge],
    utility_receipts:[],
  });
  if(
    row.failure_case.candidate_sha!==row.candidate_sha
    || row.success_case.candidate_sha!==row.candidate_sha
    || row.failure_case.outcome!=='FAILURE'
    || row.success_case.outcome!=='SUCCESS'
    || row.failure_case.task_id!==row.task_anchor.task_id
    || row.success_case.task_id!==row.task_anchor.task_id
    || row.failure_case.task_signature_digest!==row.task_anchor.task_signature_digest
    || row.success_case.task_signature_digest!==row.task_anchor.task_signature_digest
    || row.correction_edge.from_case_id!==row.failure_case.case_id
    || row.correction_edge.to_case_id!==row.success_case.case_id
    || projection.correction_edge_count!==1
  )throw new Error('rsi_post_deploy_correction_projection_binding_mismatch');
  const core={...structuredClone(row)};delete core.payload_bytes;delete core.max_payload_bytes;delete core.admission_digest;
  const payloadBytes=bytes(core);
  if(payloadBytes!==Number(row.payload_bytes)||payloadBytes>Number(row.max_payload_bytes)||Number(row.max_payload_bytes)!==MAX_PAYLOAD_BYTES)throw new Error('rsi_post_deploy_correction_size_mismatch');
  if(digest(core)!==sha256(row.admission_digest,'admission'))throw new Error('rsi_post_deploy_correction_digest_mismatch');
  return row;
}

export function applyRsiPostDeploymentCorrectionAdmission({previous_snapshot,admission}={}){
  const checked=verifyRsiPostDeploymentCorrectionAdmission(admission);
  const previous=verifyRsiExperienceGraphSnapshot(previous_snapshot);
  const originalCase=previous.cases.find(row=>row.case_digest===checked.post_deployment_learning_admission_digest)||null;
  // The Phase17 case digest is not the admission digest; use the persisted
  // utility receipts as the exact proof that both temporal observations belong
  // to an existing case in this graph.
  const harmfulReceipt=previous.utility_receipts.find(row=>row.receipt_digest===checked.harmful_utility_receipt_digest)||null;
  const helpfulReceipt=previous.utility_receipts.find(row=>row.receipt_digest===checked.helpful_utility_receipt_digest)||null;
  if(!harmfulReceipt||!helpfulReceipt)throw new Error('rsi_post_deploy_correction_utility_receipts_not_in_graph');
  if(harmfulReceipt.case_id!==helpfulReceipt.case_id)throw new Error('rsi_post_deploy_correction_utility_case_mismatch');
  if(previous.cases.some(row=>row.case_id===checked.failure_case.case_id||row.case_id===checked.success_case.case_id)){
    throw new Error('rsi_post_deploy_correction_trace_duplicate');
  }
  if(previous.task_anchors.some(row=>row.task_id===checked.task_anchor.task_id)){
    throw new Error('rsi_post_deploy_correction_task_duplicate');
  }
  return extendRsiExperienceGraphSnapshot({
    previous_snapshot:previous,
    task_anchors:[checked.task_anchor],
    cases:[checked.failure_case,checked.success_case],
    similarity_edges:[],
    correction_edges:[checked.correction_edge],
    utility_receipts:[],
  });
}

export function rsiPostDeploymentCorrectionTrustRootSnapshot(){
  const root=zeroAuthority({
    schema:RSI_POST_DEPLOYMENT_CORRECTION_ROOT_SCHEMA,
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-post-deployment-correction.mjs',
    persisted_post_deployment_learning_required:true,
    persisted_harmful_utility_required:true,
    later_persisted_helpful_utility_required:true,
    temporal_order_required:true,
    original_deployment_case_preserved:true,
    derived_failure_success_trace_only:true,
    correction_edge_is_retrieval_signal_only:true,
    correction_edge_is_authority:false,
    candidate_can_edit_trace:false,
    candidate_can_self_certify_recovery:false,
    scalar_reward_allowed:false,
    candidate_score_mutation_allowed:false,
    autonomous_rollback_allowed:false,
    autonomous_self_update_allowed:false,
    autonomous_promotion_allowed:false,
    raw_trajectory_stored:false,
    raw_page_text_stored:false,
    raw_user_input_stored:false,
    secret_material_stored:false,
    no_second_scheduler:true,
    max_payload_bytes:MAX_PAYLOAD_BYTES,
  });
  return Object.freeze({...root,post_deployment_correction_root_digest:digest(root)});
}
