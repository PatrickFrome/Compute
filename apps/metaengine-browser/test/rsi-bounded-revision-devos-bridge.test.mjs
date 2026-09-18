import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createRsiSharedExperienceAdmission,
  createRsiSharedExperienceHypothesis,
} from '../src/rsi-shared-experience-bus.mjs';
import {
  createRsiEvaluationBudgetPlan,
  createRsiEvaluationRoutingRequest,
  verifyRsiArtifactEvaluationRoutingRequest,
} from '../src/rsi-evaluation-budget-router.mjs';
import {
  RsiCandidateExperimentLedger,
  createRsiCandidateExperimentIntent,
  createRsiCandidateExperimentReceipt,
} from '../src/rsi-candidate-experiment-ledger.mjs';
import {
  createRsiBoundedRevisionEnvelope,
  createRsiBoundedRevisionProposal,
} from '../src/rsi-bounded-revision-proposal.mjs';
import {
  createRsiBoundedRevisionDevosBridge,
  verifyRsiBoundedRevisionDevosBridge,
  createRsiBoundedRevisionArtifactReceipt,
  verifyRsiBoundedRevisionArtifactReceipt,
} from '../src/rsi-bounded-revision-devos-bridge.mjs';
import {
  createRsiMaterializedCandidateEvaluationHandoff,
  verifyRsiMaterializedCandidateEvaluationHandoff,
  createRsiMaterializedCandidateExperimentIntent,
  RsiMaterializedCandidateEvaluationHandoffLedger,
  rsiMaterializedEvaluatorGenerationPredecessorAnchor,
  createRsiEvaluatorGenerationRotation,
  verifyRsiEvaluatorGenerationRotation,
  rsiMaterializedCandidateEvaluationHandoffTrustRootSnapshot,
} from '../src/rsi-materialized-candidate-evaluation-handoff.mjs';
import {
  RSI_ISOLATED_CANDIDATE_MATERIALIZATION_SCHEMA,
  prepareRsiIsolatedCandidateBuild,
  verifyRsiIsolatedCandidateBuildPlan,
} from '../src/rsi-isolated-candidate-builder.mjs';
import {
  RsiGenerationScopedOutcomeArchive,
  createRsiGenerationScopedOutcomeEntry,
  verifyRsiGenerationScopedOutcomeEntry,
  rsiGenerationScopedOutcomeFrontierTrustRootSnapshot,
} from '../src/rsi-generation-scoped-outcome-frontier.mjs';
import {
  RsiKnowledgeConsolidationArchive,
  createRsiKnowledgeConsolidationProposal,
  verifyRsiKnowledgeConsolidationProposal,
  createRsiKnowledgeTransferValidation,
  verifyRsiKnowledgeTransferValidation,
  createRsiKnowledgeConsolidationAdmission,
  verifyRsiKnowledgeConsolidationAdmission,
  rsiSlowKnowledgeConsolidationTrustRootSnapshot,
} from '../src/rsi-slow-knowledge-consolidation.mjs';
import {
  RsiConsumerRevalidationArchive,
  createRsiValidatedKnowledgeConsumerHandoff,
  verifyRsiValidatedKnowledgeConsumerHandoff,
  createRsiConsumerLocalRevalidationReceipt,
  verifyRsiConsumerLocalRevalidationReceipt,
  rsiValidatedKnowledgeConsumerHandoffTrustRootSnapshot,
} from '../src/rsi-validated-knowledge-consumer-handoff.mjs';
import {
  createRsiConsolidatedKnowledgeSkillReview,
  verifyRsiConsolidatedKnowledgeSkillReview,
  createRsiConsolidatedKnowledgeSkillEvidenceReview,
  verifyRsiConsolidatedKnowledgeSkillEvidenceReview,
  rsiConsolidatedKnowledgeSkillReviewTrustRootSnapshot,
} from '../src/rsi-consolidated-knowledge-skill-review.mjs';
import {
  createRsiSkillCapsule,
  createRsiSkillEvidence,
  createRsiVerifiedSkillLibrary,
} from '../src/rsi-verified-skill-library.mjs';

const SOURCE='a'.repeat(40);
const CANDIDATE='b'.repeat(40);
const WORKSPACE_ID='11111111-1111-4111-8111-111111111111';
const COORDINATION_WORKSPACE_ID='22222222-2222-4222-8222-222222222222';
const TASK_ID='33333333-3333-4333-8333-333333333333';
const AGENT_ID='agent_00000000-0000-4000-8000-000000000001';
const TAB_ID='tab_00000000-0000-4000-8000-000000000001';

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
}
function dg(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}
function labelDigest(label){return dg({label});}
const PROVENANCE=Object.freeze({
  builder_identity_digest:labelDigest('builder-identity'),
  worker_image_digest:labelDigest('worker-image'),
  toolchain_image_digest:labelDigest('toolchain-image'),
  dependency_material_manifest_digest:labelDigest('dependency-materials'),
  harness_manifest_digest:labelDigest('harness-manifest'),
  capability_manifest_digest:labelDigest('capability-manifest'),
  build_provenance_policy_digest:labelDigest('build-provenance-policy'),
  artifact_signature_policy_digest:labelDigest('artifact-signature-policy'),
  transparency_log_policy_digest:labelDigest('transparency-log-policy'),
});

function revisionFixture(label='one'){
  const hypothesis=createRsiSharedExperienceHypothesis({
    hypothesis_id:`bridge.hypothesis.${label}`,
    source_sha:SOURCE,
    origin_candidate_digest:labelDigest(`origin-candidate-${label}`),
    origin_lineage_digest:labelDigest(`origin-lineage-${label}`),
    sanitized_summary_digest:labelDigest(`summary-${label}`),
    distilled_recipe_digest:labelDigest(`recipe-${label}`),
    supporting_evidence_digest:labelDigest(`support-${label}`),
    counterevidence_digest:labelDigest(`counter-${label}`),
    falsification_test_digest:labelDigest(`falsify-${label}`),
    source_context_digest:labelDigest(`source-context-${label}`),
    local_revalidation_protocol_digest:labelDigest(`revalidate-${label}`),
    negative_transfer_probe_digest:labelDigest(`negative-transfer-${label}`),
    scope_tags:['PLANNING'],
    recipient_group_tags:['CODING'],
    evaluator_cost_units:8,
    expected_information_gain:0.8,
    hidden_data_disclosed:false,
    raw_benchmark_content_included:false,
    raw_verifier_assets_included:false,
    external_synthesizer:true,
    authored_by_candidate:false,
  });
  const admission=createRsiSharedExperienceAdmission({
    admission_id:`bridge.experience.admission.${label}`,
    hypothesis,
    supporting_evidence_verified:true,
    counterevidence_reviewed:true,
    falsification_test_precommitted:true,
    hidden_data_non_disclosure_pass:true,
    recipe_distillation_verified:true,
    context_compatibility_pass:true,
    negative_transfer_probe_pass:true,
    scope_precision_pass:true,
    evaluator_budget_available:true,
    marginal_information_gain_certified:true,
    external_reviewer:true,
    authored_by_candidate:false,
  });
  const request=createRsiEvaluationRoutingRequest({
    request_id:`bridge.request.${label}`,
    hypothesis,
    admission,
    external_measurement_digest:labelDigest(`measurement-${label}`),
    proxy_score_digest:labelDigest(`proxy-${label}`),
    uncertainty:0.8,
    decision_closeness:0.8,
    proxy_reliability_gap:0.2,
    external_measurement_owner:true,
    authored_by_candidate:false,
  });
  const budgetPlan=createRsiEvaluationBudgetPlan({
    plan_id:`bridge.budget-plan.${label}`,
    source_sha:SOURCE,
    requests:[request],
    epoch_budget_units:8,
    external_budget_owner:true,
    authored_by_candidate:false,
  });
  const experimentIntent=createRsiCandidateExperimentIntent({
    intent_id:`bridge.experiment.intent.${label}`,
    request,
    plan:budgetPlan,
    plan_requests:[request],
    hypothesis,
    admission,
    baseline_artifact_digest:labelDigest(`baseline-${label}`),
    candidate_artifact_digest:labelDigest(`candidate-${label}`),
    sealed_task_set_digest:labelDigest(`tasks-${label}`),
    harness_digest:labelDigest(`harness-${label}`),
    evaluator_root_digest:labelDigest(`evaluator-${label}`),
    trial_worker_image_digest:labelDigest(`worker-${label}`),
    resource_budget_digest:labelDigest(`resource-${label}`),
    task_order_digest:labelDigest(`order-${label}`),
    external_experiment_owner:true,
    authored_by_candidate:false,
  });
  const control={
    task_utility:0.70,safety:0.95,security:0.95,
    process_integrity:0.90,outcome_integrity:0.90,efficiency:0.70,
  };
  const treatment={
    task_utility:0.80,safety:0.95,security:0.96,
    process_integrity:0.92,outcome_integrity:0.91,efficiency:0.72,
  };
  const experimentReceipt=createRsiCandidateExperimentReceipt({
    receipt_id:`bridge.experiment.receipt.${label}`,
    intent:experimentIntent,
    control_metrics:control,
    treatment_metrics:treatment,
    control_attempts:1,
    treatment_attempts:1,
    retry_count:0,
    same_tasks_pass:true,
    same_task_order_pass:true,
    harness_identity_pass:true,
    resource_budget_identity_pass:true,
    evaluator_integrity_pass:true,
    trial_isolation_pass:true,
    from_scratch_replay_pass:true,
    contamination_clear:true,
    reward_hack_detected:false,
    blind_retry_detected:false,
    environment_blocker_detected:false,
    controllable_failure_detected:false,
    ambiguous_effect:false,
    evidence_digest:labelDigest(`experiment-evidence-${label}`),
    external_runner:true,
    external_evaluator:true,
    authored_by_candidate:false,
  });
  const envelope=createRsiBoundedRevisionEnvelope({
    envelope_id:`bridge.envelope.${label}`,
    intent:experimentIntent,
    receipt:experimentReceipt,
    experiment_ledger_state_digest:labelDigest(`ledger-${label}`),
    editable_scope_digest:labelDigest(`scope-${label}`),
    preserved_behavior_digest:labelDigest(`preserve-${label}`),
    negative_evidence_root_digest:labelDigest(`negative-${label}`),
    regression_budget_digest:labelDigest(`regression-${label}`),
    validation_plan_digest:labelDigest(`validation-${label}`),
    trust_root_policy_digest:labelDigest(`trust-${label}`),
    evaluator_policy_digest:labelDigest(`eval-policy-${label}`),
    scheduler_policy_digest:labelDigest(`scheduler-${label}`),
    self_update_policy_digest:labelDigest(`self-update-${label}`),
    production_authority_policy_digest:labelDigest(`production-${label}`),
    security_boundary_digest:labelDigest(`security-${label}`),
    max_mutated_files:2,
    max_edit_operations:5,
    max_changed_bytes:4096,
    external_revision_controller:true,
  });
  const proposal=createRsiBoundedRevisionProposal({
    proposal_id:`bridge.proposal.${label}`,
    envelope,
    candidate_revision_spec_digest:labelDigest(`spec-${label}`),
    proposed_child_artifact_identity_digest:labelDigest(`child-${label}`),
    mutation_categories:['VALIDATION'],
    estimated_mutated_files:1,
    estimated_edit_operations:3,
    estimated_changed_bytes:2048,
    expected_preserved_behavior_receipt_digest:labelDigest(`preserve-receipt-${label}`),
    expected_regression_test_root_digest:labelDigest(`regression-tests-${label}`),
    candidate_optimizer_id_digest:labelDigest(`optimizer-${label}`),
    authored_by_optimizer:true,
  });
  return {hypothesis,admission,request,budgetPlan,experimentIntent,experimentReceipt,envelope,proposal};
}

function sourceSnapshot(){
  return {
    schema:'metaengine.devos.packaged-source-snapshot.v1',
    repository:'PatrickFrome/Compute',
    head:SOURCE,
    ref:'refs/heads/integration/metaengine-development-os-v1',
    source_files:['apps/metaengine-browser/src/rsi-shadow-observer.mjs'],
    source_file_count:1,
    bounded:true,
    arbitrary_path_copy:false,
    process_spawn_used:false,
    authority_effect:false,
  };
}

test('Phase27 proposal bridges into existing DevOS experiment plan without a second scheduler or builder',()=>{
  const fx=revisionFixture();
  const approved=[{path:'apps/metaengine-browser/src/rsi-shadow-observer.mjs',change:'MODIFY'}];
  const bridge=createRsiBoundedRevisionDevosBridge({
    envelope:fx.envelope,
    proposal:fx.proposal,
    experiment_intent:fx.experimentIntent,
    experiment_receipt:fx.experimentReceipt,
    mutation_surface:'RSI_IMPROVER',
    approved_mutations:approved,
    approved_mutation_manifest_digest:dg(approved),
    implementation_reviewer_root_digest:labelDigest('implementation-reviewer'),
    ...PROVENANCE,
    external_implementation_reviewer:true,
  });
  const checked=verifyRsiBoundedRevisionDevosBridge(bridge,{
    envelope:fx.envelope,
    proposal:fx.proposal,
    experiment_intent:fx.experimentIntent,
    experiment_receipt:fx.experimentReceipt,
  });
  assert.equal(checked.bridge_digest,bridge.bridge_digest);
  assert.equal(bridge.uses_existing_devos_scheduler,true);
  assert.equal(bridge.uses_existing_isolated_candidate_builder,true);
  assert.equal(bridge.bridge_can_create_workspace,false);
  assert.equal(bridge.bridge_can_materialize_candidate,false);
  assert.equal(bridge.bridge_can_execute_commands,false);
  assert.equal(bridge.bridge_can_promote,false);
  assert.equal(bridge.devos_experiment_plan.requires_existing_devos_scheduler,true);
  assert.equal(bridge.devos_experiment_plan.task_spec.rsi.shadow_only,true);
  assert.equal(bridge.devos_experiment_plan.task_spec.rsi.revision_limits.max_mutated_files,2);
  assert.equal(bridge.authority_effect,false);
});

test('existing isolated candidate builder inherits stricter Phase27 edit budgets from bridge',()=>{
  const fx=revisionFixture('builder');
  const approved=[{path:'apps/metaengine-browser/src/rsi-shadow-observer.mjs',change:'MODIFY'}];
  const bridge=createRsiBoundedRevisionDevosBridge({
    envelope:fx.envelope,
    proposal:fx.proposal,
    experiment_intent:fx.experimentIntent,
    experiment_receipt:fx.experimentReceipt,
    mutation_surface:'RSI_IMPROVER',
    approved_mutations:approved,
    approved_mutation_manifest_digest:dg(approved),
    implementation_reviewer_root_digest:labelDigest('builder-reviewer'),
    ...PROVENANCE,
    external_implementation_reviewer:true,
  });
  const build=prepareRsiIsolatedCandidateBuild({
    experiment_plan:bridge.devos_experiment_plan,
    source_snapshot:sourceSnapshot(),
    mutations:approved,
    requested_backend:'FIRECRACKER',
  });
  verifyRsiIsolatedCandidateBuildPlan(build);
  assert.equal(build.materialization_contract.max_mutated_files,2);
  assert.equal(build.materialization_contract.max_edit_operations,5);
  assert.equal(build.materialization_contract.max_mutated_bytes,4096);
  assert.equal(build.materialization_contract.revision_limits.envelope_digest,fx.envelope.envelope_digest);
  assert.equal(build.materialization_contract.revision_limits.proposal_digest,fx.proposal.proposal_digest);
  assert.equal(build.workspace_contract.authority,'EXISTING_DEVOS_ONLY');
  assert.equal(build.workspace_contract.host_repository_mount_allowed,false);
  assert.equal(build.verification_contract.network_deny_by_default_required,true);
  assert.equal(build.execution_authority,false);
  assert.equal(build.promotion_authority,false);
});

test('bridge refuses more files than Phase27 envelope and requires exact approved manifest digest',()=>{
  const fx=revisionFixture('bounds');
  const tooMany=[
    {path:'apps/metaengine-browser/src/a.mjs',change:'MODIFY'},
    {path:'apps/metaengine-browser/src/b.mjs',change:'MODIFY'},
    {path:'apps/metaengine-browser/src/c.mjs',change:'MODIFY'},
  ];
  assert.throws(()=>createRsiBoundedRevisionDevosBridge({
    envelope:fx.envelope,
    proposal:fx.proposal,
    experiment_intent:fx.experimentIntent,
    experiment_receipt:fx.experimentReceipt,
    mutation_surface:'RSI_IMPROVER',
    approved_mutations:tooMany,
    approved_mutation_manifest_digest:dg(tooMany),
    implementation_reviewer_root_digest:labelDigest('bounds-reviewer'),
    ...PROVENANCE,
    external_implementation_reviewer:true,
  }),/mutations_invalid/);

  const approved=[{path:'apps/metaengine-browser/src/a.mjs',change:'MODIFY'}];
  assert.throws(()=>createRsiBoundedRevisionDevosBridge({
    envelope:fx.envelope,
    proposal:fx.proposal,
    experiment_intent:fx.experimentIntent,
    experiment_receipt:fx.experimentReceipt,
    mutation_surface:'RSI_IMPROVER',
    approved_mutations:approved,
    approved_mutation_manifest_digest:labelDigest('wrong-manifest'),
    implementation_reviewer_root_digest:labelDigest('bounds-reviewer-2'),
    ...PROVENANCE,
    external_implementation_reviewer:true,
  }),/mutation_manifest_digest_mismatch/);
});

test('existing builder still rejects immutable trust-root mutation paths after bridging',()=>{
  const fx=revisionFixture('immutable');
  const approved=[{path:'apps/metaengine-browser/src/rsi-isolated-candidate-builder.mjs',change:'MODIFY'}];
  const bridge=createRsiBoundedRevisionDevosBridge({
    envelope:fx.envelope,
    proposal:fx.proposal,
    experiment_intent:fx.experimentIntent,
    experiment_receipt:fx.experimentReceipt,
    mutation_surface:'RSI_IMPROVER',
    approved_mutations:approved,
    approved_mutation_manifest_digest:dg(approved),
    implementation_reviewer_root_digest:labelDigest('immutable-reviewer'),
    ...PROVENANCE,
    external_implementation_reviewer:true,
  });
  assert.throws(()=>prepareRsiIsolatedCandidateBuild({
    experiment_plan:bridge.devos_experiment_plan,
    source_snapshot:sourceSnapshot(),
    mutations:approved,
  }),/immutable_path_forbidden/);
});

