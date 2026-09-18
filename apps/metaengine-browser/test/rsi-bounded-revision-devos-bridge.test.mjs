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
  createRsiEvaluatorGenerationRotation,
  verifyRsiEvaluatorGenerationRotation,
  RsiMaterializedEvaluationHandoffLedger,
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
    evaluation_epoch_digest:labelDigest(`${label}-evaluation-epoch`),
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
  assert.equal(request.candidate_can_choose_evaluator,false);
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
  assert.equal(intent.evaluation_epoch_digest,handoff.evaluation_epoch_digest);
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


test('Phase29 durable handoff history supports same-generation epochs and externally witnessed generation rotation',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase29-history-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const ledger=new RsiMaterializedEvaluationHandoffLedger({statePath:path.join(dir,'history.json'),source_sha:SOURCE});
  await ledger.init();

  const fx=phase28ArtifactFixture('history');
  const first=phase29Handoff(fx,'history-gen1');
  const firstAdd=await ledger.add({
    handoff:first,
    artifact_receipt:fx.artifactReceipt,
    artifact_verification:fx.artifactVerification,
  });
  assert.equal(firstAdd.state,'RECORDED');
  assert.equal(firstAdd.handoff_seq,1);

  const second=phase29Handoff(fx,'history-gen1-epoch2',{
    evaluator_root_digest:first.evaluator_root_digest,
    evaluator_generation_digest:first.evaluator_generation_digest,
  });
  const secondAdd=await ledger.add({
    handoff:second,
    artifact_receipt:fx.artifactReceipt,
    artifact_verification:fx.artifactVerification,
  });
  assert.equal(secondAdd.handoff_seq,2);

  const third=phase29Handoff(fx,'history-gen2');
  const rotation=createRsiEvaluatorGenerationRotation({
    rotation_id:'phase29.rotation.history.gen2',
    source_sha:SOURCE,
    previous_evaluator_root_digest:second.evaluator_root_digest,
    previous_evaluator_generation_digest:second.evaluator_generation_digest,
    next_evaluator_root_digest:third.evaluator_root_digest,
    next_evaluator_generation_digest:third.evaluator_generation_digest,
    previous_evaluation_epoch_digest:second.evaluation_epoch_digest,
    next_evaluation_epoch_digest:third.evaluation_epoch_digest,
    anchor_recalibration_digest:labelDigest('history-gen2-anchor-recalibration'),
    external_rotation_receipt_digest:labelDigest('history-gen2-external-rotation'),
    external_generation_owner:true,
    authored_by_candidate:false,
  });
  verifyRsiEvaluatorGenerationRotation(rotation);
  const thirdAdd=await ledger.add({
    handoff:third,
    artifact_receipt:fx.artifactReceipt,
    artifact_verification:fx.artifactVerification,
    rotation,
  });
  assert.equal(thirdAdd.handoff_seq,3);

  const snap=ledger.snapshot();
  assert.equal(snap.row_count,3);
  assert.equal(snap.generation_count,2);
  assert.equal(snap.latest_handoff_seq,3);
  assert.equal(snap.latest_evaluator_generation_digest,third.evaluator_generation_digest);
  assert.equal(snap.active_candidate_digest,null);
  assert.equal(snap.ledger_can_execute_evaluation,false);
  assert.equal(snap.ledger_can_promote,false);

  const restored=new RsiMaterializedEvaluationHandoffLedger({statePath:path.join(dir,'history.json'),source_sha:SOURCE});
  await restored.init();
  assert.equal(restored.snapshot().row_count,3);
  assert.equal((await restored.add({
    handoff:third,
    artifact_receipt:fx.artifactReceipt,
    artifact_verification:fx.artifactVerification,
    rotation,
  })).state,'IDEMPOTENT');
});

