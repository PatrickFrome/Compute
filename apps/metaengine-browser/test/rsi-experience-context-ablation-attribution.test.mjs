import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainWorkingMemory } from '../src/browser-brain-working-memory.mjs';
import { RsiShadowObserver } from '../src/rsi-shadow-observer.mjs';
import { buildRsiExperimentHypothesis } from '../src/supervisor-rsi-experiment-hypothesis.mjs';
import { buildRsiDevosExperimentPlan } from '../src/rsi-devos-experiment-plan.mjs';
import { createRsiSearchContext } from '../src/rsi-search-mode-router.mjs';
import {
  createRsiExperienceCase,
  createRsiExperienceGraphSnapshot,
} from '../src/rsi-experience-graph.mjs';
import { createRsiExperienceContextPlan } from '../src/rsi-experience-context-planner.mjs';
import { createRsiAutonomousEpisodePlan } from '../src/rsi-autonomous-episode-controller.mjs';
import {
  createRsiExperienceContextAttributionPlan,
  verifyRsiExperienceContextAttributionPlan,
  createRsiExperienceContextAblationReceipt,
  verifyRsiExperienceContextAblationReceipt,
  finalizeRsiExperienceContextAttribution,
  verifyRsiExperienceContextAttributionResult,
  rsiExperienceContextAttributionTrustRootSnapshot,
} from '../src/rsi-experience-context-ablation-attribution.mjs';

const SOURCE='a0af13c0640fffb4b6d5da1645220e32786b5ec0';
const TAB='tab_00000000-0000-4000-8000-000000000001';
const d=(c)=>'sha256:'+c.repeat(64);
const cid=(c)=>'candidate_sha256_'+c.repeat(64);

function observation(){
  const memory=new BrowserBrainWorkingMemory({maxEvents:64,maxCells:8,clock:()=>1_800_000_000_000});
  memory.rememberBinding({
    valid:true,tab_id:TAB,binding_generation:1,web_contents_id:7,renderer_pid:77,
    renderer_process_key:'77:1234',target_id:'target-7',document_generation:1,semantic_revision:1,
  });
  memory.rememberCommandOutcome({
    command_id:'cmd-ambiguous-memory-attribution-1',action:'TYPE',tab_id:TAB,
    status:'AMBIGUOUS',effect_outcome:'AMBIGUOUS',recorded_at:'2027-01-15T08:01:00.000Z',
  });
  return new RsiShadowObserver({
    source_sha:SOURCE,clock:()=>1_800_000_001_000,
  }).observeBrainSnapshot(memory.snapshot());
}

function searchContext(){
  return createRsiSearchContext({
    context_id:'rsi-context-memory-attribution-1',
    mutation_surface:'BROWSER_RUNTIME',
    problem_class:'AMBIGUITY_RECONCILIATION',
    budget_class:'NORMAL',
    skeleton_available:false,trace_history_available:true,lineage_candidate_count:2,
    failure_class:'TRANSPORT_AMBIGUITY',novelty_pressure:0.35,
    external_context_owner:true,authored_by_candidate:false,
  });
}

