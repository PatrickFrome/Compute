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
  createRsiSkillExposureReleaseReview,
  verifyRsiSkillExposureReleaseReview,
  rsiSkillExposureReleaseReviewTrustRootSnapshot,
} from '../src/rsi-skill-exposure-release-review.mjs';

const sha=(char)=>char.repeat(40);
const d=(char)=>`sha256:${char.repeat(64)}`;
function stable(value){if(Array.isArray(value))return value.map(stable);if(!value||typeof value!=='object')return value;return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));}
function dg(value){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;}

function admissionProvenance(fx,overrides={}){
  const core={
    schema:'metaengine.rsi.admission-exposure-hold-provenance.v1',version:1,
    skill_digest:fx.skill.skill_digest,
    admission_attempt_id:'phase34b.attempt.exposure.review.fixture',
    admission_attempt_digest:d('a'),
    admission_certificate_digest:d('b'),
    effect_id_digest:d('c'),
    effect_executor_identity_digest:d('d'),
    idempotency_key_digest:d('e'),
    admitted_successor_library_digest:fx.library.library_digest,
    confirmed_transition_digest:d('f'),
    current_library_digest:fx.library.library_digest,
    current_governance_digest:fx.governance.governance_digest,
    admission_state:'CONFIRMED_APPLIED_STORAGE_ONLY',
    exposure_hold_observed:true,dormant_cap_observed:true,active_for_composition:false,
    retrieval_exposure_allowed:false,release_authority:false,
    execution_authority:false,browser_authority:false,task_authority:false,scheduler_authority:false,
    production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
    ...overrides,
  };
  return Object.freeze({...core,provenance_digest:dg(core)});
}

