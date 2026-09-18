import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiEvaluatorMeshPlan,
  createRsiEvaluatorReceipt,
  applyRsiEvaluatorMesh,
  rsiEvaluatorRootSnapshot,
} from '../src/rsi-evaluator-mesh.mjs';
import { RsiShadowArchive, RSI_HARD_INVARIANTS } from '../src/rsi-shadow-core.mjs';
import { RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA } from '../src/rsi-isolated-candidate-builder.mjs';
import {
  createRsiBenchmarkProvenancePolicy,
  createRsiBenchmarkTaskProvenance,
  assessRsiBenchmarkContamination,
  createRsiBenchmarkEvidenceAdmission,
} from '../src/rsi-benchmark-provenance-guard.mjs';
import {
  createRsiMasteryAnchor,
  createRsiMasteryLedger,
  createRsiRetentionReplayPlan,
  createRsiRetentionReplayReceipt,
} from '../src/rsi-regression-replay.mjs';
import {
  createRsiEvaluationIntegrityPolicy,
  createRsiEvaluationIntegrityReceipt,
} from '../src/rsi-evaluation-integrity-guard.mjs';
import {
  createRsiShadowTournamentPlan,
  createRsiTournamentPairReceipt,
} from '../src/rsi-shadow-tournament.mjs';
import {
  createRsiExternalHoldoutResult,
  createRsiExternalEvaluationBundle,
  verifyRsiExternalEvaluationBundle,
  rsiExternalEvaluationTrustRootSnapshot,
} from '../src/rsi-external-evaluation-evidence-adapter.mjs';

