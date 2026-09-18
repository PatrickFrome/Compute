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
} from '../src/rsi-bounded-revision-devos-bridge.mjs';
import {
  prepareRsiIsolatedCandidateBuild,
  verifyRsiIsolatedCandidateBuildPlan,
} from '../src/rsi-isolated-candidate-builder.mjs';

const SOURCE='a'.repeat(40);

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
}
function dg(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}
function labelDigest(label){return dg({label});}

function revisionFixture(label='one'){
  const hypothesis=createRsiSharedExperienceHypothesis({
    hypothesis_id:`bridge.hypothesis.${label}`,
    source_sha:SOURCE,
    origin_candidate_digest:labelDigest(`origin-candidate-${label}`),
    origin_lineage_digest:labelDigest(`origin-lineage-${label}`),
    sanitized_summary_digest:labelDigest(`summary-${label}`),
    supporting_evidence_digest:labelDigest(`support-${label}`),
    counterevidence_digest:labelDigest(`counter-${label}`),
    falsification_test_digest:labelDigest(`falsify-${label}`),
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
