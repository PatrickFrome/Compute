import crypto from 'node:crypto';

import { verifyRsiVerifiedSkillLibrary } from './rsi-verified-skill-library.mjs';
import { verifyRsiSkillLibraryGovernance } from './rsi-skill-library-governance.mjs';

export const RSI_DORMANT_SKILL_RETRIEVAL_REVIEW_SCHEMA='metaengine.rsi.dormant-skill-retrieval-review.v1';

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
function exactSha(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA40_RE.test(out))throw new Error(`rsi_dormant_review_${label}_sha_invalid`);return out;}
function exactDigest(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA256_RE.test(out))throw new Error(`rsi_dormant_review_${label}_digest_invalid`);return out;}
function boundedId(value,label){const out=String(value||'').trim();if(!SAFE_ID_RE.test(out))throw new Error(`rsi_dormant_review_${label}_invalid`);return out;}
function token(value,label){const out=String(value||'').trim().toUpperCase();if(!SAFE_TOKEN_RE.test(out))throw new Error(`rsi_dormant_review_${label}_invalid`);return out;}
function positiveInt(value,label,max=1000000){const out=Number(value);if(!Number.isSafeInteger(out)||out<1||out>max)throw new Error(`rsi_dormant_review_${label}_invalid`);return out;}
function nonNegativeInt(value,label,max=1000000){const out=Number(value);if(!Number.isSafeInteger(out)||out<0||out>max)throw new Error(`rsi_dormant_review_${label}_invalid`);return out;}

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
    if(row?.[field]!==false)throw new Error(`rsi_dormant_review_${label}_${field}_invalid`);
  }
  if(row?.automatic_retry_allowed!==false)throw new Error(`rsi_dormant_review_${label}_automatic_retry_invalid`);
}
function verifyProvenance(provenance,{library,governance,skillDigest}){
  if(!provenance||provenance.schema!=='metaengine.rsi.admission-exposure-hold-provenance.v1'||provenance.version!==1){
    throw new Error('rsi_dormant_review_admission_provenance_invalid');
  }
  for(const field of ['execution_authority','browser_authority','task_authority','scheduler_authority','production_mutation_authority','promotion_authority','self_update_authority','authority_effect']){
    if(provenance[field]!==false)throw new Error(`rsi_dormant_review_provenance_${field}_invalid`);
  }
  if(provenance.automatic_retry_allowed!==false||provenance.release_authority!==false||provenance.retrieval_exposure_allowed!==false){
    throw new Error('rsi_dormant_review_admission_provenance_authority_invalid');
  }
  if(provenance.skill_digest!==skillDigest
    ||provenance.current_library_digest!==library.library_digest
    ||provenance.current_governance_digest!==governance.governance_digest
    ||provenance.admission_state!=='CONFIRMED_APPLIED_STORAGE_ONLY'
    ||provenance.exposure_hold_observed!==true
    ||provenance.dormant_cap_observed!==true
    ||provenance.active_for_composition!==false){
    throw new Error('rsi_dormant_review_admission_provenance_binding_mismatch');
  }
  exactDigest(provenance.admission_certificate_digest,'admission_certificate');
  exactDigest(provenance.effect_id_digest,'effect_id');
  exactDigest(provenance.effect_executor_identity_digest,'effect_executor_identity');
  exactDigest(provenance.admitted_successor_library_digest,'admitted_successor_library');
  exactDigest(provenance.confirmed_transition_digest,'confirmed_transition');
  const clone=structuredClone(provenance);delete clone.provenance_digest;
  if(digest(clone)!==exactDigest(provenance.provenance_digest,'provenance'))throw new Error('rsi_dormant_review_admission_provenance_digest_mismatch');
  return Object.freeze(structuredClone(provenance));
}
function heldEntry(governance,skillDigest){
  const entry=governance.entries.find(row=>row.skill_digest===skillDigest);
  if(!entry)throw new Error('rsi_dormant_review_skill_not_in_governance');
  if(!Array.isArray(governance.admission_exposure_hold_skill_digests)
    ||!governance.admission_exposure_hold_skill_digests.includes(skillDigest)
    ||entry.admission_exposure_held!==true
    ||entry.admission_exposure_hold_external_release_required!==true
    ||entry.state!=='DORMANT_CAP'
    ||entry.active_for_composition!==false){
    throw new Error('rsi_dormant_review_exact_exposure_hold_required');
  }
  return entry;
}

