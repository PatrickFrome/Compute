import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  verifyRsiExactSkillPrecommitCertificate,
  rsiExactExistingConsumerOwnerReviewTrustRootSnapshot,
} from './rsi-exact-existing-consumer-owner-review.mjs';
import {
  createRsiVerifiedSkillLibrary,
  verifyRsiVerifiedSkillLibrary,
  verifyRsiSkillCapsule,
  verifyRsiSkillEvidence,
} from './rsi-verified-skill-library.mjs';
import {
  verifyRsiSkillLibraryGovernance,
  rsiSkillLibraryGovernanceTrustRootSnapshot,
} from './rsi-skill-library-governance.mjs';

export const RSI_EXTERNAL_LIBRARY_ADMISSION_PROPOSAL_SCHEMA='metaengine.rsi.external-library-admission-proposal.v1';
export const RSI_EXTERNAL_LIBRARY_APPEND_READBACK_SCHEMA='metaengine.rsi.external-library-append-readback.v1';
export const RSI_EXTERNAL_LIBRARY_ADMISSION_ARCHIVE_SCHEMA='metaengine.rsi.external-library-admission-archive.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_ROWS=2048;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function digest(v){return 'sha256:'+crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex');}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error('rsi_phase34_'+l+'_sha_invalid');return x;}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error('rsi_phase34_'+l+'_digest_invalid');return x;}
function id(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error('rsi_phase34_'+l+'_invalid');return x;}
function plain(v){return !!v&&typeof v==='object'&&!Array.isArray(v);}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false});}
function assertZero(v,l){for(const f of ['execution_authority','browser_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error('rsi_phase34_'+l+'_'+f+'_invalid');if(v?.automatic_retry_allowed!==false)throw new Error('rsi_phase34_'+l+'_retry_invalid');}
function sameArray(a,b){return JSON.stringify(a)===JSON.stringify(b);}

function verifyPhase33({certificate,certificate_args}={}){
  if(!plain(certificate_args))throw new Error('rsi_phase34_phase33_certificate_args_required');
  const checked=verifyRsiExactSkillPrecommitCertificate(certificate,certificate_args);
  if(checked.state!=='ELIGIBLE_FOR_EXISTING_LIBRARY_OWNER_ADMISSION_REVIEW'
    ||checked.blockers.length!==0
    ||checked.library_append_performed!==false
    ||checked.retrieval_exposure_changed!==false
    ||checked.skill_activation_performed!==false
    ||checked.skill_lifecycle_mutated!==false
    ||checked.library_admission_token!==null){
    throw new Error('rsi_phase34_phase33_certificate_not_eligible');
  }
  return checked;
}

function verifyCandidateArtifacts({current_library,skill_capsule,skill_evidence,certificate}){
  const library=verifyRsiVerifiedSkillLibrary(current_library);
  if(library.library_digest!==certificate.current_library_digest)throw new Error('rsi_phase34_current_library_drift');
  const skill=verifyRsiSkillCapsule(skill_capsule);
  const evidence=verifyRsiSkillEvidence(skill_evidence,skill);
  if(skill.skill_digest!==certificate.proposed_skill_digest)throw new Error('rsi_phase34_skill_digest_mismatch');
  if(evidence.evidence_digest!==certificate.standard_skill_evidence_digest)throw new Error('rsi_phase34_skill_evidence_digest_mismatch');
  if(evidence.verified_for_library!==true||evidence.hard_invariants_pass!==true)throw new Error('rsi_phase34_skill_evidence_not_library_verified');
  if(skill.source_candidate_sha!==certificate.source_sha||evidence.source_candidate_sha!==certificate.source_sha)throw new Error('rsi_phase34_skill_source_mismatch');
  if(library.entries.some(e=>e.skill_digest===skill.skill_digest||e.skill_id===skill.skill_id&&e.skill_version===skill.skill_version)){
    throw new Error('rsi_phase34_skill_already_present');
  }
  return Object.freeze({library,skill,evidence});
}

function expectedNextLibrary(library,skill,evidence){
  const entries=[
    ...library.entries.map(row=>({capsule:row.capsule,evidence:row.evidence})),
    {capsule:skill,evidence},
  ];
  return createRsiVerifiedSkillLibrary({
    library_id:library.library_id,
    entries,
    external_library_owner:true,
    authored_by_candidate:false,
  });
}

function assertPreviousEntriesPreserved(previous,next){
  const oldMap=new Map(previous.entries.map(e=>[e.skill_digest,e]));
  for(const [skillDigest,row] of oldMap){
    const observed=next.entries.find(e=>e.skill_digest===skillDigest);
    if(!observed)throw new Error('rsi_phase34_previous_skill_missing');
    if(observed.evidence_digest!==row.evidence_digest
      ||observed.skill_id!==row.skill_id
      ||observed.skill_version!==row.skill_version
      ||observed.role!==row.role
      ||observed.input_schema_digest!==row.input_schema_digest
      ||observed.output_schema_digest!==row.output_schema_digest
      ||!sameArray(observed.capabilities,row.capabilities)){
      throw new Error('rsi_phase34_previous_skill_rewritten');
    }
  }
}

export function createRsiExternalLibraryAdmissionProposal({
  proposal_id,
  phase33_certificate,
  phase33_certificate_args,
  current_library,
  current_governance,
  skill_capsule,
  skill_evidence,
  append_owner_identity_digest,
  append_policy_digest,
  append_journal_contract_digest,
  append_transaction_fence_digest,
  retrieval_exposure_policy_digest,
  post_append_governance_policy_digest,
  external_library_owner=false,
  external_governance_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_library_owner!==true||external_governance_owner!==true||authored_by_candidate!==false){
    throw new Error('rsi_phase34_external_owners_required');
  }
  const certificate=verifyPhase33({certificate:phase33_certificate,certificate_args:phase33_certificate_args});
  const {library,skill,evidence}=verifyCandidateArtifacts({current_library,skill_capsule,skill_evidence,certificate});
  const governance=verifyRsiSkillLibraryGovernance(current_governance,library);
  const phase33Root=rsiExactExistingConsumerOwnerReviewTrustRootSnapshot();
  const governanceRoot=rsiSkillLibraryGovernanceTrustRootSnapshot();
  const next=expectedNextLibrary(library,skill,evidence);
  assertPreviousEntriesPreserved(library,next);
  const roots=[
    exactDigest(append_owner_identity_digest,'append_owner_identity'),
    exactDigest(append_policy_digest,'append_policy'),
    exactDigest(append_journal_contract_digest,'append_journal_contract'),
    exactDigest(append_transaction_fence_digest,'append_transaction_fence'),
    exactDigest(retrieval_exposure_policy_digest,'retrieval_exposure_policy'),
    exactDigest(post_append_governance_policy_digest,'post_append_governance_policy'),
    certificate.certificate_digest,library.library_digest,governance.governance_digest,
    phase33Root.exact_owner_review_root_digest,governanceRoot.governance_root_digest,
  ];
  if(new Set(roots).size!==roots.length)throw new Error('rsi_phase34_independent_roots_required');
  const core=zero({
    schema:RSI_EXTERNAL_LIBRARY_ADMISSION_PROPOSAL_SCHEMA,version:1,
    proposal_id:id(proposal_id,'proposal_id'),source_sha:exactSha(certificate.source_sha,'source'),
    phase33_certificate_digest:certificate.certificate_digest,phase33_bundle_digest:certificate.bundle_digest,
    phase32_receipt_digest:certificate.phase32_receipt_digest,
    consumer_evaluation_contract_digest:certificate.consumer_evaluation_contract_digest,
    consumer_evaluator_generation_digest:certificate.consumer_evaluator_generation_digest,
    consumer_evaluator_generation_seq:certificate.consumer_evaluator_generation_seq,
    consumer_evaluator_generation_history_anchor_digest:certificate.consumer_evaluator_generation_history_anchor_digest,
    consumer_evaluation_epoch_seq:certificate.consumer_evaluation_epoch_seq,
    consumer_evaluation_epoch_digest:certificate.consumer_evaluation_epoch_digest,
    current_library_id:library.library_id,current_library_digest:library.library_digest,
    current_library_entry_count:library.entries.length,current_governance_digest:governance.governance_digest,
    phase33_owner_review_root_digest:phase33Root.exact_owner_review_root_digest,
    existing_governance_root_digest:governanceRoot.governance_root_digest,
    proposed_skill_id:skill.skill_id,proposed_skill_version:skill.skill_version,
    proposed_skill_digest:skill.skill_digest,proposed_skill_evidence_digest:evidence.evidence_digest,
    proposed_skill_parent_digest:skill.parent_skill_digest,
    expected_next_library_digest:next.library_digest,expected_next_library_entry_count:next.entries.length,
    append_owner_identity_digest:roots[0],append_policy_digest:roots[1],append_journal_contract_digest:roots[2],
    append_transaction_fence_digest:roots[3],retrieval_exposure_policy_digest:roots[4],
    post_append_governance_policy_digest:roots[5],
    append_only_preservation_required:true,exact_library_readback_required:true,
    existing_skill_rewrite_forbidden:true,existing_skill_delete_forbidden:true,
    in_place_candidate_replacement_forbidden:true,append_transaction_single_effect_required:true,
    append_retry_after_ambiguous_effect_forbidden:true,append_does_not_imply_retrieval_exposure:true,
    post_append_governance_recompute_required:true,candidate_starts_not_active:true,
    external_library_owner:true,external_governance_owner:true,authored_by_candidate:false,
    candidate_can_choose_append_owner:false,candidate_can_choose_append_policy:false,
    candidate_can_choose_retrieval_exposure_policy:false,candidate_can_choose_governance_policy:false,
    library_append_performed:false,retrieval_exposure_changed:false,skill_activation_performed:false,
    governance_mutation_performed:false,meta_skill_profile_mutated:false,library_admission_token:null,
    state:'ELIGIBLE_FOR_EXTERNAL_EXISTING_LIBRARY_APPEND_EFFECT',
  });
  return Object.freeze({...core,proposal_digest:digest(core)});
}

export function verifyRsiExternalLibraryAdmissionProposal(row,args={}){
  if(!plain(row)||row.schema!==RSI_EXTERNAL_LIBRARY_ADMISSION_PROPOSAL_SCHEMA||row.version!==1)throw new Error('rsi_phase34_proposal_invalid');
  assertZero(row,'proposal');
  if(row.append_only_preservation_required!==true||row.exact_library_readback_required!==true
    ||row.existing_skill_rewrite_forbidden!==true||row.existing_skill_delete_forbidden!==true
    ||row.in_place_candidate_replacement_forbidden!==true||row.append_transaction_single_effect_required!==true
    ||row.append_retry_after_ambiguous_effect_forbidden!==true||row.append_does_not_imply_retrieval_exposure!==true
    ||row.post_append_governance_recompute_required!==true||row.candidate_starts_not_active!==true
    ||row.external_library_owner!==true||row.external_governance_owner!==true||row.authored_by_candidate!==false
    ||row.candidate_can_choose_append_owner!==false||row.candidate_can_choose_append_policy!==false
    ||row.candidate_can_choose_retrieval_exposure_policy!==false||row.candidate_can_choose_governance_policy!==false
    ||row.library_append_performed!==false||row.retrieval_exposure_changed!==false
    ||row.skill_activation_performed!==false||row.governance_mutation_performed!==false
    ||row.meta_skill_profile_mutated!==false||row.library_admission_token!==null
    ||row.state!=='ELIGIBLE_FOR_EXTERNAL_EXISTING_LIBRARY_APPEND_EFFECT'){
    throw new Error('rsi_phase34_proposal_policy_invalid');
  }
  const canonical=createRsiExternalLibraryAdmissionProposal({
    proposal_id:row.proposal_id,...args,
    append_owner_identity_digest:row.append_owner_identity_digest,
    append_policy_digest:row.append_policy_digest,
    append_journal_contract_digest:row.append_journal_contract_digest,
    append_transaction_fence_digest:row.append_transaction_fence_digest,
    retrieval_exposure_policy_digest:row.retrieval_exposure_policy_digest,
    post_append_governance_policy_digest:row.post_append_governance_policy_digest,
    external_library_owner:true,external_governance_owner:true,authored_by_candidate:false,
  });
  if(canonical.proposal_digest!==exactDigest(row.proposal_digest,'proposal'))throw new Error('rsi_phase34_proposal_digest_mismatch');
  return canonical;
}

export function createRsiExternalLibraryAppendReadback({
  readback_id,
  proposal,
  proposal_args,
  observed_library,
  append_transaction_digest,
  external_owner_receipt_digest,
  previous_retrieval_exposure_digest,
  observed_retrieval_exposure_digest,
  exact_append_readback_pass=false,
  retrieval_exposure_unchanged=false,
  external_library_owner=false,
  external_readback_verifier=false,
  authored_by_candidate=true,
}={}){
  if(external_library_owner!==true||external_readback_verifier!==true||authored_by_candidate!==false){
    throw new Error('rsi_phase34_external_readback_owners_required');
  }
  const p=verifyRsiExternalLibraryAdmissionProposal(proposal,proposal_args);
  const observed=verifyRsiVerifiedSkillLibrary(observed_library);
  if(observed.library_id!==p.current_library_id)throw new Error('rsi_phase34_observed_library_id_drift');
  if(observed.library_digest!==p.expected_next_library_digest)throw new Error('rsi_phase34_observed_library_digest_mismatch');
  if(observed.entries.length!==p.expected_next_library_entry_count)throw new Error('rsi_phase34_observed_library_count_mismatch');
  const old=verifyRsiVerifiedSkillLibrary(proposal_args.current_library);
  assertPreviousEntriesPreserved(old,observed);
  const candidate=observed.entries.find(e=>e.skill_digest===p.proposed_skill_digest);
  if(!candidate||candidate.evidence_digest!==p.proposed_skill_evidence_digest)throw new Error('rsi_phase34_observed_candidate_missing');
  const previousExposure=exactDigest(previous_retrieval_exposure_digest,'previous_retrieval_exposure');
  const observedExposure=exactDigest(observed_retrieval_exposure_digest,'observed_retrieval_exposure');
  const exposureStable=previousExposure===observedExposure&&retrieval_exposure_unchanged===true;
  if(exact_append_readback_pass!==true)throw new Error('rsi_phase34_exact_readback_required');
  if(!exposureStable)throw new Error('rsi_phase34_retrieval_exposure_changed_during_append');
  const roots=[
    exactDigest(append_transaction_digest,'append_transaction'),
    exactDigest(external_owner_receipt_digest,'external_owner_receipt'),
    previousExposure,observedExposure,p.proposal_digest,observed.library_digest,
  ];
  if(new Set(roots.slice(0,3)).size!==3)throw new Error('rsi_phase34_readback_independent_roots_required');
  const core=zero({
    schema:RSI_EXTERNAL_LIBRARY_APPEND_READBACK_SCHEMA,version:1,
    readback_id:id(readback_id,'readback_id'),source_sha:p.source_sha,proposal_digest:p.proposal_digest,
    phase33_certificate_digest:p.phase33_certificate_digest,current_library_digest:p.current_library_digest,
    observed_library_digest:observed.library_digest,expected_next_library_digest:p.expected_next_library_digest,
    observed_library_entry_count:observed.entries.length,proposed_skill_digest:p.proposed_skill_digest,
    proposed_skill_evidence_digest:p.proposed_skill_evidence_digest,
    append_transaction_digest:roots[0],external_owner_receipt_digest:roots[1],
    previous_retrieval_exposure_digest:previousExposure,observed_retrieval_exposure_digest:observedExposure,
    exact_append_readback_pass:true,append_only_preservation_pass:true,candidate_entry_exact_match_pass:true,
    retrieval_exposure_unchanged:true,external_library_append_observed:true,
    external_library_owner:true,external_readback_verifier:true,authored_by_candidate:false,
    library_append_performed_by_this_module:false,skill_activation_performed:false,
    retrieval_exposure_changed:false,governance_mutation_performed:false,meta_skill_profile_mutated:false,
    post_append_governance_recompute_required:true,existing_retrieval_owner_review_required:true,
    active_for_retrieval:false,library_admission_token:null,
    state:'EXTERNAL_LIBRARY_APPEND_READBACK_VERIFIED_PENDING_GOVERNANCE_AND_RETRIEVAL_OWNER_REVIEW',
  });
  return Object.freeze({...core,readback_digest:digest(core)});
}

export function verifyRsiExternalLibraryAppendReadback(row,args={}){
  if(!plain(row)||row.schema!==RSI_EXTERNAL_LIBRARY_APPEND_READBACK_SCHEMA||row.version!==1)throw new Error('rsi_phase34_readback_invalid');
  assertZero(row,'readback');
  if(row.exact_append_readback_pass!==true||row.append_only_preservation_pass!==true
    ||row.candidate_entry_exact_match_pass!==true||row.retrieval_exposure_unchanged!==true
    ||row.external_library_append_observed!==true||row.external_library_owner!==true
    ||row.external_readback_verifier!==true||row.authored_by_candidate!==false
    ||row.library_append_performed_by_this_module!==false||row.skill_activation_performed!==false
    ||row.retrieval_exposure_changed!==false||row.governance_mutation_performed!==false
    ||row.meta_skill_profile_mutated!==false||row.post_append_governance_recompute_required!==true
    ||row.existing_retrieval_owner_review_required!==true||row.active_for_retrieval!==false
    ||row.library_admission_token!==null
    ||row.state!=='EXTERNAL_LIBRARY_APPEND_READBACK_VERIFIED_PENDING_GOVERNANCE_AND_RETRIEVAL_OWNER_REVIEW'){
    throw new Error('rsi_phase34_readback_policy_invalid');
  }
  const canonical=createRsiExternalLibraryAppendReadback({
    readback_id:row.readback_id,...args,
    append_transaction_digest:row.append_transaction_digest,
    external_owner_receipt_digest:row.external_owner_receipt_digest,
    previous_retrieval_exposure_digest:row.previous_retrieval_exposure_digest,
    observed_retrieval_exposure_digest:row.observed_retrieval_exposure_digest,
    exact_append_readback_pass:true,retrieval_exposure_unchanged:true,
    external_library_owner:true,external_readback_verifier:true,authored_by_candidate:false,
  });
  if(canonical.readback_digest!==exactDigest(row.readback_digest,'readback'))throw new Error('rsi_phase34_readback_digest_mismatch');
  return canonical;
}

function archiveState(sourceSha,rows){
  const counts={};for(const row of rows){const state=row.readback?.state??row.proposal.state;counts[state]=(counts[state]||0)+1;}
  const core=zero({
    schema:RSI_EXTERNAL_LIBRARY_ADMISSION_ARCHIVE_SCHEMA,version:1,source_sha:sourceSha,rows,row_count:rows.length,
    state_counts:Object.freeze(counts),append_only:true,durable_before_visible:true,
    rejected_or_incomplete_evidence_preserved:true,external_phase33_evidence_resolver_required:true,
    archive_can_write_library:false,archive_can_change_retrieval_exposure:false,archive_can_activate_skill:false,
    archive_can_mutate_governance:false,archive_can_modify_meta_skill_profile:false,
  });
  return {...core,state_digest:digest(core)};
}

export class RsiExternalLibraryAdmissionArchive{
  #path;#sourceSha;#resolver;#rows=[];#initialized=false;
  constructor({statePath,source_sha,evidenceResolver}={}){
    if(!statePath)throw new Error('rsi_phase34_archive_path_required');
    if(typeof evidenceResolver!=='function')throw new Error('rsi_phase34_archive_resolver_required');
    this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'archive_source');this.#resolver=evidenceResolver;
  }
  async #canonical(stored){
    const ev=await this.#resolver({phase33_certificate_digest:stored.proposal.phase33_certificate_digest,proposal_digest:stored.proposal.proposal_digest});
    if(!plain(ev))throw new Error('rsi_phase34_archive_external_evidence_missing');
    const proposal=verifyRsiExternalLibraryAdmissionProposal(stored.proposal,ev.proposal_args||{});
    let readback=null;
    if(stored.readback){
      readback=verifyRsiExternalLibraryAppendReadback(stored.readback,{proposal,proposal_args:ev.proposal_args,observed_library:ev.observed_library});
    }
    return Object.freeze({proposal,readback});
  }
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const p=JSON.parse(await fs.readFile(this.#path,'utf8'));assertZero(p,'archive');
      if(p.schema!==RSI_EXTERNAL_LIBRARY_ADMISSION_ARCHIVE_SCHEMA||p.version!==1||p.source_sha!==this.#sourceSha
        ||p.append_only!==true||p.durable_before_visible!==true||p.rejected_or_incomplete_evidence_preserved!==true
        ||p.external_phase33_evidence_resolver_required!==true||p.archive_can_write_library!==false
        ||p.archive_can_change_retrieval_exposure!==false||p.archive_can_activate_skill!==false
        ||p.archive_can_mutate_governance!==false||p.archive_can_modify_meta_skill_profile!==false){
        throw new Error('rsi_phase34_archive_policy_invalid');
      }
      const clone=structuredClone(p);delete clone.state_digest;
      if(digest(clone)!==exactDigest(p.state_digest,'archive'))throw new Error('rsi_phase34_archive_digest_mismatch');
      if(!Array.isArray(p.rows)||p.rows.length>MAX_ROWS)throw new Error('rsi_phase34_archive_rows_invalid');
      const checked=[];const ids=new Set();
      for(const stored of p.rows){
        const row=await this.#canonical(stored);
        if(row.proposal.source_sha!==this.#sourceSha)throw new Error('rsi_phase34_archive_source_mismatch');
        if(ids.has(row.proposal.proposal_id))throw new Error('rsi_phase34_archive_duplicate');
        ids.add(row.proposal.proposal_id);checked.push(row);
      }
      const canonical=archiveState(this.#sourceSha,checked);
      if(canonical.row_count!==p.row_count||JSON.stringify(canonical.state_counts)!==JSON.stringify(p.state_counts))throw new Error('rsi_phase34_archive_summary_mismatch');
      this.#rows=checked;
    }catch(e){if(e?.code!=='ENOENT')throw e;}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(rows){
    const state=archiveState(this.#sourceSha,rows),tmp=this.#path+'.tmp',h=await fs.open(tmp,'w',0o600);
    try{await h.writeFile(JSON.stringify(state)+'\n','utf8');await h.sync();}finally{await h.close();}await fs.rename(tmp,this.#path);
  }
  async add({proposal,readback=null,evidence}={}){
    if(!this.#initialized)throw new Error('rsi_phase34_archive_not_initialized');
    const canonical=await this.#canonical({proposal,readback});
    const existing=this.#rows.find(r=>r.proposal.proposal_id===canonical.proposal.proposal_id);
    if(existing){
      if(existing.proposal.proposal_digest!==canonical.proposal.proposal_digest
        ||existing.readback?.readback_digest!==(canonical.readback?.readback_digest??null))throw new Error('rsi_phase34_archive_identity_conflict');
      return zero({state:'IDEMPOTENT',proposal_digest:canonical.proposal.proposal_digest});
    }
    if(this.#rows.length>=MAX_ROWS)throw new Error('rsi_phase34_archive_capacity_exceeded');
    const next=[...this.#rows,canonical];await this.#persist(next);this.#rows=next;
    return zero({state:canonical.readback?.state??canonical.proposal.state,proposal_digest:canonical.proposal.proposal_digest});
  }
  snapshot(){
    const s=archiveState(this.#sourceSha,this.#rows);
    return Object.freeze({schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,
      row_count:s.row_count,state_counts:s.state_counts,append_only:true,durable_before_visible:true,
      rejected_or_incomplete_evidence_preserved:true,external_phase33_evidence_resolver_required:true,
      archive_can_write_library:false,archive_can_change_retrieval_exposure:false,archive_can_activate_skill:false,
      archive_can_mutate_governance:false,archive_can_modify_meta_skill_profile:false,authority_effect:false});
  }
}

export function rsiExternalLibraryAdmissionTrustRootSnapshot(){
  const phase33Root=rsiExactExistingConsumerOwnerReviewTrustRootSnapshot();
  const governanceRoot=rsiSkillLibraryGovernanceTrustRootSnapshot();
  const root={
    schema:'metaengine.rsi.external-library-admission-root.v1',version:1,
    exact_phase33_precommit_certificate_required:true,
    exact_phase33_owner_review_root_digest:phase33Root.exact_owner_review_root_digest,
    existing_verified_skill_library_reused:true,existing_skill_library_governance_reused:true,
    existing_governance_root_digest:governanceRoot.governance_root_digest,
    append_only_existing_library_effect_only:true,exact_post_append_library_readback_required:true,
    old_entries_must_be_bitwise_semantically_preserved:true,in_place_candidate_replacement_forbidden:true,
    ambiguous_append_retry_forbidden:true,append_does_not_imply_active_retrieval:true,
    post_append_governance_recompute_required:true,existing_retrieval_owner_review_required:true,
    candidate_starts_not_active:true,negative_transfer_and_rejected_evidence_remain_durable:true,
    no_second_library:true,no_second_governance_plane:true,no_second_scheduler:true,
    direct_library_write_performed_here:false,direct_retrieval_exposure_change_performed_here:false,
    direct_skill_activation_performed_here:false,direct_governance_mutation_performed_here:false,
    direct_meta_skill_profile_mutation_performed_here:false,
    execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,
    promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,external_library_admission_root_digest:digest(root)});
}
