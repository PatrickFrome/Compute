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
} from '../src/rsi-skill-exposure-release-review.mjs';
import {
  createRsiSkillExposureReleasePreview,
  verifyRsiSkillExposureReleasePreview,
  createRsiSkillExposureReleaseCertificate,
  verifyRsiSkillExposureReleaseCertificate,
  rsiSkillExposureReleaseTrustRootSnapshot,
} from '../src/rsi-skill-exposure-release.mjs';

const sha=(char)=>char.repeat(40);
const d=(char)=>`sha256:${char.repeat(64)}`;
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
}
function dg(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}

function fixture(){
  const skill=createRsiSkillCapsule({
    skill_id:'skill.phase36.reviewed.certificate',
    version:1,
    parent_skill_digest:null,
    source_candidate_sha:sha('1'),
    role:'ANALYZER',
    input_schema_digest:d('1'),
    output_schema_digest:d('2'),
    implementation_digest:d('3'),
    components:[{component_id:'skill.phase36.reviewed.component',artifact_digest:d('4'),kind:'TYPED_TRANSFORM'}],
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
    success_count:11,
    hard_invariants_pass:true,
    verified_for_library:true,
    evidence_refs:['PHASE36_REVIEWED_CERTIFICATE'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  const library=createRsiVerifiedSkillLibrary({
    library_id:'rsi.skill.library.phase36.reviewed',
    entries:[{capsule:skill,evidence}],
    external_library_owner:true,
    authored_by_candidate:false,
  });
  const lifecycle=createRsiSkillLifecycleEvidence({
    library,
    evidence_id:'phase36.reviewed.window.1',
    skill_digest:skill.skill_digest,
    window_seq:1,
    generation_start:1,
    generation_end:1,
    invocation_count:1,
    helpful_count:1,
    harmful_count:0,
    neutral_count:0,
    insufficient_evidence_count:0,
    router_engagement_count:1,
    false_positive_injection_count:0,
    hard_invariant_violation_count:0,
    measured_net_delta:0.25,
    authoring_prior:'VERIFIED_DIRECT_SKILL',
    authoring_provenance_digest:d('9'),
    evidence_refs:['PHASE36_REVIEWED_LIFECYCLE'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  const currentGovernance=createRsiSkillLibraryGovernance({
    governance_id:'governance.phase36.reviewed',
    library,
    lifecycle_evidence:[lifecycle],
    admission_exposure_hold_skill_digests:[skill.skill_digest],
    external_library_owner:true,
    authored_by_candidate:false,
  });
  const nextGovernance=createRsiSkillLibraryGovernance({
    governance_id:'governance.phase36.reviewed',
    library,
    lifecycle_evidence:[lifecycle],
    admission_exposure_hold_skill_digests:[],
    external_library_owner:true,
    authored_by_candidate:false,
  });
  const currentRow=currentGovernance.entries.find(row=>row.skill_digest===skill.skill_digest);
  const nextRow=nextGovernance.entries.find(row=>row.skill_digest===skill.skill_digest);
  assert.equal(currentRow.state,'DORMANT_CAP');
  assert.equal(currentRow.admission_exposure_hold,true);
  assert.equal(currentRow.active_for_composition,false);
  assert.equal(nextRow.state,'EXPLORATION_ACTIVE');
  assert.notEqual(nextRow.admission_exposure_hold,true);
  assert.equal(nextRow.active_for_composition,true);
  return {skill,library,currentGovernance,nextGovernance};
}

function admissionProvenance(fx,overrides={}){
  const core={
    schema:'metaengine.rsi.admission-exposure-hold-provenance.v1',
    version:1,
    skill_digest:fx.skill.skill_digest,
    admission_attempt_id:'phase34b.attempt.phase36.reviewed',
    admission_attempt_digest:d('a'),
    admission_certificate_digest:d('b'),
    effect_id_digest:d('c'),
    effect_executor_identity_digest:d('d'),
    idempotency_key_digest:d('e'),
    admitted_successor_library_digest:fx.library.library_digest,
    confirmed_transition_digest:d('f'),
    current_library_digest:fx.library.library_digest,
    current_governance_digest:fx.currentGovernance.governance_digest,
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
    ...overrides,
  };
  return Object.freeze({...core,provenance_digest:dg(core)});
}

function reviewArgs(fx,provenance,overrides={}){
  return {
    review_id:'phase36.reviewed.release.review.1',
    source_sha:sha('a'),
    library:fx.library,
    current_governance:fx.currentGovernance,
    skill_digest:fx.skill.skill_digest,
    admission_provenance:provenance,
    consumer_model_family:'GPT_5_6_SOL',
    environment_fingerprint:'env.phase36.reviewed.windows.chromium',
    task_signature_digest:d('0'),
    routing_context_manifest_digest:d('1'),
    retrieval_profile_digest:d('2'),
    memory_context_digest:d('3'),
    harness_integrity_digest:d('4'),
    benchmark_provenance_digest:d('5'),
    matched_comparison_receipt_digest:d('6'),
    negative_transfer_receipt_digest:d('7'),
    cost_latency_receipt_digest:d('8'),
    source_grounding_receipt_digest:d('9'),
    external_policy_digest:d('0'),
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

function certificateArgs(fx,provenance,review,preview,overrides={}){
  return {
    certificate_id:'phase36.reviewed.certificate.1',
    library:fx.library,
    current_governance:fx.currentGovernance,
    next_governance:fx.nextGovernance,
    release_preview:preview,
    release_review:review,
    admission_provenance:provenance,
    skill_digest:fx.skill.skill_digest,
    shadow_routing_manifest_digest:d('1'),
    no_skill_ablation_receipt_digest:d('2'),
    coalition_ablation_receipt_digest:d('3'),
    bounded_canary_policy_digest:d('4'),
    bounded_canary_result_digest:d('5'),
    shadow_context_count:4,
    shadow_success_count:4,
    shadow_hard_invariants_pass:true,
    no_skill_ablation_pass:true,
    coalition_ablation_pass:true,
    bounded_canary_pass:true,
    canary_effect_mode:'READ_ONLY_SHADOW',
    external_release_certifier_identity_digest:d('9'),
    external_shadow_evaluator_identity_digest:d('a'),
    external_canary_evaluator_identity_digest:d('b'),
    external_release_certifier:true,
    external_shadow_evaluator:true,
    external_canary_evaluator:true,
    authored_by_candidate:false,
    ...overrides,
  };
}

test('Phase36 exact preview changes only held target from dormant to exploration-active without effect authority',()=>{
  const fx=fixture();
  const preview=createRsiSkillExposureReleasePreview({
    library:fx.library,
    current_governance:fx.currentGovernance,
    next_governance:fx.nextGovernance,
    skill_digest:fx.skill.skill_digest,
    external_governance_owner:true,
    authored_by_candidate:false,
  });
  assert.equal(preview.current_state,'DORMANT_CAP');
  assert.equal(preview.next_state,'EXPLORATION_ACTIVE');
  assert.equal(preview.current_admission_exposure_hold,true);
  assert.equal(preview.next_admission_exposure_hold,false);
  assert.equal(preview.active_count_delta,1);
  assert.equal(preview.hold_count_delta,-1);
  assert.equal(preview.only_target_state_changed,true);
  assert.equal(preview.release_authorized,false);
  assert.equal(preview.exposure_effect_performed,false);
  assert.equal(verifyRsiSkillExposureReleasePreview(preview,{
    library:fx.library,
    current_governance:fx.currentGovernance,
    next_governance:fx.nextGovernance,
    skill_digest:fx.skill.skill_digest,
  }).preview_digest,preview.preview_digest);
});

test('Phase36 certificate consumes exact eligible zero-effect review and confirmed admission provenance',()=>{
  const fx=fixture();
  const provenance=admissionProvenance(fx);
  const review=createRsiSkillExposureReleaseReview(reviewArgs(fx,provenance));
  assert.equal(review.state,'ELIGIBLE_FOR_EXTERNAL_EXPOSURE_RELEASE_REVIEW');
  const preview=createRsiSkillExposureReleasePreview({
    library:fx.library,current_governance:fx.currentGovernance,next_governance:fx.nextGovernance,
    skill_digest:fx.skill.skill_digest,external_governance_owner:true,authored_by_candidate:false,
  });
  const cert=createRsiSkillExposureReleaseCertificate(certificateArgs(fx,provenance,review,preview));
  assert.equal(cert.state,'ELIGIBLE_FOR_ONE_ATTEMPT_EXPOSURE_RELEASE');
  assert.equal(cert.eligible_for_one_attempt_exposure_release,true);
  assert.equal(cert.release_review_digest,review.review_digest);
  assert.equal(cert.admission_provenance_digest,provenance.provenance_digest);
  assert.equal(cert.release_preview_digest,preview.preview_digest);
  assert.equal(cert.admission_attempt_digest,provenance.admission_attempt_digest);
  assert.equal(cert.exact_zero_effect_release_review_required,true);
  assert.equal(cert.confirmed_storage_admission_provenance_required,true);
  assert.equal(cert.exact_next_governance_preview_required,true);
  assert.equal(cert.certificate_is_effect_authority,false);
  assert.equal(cert.release_effect_authorized,false);
  assert.equal(cert.release_effect_performed,false);
  assert.equal(cert.browser_authority,false);
  assert.equal(cert.task_authority,false);
  assert.equal(cert.scheduler_authority,false);
  assert.equal(verifyRsiSkillExposureReleaseCertificate(cert,certificateArgs(fx,provenance,review,preview)).certificate_digest,cert.certificate_digest);
});

test('Phase36 certificate rejects an ineligible review and cross-stage identity collapse',()=>{
  const fx=fixture();
  const provenance=admissionProvenance(fx);
  const rejectedReview=createRsiSkillExposureReleaseReview(reviewArgs(fx,provenance,{regression_count:1}));
  assert.equal(rejectedReview.state,'REJECTED_EXPOSURE_RELEASE_REVIEW');
  const preview=createRsiSkillExposureReleasePreview({
    library:fx.library,current_governance:fx.currentGovernance,next_governance:fx.nextGovernance,
    skill_digest:fx.skill.skill_digest,external_governance_owner:true,authored_by_candidate:false,
  });
  assert.throws(
    ()=>createRsiSkillExposureReleaseCertificate(certificateArgs(fx,provenance,rejectedReview,preview)),
    /review_not_eligible_or_mismatched/,
  );

  const eligibleReview=createRsiSkillExposureReleaseReview(reviewArgs(fx,provenance));
  assert.throws(
    ()=>createRsiSkillExposureReleaseCertificate(certificateArgs(fx,provenance,eligibleReview,preview,{
      external_release_certifier_identity_digest:eligibleReview.governance_reviewer_identity_digest,
    })),
    /cross_stage_identity_separation_required/,
  );
  assert.throws(
    ()=>createRsiSkillExposureReleaseCertificate(certificateArgs(fx,provenance,eligibleReview,preview,{
      external_canary_evaluator_identity_digest:provenance.effect_executor_identity_digest,
    })),
    /cross_stage_identity_separation_required/,
  );
});

test('Phase36 certificate remains rejected when extra shadow and canary evidence is incomplete',()=>{
  const fx=fixture();
  const provenance=admissionProvenance(fx);
  const review=createRsiSkillExposureReleaseReview(reviewArgs(fx,provenance));
  const preview=createRsiSkillExposureReleasePreview({
    library:fx.library,current_governance:fx.currentGovernance,next_governance:fx.nextGovernance,
    skill_digest:fx.skill.skill_digest,external_governance_owner:true,authored_by_candidate:false,
  });
  const cases=[
    ['shadow_context_count',2,'INSUFFICIENT_SHADOW_CONTEXTS'],
    ['shadow_success_count',3,'SHADOW_CONTEXT_FAILURE'],
    ['shadow_hard_invariants_pass',false,'SHADOW_HARD_INVARIANT_FAILURE'],
    ['no_skill_ablation_pass',false,'NO_SKILL_ABLATION_FAILURE'],
    ['coalition_ablation_pass',false,'COALITION_ABLATION_FAILURE'],
    ['bounded_canary_pass',false,'BOUNDED_CANARY_FAILURE'],
    ['canary_effect_mode','MUTATING','CANARY_NOT_READ_ONLY_SHADOW'],
  ];
  for(const [field,value,blocker] of cases){
    const cert=createRsiSkillExposureReleaseCertificate(certificateArgs(fx,provenance,review,preview,{
      certificate_id:`phase36.reviewed.reject.${field}`,
      [field]:value,
    }));
    assert.equal(cert.state,'REJECTED_EXPOSURE_RELEASE');
    assert.equal(cert.eligible_for_one_attempt_exposure_release,false);
    assert.ok(cert.blockers.includes(blocker));
    assert.equal(cert.release_effect_authorized,false);
  }
});

test('Phase36 reviewed-certificate trust root keeps effect authority outside certificate',()=>{
  const root=rsiSkillExposureReleaseTrustRootSnapshot();
  assert.equal(root.exact_current_library_required,true);
  assert.equal(root.exact_current_governance_required,true);
  assert.equal(root.exact_next_governance_preview_required,true);
  assert.equal(root.exact_zero_effect_release_review_required,true);
  assert.equal(root.confirmed_storage_admission_provenance_required,true);
  assert.equal(root.release_review_must_be_eligible,true);
  assert.equal(root.held_dormant_skill_required,true);
  assert.equal(root.exploration_only_release,true);
  assert.equal(root.minimum_shadow_context_count,3);
  assert.equal(root.no_skill_ablation_required,true);
  assert.equal(root.coalition_ablation_required,true);
  assert.equal(root.read_only_shadow_canary_required,true);
  assert.equal(root.cross_stage_identity_separation_required,true);
  assert.equal(root.one_attempt_release_required,true);
  assert.equal(root.ambiguous_release_retry_allowed,false);
  assert.equal(root.certificate_is_effect_authority,false);
  assert.equal(root.release_effect_authorized,false);
  assert.equal(root.authority_effect,false);
});
