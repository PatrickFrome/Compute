import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { verifyRsiVerifiedSkillLibrary } from './rsi-verified-skill-library.mjs';
import {
  createRsiSkillLifecycleEvidence,
  createRsiSkillLibraryGovernance,
  createRsiSkillActivationView,
  verifyRsiSkillLibraryGovernance,
} from './rsi-skill-library-governance.mjs';
import { verifyRsiStepCreditReceipt } from './rsi-runtime-credit-assignment.mjs';

export const RSI_RUNTIME_SKILL_LIFECYCLE_SCHEMA='metaengine.rsi.runtime-skill-lifecycle.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const PRIORS=new Set(['VERIFIED_META_SKILL','VERIFIED_DIRECT_SKILL','LEGACY_IMPORTED']);
const MAX_PENDING=4096;
const MAX_EVIDENCE=16384;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactSha(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(o))throw new Error(`rsi_runtime_skill_${l}_sha_invalid`);return o}
function exactDigest(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(o))throw new Error(`rsi_runtime_skill_${l}_digest_invalid`);return o}
function boundedId(v,l){const o=String(v||'').trim();if(!SAFE_ID_RE.test(o))throw new Error(`rsi_runtime_skill_${l}_invalid`);return o}
function positiveInt(v,l,max=1000000){const o=Number(v);if(!Number.isSafeInteger(o)||o<1||o>max)throw new Error(`rsi_runtime_skill_${l}_invalid`);return o}
function prior(v){const o=String(v||'LEGACY_IMPORTED').trim().toUpperCase();if(!PRIORS.has(o))throw new Error('rsi_runtime_skill_authoring_prior_invalid');return o}
function assertEpisode(e){
  if(!e||typeof e!=='object'||Array.isArray(e)||e.schema!=='metaengine.rsi.browser-outcome-episode.v1')throw new Error('rsi_runtime_skill_episode_invalid');
  if(e.authority_effect!==false||e.execution_authority!==false||e.automatic_retry_allowed!==false||e.quarantined===true)throw new Error('rsi_runtime_skill_episode_not_eligible');
  if(e.eligible_for_skill_evidence!==true||!Array.isArray(e.skill_digests)||e.skill_digests.length<1)throw new Error('rsi_runtime_skill_episode_has_no_verified_skill_usage');
  exactDigest(e.episode_digest,'episode');
  return e;
}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false})}
function stateCore({sourceSha,library,lifecycleEvidence,pending,windowSeqBySkill}){
  const core={
    schema:RSI_RUNTIME_SKILL_LIFECYCLE_SCHEMA,version:1,source_sha:sourceSha,
    library:library||null,library_digest:library?.library_digest||null,
    lifecycle_evidence:lifecycleEvidence,
    pending,
    window_seq_by_skill:Object.fromEntries([...windowSeqBySkill.entries()].sort(([a],[b])=>a.localeCompare(b))),
    evidence_append_only:true,pending_is_bounded:true,max_pending:MAX_PENDING,max_evidence:MAX_EVIDENCE,
    candidate_can_write_lifecycle:false,candidate_can_reactivate_skill:false,candidate_can_retire_skill:false,
    credit_required_for_lifecycle_update:true,contextual_credit_not_global_truth:true,
    raw_model_transcript_stored:false,raw_page_text_stored:false,raw_user_input_stored:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,state_digest:digest(core)};
}

