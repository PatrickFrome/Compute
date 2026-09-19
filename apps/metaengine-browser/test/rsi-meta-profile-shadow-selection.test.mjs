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
import {
  createRsiSkillLifecycleEvidence,
  createRsiSkillLibraryGovernance,
} from '../src/rsi-skill-library-governance.mjs';
import {
  createRsiMetaSkillProfile,
  createRsiMetaSkillFastLoopSummary,
  createRsiMetaSkillEvolutionPlan,
  createRsiMetaSkillEvaluation,
  finalizeRsiMetaSkillEvolution,
} from '../src/rsi-meta-skill-evolution.mjs';
import { createRsiRuntimeMetaSkillRecord } from '../src/rsi-runtime-meta-skill-archive.mjs';
import {
  RSI_RISK_SPENDING_POLICIES,
  createRsiRecursiveRiskBudget,
  rsiRiskAllocationForConfirmation,
} from '../src/rsi-recursive-risk-budget.mjs';
import {
  createRsiMetaProfileShadowPlan,
  createRsiMetaProfilePairReceipt,
  evaluateRsiMetaProfileShadow,
  createRsiMetaProfileStatisticalCertificate,
  createRsiMetaProfileQualification,
} from '../src/rsi-meta-profile-qualification.mjs';
import {
  RsiMetaProfileShadowRegistry,
  createRsiMetaProfileShadowSelection,
  verifyRsiMetaProfileShadowSelection,
  createRsiMetaProfileShadowProjection,
  rsiMetaProfileShadowSelectionTrustRootSnapshot,
} from '../src/rsi-meta-profile-shadow-selection.mjs';

const SOURCE='a'.repeat(40);
const d=(char)=>`sha256:${char.repeat(64)}`;

function mkSkill({id,role,sourceChar,implChar}){
  const capsule=createRsiSkillCapsule({
    skill_id:id,version:1,parent_skill_digest:null,source_candidate_sha:sourceChar.repeat(40),
    role,input_schema_digest:d('1'),output_schema_digest:d('2'),implementation_digest:d(implChar),
    components:[{component_id:`${id}.component`,artifact_digest:d('f'),kind:'TYPED_TRANSFORM'}],
    capabilities:['READ_VERIFIED_CONTEXT'],max_context_tokens:2048,max_output_tokens:512,max_invocations:2,
    external_builder:true,authored_by_candidate:false,
  });
  const evidence=createRsiSkillEvidence({
    capsule,hidden_holdout_digest:d(sourceChar),evaluator_root_digest:d('4'),unit_test_digest:d('5'),
    runtime_feedback_digest:d('6'),attempt_count:16,success_count:15,hard_invariants_pass:true,
    verified_for_library:true,evidence_refs:[`VERIFY_${id}`],external_evaluator:true,authored_by_candidate:false,
  });
  return {capsule,evidence};
}
function binding(x){return {skill_id:x.capsule.skill_id,skill_version:x.capsule.skill_version,skill_digest:x.capsule.skill_digest}}

