import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  verifyRsiExistingSkillOwnerEvidenceReview,
} from './rsi-existing-consumer-owner-review.mjs';
import {
  verifyRsiSkillCapsule,
  verifyRsiVerifiedSkillLibrary,
} from './rsi-verified-skill-library.mjs';
import {
  verifyRsiSkillLibraryGovernance,
  rsiSkillLibraryGovernanceTrustRootSnapshot,
} from './rsi-skill-library-governance.mjs';
import {
  rsiSkillScopeExpansionTrustRootSnapshot,
} from './rsi-skill-scope-expansion.mjs';

export const RSI_ANYTIME_VALID_LIBRARY_ADMISSION_PLAN_SCHEMA='metaengine.rsi.anytime-valid-library-admission-plan.v1';
export const RSI_LEAST_PRIVILEGE_SKILL_SCOPE_RECEIPT_SCHEMA='metaengine.rsi.least-privilege-skill-scope-receipt.v1';
export const RSI_ANYTIME_VALID_LIBRARY_ADMISSION_CERTIFICATE_SCHEMA='metaengine.rsi.anytime-valid-library-admission-certificate.v1';
export const RSI_EXISTING_GOVERNANCE_ACTION_REVIEW_SCHEMA='metaengine.rsi.existing-governance-action-review.v1';
export const RSI_ANYTIME_VALID_LIBRARY_ADMISSION_ARCHIVE_SCHEMA='metaengine.rsi.anytime-valid-library-admission-archive.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_CAP_RE=/^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_ROWS=2048;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function digest(v){return 'sha256:'+crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex');}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error('rsi_phase34_'+l+'_sha_invalid');return x;}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error('rsi_phase34_'+l+'_digest_invalid');return x;}
function id(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error('rsi_phase34_'+l+'_invalid');return x;}
function plain(v){return !!v&&typeof v==='object'&&!Array.isArray(v);}
function finite(v,l){const x=Number(v);if(!Number.isFinite(x))throw new Error('rsi_phase34_'+l+'_invalid');return x;}
function positiveInt(v,l,max=1_000_000){const x=Number(v);if(!Number.isSafeInteger(x)||x<1||x>max)throw new Error('rsi_phase34_'+l+'_invalid');return x;}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false});}
function assertZero(v,l){for(const f of ['execution_authority','browser_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error('rsi_phase34_'+l+'_'+f+'_invalid');if(v?.automatic_retry_allowed!==false)throw new Error('rsi_phase34_'+l+'_retry_invalid');}
function sortedUnique(values){return [...new Set(values)].sort();}
function capabilities(values){
  if(!Array.isArray(values)||values.length<1||values.length>32)throw new Error('rsi_phase34_capabilities_invalid');
  const out=values.map(v=>String(v||'').trim().toUpperCase());
  if(out.some(v=>!SAFE_CAP_RE.test(v))||new Set(out).size!==out.length)throw new Error('rsi_phase34_capabilities_invalid');
  return Object.freeze(out.sort());
}
function digestList(values,l,{min=1,max=64}={}){
  if(!Array.isArray(values)||values.length<min||values.length>max)throw new Error('rsi_phase34_'+l+'_invalid');
  const out=values.map(v=>exactDigest(v,l));
  if(new Set(out).size!==out.length)throw new Error('rsi_phase34_'+l+'_duplicate');
  return Object.freeze(out.sort());
}
function sameArray(a,b){return JSON.stringify(a)===JSON.stringify(b);}

function phase33({phase33_review,phase33_args}={}){
  if(!plain(phase33_args))throw new Error('rsi_phase34_phase33_args_required');
  const review=verifyRsiExistingSkillOwnerEvidenceReview(phase33_review,phase33_args);
  if(review.state!=='ELIGIBLE_FOR_EXISTING_VERIFIED_SKILL_LIBRARY_OWNER_REVIEW'
    ||review.library_append_performed!==false||review.skill_activation_performed!==false
    ||review.skill_lifecycle_mutated!==false||review.library_admission_token!==null){
    throw new Error('rsi_phase34_phase33_review_not_eligible');
  }
  const library=verifyRsiVerifiedSkillLibrary(phase33_args.current_library);
  const skill=verifyRsiSkillCapsule(phase33_args.skill_capsule);
  if(review.current_library_digest!==library.library_digest||review.proposed_skill_digest!==skill.skill_digest){
    throw new Error('rsi_phase34_phase33_library_skill_mismatch');
  }
  return Object.freeze({review,library,skill});
}

function parentGovernanceState(skill,library,governance){
  if(skill.parent_skill_digest==null)return 'NEW_SKILL';
  const parent=library.entries.find(e=>e.skill_digest===skill.parent_skill_digest);
  if(!parent)throw new Error('rsi_phase34_parent_skill_missing');
  const state=governance.entries.find(e=>e.skill_digest===parent.skill_digest)?.state;
  if(!state)throw new Error('rsi_phase34_parent_governance_state_missing');
  return state;
}

function maturityClass(parentState){
  if(parentState==='ACTIVE')return 'MATURE_ACTIVE_PARENT';
  if(parentState==='EXPLORATION_ACTIVE')return 'EXPLORATORY_PARENT';
  if(parentState==='DORMANT_CAP')return 'DORMANT_PARENT';
  if(parentState==='QUARANTINED')return 'QUARANTINED_PARENT';
  if(parentState==='RETIRED')return 'RETIRED_PARENT';
  if(parentState==='NEW_SKILL')return 'NEW_SKILL';
  throw new Error('rsi_phase34_parent_state_invalid');
}

export function createRsiAnytimeValidLibraryAdmissionPlan({
  plan_id,phase33_review,phase33_args,current_governance,
  statistical_owner_root_digest,false_admission_alpha,error_budget_digest,
  paired_instance_set_digest,pairing_protocol_digest,eprocess_protocol_digest,error_spending_policy_digest,
  stopping_policy_digest,change_envelope_digest,maturity_policy_digest,least_privilege_policy_digest,
  planned_min_pairs,planned_max_pairs,
  external_library_owner=false,external_statistical_owner=false,external_scope_owner=false,authored_by_candidate=true,
}={}){
  if(external_library_owner!==true||external_statistical_owner!==true||external_scope_owner!==true||authored_by_candidate!==false){
    throw new Error('rsi_phase34_external_owners_required');
  }
  const p33=phase33({phase33_review,phase33_args});
  const governance=verifyRsiSkillLibraryGovernance(current_governance,p33.library);
  if(governance.library_digest!==p33.review.current_library_digest)throw new Error('rsi_phase34_governance_library_drift');
  const parentState=parentGovernanceState(p33.skill,p33.library,governance);
  if(parentState==='QUARANTINED'||parentState==='RETIRED')throw new Error('rsi_phase34_terminal_parent_requires_separate_repair_review');
  const alpha=finite(false_admission_alpha,'false_admission_alpha');
  if(!(alpha>0&&alpha<=0.05))throw new Error('rsi_phase34_false_admission_alpha_out_of_bounds');
  const minPairs=positiveInt(planned_min_pairs,'planned_min_pairs',100000);
  const maxPairs=positiveInt(planned_max_pairs,'planned_max_pairs',100000);
  if(maxPairs<minPairs)throw new Error('rsi_phase34_pair_budget_invalid');
  const governanceRoot=rsiSkillLibraryGovernanceTrustRootSnapshot();
  const scopeRoot=rsiSkillScopeExpansionTrustRootSnapshot();
  const roots=[
    exactDigest(statistical_owner_root_digest,'statistical_owner_root'),
    exactDigest(error_budget_digest,'error_budget'),exactDigest(paired_instance_set_digest,'paired_instance_set'),
    exactDigest(pairing_protocol_digest,'pairing_protocol'),exactDigest(eprocess_protocol_digest,'eprocess_protocol'),
    exactDigest(error_spending_policy_digest,'error_spending_policy'),exactDigest(stopping_policy_digest,'stopping_policy'),
    exactDigest(change_envelope_digest,'change_envelope'),exactDigest(maturity_policy_digest,'maturity_policy'),
    exactDigest(least_privilege_policy_digest,'least_privilege_policy'),
    governance.governance_digest,governanceRoot.governance_root_digest,scopeRoot.scope_root_digest,
    p33.review.review_digest,p33.skill.skill_digest,
  ];
  if(new Set(roots).size!==roots.length)throw new Error('rsi_phase34_independent_policy_roots_required');
  const core=zero({
    schema:RSI_ANYTIME_VALID_LIBRARY_ADMISSION_PLAN_SCHEMA,version:1,
    plan_id:id(plan_id,'plan_id'),source_sha:exactSha(p33.review.source_sha,'source'),
    phase33_review_digest:p33.review.review_digest,phase32_receipt_digest:p33.review.phase32_receipt_digest,
    current_library_id:p33.library.library_id,current_library_digest:p33.library.library_digest,
    current_governance_digest:governance.governance_digest,
    governance_root_digest:governanceRoot.governance_root_digest,scope_root_digest:scopeRoot.scope_root_digest,
    proposed_skill_digest:p33.skill.skill_digest,proposed_skill_id:p33.skill.skill_id,proposed_skill_version:p33.skill.skill_version,
    parent_skill_digest:p33.skill.parent_skill_digest,parent_governance_state:parentState,maturity_class:maturityClass(parentState),
    declared_capabilities:p33.skill.capabilities,
    statistical_owner_root_digest:roots[0],false_admission_alpha:alpha,
    anytime_valid_evalue_threshold:1/alpha,error_budget_digest:roots[1],paired_instance_set_digest:roots[2],
    pairing_protocol_digest:roots[3],eprocess_protocol_digest:roots[4],error_spending_policy_digest:roots[5],
    stopping_policy_digest:roots[6],change_envelope_digest:roots[7],maturity_policy_digest:roots[8],
    least_privilege_policy_digest:roots[9],planned_min_pairs:minPairs,planned_max_pairs:maxPairs,
    paired_identical_instances_required:true,matched_no_skill_or_incumbent_reference_required:true,
    optional_stopping_only_via_anytime_valid_protocol:true,abstain_or_insufficient_evidence_is_first_class:true,
    negative_transfer_is_hard_veto:true,current_library_exact_binding_required:true,current_governance_exact_binding_required:true,
    parent_terminal_state_requires_separate_repair_review:true,mature_skill_stricter_change_envelope_required:true,
    candidate_can_choose_alpha:false,candidate_can_choose_error_budget:false,candidate_can_choose_instances:false,
    candidate_can_choose_evaluator:false,candidate_can_choose_stopping_policy:false,candidate_can_choose_acceptance_boundary:false,
    candidate_can_choose_scope_policy:false,candidate_can_choose_maturity_policy:false,
    external_library_owner:true,external_statistical_owner:true,external_scope_owner:true,authored_by_candidate:false,
    library_append_performed:false,skill_activation_performed:false,governance_mutation_performed:false,
    meta_skill_profile_mutated:false,admission_token:null,plan_can_schedule_work:false,
  });
  return Object.freeze({...core,plan_digest:digest(core)});
}

export function verifyRsiAnytimeValidLibraryAdmissionPlan(row,args={}){
  if(!plain(row)||row.schema!==RSI_ANYTIME_VALID_LIBRARY_ADMISSION_PLAN_SCHEMA||row.version!==1)throw new Error('rsi_phase34_plan_invalid');
  assertZero(row,'plan');
  for(const [f,v] of Object.entries({
    paired_identical_instances_required:true,matched_no_skill_or_incumbent_reference_required:true,
    optional_stopping_only_via_anytime_valid_protocol:true,abstain_or_insufficient_evidence_is_first_class:true,
    negative_transfer_is_hard_veto:true,current_library_exact_binding_required:true,current_governance_exact_binding_required:true,
    parent_terminal_state_requires_separate_repair_review:true,mature_skill_stricter_change_envelope_required:true,
    candidate_can_choose_alpha:false,candidate_can_choose_error_budget:false,candidate_can_choose_instances:false,
    candidate_can_choose_evaluator:false,candidate_can_choose_stopping_policy:false,candidate_can_choose_acceptance_boundary:false,
    candidate_can_choose_scope_policy:false,candidate_can_choose_maturity_policy:false,
    external_library_owner:true,external_statistical_owner:true,external_scope_owner:true,authored_by_candidate:false,
    library_append_performed:false,skill_activation_performed:false,governance_mutation_performed:false,
    meta_skill_profile_mutated:false,plan_can_schedule_work:false
  }))if(row[f]!==v)throw new Error('rsi_phase34_plan_policy_invalid');
  if(row.admission_token!==null)throw new Error('rsi_phase34_plan_token_invalid');
  const canonical=createRsiAnytimeValidLibraryAdmissionPlan({
    plan_id:row.plan_id,...args,statistical_owner_root_digest:row.statistical_owner_root_digest,
    false_admission_alpha:row.false_admission_alpha,error_budget_digest:row.error_budget_digest,
    paired_instance_set_digest:row.paired_instance_set_digest,pairing_protocol_digest:row.pairing_protocol_digest,
    eprocess_protocol_digest:row.eprocess_protocol_digest,error_spending_policy_digest:row.error_spending_policy_digest,
    stopping_policy_digest:row.stopping_policy_digest,change_envelope_digest:row.change_envelope_digest,
    maturity_policy_digest:row.maturity_policy_digest,least_privilege_policy_digest:row.least_privilege_policy_digest,
    planned_min_pairs:row.planned_min_pairs,planned_max_pairs:row.planned_max_pairs,
    external_library_owner:true,external_statistical_owner:true,external_scope_owner:true,authored_by_candidate:false,
  });
  if(canonical.plan_digest!==exactDigest(row.plan_digest,'plan'))throw new Error('rsi_phase34_plan_digest_mismatch');
  return canonical;
}

export function createRsiLeastPrivilegeSkillScopeReceipt({
  scope_receipt_id,plan,plan_args,phase33_review,phase33_args,current_governance,
  observed_required_capabilities,replay_task_family_digests,scope_validation_evidence_digest,
  replay_all_pass=false,no_overprivileged_actions=false,no_hidden_capability_escalation=false,
  external_scope_owner=false,external_replay_evaluator=false,authored_by_candidate=true,
}={}){
  if(external_scope_owner!==true||external_replay_evaluator!==true||authored_by_candidate!==false){
    throw new Error('rsi_phase34_external_scope_evaluation_required');
  }
  const checkedPlan=verifyRsiAnytimeValidLibraryAdmissionPlan(plan,{...plan_args,phase33_review,phase33_args,current_governance});
  const p33=phase33({phase33_review,phase33_args});
  const observed=capabilities(observed_required_capabilities);
  const declared=Object.freeze([...p33.skill.capabilities].sort());
  const overdeclared=declared.filter(x=>!observed.includes(x));
  const undeclared=observed.filter(x=>!declared.includes(x));
  const taskFamilies=digestList(replay_task_family_digests,'replay_task_family',{min:2,max:64});
  const exactCapabilitySet=sameArray(declared,observed);
  const pass=replay_all_pass===true&&no_overprivileged_actions===true&&no_hidden_capability_escalation===true&&exactCapabilitySet;
  const core=zero({
    schema:RSI_LEAST_PRIVILEGE_SKILL_SCOPE_RECEIPT_SCHEMA,version:1,
    scope_receipt_id:id(scope_receipt_id,'scope_receipt_id'),source_sha:checkedPlan.source_sha,
    plan_digest:checkedPlan.plan_digest,phase33_review_digest:checkedPlan.phase33_review_digest,
    proposed_skill_digest:checkedPlan.proposed_skill_digest,scope_root_digest:checkedPlan.scope_root_digest,
    declared_capabilities:declared,observed_required_capabilities:observed,
    overdeclared_capabilities:Object.freeze(overdeclared),undeclared_capabilities:Object.freeze(undeclared),
    replay_task_family_digests:taskFamilies,replay_task_family_count:taskFamilies.length,
    scope_validation_evidence_digest:exactDigest(scope_validation_evidence_digest,'scope_validation_evidence'),
    replay_all_pass:replay_all_pass===true,no_overprivileged_actions:no_overprivileged_actions===true,
    no_hidden_capability_escalation:no_hidden_capability_escalation===true,exact_capability_set_pass:exactCapabilitySet,
    least_privilege_pass:pass,task_conditioned_scope_validation_required:true,cross_task_replay_required:true,
    semantic_similarity_is_scope_authority:false,model_claim_is_scope_authority:false,
    external_scope_owner:true,external_replay_evaluator:true,authored_by_candidate:false,
    scope_receipt_can_expand_capabilities:false,scope_receipt_can_activate_skill:false,scope_receipt_can_write_library:false,
  });
  return Object.freeze({...core,scope_receipt_digest:digest(core)});
}

export function verifyRsiLeastPrivilegeSkillScopeReceipt(row,args={}){
  if(!plain(row)||row.schema!==RSI_LEAST_PRIVILEGE_SKILL_SCOPE_RECEIPT_SCHEMA||row.version!==1)throw new Error('rsi_phase34_scope_receipt_invalid');
  assertZero(row,'scope_receipt');
  if(row.task_conditioned_scope_validation_required!==true||row.cross_task_replay_required!==true
    ||row.semantic_similarity_is_scope_authority!==false||row.model_claim_is_scope_authority!==false
    ||row.external_scope_owner!==true||row.external_replay_evaluator!==true||row.authored_by_candidate!==false
    ||row.scope_receipt_can_expand_capabilities!==false||row.scope_receipt_can_activate_skill!==false
    ||row.scope_receipt_can_write_library!==false)throw new Error('rsi_phase34_scope_receipt_policy_invalid');
  const canonical=createRsiLeastPrivilegeSkillScopeReceipt({
    scope_receipt_id:row.scope_receipt_id,...args,observed_required_capabilities:row.observed_required_capabilities,
    replay_task_family_digests:row.replay_task_family_digests,scope_validation_evidence_digest:row.scope_validation_evidence_digest,
    replay_all_pass:row.replay_all_pass,no_overprivileged_actions:row.no_overprivileged_actions,
    no_hidden_capability_escalation:row.no_hidden_capability_escalation,
    external_scope_owner:true,external_replay_evaluator:true,authored_by_candidate:false,
  });
  if(canonical.scope_receipt_digest!==exactDigest(row.scope_receipt_digest,'scope_receipt'))throw new Error('rsi_phase34_scope_receipt_digest_mismatch');
  return canonical;
}

export function createRsiAnytimeValidLibraryAdmissionCertificate({
  certificate_id,plan,plan_args,phase33_review,phase33_args,current_governance,
  scope_receipt,paired_sequence_digest,reference_receipt_digest,candidate_receipt_digest,
  statistical_owner_attestation_digest,observed_pair_count,stopping_index,final_e_value,
  same_instances_pass=false,matched_reference_pass=false,evaluator_integrity_pass=false,contamination_clear=false,
  hard_invariants_pass=false,negative_transfer_detected=true,optional_stopping_protocol_pass=false,
  external_statistical_owner=false,external_library_owner=false,authored_by_candidate=true,
}={}){
  if(external_statistical_owner!==true||external_library_owner!==true||authored_by_candidate!==false){
    throw new Error('rsi_phase34_external_certificate_owners_required');
  }
  const checkedPlan=verifyRsiAnytimeValidLibraryAdmissionPlan(plan,{...plan_args,phase33_review,phase33_args,current_governance});
  const checkedScope=verifyRsiLeastPrivilegeSkillScopeReceipt(scope_receipt,{
    plan:checkedPlan,plan_args,phase33_review,phase33_args,current_governance,
  });
  const pairs=positiveInt(observed_pair_count,'observed_pair_count',checkedPlan.planned_max_pairs);
  const stop=positiveInt(stopping_index,'stopping_index',checkedPlan.planned_max_pairs);
  if(pairs!==stop||pairs<checkedPlan.planned_min_pairs||pairs>checkedPlan.planned_max_pairs){
    throw new Error('rsi_phase34_observed_pair_budget_invalid');
  }
  const eValue=finite(final_e_value,'final_e_value');
  if(eValue<0)throw new Error('rsi_phase34_evalue_negative');
  const roots=[
    exactDigest(paired_sequence_digest,'paired_sequence'),exactDigest(reference_receipt_digest,'reference_receipt'),
    exactDigest(candidate_receipt_digest,'candidate_receipt'),exactDigest(statistical_owner_attestation_digest,'statistical_owner_attestation'),
    checkedPlan.paired_instance_set_digest,checkedPlan.eprocess_protocol_digest,checkedScope.scope_receipt_digest,
  ];
  if(new Set(roots).size!==roots.length)throw new Error('rsi_phase34_certificate_roots_not_independent');
  const negative=negative_transfer_detected===true;
  const structuralPass=same_instances_pass===true&&matched_reference_pass===true&&evaluator_integrity_pass===true
    &&contamination_clear===true&&hard_invariants_pass===true&&optional_stopping_protocol_pass===true&&checkedScope.least_privilege_pass===true;
  const thresholdPass=eValue+Number.EPSILON>=checkedPlan.anytime_valid_evalue_threshold;
  const state=negative?'NEGATIVE_TRANSFER_VETO'
    :!structuralPass?'ADMISSION_REJECTED'
    :thresholdPass?'ELIGIBLE_FOR_EXISTING_LIBRARY_OWNER_APPEND_REVIEW':'INSUFFICIENT_EVIDENCE';
  const core=zero({
    schema:RSI_ANYTIME_VALID_LIBRARY_ADMISSION_CERTIFICATE_SCHEMA,version:1,
    certificate_id:id(certificate_id,'certificate_id'),source_sha:checkedPlan.source_sha,
    plan_digest:checkedPlan.plan_digest,phase33_review_digest:checkedPlan.phase33_review_digest,
    proposed_skill_digest:checkedPlan.proposed_skill_digest,current_library_digest:checkedPlan.current_library_digest,
    current_governance_digest:checkedPlan.current_governance_digest,scope_receipt_digest:checkedScope.scope_receipt_digest,
    false_admission_alpha:checkedPlan.false_admission_alpha,anytime_valid_evalue_threshold:checkedPlan.anytime_valid_evalue_threshold,
    paired_sequence_digest:roots[0],reference_receipt_digest:roots[1],candidate_receipt_digest:roots[2],
    statistical_owner_attestation_digest:roots[3],observed_pair_count:pairs,stopping_index:stop,final_e_value:eValue,
    same_instances_pass:same_instances_pass===true,matched_reference_pass:matched_reference_pass===true,
    evaluator_integrity_pass:evaluator_integrity_pass===true,contamination_clear:contamination_clear===true,
    hard_invariants_pass:hard_invariants_pass===true,negative_transfer_detected:negative,
    optional_stopping_protocol_pass:optional_stopping_protocol_pass===true,least_privilege_pass:checkedScope.least_privilege_pass===true,
    threshold_pass:thresholdPass,state,
    eligible_for_existing_library_owner_append_review:state==='ELIGIBLE_FOR_EXISTING_LIBRARY_OWNER_APPEND_REVIEW',
    insufficient_evidence:state==='INSUFFICIENT_EVIDENCE',negative_transfer_veto:state==='NEGATIVE_TRANSFER_VETO',
    external_statistical_owner:true,external_library_owner:true,authored_by_candidate:false,
    candidate_can_self_certify:false,candidate_can_choose_stopping_time:false,candidate_can_relax_threshold:false,
    library_append_performed:false,skill_activation_performed:false,governance_mutation_performed:false,
    skill_retirement_performed:false,skill_quarantine_performed:false,library_admission_token:null,
  });
  return Object.freeze({...core,certificate_digest:digest(core)});
}

export function verifyRsiAnytimeValidLibraryAdmissionCertificate(row,args={}){
  if(!plain(row)||row.schema!==RSI_ANYTIME_VALID_LIBRARY_ADMISSION_CERTIFICATE_SCHEMA||row.version!==1)throw new Error('rsi_phase34_certificate_invalid');
  assertZero(row,'certificate');
  if(row.external_statistical_owner!==true||row.external_library_owner!==true||row.authored_by_candidate!==false
    ||row.candidate_can_self_certify!==false||row.candidate_can_choose_stopping_time!==false||row.candidate_can_relax_threshold!==false
    ||row.library_append_performed!==false||row.skill_activation_performed!==false||row.governance_mutation_performed!==false
    ||row.skill_retirement_performed!==false||row.skill_quarantine_performed!==false||row.library_admission_token!==null){
    throw new Error('rsi_phase34_certificate_policy_invalid');
  }
  const canonical=createRsiAnytimeValidLibraryAdmissionCertificate({
    certificate_id:row.certificate_id,...args,paired_sequence_digest:row.paired_sequence_digest,
    reference_receipt_digest:row.reference_receipt_digest,candidate_receipt_digest:row.candidate_receipt_digest,
    statistical_owner_attestation_digest:row.statistical_owner_attestation_digest,
    observed_pair_count:row.observed_pair_count,stopping_index:row.stopping_index,final_e_value:row.final_e_value,
    same_instances_pass:row.same_instances_pass,matched_reference_pass:row.matched_reference_pass,
    evaluator_integrity_pass:row.evaluator_integrity_pass,contamination_clear:row.contamination_clear,
    hard_invariants_pass:row.hard_invariants_pass,negative_transfer_detected:row.negative_transfer_detected,
    optional_stopping_protocol_pass:row.optional_stopping_protocol_pass,
    external_statistical_owner:true,external_library_owner:true,authored_by_candidate:false,
  });
  if(canonical.certificate_digest!==exactDigest(row.certificate_digest,'certificate'))throw new Error('rsi_phase34_certificate_digest_mismatch');
  return canonical;
}

export function createRsiExistingGovernanceActionReview({
  review_id,library,governance,skill_digest,trigger_evidence_digest,external_library_owner=false,authored_by_candidate=true,
}={}){
  if(external_library_owner!==true||authored_by_candidate!==false)throw new Error('rsi_phase34_governance_action_external_owner_required');
  const checkedLibrary=verifyRsiVerifiedSkillLibrary(library);
  const checkedGovernance=verifyRsiSkillLibraryGovernance(governance,checkedLibrary);
  const skill=exactDigest(skill_digest,'governance_action_skill');
  const row=checkedGovernance.entries.find(e=>e.skill_digest===skill);
  if(!row)throw new Error('rsi_phase34_governance_action_skill_unknown');
  if(row.state!=='QUARANTINED'&&row.state!=='RETIRED')throw new Error('rsi_phase34_governance_action_terminal_state_required');
  const action=row.state==='QUARANTINED'?'EXTERNAL_QUARANTINE_REVIEW':'EXTERNAL_RETIREMENT_REVIEW';
  const core=zero({
    schema:RSI_EXISTING_GOVERNANCE_ACTION_REVIEW_SCHEMA,version:1,review_id:id(review_id,'governance_action_review_id'),
    library_id:checkedLibrary.library_id,library_digest:checkedLibrary.library_digest,
    governance_digest:checkedGovernance.governance_digest,skill_digest:skill,governance_state:row.state,
    trigger_evidence_digest:exactDigest(trigger_evidence_digest,'governance_action_trigger'),review_action:action,
    external_library_owner:true,authored_by_candidate:false,existing_governance_state_is_source_of_truth:true,
    quarantine_performed:false,retirement_performed:false,reactivation_performed:false,hard_delete_performed:false,
    skill_remains_auditable:true,review_token:null,
  });
  return Object.freeze({...core,review_digest:digest(core)});
}

export function verifyRsiExistingGovernanceActionReview(row,{library,governance}={}){
  if(!plain(row)||row.schema!==RSI_EXISTING_GOVERNANCE_ACTION_REVIEW_SCHEMA||row.version!==1)throw new Error('rsi_phase34_governance_action_review_invalid');
  assertZero(row,'governance_action_review');
  if(row.external_library_owner!==true||row.authored_by_candidate!==false||row.existing_governance_state_is_source_of_truth!==true
    ||row.quarantine_performed!==false||row.retirement_performed!==false||row.reactivation_performed!==false
    ||row.hard_delete_performed!==false||row.skill_remains_auditable!==true||row.review_token!==null){
    throw new Error('rsi_phase34_governance_action_review_policy_invalid');
  }
  const canonical=createRsiExistingGovernanceActionReview({
    review_id:row.review_id,library,governance,skill_digest:row.skill_digest,
    trigger_evidence_digest:row.trigger_evidence_digest,external_library_owner:true,authored_by_candidate:false,
  });
  if(canonical.review_digest!==exactDigest(row.review_digest,'governance_action_review'))throw new Error('rsi_phase34_governance_action_review_digest_mismatch');
  return canonical;
}

function archiveState(sourceSha,rows){
  const counts={};for(const row of rows)counts[row.certificate.state]=(counts[row.certificate.state]||0)+1;
  const core=zero({
    schema:RSI_ANYTIME_VALID_LIBRARY_ADMISSION_ARCHIVE_SCHEMA,version:1,source_sha:sourceSha,
    rows,row_count:rows.length,state_counts:Object.freeze(counts),append_only:true,durable_before_visible:true,
    external_phase33_evidence_resolver_required:true,phase33_evidence_bodies_not_duplicated:true,
    insufficient_and_negative_evidence_preserved:true,archive_can_write_library:false,archive_can_activate_skill:false,
    archive_can_mutate_governance:false,archive_can_quarantine_skill:false,archive_can_retire_skill:false,
  });return {...core,state_digest:digest(core)};
}

export class RsiAnytimeValidLibraryAdmissionArchive{
  #path;#sourceSha;#resolver;#rows=[];#initialized=false;
  constructor({statePath,source_sha,evidenceResolver}={}){
    if(!statePath)throw new Error('rsi_phase34_archive_path_required');
    if(typeof evidenceResolver!=='function')throw new Error('rsi_phase34_archive_evidence_resolver_required');
    this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'archive_source');this.#resolver=evidenceResolver;
  }
  async #canonical(stored){
    const evidence=await this.#resolver({phase33_review_digest:stored.plan.phase33_review_digest});
    if(!plain(evidence))throw new Error('rsi_phase34_archive_external_evidence_missing');
    const plan=verifyRsiAnytimeValidLibraryAdmissionPlan(stored.plan,evidence);
    const scope=verifyRsiLeastPrivilegeSkillScopeReceipt(stored.scope_receipt,{
      plan,plan_args:evidence,phase33_review:evidence.phase33_review,phase33_args:evidence.phase33_args,current_governance:evidence.current_governance,
    });
    const certificate=verifyRsiAnytimeValidLibraryAdmissionCertificate(stored.certificate,{
      plan,plan_args:evidence,phase33_review:evidence.phase33_review,phase33_args:evidence.phase33_args,current_governance:evidence.current_governance,scope_receipt:scope,
    });
    return Object.freeze({plan,scope_receipt:scope,certificate});
  }
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const p=JSON.parse(await fs.readFile(this.#path,'utf8'));assertZero(p,'archive');
      if(p.schema!==RSI_ANYTIME_VALID_LIBRARY_ADMISSION_ARCHIVE_SCHEMA||p.version!==1||p.source_sha!==this.#sourceSha
        ||p.append_only!==true||p.durable_before_visible!==true||p.external_phase33_evidence_resolver_required!==true
        ||p.phase33_evidence_bodies_not_duplicated!==true||p.insufficient_and_negative_evidence_preserved!==true
        ||p.archive_can_write_library!==false||p.archive_can_activate_skill!==false||p.archive_can_mutate_governance!==false
        ||p.archive_can_quarantine_skill!==false||p.archive_can_retire_skill!==false)throw new Error('rsi_phase34_archive_policy_invalid');
      const clone=structuredClone(p);delete clone.state_digest;
      if(digest(clone)!==exactDigest(p.state_digest,'archive'))throw new Error('rsi_phase34_archive_digest_mismatch');
      if(!Array.isArray(p.rows)||p.rows.length>MAX_ROWS)throw new Error('rsi_phase34_archive_rows_invalid');
      const checked=[];const plans=new Set(),certs=new Set();
      for(const stored of p.rows){
        const row=await this.#canonical(stored);
        if(row.plan.source_sha!==this.#sourceSha)throw new Error('rsi_phase34_archive_source_mismatch');
        if(plans.has(row.plan.plan_id)||certs.has(row.certificate.certificate_id))throw new Error('rsi_phase34_archive_duplicate');
        plans.add(row.plan.plan_id);certs.add(row.certificate.certificate_id);checked.push(row);
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
  async add({plan,scope_receipt,certificate,evidence}={}){
    if(!this.#initialized)throw new Error('rsi_phase34_archive_not_initialized');
    const canonical=await this.#canonical({plan,scope_receipt,certificate});
    if(canonical.plan.source_sha!==this.#sourceSha)throw new Error('rsi_phase34_archive_source_mismatch');
    const existing=this.#rows.find(r=>r.plan.plan_id===canonical.plan.plan_id||r.certificate.certificate_id===canonical.certificate.certificate_id);
    if(existing){
      if(existing.plan.plan_digest!==canonical.plan.plan_digest||existing.certificate.certificate_digest!==canonical.certificate.certificate_digest)throw new Error('rsi_phase34_archive_identity_conflict');
      return zero({state:'IDEMPOTENT',certificate_state:canonical.certificate.state,certificate_digest:canonical.certificate.certificate_digest});
    }
    if(this.#rows.length>=MAX_ROWS)throw new Error('rsi_phase34_archive_capacity_exceeded');
    const next=[...this.#rows,canonical];await this.#persist(next);this.#rows=next;
    return zero({state:'ADMISSION_EVIDENCE_ARCHIVED',certificate_state:canonical.certificate.state,certificate_digest:canonical.certificate.certificate_digest});
  }
  snapshot(){const s=archiveState(this.#sourceSha,this.#rows);return Object.freeze({schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,row_count:s.row_count,state_counts:s.state_counts,append_only:true,durable_before_visible:true,external_phase33_evidence_resolver_required:true,phase33_evidence_bodies_not_duplicated:true,insufficient_and_negative_evidence_preserved:true,archive_can_write_library:false,archive_can_activate_skill:false,archive_can_mutate_governance:false,archive_can_quarantine_skill:false,archive_can_retire_skill:false,authority_effect:false});}
}

export function rsiAnytimeValidLibraryAdmissionTrustRootSnapshot(){
  const governanceRoot=rsiSkillLibraryGovernanceTrustRootSnapshot();
  const scopeRoot=rsiSkillScopeExpansionTrustRootSnapshot();
  const root={
    schema:'metaengine.rsi.anytime-valid-library-admission-root.v1',version:1,
    existing_verified_skill_library_reused:true,existing_skill_library_governance_reused:true,
    existing_governance_root_digest:governanceRoot.governance_root_digest,
    existing_scope_root_digest:scopeRoot.scope_root_digest,
    phase33_existing_consumer_owner_review_required:true,paired_identical_instance_validation_required:true,
    matched_no_skill_or_incumbent_reference_required:true,anytime_valid_certificate_required:true,
    externally_owned_false_admission_error_budget_required:true,optional_stopping_only_via_fixed_anytime_valid_protocol:true,
    insufficient_evidence_is_first_class:true,negative_transfer_is_hard_veto:true,task_conditioned_least_privilege_replay_required:true,
    exact_capability_set_required:true,maturity_aware_change_envelope_required:true,
    terminal_parent_requires_separate_repair_review:true,quarantine_and_retirement_use_existing_governance_state:true,
    rejected_insufficient_and_negative_evidence_preserved:true,no_second_library:true,no_second_governance_plane:true,
    library_append_performed_here:false,skill_activation_performed_here:false,governance_mutation_performed_here:false,
    skill_quarantine_performed_here:false,skill_retirement_performed_here:false,meta_skill_profile_mutated_here:false,
    candidate_can_choose_statistical_gate:false,candidate_can_choose_scope_policy:false,no_blind_retry:true,
    execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,
    promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };return Object.freeze({...root,anytime_valid_library_admission_root_digest:digest(root)});
}