test('Phase29 durable handoff history rejects silent generation change, rollback, and same-epoch generation drift',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase29-history-rotation-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const ledger=new RsiMaterializedEvaluationHandoffLedger({statePath:path.join(dir,'history.json'),source_sha:SOURCE});
  await ledger.init();

  const fx=phase28ArtifactFixture('rotation-base');
  const first=phase29Handoff(fx,'rotation-gen1');
  await ledger.add({handoff:first,artifact_receipt:fx.artifactReceipt,artifact_verification:fx.artifactVerification});

  const second=phase29Handoff(fx,'rotation-gen2');
  await assert.rejects(
    ()=>ledger.add({handoff:second,artifact_receipt:fx.artifactReceipt,artifact_verification:fx.artifactVerification}),
    /rotation_invalid|rotation_binding_mismatch/,
  );

  const rotation=createRsiEvaluatorGenerationRotation({
    rotation_id:'phase29.rotation.base.gen2',
    source_sha:SOURCE,
    previous_evaluator_root_digest:first.evaluator_root_digest,
    previous_evaluator_generation_digest:first.evaluator_generation_digest,
    next_evaluator_root_digest:second.evaluator_root_digest,
    next_evaluator_generation_digest:second.evaluator_generation_digest,
    previous_evaluation_epoch_digest:first.evaluation_epoch_digest,
    next_evaluation_epoch_digest:second.evaluation_epoch_digest,
    anchor_recalibration_digest:labelDigest('rotation-base-anchor'),
    external_rotation_receipt_digest:labelDigest('rotation-base-receipt'),
    external_generation_owner:true,
    authored_by_candidate:false,
  });
  await ledger.add({handoff:second,artifact_receipt:fx.artifactReceipt,artifact_verification:fx.artifactVerification,rotation});

  const rollback=phase29Handoff(fx,'rotation-rollback',{
    evaluator_root_digest:first.evaluator_root_digest,
    evaluator_generation_digest:first.evaluator_generation_digest,
  });
  const rollbackRotation=createRsiEvaluatorGenerationRotation({
    rotation_id:'phase29.rotation.rollback',
    source_sha:SOURCE,
    previous_evaluator_root_digest:second.evaluator_root_digest,
    previous_evaluator_generation_digest:second.evaluator_generation_digest,
    next_evaluator_root_digest:rollback.evaluator_root_digest,
    next_evaluator_generation_digest:rollback.evaluator_generation_digest,
    previous_evaluation_epoch_digest:second.evaluation_epoch_digest,
    next_evaluation_epoch_digest:rollback.evaluation_epoch_digest,
    anchor_recalibration_digest:labelDigest('rotation-rollback-anchor'),
    external_rotation_receipt_digest:labelDigest('rotation-rollback-receipt'),
    external_generation_owner:true,
    authored_by_candidate:false,
  });
  await assert.rejects(
    ()=>ledger.add({handoff:rollback,artifact_receipt:fx.artifactReceipt,artifact_verification:fx.artifactVerification,rotation:rollbackRotation}),
    /generation_rollback/,
  );

  const fx2=phase28ArtifactFixture('rotation-other-artifact');
  const epochDrift=phase29Handoff(fx2,'rotation-epoch-drift',{
    evaluation_epoch_digest:first.evaluation_epoch_digest,
  });
  await assert.rejects(
    ()=>ledger.add({handoff:epochDrift,artifact_receipt:fx2.artifactReceipt,artifact_verification:fx2.artifactVerification}),
    /epoch_generation_drift/,
  );
});

