import assert from 'node:assert/strict';
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
import { createRsiSkillRevisionIntegrityAdmission } from '../src/rsi-skill-revision-integrity-admission.mjs';
import {
  createRsiSkillTrajectoryReceipt,
  createRsiSkillReliabilityDataset,
} from '../src/rsi-contrastive-skill-reliability.mjs';
import {
  createRsiIntegrityBoundSkillReliability,
  verifyRsiIntegrityBoundSkillReliability,
  rsiIntegrityBoundSkillReliabilityTrustRootSnapshot,
} from '../src/rsi-integrity-bound-skill-reliability.mjs';

const SOURCE='a'.repeat(40);
const d=(char)=>`sha256:${char.repeat(64)}`;

function fullFixture(){
  const parent=createRsiSkillCapsule({
    skill_id:'skill.reliability.parent',version:1,parent_skill_digest:null,source_candidate_sha:'b'.repeat(40),
    role:'ANALYZER',input_schema_digest:d('1'),output_schema_digest:d('2'),implementation_digest:d('3'),
    components:[{component_id:'skill.reliability.parent.component',artifact_digest:d('4'),kind:'TYPED_TRANSFORM'}],
    capabilities:['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES'],max_context_tokens:2048,max_output_tokens:512,max_invocations:2,
    external_builder:true,authored_by_candidate:false,
  });
  const parentEvidence=createRsiSkillEvidence({
    capsule:parent,hidden_holdout_digest:d('5'),evaluator_root_digest:d('6'),unit_test_digest:d('7'),
    runtime_feedback_digest:d('8'),attempt_count:12,success_count:10,hard_invariants_pass:true,verified_for_library:true,
    evidence_refs:['VERIFY_skill.reliability.parent'],external_evaluator:true,authored_by_candidate:false,
  });
  const library=createRsiVerifiedSkillLibrary({
    library_id:'runtime.skill.reliability.library',entries:[{capsule:parent,evidence:parentEvidence}],
    external_library_owner:true,authored_by_candidate:false,
  });
  const governance=createRsiSkillLibraryGovernance({
    governance_id:'runtime.skill.reliability.governance',library,lifecycle_evidence:[],
    max_active_skills:1,exploration_slots:1,external_library_owner:true,authored_by_candidate:false,
  });
  const request=createRsiSkillCurationRequest({
    source_sha:SOURCE,request_id:'curation.reliability.1',library,governance,parent_skill_digest:parent.skill_digest,
    reason:'RELIABILITY_GAP',trigger_evidence_digests:[d('9'),d('a')],
    training_context_digest:d('b'),validation_holdout_digest:d('c'),meta_holdout_digest:d('d'),
    optimizer_model_family:'GPT_5_6_SOL',edit_budget:3,external_curator:true,authored_by_candidate:false,
  });
  const successor=createRsiSkillCapsule({
    skill_id:parent.skill_id,version:2,parent_skill_digest:parent.skill_digest,source_candidate_sha:'c'.repeat(40),
    role:parent.role,input_schema_digest:parent.input_schema_digest,output_schema_digest:parent.output_schema_digest,
    implementation_digest:d('e'),
    components:[{component_id:'skill.reliability.parent.component.v2',artifact_digest:d('f'),kind:'TYPED_TRANSFORM'}],
    capabilities:parent.capabilities,max_context_tokens:parent.max_context_tokens,max_output_tokens:parent.max_output_tokens,
    max_invocations:parent.max_invocations,external_builder:true,authored_by_candidate:false,
  });
  const successorEvidence=createRsiSkillEvidence({
    capsule:successor,hidden_holdout_digest:d('5'),evaluator_root_digest:d('6'),unit_test_digest:d('7'),
    runtime_feedback_digest:d('9'),attempt_count:12,success_count:11,hard_invariants_pass:true,verified_for_library:true,
    evidence_refs:['VERIFY_skill.reliability.successor'],external_evaluator:true,authored_by_candidate:false,
  });
  const evaluation=createRsiSkillRevisionEvaluation({
    evaluation_id:'evaluation.reliability.1',request,library,governance,successor_skill:successor,
    baseline_validation_score:0.60,candidate_validation_score:0.72,
    baseline_meta_score:0.55,candidate_meta_score:0.57,hard_invariants_pass:true,
    evaluator_digest:d('1'),evaluation_digest:d('2'),evidence_refs:['eval:reliability:curation'],
    external_evaluator:true,authored_by_candidate:false,
  });
  const frontier=createRsiSkillRevisionFrontierCandidate({
    source_sha:SOURCE,request,evaluation,library,governance,external_frontier_owner:true,authored_by_candidate:false,
  });
  const policy=createRsiEvaluationIntegrityPolicy({
    policy_id:'integrity.reliability.1',visible_suite_digest:d('3'),compositional_holdout_digest:d('e'),
    evaluator_root_digest:d('4'),workspace_baseline_digest:d('5'),max_visible_holdout_gap:0.15,min_holdout_pass_rate:0.8,
    external_policy_owner:true,authored_by_candidate:false,
  });
  const receipt=createRsiEvaluationIntegrityReceipt({
    policy,receipt_id:'integrity.reliability.receipt.1',
    candidate_id:`candidate_sha256_${successor.skill_digest.slice('sha256:'.length)}`,
    candidate_sha:successor.source_candidate_sha,visible_pass_rate:0.92,holdout_pass_rate:0.90,
    evaluator_root_digest:d('4'),workspace_before_digest:d('5'),workspace_after_digest:d('6'),
    patch_audit_digest:d('7'),file_access_audit_digest:d('8'),network_audit_digest:d('9'),
    external_integrity_monitor:true,authored_by_candidate:false,evidence_refs:['integrity:reliability:1'],
  });
  const assessment=assessRsiEvaluationIntegrity({policy,receipt});
  const admission=createRsiSkillRevisionIntegrityAdmission({
    source_sha:SOURCE,admission_id:'admission.reliability.1',
    frontier_candidate:frontier,request,evaluation,library,governance,
    integrity_policy:policy,integrity_receipt:receipt,integrity_assessment:assessment,
    external_admission_owner:true,authored_by_candidate:false,
  });
  return {parent,parentEvidence,library,governance,request,successor,successorEvidence,evaluation,frontier,policy,receipt,assessment,admission};
}

