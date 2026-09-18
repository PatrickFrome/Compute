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
  RsiCandidateExperimentLedger,
  createRsiCandidateExperimentIntent,
  createRsiCandidateExperimentReceipt,
  rsiCandidateExperimentLedgerTrustRootSnapshot,
  verifyRsiCandidateExperimentIntent,
  verifyRsiCandidateExperimentReceipt,
} from '../src/rsi-candidate-experiment-ledger.mjs';

const SOURCE='a'.repeat(40);
function dg(label){return `sha256:${crypto.createHash('sha256').update(String(label),'utf8').digest('hex')}`;}
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function structuralDigest(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}

function routingFixture(label='one'){
  const hypothesis=createRsiSharedExperienceHypothesis({
    hypothesis_id:`experience.hypothesis.${label}`,
    source_sha:SOURCE,
    origin_candidate_digest:dg(`origin-candidate-${label}`),
    origin_lineage_digest:dg(`origin-lineage-${label}`),
    sanitized_summary_digest:dg(`summary-${label}`),
    distilled_recipe_digest:dg(`recipe-${label}`),
    supporting_evidence_digest:dg(`support-${label}`),
    counterevidence_digest:dg(`counter-${label}`),
    falsification_test_digest:dg(`falsification-${label}`),
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
    admission_id:`experience.admission.${label}`,
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
    request_id:`eval.request.${label}`,
    hypothesis,
    admission,
    external_measurement_digest:dg(`measurement-${label}`),
    proxy_score_digest:dg(`proxy-${label}`),
    uncertainty:0.8,
    decision_closeness:0.8,
    proxy_reliability_gap:0.2,
    external_measurement_owner:true,
    authored_by_candidate:false,
  });
  const plan=createRsiEvaluationBudgetPlan({
    plan_id:`eval.plan.${label}`,
    source_sha:SOURCE,
    requests:[request],
    epoch_budget_units:8,
    external_budget_owner:true,
    authored_by_candidate:false,
  });
  assert.deepEqual(plan.selected_request_digests,[request.request_digest]);
  return {hypothesis,admission,request,plan,plan_requests:[request]};
}

function intent(fx,label='one',overrides={}){
  return createRsiCandidateExperimentIntent({
    intent_id:`candidate.experiment.intent.${label}`,
    request:fx.request,
    plan:fx.plan,
    plan_requests:fx.plan_requests,
    hypothesis:fx.hypothesis,
    admission:fx.admission,
    baseline_artifact_digest:dg(`baseline-${label}`),
    candidate_artifact_digest:dg(`candidate-${label}`),
    sealed_task_set_digest:dg(`tasks-${label}`),
    harness_digest:dg(`harness-${label}`),
    evaluator_root_digest:dg(`evaluator-${label}`),
    trial_worker_image_digest:dg(`trial-worker-${label}`),
    resource_budget_digest:dg(`resource-budget-${label}`),
    task_order_digest:dg(`task-order-${label}`),
    external_experiment_owner:true,
    authored_by_candidate:false,
    ...overrides,
  });
}

function controlMetrics(){
  return {
    task_utility:0.70,
    safety:0.95,
    security:0.95,
    process_integrity:0.90,
    outcome_integrity:0.90,
    efficiency:0.70,
  };
}
function treatmentMetrics(overrides={}){
  return {
    task_utility:0.80,
    safety:0.95,
    security:0.96,
    process_integrity:0.92,
    outcome_integrity:0.91,
    efficiency:0.72,
    ...overrides,
  };
}
function receipt(intentRow,label='one',overrides={}){
  return createRsiCandidateExperimentReceipt({
    receipt_id:`candidate.experiment.receipt.${label}`,
    intent:intentRow,
    control_metrics:controlMetrics(),
    treatment_metrics:treatmentMetrics(),
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
    evidence_digest:dg(`experiment-evidence-${label}`),
    external_runner:true,
    external_evaluator:true,
    authored_by_candidate:false,
    ...overrides,
  });
}

test('selected routed hypothesis binds a paired single-attempt experiment with zero authority',()=>{
  const fx=routingFixture();
  const row=intent(fx);
  const checked=verifyRsiCandidateExperimentIntent(row,fx);
  assert.equal(checked.intent_digest,row.intent_digest);
  assert.equal(row.paired_control_treatment,true);
  assert.equal(row.same_sealed_tasks_required,true);
  assert.equal(row.same_task_order_required,true);
  assert.equal(row.same_harness_required,true);
  assert.equal(row.same_resource_budget_required,true);
  assert.equal(row.from_scratch_worker_per_arm_required,true);
  assert.equal(row.max_attempts_per_arm,1);
  assert.equal(row.max_retries,0);
  assert.equal(row.candidate_can_execute_experiment,false);
  assert.equal(row.intent_is_execution_authority,false);
  assert.equal(row.intent_is_scheduler_authority,false);
  assert.equal(row.authority_effect,false);
});