test('Phase29 handoff ledger is durable-before-visible and restart rejects sequence tamper',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase29-history-persist-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'history.json');
  const fx=phase28ArtifactFixture('persist');
  const handoff=phase29Handoff(fx,'persist');

  const failed=new RsiMaterializedEvaluationHandoffLedger({statePath,source_sha:SOURCE});
  await failed.init();
  await fs.mkdir(statePath);
  await assert.rejects(()=>failed.add({
    handoff,
    artifact_receipt:fx.artifactReceipt,
    artifact_verification:fx.artifactVerification,
  }));
  assert.equal(failed.snapshot().row_count,0);
  await fs.rm(statePath,{recursive:true,force:true});

  const ledger=new RsiMaterializedEvaluationHandoffLedger({statePath,source_sha:SOURCE});
  await ledger.init();
  await ledger.add({handoff,artifact_receipt:fx.artifactReceipt,artifact_verification:fx.artifactVerification});
  const second=phase29Handoff(fx,'persist-second',{
    evaluator_root_digest:handoff.evaluator_root_digest,
    evaluator_generation_digest:handoff.evaluator_generation_digest,
  });
  await ledger.add({handoff:second,artifact_receipt:fx.artifactReceipt,artifact_verification:fx.artifactVerification});

  const persisted=JSON.parse(await fs.readFile(statePath,'utf8'));
  persisted.rows[1].handoff_seq=3;
  const stateCore=structuredClone(persisted);
  delete stateCore.state_digest;
  persisted.state_digest=dg(stateCore);
  await fs.writeFile(statePath,`${JSON.stringify(persisted)}\n`,'utf8');

  const restored=new RsiMaterializedEvaluationHandoffLedger({statePath,source_sha:SOURCE});
  await assert.rejects(()=>restored.init(),/sequence_gap_or_reorder/);
});

test('Phase29 handoff history rejects self-rehashed candidate authority and request identity conflicts',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase29-history-policy-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const ledger=new RsiMaterializedEvaluationHandoffLedger({statePath:path.join(dir,'history.json'),source_sha:SOURCE});
  await ledger.init();
  const fx=phase28ArtifactFixture('policy-history');
  const handoff=phase29Handoff(fx,'policy-history');

  const bad=structuredClone(handoff);
  bad.candidate_can_choose_evaluator=true;
  const core=structuredClone(bad);
  delete core.evaluation_handoff_digest;
  bad.evaluation_handoff_digest=dg(core);
  await assert.rejects(
    ()=>ledger.add({handoff:bad,artifact_receipt:fx.artifactReceipt,artifact_verification:fx.artifactVerification}),
    /handoff_policy_invalid/,
  );
  assert.equal(ledger.snapshot().row_count,0);

  await ledger.add({handoff,artifact_receipt:fx.artifactReceipt,artifact_verification:fx.artifactVerification});
  const conflicting=structuredClone(handoff);
  conflicting.evaluation_handoff_digest=labelDigest('different-handoff-digest');
  await assert.rejects(
    ()=>ledger.add({handoff:conflicting,artifact_receipt:fx.artifactReceipt,artifact_verification:fx.artifactVerification}),
    /handoff_digest_mismatch/,
  );
  assert.equal(ledger.snapshot().row_count,1);
});


function phase30OutcomeEvidence(label='phase30',{state='SUPPORTED_FOR_BOUNDED_REVISION',sharedEvaluation=null,treatmentOverrides={}}={}){
  const fx=phase28ArtifactFixture(label);
  const shared=sharedEvaluation||{};
  const handoff=phase29Handoff(fx,label,{
    ...(shared.evaluator_root_digest?{evaluator_root_digest:shared.evaluator_root_digest}:{}),
    ...(shared.evaluator_generation_digest?{evaluator_generation_digest:shared.evaluator_generation_digest}:{}),
    ...(shared.evaluation_epoch_digest?{evaluation_epoch_digest:shared.evaluation_epoch_digest}:{}),
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
    },
    CANDIDATE_EXPERIMENT_REJECTED:{
      negative_constraint_digest:labelDigest(`phase30-negative-${label}`),
      watch_out_digest:labelDigest(`phase30-watchout-${label}`),
    },
    NO_MATERIAL_IMPROVEMENT:{
      low_yield_constraint_digest:labelDigest(`phase30-low-yield-${label}`),
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
    ...byState[evidence.receipt.state],
    external_learning_reviewer:true,
    external_niche_owner:true,
    authored_by_candidate:false,
    ...overrides,
  });
}

