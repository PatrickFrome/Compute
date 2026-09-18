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
import { verifyRsiAnytimeLibraryAdmissionCertificate } from './rsi-anytime-library-admission.mjs';

export const RSI_RUNTIME_SKILL_LIFECYCLE_SCHEMA='metaengine.rsi.runtime-skill-lifecycle.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const PRIORS=new Set(['VERIFIED_META_SKILL','VERIFIED_DIRECT_SKILL','LEGACY_IMPORTED']);
const MAX_PENDING=4096;
const MAX_EVIDENCE=16384;
const MAX_APPEND_ADMISSIONS=512;

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
function stateCore({sourceSha,library,lifecycleEvidence,pending,windowSeqBySkill,appendAdmissions}){
  const core={
    schema:RSI_RUNTIME_SKILL_LIFECYCLE_SCHEMA,version:1,source_sha:sourceSha,
    library:library||null,library_digest:library?.library_digest||null,
    lifecycle_evidence:lifecycleEvidence,
    pending,
    append_admissions:appendAdmissions,
    append_admission_count:appendAdmissions.length,
    ambiguous_append_count:appendAdmissions.filter(row=>row.state==='AMBIGUOUS_RECONCILIATION_REQUIRED').length,
    window_seq_by_skill:Object.fromEntries([...windowSeqBySkill.entries()].sort(([a],[b])=>a.localeCompare(b))),
    evidence_append_only:true,pending_is_bounded:true,max_pending:MAX_PENDING,max_evidence:MAX_EVIDENCE,
    append_admissions_bounded:true,max_append_admissions:MAX_APPEND_ADMISSIONS,
    append_plan_durable_before_effect:true,append_effect_attempt_limit:1,blind_append_retry_forbidden:true,
    append_reconciliation_readback_only:true,append_does_not_imply_activation:true,
    candidate_can_write_lifecycle:false,candidate_can_reactivate_skill:false,candidate_can_retire_skill:false,
    credit_required_for_lifecycle_update:true,contextual_credit_not_global_truth:true,
    raw_model_transcript_stored:false,raw_page_text_stored:false,raw_user_input_stored:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,state_digest:digest(core)};
}