function trajectory({skill,evidence,id,repeat,outcome,evidenceChar}){
  return createRsiSkillTrajectoryReceipt({
    receipt_id:id,skill,skill_evidence:evidence,cohort_id:'cohort.reliability.hidden.1',repeat_index:repeat,
    state_signature_digest:d('1'),deployment_view_digest:d('2'),outcome,invoked_skill:true,
    capability_sufficient:true,clarification_required:false,unsupported_success_claim:false,
    evidence_digest:d(evidenceChar),evidence_refs:[`trajectory:${id}`],
    external_evaluator:true,authored_by_candidate:false,
  });
}

function reliabilityData(fx,{successorOutcomes=['SUCCESS','SUCCESS'],hidden=d('0')}={}){
  const baselineReceipts=[
    trajectory({skill:fx.parent,evidence:fx.parentEvidence,id:'baseline.repeat.1',repeat:1,outcome:'SUCCESS',evidenceChar:'3'}),
    trajectory({skill:fx.parent,evidence:fx.parentEvidence,id:'baseline.repeat.2',repeat:2,outcome:'FAILURE',evidenceChar:'4'}),
  ];
  const baselineDataset=createRsiSkillReliabilityDataset({
    dataset_id:'dataset.reliability.baseline',skill:fx.parent,skill_evidence:fx.parentEvidence,
    trajectory_receipts:baselineReceipts,hidden_repeated_trial_set_digest:hidden,
    external_dataset_owner:true,authored_by_candidate:false,
  });
  const successorReceipts=successorOutcomes.map((outcome,index)=>trajectory({
    skill:fx.successor,evidence:fx.successorEvidence,id:`successor.repeat.${index+1}`,repeat:index+1,outcome,
    evidenceChar:index===0?'5':'6',
  }));
  const successorDataset=createRsiSkillReliabilityDataset({
    dataset_id:'dataset.reliability.successor',skill:fx.successor,skill_evidence:fx.successorEvidence,
    trajectory_receipts:successorReceipts,hidden_repeated_trial_set_digest:hidden,
    external_dataset_owner:true,authored_by_candidate:false,
  });
  return {baselineReceipts,baselineDataset,successorReceipts,successorDataset};
}

