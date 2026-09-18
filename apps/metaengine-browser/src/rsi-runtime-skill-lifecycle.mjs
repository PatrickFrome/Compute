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
const MAX_APPEND_ATTEMPTS=2048;
const MAX_EXPOSURE_RELEASE_ATTEMPTS=2048;

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
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,signing_authority:false,direct_tool_execution_authority:false,automatic_retry_allowed:false,authority_effect:false})}
function stateCore({sourceSha,library,lifecycleEvidence,pending,windowSeqBySkill,exposureHolds,appendAttempts,exposureReleaseAttempts}){
  const holds=Object.freeze([...exposureHolds].sort());
  const core={
    schema:RSI_RUNTIME_SKILL_LIFECYCLE_SCHEMA,version:1,source_sha:sourceSha,
    library:library||null,library_digest:library?.library_digest||null,
    lifecycle_evidence:lifecycleEvidence,
    pending,
    admission_exposure_hold_skill_digests:holds,
    admission_exposure_hold_count:holds.length,
    append_attempts:appendAttempts,
    append_attempt_count:appendAttempts.length,
    exposure_release_attempts:exposureReleaseAttempts,
    exposure_release_attempt_count:exposureReleaseAttempts.length,
    window_seq_by_skill:Object.fromEntries([...windowSeqBySkill.entries()].sort(([a],[b])=>a.localeCompare(b))),
    evidence_append_only:true,pending_is_bounded:true,max_pending:MAX_PENDING,max_evidence:MAX_EVIDENCE,max_append_attempts:MAX_APPEND_ATTEMPTS,
    max_exposure_release_attempts:MAX_EXPOSURE_RELEASE_ATTEMPTS,
    append_attempts_are_durable_before_effect:true,ambiguous_append_retry_allowed:false,
    exposure_release_attempts_are_durable_before_effect:true,ambiguous_exposure_release_retry_allowed:false,
    admission_exposure_holds_force_dormant:true,admission_exposure_hold_release_requires_external_governance:true,
    candidate_can_write_lifecycle:false,candidate_can_reactivate_skill:false,candidate_can_retire_skill:false,
    credit_required_for_lifecycle_update:true,contextual_credit_not_global_truth:true,
    raw_model_transcript_stored:false,raw_page_text_stored:false,raw_user_input_stored:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,state_digest:digest(core)};
}

