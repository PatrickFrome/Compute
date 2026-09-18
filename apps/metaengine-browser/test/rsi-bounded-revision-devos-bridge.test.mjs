import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

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
