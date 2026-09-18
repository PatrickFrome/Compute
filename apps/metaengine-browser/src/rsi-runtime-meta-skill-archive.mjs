import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { verifyRsiVerifiedSkillLibrary } from './rsi-verified-skill-library.mjs';
import {
  verifyRsiMetaSkillProfile,
  verifyRsiMetaSkillFastLoopSummary,
  verifyRsiMetaSkillEvolutionPlan,
  verifyRsiMetaSkillEvaluation,
  finalizeRsiMetaSkillEvolution,
} from './rsi-meta-skill-evolution.mjs';

export const RSI_RUNTIME_META_SKILL_RECORD_SCHEMA='metaengine.rsi.runtime-meta-skill-record.v1';
export const RSI_RUNTIME_META_SKILL_ARCHIVE_SCHEMA='metaengine.rsi.runtime-meta-skill-archive.v1';

const SHA40=/^[0-9a-f]{40}$/;
const SHA256=/^sha256:[0-9a-f]{64}$/;
const SAFE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_RECORDS=1024;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function dg(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function sha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40.test(x))throw new Error(`rsi_runtime_meta_${l}_sha_invalid`);return x}
function digest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256.test(x))throw new Error(`rsi_runtime_meta_${l}_digest_invalid`);return x}
function id(v,l){const x=String(v||'').trim();if(!SAFE.test(x))throw new Error(`rsi_runtime_meta_${l}_invalid`);return x}
function assertZero(v,l){for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','signing_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_runtime_meta_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_runtime_meta_${l}_retry_invalid`)}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false})}

const FIXED_META_OPERATION=Object.freeze({
  operation:'VERIFIED_TWO_TIMESCALE_META_EVOLUTION_V1',
  fast_loop_target:'VERIFIED_TASK_SKILLS',
  slow_loop_target:'ANALYZER_RETRIEVER_ALLOCATOR_PROPOSER_EVOLVER_PROFILE',
  recursive_input_growth_allowed:true,
  meta_operation_self_rewrite_allowed:false,
  external_fast_summary_required:true,
  external_meta_operator_required:true,
  external_meta_evaluator_required:true,
  profile_activation_in_archive_allowed:false,
});
export const RSI_FIXED_META_OPERATION_DIGEST=dg(FIXED_META_OPERATION);

export function createRsiRuntimeMetaSkillRecord({
  source_sha,record_id,library,parent_profile,successor_profile,
  fast_loop_summary,plan,evaluation,result,
  external_archive_owner=false,authored_by_candidate=true,
}={}){
  const source=sha(source_sha,'source');
  if(external_archive_owner!==true||authored_by_candidate!==false)throw new Error('rsi_runtime_meta_external_archive_owner_required');
  const lib=verifyRsiVerifiedSkillLibrary(library);
  const parent=verifyRsiMetaSkillProfile(parent_profile,lib);
  const successor=verifyRsiMetaSkillProfile(successor_profile,lib);
  const fast=verifyRsiMetaSkillFastLoopSummary(fast_loop_summary,parent,lib);
  const checkedPlan=verifyRsiMetaSkillEvolutionPlan(plan,parent,successor,lib,fast);
  const checkedEval=verifyRsiMetaSkillEvaluation(evaluation,checkedPlan,parent,successor,lib,fast);
  const canonicalResult=finalizeRsiMetaSkillEvolution({
    plan:checkedPlan,parent_profile:parent,successor_profile:successor,library:lib,fast_loop_summary:fast,evaluation:checkedEval,
  });
  if(!result||result.result_digest!==canonicalResult.result_digest)throw new Error('rsi_runtime_meta_result_digest_mismatch');

  const core={
    schema:RSI_RUNTIME_META_SKILL_RECORD_SCHEMA,version:1,
    source_sha:source,record_id:id(record_id,'record_id'),
    fixed_meta_operation_digest:RSI_FIXED_META_OPERATION_DIGEST,
    library:lib,library_digest:lib.library_digest,
    parent_profile:parent,parent_profile_digest:parent.profile_digest,
    successor_profile:successor,successor_profile_digest:successor.profile_digest,
    fast_loop_summary:fast,fast_loop_summary_digest:fast.summary_digest,
    plan:checkedPlan,plan_digest:checkedPlan.plan_digest,
    evaluation:checkedEval,evaluation_digest:checkedEval.evaluation_digest,
    result:canonicalResult,result_digest:canonicalResult.result_digest,
    relation:canonicalResult.relation,state:canonicalResult.state,
    eligible_for_meta_archive:canonicalResult.eligible_for_meta_archive,
    fixed_meta_operation:true,meta_operation_self_rewrite_allowed:false,
    two_timescale_required:true,fast_and_slow_holdouts_separate:true,
    frozen_backbone_required:true,
    archive_admission_is_profile_activation:false,
    successor_profile_activation_authorized:false,
    existing_tournament_required:true,existing_recursive_risk_gate_required:true,
    candidate_can_activate_profile:false,candidate_can_modify_meta_operation:false,
    external_archive_owner:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,record_digest:dg(core)});
}

export function verifyRsiRuntimeMetaSkillRecord(row){
  if(!row||row.schema!==RSI_RUNTIME_META_SKILL_RECORD_SCHEMA||row.version!==1)throw new Error('rsi_runtime_meta_record_invalid');
  assertZero(row,'record');
  if(row.fixed_meta_operation_digest!==RSI_FIXED_META_OPERATION_DIGEST||row.fixed_meta_operation!==true
    ||row.meta_operation_self_rewrite_allowed!==false||row.two_timescale_required!==true
    ||row.fast_and_slow_holdouts_separate!==true||row.frozen_backbone_required!==true
    ||row.archive_admission_is_profile_activation!==false||row.successor_profile_activation_authorized!==false
    ||row.existing_tournament_required!==true||row.existing_recursive_risk_gate_required!==true
    ||row.candidate_can_activate_profile!==false||row.candidate_can_modify_meta_operation!==false
    ||row.external_archive_owner!==true||row.authored_by_candidate!==false)throw new Error('rsi_runtime_meta_record_policy_invalid');
  const canonical=createRsiRuntimeMetaSkillRecord({
    source_sha:row.source_sha,record_id:row.record_id,library:row.library,
    parent_profile:row.parent_profile,successor_profile:row.successor_profile,
    fast_loop_summary:row.fast_loop_summary,plan:row.plan,evaluation:row.evaluation,result:row.result,
    external_archive_owner:true,authored_by_candidate:false,
  });
  if(canonical.record_digest!==digest(row.record_digest,'record'))throw new Error('rsi_runtime_meta_record_digest_mismatch');
  return canonical;
}

function stateCore(source,records){
  const core={
    schema:RSI_RUNTIME_META_SKILL_ARCHIVE_SCHEMA,version:1,source_sha:source,
    fixed_meta_operation_digest:RSI_FIXED_META_OPERATION_DIGEST,
    records,record_count:records.length,
    eligible_count:records.filter(x=>x.eligible_for_meta_archive===true).length,
    rejected_count:records.filter(x=>x.state==='REJECTED_FROM_META_ARCHIVE').length,
    max_records:MAX_RECORDS,append_only:true,
    fixed_meta_operation:true,meta_operation_self_rewrite_allowed:false,
    active_profile_digest:null,archive_can_activate_profile:false,
    candidate_can_delete_records:false,candidate_can_rewrite_records:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,state_digest:dg(core)};
}

export class RsiRuntimeMetaSkillArchive{
  #path;#source;#records=[];#initialized=false;
  constructor({statePath,source_sha}={}){
    if(!statePath)throw new Error('rsi_runtime_meta_state_path_required');
    this.#path=path.resolve(statePath);this.#source=sha(source_sha,'source');
  }
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const parsed=JSON.parse(await fs.readFile(this.#path,'utf8'));assertZero(parsed,'state');
      if(parsed.schema!==RSI_RUNTIME_META_SKILL_ARCHIVE_SCHEMA||parsed.version!==1||parsed.source_sha!==this.#source
        ||parsed.fixed_meta_operation_digest!==RSI_FIXED_META_OPERATION_DIGEST||parsed.fixed_meta_operation!==true
        ||parsed.meta_operation_self_rewrite_allowed!==false||parsed.active_profile_digest!==null
        ||parsed.archive_can_activate_profile!==false||parsed.append_only!==true
        ||parsed.candidate_can_delete_records!==false||parsed.candidate_can_rewrite_records!==false)throw new Error('rsi_runtime_meta_state_invalid');
      const clone=structuredClone(parsed);delete clone.state_digest;
      if(dg(clone)!==digest(parsed.state_digest,'state'))throw new Error('rsi_runtime_meta_state_digest_mismatch');
      if(!Array.isArray(parsed.records)||parsed.records.length>MAX_RECORDS)throw new Error('rsi_runtime_meta_records_invalid');
      const ids=new Set(),digests=new Set();
      this.#records=parsed.records.map(row=>{
        const checked=verifyRsiRuntimeMetaSkillRecord(row);
        if(checked.source_sha!==this.#source)throw new Error('rsi_runtime_meta_record_source_mismatch');
        if(ids.has(checked.record_id)||digests.has(checked.record_digest))throw new Error('rsi_runtime_meta_record_duplicate');
        ids.add(checked.record_id);digests.add(checked.record_digest);return checked;
      });
    }catch(e){if(e?.code!=='ENOENT')throw e}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(){const s=stateCore(this.#source,this.#records);const temp=`${this.#path}.tmp`;const h=await fs.open(temp,'w',0o600);try{await h.writeFile(`${JSON.stringify(s)}\n`,'utf8');await h.sync()}finally{await h.close()}await fs.rename(temp,this.#path);return s}
  async add(record){
    if(!this.#initialized)throw new Error('rsi_runtime_meta_archive_not_initialized');
    const checked=verifyRsiRuntimeMetaSkillRecord(record);
    if(checked.source_sha!==this.#source)throw new Error('rsi_runtime_meta_record_source_mismatch');
    const existing=this.#records.find(x=>x.record_id===checked.record_id||x.record_digest===checked.record_digest);
    if(existing){
      if(existing.record_digest!==checked.record_digest)throw new Error('rsi_runtime_meta_record_identity_conflict');
      return zero({state:'IDEMPOTENT',record_digest:checked.record_digest});
    }
    if(this.#records.length>=MAX_RECORDS)throw new Error('rsi_runtime_meta_archive_capacity_exceeded');
    this.#records.push(checked);await this.#persist();
    return zero({state:checked.state,record_digest:checked.record_digest});
  }
  recordByDigest(record_digest){
    if(!this.#initialized)throw new Error('rsi_runtime_meta_archive_not_initialized');
    const d=digest(String(record_digest||'').toLowerCase());
    const row=this.#records.find(x=>x.record_digest===String(record_digest||'').toLowerCase());
    return row?Object.freeze(structuredClone(row)):null;
  }
  eligible(){
    if(!this.#initialized)throw new Error('rsi_runtime_meta_archive_not_initialized');
    return Object.freeze(this.#records.filter(x=>x.eligible_for_meta_archive===true).map(x=>Object.freeze(structuredClone(x))));
  }
  snapshot(){
    const s=stateCore(this.#source,this.#records);
    return Object.freeze({
      schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,
      fixed_meta_operation_digest:s.fixed_meta_operation_digest,record_count:s.record_count,
      eligible_count:s.eligible_count,rejected_count:s.rejected_count,max_records:s.max_records,
      append_only:true,fixed_meta_operation:true,meta_operation_self_rewrite_allowed:false,
      active_profile_digest:null,archive_can_activate_profile:false,
      execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
      scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
    });
  }
}

export function rsiRuntimeMetaSkillArchiveTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.runtime-meta-skill-archive-root.v1',version:1,
    fixed_meta_operation_digest:RSI_FIXED_META_OPERATION_DIGEST,
    fixed_meta_operation:true,meta_operation_self_rewrite_allowed:false,
    two_timescale_meta_evolution_required:true,frozen_backbone_required:true,
    fast_and_slow_holdouts_separate:true,external_fast_summary_required:true,
    external_meta_operator_required:true,external_meta_evaluator_required:true,
    pareto_and_tradeoff_archive_allowed:true,scalar_winner_authoritative:false,
    archive_can_activate_profile:false,candidate_can_activate_profile:false,
    existing_tournament_required:true,existing_recursive_risk_gate_required:true,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,meta_archive_root_digest:dg(root)});
}