export function createRsiDormantSkillRetrievalReview({
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
  contamination_receipt_digest,
  from_scratch_replay_receipt_digest,
  coalition_ablation_receipt_digest,
  marginal_contribution_receipt_digest,
  capacity_policy_digest,
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
  contamination_clear,
  from_scratch_replay_pass,
  coalition_ablation_pass,
  marginal_contribution_pass,
  retrieval_reviewer_identity_digest,
  consumer_evaluator_identity_digest,
  contamination_auditor_identity_digest,
  coalition_auditor_identity_digest,
  capacity_policy_owner_identity_digest,
  external_retrieval_reviewer=false,
  external_consumer_evaluator=false,
  external_contamination_auditor=false,
  external_coalition_auditor=false,
  external_capacity_policy_owner=false,
  authored_by_candidate=true,
}={}){
  const sourceSha=exactSha(source_sha,'source');
  const checkedLibrary=verifyRsiVerifiedSkillLibrary(library);
  const checkedGovernance=verifyRsiSkillLibraryGovernance(current_governance,checkedLibrary);
  const skillDigest=exactDigest(skill_digest,'skill');
  heldEntry(checkedGovernance,skillDigest);
  const provenance=verifyProvenance(admission_provenance,{library:checkedLibrary,governance:checkedGovernance,skillDigest});

  if(external_retrieval_reviewer!==true||external_consumer_evaluator!==true||external_contamination_auditor!==true
    ||external_coalition_auditor!==true||external_capacity_policy_owner!==true||authored_by_candidate!==false){
    throw new Error('rsi_dormant_review_external_ownership_required');
  }
  const reviewerIdentities=[
    exactDigest(retrieval_reviewer_identity_digest,'retrieval_reviewer_identity'),
    exactDigest(consumer_evaluator_identity_digest,'consumer_evaluator_identity'),
    exactDigest(contamination_auditor_identity_digest,'contamination_auditor_identity'),
    exactDigest(coalition_auditor_identity_digest,'coalition_auditor_identity'),
    exactDigest(capacity_policy_owner_identity_digest,'capacity_policy_owner_identity'),
  ];
  if(new Set(reviewerIdentities).size!==reviewerIdentities.length||reviewerIdentities.includes(provenance.effect_executor_identity_digest)){
    throw new Error('rsi_dormant_review_separation_of_duties_required');
  }

  const pairCount=positiveInt(matched_pair_count,'matched_pair_count',10000);
  const skillSuccess=nonNegativeInt(skill_success_count,'skill_success_count',pairCount);
  const referenceSuccess=nonNegativeInt(reference_success_count,'reference_success_count',pairCount);
  const repairs=nonNegativeInt(repair_count,'repair_count',pairCount);
  const regressions=nonNegativeInt(regression_count,'regression_count',pairCount);
  const hardFailures=nonNegativeInt(hard_invariant_failure_count,'hard_invariant_failure_count',pairCount);
  const negativeTransfer=nonNegativeInt(negative_transfer_count,'negative_transfer_count',pairCount);
  if(repairs+regressions>pairCount)throw new Error('rsi_dormant_review_pair_delta_count_invalid');
  if(skillSuccess-referenceSuccess!==repairs-regressions)throw new Error('rsi_dormant_review_paired_success_delta_mismatch');

  const explorationActiveCount=checkedGovernance.entries.filter(row=>row.state==='EXPLORATION_ACTIVE').length;
  const activeCapAvailable=checkedGovernance.active_count<checkedGovernance.config.max_active_skills;
  const explorationSlotAvailable=explorationActiveCount<checkedGovernance.config.exploration_slots;

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
  if(contamination_clear!==true)blockers.push('CONTAMINATION_DETECTED');
  if(from_scratch_replay_pass!==true)blockers.push('FROM_SCRATCH_REPLAY_FAILURE');
  if(coalition_ablation_pass!==true)blockers.push('COALITION_ABLATION_FAILURE');
  if(marginal_contribution_pass!==true)blockers.push('NO_MARGINAL_CONTRIBUTION');
  if(!activeCapAvailable)blockers.push('ACTIVE_CAP_EXHAUSTED');
  if(!explorationSlotAvailable)blockers.push('EXPLORATION_SLOT_EXHAUSTED');
  const eligible=blockers.length===0;

  const core=zero({
    schema:RSI_DORMANT_SKILL_RETRIEVAL_REVIEW_SCHEMA,
    version:1,
    review_id:boundedId(review_id,'review_id'),
    source_sha:sourceSha,
    library_id:checkedLibrary.library_id,
    library_digest:checkedLibrary.library_digest,
    current_governance_digest:checkedGovernance.governance_digest,
    admission_provenance_digest:provenance.provenance_digest,
    admission_attempt_id:provenance.admission_attempt_id,
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
    contamination_receipt_digest:exactDigest(contamination_receipt_digest,'contamination_receipt'),
    from_scratch_replay_receipt_digest:exactDigest(from_scratch_replay_receipt_digest,'from_scratch_replay_receipt'),
    coalition_ablation_receipt_digest:exactDigest(coalition_ablation_receipt_digest,'coalition_ablation_receipt'),
    marginal_contribution_receipt_digest:exactDigest(marginal_contribution_receipt_digest,'marginal_contribution_receipt'),
    capacity_policy_digest:exactDigest(capacity_policy_digest,'capacity_policy'),
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
    contamination_clear:contamination_clear===true,
    from_scratch_replay_pass:from_scratch_replay_pass===true,
    coalition_ablation_pass:coalition_ablation_pass===true,
    marginal_contribution_pass:marginal_contribution_pass===true,
    exploration_active_count:explorationActiveCount,
    exploration_slot_limit:checkedGovernance.config.exploration_slots,
    active_count:checkedGovernance.active_count,
    active_cap_limit:checkedGovernance.config.max_active_skills,
    active_cap_capacity_available:activeCapAvailable,
    exploration_slot_capacity_available:explorationSlotAvailable,
    bounded_exploration_capacity_available:activeCapAvailable&&explorationSlotAvailable,
    blockers:Object.freeze(blockers.sort()),
    state:eligible?'ELIGIBLE_FOR_EXTERNAL_RETRIEVAL_EXPOSURE_REVIEW':'KEEP_DORMANT_REVIEW_REJECTED',
    eligible_for_external_retrieval_exposure_review:eligible,
    retrieval_reviewer_identity_digest:reviewerIdentities[0],
    consumer_evaluator_identity_digest:reviewerIdentities[1],
    contamination_auditor_identity_digest:reviewerIdentities[2],
    coalition_auditor_identity_digest:reviewerIdentities[3],
    capacity_policy_owner_identity_digest:reviewerIdentities[4],
    external_retrieval_reviewer:true,
    external_consumer_evaluator:true,
    external_contamination_auditor:true,
    external_coalition_auditor:true,
    external_capacity_policy_owner:true,
    authored_by_candidate:false,
    confirmed_admission_provenance_required:true,
    exact_current_library_and_governance_required:true,
    matched_same_instances_required:true,
    positive_matched_gain_required:true,
    zero_matched_regressions_required:true,
    hidden_or_external_evidence_roots_required:true,
    negative_transfer_veto_required:true,
    coalition_ablation_required:true,
    marginal_contribution_required:true,
    active_cap_required:true,
    exploration_slot_required:true,
    review_is_zero_effect:true,
    storage_admission_is_not_exposure_authority:true,
    hold_release_effect_authorized:false,
    hold_release_effect_performed:false,
    retrieval_exposure_change_authorized:false,
    retrieval_exposure_changed:false,
    skill_activation_authorized:false,
    skill_activation_performed:false,
    lifecycle_mutation_performed:false,
    governance_mutation_performed:false,
    release_token:null,
  });
  return Object.freeze({...core,retrieval_review_digest:digest(core)});
}

