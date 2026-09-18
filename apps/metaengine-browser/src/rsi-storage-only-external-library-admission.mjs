import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { verifyRsiExactSkillPrecommitCertificate, rsiExactExistingConsumerOwnerReviewTrustRootSnapshot } from './rsi-exact-existing-consumer-owner-review.mjs';
import { createRsiVerifiedSkillLibrary, verifyRsiVerifiedSkillLibrary, verifyRsiSkillCapsule, verifyRsiSkillEvidence } from './rsi-verified-skill-library.mjs';
import { verifyRsiSkillLibraryGovernance, rsiSkillLibraryGovernanceTrustRootSnapshot } from './rsi-skill-library-governance.mjs';

export const RSI_STORAGE_ONLY_LIBRARY_APPEND_PROPOSAL_SCHEMA='metaengine.rsi.storage-only-library-append-proposal.v1';
export const RSI_STORAGE_ONLY_LIBRARY_APPEND_READBACK_SCHEMA='metaengine.rsi.storage-only-library-append-readback.v1';
export const RSI_STORAGE_ONLY_LIBRARY_APPEND_ARCHIVE_SCHEMA='metaengine.rsi.storage-only-library-append-archive.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const EFFECTS=new Set(['APPLIED','NOT_APPLIED','AMBIGUOUS']);
const MAX_ROWS=2048;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function digest(v){return 'sha256:'+crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex');}
function plain(v){return !!v&&typeof v==='object'&&!Array.isArray(v);}
function sha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error('rsi_phase34_'+l+'_sha_invalid');return x;}
function dg(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error('rsi_phase34_'+l+'_digest_invalid');return x;}
function sid(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error('rsi_phase34_'+l+'_invalid');return x;}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false});}
function assertZero(v,l){for(const f of ['execution_authority','browser_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error('rsi_phase34_'+l+'_'+f+'_invalid');if(v?.automatic_retry_allowed!==false)throw new Error('rsi_phase34_'+l+'_retry_invalid');}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function effect(v){const x=String(v||'').trim().toUpperCase();if(!EFFECTS.has(x))throw new Error('rsi_phase34_effect_observation_invalid');return x;}

function phase33(certificate,args){
  if(!plain(args))throw new Error('rsi_phase34_phase33_certificate_args_required');
  const c=verifyRsiExactSkillPrecommitCertificate(certificate,args);
  if(c.state!=='ELIGIBLE_FOR_EXISTING_LIBRARY_OWNER_ADMISSION_REVIEW'||c.blockers.length!==0||c.anytime_valid_acceptance_pass!==true||c.library_append_performed!==false||c.retrieval_exposure_changed!==false||c.skill_activation_performed!==false||c.skill_lifecycle_mutated!==false||c.meta_skill_profile_mutated!==false||c.library_admission_token!==null)throw new Error('rsi_phase34_phase33_certificate_not_eligible');
  return c;
}

function candidate(c,currentLibrary,skillCapsule,skillEvidence){
  const library=verifyRsiVerifiedSkillLibrary(currentLibrary);
  if(library.library_digest!==c.current_library_digest)throw new Error('rsi_phase34_current_library_drift');
  const skill=verifyRsiSkillCapsule(skillCapsule);
  const evidence=verifyRsiSkillEvidence(skillEvidence,skill);
  if(skill.skill_digest!==c.proposed_skill_digest)throw new Error('rsi_phase34_skill_digest_mismatch');
  if(evidence.evidence_digest!==c.standard_skill_evidence_digest)throw new Error('rsi_phase34_skill_evidence_digest_mismatch');
  if(evidence.verified_for_library!==true||evidence.hard_invariants_pass!==true)throw new Error('rsi_phase34_skill_evidence_not_verified');
  if(skill.source_candidate_sha!==c.source_sha||evidence.source_candidate_sha!==c.source_sha)throw new Error('rsi_phase34_skill_source_mismatch');
  if(library.entries.some(r=>r.skill_digest===skill.skill_digest||(r.skill_id===skill.skill_id&&r.skill_version===skill.skill_version)))throw new Error('rsi_phase34_skill_already_present');
  return Object.freeze({library,skill,evidence});
}

function successor(library,skill,evidence){
  return createRsiVerifiedSkillLibrary({library_id:library.library_id,entries:[...library.entries.map(r=>({capsule:r.capsule,evidence:r.evidence})),{capsule:skill,evidence}],external_library_owner:true,authored_by_candidate:false});
}

function preserve(previous,next){
  if(next.entries.length!==previous.entries.length+1)throw new Error('rsi_phase34_successor_cardinality_invalid');
  for(const old of previous.entries){
    const cur=next.entries.find(r=>r.skill_digest===old.skill_digest);
    if(!cur)throw new Error('rsi_phase34_previous_skill_missing');
    if(cur.evidence_digest!==old.evidence_digest||cur.skill_id!==old.skill_id||cur.skill_version!==old.skill_version||cur.role!==old.role||cur.input_schema_digest!==old.input_schema_digest||cur.output_schema_digest!==old.output_schema_digest||!same(cur.capabilities,old.capabilities)||cur.max_context_tokens!==old.max_context_tokens||cur.max_output_tokens!==old.max_output_tokens||cur.max_invocations!==old.max_invocations)throw new Error('rsi_phase34_previous_skill_rewritten');
  }
}

export function createRsiStorageOnlyLibraryAppendProposal({
  proposal_id,phase33_certificate,phase33_certificate_args,current_library,current_governance,skill_capsule,skill_evidence,
  effect_id,idempotency_key_digest,append_owner_identity_digest,append_policy_digest,append_journal_contract_digest,
  retrieval_exposure_policy_digest,post_append_governance_policy_digest,
  external_library_owner=false,external_effect_owner=false,external_governance_owner=false,authored_by_candidate=true,
}={}){
  if(external_library_owner!==true||external_effect_owner!==true||external_governance_owner!==true||authored_by_candidate!==false)throw new Error('rsi_phase34_external_owners_required');
  const c=phase33(phase33_certificate,phase33_certificate_args);
  const {library,skill,evidence}=candidate(c,current_library,skill_capsule,skill_evidence);
  const governance=verifyRsiSkillLibraryGovernance(current_governance,library);
  if(governance.library_digest!==library.library_digest)throw new Error('rsi_phase34_governance_library_drift');
  const next=successor(library,skill,evidence);preserve(library,next);
  const p33=rsiExactExistingConsumerOwnerReviewTrustRootSnapshot(),gov=rsiSkillLibraryGovernanceTrustRootSnapshot();
  const roots=[dg(idempotency_key_digest,'idempotency_key'),dg(append_owner_identity_digest,'append_owner_identity'),dg(append_policy_digest,'append_policy'),dg(append_journal_contract_digest,'append_journal_contract'),dg(retrieval_exposure_policy_digest,'retrieval_exposure_policy'),dg(post_append_governance_policy_digest,'post_append_governance_policy'),c.certificate_digest,library.library_digest,governance.governance_digest,p33.exact_owner_review_root_digest,gov.governance_root_digest];
  if(new Set(roots).size!==roots.length)throw new Error('rsi_phase34_independent_roots_required');
  const core=zero({
    schema:RSI_STORAGE_ONLY_LIBRARY_APPEND_PROPOSAL_SCHEMA,version:1,proposal_id:sid(proposal_id,'proposal_id'),source_sha:sha(c.source_sha,'source'),
    phase33_certificate_digest:c.certificate_digest,phase33_bundle_digest:c.bundle_digest,phase32_receipt_digest:c.phase32_receipt_digest,
    consumer_evaluation_contract_digest:c.consumer_evaluation_contract_digest,consumer_evaluator_generation_digest:c.consumer_evaluator_generation_digest,
    consumer_evaluator_generation_seq:c.consumer_evaluator_generation_seq,consumer_evaluator_generation_history_anchor_digest:c.consumer_evaluator_generation_history_anchor_digest,
    consumer_evaluation_epoch_seq:c.consumer_evaluation_epoch_seq,consumer_evaluation_epoch_digest:c.consumer_evaluation_epoch_digest,
    anytime_valid_certificate_digest:c.anytime_valid_certificate_digest,false_admission_error_budget_policy_digest:c.false_admission_error_budget_policy_digest,
    false_admission_alpha_ppm:c.false_admission_alpha_ppm,anytime_valid_e_value_microunits:c.anytime_valid_e_value_microunits,
    anytime_valid_threshold_microunits:c.anytime_valid_threshold_microunits,paired_instance_manifest_digest:c.paired_instance_manifest_digest,
    stopping_policy_digest:c.stopping_policy_digest,paired_sample_count:c.paired_sample_count,minimum_paired_sample_count:c.minimum_paired_sample_count,
    active_retrieval_cap:c.active_retrieval_cap,marginal_subset_selection_policy_digest:c.marginal_subset_selection_policy_digest,
    current_library_id:library.library_id,current_library_digest:library.library_digest,current_library_entry_count:library.entries.length,
    current_governance_digest:governance.governance_digest,phase33_owner_review_root_digest:p33.exact_owner_review_root_digest,existing_governance_root_digest:gov.governance_root_digest,
    proposed_skill_id:skill.skill_id,proposed_skill_version:skill.skill_version,proposed_skill_digest:skill.skill_digest,
    proposed_skill_evidence_digest:evidence.evidence_digest,proposed_skill_parent_digest:skill.parent_skill_digest,
    expected_successor_library_digest:next.library_digest,expected_successor_library_entry_count:next.entries.length,
    effect_id:sid(effect_id,'effect_id'),idempotency_key_digest:roots[0],append_owner_identity_digest:roots[1],append_policy_digest:roots[2],
    append_journal_contract_digest:roots[3],retrieval_exposure_policy_digest:roots[4],post_append_governance_policy_digest:roots[5],
    exact_current_library_binding_required:true,exact_current_governance_binding_required:true,exact_successor_digest_precommit_required:true,
    append_only_preservation_required:true,existing_skill_rewrite_forbidden:true,existing_skill_delete_forbidden:true,in_place_candidate_replacement_forbidden:true,
    one_external_effect_attempt_required:true,ambiguous_effect_requires_reconciliation:true,blind_retry_after_ambiguous_effect_forbidden:true,
    append_does_not_imply_retrieval_exposure:true,post_append_governance_recompute_required:true,existing_retrieval_owner_review_required:true,
    candidate_starts_storage_only:true,candidate_can_choose_effect_id:false,candidate_can_choose_idempotency_key:false,candidate_can_choose_append_owner:false,
    candidate_can_choose_append_policy:false,candidate_can_choose_retrieval_exposure_policy:false,candidate_can_choose_governance_policy:false,
    external_library_owner:true,external_effect_owner:true,external_governance_owner:true,authored_by_candidate:false,
    library_append_performed:false,retrieval_exposure_changed:false,skill_activation_performed:false,governance_mutation_performed:false,meta_skill_profile_mutated:false,
    library_admission_token:null,state:'READY_FOR_EXTERNAL_STORAGE_ONLY_LIBRARY_APPEND',
  });
  return Object.freeze({...core,proposal_digest:digest(core)});
}

export function verifyRsiStorageOnlyLibraryAppendProposal(row,args={}){
  if(!plain(row)||row.schema!==RSI_STORAGE_ONLY_LIBRARY_APPEND_PROPOSAL_SCHEMA||row.version!==1)throw new Error('rsi_phase34_proposal_invalid');assertZero(row,'proposal');
  for(const [f,v] of Object.entries({exact_current_library_binding_required:true,exact_current_governance_binding_required:true,exact_successor_digest_precommit_required:true,append_only_preservation_required:true,existing_skill_rewrite_forbidden:true,existing_skill_delete_forbidden:true,in_place_candidate_replacement_forbidden:true,one_external_effect_attempt_required:true,ambiguous_effect_requires_reconciliation:true,blind_retry_after_ambiguous_effect_forbidden:true,append_does_not_imply_retrieval_exposure:true,post_append_governance_recompute_required:true,existing_retrieval_owner_review_required:true,candidate_starts_storage_only:true,candidate_can_choose_effect_id:false,candidate_can_choose_idempotency_key:false,candidate_can_choose_append_owner:false,candidate_can_choose_append_policy:false,candidate_can_choose_retrieval_exposure_policy:false,candidate_can_choose_governance_policy:false,external_library_owner:true,external_effect_owner:true,external_governance_owner:true,authored_by_candidate:false,library_append_performed:false,retrieval_exposure_changed:false,skill_activation_performed:false,governance_mutation_performed:false,meta_skill_profile_mutated:false}))if(row[f]!==v)throw new Error('rsi_phase34_proposal_policy_invalid');
  if(row.library_admission_token!==null||row.state!=='READY_FOR_EXTERNAL_STORAGE_ONLY_LIBRARY_APPEND')throw new Error('rsi_phase34_proposal_policy_invalid');
  const canonical=createRsiStorageOnlyLibraryAppendProposal({proposal_id:row.proposal_id,...args,effect_id:row.effect_id,idempotency_key_digest:row.idempotency_key_digest,append_owner_identity_digest:row.append_owner_identity_digest,append_policy_digest:row.append_policy_digest,append_journal_contract_digest:row.append_journal_contract_digest,retrieval_exposure_policy_digest:row.retrieval_exposure_policy_digest,post_append_governance_policy_digest:row.post_append_governance_policy_digest,external_library_owner:true,external_effect_owner:true,external_governance_owner:true,authored_by_candidate:false});
  if(canonical.proposal_digest!==dg(row.proposal_digest,'proposal'))throw new Error('rsi_phase34_proposal_digest_mismatch');return canonical;
}

export function createRsiStorageOnlyLibraryAppendReadback({
  readback_id,proposal,proposal_args,effect_observation,observed_library=null,external_effect_receipt_digest,reconciliation_probe_digest=null,
  previous_retrieval_exposure_digest,observed_retrieval_exposure_digest,exact_readback_pass=false,
  external_library_owner=false,external_readback_verifier=false,authored_by_candidate=true,
}={}){
  if(external_library_owner!==true||external_readback_verifier!==true||authored_by_candidate!==false)throw new Error('rsi_phase34_external_readback_owners_required');
  const p=verifyRsiStorageOnlyLibraryAppendProposal(proposal,proposal_args),obs=effect(effect_observation);
  const effectReceipt=dg(external_effect_receipt_digest,'external_effect_receipt'),before=dg(previous_retrieval_exposure_digest,'previous_retrieval_exposure'),after=dg(observed_retrieval_exposure_digest,'observed_retrieval_exposure');
  if(before!==after)throw new Error('rsi_phase34_retrieval_exposure_changed_during_append');
  let observedDigest=null,observedCount=null,confirmed=false,notApplied=false,reconcile=false,state,reconcileDigest=null;
  if(obs==='APPLIED'){
    if(exact_readback_pass!==true)throw new Error('rsi_phase34_exact_readback_required');
    const observed=verifyRsiVerifiedSkillLibrary(observed_library);
    if(observed.library_id!==p.current_library_id||observed.library_digest!==p.expected_successor_library_digest||observed.entries.length!==p.expected_successor_library_entry_count)throw new Error('rsi_phase34_observed_successor_mismatch');
    const previous=verifyRsiVerifiedSkillLibrary(proposal_args.current_library);preserve(previous,observed);
    const cand=observed.entries.find(r=>r.skill_digest===p.proposed_skill_digest);
    if(!cand||cand.evidence_digest!==p.proposed_skill_evidence_digest)throw new Error('rsi_phase34_observed_candidate_missing');
    observedDigest=observed.library_digest;observedCount=observed.entries.length;confirmed=true;state='STORAGE_ONLY_APPEND_CONFIRMED_PENDING_GOVERNANCE';
  }else if(obs==='NOT_APPLIED'){
    if(exact_readback_pass!==true)throw new Error('rsi_phase34_exact_readback_required');
    const observed=verifyRsiVerifiedSkillLibrary(observed_library);
    if(observed.library_id!==p.current_library_id||observed.library_digest!==p.current_library_digest||observed.entries.length!==p.current_library_entry_count)throw new Error('rsi_phase34_not_applied_readback_mismatch');
    observedDigest=observed.library_digest;observedCount=observed.entries.length;notApplied=true;state='APPEND_NOT_APPLIED';
  }else{
    if(exact_readback_pass===true)throw new Error('rsi_phase34_ambiguous_effect_cannot_claim_exact_readback');
    reconcileDigest=dg(reconciliation_probe_digest,'reconciliation_probe');reconcile=true;state='RECONCILIATION_REQUIRED';
  }
  const core=zero({
    schema:RSI_STORAGE_ONLY_LIBRARY_APPEND_READBACK_SCHEMA,version:1,readback_id:sid(readback_id,'readback_id'),source_sha:p.source_sha,
    proposal_digest:p.proposal_digest,effect_id:p.effect_id,idempotency_key_digest:p.idempotency_key_digest,phase33_certificate_digest:p.phase33_certificate_digest,
    current_library_digest:p.current_library_digest,expected_successor_library_digest:p.expected_successor_library_digest,
    proposed_skill_digest:p.proposed_skill_digest,proposed_skill_evidence_digest:p.proposed_skill_evidence_digest,
    effect_observation:obs,external_effect_receipt_digest:effectReceipt,reconciliation_probe_digest:reconcileDigest,
    previous_retrieval_exposure_digest:before,observed_retrieval_exposure_digest:after,observed_library_digest:observedDigest,observed_library_entry_count:observedCount,
    exact_readback_pass:exact_readback_pass===true,append_confirmed:confirmed,append_not_applied:notApplied,reconciliation_required:reconcile,
    effect_may_have_occurred:obs==='AMBIGUOUS',blind_retry_authorized:false,append_only_preservation_pass:confirmed?true:null,candidate_entry_exact_match_pass:confirmed?true:null,
    retrieval_exposure_unchanged:true,storage_only_after_append:confirmed,post_append_governance_recompute_required:confirmed,existing_retrieval_owner_review_required:confirmed,
    active_for_retrieval:false,skill_activation_performed:false,retrieval_exposure_changed:false,governance_mutation_performed:false,meta_skill_profile_mutated:false,
    library_append_performed_by_this_module:false,external_library_owner:true,external_readback_verifier:true,authored_by_candidate:false,state,
  });
  return Object.freeze({...core,readback_digest:digest(core)});
}

export function verifyRsiStorageOnlyLibraryAppendReadback(row,args={}){
  if(!plain(row)||row.schema!==RSI_STORAGE_ONLY_LIBRARY_APPEND_READBACK_SCHEMA||row.version!==1)throw new Error('rsi_phase34_readback_invalid');assertZero(row,'readback');
  if(row.blind_retry_authorized!==false||row.retrieval_exposure_unchanged!==true||row.active_for_retrieval!==false||row.skill_activation_performed!==false||row.retrieval_exposure_changed!==false||row.governance_mutation_performed!==false||row.meta_skill_profile_mutated!==false||row.library_append_performed_by_this_module!==false||row.external_library_owner!==true||row.external_readback_verifier!==true||row.authored_by_candidate!==false)throw new Error('rsi_phase34_readback_policy_invalid');
  const canonical=createRsiStorageOnlyLibraryAppendReadback({readback_id:row.readback_id,...args,effect_observation:row.effect_observation,external_effect_receipt_digest:row.external_effect_receipt_digest,reconciliation_probe_digest:row.reconciliation_probe_digest,previous_retrieval_exposure_digest:row.previous_retrieval_exposure_digest,observed_retrieval_exposure_digest:row.observed_retrieval_exposure_digest,exact_readback_pass:row.exact_readback_pass,external_library_owner:true,external_readback_verifier:true,authored_by_candidate:false});
  if(canonical.readback_digest!==dg(row.readback_digest,'readback'))throw new Error('rsi_phase34_readback_digest_mismatch');return canonical;
}

function archiveState(sourceSha,rows){
  const counts={};for(const r of rows){const s=r.readback?.state??r.proposal.state;counts[s]=(counts[s]||0)+1;}
  const core=zero({schema:RSI_STORAGE_ONLY_LIBRARY_APPEND_ARCHIVE_SCHEMA,version:1,source_sha:sourceSha,rows,row_count:rows.length,state_counts:Object.freeze(counts),append_only:true,durable_before_visible:true,upstream_evidence_reverified_on_restart:true,rejected_not_applied_and_ambiguous_evidence_preserved:true,ambiguous_effects_are_reconciliation_only:true,archive_can_write_library:false,archive_can_change_retrieval_exposure:false,archive_can_activate_skill:false,archive_can_mutate_governance:false,archive_can_modify_meta_skill_profile:false,archive_can_schedule_work:false});
  return {...core,state_digest:digest(core)};
}

export class RsiStorageOnlyLibraryAppendArchive{
  #path;#sourceSha;#resolver;#rows=[];#initialized=false;
  constructor({statePath,source_sha,evidenceResolver}={}){if(!statePath)throw new Error('rsi_phase34_archive_path_required');if(typeof evidenceResolver!=='function')throw new Error('rsi_phase34_archive_resolver_required');this.#path=path.resolve(statePath);this.#sourceSha=sha(source_sha,'archive_source');this.#resolver=evidenceResolver;}
  async #canonical(stored){const ev=await this.#resolver({phase33_certificate_digest:stored.proposal.phase33_certificate_digest,proposal_digest:stored.proposal.proposal_digest,readback_digest:stored.readback?.readback_digest??null});if(!plain(ev))throw new Error('rsi_phase34_archive_external_evidence_missing');const proposal=verifyRsiStorageOnlyLibraryAppendProposal(stored.proposal,ev.proposal_args||{});let readback=null;if(stored.readback)readback=verifyRsiStorageOnlyLibraryAppendReadback(stored.readback,{proposal,proposal_args:ev.proposal_args||{},observed_library:ev.observed_library??null});return Object.freeze({proposal,readback});}
  async init(){if(this.#initialized)return this.snapshot();await fs.mkdir(path.dirname(this.#path),{recursive:true});try{const p=JSON.parse(await fs.readFile(this.#path,'utf8'));assertZero(p,'archive');if(p.schema!==RSI_STORAGE_ONLY_LIBRARY_APPEND_ARCHIVE_SCHEMA||p.version!==1||p.source_sha!==this.#sourceSha||p.append_only!==true||p.durable_before_visible!==true||p.upstream_evidence_reverified_on_restart!==true||p.rejected_not_applied_and_ambiguous_evidence_preserved!==true||p.ambiguous_effects_are_reconciliation_only!==true||p.archive_can_write_library!==false||p.archive_can_change_retrieval_exposure!==false||p.archive_can_activate_skill!==false||p.archive_can_mutate_governance!==false||p.archive_can_modify_meta_skill_profile!==false||p.archive_can_schedule_work!==false)throw new Error('rsi_phase34_archive_policy_invalid');const clone=structuredClone(p);delete clone.state_digest;if(digest(clone)!==dg(p.state_digest,'archive'))throw new Error('rsi_phase34_archive_digest_mismatch');if(!Array.isArray(p.rows)||p.rows.length>MAX_ROWS)throw new Error('rsi_phase34_archive_rows_invalid');const checked=[],proposalIds=new Set(),effectIds=new Set();for(const stored of p.rows){const row=await this.#canonical(stored);if(row.proposal.source_sha!==this.#sourceSha)throw new Error('rsi_phase34_archive_source_mismatch');if(proposalIds.has(row.proposal.proposal_id)||effectIds.has(row.proposal.effect_id))throw new Error('rsi_phase34_archive_duplicate');proposalIds.add(row.proposal.proposal_id);effectIds.add(row.proposal.effect_id);checked.push(row);}const canonical=archiveState(this.#sourceSha,checked);if(canonical.row_count!==p.row_count||JSON.stringify(canonical.state_counts)!==JSON.stringify(p.state_counts))throw new Error('rsi_phase34_archive_summary_mismatch');this.#rows=checked;}catch(e){if(e?.code!=='ENOENT')throw e;}this.#initialized=true;return this.snapshot();}
  async #persist(rows){const state=archiveState(this.#sourceSha,rows),tmp=this.#path+'.tmp',h=await fs.open(tmp,'w',0o600);try{await h.writeFile(JSON.stringify(state)+'\n','utf8');await h.sync();}finally{await h.close();}await fs.rename(tmp,this.#path);}
  async add({proposal,readback=null}={}){if(!this.#initialized)throw new Error('rsi_phase34_archive_not_initialized');const row=await this.#canonical({proposal,readback});const existing=this.#rows.find(r=>r.proposal.proposal_id===row.proposal.proposal_id||r.proposal.effect_id===row.proposal.effect_id);if(existing){if(existing.proposal.proposal_digest!==row.proposal.proposal_digest||existing.readback?.readback_digest!==(row.readback?.readback_digest??null))throw new Error('rsi_phase34_archive_identity_conflict');return zero({state:'IDEMPOTENT',proposal_digest:row.proposal.proposal_digest,readback_state:row.readback?.state??null});}if(this.#rows.length>=MAX_ROWS)throw new Error('rsi_phase34_archive_capacity_exceeded');const next=[...this.#rows,row];await this.#persist(next);this.#rows=next;return zero({state:'STORAGE_ONLY_APPEND_EVIDENCE_ARCHIVED',proposal_digest:row.proposal.proposal_digest,readback_state:row.readback?.state??null});}
  snapshot(){const s=archiveState(this.#sourceSha,this.#rows);return Object.freeze({schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,row_count:s.row_count,state_counts:s.state_counts,append_only:true,durable_before_visible:true,upstream_evidence_reverified_on_restart:true,rejected_not_applied_and_ambiguous_evidence_preserved:true,ambiguous_effects_are_reconciliation_only:true,archive_can_write_library:false,archive_can_change_retrieval_exposure:false,archive_can_activate_skill:false,archive_can_mutate_governance:false,archive_can_modify_meta_skill_profile:false,archive_can_schedule_work:false,authority_effect:false});}
}

export function rsiStorageOnlyLibraryAppendTrustRootSnapshot(){
  const p33=rsiExactExistingConsumerOwnerReviewTrustRootSnapshot(),gov=rsiSkillLibraryGovernanceTrustRootSnapshot();
  const root={schema:'metaengine.rsi.storage-only-library-append-root.v1',version:1,exact_phase33_precommit_certificate_required:true,exact_phase33_owner_review_root_digest:p33.exact_owner_review_root_digest,existing_verified_skill_library_reused:true,existing_skill_library_governance_reused:true,existing_governance_root_digest:gov.governance_root_digest,append_only_successor_precommit_required:true,exact_post_effect_library_readback_required:true,predecessor_entries_must_be_preserved:true,in_place_candidate_replacement_forbidden:true,one_external_effect_attempt_required:true,ambiguous_effect_requires_reconciliation:true,blind_retry_after_ambiguous_effect_forbidden:true,append_does_not_imply_active_retrieval:true,newly_appended_skill_is_storage_only:true,post_append_governance_recompute_required:true,existing_retrieval_owner_review_required:true,negative_rejected_and_ambiguous_evidence_remain_durable:true,no_second_library:true,no_second_governance_plane:true,no_second_scheduler:true,direct_library_write_performed_here:false,direct_retrieval_exposure_change_performed_here:false,direct_skill_activation_performed_here:false,direct_governance_mutation_performed_here:false,direct_meta_skill_profile_mutation_performed_here:false,execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false};
  return Object.freeze({...root,storage_only_library_append_root_digest:digest(root)});
}