test('Phase30 derives typed learning artifacts from every immutable Phase26 outcome class',()=>{
  const cases=[
    ['supported','SUPPORTED_FOR_BOUNDED_REVISION','REUSABLE_RECIPE_CANDIDATE'],
    ['rejected','CANDIDATE_EXPERIMENT_REJECTED','NEGATIVE_CONSTRAINT'],
    ['flat','NO_MATERIAL_IMPROVEMENT','LOW_YIELD_CONSTRAINT'],
    ['environment','INCONCLUSIVE_ENVIRONMENT','ENVIRONMENT_DIAGNOSTIC'],
    ['ambiguous','INCONCLUSIVE_AMBIGUOUS','AMBIGUITY_DIAGNOSTIC'],
  ];
  for(const [label,state,kind] of cases){
    const evidence=phase30OutcomeEvidence(`typed-${label}`,{state});
    const entry=phase30Entry(evidence,`typed-${label}`);
    verifyRsiGenerationScopedOutcomeEntry(entry,{
      handoff_row:evidence.handoffRow,
      experiment_intent:evidence.intent,
      experiment_receipt:evidence.receipt,
    });
    assert.equal(entry.outcome_class,state);
    assert.equal(entry.learning_kind,kind);
    assert.equal(entry.experiment_receipt_digest,evidence.receipt.receipt_digest);
    assert.equal(entry.handoff_digest,evidence.handoff.evaluation_handoff_digest);
    assert.equal(entry.evaluator_generation_digest,evidence.handoff.evaluator_generation_digest);
    assert.equal(entry.evaluation_epoch_digest,evidence.handoff.evaluation_epoch_digest);
    assert.equal(entry.source_outcome_receipt_stored,false);
    assert.equal(entry.raw_trajectory_stored,false);
    assert.equal(entry.raw_hidden_holdout_stored,false);
    assert.equal(entry.entry_can_mutate_candidate,false);
    assert.equal(entry.entry_can_change_budget,false);
    assert.equal(entry.entry_can_promote,false);
    assert.equal(entry.authority_effect,false);
  }
});

