import crypto from 'node:crypto';

import {
  createRsiExperienceUtilityReceipt,
  verifyRsiExperienceUtilityReceipt,
  verifyRsiExperienceGraphSnapshot,
  extendRsiExperienceGraphSnapshot,
} from './rsi-experience-graph.mjs';
import { verifyRsiExperienceContextPlan } from './rsi-experience-context-planner.mjs';
import { verifyRsiExternalEvaluationBundle } from './rsi-external-evaluation-evidence-adapter.mjs';

export const RSI_RETRIEVAL_INFLUENCE_ADMISSION_SCHEMA='metaengine.rsi.retrieval-influence-admission.v1';
export const RSI_RETRIEVAL_INFLUENCE_ROOT_SCHEMA='metaengine.rsi.retrieval-influence-root.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE=/^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const METHODS=new Set(['LEAVE_ONE_OUT','PAIRED_ABLATION']);
const OUTCOMES=new Set(['HELPFUL','HARMFUL','NEUTRAL']);
const MAX_ROWS=8;
const MAX_REFS=16;
const MAX_PAYLOAD_BYTES=48*1024;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
}
function digest(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}
function bytes(value){return Buffer.byteLength(JSON.stringify(stable(value)),'utf8')}
function zeroAuthority(extra={}){
  return Object.freeze({
    ...extra,
    execution_authority:false,
    browser_authority:false,
    scheduler_authority:false,
    task_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    release_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  });
}
function assertZeroAuthority(value,label){
  for(const key of [
    'execution_authority','browser_authority','scheduler_authority','task_authority',
    'production_mutation_authority','promotion_authority','release_authority',
    'self_update_authority','authority_effect',
  ]){
    if(Object.hasOwn(value||{},key)&&value[key]!==false)throw new Error(`rsi_retrieval_influence_${label}_${key}_invalid`);
  }
  if(Object.hasOwn(value||{},'automatic_retry_allowed')&&value.automatic_retry_allowed!==false){
    throw new Error(`rsi_retrieval_influence_${label}_retry_invalid`);
  }
}
function sha(value,label){
  const out=String(value||'').trim().toLowerCase();
  if(!SHA40_RE.test(out))throw new Error(`rsi_retrieval_influence_${label}_sha_invalid`);
  return out;
}
function sha256(value,label){
  const out=String(value||'').trim().toLowerCase();
  if(!SHA256_RE.test(out))throw new Error(`rsi_retrieval_influence_${label}_digest_invalid`);
  return out;
}
function safeId(value,label){
  const out=String(value||'').trim();
  if(!SAFE_ID_RE.test(out))throw new Error(`rsi_retrieval_influence_${label}_invalid`);
  return out;
}
function token(value,label){
  const out=String(value||'').trim().toUpperCase();
  if(!SAFE_TOKEN_RE.test(out))throw new Error(`rsi_retrieval_influence_${label}_invalid`);
  return out;
}
function refs(value){
  if(!Array.isArray(value)||value.length<1||value.length>MAX_REFS)throw new Error('rsi_retrieval_influence_evidence_refs_invalid');
  const out=value.map(v=>safeId(v,'evidence_ref')).sort();
  if(new Set(out).size!==out.length)throw new Error('rsi_retrieval_influence_evidence_ref_duplicate');
  return Object.freeze(out);
}
function outcome(value){
  const out=token(value,'outcome');
  if(!OUTCOMES.has(out))throw new Error('rsi_retrieval_influence_outcome_invalid');
  return out;
}
function method(value){
  const out=token(value,'method');
  if(!METHODS.has(out))throw new Error('rsi_retrieval_influence_method_invalid');
  return out;
}

function selectedCaseMap(plan,graph){
  const currentById=new Map(graph.cases.map(row=>[row.case_id,row]));
  const map=new Map();
  for(const selected of plan.selected_cases){
    const current=currentById.get(selected.case_id);
    if(!current||current.case_digest!==selected.case_digest)throw new Error('rsi_retrieval_influence_selected_case_graph_drift');
    map.set(selected.case_id,Object.freeze({
      case_id:selected.case_id,
      case_digest:selected.case_digest,
      candidate_id:selected.candidate_id,
      candidate_sha:selected.candidate_sha,
    }));
  }
  return map;
}