test('legacy DevOS experiment plans without revision limits retain existing builder defaults',()=>{
  const plan={
    schema:'metaengine.rsi.devos-experiment-plan.v1',
    experiment_id:'rsi_exp_0123456789abcdef01234567',
    source_sha:SOURCE,
    target_branch:'work/rsi/legacy-plan',
    task_spec:{
      schema:'metaengine.rsi.devos-experiment-plan.v1',
      rsi:{
        source_sha:SOURCE,
        shadow_only:true,
        mutation_surface:'RSI_IMPROVER',
      },
    },
    requires_existing_devos_scheduler:true,
    lease_created:false,
    agent_assigned:false,
    workspace_bound:false,
    command_created:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  const approved=[{path:'apps/metaengine-browser/src/rsi-shadow-observer.mjs',change:'MODIFY'}];
  const build=prepareRsiIsolatedCandidateBuild({
    experiment_plan:plan,
    source_snapshot:sourceSnapshot(),
    mutations:approved,
  });
  verifyRsiIsolatedCandidateBuildPlan(build);
  assert.equal(build.materialization_contract.max_mutated_files,64);
  assert.equal(build.materialization_contract.max_mutated_bytes,4*1024*1024);
  assert.equal(Object.hasOwn(build.materialization_contract,'max_edit_operations'),false);
  assert.equal(Object.hasOwn(build.materialization_contract,'revision_limits'),false);
});


function goodBindingSnapshot(plan){
  return {
    schema:'metaengine.devos.workspace-binding-snapshot.v1',
    state:'AVAILABLE',
    coordination_workspace_id:COORDINATION_WORKSPACE_ID,
    observed_at:'2026-09-18T19:00:01.000Z',
    bindings:[{
      workspace_id:WORKSPACE_ID,
      workspace_generation:7,
      coordination_workspace_id:COORDINATION_WORKSPACE_ID,
      task_id:TASK_ID,
      claim_id:51,
      point_id:'rsi.phase28.materialize.v1',
      repo_id:'PatrickFrome/Compute',
      base_sha:SOURCE,
      branch_name:plan.target_branch,
      agent_id:AGENT_ID,
      tab_id:TAB_ID,
      target_id:'webcontents:7',
      agent_generation_epoch:31,
      lease_generation:5,
      lease_expires_at:'2026-09-18T19:15:00.000Z',
      lease_current:true,
      state:'READY',
      last_verified_head_sha:SOURCE,
      ambiguity_code:null,
      dirty_hold:false,
      updated_at:'2026-09-18T19:00:00.000Z',
      automatic_retry_allowed:false,
      scheduler_authority:false,
      browser_actuation_authority:false,
      page_data_authority:false,
      authority_effect:false,
    }],
    bounded_rows:64,
    filesystem_paths_exposed:false,
    scheduler_authority:false,
    browser_actuation_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
}

function provenanceBridge(fx,label='receipt'){
  const approved=[{path:'apps/metaengine-browser/src/rsi-shadow-observer.mjs',change:'MODIFY'}];
  return createRsiBoundedRevisionDevosBridge({
    envelope:fx.envelope,
    proposal:fx.proposal,
    experiment_intent:fx.experimentIntent,
    experiment_receipt:fx.experimentReceipt,
    mutation_surface:'RSI_IMPROVER',
    approved_mutations:approved,
    approved_mutation_manifest_digest:dg(approved),
    implementation_reviewer_root_digest:labelDigest(`reviewer-${label}`),
    ...PROVENANCE,
    external_implementation_reviewer:true,
  });
}

function provenanceMaterialization(build){
  return {
    schema:RSI_ISOLATED_CANDIDATE_MATERIALIZATION_SCHEMA,
    plan_id:build.plan_id,
    plan_digest:build.plan_digest,
    experiment_id:build.experiment_id,
    parent_sha:SOURCE,
    candidate_sha:CANDIDATE,
    target_branch:build.target_branch,
    workspace:{
      workspace_id:WORKSPACE_ID,
      isolated:true,
      host_repository_mounted:false,
      linked_git_worktree_exposed:false,
      source_snapshot_read_only:true,
      writable_layer_private:true,
      binding_snapshot:goodBindingSnapshot(build),
    },
    input_manifest_digest:build.source.source_snapshot_digest,
    output_manifest_digest:labelDigest('output-manifest'),
    components:[{
      path:'apps/metaengine-browser/src/rsi-shadow-observer.mjs',
      change:'MODIFY',
      digest:labelDigest('component'),
    }],
    materialized_file_count:1,
    materialized_edit_operations:3,
    materialized_bytes:2048,
    implementation_provenance:{
      builder_identity_digest:PROVENANCE.builder_identity_digest,
      worker_image_digest:PROVENANCE.worker_image_digest,
      toolchain_image_digest:PROVENANCE.toolchain_image_digest,
      dependency_material_manifest_digest:PROVENANCE.dependency_material_manifest_digest,
      harness_manifest_digest:PROVENANCE.harness_manifest_digest,
      capability_manifest_digest:PROVENANCE.capability_manifest_digest,
      build_provenance_digest:labelDigest('build-provenance'),
      artifact_signature_digest:labelDigest('artifact-signature'),
      transparency_log_inclusion_digest:labelDigest('transparency-inclusion'),
      artifact_reconstruction_digest:labelDigest('artifact-reconstruction'),
      protected_root_diff_audit_digest:labelDigest('protected-root-audit'),
      preserved_behavior_review_digest:labelDigest('preserved-behavior-review'),
      materials_complete:true,
      network_isolation_pass:true,
      private_writable_layer_pass:true,
      artifact_reconstruction_pass:true,
      protected_root_diff_audit_pass:true,
      preserved_behavior_review_pass:true,
      external_build_attestation_verified:true,
      artifact_signature_verified:true,
      transparency_log_inclusion_verified:true,
    },
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
}

test('provenance-bound artifact receipt yields evaluation eligibility but never activation authority',()=>{
  const fx=revisionFixture('artifact-receipt');
  const bridge=provenanceBridge(fx,'artifact-receipt');
  const approved=bridge.approved_mutations;
  const build=prepareRsiIsolatedCandidateBuild({
    experiment_plan:bridge.devos_experiment_plan,
    source_snapshot:sourceSnapshot(),
    mutations:approved,
    requested_backend:'FIRECRACKER',
  });
  const materialization=provenanceMaterialization(build);
  const receipt=createRsiBoundedRevisionArtifactReceipt({
    receipt_id:'phase28.artifact.receipt.1',
    bridge,
    envelope:fx.envelope,
    proposal:fx.proposal,
    experiment_intent:fx.experimentIntent,
    experiment_receipt:fx.experimentReceipt,
    build_plan:build,
    materialization_receipt:materialization,
    artifact_digest:labelDigest('artifact-package'),
    provenance_attestation_digest:labelDigest('provenance-attestation'),
    signature_bundle_digest:labelDigest('signature-bundle'),
    transparency_log_entry_digest:labelDigest('transparency-entry'),
    reproducibility_evidence_digest:labelDigest('reproducibility'),
    external_attestor:true,
    authored_by_candidate:false,
  });
  const checked=verifyRsiBoundedRevisionArtifactReceipt(receipt,{
    bridge,
    envelope:fx.envelope,
    proposal:fx.proposal,
    experiment_intent:fx.experimentIntent,
    experiment_receipt:fx.experimentReceipt,
    build_plan:build,
    materialization_receipt:materialization,
  });
  assert.equal(checked.artifact_receipt_digest,receipt.artifact_receipt_digest);
  assert.equal(receipt.candidate_sha,CANDIDATE);
  assert.equal(receipt.workspace_generation,7);
  assert.equal(receipt.lease_generation,5);
  assert.equal(receipt.eligible_for_fresh_paired_evaluation,true);
  assert.equal(receipt.eligible_for_promotion,false);
  assert.equal(receipt.candidate_artifact_is_active,false);
  assert.equal(receipt.authority_effect,false);
});

test('artifact receipt rejects candidate-controlled provenance identity',()=>{
  const fx=revisionFixture('artifact-tamper');
  const bridge=provenanceBridge(fx,'artifact-tamper');
  const build=prepareRsiIsolatedCandidateBuild({
    experiment_plan:bridge.devos_experiment_plan,
    source_snapshot:sourceSnapshot(),
    mutations:bridge.approved_mutations,
    requested_backend:'FIRECRACKER',
  });
  const materialization=provenanceMaterialization(build);
  materialization.implementation_provenance.worker_image_digest=labelDigest('candidate-chosen-worker');
  assert.throws(()=>createRsiBoundedRevisionArtifactReceipt({
    receipt_id:'phase28.artifact.receipt.tamper',
    bridge,
    envelope:fx.envelope,
    proposal:fx.proposal,
    experiment_intent:fx.experimentIntent,
    experiment_receipt:fx.experimentReceipt,
    build_plan:build,
    materialization_receipt:materialization,
    artifact_digest:labelDigest('artifact-package-tamper'),
    provenance_attestation_digest:labelDigest('provenance-attestation-tamper'),
    signature_bundle_digest:labelDigest('signature-bundle-tamper'),
    transparency_log_entry_digest:labelDigest('transparency-entry-tamper'),
    reproducibility_evidence_digest:labelDigest('reproducibility-tamper'),
    external_attestor:true,
    authored_by_candidate:false,
  }),/provenance_identity_mismatch/);
});


function phase28ArtifactFixture(label='phase29'){
  const fx=revisionFixture(label);
  const bridge=provenanceBridge(fx,label);
  const build=prepareRsiIsolatedCandidateBuild({
    experiment_plan:bridge.devos_experiment_plan,
    source_snapshot:sourceSnapshot(),
    mutations:bridge.approved_mutations,
    requested_backend:'FIRECRACKER',
  });
  const materialization=provenanceMaterialization(build);
  const artifactReceipt=createRsiBoundedRevisionArtifactReceipt({
    receipt_id:`phase28.artifact.receipt.${label}`,
    bridge,
    envelope:fx.envelope,
    proposal:fx.proposal,
    experiment_intent:fx.experimentIntent,
    experiment_receipt:fx.experimentReceipt,
    build_plan:build,
    materialization_receipt:materialization,
    artifact_digest:labelDigest(`${label}-artifact-package`),
    provenance_attestation_digest:labelDigest(`${label}-provenance-attestation`),
    signature_bundle_digest:labelDigest(`${label}-signature-bundle`),
    transparency_log_entry_digest:labelDigest(`${label}-transparency-entry`),
    reproducibility_evidence_digest:labelDigest(`${label}-reproducibility`),
    external_attestor:true,
    authored_by_candidate:false,
  });
  const artifactVerification={
    bridge,
    envelope:fx.envelope,
    proposal:fx.proposal,
    experiment_intent:fx.experimentIntent,
    experiment_receipt:fx.experimentReceipt,
    build_plan:build,
    materialization_receipt:materialization,
  };
  return {...fx,bridge,build,materialization,artifactReceipt,artifactVerification};
}

function phase29Handoff(fx,label='phase29',overrides={}){
  return createRsiMaterializedCandidateEvaluationHandoff({
    artifact_receipt:fx.artifactReceipt,
    artifact_verification:fx.artifactVerification,
    evaluator_root_digest:labelDigest(`${label}-evaluator-root`),
    evaluator_generation_digest:labelDigest(`${label}-evaluator-generation`),
    evaluator_generation_seq:1,
    evaluator_generation_history_anchor_digest:labelDigest(`${label}-generation-history-anchor`),
    evaluation_epoch_digest:labelDigest(`${label}-evaluation-epoch`),
    evaluation_epoch_seq:1,
    sealed_task_set_digest:labelDigest(`${label}-sealed-task-set`),
    evaluation_harness_digest:labelDigest(`${label}-evaluation-harness`),
    trial_worker_image_digest:labelDigest(`${label}-evaluation-worker`),
    resource_budget_digest:labelDigest(`${label}-resource-budget`),
    task_order_digest:labelDigest(`${label}-task-order`),
    acceptance_policy_digest:labelDigest(`${label}-acceptance-policy`),
    stopping_policy_digest:labelDigest(`${label}-stopping-policy`),
    hidden_holdout_root_digest:labelDigest(`${label}-hidden-holdout`),
    safety_suite_root_digest:labelDigest(`${label}-safety-suite`),
    security_suite_root_digest:labelDigest(`${label}-security-suite`),
    external_measurement_digest:labelDigest(`${label}-external-measurement`),
    proxy_score_digest:labelDigest(`${label}-proxy-score`),
    uncertainty:0.9,
    decision_closeness:0.8,
    proxy_reliability_gap:0.3,
    evaluator_cost_units:8,
    expected_information_gain:0.9,
    external_evaluation_owner:true,
    authored_by_candidate:false,
    ...overrides,
  });
}

test('Phase29 provenance-bound child re-enters only the existing fresh budget and paired experiment planes',()=>{
  const fx=phase28ArtifactFixture('phase29-loop');
  const handoff=phase29Handoff(fx,'phase29-loop');
  const verified=verifyRsiMaterializedCandidateEvaluationHandoff(handoff,{
    artifact_receipt:fx.artifactReceipt,
    artifact_verification:fx.artifactVerification,
  });
  const request=verifyRsiArtifactEvaluationRoutingRequest(verified.fresh_evaluation_request);
  assert.equal(request.phase28_artifact_receipt_digest,fx.artifactReceipt.artifact_receipt_digest);
  assert.equal(request.parent_artifact_digest,fx.envelope.parent_candidate_artifact_digest);
  assert.equal(request.candidate_artifact_digest,fx.artifactReceipt.artifact_digest);
  assert.equal(request.fresh_budget_epoch_required,true);
  assert.equal(request.prior_budget_reuse_allowed,false);
  assert.equal(request.acceptance_assets_frozen,true);
  assert.equal(request.sealed_task_set_digest,handoff.sealed_task_set_digest);
  assert.equal(request.harness_digest,handoff.evaluation_harness_digest);
  assert.equal(request.trial_worker_image_digest,handoff.trial_worker_image_digest);
  assert.equal(request.resource_budget_digest,handoff.resource_budget_digest);
  assert.equal(request.task_order_digest,handoff.task_order_digest);
  assert.equal(request.threshold_policy_digest,handoff.acceptance_policy_digest);
  assert.equal(request.stopping_policy_digest,handoff.stopping_policy_digest);
  assert.equal(request.hidden_holdout_root_digest,handoff.hidden_holdout_root_digest);
  assert.equal(request.safety_suite_root_digest,handoff.safety_suite_root_digest);
  assert.equal(request.security_suite_root_digest,handoff.security_suite_root_digest);
  assert.equal(request.evaluator_generation_seq,handoff.evaluator_generation_seq);
  assert.equal(request.evaluator_generation_history_anchor_digest,handoff.evaluator_generation_history_anchor_digest);
  assert.equal(request.evaluation_epoch_seq,handoff.evaluation_epoch_seq);
  assert.equal(request.evaluator_generation_sequence_external,true);
  assert.equal(request.evaluation_epoch_sequence_external,true);
  assert.equal(request.evaluator_generation_history_anchor_external,true);
  assert.equal(request.candidate_can_choose_evaluator,false);
  assert.equal(request.candidate_can_choose_evaluator_generation_seq,false);
  assert.equal(request.candidate_can_choose_evaluation_epoch_seq,false);
  assert.equal(request.candidate_can_choose_generation_history_anchor,false);
  assert.equal(request.candidate_can_choose_hidden_holdout,false);
  assert.equal(request.candidate_can_choose_safety_suite,false);
  assert.equal(request.candidate_can_choose_security_suite,false);
  assert.ok(request.scope_tags.includes('SAFETY'));
  assert.ok(request.scope_tags.includes('SECURITY'));
  assert.ok(request.scope_tags.includes('HIDDEN_HOLDOUT'));

  const freshPlan=createRsiEvaluationBudgetPlan({
    plan_id:'phase29.eval.budget.loop',
    source_sha:SOURCE,
    requests:[request],
    epoch_budget_units:8,
    external_budget_owner:true,
    authored_by_candidate:false,
  });
  assert.equal(freshPlan.state,'EVALUATION_BUDGET_ROUTED');
  assert.equal(freshPlan.safety_floor_satisfied,true);
  assert.deepEqual(freshPlan.selected_request_digests,[request.request_digest]);

  const intent=createRsiMaterializedCandidateExperimentIntent({
    handoff,
    handoff_verification:{artifact_receipt:fx.artifactReceipt,artifact_verification:fx.artifactVerification},
    fresh_budget_plan:freshPlan,
    fresh_plan_requests:[request],
    intent_id:'phase29.paired.intent.loop',
    external_experiment_owner:true,
    authored_by_candidate:false,
  });
  assert.equal(intent.evaluation_request_kind,'MATERIALIZED_CANDIDATE');
  assert.equal(intent.phase28_artifact_receipt_digest,fx.artifactReceipt.artifact_receipt_digest);
  assert.equal(intent.baseline_artifact_digest,handoff.parent_artifact_digest);
  assert.equal(intent.candidate_artifact_digest,handoff.candidate_artifact_digest);
  assert.equal(intent.evaluator_root_digest,handoff.evaluator_root_digest);
  assert.equal(intent.evaluator_generation_digest,handoff.evaluator_generation_digest);
  assert.equal(intent.evaluator_generation_seq,handoff.evaluator_generation_seq);
  assert.equal(intent.evaluator_generation_history_anchor_digest,handoff.evaluator_generation_history_anchor_digest);
  assert.equal(intent.evaluation_epoch_digest,handoff.evaluation_epoch_digest);
  assert.equal(intent.evaluation_epoch_seq,handoff.evaluation_epoch_seq);
  assert.equal(intent.sealed_task_set_digest,handoff.sealed_task_set_digest);
  assert.equal(intent.harness_digest,handoff.evaluation_harness_digest);
  assert.equal(intent.trial_worker_image_digest,handoff.trial_worker_image_digest);
  assert.equal(intent.resource_budget_digest,handoff.resource_budget_digest);
  assert.equal(intent.task_order_digest,handoff.task_order_digest);
  assert.equal(intent.threshold_policy_digest,handoff.acceptance_policy_digest);
  assert.equal(intent.stopping_policy_digest,handoff.stopping_policy_digest);
  assert.equal(intent.hidden_holdout_root_digest,handoff.hidden_holdout_root_digest);
  assert.equal(intent.safety_suite_root_digest,handoff.safety_suite_root_digest);
  assert.equal(intent.security_suite_root_digest,handoff.security_suite_root_digest);
  assert.equal(intent.acceptance_assets_frozen,true);
  assert.equal(intent.max_attempts_per_arm,1);
  assert.equal(intent.max_retries,0);
  assert.equal(intent.execution_authority,false);
  assert.equal(intent.scheduler_authority,false);
  assert.equal(handoff.state,'READY_FOR_FRESH_EVALUATION_BUDGET_ROUTING');
  assert.equal(handoff.eligible_for_promotion,undefined);
  assert.equal(handoff.authority_effect,false);
});

test('Phase29 rejects candidate-owned evaluation and build-worker reuse',()=>{
  const fx=phase28ArtifactFixture('phase29-negative');
  assert.throws(()=>createRsiMaterializedCandidateEvaluationHandoff({
    artifact_receipt:fx.artifactReceipt,
    artifact_verification:fx.artifactVerification,
    evaluator_root_digest:labelDigest('neg-evaluator'),
    evaluator_generation_digest:labelDigest('neg-generation'),
    evaluation_epoch_digest:labelDigest('neg-epoch'),
    sealed_task_set_digest:labelDigest('neg-tasks'),
    evaluation_harness_digest:labelDigest('neg-harness'),
    trial_worker_image_digest:labelDigest('neg-worker'),
    resource_budget_digest:labelDigest('neg-budget'),
    task_order_digest:labelDigest('neg-order'),
    acceptance_policy_digest:labelDigest('neg-acceptance'),
    stopping_policy_digest:labelDigest('neg-stopping'),
    hidden_holdout_root_digest:labelDigest('neg-hidden'),
    safety_suite_root_digest:labelDigest('neg-safety'),
    security_suite_root_digest:labelDigest('neg-security'),
    external_measurement_digest:labelDigest('neg-measurement'),
    proxy_score_digest:labelDigest('neg-proxy'),
    uncertainty:0.9,decision_closeness:0.8,proxy_reliability_gap:0.2,
    evaluator_cost_units:8,expected_information_gain:0.8,
    external_evaluation_owner:false,
    authored_by_candidate:true,
  }),/external_owner_required/);

  assert.throws(()=>phase29Handoff(fx,'worker-reuse',{
    trial_worker_image_digest:fx.artifactReceipt.worker_image_digest,
  }),/build_and_evaluation_worker_must_differ/);
});


test('Phase29 underlying router and paired ledger reject policy rehash and direct acceptance-asset drift',()=>{
  const fx=phase28ArtifactFixture('phase29-bypass');
  const handoff=phase29Handoff(fx,'phase29-bypass');
  const request=handoff.fresh_evaluation_request;

  const tampered=structuredClone(request);
  tampered.candidate_can_choose_hidden_holdout=true;
  const requestCore=structuredClone(tampered);
  delete requestCore.request_digest;
  tampered.request_digest=dg(requestCore);
  assert.throws(()=>verifyRsiArtifactEvaluationRoutingRequest(tampered),/artifact_request_policy_invalid/);

  const freshPlan=createRsiEvaluationBudgetPlan({
    plan_id:'phase29.eval.budget.bypass',
    source_sha:SOURCE,
    requests:[request],
    epoch_budget_units:8,
    external_budget_owner:true,
    authored_by_candidate:false,
  });
  assert.throws(()=>createRsiCandidateExperimentIntent({
    intent_id:'phase29.paired.intent.direct-drift',
    request,
    plan:freshPlan,
    plan_requests:[request],
    baseline_artifact_digest:handoff.parent_artifact_digest,
    candidate_artifact_digest:handoff.candidate_artifact_digest,
    sealed_task_set_digest:labelDigest('phase29-bypass-different-tasks'),
    harness_digest:handoff.evaluation_harness_digest,
    evaluator_root_digest:handoff.evaluator_root_digest,
    trial_worker_image_digest:handoff.trial_worker_image_digest,
    resource_budget_digest:handoff.resource_budget_digest,
    task_order_digest:handoff.task_order_digest,
    external_experiment_owner:true,
    authored_by_candidate:false,
  }),/sealed_tasks_mismatch/);
});

test('Phase29 rejects stale budget reuse and evaluator root aliasing',()=>{
  const fx=phase28ArtifactFixture('phase29-stale');
  const handoff=phase29Handoff(fx,'phase29-stale');
  assert.throws(()=>createRsiMaterializedCandidateExperimentIntent({
    handoff,
    handoff_verification:{artifact_receipt:fx.artifactReceipt,artifact_verification:fx.artifactVerification},
    fresh_budget_plan:fx.budgetPlan,
    fresh_plan_requests:[fx.request],
    intent_id:'phase29.paired.intent.stale',
    external_experiment_owner:true,
    authored_by_candidate:false,
  }),/request_not_selected|prior_budget_reuse_forbidden|request_schema|request_digest/);

  assert.throws(()=>phase29Handoff(fx,'phase29-alias',{
    evaluator_root_digest:fx.artifactReceipt.provenance_attestation_digest,
  }),/aliases_build_provenance/);
});

test('Phase29 trust root freezes external evaluation assets and zero authority',()=>{
  const root=rsiMaterializedCandidateEvaluationHandoffTrustRootSnapshot();
  assert.equal(root.verified_phase28_artifact_receipt_required,true);
  assert.equal(root.fresh_budget_epoch_required,true);
  assert.equal(root.prior_budget_reuse_allowed,false);
  assert.equal(root.protected_scope_floor_required,true);
  assert.equal(root.evaluator_generation_frozen_per_epoch,true);
  assert.equal(root.evaluator_generation_history_append_only,true);
  assert.equal(root.evaluator_generation_sequence_external,true);
  assert.equal(root.evaluation_epoch_sequence_external,true);
  assert.equal(root.generation_transition_must_be_contiguous,true);
  assert.equal(root.evaluation_epoch_transition_must_be_contiguous,true);
  assert.equal(root.generation_history_anchor_external,true);
  assert.equal(root.exact_phase28_evidence_replay_required,true);
  assert.equal(root.external_rotation_receipt_required,true);
  assert.equal(root.anchor_recalibration_required_on_rotation,true);
  assert.equal(root.build_and_evaluation_workers_must_differ,true);
  assert.equal(root.existing_evaluation_budget_router_only,true);
  assert.equal(root.existing_candidate_experiment_ledger_only,true);
  assert.equal(root.one_attempt_per_arm,true);
  assert.equal(root.blind_retry_forbidden,true);
  assert.equal(root.execution_authority,false);
  assert.equal(root.scheduler_authority,false);
  assert.equal(root.promotion_authority,false);
  assert.equal(root.self_update_authority,false);
  assert.equal(root.authority_effect,false);
});


test('Phase29 handoff ledger is durable-before-visible and tracks contiguous evaluator generations',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase29-handoff-ledger-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'handoffs.json');
  const ledger=new RsiMaterializedCandidateEvaluationHandoffLedger({statePath,source_sha:SOURCE});
  await ledger.init();

  const fx1=phase28ArtifactFixture('phase29-ledger-g1e1');
  const h1=phase29Handoff(fx1,'phase29-ledger-g1e1',{
    evaluator_generation_seq:1,
    evaluation_epoch_seq:1,
    evaluator_generation_history_anchor_digest:labelDigest('phase29-ledger-history-root'),
  });
  assert.equal((await ledger.add({
    handoff:h1,
    artifact_receipt:fx1.artifactReceipt,
    artifact_verification:fx1.artifactVerification,
  })).state,'HANDOFF_RECORDED_EXTERNAL_EVALUATION_REQUIRED');

  const fx2=phase28ArtifactFixture('phase29-ledger-g1e2');
  const h2=phase29Handoff(fx2,'phase29-ledger-g1e2',{
    evaluator_root_digest:h1.evaluator_root_digest,
    evaluator_generation_digest:h1.evaluator_generation_digest,
    evaluator_generation_seq:1,
    evaluator_generation_history_anchor_digest:h1.evaluator_generation_history_anchor_digest,
    evaluation_epoch_seq:2,
  });
  assert.equal((await ledger.add({
    handoff:h2,
    artifact_receipt:fx2.artifactReceipt,
    artifact_verification:fx2.artifactVerification,
  })).handoff_seq,2);

  const fx3=phase28ArtifactFixture('phase29-ledger-g2e1');
  const h3=phase29Handoff(fx3,'phase29-ledger-g2e1',{
    evaluator_generation_seq:2,
    evaluation_epoch_seq:1,
    evaluator_generation_history_anchor_digest:rsiMaterializedEvaluatorGenerationPredecessorAnchor(h2),
  });
  await assert.rejects(()=>ledger.add({
    handoff:h3,
    artifact_receipt:fx3.artifactReceipt,
    artifact_verification:fx3.artifactVerification,
  }),/rotation_invalid/);
  const rotation=createRsiEvaluatorGenerationRotation({
    rotation_id:'phase29.rotation.ledger.g2',
    source_sha:SOURCE,
    previous_evaluator_root_digest:h2.evaluator_root_digest,
    previous_evaluator_generation_digest:h2.evaluator_generation_digest,
    previous_evaluator_generation_seq:h2.evaluator_generation_seq,
    previous_evaluation_epoch_digest:h2.evaluation_epoch_digest,
    previous_evaluation_epoch_seq:h2.evaluation_epoch_seq,
    next_evaluator_root_digest:h3.evaluator_root_digest,
    next_evaluator_generation_digest:h3.evaluator_generation_digest,
    next_evaluator_generation_seq:h3.evaluator_generation_seq,
    next_evaluation_epoch_digest:h3.evaluation_epoch_digest,
    next_evaluation_epoch_seq:h3.evaluation_epoch_seq,
    next_generation_history_anchor_digest:h3.evaluator_generation_history_anchor_digest,
    anchor_recalibration_digest:labelDigest('phase29-ledger-g2-anchor-recalibration'),
    external_rotation_receipt_digest:labelDigest('phase29-ledger-g2-external-rotation'),
    external_generation_owner:true,
    authored_by_candidate:false,
  });
  verifyRsiEvaluatorGenerationRotation(rotation);
  assert.equal((await ledger.add({
    handoff:h3,
    artifact_receipt:fx3.artifactReceipt,
    artifact_verification:fx3.artifactVerification,
    rotation,
  })).handoff_seq,3);

  const snap=ledger.snapshot();
  assert.equal(snap.row_count,3);
  assert.equal(snap.generation_count,2);
  assert.equal(snap.latest_generation_seq,2);
  assert.equal(snap.latest_epoch_seq,1);
  assert.equal(snap.durable_before_visible,true);
  assert.equal(snap.experiment_results_stored_here,false);
  assert.equal(snap.existing_candidate_experiment_ledger_owns_outcomes,true);

  const restored=new RsiMaterializedCandidateEvaluationHandoffLedger({statePath,source_sha:SOURCE});
  await restored.init();
  assert.equal(restored.snapshot().row_count,3);
  assert.equal((await restored.add({
    handoff:h3,
    artifact_receipt:fx3.artifactReceipt,
    artifact_verification:fx3.artifactVerification,
    rotation,
  })).state,'IDEMPOTENT');
});

test('Phase29 handoff ledger persistence failure cannot publish phantom handoff',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase29-handoff-crash-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'handoffs.json');
  const ledger=new RsiMaterializedCandidateEvaluationHandoffLedger({statePath,source_sha:SOURCE});
  await ledger.init();
  const fx=phase28ArtifactFixture('phase29-ledger-crash');
  const handoff=phase29Handoff(fx,'phase29-ledger-crash',{
    evaluator_generation_seq:1,
    evaluation_epoch_seq:1,
    evaluator_generation_history_anchor_digest:labelDigest('phase29-ledger-crash-anchor'),
  });

  await fs.mkdir(statePath);
  await assert.rejects(()=>ledger.add({
    handoff,
    artifact_receipt:fx.artifactReceipt,
    artifact_verification:fx.artifactVerification,
  }));
  assert.equal(ledger.snapshot().row_count,0);
  await fs.rm(statePath,{recursive:true,force:true});

  const restored=new RsiMaterializedCandidateEvaluationHandoffLedger({statePath,source_sha:SOURCE});
  await restored.init();
  assert.equal(restored.snapshot().row_count,0);
});

