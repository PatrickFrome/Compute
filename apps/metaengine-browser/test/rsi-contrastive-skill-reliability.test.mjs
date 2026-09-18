import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiSkillCapsule,
  createRsiSkillEvidence,
} from '../src/rsi-verified-skill-library.mjs';
import {
  createRsiSkillTrajectoryReceipt,
  createRsiSkillReliabilityDataset,
  attachRsiReliabilityDatasetReceipts,
  verifyRsiSkillReliabilityDataset,
  createRsiContrastiveSkillRevision,
  createRsiSkillReliabilityEvaluation,
  finalizeRsiContrastiveSkillReliability,
  rsiContrastiveSkillReliabilityTrustRootSnapshot,
} from '../src/rsi-contrastive-skill-reliability.mjs';

const sha=(c)=>c.repeat(40);
const d=(c)=>`sha256:${c.repeat(64)}`;

function skill(version=1,parent=null,char='1'){
  return createRsiSkillCapsule({
    skill_id:'skill.limit-aware.tool-use',
    version,
    parent_skill_digest:parent,
    source_candidate_sha:sha(char),
    role:'VERIFIER',
    input_schema_digest:d('1'),
    output_schema_digest:d('2'),
    implementation_digest:d(char),
    components:[{component_id:`limit-aware.component.${version}`,artifact_digest:d('f'),kind:'TYPED_TRANSFORM'}],
    capabilities:['READ_VERIFIED_CONTEXT','CHECK_TYPED_OUTPUT'],
    max_context_tokens:2048,
    max_output_tokens:512,
    max_invocations:2,
    external_builder:true,
    authored_by_candidate:false,
  });
}

function evidence(s,char='a'){
  return createRsiSkillEvidence({
    capsule:s,
    hidden_holdout_digest:d('9'),
    evaluator_root_digest:d('8'),
    unit_test_digest:d('7'),
    runtime_feedback_digest:d(char),
    attempt_count:20,
    success_count:18,
    hard_invariants_pass:true,
    verified_for_library:true,
    evidence_refs:[`SKILL_EVIDENCE_${char}`],
    external_evaluator:true,
    authored_by_candidate:false,
  });
}

function trajectory(s,e,{cohort,index,outcome,state='3',view='4',sufficient=true,clarify=false,unsupported=false,char='5'}){
  return createRsiSkillTrajectoryReceipt({
    receipt_id:`trajectory.${cohort}.${index}.${outcome.toLowerCase().replaceAll('_','-')}`,
    skill:s,
    skill_evidence:e,
    cohort_id:cohort,
    repeat_index:index,
    state_signature_digest:d(state),
    deployment_view_digest:d(view),
    outcome,
    invoked_skill:true,
    capability_sufficient:sufficient,
    clarification_required:clarify,
    unsupported_success_claim:unsupported,
    evidence_digest:d(char),
    evidence_refs:[`TRAJECTORY_${cohort}_${index}`],
    external_evaluator:true,
    authored_by_candidate:false,
  });
}

function baselineReceipts(s,e){
  return [
    trajectory(s,e,{cohort:'cohort.alpha',index:1,outcome:'SUCCESS',char:'1'}),
    trajectory(s,e,{cohort:'cohort.alpha',index:2,outcome:'FAILURE',char:'2'}),
    trajectory(s,e,{cohort:'cohort.alpha',index:3,outcome:'SUCCESS',char:'3'}),
    trajectory(s,e,{cohort:'cohort.beta',index:1,outcome:'UNSUPPORTED_CLAIM',sufficient:false,clarify:true,unsupported:true,state:'5',view:'6',char:'4'}),
    trajectory(s,e,{cohort:'cohort.beta',index:2,outcome:'CORRECT_LIMIT',sufficient:false,clarify:true,state:'5',view:'6',char:'5'}),
    trajectory(s,e,{cohort:'cohort.beta',index:3,outcome:'CORRECT_LIMIT',sufficient:false,clarify:true,state:'5',view:'6',char:'6'}),
  ];
}

function successorReceipts(s,e){
  return [
    trajectory(s,e,{cohort:'cohort.alpha',index:1,outcome:'SUCCESS',char:'7'}),
    trajectory(s,e,{cohort:'cohort.alpha',index:2,outcome:'SUCCESS',char:'8'}),
    trajectory(s,e,{cohort:'cohort.alpha',index:3,outcome:'SUCCESS',char:'9'}),
    trajectory(s,e,{cohort:'cohort.beta',index:1,outcome:'CORRECT_LIMIT',sufficient:false,clarify:true,state:'5',view:'6',char:'a'}),
    trajectory(s,e,{cohort:'cohort.beta',index:2,outcome:'CORRECT_LIMIT',sufficient:false,clarify:true,state:'5',view:'6',char:'b'}),
    trajectory(s,e,{cohort:'cohort.beta',index:3,outcome:'CORRECT_LIMIT',sufficient:false,clarify:true,state:'5',view:'6',char:'c'}),
  ];
}

