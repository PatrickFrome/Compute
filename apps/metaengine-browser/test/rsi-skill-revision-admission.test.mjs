import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiSkillCapsule,
  createRsiSkillEvidence,
  createRsiSkillPortabilityReceipt,
} from '../src/rsi-verified-skill-library.mjs';
import {
  createRsiSkillTrajectoryReceipt,
  createRsiSkillReliabilityDataset,
  createRsiContrastiveSkillRevision,
  createRsiSkillReliabilityEvaluation,
} from '../src/rsi-contrastive-skill-reliability.mjs';
import {
  createRsiMasteryAnchor,
  createRsiMasteryLedger,
  createRsiRetentionReplayPlan,
  createRsiRetentionReplayReceipt,
} from '../src/rsi-regression-replay.mjs';
import {
  createRsiCladeNode,
} from '../src/rsi-clade-metaproductivity.mjs';
import {
  RSI_VERIFIED_LINEAGE_ADMISSION_SCHEMA,
} from '../src/rsi-verified-lineage-admission.mjs';
import {
  createRsiSkillRevisionAdmission,
  verifyRsiSkillRevisionAdmission,
} from '../src/rsi-skill-revision-admission.mjs';
import {
  admitRsiLineageSkill,
} from '../src/rsi-lineage-skill-admission.mjs';

