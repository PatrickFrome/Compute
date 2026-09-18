import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createRsiSkillCapsule,
  createRsiSkillEvidence,
  createRsiVerifiedSkillLibrary,
} from '../src/rsi-verified-skill-library.mjs';
import { createRsiSkillLibraryGovernance } from '../src/rsi-skill-library-governance.mjs';
import {
  createRsiSkillCurationRequest,
  createRsiSkillRevisionEvaluation,
} from '../src/rsi-runtime-skill-curation.mjs';
import { createRsiSkillRevisionFrontierCandidate } from '../src/rsi-skill-revision-frontier.mjs';
import {
  createRsiEvaluationIntegrityPolicy,
  createRsiEvaluationIntegrityReceipt,
  assessRsiEvaluationIntegrity,
} from '../src/rsi-evaluation-integrity-guard.mjs';
import {
  RsiSkillRevisionIntegrityLedger,
  createRsiSkillRevisionIntegrityAdmission,
  verifyRsiSkillRevisionIntegrityAdmission,
  rsiSkillRevisionIntegrityAdmissionTrustRootSnapshot,
} from '../src/rsi-skill-revision-integrity-admission.mjs';

const SOURCE='a'.repeat(40);
const d=(char)=>`sha256:${char.repeat(64)}`;

function fixture(){
  const parent=createRsiSkillCapsule({
    skill_id:'skill.integrity.parent',version:1,parent_skill_digest:null,source_candidate_sha:'b'.repeat(40),
    role:'ANALYZER',input_schema_digest:d('1'),output_schema_digest:d('2'),implementation_digest:d('3'),
    components:[{component_id:'skill.integrity.parent.component',artifact_digest:d('4'),kind:'TYPED_TRANSFORM'}],
    capabilities:['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES'],max_context_tokens:2048,max_output_tokens:512,max_invocations:2,
    external_builder:true,authored_by_candidate:false,
  });
  const evidence=createRsiSkillEvidence({
    capsule:parent,hidden_holdout_digest:d('5'),evaluator_root_digest:d('6'),unit_test_digest:d('7'),
    runtime_feedback_digest:d('8'),attempt_count:12,success_count:10,hard_invariants_pass:true,verified_for_library:true,
    evidence_refs:['VERIFY_skill.integrity.parent'],external_evaluator:true,authored_by_candidate:false,
  });
  const library=createRsiVerifiedSkillLibrary({
    library_id:'runtime.skill.integrity.library',entries:[{capsule:parent,evidence}],
    external_library_owner:true,authored_by_candidate:false,
  });
  const governance=createRsiSkillLibraryGovernance({
    governance_id:'runtime.skill.integrity.governance',library,lifecycle_evidence:[],
    max_active_skills:1,exploration_slots:1,external_library_owner:true,authored_by_candidate:false,
  });
  const request=createRsiSkillCurationRequest({
    source_sha:SOURCE,request_id:'curation.integrity.1',library,governance,parent_skill_digest:parent.skill_digest,
    reason:'RELIABILITY_GAP',trigger_evidence_digests:[d('9'),d('a')],
    training_context_digest:d('b'),validation_holdout_digest:d('c'),meta_holdout_digest:d('d'),
    optimizer_model_family:'GPT_5_6_SOL',edit_budget:3,external_curator:true,authored_by_candidate:false,
  });
  const successor=createRsiSkillCapsule({
    skill_id:parent.skill_id,version:2,parent_skill_digest:parent.skill_digest,source_candidate_sha:'c'.repeat(40),
    role:parent.role,input_schema_digest:parent.input_schema_digest,output_schema_digest:parent.output_schema_digest,
    implementation_digest:d('e'),
    components:[{component_id:'skill.integrity.parent.component.v2',artifact_digest:d('f'),kind:'TYPED_TRANSFORM'}],
    capabilities:parent.capabilities,max_context_tokens:parent.max_context_tokens,max_output_tokens:parent.max_output_tokens,
    max_invocations:parent.max_invocations,external_builder:true,authored_by_candidate:false,
  });
  const evaluation=createRsiSkillRevisionEvaluation({
    evaluation_id:'evaluation.integrity.1',request,library,governance,successor_skill:successor,
    baseline_validation_score:0.60,candidate_validation_score:0.72,
    baseline_meta_score:0.55,candidate_meta_score:0.57,hard_invariants_pass:true,
    evaluator_digest:d('1'),evaluation_digest:d('2'),evidence_refs:['eval:integrity:1'],
    external_evaluator:true,authored_by_candidate:false,
  });
  const frontier=createRsiSkillRevisionFrontierCandidate({
    source_sha:SOURCE,request,evaluation,library,governance,external_frontier_owner:true,authored_by_candidate:false,
  });
  return {parent,successor,library,governance,request,evaluation,frontier};
}

