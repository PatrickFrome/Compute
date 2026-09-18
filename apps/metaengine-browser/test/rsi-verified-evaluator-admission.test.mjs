import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiBenchmarkProvenancePolicy,
  createRsiBenchmarkTaskProvenance,
  assessRsiBenchmarkContamination,
  createRsiBenchmarkEvidenceAdmission,
} from '../src/rsi-benchmark-provenance-guard.mjs';
import {
  createRsiEvaluationIntegrityPolicy,
  createRsiEvaluationIntegrityReceipt,
  assessRsiEvaluationIntegrity,
} from '../src/rsi-evaluation-integrity-guard.mjs';
import {
  createRsiEvaluatorMeshPlan,
  createRsiEvaluatorReceipt,
} from '../src/rsi-evaluator-mesh.mjs';
import {
  applyRsiVerifiedEvaluatorMesh,
  createRsiVerifiedEvaluatorAdmission,
} from '../src/rsi-verified-evaluator-admission.mjs';
import { RsiShadowArchive, RSI_SHADOW_STATES } from '../src/rsi-shadow-core.mjs';
import { RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA } from '../src/rsi-isolated-candidate-builder.mjs';

const d=(c)=>`sha256:${c.repeat(64)}`;
const PARENT='a'.repeat(40);
const CANDIDATE='b'.repeat(40);
const CANDIDATE_ID=`candidate_sha256_${'c'.repeat(64)}`;
const HANDOFF_DIGEST=d('d');