test('integrity-admitted revision passes existing contrastive reliability only on repeated-trial improvement',()=>{
  const fx=fullFixture();
  assert.equal(fx.admission.state,'INTEGRITY_ADMITTED');
  const data=reliabilityData(fx);
  const binding=createRsiIntegrityBoundSkillReliability({
    source_sha:SOURCE,binding_id:'binding.reliability.1',integrity_admission:fx.admission,
    parent_skill:fx.parent,parent_skill_evidence:fx.parentEvidence,
    baseline_dataset:data.baselineDataset,baseline_trajectory_receipts:data.baselineReceipts,
    successor_skill:fx.successor,successor_skill_evidence:fx.successorEvidence,
    successor_dataset:data.successorDataset,successor_trajectory_receipts:data.successorReceipts,
    contrast_codes:['SUCCESS_PATTERN_MISSING_FROM_FAILURE'],contrast_evidence_digest:d('7'),
    revision_evidence_refs:['contrast:reliability:1'],reliability_evidence_refs:['eval:reliability:1'],
    hard_invariants_pass:true,max_potential_regression:0,
    external_curator:true,external_evaluator:true,authored_by_candidate:false,
  });
  verifyRsiIntegrityBoundSkillReliability(binding,{
    integrity_admission:fx.admission,parent_skill:fx.parent,parent_skill_evidence:fx.parentEvidence,
    baseline_dataset:data.baselineDataset,baseline_trajectory_receipts:data.baselineReceipts,
    successor_skill:fx.successor,successor_skill_evidence:fx.successorEvidence,
    successor_dataset:data.successorDataset,successor_trajectory_receipts:data.successorReceipts,
    contrast_codes:['SUCCESS_PATTERN_MISSING_FROM_FAILURE'],contrast_evidence_digest:d('7'),
    revision_evidence_refs:['contrast:reliability:1'],reliability_evidence_refs:['eval:reliability:1'],
    hard_invariants_pass:true,max_potential_regression:0,
  });
  assert.equal(binding.reliability_evaluation.reliability_gate_pass,true);
  assert.equal(binding.reliability_result.state,'ELIGIBLE_FOR_V126_SCOPE_PRESERVATION');
  assert.equal(binding.state,'ELIGIBLE_FOR_EXISTING_SCOPE_PRESERVATION_GATE');
  assert.equal(binding.eligible_for_existing_scope_preservation_gate,true);
  assert.equal(binding.direct_library_replacement_allowed,false);
  assert.equal(binding.authority_effect,false);
});

test('pass-any without improved consistency does not pass reliability gate',()=>{
  const fx=fullFixture();
  const data=reliabilityData(fx,{successorOutcomes:['SUCCESS','FAILURE']});
  const binding=createRsiIntegrityBoundSkillReliability({
    source_sha:SOURCE,binding_id:'binding.reliability.no-gain',integrity_admission:fx.admission,
    parent_skill:fx.parent,parent_skill_evidence:fx.parentEvidence,
    baseline_dataset:data.baselineDataset,baseline_trajectory_receipts:data.baselineReceipts,
    successor_skill:fx.successor,successor_skill_evidence:fx.successorEvidence,
    successor_dataset:data.successorDataset,successor_trajectory_receipts:data.successorReceipts,
    contrast_codes:['SUCCESS_PATTERN_MISSING_FROM_FAILURE'],contrast_evidence_digest:d('7'),
    revision_evidence_refs:['contrast:no-gain'],reliability_evidence_refs:['eval:no-gain'],
    hard_invariants_pass:true,max_potential_regression:0,
    external_curator:true,external_evaluator:true,authored_by_candidate:false,
  });
  assert.equal(binding.reliability_evaluation.reliability_gate_pass,false);
  assert.equal(binding.reliability_result.state,'REJECTED_RELIABILITY_REVISION');
  assert.equal(binding.eligible_for_existing_scope_preservation_gate,false);
  assert.equal(binding.pass_any_alone_is_not_sufficient,true);
});

