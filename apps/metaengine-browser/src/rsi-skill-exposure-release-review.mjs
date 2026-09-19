import crypto from 'node:crypto';

import { verifyRsiVerifiedSkillLibrary } from './rsi-verified-skill-library.mjs';
import { verifyRsiSkillLibraryGovernance } from './rsi-skill-library-governance.mjs';

export const RSI_SKILL_EXPOSURE_RELEASE_REVIEW_SCHEMA='metaengine.rsi.skill-exposure-release-review.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE=/^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
}
function digest(value){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;}
function exactSha(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA40_RE.test(out))throw new Error(`rsi_exposure_review_${label}_sha_invalid`);return out;}
function exactDigest(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA256_RE.test(out))throw new Error(`rsi_exposure_review_${label}_digest_invalid`);return out;}
function boundedId(value,label){const out=String(value||'').trim();if(!SAFE_ID_RE.test(out))throw new Error(`rsi_exposure_review_${label}_invalid`);return out;}
function token(value,label){const out=String(value||'').trim().toUpperCase();if(!SAFE_TOKEN_RE.test(out))throw new Error(`rsi_exposure_review_${label}_invalid`);return out;}
function positiveInt(value,label,max=1000000){const out=Number(value);if(!Number.isSafeInteger(out)||out<1||out>max)throw new Error(`rsi_exposure_review_${label}_invalid`);return out;}
function nonNegativeInt(value,label,max=1000000){const out=Number(value);if(!Number.isSafeInteger(out)||out<0||out>max)throw new Error(`rsi_exposure_review_${label}_invalid`);return out;}
function zero(extra={}){
  return Object.freeze({
    ...extra,
    execution_authority:false,
    browser_authority:false,
    task_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  });
}
function assertZero(row,label){
  for(const field of ['execution_authority','browser_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','signing_authority','direct_tool_execution_authority','authority_effect']){
    if(row?.[field]!==false)throw new Error(`rsi_exposure_review_${label}_${field}_invalid`);
  }
  if(row?.automatic_retry_allowed!==false)throw new Error(`rsi_exposure_review_${label}_automatic_retry_invalid`);
}

function heldEntry(governance,skillDigest){
  const entry=governance.entries.find(row=>row.skill_digest===skillDigest);
  if(!entry)throw new Error('rsi_exposure_review_skill_not_in_governance');
  if(!Array.isArray(governance.admission_exposure_hold_skill_digests)
    ||!governance.admission_exposure_hold_skill_digests.includes(skillDigest)
    ||entry.admission_exposure_hold!==true
    ||entry.state!=='DORMANT_CAP'
    ||entry.active_for_composition!==false){
    throw new Error('rsi_exposure_review_exact_exposure_hold_required');
  }
  return entry;
}
function verifyAdmissionProvenance(provenance,{library,governance,skillDigest}){
  if(!provenance||provenance.schema!=='metaengine.rsi.admission-exposure-hold-provenance.v1'||provenance.version!==1){
    throw new Error('rsi_exposure_review_confirmed_admission_provenance_required');
  }
  assertZero(provenance,'admission_provenance');
  if(provenance.release_authority!==false||provenance.retrieval_exposure_allowed!==false
    ||provenance.exposure_hold_observed!==true||provenance.dormant_cap_observed!==true
    ||provenance.active_for_composition!==false||provenance.admission_state!=='CONFIRMED_APPLIED_STORAGE_ONLY'){
    throw new Error('rsi_exposure_review_admission_provenance_policy_invalid');
  }
  if(exactDigest(provenance.skill_digest,'admission_provenance_skill')!==skillDigest
    ||exactDigest(provenance.current_library_digest,'admission_provenance_library')!==library.library_digest
    ||exactDigest(provenance.current_governance_digest,'admission_provenance_governance')!==governance.governance_digest){
    throw new Error('rsi_exposure_review_admission_provenance_binding_mismatch');
  }
  exactDigest(provenance.admission_certificate_digest,'admission_provenance_certificate');
  exactDigest(provenance.effect_id_digest,'admission_provenance_effect_id');
  exactDigest(provenance.admitted_successor_library_digest,'admission_provenance_successor_library');
  exactDigest(provenance.confirmed_transition_digest,'admission_provenance_transition');
  boundedId(provenance.admission_attempt_id,'admission_provenance_attempt');
  const clone=structuredClone(provenance);delete clone.provenance_digest;
  if(digest(clone)!==exactDigest(provenance.provenance_digest,'admission_provenance')){
    throw new Error('rsi_exposure_review_admission_provenance_digest_mismatch');
  }
  return provenance;
}


