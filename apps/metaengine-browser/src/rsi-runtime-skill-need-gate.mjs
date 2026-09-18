import crypto from 'node:crypto';

import {
  verifyBoundRsiRuntimeSkillAdvisory,
} from './rsi-runtime-skill-advisory.mjs';
import {
  verifyRsiLineageSkillAdmission,
} from './rsi-lineage-skill-admission.mjs';
import {
  createRsiSkillUsageReceipt,
  verifyRsiSkillUsageReceipt,
} from './rsi-verified-skill-library.mjs';

export const RSI_RUNTIME_SKILL_NEED_CONTEXT_SCHEMA='metaengine.rsi.runtime-skill-need-context.v1';
export const RSI_RUNTIME_SKILL_NEED_DECISION_SCHEMA='metaengine.rsi.runtime-skill-need-decision.v1';
export const RSI_RUNTIME_SKILL_FEEDBACK_SCHEMA='metaengine.rsi.runtime-skill-feedback.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const ROLE_NEED=Object.freeze({
  ANALYZER:'FAILURE_ANALYSIS',
  RETRIEVER:'VERIFIED_MEMORY_RETRIEVAL',
  ALLOCATOR:'PROPOSAL_BUDGET_ALLOCATION',
  PROPOSER:'TYPED_PROPOSAL_CONSTRUCTION',
  EVOLVER:'SKILL_EVOLUTION_ANALYSIS',
  VERIFIER:'OUTPUT_VERIFICATION',
  TRACE_SUMMARIZER:'VERIFIED_TRACE_SUMMARY',
  PLAN_TRANSFORM:'STRUCTURED_PLAN_TRANSFORM',
});

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function digest(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}
function exactDigest(value,label){
  const out=String(value||'').toLowerCase();
  if(!SHA256_RE.test(out))throw new Error(`rsi_runtime_skill_need_${label}_digest_invalid`);
  return out;
}
function refs(value){
  if(!Array.isArray(value)||value.length<1||value.length>24)throw new Error('rsi_runtime_skill_need_evidence_refs_invalid');
  const seen=new Set();
  return value.map((entry)=>{
    const out=String(entry||'').trim();
    if(!out||out.length>200||seen.has(out))throw new Error('rsi_runtime_skill_need_evidence_ref_invalid');
    seen.add(out);return out;
  }).sort();
}
function zeroAuthority(value,label){
  for(const field of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','signing_authority','direct_tool_execution_authority','authority_effect']){
    if(value?.[field]!==false)throw new Error(`rsi_runtime_skill_need_${label}_${field}_invalid`);
  }
  if(value?.automatic_retry_allowed!==false)throw new Error(`rsi_runtime_skill_need_${label}_automatic_retry_invalid`);
}

export function createRsiRuntimeSkillNeedDecision({
  advisory,
  context,
  external_router=false,
  authored_by_candidate=true,
}={}){
  const checked=verifyBoundRsiRuntimeSkillAdvisory(advisory);
  if(external_router!==true||authored_by_candidate!==false)throw new Error('rsi_runtime_skill_need_external_router_required');
  if(!context||typeof context!=='object'||Array.isArray(context)||context.schema!==RSI_RUNTIME_SKILL_NEED_CONTEXT_SCHEMA||context.version!==1){
    throw new Error('rsi_runtime_skill_need_context_invalid');
  }
  const sourceSha=String(context.source_sha||'').toLowerCase();
  if(!SHA40_RE.test(sourceSha))throw new Error('rsi_runtime_skill_need_source_sha_invalid');
  const contextDigest=exactDigest(context.context_digest,'context');
  const inputSchema=exactDigest(context.input_schema_digest,'input_schema');
  const requestedRole=String(context.requested_role||'').toUpperCase();
  const needKind=String(context.need_kind||'').toUpperCase();
  const evidenceDigest=exactDigest(context.evidence_digest,'evidence');
  const evidenceRefs=refs(context.evidence_refs);
  if(
    context.raw_page_text_present!==false
    ||context.raw_model_text_present!==false
    ||context.raw_user_input_present!==false
    ||context.raw_network_present!==false
    ||context.page_model_worker_authority!==false
    ||context.context_is_execution_authority!==false
  )throw new Error('rsi_runtime_skill_need_context_policy_invalid');

  const blockers=[];
  if(sourceSha!==checked.source_parent_sha)blockers.push('SOURCE_MISMATCH');
  if(inputSchema!==checked.input_schema_digest)blockers.push('INPUT_SCHEMA_MISMATCH');
  if(requestedRole!==checked.role)blockers.push('ROLE_MISMATCH');
  if(ROLE_NEED[checked.role]!==needKind)blockers.push('NEED_KIND_MISMATCH');
  if(context.need_demonstrated!==true)blockers.push('NEED_NOT_DEMONSTRATED');
  if(context.baseline_sufficient===true)blockers.push('BASELINE_ALREADY_SUFFICIENT');
  if(context.negative_transfer_signal===true)blockers.push('NEGATIVE_TRANSFER_SIGNAL');
  if(context.hard_invariant_alert===true)blockers.push('HARD_INVARIANT_ALERT');
  if(context.stale_evidence_signal===true)blockers.push('STALE_EVIDENCE_SIGNAL');

  const inject=blockers.length===0;
  const core={
    schema:RSI_RUNTIME_SKILL_NEED_DECISION_SCHEMA,
    version:1,
    advisory_digest:checked.advisory_digest,
    skill_id:checked.skill_id,
    skill_version:checked.skill_version,
    skill_digest:checked.skill_digest,
    source_parent_sha:checked.source_parent_sha,
    context_digest:contextDigest,
    input_schema_digest:inputSchema,
    requested_role:requestedRole,
    need_kind:needKind,
    evidence_digest:evidenceDigest,
    evidence_refs:evidenceRefs,
    decision:inject?'INJECT_ADVISORY_METADATA':'SKIP',
    blockers:Object.freeze(blockers.sort()),
    injected_payload:inject?Object.freeze({
      skill_id:checked.skill_id,
      skill_version:checked.skill_version,
      skill_digest:checked.skill_digest,
      role:checked.role,
      capabilities:Object.freeze([...checked.capabilities]),
      input_schema_digest:checked.input_schema_digest,
      output_schema_digest:checked.output_schema_digest,
      max_context_tokens:checked.max_context_tokens,
      max_output_tokens:checked.max_output_tokens,
      max_invocations:1,
      advisory_digest:checked.advisory_digest,
      composition_plan_digest:checked.composition_plan_digest,
    }):null,
    raw_skill_implementation_injected:false,
    raw_trajectory_injected:false,
    raw_model_transcript_injected:false,
    decision_is_execution_authority:false,
    direct_tool_execution_allowed:false,
    browser_actuation_allowed:false,
    scheduler_dispatch_allowed:false,
    feedback_required_if_injected:inject,
    external_router:true,
    authored_by_candidate:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,decision_digest:digest(core)});
}