test('request not selected by exact budget plan cannot create an experiment intent',()=>{
  const fx=routingFixture('not-selected');
  const other=routingFixture('other');
  assert.throws(()=>createRsiCandidateExperimentIntent({
    intent_id:'candidate.experiment.intent.not-selected',
    request:fx.request,
    plan:other.plan,
    plan_requests:other.plan_requests,
    hypothesis:fx.hypothesis,
    admission:fx.admission,
    baseline_artifact_digest:dg('baseline-x'),
    candidate_artifact_digest:dg('candidate-x'),
    sealed_task_set_digest:dg('tasks-x'),
    harness_digest:dg('harness-x'),
    evaluator_root_digest:dg('evaluator-x'),
    trial_worker_image_digest:dg('worker-x'),
    resource_budget_digest:dg('budget-x'),
    task_order_digest:dg('order-x'),
    external_experiment_owner:true,
    authored_by_candidate:false,
  }),/source_mismatch|request_not_selected|request_digest_mismatch|hypothesis/);
});

test('clean paired non-regressing improvement is only supported for bounded revision',()=>{
  const fx=routingFixture('supported');
  const i=intent(fx,'supported');
  const r=receipt(i,'supported');
  assert.equal(verifyRsiCandidateExperimentReceipt(r,{intent:i}).receipt_digest,r.receipt_digest);
  assert.equal(r.state,'SUPPORTED_FOR_BOUNDED_REVISION');
  assert.equal(r.eligible_for_bounded_revision,true);
  assert.equal(r.no_metric_regression,true);
  assert.equal(r.strict_metric_improvement,true);
  assert.deepEqual(r.regressed_metrics,[]);
  assert.ok(r.improved_metrics.includes('task_utility'));
  assert.equal(r.receipt_can_mutate_active_state,false);
  assert.equal(r.receipt_can_retry_experiment,false);
  assert.equal(r.receipt_can_schedule_followup,false);
  assert.equal(r.receipt_is_promotion_authority,false);
});

test('any metric regression rejects candidate even when task utility improves',()=>{
  const fx=routingFixture('regression');
  const i=intent(fx,'regression');
  const r=receipt(i,'regression',{
    treatment_metrics:treatmentMetrics({safety:0.80}),
  });
  assert.equal(r.state,'CANDIDATE_EXPERIMENT_REJECTED');
  assert.equal(r.no_metric_regression,false);
  assert.ok(r.regressed_metrics.includes('safety'));
  assert.equal(r.eligible_for_bounded_revision,false);
  assert.equal(r.rejected_or_inconclusive,true);
});

test('equal candidate with no regression but no strict improvement is retained as negative evidence',()=>{
  const fx=routingFixture('equal');
  const i=intent(fx,'equal');
  const r=receipt(i,'equal',{
    treatment_metrics:controlMetrics(),
  });
  assert.equal(r.state,'NO_MATERIAL_IMPROVEMENT');
  assert.equal(r.no_metric_regression,true);
  assert.equal(r.strict_metric_improvement,false);
  assert.equal(r.rejected_or_inconclusive,true);
});

test('environment blocker is inconclusive and separate from candidate failure',()=>{
  const fx=routingFixture('environment');
  const i=intent(fx,'environment');
  const r=receipt(i,'environment',{
    environment_blocker_detected:true,
    controllable_failure_detected:false,
  });
  assert.equal(r.state,'INCONCLUSIVE_ENVIRONMENT');
  assert.equal(r.inconclusive_environment,true);
  assert.equal(r.eligible_for_bounded_revision,false);
  assert.equal(r.validity_blockers.includes('CONTROLLABLE_FAILURE'),false);
});

test('ambiguous effect is inconclusive and cannot grant retry authority',()=>{
  const fx=routingFixture('ambiguous');
  const i=intent(fx,'ambiguous');
  const r=receipt(i,'ambiguous',{ambiguous_effect:true});
  assert.equal(r.state,'INCONCLUSIVE_AMBIGUOUS');
  assert.equal(r.ambiguous_effect,true);
  assert.equal(r.receipt_can_retry_experiment,false);
  assert.equal(r.automatic_retry_allowed,false);
});

