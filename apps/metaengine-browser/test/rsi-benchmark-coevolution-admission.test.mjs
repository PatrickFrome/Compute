import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  RsiBenchmarkCoevolutionLedger,
  createRsiBenchmarkCoevolutionAdmission,
  createRsiBenchmarkGenerationProposal,
  createRsiBenchmarkValidityReceipt,
  rsiBenchmarkCoevolutionTrustRootSnapshot,
  verifyRsiBenchmarkCoevolutionAdmission,
  verifyRsiBenchmarkGenerationProposal,
  verifyRsiBenchmarkValidityReceipt,
} from '../src/rsi-benchmark-coevolution-admission.mjs';

const SOURCE='a'.repeat(40);
function dg(label){return `sha256:${crypto.createHash('sha256').update(String(label),'utf8').digest('hex')}`;}
function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function objDigest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;}

function proposal(overrides={}){
  return createRsiBenchmarkGenerationProposal({
    proposal_id:overrides.proposal_id||'benchmark.proposal.one',
    source_sha:SOURCE,
    generation_index:overrides.generation_index||2,
    parent_generation_digest:overrides.parent_generation_digest||dg('generation-1'),
    proposed_generation_digest:overrides.proposed_generation_digest||dg('generation-2'),
    incumbent_verifier_root_digest:overrides.incumbent_verifier_root_digest||dg('incumbent-verifier'),
    trusted_runtime_digest:overrides.trusted_runtime_digest||dg('trusted-runtime'),
    anchor_set_digest:overrides.anchor_set_digest||dg('anchor-set'),
    previous_mastery_receipt_digest:overrides.previous_mastery_receipt_digest||dg('mastery-receipt'),
    task_distribution_digest:overrides.task_distribution_digest||dg('task-distribution'),
    difficulty_delta_digest:overrides.difficulty_delta_digest||dg('difficulty-delta'),
    mastery_threshold_met:overrides.mastery_threshold_met??true,
    difficulty_increase_certified:overrides.difficulty_increase_certified??true,
    external_curriculum_owner:overrides.external_curriculum_owner??true,
    authored_by_candidate:overrides.authored_by_candidate??false,
  });
}
function receipt(p,overrides={}){
  return createRsiBenchmarkValidityReceipt({
    receipt_id:overrides.receipt_id||'benchmark.receipt.one',
    proposal:p,
    sealed_task_audit_digest:overrides.sealed_task_audit_digest||dg('sealed-task-audit'),
    contamination_probe_digest:overrides.contamination_probe_digest||dg('contamination-probe'),
    prompt_test_alignment_digest:overrides.prompt_test_alignment_digest||dg('prompt-test-alignment'),
    semantic_coverage_audit_digest:overrides.semantic_coverage_audit_digest||dg('semantic-coverage'),
    noop_ablation_digest:overrides.noop_ablation_digest||dg('noop-ablation'),
    anchor_recalibration_digest:overrides.anchor_recalibration_digest||dg('anchor-recalibration'),
    hidden_holdout_digest:overrides.hidden_holdout_digest||dg('hidden-holdout'),
    contamination_clear:overrides.contamination_clear??true,
    broken_task_audit_pass:overrides.broken_task_audit_pass??true,
    prompt_test_alignment_pass:overrides.prompt_test_alignment_pass??true,
    semantic_coverage_pass:overrides.semantic_coverage_pass??true,
    noop_ablation_pass:overrides.noop_ablation_pass??true,
    anchor_recalibration_pass:overrides.anchor_recalibration_pass??true,
    hidden_holdout_pass:overrides.hidden_holdout_pass??true,
    incumbent_score_comparable:overrides.incumbent_score_comparable??true,
    external_benchmark_auditor:overrides.external_benchmark_auditor??true,
    authored_by_candidate:overrides.authored_by_candidate??false,
  });
}
function admission(p,r,overrides={}){
  return createRsiBenchmarkCoevolutionAdmission({
    admission_id:overrides.admission_id||'benchmark.admission.one',
    proposal:p,
    receipt:r,
    external_admission_owner:overrides.external_admission_owner??true,
    authored_by_candidate:overrides.authored_by_candidate??false,
  });
}