function fixture({held=true}={}){
  const skill=createRsiSkillCapsule({
    skill_id:'skill.exposure.review.fixture',
    version:1,
    parent_skill_digest:null,
    source_candidate_sha:sha('1'),
    role:'ANALYZER',
    input_schema_digest:d('1'),
    output_schema_digest:d('2'),
    implementation_digest:d('3'),
    components:[{component_id:'skill.exposure.review.component',artifact_digest:d('4'),kind:'TYPED_TRANSFORM'}],
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
    evidence_refs:['EXPOSURE_REVIEW_FIXTURE'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  const library=createRsiVerifiedSkillLibrary({
    library_id:'rsi.skill.library.exposure.review.fixture',
    entries:[{capsule:skill,evidence}],
    external_library_owner:true,
    authored_by_candidate:false,
  });
  const lifecycle=createRsiSkillLifecycleEvidence({
    library,
    evidence_id:'window.exposure.review.1',
    skill_digest:skill.skill_digest,
    window_seq:1,
    generation_start:1,
    generation_end:1,
    invocation_count:8,
    helpful_count:7,
    harmful_count:0,
    neutral_count:1,
    insufficient_evidence_count:0,
    router_engagement_count:8,
    false_positive_injection_count:0,
    hard_invariant_violation_count:0,
    measured_net_delta:0.4,
    authoring_prior:'VERIFIED_DIRECT_SKILL',
    authoring_provenance_digest:d('9'),
    evidence_refs:['EXPOSURE_REVIEW_LIFECYCLE'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  const governance=createRsiSkillLibraryGovernance({
    governance_id:'governance.exposure.review.fixture',
    library,
    lifecycle_evidence:[lifecycle],
    admission_exposure_hold_skill_digests:held?[skill.skill_digest]:[],
    external_library_owner:true,
    authored_by_candidate:false,
  });
  return {skill,library,governance};
}

function args(fx,overrides={}){
  return {
    review_id:'exposure.review.fixture.1',
    source_sha:sha('a'),
    library:fx.library,
    current_governance:fx.governance,
    skill_digest:fx.skill.skill_digest,
    admission_provenance:admissionProvenance(fx),
    consumer_model_family:'GPT_5_6_SOL',
    environment_fingerprint:'env.exposure.review.windows.chromium',
    task_signature_digest:d('a'),
    routing_context_manifest_digest:d('b'),
    retrieval_profile_digest:d('c'),
    memory_context_digest:d('d'),
    harness_integrity_digest:d('e'),
    benchmark_provenance_digest:d('f'),
    matched_comparison_receipt_digest:d('1'),
    negative_transfer_receipt_digest:d('2'),
    cost_latency_receipt_digest:d('3'),
    source_grounding_receipt_digest:d('4'),
    external_policy_digest:d('5'),
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
    governance_reviewer_identity_digest:d('6'),
    matched_evaluator_identity_digest:d('7'),
    security_reviewer_identity_digest:d('8'),
    external_governance_reviewer:true,
    external_matched_evaluator:true,
    external_security_reviewer:true,
    authored_by_candidate:false,
    ...overrides,
  };
}

test('matched external review can make a held skill review-eligible without authorizing exposure',()=>{
  const fx=fixture();
  const review=createRsiSkillExposureReleaseReview(args(fx));
  assert.equal(review.state,'ELIGIBLE_FOR_EXTERNAL_EXPOSURE_RELEASE_REVIEW');
  assert.equal(review.eligible_for_external_exposure_release_review,true);
  assert.equal(review.confirmed_storage_admission_provenance_required,true);
  assert.equal(review.admission_attempt_id,'phase34b.attempt.exposure.review.fixture');
  assert.equal(review.admission_attempt_digest,d('a'));
  assert.equal(review.admission_effect_executor_identity_digest,d('d'));
  assert.equal(review.matched_same_instances_required,true);
  assert.equal(review.repair_count,2);
  assert.equal(review.regression_count,0);
  assert.equal(review.hold_release_effect_authorized,false);
  assert.equal(review.hold_release_effect_performed,false);
  assert.equal(review.retrieval_exposure_change_authorized,false);
  assert.equal(review.skill_activation_authorized,false);
  assert.equal(review.browser_authority,false);
  assert.equal(review.task_authority,false);
  assert.equal(review.authority_effect,false);
  assert.equal(fx.governance.entries[0].active_for_composition,false);
  verifyRsiSkillExposureReleaseReview(review,{library:fx.library,current_governance:fx.governance});
});

test('review rejects negative transfer or budget regression without mutating the hold',()=>{
  const fx=fixture();
  const review=createRsiSkillExposureReleaseReview(args(fx,{
    skill_success_count:3,
    reference_success_count:3,
    repair_count:1,
    regression_count:1,
    negative_transfer_count:1,
    latency_budget_pass:false,
  }));
  assert.equal(review.state,'REJECTED_EXPOSURE_RELEASE_REVIEW');
  assert.equal(review.eligible_for_external_exposure_release_review,false);
  assert.deepEqual(review.blockers,[
    'LATENCY_BUDGET_REGRESSION',
    'MATCHED_FUNCTIONAL_REGRESSION',
    'NEGATIVE_TRANSFER_PRESENT',
    'NO_VERIFIED_MATCHED_GAIN',
  ]);
  assert.equal(fx.governance.admission_exposure_hold_skill_digests.includes(fx.skill.skill_digest),true);
  assert.equal(review.retrieval_exposure_change_authorized,false);
});

test('review requires an exact held dormant skill and distinct external reviewer identities',()=>{
  const unheld=fixture({held:false});
  assert.throws(
    ()=>createRsiSkillExposureReleaseReview(args(unheld)),
    /exact_exposure_hold_required/,
  );

  const held=fixture();
  assert.throws(
    ()=>createRsiSkillExposureReleaseReview(args(held,{
      security_reviewer_identity_digest:d('7'),
    })),
    /separation_of_duties_required/,
  );
  assert.throws(
    ()=>createRsiSkillExposureReleaseReview(args(held,{
      governance_reviewer_identity_digest:d('d'),
    })),
    /admission_executor_reviewer_separation_required/,
  );
  const forged=admissionProvenance(held,{current_governance_digest:d('0')});
  assert.throws(
    ()=>createRsiSkillExposureReleaseReview(args(held,{admission_provenance:forged})),
    /admission_provenance_binding_invalid/,
  );
});

test('paired metrics are internally consistent and candidate cannot self-certify',()=>{
  const fx=fixture();
  assert.throws(
    ()=>createRsiSkillExposureReleaseReview(args(fx,{
      skill_success_count:4,
      reference_success_count:2,
      repair_count:1,
      regression_count:0,
    })),
    /paired_success_delta_mismatch/,
  );
  assert.throws(
    ()=>createRsiSkillExposureReleaseReview(args(fx,{
      external_matched_evaluator:false,
      authored_by_candidate:true,
    })),
    /external_ownership_required/,
  );
});

test('trust root freezes zero-effect matched differential review semantics',()=>{
  const root=rsiSkillExposureReleaseReviewTrustRootSnapshot();
  assert.equal(root.exact_held_skill_required,true);
  assert.equal(root.confirmed_storage_admission_provenance_required,true);
  assert.equal(root.admission_attempt_digest_binding_required,true);
  assert.equal(root.admission_effect_executor_reviewer_separation_required,true);
  assert.equal(root.matched_same_instances_required,true);
  assert.equal(root.no_skill_or_matched_reference_required,true);
  assert.equal(root.positive_matched_gain_required,true);
  assert.equal(root.zero_matched_regressions_required,true);
  assert.equal(root.negative_transfer_veto_required,true);
  assert.equal(root.cost_and_latency_veto_required,true);
  assert.equal(root.reviewer_separation_of_duties_required,true);
  assert.equal(root.review_is_zero_effect,true);
  assert.equal(root.hold_release_effect_authorized,false);
  assert.equal(root.retrieval_exposure_change_authorized,false);
  assert.equal(root.authority_effect,false);
});
