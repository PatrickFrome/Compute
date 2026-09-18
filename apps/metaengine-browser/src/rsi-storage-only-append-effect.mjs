import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  verifyRsiAnytimeLibraryAdmissionCertificate,
} from './rsi-anytime-library-admission.mjs';
import {
  createRsiVerifiedSkillLibrary,
  verifyRsiVerifiedSkillLibrary,
  verifyRsiSkillCapsule,
  verifyRsiSkillEvidence,
} from './rsi-verified-skill-library.mjs';

export const RSI_STORAGE_ONLY_APPEND_EFFECT_PLAN_SCHEMA='metaengine.rsi.storage-only-append-effect-plan.v1';
export const RSI_STORAGE_ONLY_APPEND_EFFECT_READBACK_SCHEMA='metaengine.rsi.storage-only-append-effect-readback.v1';
export const RSI_STORAGE_ONLY_APPEND_EFFECT_RECONCILIATION_SCHEMA='metaengine.rsi.storage-only-append-effect-reconciliation.v1';
export const RSI_STORAGE_ONLY_APPEND_EFFECT_ARCHIVE_SCHEMA='metaengine.rsi.storage-only-append-effect-archive.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const EFFECT_OUTCOMES=new Set(['CONFIRMED_APPLIED','CONFIRMED_NOT_APPLIED','AMBIGUOUS']);
const MAX_EVENTS=4096;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function digest(v){return 'sha256:'+crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex');}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error('rsi_phase34_effect_'+l+'_digest_invalid');return x;}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error('rsi_phase34_effect_'+l+'_sha_invalid');return x;}
function id(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error('rsi_phase34_effect_'+l+'_invalid');return x;}
function positiveInt(v,l){if(!Number.isInteger(v)||v<1)throw new Error('rsi_phase34_effect_'+l+'_invalid');return v;}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false});}
function assertZero(v,l){for(const f of ['execution_authority','browser_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error('rsi_phase34_effect_'+l+'_'+f+'_invalid');if(v?.automatic_retry_allowed!==false)throw new Error('rsi_phase34_effect_'+l+'_retry_invalid');}

function libraryManifest(library){
  const checked=verifyRsiVerifiedSkillLibrary(library);
  const rows=checked.entries.map(row=>Object.freeze({
    skill_id:row.skill_id,
    skill_version:row.skill_version,
    skill_digest:row.skill_digest,
    evidence_digest:row.evidence_digest,
  }));
  return Object.freeze({
    library_id:checked.library_id,
    library_digest:checked.library_digest,
    entry_count:checked.entry_count,
    rows:Object.freeze(rows),
    manifest_digest:digest({library_id:checked.library_id,rows}),
  });
}

function expectedSuccessor(currentLibrary,skillCapsule,skillEvidence){
  const current=verifyRsiVerifiedSkillLibrary(currentLibrary);
  const skill=verifyRsiSkillCapsule(skillCapsule);
  const evidence=verifyRsiSkillEvidence(skillEvidence,skill);
  if(evidence.verified_for_library!==true||evidence.hard_invariants_pass!==true){
    throw new Error('rsi_phase34_effect_skill_evidence_not_verified');
  }
  if(current.entries.some(row=>row.skill_digest===skill.skill_digest)){
    throw new Error('rsi_phase34_effect_skill_digest_already_present');
  }
  if(current.entries.some(row=>row.skill_id===skill.skill_id&&row.skill_version===skill.skill_version)){
    throw new Error('rsi_phase34_effect_skill_version_already_present');
  }
  const successor=createRsiVerifiedSkillLibrary({
    library_id:current.library_id,
    entries:[
      ...current.entries.map(row=>({capsule:row.capsule,evidence:row.evidence})),
      {capsule:skill,evidence},
    ],
    external_library_owner:true,
    authored_by_candidate:false,
  });
  return Object.freeze({current,skill,evidence,successor});
}

function principalDigests(certificate){
  return Object.freeze([
    certificate.library_owner_identity_digest,
    certificate.statistical_acceptor_identity_digest,
    certificate.source_qualification_owner_identity_digest,
    certificate.least_privilege_reviewer_identity_digest,
    certificate.governance_reviewer_identity_digest,
  ].map((x,i)=>exactDigest(x,'certificate_principal_'+i)));
}

export function createRsiStorageOnlyAppendEffectPlan({
  plan_id,
  admission_certificate,
  admission_certificate_args,
  current_library,
  skill_capsule,
  skill_evidence,
  append_effect_id_digest,
  idempotency_key_digest,
  effect_journal_policy_digest,
  effect_planner_identity_digest,
  external_effect_planner=false,
  authored_by_candidate=true,
}={}){
  if(external_effect_planner!==true||authored_by_candidate!==false){
    throw new Error('rsi_phase34_effect_external_planner_required');
  }
  const certificate=verifyRsiAnytimeLibraryAdmissionCertificate(admission_certificate,admission_certificate_args||{});
  if(certificate.state!=='ELIGIBLE_FOR_ONE_ATTEMPT_EXISTING_LIBRARY_APPEND_HANDOFF'){
    throw new Error('rsi_phase34_effect_admission_certificate_not_eligible');
  }
  if(certificate.append_handoff_one_attempt_only!==true||certificate.ambiguous_append_retry_allowed!==false
    ||certificate.append_effect_performed!==false||certificate.retrieval_exposure_change_authorized!==false
    ||certificate.skill_activation_authorized!==false||certificate.lifecycle_mutation_authorized!==false){
    throw new Error('rsi_phase34_effect_admission_certificate_policy_invalid');
  }

  const exact=expectedSuccessor(current_library,skill_capsule,skill_evidence);
  if(exact.current.library_digest!==certificate.current_library_digest)throw new Error('rsi_phase34_effect_current_library_drift');
  if(exact.skill.skill_digest!==certificate.proposed_skill_digest)throw new Error('rsi_phase34_effect_skill_digest_mismatch');
  if(exact.evidence.evidence_digest!==certificate.proposed_skill_evidence_digest)throw new Error('rsi_phase34_effect_skill_evidence_mismatch');
  if(exact.successor.library_digest!==certificate.proposed_successor_library_digest)throw new Error('rsi_phase34_effect_successor_library_mismatch');

  const currentManifest=libraryManifest(exact.current);
  const successorManifest=libraryManifest(exact.successor);
  const effectId=exactDigest(append_effect_id_digest,'append_effect_id');
  const idempotency=exactDigest(idempotency_key_digest,'idempotency_key');
  const journalPolicy=exactDigest(effect_journal_policy_digest,'effect_journal_policy');
  const planner=exactDigest(effect_planner_identity_digest,'effect_planner_identity');
  const principals=principalDigests(certificate);
  if(principals.includes(planner))throw new Error('rsi_phase34_effect_planner_separation_of_duties_required');

  const roots=[
    certificate.admission_certificate_digest,
    certificate.predecessor_source_qualification_digest,
    certificate.admission_epoch_digest,
    currentManifest.manifest_digest,
    successorManifest.manifest_digest,
    effectId,idempotency,journalPolicy,planner,
  ];
  if(new Set(roots).size!==roots.length)throw new Error('rsi_phase34_effect_independent_roots_required');

  const core=zero({
    schema:RSI_STORAGE_ONLY_APPEND_EFFECT_PLAN_SCHEMA,
    version:1,
    plan_id:id(plan_id,'plan_id'),
    source_sha:exactSha(certificate.source_sha,'source'),
    phase33_policy_source_sha:exactSha(certificate.phase33_policy_source_sha,'phase33_policy_source'),
    phase34_admission_certificate_digest:certificate.admission_certificate_digest,
    phase34_admission_proposal_digest:certificate.admission_proposal_digest,
    predecessor_source_qualification_digest:certificate.predecessor_source_qualification_digest,
    admission_epoch_digest:certificate.admission_epoch_digest,
    current_governance_digest:certificate.current_governance_digest,
    current_library_id:exact.current.library_id,
    current_library_digest:exact.current.library_digest,
    current_library_entry_count:exact.current.entry_count,
    current_library_manifest_digest:currentManifest.manifest_digest,
    proposed_skill_id:exact.skill.skill_id,
    proposed_skill_version:exact.skill.skill_version,
    proposed_skill_digest:exact.skill.skill_digest,
    proposed_skill_evidence_digest:exact.evidence.evidence_digest,
    expected_successor_library_id:exact.successor.library_id,
    expected_successor_library_digest:exact.successor.library_digest,
    expected_successor_entry_count:exact.successor.entry_count,
    expected_successor_library_manifest_digest:successorManifest.manifest_digest,
    append_effect_id_digest:effectId,
    idempotency_key_digest:idempotency,
    effect_journal_policy_digest:journalPolicy,
    effect_planner_identity_digest:planner,
    certificate_library_owner_identity_digest:principals[0],
    certificate_statistical_acceptor_identity_digest:principals[1],
    certificate_source_qualification_owner_identity_digest:principals[2],
    certificate_least_privilege_reviewer_identity_digest:principals[3],
    certificate_governance_reviewer_identity_digest:principals[4],
    external_effect_planner:true,
    authored_by_candidate:false,
    existing_verified_skill_library_schema_reused:true,
    second_skill_library_created:false,
    exact_single_skill_append_required:true,
    predecessor_entries_preserved:true,
    append_is_storage_only:true,
    effect_attempt_limit:1,
    effect_attempted:false,
    library_append_performed:false,
    durable_plan_required_before_effect:true,
    blind_retry_forbidden:true,
    ambiguous_effect_requires_reconciliation:true,
    same_effect_id_retry_allowed:false,
    candidate_can_choose_effect_identity:false,
    candidate_can_choose_effect_planner:false,
    candidate_can_choose_governance_state:false,
    governance_recompute_performed:false,
    activation_view_rebuilt:false,
    retrieval_exposure_changed:false,
    skill_activation_performed:false,
    lifecycle_mutation_performed:false,
    state:'READY_FOR_EXTERNAL_STORAGE_ONLY_APPEND_EFFECT',
  });
  return Object.freeze({...core,plan_digest:digest(core)});
}

export function verifyRsiStorageOnlyAppendEffectPlan(plan,args={}){
  if(!plan||plan.schema!==RSI_STORAGE_ONLY_APPEND_EFFECT_PLAN_SCHEMA||plan.version!==1)throw new Error('rsi_phase34_effect_plan_invalid');
  assertZero(plan,'plan');
  if(plan.external_effect_planner!==true||plan.authored_by_candidate!==false
    ||plan.existing_verified_skill_library_schema_reused!==true||plan.second_skill_library_created!==false
    ||plan.exact_single_skill_append_required!==true||plan.predecessor_entries_preserved!==true
    ||plan.append_is_storage_only!==true||plan.effect_attempt_limit!==1||plan.effect_attempted!==false
    ||plan.library_append_performed!==false||plan.durable_plan_required_before_effect!==true
    ||plan.blind_retry_forbidden!==true||plan.ambiguous_effect_requires_reconciliation!==true
    ||plan.same_effect_id_retry_allowed!==false||plan.candidate_can_choose_effect_identity!==false
    ||plan.candidate_can_choose_effect_planner!==false||plan.candidate_can_choose_governance_state!==false
    ||plan.governance_recompute_performed!==false||plan.activation_view_rebuilt!==false
    ||plan.retrieval_exposure_changed!==false||plan.skill_activation_performed!==false
    ||plan.lifecycle_mutation_performed!==false||plan.state!=='READY_FOR_EXTERNAL_STORAGE_ONLY_APPEND_EFFECT'){
    throw new Error('rsi_phase34_effect_plan_policy_invalid');
  }
  const canonical=createRsiStorageOnlyAppendEffectPlan({
    ...args,
    plan_id:plan.plan_id,
    append_effect_id_digest:plan.append_effect_id_digest,
    idempotency_key_digest:plan.idempotency_key_digest,
    effect_journal_policy_digest:plan.effect_journal_policy_digest,
    effect_planner_identity_digest:plan.effect_planner_identity_digest,
    external_effect_planner:true,
    authored_by_candidate:false,
  });
  if(canonical.plan_digest!==exactDigest(plan.plan_digest,'plan'))throw new Error('rsi_phase34_effect_plan_digest_mismatch');
  return canonical;
}

function verifyPredecessors(current,observed){
  for(const before of current.entries){
    const after=observed.entries.find(row=>row.skill_digest===before.skill_digest);
    if(!after)throw new Error('rsi_phase34_effect_predecessor_entry_missing');
    if(after.skill_id!==before.skill_id||after.skill_version!==before.skill_version||after.evidence_digest!==before.evidence_digest){
      throw new Error('rsi_phase34_effect_predecessor_entry_changed');
    }
  }
}

function readbackLibraryState(plan,currentLibrary,observedLibrary){
  const current=verifyRsiVerifiedSkillLibrary(currentLibrary);
  const observed=verifyRsiVerifiedSkillLibrary(observedLibrary);
  const manifest=libraryManifest(observed);
  if(observed.library_digest===plan.current_library_digest&&manifest.manifest_digest===plan.current_library_manifest_digest){
    return Object.freeze({kind:'PREDECESSOR',library:observed,manifest});
  }
  if(observed.library_digest===plan.expected_successor_library_digest&&manifest.manifest_digest===plan.expected_successor_library_manifest_digest){
    verifyPredecessors(current,observed);
    return Object.freeze({kind:'SUCCESSOR',library:observed,manifest});
  }
  return Object.freeze({kind:'OTHER',library:observed,manifest});
}

export function createRsiStorageOnlyAppendEffectReadback({
  receipt_id,
  plan,
  plan_args,
  effect_outcome,
  observed_library=null,
  effect_attempt_count,
  effect_journal_entry_digest,
  effect_executor_identity_digest,
  readback_owner_identity_digest,
  external_effect_executor=false,
  external_readback_owner=false,
  authored_by_candidate=true,
}={}){
  const checkedPlan=verifyRsiStorageOnlyAppendEffectPlan(plan,plan_args||{});
  if(external_effect_executor!==true||external_readback_owner!==true||authored_by_candidate!==false){
    throw new Error('rsi_phase34_effect_external_executor_readback_required');
  }
  const outcome=String(effect_outcome||'').trim().toUpperCase();
  if(!EFFECT_OUTCOMES.has(outcome))throw new Error('rsi_phase34_effect_outcome_invalid');
  const attempts=positiveInt(effect_attempt_count,'effect_attempt_count');
  if(attempts!==1)throw new Error('rsi_phase34_effect_attempt_limit_exceeded');
  const journal=exactDigest(effect_journal_entry_digest,'effect_journal_entry');
  const executor=exactDigest(effect_executor_identity_digest,'effect_executor_identity');
  const readback=exactDigest(readback_owner_identity_digest,'readback_owner_identity');
  const principals=[
    checkedPlan.effect_planner_identity_digest,
    checkedPlan.certificate_library_owner_identity_digest,
    checkedPlan.certificate_statistical_acceptor_identity_digest,
    checkedPlan.certificate_source_qualification_owner_identity_digest,
    checkedPlan.certificate_least_privilege_reviewer_identity_digest,
    checkedPlan.certificate_governance_reviewer_identity_digest,
    executor,readback,
  ];
  if(new Set(principals).size!==principals.length)throw new Error('rsi_phase34_effect_execution_readback_separation_required');

  let observedKind='NONE';
  let observedDigest=null;
  let observedManifestDigest=null;
  let observedCount=null;
  let appendConfirmed=false;
  let reconciliationRequired=false;
  let newPlanRequired=false;
  let state;

  const observedState=observed_library
    ?readbackLibraryState(checkedPlan,plan_args.current_library,observed_library)
    :null;
  if(observedState){
    observedKind=observedState.kind;
    observedDigest=observedState.library.library_digest;
    observedManifestDigest=observedState.manifest.manifest_digest;
    observedCount=observedState.library.entry_count;
  }

  if(outcome==='CONFIRMED_APPLIED'){
    if(!observedState||observedState.kind!=='SUCCESSOR')throw new Error('rsi_phase34_effect_confirmed_applied_readback_mismatch');
    const current=verifyRsiVerifiedSkillLibrary(plan_args.current_library);
    const added=observedState.library.entries.filter(row=>!current.entries.some(before=>before.skill_digest===row.skill_digest));
    if(added.length!==1||added[0].skill_digest!==checkedPlan.proposed_skill_digest||added[0].evidence_digest!==checkedPlan.proposed_skill_evidence_digest){
      throw new Error('rsi_phase34_effect_exact_single_append_not_observed');
    }
    appendConfirmed=true;
    state='APPEND_CONFIRMED_STORAGE_ONLY_PENDING_GOVERNANCE';
  }else if(outcome==='CONFIRMED_NOT_APPLIED'){
    if(!observedState||observedState.kind!=='PREDECESSOR')throw new Error('rsi_phase34_effect_confirmed_not_applied_readback_mismatch');
    newPlanRequired=true;
    state='APPEND_CONFIRMED_NOT_APPLIED_NEW_PLAN_REQUIRED';
  }else{
    if(observedState&&(observedState.kind==='PREDECESSOR'||observedState.kind==='SUCCESSOR')){
      throw new Error('rsi_phase34_effect_ambiguous_outcome_resolved_by_readback');
    }
    reconciliationRequired=true;
    state='APPEND_EFFECT_AMBIGUOUS_RECONCILIATION_REQUIRED';
  }

  const core=zero({
    schema:RSI_STORAGE_ONLY_APPEND_EFFECT_READBACK_SCHEMA,
    version:1,
    receipt_id:id(receipt_id,'receipt_id'),
    source_sha:checkedPlan.source_sha,
    plan_digest:checkedPlan.plan_digest,
    phase34_admission_certificate_digest:checkedPlan.phase34_admission_certificate_digest,
    append_effect_id_digest:checkedPlan.append_effect_id_digest,
    idempotency_key_digest:checkedPlan.idempotency_key_digest,
    effect_outcome:outcome,
    effect_attempt_count:attempts,
    effect_journal_entry_digest:journal,
    effect_executor_identity_digest:executor,
    readback_owner_identity_digest:readback,
    observed_library_kind:observedKind,
    observed_library_digest:observedDigest,
    observed_library_manifest_digest:observedManifestDigest,
    observed_library_entry_count:observedCount,
    append_confirmed:appendConfirmed,
    reconciliation_required:reconciliationRequired,
    new_plan_required_for_future_attempt:newPlanRequired,
    storage_only_pending_governance:appendConfirmed,
    same_effect_id_retry_allowed:false,
    blind_retry_forbidden:true,
    governance_recompute_performed:false,
    activation_view_rebuilt:false,
    retrieval_exposure_changed:false,
    skill_activation_performed:false,
    lifecycle_mutation_performed:false,
    external_effect_executor:true,
    external_readback_owner:true,
    authored_by_candidate:false,
    state,
  });
  return Object.freeze({...core,receipt_digest:digest(core)});
}

export function verifyRsiStorageOnlyAppendEffectReadback(receipt,{plan,plan_args,observed_library=null}={}){
  if(!receipt||receipt.schema!==RSI_STORAGE_ONLY_APPEND_EFFECT_READBACK_SCHEMA||receipt.version!==1)throw new Error('rsi_phase34_effect_readback_invalid');
  assertZero(receipt,'readback');
  if(receipt.effect_attempt_count!==1||receipt.same_effect_id_retry_allowed!==false||receipt.blind_retry_forbidden!==true
    ||receipt.governance_recompute_performed!==false||receipt.activation_view_rebuilt!==false
    ||receipt.retrieval_exposure_changed!==false||receipt.skill_activation_performed!==false
    ||receipt.lifecycle_mutation_performed!==false||receipt.external_effect_executor!==true
    ||receipt.external_readback_owner!==true||receipt.authored_by_candidate!==false){
    throw new Error('rsi_phase34_effect_readback_policy_invalid');
  }
  const canonical=createRsiStorageOnlyAppendEffectReadback({
    receipt_id:receipt.receipt_id,plan,plan_args,effect_outcome:receipt.effect_outcome,observed_library,
    effect_attempt_count:receipt.effect_attempt_count,effect_journal_entry_digest:receipt.effect_journal_entry_digest,
    effect_executor_identity_digest:receipt.effect_executor_identity_digest,
    readback_owner_identity_digest:receipt.readback_owner_identity_digest,
    external_effect_executor:true,external_readback_owner:true,authored_by_candidate:false,
  });
  if(canonical.receipt_digest!==exactDigest(receipt.receipt_digest,'readback'))throw new Error('rsi_phase34_effect_readback_digest_mismatch');
  return canonical;
}

export function createRsiStorageOnlyAppendEffectReconciliation({
  reconciliation_id,
  plan,
  plan_args,
  ambiguous_receipt,
  ambiguous_observed_library=null,
  observed_library,
  reconciliation_evidence_digest,
  reconciliation_owner_identity_digest,
  external_reconciliation_owner=false,
  authored_by_candidate=true,
}={}){
  const checkedPlan=verifyRsiStorageOnlyAppendEffectPlan(plan,plan_args||{});
  const ambiguous=verifyRsiStorageOnlyAppendEffectReadback(ambiguous_receipt,{
    plan:checkedPlan,plan_args,observed_library:ambiguous_observed_library,
  });
  if(ambiguous.state!=='APPEND_EFFECT_AMBIGUOUS_RECONCILIATION_REQUIRED'||ambiguous.reconciliation_required!==true
    ||ambiguous.same_effect_id_retry_allowed!==false||ambiguous.effect_attempt_count!==1){
    throw new Error('rsi_phase34_effect_ambiguous_receipt_required');
  }
  if(!observed_library)throw new Error('rsi_phase34_effect_reconciliation_observed_library_required');
  if(external_reconciliation_owner!==true||authored_by_candidate!==false){
    throw new Error('rsi_phase34_effect_external_reconciliation_owner_required');
  }
  const state=readbackLibraryState(checkedPlan,plan_args.current_library,observed_library);
  if(state.kind==='OTHER')throw new Error('rsi_phase34_effect_reconciliation_still_unresolved');
  const evidence=exactDigest(reconciliation_evidence_digest,'reconciliation_evidence');
  const owner=exactDigest(reconciliation_owner_identity_digest,'reconciliation_owner_identity');
  const principals=[
    checkedPlan.effect_planner_identity_digest,
    checkedPlan.certificate_library_owner_identity_digest,
    checkedPlan.certificate_statistical_acceptor_identity_digest,
    checkedPlan.certificate_source_qualification_owner_identity_digest,
    checkedPlan.certificate_least_privilege_reviewer_identity_digest,
    checkedPlan.certificate_governance_reviewer_identity_digest,
    ambiguous.effect_executor_identity_digest,
    ambiguous.readback_owner_identity_digest,
    owner,
  ];
  if(new Set(principals).size!==principals.length)throw new Error('rsi_phase34_effect_reconciliation_separation_required');

  const applied=state.kind==='SUCCESSOR';
  if(applied){
    const current=verifyRsiVerifiedSkillLibrary(plan_args.current_library);
    const added=state.library.entries.filter(row=>!current.entries.some(before=>before.skill_digest===row.skill_digest));
    if(added.length!==1||added[0].skill_digest!==checkedPlan.proposed_skill_digest||added[0].evidence_digest!==checkedPlan.proposed_skill_evidence_digest){
      throw new Error('rsi_phase34_effect_reconciliation_exact_single_append_not_observed');
    }
  }
  const core=zero({
    schema:RSI_STORAGE_ONLY_APPEND_EFFECT_RECONCILIATION_SCHEMA,
    version:1,
    reconciliation_id:id(reconciliation_id,'reconciliation_id'),
    source_sha:checkedPlan.source_sha,
    plan_digest:checkedPlan.plan_digest,
    ambiguous_receipt_digest:ambiguous.receipt_digest,
    append_effect_id_digest:checkedPlan.append_effect_id_digest,
    effect_attempt_count:1,
    reconciliation_evidence_digest:evidence,
    reconciliation_owner_identity_digest:owner,
    resolved_library_kind:state.kind,
    resolved_library_digest:state.library.library_digest,
    resolved_library_manifest_digest:state.manifest.manifest_digest,
    resolved_library_entry_count:state.library.entry_count,
    append_confirmed:applied,
    storage_only_pending_governance:applied,
    new_plan_required_for_future_attempt:!applied,
    reconciliation_complete:true,
    additional_effect_attempt_performed:false,
    same_effect_id_retry_allowed:false,
    blind_retry_forbidden:true,
    governance_recompute_performed:false,
    activation_view_rebuilt:false,
    retrieval_exposure_changed:false,
    skill_activation_performed:false,
    lifecycle_mutation_performed:false,
    external_reconciliation_owner:true,
    authored_by_candidate:false,
    state:applied
      ?'RECONCILED_APPLIED_STORAGE_ONLY_PENDING_GOVERNANCE'
      :'RECONCILED_NOT_APPLIED_NEW_PLAN_REQUIRED',
  });
  return Object.freeze({...core,reconciliation_digest:digest(core)});
}

export function verifyRsiStorageOnlyAppendEffectReconciliation(row,args={}){
  if(!row||row.schema!==RSI_STORAGE_ONLY_APPEND_EFFECT_RECONCILIATION_SCHEMA||row.version!==1){
    throw new Error('rsi_phase34_effect_reconciliation_invalid');
  }
  assertZero(row,'reconciliation');
  if(row.effect_attempt_count!==1||row.reconciliation_complete!==true||row.additional_effect_attempt_performed!==false
    ||row.same_effect_id_retry_allowed!==false||row.blind_retry_forbidden!==true
    ||row.governance_recompute_performed!==false||row.activation_view_rebuilt!==false
    ||row.retrieval_exposure_changed!==false||row.skill_activation_performed!==false
    ||row.lifecycle_mutation_performed!==false||row.external_reconciliation_owner!==true
    ||row.authored_by_candidate!==false){
    throw new Error('rsi_phase34_effect_reconciliation_policy_invalid');
  }
  const canonical=createRsiStorageOnlyAppendEffectReconciliation({
    ...args,
    reconciliation_id:row.reconciliation_id,
    reconciliation_evidence_digest:row.reconciliation_evidence_digest,
    reconciliation_owner_identity_digest:row.reconciliation_owner_identity_digest,
    external_reconciliation_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.reconciliation_digest!==exactDigest(row.reconciliation_digest,'reconciliation')){
    throw new Error('rsi_phase34_effect_reconciliation_digest_mismatch');
  }
  return canonical;
}

function archiveState(sourceSha,events){
  const core=zero({
    schema:RSI_STORAGE_ONLY_APPEND_EFFECT_ARCHIVE_SCHEMA,
    version:1,
    source_sha:sourceSha,
    events,
    event_count:events.length,
    plan_count:events.filter(e=>e.event_type==='PLAN').length,
    readback_count:events.filter(e=>e.event_type==='READBACK').length,
    reconciliation_count:events.filter(e=>e.event_type==='RECONCILIATION').length,
    append_only:true,
    durable_before_visible:true,
    plan_must_be_durable_before_effect:true,
    one_readback_per_plan:true,
    one_reconciliation_per_ambiguous_plan:true,
    one_effect_identity_per_plan:true,
    ambiguous_effects_retained:true,
    non_applied_evidence_retained:true,
    archive_can_write_skill_library:false,
    archive_can_recompute_governance:false,
    archive_can_change_retrieval_exposure:false,
    archive_can_activate_skill:false,
    archive_can_schedule_work:false,
  });
  return {...core,state_digest:digest(core)};
}

export class RsiStorageOnlyAppendEffectArchive{
  #path;#sourceSha;#resolver;#events=[];#initialized=false;
  constructor({statePath,source_sha,evidenceResolver}={}){
    if(!statePath)throw new Error('rsi_phase34_effect_archive_path_required');
    if(typeof evidenceResolver!=='function')throw new Error('rsi_phase34_effect_archive_resolver_required');
    this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'archive_source');this.#resolver=evidenceResolver;
  }
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const p=JSON.parse(await fs.readFile(this.#path,'utf8'));assertZero(p,'archive');
      if(p.schema!==RSI_STORAGE_ONLY_APPEND_EFFECT_ARCHIVE_SCHEMA||p.version!==1||p.source_sha!==this.#sourceSha
        ||p.append_only!==true||p.durable_before_visible!==true||p.plan_must_be_durable_before_effect!==true
        ||p.one_readback_per_plan!==true||p.one_reconciliation_per_ambiguous_plan!==true
        ||p.one_effect_identity_per_plan!==true||p.ambiguous_effects_retained!==true
        ||p.non_applied_evidence_retained!==true||p.archive_can_write_skill_library!==false
        ||p.archive_can_recompute_governance!==false||p.archive_can_change_retrieval_exposure!==false
        ||p.archive_can_activate_skill!==false||p.archive_can_schedule_work!==false){
        throw new Error('rsi_phase34_effect_archive_policy_invalid');
      }
      const clone=structuredClone(p);delete clone.state_digest;
      if(digest(clone)!==exactDigest(p.state_digest,'archive'))throw new Error('rsi_phase34_effect_archive_digest_mismatch');
      if(!Array.isArray(p.events)||p.events.length>MAX_EVENTS)throw new Error('rsi_phase34_effect_archive_events_invalid');
      const checked=[];const plans=new Map();const effectIds=new Set();const readbacks=new Map();const reconciliations=new Set();
      for(const event of p.events){
        if(event.event_type==='PLAN'){
          const evidence=await this.#resolver({event_type:'PLAN',plan_digest:event.plan.plan_digest});
          const plan=verifyRsiStorageOnlyAppendEffectPlan(event.plan,evidence?.plan_args||{});
          if(plans.has(plan.plan_digest)||effectIds.has(plan.append_effect_id_digest))throw new Error('rsi_phase34_effect_archive_duplicate_plan_or_effect');
          plans.set(plan.plan_digest,plan);effectIds.add(plan.append_effect_id_digest);checked.push(Object.freeze({event_type:'PLAN',plan}));
        }else if(event.event_type==='READBACK'){
          const plan=plans.get(event.plan_digest);
          if(!plan)throw new Error('rsi_phase34_effect_archive_readback_without_plan');
          if(readbacks.has(plan.plan_digest))throw new Error('rsi_phase34_effect_archive_duplicate_readback');
          const evidence=await this.#resolver({event_type:'READBACK',plan_digest:plan.plan_digest,receipt_digest:event.receipt.receipt_digest});
          const receipt=verifyRsiStorageOnlyAppendEffectReadback(event.receipt,{
            plan,plan_args:evidence?.plan_args||{},observed_library:evidence?.observed_library??null,
          });
          readbacks.set(plan.plan_digest,receipt);checked.push(Object.freeze({event_type:'READBACK',plan_digest:plan.plan_digest,receipt}));
        }else if(event.event_type==='RECONCILIATION'){
          const plan=plans.get(event.plan_digest);
          if(!plan)throw new Error('rsi_phase34_effect_archive_reconciliation_without_plan');
          const ambiguous=readbacks.get(plan.plan_digest);
          if(!ambiguous||ambiguous.state!=='APPEND_EFFECT_AMBIGUOUS_RECONCILIATION_REQUIRED'){
            throw new Error('rsi_phase34_effect_archive_ambiguous_readback_required');
          }
          if(reconciliations.has(plan.plan_digest))throw new Error('rsi_phase34_effect_archive_duplicate_reconciliation');
          const evidence=await this.#resolver({event_type:'RECONCILIATION',plan_digest:plan.plan_digest,reconciliation_digest:event.reconciliation.reconciliation_digest});
          const reconciliation=verifyRsiStorageOnlyAppendEffectReconciliation(event.reconciliation,{
            plan,plan_args:evidence?.plan_args||{},ambiguous_receipt:ambiguous,
            ambiguous_observed_library:evidence?.ambiguous_observed_library??null,
            observed_library:evidence?.observed_library??null,
          });
          reconciliations.add(plan.plan_digest);
          checked.push(Object.freeze({event_type:'RECONCILIATION',plan_digest:plan.plan_digest,reconciliation}));
        }else throw new Error('rsi_phase34_effect_archive_event_type_invalid');
      }
      const canonical=archiveState(this.#sourceSha,checked);
      if(canonical.state_digest!==p.state_digest)throw new Error('rsi_phase34_effect_archive_derived_state_mismatch');
      this.#events=checked;
    }catch(e){if(e?.code!=='ENOENT')throw e;}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(events){
    const state=archiveState(this.#sourceSha,events),tmp=this.#path+'.tmp',h=await fs.open(tmp,'w',0o600);
    try{await h.writeFile(JSON.stringify(state)+'\n','utf8');await h.sync();}finally{await h.close();}
    await fs.rename(tmp,this.#path);
  }
  async recordPlan({plan,plan_args}={}){
    if(!this.#initialized)throw new Error('rsi_phase34_effect_archive_not_initialized');
    const checked=verifyRsiStorageOnlyAppendEffectPlan(plan,plan_args||{});
    if(checked.source_sha!==this.#sourceSha)throw new Error('rsi_phase34_effect_archive_source_mismatch');
    const samePlan=this.#events.find(e=>e.event_type==='PLAN'&&e.plan.plan_digest===checked.plan_digest);
    if(samePlan)return zero({state:'IDEMPOTENT',plan_digest:checked.plan_digest});
    if(this.#events.some(e=>e.event_type==='PLAN'&&e.plan.append_effect_id_digest===checked.append_effect_id_digest)){
      throw new Error('rsi_phase34_effect_archive_effect_identity_conflict');
    }
    if(this.#events.length>=MAX_EVENTS)throw new Error('rsi_phase34_effect_archive_capacity_exceeded');
    const next=[...this.#events,Object.freeze({event_type:'PLAN',plan:checked})];
    await this.#persist(next);this.#events=next;
    return zero({state:'PLAN_DURABLE_EFFECT_NOT_ATTEMPTED',plan_digest:checked.plan_digest});
  }
  async recordReadback({plan,receipt,plan_args,observed_library=null}={}){
    if(!this.#initialized)throw new Error('rsi_phase34_effect_archive_not_initialized');
    const checkedPlan=verifyRsiStorageOnlyAppendEffectPlan(plan,plan_args||{});
    const stored=this.#events.find(e=>e.event_type==='PLAN'&&e.plan.plan_digest===checkedPlan.plan_digest);
    if(!stored)throw new Error('rsi_phase34_effect_archive_plan_must_precede_readback');
    const existing=this.#events.find(e=>e.event_type==='READBACK'&&e.plan_digest===checkedPlan.plan_digest);
    if(existing){
      if(existing.receipt.receipt_digest!==receipt?.receipt_digest)throw new Error('rsi_phase34_effect_archive_readback_identity_conflict');
      return zero({state:'IDEMPOTENT',receipt_digest:existing.receipt.receipt_digest});
    }
    const checkedReceipt=verifyRsiStorageOnlyAppendEffectReadback(receipt,{plan:checkedPlan,plan_args,observed_library});
    if(this.#events.length>=MAX_EVENTS)throw new Error('rsi_phase34_effect_archive_capacity_exceeded');
    const next=[...this.#events,Object.freeze({event_type:'READBACK',plan_digest:checkedPlan.plan_digest,receipt:checkedReceipt})];
    await this.#persist(next);this.#events=next;
    return zero({state:checkedReceipt.state,receipt_digest:checkedReceipt.receipt_digest});
  }
  async recordReconciliation({plan,ambiguous_receipt,reconciliation,plan_args,ambiguous_observed_library=null,observed_library}={}){
    if(!this.#initialized)throw new Error('rsi_phase34_effect_archive_not_initialized');
    const checkedPlan=verifyRsiStorageOnlyAppendEffectPlan(plan,plan_args||{});
    const storedPlan=this.#events.find(e=>e.event_type==='PLAN'&&e.plan.plan_digest===checkedPlan.plan_digest);
    if(!storedPlan)throw new Error('rsi_phase34_effect_archive_plan_must_precede_reconciliation');
    const storedReadback=this.#events.find(e=>e.event_type==='READBACK'&&e.plan_digest===checkedPlan.plan_digest);
    if(!storedReadback||storedReadback.receipt.state!=='APPEND_EFFECT_AMBIGUOUS_RECONCILIATION_REQUIRED'){
      throw new Error('rsi_phase34_effect_archive_ambiguous_readback_required');
    }
    if(storedReadback.receipt.receipt_digest!==ambiguous_receipt?.receipt_digest){
      throw new Error('rsi_phase34_effect_archive_ambiguous_receipt_mismatch');
    }
    const existing=this.#events.find(e=>e.event_type==='RECONCILIATION'&&e.plan_digest===checkedPlan.plan_digest);
    if(existing){
      if(existing.reconciliation.reconciliation_digest!==reconciliation?.reconciliation_digest){
        throw new Error('rsi_phase34_effect_archive_reconciliation_identity_conflict');
      }
      return zero({state:'IDEMPOTENT',reconciliation_digest:existing.reconciliation.reconciliation_digest});
    }
    const checked=verifyRsiStorageOnlyAppendEffectReconciliation(reconciliation,{
      plan:checkedPlan,plan_args,ambiguous_receipt:storedReadback.receipt,
      ambiguous_observed_library,observed_library,
    });
    if(this.#events.length>=MAX_EVENTS)throw new Error('rsi_phase34_effect_archive_capacity_exceeded');
    const next=[...this.#events,Object.freeze({event_type:'RECONCILIATION',plan_digest:checkedPlan.plan_digest,reconciliation:checked})];
    await this.#persist(next);this.#events=next;
    return zero({state:checked.state,reconciliation_digest:checked.reconciliation_digest});
  }
  snapshot(){
    const s=archiveState(this.#sourceSha,this.#events);
    return Object.freeze({
      schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,
      event_count:s.event_count,plan_count:s.plan_count,readback_count:s.readback_count,reconciliation_count:s.reconciliation_count,
      append_only:true,durable_before_visible:true,plan_must_be_durable_before_effect:true,
      one_readback_per_plan:true,one_reconciliation_per_ambiguous_plan:true,
      one_effect_identity_per_plan:true,ambiguous_effects_retained:true,
      non_applied_evidence_retained:true,archive_can_write_skill_library:false,
      archive_can_recompute_governance:false,archive_can_change_retrieval_exposure:false,
      archive_can_activate_skill:false,archive_can_schedule_work:false,authority_effect:false,
    });
  }
}

export function rsiStorageOnlyAppendEffectTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.storage-only-append-effect-root.v1',
    version:1,
    phase34_anytime_admission_certificate_required:true,
    existing_verified_skill_library_schema_reused:true,
    second_skill_library_allowed:false,
    exact_predecessor_library_binding_required:true,
    exact_successor_library_binding_required:true,
    exact_single_skill_append_required:true,
    durable_plan_before_effect_required:true,
    effect_attempt_limit:1,
    blind_retry_forbidden:true,
    ambiguous_effect_requires_reconciliation:true,
    resolved_readback_cannot_be_classified_ambiguous:true,
    append_only_reconciliation_event_required:true,
    reconciliation_performs_no_second_effect_attempt:true,
    planner_executor_readback_separation_required:true,
    append_is_storage_only:true,
    governance_recompute_forbidden:true,
    activation_view_rebuild_forbidden:true,
    retrieval_exposure_change_forbidden:true,
    skill_activation_forbidden:true,
    lifecycle_mutation_forbidden:true,
    future_governance_revalidation_required:true,
    execution_authority:false,browser_authority:false,task_authority:false,
    production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,storage_only_append_effect_root_digest:digest(root)});
}