test('mastery-throttled benchmark generation qualifies only for shadow with active benchmark unchanged',()=>{
  const p=proposal();
  assert.equal(verifyRsiBenchmarkGenerationProposal(p).proposal_digest,p.proposal_digest);
  const r=receipt(p);
  assert.equal(verifyRsiBenchmarkValidityReceipt(r,{proposal:p}).receipt_digest,r.receipt_digest);
  const a=admission(p,r);
  assert.equal(verifyRsiBenchmarkCoevolutionAdmission(a,{proposal:p,receipt:r}).admission_digest,a.admission_digest);
  assert.equal(a.state,'QUALIFIED_FOR_BENCHMARK_SHADOW');
  assert.equal(a.qualified_for_benchmark_shadow,true);
  assert.equal(a.active_benchmark_unchanged,true);
  assert.equal(a.benchmark_shadow_observation_only,true);
  assert.equal(a.benchmark_shadow_can_change_training,false);
  assert.equal(a.candidate_can_self_activate_generation,false);
  assert.equal(a.authority_effect,false);
});

test('benchmark difficulty cannot advance before externally verified mastery',()=>{
  assert.throws(()=>proposal({mastery_threshold_met:false}),/mastery_throttle_required/);
  assert.throws(()=>proposal({difficulty_increase_certified:false}),/mastery_throttle_required/);
  assert.throws(()=>proposal({external_curriculum_owner:false,authored_by_candidate:true}),/external_curriculum_owner_required/);
});

test('contamination broken tasks underspecified tests low coverage no-op failure and recalibration failure all block benchmark shadow',()=>{
  const cases=[
    ['contamination',{contamination_clear:false},'CONTAMINATION_DETECTED'],
    ['broken',{broken_task_audit_pass:false},'BROKEN_TASKS_DETECTED'],
    ['alignment',{prompt_test_alignment_pass:false},'PROMPT_TEST_MISALIGNMENT'],
    ['coverage',{semantic_coverage_pass:false},'SEMANTIC_COVERAGE_FAILURE'],
    ['noop',{noop_ablation_pass:false},'NOOP_ABLATION_FAILURE'],
    ['anchor',{anchor_recalibration_pass:false},'ANCHOR_RECALIBRATION_FAILURE'],
    ['holdout',{hidden_holdout_pass:false},'HIDDEN_HOLDOUT_FAILURE'],
    ['comparable',{incumbent_score_comparable:false},'LONGITUDINAL_COMPARABILITY_FAILURE'],
  ];
  for(const [label,overrides,blocker] of cases){
    const p=proposal({proposal_id:`benchmark.proposal.${label}`,proposed_generation_digest:dg(`generation-${label}`)});
    const r=receipt(p,{receipt_id:`benchmark.receipt.${label}`,...overrides});
    assert.ok(r.blockers.includes(blocker),blocker);
    const a=admission(p,r,{admission_id:`benchmark.admission.${label}`});
    assert.equal(a.state,'BENCHMARK_COEVOLUTION_REJECTED');
    assert.equal(a.qualified_for_benchmark_shadow,false);
  }
});

test('validity audit roots must remain independent from proposal roots and each other',()=>{
  const p=proposal();
  assert.throws(()=>receipt(p,{
    sealed_task_audit_digest:p.anchor_set_digest,
  }),/validity_roots_must_be_independent/);
  assert.throws(()=>receipt(p,{
    hidden_holdout_digest:dg('same'),
    contamination_probe_digest:dg('same'),
  }),/validity_roots_must_be_independent/);
});

test('append-only ledger preserves benchmark generation history and never activates a generation',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-benchmark-coevolution-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'ledger.json');
  const ledger=new RsiBenchmarkCoevolutionLedger({statePath,source_sha:SOURCE});
  await ledger.init();

  const p1=proposal();
  const r1=receipt(p1);
  const a1=admission(p1,r1);
  assert.equal((await ledger.add({proposal:p1,receipt:r1,admission:a1})).state,'QUALIFIED_FOR_BENCHMARK_SHADOW');

  const p2=proposal({
    proposal_id:'benchmark.proposal.three',
    generation_index:3,
    parent_generation_digest:p1.proposed_generation_digest,
    proposed_generation_digest:dg('generation-3'),
    previous_mastery_receipt_digest:dg('mastery-receipt-2'),
    task_distribution_digest:dg('task-distribution-3'),
    difficulty_delta_digest:dg('difficulty-delta-3'),
  });
  const r2=receipt(p2,{
    receipt_id:'benchmark.receipt.three',
    sealed_task_audit_digest:dg('sealed-task-audit-3'),
    contamination_probe_digest:dg('contamination-probe-3'),
    prompt_test_alignment_digest:dg('prompt-test-alignment-3'),
    semantic_coverage_audit_digest:dg('semantic-coverage-3'),
    noop_ablation_digest:dg('noop-ablation-3'),
    anchor_recalibration_digest:dg('anchor-recalibration-3'),
    hidden_holdout_digest:dg('hidden-holdout-3'),
  });
  const a2=admission(p2,r2,{admission_id:'benchmark.admission.three'});
  assert.equal((await ledger.add({proposal:p2,receipt:r2,admission:a2})).state,'QUALIFIED_FOR_BENCHMARK_SHADOW');

  const snap=ledger.snapshot();
  assert.equal(snap.row_count,2);
  assert.equal(snap.qualified_count,2);
  assert.equal(snap.active_generation_digest,null);
  assert.equal(snap.ledger_can_activate_generation,false);
  assert.equal(snap.ledger_can_change_training_distribution,false);

  const restored=new RsiBenchmarkCoevolutionLedger({statePath,source_sha:SOURCE});
  await restored.init();
  assert.equal(restored.snapshot().row_count,2);
  assert.equal((await restored.add({proposal:p1,receipt:r1,admission:a1})).state,'IDEMPOTENT');
});

