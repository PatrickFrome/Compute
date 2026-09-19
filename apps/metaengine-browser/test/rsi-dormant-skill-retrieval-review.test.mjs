import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiSkillCapsule,
  createRsiSkillEvidence,
  createRsiVerifiedSkillLibrary,
} from '../src/rsi-verified-skill-library.mjs';
import {
  createRsiSkillLifecycleEvidence,
  createRsiSkillLibraryGovernance,
} from '../src/rsi-skill-library-governance.mjs';
import {
  createRsiDormantSkillRetrievalReview,
  verifyRsiDormantSkillRetrievalReview,
  rsiDormantSkillRetrievalReviewTrustRootSnapshot,
} from '../src/rsi-dormant-skill-retrieval-review.mjs';

const sha=(char)=>char.repeat(40);
const d=(char)=>`sha256:${char.repeat(64)}`;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
}
function digest(value){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;}

function fixture({explorationSlots=2}={}){
  const skill=createRsiSkillCapsule({
    skill_id:'skill.dormant.review.fixture',
    version:1,
    parent_skill_digest:null,
    source_candidate_sha:sha('1'),
    role:'ANALYZER',
    input_schema_digest:d('1'),
    output_schema_digest:d('2'),
    implementation_digest:d('3'),
    components:[{component_id:'skill.dormant.review.component',artifact_digest:d('4'),kind:'TYPED_TRANSFORM'}],
    capabilities:['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES'],
    max_context_tokens:2048,
    max_output_tokens:512,
    max_invocations:2,
    external_builder:true,
    authored_by_candidate:false,
  });
  const evidence=createRsiSkillEvidence({
    capsule:skill,
    hidden_holdout_digest:d('5'),
    evaluator_root_digest:d('6'),
    unit_test_digest:d('7'),
    runtime_feedback_digest:d('8'),
    attempt_count:12,
    success_count:10,
    hard_invariants_pass:true,
    verified_for_library:true,
    evidence_refs:['DORMANT_REVIEW_FIXTURE'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  const library=createRsiVerifiedSkillLibrary({
    library_id:'rsi.skill.library.dormant.review.fixture',
    entries:[{capsule:skill,evidence}],
    external_library_owner:true,
    authored_by_candidate:false,
  });
  const lifecycle=createRsiSkillLifecycleEvidence({
    library,
    evidence_id:'window.dormant.review.1',
    skill_digest:skill.skill_digest,
    window_seq:1,
    generation_start:1,
    generation_end:1,
    invocation_count:4,
    helpful_count:4,
    harmful_count:0,
    neutral_count:0,
    insufficient_evidence_count:0,
    router_engagement_count:4,
    false_positive_injection_count:0,
    hard_invariant_violation_count:0,
    measured_net_delta:0.4,
    authoring_prior:'VERIFIED_DIRECT_SKILL',
    authoring_provenance_digest:d('9'),
    evidence_refs:['DORMANT_REVIEW_LIFECYCLE'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  const governance=createRsiSkillLibraryGovernance({
    governance_id:'governance.dormant.review.fixture',
    library,
    lifecycle_evidence:[lifecycle],
    max_active_skills:4,
    exploration_slots:explorationSlots,
    admission_exposure_hold_skill_digests:[skill.skill_digest],
    external_library_owner:true,
    authored_by_candidate:false,
  });
  const provenanceCore={
    schema:'metaengine.rsi.admission-exposure-hold-provenance.v1',version:1,
    skill_digest:skill.skill_digest,
    admission_attempt_id:'phase34b.attempt.dormant-review',
    admission_certificate_digest:d('a'),
    effect_id_digest:d('b'),
    effect_executor_identity_digest:d('c'),
    admitted_successor_library_digest:library.library_digest,
    confirmed_transition_digest:d('d'),
    current_library_digest:library.library_digest,
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
  const provenance=Object.freeze({...provenanceCore,provenance_digest:digest(provenanceCore)});
  return {skill,library,governance,provenance};
}

function args(fx,overrides={}){
  return {
    review_id:'dormant.review.fixture.1',
    source_sha:sha('a'),
    library:fx.library,
    current_governance:fx.governance,
    admission_provenance:fx.provenance,
    skill_digest:fx.skill.skill_digest,
    consumer_model_family:'GPT_5_6_SOL',
    environment_fingerprint:'env.dormant.review.windows.chromium',
    task_signature_digest:d('1'),
    routing_context_manifest_digest:d('2'),
    retrieval_profile_digest:d('3'),
    memory_context_digest:d('4'),
    harness_integrity_digest:d('5'),
    benchmark_provenance_digest:d('6'),
    matched_comparison_receipt_digest:d('7'),
    negative_transfer_receipt_digest:d('8'),
    cost_latency_receipt_digest:d('9'),
    source_grounding_receipt_digest:d('a'),
    contamination_receipt_digest:d('b'),
    from_scratch_replay_receipt_digest:d('c'),
    coalition_ablation_receipt_digest:d('d'),
    marginal_contribution_receipt_digest:d('e'),
    capacity_policy_digest:d('f'),
    matched_pair_count:4,
    skill_success_count:4,
    reference_success_count:2,
    repair_count:2,
    regression_count:0,
    hard_invariant_failure_count:0,
    negative_transfer_count:0,
    cost_budget_pass:true,
    latency_budget_pass:true,
    harness_integrity_pass:true,
    benchmark_provenance_pass:true,
    memory_safety_pass:true,
    source_grounding_pass:true,
    contamination_clear:true,
    from_scratch_replay_pass:true,
    coalition_ablation_pass:true,
    marginal_contribution_pass:true,
    retrieval_reviewer_identity_digest:d('1'),
    consumer_evaluator_identity_digest:d('2'),
    contamination_auditor_identity_digest:d('3'),
    coalition_auditor_identity_digest:d('4'),
    capacity_policy_owner_identity_digest:d('5'),
    external_retrieval_reviewer:true,
    external_consumer_evaluator:true,
    external_contamination_auditor:true,
    external_coalition_auditor:true,
    external_capacity_policy_owner:true,
    authored_by_candidate:false,
    ...overrides,
  };
}

test('confirmed admission provenance plus matched evidence yields zero-effect external review eligibility',()=>{
  const fx=fixture();
  const review=createRsiDormantSkillRetrievalReview(args(fx));
  assert.equal(review.state,'ELIGIBLE_FOR_EXTERNAL_RETRIEVAL_EXPOSURE_REVIEW');
  assert.equal(review.eligible_for_external_retrieval_exposure_review,true);
  assert.equal(review.admission_provenance_digest,fx.provenance.provenance_digest);
  assert.equal(review.repair_count,2);
  assert.equal(review.regression_count,0);
  assert.equal(review.active_cap_capacity_available,true);
  assert.equal(review.exploration_slot_capacity_available,true);
  assert.equal(review.hold_release_effect_authorized,false);
  assert.equal(review.retrieval_exposure_changed,false);
  assert.equal(review.skill_activation_performed,false);
  assert.equal(review.browser_authority,false);
  assert.equal(review.task_authority,false);
  assert.equal(review.scheduler_authority,false);
  verifyRsiDormantSkillRetrievalReview(review,{library:fx.library,current_governance:fx.governance,admission_provenance:fx.provenance});
});

test('paired numeric evidence must be internally consistent and cannot hide a regression',()=>{
  const fx=fixture();
  assert.throws(()=>createRsiDormantSkillRetrievalReview(args(fx,{
    skill_success_count:4,
    reference_success_count:2,
    repair_count:1,
    regression_count:0,
  })),/paired_success_delta_mismatch/);
  const rejected=createRsiDormantSkillRetrievalReview(args(fx,{
    skill_success_count:3,
    reference_success_count:3,
    repair_count:1,
    regression_count:1,
    negative_transfer_count:1,
  }));
  assert.equal(rejected.state,'KEEP_DORMANT_REVIEW_REJECTED');
  assert.ok(rejected.blockers.includes('MATCHED_FUNCTIONAL_REGRESSION'));
  assert.ok(rejected.blockers.includes('NEGATIVE_TRANSFER_PRESENT'));
  assert.equal(rejected.retrieval_exposure_change_authorized,false);
});

test('review requires confirmed admission provenance and reviewer separation from the storage executor',()=>{
  const fx=fixture();
  assert.throws(()=>createRsiDormantSkillRetrievalReview(args(fx,{admission_provenance:null})),/admission_provenance_invalid/);
  assert.throws(()=>createRsiDormantSkillRetrievalReview(args(fx,{
    retrieval_reviewer_identity_digest:fx.provenance.effect_executor_identity_digest,
  })),/separation_of_duties_required/);
  const forged={...fx.provenance,current_governance_digest:d('f')};
  delete forged.provenance_digest;
  const forgedWithDigest={...forged,provenance_digest:digest(forged)};
  assert.throws(()=>createRsiDormantSkillRetrievalReview(args(fx,{admission_provenance:forgedWithDigest})),/admission_provenance_binding_mismatch/);
});

test('bounded exploration capacity is a hard eligibility fence, not a release side effect',()=>{
  const fx=fixture({explorationSlots:0});
  const review=createRsiDormantSkillRetrievalReview(args(fx));
  assert.equal(review.state,'KEEP_DORMANT_REVIEW_REJECTED');
  assert.equal(review.exploration_slot_capacity_available,false);
  assert.ok(review.blockers.includes('EXPLORATION_SLOT_EXHAUSTED'));
  assert.equal(review.hold_release_effect_performed,false);
  assert.equal(fx.governance.entries[0].admission_exposure_held,true);
  assert.equal(fx.governance.entries[0].active_for_composition,false);
});

test('candidate cannot self-certify and trust root freezes zero-effect provenance-bound semantics',()=>{
  const fx=fixture();
  assert.throws(()=>createRsiDormantSkillRetrievalReview(args(fx,{
    external_consumer_evaluator:false,
    authored_by_candidate:true,
  })),/external_ownership_required/);
  const root=rsiDormantSkillRetrievalReviewTrustRootSnapshot();
  assert.equal(root.confirmed_admission_provenance_required,true);
  assert.equal(root.paired_numeric_consistency_required,true);
  assert.equal(root.positive_matched_gain_required,true);
  assert.equal(root.zero_matched_regressions_required,true);
  assert.equal(root.negative_transfer_veto_required,true);
  assert.equal(root.active_cap_required,true);
  assert.equal(root.exploration_slot_required,true);
  assert.equal(root.reviewer_separation_from_storage_executor_required,true);
  assert.equal(root.review_is_zero_effect,true);
  assert.equal(root.hold_release_effect_authorized,false);
  assert.equal(root.retrieval_exposure_change_authorized,false);
  assert.equal(root.skill_activation_authorized,false);
  assert.equal(root.authority_effect,false);
});