function dataset(id,s,e,receipts){
  return createRsiSkillReliabilityDataset({
    dataset_id:id,
    skill:s,
    skill_evidence:e,
    trajectory_receipts:receipts,
    hidden_repeated_trial_set_digest:d('d'),
    external_dataset_owner:true,
    authored_by_candidate:false,
  });
}

function setup(){
  const parent=skill();
  const parentEvidence=evidence(parent,'a');
  const baseReceipts=baselineReceipts(parent,parentEvidence);
  const base=dataset('reliability.dataset.baseline',parent,parentEvidence,baseReceipts);
  const successor=skill(2,parent.skill_digest,'2');
  const successorEvidence=evidence(successor,'b');
  const afterReceipts=successorReceipts(successor,successorEvidence);
  const after=dataset('reliability.dataset.successor',successor,successorEvidence,afterReceipts);
  const revision=createRsiContrastiveSkillRevision({
    revision_id:'reliability.revision.limit-aware.1',
    parent_skill:parent,
    parent_skill_evidence:parentEvidence,
    reliability_dataset:base,
    trajectory_receipts:baseReceipts,
    successor_skill:successor,
    contrast_codes:[
      'MISSED_CLARIFICATION',
      'UNSUPPORTED_CAPABILITY_CLAIM',
      'SUCCESS_PATTERN_MISSING_FROM_FAILURE',
      'LIMIT_AWARENESS_PATTERN',
    ],
    contrast_evidence_digest:d('e'),
    evidence_refs:['CONTRAST_RUN_500'],
    external_curator:true,
    authored_by_candidate:false,
  });
  return {parent,parentEvidence,baseReceipts,base,successor,successorEvidence,afterReceipts,after,revision};
}

test('repeated-trial dataset exposes potential-vs-consistent reliability gap and limit violations',()=>{
  const {parent,parentEvidence,baseReceipts,base}=setup();
  verifyRsiSkillReliabilityDataset(
    attachRsiReliabilityDatasetReceipts(base,baseReceipts),
    parent,parentEvidence,
  );
  assert.equal(base.cohort_count,2);
  assert.equal(base.trajectory_count,6);
  assert.equal(base.potential_success_rate,1);
  assert.equal(base.consistent_success_rate,0);
  assert.equal(base.reliability_gap,1);
  assert.equal(base.limit_violation_count,1);
  assert.equal(base.limit_violation_rate,1/6);
  assert.equal(base.pass_any_and_pass_all_both_reported,true);
  assert.equal(base.consistency_is_first_class_metric,true);
  assert.equal(base.limit_awareness_is_first_class_metric,true);
  assert.equal(base.authority_effect,false);
});

test('repeated trials fail closed when supposedly identical cohort context drifts',()=>{
  const parent=skill();
  const ev=evidence(parent);
  const rows=[
    trajectory(parent,ev,{cohort:'cohort.drift',index:1,outcome:'SUCCESS',state:'1',view:'2'}),
    trajectory(parent,ev,{cohort:'cohort.drift',index:2,outcome:'SUCCESS',state:'3',view:'2'}),
  ];
  assert.throws(()=>dataset('reliability.dataset.drift',parent,ev,rows),/repeated_trial_context_drift/);
});

test('trajectory receipt explicitly distinguishes correct limitation from unsupported claim',()=>{
  const parent=skill();
  const ev=evidence(parent);
  const correct=trajectory(parent,ev,{
    cohort:'cohort.limit',index:1,outcome:'CORRECT_LIMIT',sufficient:false,clarify:true,
  });
  assert.equal(correct.correct_outcome,true);
  assert.equal(correct.limit_violation,false);
  assert.equal(correct.unsupported_success_claim,false);

  const bad=trajectory(parent,ev,{
    cohort:'cohort.limit',index:2,outcome:'UNSUPPORTED_CLAIM',sufficient:false,clarify:true,unsupported:true,
  });
  assert.equal(bad.correct_outcome,false);
  assert.equal(bad.limit_violation,true);
});

test('contrastive revision is a versioned successor with same interface/capabilities and no self-commit authority',()=>{
  const {revision,parent,successor}=setup();
  assert.equal(revision.parent_skill_digest,parent.skill_digest);
  assert.equal(revision.successor_skill_digest,successor.skill_digest);
  assert.equal(revision.successor_skill_version,2);
  assert.equal(revision.success_failure_contrast_required,true);
  assert.equal(revision.invoked_skill_grouping_required,true);
  assert.equal(revision.deployment_faithful_reconstruction_required,true);
  assert.equal(revision.de_hardcoding_required,true);
  assert.equal(revision.task_identifiers_allowed_in_successor,false);
  assert.equal(revision.memorized_answers_allowed_in_successor,false);
  assert.equal(revision.environment_specific_values_allowed_in_successor,false);
  assert.equal(revision.v126_source_preservation_still_required,true);
  assert.equal(revision.v124_library_evidence_still_required,true);
  assert.equal(revision.authority_effect,false);
});

