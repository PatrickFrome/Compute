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
  createRsiLineageBuildReceipt,
  createRsiLineageStructuralProvenance,
  rsiLineageComponentRootForCapsule,
} from '../src/rsi-lineage-structural-provenance.mjs';
import { createRsiGithubAttestationVerificationReceipt } from '../src/rsi-github-attestation-verification-receipt.mjs';
import { createRsiLineageProvenanceAcceptance } from '../src/rsi-lineage-provenance-acceptance.mjs';
import { createRsiSkillLineageContaminationReview } from '../src/rsi-skill-lineage-contamination-review.mjs';
import {
  createRsiExplorationGraduationPreview,
  verifyRsiExplorationGraduationPreview,
  createRsiExplorationGraduationVerifierReceipt,
  createRsiExplorationGraduationStatisticalReceipt,
  createRsiExplorationGraduationCertificate,
  verifyRsiExplorationGraduationCertificate,
  rsiExplorationGraduationCertificateTrustRootSnapshot,
} from '../src/rsi-exploration-graduation-certificate.mjs';

const SOURCE='a'.repeat(40);
const FUTURE_EXECUTOR=d('future-effect-executor');
const CONSUMER=d('consumer-snapshot');
const RETRIEVAL=d('retrieval-profile');
const EVALUATION=d('evaluation-contract');
const PAIRED=d('paired-instance-manifest');
const EXPLORATION_EVIDENCE=d('exploration-evidence-manifest');

function d(label){
  return `sha256:${crypto.createHash('sha256').update(String(label),'utf8').digest('hex')}`;
}