function handoff(){
  return {
    schema:RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA,version:1,
    experiment_id:'rsi_exp_0123456789abcdef01234567',
    mutation_surface:'AGENT_ORCHESTRATION',
    parent_sha:PARENT,candidate_sha:CANDIDATE,
    target_branch:'work/rsi/integrity-aaaaaaaa-01234567',
    handoff_digest:HANDOFF_DIGEST,
    candidate_capsule:{candidate_id:CANDIDATE_ID,source:{head:CANDIDATE}},
    candidate_verification:{ok:true,executable:false,promotion_authorized:false},
    sandbox_plan:{mode:'PREPARE_ONLY'},
    sandbox_plan_verification:{execution_authorized:false},
    shadow_archive_proposal:{
      candidate_id:CANDIDATE_ID,parent_sha:PARENT,candidate_sha:CANDIDATE,
      mutation_surface:'AGENT_ORCHESTRATION',hypothesis:'Improve without touching trust roots.',
    },
    eligible_for_evaluation:true,eligible_for_promotion:false,
    materialization_replay_authorized:false,
    execution_authority:false,production_mutation_authority:false,
    promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
}

function benchmark({ contaminated=false }={}){
  const policy=createRsiBenchmarkProvenancePolicy({
    policy_id:'verified.eval.benchmark.v1',
    min_resistant_tasks:1,
    min_source_families:1,
    max_public_static_fraction:0,
    external_policy_owner:true,
    authored_by_candidate:false,
  });
  const task=createRsiBenchmarkTaskProvenance({
    policy,
    task_id:'task.private.1',
    benchmark_id:'rsi.private.holdout.v1',
    benchmark_version:'2026-09-18.1',
    task_prompt_digest:d('1'),
    hidden_test_digest:d('2'),
    source_kind:'FRESH_PRIVATE_COMMIT',
    source_family:'private.family',
    source_repository_digest:d('3'),
    candidate_repository_digest:d('4'),
    source_commit_sha:'5'.repeat(40),
    source_published_at:'2026-09-18T10:00:00.000Z',
    candidate_frozen_at:'2026-09-18T09:00:00.000Z',
    task_materialized_at:'2026-09-18T10:05:00.000Z',
    searchability:'NOT_SEARCHABLE',
    reference_solution_visible:false,
    hidden_tests_visible:false,
    evaluator_harness_visible:false,
    evaluator_harness_mutated_by_candidate:contaminated,
    task_authored_by_candidate:false,
    task_selected_by_candidate:false,
    source_repository_selected_by_candidate:false,
    ingested_into_trusted_memory:false,
    ingested_into_skill_library:false,
    external_provenance_verifier:true,
    authored_by_candidate:false,
    evidence_refs:['PROVENANCE_PRIVATE_1'],
  });
  const assessment=assessRsiBenchmarkContamination({policy,task});
  const admission=createRsiBenchmarkEvidenceAdmission({policy,assessments:[assessment],tasks:[task]});
  return {policy,tasks:[task],assessments:[assessment],admission};
}

function integrity({ tampered=false }={}){
  const policy=createRsiEvaluationIntegrityPolicy({
    policy_id:'verified.eval.integrity.v1',
    visible_suite_digest:d('6'),
    compositional_holdout_digest:d('7'),
    evaluator_root_digest:d('8'),
    workspace_baseline_digest:d('9'),
    max_visible_holdout_gap:0.15,
    min_holdout_pass_rate:0.8,
    external_policy_owner:true,
    authored_by_candidate:false,
  });
  const receipt=createRsiEvaluationIntegrityReceipt({
    policy,
    receipt_id:'verified.eval.receipt.1',
    candidate_id:CANDIDATE_ID,
    candidate_sha:CANDIDATE,
    visible_pass_rate:0.9,
    holdout_pass_rate:0.88,
    evaluator_root_digest:policy.evaluator_root_digest,
    workspace_before_digest:policy.workspace_baseline_digest,
    workspace_after_digest:d('a'),
    patch_audit_digest:d('b'),
    file_access_audit_digest:d('c'),
    network_audit_digest:d('d'),
    evaluator_files_modified:tampered,
    hidden_tests_read:false,
    reference_solution_retrieved:false,
    expected_outputs_retrieved:false,
    contamination_canary_retrieved:false,
    evaluation_metric_tampered:false,
    validation_bypass_detected:false,
    external_integrity_monitor:true,
    authored_by_candidate:false,
    evidence_refs:['PATCH_AUDIT','FILE_AUDIT','NETWORK_AUDIT'],
  });
  const assessment=assessRsiEvaluationIntegrity({policy,receipt});
  return {policy,receipt,assessment};
}

function evaluator(candidateHandoff=handoff()){
  const plan=createRsiEvaluatorMeshPlan({candidate_handoff:candidateHandoff});
  const receipts=plan.evaluator_root.invariants.map((entry,index)=>createRsiEvaluatorReceipt({
    plan,evaluator_id:entry.evaluator_id,result:'PASS',evidence_refs:[`run:${index}`],
  }));
  receipts.push(createRsiEvaluatorReceipt({
    plan,evaluator_id:'rsi.objective.latency.v1',
    objective:{baseline:100,candidate:80},evidence_refs:['run:objective'],
  }));
  return {plan,receipts};
}

function archiveFor(candidateHandoff){
  const archive=new RsiShadowArchive({clock:()=>Date.parse('2026-09-18T12:00:00Z')});
  archive.propose(candidateHandoff.shadow_archive_proposal);
  return archive;
}

test('clean provenance plus independent harness integrity is required before evaluator archive mutation',()=>{
  const candidateHandoff=handoff();
  const {plan,receipts}=evaluator(candidateHandoff);
  const b=benchmark();
  const i=integrity();
  const admission=createRsiVerifiedEvaluatorAdmission({
    evaluator_plan:plan,
    benchmark_policy:b.policy,benchmark_tasks:b.tasks,benchmark_assessments:b.assessments,benchmark_admission:b.admission,
    integrity_policy:i.policy,integrity_receipt:i.receipt,integrity_assessment:i.assessment,
  });
  assert.equal(admission.state,'READY');
  assert.equal(admission.archive_apply_authorized,true);
  assert.equal(admission.promotion_authority,false);

  const archive=archiveFor(candidateHandoff);
  const result=applyRsiVerifiedEvaluatorMesh({
    archive,candidate_handoff:candidateHandoff,evaluator_plan:plan,evaluator_receipts:receipts,
    benchmark_policy:b.policy,benchmark_tasks:b.tasks,benchmark_assessments:b.assessments,benchmark_admission:b.admission,
    integrity_policy:i.policy,integrity_receipt:i.receipt,integrity_assessment:i.assessment,
    verified_admission:admission,
  });
  assert.equal(result.evaluator_state,RSI_SHADOW_STATES.SHADOW_QUALIFIED);
  assert.equal(result.benchmark_provenance_verified,true);
  assert.equal(result.harness_integrity_verified,true);
  assert.equal(result.direct_promotion_enabled,false);
  assert.equal(result.authority_effect,false);
});

test('candidate-mutated evaluator harness blocks archive admission even with passing evaluator receipts',()=>{
  const {plan}=evaluator();
  const b=benchmark({contaminated:true});
  const i=integrity();
  const admission=createRsiVerifiedEvaluatorAdmission({
    evaluator_plan:plan,
    benchmark_policy:b.policy,benchmark_tasks:b.tasks,benchmark_assessments:b.assessments,benchmark_admission:b.admission,
    integrity_policy:i.policy,integrity_receipt:i.receipt,integrity_assessment:i.assessment,
  });
  assert.equal(admission.state,'BLOCKED');
  assert.equal(admission.archive_apply_authorized,false);
  assert.ok(admission.blockers.includes('BENCHMARK_PROVENANCE_NOT_ADMITTED'));
  assert.ok(admission.blockers.includes('CONTAMINATED_BENCHMARK_TASK'));
});

test('external integrity monitor detecting evaluator tamper blocks archive admission',()=>{
  const {plan}=evaluator();
  const b=benchmark();
  const i=integrity({tampered:true});
  const admission=createRsiVerifiedEvaluatorAdmission({
    evaluator_plan:plan,
    benchmark_policy:b.policy,benchmark_tasks:b.tasks,benchmark_assessments:b.assessments,benchmark_admission:b.admission,
    integrity_policy:i.policy,integrity_receipt:i.receipt,integrity_assessment:i.assessment,
  });
  assert.equal(i.assessment.state,'REWARD_HACKING_DETECTED');
  assert.equal(admission.state,'BLOCKED');
  assert.equal(admission.archive_apply_authorized,false);
  assert.ok(admission.blockers.includes('EVALUATION_INTEGRITY_REWARD_HACKING_DETECTED'));
});
