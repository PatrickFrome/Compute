import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createRsiVerifierEvolutionAdmission,
  createRsiVerifierEvolutionReceipt,
} from '../src/rsi-verifier-evolution-admission.mjs';
import {
  RsiVerifierShadowArchive,
  createRsiVerifierShadowEvaluation,
  createRsiVerifierShadowReview,
  rsiVerifierShadowLifecycleTrustRootSnapshot,
  verifyRsiVerifierShadowEvaluation,
  verifyRsiVerifierShadowReview,
} from '../src/rsi-verifier-shadow-lifecycle.mjs';

const SOURCE='a'.repeat(40);

function dg(label){
  return `sha256:${crypto.createHash('sha256').update(String(label),'utf8').digest('hex')}`;
}
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function structuralDigest(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}
function phase21Metrics(){
  return {
    false_positive_rate:0.02,
    false_negative_rate:0.03,
    reward_hack_detection_rate:0.90,
    environment_blocker_calibration_rate:0.85,
    process_outcome_agreement_rate:0.90,
    transfer_agreement_rate:0.88,
  };
}
function phase21CandidateMetrics(){
  return {
    false_positive_rate:0.01,
    false_negative_rate:0.02,
    reward_hack_detection_rate:0.92,
    environment_blocker_calibration_rate:0.88,
    process_outcome_agreement_rate:0.92,
    transfer_agreement_rate:0.90,
  };
}
function phase21(candidateLabel='candidate-one'){
  const receipt=createRsiVerifierEvolutionReceipt({
    receipt_id:`verifier.receipt.${candidateLabel}`,
    source_sha:SOURCE,
    incumbent_verifier_root_digest:dg('incumbent-root'),
    candidate_verifier_root_digest:dg(candidateLabel),
    sealed_benchmark_root_digest:dg(`sealed-benchmark-${candidateLabel}`),
    transfer_holdout_digest:dg(`transfer-holdout-${candidateLabel}`),
    reward_hack_suite_digest:dg(`reward-hack-suite-${candidateLabel}`),
    external_evaluator_root_digest:dg(`external-evaluator-${candidateLabel}`),
    paired_comparison_digest:dg(`paired-comparison-${candidateLabel}`),
    incumbent_metrics:phase21Metrics(),
    candidate_metrics:phase21CandidateMetrics(),
    sample_count:128,
    reward_hack_exploitation_count:0,
    hidden_benchmark_exposure_detected:false,
    evaluator_integrity_pass:true,
    from_scratch_replay_pass:true,
    same_examples_compared:true,
    process_outcome_labels_separate:true,
    controllable_environment_labels_separate:true,
    external_evaluator:true,
    authored_by_candidate:false,
  });
  const admission=createRsiVerifierEvolutionAdmission({
    admission_id:`verifier.admission.${candidateLabel}`,
    receipt,
    external_admission_owner:true,
    authored_by_candidate:false,
  });
  assert.equal(admission.state,'QUALIFIED_FOR_VERIFIER_SHADOW');
  return {receipt,admission};
}
function incumbentShadowMetrics(){
  return {
    anchor_agreement_rate:0.90,
    heldout_anchor_agreement_rate:0.88,
    consensus_agreement_rate:0.89,
    construction_audit_pass_rate:0.90,
  };
}
function candidateShadowMetrics(overrides={}){
  return {
    anchor_agreement_rate:0.92,
    heldout_anchor_agreement_rate:0.91,
    consensus_agreement_rate:0.90,
    construction_audit_pass_rate:0.94,
    ...overrides,
  };
}
function evaluation(fx,label='one',overrides={}){
  return createRsiVerifierShadowEvaluation({
    evaluation_id:`shadow.evaluation.${label}`,
    admission:fx.admission,
    receipt:fx.receipt,
    trusted_runtime_digest:dg(`trusted-runtime-${label}`),
    anchor_set_digest:dg(`anchor-set-${label}`),
    heldout_anchor_digest:dg(`heldout-anchor-${label}`),
    semantic_audit_digest:dg(`semantic-audit-${label}`),
    freshness_probe_digest:dg(`freshness-probe-${label}`),
    incumbent_metrics:incumbentShadowMetrics(),
    candidate_metrics:candidateShadowMetrics(),
    specialty_tags:['PROCESS','SECURITY'],
    contamination_detected:false,
    trusted_runtime_integrity_pass:true,
    sealed_anchor_integrity_pass:true,
    semantic_construction_audit_pass:true,
    external_observer:true,
    authored_by_candidate:false,
    ...overrides,
  });
}
function review(fx,evalRow,label='one'){
  return createRsiVerifierShadowReview({
    review_id:`shadow.review.${label}`,
    evaluation:evalRow,
    admission:fx.admission,
    receipt:fx.receipt,
    external_reviewer:true,
    authored_by_candidate:false,
  });
}

