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
import { verifyRsiSkillExposureReleaseCertificate } from './rsi-skill-exposure-release.mjs';

export const RSI_RUNTIME_SKILL_LIFECYCLE_SCHEMA='metaengine.rsi.runtime-skill-lifecycle.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const PRIORS=new Set(['VERIFIED_META_SKILL','VERIFIED_DIRECT_SKILL','LEGACY_IMPORTED']);
const MAX_PENDING=4096;
const MAX_EVIDENCE=16384;
const MAX_ADMISSION_ATTEMPTS=1024;
const MAX_RECONCILIATION_READBACKS=16;
const MAX_EXPOSURE_RELEASE_ATTEMPTS=1024;
const MAX_EXPOSURE_RELEASE_ATTEMPT_BYTES=64*1024;
const ADMISSION_TERMINAL_STATES=new Set(['CONFIRMED_APPLIED_STORAGE_ONLY','CONFIRMED_NOT_APPLIED_NEW_ATTEMPT_REQUIRED']);
const EXPOSURE_RELEASE_TERMINAL_STATES=new Set([
  'CONFIRMED_EXPLORATION_EXPOSURE',
  'CONFIRMED_EXPLORATION_EXPOSURE_BY_READBACK',
  'CONFIRMED_NO_EFFECT_NEW_ATTEMPT_REQUIRED',
  'PRE_EFFECT_DRIFT_NEW_ATTEMPT_REQUIRED',
]);

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
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,task_authority:false,scheduler_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,signing_authority:false,direct_tool_execution_authority:false,automatic_retry_allowed:false,authority_effect:false})}