export class RsiRuntimeSkillLifecycle{
  #path;#sourceSha;#clock;#library=null;#evidence=[];#pending=[];#seq=new Map();#initialized=false;
  constructor({statePath,source_sha,clock=()=>Date.now()}={}){
    if(!statePath||typeof statePath!=='string')throw new Error('rsi_runtime_skill_state_path_required');
    if(typeof clock!=='function')throw new Error('rsi_runtime_skill_clock_required');
    this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'source');this.#clock=clock;
  }
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const parsed=JSON.parse(await fs.readFile(this.#path,'utf8'));
      if(parsed.schema!==RSI_RUNTIME_SKILL_LIFECYCLE_SCHEMA||parsed.version!==1||parsed.source_sha!==this.#sourceSha||parsed.authority_effect!==false||parsed.candidate_can_write_lifecycle!==false)throw new Error('rsi_runtime_skill_state_invalid');
      const clone=structuredClone(parsed);delete clone.state_digest;
      if(digest(clone)!==exactDigest(parsed.state_digest,'state'))throw new Error('rsi_runtime_skill_state_digest_mismatch');
      if(parsed.library){
        this.#library=verifyRsiVerifiedSkillLibrary(parsed.library);
        if(this.#library.library_digest!==parsed.library_digest)throw new Error('rsi_runtime_skill_library_digest_mismatch');
      }
      if(!Array.isArray(parsed.lifecycle_evidence)||parsed.lifecycle_evidence.length>MAX_EVIDENCE)throw new Error('rsi_runtime_skill_evidence_state_invalid');
      if(!Array.isArray(parsed.pending)||parsed.pending.length>MAX_PENDING)throw new Error('rsi_runtime_skill_pending_state_invalid');
      this.#evidence=parsed.lifecycle_evidence;
      this.#pending=parsed.pending;
      this.#seq=new Map(Object.entries(parsed.window_seq_by_skill||{}).map(([k,v])=>[exactDigest(k,'skill_seq'),positiveInt(v,'window_seq')]));
      if(this.#library){
        createRsiSkillLibraryGovernance({
          governance_id:this.#governanceId(),library:this.#library,lifecycle_evidence:this.#evidence,
          external_library_owner:true,authored_by_candidate:false,
        });
      }else if(this.#evidence.length>0)throw new Error('rsi_runtime_skill_evidence_without_library');
    }catch(error){if(error?.code!=='ENOENT')throw error}
    this.#initialized=true;return this.snapshot();
  }
  #now(){const n=Number(this.#clock());if(!Number.isFinite(n))throw new Error('rsi_runtime_skill_clock_invalid');return new Date(n).toISOString()}
  #governanceId(){return `runtime.skill.governance.${this.#sourceSha.slice(0,16)}`}
  async #persist(){
    const state=stateCore({sourceSha:this.#sourceSha,library:this.#library,lifecycleEvidence:this.#evidence,pending:this.#pending,windowSeqBySkill:this.#seq});
    const temp=`${this.#path}.tmp`;const handle=await fs.open(temp,'w',0o600);
    try{await handle.writeFile(`${JSON.stringify(state)}\n`,'utf8');await handle.sync()}finally{await handle.close()}
    await fs.rename(temp,this.#path);return state;
  }
  #assertInit(){if(!this.#initialized)throw new Error('rsi_runtime_skill_not_initialized')}
  #libraryContainsAll(skillDigests){return !!this.#library&&skillDigests.every(d=>this.#library.entries.some(e=>e.skill_digest===d))}
  #assertAppendOnlyLibrary(next){
    if(!this.#library)return;
    if(next.library_id!==this.#library.library_id)throw new Error('rsi_runtime_skill_library_identity_drift');
    const current=new Map(this.#library.entries.map(e=>[e.skill_digest,e]));
    const incoming=new Map(next.entries.map(e=>[e.skill_digest,e]));
    for(const [skillDigest,row] of current){
      const candidate=incoming.get(skillDigest);
      if(!candidate||candidate.evidence_digest!==row.evidence_digest||candidate.skill_id!==row.skill_id||candidate.skill_version!==row.skill_version)throw new Error('rsi_runtime_skill_library_non_append_only_update');
    }
  }
  async adoptVerifiedLibrary({library,external_library_owner=false,authored_by_candidate=true}={}){
    this.#assertInit();
    if(external_library_owner!==true||authored_by_candidate!==false)throw new Error('rsi_runtime_skill_library_external_origin_required');
    const checked=verifyRsiVerifiedSkillLibrary(library);
    this.#assertAppendOnlyLibrary(checked);
    const changed=this.#library?.library_digest!==checked.library_digest;
    this.#library=checked;
    const reconciled=await this.#reconcilePendingInternal();
    await this.#persist();
    return zero({state:changed?'ADOPTED':'UNCHANGED',library_digest:checked.library_digest,entry_count:checked.entry_count,reconciled_pending:reconciled});
  }
  #nextSeq(skillDigest){const next=(this.#seq.get(skillDigest)||0)+1;this.#seq.set(skillDigest,next);return next}
  #materializeOne({episode,credit_receipt,generation,router_engaged,false_positive_injection,hard_invariant_violation,authoring_prior,authoring_provenance_digest}){
    const e=assertEpisode(episode);
    const credit=verifyRsiStepCreditReceipt(credit_receipt,e);
    const gen=positiveInt(generation,'generation');
    const p=prior(authoring_prior);
    const provenance=exactDigest(authoring_provenance_digest,'authoring_provenance');
    const rows=[];
    for(const skillDigest of e.skill_digests){
      const entry=this.#library.entries.find(x=>x.skill_digest===skillDigest);
      if(!entry)throw new Error('rsi_runtime_skill_unknown_skill_digest');
      const sign=credit.credit_sign;
      const seq=this.#nextSeq(skillDigest);
      rows.push(createRsiSkillLifecycleEvidence({
        library:this.#library,
        evidence_id:`runtime.skill.window.${skillDigest.slice(-16)}.${seq}`,
        skill_digest:skillDigest,
        window_seq:seq,
        generation_start:gen,generation_end:gen,
        invocation_count:1,
        helpful_count:sign==='POSITIVE'?1:0,
        harmful_count:sign==='NEGATIVE'?1:0,
        neutral_count:sign==='NEUTRAL'?1:0,
        insufficient_evidence_count:0,
        router_engagement_count:1,
        false_positive_injection_count:false_positive_injection===true?1:0,
        hard_invariant_violation_count:hard_invariant_violation===true?1:0,
        measured_net_delta:credit.credit_score,
        authoring_prior:p,
        authoring_provenance_digest:provenance,
        evidence_refs:[`episode:${e.episode_digest}`,`credit:${credit.receipt_digest}`],
        external_evaluator:true,authored_by_candidate:false,
      }));
    }
    if(this.#evidence.length+rows.length>MAX_EVIDENCE)throw new Error('rsi_runtime_skill_evidence_capacity_exceeded');
    this.#evidence.push(...rows);
    return rows;
  }
  async #reconcilePendingInternal(){
    if(!this.#library||this.#pending.length===0)return 0;
    const remaining=[];let applied=0;
    for(const item of this.#pending){
      if(!this.#libraryContainsAll(item.episode.skill_digests)){remaining.push(item);continue}
      this.#materializeOne(item);applied+=1;
    }
    this.#pending=remaining;return applied;
  }
  async recordCreditedOutcome({
    episode,credit_receipt,generation,
    router_engaged=true,false_positive_injection=false,hard_invariant_violation=false,
    authoring_prior='LEGACY_IMPORTED',authoring_provenance_digest,
    external_evaluator=false,authored_by_candidate=true,
  }={}){
    this.#assertInit();
    if(external_evaluator!==true||authored_by_candidate!==false)throw new Error('rsi_runtime_skill_external_evidence_required');
    const e=assertEpisode(episode);const credit=verifyRsiStepCreditReceipt(credit_receipt,e);
    if(router_engaged!==true)throw new Error('rsi_runtime_skill_router_engagement_required_for_attributed_invocation');
    const item={
      episode:e,credit_receipt:credit,generation:positiveInt(generation,'generation'),
      router_engaged:true,false_positive_injection:false_positive_injection===true,
      hard_invariant_violation:hard_invariant_violation===true,
      authoring_prior:prior(authoring_prior),
      authoring_provenance_digest:exactDigest(authoring_provenance_digest,'authoring_provenance'),
      captured_at:this.#now(),
    };
    if(this.#evidence.some(row=>row.evidence_refs.includes(`credit:${credit.receipt_digest}`))){
      return zero({state:'IDEMPOTENT',applied:false,credit_receipt_digest:credit.receipt_digest});
    }
    if(this.#pending.some(row=>row.credit_receipt.receipt_digest===credit.receipt_digest)){
      return zero({state:'HELD_NO_LIBRARY',applied:false,credit_receipt_digest:credit.receipt_digest});
    }
    if(!this.#libraryContainsAll(e.skill_digests)){
      if(this.#pending.length>=MAX_PENDING)throw new Error('rsi_runtime_skill_pending_capacity_exceeded');
      this.#pending.push(item);await this.#persist();
      return zero({state:'HELD_NO_LIBRARY',applied:false,credit_receipt_digest:credit.receipt_digest});
    }
    const rows=this.#materializeOne(item);await this.#persist();
    return zero({state:'APPLIED',applied:true,credit_receipt_digest:credit.receipt_digest,evidence_digests:rows.map(r=>r.evidence_digest)});
  }
  verifiedLibrarySnapshot(){
    this.#assertInit();
    return this.#library ? structuredClone(this.#library) : null;
  }
  governance(){
    this.#assertInit();if(!this.#library)return null;
    return createRsiSkillLibraryGovernance({
      governance_id:this.#governanceId(),library:this.#library,lifecycle_evidence:this.#evidence,
      external_library_owner:true,authored_by_candidate:false,
    });
  }
  activationView(requestedSkillDigests){
    const governance=this.governance();if(!governance)throw new Error('rsi_runtime_skill_library_unavailable');
    verifyRsiSkillLibraryGovernance(governance,this.#library);
    return createRsiSkillActivationView({
      governance,library:this.#library,requested_skill_digests:requestedSkillDigests,
      external_planner:true,authored_by_candidate:false,
    });
  }
  snapshot(){
    const governance=this.#library?this.governance():null;
    return Object.freeze({
      schema:RSI_RUNTIME_SKILL_LIFECYCLE_SCHEMA,version:1,source_sha:this.#sourceSha,initialized:this.#initialized,
      library_present:this.#library!=null,library_digest:this.#library?.library_digest||null,
      library_entry_count:this.#library?.entry_count||0,lifecycle_evidence_count:this.#evidence.length,pending_count:this.#pending.length,
      governance_digest:governance?.governance_digest||null,
      active_count:governance?.active_count||0,quarantined_count:governance?.quarantined_count||0,
      retired_count:governance?.retired_count||0,dormant_count:governance?.dormant_count||0,
      evidence_append_only:true,pending_is_bounded:true,contextual_credit_not_global_truth:true,
      candidate_can_write_lifecycle:false,candidate_can_reactivate_skill:false,candidate_can_retire_skill:false,
      execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
      automatic_retry_allowed:false,authority_effect:false,
    });
  }
}

export function rsiRuntimeSkillLifecycleTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.runtime-skill-lifecycle-root.v1',version:1,
    policy_path:'apps/metaengine-browser/src/rsi-runtime-skill-lifecycle.mjs',
    verified_library_required:true,library_updates_append_only:true,
    independently_credited_outcomes_only:true,contextual_credit_not_global_truth:true,
    lifecycle_windows_are_append_only:true,bounded_pending_before_library:true,
    candidate_can_write_lifecycle:false,candidate_can_reactivate_skill:false,candidate_can_retire_skill:false,
    skill_activation_view_is_execution_authority:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,skill_lifecycle_root_digest:digest(root)});
}