export class RsiRuntimeSkillLifecycle{
  #path;#sourceSha;#clock;#library=null;#evidence=[];#pending=[];#appendAdmissions=[];#seq=new Map();#initialized=false;
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
      const appendAdmissions=parsed.append_admissions??[];
      if(!Array.isArray(appendAdmissions)||appendAdmissions.length>MAX_APPEND_ADMISSIONS)throw new Error('rsi_runtime_skill_append_admissions_state_invalid');
      const seenAppendIds=new Set(),seenEffectIds=new Set(),seenIdempotency=new Set();
      for(const row of appendAdmissions){
        if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('rsi_runtime_skill_append_admission_invalid');
        const admissionId=boundedId(row.admission_id,'append_admission_id');
        const effectId=exactDigest(row.append_effect_id_digest,'append_effect_id');
        const idempotency=exactDigest(row.idempotency_key_digest,'append_idempotency_key');
        exactDigest(row.admission_certificate_digest,'append_certificate');
        exactDigest(row.expected_predecessor_library_digest,'append_predecessor');
        exactDigest(row.expected_successor_library_digest,'append_successor');
        if(seenAppendIds.has(admissionId)||seenEffectIds.has(effectId)||seenIdempotency.has(idempotency))throw new Error('rsi_runtime_skill_append_admission_duplicate');
        seenAppendIds.add(admissionId);seenEffectIds.add(effectId);seenIdempotency.add(idempotency);
        if(!Number.isSafeInteger(row.effect_attempt_count)||row.effect_attempt_count<0||row.effect_attempt_count>1)throw new Error('rsi_runtime_skill_append_attempt_count_invalid');
        if(row.blind_retry_authorized!==false||row.retrieval_exposure_changed!==false||row.skill_activation_performed!==false||row.lifecycle_mutation_performed!==false)throw new Error('rsi_runtime_skill_append_admission_policy_invalid');
      }
      this.#evidence=parsed.lifecycle_evidence;
      this.#pending=parsed.pending;
      this.#appendAdmissions=appendAdmissions;
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
  async #persistSnapshot({library=this.#library,appendAdmissions=this.#appendAdmissions}={}){
    const state=stateCore({sourceSha:this.#sourceSha,library,lifecycleEvidence:this.#evidence,pending:this.#pending,windowSeqBySkill:this.#seq,appendAdmissions});
    const temp=`${this.#path}.tmp`;const handle=await fs.open(temp,'w',0o600);
    try{await handle.writeFile(`${JSON.stringify(state)}\n`,'utf8');await handle.sync()}finally{await handle.close()}
    await fs.rename(temp,this.#path);return state;
  }
  async #persist(){return this.#persistSnapshot();}
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

  #appendAdmission(admissionId){
    const idValue=boundedId(admissionId,'append_admission_id');
    const row=this.#appendAdmissions.find(item=>item.admission_id===idValue);
    if(!row)throw new Error('rsi_runtime_skill_append_admission_not_found');
    return row;
  }
  #verifyAppendCertificate(row,certificate,certificateArgs){
    const checked=verifyRsiAnytimeLibraryAdmissionCertificate(certificate,certificateArgs||{});
    if(checked.admission_certificate_digest!==row.admission_certificate_digest)throw new Error('rsi_runtime_skill_append_certificate_mismatch');
    if(checked.state!=='ELIGIBLE_FOR_ONE_ATTEMPT_EXISTING_LIBRARY_APPEND_HANDOFF'
      ||checked.append_handoff_one_attempt_only!==true||checked.ambiguous_append_retry_allowed!==false
      ||checked.append_effect_performed!==false||checked.library_append_token!==null
      ||checked.retrieval_exposure_change_authorized!==false||checked.skill_activation_authorized!==false
      ||checked.lifecycle_mutation_authorized!==false){
      throw new Error('rsi_runtime_skill_append_certificate_not_eligible');
    }
    return checked;
  }
  #certificatePrincipals(certificate){
    return new Set([
      certificate.library_owner_identity_digest,
      certificate.statistical_acceptor_identity_digest,
      certificate.source_qualification_owner_identity_digest,
      certificate.least_privilege_reviewer_identity_digest,
      certificate.governance_reviewer_identity_digest,
      certificate.benchmark_security_attestor_identity_digest,
    ].filter(Boolean).map((value)=>exactDigest(value,'append_certificate_principal')));
  }
  async prepareStorageOnlyAppendAdmission({
    admission_id,admission_certificate,admission_certificate_args,proposed_successor_library,
    append_effect_id_digest,idempotency_key_digest,external_effect_planner_identity_digest,
    external_library_owner=false,external_effect_planner=false,authored_by_candidate=true,
  }={}){
    this.#assertInit();
    if(external_library_owner!==true||external_effect_planner!==true||authored_by_candidate!==false){
      throw new Error('rsi_runtime_skill_append_external_planner_required');
    }
    if(!this.#library)throw new Error('rsi_runtime_skill_library_unavailable');
    const certificate=verifyRsiAnytimeLibraryAdmissionCertificate(admission_certificate,admission_certificate_args||{});
    if(certificate.state!=='ELIGIBLE_FOR_ONE_ATTEMPT_EXISTING_LIBRARY_APPEND_HANDOFF'
      ||certificate.append_handoff_one_attempt_only!==true||certificate.ambiguous_append_retry_allowed!==false
      ||certificate.append_effect_performed!==false||certificate.library_append_token!==null){
      throw new Error('rsi_runtime_skill_append_certificate_not_eligible');
    }
    if(certificate.current_library_digest!==this.#library.library_digest)throw new Error('rsi_runtime_skill_append_cas_predecessor_mismatch');
    const successor=verifyRsiVerifiedSkillLibrary(proposed_successor_library);
    if(successor.library_id!==this.#library.library_id)throw new Error('rsi_runtime_skill_append_library_identity_drift');
    if(successor.library_digest!==certificate.proposed_successor_library_digest)throw new Error('rsi_runtime_skill_append_successor_digest_mismatch');
    this.#assertAppendOnlyLibrary(successor);
    if(successor.entries.length!==this.#library.entries.length+1)throw new Error('rsi_runtime_skill_append_exactly_one_skill_required');
    const predecessorDigests=new Set(this.#library.entries.map(row=>row.skill_digest));
    const added=successor.entries.filter(row=>!predecessorDigests.has(row.skill_digest));
    if(added.length!==1||added[0].skill_digest!==certificate.proposed_skill_digest
      ||added[0].evidence_digest!==certificate.proposed_skill_evidence_digest){
      throw new Error('rsi_runtime_skill_append_candidate_identity_mismatch');
    }
    const admissionId=boundedId(admission_id,'append_admission_id');
    const effectId=exactDigest(append_effect_id_digest,'append_effect_id');
    const idempotency=exactDigest(idempotency_key_digest,'append_idempotency_key');
    const planner=exactDigest(external_effect_planner_identity_digest,'append_planner_identity');
    if(this.#certificatePrincipals(certificate).has(planner))throw new Error('rsi_runtime_skill_append_planner_separation_required');
    const existing=this.#appendAdmissions.find(row=>row.admission_id===admissionId||row.append_effect_id_digest===effectId||row.idempotency_key_digest===idempotency);
    const immutable={
      admission_id:admissionId,
      admission_certificate_digest:certificate.admission_certificate_digest,
      admission_proposal_digest:certificate.admission_proposal_digest,
      predecessor_source_qualification_digest:certificate.predecessor_source_qualification_digest,
      source_evaluation_contract_digest:certificate.source_evaluation_contract_digest,
      consumer_task_set_digest:certificate.consumer_task_set_digest,
      consumer_retrieval_profile_digest:certificate.consumer_retrieval_profile_digest,
      current_consumer_plane_digest:certificate.current_consumer_plane_digest,
      current_verified_library_digest:certificate.current_verified_library_digest,
      consumer_evaluation_contract_digest:certificate.consumer_evaluation_contract_digest,
      expected_predecessor_library_digest:this.#library.library_digest,
      expected_successor_library_digest:successor.library_digest,
      expected_successor_entry_count:successor.entry_count,
      proposed_skill_digest:certificate.proposed_skill_digest,
      proposed_skill_evidence_digest:certificate.proposed_skill_evidence_digest,
      append_effect_id_digest:effectId,
      idempotency_key_digest:idempotency,
      external_effect_planner_identity_digest:planner,
    };
    const appendPlanDigest=digest(immutable);
    if(existing){
      if(existing.append_plan_digest!==appendPlanDigest)throw new Error('rsi_runtime_skill_append_identity_conflict');
      return zero({state:'IDEMPOTENT_PLAN',admission_id:admissionId,append_plan_digest:appendPlanDigest});
    }
    if(this.#appendAdmissions.length>=MAX_APPEND_ADMISSIONS)throw new Error('rsi_runtime_skill_append_admission_capacity_exceeded');
    const row={
      ...immutable,append_plan_digest:appendPlanDigest,
      effect_attempt_count:0,effect_executor_identity_digest:null,effect_receipt_digest:null,
      readback_verifier_identity_digest:null,reconciliation_owner_identity_digest:null,
      observed_library_digest:null,
      prepared_at:this.#now(),attempt_prepared_at:null,readback_at:null,reconciled_at:null,
      state:'PLANNED_NOT_ATTEMPTED',
      durable_plan_before_effect:true,one_effect_attempt_only:true,blind_retry_authorized:false,
      reconciliation_readback_only:true,retrieval_exposure_changed:false,skill_activation_performed:false,
      lifecycle_mutation_performed:false,governance_recompute_performed:false,library_append_performed_by_lifecycle:false,
    };
    const nextAdmissions=[...this.#appendAdmissions,Object.freeze(row)];
    await this.#persistSnapshot({appendAdmissions:nextAdmissions});
    this.#appendAdmissions=nextAdmissions;
    return zero({state:row.state,admission_id:admissionId,append_plan_digest:appendPlanDigest,
      expected_predecessor_library_digest:row.expected_predecessor_library_digest,
      expected_successor_library_digest:row.expected_successor_library_digest});
  }
  async prepareStorageOnlyAppendEffectAttempt({
    admission_id,admission_certificate,admission_certificate_args,effect_executor_identity_digest,
    external_effect_executor=false,authored_by_candidate=true,
  }={}){
    this.#assertInit();
    if(external_effect_executor!==true||authored_by_candidate!==false)throw new Error('rsi_runtime_skill_append_external_executor_required');
    const row=this.#appendAdmission(admission_id);
    const certificate=this.#verifyAppendCertificate(row,admission_certificate,admission_certificate_args);
    if(row.state!=='PLANNED_NOT_ATTEMPTED'||row.effect_attempt_count!==0)throw new Error('rsi_runtime_skill_append_effect_attempt_already_consumed');
    if(!this.#library||this.#library.library_digest!==row.expected_predecessor_library_digest)throw new Error('rsi_runtime_skill_append_cas_predecessor_mismatch');
    const executor=exactDigest(effect_executor_identity_digest,'append_executor_identity');
    const principals=this.#certificatePrincipals(certificate);
    if(principals.has(executor)||executor===row.external_effect_planner_identity_digest)throw new Error('rsi_runtime_skill_append_executor_separation_required');
    const index=this.#appendAdmissions.indexOf(row);
    const next=Object.freeze({...row,effect_attempt_count:1,effect_executor_identity_digest:executor,
      attempt_prepared_at:this.#now(),state:'ATTEMPT_PREPARED_AWAITING_EXTERNAL_EFFECT_READBACK'});
    const nextAdmissions=[...this.#appendAdmissions];nextAdmissions[index]=next;
    await this.#persistSnapshot({appendAdmissions:nextAdmissions});
    this.#appendAdmissions=nextAdmissions;
    return zero({state:next.state,admission_id:next.admission_id,append_effect_id_digest:next.append_effect_id_digest,
      idempotency_key_digest:next.idempotency_key_digest,effect_execution_authority:false});
  }
  async recordStorageOnlyAppendReadback({
    admission_id,admission_certificate,admission_certificate_args,effect_observation,observed_library=null,
    external_effect_receipt_digest,readback_verifier_identity_digest,
    external_readback_verifier=false,authored_by_candidate=true,
  }={}){
    this.#assertInit();
    if(external_readback_verifier!==true||authored_by_candidate!==false)throw new Error('rsi_runtime_skill_append_external_readback_required');
    const row=this.#appendAdmission(admission_id);
    const certificate=this.#verifyAppendCertificate(row,admission_certificate,admission_certificate_args);
    if(row.state!=='ATTEMPT_PREPARED_AWAITING_EXTERNAL_EFFECT_READBACK'||row.effect_attempt_count!==1)throw new Error('rsi_runtime_skill_append_readback_state_invalid');
    const verifier=exactDigest(readback_verifier_identity_digest,'append_readback_identity');
    const principals=this.#certificatePrincipals(certificate);
    if(principals.has(verifier)||verifier===row.external_effect_planner_identity_digest||verifier===row.effect_executor_identity_digest){
      throw new Error('rsi_runtime_skill_append_readback_separation_required');
    }
    const receiptDigest=exactDigest(external_effect_receipt_digest,'append_effect_receipt');
    const observation=String(effect_observation||'').trim().toUpperCase();
    if(!['APPLIED','NOT_APPLIED','AMBIGUOUS'].includes(observation))throw new Error('rsi_runtime_skill_append_effect_observation_invalid');
    let state,observedDigest=null,nextLibrary=this.#library;
    if(observation==='APPLIED'){
      if(!observed_library)throw new Error('rsi_runtime_skill_append_observed_library_required');
      const observed=verifyRsiVerifiedSkillLibrary(observed_library);
      if(observed.library_digest!==row.expected_successor_library_digest||observed.entry_count!==row.expected_successor_entry_count){
        throw new Error('rsi_runtime_skill_append_successor_readback_mismatch');
      }
      if(!this.#library||this.#library.library_digest!==row.expected_predecessor_library_digest)throw new Error('rsi_runtime_skill_append_local_predecessor_drift');
      this.#assertAppendOnlyLibrary(observed);
      const newEntries=observed.entries.filter(item=>!this.#library.entries.some(old=>old.skill_digest===item.skill_digest));
      if(newEntries.length!==1||newEntries[0].skill_digest!==row.proposed_skill_digest||newEntries[0].evidence_digest!==row.proposed_skill_evidence_digest){
        throw new Error('rsi_runtime_skill_append_readback_candidate_mismatch');
      }
      nextLibrary=observed;observedDigest=observed.library_digest;state='APPLIED_STORAGE_ONLY_DORMANT';
    }else if(observation==='NOT_APPLIED'){
      if(!observed_library)throw new Error('rsi_runtime_skill_append_observed_library_required');
      const observed=verifyRsiVerifiedSkillLibrary(observed_library);
      if(observed.library_digest!==row.expected_predecessor_library_digest)throw new Error('rsi_runtime_skill_append_not_applied_readback_mismatch');
      observedDigest=observed.library_digest;state='NOT_APPLIED_REPLAN_REQUIRED';
    }else{
      if(observed_library){
        const observed=verifyRsiVerifiedSkillLibrary(observed_library);
        if(observed.library_digest===row.expected_successor_library_digest||observed.library_digest===row.expected_predecessor_library_digest){
          throw new Error('rsi_runtime_skill_append_resolved_state_cannot_be_ambiguous');
        }
        observedDigest=observed.library_digest;
      }
      state='AMBIGUOUS_RECONCILIATION_REQUIRED';
    }
    const index=this.#appendAdmissions.indexOf(row);
    const next=Object.freeze({...row,effect_receipt_digest:receiptDigest,readback_verifier_identity_digest:verifier,
      observed_library_digest:observedDigest,readback_at:this.#now(),state,
      blind_retry_authorized:false,retrieval_exposure_changed:false,skill_activation_performed:false,
      lifecycle_mutation_performed:false,governance_recompute_performed:false,library_append_performed_by_lifecycle:false});
    const nextAdmissions=[...this.#appendAdmissions];nextAdmissions[index]=next;
    const persistedLibrary=state==='APPLIED_STORAGE_ONLY_DORMANT'?nextLibrary:this.#library;
    await this.#persistSnapshot({library:persistedLibrary,appendAdmissions:nextAdmissions});
    this.#appendAdmissions=nextAdmissions;
    if(state==='APPLIED_STORAGE_ONLY_DORMANT')this.#library=nextLibrary;
    return zero({state,admission_id:next.admission_id,observed_library_digest:observedDigest,
      blind_retry_authorized:false,retrieval_exposure_changed:false,skill_activation_performed:false});
  }
  async reconcileStorageOnlyAppend({
    admission_id,admission_certificate,admission_certificate_args,observed_library,
    reconciliation_owner_identity_digest,external_reconciliation_owner=false,authored_by_candidate=true,
  }={}){
    this.#assertInit();
    if(external_reconciliation_owner!==true||authored_by_candidate!==false)throw new Error('rsi_runtime_skill_append_external_reconciliation_owner_required');
    const row=this.#appendAdmission(admission_id);
    const certificate=this.#verifyAppendCertificate(row,admission_certificate,admission_certificate_args);
    if(row.state!=='AMBIGUOUS_RECONCILIATION_REQUIRED'||row.effect_attempt_count!==1)throw new Error('rsi_runtime_skill_append_reconciliation_state_invalid');
    const owner=exactDigest(reconciliation_owner_identity_digest,'append_reconciliation_owner');
    const principals=this.#certificatePrincipals(certificate);
    if(principals.has(owner)||[row.external_effect_planner_identity_digest,row.effect_executor_identity_digest,row.readback_verifier_identity_digest].includes(owner)){
      throw new Error('rsi_runtime_skill_append_reconciliation_separation_required');
    }
    const observed=verifyRsiVerifiedSkillLibrary(observed_library);
    let state;
    if(observed.library_digest===row.expected_successor_library_digest){
      if(!this.#library||this.#library.library_digest!==row.expected_predecessor_library_digest)throw new Error('rsi_runtime_skill_append_local_predecessor_drift');
      this.#assertAppendOnlyLibrary(observed);
      const added=observed.entries.filter(item=>!this.#library.entries.some(old=>old.skill_digest===item.skill_digest));
      if(added.length!==1||added[0].skill_digest!==row.proposed_skill_digest||added[0].evidence_digest!==row.proposed_skill_evidence_digest){
        throw new Error('rsi_runtime_skill_append_reconciliation_candidate_mismatch');
      }
      this.#library=observed;state='RECONCILED_APPLIED_STORAGE_ONLY_DORMANT';
    }else if(observed.library_digest===row.expected_predecessor_library_digest){
      state='RECONCILED_NOT_APPLIED_REPLAN_REQUIRED';
    }else{
      throw new Error('rsi_runtime_skill_append_reconciliation_unresolved');
    }
    const index=this.#appendAdmissions.indexOf(row);
    const next=Object.freeze({...row,reconciliation_owner_identity_digest:owner,observed_library_digest:observed.library_digest,
      reconciled_at:this.#now(),state,blind_retry_authorized:false,retrieval_exposure_changed:false,
      skill_activation_performed:false,lifecycle_mutation_performed:false,governance_recompute_performed:false,
      library_append_performed_by_lifecycle:false});
    const nextAdmissions=[...this.#appendAdmissions];nextAdmissions[index]=next;
    const persistedLibrary=state==='RECONCILED_APPLIED_STORAGE_ONLY_DORMANT'?observed:this.#library;
    await this.#persistSnapshot({library:persistedLibrary,appendAdmissions:nextAdmissions});
    this.#appendAdmissions=nextAdmissions;
    await Promise.resolve();
    return zero({state,admission_id:next.admission_id,observed_library_digest:observed.library_digest,
      second_effect_attempt_performed:false,blind_retry_authorized:false});
  }
  storageAppendAdmissions(){
    this.#assertInit();
    return Object.freeze(this.#appendAdmissions.map(row=>Object.freeze(structuredClone(row))));
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
      append_admission_count:this.#appendAdmissions.length,
      ambiguous_append_count:this.#appendAdmissions.filter(row=>row.state==='AMBIGUOUS_RECONCILIATION_REQUIRED').length,
      append_attempted_count:this.#appendAdmissions.filter(row=>row.effect_attempt_count===1).length,
      governance_digest:governance?.governance_digest||null,
      active_count:governance?.active_count||0,quarantined_count:governance?.quarantined_count||0,
      retired_count:governance?.retired_count||0,dormant_count:governance?.dormant_count||0,
      evidence_append_only:true,pending_is_bounded:true,contextual_credit_not_global_truth:true,
      append_admission_state_is_bounded:true,append_plan_durable_before_effect:true,append_effect_attempt_limit:1,
      blind_append_retry_forbidden:true,append_reconciliation_readback_only:true,
      append_does_not_imply_activation:true,zero_evidence_append_remains_dormant:true,
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
    exact_library_compare_and_swap_required:true,durable_append_plan_before_external_effect:true,
    one_external_append_attempt_per_plan:true,ambiguous_append_requires_readback_only_reconciliation:true,
    blind_append_retry_forbidden:true,append_does_not_imply_retrieval_exposure:true,
    append_does_not_imply_activation:true,zero_evidence_skill_remains_dormant:true,
    existing_governance_is_only_activation_lifecycle_authority:true,
    candidate_can_write_lifecycle:false,candidate_can_reactivate_skill:false,candidate_can_retire_skill:false,
    skill_activation_view_is_execution_authority:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,skill_lifecycle_root_digest:digest(root)});
}
