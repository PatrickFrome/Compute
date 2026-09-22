import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { verifyRsiSkillRevisionFrontierCandidate } from './rsi-skill-revision-frontier.mjs';
import {
  verifyRsiEvaluationIntegrityPolicy,
  verifyRsiEvaluationIntegrityReceipt,
  verifyRsiEvaluationIntegrityAssessment,
} from './rsi-evaluation-integrity-guard.mjs';

export const RSI_SKILL_REVISION_INTEGRITY_ADMISSION_SCHEMA='metaengine.rsi.skill-revision-integrity-admission.v1';
export const RSI_SKILL_REVISION_INTEGRITY_LEDGER_SCHEMA='metaengine.rsi.skill-revision-integrity-ledger.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_ADMISSIONS=2048;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactSha(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(o))throw new Error(`rsi_revision_integrity_${l}_sha_invalid`);return o}
function exactDigest(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(o))throw new Error(`rsi_revision_integrity_${l}_digest_invalid`);return o}
function boundedId(v,l){const o=String(v||'').trim();if(!SAFE_ID_RE.test(o))throw new Error(`rsi_revision_integrity_${l}_invalid`);return o}
function assertZero(v,l){
  for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','signing_authority','authority_effect']){
    if(v?.[f]!==false)throw new Error(`rsi_revision_integrity_${l}_${f}_invalid`);
  }
  if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_revision_integrity_${l}_automatic_retry_invalid`);
}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false})}
function skillCandidateId(skillDigest){
  const d=exactDigest(skillDigest,'successor_skill');
  return `candidate_sha256_${d.slice('sha256:'.length)}`;
}

export function createRsiSkillRevisionIntegrityAdmission({
  source_sha,admission_id,frontier_candidate,request,evaluation,library,governance,
  integrity_policy,integrity_receipt,integrity_assessment,
  external_admission_owner=false,authored_by_candidate=true,
}={}){
  const sourceSha=exactSha(source_sha,'source');
  const frontier=verifyRsiSkillRevisionFrontierCandidate(frontier_candidate,{request,evaluation,library,governance});
  if(frontier.source_sha!==sourceSha)throw new Error('rsi_revision_integrity_frontier_source_mismatch');
  const policy=verifyRsiEvaluationIntegrityPolicy(integrity_policy);
  const receipt=verifyRsiEvaluationIntegrityReceipt(integrity_receipt,policy);
  const assessment=verifyRsiEvaluationIntegrityAssessment(integrity_assessment,policy,receipt);
  if(external_admission_owner!==true||authored_by_candidate!==false)throw new Error('rsi_revision_integrity_external_owner_required');

  const expectedCandidateId=skillCandidateId(evaluation.successor_skill.skill_digest);
  const expectedCandidateSha=exactSha(evaluation.successor_skill.source_candidate_sha,'successor_source');
  if(receipt.candidate_id!==expectedCandidateId||receipt.candidate_sha!==expectedCandidateSha)throw new Error('rsi_revision_integrity_candidate_binding_mismatch');
  if(frontier.successor_skill_digest!==evaluation.successor_skill.skill_digest)throw new Error('rsi_revision_integrity_frontier_successor_mismatch');

  const sealedHoldout=policy.compositional_holdout_digest;
  if([request.training_context_digest,request.validation_holdout_digest,request.meta_holdout_digest].includes(sealedHoldout)){
    throw new Error('rsi_revision_integrity_sealed_holdout_alias');
  }

  const integrityVerified=assessment.state==='INTEGRITY_VERIFIED';
  const core={
    schema:RSI_SKILL_REVISION_INTEGRITY_ADMISSION_SCHEMA,version:1,
    source_sha:sourceSha,
    admission_id:boundedId(admission_id,'admission_id'),
    request_id:request.request_id,
    request_digest:request.request_digest,
    frontier_candidate_digest:frontier.frontier_candidate_digest,
    parent_skill_digest:frontier.parent_skill_digest,
    successor_skill_digest:frontier.successor_skill_digest,
    candidate_id:expectedCandidateId,
    candidate_sha:expectedCandidateSha,
    integrity_policy_digest:policy.policy_digest,
    integrity_receipt_digest:receipt.receipt_digest,
    integrity_assessment_digest:assessment.assessment_digest,
    integrity_state:assessment.state,
    exploit_signals:Object.freeze([...assessment.exploit_signals]),
    sealed_holdout_digest:sealedHoldout,
    validation_holdout_digest:request.validation_holdout_digest,
    meta_holdout_digest:request.meta_holdout_digest,
    sealed_holdout_distinct_from_fast_and_meta:true,
    integrity_verified:integrityVerified,
    state:integrityVerified?'INTEGRITY_ADMITTED':'INTEGRITY_REJECTED',
    eligible_for_existing_reliability_gate:integrityVerified,
    existing_benchmark_provenance_required:true,
    existing_statistical_confirmation_required:true,
    existing_reliability_gate_required:true,
    existing_scope_preservation_gate_required:true,
    direct_library_replacement_allowed:false,
    self_authored_verification_sufficient:false,
    candidate_can_modify_integrity_policy:false,
    candidate_can_read_sealed_holdout_content:false,
    candidate_can_self_admit:false,
    admission_is_execution_authority:false,
    external_admission_owner:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,admission_digest:digest(core)});
}

export function verifyRsiSkillRevisionIntegrityAdmission(row,args={}){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_SKILL_REVISION_INTEGRITY_ADMISSION_SCHEMA||row.version!==1)throw new Error('rsi_revision_integrity_admission_invalid');
  assertZero(row,'admission');
  if(row.sealed_holdout_distinct_from_fast_and_meta!==true||row.existing_benchmark_provenance_required!==true
    ||row.existing_statistical_confirmation_required!==true||row.existing_reliability_gate_required!==true
    ||row.existing_scope_preservation_gate_required!==true||row.direct_library_replacement_allowed!==false
    ||row.self_authored_verification_sufficient!==false||row.candidate_can_modify_integrity_policy!==false
    ||row.candidate_can_read_sealed_holdout_content!==false||row.candidate_can_self_admit!==false
    ||row.admission_is_execution_authority!==false||row.external_admission_owner!==true||row.authored_by_candidate!==false){
    throw new Error('rsi_revision_integrity_admission_policy_invalid');
  }
  const canonical=createRsiSkillRevisionIntegrityAdmission({...args,source_sha:row.source_sha,admission_id:row.admission_id,external_admission_owner:true,authored_by_candidate:false});
  if(canonical.admission_digest!==exactDigest(row.admission_digest,'admission'))throw new Error('rsi_revision_integrity_admission_digest_mismatch');
  return canonical;
}

function stateCore(sourceSha,admissions){
  const core={
    schema:RSI_SKILL_REVISION_INTEGRITY_LEDGER_SCHEMA,version:1,source_sha:sourceSha,
    admissions,
    admission_count:admissions.length,
    admitted_count:admissions.filter(x=>x.state==='INTEGRITY_ADMITTED').length,
    rejected_count:admissions.filter(x=>x.state==='INTEGRITY_REJECTED').length,
    reward_hacking_rejection_count:admissions.filter(x=>x.integrity_state==='REWARD_HACKING_DETECTED').length,
    specification_gaming_rejection_count:admissions.filter(x=>x.integrity_state==='SPECIFICATION_GAMING_SUSPECT').length,
    append_only:true,
    integrity_rejection_is_terminal_for_exact_admission:true,
    self_authored_verification_sufficient:false,
    candidate_can_delete_admission:false,
    candidate_can_rewrite_integrity_state:false,
    admission_is_execution_authority:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,state_digest:digest(core)};
}

export class RsiSkillRevisionIntegrityLedger{
  #path;#sourceSha;#admissions=[];#initialized=false;
  constructor({statePath,source_sha}={}){
    if(!statePath||typeof statePath!=='string')throw new Error('rsi_revision_integrity_state_path_required');
    this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'source');
  }
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const parsed=JSON.parse(await fs.readFile(this.#path,'utf8'));
      assertZero(parsed,'state');
      if(parsed.schema!==RSI_SKILL_REVISION_INTEGRITY_LEDGER_SCHEMA||parsed.version!==1||parsed.source_sha!==this.#sourceSha
        ||parsed.append_only!==true||parsed.self_authored_verification_sufficient!==false
        ||parsed.candidate_can_delete_admission!==false||parsed.candidate_can_rewrite_integrity_state!==false
        ||parsed.admission_is_execution_authority!==false)throw new Error('rsi_revision_integrity_state_invalid');
      const clone=structuredClone(parsed);delete clone.state_digest;
      if(digest(clone)!==exactDigest(parsed.state_digest,'state'))throw new Error('rsi_revision_integrity_state_digest_mismatch');
      if(!Array.isArray(parsed.admissions)||parsed.admissions.length>MAX_ADMISSIONS)throw new Error('rsi_revision_integrity_admissions_invalid');
      const ids=new Set();const candidates=new Set();
      for(const row of parsed.admissions){
        if(row.schema!==RSI_SKILL_REVISION_INTEGRITY_ADMISSION_SCHEMA||row.source_sha!==this.#sourceSha)throw new Error('rsi_revision_integrity_admission_state_invalid');
        assertZero(row,'admission');
        if(ids.has(row.admission_id)||candidates.has(row.frontier_candidate_digest))throw new Error('rsi_revision_integrity_admission_duplicate');
        ids.add(row.admission_id);candidates.add(row.frontier_candidate_digest);
      }
      this.#admissions=parsed.admissions;
    }catch(error){if(error?.code!=='ENOENT')throw error}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(){
    const state=stateCore(this.#sourceSha,this.#admissions);
    const temp=`${this.#path}.tmp`;const handle=await fs.open(temp,'w',0o600);
    try{await handle.writeFile(`${JSON.stringify(state)}\n`,'utf8');await handle.sync()}finally{await handle.close()}
    await fs.rename(temp,this.#path);return state;
  }
  #assertInit(){if(!this.#initialized)throw new Error('rsi_revision_integrity_not_initialized')}
  async append(admission){
    this.#assertInit();
    if(!admission||admission.schema!==RSI_SKILL_REVISION_INTEGRITY_ADMISSION_SCHEMA||admission.version!==1)throw new Error('rsi_revision_integrity_admission_invalid');
    assertZero(admission,'admission');
    if(admission.source_sha!==this.#sourceSha)throw new Error('rsi_revision_integrity_admission_source_mismatch');
    const existing=this.#admissions.find(x=>x.frontier_candidate_digest===admission.frontier_candidate_digest);
    if(existing){
      if(existing.admission_digest!==admission.admission_digest)throw new Error('rsi_revision_integrity_exact_candidate_conflict');
      return zero({state:'IDEMPOTENT',admission_digest:admission.admission_digest});
    }
    if(this.#admissions.length>=MAX_ADMISSIONS)throw new Error('rsi_revision_integrity_capacity_exceeded');
    this.#admissions.push(structuredClone(admission));await this.#persist();
    return zero({state:admission.state,admission_digest:admission.admission_digest});
  }
  admissionByRequest(request_id){
    this.#assertInit();
    const id=boundedId(request_id,'request_id');
    const row=this.#admissions.find(x=>x.request_id===id);
    return row ? Object.freeze(structuredClone(row)) : null;
  }
  admitted({parent_skill_digest=null}={}){
    this.#assertInit();
    const parent=parent_skill_digest==null?null:exactDigest(parent_skill_digest,'parent_skill');
    return Object.freeze(this.#admissions.filter(x=>x.state==='INTEGRITY_ADMITTED'&&(parent==null||x.parent_skill_digest===parent))
      .map(x=>Object.freeze(structuredClone(x))));
  }
  snapshot(){
    const s=stateCore(this.#sourceSha,this.#admissions);
    return Object.freeze({
      schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,
      admission_count:s.admission_count,admitted_count:s.admitted_count,rejected_count:s.rejected_count,
      reward_hacking_rejection_count:s.reward_hacking_rejection_count,
      specification_gaming_rejection_count:s.specification_gaming_rejection_count,
      append_only:true,integrity_rejection_is_terminal_for_exact_admission:true,self_authored_verification_sufficient:false,
      candidate_can_delete_admission:false,candidate_can_rewrite_integrity_state:false,admission_is_execution_authority:false,
      execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
      scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
    });
  }
}

export function rsiSkillRevisionIntegrityAdmissionTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.skill-revision-integrity-root.v1',version:1,
    policy_path:'apps/metaengine-browser/src/rsi-skill-revision-integrity-admission.mjs',
    existing_evaluation_integrity_guard_reused:true,
    sealed_exogenous_acceptance_required:true,
    sealed_holdout_distinct_from_training_validation_meta:true,
    reward_hacking_rejected:true,specification_gaming_rejected:true,
    self_authored_verification_sufficient:false,
    candidate_can_modify_integrity_policy:false,candidate_can_read_sealed_holdout_content:false,candidate_can_self_admit:false,
    existing_benchmark_provenance_required:true,existing_statistical_confirmation_required:true,
    existing_reliability_gate_required:true,existing_scope_preservation_gate_required:true,
    direct_library_replacement_allowed:false,admission_is_execution_authority:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,integrity_admission_root_digest:digest(root)});
}