test('Phase29 handoff ledger rejects generation gaps, reorder and self-rehashed policy weakening',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase29-handoff-replay-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'handoffs.json');
  const ledger=new RsiMaterializedCandidateEvaluationHandoffLedger({statePath,source_sha:SOURCE});
  await ledger.init();

  const fx1=phase28ArtifactFixture('phase29-replay-g1e1');
  const h1=phase29Handoff(fx1,'phase29-replay-g1e1',{
    evaluator_generation_seq:1,evaluation_epoch_seq:1,
    evaluator_generation_history_anchor_digest:labelDigest('phase29-replay-history'),
  });
  await ledger.add({handoff:h1,artifact_receipt:fx1.artifactReceipt,artifact_verification:fx1.artifactVerification});

  const fxGap=phase28ArtifactFixture('phase29-replay-g3e1');
  const gap=phase29Handoff(fxGap,'phase29-replay-g3e1',{
    evaluator_generation_seq:3,evaluation_epoch_seq:1,
    evaluator_generation_history_anchor_digest:rsiMaterializedEvaluatorGenerationPredecessorAnchor(h1),
  });
  await assert.rejects(()=>ledger.add({
    handoff:gap,
    artifact_receipt:fxGap.artifactReceipt,
    artifact_verification:fxGap.artifactVerification,
  }),/generation_sequence_gap/);

  const fx2=phase28ArtifactFixture('phase29-replay-g1e2');
  const h2=phase29Handoff(fx2,'phase29-replay-g1e2',{
    evaluator_root_digest:h1.evaluator_root_digest,
    evaluator_generation_digest:h1.evaluator_generation_digest,
    evaluator_generation_seq:1,evaluation_epoch_seq:2,
    evaluator_generation_history_anchor_digest:h1.evaluator_generation_history_anchor_digest,
  });
  await ledger.add({handoff:h2,artifact_receipt:fx2.artifactReceipt,artifact_verification:fx2.artifactVerification});

  const raw=JSON.parse(await fs.readFile(statePath,'utf8'));

  const weakened=structuredClone(raw);
  weakened.rows[0].handoff.handoff_can_execute_evaluation=true;
  const handoffCore=structuredClone(weakened.rows[0].handoff);
  delete handoffCore.evaluation_handoff_digest;
  weakened.rows[0].handoff.evaluation_handoff_digest=dg(handoffCore);
  const weakenedCore=structuredClone(weakened);
  delete weakenedCore.state_digest;
  weakened.state_digest=dg(weakenedCore);
  const weakenedPath=path.join(dir,'weakened.json');
  await fs.writeFile(weakenedPath,JSON.stringify(weakened),'utf8');
  const weakenedLedger=new RsiMaterializedCandidateEvaluationHandoffLedger({statePath:weakenedPath,source_sha:SOURCE});
  await assert.rejects(()=>weakenedLedger.init(),/handoff_policy_invalid/);

  const reordered=structuredClone(raw);
  reordered.rows=[reordered.rows[1],reordered.rows[0]];
  const reorderedCore=structuredClone(reordered);
  delete reorderedCore.state_digest;
  reordered.state_digest=dg(reorderedCore);
  const reorderedPath=path.join(dir,'reordered.json');
  await fs.writeFile(reorderedPath,JSON.stringify(reordered),'utf8');
  const reorderedLedger=new RsiMaterializedCandidateEvaluationHandoffLedger({statePath:reorderedPath,source_sha:SOURCE});
  await assert.rejects(()=>reorderedLedger.init(),/handoff_sequence_gap/);
});


test('Phase29 handoff ledger restart replays exact Phase28 evidence and rejects self-rehashed artifact tamper',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase29-exact-phase28-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'handoffs.json');
  const ledger=new RsiMaterializedCandidateEvaluationHandoffLedger({statePath,source_sha:SOURCE});
  await ledger.init();
  const fx=phase28ArtifactFixture('phase29-exact-phase28');
  const handoff=phase29Handoff(fx,'phase29-exact-phase28',{
    evaluator_generation_seq:1,
    evaluation_epoch_seq:1,
    evaluator_generation_history_anchor_digest:labelDigest('phase29-exact-phase28-history'),
  });
  await ledger.add({handoff,artifact_receipt:fx.artifactReceipt,artifact_verification:fx.artifactVerification});

  const persisted=JSON.parse(await fs.readFile(statePath,'utf8'));
  persisted.rows[0].artifact_receipt.candidate_self_attestation_accepted=true;
  const receiptCore=structuredClone(persisted.rows[0].artifact_receipt);
  delete receiptCore.artifact_receipt_digest;
  persisted.rows[0].artifact_receipt.artifact_receipt_digest=dg(receiptCore);
  const stateCore=structuredClone(persisted);
  delete stateCore.state_digest;
  persisted.state_digest=dg(stateCore);
  await fs.writeFile(statePath,JSON.stringify(persisted),'utf8');

  const restored=new RsiMaterializedCandidateEvaluationHandoffLedger({statePath,source_sha:SOURCE});
  await assert.rejects(()=>restored.init(),/artifact_receipt_policy_invalid|artifact_receipt_digest_mismatch|artifact_receipt_mismatch|artifact_binding_mismatch/);
});

