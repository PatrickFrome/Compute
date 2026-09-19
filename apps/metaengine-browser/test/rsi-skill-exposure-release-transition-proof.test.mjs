import assert from 'node:assert/strict';
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
} from '../src/rsi-skill-exposure-release-review.mjs';
import {
  createRsiSkillExposureReleaseTransitionProof,
  verifyRsiSkillExposureReleaseTransitionProof,
  rsiSkillExposureReleaseTransitionProofTrustRootSnapshot,
} from '../src/rsi-skill-exposure-release-transition-proof.mjs';

const sha=(char)=>char.repeat(40);
const d=(char)=>`sha256:${char.repeat(64)}`;

function fixture({invocations=2}={}){
  const skill=createRsiSkillCapsule({
    skill_id:'skill.exposure.transition.fixture',
    version:1,
    parent_skill_digest:null,
    source_candidate_sha:sha('1'),
    role:'ANALYZER',
    input_schema_digest:d('1'),
    output_schema_digest:d('2'),
    implementation_digest:d('3'),
    components:[{component_id:'skill.exposure.transition.component',artifact_digest:d('4'),kind:'TYPED_TRANSFORM'}],
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
    evidence_refs:['EXPOSURE_TRANSITION_FIXTURE'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  const library=createRsiVerifiedSkillLibrary({
    library_id:'rsi.skill.library.exposure.transition.fixture',
    entries:[{capsule:skill,evidence}],
    external_library_owner:true,
    authored_by_candidate:false,
  });
  const lifecycle=createRsiSkillLifecycleEvidence({
    library,
    evidence_id:'window.exposure.transition.1',
    skill_digest:skill.skill_digest,
    window_seq:1,
    generation_start:1,
    generation_end:1,
    invocation_count:invocations,
    helpful_count:invocations,
    harmful_count:0,
    neutral_count:0,
    insufficient_evidence_count:0,
    router_engagement_count:invocations,
    false_positive_injection_count:0,
    hard_invariant_violation_count:0,
    measured_net_delta:0.4,
    authoring_prior:'VERIFIED_DIRECT_SKILL',
    authoring_provenance_digest:d('9'),
    evidence_refs:['EXPOSURE_TRANSITION_LIFECYCLE'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  const base={
    governance_id:'governance.exposure.transition.fixture',
    library,
    lifecycle_evidence:[lifecycle],
    external_library_owner:true,
    authored_by_candidate:false,
  };
  const currentGovernance=createRsiSkillLibraryGovernance({
    ...base,
    admission_exposure_hold_skill_digests:[skill.skill_digest],
  });
  const nextGovernance=createRsiSkillLibraryGovernance(base);
  return {skill,library,lifecycle,currentGovernance,nextGovernance};
}

function reviewArgs(fx,overrides={}){
  return {
    review_id:'exposure.transition.review.1',
    source_sha:sha('a'),
    library:fx.library,
    current_governance:fx.currentGovernance,
    skill_digest:fx.skill.skill_digest,
    consumer_model_family:'GPT_5_6_SOL',
    environment_fingerprint:'env.exposure.transition.windows.chromium',
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

function proofArgs(fx,review,overrides={}){
  return {
    proof_id:'exposure.transition.proof.1',
    source_sha:sha('a'),
    library:fx.library,
    current_governance:fx.currentGovernance,
    next_governance:fx.nextGovernance,
    review,
    skill_digest:fx.skill.skill_digest,
    external_release_owner_identity_digest:d('9'),
    external_canary_evaluator_identity_digest:d('d'),
    external_security_auditor_identity_digest:d('e'),
    read_only_shadow_canary_digest:d('a'),
    coalition_ablation_receipt_digest:d('b'),
    memory_poisoning_scan_digest:d('c'),
    read_only_shadow_canary_pass:true,
    coalition_ablation_pass:true,
    memory_poisoning_scan_pass:true,
    canary_effect_mode:'READ_ONLY_SHADOW',
    external_release_owner:true,
    authored_by_candidate:false,
    ...overrides,
  };
}

test('eligible held skill can produce a zero-effect exploration-only transition proof',()=>{
  const fx=fixture();
  assert.equal(fx.currentGovernance.entries[0].state,'DORMANT_CAP');
  assert.equal(fx.nextGovernance.entries[0].state,'EXPLORATION_ACTIVE');
  const review=createRsiSkillExposureReleaseReview(reviewArgs(fx));
  const proof=createRsiSkillExposureReleaseTransitionProof(proofArgs(fx,review));
  assert.equal(proof.eligible_for_external_release_attempt_review,true);
  assert.equal(proof.current_state,'DORMANT_CAP');
  assert.equal(proof.next_state,'EXPLORATION_ACTIVE');
  assert.equal(proof.active_count_delta,1);
  assert.equal(proof.hold_count_delta,-1);
  assert.equal(proof.hold_release_effect_authorized,false);
  assert.equal(proof.hold_release_effect_performed,false);
  assert.equal(proof.retrieval_exposure_changed,false);
  assert.equal(proof.skill_activation_performed,false);
  assert.equal(proof.browser_authority,false);
  assert.equal(proof.task_authority,false);
  verifyRsiSkillExposureReleaseTransitionProof(proof,proofArgs(fx,review));
});

test('transition proof rejects a direct held-to-full-active jump',()=>{
  const fx=fixture({invocations:8});
  assert.equal(fx.currentGovernance.entries[0].state,'DORMANT_CAP');
  assert.equal(fx.nextGovernance.entries[0].state,'ACTIVE');
  const review=createRsiSkillExposureReleaseReview(reviewArgs(fx));
  assert.throws(
    ()=>createRsiSkillExposureReleaseTransitionProof(proofArgs(fx,review)),
    /exploration_only_required/,
  );
});

test('release owner must be external and distinct from all review principals',()=>{
  const fx=fixture();
  const review=createRsiSkillExposureReleaseReview(reviewArgs(fx));
  assert.throws(
    ()=>createRsiSkillExposureReleaseTransitionProof(proofArgs(fx,review,{
      external_release_owner_identity_digest:d('6'),
    })),
    /cross_stage_separation_required/,
  );
  assert.throws(
    ()=>createRsiSkillExposureReleaseTransitionProof(proofArgs(fx,review,{
      external_canary_evaluator_identity_digest:d('9'),
    })),
    /cross_stage_separation_required/,
  );
  assert.throws(
    ()=>createRsiSkillExposureReleaseTransitionProof(proofArgs(fx,review,{
      external_security_auditor_identity_digest:d('8'),
    })),
    /cross_stage_separation_required/,
  );
  assert.throws(
    ()=>createRsiSkillExposureReleaseTransitionProof(proofArgs(fx,review,{
      external_release_owner:false,
      authored_by_candidate:true,
    })),
    /external_release_owner_required/,
  );
});

test('transition proof rejects source drift and cross-stage evidence aliasing',()=>{
  const fx=fixture();
  const review=createRsiSkillExposureReleaseReview(reviewArgs(fx));
  assert.throws(
    ()=>createRsiSkillExposureReleaseTransitionProof(proofArgs(fx,review,{source_sha:sha('b')})),
    /eligible_review_required/,
  );
  assert.throws(
    ()=>createRsiSkillExposureReleaseTransitionProof(proofArgs(fx,review,{
      read_only_shadow_canary_digest:review.matched_comparison_receipt_digest,
    })),
    /cross_stage_evidence_alias_forbidden/,
  );
});

test('transition proof requires read-only canary, coalition ablation and poisoning scan',()=>{
  const fx=fixture();
  const review=createRsiSkillExposureReleaseReview(reviewArgs(fx));
  assert.throws(
    ()=>createRsiSkillExposureReleaseTransitionProof(proofArgs(fx,review,{
      memory_poisoning_scan_pass:false,
    })),
    /external_safety_evidence_required/,
  );
  assert.throws(
    ()=>createRsiSkillExposureReleaseTransitionProof(proofArgs(fx,review,{
      canary_effect_mode:'MUTATING_CANARY',
    })),
    /external_safety_evidence_required/,
  );
});

test('transition proof trust root keeps release review non-authoritative',()=>{
  const root=rsiSkillExposureReleaseTransitionProofTrustRootSnapshot();
  assert.equal(root.eligible_external_review_required,true);
  assert.equal(root.exact_current_governance_required,true);
  assert.equal(root.exact_next_governance_required,true);
  assert.equal(root.exploration_only_transition,true);
  assert.equal(root.only_target_governance_state_may_change,true);
  assert.equal(root.read_only_shadow_canary_required,true);
  assert.equal(root.release_owner_separation_of_duties_required,true);
  assert.equal(root.cross_stage_identity_separation_required,true);
  assert.equal(root.independent_canary_evaluator_required,true);
  assert.equal(root.independent_security_auditor_required,true);
  assert.equal(root.proof_is_zero_effect,true);
  assert.equal(root.hold_release_effect_authorized,false);
  assert.equal(root.retrieval_exposure_change_authorized,false);
  assert.equal(root.skill_activation_authorized,false);
  assert.equal(root.authority_effect,false);
});