function normalizeAssessmentRows(rows,selected,assessmentId,bundleDigest,targetContextDigest){
  if(!Array.isArray(rows)||rows.length<1||rows.length>MAX_ROWS)throw new Error('rsi_retrieval_influence_rows_invalid');
  const seen=new Set();
  return Object.freeze(rows.map((row,index)=>{
    if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('rsi_retrieval_influence_row_invalid');
    const caseId=safeId(row.case_id,'case_id');
    if(seen.has(caseId))throw new Error('rsi_retrieval_influence_case_duplicate');
    seen.add(caseId);
    const selectedCase=selected.get(caseId);
    if(!selectedCase)throw new Error('rsi_retrieval_influence_case_not_selected');
    if(
      row.external_evaluator!==true
      || row.authored_by_candidate!==false
      || row.candidate_can_rate_memory!==false
      || row.counterfactual_baseline_verified!==true
      || row.treatment_verified!==true
    )throw new Error('rsi_retrieval_influence_external_counterfactual_required');
    const normalizedMethod=method(row.attribution_method);
    const normalizedOutcome=outcome(row.outcome);
    const evidenceDigest=sha256(row.evidence_digest,'row_evidence');
    const evidenceRefs=refs(row.evidence_refs);
    const baselineDigest=sha256(row.baseline_without_case_digest,'baseline_without_case');
    const treatmentDigest=sha256(row.treatment_with_case_digest,'treatment_with_case');
    if(baselineDigest===treatmentDigest)throw new Error('rsi_retrieval_influence_counterfactual_distinct_runs_required');
    const receipt=createRsiExperienceUtilityReceipt({
      receipt_id:`rsi_memory_influence_${digest({assessment_id:assessmentId,case_id:caseId,bundle_digest:bundleDigest,index}).slice(7,31)}`,
      case_id:caseId,
      target_context_digest:targetContextDigest,
      outcome:normalizedOutcome,
      evidence_digest:evidenceDigest,
      evidence_refs:evidenceRefs,
      external_evaluator:true,
      authored_by_candidate:false,
    });
    verifyRsiExperienceUtilityReceipt(receipt);
    return Object.freeze({
      case_id:caseId,
      case_digest:selectedCase.case_digest,
      candidate_id:selectedCase.candidate_id,
      candidate_sha:selectedCase.candidate_sha,
      attribution_method:normalizedMethod,
      outcome:normalizedOutcome,
      baseline_without_case_digest:baselineDigest,
      treatment_with_case_digest:treatmentDigest,
      evidence_digest:evidenceDigest,
      evidence_refs:evidenceRefs,
      external_evaluator:true,
      authored_by_candidate:false,
      candidate_can_rate_memory:false,
      counterfactual_baseline_verified:true,
      treatment_verified:true,
      utility_receipt:receipt,
      utility_receipt_digest:receipt.receipt_digest,
    });
  }).sort((a,b)=>a.case_id.localeCompare(b.case_id)));
}