test('qualified verifier candidate advances only to archive eligibility while incumbent stays active',()=>{
  const fx=phase21();
  const row=evaluation(fx);
  const checked=verifyRsiVerifierShadowEvaluation(row,{admission:fx.admission,receipt:fx.receipt});
  assert.equal(checked.clean_shadow_evidence,true);
  assert.deepEqual(checked.regressed_metrics,[]);
  assert.ok(checked.improved_metrics.length>0);
  assert.equal(checked.candidate_can_read_heldout_anchor,false);
  assert.equal(checked.candidate_can_modify_trusted_runtime,false);
  assert.equal(checked.evaluation_is_activation_authority,false);

  const result=review(fx,row);
  assert.equal(verifyRsiVerifierShadowReview(result,{evaluation:row,admission:fx.admission,receipt:fx.receipt}).review_digest,result.review_digest);
  assert.equal(result.state,'ELIGIBLE_FOR_VERIFIER_ARCHIVE');
  assert.equal(result.eligible_for_verifier_archive,true);
  assert.equal(result.incumbent_verifier_remains_active,true);
  assert.equal(result.archive_preserves_multiple_candidates,true);
  assert.equal(result.greedy_replacement_forbidden,true);
  assert.equal(result.candidate_can_become_active_verifier,false);
  assert.equal(result.authority_effect,false);
});

test('any shadow metric regression blocks archive even when other metrics improve',()=>{
  const fx=phase21();
  const row=evaluation(fx,'regression',{
    candidate_metrics:candidateShadowMetrics({heldout_anchor_agreement_rate:0.80}),
  });
  assert.equal(row.clean_shadow_evidence,false);
  assert.ok(row.regressed_metrics.includes('heldout_anchor_agreement_rate'));
  assert.ok(row.blockers.includes('SHADOW_METRIC_REGRESSION'));
  const result=review(fx,row,'regression');
  assert.equal(result.state,'VERIFIER_SHADOW_REJECTED');
  assert.equal(result.eligible_for_verifier_archive,false);
});

test('benchmark contamination and integrity failures fail closed',()=>{
  const fx=phase21();
  for(const [label,overrides,blocker] of [
    ['contamination',{contamination_detected:true},'BENCHMARK_CONTAMINATION_DETECTED'],
    ['runtime',{trusted_runtime_integrity_pass:false},'TRUSTED_RUNTIME_INTEGRITY_FAILURE'],
    ['anchor',{sealed_anchor_integrity_pass:false},'SEALED_ANCHOR_INTEGRITY_FAILURE'],
    ['semantic',{semantic_construction_audit_pass:false},'SEMANTIC_CONSTRUCTION_AUDIT_FAILURE'],
  ]){
    const row=evaluation(fx,label,overrides);
    assert.ok(row.blockers.includes(blocker),blocker);
    assert.equal(review(fx,row,label).state,'VERIFIER_SHADOW_REJECTED');
  }
});

test('trusted runtime anchors holdout audit and freshness roots must remain independent',()=>{
  const fx=phase21();
  const same=dg('same-root');
  assert.throws(()=>evaluation(fx,'root-alias',{
    trusted_runtime_digest:same,
    anchor_set_digest:same,
  }),/independent_roots_required/);
});

test('append-only archive preserves multiple qualified niches without choosing a scalar winner',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-verifier-shadow-archive-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'archive.json');
  const archive=new RsiVerifierShadowArchive({statePath,source_sha:SOURCE});
  await archive.init();

  const fx1=phase21('candidate-one');
  const eval1=evaluation(fx1,'candidate-one',{specialty_tags:['PROCESS','SECURITY']});
  const review1=review(fx1,eval1,'candidate-one');
  assert.equal((await archive.add({evaluation:eval1,review:review1})).state,'ELIGIBLE_FOR_VERIFIER_ARCHIVE');

  const fx2=phase21('candidate-two');
  const eval2=evaluation(fx2,'candidate-two',{
    specialty_tags:['TRANSFER','SEMANTIC'],
    candidate_metrics:candidateShadowMetrics({construction_audit_pass_rate:0.96}),
  });
  const review2=review(fx2,eval2,'candidate-two');
  assert.equal((await archive.add({evaluation:eval2,review:review2})).state,'ELIGIBLE_FOR_VERIFIER_ARCHIVE');

  const snap=archive.snapshot();
  assert.equal(snap.eligible_count,2);
  assert.equal(snap.archive_preserves_multiple_candidates,true);
  assert.equal(snap.archive_has_scalar_winner,false);
  assert.equal(snap.active_verifier_root_digest,null);
  assert.equal(snap.archive_can_activate_verifier,false);
  assert.ok(snap.represented_niches.includes('PROCESS'));
  assert.ok(snap.represented_niches.includes('TRANSFER'));

  const restored=new RsiVerifierShadowArchive({statePath,source_sha:SOURCE});
  await restored.init();
  assert.equal(restored.snapshot().eligible_count,2);
  assert.equal((await restored.add({evaluation:eval1,review:review1})).state,'IDEMPOTENT');
});