function qualifiedFixture(){
  const analyzerA=mkSkill({id:'shadow.analyzer.a',role:'ANALYZER',sourceChar:'b',implChar:'b'});
  const analyzerB=mkSkill({id:'shadow.analyzer.b',role:'ANALYZER',sourceChar:'c',implChar:'c'});
  const retriever=mkSkill({id:'shadow.retriever',role:'RETRIEVER',sourceChar:'d',implChar:'d'});
  const allocator=mkSkill({id:'shadow.allocator',role:'ALLOCATOR',sourceChar:'e',implChar:'e'});
  const proposer=mkSkill({id:'shadow.proposer',role:'PROPOSER',sourceChar:'f',implChar:'f'});
  const evolver=mkSkill({id:'shadow.evolver',role:'EVOLVER',sourceChar:'9',implChar:'9'});
  const entries=[analyzerA,analyzerB,retriever,allocator,proposer,evolver];
  const library=createRsiVerifiedSkillLibrary({
    library_id:'runtime.shadow.profile.library',entries,
    external_library_owner:true,authored_by_candidate:false,
  });
  const parent=createRsiMetaSkillProfile({
    profile_id:'shadow.profile.parent',library,profile_generation:1,slow_meta_epoch:1,fast_skill_epoch:3,
    frozen_backbone_family:'GPT_5_6_SOL',
    bindings:{ANALYZER:binding(analyzerA),RETRIEVER:binding(retriever),ALLOCATOR:binding(allocator),PROPOSER:binding(proposer),EVOLVER:binding(evolver)},
    external_profile_owner:true,authored_by_candidate:false,
  });
  const successor=createRsiMetaSkillProfile({
    profile_id:'shadow.profile.successor',library,profile_generation:2,slow_meta_epoch:2,fast_skill_epoch:3,
    frozen_backbone_family:'GPT_5_6_SOL',
    bindings:{ANALYZER:binding(analyzerB),RETRIEVER:binding(retriever),ALLOCATOR:binding(allocator),PROPOSER:binding(proposer),EVOLVER:binding(evolver)},
    external_profile_owner:true,authored_by_candidate:false,
  });
  const fast=createRsiMetaSkillFastLoopSummary({
    profile:parent,library,fast_holdout_digest:d('7'),episode_count:12,helpful_count:9,harmful_count:1,neutral_count:2,insufficient_count:0,
    evidence_refs:['shadow:fast'],external_evaluator:true,authored_by_candidate:false,
  });
  const metaPlan=createRsiMetaSkillEvolutionPlan({
    parent_profile:parent,successor_profile:successor,library,fast_loop_summary:fast,min_fast_episodes:8,
    meta_holdout_digest:d('8'),max_role_changes:1,external_meta_operator:true,authored_by_candidate:false,
  });
  const metaEval=createRsiMetaSkillEvaluation({
    plan:metaPlan,parent_profile:parent,successor_profile:successor,library,fast_loop_summary:fast,evaluator_root_digest:d('9'),
    objective_spec:[
      {metric:'task_success',direction:'MAXIMIZE',materiality_threshold:0.01},
      {metric:'latency_ms',direction:'MINIMIZE',materiality_threshold:1},
    ],
    parent_metrics:{task_success:0.70,latency_ms:110},successor_metrics:{task_success:0.77,latency_ms:100},
    hard_invariants_pass:true,evidence_refs:['shadow:meta-eval'],external_evaluator:true,authored_by_candidate:false,
  });
  const metaResult=finalizeRsiMetaSkillEvolution({
    plan:metaPlan,parent_profile:parent,successor_profile:successor,library,fast_loop_summary:fast,evaluation:metaEval,
  });
  const record=createRsiRuntimeMetaSkillRecord({
    source_sha:SOURCE,record_id:'shadow.meta.record.1',library,parent_profile:parent,successor_profile:successor,
    fast_loop_summary:fast,plan:metaPlan,evaluation:metaEval,result:metaResult,external_archive_owner:true,authored_by_candidate:false,
  });

  const shadowPlan=createRsiMetaProfileShadowPlan({
    plan_id:'shadow.qual.plan.1',meta_record:record,activation_holdout_digest:d('a'),evaluator_root_digest:d('b'),
    external_plan_owner:true,authored_by_candidate:false,
  });
  const receipts=[];
  for(let i=0;i<shadowPlan.pair_count;i++){
    receipts.push(createRsiMetaProfilePairReceipt({
      plan:shadowPlan,meta_record:record,pair_index:i+1,order:shadowPlan.precommitted_order_schedule[i],seed:shadowPlan.precommitted_seed_schedule[i],
      parent_metrics:{task_success:0.70,latency_ms:110},successor_metrics:{task_success:0.79,latency_ms:96},
      hard_invariants_pass:true,evidence_digest:d(String((i%6)+1)),evidence_refs:[`shadow:pair:${i+1}`],
      external_evaluator:true,authored_by_candidate:false,
    }));
  }
  const shadowResult=evaluateRsiMetaProfileShadow({plan:shadowPlan,meta_record:record,receipts});
  const budget=createRsiRecursiveRiskBudget({
    budget_id:'rsi.meta-profile.activation.risk.v1',global_alpha:0.05,
    spending_policy:RSI_RISK_SPENDING_POLICIES.TELESCOPING_ANYTIME,
    evidence_family:'RSI_META_PROFILE_ACTIVATION',
  });
  const certificate=createRsiMetaProfileStatisticalCertificate({
    certificate_id:'shadow.qual.cert.1',budget,confirmation_index:1,meta_record:record,shadow_plan:shadowPlan,
    shadow_result:shadowResult,receipts,alpha_used:rsiRiskAllocationForConfirmation(budget,1),
    superiority_certified:true,sample_count:shadowPlan.pair_count,evidence_refs:['shadow:stat'],
    external_verifier:true,authored_by_candidate:false,
  });
  const qualification=createRsiMetaProfileQualification({
    qualification_id:'shadow.qual.final.1',meta_record:record,shadow_plan:shadowPlan,shadow_result:shadowResult,
    receipts,budget,certificate,confirmation_index:1,
  });
  const governance=createRsiSkillLibraryGovernance({
    governance_id:'shadow.profile.governance.1',library,lifecycle_evidence:[],
    max_active_skills:8,exploration_slots:8,external_library_owner:true,authored_by_candidate:false,
  });
  return {entries,analyzerA,analyzerB,library,parent,successor,record,qualification,governance};
}