const PARENT='a'.repeat(40);
const CANDIDATE='b'.repeat(40);
const CANDIDATE_ID=`candidate_sha256_${'c'.repeat(64)}`;
const HANDOFF_DIGEST=`sha256:${'d'.repeat(64)}`;
const SUITE=`sha256:${'e'.repeat(64)}`;
const HOLDOUT=`sha256:${'f'.repeat(64)}`;
const d=(c)=>`sha256:${c.repeat(64)}`;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
}
function digest(value){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`}
function bytes(value){return Buffer.byteLength(JSON.stringify(stable(value)),'utf8')}

function handoff(){
  return {
    schema:RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA,
    version:1,
    experiment_id:'rsi_exp_0123456789abcdef01234567',
    mutation_surface:'BROWSER_RUNTIME',
    parent_sha:PARENT,
    candidate_sha:CANDIDATE,
    target_branch:'work/rsi/external-eval-aaaaaaaa-01234567',
    handoff_digest:HANDOFF_DIGEST,
    candidate_capsule:{
      candidate_id:CANDIDATE_ID,
      source:{head:CANDIDATE},
      components:[{path:'apps/metaengine-browser/src/browser-brain-working-memory.mjs',change:'MODIFY',digest:d('1')}],
    },
    candidate_verification:{ok:true,executable:false,promotion_authorized:false},
    sandbox_plan:{mode:'PREPARE_ONLY'},
    sandbox_plan_verification:{execution_authorized:false},
    shadow_archive_proposal:{
      candidate_id:CANDIDATE_ID,
      parent_sha:PARENT,
      candidate_sha:CANDIDATE,
      mutation_surface:'BROWSER_RUNTIME',
      hypothesis:'Improve runtime without changing authority.',
    },
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
}

function verifiedMaterialization(){
  const core={
    schema:'metaengine.rsi.verified-candidate-materialization.v1',
    version:1,
    episode_id:'episode:rsi:111111111111111111111111',
    materialization_admission_digest:d('2'),
    source_sha:PARENT,
    candidate_id:CANDIDATE_ID,
    candidate_sha:CANDIDATE,
    target_branch:'work/rsi/external-eval-aaaaaaaa-01234567',
    context_aware_build_digest:d('3'),
    generic_build_plan_digest:d('4'),
    source_snapshot_digest:d('5'),
    isolated_candidate_handoff_digest:HANDOFF_DIGEST,
    workspace_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    task_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    lease_generation:3,
    agent_generation_epoch:4,
    episode_candidate_registration:{},
    evaluator_handoff:{},
    exact_workspace_incarnation_verified:true,
    exact_candidate_source_verified:true,
    candidate_registered_in_episode:false,
    evaluation_started:false,
    eligible_for_external_evaluation:true,
    eligible_for_promotion:false,
    materialization_replay_authorized:false,
    db_lease_was_execution_authority:true,
    verified_materialization_is_execution_authority:false,
    execution_authority:false,
    browser_authority:false,
    scheduler_authority:false,
    task_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return {
    ...core,
    payload_bytes:bytes(core),
    max_payload_bytes:48*1024,
    verified_materialization_digest:digest(core),
  };
}

function evaluatorFixture(){
  const candidateHandoff=handoff();
  const plan=createRsiEvaluatorMeshPlan({candidate_handoff:candidateHandoff});
  const invariantReceipts=plan.evaluator_root.invariants.map((entry,index)=>createRsiEvaluatorReceipt({
    plan,
    evaluator_id:entry.evaluator_id,
    result:'PASS',
    evidence_refs:[`github:run:${1000+index}`],
  }));
  const objective=createRsiEvaluatorReceipt({
    plan,
    evaluator_id:'rsi.objective.latency.v1',
    objective:{baseline:120,candidate:80},
    evidence_refs:['github:run:2000'],
  });
  const receipts=[...invariantReceipts,objective];
  const archive=new RsiShadowArchive({clock:()=>Date.parse('2026-09-18T19:00:00.000Z')});
  archive.propose(candidateHandoff.shadow_archive_proposal);
  const result=applyRsiEvaluatorMesh({archive,candidate_handoff:candidateHandoff,plan,receipts});
  return {candidateHandoff,plan,receipts,result};
}

function benchmarkFixture(){
  const policy=createRsiBenchmarkProvenancePolicy({
    policy_id:'benchmark.external.eval.1',
    min_resistant_tasks:1,
    min_source_families:1,
    max_public_static_fraction:0,
    external_policy_owner:true,
    authored_by_candidate:false,
  });
  const task=createRsiBenchmarkTaskProvenance({
    policy,
    task_id:'task.external.holdout.1',
    benchmark_id:'rsi.hidden.browser.v2',
    benchmark_version:'2026-09-18.2',
    task_prompt_digest:d('6'),
    hidden_test_digest:d('7'),
    source_kind:'FRESH_PRIVATE_COMMIT',
    source_family:'private.family.a',
    source_repository_digest:d('8'),
    candidate_repository_digest:d('9'),
    source_commit_sha:'e'.repeat(40),
    source_published_at:'2026-09-18T18:00:00.000Z',
    candidate_frozen_at:'2026-09-18T17:00:00.000Z',
    task_materialized_at:'2026-09-18T18:05:00.000Z',
    searchability:'NOT_SEARCHABLE',
    reference_solution_visible:false,
    hidden_tests_visible:false,
    evaluator_harness_visible:false,
    evaluator_harness_mutated_by_candidate:false,
    task_authored_by_candidate:false,
    task_selected_by_candidate:false,
    source_repository_selected_by_candidate:false,
    ingested_into_trusted_memory:false,
    ingested_into_skill_library:false,
    external_provenance_verifier:true,
    authored_by_candidate:false,
    evidence_refs:['PROVENANCE_EXTERNAL_1'],
  });
  const assessment=assessRsiBenchmarkContamination({policy,task});
  const admission=createRsiBenchmarkEvidenceAdmission({policy,assessments:[assessment],tasks:[task]});
  const result=createRsiExternalHoldoutResult({
    candidate_id:CANDIDATE_ID,
    candidate_sha:CANDIDATE,
    benchmark_admission_digest:admission.admission_digest,
    hidden_manifest_digest:d('a'),
    holdout_suite_digest:HOLDOUT,
    pass_rate:0.92,
    minimum_pass_rate:0.8,
    evaluation_complete:true,
    external_holdout_evaluator:true,
    authored_by_candidate:false,
    evidence_refs:['HOLDOUT_RUN_1'],
  });
  return {policy,tasks:[task],assessments:[assessment],admission,result};
}

function regressionFixture(){
  const root=rsiEvaluatorRootSnapshot();
  const anchor=createRsiMasteryAnchor({
    anchor_id:'mastery.external.eval.1',
    capability_family:'BROWSER_RUNTIME',
    challenge_digest:d('b'),
    benchmark_admission_digest:d('c'),
    baseline_candidate_id:`candidate_sha256_${'1'.repeat(64)}`,
    baseline_candidate_sha:'1'.repeat(40),
    mastered_generation:1,
    mastered_at:'2026-09-17T00:00:00.000Z',
    baseline_success_rate:0.9,
    minimum_retained_success_rate:0.8,
    historical_regression_count:1,
    safety_critical:true,
    external_mastery_verifier:true,
    authored_by_candidate:false,
    contamination_resistant_evidence:true,
    hidden_holdout:true,
    evidence_refs:['MASTER_EXTERNAL_1'],
  });
  const ledger=createRsiMasteryLedger({ledger_id:'mastery.ledger.external.1',anchors:[anchor]});
  const plan=createRsiRetentionReplayPlan({
    ledger,
    current_candidate_id:CANDIDATE_ID,
    current_candidate_sha:CANDIDATE,
    current_generation:2,
    max_replay_tasks:1,
  });
  const receipts=plan.tasks.map(task=>createRsiRetentionReplayReceipt({
    plan,
    ledger,
    anchor_id:task.anchor_id,
    replay_attempts:8,
    replay_successes:8,
    hard_invariants_pass:true,
    evaluator_root_digest:root.evaluator_root_digest,
    environment_fingerprint:'windows-x64-rsi-external-v1',
    external_replay_evaluator:true,
    authored_by_candidate:false,
    evidence_refs:['REPLAY_EXTERNAL_1'],
  }));
  return {ledger,plan,receipts};
}

function integrityFixture(overrides={}){
  const root=rsiEvaluatorRootSnapshot();
  const policy=createRsiEvaluationIntegrityPolicy({
    policy_id:'integrity.external.eval.1',
    visible_suite_digest:SUITE,
    compositional_holdout_digest:HOLDOUT,
    evaluator_root_digest:root.evaluator_root_digest,
    workspace_baseline_digest:d('d'),
    max_visible_holdout_gap:0.15,
    min_holdout_pass_rate:0.8,
    external_policy_owner:true,
    authored_by_candidate:false,
  });
  const receipt=createRsiEvaluationIntegrityReceipt({
    policy,
    receipt_id:'integrity.external.receipt.1',
    candidate_id:CANDIDATE_ID,
    candidate_sha:CANDIDATE,
    visible_pass_rate:0.93,
    holdout_pass_rate:0.90,
    evaluator_root_digest:root.evaluator_root_digest,
    workspace_before_digest:policy.workspace_baseline_digest,
    workspace_after_digest:d('e'),
    patch_audit_digest:d('1'),
    file_access_audit_digest:d('2'),
    network_audit_digest:d('3'),
    evaluator_files_modified:false,
    hidden_tests_read:false,
    reference_solution_retrieved:false,
    expected_outputs_retrieved:false,
    contamination_canary_retrieved:false,
    evaluation_metric_tampered:false,
    validation_bypass_detected:false,
    external_integrity_monitor:true,
    authored_by_candidate:false,
    evidence_refs:['PATCH_AUDIT_EXT','FILE_AUDIT_EXT','NETWORK_AUDIT_EXT'],
    ...overrides,
  });
  return {policy,receipt};
}

function hardPass(){
  return Object.fromEntries(RSI_HARD_INVARIANTS.map(name=>[name,'PASS']));
}
function tournamentFixture(evaluatorResult){
  const workload={
    task_class:'browser-external-holdout',
    environment_fingerprint:'windows-x64-rsi-external-v1',
    suite_digest:SUITE,
    holdout_digest:HOLDOUT,
  };
  const plan=createRsiShadowTournamentPlan({
    candidate_handoff:handoff(),
    evaluator_result:evaluatorResult,
    workload,
    pair_count:5,
  });
  const receipts=Array.from({length:5},(_,index)=>createRsiTournamentPairReceipt({
    plan,
    pair_index:index+1,
    order:plan.pair_policy.precommitted_order_schedule[index],
    seed:plan.pair_policy.precommitted_seed_schedule[index],
    incumbent_metrics:{
      task_success_rate:0.9,
      p95_latency_ms:100+index,
      peak_rss_bytes:1000,
      recovery_p95_ms:60,
    },
    candidate_metrics:{
      task_success_rate:0.9,
      p95_latency_ms:75+index,
      peak_rss_bytes:1000,
      recovery_p95_ms:60,
    },
    hard_invariants:hardPass(),
    evidence_refs:[`TOURNAMENT_PAIR_${index+1}`],
  }));
  return {workload,pair_count:5,receipts};
}

function passingInput(){
  const evaluator=evaluatorFixture();
  return {
    verified_materialization:verifiedMaterialization(),
    candidate_handoff:evaluator.candidateHandoff,
    evaluator_receipts:evaluator.receipts,
    holdout:benchmarkFixture(),
    regression:regressionFixture(),
    integrity:integrityFixture(),
    tournament:tournamentFixture(evaluator.result),
  };
}

test('external evaluator adapter verifies all six classes and yields nomination-grade evidence without promotion authority',()=>{
  const bundle=createRsiExternalEvaluationBundle(passingInput());
  verifyRsiExternalEvaluationBundle(bundle);
  assert.deepEqual(bundle.evidence_classes.map(row=>row.evidence_kind),[
    'HARD_INVARIANTS','OBJECTIVES','HOLDOUT','REGRESSION_REPLAY','EVALUATION_INTEGRITY','TOURNAMENT',
  ]);
  assert.equal(bundle.evidence_classes.every(row=>row.result==='PASS'),true);
  assert.equal(bundle.all_classes_pass,true);
  assert.equal(bundle.any_class_ambiguous,false);
  assert.equal(bundle.candidate_can_self_certify,false);
  assert.equal(bundle.direct_promotion_enabled,false);
  assert.equal(bundle.promotion_authority,false);
  assert.ok(bundle.payload_bytes<bundle.max_payload_bytes);
});

test('reward-hacking integrity evidence becomes a blocking FAIL even when performance is strong',()=>{
  const input=passingInput();
  input.integrity=integrityFixture({hidden_tests_read:true,visible_pass_rate:1,holdout_pass_rate:1});
  const bundle=createRsiExternalEvaluationBundle(input);
  const integrity=bundle.evidence_classes.find(row=>row.evidence_kind==='EVALUATION_INTEGRITY');
  assert.equal(integrity.result,'FAIL');
  assert.equal(bundle.all_classes_pass,false);
  assert.equal(bundle.direct_promotion_enabled,false);
});

test('candidate-authored evaluator receipt is rejected before evidence bundle creation',()=>{
  const input=passingInput();
  const forged=structuredClone(input.evaluator_receipts[0]);
  forged.authored_by_candidate=true;
  input.evaluator_receipts[0]=forged;
  assert.throws(()=>createRsiExternalEvaluationBundle(input),/receipt_origin_invalid|receipt_digest_mismatch/);
});

test('holdout and tournament must be bound to the same hidden workload',()=>{
  const input=passingInput();
  const holdout=input.holdout;
  input.holdout={
    ...holdout,
    result:createRsiExternalHoldoutResult({
      candidate_id:CANDIDATE_ID,
      candidate_sha:CANDIDATE,
      benchmark_admission_digest:holdout.admission.admission_digest,
      hidden_manifest_digest:d('a'),
      holdout_suite_digest:d('4'),
      pass_rate:0.92,
      minimum_pass_rate:0.8,
      evaluation_complete:true,
      external_holdout_evaluator:true,
      authored_by_candidate:false,
      evidence_refs:['HOLDOUT_RUN_DRIFT'],
    }),
  };
  assert.throws(()=>createRsiExternalEvaluationBundle(input),/holdout_tournament_binding_mismatch/);
});

test('external evaluation trust root requires all six independent gates and remains zero-authority',()=>{
  const root=rsiExternalEvaluationTrustRootSnapshot();
  assert.deepEqual(root.required_evidence_kinds,[
    'HARD_INVARIANTS','OBJECTIVES','HOLDOUT','REGRESSION_REPLAY','EVALUATION_INTEGRITY','TOURNAMENT',
  ]);
  assert.equal(root.contamination_resistant_holdout_required,true);
  assert.equal(root.regression_replay_required,true);
  assert.equal(root.evaluation_integrity_required,true);
  assert.equal(root.precommitted_tournament_required,true);
  assert.equal(root.tournament_pareto_advance_required_for_pass,true);
  assert.equal(root.candidate_can_self_certify,false);
  assert.equal(root.durable_before_episode_apply_required,true);
  assert.equal(root.direct_promotion_enabled,false);
  assert.equal(root.execution_authority,false);
  assert.equal(root.promotion_authority,false);
});