export function createRsiRetrievalInfluenceAdmission({
  episode_id,
  context_plan,
  external_evaluation_bundle,
  experience_graph_snapshot,
  assessment,
}={}){
  const episodeId=safeId(episode_id,'episode_id');
  const plan=verifyRsiExperienceContextPlan(context_plan);
  const bundle=verifyRsiExternalEvaluationBundle(external_evaluation_bundle);
  const graph=verifyRsiExperienceGraphSnapshot(experience_graph_snapshot);
  if(bundle.episode_id!==episodeId)throw new Error('rsi_retrieval_influence_episode_bundle_mismatch');
  if(bundle.any_class_ambiguous!==false)throw new Error('rsi_retrieval_influence_ambiguous_evaluation_forbidden');
  if(plan.graph_snapshot_digest==null||plan.selected_case_count<1)throw new Error('rsi_retrieval_influence_selected_experience_required');
  if(!assessment||typeof assessment!=='object'||Array.isArray(assessment))throw new Error('rsi_retrieval_influence_assessment_invalid');
  if(
    assessment.external_evaluator!==true
    || assessment.authored_by_candidate!==false
    || assessment.candidate_can_rate_memory!==false
    || assessment.trajectory_level_reward_assigned!==false
    || assessment.co_retrieved_memories_share_reward!==false
  )throw new Error('rsi_retrieval_influence_external_assessment_required');
  const assessmentId=safeId(assessment.assessment_id,'assessment_id');
  const evaluatorId=safeId(assessment.evaluator_id,'evaluator_id');
  const selected=selectedCaseMap(plan,graph);
  const rows=normalizeAssessmentRows(
    assessment.rows,
    selected,
    assessmentId,
    bundle.bundle_digest,
    plan.target_context_digest,
  );
  const receiptIds=new Set(rows.map(row=>row.utility_receipt.receipt_id));
  if(receiptIds.size!==rows.length)throw new Error('rsi_retrieval_influence_receipt_duplicate');
  const assessedIds=new Set(rows.map(row=>row.case_id));
  const unassessed=plan.selected_cases
    .filter(row=>!assessedIds.has(row.case_id))
    .map(row=>row.case_id)
    .sort();
  const core=zeroAuthority({
    schema:RSI_RETRIEVAL_INFLUENCE_ADMISSION_SCHEMA,
    version:1,
    episode_id:episodeId,
    assessment_id:assessmentId,
    evaluator_id:evaluatorId,
    context_plan_digest:sha256(plan.context_plan_digest,'context_plan'),
    search_context_digest:sha256(`sha256:${plan.search_context_digest}`,'search_context'),
    source_graph_snapshot_digest:sha256(plan.graph_snapshot_digest,'source_graph_snapshot'),
    current_graph_snapshot_digest:sha256(graph.snapshot_digest,'current_graph_snapshot'),
    external_evaluation_bundle_digest:sha256(bundle.bundle_digest,'evaluation_bundle'),
    evaluated_candidate_id:safeId(bundle.candidate_id,'evaluated_candidate_id'),
    evaluated_candidate_sha:sha(bundle.candidate_sha,'evaluated_candidate'),
    target_context_digest:sha256(plan.target_context_digest,'target_context'),
    selected_case_count:plan.selected_case_count,
    assessed_case_count:rows.length,
    unassessed_case_ids:Object.freeze(unassessed),
    assessment_rows:rows,
    utility_receipts:Object.freeze(rows.map(row=>row.utility_receipt)),
    utility_receipt_digests:Object.freeze(rows.map(row=>row.utility_receipt_digest).sort()),
    external_evaluator:true,
    authored_by_candidate:false,
    candidate_can_rate_memory:false,
    counterfactual_or_ablation_required:true,
    allowed_attribution_methods:Object.freeze([...METHODS].sort()),
    per_case_utility_only:true,
    trajectory_level_reward_assigned:false,
    co_retrieved_memories_share_reward:false,
    unassessed_cases_receive_no_utility:true,
    utility_is_contextual_not_global_truth:true,
    candidate_score_mutated:false,
    scalar_reward:null,
    graph_append_only:true,
    raw_trajectory_stored:false,
    raw_page_text_stored:false,
    raw_user_input_stored:false,
    secret_material_stored:false,
  });
  const payloadBytes=bytes(core);
  if(payloadBytes>MAX_PAYLOAD_BYTES)throw new Error('rsi_retrieval_influence_payload_budget_exceeded');
  return Object.freeze({...core,payload_bytes:payloadBytes,max_payload_bytes:MAX_PAYLOAD_BYTES,admission_digest:digest(core)});
}