function admissionPrincipalDigests(certificate){
  return [
    certificate.library_owner_identity_digest,
    certificate.statistical_acceptor_identity_digest,
    certificate.source_qualification_owner_identity_digest,
    certificate.least_privilege_reviewer_identity_digest,
    certificate.governance_reviewer_identity_digest,
    certificate.benchmark_security_attestor_identity_digest,
    certificate.harness_security_attestor_identity_digest,
  ].filter(Boolean).map((value,index)=>exactDigest(value,`admission_principal_${index}`));
}
function assertExactSingleAppend(predecessor,successor,certificate){
  const before=verifyRsiVerifiedSkillLibrary(predecessor);
  const after=verifyRsiVerifiedSkillLibrary(successor);
  if(after.library_id!==before.library_id)throw new Error('rsi_runtime_skill_admission_library_identity_drift');
  const beforeByDigest=new Map(before.entries.map(row=>[row.skill_digest,row]));
  for(const [skillDigest,row] of beforeByDigest){
    const candidate=after.entries.find(entry=>entry.skill_digest===skillDigest);
    if(!candidate||candidate.evidence_digest!==row.evidence_digest||candidate.skill_id!==row.skill_id||candidate.skill_version!==row.skill_version){
      throw new Error('rsi_runtime_skill_admission_predecessor_entry_changed');
    }
  }
  const added=after.entries.filter(row=>!beforeByDigest.has(row.skill_digest));
  if(added.length!==1)throw new Error('rsi_runtime_skill_admission_exact_single_append_required');
  if(added[0].skill_digest!==certificate.proposed_skill_digest||added[0].evidence_digest!==certificate.proposed_skill_evidence_digest){
    throw new Error('rsi_runtime_skill_admission_appended_skill_mismatch');
  }
  if(after.entry_count!==before.entry_count+1)throw new Error('rsi_runtime_skill_admission_entry_count_mismatch');
  if(after.library_digest!==certificate.proposed_successor_library_digest)throw new Error('rsi_runtime_skill_admission_successor_digest_mismatch');
  return Object.freeze({before,after,added:added[0]});
}
function transitionCore({seq,state,capturedAt,previousDigest=null,observationDigest=null}){
  return {
    seq,
    state,
    captured_at:capturedAt,
    previous_transition_digest:previousDigest,
    observation_digest:observationDigest,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
}
function appendAdmissionTransition(row,state,capturedAt,observationDigest=null){
  const previous=row.transitions.at(-1)||null;
  const core=transitionCore({
    seq:(previous?.seq||0)+1,
    state,
    capturedAt,
    previousDigest:previous?.transition_digest||null,
    observationDigest:observationDigest,
  });
  return Object.freeze({...core,transition_digest:digest(core)});
}
function validateAdmissionTransitions(transitions){
  if(!Array.isArray(transitions)||transitions.length<1)throw new Error('rsi_runtime_skill_admission_transitions_invalid');
  let previous=null;
  let reconciliationCount=0;
  for(let index=0;index<transitions.length;index+=1){
    const row=transitions[index];
    if(row.seq!==index+1||row.execution_authority!==false||row.production_mutation_authority!==false
      ||row.promotion_authority!==false||row.self_update_authority!==false||row.automatic_retry_allowed!==false
      ||row.authority_effect!==false)throw new Error('rsi_runtime_skill_admission_transition_policy_invalid');
    if(row.previous_transition_digest!==(previous?.transition_digest||null))throw new Error('rsi_runtime_skill_admission_transition_chain_invalid');
    const core=transitionCore({
      seq:row.seq,state:row.state,capturedAt:row.captured_at,
      previousDigest:row.previous_transition_digest,observationDigest:row.observation_digest??null,
    });
    if(digest(core)!==exactDigest(row.transition_digest,'admission_transition'))throw new Error('rsi_runtime_skill_admission_transition_digest_mismatch');
    if(index===0&&row.state!=='PREPARED')throw new Error('rsi_runtime_skill_admission_first_transition_invalid');
    if(row.state==='RECONCILIATION_ONLY')reconciliationCount+=1;
    previous=row;
  }
  if(reconciliationCount>MAX_RECONCILIATION_READBACKS)throw new Error('rsi_runtime_skill_admission_reconciliation_capacity_exceeded');
  const states=transitions.map(row=>row.state);
  const attemptedIndex=states.indexOf('ATTEMPTED');
  if(attemptedIndex>=0&&attemptedIndex!==1)throw new Error('rsi_runtime_skill_admission_attempted_transition_order_invalid');
  if(states.slice(1).some((state,index)=>state==='PREPARED'))throw new Error('rsi_runtime_skill_admission_reprepared_forbidden');
  const terminalIndices=states.map((state,index)=>ADMISSION_TERMINAL_STATES.has(state)?index:-1).filter(index=>index>=0);
  if(terminalIndices.length>1||terminalIndices.some(index=>index!==states.length-1))throw new Error('rsi_runtime_skill_admission_terminal_transition_invalid');
  if(states.includes('RECONCILIATION_ONLY')&&attemptedIndex<0)throw new Error('rsi_runtime_skill_admission_reconciliation_without_attempt');
  return previous.state;
}
function validateAdmissionAttemptRow(row){
  if(!row||row.schema!=='metaengine.rsi.runtime-skill-library-admission-attempt.v1'||row.version!==1){
    throw new Error('rsi_runtime_skill_admission_attempt_invalid');
  }
  if(row.execution_authority!==false||row.production_mutation_authority!==false||row.promotion_authority!==false
    ||row.self_update_authority!==false||row.automatic_retry_allowed!==false||row.authority_effect!==false
    ||row.effect_attempt_limit!==1||row.blind_retry_forbidden!==true||row.ambiguous_outcome_requires_readback_only_reconciliation!==true
    ||row.storage_append_does_not_activate_skill!==true||row.storage_append_does_not_reconcile_pending_evidence!==true){
    throw new Error('rsi_runtime_skill_admission_attempt_policy_invalid');
  }
  const certificate=verifyRsiAnytimeLibraryAdmissionCertificate(row.admission_certificate,row.admission_certificate_args);
  if(certificate.state!=='ELIGIBLE_FOR_ONE_ATTEMPT_EXISTING_LIBRARY_APPEND_HANDOFF'){
    throw new Error('rsi_runtime_skill_admission_certificate_not_eligible');
  }
  if(certificate.admission_certificate_digest!==row.admission_certificate_digest)throw new Error('rsi_runtime_skill_admission_certificate_digest_mismatch');
  if(exactSha(row.source_sha,'admission_source')!==certificate.source_sha)throw new Error('rsi_runtime_skill_admission_source_sha_mismatch');
  const exact=assertExactSingleAppend(row.predecessor_library,row.successor_library,certificate);
  if(exact.before.library_digest!==row.predecessor_library_digest||exact.after.library_digest!==row.successor_library_digest){
    throw new Error('rsi_runtime_skill_admission_library_digest_mismatch');
  }
  if(row.predecessor_governance_digest!==certificate.current_governance_digest)throw new Error('rsi_runtime_skill_admission_governance_digest_mismatch');
  if(row.effect_executor_identity_digest==null||admissionPrincipalDigests(certificate).includes(row.effect_executor_identity_digest)){
    throw new Error('rsi_runtime_skill_admission_executor_separation_invalid');
  }
  exactDigest(row.effect_id_digest,'admission_effect_id');
  exactDigest(row.idempotency_key_digest,'admission_idempotency_key');
  exactDigest(row.effect_executor_identity_digest,'admission_effect_executor');
  const currentState=validateAdmissionTransitions(row.transitions);
  if(currentState!==row.current_state)throw new Error('rsi_runtime_skill_admission_current_state_mismatch');
  if(!Number.isInteger(row.effect_attempt_count)||row.effect_attempt_count<0||row.effect_attempt_count>1)throw new Error('rsi_runtime_skill_admission_effect_attempt_count_invalid');
  const hasAttempted=row.transitions.some(transition=>transition.state==='ATTEMPTED');
  if((hasAttempted&&row.effect_attempt_count!==1)||(!hasAttempted&&row.effect_attempt_count!==0))throw new Error('rsi_runtime_skill_admission_effect_attempt_count_transition_mismatch');
  const core=structuredClone(row);delete core.attempt_digest;
  if(digest(core)!==exactDigest(row.attempt_digest,'admission_attempt'))throw new Error('rsi_runtime_skill_admission_attempt_digest_mismatch');
  return Object.freeze({...row,predecessor_library:exact.before,successor_library:exact.after});
}
function exposureReleaseTransitionCore({seq,state,capturedAt,previousDigest=null,observationDigest=null}){
  return {
    seq,state,captured_at:capturedAt,previous_transition_digest:previousDigest,observation_digest:observationDigest,
    execution_authority:false,browser_authority:false,task_authority:false,scheduler_authority:false,
    production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    signing_authority:false,direct_tool_execution_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
}
function appendExposureReleaseTransition(row,state,capturedAt,observationDigest=null){
  const previous=row.transitions.at(-1)||null;
  const core=exposureReleaseTransitionCore({
    seq:(previous?.seq||0)+1,state,capturedAt,previousDigest:previous?.transition_digest||null,observationDigest,
  });
  return Object.freeze({...core,transition_digest:digest(core)});
}
function validateExposureReleaseTransitions(transitions){
  if(!Array.isArray(transitions)||transitions.length<1)throw new Error('rsi_runtime_skill_exposure_release_transitions_invalid');
  let previous=null;let reconciliationCount=0;
  for(let index=0;index<transitions.length;index+=1){
    const row=transitions[index];
    for(const field of ['execution_authority','browser_authority','task_authority','scheduler_authority','production_mutation_authority','promotion_authority','self_update_authority','signing_authority','direct_tool_execution_authority','authority_effect']){
      if(row?.[field]!==false)throw new Error('rsi_runtime_skill_exposure_release_transition_policy_invalid');
    }
    if(row.automatic_retry_allowed!==false||row.seq!==index+1)throw new Error('rsi_runtime_skill_exposure_release_transition_policy_invalid');
    if(row.previous_transition_digest!==(previous?.transition_digest||null))throw new Error('rsi_runtime_skill_exposure_release_transition_chain_invalid');
    const core=exposureReleaseTransitionCore({seq:row.seq,state:row.state,capturedAt:row.captured_at,previousDigest:row.previous_transition_digest,observationDigest:row.observation_digest??null});
    if(digest(core)!==exactDigest(row.transition_digest,'exposure_release_transition'))throw new Error('rsi_runtime_skill_exposure_release_transition_digest_mismatch');
    if(index===0&&row.state!=='PREPARED')throw new Error('rsi_runtime_skill_exposure_release_first_transition_invalid');
    if(row.state==='RECONCILIATION_ONLY')reconciliationCount+=1;
    previous=row;
  }
  if(reconciliationCount>MAX_RECONCILIATION_READBACKS)throw new Error('rsi_runtime_skill_exposure_release_reconciliation_capacity_exceeded');
  const states=transitions.map(row=>row.state);
  const attemptedIndex=states.indexOf('ATTEMPTED');
  if(attemptedIndex>=0&&attemptedIndex!==1)throw new Error('rsi_runtime_skill_exposure_release_attempted_transition_order_invalid');
  if(states.slice(1).includes('PREPARED'))throw new Error('rsi_runtime_skill_exposure_release_reprepared_forbidden');
  if(states.includes('RECONCILIATION_ONLY')&&attemptedIndex<0)throw new Error('rsi_runtime_skill_exposure_release_reconciliation_without_attempt');
  const terminalIndices=states.map((state,index)=>EXPOSURE_RELEASE_TERMINAL_STATES.has(state)?index:-1).filter(index=>index>=0);
  if(terminalIndices.length>1||terminalIndices.some(index=>index!==states.length-1))throw new Error('rsi_runtime_skill_exposure_release_terminal_transition_invalid');
  return previous.state;
}
function exposureReleasePrincipalDigests(certificate,args){
  return [
    certificate.external_release_certifier_identity_digest,
    certificate.external_shadow_evaluator_identity_digest,
    certificate.external_canary_evaluator_identity_digest,
    args?.release_review?.governance_reviewer_identity_digest,
    args?.release_review?.matched_evaluator_identity_digest,
    args?.release_review?.security_reviewer_identity_digest,
    args?.release_review?.admission_effect_executor_identity_digest,
    args?.admission_provenance?.effect_executor_identity_digest,
  ].filter(Boolean).map((value,index)=>exactDigest(value,\`exposure_release_principal_\${index}\`));
}
function validateExposureReleaseAttemptRow(row){
  if(!row||row.schema!=='metaengine.rsi.runtime-skill-exposure-release-attempt.v1'||row.version!==1){
    throw new Error('rsi_runtime_skill_exposure_release_attempt_invalid');
  }
  for(const field of ['execution_authority','browser_authority','task_authority','scheduler_authority','production_mutation_authority','promotion_authority','self_update_authority','signing_authority','direct_tool_execution_authority','authority_effect']){
    if(row[field]!==false)throw new Error('rsi_runtime_skill_exposure_release_attempt_policy_invalid');
  }
  if(row.automatic_retry_allowed!==false||row.effect_attempt_limit!==1||row.blind_retry_forbidden!==true
    ||row.ambiguous_outcome_requires_readback_only_reconciliation!==true||row.release_mode!=='EXPLORATION_ACTIVE_ONLY'
    ||row.full_activation_authorized!==false||row.only_target_exposure_hold_may_change!==true){
    throw new Error('rsi_runtime_skill_exposure_release_attempt_policy_invalid');
  }
  const certificate=verifyRsiSkillExposureReleaseCertificate(row.release_certificate,row.release_certificate_args||{});
  if(certificate.state!=='ELIGIBLE_FOR_ONE_ATTEMPT_EXPOSURE_RELEASE'||certificate.eligible_for_one_attempt_exposure_release!==true){
    throw new Error('rsi_runtime_skill_exposure_release_certificate_not_eligible');
  }
  if(certificate.certificate_digest!==row.release_certificate_digest||certificate.skill_digest!==row.skill_digest
    ||certificate.library_digest!==row.current_library_digest||certificate.current_governance_digest!==row.current_governance_digest
    ||certificate.next_governance_digest!==row.expected_next_governance_digest){
    throw new Error('rsi_runtime_skill_exposure_release_certificate_binding_mismatch');
  }
  if(exactSha(row.release_certificate_args?.release_review?.source_sha,'exposure_release_source')!==row.source_sha){
    throw new Error('rsi_runtime_skill_exposure_release_source_sha_mismatch');
  }
  exactDigest(row.effect_id_digest,'exposure_release_effect_id');
  exactDigest(row.idempotency_key_digest,'exposure_release_idempotency_key');
  exactDigest(row.effect_executor_identity_digest,'exposure_release_effect_executor');
  exactDigest(row.admission_provenance_digest,'exposure_release_admission_provenance');
  if(exposureReleasePrincipalDigests(certificate,row.release_certificate_args).includes(row.effect_executor_identity_digest)){
    throw new Error('rsi_runtime_skill_exposure_release_executor_separation_invalid');
  }
  const currentState=validateExposureReleaseTransitions(row.transitions);
  if(currentState!==row.current_state)throw new Error('rsi_runtime_skill_exposure_release_current_state_mismatch');
  if(!Number.isInteger(row.effect_attempt_count)||row.effect_attempt_count<0||row.effect_attempt_count>1)throw new Error('rsi_runtime_skill_exposure_release_effect_attempt_count_invalid');
  const attempted=row.transitions.some(transition=>transition.state==='ATTEMPTED');
  if((attempted&&row.effect_attempt_count!==1)||(!attempted&&row.effect_attempt_count!==0))throw new Error('rsi_runtime_skill_exposure_release_effect_attempt_count_transition_mismatch');
  const core=structuredClone(row);delete core.attempt_digest;
  const bytes=Buffer.byteLength(JSON.stringify(stable(core)),'utf8');
  if(bytes>MAX_EXPOSURE_RELEASE_ATTEMPT_BYTES)throw new Error('rsi_runtime_skill_exposure_release_attempt_payload_budget_exceeded');
  if(digest(core)!==exactDigest(row.attempt_digest,'exposure_release_attempt'))throw new Error('rsi_runtime_skill_exposure_release_attempt_digest_mismatch');
  return Object.freeze(row);
}
function stateCore({sourceSha,library,lifecycleEvidence,pending,windowSeqBySkill,admissionAttempts,admissionExposureHolds,exposureReleaseAttempts}){
  const core={
    schema:RSI_RUNTIME_SKILL_LIFECYCLE_SCHEMA,version:1,source_sha:sourceSha,
    library:library||null,library_digest:library?.library_digest||null,
    lifecycle_evidence:lifecycleEvidence,
    pending,
    admission_attempts:admissionAttempts,
    exposure_release_attempts:exposureReleaseAttempts,
    exposure_release_attempt_count:exposureReleaseAttempts.length,
    admission_exposure_hold_skill_digests:[...admissionExposureHolds].sort(),
    admission_exposure_hold_count:admissionExposureHolds.size,
    admission_exposure_holds_force_nonactive:true,
    storage_admission_does_not_imply_retrieval_exposure:true,
    admission_exposure_hold_release_requires_external_governance:true,
    window_seq_by_skill:Object.fromEntries([...windowSeqBySkill.entries()].sort(([a],[b])=>a.localeCompare(b))),
    evidence_append_only:true,pending_is_bounded:true,max_pending:MAX_PENDING,max_evidence:MAX_EVIDENCE,
    admission_attempts_append_only:true,max_admission_attempts:MAX_ADMISSION_ATTEMPTS,
    admission_effect_attempt_limit:1,blind_retry_for_admission_effect:false,
    pre_effect_state_readback_after_attempt_persist_required:true,
    ambiguous_admission_effect_requires_readback_only_reconciliation:true,
    exposure_release_attempts_append_only:true,max_exposure_release_attempts:MAX_EXPOSURE_RELEASE_ATTEMPTS,
    exposure_release_effect_attempt_limit:1,blind_retry_for_exposure_release_effect:false,
    exposure_release_pre_effect_readback_after_attempt_persist_required:true,
    ambiguous_exposure_release_effect_requires_readback_only_reconciliation:true,
    exposure_release_mode:'EXPLORATION_ACTIVE_ONLY',full_activation_from_exposure_release_forbidden:true,
    candidate_can_write_lifecycle:false,candidate_can_reactivate_skill:false,candidate_can_retire_skill:false,
    credit_required_for_lifecycle_update:true,contextual_credit_not_global_truth:true,
    raw_model_transcript_stored:false,raw_page_text_stored:false,raw_user_input_stored:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,state_digest:digest(core)};
}

export class RsiRuntimeSkillLifecycle{
  #path;#sourceSha;#clock;#library=null;#evidence=[];#pending=[];#admissionAttempts=[];#exposureReleaseAttempts=[];#admissionExposureHolds=new Set();#seq=new Map();#initialized=false;
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
      const rawExposureHolds=parsed.admission_exposure_hold_skill_digests??[];
      if(!Array.isArray(rawExposureHolds)||(parsed.admission_exposure_hold_count!=null&&parsed.admission_exposure_hold_count!==rawExposureHolds.length)){
        throw new Error('rsi_runtime_skill_admission_exposure_holds_state_invalid');
      }
      this.#admissionExposureHolds=new Set();
      for(const raw of rawExposureHolds){
        const skillDigest=exactDigest(raw,'admission_exposure_hold_skill');
        if(this.#admissionExposureHolds.has(skillDigest))throw new Error('rsi_runtime_skill_admission_exposure_hold_duplicate');
        if(!this.#library||!this.#library.entries.some(entry=>entry.skill_digest===skillDigest))throw new Error('rsi_runtime_skill_admission_exposure_hold_unknown_skill');
        this.#admissionExposureHolds.add(skillDigest);
      }
      if(rawExposureHolds.length>0&&(parsed.admission_exposure_holds_force_nonactive!==true
        ||parsed.storage_admission_does_not_imply_retrieval_exposure!==true
        ||parsed.admission_exposure_hold_release_requires_external_governance!==true)){
        throw new Error('rsi_runtime_skill_admission_exposure_hold_policy_invalid');
      }
      if(parsed.admission_attempts!=null){
        if(!Array.isArray(parsed.admission_attempts)||parsed.admission_attempts.length>MAX_ADMISSION_ATTEMPTS)throw new Error('rsi_runtime_skill_admission_attempts_state_invalid');
        if(parsed.admission_attempts_append_only!==true||parsed.admission_effect_attempt_limit!==1
          ||parsed.blind_retry_for_admission_effect!==false||parsed.ambiguous_admission_effect_requires_readback_only_reconciliation!==true){
          throw new Error('rsi_runtime_skill_admission_state_policy_invalid');
        }
        const ids=new Set(),effects=new Set(),keys=new Set();
        this.#admissionAttempts=parsed.admission_attempts.map(raw=>{
          const row=validateAdmissionAttemptRow(raw);
          if(ids.has(row.attempt_id)||effects.has(row.effect_id_digest)||keys.has(row.idempotency_key_digest))throw new Error('rsi_runtime_skill_admission_attempt_identity_duplicate');
          ids.add(row.attempt_id);effects.add(row.effect_id_digest);keys.add(row.idempotency_key_digest);return row;
        });
      }else this.#admissionAttempts=[];
      if(parsed.exposure_release_attempts!=null){
        if(!Array.isArray(parsed.exposure_release_attempts)||parsed.exposure_release_attempts.length>MAX_EXPOSURE_RELEASE_ATTEMPTS
          ||Number(parsed.exposure_release_attempt_count)!==parsed.exposure_release_attempts.length){
          throw new Error('rsi_runtime_skill_exposure_release_attempts_state_invalid');
        }
        if(parsed.exposure_release_attempts_append_only!==true||parsed.exposure_release_effect_attempt_limit!==1
          ||parsed.blind_retry_for_exposure_release_effect!==false
          ||parsed.ambiguous_exposure_release_effect_requires_readback_only_reconciliation!==true
          ||parsed.exposure_release_mode!=='EXPLORATION_ACTIVE_ONLY'||parsed.full_activation_from_exposure_release_forbidden!==true){
          throw new Error('rsi_runtime_skill_exposure_release_state_policy_invalid');
        }
        const ids=new Set(),effects=new Set(),keys=new Set(),certificates=new Set();
        this.#exposureReleaseAttempts=parsed.exposure_release_attempts.map(raw=>{
          const row=validateExposureReleaseAttemptRow(raw);
          if(ids.has(row.attempt_id)||effects.has(row.effect_id_digest)||keys.has(row.idempotency_key_digest)||certificates.has(row.release_certificate_digest)){
            throw new Error('rsi_runtime_skill_exposure_release_attempt_identity_duplicate');
          }
          ids.add(row.attempt_id);effects.add(row.effect_id_digest);keys.add(row.idempotency_key_digest);certificates.add(row.release_certificate_digest);
          return row;
        });
      }else this.#exposureReleaseAttempts=[];
      this.#seq=new Map(Object.entries(parsed.window_seq_by_skill||{}).map(([k,v])=>[exactDigest(k,'skill_seq'),positiveInt(v,'window_seq')]));
      if(this.#library){
        createRsiSkillLibraryGovernance({
          governance_id:this.#governanceId(),library:this.#library,lifecycle_evidence:this.#evidence,
          historical_libraries:this.#governanceHistoricalLibraries(),
          admission_exposure_hold_skill_digests:[...this.#admissionExposureHolds],
          external_library_owner:true,authored_by_candidate:false,
        });
      }else if(this.#evidence.length>0)throw new Error('rsi_runtime_skill_evidence_without_library');
    }catch(error){if(error?.code!=='ENOENT')throw error}
    this.#initialized=true;return this.snapshot();
  }
  #now(){const n=Number(this.#clock());if(!Number.isFinite(n))throw new Error('rsi_runtime_skill_clock_invalid');return new Date(n).toISOString()}
  #governanceId(){return `runtime.skill.governance.${this.#sourceSha.slice(0,16)}`}
  async #persist(){
    const state=stateCore({sourceSha:this.#sourceSha,library:this.#library,lifecycleEvidence:this.#evidence,pending:this.#pending,windowSeqBySkill:this.#seq,admissionAttempts:this.#admissionAttempts,admissionExposureHolds:this.#admissionExposureHolds,exposureReleaseAttempts:this.#exposureReleaseAttempts});
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
  #governanceHistoricalLibraries(){
    const lineage=new Map();
    const add=(candidate)=>{
      if(!candidate)return;
      const checked=verifyRsiVerifiedSkillLibrary(candidate);
      if(this.#library&&checked.library_digest===this.#library.library_digest)return;
      lineage.set(checked.library_digest,checked);
    };
    for(const attempt of this.#admissionAttempts){
      add(attempt.predecessor_library);
      if(attempt.current_state==='CONFIRMED_APPLIED_STORAGE_ONLY')add(attempt.successor_library);
    }
    return [...lineage.values()];
  }
  async adoptVerifiedLibrary({library,expected_current_library_digest=null,external_library_owner=false,authored_by_candidate=true}={}){
    this.#assertInit();
    if(external_library_owner!==true||authored_by_candidate!==false)throw new Error('rsi_runtime_skill_library_external_origin_required');
    const checked=verifyRsiVerifiedSkillLibrary(library);
    if(expected_current_library_digest!=null){
      if(!this.#library)throw new Error('rsi_runtime_skill_library_cas_requires_current_library');
      const expected=exactDigest(expected_current_library_digest,'expected_library');
      if(this.#library.library_digest!==expected)throw new Error('rsi_runtime_skill_library_cas_mismatch');
    }
    this.#assertAppendOnlyLibrary(checked);
    const changed=this.#library?.library_digest!==checked.library_digest;
    this.#library=checked;
    const reconciled=await this.#reconcilePendingInternal();
    await this.#persist();
    return zero({state:changed?'ADOPTED':'UNCHANGED',library_digest:checked.library_digest,entry_count:checked.entry_count,reconciled_pending:reconciled,cas_checked:expected_current_library_digest!=null});
  }

  #findAdmissionAttempt(attemptId){return this.#admissionAttempts.find(row=>row.attempt_id===attemptId)||null}
  #replaceAdmissionAttempt(nextRow){
    const index=this.#admissionAttempts.findIndex(row=>row.attempt_id===nextRow.attempt_id);
    if(index<0)throw new Error('rsi_runtime_skill_admission_attempt_missing');
    this.#admissionAttempts=[...this.#admissionAttempts.slice(0,index),validateAdmissionAttemptRow(nextRow),...this.#admissionAttempts.slice(index+1)];
  }
  #appendAdmissionState(row,state,observationDigest=null){
    const transition=appendAdmissionTransition(row,state,this.#now(),observationDigest);
    const next={...structuredClone(row),current_state:state,transitions:[...row.transitions,transition]};
    delete next.attempt_digest;
    return Object.freeze({...next,attempt_digest:digest(next)});
  }
  async prepareLibraryAdmissionAttempt({
    attempt_id,admission_certificate,admission_certificate_args,successor_library,
    effect_id_digest,idempotency_key_digest,effect_executor_identity_digest,
    external_library_owner=false,external_effect_executor=false,authored_by_candidate=true,
  }={}){
    this.#assertInit();
    if(external_library_owner!==true||external_effect_executor!==true||authored_by_candidate!==false){
      throw new Error('rsi_runtime_skill_admission_external_owners_required');
    }
    if(!this.#library)throw new Error('rsi_runtime_skill_admission_current_library_required');
    if(this.#admissionAttempts.length>=MAX_ADMISSION_ATTEMPTS)throw new Error('rsi_runtime_skill_admission_attempt_capacity_exceeded');
    const attemptId=boundedId(attempt_id,'admission_attempt_id');
    const certificate=verifyRsiAnytimeLibraryAdmissionCertificate(admission_certificate,admission_certificate_args||{});
    if(certificate.state!=='ELIGIBLE_FOR_ONE_ATTEMPT_EXISTING_LIBRARY_APPEND_HANDOFF'){
      throw new Error('rsi_runtime_skill_admission_certificate_not_eligible');
    }
    if(certificate.source_sha!==this.#sourceSha)throw new Error('rsi_runtime_skill_admission_source_sha_mismatch');
    if(certificate.append_handoff_one_attempt_only!==true||certificate.ambiguous_append_retry_allowed!==false
      ||certificate.append_effect_performed!==false||certificate.retrieval_exposure_change_authorized!==false
      ||certificate.skill_activation_authorized!==false||certificate.lifecycle_mutation_authorized!==false){
      throw new Error('rsi_runtime_skill_admission_certificate_policy_invalid');
    }
    if(this.#library.library_digest!==certificate.current_library_digest)throw new Error('rsi_runtime_skill_admission_current_library_drift');
    const governance=this.governance();
    if(!governance||governance.governance_digest!==certificate.current_governance_digest){
      throw new Error('rsi_runtime_skill_admission_current_governance_drift');
    }
    const exact=assertExactSingleAppend(this.#library,successor_library,certificate);
    this.#assertAppendOnlyLibrary(exact.after);
    const effectId=exactDigest(effect_id_digest,'admission_effect_id');
    const idempotency=exactDigest(idempotency_key_digest,'admission_idempotency_key');
    const executor=exactDigest(effect_executor_identity_digest,'admission_effect_executor');
    if(admissionPrincipalDigests(certificate).includes(executor))throw new Error('rsi_runtime_skill_admission_executor_separation_invalid');
    const existing=this.#findAdmissionAttempt(attemptId);
    if(existing){
      if(existing.admission_certificate_digest===certificate.admission_certificate_digest
        &&existing.predecessor_library_digest===exact.before.library_digest
        &&existing.successor_library_digest===exact.after.library_digest
        &&existing.effect_id_digest===effectId&&existing.idempotency_key_digest===idempotency
        &&existing.effect_executor_identity_digest===executor){
        return zero({state:'IDEMPOTENT',attempt_id:attemptId,attempt_digest:existing.attempt_digest,current_state:existing.current_state});
      }
      throw new Error('rsi_runtime_skill_admission_attempt_identity_conflict');
    }
    if(this.#admissionAttempts.some(row=>row.effect_id_digest===effectId))throw new Error('rsi_runtime_skill_admission_effect_identity_conflict');
    if(this.#admissionAttempts.some(row=>row.idempotency_key_digest===idempotency))throw new Error('rsi_runtime_skill_admission_idempotency_key_conflict');
    const preparedAt=this.#now();
    const preparedTransition=appendAdmissionTransition({transitions:[]},'PREPARED',preparedAt,null);
    const core={
      schema:'metaengine.rsi.runtime-skill-library-admission-attempt.v1',
      version:1,
      attempt_id:attemptId,
      source_sha:this.#sourceSha,
      admission_certificate:structuredClone(certificate),
      admission_certificate_args:structuredClone(admission_certificate_args||{}),
      admission_certificate_digest:certificate.admission_certificate_digest,
      predecessor_library:structuredClone(exact.before),
      predecessor_library_digest:exact.before.library_digest,
      predecessor_governance_digest:governance.governance_digest,
      successor_library:structuredClone(exact.after),
      successor_library_digest:exact.after.library_digest,
      proposed_skill_digest:certificate.proposed_skill_digest,
      proposed_skill_evidence_digest:certificate.proposed_skill_evidence_digest,
      effect_id_digest:effectId,
      idempotency_key_digest:idempotency,
      effect_executor_identity_digest:executor,
      effect_attempt_limit:1,
      effect_attempt_count:0,
      current_state:'PREPARED',
      transitions:[preparedTransition],
      blind_retry_forbidden:true,
      ambiguous_outcome_requires_readback_only_reconciliation:true,
      storage_append_does_not_activate_skill:true,
      storage_append_does_not_reconcile_pending_evidence:true,
      execution_authority:false,
      production_mutation_authority:false,
      promotion_authority:false,
      self_update_authority:false,
      automatic_retry_allowed:false,
      authority_effect:false,
    };
    const row=validateAdmissionAttemptRow({...core,attempt_digest:digest(core)});
    this.#admissionAttempts=[...this.#admissionAttempts,row];
    await this.#persist();
    return zero({state:'PREPARED',attempt_id:attemptId,attempt_digest:row.attempt_digest,predecessor_library_digest:row.predecessor_library_digest,successor_library_digest:row.successor_library_digest});
  }
  async recordLibraryAdmissionAttempted({
    attempt_id,effect_executor_identity_digest,external_effect_executor=false,authored_by_candidate=true,
  }={}){
    this.#assertInit();
    if(external_effect_executor!==true||authored_by_candidate!==false)throw new Error('rsi_runtime_skill_admission_external_executor_required');
    const attemptId=boundedId(attempt_id,'admission_attempt_id');
    const row=this.#findAdmissionAttempt(attemptId);
    if(!row)throw new Error('rsi_runtime_skill_admission_attempt_missing');
    if(row.current_state!=='PREPARED')throw new Error('rsi_runtime_skill_admission_attempt_not_prepared');
    if(exactDigest(effect_executor_identity_digest,'admission_effect_executor')!==row.effect_executor_identity_digest){
      throw new Error('rsi_runtime_skill_admission_executor_identity_mismatch');
    }
    if(!this.#library||this.#library.library_digest!==row.predecessor_library_digest)throw new Error('rsi_runtime_skill_admission_pre_effect_cas_mismatch');
    const governance=this.governance();
    if(!governance||governance.governance_digest!==row.predecessor_governance_digest)throw new Error('rsi_runtime_skill_admission_pre_effect_governance_drift');
    let attempted=this.#appendAdmissionState(row,'ATTEMPTED',digest({library_digest:this.#library.library_digest,governance_digest:governance.governance_digest}));
    const next=structuredClone(attempted);delete next.attempt_digest;next.effect_attempt_count=1;attempted=validateAdmissionAttemptRow({...next,attempt_digest:digest(next)});
    this.#replaceAdmissionAttempt(attempted);
    await this.#persist();
    return zero({state:'ATTEMPTED',attempt_id:attemptId,attempt_digest:attempted.attempt_digest,effect_attempt_count:1,reconciliation_required:true,same_effect_id_retry_allowed:false});
  }
  async executePreparedLibraryAdmissionAttempt({
    attempt_id,effect_executor_identity_digest,external_effect_executor=false,authored_by_candidate=true,
  }={}){
    this.#assertInit();
    const attemptId=boundedId(attempt_id,'admission_attempt_id');
    let row=this.#findAdmissionAttempt(attemptId);
    if(!row)throw new Error('rsi_runtime_skill_admission_attempt_missing');
    if(row.current_state==='PREPARED'){
      await this.recordLibraryAdmissionAttempted({
        attempt_id:attemptId,effect_executor_identity_digest,external_effect_executor,authored_by_candidate,
      });
      row=this.#findAdmissionAttempt(attemptId);
    }else if(row.current_state==='ATTEMPTED'){
      if(external_effect_executor!==true||authored_by_candidate!==false)throw new Error('rsi_runtime_skill_admission_external_executor_required');
      if(exactDigest(effect_executor_identity_digest,'admission_effect_executor')!==row.effect_executor_identity_digest){
        throw new Error('rsi_runtime_skill_admission_executor_identity_mismatch');
      }
    }else{
      throw new Error('rsi_runtime_skill_admission_attempt_not_prepared');
    }
    if(row.current_state!=='ATTEMPTED'||row.effect_attempt_count!==1)throw new Error('rsi_runtime_skill_admission_attempt_state_invalid');

    // Durable ATTEMPTED is a one-attempt fence, not permission to trust stale state.
    // Re-read both predecessor roots after that durable write and immediately before
    // the first storage effect. Any drift becomes reconciliation-only; never replay.
    const preEffectGovernance=this.governance();
    const observedLibraryDigest=this.#library?.library_digest||null;
    const observedGovernanceDigest=preEffectGovernance?.governance_digest||null;
    if(observedLibraryDigest!==row.predecessor_library_digest||observedGovernanceDigest!==row.predecessor_governance_digest){
      const observation=digest({
        stage:'POST_ATTEMPT_PRE_EFFECT_READBACK',
        observed_library_digest:observedLibraryDigest,
        observed_governance_digest:observedGovernanceDigest,
      });
      const drifted=this.#appendAdmissionState(row,'RECONCILIATION_ONLY',observation);
      this.#replaceAdmissionAttempt(drifted);
      await this.#persist();
      return zero({
        state:'PRE_EFFECT_DRIFT_RECONCILIATION_REQUIRED',
        attempt_id:row.attempt_id,
        attempt_digest:drifted.attempt_digest,
        observed_library_digest:observedLibraryDigest,
        observed_governance_digest:observedGovernanceDigest,
        effect_attempt_count:1,
        effect_started:false,
        effect_performed:false,
        additional_effect_attempt_performed:false,
        same_effect_id_retry_allowed:false,
        reconciliation_required:true,
        pre_effect_readback_passed:false,
      });
    }

    const prior=this.#library;
    const priorExposureHolds=new Set(this.#admissionExposureHolds);
    try{
      const successor=verifyRsiVerifiedSkillLibrary(row.successor_library);
      this.#assertAppendOnlyLibrary(successor);
      this.#library=successor;
      this.#admissionExposureHolds.add(row.proposed_skill_digest);
      const governance=this.governance();
      const added=governance.entries.find(entry=>entry.skill_digest===row.proposed_skill_digest);
      if(!added||added.evidence_window_count!==0||added.state!=='DORMANT_CAP'||added.active_for_composition!==false||added.admission_exposure_hold!==true){
        throw new Error('rsi_runtime_skill_admission_storage_only_dormancy_violation');
      }
      const confirmed=this.#appendAdmissionState(row,'CONFIRMED_APPLIED_STORAGE_ONLY',digest({library_digest:this.#library.library_digest,governance_digest:governance.governance_digest}));
      this.#replaceAdmissionAttempt(confirmed);
      await this.#persist();
      return zero({
        state:'CONFIRMED_APPLIED_STORAGE_ONLY',attempt_id:row.attempt_id,attempt_digest:confirmed.attempt_digest,
        library_digest:this.#library.library_digest,entry_count:this.#library.entry_count,effect_attempt_count:1,
        reconciled_pending:0,storage_only:true,retrieval_exposure_changed:false,skill_activation_performed:false,
        same_effect_id_retry_allowed:false,pre_effect_readback_passed:true,
      });
    }catch(error){
      this.#library=prior;
      this.#admissionExposureHolds=priorExposureHolds;
      throw error;
    }
  }
  async reconcileLibraryAdmissionAttempt({
    attempt_id,readback_owner_identity_digest,external_readback_owner=false,authored_by_candidate=true,
  }={}){
    this.#assertInit();
    if(external_readback_owner!==true||authored_by_candidate!==false)throw new Error('rsi_runtime_skill_admission_external_readback_owner_required');
    const attemptId=boundedId(attempt_id,'admission_attempt_id');
    const row=this.#findAdmissionAttempt(attemptId);
    if(!row)throw new Error('rsi_runtime_skill_admission_attempt_missing');
    if(row.current_state!=='ATTEMPTED'&&row.current_state!=='RECONCILIATION_ONLY'){
      throw new Error('rsi_runtime_skill_admission_reconciliation_state_invalid');
    }
    const readbackOwner=exactDigest(readback_owner_identity_digest,'admission_readback_owner');
    if(readbackOwner===row.effect_executor_identity_digest||admissionPrincipalDigests(row.admission_certificate).includes(readbackOwner)){
      throw new Error('rsi_runtime_skill_admission_readback_separation_invalid');
    }
    const observed=this.#library?.library_digest||null;
    let nextState='RECONCILIATION_ONLY';
    if(observed===row.successor_library_digest){
      const observedLibrary=verifyRsiVerifiedSkillLibrary(this.#library);
      if(observedLibrary.library_digest!==verifyRsiVerifiedSkillLibrary(row.successor_library).library_digest){
        throw new Error('rsi_runtime_skill_admission_reconciliation_successor_payload_mismatch');
      }
      const priorExposureHolds=new Set(this.#admissionExposureHolds);
      try{
        this.#admissionExposureHolds.add(row.proposed_skill_digest);
        const governance=this.governance();
        const added=governance.entries.find(entry=>entry.skill_digest===row.proposed_skill_digest);
        if(!added||added.evidence_window_count!==0||added.state!=='DORMANT_CAP'||added.active_for_composition!==false||added.admission_exposure_hold!==true){
          throw new Error('rsi_runtime_skill_admission_reconciliation_dormancy_violation');
        }
      }catch(error){
        this.#admissionExposureHolds=priorExposureHolds;
        throw error;
      }
      nextState='CONFIRMED_APPLIED_STORAGE_ONLY';
    }else if(observed===row.predecessor_library_digest){
      nextState='CONFIRMED_NOT_APPLIED_NEW_ATTEMPT_REQUIRED';
    }
    const observation=digest({observed_library_digest:observed,readback_owner_identity_digest:readbackOwner});
    const reconciled=this.#appendAdmissionState(row,nextState,observation);
    this.#replaceAdmissionAttempt(reconciled);
    await this.#persist();
    return zero({
      state:nextState,attempt_id:attemptId,attempt_digest:reconciled.attempt_digest,
      observed_library_digest:observed,effect_attempt_count:1,additional_effect_attempt_performed:false,
      same_effect_id_retry_allowed:false,new_attempt_required:nextState==='CONFIRMED_NOT_APPLIED_NEW_ATTEMPT_REQUIRED',
      storage_only_pending_governance:nextState==='CONFIRMED_APPLIED_STORAGE_ONLY',
      reconciliation_complete:ADMISSION_TERMINAL_STATES.has(nextState),
    });
  }
  admissionExposureHoldProvenance(skillDigest){
    this.#assertInit();
    const skill=exactDigest(skillDigest,'exposure_hold_provenance_skill');
    if(!this.#admissionExposureHolds.has(skill))return null;
    const matches=this.#admissionAttempts.filter(row=>row.current_state==='CONFIRMED_APPLIED_STORAGE_ONLY'&&row.proposed_skill_digest===skill);
    if(matches.length===0)return null;
    if(matches.length!==1)throw new Error('rsi_runtime_skill_exposure_hold_provenance_ambiguous');
    const attempt=matches[0];
    const confirmed=attempt.transitions.find(row=>row.state==='CONFIRMED_APPLIED_STORAGE_ONLY');
    if(!confirmed)throw new Error('rsi_runtime_skill_exposure_hold_provenance_transition_missing');
    const governance=this.governance();
    if(!governance)throw new Error('rsi_runtime_skill_exposure_hold_provenance_governance_missing');
    const entry=governance.entries.find(row=>row.skill_digest===skill);
    if(!entry||entry.admission_exposure_hold!==true||entry.state!=='DORMANT_CAP'||entry.active_for_composition!==false){
      throw new Error('rsi_runtime_skill_exposure_hold_provenance_current_hold_invalid');
    }
    const core={
      schema:'metaengine.rsi.admission-exposure-hold-provenance.v1',version:1,
      skill_digest:skill,
      admission_attempt_id:attempt.attempt_id,
      admission_attempt_digest:attempt.attempt_digest,
      admission_certificate_digest:attempt.admission_certificate_digest,
      effect_id_digest:attempt.effect_id_digest,
      effect_executor_identity_digest:attempt.effect_executor_identity_digest,
      idempotency_key_digest:attempt.idempotency_key_digest,
      admitted_successor_library_digest:attempt.successor_library_digest,
      confirmed_transition_digest:confirmed.transition_digest,
      current_library_digest:this.#library.library_digest,
      current_governance_digest:governance.governance_digest,
      admission_state:'CONFIRMED_APPLIED_STORAGE_ONLY',
      exposure_hold_observed:true,
      dormant_cap_observed:true,
      active_for_composition:false,
      retrieval_exposure_allowed:false,
      release_authority:false,
      execution_authority:false,
      browser_authority:false,
      task_authority:false,
      scheduler_authority:false,
      production_mutation_authority:false,
      promotion_authority:false,
      self_update_authority:false,
      automatic_retry_allowed:false,
      authority_effect:false,
    };
    return Object.freeze({...core,provenance_digest:digest(core)});
  }
  admissionAttemptSnapshot(attemptId){
    this.#assertInit();
    const row=this.#findAdmissionAttempt(boundedId(attemptId,'admission_attempt_id'));
    return row?Object.freeze(structuredClone(row)):null;
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
      historical_libraries:this.#governanceHistoricalLibraries(),
      admission_exposure_hold_skill_digests:[...this.#admissionExposureHolds],
      external_library_owner:true,authored_by_candidate:false,
    });
  }
  exposureReleaseGovernancePreview(skillDigest){
    this.#assertInit();
    if(!this.#library)throw new Error('rsi_runtime_skill_library_unavailable');
    const skill=exactDigest(skillDigest,'exposure_release_preview_skill');
    if(!this.#admissionExposureHolds.has(skill))throw new Error('rsi_runtime_skill_exposure_release_hold_required');
    const admissionProvenance=this.admissionExposureHoldProvenance(skill);
    if(!admissionProvenance)throw new Error('rsi_runtime_skill_exposure_release_admission_provenance_required');
    const currentGovernance=this.governance();
    verifyRsiSkillLibraryGovernance(currentGovernance,this.#library);
    const nextHolds=[...this.#admissionExposureHolds].filter(value=>value!==skill);
    if(nextHolds.length!==this.#admissionExposureHolds.size-1)throw new Error('rsi_runtime_skill_exposure_release_hold_cardinality_invalid');
    const nextGovernance=createRsiSkillLibraryGovernance({
      governance_id:this.#governanceId(),library:this.#library,lifecycle_evidence:this.#evidence,
      historical_libraries:this.#governanceHistoricalLibraries(),
      admission_exposure_hold_skill_digests:nextHolds,
      external_library_owner:true,authored_by_candidate:false,
    });
    verifyRsiSkillLibraryGovernance(nextGovernance,this.#library);
    const currentRow=currentGovernance.entries.find(row=>row.skill_digest===skill);
    const nextRow=nextGovernance.entries.find(row=>row.skill_digest===skill);
    if(!currentRow||currentRow.state!=='DORMANT_CAP'||currentRow.active_for_composition!==false||currentRow.admission_exposure_hold!==true){
      throw new Error('rsi_runtime_skill_exposure_release_current_state_invalid');
    }
    if(!nextRow||nextRow.state!=='EXPLORATION_ACTIVE'||nextRow.active_for_composition!==true||nextRow.admission_exposure_hold===true){
      throw new Error('rsi_runtime_skill_exposure_release_next_state_not_exploration_active');
    }
    return zero({
      state:'ZERO_EFFECT_PREVIEW_READY',
      skill_digest:skill,
      library:structuredClone(this.#library),
      current_governance:currentGovernance,
      next_governance:nextGovernance,
      admission_provenance:admissionProvenance,
      current_governance_digest:currentGovernance.governance_digest,
      next_governance_digest:nextGovernance.governance_digest,
      preview_mutates_lifecycle:false,
      preview_releases_hold:false,
      preview_changes_retrieval_exposure:false,
      browser_authority:false,
      task_authority:false,
      scheduler_authority:false,
    });
  }
  #findExposureReleaseAttempt(attemptId){return this.#exposureReleaseAttempts.find(row=>row.attempt_id===attemptId)||null}
  #replaceExposureReleaseAttempt(nextRow){
    const index=this.#exposureReleaseAttempts.findIndex(row=>row.attempt_id===nextRow.attempt_id);
    if(index<0)throw new Error('rsi_runtime_skill_exposure_release_attempt_missing');
    this.#exposureReleaseAttempts=[...this.#exposureReleaseAttempts.slice(0,index),validateExposureReleaseAttemptRow(nextRow),...this.#exposureReleaseAttempts.slice(index+1)];
  }
  #appendExposureReleaseState(row,state,observationDigest=null){
    const transition=appendExposureReleaseTransition(row,state,this.#now(),observationDigest);
    const next={...structuredClone(row),current_state:state,transitions:[...row.transitions,transition]};
    delete next.attempt_digest;
    return validateExposureReleaseAttemptRow({...next,attempt_digest:digest(next)});
  }
  async prepareExposureReleaseAttempt({
    attempt_id,release_certificate,release_certificate_args,
    effect_id_digest,idempotency_key_digest,effect_executor_identity_digest,
    external_governance_owner=false,external_effect_executor=false,authored_by_candidate=true,
  }={}){
    this.#assertInit();
    if(external_governance_owner!==true||external_effect_executor!==true||authored_by_candidate!==false){
      throw new Error('rsi_runtime_skill_exposure_release_external_owners_required');
    }
    if(!this.#library)throw new Error('rsi_runtime_skill_exposure_release_library_required');
    if(this.#exposureReleaseAttempts.length>=MAX_EXPOSURE_RELEASE_ATTEMPTS)throw new Error('rsi_runtime_skill_exposure_release_attempt_capacity_exceeded');
    const attemptId=boundedId(attempt_id,'exposure_release_attempt_id');
    const verificationArgs=Object.freeze({
      library:release_certificate_args?.library,
      current_governance:release_certificate_args?.current_governance,
      next_governance:release_certificate_args?.next_governance,
      release_preview:release_certificate_args?.release_preview,
      release_review:release_certificate_args?.release_review,
      admission_provenance:release_certificate_args?.admission_provenance,
    });
    const certificate=verifyRsiSkillExposureReleaseCertificate(release_certificate,verificationArgs);
    if(certificate.state!=='ELIGIBLE_FOR_ONE_ATTEMPT_EXPOSURE_RELEASE'||certificate.eligible_for_one_attempt_exposure_release!==true
      ||certificate.one_attempt_release_required!==true||certificate.ambiguous_release_retry_allowed!==false
      ||certificate.release_effect_authorized!==false||certificate.release_effect_performed!==false
      ||certificate.automatic_full_activation_allowed!==false||certificate.release_mode!=='EXPLORATION_ACTIVE_ONLY'){
      throw new Error('rsi_runtime_skill_exposure_release_certificate_policy_invalid');
    }
    if(exactSha(verificationArgs.release_review?.source_sha,'exposure_release_source')!==this.#sourceSha){
      throw new Error('rsi_runtime_skill_exposure_release_source_sha_mismatch');
    }
    const currentGovernance=this.governance();
    if(this.#library.library_digest!==certificate.library_digest||currentGovernance.governance_digest!==certificate.current_governance_digest){
      throw new Error('rsi_runtime_skill_exposure_release_current_state_drift');
    }
    const preview=this.exposureReleaseGovernancePreview(certificate.skill_digest);
    if(preview.next_governance_digest!==certificate.next_governance_digest
      ||preview.admission_provenance.provenance_digest!==certificate.admission_provenance_digest){
      throw new Error('rsi_runtime_skill_exposure_release_preview_binding_mismatch');
    }
    const effectId=exactDigest(effect_id_digest,'exposure_release_effect_id');
    const idempotency=exactDigest(idempotency_key_digest,'exposure_release_idempotency_key');
    const executor=exactDigest(effect_executor_identity_digest,'exposure_release_effect_executor');
    if(exposureReleasePrincipalDigests(certificate,verificationArgs).includes(executor))throw new Error('rsi_runtime_skill_exposure_release_executor_separation_invalid');
    const conflict=this.#exposureReleaseAttempts.find(row=>row.attempt_id===attemptId||row.effect_id_digest===effectId||row.idempotency_key_digest===idempotency||row.release_certificate_digest===certificate.certificate_digest);
    if(conflict)throw new Error('rsi_runtime_skill_exposure_release_attempt_identity_conflict');
    const preparedTransition=appendExposureReleaseTransition({transitions:[]},'PREPARED',this.#now(),digest({
      library_digest:this.#library.library_digest,governance_digest:currentGovernance.governance_digest,next_governance_digest:certificate.next_governance_digest,
    }));
    const core=zero({
      schema:'metaengine.rsi.runtime-skill-exposure-release-attempt.v1',version:1,source_sha:this.#sourceSha,
      attempt_id:attemptId,release_certificate:certificate,release_certificate_args:verificationArgs,
      release_certificate_digest:certificate.certificate_digest,skill_digest:certificate.skill_digest,
      admission_provenance_digest:certificate.admission_provenance_digest,
      current_library_digest:certificate.library_digest,current_governance_digest:certificate.current_governance_digest,
      expected_next_governance_digest:certificate.next_governance_digest,
      effect_id_digest:effectId,idempotency_key_digest:idempotency,effect_executor_identity_digest:executor,
      current_state:'PREPARED',transitions:Object.freeze([preparedTransition]),effect_attempt_count:0,effect_attempt_limit:1,
      blind_retry_forbidden:true,ambiguous_outcome_requires_readback_only_reconciliation:true,
      release_mode:'EXPLORATION_ACTIVE_ONLY',full_activation_authorized:false,only_target_exposure_hold_may_change:true,
    });
    const attempt=validateExposureReleaseAttemptRow({...core,attempt_digest:digest(core)});
    this.#exposureReleaseAttempts.push(attempt);await this.#persist();
    return zero({state:'PREPARED',attempt_id:attempt.attempt_id,attempt_digest:attempt.attempt_digest,skill_digest:attempt.skill_digest,
      current_library_digest:attempt.current_library_digest,current_governance_digest:attempt.current_governance_digest,
      expected_next_governance_digest:attempt.expected_next_governance_digest,effect_attempt_count:0,effect_performed:false,
      retrieval_exposure_changed:false,full_activation_authorized:false,same_effect_id_retry_allowed:false});
  }
  async recordExposureReleaseAttempted({
    attempt_id,effect_executor_identity_digest,external_effect_executor=false,authored_by_candidate=true,
  }={}){
    this.#assertInit();
    if(external_effect_executor!==true||authored_by_candidate!==false)throw new Error('rsi_runtime_skill_exposure_release_external_executor_required');
    const attemptId=boundedId(attempt_id,'exposure_release_attempt_id');
    const row=this.#findExposureReleaseAttempt(attemptId);
    if(!row)throw new Error('rsi_runtime_skill_exposure_release_attempt_missing');
    if(row.current_state!=='PREPARED')throw new Error('rsi_runtime_skill_exposure_release_attempt_not_prepared');
    if(exactDigest(effect_executor_identity_digest,'exposure_release_effect_executor')!==row.effect_executor_identity_digest){
      throw new Error('rsi_runtime_skill_exposure_release_executor_identity_mismatch');
    }
    const governance=this.governance();
    if(!this.#library||this.#library.library_digest!==row.current_library_digest||!governance||governance.governance_digest!==row.current_governance_digest){
      throw new Error('rsi_runtime_skill_exposure_release_pre_attempt_state_drift');
    }
    let attempted=this.#appendExposureReleaseState(row,'ATTEMPTED',digest({library_digest:this.#library.library_digest,governance_digest:governance.governance_digest}));
    const next=structuredClone(attempted);delete next.attempt_digest;next.effect_attempt_count=1;attempted=validateExposureReleaseAttemptRow({...next,attempt_digest:digest(next)});
    this.#replaceExposureReleaseAttempt(attempted);await this.#persist();
    return zero({state:'ATTEMPTED',attempt_id:attemptId,attempt_digest:attempted.attempt_digest,effect_attempt_count:1,
      reconciliation_required:true,effect_performed:false,retrieval_exposure_changed:false,full_activation_authorized:false,same_effect_id_retry_allowed:false});
  }
  async executePreparedExposureReleaseAttempt({
    attempt_id,effect_executor_identity_digest,external_effect_executor=false,authored_by_candidate=true,
  }={}){
    this.#assertInit();
    const attemptId=boundedId(attempt_id,'exposure_release_attempt_id');
    let row=this.#findExposureReleaseAttempt(attemptId);
    if(!row)throw new Error('rsi_runtime_skill_exposure_release_attempt_missing');
    if(row.current_state==='ATTEMPTED'||row.current_state==='RECONCILIATION_ONLY'){
      throw new Error('rsi_runtime_skill_exposure_release_attempt_ambiguous_reconcile_required');
    }
    if(row.current_state!=='PREPARED')throw new Error('rsi_runtime_skill_exposure_release_attempt_not_prepared');
    await this.recordExposureReleaseAttempted({attempt_id:attemptId,effect_executor_identity_digest,external_effect_executor,authored_by_candidate});
    row=this.#findExposureReleaseAttempt(attemptId);
    const preEffectGovernance=this.governance();
    const observedLibraryDigest=this.#library?.library_digest||null;
    const observedGovernanceDigest=preEffectGovernance?.governance_digest||null;
    const preview=observedLibraryDigest===row.current_library_digest&&observedGovernanceDigest===row.current_governance_digest
      ?this.exposureReleaseGovernancePreview(row.skill_digest):null;
    if(observedLibraryDigest!==row.current_library_digest||observedGovernanceDigest!==row.current_governance_digest
      ||preview?.next_governance_digest!==row.expected_next_governance_digest
      ||preview?.admission_provenance?.provenance_digest!==row.admission_provenance_digest){
      const observation=digest({stage:'POST_ATTEMPT_PRE_EFFECT_READBACK',observed_library_digest:observedLibraryDigest,
        observed_governance_digest:observedGovernanceDigest,observed_next_governance_digest:preview?.next_governance_digest||null});
      const drifted=this.#appendExposureReleaseState(row,'PRE_EFFECT_DRIFT_NEW_ATTEMPT_REQUIRED',observation);
      this.#replaceExposureReleaseAttempt(drifted);await this.#persist();
      return zero({state:'PRE_EFFECT_DRIFT_NEW_ATTEMPT_REQUIRED',attempt_id:row.attempt_id,attempt_digest:drifted.attempt_digest,
        observed_library_digest:observedLibraryDigest,observed_governance_digest:observedGovernanceDigest,effect_attempt_count:1,
        effect_started:false,effect_performed:false,retrieval_exposure_changed:false,full_activation_authorized:false,
        same_effect_id_retry_allowed:false,new_attempt_required:true,reconciliation_required:false,pre_effect_readback_passed:false});
    }
    this.#admissionExposureHolds.delete(row.skill_digest);
    const nextGovernance=this.governance();
    const target=nextGovernance.entries.find(entry=>entry.skill_digest===row.skill_digest);
    if(nextGovernance.governance_digest!==row.expected_next_governance_digest||!target||target.state!=='EXPLORATION_ACTIVE'
      ||target.active_for_composition!==true||target.admission_exposure_hold===true){
      throw new Error('rsi_runtime_skill_exposure_release_post_effect_readback_mismatch');
    }
    const confirmed=this.#appendExposureReleaseState(row,'CONFIRMED_EXPLORATION_EXPOSURE',digest({
      library_digest:this.#library.library_digest,governance_digest:nextGovernance.governance_digest,skill_digest:row.skill_digest,
    }));
    this.#replaceExposureReleaseAttempt(confirmed);await this.#persist();
    return zero({state:'CONFIRMED_EXPLORATION_EXPOSURE',attempt_id:row.attempt_id,attempt_digest:confirmed.attempt_digest,
      skill_digest:row.skill_digest,library_digest:this.#library.library_digest,governance_digest:nextGovernance.governance_digest,
      effect_attempt_count:1,effect_started:true,effect_performed:true,retrieval_exposure_changed:true,
      release_mode:'EXPLORATION_ACTIVE_ONLY',full_activation_authorized:false,same_effect_id_retry_allowed:false,pre_effect_readback_passed:true});
  }
  async reconcileExposureReleaseAttempt({
    attempt_id,readback_owner_identity_digest,external_readback_owner=false,authored_by_candidate=true,
  }={}){
    this.#assertInit();
    if(external_readback_owner!==true||authored_by_candidate!==false)throw new Error('rsi_runtime_skill_exposure_release_external_readback_owner_required');
    const attemptId=boundedId(attempt_id,'exposure_release_attempt_id');
    const row=this.#findExposureReleaseAttempt(attemptId);
    if(!row)throw new Error('rsi_runtime_skill_exposure_release_attempt_missing');
    if(row.current_state!=='ATTEMPTED'&&row.current_state!=='RECONCILIATION_ONLY')throw new Error('rsi_runtime_skill_exposure_release_reconciliation_state_invalid');
    const readbackOwner=exactDigest(readback_owner_identity_digest,'exposure_release_readback_owner');
    if(readbackOwner===row.effect_executor_identity_digest||exposureReleasePrincipalDigests(row.release_certificate,row.release_certificate_args).includes(readbackOwner)){
      throw new Error('rsi_runtime_skill_exposure_release_readback_separation_invalid');
    }
    const governance=this.governance();
    const observedLibraryDigest=this.#library?.library_digest||null;
    const observedGovernanceDigest=governance?.governance_digest||null;
    const entry=governance?.entries.find(candidate=>candidate.skill_digest===row.skill_digest)||null;
    const held=this.#admissionExposureHolds.has(row.skill_digest);
    let nextState='RECONCILIATION_ONLY';
    if(observedLibraryDigest===row.current_library_digest&&observedGovernanceDigest===row.expected_next_governance_digest
      &&held===false&&entry?.state==='EXPLORATION_ACTIVE'&&entry?.active_for_composition===true&&entry?.admission_exposure_hold!==true){
      nextState='CONFIRMED_EXPLORATION_EXPOSURE_BY_READBACK';
    }else if(observedLibraryDigest===row.current_library_digest&&observedGovernanceDigest===row.current_governance_digest
      &&held===true&&entry?.state==='DORMANT_CAP'&&entry?.active_for_composition===false&&entry?.admission_exposure_hold===true){
      nextState='CONFIRMED_NO_EFFECT_NEW_ATTEMPT_REQUIRED';
    }
    const observation=digest({observed_library_digest:observedLibraryDigest,observed_governance_digest:observedGovernanceDigest,
      observed_hold_present:held,readback_owner_identity_digest:readbackOwner});
    const reconciled=this.#appendExposureReleaseState(row,nextState,observation);
    this.#replaceExposureReleaseAttempt(reconciled);await this.#persist();
    return zero({state:nextState,attempt_id:attemptId,attempt_digest:reconciled.attempt_digest,
      observed_library_digest:observedLibraryDigest,observed_governance_digest:observedGovernanceDigest,effect_attempt_count:1,
      additional_effect_attempt_performed:false,same_effect_id_retry_allowed:false,
      retrieval_exposure_changed:nextState==='CONFIRMED_EXPLORATION_EXPOSURE_BY_READBACK',
      full_activation_authorized:false,new_attempt_required:nextState==='CONFIRMED_NO_EFFECT_NEW_ATTEMPT_REQUIRED',
      reconciliation_complete:EXPOSURE_RELEASE_TERMINAL_STATES.has(nextState)});
  }
  exposureReleaseAttemptSnapshot(attemptId){
    this.#assertInit();
    const row=this.#findExposureReleaseAttempt(boundedId(attemptId,'exposure_release_attempt_id'));
    return row?Object.freeze(structuredClone(row)):null;
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
      admission_attempt_count:this.#admissionAttempts.length,
      admission_attempt_state_counts:Object.freeze(this.#admissionAttempts.reduce((acc,row)=>{acc[row.current_state]=(acc[row.current_state]||0)+1;return acc},{})),
      exposure_release_attempt_count:this.#exposureReleaseAttempts.length,
      exposure_release_attempt_state_counts:Object.freeze(this.#exposureReleaseAttempts.reduce((acc,row)=>{acc[row.current_state]=(acc[row.current_state]||0)+1;return acc},{})),
      admission_exposure_hold_skill_digests:Object.freeze([...this.#admissionExposureHolds].sort()),
      admission_exposure_hold_count:this.#admissionExposureHolds.size,
      confirmed_admission_exposure_provenance_count:this.#admissionAttempts.filter(row=>row.current_state==='CONFIRMED_APPLIED_STORAGE_ONLY'&&this.#admissionExposureHolds.has(row.proposed_skill_digest)).length,
      admission_exposure_holds_force_nonactive:true,
      storage_admission_does_not_imply_retrieval_exposure:true,
      admission_exposure_hold_release_requires_external_governance:true,
      exposure_release_governance_preview_is_zero_effect:true,
      exposure_release_preview_requires_exploration_active_next_state:true,
      governance_digest:governance?.governance_digest||null,
      active_count:governance?.active_count||0,quarantined_count:governance?.quarantined_count||0,
      retired_count:governance?.retired_count||0,dormant_count:governance?.dormant_count||0,
      evidence_append_only:true,pending_is_bounded:true,contextual_credit_not_global_truth:true,
      admission_attempts_append_only:true,admission_effect_attempt_limit:1,blind_retry_for_admission_effect:false,
      pre_effect_state_readback_after_attempt_persist_required:true,
      ambiguous_admission_effect_requires_readback_only_reconciliation:true,
      exposure_release_attempts_append_only:true,exposure_release_effect_attempt_limit:1,
      blind_retry_for_exposure_release_effect:false,exposure_release_pre_effect_readback_after_attempt_persist_required:true,
      ambiguous_exposure_release_effect_requires_readback_only_reconciliation:true,
      exposure_release_mode:'EXPLORATION_ACTIVE_ONLY',full_activation_from_exposure_release_forbidden:true,
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
    verified_library_required:true,library_updates_append_only:true,exact_library_digest_cas_supported:true,
    phase34_anytime_admission_certificate_required:true,admission_attempts_durable_before_effect:true,
    admission_effect_attempt_limit:1,blind_retry_for_admission_effect:false,
    pre_effect_state_readback_after_attempt_persist_required:true,
    ambiguous_attempt_readback_only_reconciliation:true,admission_attempt_state_is_append_only:true,
    storage_append_does_not_reconcile_pending_evidence:true,
    storage_append_does_not_activate_skill:true,zero_evidence_skill_activation_forbidden:true,
    admission_exposure_holds_force_nonactive:true,
    storage_admission_does_not_imply_retrieval_exposure:true,
    admission_exposure_hold_release_requires_external_governance:true,
    exposure_release_requires_confirmed_admission_provenance:true,
    confirmed_admission_provenance_binds_attempt_digest:true,
    confirmed_admission_provenance_binds_effect_executor_identity:true,
    exposure_release_governance_preview_is_zero_effect:true,
    exposure_release_preview_requires_exact_hold_removal:true,
    exposure_release_preview_requires_exploration_active_next_state:true,
    exposure_release_attempts_durable_before_effect:true,
    exposure_release_effect_attempt_limit:1,
    blind_retry_for_exposure_release_effect:false,
    exposure_release_pre_effect_readback_after_attempt_persist_required:true,
    ambiguous_exposure_release_effect_requires_readback_only_reconciliation:true,
    exposure_release_only_to_exploration_active:true,
    full_activation_from_exposure_release_forbidden:true,
    independently_credited_outcomes_only:true,contextual_credit_not_global_truth:true,
    lifecycle_windows_are_append_only:true,bounded_pending_before_library:true,
    candidate_can_write_lifecycle:false,candidate_can_reactivate_skill:false,candidate_can_retire_skill:false,
    skill_activation_view_is_execution_authority:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,skill_lifecycle_root_digest:digest(root)});
}