function fixture(){
  const capsule=createRsiSkillCapsule({
    skill_id:'skill.phase37a.fixture',
    version:1,
    parent_skill_digest:null,
    source_candidate_sha:SOURCE,
    role:'ANALYZER',
    input_schema_digest:d('input'),
    output_schema_digest:d('output'),
    implementation_digest:d('implementation'),
    components:[{component_id:'skill.phase37a.fixture.component',artifact_digest:d('component'),kind:'TYPED_TRANSFORM'}],
    capabilities:['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES'],
    max_context_tokens:2048,
    max_output_tokens:512,
    max_invocations:2,
    deterministic_interface:true,
    external_builder:true,
    authored_by_candidate:false,
  });
  const evidence=createRsiSkillEvidence({
    capsule,
    hidden_holdout_digest:d('holdout'),
    evaluator_root_digest:d('library-evaluator'),
    unit_test_digest:d('unit'),
    runtime_feedback_digest:d('runtime'),
    attempt_count:12,
    success_count:10,
    hard_invariants_pass:true,
    verified_for_library:true,
    evidence_refs:['PHASE37A_FIXTURE'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  const library=createRsiVerifiedSkillLibrary({
    library_id:'rsi.skill.library.phase37a.fixture',
    entries:[{capsule,evidence}],
    external_library_owner:true,
    authored_by_candidate:false,
  });
  const lifecycle=createRsiSkillLifecycleEvidence({
    library,
    evidence_id:'window.phase37a.fixture.1',
    skill_digest:capsule.skill_digest,
    window_seq:1,
    generation_start:1,
    generation_end:8,
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
    authoring_provenance_digest:d('authoring'),
    evidence_refs:['PHASE37A_EXPLORATION_EVIDENCE'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  const governanceId='governance.phase37a.fixture';
  const current=createRsiSkillLibraryGovernance({
    governance_id:governanceId,
    library,
    lifecycle_evidence:[lifecycle],
    exploration_only_skill_digests:[capsule.skill_digest],
    external_library_owner:true,
    authored_by_candidate:false,
  });
  const next=createRsiSkillLibraryGovernance({
    governance_id:governanceId,
    library,
    lifecycle_evidence:[lifecycle],
    exploration_only_skill_digests:[],
    external_library_owner:true,
    authored_by_candidate:false,
  });
  return {capsule,library,lifecycle,current,next};
}

function lineage(fx,{semantic='PASS'}={}){
  const builder=d('trusted-builder');
  const recipe=d('trusted-recipe');
  const materials=d('trusted-materials');
  const build=createRsiLineageBuildReceipt({
    receipt_id:'phase37a.build.receipt',
    subject_skill_digest:fx.capsule.skill_digest,
    source_candidate_sha:fx.capsule.source_candidate_sha,
    implementation_digest:fx.capsule.implementation_digest,
    component_root_digest:rsiLineageComponentRootForCapsule(fx.capsule),
    parent_material_skill_digest:null,
    material_manifest_digest:materials,
    product_manifest_digest:d('products'),
    build_recipe_digest:recipe,
    builder_identity_digest:builder,
    external_builder:true,
    authored_by_candidate:false,
  });
  const structural=createRsiLineageStructuralProvenance({
    attestation_id:'phase37a.structural.provenance',
    library:fx.library,
    skill_digest:fx.capsule.skill_digest,
    build_receipt:build,
    expected_builder_identity_digest:builder,
    expected_build_recipe_digest:recipe,
    expected_material_manifest_digest:materials,
    provenance_reviewer_identity_digest:d('provenance-reviewer'),
    effect_executor_identity_digest:FUTURE_EXECUTOR,
    external_provenance_owner:true,
    authored_by_candidate:false,
  });
  const github=createRsiGithubAttestationVerificationReceipt({
    verification_id:'phase37a.github.attestation',
    subject_digest:d('attested-file'),
    provenance_bundle_digest:d('provenance-bundle'),
    structural_attestation_digest:structural.attestation_digest,
    repository:'PatrickFrome/Compute',
    signer_workflow:'.github/workflows/rsi-lineage-provenance-attestation.yml',
    signer_digest:SOURCE,
    source_ref:'refs/heads/main',
    source_digest:SOURCE,
    cert_oidc_issuer:'https://token.actions.githubusercontent.com',
    predicate_type:'https://github.com/PatrickFrome/Compute/attestations/rsi-lineage-provenance/v1',
    trusted_root_digest:d('trusted-root'),
    verification_json_digest:d('verification-json'),
    verification_result_count:1,
    gh_attestation_verify_executed:true,
    signature_verified:true,
    signer_identity_verified:true,
    subject_digest_verified:true,
    trusted_root_verified:true,
    deny_self_hosted_runners:true,
    external_attestation_verifier:true,
    authored_by_candidate:false,
  });
  const provenance=createRsiLineageProvenanceAcceptance({
    acceptance_id:'phase37a.provenance.acceptance',
    library:fx.library,
    skill_digest:fx.capsule.skill_digest,
    structural_attestation:structural,
    github_verification_receipt:github,
    external_provenance_acceptor:true,
    authored_by_candidate:false,
  });
  return createRsiSkillLineageContaminationReview({
    review_id:'phase37a.lineage.review',
    source_sha:SOURCE,
    library:fx.library,
    target_skill_digest:fx.capsule.skill_digest,
    current_governance_digest:fx.current.governance_digest,
    target_consumer_snapshot_digest:CONSUMER,
    effect_executor_identity_digest:FUTURE_EXECUTOR,
    findings:[{
      skill_digest:fx.capsule.skill_digest,
      provenance_acceptance:provenance,
      security_negative_transfer_state:'PASS',
      semantic_consistency_state:semantic,
      negative_transfer_receipt_digest:d('lineage-negative-transfer'),
      semantic_consistency_digest:d('lineage-semantic-consistency'),
      security_reviewer_identity_digest:d('lineage-security-reviewer'),
      semantic_reviewer_identity_digest:d('lineage-semantic-reviewer'),
    }],
    external_review_owner:true,
    authored_by_candidate:false,
  });
}

function preview(fx){
  return createRsiExplorationGraduationPreview({
    preview_id:'phase37a.graduation.preview',
    library:fx.library,
    current_governance:fx.current,
    next_governance:fx.next,
    skill_digest:fx.capsule.skill_digest,
    external_governance_owner:true,
    authored_by_candidate:false,
  });
}

function verifier(fx,kind,verdict='PASS',overrides={}){
  return createRsiExplorationGraduationVerifierReceipt({
    receipt_id:`phase37a.${kind.toLowerCase()}.verifier`,
    kind,
    source_sha:SOURCE,
    skill_digest:fx.capsule.skill_digest,
    library_digest:fx.library.library_digest,
    governance_digest:fx.current.governance_digest,
    target_consumer_snapshot_digest:CONSUMER,
    target_retrieval_profile_digest:RETRIEVAL,
    evaluation_contract_digest:EVALUATION,
    paired_instance_manifest_digest:PAIRED,
    exploration_evidence_manifest_digest:EXPLORATION_EVIDENCE,
    verifier_identity_digest:d(`${kind.toLowerCase()}-verifier-identity`),
    evidence_digest:d(`${kind.toLowerCase()}-verifier-evidence`),
    verdict,
    external_verifier:true,
    authored_by_candidate:false,
    ...overrides,
  });
}

function statistical(fx,overrides={}){
  return createRsiExplorationGraduationStatisticalReceipt({
    receipt_id:'phase37a.statistical.receipt',
    source_sha:SOURCE,
    skill_digest:fx.capsule.skill_digest,
    library_digest:fx.library.library_digest,
    governance_digest:fx.current.governance_digest,
    target_consumer_snapshot_digest:CONSUMER,
    target_retrieval_profile_digest:RETRIEVAL,
    evaluation_contract_digest:EVALUATION,
    paired_instance_manifest_digest:PAIRED,
    exploration_evidence_manifest_digest:EXPLORATION_EVIDENCE,
    stopping_policy_digest:d('stopping-policy'),
    false_admission_error_budget_policy_digest:d('false-admission-policy'),
    anytime_valid_certificate_digest:d('external-anytime-valid-certificate'),
    statistical_acceptor_identity_digest:d('statistical-acceptor-identity'),
    false_admission_alpha_ppm:10000,
    anytime_valid_e_value_microunits:100_000_000,
    paired_sample_count:32,
    minimum_paired_sample_count:16,
    external_statistical_acceptor:true,
    authored_by_candidate:false,
    ...overrides,
  });
}

function certificateArgs(fx,overrides={}){
  return {
    certificate_id:'phase37a.graduation.certificate',
    source_sha:SOURCE,
    library:fx.library,
    current_governance:fx.current,
    next_governance:fx.next,
    preview:preview(fx),
    skill_digest:fx.capsule.skill_digest,
    target_consumer_snapshot_digest:CONSUMER,
    target_retrieval_profile_digest:RETRIEVAL,
    evaluation_contract_digest:EVALUATION,
    exploration_evidence_manifest_digest:EXPLORATION_EVIDENCE,
    process_verifier_receipt:verifier(fx,'PROCESS'),
    outcome_verifier_receipt:verifier(fx,'OUTCOME'),
    statistical_receipt:statistical(fx),
    lineage_review:lineage(fx),
    future_effect_executor_identity_digest:FUTURE_EXECUTOR,
    certificate_owner_identity_digest:d('certificate-owner'),
    retention_receipt_digest:d('retention'),
    retention_non_regression_pass:true,
    cost_latency_receipt_digest:d('cost-latency'),
    cost_budget_pass:true,
    latency_budget_pass:true,
    negative_transfer_receipt_digest:d('certificate-negative-transfer'),
    negative_transfer_clear:true,
    coalition_ablation_receipt_digest:d('coalition-ablation'),
    coalition_ablation_pass:true,
    no_skill_ablation_receipt_digest:d('no-skill-ablation'),
    no_skill_ablation_pass:true,
    source_grounding_receipt_digest:d('source-grounding'),
    source_grounding_pass:true,
    memory_poisoning_scan_digest:d('memory-poisoning'),
    memory_poisoning_scan_pass:true,
    external_certificate_owner:true,
    authored_by_candidate:false,
    ...overrides,
  };
}

test('Phase37A preview proves only EXPLORATION_ACTIVE hold removal to ACTIVE and performs no effect',()=>{
  const fx=fixture();
  const row=preview(fx);
  assert.equal(row.current_state,'EXPLORATION_ACTIVE');
  assert.equal(row.next_state,'ACTIVE');
  assert.equal(row.active_count_delta,0);
  assert.equal(row.exploration_only_hold_count_delta,-1);
  assert.equal(row.only_target_governance_state_changed,true);
  assert.equal(row.preview_only,true);
  assert.equal(row.exploration_hold_release_authorized,false);
  assert.equal(row.full_activation_authorized,undefined);
  assert.equal(row.full_activation_effect_authorized,false);
  assert.equal(row.authority_effect,false);
  assert.equal(verifyRsiExplorationGraduationPreview(row,{
    library:fx.library,
    current_governance:fx.current,
    next_governance:fx.next,
    skill_digest:fx.capsule.skill_digest,
  }).preview_digest,row.preview_digest);
});

test('Phase37A certificate is eligible only with exact paired anytime-valid process outcome and safety evidence',()=>{
  const fx=fixture();
  const cert=createRsiExplorationGraduationCertificate(certificateArgs(fx));
  assert.equal(cert.state,'ELIGIBLE_FOR_PHASE37B_ONE_ATTEMPT_GRADUATION_REVIEW');
  assert.equal(cert.eligible_for_phase37b_one_attempt_graduation_review,true);
  assert.equal(cert.process_verifier_pass,true);
  assert.equal(cert.outcome_verifier_pass,true);
  assert.equal(cert.anytime_valid_acceptance_pass,true);
  assert.equal(cert.lineage_contamination_clear,true);
  assert.equal(cert.certificate_only,true);
  assert.equal(cert.full_activation_authorized,false);
  assert.equal(cert.exploration_hold_release_authorized,false);
  assert.equal(cert.graduation_effect_attempted,false);
  assert.equal(cert.graduation_token,null);
  assert.equal(cert.authority_effect,false);

  const checked=verifyRsiExplorationGraduationCertificate(cert,certificateArgs(fx));
  assert.equal(checked.certificate_digest,cert.certificate_digest);
});

test('Phase37A numerical anytime-valid evidence abstains when threshold or paired sample floor is not met',()=>{
  const fx=fixture();
  const weakStats=statistical(fx,{
    anytime_valid_e_value_microunits:1,
    paired_sample_count:8,
    minimum_paired_sample_count:16,
  });
  assert.equal(weakStats.state,'INSUFFICIENT_EVIDENCE');
  const cert=createRsiExplorationGraduationCertificate(certificateArgs(fx,{statistical_receipt:weakStats}));
  assert.equal(cert.state,'GRADUATION_CERTIFICATE_BLOCKED');
  assert.equal(cert.eligible_for_phase37b_one_attempt_graduation_review,false);
  assert.ok(cert.blockers.includes('INSUFFICIENT_ANYTIME_VALID_EVIDENCE'));
});

test('Phase37A separates controllable verifier failure from uncontrollable environment abstention',()=>{
  const fx=fixture();
  const failed=createRsiExplorationGraduationCertificate(certificateArgs(fx,{
    process_verifier_receipt:verifier(fx,'PROCESS','FAIL'),
  }));
  assert.equal(failed.state,'GRADUATION_CERTIFICATE_BLOCKED');
  assert.ok(failed.blockers.includes('PROCESS_VERIFIER_FAILED'));

  const abstain=createRsiExplorationGraduationCertificate(certificateArgs(fx,{
    outcome_verifier_receipt:verifier(fx,'OUTCOME','UNCONTROLLABLE'),
  }));
  assert.equal(abstain.state,'ABSTAIN_UNCONTROLLABLE_ENVIRONMENT');
  assert.deepEqual(abstain.blockers,['UNCONTROLLABLE_ENVIRONMENT_REQUIRES_FRESH_MATCHED_EVIDENCE']);
  assert.equal(abstain.eligible_for_phase37b_one_attempt_graduation_review,false);
});

test('Phase37A blocks lineage contamination and every retention cost latency transfer ablation grounding safety veto',()=>{
  const fx=fixture();
  const contaminated=createRsiExplorationGraduationCertificate(certificateArgs(fx,{
    lineage_review:lineage(fx,{semantic:'FAIL'}),
  }));
  assert.equal(contaminated.state,'GRADUATION_CERTIFICATE_BLOCKED');
  assert.ok(contaminated.blockers.includes('LINEAGE_CONTAMINATION_NOT_CLEAR'));

  for(const [field,blocker] of [
    ['retention_non_regression_pass','RETENTION_REGRESSION'],
    ['cost_budget_pass','COST_BUDGET_FAILED'],
    ['latency_budget_pass','LATENCY_BUDGET_FAILED'],
    ['negative_transfer_clear','NEGATIVE_TRANSFER_NOT_CLEAR'],
    ['coalition_ablation_pass','COALITION_ABLATION_FAILED'],
    ['no_skill_ablation_pass','NO_SKILL_ABLATION_FAILED'],
    ['source_grounding_pass','SOURCE_GROUNDING_FAILED'],
    ['memory_poisoning_scan_pass','MEMORY_POISONING_SCAN_FAILED'],
  ]){
    const cert=createRsiExplorationGraduationCertificate(certificateArgs(fx,{[field]:false}));
    assert.equal(cert.eligible_for_phase37b_one_attempt_graduation_review,false,field);
    assert.ok(cert.blockers.includes(blocker),field);
  }
});

test('Phase37A fails closed on cross-receipt scope drift and cross-stage identity collapse',()=>{
  const fx=fixture();
  const driftedProcess=verifier(fx,'PROCESS','PASS',{
    target_consumer_snapshot_digest:d('different-consumer'),
  });
  assert.throws(
    ()=>createRsiExplorationGraduationCertificate(certificateArgs(fx,{process_verifier_receipt:driftedProcess})),
    /cross_receipt_target_consumer_snapshot_digest_mismatch/,
  );

  assert.throws(
    ()=>createRsiExplorationGraduationCertificate(certificateArgs(fx,{
      certificate_owner_identity_digest:d('process-verifier-identity'),
    })),
    /cross_stage_identity_separation_required/,
  );
});

test('Phase37A preview rejects direct ACTIVE-without-hold input and non-target governance drift',()=>{
  const fx=fixture();
  assert.throws(
    ()=>createRsiExplorationGraduationPreview({
      preview_id:'phase37a.bad.current',
      library:fx.library,
      current_governance:fx.next,
      next_governance:fx.next,
      skill_digest:fx.capsule.skill_digest,
      external_governance_owner:true,
      authored_by_candidate:false,
    }),
    /current_exploration_state_required/,
  );
});

test('Phase37A certificate verifier rejects any forged activation/effect authority',()=>{
  const fx=fixture();
  const cert=createRsiExplorationGraduationCertificate(certificateArgs(fx));
  assert.throws(
    ()=>verifyRsiExplorationGraduationCertificate({...cert,full_activation_authorized:true},certificateArgs(fx)),
    /certificate_policy_invalid/,
  );
  assert.throws(
    ()=>verifyRsiExplorationGraduationCertificate({...cert,authority_effect:true},certificateArgs(fx)),
    /certificate_authority_effect_invalid/,
  );
});

test('Phase37A trust root keeps graduation certificate outside activation and effect authority',()=>{
  const root=rsiExplorationGraduationCertificateTrustRootSnapshot();
  assert.equal(root.current_exploration_only_hold_required,true);
  assert.equal(root.target_proven_positive_required,true);
  assert.equal(root.paired_same_instances_required,true);
  assert.equal(root.e_value_external_contract_required,true);
  assert.equal(root.process_and_outcome_verifiers_separate,true);
  assert.equal(root.controllable_and_uncontrollable_failures_separate,true);
  assert.equal(root.current_lineage_contamination_clear_required,true);
  assert.equal(root.second_statistical_estimator_created,false);
  assert.equal(root.certificate_is_activation_authority,false);
  assert.equal(root.certificate_is_effect_authority,false);
  assert.equal(root.phase37b_one_attempt_effect_remains_separate,true);
  assert.equal(root.authority_effect,false);
});