export function createRsiSkillExposureReleaseReview({
  review_id,
  source_sha,
  library,
  current_governance,
  admission_provenance,
  skill_digest,
  consumer_model_family,
  environment_fingerprint,
  task_signature_digest,
  routing_context_manifest_digest,
  retrieval_profile_digest,
  memory_context_digest,
  harness_integrity_digest,
  benchmark_provenance_digest,
  matched_comparison_receipt_digest,
  negative_transfer_receipt_digest,
  cost_latency_receipt_digest,
  source_grounding_receipt_digest,
  external_policy_digest,
  matched_pair_count,
  skill_success_count,
  reference_success_count,
  repair_count,
  regression_count,
  hard_invariant_failure_count,
  negative_transfer_count,
  cost_budget_pass,
  latency_budget_pass,
  harness_integrity_pass,
  benchmark_provenance_pass,
  memory_safety_pass,
  source_grounding_pass,
  governance_reviewer_identity_digest,
  matched_evaluator_identity_digest,
  security_reviewer_identity_digest,
  external_governance_reviewer=false,
  external_matched_evaluator=false,
  external_security_reviewer=false,
  authored_by_candidate=true,
}={}){
  const sourceSha=exactSha(source_sha,'source');
  const checkedLibrary=verifyRsiVerifiedSkillLibrary(library);
  const checkedGovernance=verifyRsiSkillLibraryGovernance(current_governance,checkedLibrary);
  const skillDigest=exactDigest(skill_digest,'skill');
  heldEntry(checkedGovernance,skillDigest);
  const confirmedAdmission=verifyAdmissionProvenance(admission_provenance,{library:checkedLibrary,governance:checkedGovernance,skillDigest});

  if(external_governance_reviewer!==true||external_matched_evaluator!==true||external_security_reviewer!==true||authored_by_candidate!==false){
    throw new Error('rsi_exposure_review_external_ownership_required');
  }
  const reviewerIdentities=[
    exactDigest(governance_reviewer_identity_digest,'governance_reviewer_identity'),
    exactDigest(matched_evaluator_identity_digest,'matched_evaluator_identity'),
    exactDigest(security_reviewer_identity_digest,'security_reviewer_identity'),
  ];
  if(new Set(reviewerIdentities).size!==reviewerIdentities.length)throw new Error('rsi_exposure_review_separation_of_duties_required');

  const pairCount=positiveInt(matched_pair_count,'matched_pair_count',10000);
  const skillSuccess=nonNegativeInt(skill_success_count,'skill_success_count',pairCount);
  const referenceSuccess=nonNegativeInt(reference_success_count,'reference_success_count',pairCount);
  const repairs=nonNegativeInt(repair_count,'repair_count',pairCount);
  const regressions=nonNegativeInt(regression_count,'regression_count',pairCount);
  const hardFailures=nonNegativeInt(hard_invariant_failure_count,'hard_invariant_failure_count',pairCount);
  const negativeTransfer=nonNegativeInt(negative_transfer_count,'negative_transfer_count',pairCount);
  if(repairs+regressions>pairCount)throw new Error('rsi_exposure_review_pair_delta_count_invalid');
  if(skillSuccess-referenceSuccess!==repairs-regressions)throw new Error('rsi_exposure_review_paired_success_delta_mismatch');

  const blockers=[];
  if(pairCount<3)blockers.push('INSUFFICIENT_MATCHED_PAIRS');
  if(repairs<1||skillSuccess<=referenceSuccess)blockers.push('NO_VERIFIED_MATCHED_GAIN');
  if(regressions!==0)blockers.push('MATCHED_FUNCTIONAL_REGRESSION');
  if(hardFailures!==0)blockers.push('HARD_INVARIANT_FAILURE');
  if(negativeTransfer!==0)blockers.push('NEGATIVE_TRANSFER_PRESENT');
  if(cost_budget_pass!==true)blockers.push('COST_BUDGET_REGRESSION');
  if(latency_budget_pass!==true)blockers.push('LATENCY_BUDGET_REGRESSION');
  if(harness_integrity_pass!==true)blockers.push('HARNESS_INTEGRITY_FAILURE');
  if(benchmark_provenance_pass!==true)blockers.push('BENCHMARK_PROVENANCE_FAILURE');
  if(memory_safety_pass!==true)blockers.push('MEMORY_SAFETY_FAILURE');
  if(source_grounding_pass!==true)blockers.push('SOURCE_GROUNDING_FAILURE');
  const eligible=blockers.length===0;

  const core=zero({
    schema:RSI_SKILL_EXPOSURE_RELEASE_REVIEW_SCHEMA,
    version:1,
    review_id:boundedId(review_id,'review_id'),
    source_sha:sourceSha,
    library_id:checkedLibrary.library_id,
    library_digest:checkedLibrary.library_digest,
    current_governance_digest:checkedGovernance.governance_digest,
    admission_provenance_digest:confirmedAdmission.provenance_digest,
    admission_attempt_id:confirmedAdmission.admission_attempt_id,
    admission_certificate_digest:confirmedAdmission.admission_certificate_digest,
    confirmed_admission_transition_digest:confirmedAdmission.confirmed_transition_digest,
    skill_digest:skillDigest,
    consumer_model_family:token(consumer_model_family,'consumer_model_family'),
    environment_fingerprint:boundedId(environment_fingerprint,'environment_fingerprint'),
    task_signature_digest:exactDigest(task_signature_digest,'task_signature'),
    routing_context_manifest_digest:exactDigest(routing_context_manifest_digest,'routing_context_manifest'),
    retrieval_profile_digest:exactDigest(retrieval_profile_digest,'retrieval_profile'),
    memory_context_digest:exactDigest(memory_context_digest,'memory_context'),
    harness_integrity_digest:exactDigest(harness_integrity_digest,'harness_integrity'),
    benchmark_provenance_digest:exactDigest(benchmark_provenance_digest,'benchmark_provenance'),
    matched_comparison_receipt_digest:exactDigest(matched_comparison_receipt_digest,'matched_comparison_receipt'),
    negative_transfer_receipt_digest:exactDigest(negative_transfer_receipt_digest,'negative_transfer_receipt'),
    cost_latency_receipt_digest:exactDigest(cost_latency_receipt_digest,'cost_latency_receipt'),
    source_grounding_receipt_digest:exactDigest(source_grounding_receipt_digest,'source_grounding_receipt'),
    external_policy_digest:exactDigest(external_policy_digest,'external_policy'),
    matched_pair_count:pairCount,
    skill_success_count:skillSuccess,
    reference_success_count:referenceSuccess,
    repair_count:repairs,
    regression_count:regressions,
    hard_invariant_failure_count:hardFailures,
    negative_transfer_count:negativeTransfer,
    cost_budget_pass:cost_budget_pass===true,
    latency_budget_pass:latency_budget_pass===true,
    harness_integrity_pass:harness_integrity_pass===true,
    benchmark_provenance_pass:benchmark_provenance_pass===true,
    memory_safety_pass:memory_safety_pass===true,
    source_grounding_pass:source_grounding_pass===true,
    blockers:Object.freeze(blockers.sort()),
    state:eligible?'ELIGIBLE_FOR_EXTERNAL_EXPOSURE_RELEASE_REVIEW':'REJECTED_EXPOSURE_RELEASE_REVIEW',
    eligible_for_external_exposure_release_review:eligible,
    governance_reviewer_identity_digest:reviewerIdentities[0],
    matched_evaluator_identity_digest:reviewerIdentities[1],
    security_reviewer_identity_digest:reviewerIdentities[2],
    external_governance_reviewer:true,
    external_matched_evaluator:true,
    external_security_reviewer:true,
    authored_by_candidate:false,
    exact_consumer_scope_required:true,
    matched_same_instances_required:true,
    no_skill_or_matched_reference_required:true,
    negative_transfer_veto_required:true,
    cost_and_latency_veto_required:true,
    exposure_hold_required:true,
    confirmed_admission_provenance_required:true,
    storage_admission_is_not_exposure_authority:true,
    hold_release_effect_authorized:false,
    hold_release_effect_performed:false,
    retrieval_exposure_change_authorized:false,
    skill_activation_authorized:false,
    release_token:null,
  });
  return Object.freeze({...core,review_digest:digest(core)});
}