test('Phase29 evaluator generation rotation is externally witnessed and exact-bound to predecessor and successor',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase29-rotation-binding-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const ledger=new RsiMaterializedCandidateEvaluationHandoffLedger({statePath:path.join(dir,'handoffs.json'),source_sha:SOURCE});
  await ledger.init();
  const fx1=phase28ArtifactFixture('phase29-rotation-bind-g1');
  const h1=phase29Handoff(fx1,'phase29-rotation-bind-g1',{
    evaluator_generation_seq:1,evaluation_epoch_seq:1,
    evaluator_generation_history_anchor_digest:labelDigest('phase29-rotation-bind-history'),
  });
  await ledger.add({handoff:h1,artifact_receipt:fx1.artifactReceipt,artifact_verification:fx1.artifactVerification});

  const fx2=phase28ArtifactFixture('phase29-rotation-bind-g2');
  const h2=phase29Handoff(fx2,'phase29-rotation-bind-g2',{
    evaluator_generation_seq:2,evaluation_epoch_seq:1,
    evaluator_generation_history_anchor_digest:rsiMaterializedEvaluatorGenerationPredecessorAnchor(h1),
  });
  const wrong=createRsiEvaluatorGenerationRotation({
    rotation_id:'phase29.rotation.wrong',
    source_sha:SOURCE,
    previous_evaluator_root_digest:h1.evaluator_root_digest,
    previous_evaluator_generation_digest:h1.evaluator_generation_digest,
    previous_evaluator_generation_seq:1,
    previous_evaluation_epoch_digest:h1.evaluation_epoch_digest,
    previous_evaluation_epoch_seq:1,
    next_evaluator_root_digest:labelDigest('wrong-next-root'),
    next_evaluator_generation_digest:h2.evaluator_generation_digest,
    next_evaluator_generation_seq:2,
    next_evaluation_epoch_digest:h2.evaluation_epoch_digest,
    next_evaluation_epoch_seq:1,
    next_generation_history_anchor_digest:h2.evaluator_generation_history_anchor_digest,
    anchor_recalibration_digest:labelDigest('phase29-rotation-bind-anchor'),
    external_rotation_receipt_digest:labelDigest('phase29-rotation-bind-receipt'),
    external_generation_owner:true,
    authored_by_candidate:false,
  });
  await assert.rejects(()=>ledger.add({
    handoff:h2,
    artifact_receipt:fx2.artifactReceipt,
    artifact_verification:fx2.artifactVerification,
    rotation:wrong,
  }),/rotation_binding_mismatch/);
  assert.equal(ledger.snapshot().row_count,1);
});


function evaluatedPhase29(label,{
  generation='generation-a',
  generationSeq=1,
  epochSeq=1,
  outcome='SUPPORTED',
  evaluatorRoot=null,
  historyAnchor=null,
  epochDigest=null,
}={}){
  const fx=phase28ArtifactFixture(label);
  const handoff=phase29Handoff(fx,label,{
    evaluator_root_digest:evaluatorRoot??labelDigest(`${generation}-evaluator-root`),
    evaluator_generation_digest:labelDigest(`${generation}-evaluator-generation`),
    evaluator_generation_seq:generationSeq,
    evaluator_generation_history_anchor_digest:historyAnchor??labelDigest(`${generation}-generation-history-anchor`),
    evaluation_epoch_digest:epochDigest??labelDigest(`${generation}-epoch-${epochSeq}`),
    evaluation_epoch_seq:epochSeq,
  });
  const request=handoff.fresh_evaluation_request;
  const plan=createRsiEvaluationBudgetPlan({
    plan_id:`phase29.history.plan.${label}`,
    source_sha:SOURCE,
    requests:[request],
    epoch_budget_units:8,
    external_budget_owner:true,
    authored_by_candidate:false,
  });
  const intent=createRsiMaterializedCandidateExperimentIntent({
    handoff,
    handoff_verification:{artifact_receipt:fx.artifactReceipt,artifact_verification:fx.artifactVerification},
    fresh_budget_plan:plan,
    fresh_plan_requests:[request],
    intent_id:`phase29.history.intent.${label}`,
    external_experiment_owner:true,
    authored_by_candidate:false,
  });
  const control={
    task_utility:0.70,safety:0.95,security:0.95,
    process_integrity:0.90,outcome_integrity:0.90,efficiency:0.70,
  };
  let treatment={
    task_utility:0.80,safety:0.95,security:0.96,
    process_integrity:0.92,outcome_integrity:0.91,efficiency:0.72,
  };
  if(outcome==='NO_MATERIAL')treatment={...control};
  if(outcome==='REJECTED')treatment={...treatment,safety:0.80};
  const receipt=createRsiCandidateExperimentReceipt({
    receipt_id:`phase29.history.receipt.${label}`,
    intent,
    control_metrics:control,
    treatment_metrics:treatment,
    control_attempts:1,
    treatment_attempts:1,
    retry_count:0,
    same_tasks_pass:true,
    same_task_order_pass:true,
    harness_identity_pass:true,
    resource_budget_identity_pass:true,
    evaluator_integrity_pass:true,
    trial_isolation_pass:true,
    from_scratch_replay_pass:true,
    contamination_clear:true,
    reward_hack_detected:false,
    blind_retry_detected:false,
    environment_blocker_detected:outcome==='ENVIRONMENT',
    controllable_failure_detected:false,
    ambiguous_effect:outcome==='AMBIGUOUS',
    evidence_digest:labelDigest(`phase29-history-evidence-${label}`),
    external_runner:true,
    external_evaluator:true,
    authored_by_candidate:false,
  });
  return {fx,handoff,request,plan,intent,receipt};
}

test('Phase29 existing experiment ledger retains every outcome class inside one evaluator generation',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase29-generation-history-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const ledger=new RsiCandidateExperimentLedger({statePath:path.join(dir,'ledger.json'),source_sha:SOURCE});
  await ledger.init();

  for(const [label,outcome] of [
    ['supported','SUPPORTED'],
    ['no-material','NO_MATERIAL'],
    ['rejected','REJECTED'],
    ['environment','ENVIRONMENT'],
    ['ambiguous','AMBIGUOUS'],
  ]){
    const row=evaluatedPhase29(`history-${label}`,{
      generation:'shared-generation',
      generationSeq:1,
      epochSeq:1,
      outcome,
    });
    await ledger.add({intent:row.intent,receipt:row.receipt});
  }

  const snap=ledger.snapshot();
  assert.equal(snap.materialized_candidate_outcome_count,5);
  assert.equal(snap.evaluation_generation_count,1);
  assert.equal(snap.all_materialized_outcome_classes_retained,true);
  assert.equal(snap.evaluator_dependent_verdict_reuse_across_generation_allowed,false);
  const generation=snap.evaluation_generation_history[0];
  assert.equal(generation.generation_sequence,1);
  assert.equal(generation.outcome_count,5);
  assert.equal(generation.state_counts.supported,1);
  assert.equal(generation.state_counts.no_material_improvement,1);
  assert.equal(generation.state_counts.rejected,1);
  assert.equal(generation.state_counts.inconclusive_environment,1);
  assert.equal(generation.state_counts.inconclusive_ambiguous,1);
  assert.equal(generation.negative_outcomes_retained,true);
});

test('Phase29 evaluator generations advance monotonically and cannot roll back or drift root',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase29-generation-monotonic-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const ledger=new RsiCandidateExperimentLedger({statePath:path.join(dir,'ledger.json'),source_sha:SOURCE});
  await ledger.init();

  const a1=evaluatedPhase29('generation-a-one',{generation:'generation-a',generationSeq:1,epochSeq:1});
  const b1=evaluatedPhase29('generation-b-one',{generation:'generation-b',generationSeq:2,epochSeq:1});
  await ledger.add({intent:a1.intent,receipt:a1.receipt});
  await ledger.add({intent:b1.intent,receipt:b1.receipt});
  assert.equal(ledger.snapshot().evaluation_generation_count,2);

  const rollback=evaluatedPhase29('generation-a-return',{generation:'generation-a',generationSeq:1,epochSeq:2});
  await assert.rejects(
    ()=>ledger.add({intent:rollback.intent,receipt:rollback.receipt}),
    /generation_history_rollback_detected/,
  );

  const drift=evaluatedPhase29('generation-b-root-drift',{
    generation:'generation-b',
    generationSeq:2,
    epochSeq:1,
    evaluatorRoot:labelDigest('generation-b-different-evaluator-root'),
  });
  await assert.rejects(
    ()=>ledger.add({intent:drift.intent,receipt:drift.receipt}),
    /evaluator_root_drift/,
  );
  assert.equal(ledger.snapshot().row_count,2);
});

test('Phase29 generation history is durable-before-visible and restart rejects forged derived history',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase29-generation-durable-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'ledger.json');
  const ledger=new RsiCandidateExperimentLedger({statePath,source_sha:SOURCE});
  await ledger.init();

  const first=evaluatedPhase29('generation-durable',{generation:'generation-durable'});
  await fs.mkdir(statePath);
  await assert.rejects(()=>ledger.add({intent:first.intent,receipt:first.receipt}));
  assert.equal(ledger.snapshot().row_count,0);
  assert.equal(ledger.snapshot().evaluation_generation_count,0);
  await fs.rm(statePath,{recursive:true,force:true});

  await ledger.add({intent:first.intent,receipt:first.receipt});
  const raw=JSON.parse(await fs.readFile(statePath,'utf8'));
  raw.evaluation_generation_history[0].state_counts.supported=99;
  const core=structuredClone(raw);
  delete core.state_digest;
  raw.state_digest=dg(core);
  const forgedPath=path.join(dir,'forged-ledger.json');
  await fs.writeFile(forgedPath,JSON.stringify(raw),'utf8');

  const restored=new RsiCandidateExperimentLedger({statePath:forgedPath,source_sha:SOURCE});
  await assert.rejects(()=>restored.init(),/ledger_derived_state_mismatch/);
});



test('Phase29 outcome history rejects sequence gaps and generation-anchor drift',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase29-sequence-binding-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const ledger=new RsiCandidateExperimentLedger({statePath:path.join(dir,'ledger.json'),source_sha:SOURCE});
  await ledger.init();

  const g1=evaluatedPhase29('sequence-g1',{generation:'seq-a',generationSeq:1,epochSeq:1});
  await ledger.add({intent:g1.intent,receipt:g1.receipt});

  const gap=evaluatedPhase29('sequence-g3',{generation:'seq-c',generationSeq:3,epochSeq:1});
  await assert.rejects(()=>ledger.add({intent:gap.intent,receipt:gap.receipt}),/generation_sequence_gap/);

  const epoch2=evaluatedPhase29('sequence-g1-e2',{
    generation:'seq-a',
    generationSeq:1,
    epochSeq:2,
    historyAnchor:g1.intent.evaluator_generation_history_anchor_digest,
    evaluatorRoot:g1.intent.evaluator_root_digest,
  });
  await ledger.add({intent:epoch2.intent,receipt:epoch2.receipt});

  const anchorDrift=evaluatedPhase29('sequence-anchor-drift',{
    generation:'seq-a',
    generationSeq:1,
    epochSeq:2,
    historyAnchor:labelDigest('seq-a-forged-history-anchor'),
    evaluatorRoot:g1.intent.evaluator_root_digest,
    epochDigest:epoch2.intent.evaluation_epoch_digest,
  });
  await assert.rejects(()=>ledger.add({intent:anchorDrift.intent,receipt:anchorDrift.receipt}),/anchor_drift/);

  const snap=ledger.snapshot();
  assert.equal(snap.evaluation_generation_count,1);
  assert.equal(snap.evaluation_generation_history[0].evaluator_generation_seq,1);
  assert.deepEqual(snap.evaluation_generation_history[0].evaluation_epoch_sequences,[1,2]);
  assert.equal(
    snap.evaluation_generation_history[0].evaluator_generation_history_anchor_digest,
    g1.intent.evaluator_generation_history_anchor_digest,
  );
});

test('Phase29 artifact request digest commits exact external generation and epoch sequence',()=>{
  const fx=phase28ArtifactFixture('sequence-request-binding');
  const handoff=phase29Handoff(fx,'sequence-request-binding',{
    evaluator_generation_seq:7,
    evaluation_epoch_seq:3,
    evaluator_generation_history_anchor_digest:labelDigest('sequence-request-history-anchor'),
  });
  const request=handoff.fresh_evaluation_request;
  assert.equal(request.evaluator_generation_seq,7);
  assert.equal(request.evaluation_epoch_seq,3);
  assert.equal(request.evaluator_generation_history_anchor_digest,handoff.evaluator_generation_history_anchor_digest);

  const forged={...request,evaluator_generation_seq:8};
  assert.throws(()=>verifyRsiArtifactEvaluationRoutingRequest(forged),/digest_mismatch/);
});


function phase30OutcomeEvidence(label='phase30',{
  state='SUPPORTED_FOR_BOUNDED_REVISION',
  generationSeq=1,
  epochSeq=1,
  generationTag='phase30-generation-a',
  sharedEvaluation=null,
  treatmentOverrides={},
}={}){
  const fx=phase28ArtifactFixture(label);
  const shared=sharedEvaluation||{};
  const evaluatorRoot=shared.evaluator_root_digest??labelDigest(`${generationTag}-evaluator-root`);
  const evaluatorGeneration=shared.evaluator_generation_digest??labelDigest(`${generationTag}-evaluator-generation`);
  const generationAnchor=shared.evaluator_generation_history_anchor_digest??labelDigest(`${generationTag}-history-anchor`);
  const epochDigest=shared.evaluation_epoch_digest??labelDigest(`${generationTag}-epoch-${epochSeq}`);
  const handoff=phase29Handoff(fx,label,{
    evaluator_root_digest:evaluatorRoot,
    evaluator_generation_digest:evaluatorGeneration,
    evaluator_generation_seq:generationSeq,
    evaluator_generation_history_anchor_digest:generationAnchor,
    evaluation_epoch_digest:epochDigest,
    evaluation_epoch_seq:epochSeq,
    ...(shared.sealed_task_set_digest?{sealed_task_set_digest:shared.sealed_task_set_digest}:{}),
    ...(shared.evaluation_harness_digest?{evaluation_harness_digest:shared.evaluation_harness_digest}:{}),
    ...(shared.trial_worker_image_digest?{trial_worker_image_digest:shared.trial_worker_image_digest}:{}),
    ...(shared.resource_budget_digest?{resource_budget_digest:shared.resource_budget_digest}:{}),
    ...(shared.task_order_digest?{task_order_digest:shared.task_order_digest}:{}),
    ...(shared.acceptance_policy_digest?{acceptance_policy_digest:shared.acceptance_policy_digest}:{}),
    ...(shared.stopping_policy_digest?{stopping_policy_digest:shared.stopping_policy_digest}:{}),
    ...(shared.hidden_holdout_root_digest?{hidden_holdout_root_digest:shared.hidden_holdout_root_digest}:{}),
    ...(shared.safety_suite_root_digest?{safety_suite_root_digest:shared.safety_suite_root_digest}:{}),
    ...(shared.security_suite_root_digest?{security_suite_root_digest:shared.security_suite_root_digest}:{}),
  });
  const request=handoff.fresh_evaluation_request;
  const plan=createRsiEvaluationBudgetPlan({
    plan_id:`phase30.eval.plan.${label}`,
    source_sha:SOURCE,
    requests:[request],
    epoch_budget_units:8,
    external_budget_owner:true,
    authored_by_candidate:false,
  });
  const intent=createRsiMaterializedCandidateExperimentIntent({
    handoff,
    handoff_verification:{artifact_receipt:fx.artifactReceipt,artifact_verification:fx.artifactVerification},
    fresh_budget_plan:plan,
    fresh_plan_requests:[request],
    intent_id:`phase30.intent.${label}`,
    external_experiment_owner:true,
    authored_by_candidate:false,
  });
  const control={
    task_utility:0.70,safety:0.95,security:0.95,
    process_integrity:0.90,outcome_integrity:0.90,efficiency:0.70,
  };
  let treatment={
    task_utility:0.80,safety:0.95,security:0.96,
    process_integrity:0.92,outcome_integrity:0.91,efficiency:0.72,
    ...treatmentOverrides,
  };
  const flags={
    environment_blocker_detected:false,
    controllable_failure_detected:false,
    ambiguous_effect:false,
  };
  if(state==='CANDIDATE_EXPERIMENT_REJECTED')treatment={...treatment,safety:0.80};
  if(state==='NO_MATERIAL_IMPROVEMENT')treatment={...control};
  if(state==='INCONCLUSIVE_ENVIRONMENT')flags.environment_blocker_detected=true;
  if(state==='INCONCLUSIVE_AMBIGUOUS')flags.ambiguous_effect=true;
  const receipt=createRsiCandidateExperimentReceipt({
    receipt_id:`phase30.receipt.${label}`,
    intent,
    control_metrics:control,
    treatment_metrics:treatment,
    control_attempts:1,treatment_attempts:1,retry_count:0,
    same_tasks_pass:true,same_task_order_pass:true,harness_identity_pass:true,
    resource_budget_identity_pass:true,evaluator_integrity_pass:true,trial_isolation_pass:true,
    from_scratch_replay_pass:true,contamination_clear:true,reward_hack_detected:false,
    blind_retry_detected:false,...flags,
    evidence_digest:labelDigest(`phase30-evidence-${label}`),
    external_runner:true,external_evaluator:true,authored_by_candidate:false,
  });
  assert.equal(receipt.state,state);
  const handoffRow={
    handoff_seq:1,
    source_sha:SOURCE,
    handoff,
    artifact_receipt:fx.artifactReceipt,
    artifact_verification:fx.artifactVerification,
    rotation:null,
  };
  return {fx,handoff,request,plan,intent,receipt,handoffRow};
}

function phase30Entry(evidence,label,{niches=['CONTROL_FLOW'],...overrides}={}){
  const byState={
    SUPPORTED_FOR_BOUNDED_REVISION:{
      recipe_digest:labelDigest(`phase30-recipe-${label}`),
      watch_out_digest:labelDigest(`phase30-watchout-${label}`),
      sealed_exogenous_acceptance_digest:labelDigest(`phase30-sealed-acceptance-${label}`),
      differential_reference_digest:labelDigest(`phase30-differential-reference-${label}`),
    },
    CANDIDATE_EXPERIMENT_REJECTED:{
      negative_constraint_digest:labelDigest(`phase30-negative-${label}`),
      watch_out_digest:labelDigest(`phase30-watchout-${label}`),
      differential_reference_digest:labelDigest(`phase30-differential-reference-${label}`),
      failure_attribution_digest:labelDigest(`phase30-failure-attribution-${label}`),
    },
    NO_MATERIAL_IMPROVEMENT:{
      low_yield_constraint_digest:labelDigest(`phase30-low-yield-${label}`),
      differential_reference_digest:labelDigest(`phase30-differential-reference-${label}`),
    },
    INCONCLUSIVE_ENVIRONMENT:{
      environment_diagnostic_digest:labelDigest(`phase30-environment-${label}`),
    },
    INCONCLUSIVE_AMBIGUOUS:{
      ambiguity_diagnostic_digest:labelDigest(`phase30-ambiguity-${label}`),
    },
  };
  return createRsiGenerationScopedOutcomeEntry({
    entry_id:`phase30.outcome.${label}`,
    handoff_row:evidence.handoffRow,
    experiment_intent:evidence.intent,
    experiment_receipt:evidence.receipt,
    niche_tags:niches,
    summary_digest:labelDigest(`phase30-summary-${label}`),
    applicability_digest:labelDigest(`phase30-applicability-${label}`),
    counterevidence_digest:labelDigest(`phase30-counterevidence-${label}`),
    trajectory_summary_digest:labelDigest(`phase30-trajectory-summary-${label}`),
    reference_evidence_digest:labelDigest(`phase30-reference-${label}`),
    causal_attribution_digest:labelDigest(`phase30-causal-attribution-${label}`),
    ...byState[evidence.receipt.state],
    external_learning_reviewer:true,
    external_niche_owner:true,
    external_acceptance_owner:true,
    authored_by_candidate:false,
    ...overrides,
  });
}