test('archive rejects a conflicting rewrite of the same candidate identity',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-verifier-shadow-conflict-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const archive=new RsiVerifierShadowArchive({statePath:path.join(dir,'archive.json'),source_sha:SOURCE});
  await archive.init();
  const fx=phase21('candidate-conflict');
  const eval1=evaluation(fx,'candidate-conflict');
  const review1=review(fx,eval1,'candidate-conflict');
  await archive.add({evaluation:eval1,review:review1});

  const eval2=evaluation(fx,'candidate-conflict-2',{
    specialty_tags:['TRANSFER'],
    candidate_metrics:candidateShadowMetrics({anchor_agreement_rate:0.95}),
  });
  const review2=review(fx,eval2,'candidate-conflict-2');
  await assert.rejects(()=>archive.add({evaluation:eval2,review:review2}),/identity_conflict/);
});


test('archive rejects self-rehashed evaluation or review rows that weaken shadow policy',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-verifier-shadow-policy-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const archive=new RsiVerifierShadowArchive({statePath:path.join(dir,'archive.json'),source_sha:SOURCE});
  await archive.init();
  const fx=phase21('candidate-policy');
  const eval1=evaluation(fx,'candidate-policy');
  const review1=review(fx,eval1,'candidate-policy');

  const badEvalCore={...eval1,candidate_can_read_heldout_anchor:true};
  delete badEvalCore.evaluation_digest;
  const badEval={...badEvalCore,evaluation_digest:structuralDigest(badEvalCore)};
  await assert.rejects(()=>archive.add({evaluation:badEval,review:review1}),/evaluation_policy_invalid/);

  const badReviewCore={...review1,candidate_can_become_active_verifier:true};
  delete badReviewCore.review_digest;
  const badReview={...badReviewCore,review_digest:structuralDigest(badReviewCore)};
  await assert.rejects(()=>archive.add({evaluation:eval1,review:badReview}),/review_policy_invalid/);
  assert.equal(archive.snapshot().row_count,0);
});

test('failed durable verifier-shadow archive write does not create phantom in-memory evidence',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-verifier-shadow-persist-fail-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'archive.json');
  const archive=new RsiVerifierShadowArchive({statePath,source_sha:SOURCE});
  await archive.init();
  const fx=phase21('candidate-persist-fail');
  const eval1=evaluation(fx,'candidate-persist-fail');
  const review1=review(fx,eval1,'candidate-persist-fail');

  await fs.mkdir(statePath);
  await assert.rejects(()=>archive.add({evaluation:eval1,review:review1}));
  assert.equal(archive.snapshot().row_count,0);
  assert.equal(archive.snapshot().eligible_count,0);
  assert.deepEqual(archive.eligible(),[]);
});

test('restart rejects a self-rehashed persisted review that changes archive eligibility policy',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-verifier-shadow-restart-policy-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'archive.json');
  const archive=new RsiVerifierShadowArchive({statePath,source_sha:SOURCE});
  await archive.init();
  const fx=phase21('candidate-restart-policy');
  const eval1=evaluation(fx,'candidate-restart-policy');
  const review1=review(fx,eval1,'candidate-restart-policy');
  await archive.add({evaluation:eval1,review:review1});

  const persisted=JSON.parse(await fs.readFile(statePath,'utf8'));
  const badReviewCore={...persisted.rows[0].review,greedy_replacement_forbidden:false};
  delete badReviewCore.review_digest;
  persisted.rows[0].review={...badReviewCore,review_digest:structuralDigest(badReviewCore)};
  const stateCore={...persisted};
  delete stateCore.state_digest;
  persisted.state_digest=structuralDigest(stateCore);
  await fs.writeFile(statePath,`${JSON.stringify(persisted)}\n`,'utf8');

  const restored=new RsiVerifierShadowArchive({statePath,source_sha:SOURCE});
  await assert.rejects(()=>restored.init(),/review_policy_invalid/);
});

test('verifier shadow lifecycle trust root keeps evaluation hidden and zero-authority',()=>{
  const root=rsiVerifierShadowLifecycleTrustRootSnapshot();
  assert.equal(root.phase21_shadow_qualification_required,true);
  assert.equal(root.fixed_trusted_runtime_required,true);
  assert.equal(root.external_anchor_set_required,true);
  assert.equal(root.heldout_anchor_required,true);
  assert.equal(root.semantic_construction_audit_required,true);
  assert.equal(root.freshness_probe_required,true);
  assert.equal(root.benchmark_contamination_blocks_archive,true);
  assert.equal(root.candidate_can_read_heldout_anchor,false);
  assert.equal(root.candidate_can_modify_trusted_runtime,false);
  assert.equal(root.no_shadow_metric_regression_required,true);
  assert.equal(root.at_least_one_shadow_metric_improvement_required,true);
  assert.equal(root.multiple_candidate_archive_required,true);
  assert.equal(root.scalar_winner_forbidden,true);
  assert.equal(root.incumbent_verifier_remains_active,true);
  assert.equal(root.archive_can_activate_verifier,false);
  assert.equal(root.archive_can_gate_canary,false);
  assert.equal(root.archive_can_gate_promotion,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.verifier_shadow_lifecycle_root_digest,/^sha256:[0-9a-f]{64}$/);
});
