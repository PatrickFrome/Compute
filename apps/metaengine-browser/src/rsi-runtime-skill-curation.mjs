import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  verifyRsiSkillCapsule,
  verifyRsiVerifiedSkillLibrary,
} from './rsi-verified-skill-library.mjs';
import {
  verifyRsiSkillLibraryGovernance,
} from './rsi-skill-library-governance.mjs';

export const RSI_SKILL_CURATION_REQUEST_SCHEMA='metaengine.rsi.skill-curation-request.v1';
export const RSI_SKILL_REVISION_EVALUATION_SCHEMA='metaengine.rsi.skill-revision-evaluation.v1';
export const RSI_RUNTIME_SKILL_CURATION_STATE_SCHEMA='metaengine.rsi.runtime-skill-curation-state.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE=/^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const REASONS=new Set([
  'NEGATIVE_TRANSFER',
  'RELIABILITY_GAP',
  'FRAGMENTATION_CONSOLIDATION',
  'CAPABILITY_PRESERVING_GENERALIZATION',
]);
const EDIT_OPS=new Set(['ADD','DELETE','REPLACE']);
const MAX_REQUESTS=2048;
const MAX_TRIGGER_EVIDENCE=32;
const MAX_EDIT_BUDGET=16;
const MAX_EVIDENCE_REFS=32;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactSha(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(o))throw new Error(`rsi_curation_${l}_sha_invalid`);return o}
function exactDigest(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(o))throw new Error(`rsi_curation_${l}_digest_invalid`);return o}
function boundedId(v,l){const o=String(v||'').trim();if(!SAFE_ID_RE.test(o))throw new Error(`rsi_curation_${l}_invalid`);return o}
function token(v,l){const o=String(v||'').trim().toUpperCase();if(!SAFE_TOKEN_RE.test(o))throw new Error(`rsi_curation_${l}_invalid`);return o}
function positiveInt(v,l,max=1000000){const o=Number(v);if(!Number.isSafeInteger(o)||o<1||o>max)throw new Error(`rsi_curation_${l}_invalid`);return o}
function unitScore(v,l){const o=Number(v);if(!Number.isFinite(o)||o<0||o>1)throw new Error(`rsi_curation_${l}_invalid`);return Math.round(o*1e9)/1e9}
function refs(v,l,max=MAX_EVIDENCE_REFS){
  if(!Array.isArray(v)||v.length<1||v.length>max)throw new Error(`rsi_curation_${l}_invalid`);
  const seen=new Set();const out=[];
  for(const raw of v){const x=boundedId(raw,l);if(seen.has(x))throw new Error(`rsi_curation_${l}_duplicate`);seen.add(x);out.push(x)}
  return Object.freeze(out.sort());
}
function digestRefs(v,l,max=MAX_TRIGGER_EVIDENCE){
  if(!Array.isArray(v)||v.length<2||v.length>max)throw new Error(`rsi_curation_${l}_invalid`);
  const seen=new Set();const out=[];
  for(const raw of v){const x=exactDigest(raw,l);if(seen.has(x))throw new Error(`rsi_curation_${l}_duplicate`);seen.add(x);out.push(x)}
  return Object.freeze(out.sort());
}
function editOps(v){
  if(!Array.isArray(v)||v.length<1||v.length>EDIT_OPS.size)throw new Error('rsi_curation_edit_ops_invalid');
  const seen=new Set();const out=[];
  for(const raw of v){const x=token(raw,'edit_op');if(!EDIT_OPS.has(x))throw new Error('rsi_curation_edit_op_invalid');if(seen.has(x))throw new Error('rsi_curation_edit_op_duplicate');seen.add(x);out.push(x)}
  return Object.freeze(out.sort());
}
function assertZero(v,l){
  for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','signing_authority','authority_effect']){
    if(v?.[f]!==false)throw new Error(`rsi_curation_${l}_${f}_invalid`);
  }
  if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_curation_${l}_automatic_retry_invalid`);
}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false})}
function parentEntry(library,skillDigest){
  const d=exactDigest(skillDigest,'parent_skill');
  const row=library.entries.find(x=>x.skill_digest===d);
  if(!row)throw new Error('rsi_curation_parent_skill_not_in_library');
  return row;
}
function governanceEntry(governance,skillDigest){
  const row=governance.entries.find(x=>x.skill_digest===skillDigest);
  if(!row)throw new Error('rsi_curation_parent_skill_not_in_governance');
  return row;
}

export function createRsiSkillCurationRequest({
  source_sha,request_id,library,governance,parent_skill_digest,reason,
  trigger_evidence_digests,training_context_digest,validation_holdout_digest,meta_holdout_digest,
  optimizer_model_family,allowed_edit_ops=['ADD','DELETE','REPLACE'],edit_budget=4,
  external_curator=false,authored_by_candidate=true,
}={}){
  const sourceSha=exactSha(source_sha,'source');
  const checkedLibrary=verifyRsiVerifiedSkillLibrary(library);
  const checkedGovernance=verifyRsiSkillLibraryGovernance(governance,checkedLibrary);
  if(external_curator!==true||authored_by_candidate!==false)throw new Error('rsi_curation_external_curator_required');
  const parent=parentEntry(checkedLibrary,parent_skill_digest);
  const gov=governanceEntry(checkedGovernance,parent.skill_digest);
  const why=token(reason,'reason');if(!REASONS.has(why))throw new Error('rsi_curation_reason_invalid');
  const training=exactDigest(training_context_digest,'training_context');
  const validation=exactDigest(validation_holdout_digest,'validation_holdout');
  const meta=exactDigest(meta_holdout_digest,'meta_holdout');
  if(training===validation||training===meta||validation===meta)throw new Error('rsi_curation_holdout_alias');
  const budget=positiveInt(edit_budget,'edit_budget',MAX_EDIT_BUDGET);
  const core={
    schema:RSI_SKILL_CURATION_REQUEST_SCHEMA,version:1,
    source_sha:sourceSha,
    request_id:boundedId(request_id,'request_id'),
    library_id:checkedLibrary.library_id,
    library_digest:checkedLibrary.library_digest,
    governance_id:checkedGovernance.governance_id,
    governance_digest:checkedGovernance.governance_digest,
    parent_skill_id:parent.skill_id,
    parent_skill_version:parent.skill_version,
    parent_skill_digest:parent.skill_digest,
    parent_skill_state:gov.state,
    reason:why,
    trigger_evidence_digests:digestRefs(trigger_evidence_digests,'trigger_evidence'),
    training_context_digest:training,
    validation_holdout_digest:validation,
    meta_holdout_digest:meta,
    optimizer_model_family:token(optimizer_model_family,'optimizer_model_family'),
    allowed_edit_ops:editOps(allowed_edit_ops),
    edit_budget:budget,
    target_skill_version:parent.skill_version+1,
    parent_interface_digest:digest({
      role:parent.role,
      input_schema_digest:parent.input_schema_digest,
      output_schema_digest:parent.output_schema_digest,
      capabilities:parent.capabilities,
    }),
    parent_remains_library_member:true,
    parent_activation_state_unchanged:true,
    bounded_text_edit_only:true,
    heldout_validation_required:true,
    slow_meta_holdout_required:true,
    rejected_revision_memory_required:true,
    existing_reliability_gate_required:true,
    existing_scope_preservation_gate_required:true,
    direct_library_replacement_allowed:false,
    candidate_can_choose_holdout:false,
    candidate_can_choose_evaluator:false,
    candidate_can_expand_edit_budget:false,
    request_is_execution_authority:false,
    external_curator:true,
    authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,request_digest:digest(core)});
}

export function verifyRsiSkillCurationRequest(row,{library,governance}={}){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_SKILL_CURATION_REQUEST_SCHEMA||row.version!==1)throw new Error('rsi_curation_request_invalid');
  assertZero(row,'request');
  if(row.external_curator!==true||row.authored_by_candidate!==false||row.parent_remains_library_member!==true
    ||row.parent_activation_state_unchanged!==true||row.bounded_text_edit_only!==true||row.heldout_validation_required!==true
    ||row.slow_meta_holdout_required!==true||row.rejected_revision_memory_required!==true
    ||row.existing_reliability_gate_required!==true||row.existing_scope_preservation_gate_required!==true
    ||row.direct_library_replacement_allowed!==false||row.candidate_can_choose_holdout!==false
    ||row.candidate_can_choose_evaluator!==false||row.candidate_can_expand_edit_budget!==false
    ||row.request_is_execution_authority!==false)throw new Error('rsi_curation_request_policy_invalid');
  const canonical=createRsiSkillCurationRequest({
    source_sha:row.source_sha,request_id:row.request_id,library,governance,parent_skill_digest:row.parent_skill_digest,
    reason:row.reason,trigger_evidence_digests:row.trigger_evidence_digests,
    training_context_digest:row.training_context_digest,validation_holdout_digest:row.validation_holdout_digest,
    meta_holdout_digest:row.meta_holdout_digest,optimizer_model_family:row.optimizer_model_family,
    allowed_edit_ops:row.allowed_edit_ops,edit_budget:row.edit_budget,external_curator:true,authored_by_candidate:false,
  });
  if(canonical.request_digest!==exactDigest(row.request_digest,'request'))throw new Error('rsi_curation_request_digest_mismatch');
  return canonical;
}

function assertSuccessorPreservesSurface(request,parent,successor){
  if(successor.skill_id!==parent.skill_id)throw new Error('rsi_curation_successor_skill_id_mismatch');
  if(successor.skill_version!==request.target_skill_version)throw new Error('rsi_curation_successor_version_mismatch');
  if(successor.parent_skill_digest!==parent.skill_digest)throw new Error('rsi_curation_successor_parent_mismatch');
  if(successor.role!==parent.role||successor.input_schema_digest!==parent.input_schema_digest||successor.output_schema_digest!==parent.output_schema_digest){
    throw new Error('rsi_curation_successor_interface_drift');
  }
  if(JSON.stringify(successor.capabilities)!==JSON.stringify(parent.capabilities))throw new Error('rsi_curation_successor_capability_drift');
}

export function createRsiSkillRevisionEvaluation({
  evaluation_id,request,library,governance,successor_skill,
  baseline_validation_score,candidate_validation_score,
  baseline_meta_score,candidate_meta_score,
  hard_invariants_pass,evaluator_digest,evaluation_digest,evidence_refs,
  external_evaluator=false,authored_by_candidate=true,
}={}){
  const checkedRequest=verifyRsiSkillCurationRequest(request,{library,governance});
  const checkedLibrary=verifyRsiVerifiedSkillLibrary(library);
  const parent=parentEntry(checkedLibrary,checkedRequest.parent_skill_digest);
  const successor=verifyRsiSkillCapsule(successor_skill);
  assertSuccessorPreservesSurface(checkedRequest,parent,successor);
  if(external_evaluator!==true||authored_by_candidate!==false)throw new Error('rsi_curation_external_evaluator_required');
  const baselineVal=unitScore(baseline_validation_score,'baseline_validation_score');
  const candidateVal=unitScore(candidate_validation_score,'candidate_validation_score');
  const baselineMeta=unitScore(baseline_meta_score,'baseline_meta_score');
  const candidateMeta=unitScore(candidate_meta_score,'candidate_meta_score');
  const hard=hard_invariants_pass===true;
  const strictValidationImprovement=candidateVal>baselineVal;
  const nonRegressingMeta=candidateMeta>=baselineMeta;
  const accepted=hard&&strictValidationImprovement&&nonRegressingMeta;
  const core={
    schema:RSI_SKILL_REVISION_EVALUATION_SCHEMA,version:1,
    evaluation_id:boundedId(evaluation_id,'evaluation_id'),
    request_id:checkedRequest.request_id,
    request_digest:checkedRequest.request_digest,
    parent_skill_digest:parent.skill_digest,
    successor_skill:successor,
    successor_skill_digest:successor.skill_digest,
    validation_holdout_digest:checkedRequest.validation_holdout_digest,
    meta_holdout_digest:checkedRequest.meta_holdout_digest,
    baseline_validation_score:baselineVal,
    candidate_validation_score:candidateVal,
    validation_delta:Math.round((candidateVal-baselineVal)*1e9)/1e9,
    baseline_meta_score:baselineMeta,
    candidate_meta_score:candidateMeta,
    meta_delta:Math.round((candidateMeta-baselineMeta)*1e9)/1e9,
    hard_invariants_pass:hard,
    strict_validation_improvement:strictValidationImprovement,
    meta_non_regression:nonRegressingMeta,
    accepted_for_existing_reliability_gate:accepted,
    state:accepted?'ELIGIBLE_FOR_EXISTING_RELIABILITY_GATE':'REJECTED_HELDOUT_REVISION',
    evaluator_digest:exactDigest(evaluator_digest,'evaluator'),
    evaluation_digest:exactDigest(evaluation_digest,'evaluation'),
    evidence_refs:refs(evidence_refs,'evidence_ref'),
    rejected_revision_retained:!accepted,
    direct_library_replacement_allowed:false,
    parent_activation_state_unchanged:true,
    existing_reliability_gate_required:true,
    existing_scope_preservation_gate_required:true,
    evaluator_is_independent_of_candidate:true,
    candidate_can_self_accept_revision:false,
    evaluation_is_execution_authority:false,
    external_evaluator:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,result_digest:digest(core)});
}

export function verifyRsiSkillRevisionEvaluation(row,{request,library,governance}={}){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_SKILL_REVISION_EVALUATION_SCHEMA||row.version!==1)throw new Error('rsi_curation_evaluation_invalid');
  assertZero(row,'evaluation');
  if(row.external_evaluator!==true||row.authored_by_candidate!==false||row.direct_library_replacement_allowed!==false
    ||row.parent_activation_state_unchanged!==true||row.existing_reliability_gate_required!==true
    ||row.existing_scope_preservation_gate_required!==true||row.evaluator_is_independent_of_candidate!==true
    ||row.candidate_can_self_accept_revision!==false||row.evaluation_is_execution_authority!==false)throw new Error('rsi_curation_evaluation_policy_invalid');
  const canonical=createRsiSkillRevisionEvaluation({
    evaluation_id:row.evaluation_id,request,library,governance,successor_skill:row.successor_skill,
    baseline_validation_score:row.baseline_validation_score,candidate_validation_score:row.candidate_validation_score,
    baseline_meta_score:row.baseline_meta_score,candidate_meta_score:row.candidate_meta_score,
    hard_invariants_pass:row.hard_invariants_pass,evaluator_digest:row.evaluator_digest,
    evaluation_digest:row.evaluation_digest,evidence_refs:row.evidence_refs,
    external_evaluator:true,authored_by_candidate:false,
  });
  if(canonical.result_digest!==exactDigest(row.result_digest,'evaluation_result'))throw new Error('rsi_curation_evaluation_digest_mismatch');
  return canonical;
}

function stateCore(sourceSha,records){
  const core={
    schema:RSI_RUNTIME_SKILL_CURATION_STATE_SCHEMA,version:1,source_sha:sourceSha,
    records,
    record_count:records.length,
    pending_count:records.filter(x=>x.evaluation==null).length,
    accepted_count:records.filter(x=>x.evaluation?.accepted_for_existing_reliability_gate===true).length,
    rejected_count:records.filter(x=>x.evaluation?.state==='REJECTED_HELDOUT_REVISION').length,
    rejected_revision_buffer:records.filter(x=>x.evaluation?.state==='REJECTED_HELDOUT_REVISION').map(x=>x.evaluation.successor_skill_digest).sort(),
    max_requests:MAX_REQUESTS,
    request_identity_immutable:true,
    evaluation_single_assignment:true,
    rejected_revision_memory_required:true,
    candidate_can_write_queue:false,
    queue_is_execution_authority:false,
    direct_library_replacement_allowed:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,state_digest:digest(core)};
}

export class RsiRuntimeSkillCurationQueue{
  #path;#sourceSha;#records=[];#initialized=false;
  constructor({statePath,source_sha}={}){
    if(!statePath||typeof statePath!=='string')throw new Error('rsi_curation_state_path_required');
    this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'source');
  }
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const parsed=JSON.parse(await fs.readFile(this.#path,'utf8'));
      assertZero(parsed,'state');
      if(parsed.schema!==RSI_RUNTIME_SKILL_CURATION_STATE_SCHEMA||parsed.version!==1||parsed.source_sha!==this.#sourceSha
        ||parsed.candidate_can_write_queue!==false||parsed.queue_is_execution_authority!==false||parsed.direct_library_replacement_allowed!==false){
        throw new Error('rsi_curation_state_invalid');
      }
      const clone=structuredClone(parsed);delete clone.state_digest;
      if(digest(clone)!==exactDigest(parsed.state_digest,'state'))throw new Error('rsi_curation_state_digest_mismatch');
      if(!Array.isArray(parsed.records)||parsed.records.length>MAX_REQUESTS)throw new Error('rsi_curation_state_records_invalid');
      const ids=new Set();
      for(const record of parsed.records){
        if(!record?.request||record.request.source_sha!==this.#sourceSha)throw new Error('rsi_curation_state_record_invalid');
        if(ids.has(record.request.request_id))throw new Error('rsi_curation_state_request_duplicate');
        ids.add(record.request.request_id);
      }
      this.#records=parsed.records;
    }catch(error){if(error?.code!=='ENOENT')throw error}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(){
    const state=stateCore(this.#sourceSha,this.#records);
    const temp=`${this.#path}.tmp`;const handle=await fs.open(temp,'w',0o600);
    try{await handle.writeFile(`${JSON.stringify(state)}\n`,'utf8');await handle.sync()}finally{await handle.close()}
    await fs.rename(temp,this.#path);return state;
  }
  #assertInit(){if(!this.#initialized)throw new Error('rsi_curation_queue_not_initialized')}
  async enqueue({request,library,governance}={}){
    this.#assertInit();
    const checked=verifyRsiSkillCurationRequest(request,{library,governance});
    if(checked.source_sha!==this.#sourceSha)throw new Error('rsi_curation_request_source_mismatch');
    const existing=this.#records.find(x=>x.request.request_id===checked.request_id);
    if(existing){
      if(existing.request.request_digest!==checked.request_digest)throw new Error('rsi_curation_request_identity_conflict');
      return zero({state:'IDEMPOTENT',request_digest:checked.request_digest});
    }
    if(this.#records.length>=MAX_REQUESTS)throw new Error('rsi_curation_request_capacity_exceeded');
    this.#records.push({request:checked,evaluation:null});
    await this.#persist();
    return zero({state:'QUEUED',request_digest:checked.request_digest});
  }
  request(request_id){
    this.#assertInit();
    const id=boundedId(request_id,'request_id');
    const record=this.#records.find(x=>x.request.request_id===id);
    return record ? structuredClone(record.request) : null;
  }
  async evaluateRevision({
    request_id,library,governance,successor_skill,
    baseline_validation_score,candidate_validation_score,
    baseline_meta_score,candidate_meta_score,
    hard_invariants_pass,evaluator_digest,evaluation_digest,evidence_refs,
    external_evaluator=false,authored_by_candidate=true,
  }={}){
    this.#assertInit();
    const request=this.request(request_id);
    if(!request)throw new Error('rsi_curation_request_not_found');
    const evaluation=createRsiSkillRevisionEvaluation({
      evaluation_id:`evaluation.${request.request_id}`,
      request,library,governance,successor_skill,
      baseline_validation_score,candidate_validation_score,
      baseline_meta_score,candidate_meta_score,
      hard_invariants_pass,evaluator_digest,evaluation_digest,evidence_refs,
      external_evaluator,authored_by_candidate,
    });
    const result=await this.recordEvaluation({request_id:request.request_id,evaluation,library,governance});
    return Object.freeze({evaluation,result});
  }
  async recordEvaluation({request_id,evaluation,library,governance}={}){
    this.#assertInit();
    const id=boundedId(request_id,'request_id');
    const record=this.#records.find(x=>x.request.request_id===id);
    if(!record)throw new Error('rsi_curation_request_not_found');
    const checked=verifyRsiSkillRevisionEvaluation(evaluation,{request:record.request,library,governance});
    if(record.evaluation){
      if(record.evaluation.result_digest!==checked.result_digest)throw new Error('rsi_curation_evaluation_conflict');
      return zero({state:'IDEMPOTENT',result_digest:checked.result_digest});
    }
    const rejectedAlready=this.#records.some(x=>x.evaluation?.state==='REJECTED_HELDOUT_REVISION'
      && x.evaluation.successor_skill_digest===checked.successor_skill_digest);
    if(rejectedAlready&&checked.state!=='REJECTED_HELDOUT_REVISION')throw new Error('rsi_curation_rejected_revision_reuse_forbidden');
    record.evaluation=checked;
    await this.#persist();
    return zero({
      state:checked.state,
      result_digest:checked.result_digest,
      successor_skill_digest:checked.successor_skill_digest,
      accepted_for_existing_reliability_gate:checked.accepted_for_existing_reliability_gate,
    });
  }
  snapshot(){const s=stateCore(this.#sourceSha,this.#records);return Object.freeze({
    schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,
    record_count:s.record_count,pending_count:s.pending_count,accepted_count:s.accepted_count,rejected_count:s.rejected_count,
    rejected_revision_buffer:[...s.rejected_revision_buffer],max_requests:s.max_requests,
    request_identity_immutable:true,evaluation_single_assignment:true,rejected_revision_memory_required:true,
    candidate_can_write_queue:false,queue_is_execution_authority:false,direct_library_replacement_allowed:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  })}
}

export function rsiRuntimeSkillCurationTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.runtime-skill-curation-root.v1',version:1,
    policy_path:'apps/metaengine-browser/src/rsi-runtime-skill-curation.mjs',
    reasons:[...REASONS].sort(),allowed_edit_ops:[...EDIT_OPS].sort(),max_edit_budget:MAX_EDIT_BUDGET,
    frozen_executor_required:true,separate_external_curator_required:true,
    training_validation_meta_holdouts_must_be_distinct:true,
    strict_validation_improvement_required:true,meta_non_regression_required:true,
    rejected_revision_buffer_required:true,bounded_edit_budget_required:true,
    parent_library_entry_preserved:true,parent_activation_state_unchanged:true,
    existing_reliability_gate_required:true,existing_scope_preservation_gate_required:true,
    direct_library_replacement_allowed:false,candidate_can_choose_holdout:false,candidate_can_choose_evaluator:false,
    candidate_can_self_accept_revision:false,queue_is_execution_authority:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,curation_root_digest:digest(root)});
}