test('Phase30 maps all immutable Phase26 outcomes into typed zero-authority learning evidence with exact sequence lineage',()=>{
  const cases=[
    ['supported','SUPPORTED_FOR_BOUNDED_REVISION','REUSABLE_RECIPE_CANDIDATE'],
    ['rejected','CANDIDATE_EXPERIMENT_REJECTED','NEGATIVE_CONSTRAINT'],
    ['flat','NO_MATERIAL_IMPROVEMENT','LOW_YIELD_CONSTRAINT'],
    ['environment','INCONCLUSIVE_ENVIRONMENT','ENVIRONMENT_DIAGNOSTIC'],
    ['ambiguous','INCONCLUSIVE_AMBIGUOUS','AMBIGUITY_DIAGNOSTIC'],
  ];
  for(const [label,state,kind] of cases){
    const evidence=phase30OutcomeEvidence(`typed-${label}`,{state,generationSeq:1,epochSeq:1});
    const entry=phase30Entry(evidence,`typed-${label}`);
    verifyRsiGenerationScopedOutcomeEntry(entry,{
      handoff_row:evidence.handoffRow,
      experiment_intent:evidence.intent,
      experiment_receipt:evidence.receipt,
    });
    assert.equal(entry.outcome_class,state);
    assert.equal(entry.learning_kind,kind);
    assert.equal(entry.evaluator_generation_seq,1);
    assert.equal(entry.evaluation_epoch_seq,1);
    assert.equal(entry.evaluator_generation_history_anchor_digest,evidence.handoff.evaluator_generation_history_anchor_digest);
    assert.equal(entry.experiment_receipt_digest,evidence.receipt.receipt_digest);
    assert.equal(entry.handoff_digest,evidence.handoff.evaluation_handoff_digest);
    assert.equal(entry.exact_generation_sequence_bound,true);
    assert.equal(entry.exact_epoch_sequence_bound,true);
    assert.equal(entry.generation_history_anchor_bound,true);
    assert.equal(entry.differential_reference_required,true);
    assert.equal(entry.provenance_root_bound,true);
    assert.equal(entry.external_acceptance_owner,true);
    assert.equal(entry.sealed_exogenous_acceptance_required_for_positive,true);
    assert.equal(entry.failure_attribution_required_for_rejected,true);
    assert.equal(entry.candidate_can_view_sealed_acceptance,false);
    assert.equal(entry.candidate_can_choose_reference,false);
    assert.equal(entry.candidate_can_choose_niche,false);
    if(state==='SUPPORTED_FOR_BOUNDED_REVISION'){
      assert.match(entry.sealed_exogenous_acceptance_digest,/^sha256:/);
      assert.match(entry.differential_reference_digest,/^sha256:/);
    }
    if(state==='CANDIDATE_EXPERIMENT_REJECTED'){
      assert.match(entry.failure_attribution_digest,/^sha256:/);
      assert.match(entry.differential_reference_digest,/^sha256:/);
    }
    assert.equal(entry.trajectory_summary_is_advisory,true);
    assert.equal(entry.causal_attribution_is_advisory,true);
    assert.equal(entry.candidate_can_author_learning,false);
    assert.equal(entry.source_outcome_receipt_stored,false);
    assert.equal(entry.raw_trajectory_stored,false);
    assert.equal(entry.raw_hidden_holdout_stored,false);
    assert.equal(entry.entry_can_mutate_candidate,false);
    assert.equal(entry.entry_can_change_budget,false);
    assert.equal(entry.entry_can_promote,false);
    assert.equal(entry.authority_effect,false);
  }
});

test('Phase30 Pareto frontier is exact generation plus epoch plus niche scoped and has no scalar winner',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase30-exact-frontier-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'frontier.json');
  const evidenceByKey=new Map();
  const resolver=async({handoff_digest,experiment_intent_digest,experiment_receipt_digest})=>
    evidenceByKey.get(`${handoff_digest}|${experiment_intent_digest}|${experiment_receipt_digest}`)??null;
  const archive=new RsiGenerationScopedOutcomeArchive({statePath,source_sha:SOURCE,evidenceResolver:resolver});
  await archive.init();

  const sharedG1E1={
    evaluator_root_digest:labelDigest('phase30-g1-root'),
    evaluator_generation_digest:labelDigest('phase30-g1-generation'),
    evaluator_generation_history_anchor_digest:labelDigest('phase30-g1-anchor'),
    evaluation_epoch_digest:labelDigest('phase30-g1-epoch1'),
    sealed_task_set_digest:labelDigest('phase30-g1-e1-tasks'),
    evaluation_harness_digest:labelDigest('phase30-g1-e1-harness'),
    trial_worker_image_digest:labelDigest('phase30-g1-e1-worker'),
    resource_budget_digest:labelDigest('phase30-g1-e1-budget'),
    task_order_digest:labelDigest('phase30-g1-e1-order'),
    acceptance_policy_digest:labelDigest('phase30-g1-e1-acceptance'),
    stopping_policy_digest:labelDigest('phase30-g1-e1-stopping'),
    hidden_holdout_root_digest:labelDigest('phase30-g1-e1-holdout'),
    safety_suite_root_digest:labelDigest('phase30-g1-e1-safety'),
    security_suite_root_digest:labelDigest('phase30-g1-e1-security'),
  };
  const a=phase30OutcomeEvidence('pareto-a',{generationSeq:1,epochSeq:1,generationTag:'phase30-g1',sharedEvaluation:sharedG1E1});
  const b=phase30OutcomeEvidence('pareto-b',{
    generationSeq:1,epochSeq:1,generationTag:'phase30-g1',sharedEvaluation:sharedG1E1,
    treatmentOverrides:{task_utility:0.75,security:0.955,process_integrity:0.91,outcome_integrity:0.905,efficiency:0.71},
  });
  const e1=phase30Entry(a,'pareto-a',{niches:['CONTROL_FLOW']});
  const e2=phase30Entry(b,'pareto-b',{niches:['CONTROL_FLOW']});
  for(const [evidence,entry] of [[a,e1],[b,e2]]){
    evidenceByKey.set(
      `${entry.handoff_digest}|${entry.experiment_intent_digest}|${entry.experiment_receipt_digest}`,
      {handoff_row:evidence.handoffRow,experiment_intent:evidence.intent,experiment_receipt:evidence.receipt},
    );
    await archive.add({entry,handoff_row:evidence.handoffRow,experiment_intent:evidence.intent,experiment_receipt:evidence.receipt});
  }
  assert.equal(e1.evaluation_contract_digest,e2.evaluation_contract_digest);

  const differentContract=phase30OutcomeEvidence('pareto-different-contract',{
    generationSeq:1,epochSeq:1,generationTag:'phase30-g1',
    sharedEvaluation:{
      ...sharedG1E1,
      sealed_task_set_digest:labelDigest('phase30-g1-e1-different-tasks'),
    },
  });
  const eContract=phase30Entry(differentContract,'pareto-different-contract',{niches:['CONTROL_FLOW']});
  evidenceByKey.set(
    `${eContract.handoff_digest}|${eContract.experiment_intent_digest}|${eContract.experiment_receipt_digest}`,
    {handoff_row:differentContract.handoffRow,experiment_intent:differentContract.intent,experiment_receipt:differentContract.receipt},
  );
  await archive.add({
    entry:eContract,
    handoff_row:differentContract.handoffRow,
    experiment_intent:differentContract.intent,
    experiment_receipt:differentContract.receipt,
  });
  assert.notEqual(eContract.evaluation_contract_digest,e1.evaluation_contract_digest);

  const g1e2=phase30OutcomeEvidence('pareto-epoch2',{
    generationSeq:1,epochSeq:2,generationTag:'phase30-g1',
    sharedEvaluation:{
      ...sharedG1E1,
      evaluation_epoch_digest:labelDigest('phase30-g1-epoch2'),
    },
  });
  const e3=phase30Entry(g1e2,'pareto-epoch2',{niches:['CONTROL_FLOW']});
  evidenceByKey.set(`${e3.handoff_digest}|${e3.experiment_intent_digest}|${e3.experiment_receipt_digest}`,
    {handoff_row:g1e2.handoffRow,experiment_intent:g1e2.intent,experiment_receipt:g1e2.receipt});
  await archive.add({entry:e3,handoff_row:g1e2.handoffRow,experiment_intent:g1e2.intent,experiment_receipt:g1e2.receipt});

  const g2e1=phase30OutcomeEvidence('pareto-generation2',{
    generationSeq:2,epochSeq:1,generationTag:'phase30-g2',
  });
  const e4=phase30Entry(g2e1,'pareto-generation2',{niches:['CONTROL_FLOW']});
  evidenceByKey.set(`${e4.handoff_digest}|${e4.experiment_intent_digest}|${e4.experiment_receipt_digest}`,
    {handoff_row:g2e1.handoffRow,experiment_intent:g2e1.intent,experiment_receipt:g2e1.receipt});
  await archive.add({entry:e4,handoff_row:g2e1.handoffRow,experiment_intent:g2e1.intent,experiment_receipt:g2e1.receipt});

  const frontier=archive.frontier();
  assert.equal(frontier.length,4);
  const first=frontier.find(x=>x.evaluator_generation_seq===1&&x.evaluation_epoch_seq===1
    &&x.evaluation_contract_digest===e1.evaluation_contract_digest&&x.niche==='CONTROL_FLOW');
  assert.deepEqual(first.entry_digests,[e1.entry_digest]);
  assert.ok(frontier.some(x=>x.evaluator_generation_seq===1&&x.evaluation_epoch_seq===1
    &&x.evaluation_contract_digest===eContract.evaluation_contract_digest
    &&x.entry_digests.includes(eContract.entry_digest)));
  assert.equal(first.scalar_winner,null);
  assert.ok(frontier.some(x=>x.evaluator_generation_seq===1&&x.evaluation_epoch_seq===2));
  assert.ok(frontier.some(x=>x.evaluator_generation_seq===2&&x.evaluation_epoch_seq===1));
  assert.ok(frontier.every(x=>x.scalar_winner===null));
  const snap=archive.snapshot();
  assert.equal(snap.generation_count,2);
  assert.equal(snap.epoch_count,3);
  assert.equal(snap.exact_generation_sequence_required,true);
  assert.equal(snap.exact_epoch_sequence_required,true);
  assert.equal(snap.generation_history_anchor_required,true);
  assert.equal(snap.fixed_evaluation_contract_required_for_dominance,true);
  assert.equal(snap.cross_contract_dominance_forbidden,true);
  assert.equal(snap.cross_generation_dominance_forbidden,true);
  assert.equal(snap.cross_epoch_dominance_forbidden,true);
});

test('Phase30 archive is durable-before-visible and restart re-resolves exact upstream evidence',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase30-durable-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'frontier.json');
  const evidence=phase30OutcomeEvidence('durable',{generationSeq:1,epochSeq:1});
  const entry=phase30Entry(evidence,'durable');
  const key=`${entry.handoff_digest}|${entry.experiment_intent_digest}|${entry.experiment_receipt_digest}`;
  const sourceEvidence={handoff_row:evidence.handoffRow,experiment_intent:evidence.intent,experiment_receipt:evidence.receipt};
  const resolver=async(args)=>`${args.handoff_digest}|${args.experiment_intent_digest}|${args.experiment_receipt_digest}`===key?sourceEvidence:null;

  const failed=new RsiGenerationScopedOutcomeArchive({statePath,source_sha:SOURCE,evidenceResolver:resolver});
  await failed.init();
  await fs.mkdir(statePath);
  await assert.rejects(()=>failed.add({entry,...sourceEvidence}));
  assert.equal(failed.snapshot().row_count,0);
  await fs.rm(statePath,{recursive:true,force:true});

  const archive=new RsiGenerationScopedOutcomeArchive({statePath,source_sha:SOURCE,evidenceResolver:resolver});
  await archive.init();
  await archive.add({entry,...sourceEvidence});
  assert.equal(archive.snapshot().row_count,1);

  const restored=new RsiGenerationScopedOutcomeArchive({statePath,source_sha:SOURCE,evidenceResolver:resolver});
  await restored.init();
  assert.equal(restored.snapshot().row_count,1);
  assert.equal((await restored.add({entry,...sourceEvidence})).state,'IDEMPOTENT');
});

test('Phase30 rejects self-rehashed outcome forgery and exact-sequence mismatch',()=>{
  const good=phase30OutcomeEvidence('tamper-good',{generationSeq:1,epochSeq:1});
  const entry=phase30Entry(good,'tamper-good');

  const forgedEntry=structuredClone(entry);
  forgedEntry.outcome_class='NO_MATERIAL_IMPROVEMENT';
  forgedEntry.learning_kind='LOW_YIELD_CONSTRAINT';
  forgedEntry.low_yield_constraint_digest=labelDigest('forged-low-yield');
  forgedEntry.recipe_digest=null;
  forgedEntry.watch_out_digest=null;
  const core=structuredClone(forgedEntry);delete core.entry_digest;
  forgedEntry.entry_digest=dg(core);
  assert.throws(()=>verifyRsiGenerationScopedOutcomeEntry(forgedEntry,{
    handoff_row:good.handoffRow,
    experiment_intent:good.intent,
    experiment_receipt:good.receipt,
  }),/entry_digest_mismatch/);

  const badIntent=structuredClone(good.intent);
  badIntent.evaluator_generation_seq=2;
  const intentCore=structuredClone(badIntent);delete intentCore.intent_digest;
  badIntent.intent_digest=dg(intentCore);
  assert.throws(()=>createRsiGenerationScopedOutcomeEntry({
    entry_id:'phase30.outcome.sequence-mismatch',
    handoff_row:good.handoffRow,
    experiment_intent:badIntent,
    experiment_receipt:good.receipt,
    niche_tags:['CONTROL_FLOW'],
    summary_digest:labelDigest('mismatch-summary'),
    applicability_digest:labelDigest('mismatch-applicability'),
    counterevidence_digest:labelDigest('mismatch-counter'),
    trajectory_summary_digest:labelDigest('mismatch-trajectory'),
    reference_evidence_digest:labelDigest('mismatch-reference'),
    causal_attribution_digest:labelDigest('mismatch-causal'),
    sealed_exogenous_acceptance_digest:labelDigest('mismatch-sealed-acceptance'),
    differential_reference_digest:labelDigest('mismatch-differential-reference'),
    recipe_digest:labelDigest('mismatch-recipe'),
    watch_out_digest:labelDigest('mismatch-watchout'),
    external_learning_reviewer:true,
    external_niche_owner:true,
    external_acceptance_owner:true,
    authored_by_candidate:false,
  }),/artifact_request_binding_invalid|intent_digest_mismatch|evaluator_generation_seq_mismatch/);
});

test('Phase30 trust root freezes exact-sequence quality-diverse learning with zero authority',()=>{
  const root=rsiGenerationScopedOutcomeFrontierTrustRootSnapshot();
  assert.equal(root.existing_candidate_experiment_ledger_is_only_outcome_truth,true);
  assert.equal(root.evaluator_generation_sequence_binding_required,true);
  assert.equal(root.evaluation_epoch_sequence_binding_required,true);
  assert.equal(root.generation_history_anchor_binding_required,true);
  assert.equal(root.provenance_root_binding_required,true);
  assert.equal(root.evaluation_contract_binding_required,true);
  assert.equal(root.fixed_evaluation_contract_required_for_dominance,true);
  assert.equal(root.cross_contract_dominance_forbidden,true);
  assert.equal(root.external_acceptance_owner_required,true);
  assert.equal(root.sealed_exogenous_acceptance_required_for_positive,true);
  assert.equal(root.candidate_can_view_sealed_acceptance,false);
  assert.equal(root.differential_reference_required,true);
  assert.equal(root.candidate_can_choose_reference,false);
  assert.equal(root.candidate_can_choose_niche,false);
  assert.equal(root.failure_attribution_required_for_rejected,true);
  assert.equal(root.fast_candidate_loop_separate,true);
  assert.equal(root.slow_consolidation_loop_advisory_only,true);
  assert.equal(root.trajectory_summary_advisory_only,true);
  assert.equal(root.causal_attribution_advisory_only,true);
  assert.equal(root.quality_diverse_frontier_required,true);
  assert.equal(root.scalar_global_winner_forbidden,true);
  assert.equal(root.cross_generation_dominance_forbidden,true);
  assert.equal(root.cross_epoch_dominance_forbidden,true);
  assert.equal(root.external_revalidation_required_for_cross_generation_comparison,true);
  assert.equal(root.archive_can_mutate_candidate,false);
  assert.equal(root.archive_can_change_budget,false);
  assert.equal(root.archive_can_promote,false);
  assert.equal(root.execution_authority,false);
  assert.equal(root.scheduler_authority,false);
  assert.equal(root.self_update_authority,false);
  assert.equal(root.authority_effect,false);
});


