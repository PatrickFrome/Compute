import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  RsiVerifierEvolutionLedger,
  createRsiVerifierEvolutionAdmission,
  createRsiVerifierEvolutionReceipt,
  rsiVerifierEvolutionAdmissionTrustRootSnapshot,
  verifyRsiVerifierEvolutionAdmission,
  verifyRsiVerifierEvolutionReceipt,
} from '../src/rsi-verifier-evolution-admission.mjs';

const SOURCE='a'.repeat(40);

function dg(label){
  return `sha256:${crypto.createHash('sha256').update(String(label),'utf8').digest('hex')}`;
}
function incumbentMetrics(){
  return {
    false_positive_rate:0.02,
    false_negative_rate:0.03,
    reward_hack_detection_rate:0.90,
    environment_blocker_calibration_rate:0.85,
    process_outcome_agreement_rate:0.90,
    transfer_agreement_rate:0.88,
  };
}
function improvedMetrics(overrides={}){
  return {
    false_positive_rate:0.01,
    false_negative_rate:0.03,
    reward_hack_detection_rate:0.92,
    environment_blocker_calibration_rate:0.86,
    process_outcome_agreement_rate:0.91,
    transfer_agreement_rate:0.90,
    ...overrides,
  };
}
function receipt(overrides={}){
  return createRsiVerifierEvolutionReceipt({
    receipt_id:overrides.receipt_id||'verifier.receipt.one',
    source_sha:SOURCE,
    incumbent_verifier_root_digest:overrides.incumbent_verifier_root_digest||dg('incumbent-root'),
    candidate_verifier_root_digest:overrides.candidate_verifier_root_digest||dg('candidate-root'),
    sealed_benchmark_root_digest:overrides.sealed_benchmark_root_digest||dg('sealed-benchmark'),
    transfer_holdout_digest:overrides.transfer_holdout_digest||dg('transfer-holdout'),
    reward_hack_suite_digest:overrides.reward_hack_suite_digest||dg('reward-hack-suite'),
    external_evaluator_root_digest:overrides.external_evaluator_root_digest||dg('external-evaluator'),
    paired_comparison_digest:overrides.paired_comparison_digest||dg('paired-comparison'),
    incumbent_metrics:overrides.incumbent_metrics||incumbentMetrics(),
    candidate_metrics:overrides.candidate_metrics||improvedMetrics(),
    sample_count:overrides.sample_count||128,
    reward_hack_exploitation_count:overrides.reward_hack_exploitation_count??0,
    hidden_benchmark_exposure_detected:overrides.hidden_benchmark_exposure_detected??false,
    evaluator_integrity_pass:overrides.evaluator_integrity_pass??true,
    from_scratch_replay_pass:overrides.from_scratch_replay_pass??true,
    same_examples_compared:overrides.same_examples_compared??true,
    process_outcome_labels_separate:overrides.process_outcome_labels_separate??true,
    controllable_environment_labels_separate:overrides.controllable_environment_labels_separate??true,
    external_evaluator:overrides.external_evaluator??true,
    authored_by_candidate:overrides.authored_by_candidate??false,
  });
}
function admission(row,overrides={}){
  return createRsiVerifierEvolutionAdmission({
    admission_id:overrides.admission_id||'verifier.admission.one',
    receipt:row,
    external_admission_owner:overrides.external_admission_owner??true,
    authored_by_candidate:overrides.authored_by_candidate??false,
  });
}

test('Pareto non-regressing verifier candidate qualifies for shadow only',()=>{
  const row=receipt();
  const checked=verifyRsiVerifierEvolutionReceipt(row);
  assert.equal(checked.non_regression_pass,true);
  assert.equal(checked.strict_improvement_pass,true);
  assert.equal(checked.eligible_for_verifier_shadow,true);
  assert.deepEqual(checked.regressed_metrics,[]);
  assert.ok(checked.improved_metrics.length>0);
  assert.equal(checked.receipt_is_activation_authority,false);

  const result=admission(row);
  assert.equal(verifyRsiVerifierEvolutionAdmission(result,{receipt:row}).admission_digest,result.admission_digest);
  assert.equal(result.state,'QUALIFIED_FOR_VERIFIER_SHADOW');
  assert.equal(result.qualified_for_verifier_shadow,true);
  assert.equal(result.incumbent_verifier_remains_active,true);
  assert.equal(result.verifier_shadow_is_observation_only,true);
  assert.equal(result.verifier_shadow_can_gate_canary,false);
  assert.equal(result.verifier_shadow_can_gate_promotion,false);
  assert.equal(result.verifier_shadow_can_modify_reward,false);
  assert.equal(result.execution_authority,false);
  assert.equal(result.authority_effect,false);
});