test('qualified profile can enter only the shadow slot against the exact current library',()=>{
  const fx=qualifiedFixture();
  const selection=createRsiMetaProfileShadowSelection({
    selection_id:'shadow.selection.1',qualification:fx.qualification,meta_record:fx.record,current_library:fx.library,
    external_selector:true,authored_by_candidate:false,
  });
  verifyRsiMetaProfileShadowSelection(selection,{qualification:fx.qualification,meta_record:fx.record,current_library:fx.library});
  assert.equal(selection.mode,'SHADOW_ONLY');
  assert.equal(selection.incumbent_profile_digest,fx.parent.profile_digest);
  assert.equal(selection.challenger_profile_digest,fx.successor.profile_digest);
  assert.equal(selection.selection_can_change_execution,false);
  assert.equal(selection.selection_can_replace_incumbent,false);
  assert.equal(selection.canary_gate_still_required,true);
  assert.equal(selection.authority_effect,false);
});

test('library drift invalidates shadow selection until explicit requalification',()=>{
  const fx=qualifiedFixture();
  const extra=mkSkill({id:'shadow.extra',role:'ANALYZER',sourceChar:'6',implChar:'6'});
  const drifted=createRsiVerifiedSkillLibrary({
    library_id:fx.library.library_id,
    entries:[...fx.entries,extra],
    external_library_owner:true,authored_by_candidate:false,
  });
  assert.throws(()=>createRsiMetaProfileShadowSelection({
    selection_id:'shadow.selection.drift',qualification:fx.qualification,meta_record:fx.record,current_library:drifted,
    external_selector:true,authored_by_candidate:false,
  }),/library_drift_requires_requalification/);
});

test('shadow projection blocks a dormant challenger without modifying baseline execution selection',()=>{
  const fx=qualifiedFixture();
  const selection=createRsiMetaProfileShadowSelection({
    selection_id:'shadow.selection.projection.dormant',qualification:fx.qualification,meta_record:fx.record,current_library:fx.library,
    external_selector:true,authored_by_candidate:false,
  });
  const baseline=[fx.analyzerA.capsule.skill_digest];
  const projection=createRsiMetaProfileShadowProjection({
    selection,qualification:fx.qualification,meta_record:fx.record,current_library:fx.library,governance:fx.governance,
    context_digest:d('c'),required_role:'ANALYZER',baseline_plan_digest:d('d'),baseline_selected_skill_digests:baseline,
  });
  assert.equal(projection.status,'BLOCKED_BY_GOVERNANCE');
  assert.equal(projection.challenger_skill_digest,fx.analyzerB.capsule.skill_digest);
  assert.equal(projection.challenger_skill_governance_state,'DORMANT_CAP');
  assert.deepEqual(projection.baseline_selected_skill_digests,baseline);
  assert.equal(projection.baseline_execution_path_unchanged,true);
  assert.equal(projection.projection_can_add_skill_to_execution,false);
  assert.equal(projection.projection_can_override_governance,false);
  assert.equal(projection.authority_effect,false);
});