function integrity(fx,{holdout=d('0'),hiddenTestsRead=false,visible=0.92,holdoutRate=0.90}={}){
  const policy=createRsiEvaluationIntegrityPolicy({
    policy_id:'integrity.skill.revision.1',
    visible_suite_digest:d('3'),
    compositional_holdout_digest:holdout,
    evaluator_root_digest:d('4'),
    workspace_baseline_digest:d('5'),
    max_visible_holdout_gap:0.15,
    min_holdout_pass_rate:0.8,
    external_policy_owner:true,
    authored_by_candidate:false,
  });
  const receipt=createRsiEvaluationIntegrityReceipt({
    policy,
    receipt_id:'integrity.receipt.skill.revision.1',
    candidate_id:`candidate_sha256_${fx.successor.skill_digest.slice('sha256:'.length)}`,
    candidate_sha:fx.successor.source_candidate_sha,
    visible_pass_rate:visible,
    holdout_pass_rate:holdoutRate,
    evaluator_root_digest:d('4'),
    workspace_before_digest:d('5'),
    workspace_after_digest:d('6'),
    patch_audit_digest:d('7'),
    file_access_audit_digest:d('8'),
    network_audit_digest:d('9'),
    evaluator_files_modified:false,
    hidden_tests_read:hiddenTestsRead,
    reference_solution_retrieved:false,
    expected_outputs_retrieved:false,
    contamination_canary_retrieved:false,
    evaluation_metric_tampered:false,
    validation_bypass_detected:false,
    external_integrity_monitor:true,
    authored_by_candidate:false,
    evidence_refs:['integrity:skill:revision:1'],
  });
  const assessment=assessRsiEvaluationIntegrity({policy,receipt});
  return {policy,receipt,assessment};
}

test('sealed exogenous integrity admits a frontier revision only after independent hidden evaluation',()=>{
  const fx=fixture();
  const proof=integrity(fx);
  assert.equal(proof.assessment.state,'INTEGRITY_VERIFIED');
  const admission=createRsiSkillRevisionIntegrityAdmission({
    source_sha:SOURCE,admission_id:'admission.skill.revision.1',
    frontier_candidate:fx.frontier,request:fx.request,evaluation:fx.evaluation,library:fx.library,governance:fx.governance,
    integrity_policy:proof.policy,integrity_receipt:proof.receipt,integrity_assessment:proof.assessment,
    external_admission_owner:true,authored_by_candidate:false,
  });
  verifyRsiSkillRevisionIntegrityAdmission(admission,{
    frontier_candidate:fx.frontier,request:fx.request,evaluation:fx.evaluation,library:fx.library,governance:fx.governance,
    integrity_policy:proof.policy,integrity_receipt:proof.receipt,integrity_assessment:proof.assessment,
  });
  assert.equal(admission.state,'INTEGRITY_ADMITTED');
  assert.equal(admission.eligible_for_existing_reliability_gate,true);
  assert.equal(admission.self_authored_verification_sufficient,false);
  assert.equal(admission.candidate_can_read_sealed_holdout_content,false);
  assert.equal(admission.direct_library_replacement_allowed,false);
  assert.equal(admission.authority_effect,false);
});

test('reward hacking or specification gaming evidence rejects the exact frontier candidate',()=>{
  const fx=fixture();
  const hacked=integrity(fx,{hiddenTestsRead:true});
  assert.equal(hacked.assessment.state,'REWARD_HACKING_DETECTED');
  const hackedAdmission=createRsiSkillRevisionIntegrityAdmission({
    source_sha:SOURCE,admission_id:'admission.skill.revision.hacked',
    frontier_candidate:fx.frontier,request:fx.request,evaluation:fx.evaluation,library:fx.library,governance:fx.governance,
    integrity_policy:hacked.policy,integrity_receipt:hacked.receipt,integrity_assessment:hacked.assessment,
    external_admission_owner:true,authored_by_candidate:false,
  });
  assert.equal(hackedAdmission.state,'INTEGRITY_REJECTED');
  assert.equal(hackedAdmission.eligible_for_existing_reliability_gate,false);

  const gaming=integrity(fx,{visible:0.99,holdoutRate:0.70});
  assert.equal(gaming.assessment.state,'SPECIFICATION_GAMING_SUSPECT');
  const gamingAdmission=createRsiSkillRevisionIntegrityAdmission({
    source_sha:SOURCE,admission_id:'admission.skill.revision.gaming',
    frontier_candidate:fx.frontier,request:fx.request,evaluation:fx.evaluation,library:fx.library,governance:fx.governance,
    integrity_policy:gaming.policy,integrity_receipt:gaming.receipt,integrity_assessment:gaming.assessment,
    external_admission_owner:true,authored_by_candidate:false,
  });
  assert.equal(gamingAdmission.state,'INTEGRITY_REJECTED');
});