test('any metric regression rejects verifier evolution even if several metrics improve',()=>{
  const row=receipt({
    candidate_metrics:improvedMetrics({false_positive_rate:0.04}),
  });
  assert.equal(row.non_regression_pass,false);
  assert.ok(row.regressed_metrics.includes('false_positive_rate'));
  assert.equal(row.eligible_for_verifier_shadow,false);
  const result=admission(row);
  assert.equal(result.state,'VERIFIER_EVOLUTION_REJECTED');
  assert.equal(result.qualified_for_verifier_shadow,false);
});

test('no strict improvement rejects incumbent-equivalent verifier clone',()=>{
  const row=receipt({
    candidate_metrics:incumbentMetrics(),
  });
  assert.equal(row.non_regression_pass,true);
  assert.equal(row.strict_improvement_pass,false);
  assert.ok(row.blockers.includes('NO_STRICT_IMPROVEMENT'));
  assert.equal(admission(row).state,'VERIFIER_EVOLUTION_REJECTED');
});

test('reward-hack exploitation, benchmark exposure and evaluator failures block shadow qualification',()=>{
  for(const [label,override,blocker] of [
    ['exploit',{reward_hack_exploitation_count:1},'REWARD_HACK_EXPLOITATION'],
    ['exposure',{hidden_benchmark_exposure_detected:true},'BENCHMARK_EXPOSURE'],
    ['integrity',{evaluator_integrity_pass:false},'EVALUATOR_INTEGRITY_FAILURE'],
    ['replay',{from_scratch_replay_pass:false},'FROM_SCRATCH_REPLAY_FAILURE'],
  ]){
    const row=receipt({receipt_id:`verifier.receipt.${label}`,candidate_verifier_root_digest:dg(`candidate-${label}`),...override});
    assert.ok(row.blockers.includes(blocker),blocker);
    assert.equal(row.eligible_for_verifier_shadow,false);
  }
});

test('sealed benchmark, reward-hack suite and external evaluator roots must be independent',()=>{
  assert.throws(()=>receipt({
    sealed_benchmark_root_digest:dg('same-root'),
    reward_hack_suite_digest:dg('same-root'),
  }),/independent_roots_required/);
  assert.throws(()=>receipt({
    external_evaluator:false,
    authored_by_candidate:true,
  }),/external_evaluator_required/);
  assert.throws(()=>receipt({
    same_examples_compared:false,
  }),/paired_evaluation_policy_invalid/);
});

test('append-only ledger survives restart and rejects conflicting candidate identity',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-verifier-evolution-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'ledger.json');
  const row=receipt();
  const admit=admission(row);
  const ledger=new RsiVerifierEvolutionLedger({statePath,source_sha:SOURCE});
  await ledger.init();
  const stored=await ledger.add({receipt:row,admission:admit});
  assert.equal(stored.state,'QUALIFIED_FOR_VERIFIER_SHADOW');
  assert.equal(ledger.snapshot().qualified_count,1);
  assert.equal(ledger.snapshot().active_verifier_root_digest,null);
  assert.equal(ledger.snapshot().ledger_can_activate_verifier,false);

  const restarted=new RsiVerifierEvolutionLedger({statePath,source_sha:SOURCE});
  await restarted.init();
  assert.equal(restarted.snapshot().qualified_count,1);
  assert.equal((await restarted.add({receipt:row,admission:admit})).state,'IDEMPOTENT');

  const conflicting=receipt({
    receipt_id:'verifier.receipt.conflict',
    candidate_metrics:improvedMetrics({transfer_agreement_rate:0.95}),
  });
  const conflictingAdmission=admission(conflicting,{admission_id:'verifier.admission.conflict'});
  await assert.rejects(
    ()=>restarted.add({receipt:conflicting,admission:conflictingAdmission}),
    /identity_conflict/,
  );
});

test('verifier evolution trust root keeps incumbent active and candidate shadow zero-authority',()=>{
  const root=rsiVerifierEvolutionAdmissionTrustRootSnapshot();
  assert.equal(root.paired_same_examples_required,true);
  assert.equal(root.process_outcome_labels_separate,true);
  assert.equal(root.controllable_environment_labels_separate,true);
  assert.equal(root.sealed_benchmark_required,true);
  assert.equal(root.transfer_holdout_required,true);
  assert.equal(root.reward_hack_suite_required,true);
  assert.equal(root.external_evaluator_required,true);
  assert.equal(root.no_metric_regression_required,true);
  assert.equal(root.at_least_one_strict_metric_improvement_required,true);
  assert.equal(root.reward_hack_exploitation_forbidden,true);
  assert.equal(root.hidden_benchmark_exposure_forbidden,true);
  assert.equal(root.incumbent_verifier_remains_active,true);
  assert.equal(root.candidate_qualified_for_shadow_only,true);
  assert.equal(root.verifier_shadow_can_gate_canary,false);
  assert.equal(root.verifier_shadow_can_gate_promotion,false);
  assert.equal(root.candidate_can_self_activate,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.verifier_evolution_root_digest,/^sha256:[0-9a-f]{64}$/);
});