export function verifyRsiRuntimeSkillNeedDecision(row,{advisory,context}={}){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_RUNTIME_SKILL_NEED_DECISION_SCHEMA||row.version!==1){
    throw new Error('rsi_runtime_skill_need_decision_invalid');
  }
  zeroAuthority(row,'decision');
  const expected=createRsiRuntimeSkillNeedDecision({advisory,context,external_router:true,authored_by_candidate:false});
  if(JSON.stringify(stable(row))!==JSON.stringify(stable(expected)))throw new Error('rsi_runtime_skill_need_decision_mismatch');
  return expected;
}

export function createRsiRuntimeSkillFeedback({
  advisory,
  decision,
  context,
  lineage_skill_admission,
  lineage_skill_admission_inputs,
  hidden_holdout_digest,
  evaluator_root_digest,
  outcome,
  measured_delta,
  hard_invariants_pass,
  evidence_refs,
  external_evaluator=false,
  authored_by_candidate=true,
}={}){
  const checkedAdvisory=verifyBoundRsiRuntimeSkillAdvisory(advisory);
  const checkedDecision=verifyRsiRuntimeSkillNeedDecision(decision,{advisory:checkedAdvisory,context});
  if(checkedDecision.decision!=='INJECT_ADVISORY_METADATA')throw new Error('rsi_runtime_skill_feedback_for_skipped_decision');
  const admission=verifyRsiLineageSkillAdmission(lineage_skill_admission,lineage_skill_admission_inputs);
  if(
    admission.admission_digest!==checkedAdvisory.lineage_skill_admission_digest
    ||admission.skill_digest!==checkedAdvisory.skill_digest
    ||admission.library_digest!==checkedAdvisory.library_digest
    ||admission.governance_digest!==checkedAdvisory.governance_digest
  )throw new Error('rsi_runtime_skill_feedback_admission_binding_invalid');
  if(external_evaluator!==true||authored_by_candidate!==false)throw new Error('rsi_runtime_skill_feedback_external_evaluator_required');

  const receipt=createRsiSkillUsageReceipt({
    plan:checkedAdvisory.composition_plan,
    library:admission.library,
    target_context_digest:checkedDecision.context_digest,
    hidden_holdout_digest,
    evaluator_root_digest,
    outcome,
    measured_delta,
    hard_invariants_pass,
    evidence_refs,
    external_evaluator:true,
    authored_by_candidate:false,
  });
  verifyRsiSkillUsageReceipt(receipt,checkedAdvisory.composition_plan,admission.library);
  zeroAuthority(receipt,'usage_receipt');

  const core={
    schema:RSI_RUNTIME_SKILL_FEEDBACK_SCHEMA,
    version:1,
    advisory_digest:checkedAdvisory.advisory_digest,
    decision_digest:checkedDecision.decision_digest,
    skill_digest:checkedAdvisory.skill_digest,
    library_digest:admission.library_digest,
    governance_digest:admission.governance_digest,
    usage_receipt_digest:receipt.receipt_digest,
    usage_receipt:receipt,
    outcome:receipt.outcome,
    measured_delta:receipt.measured_delta,
    hard_invariants_pass:receipt.hard_invariants_pass,
    feedback_updates_governance_automatically:false,
    feedback_updates_library_automatically:false,
    feedback_is_skill_memory_only:true,
    external_lifecycle_governance_ingest_required:true,
    direct_activation_change_allowed:false,
    external_evaluator:true,
    authored_by_candidate:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,feedback_digest:digest(core)});
}
