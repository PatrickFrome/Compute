import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createRsiExperienceCase,
  createRsiExperienceGraphSnapshot,
  extendRsiExperienceGraphSnapshot,
  verifyRsiExperienceGraphSnapshot,
} from './rsi-experience-graph.mjs';
import { verifyRsiStepCreditReceipt } from './rsi-runtime-credit-assignment.mjs';

export const RSI_RUNTIME_EXPERIENCE_STORE_SCHEMA='metaengine.rsi.runtime-experience-store.v1';
export const RSI_RUNTIME_EXPERIENCE_MATERIALIZATION_SCHEMA='metaengine.rsi.runtime-experience-materialization.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE=/^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactSha(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(o))throw new Error(`rsi_experience_store_${l}_sha_invalid`);return o}
function exactDigest(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(o))throw new Error(`rsi_experience_store_${l}_digest_invalid`);return o}
function boundedId(v,l){const o=String(v||'').trim();if(!SAFE_ID_RE.test(o))throw new Error(`rsi_experience_store_${l}_invalid`);return o}
function token(v,l){const o=String(v||'').trim().toUpperCase();if(!SAFE_TOKEN_RE.test(o))throw new Error(`rsi_experience_store_${l}_invalid`);return o}
function assertEpisode(e){
  if(!e||typeof e!=='object'||Array.isArray(e)||e.schema!=='metaengine.rsi.browser-outcome-episode.v1')throw new Error('rsi_experience_store_episode_invalid');
  if(e.authority_effect!==false||e.execution_authority!==false||e.automatic_retry_allowed!==false||e.quarantined===true||e.eligible_for_credit_assignment!==true)throw new Error('rsi_experience_store_episode_not_eligible');
  exactDigest(e.episode_digest,'episode');exactDigest(e.receipt_digest,'receipt');exactDigest(e.context_digest,'context');
  return e;
}
function normalizeAnchor(anchor,episode){
  if(!anchor||typeof anchor!=='object'||Array.isArray(anchor))throw new Error('rsi_experience_store_task_anchor_required');
  if(anchor.external_writer!==true||anchor.authored_by_candidate!==false)throw new Error('rsi_experience_store_task_anchor_external_origin_required');
  const out=Object.freeze({
    task_id:boundedId(anchor.task_id,'task_id'),
    task_signature_digest:exactDigest(anchor.task_signature_digest,'task_signature'),
    challenge_family:token(anchor.challenge_family,'challenge_family'),
    hidden_manifest_digest:exactDigest(anchor.hidden_manifest_digest,'hidden_manifest'),
    external_writer:true,authored_by_candidate:false,
  });
  if(out.task_id!==episode.task_id||out.task_signature_digest!==episode.task_signature_digest)throw new Error('rsi_experience_store_task_anchor_episode_mismatch');
  return out;
}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false})}

export function materializeRsiExperienceCaseFromCredit({episode,credit_receipt,task_anchor}={}){
  const e=assertEpisode(episode);
  const credit=verifyRsiStepCreditReceipt(credit_receipt,e);
  const anchor=normalizeAnchor(task_anchor,e);
  if(credit.credit_sign==='NEUTRAL'){
    return zero({
      schema:RSI_RUNTIME_EXPERIENCE_MATERIALIZATION_SCHEMA,version:1,state:'HELD_NEUTRAL',
      episode_digest:e.episode_digest,credit_receipt_digest:credit.receipt_digest,
      case_row:null,task_anchor:anchor,
      neutral_credit_is_not_success_or_failure:true,candidate_can_write_graph:false,
    });
  }
  const outcome=credit.credit_sign==='POSITIVE'?'SUCCESS':'FAILURE';
  const mechanismTags=[
    `ACTION_${e.action}`,
    ...(e.lane?[ `LANE_${e.lane}` ]:[]),
    `CREDIT_${credit.method}`,
  ];
  const attributionDigests=[e.context_digest,credit.receipt_digest];
  if(e.predecessor_episode_digest)attributionDigests.push(e.predecessor_episode_digest);
  const evidenceDigest=digest({
    episode_digest:e.episode_digest,
    receipt_digest:e.receipt_digest,
    credit_receipt_digest:credit.receipt_digest,
    task_anchor:anchor,
  });
  const caseRow=createRsiExperienceCase({
    case_id:`case.${e.command_id}`,
    task_id:e.task_id,
    task_signature_digest:e.task_signature_digest,
    attempt_index:e.step_index,
    candidate_id:e.candidate_id,
    candidate_sha:e.candidate_sha,
    outcome,
    environment_fingerprint:e.environment_fingerprint,
    model_family:e.model_family,
    execution_signature_digest:e.receipt_digest,
    failure_codes:outcome==='FAILURE'?credit.failure_codes:[],
    mechanism_tags:mechanismTags,
    lesson_digests:credit.lesson_digests,
    attribution_digests:attributionDigests,
    transfer_receipt_digests:[],
    evidence_digest:evidenceDigest,
    evidence_refs:[`episode:${e.episode_digest}`,`credit:${credit.receipt_digest}`],
    external_writer:true,
    authored_by_candidate:false,
  });
  return zero({
    schema:RSI_RUNTIME_EXPERIENCE_MATERIALIZATION_SCHEMA,version:1,state:'MATERIALIZED',
    episode_digest:e.episode_digest,credit_receipt_digest:credit.receipt_digest,
    case_row:caseRow,task_anchor:anchor,
    neutral_credit_is_not_success_or_failure:true,candidate_can_write_graph:false,
  });
}