export function verifyRsiSkillExposureReleaseReview(review,args={}){
  if(!review||typeof review!=='object'||Array.isArray(review)||review.schema!==RSI_SKILL_EXPOSURE_RELEASE_REVIEW_SCHEMA||review.version!==1){
    throw new Error('rsi_exposure_review_invalid');
  }
  assertZero(review,'review');
  if(review.external_governance_reviewer!==true||review.external_matched_evaluator!==true||review.external_security_reviewer!==true
    ||review.authored_by_candidate!==false||review.exact_consumer_scope_required!==true||review.matched_same_instances_required!==true
    ||review.no_skill_or_matched_reference_required!==true||review.negative_transfer_veto_required!==true
    ||review.cost_and_latency_veto_required!==true||review.exposure_hold_required!==true
    ||review.confirmed_admission_provenance_required!==true
    ||review.storage_admission_is_not_exposure_authority!==true||review.hold_release_effect_authorized!==false
    ||review.hold_release_effect_performed!==false||review.retrieval_exposure_change_authorized!==false
    ||review.skill_activation_authorized!==false||review.release_token!==null){
    throw new Error('rsi_exposure_review_policy_invalid');
  }
  const canonical=createRsiSkillExposureReleaseReview({
    ...args,
    review_id:review.review_id,
    source_sha:review.source_sha,
    skill_digest:review.skill_digest,
    consumer_model_family:review.consumer_model_family,
    environment_fingerprint:review.environment_fingerprint,
    task_signature_digest:review.task_signature_digest,
    routing_context_manifest_digest:review.routing_context_manifest_digest,
    retrieval_profile_digest:review.retrieval_profile_digest,
    memory_context_digest:review.memory_context_digest,
    harness_integrity_digest:review.harness_integrity_digest,
    benchmark_provenance_digest:review.benchmark_provenance_digest,
    matched_comparison_receipt_digest:review.matched_comparison_receipt_digest,
    negative_transfer_receipt_digest:review.negative_transfer_receipt_digest,
    cost_latency_receipt_digest:review.cost_latency_receipt_digest,
    source_grounding_receipt_digest:review.source_grounding_receipt_digest,
    external_policy_digest:review.external_policy_digest,
    matched_pair_count:review.matched_pair_count,
    skill_success_count:review.skill_success_count,
    reference_success_count:review.reference_success_count,
    repair_count:review.repair_count,
    regression_count:review.regression_count,
    hard_invariant_failure_count:review.hard_invariant_failure_count,
    negative_transfer_count:review.negative_transfer_count,
    cost_budget_pass:review.cost_budget_pass,
    latency_budget_pass:review.latency_budget_pass,
    harness_integrity_pass:review.harness_integrity_pass,
    benchmark_provenance_pass:review.benchmark_provenance_pass,
    memory_safety_pass:review.memory_safety_pass,
    source_grounding_pass:review.source_grounding_pass,
    governance_reviewer_identity_digest:review.governance_reviewer_identity_digest,
    matched_evaluator_identity_digest:review.matched_evaluator_identity_digest,
    security_reviewer_identity_digest:review.security_reviewer_identity_digest,
    external_governance_reviewer:true,
    external_matched_evaluator:true,
    external_security_reviewer:true,
    authored_by_candidate:false,
  });
  if(canonical.review_digest!==exactDigest(review.review_digest,'review'))throw new Error('rsi_exposure_review_digest_mismatch');
  return canonical;
}

export function rsiSkillExposureReleaseReviewTrustRootSnapshot(){
  const root=zero({
    schema:'metaengine.rsi.skill-exposure-release-review-root.v1',
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-skill-exposure-release-review.mjs',
    exact_held_skill_required:true,
    exact_library_governance_binding_required:true,
    confirmed_admission_provenance_required:true,
    exact_consumer_scope_required:true,
    matched_same_instances_required:true,
    no_skill_or_matched_reference_required:true,
    positive_matched_gain_required:true,
    zero_matched_regressions_required:true,
    negative_transfer_veto_required:true,
    cost_and_latency_veto_required:true,
    harness_integrity_required:true,
    benchmark_provenance_required:true,
    memory_safety_required:true,
    source_grounding_required:true,
    reviewer_separation_of_duties_required:true,
    candidate_cannot_self_release:true,
    review_is_zero_effect:true,
    hold_release_effect_authorized:false,
    retrieval_exposure_change_authorized:false,
    skill_activation_authorized:false,
  });
  return Object.freeze({...root,review_root_digest:digest(root)});
}