export class RsiRuntimeSkillLifecycle{
  #path;#sourceSha;#clock;#library=null;#evidence=[];#pending=[];#seq=new Map();#exposureHolds=new Set();#appendAttempts=[];#exposureReleaseAttempts=[];#initialized=false;
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
      if(!Array.isArray(parsed.admission_exposure_hold_skill_digests||[])||Number(parsed.admission_exposure_hold_count||0)!==(parsed.admission_exposure_hold_skill_digests||[]).length)throw new Error('rsi_runtime_skill_exposure_hold_state_invalid');
      if(!Array.isArray(parsed.append_attempts||[])||(parsed.append_attempts||[]).length>MAX_APPEND_ATTEMPTS||Number(parsed.append_attempt_count||0)!==(parsed.append_attempts||[]).length)throw new Error('rsi_runtime_skill_append_attempt_state_invalid');
      if(!Array.isArray(parsed.exposure_release_attempts||[])||(parsed.exposure_release_attempts||[]).length>MAX_EXPOSURE_RELEASE_ATTEMPTS||Number(parsed.exposure_release_attempt_count||0)!==(parsed.exposure_release_attempts||[]).length)throw new Error('rsi_runtime_skill_exposure_release_attempt_state_invalid');
      this.#evidence=parsed.lifecycle_evidence;
      this.#pending=parsed.pending;
      this.#exposureHolds=new Set((parsed.admission_exposure_hold_skill_digests||[]).map(x=>exactDigest(x,'exposure_hold_skill')));
      this.#appendAttempts=(parsed.append_attempts||[]).map(row=>Object.freeze(structuredClone(row)));
      this.#exposureReleaseAttempts=(parsed.exposure_release_attempts||[]).map(row=>Object.freeze(structuredClone(row)));
      this.#seq=new Map(Object.entries(parsed.window_seq_by_skill||{}).map(([k,v])=>[exactDigest(k,'skill_seq'),positiveInt(v,'window_seq')]));
      if(this.#library){
        for(const held of this.#exposureHolds)if(!this.#library.entries.some(e=>e.skill_digest===held))throw new Error('rsi_runtime_skill_exposure_hold_unknown_skill');
        createRsiSkillLibraryGovernance({
          governance_id:this.#governanceId(),library:this.#library,lifecycle_evidence:this.#evidence,
          admission_exposure_hold_skill_digests:[...this.#exposureHolds],
          external_library_owner:true,authored_by_candidate:false,
        });
      }else if(this.#evidence.length>0)throw new Error('rsi_runtime_skill_evidence_without_library');
    }catch(error){if(error?.code!=='ENOENT')throw error}
    this.#initialized=true;return this.snapshot();
  }
  #now(){const n=Number(this.#clock());if(!Number.isFinite(n))throw new Error('rsi_runtime_skill_clock_invalid');return new Date(n).toISOString()}
  #governanceId(){return `runtime.skill.governance.${this.#sourceSha.slice(0,16)}`}
  async #persist(){
    const state=stateCore({sourceSha:this.#sourceSha,library:this.#library,lifecycleEvidence:this.#evidence,pending:this.#pending,windowSeqBySkill:this.#seq,exposureHolds:this.#exposureHolds,appendAttempts:this.#appendAttempts,exposureReleaseAttempts:this.#exposureReleaseAttempts});
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
  #newSkillDigests(next){
    if(!this.#library)return [];
    const current=new Set(this.#library.entries.map(e=>e.skill_digest));
    return next.entries.map(e=>e.skill_digest).filter(d=>!current.has(d)).sort();
  }
  #normalizeHoldDigests(values){
    if(!Array.isArray(values))throw new Error('rsi_runtime_skill_exposure_holds_invalid');
    const out=values.map(x=>exactDigest(x,'exposure_hold_skill')).sort();
    if(new Set(out).size!==out.length)throw new Error('rsi_runtime_skill_exposure_hold_duplicate');
    return out;
  }
  async adoptVerifiedLibrary({library,admission_exposure_hold_skill_digests=[],external_library_owner=false,authored_by_candidate=true}={}){
    this.#assertInit();
    if(external_library_owner!==true||authored_by_candidate!==false)throw new Error('rsi_runtime_skill_library_external_origin_required');
    const checked=verifyRsiVerifiedSkillLibrary(library);
    this.#assertAppendOnlyLibrary(checked);
    const holds=this.#normalizeHoldDigests(admission_exposure_hold_skill_digests);
    const newDigests=this.#newSkillDigests(checked);
    if(this.#library&&newDigests.length>0&&JSON.stringify(holds)!==JSON.stringify(newDigests))throw new Error('rsi_runtime_skill_append_exposure_hold_required');
    for(const held of holds)if(!checked.entries.some(e=>e.skill_digest===held))throw new Error('rsi_runtime_skill_exposure_hold_unknown_skill');
    const changed=this.#library?.library_digest!==checked.library_digest;
    const previousLibrary=this.#library;
    const previousEvidence=this.#evidence;
    const previousPending=this.#pending;
    const previousSeq=this.#seq;
    const previousHolds=this.#exposureHolds;
    this.#library=checked;
    this.#evidence=[...this.#evidence];
    this.#pending=[...this.#pending];
    this.#seq=new Map(this.#seq);
    this.#exposureHolds=new Set(this.#exposureHolds);
    for(const held of holds)this.#exposureHolds.add(held);
    let reconciled=0;
    try{
      reconciled=await this.#reconcilePendingInternal();
      await this.#persist();
    }catch(error){
      this.#library=previousLibrary;this.#evidence=previousEvidence;this.#pending=previousPending;this.#seq=previousSeq;this.#exposureHolds=previousHolds;
      throw error;
    }
    return zero({state:changed?'ADOPTED':'UNCHANGED',library_digest:checked.library_digest,entry_count:checked.entry_count,reconciled_pending:reconciled,admission_exposure_hold_skill_digests:Object.freeze(holds),retrieval_exposure_changed:false});
  }
  #replaceAppendAttempt(nextRow){
    this.#appendAttempts=this.#appendAttempts.map(row=>row.attempt_id===nextRow.attempt_id?Object.freeze(nextRow):row);
  }
  #governanceWithHolds(holds){
    if(!this.#library)return null;
    return createRsiSkillLibraryGovernance({
      governance_id:this.#governanceId(),library:this.#library,lifecycle_evidence:this.#evidence,
      admission_exposure_hold_skill_digests:[...holds],
      external_library_owner:true,authored_by_candidate:false,
    });
  }
  previewAdmissionExposureRelease({skill_digest}={}){
    this.#assertInit();
    if(!this.#library)throw new Error('rsi_runtime_skill_exposure_release_library_required');
    const skillDigest=exactDigest(skill_digest,'exposure_release_skill');
    if(!this.#exposureHolds.has(skillDigest))throw new Error('rsi_runtime_skill_exposure_release_hold_required');
    const current=this.governance();
    const nextHolds=new Set(this.#exposureHolds);nextHolds.delete(skillDigest);
    const next=this.#governanceWithHolds(nextHolds);
    const currentRow=current.entries.find(row=>row.skill_digest===skillDigest);
    const nextRow=next.entries.find(row=>row.skill_digest===skillDigest);
    if(!currentRow||!nextRow)throw new Error('rsi_runtime_skill_exposure_release_skill_missing');
    const changed=current.entries.filter(row=>{
      const n=next.entries.find(x=>x.skill_digest===row.skill_digest);
      return !n||row.state!==n.state||row.active_for_composition!==n.active_for_composition||row.admission_exposure_held!==n.admission_exposure_held;
    }).map(row=>row.skill_digest).sort();
    const core=zero({
      schema:'metaengine.rsi.skill-exposure-release-preview.v1',version:1,
      source_sha:this.#sourceSha,library_digest:this.#library.library_digest,
      current_governance_digest:current.governance_digest,next_governance_digest:next.governance_digest,
      skill_digest:skillDigest,current_state:currentRow.state,current_active_for_composition:currentRow.active_for_composition,
      current_admission_exposure_held:currentRow.admission_exposure_held,
      next_state:nextRow.state,next_active_for_composition:nextRow.active_for_composition,
      next_admission_exposure_held:nextRow.admission_exposure_held,
      changed_skill_digests:Object.freeze(changed),only_target_state_changed:changed.length===1&&changed[0]===skillDigest,
      active_count_delta:next.active_count-current.active_count,hold_count_delta:next.admission_exposure_hold_count-current.admission_exposure_hold_count,
      preview_is_effect_authority:false,
    });
    return Object.freeze({...core,preview_digest:digest(core)});
  }
  #replaceExposureReleaseAttempt(nextRow){
    this.#exposureReleaseAttempts=this.#exposureReleaseAttempts.map(row=>row.attempt_id===nextRow.attempt_id?Object.freeze(nextRow):row);
  }
  exposureReleaseAttemptReadback({attempt_id,release_certificate_digest}={}){
    this.#assertInit();
    const attemptId=boundedId(attempt_id,'exposure_release_attempt_id');
    const certificateDigest=exactDigest(release_certificate_digest,'exposure_release_certificate');
    const row=this.#exposureReleaseAttempts.find(x=>x.attempt_id===attemptId&&x.release_certificate_digest===certificateDigest);
    if(!row)return zero({found:false,attempt_id:attemptId,state:null,retrieval_exposure_changed:false});
    return zero({
      found:true,attempt_id:attemptId,state:row.state,skill_digest:row.skill_digest,
      expected_current_library_digest:row.expected_current_library_digest,
      expected_current_governance_digest:row.expected_current_governance_digest,
      expected_next_governance_digest:row.expected_next_governance_digest,
      retrieval_exposure_changed:row.state==='CONFIRMED'||row.state==='CONFIRMED_BY_READBACK',
    });
  }
  async releaseAdmissionExposureHoldOneAttempt({
    attempt_id,release_certificate_digest,skill_digest,expected_current_library_digest,
    expected_current_governance_digest,expected_next_governance_digest,
    external_governance_owner=false,authored_by_candidate=true,
  }={}){
    this.#assertInit();
    if(external_governance_owner!==true||authored_by_candidate!==false)throw new Error('rsi_runtime_skill_exposure_release_external_owner_required');
    const attemptId=boundedId(attempt_id,'exposure_release_attempt_id');
    const certificateDigest=exactDigest(release_certificate_digest,'exposure_release_certificate');
    const skillDigest=exactDigest(skill_digest,'exposure_release_skill');
    const expectedLibrary=exactDigest(expected_current_library_digest,'exposure_release_expected_library');
    const expectedGovernance=exactDigest(expected_current_governance_digest,'exposure_release_expected_governance');
    const expectedNextGovernance=exactDigest(expected_next_governance_digest,'exposure_release_expected_next_governance');
    const existing=this.#exposureReleaseAttempts.find(row=>row.attempt_id===attemptId||row.release_certificate_digest===certificateDigest);
    if(existing){
      if(existing.attempt_id!==attemptId||existing.release_certificate_digest!==certificateDigest)throw new Error('rsi_runtime_skill_exposure_release_attempt_identity_conflict');
      if(existing.state==='ATTEMPT_STARTED')throw new Error('rsi_runtime_skill_exposure_release_attempt_ambiguous_reconcile_required');
      return zero({state:'ALREADY_RECORDED',attempt_state:existing.state,attempt_id:existing.attempt_id,retrieval_exposure_changed:existing.state==='CONFIRMED'||existing.state==='CONFIRMED_BY_READBACK'});
    }
    if(this.#exposureReleaseAttempts.length>=MAX_EXPOSURE_RELEASE_ATTEMPTS)throw new Error('rsi_runtime_skill_exposure_release_attempt_capacity_exceeded');
    if(!this.#library||this.#library.library_digest!==expectedLibrary)throw new Error('rsi_runtime_skill_exposure_release_current_library_drift');
    const current=this.governance();
    if(current.governance_digest!==expectedGovernance)throw new Error('rsi_runtime_skill_exposure_release_current_governance_drift');
    const preview=this.previewAdmissionExposureRelease({skill_digest:skillDigest});
    if(preview.next_governance_digest!==expectedNextGovernance)throw new Error('rsi_runtime_skill_exposure_release_next_governance_drift');
    if(preview.next_state!=='EXPLORATION_ACTIVE'||preview.only_target_state_changed!==true||preview.active_count_delta!==1||preview.hold_count_delta!==-1)throw new Error('rsi_runtime_skill_exposure_release_preview_not_bounded');
    const prepared=Object.freeze({
      attempt_id:attemptId,release_certificate_digest:certificateDigest,skill_digest:skillDigest,
      expected_current_library_digest:expectedLibrary,expected_current_governance_digest:expectedGovernance,
      expected_next_governance_digest:expectedNextGovernance,preview_digest:preview.preview_digest,
      state:'PREPARED',prepared_at:this.#now(),attempt_started_at:null,confirmed_at:null,
      one_attempt_only:true,ambiguous_retry_allowed:false,exploration_only:true,authority_effect:false,
    });
    this.#exposureReleaseAttempts=[...this.#exposureReleaseAttempts,prepared];await this.#persist();
    const started=Object.freeze({...prepared,state:'ATTEMPT_STARTED',attempt_started_at:this.#now()});
    this.#replaceExposureReleaseAttempt(started);await this.#persist();
    const previousHolds=this.#exposureHolds;
    this.#exposureHolds=new Set(this.#exposureHolds);this.#exposureHolds.delete(skillDigest);
    try{await this.#persist();}catch(error){this.#exposureHolds=previousHolds;throw error}
    const confirmed=Object.freeze({...started,state:'CONFIRMED',confirmed_at:this.#now(),confirmed_governance_digest:this.governance().governance_digest});
    this.#replaceExposureReleaseAttempt(confirmed);
    try{await this.#persist();}catch(error){this.#replaceExposureReleaseAttempt(started);throw error}
    return zero({state:'CONFIRMED',attempt_id:attemptId,skill_digest:skillDigest,current_library_digest:this.#library.library_digest,
      governance_digest:this.governance().governance_digest,retrieval_exposure_changed:true,release_mode:'EXPLORATION_ACTIVE_ONLY',
      full_activation_authorized:false,automatic_retry_allowed:false});
  }
  async reconcileAdmissionExposureReleaseAttempt({attempt_id,release_certificate_digest}={}){
    this.#assertInit();
    const attemptId=boundedId(attempt_id,'exposure_release_attempt_id');
    const certificateDigest=exactDigest(release_certificate_digest,'exposure_release_certificate');
    const row=this.#exposureReleaseAttempts.find(x=>x.attempt_id===attemptId&&x.release_certificate_digest===certificateDigest);
    if(!row)throw new Error('rsi_runtime_skill_exposure_release_attempt_not_found');
    if(row.state!=='ATTEMPT_STARTED')return zero({state:'ALREADY_TERMINAL',attempt_state:row.state,attempt_id:attemptId,retrieval_exposure_changed:row.state==='CONFIRMED'||row.state==='CONFIRMED_BY_READBACK'});
    const libraryDigest=this.#library?.library_digest||null;
    const governance=this.#library?this.governance():null;
    let state='DIVERGED';
    if(libraryDigest===row.expected_current_library_digest&&!this.#exposureHolds.has(row.skill_digest)&&governance?.governance_digest===row.expected_next_governance_digest)state='CONFIRMED_BY_READBACK';
    else if(libraryDigest===row.expected_current_library_digest&&this.#exposureHolds.has(row.skill_digest)&&governance?.governance_digest===row.expected_current_governance_digest)state='NO_EFFECT_CONFIRMED';
    const terminal=Object.freeze({...row,state,reconciled_at:this.#now(),observed_library_digest:libraryDigest,observed_governance_digest:governance?.governance_digest||null});
    this.#replaceExposureReleaseAttempt(terminal);await this.#persist();
    return zero({state,attempt_id:attemptId,observed_library_digest:libraryDigest,observed_governance_digest:governance?.governance_digest||null,
      retry_performed:false,automatic_retry_allowed:false,retrieval_exposure_changed:state==='CONFIRMED_BY_READBACK'});
  }
  async adoptVerifiedLibraryOneAttempt({
    attempt_id,admission_certificate_digest,expected_current_library_digest,expected_current_governance_digest,
    proposed_library,proposed_library_digest,hold_new_skill_digests,external_library_owner=false,authored_by_candidate=true,
  }={}){
    this.#assertInit();
    if(external_library_owner!==true||authored_by_candidate!==false)throw new Error('rsi_runtime_skill_append_external_origin_required');
    const attemptId=boundedId(attempt_id,'append_attempt_id');
    const certificateDigest=exactDigest(admission_certificate_digest,'append_certificate');
    const expectedLibrary=exactDigest(expected_current_library_digest,'append_expected_library');
    const expectedGovernance=exactDigest(expected_current_governance_digest,'append_expected_governance');
    const proposedDigest=exactDigest(proposed_library_digest,'append_proposed_library');
    const existing=this.#appendAttempts.find(row=>row.attempt_id===attemptId||row.admission_certificate_digest===certificateDigest);
    if(existing){
      if(existing.attempt_id!==attemptId||existing.admission_certificate_digest!==certificateDigest)throw new Error('rsi_runtime_skill_append_attempt_identity_conflict');
      if(existing.state==='ATTEMPT_STARTED')throw new Error('rsi_runtime_skill_append_attempt_ambiguous_reconcile_required');
      return zero({state:'ALREADY_RECORDED',attempt_state:existing.state,attempt_id:existing.attempt_id,library_digest:this.#library?.library_digest||null,retrieval_exposure_changed:false});
    }
    if(this.#appendAttempts.length>=MAX_APPEND_ATTEMPTS)throw new Error('rsi_runtime_skill_append_attempt_capacity_exceeded');
    if(!this.#library)throw new Error('rsi_runtime_skill_append_current_library_required');
    const currentGovernance=this.governance();
    if(this.#library.library_digest!==expectedLibrary)throw new Error('rsi_runtime_skill_append_current_library_drift');
    if(currentGovernance.governance_digest!==expectedGovernance)throw new Error('rsi_runtime_skill_append_current_governance_drift');
    const checked=verifyRsiVerifiedSkillLibrary(proposed_library);
    if(checked.library_digest!==proposedDigest)throw new Error('rsi_runtime_skill_append_proposed_library_digest_mismatch');
    this.#assertAppendOnlyLibrary(checked);
    const newDigests=this.#newSkillDigests(checked);
    const holds=this.#normalizeHoldDigests(hold_new_skill_digests);
    if(newDigests.length<1||JSON.stringify(newDigests)!==JSON.stringify(holds))throw new Error('rsi_runtime_skill_append_exact_new_skill_hold_required');
    const prepared=Object.freeze({
      attempt_id:attemptId,admission_certificate_digest:certificateDigest,
      expected_current_library_digest:expectedLibrary,expected_current_governance_digest:expectedGovernance,
      proposed_library_digest:proposedDigest,new_skill_digests:Object.freeze(newDigests),exposure_hold_skill_digests:Object.freeze(holds),
      state:'PREPARED',prepared_at:this.#now(),attempt_started_at:null,confirmed_at:null,
      one_attempt_only:true,ambiguous_retry_allowed:false,retrieval_exposure_change_authorized:false,authority_effect:false,
    });
    this.#appendAttempts=[...this.#appendAttempts,prepared];await this.#persist();
    const started=Object.freeze({...prepared,state:'ATTEMPT_STARTED',attempt_started_at:this.#now()});
    this.#replaceAppendAttempt(started);await this.#persist();
    const adoption=await this.adoptVerifiedLibrary({
      library:checked,admission_exposure_hold_skill_digests:holds,external_library_owner:true,authored_by_candidate:false,
    });
    const confirmed=Object.freeze({...started,state:'CONFIRMED',confirmed_at:this.#now(),confirmed_library_digest:adoption.library_digest});
    this.#replaceAppendAttempt(confirmed);
    try{await this.#persist();}catch(error){this.#replaceAppendAttempt(started);throw error}
    return zero({state:'CONFIRMED',attempt_id:attemptId,admission_certificate_digest:certificateDigest,library_digest:adoption.library_digest,entry_count:adoption.entry_count,held_skill_digests:Object.freeze(holds),retrieval_exposure_changed:false,automatic_retry_allowed:false});
  }
  async reconcileVerifiedLibraryAppendAttempt({attempt_id,admission_certificate_digest}={}){
    this.#assertInit();
    const attemptId=boundedId(attempt_id,'append_attempt_id');
    const certificateDigest=exactDigest(admission_certificate_digest,'append_certificate');
    const row=this.#appendAttempts.find(x=>x.attempt_id===attemptId&&x.admission_certificate_digest===certificateDigest);
    if(!row)throw new Error('rsi_runtime_skill_append_attempt_not_found');
    if(row.state!=='ATTEMPT_STARTED')return zero({state:'ALREADY_TERMINAL',attempt_state:row.state,attempt_id:attemptId,retrieval_exposure_changed:false});
    const current=this.#library?.library_digest||null;
    let state='DIVERGED';
    if(current===row.proposed_library_digest)state='CONFIRMED_BY_READBACK';
    else if(current===row.expected_current_library_digest)state='NO_EFFECT_CONFIRMED';
    const terminal=Object.freeze({...row,state,reconciled_at:this.#now(),observed_library_digest:current});
    this.#replaceAppendAttempt(terminal);await this.#persist();
    return zero({state,attempt_id:attemptId,observed_library_digest:current,automatic_retry_allowed:false,retrieval_exposure_changed:false});
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
      admission_exposure_hold_skill_digests:[...this.#exposureHolds],
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
      admission_exposure_hold_skill_digests:Object.freeze([...this.#exposureHolds].sort()),
      admission_exposure_hold_count:this.#exposureHolds.size,append_attempt_count:this.#appendAttempts.length,
      ambiguous_append_attempt_count:this.#appendAttempts.filter(x=>x.state==='ATTEMPT_STARTED').length,
      exposure_release_attempt_count:this.#exposureReleaseAttempts.length,
      ambiguous_exposure_release_attempt_count:this.#exposureReleaseAttempts.filter(x=>x.state==='ATTEMPT_STARTED').length,
      active_count:governance?.active_count||0,quarantined_count:governance?.quarantined_count||0,
      retired_count:governance?.retired_count||0,dormant_count:governance?.dormant_count||0,
      evidence_append_only:true,pending_is_bounded:true,contextual_credit_not_global_truth:true,
      append_attempts_are_durable_before_effect:true,ambiguous_append_retry_allowed:false,
      exposure_release_attempts_are_durable_before_effect:true,ambiguous_exposure_release_retry_allowed:false,
      admission_exposure_holds_force_dormant:true,admission_exposure_hold_release_requires_external_governance:true,
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
    append_new_skills_require_exposure_hold:true,admission_exposure_holds_force_dormant:true,
    admission_exposure_hold_release_requires_external_governance:true,
    one_attempt_append_journal_durable_before_effect:true,ambiguous_append_retry_allowed:false,
    exposure_release_preview_required:true,exposure_release_exploration_only:true,
    exposure_release_only_target_governance_change_allowed:true,one_attempt_exposure_release_journal_durable_before_effect:true,
    ambiguous_exposure_release_retry_allowed:false,
    independently_credited_outcomes_only:true,contextual_credit_not_global_truth:true,
    lifecycle_windows_are_append_only:true,bounded_pending_before_library:true,
    candidate_can_write_lifecycle:false,candidate_can_reactivate_skill:false,candidate_can_retire_skill:false,
    skill_activation_view_is_execution_authority:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,skill_lifecycle_root_digest:digest(root)});
}