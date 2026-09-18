import crypto from 'node:crypto';

import {
  createRsiVerifiedSkillLibrary,
  verifyRsiVerifiedSkillLibrary,
  verifyRsiSkillCapsule,
  verifyRsiSkillEvidence,
} from './rsi-verified-skill-library.mjs';
import { verifyRsiExactSkillPrecommitCertificate } from './rsi-exact-existing-consumer-owner-review.mjs';

export const RSI_EXTERNAL_SKILL_LIBRARY_ADMISSION_PLAN_SCHEMA='metaengine.rsi.external-skill-library-admission-plan.v1';

const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map((k)=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function id(v,label){const out=String(v||'').trim();if(!SAFE_ID_RE.test(out))throw new Error(`rsi_phase34_${label}_invalid`);return out}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,direct_tool_execution_authority:false,automatic_retry_allowed:false,authority_effect:false})}

export function createRsiExternalSkillLibraryAdmissionPlan({
  plan_id,
  phase33_certificate,
  phase33_certificate_args,
  current_library,
  skill_capsule,
  standard_skill_evidence,
  external_library_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_library_owner!==true||authored_by_candidate!==false)throw new Error('rsi_phase34_external_library_owner_required');
  const certificate=verifyRsiExactSkillPrecommitCertificate(phase33_certificate,phase33_certificate_args||{});
  if(certificate.state!=='ELIGIBLE_FOR_EXISTING_LIBRARY_OWNER_ADMISSION_REVIEW'||certificate.blockers.length!==0||certificate.anytime_valid_acceptance_pass!==true)throw new Error('rsi_phase34_phase33_certificate_not_eligible');
  const library=verifyRsiVerifiedSkillLibrary(current_library);
  const skill=verifyRsiSkillCapsule(skill_capsule);
  const evidence=verifyRsiSkillEvidence(standard_skill_evidence,skill);

  if(certificate.current_library_digest!==library.library_digest)throw new Error('rsi_phase34_current_library_drift');
  if(certificate.proposed_skill_digest!==skill.skill_digest)throw new Error('rsi_phase34_skill_digest_mismatch');
  if(certificate.standard_skill_evidence_digest!==evidence.evidence_digest)throw new Error('rsi_phase34_standard_evidence_digest_mismatch');
  if(certificate.source_sha!==skill.source_candidate_sha||evidence.source_candidate_sha!==certificate.source_sha)throw new Error('rsi_phase34_source_sha_mismatch');
  if(evidence.verified_for_library!==true||evidence.hard_invariants_pass!==true)throw new Error('rsi_phase34_unverified_standard_evidence');
  if(library.entries.some((entry)=>entry.skill_digest===skill.skill_digest))throw new Error('rsi_phase34_skill_already_present');

  const successor=createRsiVerifiedSkillLibrary({
    library_id:library.library_id,
    entries:[
      ...library.entries.map((entry)=>({capsule:entry.capsule,evidence:entry.evidence})),
      {capsule:skill,evidence},
    ],
    external_library_owner:true,
    authored_by_candidate:false,
  });
  if(successor.entry_count!==library.entry_count+1)throw new Error('rsi_phase34_exactly_one_append_required');
  const added=successor.entries.filter((entry)=>!library.entries.some((prior)=>prior.skill_digest===entry.skill_digest));
  if(added.length!==1||added[0].skill_digest!==skill.skill_digest||added[0].evidence_digest!==evidence.evidence_digest)throw new Error('rsi_phase34_exactly_one_bound_entry_required');

  const core=zero({
    schema:RSI_EXTERNAL_SKILL_LIBRARY_ADMISSION_PLAN_SCHEMA,
    version:1,
    plan_id:id(plan_id,'plan_id'),
    source_sha:certificate.source_sha,
    phase33_certificate_digest:certificate.certificate_digest,
    phase33_skill_evidence_review_digest:certificate.phase32_skill_evidence_review_digest,
    consumer_evaluation_contract_digest:certificate.consumer_evaluation_contract_digest,
    anytime_valid_certificate_digest:certificate.anytime_valid_certificate_digest,
    false_admission_error_budget_policy_digest:certificate.false_admission_error_budget_policy_digest,
    current_library_id:library.library_id,
    expected_current_library_digest:library.library_digest,
    successor_library_digest:successor.library_digest,
    current_entry_count:library.entry_count,
    successor_entry_count:successor.entry_count,
    proposed_skill_digest:skill.skill_digest,
    standard_skill_evidence_digest:evidence.evidence_digest,
    successor_library:successor,
    storage_admission_only:true,
    exactly_one_append_required:true,
    exact_library_cas_required:true,
    write_ahead_attempt_required:true,
    post_effect_readback_required:true,
    one_attempt_only:true,
    zero_evidence_skill_must_remain_dormant:true,
    append_does_not_imply_retrieval_exposure:true,
    direct_library_append_performed:false,
    retrieval_exposure_changed:false,
    skill_activation_performed:false,
    lifecycle_evidence_written:false,
    meta_skill_profile_mutated:false,
    browser_effect_performed:false,
    candidate_can_execute_admission:false,
    external_library_owner:true,
    authored_by_candidate:false,
  });
  return Object.freeze({...core,plan_digest:digest(core)});
}