test('Phase30 archive stores only derived references and preserves a generation-scoped Pareto frontier',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase30-frontier-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'frontier.json');
  const shared={
    evaluator_root_digest:labelDigest('phase30-shared-evaluator'),
    evaluator_generation_digest:labelDigest('phase30-shared-generation'),
    evaluation_epoch_digest:labelDigest('phase30-shared-epoch'),
    sealed_task_set_digest:labelDigest('phase30-shared-tasks'),
    evaluation_harness_digest:labelDigest('phase30-shared-harness'),
    trial_worker_image_digest:labelDigest('phase30-shared-worker'),
    resource_budget_digest:labelDigest('phase30-shared-budget'),
    task_order_digest:labelDigest('phase30-shared-order'),
    acceptance_policy_digest:labelDigest('phase30-shared-acceptance'),
    stopping_policy_digest:labelDigest('phase30-shared-stopping'),
    hidden_holdout_root_digest:labelDigest('phase30-shared-holdout'),
    safety_suite_root_digest:labelDigest('phase30-shared-safety'),
    security_suite_root_digest:labelDigest('phase30-shared-security'),
  };
  const a=phase30OutcomeEvidence('frontier-a',{sharedEvaluation:shared,treatmentOverrides:{task_utility:0.86,security:0.96}});
  const b=phase30OutcomeEvidence('frontier-b',{sharedEvaluation:shared,treatmentOverrides:{task_utility:0.80,security:1.00}});
  const rejected=phase30OutcomeEvidence('frontier-rejected',{state:'CANDIDATE_EXPERIMENT_REJECTED',sharedEvaluation:shared});
  const ea=phase30Entry(a,'frontier-a',{niches:['CONTROL_FLOW','VALIDATION']});
  const eb=phase30Entry(b,'frontier-b',{niches:['CONTROL_FLOW']});
  const er=phase30Entry(rejected,'frontier-rejected',{niches:['CONTROL_FLOW']});
  const evidenceByReceipt=new Map([
    [a.receipt.receipt_digest,{handoff_row:a.handoffRow,experiment_intent:a.intent,experiment_receipt:a.receipt}],
    [b.receipt.receipt_digest,{handoff_row:b.handoffRow,experiment_intent:b.intent,experiment_receipt:b.receipt}],
    [rejected.receipt.receipt_digest,{handoff_row:rejected.handoffRow,experiment_intent:rejected.intent,experiment_receipt:rejected.receipt}],
  ]);
  const archive=new RsiGenerationScopedOutcomeArchive({
    statePath,source_sha:SOURCE,
    evidenceResolver:async({experiment_receipt_digest})=>evidenceByReceipt.get(experiment_receipt_digest),
  });
  await archive.init();
  await archive.add({entry:ea,...evidenceByReceipt.get(a.receipt.receipt_digest)});
  await archive.add({entry:eb,...evidenceByReceipt.get(b.receipt.receipt_digest)});
  await archive.add({entry:er,...evidenceByReceipt.get(rejected.receipt.receipt_digest)});

  const frontier=archive.frontier();
  const controlFlow=frontier.find(x=>x.niche==='CONTROL_FLOW');
  assert.ok(controlFlow);
  assert.equal(controlFlow.scalar_winner,null);
  assert.deepEqual(controlFlow.entry_digests.sort(),[ea.entry_digest,eb.entry_digest].sort());
  assert.equal(controlFlow.entry_digests.includes(er.entry_digest),false);

  const snap=archive.snapshot();
  assert.equal(snap.row_count,3);
  assert.equal(snap.outcome_counts.SUPPORTED_FOR_BOUNDED_REVISION,2);
  assert.equal(snap.outcome_counts.CANDIDATE_EXPERIMENT_REJECTED,1);
  assert.equal(snap.source_outcome_receipts_stored_here,false);
  assert.equal(snap.scalar_global_winner_forbidden,true);
  assert.equal(snap.cross_generation_dominance_forbidden,true);
  assert.equal(snap.archive_can_change_budget,false);

  const persisted=await fs.readFile(statePath,'utf8');
  assert.equal(persisted.includes('control_metrics'),false);
  assert.equal(persisted.includes('treatment_metrics'),false);
  assert.equal(persisted.includes('raw_trajectory'),true);
  assert.equal(persisted.includes(ea.experiment_receipt_digest),true);

  const restored=new RsiGenerationScopedOutcomeArchive({
    statePath,source_sha:SOURCE,
    evidenceResolver:async({experiment_receipt_digest})=>evidenceByReceipt.get(experiment_receipt_digest),
  });
  await restored.init();
  assert.equal(restored.snapshot().row_count,3);
  assert.equal((await restored.add({entry:ea,...evidenceByReceipt.get(a.receipt.receipt_digest)})).state,'IDEMPOTENT');
});

test('Phase30 archive is durable-before-visible and restart rejects self-rehashed outcome forgery',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase30-replay-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'frontier.json');
  const evidence=phase30OutcomeEvidence('replay',{state:'CANDIDATE_EXPERIMENT_REJECTED'});
  const entry=phase30Entry(evidence,'replay');
  const resolver=async()=>({handoff_row:evidence.handoffRow,experiment_intent:evidence.intent,experiment_receipt:evidence.receipt});
  const archive=new RsiGenerationScopedOutcomeArchive({statePath,source_sha:SOURCE,evidenceResolver:resolver});
  await archive.init();

  await fs.mkdir(statePath);
  await assert.rejects(()=>archive.add({
    entry,handoff_row:evidence.handoffRow,experiment_intent:evidence.intent,experiment_receipt:evidence.receipt,
  }));
  assert.equal(archive.snapshot().row_count,0);
  await fs.rm(statePath,{recursive:true,force:true});

  await archive.add({entry,handoff_row:evidence.handoffRow,experiment_intent:evidence.intent,experiment_receipt:evidence.receipt});
  const raw=JSON.parse(await fs.readFile(statePath,'utf8'));
  raw.rows[0].outcome_class='SUPPORTED_FOR_BOUNDED_REVISION';
  raw.rows[0].learning_kind='REUSABLE_RECIPE_CANDIDATE';
  raw.rows[0].recipe_digest=labelDigest('forged-recipe');
  const entryCore=structuredClone(raw.rows[0]);delete entryCore.entry_digest;
  raw.rows[0].entry_digest=dg(entryCore);
  raw.outcome_counts={
    SUPPORTED_FOR_BOUNDED_REVISION:1,
    CANDIDATE_EXPERIMENT_REJECTED:0,
    NO_MATERIAL_IMPROVEMENT:0,
    INCONCLUSIVE_ENVIRONMENT:0,
    INCONCLUSIVE_AMBIGUOUS:0,
  };
  const stateCore=structuredClone(raw);delete stateCore.state_digest;
  raw.state_digest=dg(stateCore);
  await fs.writeFile(statePath,`${JSON.stringify(raw)}\n`,'utf8');

  const restored=new RsiGenerationScopedOutcomeArchive({statePath,source_sha:SOURCE,evidenceResolver:resolver});
  await assert.rejects(()=>restored.init(),/entry_digest_mismatch|outcome|negative_constraint|recipe/);
});