function wrapper(sourceSha,graphSnapshot){
  const core={
    schema:RSI_RUNTIME_EXPERIENCE_STORE_SCHEMA,version:1,source_sha:sourceSha,
    graph_snapshot:graphSnapshot,
    graph_snapshot_digest:graphSnapshot?.snapshot_digest||null,
    append_only_graph_chain:true,candidate_can_write_graph:false,
    raw_trajectory_stored:false,raw_page_text_stored:false,raw_user_input_stored:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,state_digest:digest(core)};
}

export class RsiRuntimeExperienceStore{
  #path;#sourceSha;#graphId;#snapshot=null;#initialized=false;
  constructor({statePath,source_sha,graph_id=null}={}){
    if(!statePath||typeof statePath!=='string')throw new Error('rsi_experience_store_state_path_required');
    this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'source');
    this.#graphId=boundedId(graph_id||`runtime.experience.${this.#sourceSha.slice(0,16)}`,'graph_id');
  }
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const parsed=JSON.parse(await fs.readFile(this.#path,'utf8'));
      if(parsed.schema!==RSI_RUNTIME_EXPERIENCE_STORE_SCHEMA||parsed.version!==1||parsed.source_sha!==this.#sourceSha||parsed.authority_effect!==false||parsed.candidate_can_write_graph!==false)throw new Error('rsi_experience_store_state_invalid');
      const clone=structuredClone(parsed);delete clone.state_digest;
      if(digest(clone)!==exactDigest(parsed.state_digest,'state'))throw new Error('rsi_experience_store_state_digest_mismatch');
      if(parsed.graph_snapshot){
        this.#snapshot=verifyRsiExperienceGraphSnapshot(parsed.graph_snapshot);
        if(this.#snapshot.graph_id!==this.#graphId)throw new Error('rsi_experience_store_graph_id_mismatch');
      }
    }catch(error){if(error?.code!=='ENOENT')throw error}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(){
    const state=wrapper(this.#sourceSha,this.#snapshot);
    const temp=`${this.#path}.tmp`;const handle=await fs.open(temp,'w',0o600);
    try{await handle.writeFile(`${JSON.stringify(state)}\n`,'utf8');await handle.sync()}finally{await handle.close()}
    await fs.rename(temp,this.#path);return state;
  }
  async appendMaterialization(materialization){
    if(!this.#initialized)throw new Error('rsi_experience_store_not_initialized');
    if(!materialization||materialization.schema!==RSI_RUNTIME_EXPERIENCE_MATERIALIZATION_SCHEMA)throw new Error('rsi_experience_store_materialization_invalid');
    if(materialization.authority_effect!==false||materialization.candidate_can_write_graph!==false)throw new Error('rsi_experience_store_materialization_policy_invalid');
    if(materialization.state==='HELD_NEUTRAL')return zero({state:'HELD_NEUTRAL',appended:false,case_digest:null,snapshot_digest:this.#snapshot?.snapshot_digest||null});
    if(materialization.state!=='MATERIALIZED'||!materialization.case_row)throw new Error('rsi_experience_store_materialization_state_invalid');
    const caseRow=materialization.case_row;const anchor=materialization.task_anchor;
    if(this.#snapshot){
      const existingCase=this.#snapshot.cases.find(x=>x.case_id===caseRow.case_id);
      if(existingCase){
        if(existingCase.case_digest!==caseRow.case_digest)throw new Error('rsi_experience_store_case_identity_conflict');
        return zero({state:'IDEMPOTENT',appended:false,case_digest:caseRow.case_digest,snapshot_digest:this.#snapshot.snapshot_digest});
      }
      const existingAnchor=this.#snapshot.task_anchors.find(x=>x.task_id===anchor.task_id);
      if(existingAnchor&&JSON.stringify(stable(existingAnchor))!==JSON.stringify(stable(anchor)))throw new Error('rsi_experience_store_task_anchor_conflict');
      this.#snapshot=extendRsiExperienceGraphSnapshot({
        previous_snapshot:this.#snapshot,
        task_anchors:existingAnchor?[]:[anchor],
        cases:[caseRow],
      });
    }else{
      this.#snapshot=createRsiExperienceGraphSnapshot({
        graph_id:this.#graphId,epoch:1,task_anchors:[anchor],cases:[caseRow],
      });
    }
    await this.#persist();
    return zero({state:'APPENDED',appended:true,case_digest:caseRow.case_digest,snapshot_digest:this.#snapshot.snapshot_digest});
  }
  graphSnapshot(){return this.#snapshot?structuredClone(this.#snapshot):null}
  snapshot(){
    return Object.freeze({
      schema:RSI_RUNTIME_EXPERIENCE_STORE_SCHEMA,version:1,source_sha:this.#sourceSha,graph_id:this.#graphId,
      initialized:this.#initialized,graph_present:this.#snapshot!=null,
      graph_epoch:this.#snapshot?.epoch||0,case_count:this.#snapshot?.case_count||0,task_anchor_count:this.#snapshot?.task_anchor_count||0,
      snapshot_digest:this.#snapshot?.snapshot_digest||null,
      append_only_graph_chain:true,candidate_can_write_graph:false,raw_trajectory_stored:false,
      execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
      automatic_retry_allowed:false,authority_effect:false,
    });
  }
}

export function rsiRuntimeExperienceStoreTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.runtime-experience-store-root.v1',version:1,
    policy_path:'apps/metaengine-browser/src/rsi-runtime-experience-store.mjs',
    independently_credited_episode_required:true,
    neutral_credit_materialization_forbidden:true,
    append_only_graph_chain:true,exact_task_anchor_required:true,
    candidate_can_write_graph:false,raw_trajectory_stored:false,raw_page_text_stored:false,raw_user_input_stored:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,experience_store_root_digest:digest(root)});
}