test('failed benchmark persistence never becomes visible in memory',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-benchmark-crash-consistency-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'ledger.json');
  const ledger=new RsiBenchmarkCoevolutionLedger({statePath,source_sha:SOURCE});
  await ledger.init();
  const p=proposal();
  const r=receipt(p);
  const a=admission(p,r);

  await fs.mkdir(`${statePath}.tmp`);
  await assert.rejects(()=>ledger.add({proposal:p,receipt:r,admission:a}));
  assert.equal(ledger.snapshot().row_count,0);
  assert.equal(ledger.snapshot().qualified_count,0);

  await fs.rm(`${statePath}.tmp`,{recursive:true,force:true});
  const restored=new RsiBenchmarkCoevolutionLedger({statePath,source_sha:SOURCE});
  await restored.init();
  assert.equal(restored.snapshot().row_count,0);
});

test('restart rejects a self-rehashed benchmark policy downgrade',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-benchmark-replay-hardening-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'ledger.json');
  const ledger=new RsiBenchmarkCoevolutionLedger({statePath,source_sha:SOURCE});
  await ledger.init();
  const p=proposal();
  const r=receipt(p);
  const a=admission(p,r);
  await ledger.add({proposal:p,receipt:r,admission:a});

  const persisted=JSON.parse(await fs.readFile(statePath,'utf8'));
  const weakened={...persisted.rows[0].admission,active_benchmark_unchanged:false};
  delete weakened.admission_digest;
  persisted.rows[0].admission={...weakened,admission_digest:objDigest(weakened)};
  const stateCore=structuredClone(persisted);
  delete stateCore.state_digest;
  persisted.state_digest=objDigest(stateCore);
  await fs.writeFile(statePath,`${JSON.stringify(persisted)}\n`,'utf8');

  const restored=new RsiBenchmarkCoevolutionLedger({statePath,source_sha:SOURCE});
  await assert.rejects(()=>restored.init(),/admission_policy_invalid/);
});

test('candidate cannot self-validate or activate benchmark generation',()=>{
  const p=proposal();
  assert.throws(()=>receipt(p,{external_benchmark_auditor:false,authored_by_candidate:true}),/external_auditor_required/);
  const r=receipt(p);
  assert.throws(()=>admission(p,r,{external_admission_owner:false,authored_by_candidate:true}),/external_admission_owner_required/);
});

test('benchmark coevolution trust root keeps benchmark evolution zero-authority',()=>{
  const root=rsiBenchmarkCoevolutionTrustRootSnapshot();
  assert.equal(root.mastery_throttled_curriculum_required,true);
  assert.equal(root.external_curriculum_owner_required,true);
  assert.equal(root.incumbent_verifier_fixed_during_generation_review,true);
  assert.equal(root.trusted_runtime_fixed_during_generation_review,true);
  assert.equal(root.anchor_recalibration_required,true);
  assert.equal(root.hidden_holdout_required,true);
  assert.equal(root.contamination_probe_required,true);
  assert.equal(root.broken_task_audit_required,true);
  assert.equal(root.prompt_test_alignment_required,true);
  assert.equal(root.semantic_coverage_audit_required,true);
  assert.equal(root.noop_ablation_required,true);
  assert.equal(root.longitudinal_comparability_required,true);
  assert.equal(root.candidate_can_choose_tasks,false);
  assert.equal(root.candidate_can_self_activate_generation,false);
  assert.equal(root.active_benchmark_unchanged,true);
  assert.equal(root.benchmark_shadow_observation_only,true);
  assert.equal(root.ledger_can_change_training_distribution,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.benchmark_coevolution_root_digest,/^sha256:[0-9a-f]{64}$/);
});
