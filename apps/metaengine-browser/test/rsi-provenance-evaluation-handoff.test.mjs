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


import {
  createRsiProvenanceEvaluationHandoff,
  verifyRsiProvenanceEvaluationHandoff,
  rsiProvenanceEvaluationHandoffTrustRootSnapshot,
} from '../src/rsi-provenance-evaluation-handoff.mjs';

function phase28Artifact(label='phase29'){
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
    receipt_id:`${label}.artifact.receipt`,
    bridge,
    envelope:fx.envelope,
    proposal:fx.proposal,
    experiment_intent:fx.experimentIntent,
    experiment_receipt:fx.experimentReceipt,
    build_plan:build,
    materialization_receipt:materialization,
    artifact_digest:labelDigest(`${label}.artifact.package`),
    provenance_attestation_digest:labelDigest(`${label}.provenance.attestation`),
    signature_bundle_digest:labelDigest(`${label}.signature.bundle`),
    transparency_log_entry_digest:labelDigest(`${label}.transparency.entry`),
    reproducibility_evidence_digest:labelDigest(`${label}.reproducibility`),
    external_attestor:true,
    authored_by_candidate:false,
  });
  return {fx,bridge,build,materialization,artifactReceipt};
}

function evaluationArgs(bundle,label='phase29',overrides={}){
  return {
    handoff_id:`${label}.evaluation.handoff`,
    artifact_receipt:bundle.artifactReceipt,
    bridge:bundle.bridge,
    envelope:bundle.fx.envelope,
    proposal:bundle.fx.proposal,
    original_experiment_intent:bundle.fx.experimentIntent,
    original_experiment_receipt:bundle.fx.experimentReceipt,
    build_plan:bundle.build,
    materialization_receipt:bundle.materialization,
    external_measurement_digest:labelDigest(`${label}.fresh.measurement`),
    proxy_score_digest:labelDigest(`${label}.fresh.proxy`),
    uncertainty:0.9,
    decision_closeness:0.8,
    proxy_reliability_gap:0.4,
    epoch_budget_units:8,
    baseline_artifact_digest:labelDigest(`${label}.baseline.artifact`),
    sealed_task_set_digest:labelDigest(`${label}.sealed.tasks`),
    harness_digest:labelDigest(`${label}.evaluation.harness`),
    evaluator_root_digest:labelDigest(`${label}.external.evaluator`),
    trial_worker_image_digest:labelDigest(`${label}.evaluation.worker`),
    resource_budget_digest:labelDigest(`${label}.resource.budget`),
    task_order_digest:labelDigest(`${label}.task.order`),
    external_evaluation_controller:true,
    authored_by_candidate:false,
    ...overrides,
  };
}

test('Phase29 closes provenance artifact into existing fresh paired evaluation only',()=>{
  const bundle=phase28Artifact('phase29-success');
  const args=evaluationArgs(bundle,'phase29-success');
  const handoff=createRsiProvenanceEvaluationHandoff(args);
  const checked=verifyRsiProvenanceEvaluationHandoff(handoff,args);
  assert.equal(checked.handoff_digest,handoff.handoff_digest);
  assert.equal(handoff.state,'ELIGIBLE_FOR_EXTERNAL_PAIRED_EVALUATION');
  assert.equal(handoff.artifact_receipt_digest,bundle.artifactReceipt.artifact_receipt_digest);
  assert.equal(handoff.envelope_digest,bundle.fx.envelope.envelope_digest);
  assert.equal(handoff.proposal_digest,bundle.fx.proposal.proposal_digest);
  assert.equal(handoff.candidate_sha,CANDIDATE);
  assert.equal(handoff.candidate_artifact_digest,bundle.artifactReceipt.artifact_digest);
  assert.equal(handoff.routing_request.source_sha,SOURCE);
  assert.equal(handoff.budget_plan.state,'EVALUATION_BUDGET_ROUTED');
  assert.ok(handoff.budget_plan.selected_request_digests.includes(handoff.routing_request_digest));
  assert.equal(handoff.paired_experiment_intent.candidate_artifact_digest,bundle.artifactReceipt.artifact_digest);
  assert.equal(handoff.paired_experiment_intent.max_attempts_per_arm,1);
  assert.equal(handoff.paired_experiment_intent.max_retries,0);
  assert.equal(handoff.paired_experiment_intent.external_evaluator_required,true);
  assert.equal(handoff.fresh_evaluation_budget_required,true);
  assert.equal(handoff.fresh_external_measurement_required,true);
  assert.equal(handoff.sealed_exogenous_acceptance_required,true);
  assert.equal(handoff.build_and_evaluation_roots_independent,true);
  assert.equal(handoff.active_artifact_replaced,false);
  assert.equal(handoff.direct_promotion_allowed,false);
  assert.equal(handoff.handoff_can_schedule_evaluation,false);
  assert.equal(handoff.handoff_can_execute_evaluation,false);
  assert.equal(handoff.second_evaluator_created,false);
  assert.equal(handoff.second_scheduler_created,false);
  assert.equal(handoff.authority_effect,false);
});