test('paired validity failures and reward hacking fail closed',()=>{
  const cases=[
    ['tasks',{same_tasks_pass:false},'TASK_SET_MISMATCH'],
    ['order',{same_task_order_pass:false},'TASK_ORDER_MISMATCH'],
    ['harness',{harness_identity_pass:false},'HARNESS_IDENTITY_MISMATCH'],
    ['budget',{resource_budget_identity_pass:false},'RESOURCE_BUDGET_MISMATCH'],
    ['evaluator',{evaluator_integrity_pass:false},'EVALUATOR_INTEGRITY_FAILURE'],
    ['isolation',{trial_isolation_pass:false},'TRIAL_ISOLATION_FAILURE'],
    ['replay',{from_scratch_replay_pass:false},'FROM_SCRATCH_REPLAY_FAILURE'],
    ['contamination',{contamination_clear:false},'CONTAMINATION_DETECTED'],
    ['reward-hack',{reward_hack_detected:true},'REWARD_HACK_DETECTED'],
    ['blind-retry',{blind_retry_detected:true},'BLIND_RETRY_DETECTED'],
    ['controllable',{controllable_failure_detected:true},'CONTROLLABLE_FAILURE'],
  ];
  for(const [label,overrides,blocker] of cases){
    const fx=routingFixture(label);
    const i=intent(fx,label);
    const r=receipt(i,label,overrides);
    assert.equal(r.state,'CANDIDATE_EXPERIMENT_REJECTED');
    assert.ok(r.validity_blockers.includes(blocker),blocker);
  }
});

test('more than one attempt or any retry is forbidden by experiment receipt contract',()=>{
  const fx=routingFixture('attempts');
  const i=intent(fx,'attempts');
  assert.throws(()=>receipt(i,'attempts',{control_attempts:0}),/single_attempt_required/);
  assert.throws(()=>receipt(i,'retries',{retry_count:1}),/retry_count_invalid|single_attempt_required/);
});

test('append-only ledger retains supported rejected and inconclusive experiments across restart',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-candidate-experiment-ledger-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'ledger.json');
  const ledger=new RsiCandidateExperimentLedger({statePath,source_sha:SOURCE});
  await ledger.init();

  const fx1=routingFixture('ledger-supported');
  const i1=intent(fx1,'ledger-supported');
  const r1=receipt(i1,'ledger-supported');
  assert.equal((await ledger.add({intent:i1,receipt:r1})).state,'SUPPORTED_FOR_BOUNDED_REVISION');

  const fx2=routingFixture('ledger-rejected');
  const i2=intent(fx2,'ledger-rejected');
  const r2=receipt(i2,'ledger-rejected',{treatment_metrics:treatmentMetrics({security:0.80})});
  assert.equal((await ledger.add({intent:i2,receipt:r2})).state,'CANDIDATE_EXPERIMENT_REJECTED');

  const fx3=routingFixture('ledger-env');
  const i3=intent(fx3,'ledger-env');
  const r3=receipt(i3,'ledger-env',{environment_blocker_detected:true});
  assert.equal((await ledger.add({intent:i3,receipt:r3})).state,'INCONCLUSIVE_ENVIRONMENT');

  const snap=ledger.snapshot();
  assert.equal(snap.row_count,3);
  assert.equal(snap.state_counts.supported,1);
  assert.equal(snap.state_counts.rejected,1);
  assert.equal(snap.state_counts.inconclusive_environment,1);
  assert.equal(snap.rejected_evidence_retained,true);
  assert.equal(snap.inconclusive_evidence_retained,true);
  assert.equal(snap.ledger_can_mutate_active_state,false);
  assert.equal(snap.ledger_can_retry_experiment,false);
  assert.equal(snap.ledger_can_schedule_followup,false);
  assert.equal(ledger.supported().length,1);
  assert.equal(ledger.rejectedOrInconclusive().length,2);

  const restored=new RsiCandidateExperimentLedger({statePath,source_sha:SOURCE});
  await restored.init();
  assert.equal(restored.snapshot().row_count,3);
  assert.equal((await restored.add({intent:i1,receipt:r1})).state,'IDEMPOTENT');
});


test('experiment intent is independently replay-verifiable from embedded hardened routing evidence',()=>{
  const fx=routingFixture('embedded-replay');
  const row=intent(fx,'embedded-replay');
  const checked=verifyRsiCandidateExperimentIntent(row);
  assert.equal(checked.intent_digest,row.intent_digest);
  assert.equal(checked.request_snapshot.request_digest,fx.request.request_digest);
  assert.equal(checked.plan_snapshot.plan_digest,fx.plan.plan_digest);
});

