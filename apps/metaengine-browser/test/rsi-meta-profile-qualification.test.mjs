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
  RsiMetaProfileQualificationLedger,
  createRsiMetaProfileShadowPlan,
  createRsiMetaProfilePairReceipt,
  evaluateRsiMetaProfileShadow,
  verifyRsiMetaProfileShadowResult,
  createRsiMetaProfileStatisticalCertificate,
  verifyRsiMetaProfileStatisticalCertificate,
  createRsiMetaProfileQualification,
  rsiMetaProfileQualificationTrustRootSnapshot,
} from '../src/rsi-meta-profile-qualification.mjs';

const SOURCE='a'.repeat(40);
const d=(char)=>`sha256:${char.repeat(64)}`;

function skill({id,role,sourceChar,implChar}){
  const capsule=createRsiSkillCapsule({
    skill_id:id,version:1,parent_skill_digest:null,source_candidate_sha:sourceChar.repeat(40),
    role,input_schema_digest:d('1'),output_schema_digest:d('2'),implementation_digest:d(implChar),
    components:[{component_id:`${id}.component`,artifact_digest:d('f'),kind:'TYPED_TRANSFORM'}],
    capabilities:['READ_VERIFIED_CONTEXT'],max_context_tokens:2048,max_output_tokens:512,max_invocations:2,
    external_builder:true,authored_by_candidate:false,
  });
  const evidence=createRsiSkillEvidence({
    capsule,hidden_holdout_digest:d(sourceChar),evaluator_root_digest:d('4'),unit_test_digest:d('5'),
    runtime_feedback_digest:d('6'),attempt_count:20,success_count:18,hard_invariants_pass:true,
    verified_for_library:true,evidence_refs:[`VERIFY_${id}`],external_evaluator:true,authored_by_candidate:false,
  });
  return {capsule,evidence};
}
function binding(entry){return {skill_id:entry.capsule.skill_id,skill_version:entry.capsule.skill_version,skill_digest:entry.capsule.skill_digest}}

function fixture(){
  const analyzerA=skill({id:'meta.qual.analyzer.a',role:'ANALYZER',sourceChar:'b',implChar:'b'});
  const analyzerB=skill({id:'meta.qual.analyzer.b',role:'ANALYZER',sourceChar:'c',implChar:'c'});
  const retriever=skill({id:'meta.qual.retriever',role:'RETRIEVER',sourceChar:'d',implChar:'d'});
  const allocator=skill({id:'meta.qual.allocator',role:'ALLOCATOR',sourceChar:'e',implChar:'e'});
  const proposer=skill({id:'meta.qual.proposer',role:'PROPOSER',sourceChar:'f',implChar:'f'});
  const evolver=skill({id:'meta.qual.evolver',role:'EVOLVER',sourceChar:'9',implChar:'9'});
  const library=createRsiVerifiedSkillLibrary({
    library_id:'runtime.meta.profile.qualification.library',
    entries:[analyzerA,analyzerB,retriever,allocator,proposer,evolver],
    external_library_owner:true,authored_by_candidate:false,
  });
  const parent=createRsiMetaSkillProfile({
    profile_id:'meta.qual.profile.parent',library,profile_generation:1,slow_meta_epoch:1,fast_skill_epoch:20,
    frozen_backbone_family:'GPT_5_6_SOL',
    bindings:{
      ANALYZER:binding(analyzerA),RETRIEVER:binding(retriever),ALLOCATOR:binding(allocator),
      PROPOSER:binding(proposer),EVOLVER:binding(evolver),
    },
    external_profile_owner:true,authored_by_candidate:false,
  });
  const successor=createRsiMetaSkillProfile({
    profile_id:'meta.qual.profile.successor',library,profile_generation:2,slow_meta_epoch:2,fast_skill_epoch:20,
    frozen_backbone_family:'GPT_5_6_SOL',
    bindings:{
      ANALYZER:binding(analyzerB),RETRIEVER:binding(retriever),ALLOCATOR:binding(allocator),
      PROPOSER:binding(proposer),EVOLVER:binding(evolver),
    },
    external_profile_owner:true,authored_by_candidate:false,
  });
  const fast=createRsiMetaSkillFastLoopSummary({
    profile:parent,library,fast_holdout_digest:d('7'),episode_count:12,helpful_count:9,harmful_count:1,neutral_count:2,insufficient_count:0,
    evidence_refs:['meta:qual:fast'],external_evaluator:true,authored_by_candidate:false,
  });
  const metaPlan=createRsiMetaSkillEvolutionPlan({
    parent_profile:parent,successor_profile:successor,library,fast_loop_summary:fast,min_fast_episodes:8,
    meta_holdout_digest:d('8'),max_role_changes:1,external_meta_operator:true,authored_by_candidate:false,
  });
  const evaluation=createRsiMetaSkillEvaluation({
    plan:metaPlan,parent_profile:parent,successor_profile:successor,library,fast_loop_summary:fast,
    evaluator_root_digest:d('9'),
    objective_spec:[
      {metric:'task_success',direction:'MAXIMIZE',materiality_threshold:0.01},
      {metric:'latency_ms',direction:'MINIMIZE',materiality_threshold:1},
    ],
    parent_metrics:{task_success:0.70,latency_ms:110},
    successor_metrics:{task_success:0.76,latency_ms:100},
    hard_invariants_pass:true,evidence_refs:['meta:qual:slow'],
    external_evaluator:true,authored_by_candidate:false,
  });
  const result=finalizeRsiMetaSkillEvolution({plan:metaPlan,parent_profile:parent,successor_profile:successor,library,fast_loop_summary:fast,evaluation});
  const record=createRsiRuntimeMetaSkillRecord({
    source_sha:SOURCE,record_id:'meta.qual.record.1',library,parent_profile:parent,successor_profile:successor,
    fast_loop_summary:fast,plan:metaPlan,evaluation,result,external_archive_owner:true,authored_by_candidate:false,
  });
  return {library,parent,successor,fast,metaPlan,evaluation,result,record};
}