test('Phase30 positive learning requires sealed exogenous acceptance and an independent differential reference',()=>{
  const evidence=phase30OutcomeEvidence('sealed-positive',{generationSeq:1,epochSeq:1});
  assert.throws(()=>createRsiGenerationScopedOutcomeEntry({
    entry_id:'phase30.outcome.missing-sealed',
    handoff_row:evidence.handoffRow,
    experiment_intent:evidence.intent,
    experiment_receipt:evidence.receipt,
    niche_tags:['CONTROL_FLOW'],
    summary_digest:labelDigest('missing-sealed-summary'),
    applicability_digest:labelDigest('missing-sealed-applicability'),
    counterevidence_digest:labelDigest('missing-sealed-counter'),
    trajectory_summary_digest:labelDigest('missing-sealed-trajectory'),
    reference_evidence_digest:labelDigest('missing-sealed-reference'),
    causal_attribution_digest:labelDigest('missing-sealed-causal'),
    recipe_digest:labelDigest('missing-sealed-recipe'),
    watch_out_digest:labelDigest('missing-sealed-watchout'),
    differential_reference_digest:labelDigest('missing-sealed-differential'),
    external_learning_reviewer:true,
    external_niche_owner:true,
    external_acceptance_owner:true,
    authored_by_candidate:false,
  }),/sealed_acceptance_digest_invalid/);

  assert.throws(()=>phase30Entry(evidence,'candidate-owns-acceptance',{
    external_acceptance_owner:false,
  }),/external_learning_ownership_required/);

  const alias=labelDigest('phase30-positive-alias');
  assert.throws(()=>phase30Entry(evidence,'aliased-positive',{
    sealed_exogenous_acceptance_digest:alias,
    differential_reference_digest:alias,
  }),/learning_evidence_roots_must_be_distinct/);
});

test('Phase30 rejected and no-material evidence remain counterevidence and cannot enter the positive frontier',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase30-negative-frontier-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'frontier.json');
  const rejected=phase30OutcomeEvidence('negative-rejected',{state:'CANDIDATE_EXPERIMENT_REJECTED'});
  const flat=phase30OutcomeEvidence('negative-flat',{state:'NO_MATERIAL_IMPROVEMENT'});
  const er=phase30Entry(rejected,'negative-rejected');
  const ef=phase30Entry(flat,'negative-flat');
  const map=new Map([
    [er.experiment_receipt_digest,{handoff_row:rejected.handoffRow,experiment_intent:rejected.intent,experiment_receipt:rejected.receipt}],
    [ef.experiment_receipt_digest,{handoff_row:flat.handoffRow,experiment_intent:flat.intent,experiment_receipt:flat.receipt}],
  ]);
  const archive=new RsiGenerationScopedOutcomeArchive({
    statePath,source_sha:SOURCE,
    evidenceResolver:async({experiment_receipt_digest})=>map.get(experiment_receipt_digest),
  });
  await archive.init();
  await archive.add({entry:er,...map.get(er.experiment_receipt_digest)});
  await archive.add({entry:ef,...map.get(ef.experiment_receipt_digest)});
  assert.equal(archive.frontier().length,0);
  assert.match(er.failure_attribution_digest,/^sha256:/);
  assert.match(er.differential_reference_digest,/^sha256:/);
  assert.match(ef.differential_reference_digest,/^sha256:/);
  assert.equal(archive.snapshot().slow_consolidation_loop_advisory_only,true);
  assert.equal(archive.snapshot().archive_can_change_budget,false);
});

function phase31SourceRows(prefix='phase31', {state='SUPPORTED_FOR_BOUNDED_REVISION'} = {}) {
  const shared={
    evaluator_root_digest:labelDigest(`${prefix}-evaluator-root`),
    evaluator_generation_digest:labelDigest(`${prefix}-generation`),
    evaluator_generation_history_anchor_digest:labelDigest(`${prefix}-generation-anchor`),
    evaluation_epoch_digest:labelDigest(`${prefix}-epoch`),
    sealed_task_set_digest:labelDigest(`${prefix}-tasks`),
    evaluation_harness_digest:labelDigest(`${prefix}-harness`),
    trial_worker_image_digest:labelDigest(`${prefix}-worker`),
    resource_budget_digest:labelDigest(`${prefix}-budget`),
    task_order_digest:labelDigest(`${prefix}-order`),
    acceptance_policy_digest:labelDigest(`${prefix}-acceptance`),
    stopping_policy_digest:labelDigest(`${prefix}-stopping`),
    hidden_holdout_root_digest:labelDigest(`${prefix}-holdout`),
    safety_suite_root_digest:labelDigest(`${prefix}-safety`),
    security_suite_root_digest:labelDigest(`${prefix}-security`),
  };
  const a=phase30OutcomeEvidence(`${prefix}-a`,{state,sharedEvaluation:shared});
  const b=phase30OutcomeEvidence(`${prefix}-b`,{state,sharedEvaluation:shared});
  const ea=phase30Entry(a,`${prefix}-a`,{niches:['CONTROL_FLOW','VALIDATION']});
  const eb=phase30Entry(b,`${prefix}-b`,{niches:['CONTROL_FLOW']});
  return [
    {entry:ea,handoff_row:a.handoffRow,experiment_intent:a.intent,experiment_receipt:a.receipt},
    {entry:eb,handoff_row:b.handoffRow,experiment_intent:b.intent,experiment_receipt:b.receipt},
  ];
}

function phase31Proposal(sourceRows,label='phase31',overrides={}){
  return createRsiKnowledgeConsolidationProposal({
    proposal_id:`phase31.knowledge.proposal.${label}`,
    source_rows:sourceRows,
    consolidation_tags:['CONTROL_FLOW','VALIDATION'],
    consolidated_knowledge_digest:labelDigest(`${label}-knowledge`),
    applicability_contract_digest:labelDigest(`${label}-applicability`),
    watch_out_digest:labelDigest(`${label}-watchout`),
    falsification_protocol_digest:labelDigest(`${label}-falsification`),
    transfer_validation_plan_digest:labelDigest(`${label}-transfer-plan`),
    external_consolidator:true,
    external_scope_owner:true,
    authored_by_candidate:false,
    ...overrides,
  });
}

function phase31Validation(proposal,label='phase31',overrides={}){
  const base={
    validation_id:`phase31.transfer.validation.${label}`,
    proposal,
    heldout_context_digest:labelDigest(`${label}-heldout-context`),
    heldout_task_set_digest:labelDigest(`${label}-heldout-tasks`),
    task_family_digest:labelDigest(`${label}-task-family`),
    transfer_harness_digest:labelDigest(`${label}-transfer-harness`),
    acceptance_policy_digest:labelDigest(`${label}-acceptance-policy`),
    hidden_holdout_root_digest:labelDigest(`${label}-hidden-holdout-root`),
    external_evaluator_root_digest:labelDigest(`${label}-external-evaluator`),
    external_evaluator_generation_digest:labelDigest(`${label}-external-evaluator-generation`),
    matched_reference_plan_digest:labelDigest(`${label}-matched-reference-plan`),
    sealed_transfer_acceptance_digest:labelDigest(`${label}-sealed-transfer-acceptance`),
    control_receipt_digest:labelDigest(`${label}-control`),
    treatment_receipt_digest:labelDigest(`${label}-treatment`),
    transfer_evidence_digest:labelDigest(`${label}-transfer-evidence`),
    source_context_exclusion_pass:true,
    hidden_holdout_pass:true,
    evaluator_integrity_pass:true,
    contamination_clear:true,
    from_scratch_replay_pass:true,
    matched_reference_integrity_pass:true,
    sealed_transfer_acceptance_pass:true,
    task_non_regression:true,
    safety_non_regression:true,
    security_non_regression:true,
    process_non_regression:true,
    outcome_non_regression:true,
    efficiency_non_regression:true,
    strict_transfer_improvement:proposal.knowledge_class==='REUSABLE_RECIPE_CANDIDATE',
    constraint_prediction_confirmed:proposal.knowledge_class==='NEGATIVE_CONSTRAINT'||proposal.knowledge_class==='LOW_YIELD_CONSTRAINT',
    diagnostic_discrimination_pass:proposal.knowledge_class==='ENVIRONMENT_DIAGNOSTIC'||proposal.knowledge_class==='AMBIGUITY_DIAGNOSTIC',
    external_transfer_validator:true,
    external_holdout_owner:true,
    external_reference_owner:true,
    external_acceptance_owner:true,
    authored_by_candidate:false,
  };
  return createRsiKnowledgeTransferValidation({...base,...overrides});
}

test('Phase31 consolidates only diverse same-generation same-kind Phase30 evidence and remains zero-authority',()=>{
  const rows=phase31SourceRows('same-generation');
  const proposal=phase31Proposal(rows,'same-generation');
  const checked=verifyRsiKnowledgeConsolidationProposal(proposal,{source_rows:rows});
  assert.equal(checked.proposal_digest,proposal.proposal_digest);
  assert.equal(proposal.knowledge_class,'REUSABLE_RECIPE_CANDIDATE');
  assert.equal(proposal.source_entry_count,2);
  assert.equal(proposal.source_candidate_count,2);
  assert.equal(proposal.same_evaluator_generation_required,true);
  assert.equal(proposal.same_evaluator_generation_sequence_required,true);
  assert.equal(proposal.same_generation_history_anchor_required,true);
  assert.equal(proposal.same_evaluation_epoch_required,true);
  assert.equal(proposal.same_evaluation_epoch_sequence_required,true);
  assert.equal(proposal.same_evaluation_contract_required,true);
  assert.match(proposal.evaluation_contract_digest,/^sha256:/);
  assert.equal(proposal.source_evidence_preserved_by_digest,true);
  assert.equal(proposal.raw_source_trajectory_copied,false);
  assert.equal(proposal.raw_hidden_holdout_copied,false);
  assert.equal(proposal.proposal_can_write_skill_library,false);
  assert.equal(proposal.proposal_can_write_experience_graph,false);
  assert.equal(proposal.proposal_can_modify_meta_skill_profile,false);
  assert.equal(proposal.proposal_can_schedule_transfer_validation,false);
  assert.equal(proposal.proposal_can_activate_knowledge,false);
  assert.equal(proposal.authority_effect,false);
});

test('Phase31 forbids mixed evaluator generations epochs learning kinds and duplicate candidate evidence',()=>{
  const rows=phase31SourceRows('cross-generation');
  const other=phase31SourceRows('cross-generation-other');
  assert.throws(()=>phase31Proposal([rows[0],other[1]],'cross-generation'),/cross_generation_forbidden/);

  const epochA=phase31SourceRows('cross-epoch');
  const epochB=phase31SourceRows('cross-epoch-b');
  const cloned=structuredClone(epochB[1]);
  cloned.entry.evaluator_generation_digest=epochA[0].entry.evaluator_generation_digest;
  const entryCore=structuredClone(cloned.entry);delete entryCore.entry_digest;
  cloned.entry.entry_digest=dg(entryCore);
  assert.throws(()=>phase31Proposal([epochA[0],cloned],'cross-epoch'),/entry_digest_mismatch|cross_epoch_forbidden/);

  const supported=phase31SourceRows('mixed-kind');
  const rejected=phase31SourceRows('mixed-kind-rejected',{state:'CANDIDATE_EXPERIMENT_REJECTED'});
  const rebased=structuredClone(rejected[1]);
  rebased.entry.evaluator_generation_digest=supported[0].entry.evaluator_generation_digest;
  rebased.entry.evaluation_epoch_digest=supported[0].entry.evaluation_epoch_digest;
  const reCore=structuredClone(rebased.entry);delete reCore.entry_digest;
  rebased.entry.entry_digest=dg(reCore);
  assert.throws(()=>phase31Proposal([supported[0],rebased],'mixed-kind'),/entry_digest_mismatch|mixed_learning_kind_forbidden/);

  const duplicate=[rows[0],structuredClone(rows[0])];
  assert.throws(()=>phase31Proposal(duplicate,'duplicate'),/duplicate_source_evidence|source_diversity_required/);
});

test('Phase31 reusable recipe requires strict held-out transfer improvement plus common non-regression floor',()=>{
  const rows=phase31SourceRows('transfer-recipe');
  const proposal=phase31Proposal(rows,'transfer-recipe');
  const validation=phase31Validation(proposal,'transfer-recipe');
  const checked=verifyRsiKnowledgeTransferValidation(validation,{proposal});
  assert.equal(checked.validation_digest,validation.validation_digest);
  assert.equal(validation.state,'TRANSFER_VALIDATED_ADVISORY_KNOWLEDGE');
  assert.equal(validation.eligible_for_advisory_knowledge_archive,true);
  assert.equal(validation.strict_transfer_improvement,true);
  assert.equal(validation.candidate_can_choose_holdout,false);
  assert.equal(validation.candidate_can_choose_evaluator,false);
  assert.equal(validation.candidate_can_choose_reference,false);
  assert.equal(validation.matched_reference_required,true);
  assert.equal(validation.transfer_evaluation_contract_bound,true);
  assert.match(validation.transfer_evaluation_contract_digest,/^sha256:/);
  assert.equal(validation.validation_can_write_skill_library,false);
  assert.equal(validation.validation_can_activate_knowledge,false);

  const noGain=phase31Validation(proposal,'transfer-no-gain',{strict_transfer_improvement:false});
  assert.equal(noGain.state,'KNOWLEDGE_TRANSFER_REJECTED');
  assert.ok(noGain.blockers.includes('KNOWLEDGE_CLASS_TRANSFER_GOAL_NOT_MET'));

  const safetyRegression=phase31Validation(proposal,'transfer-safety-regression',{safety_non_regression:false});
  assert.equal(safetyRegression.state,'KNOWLEDGE_TRANSFER_REJECTED');
  assert.ok(safetyRegression.blockers.includes('SAFETY_REGRESSION'));
});

test('Phase31 negative constraints require held-out predictive confirmation rather than positive transfer gain',()=>{
  const rows=phase31SourceRows('negative-transfer',{state:'CANDIDATE_EXPERIMENT_REJECTED'});
  const proposal=phase31Proposal(rows,'negative-transfer');
  assert.equal(proposal.knowledge_class,'NEGATIVE_CONSTRAINT');
  const validation=phase31Validation(proposal,'negative-transfer');
  assert.equal(validation.constraint_prediction_confirmed,true);
  assert.equal(validation.state,'TRANSFER_VALIDATED_ADVISORY_KNOWLEDGE');
  const missing=phase31Validation(proposal,'negative-missing',{constraint_prediction_confirmed:false});
  assert.equal(missing.state,'KNOWLEDGE_TRANSFER_REJECTED');
  assert.ok(missing.blockers.includes('KNOWLEDGE_CLASS_TRANSFER_GOAL_NOT_MET'));
});

test('Phase31 requires at least two distinct passed transfer contexts before library-admission review eligibility',()=>{
  const rows=phase31SourceRows('quorum');
  const proposal=phase31Proposal(rows,'quorum');
  const v1=phase31Validation(proposal,'quorum-a');
  assert.throws(()=>createRsiKnowledgeConsolidationAdmission({
    admission_id:'phase31.admission.quorum-one',
    proposal,
    validations:[v1],
    external_admission_owner:true,
    authored_by_candidate:false,
  }),/transfer_validation_quorum_invalid/);

  const v2=phase31Validation(proposal,'quorum-b');
  const admission=createRsiKnowledgeConsolidationAdmission({
    admission_id:'phase31.admission.quorum-two',
    proposal,
    validations:[v1,v2],
    external_admission_owner:true,
    authored_by_candidate:false,
  });
  assert.equal(verifyRsiKnowledgeConsolidationAdmission(admission,{proposal,validations:[v1,v2]}).admission_digest,admission.admission_digest);
  assert.equal(admission.state,'ELIGIBLE_FOR_LIBRARY_ADMISSION_REVIEW');
  assert.equal(admission.passed_transfer_context_count,2);
  assert.equal(admission.zero_observed_negative_transfer,true);
  assert.equal(admission.evaluator_generation_seq,proposal.evaluator_generation_seq);
  assert.equal(admission.evaluation_epoch_seq,proposal.evaluation_epoch_seq);
  assert.equal(admission.evaluation_contract_digest,proposal.evaluation_contract_digest);
  assert.equal(admission.transfer_evaluation_contract_digests.length,2);
  assert.equal(admission.library_admission_token,null);
  assert.equal(admission.admission_can_write_skill_library,false);
  assert.equal(admission.admission_can_write_experience_graph,false);
  assert.equal(admission.admission_can_modify_meta_skill_profile,false);
  assert.equal(admission.admission_can_activate_knowledge,false);

  const duplicateContext=phase31Validation(proposal,'quorum-c',{
    heldout_context_digest:v1.heldout_context_digest,
  });
  assert.throws(()=>createRsiKnowledgeConsolidationAdmission({
    admission_id:'phase31.admission.duplicate-context',
    proposal,
    validations:[v1,duplicateContext],
    external_admission_owner:true,
    authored_by_candidate:false,
  }),/distinct_target_contexts_required/);
});

test('Phase31 consolidation archive is durable-before-visible, source-revalidated on restart and cannot activate knowledge',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase31-consolidation-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'knowledge.json');
  const rows=phase31SourceRows('archive');
  const proposal=phase31Proposal(rows,'archive');
  const validations=[phase31Validation(proposal,'archive-a'),phase31Validation(proposal,'archive-b')];
  const admission=createRsiKnowledgeConsolidationAdmission({
    admission_id:'phase31.admission.archive',
    proposal,
    validations,
    external_admission_owner:true,
    authored_by_candidate:false,
  });
  const resolver=async({source_entry_digests})=>{
    const wanted=new Set(source_entry_digests);
    return rows.filter(r=>wanted.has(r.entry.entry_digest));
  };
  const archive=new RsiKnowledgeConsolidationArchive({statePath,source_sha:SOURCE,evidenceResolver:resolver});
  await archive.init();

  await fs.mkdir(statePath);
  await assert.rejects(()=>archive.add({proposal,validations,admission,source_rows:rows}));
  assert.equal(archive.snapshot().row_count,0);
  await fs.rm(statePath,{recursive:true,force:true});

  assert.equal((await archive.add({proposal,validations,admission,source_rows:rows})).state,'ELIGIBLE_FOR_LIBRARY_ADMISSION_REVIEW');
  const snap=archive.snapshot();
  assert.equal(snap.row_count,1);
  assert.equal(snap.validated_count,1);
  assert.equal(snap.source_outcome_rows_not_copied,true);
  assert.equal(snap.exact_source_evaluation_contract_required,true);
  assert.equal(snap.transfer_evaluation_contracts_preserved,true);
  assert.equal(snap.active_skill_library_digest,null);
  assert.equal(snap.active_meta_skill_profile_digest,null);
  assert.equal(snap.archive_can_write_skill_library,false);
  assert.equal(snap.archive_can_write_experience_graph,false);
  assert.equal(snap.archive_can_modify_meta_skill_profile,false);
  assert.equal(snap.archive_can_activate_knowledge,false);
  assert.equal(snap.archive_can_schedule_work,false);

  const persisted=await fs.readFile(statePath,'utf8');
  assert.equal(persisted.includes('control_metrics'),false);
  assert.equal(persisted.includes('treatment_metrics'),false);
  assert.equal(persisted.includes(rows[0].entry.entry_digest),true);

  const restored=new RsiKnowledgeConsolidationArchive({statePath,source_sha:SOURCE,evidenceResolver:resolver});
  await restored.init();
  assert.equal(restored.snapshot().row_count,1);
  assert.equal((await restored.add({proposal,validations,admission,source_rows:rows})).state,'IDEMPOTENT');
});

