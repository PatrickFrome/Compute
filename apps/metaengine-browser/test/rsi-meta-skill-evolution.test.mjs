import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiSkillCapsule,
  createRsiSkillEvidence,
  createRsiVerifiedSkillLibrary,
} from '../src/rsi-verified-skill-library.mjs';
import {
  createRsiMetaSkillProfile,
  verifyRsiMetaSkillProfile,
  createRsiMetaSkillFastLoopSummary,
  verifyRsiMetaSkillFastLoopSummary,
  createRsiMetaSkillEvolutionPlan,
  verifyRsiMetaSkillEvolutionPlan,
  createRsiMetaSkillEvaluation,
  verifyRsiMetaSkillEvaluation,
  finalizeRsiMetaSkillEvolution,
  rsiMetaSkillEvolutionTrustRootSnapshot,
} from '../src/rsi-meta-skill-evolution.mjs';

const sha=(c)=>c.repeat(40);
const d=(c)=>`sha256:${c.repeat(64)}`;

const roles=[
  ['ANALYZER','ANALYZE_FAILURE_CODES'],
  ['RETRIEVER','SELECT_VERIFIED_MEMORY'],
  ['ALLOCATOR','ALLOCATE_PROPOSAL_BUDGET'],
  ['PROPOSER','PROPOSE_TYPED_TRANSFORM'],
  ['EVOLVER','SYNTHESIZE_STRUCTURED_PLAN'],
];

