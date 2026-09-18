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
  createRsiBoundedRevisionArtifactReceipt,
  createRsiBoundedRevisionDevosBridge,
} from '../src/rsi-bounded-revision-devos-bridge.mjs';
import {
  RsiImplementationEvaluationLedger,
  createRsiImplementationEvaluationHandoff,
  createRsiImplementationEvaluationResult,
  rsiImplementationEvaluationHandoffTrustRootSnapshot,
  verifyRsiImplementationEvaluationHandoff,
  verifyRsiImplementationEvaluationResult,
} from '../src/rsi-implementation-evaluation-handoff.mjs';

const SOURCE='a'.repeat(40);

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
}
function dg(label){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable({label})),'utf8').digest('hex')}`;
}
function objDigest(v){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;
}

function sharedExperience(label='one'){
  const hypothesis=createRsiSharedExperienceHypothesis({
    hypothesis_id:`phase29.hypothesis.${label}`,
    source_sha:SOURCE,
    origin_candidate_digest:dg(`origin-candidate-${label}`),
    origin_lineage_digest:dg(`origin-lineage-${label}`),
    sanitized_summary_digest:dg(`summary-${label}`),
    distilled_recipe_digest:dg(`recipe-${label}`),
    supporting_evidence_digest:dg(`support-${label}`),
    counterevidence_digest:dg(`counter-${label}`),
    falsification_test_digest:dg(`falsify-${label}`),
    source_context_digest:dg(`source-context-${label}`),
    local_revalidation_protocol_digest:dg(`revalidate-${label}`),
    negative_transfer_probe_digest:dg(`negative-transfer-${label}`),
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
    admission_id:`phase29.experience.admission.${label}`,
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
  return {hypothesis,admission};
}

function routing(label='one',shared=sharedExperience(label)){
  const request=createRsiEvaluationRoutingRequest({
    request_id:`phase29.request.${label}`,
    hypothesis:shared.hypothesis,
    admission:shared.admission,
    external_measurement_digest:dg(`measurement-${label}`),
    proxy_score_digest:dg(`proxy-${label}`),
    uncertainty:0.8,
    decision_closeness:0.8,
    proxy_reliability_gap:0.2,
    external_measurement_owner:true,
    authored_by_candidate:false,
  });
  const plan=createRsiEvaluationBudgetPlan({
    plan_id:`phase29.plan.${label}`,
    source_sha:SOURCE,
    requests:[request],
    epoch_budget_units:8,
    external_budget_owner:true,
    authored_by_candidate:false,
  });
  return {...shared,request,plan,plan_requests:[request]};
}

function upstreamRevision(label='one'){
  const shared=sharedExperience(`upstream-${label}`);
  const route=routing(`upstream-${label}`,shared);
  const intent=createRsiCandidateExperimentIntent({
    intent_id:`phase29.upstream.intent.${label}`,
    request:route.request,
    plan:route.plan,
    plan_requests:route.plan_requests,
    hypothesis:route.hypothesis,
    admission:route.admission,
    baseline_artifact_digest:dg(`upstream-baseline-${label}`),
    candidate_artifact_digest:dg(`upstream-parent-candidate-${label}`),
    sealed_task_set_digest:dg(`upstream-tasks-${label}`),
    harness_digest:dg(`upstream-harness-${label}`),
    evaluator_root_digest:dg(`upstream-evaluator-${label}`),
    trial_worker_image_digest:dg(`upstream-worker-${label}`),
    resource_budget_digest:dg(`upstream-budget-${label}`),
    task_order_digest:dg(`upstream-order-${label}`),
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
  const receipt=createRsiCandidateExperimentReceipt({
    receipt_id:`phase29.upstream.receipt.${label}`,
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
    environment_blocker_detected:false,
    controllable_failure_detected:false,
    ambiguous_effect:false,
    evidence_digest:dg(`upstream-evidence-${label}`),
    external_runner:true,
    external_evaluator:true,
    authored_by_candidate:false,
  });
  const envelope=createRsiBoundedRevisionEnvelope({
    envelope_id:`phase29.envelope.${label}`,
    intent,
    receipt,
    experiment_ledger_state_digest:dg(`ledger-${label}`),
    editable_scope_digest:dg(`scope-${label}`),
    preserved_behavior_digest:dg(`preserve-${label}`),
    negative_evidence_root_digest:dg(`negative-${label}`),
    regression_budget_digest:dg(`regression-${label}`),
    validation_plan_digest:dg(`validation-${label}`),
    trust_root_policy_digest:dg(`trust-${label}`),
    evaluator_policy_digest:dg(`eval-policy-${label}`),
    scheduler_policy_digest:dg(`scheduler-${label}`),
    self_update_policy_digest:dg(`self-update-${label}`),
    production_authority_policy_digest:dg(`production-${label}`),
    security_boundary_digest:dg(`security-${label}`),
    max_mutated_files:2,
    max_edit_operations:5,
    max_changed_bytes:4096,
    external_revision_controller:true,
  });
  const proposal=createRsiBoundedRevisionProposal({
    proposal_id:`phase29.proposal.${label}`,
    envelope,
    candidate_revision_spec_digest:dg(`spec-${label}`),
    proposed_child_artifact_identity_digest:dg(`child-identity-${label}`),
    mutation_categories:['VALIDATION'],
    estimated_mutated_files:1,
    estimated_edit_operations:3,
    estimated_changed_bytes:2048,
    expected_preserved_behavior_receipt_digest:dg(`preserved-receipt-${label}`),
    expected_regression_test_root_digest:dg(`regression-tests-${label}`),
    candidate_optimizer_id_digest:dg(`optimizer-${label}`),
    authored_by_optimizer:true,
  });
  return {...route,intent,receipt,envelope,proposal};
}

function provenance(label){
  return {
    harness_manifest_digest:dg(`manifest-harness-${label}`),
    harness_signature_bundle_digest:dg(`manifest-signature-${label}`),
    manifest_signer_root_digest:dg(`manifest-signer-${label}`),
    toolchain_digest:dg(`toolchain-${label}`),
    dependency_lock_digest:dg(`dependency-lock-${label}`),
    dependency_closure_digest:dg(`dependency-closure-${label}`),
    capability_profile_digest:dg(`capability-${label}`),
    network_policy_digest:dg(`network-policy-${label}`),
    build_recipe_digest:dg(`build-recipe-${label}`),
    expected_builder_identity_digest:dg(`builder-${label}`),
    external_manifest_verifier:true,
    harness_signature_verified:true,
  };
}

function bridgeFixture(label='one'){
  const upstream=upstreamRevision(label);
  const approved=[{path:'apps/metaengine-browser/src/rsi-shadow-observer.mjs',change:'MODIFY'}];
  const bridge=createRsiBoundedRevisionDevosBridge({
    envelope:upstream.envelope,
    proposal:upstream.proposal,
    experiment_intent:upstream.intent,
    experiment_receipt:upstream.receipt,
    mutation_surface:'RSI_IMPROVER',
    approved_mutations:approved,
    approved_mutation_manifest_digest:objDigest(approved),
    implementation_reviewer_root_digest:dg(`implementation-reviewer-${label}`),
    ...provenance(label),
    external_implementation_reviewer:true,
  });
  return {...upstream,bridge,approved};
}

function candidateHandoff(bridge,label='one'){
  const core={
    schema:'metaengine.rsi.isolated-candidate-handoff.v1',
    version:1,
    experiment_id:bridge.devos_experiment_plan.experiment_id,
    mutation_surface:bridge.mutation_surface,
    parent_sha:bridge.source_sha,
    candidate_sha:'b'.repeat(40),
    target_branch:bridge.devos_experiment_plan.target_branch,
    build_plan_id:`rsi_build_${'c'.repeat(64)}`,
    build_plan_digest:dg(`build-plan-${label}`),
    workspace_binding_readback_digest:dg(`workspace-${label}`),
    materialization_digest:dg(`materialization-${label}`),
    candidate_capsule:{
      evidence:[
        {name:'SOURCE_SNAPSHOT',digest:dg(`source-snapshot-${label}`)},
        {name:'WORKSPACE_BINDING_READBACK',digest:dg(`workspace-${label}`)},
        {name:'MATERIALIZATION_RECEIPT',digest:dg(`materialization-${label}`)},
        {name:'OUTPUT_MANIFEST',digest:dg(`output-manifest-${label}`)},
      ],
    },
    candidate_verification:{ok:true,executable:false,promotion_authorized:false},
    sandbox_plan:{mode:'PREPARE_ONLY',filesystem:{host_repository_mounted:false},network:{deny_by_default:true,allowed_hosts:[]}},
    sandbox_plan_verification:{execution_authorized:false},
    eligible_for_evaluation:true,
    eligible_for_promotion:false,
    materialization_replay_authorized:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,handoff_digest:objDigest(core)});
}

function phase28Artifact(label='one'){
  const fx=bridgeFixture(label);
  const candidate_handoff=candidateHandoff(fx.bridge,label);
  const artifact_receipt=createRsiBoundedRevisionArtifactReceipt({
    bridge:fx.bridge,
    candidate_handoff,
    artifact_bundle_digest:dg(`artifact-bundle-${label}`),
    sbom_digest:dg(`sbom-${label}`),
    provenance_statement_digest:dg(`provenance-${label}`),
    artifact_signature_bundle_digest:dg(`artifact-signature-${label}`),
    external_artifact_signer_root_digest:dg(`artifact-signer-${label}`),
    builder_identity_digest:fx.bridge.implementation_manifest.expected_builder_identity_digest,
    external_provenance_verifier:true,
    provenance_verified:true,
    materials_complete:true,
    hermeticity_pass:true,
    artifact_signature_verified:true,
    network_egress_observed:false,
    undeclared_dependency_observed:false,
    host_dependency_observed:false,
  });
  return {...fx,candidate_handoff,artifact_receipt};
}

function phase29Handoff(label='one'){
  const artifact=phase28Artifact(label);
  const evalRoute=routing(`eval-${label}`);
  const handoff=createRsiImplementationEvaluationHandoff({
    handoff_id:`implementation-eval.${label}`,
    bridge:artifact.bridge,
    revision_envelope:artifact.envelope,
    revision_proposal:artifact.proposal,
    artifact_receipt:artifact.artifact_receipt,
    candidate_handoff:artifact.candidate_handoff,
    request:evalRoute.request,
    plan:evalRoute.plan,
    plan_requests:evalRoute.plan_requests,
    hypothesis:evalRoute.hypothesis,
    admission:evalRoute.admission,
    sealed_task_set_digest:dg(`phase29-tasks-${label}`),
    evaluator_root_digest:dg(`phase29-evaluator-${label}`),
    trial_worker_image_digest:dg(`phase29-worker-${label}`),
    resource_budget_digest:dg(`phase29-budget-${label}`),
    task_order_digest:dg(`phase29-order-${label}`),
    external_evaluation_owner:true,
    authored_by_candidate:false,
  });
  return {...artifact,evalRoute,handoff};
}

function evaluationReceipt(handoff,label='one',overrides={}){
  return createRsiCandidateExperimentReceipt({
    receipt_id:`phase29.evaluation.receipt.${label}`,
    intent:handoff.experiment_intent,
    control_metrics:{
      task_utility:0.70,safety:0.95,security:0.95,
      process_integrity:0.90,outcome_integrity:0.90,efficiency:0.70,
    },
    treatment_metrics:{
      task_utility:0.82,safety:0.95,security:0.96,
      process_integrity:0.92,outcome_integrity:0.91,efficiency:0.73,
    },
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
    evidence_digest:dg(`phase29-evidence-${label}`),
    external_runner:true,
    external_evaluator:true,
    authored_by_candidate:false,
    ...overrides,
  });
}

test('Phase29 handoff reuses exact parent-child identities and existing paired evaluator contract',()=>{
  const fx=phase29Handoff('handoff');
  const checked=verifyRsiImplementationEvaluationHandoff(fx.handoff);
  assert.equal(checked.handoff_digest,fx.handoff.handoff_digest);
  assert.equal(fx.handoff.parent_candidate_artifact_digest,fx.envelope.parent_candidate_artifact_digest);
  assert.equal(fx.handoff.child_candidate_artifact_digest,fx.artifact_receipt.artifact_bundle_digest);
  assert.equal(fx.handoff.experiment_intent.baseline_artifact_digest,fx.envelope.parent_candidate_artifact_digest);
  assert.equal(fx.handoff.experiment_intent.candidate_artifact_digest,fx.artifact_receipt.artifact_bundle_digest);
  assert.equal(fx.handoff.experiment_intent.harness_digest,fx.artifact_receipt.harness_manifest_digest);
  assert.equal(fx.handoff.reuses_existing_candidate_experiment_contract,true);
  assert.equal(fx.handoff.reuses_existing_verification_sandbox,true);
  assert.equal(fx.handoff.handoff_can_execute,false);
  assert.equal(fx.handoff.handoff_can_promote,false);
  assert.equal(fx.handoff.authority_effect,false);
});

test('candidate cannot own evaluation handoff or choose its evaluator plane',()=>{
  const fx=phase28Artifact('candidate-owner');
  const route=routing('candidate-owner-eval');
  assert.throws(()=>createRsiImplementationEvaluationHandoff({
    handoff_id:'implementation-eval.candidate-owner',
    bridge:fx.bridge,
    revision_envelope:fx.envelope,
    revision_proposal:fx.proposal,
    artifact_receipt:fx.artifact_receipt,
    candidate_handoff:fx.candidate_handoff,
    request:route.request,plan:route.plan,plan_requests:route.plan_requests,
    hypothesis:route.hypothesis,admission:route.admission,
    sealed_task_set_digest:dg('candidate-owner-tasks'),
    evaluator_root_digest:dg('candidate-owner-evaluator'),
    trial_worker_image_digest:dg('candidate-owner-worker'),
    resource_budget_digest:dg('candidate-owner-budget'),
    task_order_digest:dg('candidate-owner-order'),
    external_evaluation_owner:false,
    authored_by_candidate:true,
  }),/external_owner_required/);
});

test('supported external paired result remains evidence only and cannot replace parent',()=>{
  const fx=phase29Handoff('supported');
  const receipt=evaluationReceipt(fx.handoff,'supported');
  const result=createRsiImplementationEvaluationResult({
    result_id:'implementation-eval-result.supported',
    handoff:fx.handoff,
    experiment_receipt:receipt,
    external_result_owner:true,
    authored_by_candidate:false,
  });
  assert.equal(verifyRsiImplementationEvaluationResult(result,{handoff:fx.handoff,experiment_receipt:receipt}).result_digest,result.result_digest);
  assert.equal(result.state,'EVALUATED_CHILD_SUPPORTED');
  assert.equal(result.no_metric_regression,true);
  assert.equal(result.strict_metric_improvement,true);
  assert.equal(result.eligible_for_new_revision_search,true);
  assert.equal(result.child_can_replace_parent,false);
  assert.equal(result.result_can_promote,false);
  assert.equal(result.result_can_schedule,false);
  assert.equal(result.authority_effect,false);
});

test('regression rejection preserves separate dimensions despite utility improvement',()=>{
  const fx=phase29Handoff('regression');
  const receipt=evaluationReceipt(fx.handoff,'regression',{
    treatment_metrics:{
      task_utility:0.90,safety:0.80,security:0.96,
      process_integrity:0.92,outcome_integrity:0.91,efficiency:0.73,
    },
  });
  const result=createRsiImplementationEvaluationResult({
    result_id:'implementation-eval-result.regression',
    handoff:fx.handoff,experiment_receipt:receipt,
    external_result_owner:true,authored_by_candidate:false,
  });
  assert.equal(result.state,'EVALUATED_CHILD_REJECTED');
  assert.equal(result.no_metric_regression,false);
  assert.ok(result.regressed_metrics.includes('safety'));
  assert.equal(result.eligible_for_new_revision_search,false);
  assert.equal(result.eligible_for_external_learning_review,true);
});

test('environment and ambiguous outcomes remain separate non-retry evidence',()=>{
  const envFx=phase29Handoff('env');
  const envReceipt=evaluationReceipt(envFx.handoff,'env',{environment_blocker_detected:true});
  const envResult=createRsiImplementationEvaluationResult({
    result_id:'implementation-eval-result.env',handoff:envFx.handoff,experiment_receipt:envReceipt,
    external_result_owner:true,authored_by_candidate:false,
  });
  assert.equal(envResult.state,'EVALUATED_CHILD_INCONCLUSIVE_ENVIRONMENT');
  assert.equal(envResult.conclusive_external_evaluation,false);
  assert.equal(envResult.result_can_retry,false);

  const ambFx=phase29Handoff('amb');
  const ambReceipt=evaluationReceipt(ambFx.handoff,'amb',{ambiguous_effect:true});
  const ambResult=createRsiImplementationEvaluationResult({
    result_id:'implementation-eval-result.amb',handoff:ambFx.handoff,experiment_receipt:ambReceipt,
    external_result_owner:true,authored_by_candidate:false,
  });
  assert.equal(ambResult.state,'EVALUATED_CHILD_INCONCLUSIVE_AMBIGUOUS');
  assert.equal(ambResult.conclusive_external_evaluation,false);
  assert.equal(ambResult.result_can_retry,false);
  assert.equal(ambResult.automatic_retry_allowed,false);
});

test('append-only evaluation ledger is durable, preserves negative evidence and allows repeated independent child evaluations',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-implementation-evaluation-ledger-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'ledger.json');
  const ledger=new RsiImplementationEvaluationLedger({statePath,source_sha:SOURCE});
  await ledger.init();

  const first=phase29Handoff('ledger-one');
  const receipt1=evaluationReceipt(first.handoff,'ledger-one');
  const result1=createRsiImplementationEvaluationResult({
    result_id:'implementation-eval-result.ledger-one',handoff:first.handoff,experiment_receipt:receipt1,
    external_result_owner:true,authored_by_candidate:false,
  });
  assert.equal((await ledger.add({handoff:first.handoff,experiment_receipt:receipt1,result:result1})).state,'EVALUATED_CHILD_SUPPORTED');

  const secondRoute=routing('ledger-two-eval');
  const secondHandoff=createRsiImplementationEvaluationHandoff({
    handoff_id:'implementation-eval.ledger-two',
    bridge:first.bridge,
    revision_envelope:first.envelope,
    revision_proposal:first.proposal,
    artifact_receipt:first.artifact_receipt,
    candidate_handoff:first.candidate_handoff,
    request:secondRoute.request,plan:secondRoute.plan,plan_requests:secondRoute.plan_requests,
    hypothesis:secondRoute.hypothesis,admission:secondRoute.admission,
    sealed_task_set_digest:dg('ledger-two-tasks'),
    evaluator_root_digest:dg('ledger-two-evaluator'),
    trial_worker_image_digest:dg('ledger-two-worker'),
    resource_budget_digest:dg('ledger-two-budget'),
    task_order_digest:dg('ledger-two-order'),
    external_evaluation_owner:true,authored_by_candidate:false,
  });
  const receipt2=evaluationReceipt(secondHandoff,'ledger-two',{ambiguous_effect:true});
  const result2=createRsiImplementationEvaluationResult({
    result_id:'implementation-eval-result.ledger-two',handoff:secondHandoff,experiment_receipt:receipt2,
    external_result_owner:true,authored_by_candidate:false,
  });
  assert.equal((await ledger.add({handoff:secondHandoff,experiment_receipt:receipt2,result:result2})).state,'EVALUATED_CHILD_INCONCLUSIVE_AMBIGUOUS');

  const snap=ledger.snapshot();
  assert.equal(snap.row_count,2);
  assert.equal(snap.state_counts.supported,1);
  assert.equal(snap.state_counts.inconclusive_ambiguous,1);
  assert.equal(snap.preserves_negative_evidence,true);
  assert.equal(snap.preserves_inconclusive_evidence,true);
  assert.equal(snap.active_candidate_artifact_digest,null);

  const restored=new RsiImplementationEvaluationLedger({statePath,source_sha:SOURCE});
  await restored.init();
  assert.equal(restored.snapshot().row_count,2);
  assert.equal((await restored.add({handoff:first.handoff,experiment_receipt:receipt1,result:result1})).state,'IDEMPOTENT');
});

test('failed ledger persistence creates no phantom evaluated child evidence',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-implementation-evaluation-persist-fail-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'ledger.json');
  const ledger=new RsiImplementationEvaluationLedger({statePath,source_sha:SOURCE});
  await ledger.init();
  const fx=phase29Handoff('persist-fail');
  const receipt=evaluationReceipt(fx.handoff,'persist-fail');
  const result=createRsiImplementationEvaluationResult({
    result_id:'implementation-eval-result.persist-fail',handoff:fx.handoff,experiment_receipt:receipt,
    external_result_owner:true,authored_by_candidate:false,
  });

  await fs.mkdir(`${statePath}.tmp`);
  await assert.rejects(()=>ledger.add({handoff:fx.handoff,experiment_receipt:receipt,result}));
  assert.equal(ledger.snapshot().row_count,0);
  assert.equal(ledger.snapshot().state_counts.supported,0);
});

test('restart rejects self-rehashed result policy downgrade',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-implementation-evaluation-replay-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'ledger.json');
  const ledger=new RsiImplementationEvaluationLedger({statePath,source_sha:SOURCE});
  await ledger.init();
  const fx=phase29Handoff('replay');
  const receipt=evaluationReceipt(fx.handoff,'replay');
  const result=createRsiImplementationEvaluationResult({
    result_id:'implementation-eval-result.replay',handoff:fx.handoff,experiment_receipt:receipt,
    external_result_owner:true,authored_by_candidate:false,
  });
  await ledger.add({handoff:fx.handoff,experiment_receipt:receipt,result});

  const persisted=JSON.parse(await fs.readFile(statePath,'utf8'));
  const badResultCore={...persisted.rows[0].result,result_can_promote:true};
  delete badResultCore.result_digest;
  persisted.rows[0].result={...badResultCore,result_digest:objDigest(badResultCore)};
  const stateCore=structuredClone(persisted);delete stateCore.state_digest;
  persisted.state_digest=objDigest(stateCore);
  await fs.writeFile(statePath,`${JSON.stringify(persisted)}\n`,'utf8');

  const restored=new RsiImplementationEvaluationLedger({statePath,source_sha:SOURCE});
  await assert.rejects(()=>restored.init(),/result_policy_invalid|result_digest_mismatch|ledger_derived_state_mismatch/);
});

test('Phase29 trust root keeps external evaluation reusable, repeated and zero-authority',()=>{
  const root=rsiImplementationEvaluationHandoffTrustRootSnapshot();
  assert.equal(root.provenance_verified_phase28_artifact_required,true);
  assert.equal(root.exact_parent_child_identity_required,true);
  assert.equal(root.existing_candidate_experiment_contract_required,true);
  assert.equal(root.existing_verification_sandbox_required,true);
  assert.equal(root.external_evaluation_owner_required,true);
  assert.equal(root.target_improvement_and_regression_preservation_separate,true);
  assert.equal(root.environment_invalidity_separate,true);
  assert.equal(root.ambiguity_separate,true);
  assert.equal(root.repeated_independent_child_evaluations_allowed,true);
  assert.equal(root.second_evaluator_forbidden,true);
  assert.equal(root.second_experiment_executor_forbidden,true);
  assert.equal(root.result_can_replace_parent,false);
  assert.equal(root.result_can_promote,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.implementation_evaluation_handoff_root_digest,/^sha256:[0-9a-f]{64}$/);
});
