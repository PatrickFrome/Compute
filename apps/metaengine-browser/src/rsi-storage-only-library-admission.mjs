import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  verifyRsiExactSkillPrecommitCertificate,
} from './rsi-exact-existing-consumer-owner-review.mjs';
import {
  createRsiVerifiedSkillLibrary,
  verifyRsiVerifiedSkillLibrary,
  verifyRsiSkillCapsule,
  verifyRsiSkillEvidence,
} from './rsi-verified-skill-library.mjs';

export const RSI_STORAGE_ONLY_LIBRARY_APPEND_PLAN_SCHEMA='metaengine.rsi.storage-only-library-append-plan.v1';
export const RSI_STORAGE_ONLY_LIBRARY_APPEND_READBACK_SCHEMA='metaengine.rsi.storage-only-library-append-readback.v1';
export const RSI_STORAGE_ONLY_LIBRARY_APPEND_ARCHIVE_SCHEMA='metaengine.rsi.storage-only-library-append-archive.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const EFFECT_OUTCOMES=new Set(['CONFIRMED_APPLIED','CONFIRMED_NOT_APPLIED','AMBIGUOUS']);
const MAX_EVENTS=4096;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function digest(v){return 'sha256:'+crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex');}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error('rsi_phase34_'+l+'_digest_invalid');return x;}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error('rsi_phase34_'+l+'_sha_invalid');return x;}
function id(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error('rsi_phase34_'+l+'_invalid');return x;}
function positiveInt(v,l){if(!Number.isInteger(v)||v<1)throw new Error('rsi_phase34_'+l+'_invalid');return v;}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false});}
function assertZero(v,l){for(const f of ['execution_authority','browser_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error('rsi_phase34_'+l+'_'+f+'_invalid');if(v?.automatic_retry_allowed!==false)throw new Error('rsi_phase34_'+l+'_retry_invalid');}

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

function exactSuccessorLibrary(currentLibrary,skill,evidence){
  const current=verifyRsiVerifiedSkillLibrary(currentLibrary);
  const checkedSkill=verifyRsiSkillCapsule(skill);
  const checkedEvidence=verifyRsiSkillEvidence(evidence,checkedSkill);
  if(checkedEvidence.verified_for_library!==true||checkedEvidence.hard_invariants_pass!==true)throw new Error('rsi_phase34_skill_evidence_not_library_verified');
  if(current.entries.some(row=>row.skill_digest===checkedSkill.skill_digest))throw new Error('rsi_phase34_skill_digest_already_present');
  if(current.entries.some(row=>row.skill_id===checkedSkill.skill_id&&row.skill_version===checkedSkill.skill_version))throw new Error('rsi_phase34_skill_version_already_present');
  const successor=createRsiVerifiedSkillLibrary({
    library_id:current.library_id,
    entries:[
      ...current.entries.map(row=>({capsule:row.capsule,evidence:row.evidence})),
      {capsule:checkedSkill,evidence:checkedEvidence},
    ],
    external_library_owner:true,
    authored_by_candidate:false,
  });
  return Object.freeze({current,skill:checkedSkill,evidence:checkedEvidence,successor});
}

function verifyPredecessorPreserved(currentLibrary,observedLibrary){
  const current=verifyRsiVerifiedSkillLibrary(currentLibrary);
  const observed=verifyRsiVerifiedSkillLibrary(observedLibrary);
  for(const before of current.entries){
    const after=observed.entries.find(row=>row.skill_digest===before.skill_digest);
    if(!after)throw new Error('rsi_phase34_predecessor_entry_missing');
    if(after.skill_id!==before.skill_id||after.skill_version!==before.skill_version||after.evidence_digest!==before.evidence_digest){
      throw new Error('rsi_phase34_predecessor_entry_changed');
    }
  }
  return observed;
}

export function createRsiStorageOnlyLibraryAppendPlan({
  plan_id,
  phase33_certificate,
  phase33_certificate_args,
  phase33_policy_head_sha,
  phase33_terminal_ci_evidence_digest,
  predecessor_ci_terminal_green=false,
  current_library,
  skill_capsule,
  skill_evidence,
  append_effect_id_digest,
  idempotency_key_digest,
  effect_journal_policy_digest,
  external_library_owner_identity_digest,
  external_ci_attestor_identity_digest,
  external_library_owner=false,
  external_ci_attestor=false,
  authored_by_candidate=true,
}={}){
  if(external_library_owner!==true||external_ci_attestor!==true||authored_by_candidate!==false){
    throw new Error('rsi_phase34_external_owners_required');
  }
  if(predecessor_ci_terminal_green!==true)throw new Error('rsi_phase34_predecessor_ci_not_terminal_green');
  const certificate=verifyRsiExactSkillPrecommitCertificate(phase33_certificate,phase33_certificate_args||{});
  if(certificate.state!=='ELIGIBLE_FOR_EXISTING_LIBRARY_OWNER_ADMISSION_REVIEW'){
    throw new Error('rsi_phase34_phase33_certificate_not_eligible');
  }
  const exact=exactSuccessorLibrary(current_library,skill_capsule,skill_evidence);
  if(exact.current.library_digest!==certificate.current_library_digest)throw new Error('rsi_phase34_current_library_drift');
  if(exact.skill.skill_digest!==certificate.proposed_skill_digest)throw new Error('rsi_phase34_skill_digest_mismatch');
  if(exact.evidence.evidence_digest!==certificate.standard_skill_evidence_digest)throw new Error('rsi_phase34_skill_evidence_digest_mismatch');

  const phase33Head=exactSha(phase33_policy_head_sha,'phase33_policy_head');
  const ciEvidence=exactDigest(phase33_terminal_ci_evidence_digest,'phase33_terminal_ci_evidence');
  const effectId=exactDigest(append_effect_id_digest,'append_effect_id');
  const idempotency=exactDigest(idempotency_key_digest,'idempotency_key');
  const journalPolicy=exactDigest(effect_journal_policy_digest,'effect_journal_policy');
  const libraryOwner=exactDigest(external_library_owner_identity_digest,'library_owner_identity');
  const ciAttestor=exactDigest(external_ci_attestor_identity_digest,'ci_attestor_identity');
  const currentManifest=libraryManifest(exact.current);
  const successorManifest=libraryManifest(exact.successor);
  const independent=[
    certificate.certificate_digest,
    ciEvidence,effectId,idempotency,journalPolicy,libraryOwner,ciAttestor,
    currentManifest.manifest_digest,successorManifest.manifest_digest,
  ];
  if(new Set(independent).size!==independent.length)throw new Error('rsi_phase34_independent_roots_required');
  if(libraryOwner===ciAttestor)throw new Error('rsi_phase34_owner_ci_attestor_separation_required');

  const core=zero({
    schema:RSI_STORAGE_ONLY_LIBRARY_APPEND_PLAN_SCHEMA,
    version:1,
    plan_id:id(plan_id,'plan_id'),
    source_sha:certificate.source_sha,
    phase33_certificate_digest:certificate.certificate_digest,
    phase33_bundle_digest:certificate.bundle_digest,
    phase33_policy_head_sha:phase33Head,
    phase33_terminal_ci_evidence_digest:ciEvidence,
    predecessor_ci_terminal_green:true,
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
    external_library_owner_identity_digest:libraryOwner,
    external_ci_attestor_identity_digest:ciAttestor,
    external_library_owner:true,
    external_ci_attestor:true,
    authored_by_candidate:false,
    existing_verified_skill_library_schema_reused:true,
    second_skill_library_created:false,
    append_is_storage_only:true,
    append_preserves_all_predecessor_entries:true,
    append_adds_exactly_one_skill_version:true,
    effect_attempt_limit:1,
    blind_retry_forbidden:true,
    ambiguous_effect_requires_reconciliation:true,
    candidate_can_choose_effect_identity:false,
    candidate_can_choose_library_owner:false,
    candidate_can_choose_governance_state:false,
    governance_recompute_performed:false,
    activation_view_rebuilt:false,
    retrieval_exposure_changed:false,
    skill_activation_performed:false,
    library_append_performed:false,
    effect_attempted:false,
    state:'READY_FOR_EXTERNAL_STORAGE_ONLY_LIBRARY_APPEND',
  });
  return Object.freeze({...core,plan_digest:digest(core)});
}

export function verifyRsiStorageOnlyLibraryAppendPlan(plan,args={}){
  if(!plan||plan.schema!==RSI_STORAGE_ONLY_LIBRARY_APPEND_PLAN_SCHEMA||plan.version!==1)throw new Error('rsi_phase34_plan_invalid');
  assertZero(plan,'plan');
  if(plan.predecessor_ci_terminal_green!==true||plan.external_library_owner!==true||plan.external_ci_attestor!==true
    ||plan.authored_by_candidate!==false||plan.existing_verified_skill_library_schema_reused!==true
    ||plan.second_skill_library_created!==false||plan.append_is_storage_only!==true
    ||plan.append_preserves_all_predecessor_entries!==true||plan.append_adds_exactly_one_skill_version!==true
    ||plan.effect_attempt_limit!==1||plan.blind_retry_forbidden!==true||plan.ambiguous_effect_requires_reconciliation!==true
    ||plan.candidate_can_choose_effect_identity!==false||plan.candidate_can_choose_library_owner!==false
    ||plan.candidate_can_choose_governance_state!==false||plan.governance_recompute_performed!==false
    ||plan.activation_view_rebuilt!==false||plan.retrieval_exposure_changed!==false||plan.skill_activation_performed!==false
    ||plan.library_append_performed!==false||plan.effect_attempted!==false
    ||plan.state!=='READY_FOR_EXTERNAL_STORAGE_ONLY_LIBRARY_APPEND'){
    throw new Error('rsi_phase34_plan_policy_invalid');
  }
  const canonical=createRsiStorageOnlyLibraryAppendPlan({
    ...args,
    plan_id:plan.plan_id,
    phase33_policy_head_sha:plan.phase33_policy_head_sha,
    phase33_terminal_ci_evidence_digest:plan.phase33_terminal_ci_evidence_digest,
    predecessor_ci_terminal_green:true,
    append_effect_id_digest:plan.append_effect_id_digest,
    idempotency_key_digest:plan.idempotency_key_digest,
    effect_journal_policy_digest:plan.effect_journal_policy_digest,
    external_library_owner_identity_digest:plan.external_library_owner_identity_digest,
    external_ci_attestor_identity_digest:plan.external_ci_attestor_identity_digest,
    external_library_owner:true,
    external_ci_attestor:true,
    authored_by_candidate:false,
  });
  if(canonical.plan_digest!==exactDigest(plan.plan_digest,'plan'))throw new Error('rsi_phase34_plan_digest_mismatch');
  return canonical;
}

export function createRsiStorageOnlyLibraryAppendReadback({
  receipt_id,
  plan,
  plan_evidence,
  effect_outcome,
  observed_library=null,
  effect_attempt_count,
  effect_journal_entry_digest,
  external_effect_executor_identity_digest,
  external_readback_identity_digest,
  external_effect_executor=false,
  external_readback_owner=false,
  authored_by_candidate=true,
}={}){
  const checkedPlan=verifyRsiStorageOnlyLibraryAppendPlan(plan,plan_evidence||{});
  if(external_effect_executor!==true||external_readback_owner!==true||authored_by_candidate!==false){
    throw new Error('rsi_phase34_external_effect_and_readback_owners_required');
  }
  const outcome=String(effect_outcome||'').trim().toUpperCase();
  if(!EFFECT_OUTCOMES.has(outcome))throw new Error('rsi_phase34_effect_outcome_invalid');
  const attempts=positiveInt(effect_attempt_count,'effect_attempt_count');
  if(attempts!==1)throw new Error('rsi_phase34_effect_attempt_limit_exceeded');
  const journalEntry=exactDigest(effect_journal_entry_digest,'effect_journal_entry');
  const executor=exactDigest(external_effect_executor_identity_digest,'effect_executor_identity');
  const readbackOwner=exactDigest(external_readback_identity_digest,'readback_identity');
  if(new Set([executor,readbackOwner,checkedPlan.external_library_owner_identity_digest,checkedPlan.external_ci_attestor_identity_digest]).size!==4){
    throw new Error('rsi_phase34_effect_readback_separation_of_duties_required');
  }

  let observedDigest=null;
  let observedManifestDigest=null;
  let observedEntryCount=null;
  let appendConfirmed=false;
  let reconciliationRequired=false;
  let state;
  if(outcome==='CONFIRMED_APPLIED'){
    if(!observed_library)throw new Error('rsi_phase34_applied_readback_library_required');
    const observed=verifyPredecessorPreserved(plan_evidence.current_library,observed_library);
    const manifest=libraryManifest(observed);
    if(observed.library_digest!==checkedPlan.expected_successor_library_digest
      ||manifest.manifest_digest!==checkedPlan.expected_successor_library_manifest_digest
      ||observed.entry_count!==checkedPlan.expected_successor_entry_count){
      throw new Error('rsi_phase34_successor_readback_mismatch');
    }
    const skill=verifyRsiSkillCapsule(plan_evidence.skill_capsule);
    const evidence=verifyRsiSkillEvidence(plan_evidence.skill_evidence,skill);
    const added=observed.entries.filter(row=>!verifyRsiVerifiedSkillLibrary(plan_evidence.current_library).entries.some(before=>before.skill_digest===row.skill_digest));
    if(added.length!==1||added[0].skill_digest!==skill.skill_digest||added[0].evidence_digest!==evidence.evidence_digest){
      throw new Error('rsi_phase34_exact_single_append_not_observed');
    }
    observedDigest=observed.library_digest;observedManifestDigest=manifest.manifest_digest;observedEntryCount=observed.entry_count;
    appendConfirmed=true;state='APPEND_CONFIRMED_STORAGE_ONLY_PENDING_GOVERNANCE';
  }else if(outcome==='CONFIRMED_NOT_APPLIED'){
    if(!observed_library)throw new Error('rsi_phase34_not_applied_readback_library_required');
    const observed=verifyRsiVerifiedSkillLibrary(observed_library);
    const manifest=libraryManifest(observed);
    if(observed.library_digest!==checkedPlan.current_library_digest||manifest.manifest_digest!==checkedPlan.current_library_manifest_digest){
      throw new Error('rsi_phase34_not_applied_readback_mismatch');
    }
    observedDigest=observed.library_digest;observedManifestDigest=manifest.manifest_digest;observedEntryCount=observed.entry_count;
    state='APPEND_CONFIRMED_NOT_APPLIED_NEW_PLAN_REQUIRED_FOR_FUTURE_ATTEMPT';
  }else{
    if(observed_library){
      const observed=verifyRsiVerifiedSkillLibrary(observed_library);
      const manifest=libraryManifest(observed);
      observedDigest=observed.library_digest;observedManifestDigest=manifest.manifest_digest;observedEntryCount=observed.entry_count;
    }
    reconciliationRequired=true;state='APPEND_EFFECT_AMBIGUOUS_RECONCILIATION_REQUIRED';
  }

  const core=zero({
    schema:RSI_STORAGE_ONLY_LIBRARY_APPEND_READBACK_SCHEMA,
    version:1,
    receipt_id:id(receipt_id,'receipt_id'),
    source_sha:checkedPlan.source_sha,
    plan_digest:checkedPlan.plan_digest,
    append_effect_id_digest:checkedPlan.append_effect_id_digest,
    idempotency_key_digest:checkedPlan.idempotency_key_digest,
    effect_outcome:outcome,
    effect_attempt_count:attempts,
    effect_journal_entry_digest:journalEntry,
    external_effect_executor_identity_digest:executor,
    external_readback_identity_digest:readbackOwner,
    observed_library_digest:observedDigest,
    observed_library_manifest_digest:observedManifestDigest,
    observed_library_entry_count:observedEntryCount,
    append_confirmed:appendConfirmed,
    reconciliation_required:reconciliationRequired,
    storage_only_pending_governance:appendConfirmed,
    predecessor_entries_preserved:appendConfirmed,
    governance_recompute_performed:false,
    activation_view_rebuilt:false,
    retrieval_exposure_changed:false,
    skill_activation_performed:false,
    same_effect_id_retry_allowed:false,
    new_effect_requires_new_plan:outcome==='CONFIRMED_NOT_APPLIED',
    blind_retry_forbidden:true,
    external_effect_executor:true,
    external_readback_owner:true,
    authored_by_candidate:false,
    state,
  });
  return Object.freeze({...core,receipt_digest:digest(core)});
}

export function verifyRsiStorageOnlyLibraryAppendReadback(receipt,{plan,plan_evidence,observed_library=null}={}){
  if(!receipt||receipt.schema!==RSI_STORAGE_ONLY_LIBRARY_APPEND_READBACK_SCHEMA||receipt.version!==1)throw new Error('rsi_phase34_readback_invalid');
  assertZero(receipt,'readback');
  if(receipt.effect_attempt_count!==1||receipt.governance_recompute_performed!==false||receipt.activation_view_rebuilt!==false
    ||receipt.retrieval_exposure_changed!==false||receipt.skill_activation_performed!==false
    ||receipt.same_effect_id_retry_allowed!==false||receipt.blind_retry_forbidden!==true
    ||receipt.external_effect_executor!==true||receipt.external_readback_owner!==true||receipt.authored_by_candidate!==false){
    throw new Error('rsi_phase34_readback_policy_invalid');
  }
  const canonical=createRsiStorageOnlyLibraryAppendReadback({
    receipt_id:receipt.receipt_id,plan,plan_evidence,effect_outcome:receipt.effect_outcome,observed_library,
    effect_attempt_count:receipt.effect_attempt_count,effect_journal_entry_digest:receipt.effect_journal_entry_digest,
    external_effect_executor_identity_digest:receipt.external_effect_executor_identity_digest,
    external_readback_identity_digest:receipt.external_readback_identity_digest,
    external_effect_executor:true,external_readback_owner:true,authored_by_candidate:false,
  });
  if(canonical.receipt_digest!==exactDigest(receipt.receipt_digest,'readback'))throw new Error('rsi_phase34_readback_digest_mismatch');
  return canonical;
}

function archiveState(sourceSha,events){
  const plans=events.filter(e=>e.event_type==='PLAN');
  const readbacks=events.filter(e=>e.event_type==='READBACK');
  const core=zero({
    schema:RSI_STORAGE_ONLY_LIBRARY_APPEND_ARCHIVE_SCHEMA,
    version:1,
    source_sha:sourceSha,
    events,
    event_count:events.length,
    plan_count:plans.length,
    readback_count:readbacks.length,
    append_only:true,
    durable_before_visible:true,
    plan_must_precede_readback:true,
    one_readback_per_plan:true,
    ambiguous_effects_retained:true,
    rejected_or_not_applied_evidence_retained:true,
    archive_can_write_skill_library:false,
    archive_can_recompute_governance:false,
    archive_can_change_retrieval_exposure:false,
    archive_can_activate_skill:false,
    archive_can_schedule_work:false,
  });
  return {...core,state_digest:digest(core)};
}

export class RsiStorageOnlyLibraryAppendArchive{
  #path;#sourceSha;#resolver;#events=[];#initialized=false;
  constructor({statePath,source_sha,evidenceResolver}={}){
    if(!statePath)throw new Error('rsi_phase34_archive_path_required');
    if(typeof evidenceResolver!=='function')throw new Error('rsi_phase34_archive_resolver_required');
    this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'archive_source');this.#resolver=evidenceResolver;
  }
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const p=JSON.parse(await fs.readFile(this.#path,'utf8'));assertZero(p,'archive');
      if(p.schema!==RSI_STORAGE_ONLY_LIBRARY_APPEND_ARCHIVE_SCHEMA||p.version!==1||p.source_sha!==this.#sourceSha
        ||p.append_only!==true||p.durable_before_visible!==true||p.plan_must_precede_readback!==true
        ||p.one_readback_per_plan!==true||p.ambiguous_effects_retained!==true||p.rejected_or_not_applied_evidence_retained!==true
        ||p.archive_can_write_skill_library!==false||p.archive_can_recompute_governance!==false
        ||p.archive_can_change_retrieval_exposure!==false||p.archive_can_activate_skill!==false||p.archive_can_schedule_work!==false){
        throw new Error('rsi_phase34_archive_policy_invalid');
      }
      const clone=structuredClone(p);delete clone.state_digest;
      if(digest(clone)!==exactDigest(p.state_digest,'archive'))throw new Error('rsi_phase34_archive_digest_mismatch');
      if(!Array.isArray(p.events)||p.events.length>MAX_EVENTS)throw new Error('rsi_phase34_archive_events_invalid');
      const checked=[];const planByDigest=new Map();const readbackByPlan=new Set();
      for(const event of p.events){
        if(event.event_type==='PLAN'){
          const evidence=await this.#resolver({event_type:'PLAN',plan_digest:event.plan.plan_digest});
          const plan=verifyRsiStorageOnlyLibraryAppendPlan(event.plan,evidence?.plan_evidence||{});
          if(planByDigest.has(plan.plan_digest))throw new Error('rsi_phase34_archive_duplicate_plan');
          planByDigest.set(plan.plan_digest,plan);checked.push(Object.freeze({event_type:'PLAN',plan}));
        }else if(event.event_type==='READBACK'){
          const plan=planByDigest.get(event.plan_digest);
          if(!plan)throw new Error('rsi_phase34_archive_readback_without_plan');
          if(readbackByPlan.has(plan.plan_digest))throw new Error('rsi_phase34_archive_duplicate_readback');
          const evidence=await this.#resolver({event_type:'READBACK',plan_digest:plan.plan_digest,receipt_digest:event.receipt.receipt_digest});
          const receipt=verifyRsiStorageOnlyLibraryAppendReadback(event.receipt,{
            plan,plan_evidence:evidence?.plan_evidence||{},observed_library:evidence?.observed_library??null,
          });
          readbackByPlan.add(plan.plan_digest);checked.push(Object.freeze({event_type:'READBACK',plan_digest:plan.plan_digest,receipt}));
        }else throw new Error('rsi_phase34_archive_event_type_invalid');
      }
      const canonical=archiveState(this.#sourceSha,checked);
      if(canonical.state_digest!==p.state_digest)throw new Error('rsi_phase34_archive_derived_state_mismatch');
      this.#events=checked;
    }catch(e){if(e?.code!=='ENOENT')throw e;}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(events){
    const state=archiveState(this.#sourceSha,events),tmp=this.#path+'.tmp',h=await fs.open(tmp,'w',0o600);
    try{await h.writeFile(JSON.stringify(state)+'\n','utf8');await h.sync();}finally{await h.close();}
    await fs.rename(tmp,this.#path);
  }
  async recordPlan({plan,plan_evidence}={}){
    if(!this.#initialized)throw new Error('rsi_phase34_archive_not_initialized');
    const checked=verifyRsiStorageOnlyLibraryAppendPlan(plan,plan_evidence||{});
    if(checked.source_sha!==this.#sourceSha)throw new Error('rsi_phase34_archive_source_mismatch');
    const existing=this.#events.find(e=>e.event_type==='PLAN'&&e.plan.plan_digest===checked.plan_digest);
    if(existing)return zero({state:'IDEMPOTENT',plan_digest:checked.plan_digest});
    if(this.#events.some(e=>e.event_type==='PLAN'&&e.plan.append_effect_id_digest===checked.append_effect_id_digest)){
      throw new Error('rsi_phase34_archive_effect_identity_conflict');
    }
    if(this.#events.length>=MAX_EVENTS)throw new Error('rsi_phase34_archive_capacity_exceeded');
    const next=[...this.#events,Object.freeze({event_type:'PLAN',plan:checked})];
    await this.#persist(next);this.#events=next;
    return zero({state:'PLAN_RECORDED_EFFECT_NOT_ATTEMPTED',plan_digest:checked.plan_digest});
  }
  async recordReadback({plan,receipt,plan_evidence,observed_library=null}={}){
    if(!this.#initialized)throw new Error('rsi_phase34_archive_not_initialized');
    const checkedPlan=verifyRsiStorageOnlyLibraryAppendPlan(plan,plan_evidence||{});
    const stored=this.#events.find(e=>e.event_type==='PLAN'&&e.plan.plan_digest===checkedPlan.plan_digest);
    if(!stored)throw new Error('rsi_phase34_archive_plan_must_be_recorded_first');
    const existing=this.#events.find(e=>e.event_type==='READBACK'&&e.plan_digest===checkedPlan.plan_digest);
    if(existing){
      if(existing.receipt.receipt_digest!==receipt?.receipt_digest)throw new Error('rsi_phase34_archive_readback_identity_conflict');
      return zero({state:'IDEMPOTENT',receipt_digest:existing.receipt.receipt_digest});
    }
    const checkedReceipt=verifyRsiStorageOnlyLibraryAppendReadback(receipt,{plan:checkedPlan,plan_evidence,observed_library});
    if(this.#events.length>=MAX_EVENTS)throw new Error('rsi_phase34_archive_capacity_exceeded');
    const next=[...this.#events,Object.freeze({event_type:'READBACK',plan_digest:checkedPlan.plan_digest,receipt:checkedReceipt})];
    await this.#persist(next);this.#events=next;
    return zero({state:checkedReceipt.state,receipt_digest:checkedReceipt.receipt_digest});
  }
  snapshot(){
    const s=archiveState(this.#sourceSha,this.#events);
    return Object.freeze({
      schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,
      event_count:s.event_count,plan_count:s.plan_count,readback_count:s.readback_count,
      append_only:true,durable_before_visible:true,plan_must_precede_readback:true,one_readback_per_plan:true,
      ambiguous_effects_retained:true,rejected_or_not_applied_evidence_retained:true,
      archive_can_write_skill_library:false,archive_can_recompute_governance:false,
      archive_can_change_retrieval_exposure:false,archive_can_activate_skill:false,archive_can_schedule_work:false,
      authority_effect:false,
    });
  }
}

export function rsiStorageOnlyLibraryAdmissionTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.storage-only-library-admission-root.v1',
    version:1,
    exact_phase33_precommit_certificate_required:true,
    predecessor_exact_head_terminal_ci_required:true,
    existing_verified_skill_library_schema_reused:true,
    second_skill_library_allowed:false,
    exact_current_library_binding_required:true,
    exact_single_skill_append_required:true,
    predecessor_entries_must_be_bitwise_equivalent_by_digest:true,
    effect_plan_must_be_durable_before_attempt:true,
    effect_attempt_limit:1,
    blind_retry_forbidden:true,
    ambiguous_effect_requires_reconciliation:true,
    effect_executor_and_readback_owner_separation_required:true,
    append_is_storage_only:true,
    governance_recompute_forbidden_in_phase34:true,
    retrieval_exposure_change_forbidden_in_phase34:true,
    skill_activation_forbidden_in_phase34:true,
    future_governance_revalidation_required:true,
    execution_authority:false,browser_authority:false,task_authority:false,
    production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,storage_only_library_admission_root_digest:digest(root)});
}