test('Phase31 trust root enforces slow external consolidation without authority expansion',()=>{
  const root=rsiSlowKnowledgeConsolidationTrustRootSnapshot();
  assert.equal(root.phase30_generation_scoped_outcome_evidence_required,true);
  assert.equal(root.min_source_entries,2);
  assert.equal(root.source_candidate_diversity_required,true);
  assert.equal(root.same_evaluator_generation_required,true);
  assert.equal(root.same_evaluator_generation_sequence_required,true);
  assert.equal(root.same_generation_history_anchor_required,true);
  assert.equal(root.same_evaluation_epoch_required,true);
  assert.equal(root.same_evaluation_epoch_sequence_required,true);
  assert.equal(root.same_evaluation_contract_required,true);
  assert.equal(root.mixed_learning_kind_forbidden,true);
  assert.equal(root.source_evidence_preserved_by_digest,true);
  assert.equal(root.external_consolidator_required,true);
  assert.equal(root.external_transfer_validator_required,true);
  assert.equal(root.matched_reference_required,true);
  assert.equal(root.transfer_evaluation_contract_binding_required,true);
  assert.equal(root.min_distinct_passed_transfer_contexts,2);
  assert.equal(root.distinct_heldout_task_sets_required,true);
  assert.equal(root.distinct_task_families_required,true);
  assert.equal(root.zero_observed_negative_transfer_required,true);
  assert.equal(root.heldout_source_context_exclusion_required,true);
  assert.equal(root.common_non_regression_floor_required,true);
  assert.equal(root.knowledge_class_specific_transfer_goal_required,true);
  assert.equal(root.skill_library_write_performed_here,false);
  assert.equal(root.experience_graph_write_performed_here,false);
  assert.equal(root.meta_skill_profile_mutation_performed_here,false);
  assert.equal(root.knowledge_activation_performed_here,false);
  assert.equal(root.archive_can_schedule_work,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.slow_knowledge_consolidation_root_digest,/^sha256:[0-9a-f]{64}$/);
});



test('Phase31 refuses consolidation across different fixed Phase30 evaluation contracts even inside one generation and epoch',()=>{
  const rows=phase31SourceRows('fixed-contract');
  const different=phase31SourceRows('fixed-contract-other');
  const transplanted=structuredClone(different[1]);
  transplanted.entry.evaluator_root_digest=rows[0].entry.evaluator_root_digest;
  transplanted.entry.evaluator_generation_digest=rows[0].entry.evaluator_generation_digest;
  transplanted.entry.evaluator_generation_seq=rows[0].entry.evaluator_generation_seq;
  transplanted.entry.evaluator_generation_history_anchor_digest=rows[0].entry.evaluator_generation_history_anchor_digest;
  transplanted.entry.evaluation_epoch_digest=rows[0].entry.evaluation_epoch_digest;
  transplanted.entry.evaluation_epoch_seq=rows[0].entry.evaluation_epoch_seq;
  const core=structuredClone(transplanted.entry);delete core.entry_digest;
  transplanted.entry.entry_digest=dg(core);
  assert.throws(
    ()=>phase31Proposal([rows[0],transplanted],'fixed-contract-mismatch'),
    /entry_digest_mismatch|cross_evaluation_contract_forbidden/,
  );
});


function phase32Fixture(label='phase32',{state='SUPPORTED_FOR_BOUNDED_REVISION',consumerGeneration=null,consumerGenerationSeq=null,consumerGenerationAnchor=null,consumerEpochSeq=null,consumerEpochDigest=null}={}){
  const rows=phase31SourceRows(`${label}-source`,{state});
  const proposal=phase31Proposal(rows,`${label}-proposal`);
  const validations=[
    phase31Validation(proposal,`${label}-transfer-a`),
    phase31Validation(proposal,`${label}-transfer-b`),
  ];
  const admission=createRsiKnowledgeConsolidationAdmission({
    admission_id:`phase32.phase31.admission.${label}`,
    proposal,
    validations,
    external_admission_owner:true,
    authored_by_candidate:false,
  });
  const handoff=createRsiValidatedKnowledgeConsumerHandoff({
    handoff_id:`phase32.consumer.handoff.${label}`,
    proposal,validations,admission,source_rows:rows,
    consumer_model_family:'METAENGINE_RSI',
    consumer_environment_family:'METAENGINE_BROWSER',
    consumer_context_digest:labelDigest(`${label}-consumer-context`),
    consumer_harness_digest:labelDigest(`${label}-consumer-harness`),
    consumer_evaluator_root_digest:labelDigest(`${label}-consumer-evaluator-root`),
    consumer_evaluator_generation_digest:consumerGeneration||proposal.evaluator_generation_digest,
    consumer_evaluator_generation_seq:consumerGenerationSeq||proposal.evaluator_generation_seq,
    consumer_evaluator_generation_history_anchor_digest:consumerGenerationAnchor||proposal.evaluator_generation_history_anchor_digest,
    consumer_evaluation_epoch_seq:consumerEpochSeq||proposal.evaluation_epoch_seq,
    consumer_evaluation_epoch_digest:consumerEpochDigest||proposal.evaluation_epoch_digest,
    consumer_holdout_digest:labelDigest(`${label}-consumer-holdout`),
    matched_reference_plan_digest:labelDigest(`${label}-matched-reference`),
    local_revalidation_protocol_digest:labelDigest(`${label}-local-revalidation`),
    external_consumer_router:true,
    authored_by_candidate:false,
  });
  return {rows,proposal,validations,admission,handoff};
}

function phase32Receipt(fx,label='phase32',overrides={}){
  const base={
    receipt_id:`phase32.consumer.receipt.${label}`,
    handoff:fx.handoff,
    matched_control_receipt_digest:labelDigest(`${label}-control-receipt`),
    treatment_receipt_digest:labelDigest(`${label}-treatment-receipt`),
    local_evidence_digest:labelDigest(`${label}-local-evidence`),
    same_instances_pass:true,
    same_harness_pass:true,
    same_budget_pass:true,
    evaluator_integrity_pass:true,
    hidden_holdout_pass:true,
    contamination_clear:true,
    from_scratch_replay_pass:true,
    hard_invariants_pass:true,
    task_non_regression:true,
    safety_non_regression:true,
    security_non_regression:true,
    efficiency_non_regression:true,
    strict_consumer_improvement:fx.handoff.knowledge_class==='REUSABLE_RECIPE_CANDIDATE',
    constraint_prediction_confirmed:fx.handoff.knowledge_class==='NEGATIVE_CONSTRAINT'||fx.handoff.knowledge_class==='LOW_YIELD_CONSTRAINT',
    diagnostic_discrimination_pass:fx.handoff.knowledge_class==='ENVIRONMENT_DIAGNOSTIC'||fx.handoff.knowledge_class==='AMBIGUITY_DIAGNOSTIC',
    external_consumer_evaluator:true,
    authored_by_candidate:false,
  };
  return createRsiConsumerLocalRevalidationReceipt({...base,...overrides});
}

test('Phase32 routes transfer-validated recipes only to existing verified-skill consumer revalidation',()=>{
  const fx=phase32Fixture('recipe');
  assert.equal(fx.handoff.knowledge_class,'REUSABLE_RECIPE_CANDIDATE');
  assert.equal(fx.handoff.consumer_route,'VERIFIED_SKILL_CANDIDATE_REVALIDATION');
  assert.equal(fx.handoff.state,'ELIGIBLE_FOR_CONSUMER_LOCAL_REVALIDATION');
  assert.equal(fx.handoff.existing_verified_skill_library_only,true);
  assert.equal(fx.handoff.existing_experience_graph_only,true);
  assert.equal(fx.handoff.existing_adaptive_retrieval_only,true);
  assert.equal(fx.handoff.existing_meta_skill_plane_only,true);
  assert.equal(fx.handoff.second_skill_library_created,false);
  assert.equal(fx.handoff.second_experience_graph_created,false);
  assert.equal(fx.handoff.second_scheduler_created,false);
  assert.equal(fx.handoff.matched_no_skill_or_reference_required,true);
  assert.equal(fx.handoff.consumer_can_inherit_source_success,false);
  assert.equal(fx.handoff.handoff_can_write_skill_library,false);
  assert.equal(fx.handoff.handoff_can_activate_knowledge,false);
  assert.equal(verifyRsiValidatedKnowledgeConsumerHandoff(fx.handoff,fx).handoff_digest,fx.handoff.handoff_digest);
});

test('Phase32 class-sensitive routing keeps negative constraints and diagnostics out of positive skill path',()=>{
  const negative=phase32Fixture('negative',{state:'CANDIDATE_EXPERIMENT_REJECTED'});
  assert.equal(negative.handoff.knowledge_class,'NEGATIVE_CONSTRAINT');
  assert.equal(negative.handoff.consumer_route,'EXPERIENCE_COUNTEREVIDENCE_REVALIDATION');
  assert.equal(negative.handoff.matched_no_skill_or_reference_required,false);

  const diagnostic=phase32Fixture('diagnostic',{state:'INCONCLUSIVE_ENVIRONMENT'});
  assert.equal(diagnostic.handoff.knowledge_class,'ENVIRONMENT_DIAGNOSTIC');
  assert.equal(diagnostic.handoff.consumer_route,'ADAPTIVE_RETRIEVAL_DIAGNOSTIC_REVALIDATION');
  assert.equal(diagnostic.handoff.handoff_can_write_experience_graph,false);
});

test('Phase32 never inherits source evaluator-generation verdict into a consumer context',()=>{
  const fx=phase32Fixture('cross-generation',{consumerGeneration:labelDigest('phase32-new-consumer-generation')});
  assert.notEqual(fx.handoff.consumer_evaluator_generation_digest,fx.handoff.source_evaluator_generation_digest);
  assert.equal(fx.handoff.cross_generation_revalidation_required,true);
  assert.equal(fx.handoff.source_generation_verdict_inherited,false);
  assert.equal(fx.handoff.state,'ELIGIBLE_FOR_CONSUMER_LOCAL_REVALIDATION');
});

test('Phase32 positive recipe requires matched local improvement and hard non-regression before existing skill review',()=>{
  const fx=phase32Fixture('positive-local');
  const receipt=phase32Receipt(fx,'positive-local');
  assert.equal(verifyRsiConsumerLocalRevalidationReceipt(receipt,{handoff:fx.handoff}).receipt_digest,receipt.receipt_digest);
  assert.equal(receipt.state,'CONSUMER_REVALIDATED_RECIPE');
  assert.equal(receipt.eligible_existing_consumer_review,'EXISTING_VERIFIED_SKILL_EVIDENCE_REVIEW');
  assert.equal(receipt.negative_transfer_memory,false);
  assert.equal(receipt.receipt_can_write_skill_library,false);
  assert.equal(receipt.receipt_can_activate_skill,false);

  const noBenefit=phase32Receipt(fx,'positive-no-benefit',{strict_consumer_improvement:false});
  assert.equal(noBenefit.state,'CONSUMER_NO_CLEAR_BENEFIT');
  assert.equal(noBenefit.eligible_existing_consumer_review,null);

  const regression=phase32Receipt(fx,'positive-regression',{efficiency_non_regression:false});
  assert.equal(regression.state,'CONSUMER_NEGATIVE_TRANSFER');
  assert.equal(regression.negative_transfer_memory,true);
  assert.equal(regression.suppress_repeat_same_consumer_context,true);
  assert.equal(regression.eligible_existing_consumer_review,null);
});

test('Phase32 counterevidence and diagnostic paths require local confirmation and never become skills',()=>{
  const negative=phase32Fixture('counter',{state:'CANDIDATE_EXPERIMENT_REJECTED'});
  const nr=phase32Receipt(negative,'counter');
  assert.equal(nr.state,'CONSUMER_REVALIDATED_COUNTEREVIDENCE');
  assert.equal(nr.eligible_existing_consumer_review,'EXISTING_EXPERIENCE_COUNTEREVIDENCE_REVIEW');
  assert.equal(nr.receipt_can_write_skill_library,false);

  const diag=phase32Fixture('diag-local',{state:'INCONCLUSIVE_AMBIGUOUS'});
  const dr=phase32Receipt(diag,'diag-local');
  assert.equal(dr.state,'CONSUMER_REVALIDATED_DIAGNOSTIC');
  assert.equal(dr.eligible_existing_consumer_review,'EXISTING_ADAPTIVE_RETRIEVAL_DIAGNOSTIC_REVIEW');
  assert.equal(dr.receipt_can_write_experience_graph,false);
});

test('Phase32 local revalidation rejects invalid harness/evaluator/holdout evidence before consumer review',()=>{
  const fx=phase32Fixture('invalid-local');
  for(const [label,overrides,blocker] of [
    ['instances',{same_instances_pass:false},'INSTANCE_MISMATCH'],
    ['harness',{same_harness_pass:false},'HARNESS_MISMATCH'],
    ['budget',{same_budget_pass:false},'BUDGET_MISMATCH'],
    ['evaluator',{evaluator_integrity_pass:false},'EVALUATOR_INTEGRITY_FAILURE'],
    ['holdout',{hidden_holdout_pass:false},'HIDDEN_HOLDOUT_FAILURE'],
    ['contamination',{contamination_clear:false},'CONTAMINATION_DETECTED'],
    ['replay',{from_scratch_replay_pass:false},'FROM_SCRATCH_REPLAY_FAILURE'],
  ]){
    const receipt=phase32Receipt(fx,`invalid-${label}`,overrides);
    assert.equal(receipt.state,'CONSUMER_REVALIDATION_INVALID');
    assert.ok(receipt.blockers.includes(blocker),blocker);
    assert.equal(receipt.eligible_existing_consumer_review,null);
  }
});

test('Phase32 archive is durable-before-visible, revalidates Phase31 evidence on restart and retains negative transfer',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase32-consumer-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'consumer.json');
  const fx=phase32Fixture('archive');
  const receipt=phase32Receipt(fx,'archive',{safety_non_regression:false});
  const resolver=async()=>({
    proposal:fx.proposal,validations:fx.validations,admission:fx.admission,source_rows:fx.rows,
  });
  const archive=new RsiConsumerRevalidationArchive({statePath,source_sha:SOURCE,evidenceResolver:resolver});
  await archive.init();

  await fs.mkdir(statePath);
  await assert.rejects(()=>archive.add({...fx,receipt}));
  assert.equal(archive.snapshot().row_count,0);
  await fs.rm(statePath,{recursive:true,force:true});

  assert.equal((await archive.add({...fx,receipt})).state,'CONSUMER_NEGATIVE_TRANSFER');
  const snap=archive.snapshot();
  assert.equal(snap.row_count,1);
  assert.equal(snap.negative_transfer_retained,true);
  assert.equal(snap.active_skill_library_digest,null);
  assert.equal(snap.active_experience_graph_digest,null);
  assert.equal(snap.active_meta_skill_profile_digest,null);
  assert.equal(snap.archive_can_write_consumers,false);
  assert.equal(snap.archive_can_activate_skill,false);
  assert.equal(snap.archive_can_schedule_work,false);

  const restored=new RsiConsumerRevalidationArchive({statePath,source_sha:SOURCE,evidenceResolver:resolver});
  await restored.init();
  assert.equal(restored.snapshot().row_count,1);
  assert.equal((await restored.add({...fx,receipt})).state,'IDEMPOTENT');
});

test('Phase32 archive restart rejects self-rehashed authority widening',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase32-tamper-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'consumer.json');
  const fx=phase32Fixture('tamper');
  const receipt=phase32Receipt(fx,'tamper');
  const resolver=async()=>({
    proposal:fx.proposal,validations:fx.validations,admission:fx.admission,source_rows:fx.rows,
  });
  const archive=new RsiConsumerRevalidationArchive({statePath,source_sha:SOURCE,evidenceResolver:resolver});
  await archive.init();
  await archive.add({...fx,receipt});

  const raw=JSON.parse(await fs.readFile(statePath,'utf8'));
  raw.rows[0].handoff.handoff_can_write_skill_library=true;
  const hc=structuredClone(raw.rows[0].handoff);delete hc.handoff_digest;
  raw.rows[0].handoff.handoff_digest=dg(hc);
  raw.rows[0].receipt.handoff_digest=raw.rows[0].handoff.handoff_digest;
  const rc=structuredClone(raw.rows[0].receipt);delete rc.receipt_digest;
  raw.rows[0].receipt.receipt_digest=dg(rc);
  const sc=structuredClone(raw);delete sc.state_digest;
  raw.state_digest=dg(sc);
  await fs.writeFile(statePath,`${JSON.stringify(raw)}\n`,'utf8');

  const restored=new RsiConsumerRevalidationArchive({statePath,source_sha:SOURCE,evidenceResolver:resolver});
  await assert.rejects(()=>restored.init(),/handoff_policy_invalid|handoff_digest_mismatch/);
});