test('reliability hidden repeated-trial set cannot alias earlier curation or sealed-integrity holdouts',()=>{
  const fx=fullFixture();
  for(const hidden of [fx.admission.sealed_holdout_digest,fx.admission.validation_holdout_digest,fx.admission.meta_holdout_digest]){
    const data=reliabilityData(fx,{hidden});
    assert.throws(()=>createRsiIntegrityBoundSkillReliability({
      source_sha:SOURCE,binding_id:'binding.reliability.alias',integrity_admission:fx.admission,
      parent_skill:fx.parent,parent_skill_evidence:fx.parentEvidence,
      baseline_dataset:data.baselineDataset,baseline_trajectory_receipts:data.baselineReceipts,
      successor_skill:fx.successor,successor_skill_evidence:fx.successorEvidence,
      successor_dataset:data.successorDataset,successor_trajectory_receipts:data.successorReceipts,
      contrast_codes:['SUCCESS_PATTERN_MISSING_FROM_FAILURE'],contrast_evidence_digest:d('7'),
      revision_evidence_refs:['contrast:alias'],reliability_evidence_refs:['eval:alias'],
      hard_invariants_pass:true,external_curator:true,external_evaluator:true,authored_by_candidate:false,
    }),/hidden_trial_alias/);
  }
});

test('reliability bridge refuses non-admitted integrity or candidate-authored evaluation',()=>{
  const fx=fullFixture();
  const data=reliabilityData(fx);
  assert.throws(()=>createRsiIntegrityBoundSkillReliability({
    source_sha:SOURCE,binding_id:'binding.reliability.bad-origin',integrity_admission:fx.admission,
    parent_skill:fx.parent,parent_skill_evidence:fx.parentEvidence,
    baseline_dataset:data.baselineDataset,baseline_trajectory_receipts:data.baselineReceipts,
    successor_skill:fx.successor,successor_skill_evidence:fx.successorEvidence,
    successor_dataset:data.successorDataset,successor_trajectory_receipts:data.successorReceipts,
    contrast_codes:['SUCCESS_PATTERN_MISSING_FROM_FAILURE'],contrast_evidence_digest:d('7'),
    revision_evidence_refs:['contrast:bad-origin'],reliability_evidence_refs:['eval:bad-origin'],
    hard_invariants_pass:true,external_curator:false,external_evaluator:false,authored_by_candidate:true,
  }),/external_origin_required/);

  assert.throws(()=>createRsiIntegrityBoundSkillReliability({
    source_sha:SOURCE,binding_id:'binding.reliability.bad-integrity',
    integrity_admission:{...fx.admission,state:'INTEGRITY_REJECTED',integrity_verified:false,eligible_for_existing_reliability_gate:false},
    parent_skill:fx.parent,parent_skill_evidence:fx.parentEvidence,
    baseline_dataset:data.baselineDataset,baseline_trajectory_receipts:data.baselineReceipts,
    successor_skill:fx.successor,successor_skill_evidence:fx.successorEvidence,
    successor_dataset:data.successorDataset,successor_trajectory_receipts:data.successorReceipts,
    contrast_codes:['SUCCESS_PATTERN_MISSING_FROM_FAILURE'],contrast_evidence_digest:d('7'),
    revision_evidence_refs:['contrast:bad-integrity'],reliability_evidence_refs:['eval:bad-integrity'],
    hard_invariants_pass:true,external_curator:true,external_evaluator:true,authored_by_candidate:false,
  }),/integrity_admission_required/);
});

test('reliability trust root reuses existing gate and cannot become library or execution authority',()=>{
  const root=rsiIntegrityBoundSkillReliabilityTrustRootSnapshot();
  assert.equal(root.existing_contrastive_reliability_gate_reused,true);
  assert.equal(root.prior_sealed_integrity_admission_required,true);
  assert.equal(root.hidden_repeated_trial_set_required,true);
  assert.equal(root.hidden_trial_distinct_from_curation_and_integrity_holdouts,true);
  assert.equal(root.repeated_trial_consistency_required,true);
  assert.equal(root.pass_any_alone_is_not_sufficient,true);
  assert.equal(root.existing_scope_preservation_gate_required,true);
  assert.equal(root.direct_library_replacement_allowed,false);
  assert.equal(root.self_authored_reliability_sufficient,false);
  assert.equal(root.binding_is_execution_authority,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.reliability_binding_root_digest,/^sha256:[0-9a-f]{64}$/);
});