export function verifyRsiDormantSkillRetrievalReview(review,args={}){
  if(!review||typeof review!=='object'||Array.isArray(review)||review.schema!==RSI_DORMANT_SKILL_RETRIEVAL_REVIEW_SCHEMA||review.version!==1){
    throw new Error('rsi_dormant_review_invalid');
  }
  assertZero(review,'review');
  if(review.confirmed_admission_provenance_required!==true||review.exact_current_library_and_governance_required!==true
    ||review.matched_same_instances_required!==true||review.positive_matched_gain_required!==true
    ||review.zero_matched_regressions_required!==true||review.hidden_or_external_evidence_roots_required!==true
    ||review.negative_transfer_veto_required!==true||review.coalition_ablation_required!==true
    ||review.marginal_contribution_required!==true||review.active_cap_required!==true||review.exploration_slot_required!==true
    ||review.review_is_zero_effect!==true||review.storage_admission_is_not_exposure_authority!==true
    ||review.hold_release_effect_authorized!==false||review.hold_release_effect_performed!==false
    ||review.retrieval_exposure_change_authorized!==false||review.retrieval_exposure_changed!==false
    ||review.skill_activation_authorized!==false||review.skill_activation_performed!==false
    ||review.lifecycle_mutation_performed!==false||review.governance_mutation_performed!==false||review.release_token!==null){
    throw new Error('rsi_dormant_review_policy_invalid');
  }
  const canonical=createRsiDormantSkillRetrievalReview({
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
    contamination_receipt_digest:review.contamination_receipt_digest,
    from_scratch_replay_receipt_digest:review.from_scratch_replay_receipt_digest,
    coalition_ablation_receipt_digest:review.coalition_ablation_receipt_digest,
    marginal_contribution_receipt_digest:review.marginal_contribution_receipt_digest,
    capacity_policy_digest:review.capacity_policy_digest,
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
    contamination_clear:review.contamination_clear,
    from_scratch_replay_pass:review.from_scratch_replay_pass,
    coalition_ablation_pass:review.coalition_ablation_pass,
    marginal_contribution_pass:review.marginal_contribution_pass,
    retrieval_reviewer_identity_digest:review.retrieval_reviewer_identity_digest,
    consumer_evaluator_identity_digest:review.consumer_evaluator_identity_digest,
    contamination_auditor_identity_digest:review.contamination_auditor_identity_digest,
    coalition_auditor_identity_digest:review.coalition_auditor_identity_digest,
    capacity_policy_owner_identity_digest:review.capacity_policy_owner_identity_digest,
    external_retrieval_reviewer:true,
    external_consumer_evaluator:true,
    external_contamination_auditor:true,
    external_coalition_auditor:true,
    external_capacity_policy_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.retrieval_review_digest!==exactDigest(review.retrieval_review_digest,'review'))throw new Error('rsi_dormant_review_digest_mismatch');
  return canonical;
}

export function rsiDormantSkillRetrievalReviewTrustRootSnapshot(){
  const root=zero({
    schema:'metaengine.rsi.dormant-skill-retrieval-review-root.v1',
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-dormant-skill-retrieval-review.mjs',
    confirmed_admission_provenance_required:true,
    exact_held_dormant_skill_required:true,
    exact_current_library_and_governance_required:true,
    paired_numeric_consistency_required:true,
    minimum_matched_pairs:3,
    positive_matched_gain_required:true,
    zero_matched_regressions_required:true,
    hard_invariant_veto_required:true,
    negative_transfer_veto_required:true,
    cost_latency_veto_required:true,
    harness_benchmark_memory_grounding_required:true,
    contamination_and_from_scratch_replay_required:true,
    coalition_ablation_required:true,
    marginal_contribution_required:true,
    active_cap_required:true,
    exploration_slot_required:true,
    reviewer_separation_from_storage_executor_required:true,
    review_is_zero_effect:true,
    candidate_cannot_self_release:true,
    hold_release_effect_authorized:false,
    retrieval_exposure_change_authorized:false,
    skill_activation_authorized:false,
  });
  return Object.freeze({...root,retrieval_review_root_digest:digest(root)});
}