export function verifyRsiRetrievalInfluenceAdmission(row,{
  context_plan=null,
  external_evaluation_bundle=null,
  experience_graph_snapshot=null,
}={}){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_RETRIEVAL_INFLUENCE_ADMISSION_SCHEMA||row.version!==1){
    throw new Error('rsi_retrieval_influence_admission_invalid');
  }
  assertZeroAuthority(row,'admission');
  if(
    row.external_evaluator!==true
    || row.authored_by_candidate!==false
    || row.candidate_can_rate_memory!==false
    || row.counterfactual_or_ablation_required!==true
    || row.per_case_utility_only!==true
    || row.trajectory_level_reward_assigned!==false
    || row.co_retrieved_memories_share_reward!==false
    || row.unassessed_cases_receive_no_utility!==true
    || row.utility_is_contextual_not_global_truth!==true
    || row.candidate_score_mutated!==false
    || row.scalar_reward!==null
    || row.graph_append_only!==true
    || row.raw_trajectory_stored!==false
    || row.raw_page_text_stored!==false
    || row.raw_user_input_stored!==false
    || row.secret_material_stored!==false
  )throw new Error('rsi_retrieval_influence_policy_invalid');
  safeId(row.episode_id,'episode_id');
  safeId(row.assessment_id,'assessment_id');
  safeId(row.evaluator_id,'evaluator_id');
  safeId(row.evaluated_candidate_id,'evaluated_candidate_id');
  sha(row.evaluated_candidate_sha,'evaluated_candidate');
  for(const [value,label] of [
    [row.context_plan_digest,'context_plan'],
    [row.search_context_digest,'search_context'],
    [row.source_graph_snapshot_digest,'source_graph_snapshot'],
    [row.current_graph_snapshot_digest,'current_graph_snapshot'],
    [row.external_evaluation_bundle_digest,'evaluation_bundle'],
    [row.target_context_digest,'target_context'],
  ])sha256(value,label);
  if(!Array.isArray(row.assessment_rows)||row.assessment_rows.length<1||row.assessment_rows.length>MAX_ROWS){
    throw new Error('rsi_retrieval_influence_rows_invalid');
  }
  if(row.assessed_case_count!==row.assessment_rows.length||row.assessed_case_count>row.selected_case_count){
    throw new Error('rsi_retrieval_influence_case_count_mismatch');
  }
  if(!Array.isArray(row.unassessed_case_ids)||new Set(row.unassessed_case_ids).size!==row.unassessed_case_ids.length){
    throw new Error('rsi_retrieval_influence_unassessed_cases_invalid');
  }
  if(row.assessed_case_count+row.unassessed_case_ids.length!==row.selected_case_count){
    throw new Error('rsi_retrieval_influence_selected_partition_mismatch');
  }
  if(JSON.stringify(row.allowed_attribution_methods)!==JSON.stringify([...METHODS].sort())){
    throw new Error('rsi_retrieval_influence_methods_invalid');
  }
  const rowCaseIds=new Set();
  const receiptDigests=[];
  for(const item of row.assessment_rows){
    const caseId=safeId(item.case_id,'row_case_id');
    if(rowCaseIds.has(caseId))throw new Error('rsi_retrieval_influence_case_duplicate');
    rowCaseIds.add(caseId);
    sha256(item.case_digest,'row_case');
    safeId(item.candidate_id,'row_candidate_id');
    method(item.attribution_method);
    outcome(item.outcome);
    sha256(item.baseline_without_case_digest,'row_baseline');
    sha256(item.treatment_with_case_digest,'row_treatment');
    sha256(item.evidence_digest,'row_evidence');
    refs(item.evidence_refs);
    if(
      item.external_evaluator!==true
      || item.authored_by_candidate!==false
      || item.candidate_can_rate_memory!==false
      || item.counterfactual_baseline_verified!==true
      || item.treatment_verified!==true
    )throw new Error('rsi_retrieval_influence_row_policy_invalid');
    const receipt=verifyRsiExperienceUtilityReceipt(item.utility_receipt);
    if(
      receipt.case_id!==item.case_id
      || receipt.target_context_digest!==row.target_context_digest
      || receipt.outcome!==item.outcome
      || receipt.evidence_digest!==item.evidence_digest
      || receipt.receipt_digest!==item.utility_receipt_digest
    )throw new Error('rsi_retrieval_influence_receipt_binding_mismatch');
    receiptDigests.push(receipt.receipt_digest);
  }
  if(JSON.stringify([...receiptDigests].sort())!==JSON.stringify(row.utility_receipt_digests)){
    throw new Error('rsi_retrieval_influence_receipt_digest_set_mismatch');
  }
  if(
    !Array.isArray(row.utility_receipts)
    || row.utility_receipts.length!==row.assessment_rows.length
    || JSON.stringify(row.utility_receipts.map(r=>r.receipt_digest).sort())!==JSON.stringify(row.utility_receipt_digests)
  )throw new Error('rsi_retrieval_influence_receipt_set_mismatch');
  const core={...structuredClone(row)};
  delete core.payload_bytes;
  delete core.max_payload_bytes;
  delete core.admission_digest;
  const payloadBytes=bytes(core);
  if(payloadBytes!==Number(row.payload_bytes)||payloadBytes>Number(row.max_payload_bytes)||Number(row.max_payload_bytes)!==MAX_PAYLOAD_BYTES){
    throw new Error('rsi_retrieval_influence_size_mismatch');
  }
  if(digest(core)!==sha256(row.admission_digest,'admission'))throw new Error('rsi_retrieval_influence_digest_mismatch');

  if(context_plan!=null||external_evaluation_bundle!=null||experience_graph_snapshot!=null){
    if(context_plan==null||external_evaluation_bundle==null||experience_graph_snapshot==null){
      throw new Error('rsi_retrieval_influence_full_reverification_required');
    }
    const plan=verifyRsiExperienceContextPlan(context_plan);
    const bundle=verifyRsiExternalEvaluationBundle(external_evaluation_bundle);
    const graph=verifyRsiExperienceGraphSnapshot(experience_graph_snapshot);
    if(
      plan.context_plan_digest!==row.context_plan_digest
      || `sha256:${plan.search_context_digest}`!==row.search_context_digest
      || plan.graph_snapshot_digest!==row.source_graph_snapshot_digest
      || graph.snapshot_digest!==row.current_graph_snapshot_digest
      || bundle.bundle_digest!==row.external_evaluation_bundle_digest
      || bundle.episode_id!==row.episode_id
      || bundle.candidate_id!==row.evaluated_candidate_id
      || bundle.candidate_sha!==row.evaluated_candidate_sha
      || plan.target_context_digest!==row.target_context_digest
      || bundle.any_class_ambiguous!==false
    )throw new Error('rsi_retrieval_influence_lineage_mismatch');
    const selected=selectedCaseMap(plan,graph);
    for(const item of row.assessment_rows){
      const selectedCase=selected.get(item.case_id);
      if(!selectedCase||selectedCase.case_digest!==item.case_digest)throw new Error('rsi_retrieval_influence_case_lineage_mismatch');
    }
  }
  return row;
}