function shadowFixture(){
  const fx=fixture();
  const plan=createRsiMetaProfileShadowPlan({
    plan_id:'meta.qual.shadow.plan.1',meta_record:fx.record,activation_holdout_digest:d('a'),evaluator_root_digest:d('b'),
    external_plan_owner:true,authored_by_candidate:false,
  });
  const receipts=[];
  for(let i=0;i<plan.pair_count;i++){
    receipts.push(createRsiMetaProfilePairReceipt({
      plan,meta_record:fx.record,pair_index:i+1,order:plan.precommitted_order_schedule[i],seed:plan.precommitted_seed_schedule[i],
      parent_metrics:{task_success:0.70+(i%2)*0.01,latency_ms:110+(i%3)},
      successor_metrics:{task_success:0.77+(i%2)*0.01,latency_ms:98+(i%3)},
      hard_invariants_pass:true,evidence_digest:d(String((i%6)+1)),evidence_refs:[`meta:qual:pair:${i+1}`],
      external_evaluator:true,authored_by_candidate:false,
    }));
  }
  const shadow=evaluateRsiMetaProfileShadow({plan,meta_record:fx.record,receipts});
  const budget=createRsiRecursiveRiskBudget({
    budget_id:'rsi.meta-profile.activation.risk.v1',global_alpha:0.05,spending_policy:RSI_RISK_SPENDING_POLICIES.TELESCOPING_ANYTIME,
    evidence_family:'RSI_META_PROFILE_ACTIVATION',
  });
  const alpha=rsiRiskAllocationForConfirmation(budget,1);
  const certificate=createRsiMetaProfileStatisticalCertificate({
    certificate_id:'meta.qual.stat.cert.1',budget,confirmation_index:1,meta_record:fx.record,
    shadow_plan:plan,shadow_result:shadow,receipts,alpha_used:alpha,superiority_certified:true,
    sample_count:plan.pair_count,evidence_refs:['meta:qual:stat:1'],external_verifier:true,authored_by_candidate:false,
  });
  return {...fx,plan,receipts,shadow,budget,certificate};
}

test('meta-profile qualification requires independent paired shadow Pareto advance and recursive risk certificate',()=>{
  const fx=shadowFixture();
  verifyRsiMetaProfileShadowResult(fx.shadow,{plan:fx.plan,meta_record:fx.record,receipts:fx.receipts});
  verifyRsiMetaProfileStatisticalCertificate(fx.certificate,{
    budget:fx.budget,confirmation_index:1,meta_record:fx.record,shadow_plan:fx.plan,shadow_result:fx.shadow,receipts:fx.receipts,
  });
  const q=createRsiMetaProfileQualification({
    qualification_id:'meta.qual.final.1',meta_record:fx.record,shadow_plan:fx.plan,shadow_result:fx.shadow,
    receipts:fx.receipts,budget:fx.budget,certificate:fx.certificate,confirmation_index:1,
  });
  assert.equal(fx.shadow.relation,'PARETO_ADVANCE');
  assert.equal(q.state,'QUALIFIED_FOR_SHADOW_PROFILE_SELECTION');
  assert.equal(q.qualified_for_shadow_profile_selection,true);
  assert.equal(q.live_profile_activation_authorized,false);
  assert.equal(q.canary_activation_authorized,false);
  assert.equal(q.browser_authority,false);
  assert.equal(q.task_authority,false);
  assert.equal(q.authority_effect,false);
});

test('activation holdout cannot alias fast-loop or slow/meta holdout',()=>{
  const fx=fixture();
  for(const holdout of [fx.fast.fast_holdout_digest,fx.metaPlan.meta_holdout_digest]){
    assert.throws(()=>createRsiMetaProfileShadowPlan({
      plan_id:'meta.qual.alias.plan',meta_record:fx.record,activation_holdout_digest:holdout,evaluator_root_digest:d('b'),
      external_plan_owner:true,authored_by_candidate:false,
    }),/activation_holdout_alias/);
  }
});