test('Phase32 trust root reuses existing consumer planes and keeps all effects external',()=>{
  const root=rsiValidatedKnowledgeConsumerHandoffTrustRootSnapshot();
  assert.equal(root.phase31_multi_context_admission_required,true);
  assert.equal(root.existing_verified_skill_library_only,true);
  assert.equal(root.existing_experience_graph_only,true);
  assert.equal(root.existing_adaptive_retrieval_only,true);
  assert.equal(root.existing_meta_skill_plane_only,true);
  assert.equal(root.second_skill_library_allowed,false);
  assert.equal(root.second_experience_graph_allowed,false);
  assert.equal(root.second_scheduler_allowed,false);
  assert.equal(root.consumer_local_paired_validation_required,true);
  assert.equal(root.matched_no_skill_or_reference_required_for_recipes,true);
  assert.equal(root.consumer_evaluator_generation_sequence_binding_required,true);
  assert.equal(root.consumer_evaluator_history_anchor_binding_required,true);
  assert.equal(root.consumer_evaluation_epoch_binding_required,true);
  assert.equal(root.consumer_evaluation_contract_binding_required,true);
  assert.equal(root.source_evaluation_contract_preserved,true);
  assert.equal(root.archive_consumer_identity_exact_lineage_bound,true);
  assert.equal(root.phase31_context_reuse_forbidden,true);
  assert.equal(root.phase31_harness_reuse_forbidden,true);
  assert.equal(root.phase31_holdout_reuse_forbidden,true);
  assert.equal(root.phase31_evaluator_root_reuse_forbidden,true);
  assert.equal(root.phase31_transfer_plan_reuse_forbidden,true);
  assert.equal(root.cross_generation_revalidation_required,true);
  assert.equal(root.source_generation_verdict_inherited,false);
  assert.equal(root.negative_transfer_retained,true);
  assert.equal(root.direct_skill_library_write,false);
  assert.equal(root.direct_experience_graph_write,false);
  assert.equal(root.direct_meta_skill_profile_mutation,false);
  assert.equal(root.direct_knowledge_activation,false);
  assert.equal(root.direct_scheduler_action,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.validated_knowledge_consumer_handoff_root_digest,/^sha256:[0-9a-f]{64}$/);
});


function phase32ExactSkillCapsule({
  skillId='skill.phase32.exact.recipe',
  version=1,
  parent=null,
  role='PLAN_TRANSFORM',
  sourceSha=SOURCE,
  inputDigest=labelDigest('phase32-exact-skill-input'),
  outputDigest=labelDigest('phase32-exact-skill-output'),
  implDigest=labelDigest('phase32-exact-skill-impl'),
  capabilities=['READ_VERIFIED_CONTEXT','PROPOSE_TYPED_TRANSFORM'],
}={}){
  return createRsiSkillCapsule({
    skill_id:skillId,
    version,
    parent_skill_digest:parent,
    source_candidate_sha:sourceSha,
    role,
    input_schema_digest:inputDigest,
    output_schema_digest:outputDigest,
    implementation_digest:implDigest,
    components:[{
      component_id:`${skillId}.component.v${version}`,
      artifact_digest:labelDigest(`${skillId}-component-${version}`),
      kind:'PROCEDURAL_RECIPE',
    }],
    capabilities,
    max_context_tokens:8192,
    max_output_tokens:2048,
    max_invocations:4,
    deterministic_interface:true,
    external_builder:true,
    authored_by_candidate:false,
  });
}

function phase32ExactSkillEvidence(skill,label='phase32-exact-existing'){
  return createRsiSkillEvidence({
    capsule:skill,
    hidden_holdout_digest:labelDigest(`${label}-holdout`),
    evaluator_root_digest:labelDigest(`${label}-evaluator`),
    unit_test_digest:labelDigest(`${label}-unit`),
    runtime_feedback_digest:labelDigest(`${label}-runtime`),
    attempt_count:8,
    success_count:8,
    hard_invariants_pass:true,
    verified_for_library:true,
    evidence_refs:[`EVIDENCE_${label.toUpperCase().replace(/[^A-Z0-9]+/g,'_')}`],
    external_evaluator:true,
    authored_by_candidate:false,
  });
}

function phase32ExactCurrentLibrary(){
  const baseline=phase32ExactSkillCapsule({
    skillId:'skill.phase32.exact.baseline',
    role:'ANALYZER',
    sourceSha:'b'.repeat(40),
    inputDigest:labelDigest('phase32-exact-baseline-input'),
    outputDigest:labelDigest('phase32-exact-baseline-output'),
    implDigest:labelDigest('phase32-exact-baseline-impl'),
    capabilities:['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES'],
  });
  return createRsiVerifiedSkillLibrary({
    library_id:'rsi.skill.library.phase32.exact',
    entries:[{capsule:baseline,evidence:phase32ExactSkillEvidence(baseline,'phase32-exact-baseline')}],
    external_library_owner:true,
    authored_by_candidate:false,
  });
}

function phase32ExactSkillReviewFixture(label='phase32-exact-skill-review'){
  const rows=phase31SourceRows(`${label}-source`);
  const proposal=phase31Proposal(rows,`${label}-proposal`);
  const validations=[
    phase31Validation(proposal,`${label}-transfer-a`),
    phase31Validation(proposal,`${label}-transfer-b`),
  ];
  const admission=createRsiKnowledgeConsolidationAdmission({
    admission_id:`${label}.phase31.admission`,
    proposal,validations,external_admission_owner:true,authored_by_candidate:false,
  });
  const currentLibrary=phase32ExactCurrentLibrary();
  const skill=phase32ExactSkillCapsule({skillId:`skill.${label}.recipe`,sourceSha:proposal.source_sha});
  const review=createRsiConsolidatedKnowledgeSkillReview({
    review_id:`${label}.review`,
    proposal,validations,admission,
    current_library:currentLibrary,
    skill_capsule:skill,
    knowledge_to_skill_binding_digest:labelDigest(`${label}-knowledge-binding`),
    external_materialization_receipt_digest:labelDigest(`${label}-materialization`),
    interface_review_digest:labelDigest(`${label}-interface-review`),
    capability_review_digest:labelDigest(`${label}-capability-review`),
    external_skill_builder:true,
    external_interface_owner:true,
    external_capability_reviewer:true,
    authored_by_candidate:false,
  });
  return {rows,proposal,validations,admission,currentLibrary,skill,review};
}

function phase32ExactSkillEvidenceReviewArgs(fx,label='phase32-exact-skill-evidence',overrides={}){
  return {
    evidence_review_id:`${label}.evidence.review`,
    review:fx.review,
    proposal:fx.proposal,
    validations:fx.validations,
    admission:fx.admission,
    current_library:fx.currentLibrary,
    skill_capsule:fx.skill,
    local_hidden_holdout_digest:labelDigest(`${label}-local-holdout`),
    local_evaluator_root_digest:labelDigest(`${label}-local-evaluator`),
    local_unit_test_digest:labelDigest(`${label}-local-unit`),
    local_runtime_feedback_digest:labelDigest(`${label}-local-runtime`),
    matched_reference_control_receipt_digest:labelDigest(`${label}-matched-control`),
    treatment_receipt_digest:labelDigest(`${label}-treatment`),
    local_evidence_digest:labelDigest(`${label}-local-evidence`),
    attempt_count:12,
    success_count:11,
    local_acceptance_pass:true,
    matched_reference_pass:true,
    skill_specific_value_demonstrated:true,
    hard_invariants_pass:true,
    contamination_clear:true,
    from_scratch_replay_pass:true,
    task_non_regression:true,
    safety_non_regression:true,
    security_non_regression:true,
    process_non_regression:true,
    outcome_non_regression:true,
    efficiency_non_regression:true,
    negative_transfer_detected:false,
    external_library_evaluator:true,
    external_holdout_owner:true,
    authored_by_candidate:false,
    ...overrides,
  };
}

test('Phase32 exact-contract recipe path reuses existing verified-skill schemas without appending the library',()=>{
  const fx=phase32ExactSkillReviewFixture();
  const checked=verifyRsiConsolidatedKnowledgeSkillReview(fx.review,{
    proposal:fx.proposal,validations:fx.validations,admission:fx.admission,
    current_library:fx.currentLibrary,skill_capsule:fx.skill,
  });
  assert.equal(checked.review_digest,fx.review.review_digest);
  assert.equal(fx.review.state,'READY_FOR_FRESH_LOCAL_LIBRARY_VALIDATION');
  assert.equal(fx.review.current_library_digest,fx.currentLibrary.library_digest);
  assert.equal(fx.review.review_can_write_skill_library,false);
  assert.equal(fx.review.review_can_activate_skill,false);
  assert.equal(fx.review.library_admission_token,null);

  const result=createRsiConsolidatedKnowledgeSkillEvidenceReview(phase32ExactSkillEvidenceReviewArgs(fx));
  assert.equal(result.state,'READY_FOR_EXTERNAL_EXISTING_LIBRARY_APPEND_REVIEW');
  assert.equal(result.standard_skill_evidence_verified_for_library,true);
  assert.equal(result.standard_skill_evidence.skill_digest,fx.skill.skill_digest);
  assert.equal(result.library_append_performed,false);
  assert.equal(result.review_can_append_library,false);
  assert.equal(result.review_can_activate_skill,false);
  assert.equal(result.library_admission_token,null);
  assert.equal(result.authority_effect,false);
  assert.equal(verifyRsiConsolidatedKnowledgeSkillEvidenceReview(result,phase32ExactSkillEvidenceReviewArgs(fx)).evidence_review_digest,result.evidence_review_digest);
});

test('Phase32 exact-contract skill review uses fresh local holdout/evaluator evidence and rejects negative transfer',()=>{
  const fx=phase32ExactSkillReviewFixture('phase32-exact-independence');
  assert.throws(()=>createRsiConsolidatedKnowledgeSkillEvidenceReview(
    phase32ExactSkillEvidenceReviewArgs(fx,'phase32-exact-reused-holdout',{
      local_hidden_holdout_digest:fx.validations[0].hidden_holdout_root_digest,
    })
  ),/reuses_phase31_evidence/);

  const harmful=createRsiConsolidatedKnowledgeSkillEvidenceReview(
    phase32ExactSkillEvidenceReviewArgs(fx,'phase32-exact-harmful',{
      matched_reference_pass:false,
      skill_specific_value_demonstrated:false,
      efficiency_non_regression:false,
      negative_transfer_detected:true,
    })
  );
  assert.equal(harmful.state,'LOCAL_LIBRARY_VALIDATION_REJECTED');
  assert.equal(harmful.standard_skill_evidence_verified_for_library,false);
  assert.ok(harmful.blockers.includes('MATCHED_REFERENCE_FAILED'));
  assert.ok(harmful.blockers.includes('SKILL_SPECIFIC_VALUE_NOT_DEMONSTRATED'));
  assert.ok(harmful.blockers.includes('EFFICIENCY_REGRESSION'));
  assert.ok(harmful.blockers.includes('NEGATIVE_TRANSFER_DETECTED'));
  assert.equal(harmful.library_append_performed,false);
});

test('Phase32 exact-contract positive skill path is reusable-recipe only and exact-library bound',()=>{
  const negativeRows=phase31SourceRows('phase32-exact-negative',{state:'CANDIDATE_EXPERIMENT_REJECTED'});
  const negativeProposal=phase31Proposal(negativeRows,'phase32-exact-negative');
  const negativeValidations=[
    phase31Validation(negativeProposal,'phase32-exact-negative-a'),
    phase31Validation(negativeProposal,'phase32-exact-negative-b'),
  ];
  const negativeAdmission=createRsiKnowledgeConsolidationAdmission({
    admission_id:'phase32.exact.negative.admission',
    proposal:negativeProposal,validations:negativeValidations,
    external_admission_owner:true,authored_by_candidate:false,
  });
  assert.throws(()=>createRsiConsolidatedKnowledgeSkillReview({
    review_id:'phase32.exact.negative.review',
    proposal:negativeProposal,validations:negativeValidations,admission:negativeAdmission,
    current_library:phase32ExactCurrentLibrary(),
    skill_capsule:phase32ExactSkillCapsule({skillId:'skill.phase32.exact.negative',sourceSha:SOURCE}),
    knowledge_to_skill_binding_digest:labelDigest('phase32-exact-negative-binding'),
    external_materialization_receipt_digest:labelDigest('phase32-exact-negative-materialization'),
    interface_review_digest:labelDigest('phase32-exact-negative-interface'),
    capability_review_digest:labelDigest('phase32-exact-negative-capability'),
    external_skill_builder:true,external_interface_owner:true,external_capability_reviewer:true,authored_by_candidate:false,
  }),/reusable_recipe_required/);

  const fx=phase32ExactSkillReviewFixture('phase32-exact-library-drift');
  const other=phase32ExactSkillCapsule({
    skillId:'skill.phase32.exact.other',
    role:'VERIFIER',sourceSha:'c'.repeat(40),
    inputDigest:labelDigest('phase32-exact-other-input'),
    outputDigest:labelDigest('phase32-exact-other-output'),
    implDigest:labelDigest('phase32-exact-other-impl'),
    capabilities:['READ_VERIFIED_CONTEXT','CHECK_TYPED_OUTPUT'],
  });
  const drifted=createRsiVerifiedSkillLibrary({
    library_id:fx.currentLibrary.library_id,
    entries:[
      ...fx.currentLibrary.entries.map(row=>({capsule:row.capsule,evidence:row.evidence})),
      {capsule:other,evidence:phase32ExactSkillEvidence(other,'phase32-exact-other')},
    ],
    external_library_owner:true,authored_by_candidate:false,
  });
  assert.throws(()=>createRsiConsolidatedKnowledgeSkillEvidenceReview({
    ...phase32ExactSkillEvidenceReviewArgs(fx,'phase32-exact-drift'),
    current_library:drifted,
  }),/review_digest_mismatch|library_drift_requires_revalidation/);
});

test('Phase32 exact consumer convergence freezes both generic revalidation and existing skill-review roots',()=>{
  const generic=rsiValidatedKnowledgeConsumerHandoffTrustRootSnapshot();
  const skill=rsiConsolidatedKnowledgeSkillReviewTrustRootSnapshot();
  assert.equal(generic.second_skill_library_allowed,false);
  assert.equal(generic.second_experience_graph_allowed,false);
  assert.equal(generic.second_scheduler_allowed,false);
  assert.equal(generic.cross_generation_revalidation_required,true);
  assert.equal(generic.direct_skill_library_write,false);
  assert.equal(skill.existing_verified_skill_library_reused,true);
  assert.equal(skill.second_skill_library_created,false);
  assert.equal(skill.current_library_exact_binding_required,true);
  assert.equal(skill.fresh_local_holdout_required,true);
  assert.equal(skill.local_holdout_independent_from_phase31_required,true);
  assert.equal(skill.matched_reference_required,true);
  assert.equal(skill.skill_specific_value_required,true);
  assert.equal(skill.zero_negative_transfer_required,true);
  assert.equal(skill.skill_library_write_performed_here,false);
  assert.equal(skill.skill_activation_performed_here,false);
  assert.equal(skill.scheduler_action_performed_here,false);
  assert.equal(skill.authority_effect,false);
});


test('Phase32 hardened consumer handoff rejects reuse of Phase31 transfer evidence assets',()=>{
  const fx=phase32Fixture('freshness-source');
  const base={
    proposal:fx.proposal,validations:fx.validations,admission:fx.admission,source_rows:fx.rows,
    consumer_model_family:'METAENGINE_RSI',
    consumer_environment_family:'METAENGINE_BROWSER',
    consumer_evaluator_generation_digest:fx.proposal.evaluator_generation_digest,
    consumer_evaluator_generation_seq:fx.proposal.evaluator_generation_seq,
    consumer_evaluator_generation_history_anchor_digest:fx.proposal.evaluator_generation_history_anchor_digest,
    consumer_evaluation_epoch_seq:fx.proposal.evaluation_epoch_seq,
    consumer_evaluation_epoch_digest:fx.proposal.evaluation_epoch_digest,
    external_consumer_router:true,
    authored_by_candidate:false,
  };
  const build=(label,overrides={})=>createRsiValidatedKnowledgeConsumerHandoff({
    handoff_id:`phase32.freshness.${label}`,
    ...base,
    consumer_context_digest:labelDigest(`${label}-context`),
    consumer_harness_digest:labelDigest(`${label}-harness`),
    consumer_evaluator_root_digest:labelDigest(`${label}-evaluator`),
    consumer_holdout_digest:labelDigest(`${label}-holdout`),
    matched_reference_plan_digest:labelDigest(`${label}-reference`),
    local_revalidation_protocol_digest:labelDigest(`${label}-protocol`),
    ...overrides,
  });
  const source=fx.validations[0];
  assert.throws(()=>build('reuse-context',{consumer_context_digest:source.heldout_context_digest}),/source_context_reuse_forbidden/);
  assert.throws(()=>build('reuse-harness',{consumer_harness_digest:source.transfer_harness_digest}),/source_harness_reuse_forbidden/);
  assert.throws(()=>build('reuse-evaluator',{consumer_evaluator_root_digest:source.external_evaluator_root_digest}),/source_evaluator_reuse_forbidden/);
  assert.throws(()=>build('reuse-task',{consumer_holdout_digest:source.heldout_task_set_digest}),/source_holdout_reuse_forbidden/);
  assert.throws(()=>build('reuse-hidden',{consumer_holdout_digest:source.hidden_holdout_root_digest}),/source_holdout_reuse_forbidden/);
  assert.throws(()=>build('reuse-reference',{matched_reference_plan_digest:fx.proposal.transfer_validation_plan_digest}),/source_reference_plan_reuse_forbidden/);
  assert.throws(()=>build('reuse-protocol',{local_revalidation_protocol_digest:fx.proposal.transfer_validation_plan_digest}),/source_revalidation_protocol_reuse_forbidden/);
});

test('Phase32 hardened consumer identity detects generation and epoch identity drift',()=>{
  const fx=phase32Fixture('identity-drift');
  assert.throws(()=>phase32Fixture('identity-drift-generation',{
    consumerGeneration:fx.proposal.evaluator_generation_digest,
    consumerGenerationSeq:fx.proposal.evaluator_generation_seq+1,
  }),/evaluator_generation_identity_drift/);
  assert.throws(()=>phase32Fixture('identity-drift-anchor',{
    consumerGeneration:fx.proposal.evaluator_generation_digest,
    consumerGenerationAnchor:labelDigest('phase32-wrong-generation-anchor'),
  }),/evaluator_generation_identity_drift/);
  assert.throws(()=>phase32Fixture('identity-drift-epoch',{
    consumerEpochDigest:fx.proposal.evaluation_epoch_digest,
    consumerEpochSeq:fx.proposal.evaluation_epoch_seq+1,
  }),/evaluation_epoch_identity_drift/);
});
