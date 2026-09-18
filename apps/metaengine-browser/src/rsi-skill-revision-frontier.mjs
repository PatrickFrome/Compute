import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  verifyRsiSkillCurationRequest,
  verifyRsiSkillRevisionEvaluation,
} from './rsi-runtime-skill-curation.mjs';

export const RSI_SKILL_REVISION_FRONTIER_CANDIDATE_SCHEMA='metaengine.rsi.skill-revision-frontier-candidate.v1';
export const RSI_SKILL_REVISION_FRONTIER_SCHEMA='metaengine.rsi.skill-revision-frontier.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_ARCHIVE=1024;
const MAX_FRONTIER_RETURN=16;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactSha(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(o))throw new Error(`rsi_frontier_${l}_sha_invalid`);return o}
function exactDigest(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(o))throw new Error(`rsi_frontier_${l}_digest_invalid`);return o}
function boundedId(v,l){const o=String(v||'').trim();if(!SAFE_ID_RE.test(o))throw new Error(`rsi_frontier_${l}_invalid`);return o}
function positiveInt(v,l,max=1000000){const o=Number(v);if(!Number.isSafeInteger(o)||o<1||o>max)throw new Error(`rsi_frontier_${l}_invalid`);return o}
function assertZero(v,l){
  for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','signing_authority','authority_effect']){
    if(v?.[f]!==false)throw new Error(`rsi_frontier_${l}_${f}_invalid`);
  }
  if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_frontier_${l}_automatic_retry_invalid`);
}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false})}

export function createRsiSkillRevisionFrontierCandidate({
  source_sha,request,evaluation,library,governance,
  external_frontier_owner=false,authored_by_candidate=true,
}={}){
  const sourceSha=exactSha(source_sha,'source');
  const req=verifyRsiSkillCurationRequest(request,{library,governance});
  const evalRow=verifyRsiSkillRevisionEvaluation(evaluation,{request:req,library,governance});
  if(external_frontier_owner!==true||authored_by_candidate!==false)throw new Error('rsi_frontier_external_owner_required');
  if(evalRow.accepted_for_existing_reliability_gate!==true||evalRow.state!=='ELIGIBLE_FOR_EXISTING_RELIABILITY_GATE'){
    throw new Error('rsi_frontier_only_accepted_revision_allowed');
  }
  const core={
    schema:RSI_SKILL_REVISION_FRONTIER_CANDIDATE_SCHEMA,version:1,
    source_sha:sourceSha,
    candidate_id:boundedId(`frontier.${req.request_id}`,'candidate_id'),
    request_id:req.request_id,
    request_digest:req.request_digest,
    parent_skill_digest:req.parent_skill_digest,
    successor_skill_digest:evalRow.successor_skill_digest,
    evaluation_result_digest:evalRow.result_digest,
    validation_delta:evalRow.validation_delta,
    meta_delta:evalRow.meta_delta,
    edit_budget:req.edit_budget,
    optimizer_model_family:req.optimizer_model_family,
    reason:req.reason,
    validation_holdout_digest:req.validation_holdout_digest,
    meta_holdout_digest:req.meta_holdout_digest,
    hard_invariants_pass:evalRow.hard_invariants_pass,
    objective_vector:Object.freeze({
      validation_delta:evalRow.validation_delta,
      meta_delta:evalRow.meta_delta,
      edit_budget:req.edit_budget,
    }),
    archive_retained:true,
    pareto_membership_is_advisory:true,
    existing_reliability_gate_required:true,
    existing_scope_preservation_gate_required:true,
    direct_library_replacement_allowed:false,
    candidate_can_edit_objectives:false,
    candidate_can_self_select_frontier:false,
    frontier_is_execution_authority:false,
    external_frontier_owner:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,frontier_candidate_digest:digest(core)});
}

export function verifyRsiSkillRevisionFrontierCandidate(row,{request,evaluation,library,governance}={}){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_SKILL_REVISION_FRONTIER_CANDIDATE_SCHEMA||row.version!==1)throw new Error('rsi_frontier_candidate_invalid');
  assertZero(row,'candidate');
  if(row.archive_retained!==true||row.pareto_membership_is_advisory!==true||row.existing_reliability_gate_required!==true
    ||row.existing_scope_preservation_gate_required!==true||row.direct_library_replacement_allowed!==false
    ||row.candidate_can_edit_objectives!==false||row.candidate_can_self_select_frontier!==false
    ||row.frontier_is_execution_authority!==false||row.external_frontier_owner!==true||row.authored_by_candidate!==false){
    throw new Error('rsi_frontier_candidate_policy_invalid');
  }
  const canonical=createRsiSkillRevisionFrontierCandidate({
    source_sha:row.source_sha,request,evaluation,library,governance,
    external_frontier_owner:true,authored_by_candidate:false,
  });
  if(canonical.frontier_candidate_digest!==exactDigest(row.frontier_candidate_digest,'candidate'))throw new Error('rsi_frontier_candidate_digest_mismatch');
  return canonical;
}

function dominates(a,b){
  const weak=
    a.validation_delta>=b.validation_delta
    && a.meta_delta>=b.meta_delta
    && a.edit_budget<=b.edit_budget;
  const strict=
    a.validation_delta>b.validation_delta
    || a.meta_delta>b.meta_delta
    || a.edit_budget<b.edit_budget;
  return weak&&strict;
}

function paretoRows(rows,parentSkillDigest=null){
  const pool=parentSkillDigest==null?rows:rows.filter(row=>row.parent_skill_digest===parentSkillDigest);
  return pool.filter(row=>!pool.some(other=>other.frontier_candidate_digest!==row.frontier_candidate_digest&&dominates(other,row)))
    .sort((a,b)=>
      b.validation_delta-a.validation_delta
      || b.meta_delta-a.meta_delta
      || a.edit_budget-b.edit_budget
      || a.frontier_candidate_digest.localeCompare(b.frontier_candidate_digest));
}

function stateCore(sourceSha,archive){
  const frontier=paretoRows(archive);
  const core={
    schema:RSI_SKILL_REVISION_FRONTIER_SCHEMA,version:1,source_sha:sourceSha,
    archive,
    archive_count:archive.length,
    frontier_candidate_digests:frontier.map(x=>x.frontier_candidate_digest),
    frontier_count:frontier.length,
    objective_directions:Object.freeze({
      validation_delta:'MAXIMIZE',
      meta_delta:'MAXIMIZE',
      edit_budget:'MINIMIZE',
    }),
    archive_is_append_only:true,
    dominated_candidates_retained:true,
    frontier_recomputed_deterministically:true,
    pareto_selection_is_advisory:true,
    direct_library_replacement_allowed:false,
    candidate_can_delete_archive:false,
    candidate_can_select_frontier:false,
    frontier_is_execution_authority:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,state_digest:digest(core)};
}

export class RsiSkillRevisionFrontier{
  #path;#sourceSha;#archive=[];#initialized=false;
  constructor({statePath,source_sha}={}){
    if(!statePath||typeof statePath!=='string')throw new Error('rsi_frontier_state_path_required');
    this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'source');
  }
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const parsed=JSON.parse(await fs.readFile(this.#path,'utf8'));
      assertZero(parsed,'state');
      if(parsed.schema!==RSI_SKILL_REVISION_FRONTIER_SCHEMA||parsed.version!==1||parsed.source_sha!==this.#sourceSha
        ||parsed.archive_is_append_only!==true||parsed.dominated_candidates_retained!==true
        ||parsed.candidate_can_delete_archive!==false||parsed.candidate_can_select_frontier!==false
        ||parsed.frontier_is_execution_authority!==false||parsed.direct_library_replacement_allowed!==false){
        throw new Error('rsi_frontier_state_invalid');
      }
      const clone=structuredClone(parsed);delete clone.state_digest;
      if(digest(clone)!==exactDigest(parsed.state_digest,'state'))throw new Error('rsi_frontier_state_digest_mismatch');
      if(!Array.isArray(parsed.archive)||parsed.archive.length>MAX_ARCHIVE)throw new Error('rsi_frontier_archive_invalid');
      const seen=new Set();
      for(const row of parsed.archive){
        if(row.schema!==RSI_SKILL_REVISION_FRONTIER_CANDIDATE_SCHEMA||row.source_sha!==this.#sourceSha)throw new Error('rsi_frontier_archive_candidate_invalid');
        assertZero(row,'candidate');
        exactDigest(row.frontier_candidate_digest,'candidate');
        if(seen.has(row.frontier_candidate_digest))throw new Error('rsi_frontier_archive_duplicate');
        seen.add(row.frontier_candidate_digest);
      }
      const canonicalFrontier=paretoRows(parsed.archive).map(x=>x.frontier_candidate_digest);
      if(JSON.stringify(canonicalFrontier)!==JSON.stringify(parsed.frontier_candidate_digests))throw new Error('rsi_frontier_projection_mismatch');
      this.#archive=parsed.archive;
    }catch(error){if(error?.code!=='ENOENT')throw error}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(){
    const state=stateCore(this.#sourceSha,this.#archive);
    const temp=`${this.#path}.tmp`;const handle=await fs.open(temp,'w',0o600);
    try{await handle.writeFile(`${JSON.stringify(state)}\n`,'utf8');await handle.sync()}finally{await handle.close()}
    await fs.rename(temp,this.#path);return state;
  }
  #assertInit(){if(!this.#initialized)throw new Error('rsi_frontier_not_initialized')}
  async add({candidate}={}){
    this.#assertInit();
    if(!candidate||candidate.schema!==RSI_SKILL_REVISION_FRONTIER_CANDIDATE_SCHEMA||candidate.version!==1)throw new Error('rsi_frontier_candidate_invalid');
    assertZero(candidate,'candidate');
    if(candidate.source_sha!==this.#sourceSha)throw new Error('rsi_frontier_candidate_source_mismatch');
    const digestValue=exactDigest(candidate.frontier_candidate_digest,'candidate');
    const existing=this.#archive.find(x=>x.frontier_candidate_digest===digestValue);
    if(existing)return zero({state:'IDEMPOTENT',frontier_candidate_digest:digestValue});
    if(this.#archive.length>=MAX_ARCHIVE)throw new Error('rsi_frontier_archive_capacity_exceeded');
    if(this.#archive.some(x=>x.successor_skill_digest===candidate.successor_skill_digest&&x.evaluation_result_digest!==candidate.evaluation_result_digest)){
      throw new Error('rsi_frontier_successor_evaluation_conflict');
    }
    this.#archive.push(structuredClone(candidate));
    await this.#persist();
    const isFrontier=paretoRows(this.#archive,candidate.parent_skill_digest)
      .some(x=>x.frontier_candidate_digest===digestValue);
    return zero({state:'ARCHIVED',frontier_candidate_digest:digestValue,pareto_frontier:isFrontier});
  }
  frontier({parent_skill_digest,max_candidates=MAX_FRONTIER_RETURN}={}){
    this.#assertInit();
    const parent=parent_skill_digest==null?null:exactDigest(parent_skill_digest,'parent_skill');
    const max=positiveInt(max_candidates,'max_candidates',MAX_FRONTIER_RETURN);
    return Object.freeze(paretoRows(this.#archive,parent).slice(0,max).map(row=>Object.freeze(structuredClone(row))));
  }
  snapshot(){
    const state=stateCore(this.#sourceSha,this.#archive);
    return Object.freeze({
      schema:state.schema,version:state.version,source_sha:state.source_sha,initialized:this.#initialized,
      archive_count:state.archive_count,frontier_count:state.frontier_count,
      frontier_candidate_digests:[...state.frontier_candidate_digests],
      objective_directions:state.objective_directions,
      archive_is_append_only:true,dominated_candidates_retained:true,frontier_recomputed_deterministically:true,
      pareto_selection_is_advisory:true,direct_library_replacement_allowed:false,
      candidate_can_delete_archive:false,candidate_can_select_frontier:false,frontier_is_execution_authority:false,
      execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
      scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
    });
  }
}

export function rsiSkillRevisionFrontierTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.skill-revision-frontier-root.v1',version:1,
    policy_path:'apps/metaengine-browser/src/rsi-skill-revision-frontier.mjs',
    accepted_heldout_revisions_only:true,
    objectives:Object.freeze({
      validation_delta:'MAXIMIZE',
      meta_delta:'MAXIMIZE',
      edit_budget:'MINIMIZE',
    }),
    pareto_frontier_required:true,archive_is_append_only:true,dominated_candidates_retained:true,
    diverse_lineages_preserved:true,greedy_single_winner_replacement_forbidden:true,
    existing_reliability_gate_required:true,existing_scope_preservation_gate_required:true,
    direct_library_replacement_allowed:false,candidate_can_delete_archive:false,candidate_can_select_frontier:false,
    frontier_is_execution_authority:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,frontier_root_digest:digest(root)});
}
