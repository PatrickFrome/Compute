import crypto from 'node:crypto';

import {
  createRsiExperienceUtilityReceipt,
  verifyRsiExperienceUtilityReceipt,
} from './rsi-experience-graph.mjs';
import {
  verifyRsiExperienceContextPlan,
} from './rsi-experience-context-planner.mjs';
import {
  verifyRsiAutonomousEpisodePlan,
} from './rsi-autonomous-episode-controller.mjs';

export const RSI_EXPERIENCE_CONTEXT_UTILITY_FEEDBACK_SCHEMA =
  'metaengine.rsi.experience-context-utility-feedback.v1';

const SHA256=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const OUTCOMES=new Set(['HELPFUL','HARMFUL','NEUTRAL']);
const MAX_CASES=12;
const MAX_REFS=24;

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map((k)=>[k,stable(v[k])]));
}
function digest(v){
  return 'sha256:'+crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex');
}
function exactDigest(v,l){
  const out=String(v||'').trim().toLowerCase();
  if(!SHA256.test(out))throw new Error('rsi_context_utility_'+l+'_digest_invalid');
  return out;
}
function safeId(v,l){
  const out=String(v||'').trim();
  if(!SAFE_ID.test(out))throw new Error('rsi_context_utility_'+l+'_invalid');
  return out;
}
function evidenceRefs(v){
  if(!Array.isArray(v)||v.length<1||v.length>MAX_REFS){
    throw new Error('rsi_context_utility_evidence_refs_invalid');
  }
  const out=v.map((x)=>safeId(x,'evidence_ref')).sort();
  if(new Set(out).size!==out.length)throw new Error('rsi_context_utility_evidence_ref_duplicate');
  return Object.freeze(out);
}
function zero(extra={}){
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
function assertZero(v,l){
  for(const f of [
    'execution_authority','browser_authority','scheduler_authority','task_authority',
    'production_mutation_authority','promotion_authority','release_authority',
    'self_update_authority','authority_effect',
  ]){
    if(Object.hasOwn(v||{},f)&&v[f]!==false){
      throw new Error('rsi_context_utility_'+l+'_'+f+'_invalid');
    }
  }
  if(Object.hasOwn(v||{},'automatic_retry_allowed')&&v.automatic_retry_allowed!==false){
    throw new Error('rsi_context_utility_'+l+'_automatic_retry_invalid');
  }
}

function normalizedJudgments(judgments,contextPlan,evaluationDigest,evaluatorId){
  if(!Array.isArray(judgments)||judgments.length!==contextPlan.selected_case_count
    ||judgments.length<1||judgments.length>MAX_CASES){
    throw new Error('rsi_context_utility_complete_case_judgments_required');
  }
  const byId=new Map((contextPlan.selected_cases||[]).map((row)=>[row.case_id,row]));
  const seen=new Set();
  const rows=judgments.map((row)=>{
    if(!row||typeof row!=='object'||Array.isArray(row)){
      throw new Error('rsi_context_utility_judgment_invalid');
    }
    const caseId=safeId(row.case_id,'case_id');
    const selected=byId.get(caseId);
    if(!selected)throw new Error('rsi_context_utility_case_not_selected');
    if(seen.has(caseId))throw new Error('rsi_context_utility_case_duplicate');
    seen.add(caseId);
    const outcome=String(row.outcome||'').trim().toUpperCase();
    if(!OUTCOMES.has(outcome))throw new Error('rsi_context_utility_outcome_invalid');
    const caseDigest=exactDigest(row.case_digest,'case');
    if(caseDigest!==exactDigest(selected.case_digest,'selected_case')){
      throw new Error('rsi_context_utility_case_digest_mismatch');
    }
    const evidenceDigest=exactDigest(row.evidence_digest,'case_evidence');
    const refs=evidenceRefs(row.evidence_refs);
    const receiptId='rsi_utility_'+digest({
      context_plan_digest:contextPlan.context_plan_digest,
      case_id:caseId,
      case_digest:caseDigest,
      evaluation_digest:evaluationDigest,
      evaluator_id:evaluatorId,
      outcome,
      evidence_digest:evidenceDigest,
      evidence_refs:refs,
    }).slice(7,31);
    const utility=createRsiExperienceUtilityReceipt({
      receipt_id:receiptId,
      case_id:caseId,
      target_context_digest:contextPlan.target_context_digest,
      outcome,
      evidence_digest:evidenceDigest,
      evidence_refs:refs,
      external_evaluator:true,
      authored_by_candidate:false,
    });
    return Object.freeze({
      case_id:caseId,
      case_digest:caseDigest,
      outcome,
      evidence_digest:evidenceDigest,
      evidence_refs:refs,
      utility_receipt:utility,
      contextual_only:true,
      causal_credit_claimed:false,
      global_portability_claimed:false,
      authority_effect:false,
    });
  }).sort((a,b)=>a.case_id.localeCompare(b.case_id));
  if(seen.size!==byId.size)throw new Error('rsi_context_utility_selected_case_missing');
  return Object.freeze(rows);
}

export function createRsiExperienceContextUtilityFeedback({
  experience_context_plan,
  autonomous_controller_plan,
  evaluation_digest,
  evaluation_kind,
  evaluator_id,
  judgments,
  external_evaluator=false,
  authored_by_candidate=true,
}={}){
  const context=verifyRsiExperienceContextPlan(experience_context_plan);
  const controller=verifyRsiAutonomousEpisodePlan(autonomous_controller_plan);
  if(context.selected_case_count<1||context.mode!=='VERIFIED_EXPERIENCE_RETRIEVAL'){
    throw new Error('rsi_context_utility_verified_retrieval_required');
  }
  if(
    controller.experience_context_digest!==context.context_plan_digest.slice(7)
    ||controller.experience_context_plan?.context_plan_digest!==context.context_plan_digest
    ||controller.observation_digest!==String(context.observation_digest).replace(/^sha256:/,'')
    ||controller.opportunity_id!==context.opportunity_id
    ||controller.mutation_surface!==context.mutation_surface
  ){
    throw new Error('rsi_context_utility_controller_context_mismatch');
  }
  if(external_evaluator!==true||authored_by_candidate!==false){
    throw new Error('rsi_context_utility_external_evaluator_required');
  }
  const evaluationDigest=exactDigest(evaluation_digest,'evaluation');
  const evaluationKind=safeId(evaluation_kind,'evaluation_kind').toUpperCase();
  const evaluatorId=safeId(evaluator_id,'evaluator_id');
  const rows=normalizedJudgments(judgments,context,evaluationDigest,evaluatorId);
  const counts={
    helpful:rows.filter((x)=>x.outcome==='HELPFUL').length,
    harmful:rows.filter((x)=>x.outcome==='HARMFUL').length,
    neutral:rows.filter((x)=>x.outcome==='NEUTRAL').length,
  };
  const core=zero({
    schema:RSI_EXPERIENCE_CONTEXT_UTILITY_FEEDBACK_SCHEMA,
    version:1,
    state:counts.harmful>0?'NEGATIVE_TRANSFER_PRESENT':counts.helpful>0?'CONTEXT_UTILITY_OBSERVED':'NEUTRAL_ONLY',
    context_plan_digest:context.context_plan_digest,
    target_context_digest:context.target_context_digest,
    graph_snapshot_digest:context.graph_snapshot_digest,
    retrieval_digest:context.retrieval_digest,
    controller_plan_digest:controller.controller_plan_digest,
    episode_id:controller.episode_id,
    source_sha:controller.source_sha,
    observation_digest:controller.observation_digest,
    opportunity_id:controller.opportunity_id,
    mutation_surface:controller.mutation_surface,
    evaluation_digest:evaluationDigest,
    evaluation_kind:evaluationKind,
    evaluator_id:evaluatorId,
    judgments:rows,
    utility_receipts:Object.freeze(rows.map((x)=>x.utility_receipt)),
    selected_case_count:context.selected_case_count,
    receipt_count:rows.length,
    helpful_count:counts.helpful,
    harmful_count:counts.harmful,
    neutral_count:counts.neutral,
    complete_selected_case_attribution:true,
    utility_is_contextual_not_global_truth:true,
    causal_credit_claimed:false,
    similarity_is_authority:false,
    candidate_can_label_utility:false,
    candidate_can_edit_utility:false,
    utility_is_scheduler_authority:false,
    utility_is_promotion_authority:false,
    utility_is_execution_authority:false,
    positive_utility_is_skill_evidence:false,
    graph_write_performed:false,
    next_episode_created:false,
    raw_trajectory_present:false,
    raw_page_text_present:false,
    raw_user_input_present:false,
    secret_material_present:false,
  });
  return Object.freeze({...core,feedback_digest:digest(core)});
}

export function verifyRsiExperienceContextUtilityFeedback(row){
  if(!row||typeof row!=='object'||Array.isArray(row)
    ||row.schema!==RSI_EXPERIENCE_CONTEXT_UTILITY_FEEDBACK_SCHEMA||row.version!==1){
    throw new Error('rsi_context_utility_feedback_schema_invalid');
  }
  assertZero(row,'feedback');
  if(!['NEGATIVE_TRANSFER_PRESENT','CONTEXT_UTILITY_OBSERVED','NEUTRAL_ONLY'].includes(row.state)){
    throw new Error('rsi_context_utility_state_invalid');
  }
  if(
    row.complete_selected_case_attribution!==true
    ||row.utility_is_contextual_not_global_truth!==true
    ||row.causal_credit_claimed!==false
    ||row.similarity_is_authority!==false
    ||row.candidate_can_label_utility!==false
    ||row.candidate_can_edit_utility!==false
    ||row.utility_is_scheduler_authority!==false
    ||row.utility_is_promotion_authority!==false
    ||row.utility_is_execution_authority!==false
    ||row.positive_utility_is_skill_evidence!==false
    ||row.graph_write_performed!==false
    ||row.next_episode_created!==false
    ||row.raw_trajectory_present!==false
    ||row.raw_page_text_present!==false
    ||row.raw_user_input_present!==false
    ||row.secret_material_present!==false
  )throw new Error('rsi_context_utility_feedback_policy_invalid');
  for(const f of [
    'context_plan_digest','target_context_digest','graph_snapshot_digest','retrieval_digest',
    'controller_plan_digest','evaluation_digest',
  ]) exactDigest(row[f],f);
  if(!Array.isArray(row.judgments)||!Array.isArray(row.utility_receipts)
    ||row.judgments.length!==row.receipt_count
    ||row.utility_receipts.length!==row.receipt_count
    ||row.receipt_count!==row.selected_case_count
    ||row.receipt_count<1||row.receipt_count>MAX_CASES){
    throw new Error('rsi_context_utility_feedback_count_invalid');
  }
  let helpful=0,harmful=0,neutral=0;
  const receiptIds=new Set();
  for(let i=0;i<row.utility_receipts.length;i+=1){
    const receipt=verifyRsiExperienceUtilityReceipt(row.utility_receipts[i]);
    const judgment=row.judgments.find((x)=>x.case_id===receipt.case_id);
    if(!judgment||judgment.outcome!==receipt.outcome
      ||judgment.evidence_digest!==receipt.evidence_digest
      ||judgment.utility_receipt?.receipt_digest!==receipt.receipt_digest
      ||receipt.target_context_digest!==row.target_context_digest){
      throw new Error('rsi_context_utility_receipt_binding_mismatch');
    }
    if(receiptIds.has(receipt.receipt_id))throw new Error('rsi_context_utility_receipt_duplicate');
    receiptIds.add(receipt.receipt_id);
    if(receipt.outcome==='HELPFUL')helpful+=1;
    else if(receipt.outcome==='HARMFUL')harmful+=1;
    else neutral+=1;
  }
  if(helpful!==row.helpful_count||harmful!==row.harmful_count||neutral!==row.neutral_count){
    throw new Error('rsi_context_utility_outcome_count_mismatch');
  }
  const expectedState=harmful>0?'NEGATIVE_TRANSFER_PRESENT':helpful>0?'CONTEXT_UTILITY_OBSERVED':'NEUTRAL_ONLY';
  if(row.state!==expectedState)throw new Error('rsi_context_utility_state_mismatch');
  const clone=structuredClone(row);
  const claimed=exactDigest(clone.feedback_digest,'feedback');
  delete clone.feedback_digest;
  if(digest(clone)!==claimed)throw new Error('rsi_context_utility_feedback_digest_mismatch');
  return row;
}

export function rsiExperienceContextUtilityFeedbackTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.experience-context-utility-feedback-root.v1',
    version:1,
    adapter_path:'apps/metaengine-browser/src/rsi-experience-context-utility-feedback.mjs',
    experience_graph_path:'apps/metaengine-browser/src/rsi-experience-graph.mjs',
    experience_context_path:'apps/metaengine-browser/src/rsi-experience-context-planner.mjs',
    autonomous_controller_path:'apps/metaengine-browser/src/rsi-autonomous-episode-controller.mjs',
    external_evaluator_required:true,
    complete_selected_case_attribution_required:true,
    exact_target_context_binding_required:true,
    contextual_utility_not_global_truth:true,
    harmful_is_negative_transfer_memory:true,
    positive_utility_is_skill_evidence:false,
    candidate_can_label_utility:false,
    candidate_can_edit_utility:false,
    similarity_is_authority:false,
    utility_is_scheduler_authority:false,
    utility_is_promotion_authority:false,
    utility_is_execution_authority:false,
    graph_write_performed_here:false,
    next_episode_created_here:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    release_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,utility_feedback_root_digest:digest(root)});
}