export function applyRsiRetrievalInfluenceAdmission({previous_snapshot,admission}={}){
  const checked=verifyRsiRetrievalInfluenceAdmission(admission);
  const previous=verifyRsiExperienceGraphSnapshot(previous_snapshot);
  if(previous.snapshot_digest!==checked.current_graph_snapshot_digest){
    throw new Error('rsi_retrieval_influence_graph_advanced_requires_reassessment');
  }
  const caseById=new Map(previous.cases.map(row=>[row.case_id,row]));
  for(const item of checked.assessment_rows){
    const current=caseById.get(item.case_id);
    if(!current||current.case_digest!==item.case_digest)throw new Error('rsi_retrieval_influence_case_graph_drift');
  }
  const existingReceiptIds=new Set(previous.utility_receipts.map(row=>row.receipt_id));
  for(const receipt of checked.utility_receipts){
    if(existingReceiptIds.has(receipt.receipt_id))throw new Error('rsi_retrieval_influence_receipt_already_applied');
  }
  return extendRsiExperienceGraphSnapshot({
    previous_snapshot:previous,
    task_anchors:[],
    cases:[],
    similarity_edges:[],
    correction_edges:[],
    utility_receipts:checked.utility_receipts,
  });
}

export function rsiRetrievalInfluenceTrustRootSnapshot(){
  const root=zeroAuthority({
    schema:RSI_RETRIEVAL_INFLUENCE_ROOT_SCHEMA,
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-retrieval-influence-evidence.mjs',
    persisted_context_plan_required:true,
    exact_selected_case_binding_required:true,
    external_evaluation_bundle_required:true,
    ambiguous_evaluation_allowed:false,
    allowed_attribution_methods:Object.freeze([...METHODS].sort()),
    counterfactual_or_ablation_required:true,
    max_assessment_rows:MAX_ROWS,
    per_case_utility_only:true,
    trajectory_level_reward_assignment:false,
    co_retrieved_memories_share_reward:false,
    unassessed_cases_receive_no_utility:true,
    candidate_can_rate_memory:false,
    utility_is_contextual_not_global_truth:true,
    candidate_score_mutation_allowed:false,
    scalar_reward_allowed:false,
    graph_append_only:true,
    graph_advance_requires_reassessment:true,
    raw_trajectory_stored:false,
    raw_page_text_stored:false,
    raw_user_input_stored:false,
    secret_material_stored:false,
    no_second_scheduler:true,
    max_payload_bytes:MAX_PAYLOAD_BYTES,
  });
  return Object.freeze({...root,retrieval_influence_root_digest:digest(root)});
}