function fixture(){
  const obs=observation();
  const opportunity=obs.opportunities.find(row=>row.signal==='AMBIGUOUS_COMMAND_OUTCOMES');
  const hypothesis=buildRsiExperimentHypothesis({observation:obs,opportunity_id:opportunity.opportunity_id});
  const devos=buildRsiDevosExperimentPlan({observation:obs,opportunity_id:opportunity.opportunity_id,hypothesis});
  const frontier={
    opportunity_id:opportunity.opportunity_id,signal:opportunity.signal,priority:opportunity.priority,
    mutation_surface:opportunity.mutation_surface,observation_digest:obs.observation_digest,hypothesis,plan:devos,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,
    self_update_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  const anchor={
    task_id:'memory.attribution.history.1',task_signature_digest:d('1'),
    challenge_family:'BROWSER_RUNTIME',hidden_manifest_digest:d('2'),
    external_writer:true,authored_by_candidate:false,
  };
  const cases=[
    createRsiExperienceCase({
      case_id:'rsi_case_attribution_helpful',task_id:anchor.task_id,task_signature_digest:anchor.task_signature_digest,
      attempt_index:1,candidate_id:cid('b'),candidate_sha:'b'.repeat(40),outcome:'SUCCESS',
      environment_fingerprint:'metaengine.browser.runtime',model_family:'METAENGINE_RSI',
      execution_signature_digest:d('3'),failure_codes:[],
      mechanism_tags:['AMBIGUOUS_COMMAND_OUTCOMES','BROWSER_RUNTIME'],lesson_digests:[d('4')],
      attribution_digests:[d('5')],transfer_receipt_digests:[],evidence_digest:d('6'),
      evidence_refs:['evidence:attribution-helpful'],external_writer:true,authored_by_candidate:false,
    }),
    createRsiExperienceCase({
      case_id:'rsi_case_attribution_harmful',task_id:anchor.task_id,task_signature_digest:anchor.task_signature_digest,
      attempt_index:2,candidate_id:cid('c'),candidate_sha:'c'.repeat(40),outcome:'SUCCESS',
      environment_fingerprint:'metaengine.browser.runtime',model_family:'METAENGINE_RSI',
      execution_signature_digest:d('7'),failure_codes:[],
      mechanism_tags:['AMBIGUOUS_COMMAND_OUTCOMES','BROWSER_RUNTIME'],lesson_digests:[d('8')],
      attribution_digests:[d('9')],transfer_receipt_digests:[],evidence_digest:d('a'),
      evidence_refs:['evidence:attribution-harmful'],external_writer:true,authored_by_candidate:false,
    }),
  ];
  const graph=createRsiExperienceGraphSnapshot({
    graph_id:'rsi.runtime.experience.'+SOURCE.slice(0,16),
    epoch:1,task_anchors:[anchor],cases,
  });
  const context=createRsiExperienceContextPlan({
    frontier_entry:frontier,experience_graph_snapshot:graph,
    bridge_case_ids:cases.map(x=>x.case_id),
  });
  const controller=createRsiAutonomousEpisodePlan({
    observation:obs,opportunity_id:opportunity.opportunity_id,
    search_context:searchContext(),experience_context_plan:context,
  });
  const plan=createRsiExperienceContextAttributionPlan({
    experience_context_plan:context,autonomous_controller_plan:controller,
    evaluation_protocol_digest:d('b'),
    objective_spec:[
      {metric:'TASK_SUCCESS',direction:'HIGHER_BETTER',epsilon:0.01},
      {metric:'P95_LATENCY_MS',direction:'LOWER_BETTER',epsilon:2},
    ],
    external_planner:true,authored_by_candidate:false,
  });
  return {obs,opportunity,graph,context,controller,plan};
}

function receipt(plan,ablation,{kind='HELPFUL',seed='c'}={}){
  const baseline=[
    {metric:'TASK_SUCCESS',value:0.80},
    {metric:'P95_LATENCY_MS',value:100},
  ];
  let ablated;
  if(kind==='HELPFUL'){
    ablated=[
      {metric:'TASK_SUCCESS',value:0.70},
      {metric:'P95_LATENCY_MS',value:112},
    ];
  }else if(kind==='HARMFUL'){
    ablated=[
      {metric:'TASK_SUCCESS',value:0.88},
      {metric:'P95_LATENCY_MS',value:88},
    ];
  }else if(kind==='AMBIGUOUS'){
    ablated=[
      {metric:'TASK_SUCCESS',value:0.70},
      {metric:'P95_LATENCY_MS',value:85},
    ];
  }else{
    ablated=[
      {metric:'TASK_SUCCESS',value:0.805},
      {metric:'P95_LATENCY_MS',value:101},
    ];
  }
  return createRsiExperienceContextAblationReceipt({
    plan,ablation_id:ablation.ablation_id,
    baseline_hard_invariants_pass:true,ablated_hard_invariants_pass:true,
    baseline_objectives:baseline,ablated_objectives:ablated,
    workload_digest:d('d'),seed_set_digest:d('e'),budget_digest:d('f'),
    evaluator_id:'external-memory-ablation-evaluator-v1',
    evidence_digest:d(seed),evidence_refs:['eval:memory-ablation-'+seed],
    external_evaluator:true,authored_by_candidate:false,
  });
}

test('attribution plan ablates every selected memory exactly once under matched evaluation',()=>{
  const {context,controller,plan}=fixture();
  verifyRsiExperienceContextAttributionPlan(plan);
  assert.equal(plan.selected_case_count,context.selected_case_count);
  assert.equal(plan.ablation_count,context.selected_case_count);
  assert.equal(new Set(plan.ablations.map(x=>x.removed_case_id)).size,context.selected_case_count);
  assert.ok(plan.ablations.every(x=>x.retained_case_count===context.selected_case_count-1));
  assert.equal(plan.causal_claim_scope,'MATCHED_SINGLE_MEMORY_ABLATION');
  assert.equal(plan.interaction_claims_require_separate_evidence,true);
  assert.equal(plan.candidate_can_select_memory_for_attribution,false);
  assert.equal(plan.controller_plan_digest,controller.controller_plan_digest);
});

test('matched leave-one-memory-out receipts distinguish helpful and harmful context',()=>{
  const {plan}=fixture();
  const helpful=receipt(plan,plan.ablations[0],{kind:'HELPFUL',seed:'c'});
  const harmful=receipt(plan,plan.ablations[1],{kind:'HARMFUL',seed:'d'});
  verifyRsiExperienceContextAblationReceipt(helpful,plan);
  verifyRsiExperienceContextAblationReceipt(harmful,plan);
  assert.equal(helpful.outcome,'HELPFUL');
  assert.equal(helpful.pareto_relation,'BASELINE_PARETO_DOMINATES_ABLATION');
  assert.equal(harmful.outcome,'HARMFUL');
  assert.equal(harmful.pareto_relation,'ABLATION_PARETO_DOMINATES_BASELINE');

  const result=finalizeRsiExperienceContextAttribution({plan,receipts:[helpful,harmful]});
  verifyRsiExperienceContextAttributionResult(result);
  assert.equal(result.state,'ATTRIBUTION_READY');
  assert.equal(result.utility_judgment_count,2);
  assert.equal(result.eligible_for_context_utility_feedback,true);
  assert.equal(result.attribution_is_skill_evidence,false);
  assert.equal(result.utility_judgments.find(x=>x.case_id===helpful.removed_case_id).outcome,'HELPFUL');
  assert.equal(result.utility_judgments.find(x=>x.case_id===harmful.removed_case_id).outcome,'HARMFUL');
});

test('hard-invariant failure after removing a memory makes that memory HELPFUL',()=>{
  const {plan}=fixture();
  const ablation=plan.ablations[0];
  const row=createRsiExperienceContextAblationReceipt({
    plan,ablation_id:ablation.ablation_id,
    baseline_hard_invariants_pass:true,ablated_hard_invariants_pass:false,
    baseline_objectives:[
      {metric:'TASK_SUCCESS',value:0.80},{metric:'P95_LATENCY_MS',value:100},
    ],
    ablated_objectives:[
      {metric:'TASK_SUCCESS',value:0.95},{metric:'P95_LATENCY_MS',value:80},
    ],
    workload_digest:d('d'),seed_set_digest:d('e'),budget_digest:d('f'),
    evaluator_id:'external-memory-ablation-evaluator-v1',
    evidence_digest:d('c'),evidence_refs:['eval:hard-invariant-ablation'],
    external_evaluator:true,authored_by_candidate:false,
  });
  assert.equal(row.outcome,'HELPFUL');
  assert.equal(row.pareto_relation,'BASELINE_DOMINATES_BY_HARD_INVARIANT');
});

test('objective tradeoff is held as ambiguous and cannot emit contextual utility judgments',()=>{
  const {plan}=fixture();
  const ambiguous=receipt(plan,plan.ablations[0],{kind:'AMBIGUOUS',seed:'c'});
  const neutral=receipt(plan,plan.ablations[1],{kind:'NEUTRAL',seed:'d'});
  const result=finalizeRsiExperienceContextAttribution({plan,receipts:[ambiguous,neutral]});
  verifyRsiExperienceContextAttributionResult(result);
  assert.equal(result.state,'AMBIGUOUS_INTERACTIONS_HOLD');
  assert.equal(result.ambiguous_interactions_present,true);
  assert.equal(result.eligible_for_context_utility_feedback,false);
  assert.equal(result.utility_judgment_count,0);
});

test('receipts must share workload, seeds, budget, evaluator and exact baseline',()=>{
  const {plan}=fixture();
  const first=receipt(plan,plan.ablations[0],{kind:'HELPFUL',seed:'c'});
  const second=receipt(plan,plan.ablations[1],{kind:'HARMFUL',seed:'d'});
  const drift=createRsiExperienceContextAblationReceipt({
    plan,ablation_id:plan.ablations[1].ablation_id,
    baseline_hard_invariants_pass:true,ablated_hard_invariants_pass:true,
    baseline_objectives:[
      {metric:'TASK_SUCCESS',value:0.81},{metric:'P95_LATENCY_MS',value:100},
    ],
    ablated_objectives:[
      {metric:'TASK_SUCCESS',value:0.88},{metric:'P95_LATENCY_MS',value:88},
    ],
    workload_digest:d('d'),seed_set_digest:d('e'),budget_digest:d('f'),
    evaluator_id:'external-memory-ablation-evaluator-v1',
    evidence_digest:d('d'),evidence_refs:['eval:baseline-drift'],
    external_evaluator:true,authored_by_candidate:false,
  });
  assert.throws(()=>finalizeRsiExperienceContextAttribution({plan,receipts:[first,drift]}),/matched_evaluation_contract_mismatch/);

  const seedDrift=createRsiExperienceContextAblationReceipt({
    plan,ablation_id:plan.ablations[1].ablation_id,
    baseline_hard_invariants_pass:true,ablated_hard_invariants_pass:true,
    baseline_objectives:second.baseline_objectives,ablated_objectives:second.ablated_objectives,
    workload_digest:d('d'),seed_set_digest:d('1'),budget_digest:d('f'),
    evaluator_id:'external-memory-ablation-evaluator-v1',
    evidence_digest:d('d'),evidence_refs:['eval:seed-drift'],
    external_evaluator:true,authored_by_candidate:false,
  });
  assert.throws(()=>finalizeRsiExperienceContextAttribution({plan,receipts:[first,seedDrift]}),/matched_evaluation_contract_mismatch/);
});

test('candidate cannot author attribution and attribution never becomes skill or control authority',()=>{
  const {context,controller}=fixture();
  assert.throws(()=>createRsiExperienceContextAttributionPlan({
    experience_context_plan:context,autonomous_controller_plan:controller,
    evaluation_protocol_digest:d('b'),
    objective_spec:[{metric:'TASK_SUCCESS',direction:'HIGHER_BETTER',epsilon:0.01}],
    external_planner:true,authored_by_candidate:true,
  }),/external_planner_required/);

  const root=rsiExperienceContextAttributionTrustRootSnapshot();
  assert.equal(root.all_selected_cases_attributed,true);
  assert.equal(root.matched_single_memory_ablation,true);
  assert.equal(root.matched_workload_seed_budget_evaluator_required,true);
  assert.equal(root.interaction_claims_require_separate_evidence,true);
  assert.equal(root.ambiguous_interactions_block_utility_feedback,true);
  assert.equal(root.candidate_can_select_memory_for_attribution,false);
  assert.equal(root.candidate_can_author_attribution,false);
  assert.equal(root.attribution_is_skill_evidence,false);
  assert.equal(root.attribution_is_scheduler_authority,false);
  assert.equal(root.attribution_is_promotion_authority,false);
});