test('Phase29 rejects candidate-owned evaluation control and build/evaluation identity reuse',()=>{
  const bundle=phase28Artifact('phase29-negative');
  const common=evaluationArgs(bundle,'phase29-negative');
  assert.throws(()=>createRsiProvenanceEvaluationHandoff({
    ...common,
    external_evaluation_controller:false,
    authored_by_candidate:true,
  }),/external_controller_required/);
  assert.throws(()=>createRsiProvenanceEvaluationHandoff({
    ...common,
    trial_worker_image_digest:bundle.artifactReceipt.worker_image_digest,
  }),/build_and_evaluation_roots_must_be_independent/);
  assert.throws(()=>createRsiProvenanceEvaluationHandoff({
    ...common,
    harness_digest:bundle.artifactReceipt.harness_manifest_digest,
  }),/build_and_evaluation_roots_must_be_independent/);
});

test('Phase29 requires a fresh budget selection instead of silently reusing spent evaluation budget',()=>{
  const bundle=phase28Artifact('phase29-budget');
  assert.throws(()=>createRsiProvenanceEvaluationHandoff(
    evaluationArgs(bundle,'phase29-budget',{epoch_budget_units:1})
  ),/fresh_request_not_selected/);
});

test('Phase29 rejects baseline equal to materialized candidate artifact',()=>{
  const bundle=phase28Artifact('phase29-baseline');
  assert.throws(()=>createRsiProvenanceEvaluationHandoff(
    evaluationArgs(bundle,'phase29-baseline',{baseline_artifact_digest:bundle.artifactReceipt.artifact_digest})
  ),/distinct_candidate_required/);
});

test('Phase29 self-rehashed policy downgrade is rejected',()=>{
  const bundle=phase28Artifact('phase29-tamper');
  const args=evaluationArgs(bundle,'phase29-tamper');
  const handoff=createRsiProvenanceEvaluationHandoff(args);
  const tampered={...handoff,active_artifact_replaced:true};
  const core={...tampered};delete core.handoff_digest;
  tampered.handoff_digest=dg(core);
  assert.throws(()=>verifyRsiProvenanceEvaluationHandoff(tampered,args),/policy_invalid/);
});

test('Phase29 trust root reuses existing evaluation planes and freezes candidate control',()=>{
  const root=rsiProvenanceEvaluationHandoffTrustRootSnapshot();
  assert.equal(root.strongest_phase28_provenance_receipt_required,true);
  assert.equal(root.existing_evaluation_budget_router_only,true);
  assert.equal(root.existing_paired_candidate_experiment_ledger_only,true);
  assert.equal(root.fresh_external_measurement_required,true);
  assert.equal(root.fresh_evaluation_budget_required,true);
  assert.equal(root.sealed_exogenous_acceptance_required,true);
  assert.equal(root.full_phase27_phase28_lineage_binding_required,true);
  assert.equal(root.build_and_evaluation_roots_independent,true);
  assert.equal(root.candidate_can_choose_evaluator,false);
  assert.equal(root.candidate_can_choose_task_set,false);
  assert.equal(root.candidate_can_choose_harness,false);
  assert.equal(root.candidate_can_choose_trial_worker,false);
  assert.equal(root.second_evaluator_allowed,false);
  assert.equal(root.second_scheduler_allowed,false);
  assert.equal(root.direct_active_replacement_allowed,false);
  assert.equal(root.direct_promotion_allowed,false);
  assert.equal(root.deployment_evidence_required_for_trusted_learning,true);
  assert.equal(root.authority_effect,false);
  assert.match(root.handoff_root_digest,/^sha256:[0-9a-f]{64}$/);
});