test('Phase30 rejects candidate-authored learning authority and keeps maturity statistics advisory',async(t)=>{
  const evidence=phase30OutcomeEvidence('ownership');
  assert.throws(()=>phase30Entry(evidence,'ownership',{
    authored_by_candidate:true,
    external_learning_reviewer:false,
  }),/external_learning_ownership_required/);

  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase30-stats-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const entry=phase30Entry(evidence,'ownership');
  const resolver=async()=>({handoff_row:evidence.handoffRow,experiment_intent:evidence.intent,experiment_receipt:evidence.receipt});
  const archive=new RsiGenerationScopedOutcomeArchive({statePath:path.join(dir,'frontier.json'),source_sha:SOURCE,evidenceResolver:resolver});
  await archive.init();
  await archive.add({entry,handoff_row:evidence.handoffRow,experiment_intent:evidence.intent,experiment_receipt:evidence.receipt});
  const stats=archive.nicheStats();
  assert.equal(stats[0].budget_recommendation,null);
  assert.equal(stats[0].automatic_plasticity_change_authorized,false);

  const root=rsiGenerationScopedOutcomeFrontierTrustRootSnapshot();
  assert.equal(root.existing_candidate_experiment_ledger_is_only_outcome_truth,true);
  assert.equal(root.source_outcome_receipts_not_duplicated,true);
  assert.equal(root.quality_diverse_frontier_required,true);
  assert.equal(root.scalar_global_winner_forbidden,true);
  assert.equal(root.cross_generation_dominance_forbidden,true);
  assert.equal(root.maturity_stats_advisory_only,true);
  assert.equal(root.automatic_plasticity_change_authorized,false);
  assert.equal(root.authority_effect,false);
});


function phase31SourceRows(prefix='phase31', {state='SUPPORTED_FOR_BOUNDED_REVISION'} = {}) {
  const shared={
    evaluator_root_digest:labelDigest(`${prefix}-evaluator-root`),
    evaluator_generation_digest:labelDigest(`${prefix}-generation`),
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
    control_receipt_digest:labelDigest(`${label}-control`),
    treatment_receipt_digest:labelDigest(`${label}-treatment`),
    transfer_evidence_digest:labelDigest(`${label}-transfer-evidence`),
    source_context_exclusion_pass:true,
    hidden_holdout_pass:true,
    evaluator_integrity_pass:true,
    contamination_clear:true,
    from_scratch_replay_pass:true,
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
  assert.equal(proposal.same_evaluation_epoch_required,true);
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
  assert.equal(root.same_evaluation_epoch_required,true);
  assert.equal(root.mixed_learning_kind_forbidden,true);
  assert.equal(root.source_evidence_preserved_by_digest,true);
  assert.equal(root.external_consolidator_required,true);
  assert.equal(root.external_transfer_validator_required,true);
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