test('ledger rejects self-rehashed intent or receipt policy downgrade',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-candidate-experiment-policy-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const ledger=new RsiCandidateExperimentLedger({statePath:path.join(dir,'ledger.json'),source_sha:SOURCE});
  await ledger.init();
  const fx=routingFixture('policy-tamper');
  const goodIntent=intent(fx,'policy-tamper');
  const goodReceipt=receipt(goodIntent,'policy-tamper');

  const badIntentCore={...goodIntent,candidate_can_execute_experiment:true};
  delete badIntentCore.intent_digest;
  const badIntent={...badIntentCore,intent_digest:structuralDigest(badIntentCore)};
  await assert.rejects(()=>ledger.add({intent:badIntent,receipt:goodReceipt}),/intent_policy_invalid/);

  const badReceiptCore={...goodReceipt,receipt_can_retry_experiment:true};
  delete badReceiptCore.receipt_digest;
  const badReceipt={...badReceiptCore,receipt_digest:structuralDigest(badReceiptCore)};
  await assert.rejects(()=>ledger.add({intent:goodIntent,receipt:badReceipt}),/receipt_policy_invalid/);
  assert.equal(ledger.snapshot().row_count,0);
});

test('failed durable experiment write creates no phantom supported or negative evidence',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-candidate-experiment-persist-fail-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'ledger.json');
  const ledger=new RsiCandidateExperimentLedger({statePath,source_sha:SOURCE});
  await ledger.init();
  const fx=routingFixture('persist-fail');
  const rowIntent=intent(fx,'persist-fail');
  const rowReceipt=receipt(rowIntent,'persist-fail');

  await fs.mkdir(statePath);
  await assert.rejects(()=>ledger.add({intent:rowIntent,receipt:rowReceipt}));
  assert.equal(ledger.snapshot().row_count,0);
  assert.equal(ledger.snapshot().state_counts.supported,0);
  assert.deepEqual(ledger.supported(),[]);
  assert.deepEqual(ledger.rejectedOrInconclusive(),[]);
});

test('restart rejects self-rehashed experiment outcome reclassification',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-candidate-experiment-restart-tamper-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'ledger.json');
  const ledger=new RsiCandidateExperimentLedger({statePath,source_sha:SOURCE});
  await ledger.init();
  const fx=routingFixture('restart-tamper');
  const rowIntent=intent(fx,'restart-tamper');
  const rowReceipt=receipt(rowIntent,'restart-tamper');
  await ledger.add({intent:rowIntent,receipt:rowReceipt});

  const persisted=JSON.parse(await fs.readFile(statePath,'utf8'));
  const badReceiptCore={...persisted.rows[0].receipt,state:'NO_MATERIAL_IMPROVEMENT',eligible_for_bounded_revision:false,rejected_or_inconclusive:true};
  delete badReceiptCore.receipt_digest;
  persisted.rows[0].receipt={...badReceiptCore,receipt_digest:structuralDigest(badReceiptCore)};
  persisted.state_counts={supported:0,no_material_improvement:1,rejected:0,inconclusive_environment:0,inconclusive_ambiguous:0};
  const stateCore={...persisted};
  delete stateCore.state_digest;
  persisted.state_digest=structuralDigest(stateCore);
  await fs.writeFile(statePath,`${JSON.stringify(persisted)}\n`,'utf8');

  const restored=new RsiCandidateExperimentLedger({statePath,source_sha:SOURCE});
  await assert.rejects(()=>restored.init(),/receipt_digest_mismatch|receipt_policy_invalid|receipt_intent_mismatch/);
});

test('candidate experiment trust root keeps paired trials external and zero-authority',()=>{
  const root=rsiCandidateExperimentLedgerTrustRootSnapshot();
  assert.equal(root.selected_routing_request_required,true);
  assert.equal(root.paired_control_treatment_required,true);
  assert.equal(root.unchanged_baseline_artifact_required,true);
  assert.equal(root.same_sealed_tasks_required,true);
  assert.equal(root.same_task_order_required,true);
  assert.equal(root.same_harness_required,true);
  assert.equal(root.same_resource_budget_required,true);
  assert.equal(root.from_scratch_trial_worker_required,true);
  assert.equal(root.one_attempt_per_arm,true);
  assert.equal(root.blind_retry_forbidden,true);
  assert.equal(root.external_runner_required,true);
  assert.equal(root.external_evaluator_required,true);
  assert.equal(root.environment_blocker_separate_from_candidate_failure,true);
  assert.equal(root.ambiguous_effect_requires_new_external_intent,true);
  assert.equal(root.rejected_evidence_retained,true);
  assert.equal(root.inconclusive_evidence_retained,true);
  assert.equal(root.supported_result_only_eligible_for_bounded_revision,true);
  assert.equal(root.ledger_can_mutate_active_state,false);
  assert.equal(root.ledger_can_retry_experiment,false);
  assert.equal(root.ledger_can_schedule_followup,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.candidate_experiment_ledger_root_digest,/^sha256:[0-9a-f]{64}$/);
});