test('tradeoff shadow result is not activation eligible',()=>{
  const fx=fixture();
  const plan=createRsiMetaProfileShadowPlan({
    plan_id:'meta.qual.tradeoff.plan',meta_record:fx.record,activation_holdout_digest:d('a'),evaluator_root_digest:d('b'),
    external_plan_owner:true,authored_by_candidate:false,
  });
  const receipts=[];
  for(let i=0;i<plan.pair_count;i++){
    receipts.push(createRsiMetaProfilePairReceipt({
      plan,meta_record:fx.record,pair_index:i+1,order:plan.precommitted_order_schedule[i],seed:plan.precommitted_seed_schedule[i],
      parent_metrics:{task_success:0.70,latency_ms:100},successor_metrics:{task_success:0.80,latency_ms:120},
      hard_invariants_pass:true,evidence_digest:d(String((i%6)+1)),evidence_refs:[`meta:tradeoff:pair:${i+1}`],
      external_evaluator:true,authored_by_candidate:false,
    }));
  }
  const shadow=evaluateRsiMetaProfileShadow({plan,meta_record:fx.record,receipts});
  assert.equal(shadow.relation,'TRADEOFF_STEPPING_STONE');
  assert.equal(shadow.eligible_for_statistical_confirmation,false);
});

test('candidate cannot choose pair count seed schedule or author receipts',()=>{
  const fx=shadowFixture();
  assert.equal(fx.plan.pair_count,7);
  assert.equal(fx.plan.candidate_can_choose_pair_count,false);
  assert.equal(fx.plan.candidate_can_choose_seed_schedule,false);
  assert.throws(()=>createRsiMetaProfilePairReceipt({
    plan:fx.plan,meta_record:fx.record,pair_index:1,order:fx.plan.precommitted_order_schedule[0],seed:fx.plan.precommitted_seed_schedule[0],
    parent_metrics:{task_success:0.7,latency_ms:100},successor_metrics:{task_success:0.8,latency_ms:90},
    hard_invariants_pass:true,evidence_digest:d('1'),evidence_refs:['meta:candidate:pair'],
    external_evaluator:false,authored_by_candidate:true,
  }),/external_evaluator_required/);
});

test('qualification ledger is source-fenced append-only and restart durable',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-meta-profile-qualification-'));
  try{
    const fx=shadowFixture();
    const q=createRsiMetaProfileQualification({
      qualification_id:'meta.qual.persist.1',meta_record:fx.record,shadow_plan:fx.plan,shadow_result:fx.shadow,
      receipts:fx.receipts,budget:fx.budget,certificate:fx.certificate,confirmation_index:1,
    });
    const statePath=path.join(root,'qual.json');
    const ledger=new RsiMetaProfileQualificationLedger({statePath,source_sha:SOURCE});
    await ledger.init();
    assert.equal((await ledger.add(q)).state,'QUALIFIED_FOR_SHADOW_PROFILE_SELECTION');
    assert.equal((await ledger.add(q)).state,'IDEMPOTENT');
    assert.equal(ledger.snapshot().qualified_count,1);
    assert.equal(ledger.snapshot().next_confirmation_index,2);
    assert.ok(ledger.snapshot().cumulative_alpha_spent>0);
    assert.ok(ledger.snapshot().cumulative_alpha_spent<=ledger.snapshot().global_alpha);
    assert.equal(ledger.snapshot().active_profile_digest,null);
    assert.equal(ledger.snapshot().shadow_profile_digest,null);
    assert.equal(ledger.qualified().length,1);

    const restored=new RsiMetaProfileQualificationLedger({statePath,source_sha:SOURCE});
    await restored.init();
    assert.equal(restored.snapshot().row_count,1);
    assert.equal(restored.snapshot().qualified_count,1);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('meta-profile qualification trust root is qualification-only and zero authority',()=>{
  const root=rsiMetaProfileQualificationTrustRootSnapshot();
  assert.equal(root.exact_meta_archive_record_required,true);
  assert.equal(root.source_sha_fencing_required,true);
  assert.equal(root.independent_activation_holdout_required,true);
  assert.equal(root.pair_count,7);
  assert.equal(root.early_stop_allowed,false);
  assert.equal(root.recursive_risk_budget_reused,true);
  assert.equal(root.confirmation_index_ledger_owned,true);
  assert.equal(root.cumulative_alpha_enforced,true);
  assert.equal(root.global_alpha,0.05);
  assert.equal(root.tradeoff_is_not_activation_eligible,true);
  assert.equal(root.qualification_only_for_shadow_profile_selection,true);
  assert.equal(root.live_profile_activation_authorized,false);
  assert.equal(root.browser_authority,false);
  assert.equal(root.task_authority,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.qualification_root_digest,/^sha256:[0-9a-f]{64}$/);
});