test('shadow projection reports divergence for an explicitly governance-active challenger without modifying baseline execution selection',()=>{
  const fx=qualifiedFixture();
  const lifecycle=createRsiSkillLifecycleEvidence({
    library:fx.library,
    evidence_id:'shadow.lifecycle.analyzer-b.1',
    skill_digest:fx.analyzerB.capsule.skill_digest,
    window_seq:1,
    generation_start:1,
    generation_end:1,
    invocation_count:1,
    helpful_count:1,
    harmful_count:0,
    neutral_count:0,
    insufficient_evidence_count:0,
    router_engagement_count:1,
    false_positive_injection_count:0,
    hard_invariant_violation_count:0,
    measured_net_delta:0.5,
    authoring_prior:'VERIFIED_DIRECT_SKILL',
    authoring_provenance_digest:d('e'),
    evidence_refs:['shadow:lifecycle:analyzer-b:1'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  const activeGovernance=createRsiSkillLibraryGovernance({
    governance_id:'shadow.profile.governance.active-analyzer-b',
    library:fx.library,
    lifecycle_evidence:[lifecycle],
    max_active_skills:8,
    exploration_slots:8,
    external_library_owner:true,
    authored_by_candidate:false,
  });
  const selection=createRsiMetaProfileShadowSelection({
    selection_id:'shadow.selection.projection.active',qualification:fx.qualification,meta_record:fx.record,current_library:fx.library,
    external_selector:true,authored_by_candidate:false,
  });
  const baseline=[fx.analyzerA.capsule.skill_digest];
  const projection=createRsiMetaProfileShadowProjection({
    selection,qualification:fx.qualification,meta_record:fx.record,current_library:fx.library,governance:activeGovernance,
    context_digest:d('c'),required_role:'ANALYZER',baseline_plan_digest:d('d'),baseline_selected_skill_digests:baseline,
  });
  assert.equal(projection.status,'SHADOW_DIVERGENCE');
  assert.equal(projection.challenger_skill_digest,fx.analyzerB.capsule.skill_digest);
  assert.equal(projection.challenger_skill_governance_state,'EXPLORATION_ACTIVE');
  assert.deepEqual(projection.baseline_selected_skill_digests,baseline);
  assert.equal(projection.baseline_execution_path_unchanged,true);
  assert.equal(projection.projection_can_add_skill_to_execution,false);
  assert.equal(projection.projection_can_override_governance,false);
  assert.equal(projection.authority_effect,false);
});

test('non-meta runtime role produces no challenger recommendation',()=>{
  const fx=qualifiedFixture();
  const selection=createRsiMetaProfileShadowSelection({
    selection_id:'shadow.selection.nonmeta',qualification:fx.qualification,meta_record:fx.record,current_library:fx.library,
    external_selector:true,authored_by_candidate:false,
  });
  const projection=createRsiMetaProfileShadowProjection({
    selection,qualification:fx.qualification,meta_record:fx.record,current_library:fx.library,governance:fx.governance,
    context_digest:d('c'),required_role:'IMPLEMENTER',baseline_plan_digest:d('d'),baseline_selected_skill_digests:[],
  });
  assert.equal(projection.status,'NO_APPLICABLE_META_ROLE');
  assert.equal(projection.challenger_skill_digest,null);
  assert.equal(projection.projection_can_add_skill_to_execution,false);
});

test('shadow registry is append-only restart durable and never activates a profile',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-shadow-profile-'));
  try{
    const fx=qualifiedFixture();
    const selection=createRsiMetaProfileShadowSelection({
      selection_id:'shadow.selection.persist',qualification:fx.qualification,meta_record:fx.record,current_library:fx.library,
      external_selector:true,authored_by_candidate:false,
    });
    const statePath=path.join(root,'shadow.json');
    const registry=new RsiMetaProfileShadowRegistry({statePath,source_sha:SOURCE});
    await registry.init();
    assert.equal((await registry.select(selection)).state,'SHADOW_SELECTED');
    assert.equal((await registry.select(selection)).state,'IDEMPOTENT');
    assert.equal(registry.snapshot().selection_count,1);
    assert.equal(registry.snapshot().current_challenger_profile_digest,fx.successor.profile_digest);
    assert.equal(registry.snapshot().registry_can_activate_profile,false);

    const restored=new RsiMetaProfileShadowRegistry({statePath,source_sha:SOURCE});
    await restored.init();
    assert.equal(restored.snapshot().selection_count,1);
    assert.equal(restored.current().selection_digest,selection.selection_digest);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('shadow selection trust root keeps champion execution unchanged',()=>{
  const root=rsiMetaProfileShadowSelectionTrustRootSnapshot();
  assert.equal(root.exact_qualification_required,true);
  assert.equal(root.current_library_drift_requires_requalification,true);
  assert.equal(root.external_selector_required,true);
  assert.equal(root.candidate_can_select_profile,false);
  assert.equal(root.shadow_only,true);
  assert.equal(root.baseline_execution_path_unchanged,true);
  assert.equal(root.projection_can_add_skill_to_execution,false);
  assert.equal(root.projection_can_override_governance,false);
  assert.equal(root.registry_can_activate_profile,false);
  assert.equal(root.canary_gate_still_required,true);
  assert.equal(root.continuous_shadow_review_required,true);
  assert.equal(root.authority_effect,false);
  assert.match(root.shadow_selection_root_digest,/^sha256:[0-9a-f]{64}$/);
});