function skill(role,capability,version=1,char='1'){
  const capsule=createRsiSkillCapsule({
    skill_id:`skill.${role.toLowerCase()}.${version}.${char}`,
    version,
    source_candidate_sha:sha(char),
    role,
    input_schema_digest:d('1'),
    output_schema_digest:d('1'),
    implementation_digest:d(char),
    components:[{component_id:`${role.toLowerCase()}.component.${char}`,artifact_digest:d(char==='f'?'e':'f'),kind:'TYPED_TRANSFORM'}],
    capabilities:['READ_VERIFIED_CONTEXT',capability],
    max_context_tokens:1024,
    max_output_tokens:256,
    max_invocations:2,
    external_builder:true,
    authored_by_candidate:false,
  });
  const evidence=createRsiSkillEvidence({
    capsule,
    hidden_holdout_digest:d('a'),
    evaluator_root_digest:d('b'),
    unit_test_digest:d('c'),
    runtime_feedback_digest:d('d'),
    attempt_count:12,
    success_count:10,
    hard_invariants_pass:true,
    verified_for_library:true,
    evidence_refs:[`RUN_${role}_${version}_${char}`],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  return {capsule,evidence};
}

function libraryFixture(){
  const entries=[];
  const primary={};
  const alternate={};
  let index=1;
  for(const [role,capability] of roles){
    const char=String(index);
    const a=skill(role,capability,1,char);
    const b=skill(role,capability,1,String(index+5));
    entries.push(a,b);
    primary[role]=a.capsule;
    alternate[role]=b.capsule;
    index+=1;
  }
  const library=createRsiVerifiedSkillLibrary({
    library_id:'rsi.meta.skill.library.1',
    entries,
    external_library_owner:true,
    authored_by_candidate:false,
  });
  return {library,primary,alternate};
}

function bindings(skills){
  return Object.fromEntries(roles.map(([role])=>[role,{
    skill_id:skills[role].skill_id,
    skill_version:skills[role].skill_version,
    skill_digest:skills[role].skill_digest,
  }]));
}

function profile(library,skills,{
  id='meta.profile.1',
  generation=1,
  slow=1,
  fast=10,
  backbone='GPT_5_6_SOL',
}={}){
  return createRsiMetaSkillProfile({
    profile_id:id,
    library,
    profile_generation:generation,
    slow_meta_epoch:slow,
    fast_skill_epoch:fast,
    frozen_backbone_family:backbone,
    bindings:bindings(skills),
    external_profile_owner:true,
    authored_by_candidate:false,
  });
}

function summary(parent,library,{episodes=12}={}){
  return createRsiMetaSkillFastLoopSummary({
    profile:parent,
    library,
    fast_holdout_digest:d('8'),
    episode_count:episodes,
    helpful_count:8,
    harmful_count:1,
    neutral_count:2,
    insufficient_count:episodes-11,
    evidence_refs:['FAST_LOOP_RUN_100','FAST_LOOP_HOLDOUT_100'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
}

function setup(){
  const {library,primary,alternate}=libraryFixture();
  const parent=profile(library,primary);
  const successorSkills={...primary,ANALYZER:alternate.ANALYZER};
  const successor=profile(library,successorSkills,{id:'meta.profile.2',generation:2,slow:2,fast:11});
  const fast=summary(parent,library);
  const plan=createRsiMetaSkillEvolutionPlan({
    parent_profile:parent,
    successor_profile:successor,
    library,
    fast_loop_summary:fast,
    min_fast_episodes:8,
    meta_holdout_digest:d('9'),
    max_role_changes:1,
    external_meta_operator:true,
    authored_by_candidate:false,
  });
  return {library,primary,alternate,parent,successor,fast,plan};
}

test('meta profile binds exactly five verified roles to one frozen backbone without authority',()=>{
  const {library,parent}=setup();
  verifyRsiMetaSkillProfile(parent,library);
  assert.deepEqual(parent.roles,['ANALYZER','RETRIEVER','ALLOCATOR','PROPOSER','EVOLVER']);
  assert.equal(parent.two_timescale_profile,true);
  assert.equal(parent.backbone_mutable_by_profile,false);
  assert.equal(parent.candidate_can_bind_unverified_skill,false);
  assert.equal(parent.candidate_can_activate_profile,false);
  assert.equal(parent.execution_authority,false);
  assert.equal(parent.authority_effect,false);
});

test('fast-loop summary is external evidence only and cannot activate a slow meta update',()=>{
  const {library,parent,fast}=setup();
  verifyRsiMetaSkillFastLoopSummary(fast,parent,library);
  assert.equal(fast.fast_loop_evidence_only,true);
  assert.equal(fast.slow_meta_update_authority,false);
  assert.equal(fast.profile_activation_authority,false);
  assert.equal(fast.episode_count,12);
  assert.equal(fast.helpful_count+fast.harmful_count+fast.neutral_count+fast.insufficient_count,12);
  assert.equal(fast.authority_effect,false);
});

test('slow meta evolution requires enough fast episodes, distinct holdout, advanced generation and bounded role changes',()=>{
  const {library,parent,successor,fast,plan}=setup();
  verifyRsiMetaSkillEvolutionPlan(plan,parent,successor,library,fast);
  assert.deepEqual(plan.changed_roles,['ANALYZER']);
  assert.equal(plan.changed_role_count,1);
  assert.equal(plan.fast_and_slow_holdouts_separate,true);
  assert.notEqual(plan.fast_holdout_digest,plan.meta_holdout_digest);
  assert.equal(plan.same_frozen_backbone_required,true);
  assert.equal(plan.candidate_can_choose_meta_holdout,false);
  assert.equal(plan.candidate_can_activate_successor,false);
  assert.equal(plan.authority_effect,false);

  const tooShort=summary(parent,library,{episodes:11});
  assert.throws(()=>createRsiMetaSkillEvolutionPlan({
    parent_profile:parent,successor_profile:successor,library,fast_loop_summary:tooShort,
    min_fast_episodes:12,meta_holdout_digest:d('9'),max_role_changes:1,
    external_meta_operator:true,authored_by_candidate:false,
  }),/fast_evidence_insufficient/);

  assert.throws(()=>createRsiMetaSkillEvolutionPlan({
    parent_profile:parent,successor_profile:successor,library,fast_loop_summary:fast,
    min_fast_episodes:8,meta_holdout_digest:fast.fast_holdout_digest,max_role_changes:1,
    external_meta_operator:true,authored_by_candidate:false,
  }),/holdout_alias/);
});

test('slow meta evolution rejects backbone drift and multi-role confounding beyond policy bound',()=>{
  const {library,primary,alternate,parent,fast}=setup();
  const driftSkills={...primary,ANALYZER:alternate.ANALYZER};
  const drift=profile(library,driftSkills,{id:'meta.profile.drift',generation:2,slow:2,fast:11,backbone:'GLM_5'});
  assert.throws(()=>createRsiMetaSkillEvolutionPlan({
    parent_profile:parent,successor_profile:drift,library,fast_loop_summary:fast,
    min_fast_episodes:8,meta_holdout_digest:d('9'),max_role_changes:1,
    external_meta_operator:true,authored_by_candidate:false,
  }),/backbone_drift/);

  const twoChanges={...primary,ANALYZER:alternate.ANALYZER,RETRIEVER:alternate.RETRIEVER};
  const successor=profile(library,twoChanges,{id:'meta.profile.multi',generation:2,slow:2,fast:11});
  assert.throws(()=>createRsiMetaSkillEvolutionPlan({
    parent_profile:parent,successor_profile:successor,library,fast_loop_summary:fast,
    min_fast_episodes:8,meta_holdout_digest:d('9'),max_role_changes:1,
    external_meta_operator:true,authored_by_candidate:false,
  }),/role_change_count_invalid/);
});

test('external meta evaluation preserves Pareto tradeoffs instead of scalarizing them',()=>{
  const {library,parent,successor,fast,plan}=setup();
  const evaluation=createRsiMetaSkillEvaluation({
    plan,parent_profile:parent,successor_profile:successor,library,fast_loop_summary:fast,
    evaluator_root_digest:d('7'),
    objective_spec:[
      {metric:'task_success_rate',direction:'MAXIMIZE',materiality_threshold:0.01},
      {metric:'p95_latency_ms',direction:'MINIMIZE',materiality_threshold:1},
    ],
    parent_metrics:{task_success_rate:0.70,p95_latency_ms:100},
    successor_metrics:{task_success_rate:0.80,p95_latency_ms:110},
    hard_invariants_pass:true,
    evidence_refs:['META_EVAL_RUN_200','META_HOLDOUT_200'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  verifyRsiMetaSkillEvaluation(evaluation,plan,parent,successor,library,fast);
  assert.equal(evaluation.relation,'TRADEOFF_STEPPING_STONE');
  assert.equal(evaluation.better_objective_count,1);
  assert.equal(evaluation.worse_objective_count,1);
  assert.equal(evaluation.scalar_winner_authoritative,false);
  assert.equal(evaluation.evaluation_is_profile_activation_authority,false);
  assert.equal(evaluation.authority_effect,false);

  const result=finalizeRsiMetaSkillEvolution({
    plan,parent_profile:parent,successor_profile:successor,library,fast_loop_summary:fast,evaluation,
  });
  assert.equal(result.state,'ELIGIBLE_FOR_META_ARCHIVE');
  assert.equal(result.meta_archive_admission_is_promotion,false);
  assert.equal(result.successor_profile_activation_authorized,false);
  assert.equal(result.parent_profile_replacement_authorized,false);
  assert.equal(result.existing_rsi_tournament_still_required,true);
  assert.equal(result.existing_recursive_risk_gate_still_required,true);
  assert.equal(result.authority_effect,false);
});

test('hard invariant failure rejects a slow meta candidate regardless of quality metrics',()=>{
  const {library,parent,successor,fast,plan}=setup();
  const evaluation=createRsiMetaSkillEvaluation({
    plan,parent_profile:parent,successor_profile:successor,library,fast_loop_summary:fast,
    evaluator_root_digest:d('7'),
    objective_spec:[{metric:'task_success_rate',direction:'MAXIMIZE',materiality_threshold:0.01}],
    parent_metrics:{task_success_rate:0.50},
    successor_metrics:{task_success_rate:0.99},
    hard_invariants_pass:false,
    evidence_refs:['META_EVAL_RUN_201'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  assert.equal(evaluation.relation,'HARD_INVARIANT_REJECT');
  const result=finalizeRsiMetaSkillEvolution({
    plan,parent_profile:parent,successor_profile:successor,library,fast_loop_summary:fast,evaluation,
  });
  assert.equal(result.state,'REJECTED_FROM_META_ARCHIVE');
  assert.equal(result.eligible_for_meta_archive,false);
});

test('candidate-authored slow meta operator or evaluator cannot certify itself',()=>{
  const {library,parent,successor,fast,plan}=setup();
  assert.throws(()=>createRsiMetaSkillEvolutionPlan({
    parent_profile:parent,successor_profile:successor,library,fast_loop_summary:fast,
    min_fast_episodes:8,meta_holdout_digest:d('9'),max_role_changes:1,
    external_meta_operator:false,authored_by_candidate:true,
  }),/external_origin_required/);

  assert.throws(()=>createRsiMetaSkillEvaluation({
    plan,parent_profile:parent,successor_profile:successor,library,fast_loop_summary:fast,
    evaluator_root_digest:d('7'),
    objective_spec:[{metric:'task_success_rate',direction:'MAXIMIZE',materiality_threshold:0.01}],
    parent_metrics:{task_success_rate:0.7},
    successor_metrics:{task_success_rate:0.9},
    hard_invariants_pass:true,
    evidence_refs:['MODEL_SELF_REPORT'],
    external_evaluator:false,
    authored_by_candidate:true,
  }),/external_origin_required/);
});

test('meta-skill trust root captures two-timescale recursion without widening authority',()=>{
  const root=rsiMetaSkillEvolutionTrustRootSnapshot();
  assert.equal(root.mechanism,'TWO_TIMESCALE_VERIFIED_SKILL_AND_META_SKILL_EVOLUTION');
  assert.equal(root.fast_loop_target,'VERIFIED_TASK_SKILLS');
  assert.equal(root.slow_loop_target,'ANALYZER_RETRIEVER_ALLOCATOR_PROPOSER_EVOLVER_PROFILE');
  assert.equal(root.frozen_backbone_required,true);
  assert.equal(root.fast_and_slow_holdouts_separate,true);
  assert.equal(root.external_fast_summary_required,true);
  assert.equal(root.external_meta_operator_required,true);
  assert.equal(root.external_meta_evaluator_required,true);
  assert.equal(root.candidate_can_bind_unverified_skill,false);
  assert.equal(root.candidate_can_activate_successor,false);
  assert.equal(root.scalar_winner_authoritative,false);
  assert.equal(root.meta_skill_result_is_promotion_authority,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.meta_skill_root_digest,/^sha256:[0-9a-f]{64}$/);
});
