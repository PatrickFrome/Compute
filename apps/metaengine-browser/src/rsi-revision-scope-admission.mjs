import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  finalizeRsiSkillScopeExpansion,
  verifyRsiSkillAbstractionCandidate,
  verifyRsiSkillCompatibilityReceipt,
  verifyRsiSkillScopePreservationReceipt,
} from './rsi-skill-scope-expansion.mjs';

export const RSI_REVISION_SCOPE_ADMISSION_SCHEMA='metaengine.rsi.revision-scope-admission.v1';
export const RSI_REVISION_SCOPE_LEDGER_SCHEMA='metaengine.rsi.revision-scope-ledger.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_ROWS=2048;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactSha(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(o))throw new Error(`rsi_revision_scope_${l}_sha_invalid`);return o}
function exactDigest(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(o))throw new Error(`rsi_revision_scope_${l}_digest_invalid`);return o}
function boundedId(v,l){const o=String(v||'').trim();if(!SAFE_ID_RE.test(o))throw new Error(`rsi_revision_scope_${l}_invalid`);return o}
function assertZero(v,l){
  for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','signing_authority','authority_effect']){
    if(v?.[f]!==false)throw new Error(`rsi_revision_scope_${l}_${f}_invalid`);
  }
  if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_revision_scope_${l}_automatic_retry_invalid`);
}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false})}

function verifyReliabilityBinding(binding){
  if(!binding||typeof binding!=='object'||Array.isArray(binding)||binding.schema!=='metaengine.rsi.integrity-bound-skill-reliability.v1'||binding.version!==1){
    throw new Error('rsi_revision_scope_reliability_binding_invalid');
  }
  assertZero(binding,'reliability');
  exactSha(binding.source_sha,'source');
  const bindingDigest=exactDigest(binding.binding_digest,'reliability_binding');
  const bindingClone=structuredClone(binding);delete bindingClone.binding_digest;
  if(digest(bindingClone)!==bindingDigest)throw new Error('rsi_revision_scope_reliability_binding_digest_mismatch');
  exactDigest(binding.parent_skill_digest,'parent_skill');
  exactDigest(binding.successor_skill_digest,'successor_skill');
  if(binding.state!=='ELIGIBLE_FOR_EXISTING_SCOPE_PRESERVATION_GATE'
    ||binding.eligible_for_existing_scope_preservation_gate!==true){
    throw new Error('rsi_revision_scope_reliability_pass_required');
  }
  if(binding.existing_scope_preservation_gate_required!==true
    ||binding.existing_external_library_evidence_required!==true
    ||binding.direct_library_replacement_allowed!==false
    ||binding.binding_is_execution_authority!==false){
    throw new Error('rsi_revision_scope_reliability_policy_invalid');
  }
  return binding;
}

export function createRsiRevisionScopeAdmission({
  source_sha,admission_id,reliability_binding,
  units,compatibility_receipt,scope_candidate,preservation_receipt,scope_result,
  external_scope_owner=false,authored_by_candidate=true,
}={}){
  const sourceSha=exactSha(source_sha,'source');
  const binding=verifyReliabilityBinding(reliability_binding);
  if(binding.source_sha!==sourceSha)throw new Error('rsi_revision_scope_source_mismatch');
  if(external_scope_owner!==true||authored_by_candidate!==false)throw new Error('rsi_revision_scope_external_owner_required');

  const compatibility=verifyRsiSkillCompatibilityReceipt(compatibility_receipt,units);
  const candidate=verifyRsiSkillAbstractionCandidate(scope_candidate,units,compatibility);
  const preservation=verifyRsiSkillScopePreservationReceipt(preservation_receipt,candidate,units,compatibility);
  const canonicalResult=finalizeRsiSkillScopeExpansion({
    candidate,units,compatibility_receipt:compatibility,preservation_receipt:preservation,
  });
  if(!scope_result||scope_result.result_digest!==canonicalResult.result_digest)throw new Error('rsi_revision_scope_result_digest_mismatch');
  if(candidate.abstract_skill_digest!==binding.successor_skill_digest)throw new Error('rsi_revision_scope_successor_skill_mismatch');

  const eligible=canonicalResult.eligible_for_v124_library_evidence===true
    && canonicalResult.source_preservation_verified===true
    && canonicalResult.behavioral_integrity_verified===true;

  const core={
    schema:RSI_REVISION_SCOPE_ADMISSION_SCHEMA,version:1,
    source_sha:sourceSha,
    admission_id:boundedId(admission_id,'admission_id'),
    reliability_binding_digest:binding.binding_digest,
    parent_skill_digest:binding.parent_skill_digest,
    successor_skill_digest:binding.successor_skill_digest,
    scope_candidate_digest:candidate.candidate_digest,
    compatibility_digest:compatibility.compatibility_digest,
    preservation_digest:preservation.preservation_digest,
    scope_result_digest:canonicalResult.result_digest,
    target_scope_level:canonicalResult.target_scope_level,
    source_instance_count:canonicalResult.source_instance_count,
    source_preservation_verified:canonicalResult.source_preservation_verified,
    behavioral_integrity_verified:canonicalResult.behavioral_integrity_verified,
    state:eligible?'ELIGIBLE_FOR_EXTERNAL_LIBRARY_EVIDENCE':'REJECTED_SCOPE_PRESERVATION',
    eligible_for_external_library_evidence:eligible,
    prior_reliability_gate_required:true,
    exact_successor_skill_binding_required:true,
    cross_instance_replay_required:true,
    exact_capability_set_required:true,
    semantic_similarity_is_authority:false,
    model_mechanism_judgment_is_authority:false,
    external_library_evidence_still_required:true,
    direct_library_replacement_allowed:false,
    candidate_can_self_commit:false,
    admission_is_execution_authority:false,
    external_scope_owner:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,admission_digest:digest(core)});
}

export function verifyRsiRevisionScopeAdmission(row,args={}){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_REVISION_SCOPE_ADMISSION_SCHEMA||row.version!==1)throw new Error('rsi_revision_scope_admission_invalid');
  assertZero(row,'admission');
  if(row.prior_reliability_gate_required!==true||row.exact_successor_skill_binding_required!==true
    ||row.cross_instance_replay_required!==true||row.exact_capability_set_required!==true
    ||row.semantic_similarity_is_authority!==false||row.model_mechanism_judgment_is_authority!==false
    ||row.external_library_evidence_still_required!==true||row.direct_library_replacement_allowed!==false
    ||row.candidate_can_self_commit!==false||row.admission_is_execution_authority!==false
    ||row.external_scope_owner!==true||row.authored_by_candidate!==false){
    throw new Error('rsi_revision_scope_admission_policy_invalid');
  }
  const canonical=createRsiRevisionScopeAdmission({...args,source_sha:row.source_sha,admission_id:row.admission_id,external_scope_owner:true,authored_by_candidate:false});
  if(canonical.admission_digest!==exactDigest(row.admission_digest,'admission'))throw new Error('rsi_revision_scope_admission_digest_mismatch');
  return canonical;
}

function stateCore(sourceSha,rows){
  const core={
    schema:RSI_REVISION_SCOPE_LEDGER_SCHEMA,version:1,source_sha:sourceSha,
    rows,
    row_count:rows.length,
    eligible_count:rows.filter(x=>x.state==='ELIGIBLE_FOR_EXTERNAL_LIBRARY_EVIDENCE').length,
    rejected_count:rows.filter(x=>x.state==='REJECTED_SCOPE_PRESERVATION').length,
    append_only:true,
    candidate_can_delete_rows:false,
    candidate_can_rewrite_scope_state:false,
    direct_library_replacement_allowed:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,state_digest:digest(core)};
}

export class RsiRevisionScopeLedger{
  #path;#sourceSha;#rows=[];#initialized=false;
  constructor({statePath,source_sha}={}){
    if(!statePath||typeof statePath!=='string')throw new Error('rsi_revision_scope_state_path_required');
    this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'source');
  }
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const parsed=JSON.parse(await fs.readFile(this.#path,'utf8'));
      assertZero(parsed,'state');
      if(parsed.schema!==RSI_REVISION_SCOPE_LEDGER_SCHEMA||parsed.version!==1||parsed.source_sha!==this.#sourceSha
        ||parsed.append_only!==true||parsed.candidate_can_delete_rows!==false
        ||parsed.candidate_can_rewrite_scope_state!==false||parsed.direct_library_replacement_allowed!==false){
        throw new Error('rsi_revision_scope_state_invalid');
      }
      const clone=structuredClone(parsed);delete clone.state_digest;
      if(digest(clone)!==exactDigest(parsed.state_digest,'state'))throw new Error('rsi_revision_scope_state_digest_mismatch');
      if(!Array.isArray(parsed.rows)||parsed.rows.length>MAX_ROWS)throw new Error('rsi_revision_scope_rows_invalid');
      const ids=new Set();const bindings=new Set();
      for(const row of parsed.rows){
        if(row.schema!==RSI_REVISION_SCOPE_ADMISSION_SCHEMA||row.source_sha!==this.#sourceSha)throw new Error('rsi_revision_scope_row_invalid');
        assertZero(row,'row');
        const rowDigest=exactDigest(row.admission_digest,'admission');
        const rowClone=structuredClone(row);delete rowClone.admission_digest;
        if(digest(rowClone)!==rowDigest)throw new Error('rsi_revision_scope_row_digest_mismatch');
        if(ids.has(row.admission_id)||bindings.has(row.reliability_binding_digest))throw new Error('rsi_revision_scope_row_duplicate');
        ids.add(row.admission_id);bindings.add(row.reliability_binding_digest);
      }
      this.#rows=parsed.rows;
    }catch(error){if(error?.code!=='ENOENT')throw error}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(){
    const state=stateCore(this.#sourceSha,this.#rows);
    const temp=`${this.#path}.tmp`;const handle=await fs.open(temp,'w',0o600);
    try{await handle.writeFile(`${JSON.stringify(state)}\n`,'utf8');await handle.sync()}finally{await handle.close()}
    await fs.rename(temp,this.#path);return state;
  }
  #assertInit(){if(!this.#initialized)throw new Error('rsi_revision_scope_not_initialized')}
  async append(admission){
    this.#assertInit();
    if(!admission||admission.schema!==RSI_REVISION_SCOPE_ADMISSION_SCHEMA||admission.version!==1)throw new Error('rsi_revision_scope_admission_invalid');
    assertZero(admission,'admission');
    if(admission.source_sha!==this.#sourceSha)throw new Error('rsi_revision_scope_admission_source_mismatch');
    const existing=this.#rows.find(x=>x.reliability_binding_digest===admission.reliability_binding_digest);
    if(existing){
      if(existing.admission_digest!==admission.admission_digest)throw new Error('rsi_revision_scope_exact_binding_conflict');
      return zero({state:'IDEMPOTENT',admission_digest:admission.admission_digest});
    }
    if(this.#rows.length>=MAX_ROWS)throw new Error('rsi_revision_scope_capacity_exceeded');
    this.#rows.push(structuredClone(admission));await this.#persist();
    return zero({state:admission.state,admission_digest:admission.admission_digest});
  }
  admissionByDigest(admission_digest){
    this.#assertInit();
    const d=exactDigest(admission_digest,'admission');
    const row=this.#rows.find(x=>x.admission_digest===d);
    return row ? Object.freeze(structuredClone(row)) : null;
  }
  eligible(){
    this.#assertInit();
    return Object.freeze(this.#rows.filter(x=>x.state==='ELIGIBLE_FOR_EXTERNAL_LIBRARY_EVIDENCE').map(x=>Object.freeze(structuredClone(x))));
  }
  snapshot(){
    const s=stateCore(this.#sourceSha,this.#rows);
    return Object.freeze({
      schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,
      row_count:s.row_count,eligible_count:s.eligible_count,rejected_count:s.rejected_count,
      append_only:true,candidate_can_delete_rows:false,candidate_can_rewrite_scope_state:false,
      direct_library_replacement_allowed:false,
      execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
      scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
    });
  }
}

export function rsiRevisionScopeAdmissionTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.revision-scope-admission-root.v1',version:1,
    policy_path:'apps/metaengine-browser/src/rsi-revision-scope-admission.mjs',
    existing_scope_expansion_gate_reused:true,prior_reliability_gate_required:true,
    exact_successor_skill_binding_required:true,cross_instance_replay_required:true,
    exact_capability_set_required:true,semantic_similarity_is_authority:false,
    model_mechanism_judgment_is_authority:false,external_library_evidence_still_required:true,
    direct_library_replacement_allowed:false,candidate_can_self_commit:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,scope_admission_root_digest:digest(root)});
}