test('sealed integrity holdout cannot alias training validation or slow-meta holdouts',()=>{
  const fx=fixture();
  for(const [name,holdout] of [
    ['training',fx.request.training_context_digest],
    ['validation',fx.request.validation_holdout_digest],
    ['meta',fx.request.meta_holdout_digest],
  ]){
    const proof=integrity(fx,{holdout});
    assert.throws(()=>createRsiSkillRevisionIntegrityAdmission({
      source_sha:SOURCE,admission_id:`admission.alias.${name}`,
      frontier_candidate:fx.frontier,request:fx.request,evaluation:fx.evaluation,library:fx.library,governance:fx.governance,
      integrity_policy:proof.policy,integrity_receipt:proof.receipt,integrity_assessment:proof.assessment,
      external_admission_owner:true,authored_by_candidate:false,
    }),/sealed_holdout_alias/);
  }
});

test('integrity evidence must bind the exact successor candidate identity',()=>{
  const fx=fixture();
  const proof=integrity(fx);
  const wrongReceipt=createRsiEvaluationIntegrityReceipt({
    policy:proof.policy,receipt_id:'integrity.receipt.wrong',
    candidate_id:`candidate_sha256_${'f'.repeat(64)}`,candidate_sha:'f'.repeat(40),
    visible_pass_rate:0.92,holdout_pass_rate:0.90,evaluator_root_digest:d('4'),
    workspace_before_digest:d('5'),workspace_after_digest:d('6'),patch_audit_digest:d('7'),
    file_access_audit_digest:d('8'),network_audit_digest:d('9'),
    external_integrity_monitor:true,authored_by_candidate:false,evidence_refs:['integrity:wrong'],
  });
  const wrongAssessment=assessRsiEvaluationIntegrity({policy:proof.policy,receipt:wrongReceipt});
  assert.throws(()=>createRsiSkillRevisionIntegrityAdmission({
    source_sha:SOURCE,admission_id:'admission.wrong.candidate',
    frontier_candidate:fx.frontier,request:fx.request,evaluation:fx.evaluation,library:fx.library,governance:fx.governance,
    integrity_policy:proof.policy,integrity_receipt:wrongReceipt,integrity_assessment:wrongAssessment,
    external_admission_owner:true,authored_by_candidate:false,
  }),/candidate_binding_mismatch/);
});

test('integrity ledger is append-only, exact-candidate idempotent and durable',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-revision-integrity-'));
  try{
    const fx=fixture();
    const proof=integrity(fx);
    const admission=createRsiSkillRevisionIntegrityAdmission({
      source_sha:SOURCE,admission_id:'admission.skill.revision.persist',
      frontier_candidate:fx.frontier,request:fx.request,evaluation:fx.evaluation,library:fx.library,governance:fx.governance,
      integrity_policy:proof.policy,integrity_receipt:proof.receipt,integrity_assessment:proof.assessment,
      external_admission_owner:true,authored_by_candidate:false,
    });
    const statePath=path.join(root,'integrity.json');
    const ledger=new RsiSkillRevisionIntegrityLedger({statePath,source_sha:SOURCE});
    await ledger.init();
    const first=await ledger.append(admission);
    const again=await ledger.append(admission);
    assert.equal(first.state,'INTEGRITY_ADMITTED');
    assert.equal(again.state,'IDEMPOTENT');
    assert.equal(ledger.snapshot().admitted_count,1);
    assert.equal(ledger.admitted({parent_skill_digest:fx.parent.skill_digest}).length,1);

    const restored=new RsiSkillRevisionIntegrityLedger({statePath,source_sha:SOURCE});
    await restored.init();
    assert.equal(restored.snapshot().admission_count,1);
    assert.equal(restored.snapshot().admitted_count,1);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('integrity admission trust root makes exogenous acceptance mandatory without promotion authority',()=>{
  const root=rsiSkillRevisionIntegrityAdmissionTrustRootSnapshot();
  assert.equal(root.existing_evaluation_integrity_guard_reused,true);
  assert.equal(root.sealed_exogenous_acceptance_required,true);
  assert.equal(root.sealed_holdout_distinct_from_training_validation_meta,true);
  assert.equal(root.reward_hacking_rejected,true);
  assert.equal(root.specification_gaming_rejected,true);
  assert.equal(root.self_authored_verification_sufficient,false);
  assert.equal(root.candidate_can_modify_integrity_policy,false);
  assert.equal(root.candidate_can_read_sealed_holdout_content,false);
  assert.equal(root.existing_benchmark_provenance_required,true);
  assert.equal(root.direct_library_replacement_allowed,false);
  assert.equal(root.admission_is_execution_authority,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.integrity_admission_root_digest,/^sha256:[0-9a-f]{64}$/);
});