const sha=(c)=>c.repeat(40);
const d=(c)=>`sha256:${c.repeat(64)}`;
const cid=(c)=>`candidate_sha256_${c.repeat(64)}`;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function digest(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}
function lineage(){
  const clade=createRsiCladeNode({
    node_id:'clade:cccccccccccccccccccccccc',
    candidate_id:cid('c'),
    candidate_sha:sha('2'),
    parent_candidate_id:null,
    benchmark_solved:18,
    benchmark_total:20,
    evaluation_digest:d('6'),
    expansion_count:0,
    external_evaluator:true,
    authored_by_candidate:false,
  });
  const core={
    schema:RSI_VERIFIED_LINEAGE_ADMISSION_SCHEMA,version:1,
    candidate_id:cid('c'),candidate_sha:sha('2'),parent_sha:sha('1'),parent_candidate_id:null,
    verified_evaluator_result_digest:d('1'),tournament_plan_id:'rsi_tournament_revision',
    tournament_plan_digest:d('2'),tournament_result_digest:d('3'),archive_admission_digest:d('4'),
    archive_state:'PARETO_ELITE',archive_active:true,archive_snapshot_digest:d('5'),
    clade_node:clade,clade_node_digest:clade.node_digest,
    diverse_lineage_retention_required:true,scalar_rank_authoritative:false,
    non_elite_stepping_stones_may_remain_active:true,skill_distillation_research_eligible:true,
    direct_skill_library_admission_allowed:false,transfer_evidence_required_before_skill_library:true,
    lifecycle_governance_required_before_skill_activation:true,
    candidate_can_edit_archive:false,candidate_can_edit_clade_statistics:false,
    eligible_for_promotion:false,direct_promotion_enabled:false,direct_self_update_enabled:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,lineage_admission_digest:digest(core)};
}
function skill(version=1,parent=null,source='1'){
  return createRsiSkillCapsule({
    skill_id:'skill.limit-aware.tool-use',version,parent_skill_digest:parent,
    source_candidate_sha:sha(source),role:'VERIFIER',
    input_schema_digest:d('1'),output_schema_digest:d('2'),implementation_digest:d(source),
    components:[{component_id:`limit-aware.component.${version}`,artifact_digest:d('f'),kind:'TYPED_TRANSFORM'}],
    capabilities:['READ_VERIFIED_CONTEXT','CHECK_TYPED_OUTPUT'],
    max_context_tokens:2048,max_output_tokens:512,max_invocations:2,
    external_builder:true,authored_by_candidate:false,
  });
}
function evidence(s,char='a'){
  return createRsiSkillEvidence({
    capsule:s,hidden_holdout_digest:d('9'),evaluator_root_digest:d('8'),unit_test_digest:d('7'),runtime_feedback_digest:d(char),
    attempt_count:20,success_count:18,hard_invariants_pass:true,verified_for_library:true,
    evidence_refs:[`SKILL_EVIDENCE_${char}`],external_evaluator:true,authored_by_candidate:false,
  });
}
function trajectory(s,e,{cohort,index,outcome,state='3',view='4',sufficient=true,clarify=false,unsupported=false,char='5'}){
  return createRsiSkillTrajectoryReceipt({
    receipt_id:`trajectory.${cohort}.${index}.${outcome.toLowerCase().replaceAll('_','-')}`,
    skill:s,skill_evidence:e,cohort_id:cohort,repeat_index:index,
    state_signature_digest:d(state),deployment_view_digest:d(view),outcome,invoked_skill:true,
    capability_sufficient:sufficient,clarification_required:clarify,unsupported_success_claim:unsupported,
    evidence_digest:d(char),evidence_refs:[`TRAJECTORY_${cohort}_${index}`],
    external_evaluator:true,authored_by_candidate:false,
  });
}
function baseReceipts(s,e){
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
    dataset_id:id,skill:s,skill_evidence:e,trajectory_receipts:receipts,
    hidden_repeated_trial_set_digest:d('d'),external_dataset_owner:true,authored_by_candidate:false,
  });
}
function anchor(id,family,char){
  return createRsiMasteryAnchor({
    anchor_id:`mastery.${id}`,capability_family:family,challenge_digest:d(char),benchmark_admission_digest:d('e'),
    baseline_candidate_id:cid('a'),baseline_candidate_sha:sha('1'),mastered_generation:4,mastered_at:'2026-09-18T00:00:00Z',
    baseline_success_rate:.95,minimum_retained_success_rate:.8,historical_regression_count:1,safety_critical:true,
    external_mastery_verifier:true,authored_by_candidate:false,contamination_resistant_evidence:true,hidden_holdout:true,
    evidence_refs:[`MASTER_${id}`],
  });
}
function fixture({retentionRegression=false}={}){
  const parent=skill();
  const parentEvidence=evidence(parent,'a');
  const baselineReceipts=baseReceipts(parent,parentEvidence);
  const baseline=dataset('reliability.dataset.baseline',parent,parentEvidence,baselineReceipts);
  const successor=skill(2,parent.skill_digest,'2');
  const successorEvidence=evidence(successor,'b');
  const afterReceipts=successorReceipts(successor,successorEvidence);
  const after=dataset('reliability.dataset.successor',successor,successorEvidence,afterReceipts);

  const revisionInputs={
    revision_id:'reliability.revision.limit-aware.1',
    parent_skill:parent,parent_skill_evidence:parentEvidence,reliability_dataset:baseline,trajectory_receipts:baselineReceipts,
    successor_skill:successor,
    contrast_codes:['MISSED_CLARIFICATION','UNSUPPORTED_CAPABILITY_CLAIM','SUCCESS_PATTERN_MISSING_FROM_FAILURE','LIMIT_AWARENESS_PATTERN'],
    contrast_evidence_digest:d('e'),evidence_refs:['CONTRAST_RUN_500'],external_curator:true,authored_by_candidate:false,
  };
  const revision=createRsiContrastiveSkillRevision(revisionInputs);
  const evaluationInputs={
    evaluation_id:'reliability.evaluation.1',
    parent_skill:parent,parent_skill_evidence:parentEvidence,baseline_dataset:baseline,baseline_trajectory_receipts:baselineReceipts,
    successor_skill_evidence:successorEvidence,successor_dataset:after,successor_trajectory_receipts:afterReceipts,
    hard_invariants_pass:true,max_potential_regression:0,evidence_refs:['RELIABILITY_EVAL_600'],
    external_evaluator:true,authored_by_candidate:false,
  };
  createRsiSkillReliabilityEvaluation({...evaluationInputs,revision});

  const ledger=createRsiMasteryLedger({
    ledger_id:'rsi.mastery.ledger.revision',
    anchors:[anchor('auth','AUTH_CONTINUITY','1'),anchor('workspace','WORKSPACE_ISOLATION','2')],
  });
  const plan=createRsiRetentionReplayPlan({
    ledger,current_candidate_id:cid('c'),current_candidate_sha:sha('2'),current_generation:30,max_replay_tasks:2,
  });
  const retentionReceipts=plan.tasks.map((task,index)=>createRsiRetentionReplayReceipt({
    plan,ledger,anchor_id:task.anchor_id,replay_attempts:20,replay_successes:retentionRegression&&index===0?5:19,
    hard_invariants_pass:true,evaluator_root_digest:d('f'),environment_fingerprint:'windows-x64-browsercell-v1',
    external_replay_evaluator:true,authored_by_candidate:false,evidence_refs:[`REPLAY_${task.anchor_id}`],
  }));
  const inputs={
    successor_lineage_admission:lineage(),
    reliability_revision_inputs:revisionInputs,
    reliability_evaluation_inputs:evaluationInputs,
    successor_skill_evidence:successorEvidence,
    retention_plan:plan,retention_ledger:ledger,retention_receipts:retentionReceipts,
  };
  return {parent,parentEvidence,successor,successorEvidence,inputs};
}
function portability(s,e,{context='3',holdout='4',model='GPT_5_6_SOL',env='WINDOWS_BROWSER',ref='PORT_1'}={}){
  return createRsiSkillPortabilityReceipt({
    skill:s,evidence:e,target_model_family:model,target_environment_family:env,
    target_context_digest:d(context),target_holdout_digest:d(holdout),evaluator_root_digest:d('a'),
    outcome:'PORTABLE_VERIFIED',hard_invariants_pass:true,measured_delta:.1,evidence_refs:[ref],
    external_evaluator:true,authored_by_candidate:false,
  });
}

