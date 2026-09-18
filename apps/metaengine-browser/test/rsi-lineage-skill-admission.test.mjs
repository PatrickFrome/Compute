import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiCladeNode,
} from '../src/rsi-clade-metaproductivity.mjs';
import {
  RSI_VERIFIED_LINEAGE_ADMISSION_SCHEMA,
} from '../src/rsi-verified-lineage-admission.mjs';
import {
  createRsiSkillCapsule,
  createRsiSkillEvidence,
  createRsiSkillPortabilityReceipt,
} from '../src/rsi-verified-skill-library.mjs';
import {
  createRsiSkillLifecycleEvidence,
} from '../src/rsi-skill-library-governance.mjs';
import {
  admitRsiLineageSkill,
  verifyRsiLineageSkillAdmission,
} from '../src/rsi-lineage-skill-admission.mjs';

const CANDIDATE='b'.repeat(40);
const CANDIDATE_ID=`candidate_sha256_${'c'.repeat(64)}`;
const d=(c)=>`sha256:${c.repeat(64)}`;

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
    candidate_id:CANDIDATE_ID,
    candidate_sha:CANDIDATE,
    parent_candidate_id:null,
    benchmark_solved:18,
    benchmark_total:20,
    evaluation_digest:d('6'),
    expansion_count:0,
    external_evaluator:true,
    authored_by_candidate:false,
  });
  const core={
    schema:RSI_VERIFIED_LINEAGE_ADMISSION_SCHEMA,
    version:1,
    candidate_id:CANDIDATE_ID,
    candidate_sha:CANDIDATE,
    parent_sha:'a'.repeat(40),
    parent_candidate_id:null,
    verified_evaluator_result_digest:d('1'),
    tournament_plan_id:'rsi_tournament_test',
    tournament_plan_digest:d('2'),
    tournament_result_digest:d('3'),
    archive_admission_digest:d('4'),
    archive_state:'PARETO_ELITE',
    archive_active:true,
    archive_snapshot_digest:d('5'),
    clade_node:clade,
    clade_node_digest:clade.node_digest,
    diverse_lineage_retention_required:true,
    scalar_rank_authoritative:false,
    non_elite_stepping_stones_may_remain_active:true,
    skill_distillation_research_eligible:true,
    direct_skill_library_admission_allowed:false,
    transfer_evidence_required_before_skill_library:true,
    lifecycle_governance_required_before_skill_activation:true,
    candidate_can_edit_archive:false,
    candidate_can_edit_clade_statistics:false,
    eligible_for_promotion:false,
    direct_promotion_enabled:false,
    direct_self_update_enabled:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return {...core,lineage_admission_digest:digest(core)};
}
function skill({source=CANDIDATE}={}){
  return createRsiSkillCapsule({
    skill_id:'skill.result.delivery.reconcile',
    version:1,
    parent_skill_digest:null,
    source_candidate_sha:source,
    role:'ANALYZER',
    input_schema_digest:d('7'),
    output_schema_digest:d('8'),
    implementation_digest:d('9'),
    components:[{component_id:'skill.result.delivery.reconcile.component',artifact_digest:d('a'),kind:'TYPED_TRANSFORM'}],
    capabilities:['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES'],
    max_context_tokens:2048,
    max_output_tokens:512,
    max_invocations:2,
    external_builder:true,
    authored_by_candidate:false,
  });
}
function evidence(s){
  return createRsiSkillEvidence({
    capsule:s,
    hidden_holdout_digest:d('b'),
    evaluator_root_digest:d('c'),
    unit_test_digest:d('d'),
    runtime_feedback_digest:d('e'),
    attempt_count:12,
    success_count:10,
    hard_invariants_pass:true,
    verified_for_library:true,
    evidence_refs:['SKILL_HOLDOUT','SKILL_RUNTIME'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
}
function portability(s,e,{context='1',holdout='2',model='GPT_5_6_SOL',env='WINDOWS_BROWSER',outcome='PORTABLE_VERIFIED',delta=0.08,ref='TRANSFER_1'}={}){
  return createRsiSkillPortabilityReceipt({
    skill:s,evidence:e,
    target_model_family:model,
    target_environment_family:env,
    target_context_digest:d(context),
    target_holdout_digest:d(holdout),
    evaluator_root_digest:d('f'),
    outcome,
    hard_invariants_pass:true,
    measured_delta:delta,
    evidence_refs:[ref],
    external_evaluator:true,
    authored_by_candidate:false,
  });
}
function portableSet(s,e){
  return [
    portability(s,e,{context:'1',holdout:'2',model:'GPT_5_6_SOL',env:'WINDOWS_BROWSER',ref:'TRANSFER_A'}),
    portability(s,e,{context:'3',holdout:'4',model:'GLM_5',env:'LINUX_SANDBOX',ref:'TRANSFER_B'}),
  ];
}
function admitBase({s=skill(),e=evidence(s),receipts=portableSet(s,e),lifecycle=[]}={}){
  return admitRsiLineageSkill({
    lineage_admission:lineage(),
    skill:s,
    skill_evidence:e,
    portability_receipts:receipts,
    library_id:'rsi.skill.library.lineage.1',
    existing_entries:[],
    lifecycle_evidence:lifecycle,
    governance_id:'governance.lineage.1',
    max_active_skills:4,
    exploration_slots:1,
    external_library_owner:true,
    authored_by_candidate:false,
  });
}

test('verified lineage skill enters append-only library only after independent cross-context transfer',()=>{
  const s=skill(),e=evidence(s),receipts=portableSet(s,e);
  const inputs={
    lineage_admission:lineage(),skill:s,skill_evidence:e,portability_receipts:receipts,
    library_id:'rsi.skill.library.lineage.1',existing_entries:[],lifecycle_evidence:[],
    governance_id:'governance.lineage.1',max_active_skills:4,exploration_slots:1,
    external_library_owner:true,authored_by_candidate:false,
  };
  const row=admitRsiLineageSkill(inputs);
  assert.equal(row.cross_context_transfer_verified,true);
  assert.equal(row.verified_transfer_context_count,2);
  assert.equal(row.verified_transfer_holdout_count,2);
  assert.equal(row.verified_transfer_family_count,2);
  assert.equal(row.negative_transfer_present,false);
  assert.equal(row.governance_state,'EXPLORATION_ACTIVE');
  assert.equal(row.active_for_composition,true);
  assert.equal(row.activation_view_created,false);
  assert.equal(row.direct_activation_allowed,false);
  assert.equal(row.skill_memory_is_execution_authority,false);
  assert.equal(row.eligible_for_promotion,false);
  assert.equal(verifyRsiLineageSkillAdmission(row,inputs).admission_digest,row.admission_digest);
});

test('negative transfer is a hard admission blocker and cannot be averaged away',()=>{
  const s=skill(),e=evidence(s);
  const receipts=[
    portability(s,e,{context:'1',holdout:'2',ref:'TRANSFER_POSITIVE'}),
    portability(s,e,{context:'3',holdout:'4',outcome:'NEGATIVE_TRANSFER',delta:-0.1,ref:'TRANSFER_NEGATIVE'}),
  ];
  assert.throws(()=>admitBase({s,e,receipts}),/negative_transfer_blocks_admission/);
});

test('duplicate target context or candidate-source drift fails before library admission',()=>{
  const s=skill(),e=evidence(s);
  const duplicated=[
    portability(s,e,{context:'1',holdout:'2',ref:'TRANSFER_1'}),
    portability(s,e,{context:'1',holdout:'3',model:'GLM_5',env:'LINUX_SANDBOX',ref:'TRANSFER_2'}),
  ];
  assert.throws(()=>admitBase({s,e,receipts:duplicated}),/transfer_diversity_insufficient/);

  const wrong=skill({source:'f'.repeat(40)}),wrongEvidence=evidence(wrong),wrongReceipts=portableSet(wrong,wrongEvidence);
  assert.throws(()=>admitBase({s:wrong,e:wrongEvidence,receipts:wrongReceipts}),/source_candidate_mismatch/);
});

test('post-admission harmful lifecycle evidence quarantines then retires without hard deletion',()=>{
  const s=skill(),e=evidence(s),receipts=portableSet(s,e);
  const first=admitBase({s,e,receipts});
  const library=first.library;
  const window1=createRsiSkillLifecycleEvidence({
    library,evidence_id:'lineage.skill.window.1',skill_digest:s.skill_digest,
    window_seq:1,generation_start:1,generation_end:1,
    invocation_count:6,helpful_count:1,harmful_count:4,neutral_count:1,insufficient_evidence_count:0,
    router_engagement_count:7,false_positive_injection_count:1,hard_invariant_violation_count:0,
    measured_net_delta:-0.08,authoring_prior:'VERIFIED_DIRECT_SKILL',authoring_provenance_digest:d('5'),
    evidence_refs:['LIFECYCLE_1'],external_evaluator:true,authored_by_candidate:false,
  });
  const quarantined=admitRsiLineageSkill({
    lineage_admission:lineage(),skill:s,skill_evidence:e,portability_receipts:receipts,
    library_id:'rsi.skill.library.lineage.1',existing_entries:[],lifecycle_evidence:[window1],
    governance_id:'governance.lineage.quarantine',max_active_skills:4,exploration_slots:1,
    external_library_owner:true,authored_by_candidate:false,
  });
  assert.equal(quarantined.governance_state,'QUARANTINED');
  assert.equal(quarantined.active_for_composition,false);

  const window2=createRsiSkillLifecycleEvidence({
    library,evidence_id:'lineage.skill.window.2',skill_digest:s.skill_digest,
    window_seq:2,generation_start:2,generation_end:2,
    invocation_count:6,helpful_count:0,harmful_count:5,neutral_count:1,insufficient_evidence_count:0,
    router_engagement_count:8,false_positive_injection_count:2,hard_invariant_violation_count:0,
    measured_net_delta:-0.09,authoring_prior:'VERIFIED_DIRECT_SKILL',authoring_provenance_digest:d('6'),
    evidence_refs:['LIFECYCLE_2'],external_evaluator:true,authored_by_candidate:false,
  });
  const retired=admitRsiLineageSkill({
    lineage_admission:lineage(),skill:s,skill_evidence:e,portability_receipts:receipts,
    library_id:'rsi.skill.library.lineage.1',existing_entries:[],lifecycle_evidence:[window1,window2],
    governance_id:'governance.lineage.retired',max_active_skills:4,exploration_slots:1,
    external_library_owner:true,authored_by_candidate:false,
  });
  assert.equal(retired.governance_state,'RETIRED');
  assert.equal(retired.active_for_composition,false);
  const governed=retired.governance.entries.find((row)=>row.skill_digest===s.skill_digest);
  assert.equal(governed.retained_in_evidence_archive,true);
  assert.equal(governed.hard_deleted,false);
  assert.equal(retired.retired_or_quarantined_reactivation_allowed,false);
});