export function verifyRsiExternalSkillLibraryAdmissionPlan(plan,args={}){
  if(!plan||plan.schema!==RSI_EXTERNAL_SKILL_LIBRARY_ADMISSION_PLAN_SCHEMA||plan.version!==1)throw new Error('rsi_phase34_admission_plan_invalid');
  if(plan.storage_admission_only!==true||plan.exactly_one_append_required!==true||plan.exact_library_cas_required!==true||plan.write_ahead_attempt_required!==true||plan.post_effect_readback_required!==true||plan.one_attempt_only!==true||plan.zero_evidence_skill_must_remain_dormant!==true||plan.append_does_not_imply_retrieval_exposure!==true||plan.direct_library_append_performed!==false||plan.retrieval_exposure_changed!==false||plan.skill_activation_performed!==false||plan.lifecycle_evidence_written!==false||plan.meta_skill_profile_mutated!==false||plan.browser_effect_performed!==false||plan.candidate_can_execute_admission!==false||plan.external_library_owner!==true||plan.authored_by_candidate!==false||plan.execution_authority!==false||plan.production_mutation_authority!==false||plan.promotion_authority!==false||plan.self_update_authority!==false||plan.scheduler_authority!==false||plan.direct_tool_execution_authority!==false||plan.automatic_retry_allowed!==false||plan.authority_effect!==false)throw new Error('rsi_phase34_admission_plan_policy_invalid');
  const canonical=createRsiExternalSkillLibraryAdmissionPlan({...args,plan_id:plan.plan_id,external_library_owner:true,authored_by_candidate:false});
  if(canonical.plan_digest!==plan.plan_digest)throw new Error('rsi_phase34_admission_plan_digest_mismatch');
  if(canonical.successor_library_digest!==plan.successor_library_digest)throw new Error('rsi_phase34_admission_plan_successor_mismatch');
  return canonical;
}

export function rsiExternalSkillLibraryAdmissionTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.external-skill-library-admission-root.v1',
    version:1,
    actual_phase33_certificate_required:true,
    eligible_phase33_certificate_only:true,
    actual_standard_skill_evidence_required:true,
    exact_current_library_binding_required:true,
    exactly_one_append_required:true,
    existing_verified_skill_library_reused:true,
    second_skill_library_allowed:false,
    exact_library_cas_required:true,
    write_ahead_attempt_required:true,
    one_attempt_only:true,
    post_effect_readback_required:true,
    zero_evidence_skill_must_remain_dormant:true,
    append_does_not_imply_retrieval_exposure:true,
    direct_library_append_performed_here:false,
    direct_retrieval_exposure_change:false,
    direct_skill_activation:false,
    direct_lifecycle_evidence_write:false,
    direct_meta_skill_mutation:false,
    direct_browser_effect:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,admission_root_digest:digest(root)});
}