test('same-scope skill revision requires both contrastive reliability gain and mastery retention',()=>{
  const f=fixture();
  const admission=createRsiSkillRevisionAdmission(f.inputs);
  assert.equal(admission.reliable_behavior_improved,true);
  assert.equal(admission.potential_capability_preserved,true);
  assert.equal(admission.retention_gate_pass,true);
  assert.equal(admission.same_interface_required,true);
  assert.equal(admission.same_capability_set_required,true);
  assert.equal(admission.same_scope_revision_only,true);
  assert.equal(admission.scope_widening_allowed,false);
  assert.equal(admission.parent_replacement_automatic,false);
  assert.equal(admission.directly_admitted_to_library,false);
  assert.equal(admission.direct_activation_allowed,false);
  assert.equal(admission.authority_effect,false);
  assert.equal(verifyRsiSkillRevisionAdmission(admission,f.inputs).admission_digest,admission.admission_digest);
});

test('reliability-qualified revision with a mastery regression is rejected',()=>{
  const f=fixture({retentionRegression:true});
  assert.throws(()=>createRsiSkillRevisionAdmission(f.inputs),/retention_gate_failed/);
});

test('version two cannot enter lineage skill library without the revision gate and retained parent version',()=>{
  const f=fixture();
  const revisionAdmission=createRsiSkillRevisionAdmission(f.inputs);
  const receipts=[
    portability(f.successor,f.successorEvidence,{context:'3',holdout:'4',model:'GPT_5_6_SOL',env:'WINDOWS_BROWSER',ref:'PORT_A'}),
    portability(f.successor,f.successorEvidence,{context:'5',holdout:'6',model:'GLM_5',env:'LINUX_SANDBOX',ref:'PORT_B'}),
  ];
  const common={
    lineage_admission:lineage(),skill:f.successor,skill_evidence:f.successorEvidence,portability_receipts:receipts,
    library_id:'rsi.skill.library.revision',lifecycle_evidence:[],governance_id:'governance.revision.1',
    max_active_skills:4,exploration_slots:1,external_library_owner:true,authored_by_candidate:false,
  };
  assert.throws(()=>admitRsiLineageSkill({...common,existing_entries:[{capsule:f.parent,evidence:f.parentEvidence}]}),/revision_gate_required/);
  assert.throws(()=>admitRsiLineageSkill({
    ...common,existing_entries:[],
    skill_revision_admission:revisionAdmission,skill_revision_admission_inputs:f.inputs,
  }),/parent_version_missing/);

  const admitted=admitRsiLineageSkill({
    ...common,existing_entries:[{capsule:f.parent,evidence:f.parentEvidence}],
    skill_revision_admission:revisionAdmission,skill_revision_admission_inputs:f.inputs,
  });
  assert.equal(admitted.skill_version,2);
  assert.equal(admitted.skill_revision_admission_digest,revisionAdmission.admission_digest);
  assert.equal(admitted.revision_gate_required,true);
  assert.equal(admitted.revision_gate_verified,true);
  assert.equal(admitted.library.entries.some((row)=>row.skill_digest===f.parent.skill_digest),true);
  assert.equal(admitted.library.entries.some((row)=>row.skill_digest===f.successor.skill_digest),true);
  assert.equal(admitted.direct_activation_allowed,false);
});

test('revision successor must be sourced from the exact verified lineage candidate',()=>{
  const f=fixture();
  const forgedInputs={
    ...f.inputs,
    successor_lineage_admission:{...f.inputs.successor_lineage_admission,candidate_sha:sha('9')},
  };
  assert.throws(()=>createRsiSkillRevisionAdmission(forgedInputs),/digest_mismatch|successor_lineage_mismatch|admission_identity/);
});
