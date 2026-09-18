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
    /generation_history_generation_identity_drift/,
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
  await assert.rejects(()=>ledger.add({intent:anchorDrift.intent,receipt:anchorDrift.receipt}),/generation_identity_drift/);

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