test('candidate cannot author its own trusted contrastive revision',()=>{
  const {parent,parentEvidence,baseReceipts,base,successor}=setup();
  assert.throws(()=>createRsiContrastiveSkillRevision({
    revision_id:'reliability.revision.self-authored',
    parent_skill:parent,
    parent_skill_evidence:parentEvidence,
    reliability_dataset:base,
    trajectory_receipts:baseReceipts,
    successor_skill:successor,
    contrast_codes:['SUCCESS_PATTERN_MISSING_FROM_FAILURE'],
    contrast_evidence_digest:d('e'),
    evidence_refs:['MODEL_SELF_REPORT'],
    external_curator:false,
    authored_by_candidate:true,
  }),/external_origin_required/);
});

test('reliability evaluation rewards repeated consistency and limit-awareness without sacrificing potential capability',()=>{
  const {parent,parentEvidence,baseReceipts,base,successorEvidence,afterReceipts,after,revision}=setup();
  const evaluation=createRsiSkillReliabilityEvaluation({
    evaluation_id:'reliability.evaluation.1',
    revision,
    parent_skill:parent,
    parent_skill_evidence:parentEvidence,
    baseline_dataset:base,
    baseline_trajectory_receipts:baseReceipts,
    successor_skill_evidence:successorEvidence,
    successor_dataset:after,
    successor_trajectory_receipts:afterReceipts,
    hard_invariants_pass:true,
    max_potential_regression:0,
    evidence_refs:['RELIABILITY_EVAL_600','REPEATED_HOLDOUT_600'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  assert.equal(evaluation.baseline_potential_success_rate,1);
  assert.equal(evaluation.successor_potential_success_rate,1);
  assert.equal(evaluation.baseline_consistent_success_rate,0);
  assert.equal(evaluation.successor_consistent_success_rate,1);
  assert.equal(evaluation.consistent_success_delta,1);
  assert.ok(evaluation.limit_violation_delta<0);
  assert.equal(evaluation.reliable_behavior_improved,true);
  assert.equal(evaluation.potential_capability_preserved,true);
  assert.equal(evaluation.reliability_gate_pass,true);
  assert.equal(evaluation.pass_any_alone_is_not_sufficient,true);
  assert.equal(evaluation.authority_effect,false);

  const result=finalizeRsiContrastiveSkillReliability({revision,evaluation});
  assert.equal(result.state,'ELIGIBLE_FOR_V126_SCOPE_PRESERVATION');
  assert.equal(result.directly_replaces_parent_skill,false);
  assert.equal(result.v126_source_preservation_required,true);
  assert.equal(result.v124_external_library_evidence_required,true);
  assert.equal(result.skill_reliability_result_is_promotion_authority,false);
  assert.equal(result.authority_effect,false);
});

test('high Pass@any without consistency or limit-awareness gain is not enough to pass',()=>{
  const {parent,parentEvidence,baseReceipts,base,successor,successorEvidence,revision}=setup();
  const sameReceipts=baselineReceipts(successor,successorEvidence);
  const same=dataset('reliability.dataset.no-gain',successor,successorEvidence,sameReceipts);
  const evaluation=createRsiSkillReliabilityEvaluation({
    evaluation_id:'reliability.evaluation.no-gain',
    revision,
    parent_skill:parent,
    parent_skill_evidence:parentEvidence,
    baseline_dataset:base,
    baseline_trajectory_receipts:baseReceipts,
    successor_skill_evidence:successorEvidence,
    successor_dataset:same,
    successor_trajectory_receipts:sameReceipts,
    hard_invariants_pass:true,
    max_potential_regression:0,
    evidence_refs:['RELIABILITY_EVAL_601'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  assert.equal(evaluation.successor_potential_success_rate,1);
  assert.equal(evaluation.reliable_behavior_improved,false);
  assert.equal(evaluation.reliability_gate_pass,false);
  const result=finalizeRsiContrastiveSkillReliability({revision,evaluation});
  assert.equal(result.state,'REJECTED_RELIABILITY_REVISION');
});

test('contrastive reliability trust root makes consistency and limit-awareness first-class without widening authority',()=>{
  const root=rsiContrastiveSkillReliabilityTrustRootSnapshot();
  assert.equal(root.mechanism,'TRAJECTORY_CONTRASTIVE_RELIABILITY_EVOLUTION');
  assert.equal(root.repeated_trials_required,true);
  assert.equal(root.pass_any_and_pass_all_both_reported,true);
  assert.equal(root.consistency_is_first_class_metric,true);
  assert.equal(root.limit_awareness_is_first_class_metric,true);
  assert.equal(root.skill_invocation_grouping_required,true);
  assert.equal(root.deployment_faithful_reconstruction_required,true);
  assert.equal(root.success_failure_contrast_required,true);
  assert.equal(root.de_hardcoding_required,true);
  assert.equal(root.candidate_can_self_rewrite,false);
  assert.equal(root.candidate_can_self_certify_reliability,false);
  assert.equal(root.v126_source_preservation_required,true);
  assert.equal(root.v124_external_library_evidence_required,true);
  assert.equal(root.authority_effect,false);
  assert.match(root.reliability_root_digest,/^sha256:[0-9a-f]{64}$/);
});
