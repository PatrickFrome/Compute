import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiSearchContext,
  verifyRsiSearchContext,
  createRsiSearchModeOutcome,
  createRsiSearchModeRoutingPlan,
  verifyRsiSearchModeRoutingPlan,
  rsiSearchModeRouterTrustRootSnapshot,
} from '../src/rsi-search-mode-router.mjs';

const d=(char)=>`sha256:${char.repeat(64)}`;

function context(overrides={}) {
  return createRsiSearchContext({
    context_id:'context.browser.latency.1',
    mutation_surface:'BROWSER_RUNTIME',
    problem_class:'LATENCY_RELIABILITY',
    budget_class:'MEDIUM',
    skeleton_available:true,
    trace_history_available:true,
    lineage_candidate_count:4,
    failure_class:'LATENCY_REGRESSION',
    novelty_pressure:0.4,
    external_context_owner:true,
    authored_by_candidate:false,
    ...overrides,
  });
}

function outcome(ctx,id,mode,{win=false,hard=true,valid=true,cost=10}={}) {
  return createRsiSearchModeOutcome({
    outcome_id:`outcome.${id}`,
    context:ctx,
    search_mode:mode,
    net_benefit_verified:win,
    hard_invariants_pass:hard,
    candidate_valid:valid,
    cost_units:cost,
    evaluation_digest:d(id[0] || 'a'),
    evidence_refs:[`EVAL_${id}`],
    external_evaluator:true,
    authored_by_candidate:false,
  });
}

test('typed search context is external and contains no raw page/user authority',()=>{
  const ctx=context();
  verifyRsiSearchContext(ctx);
  assert.equal(ctx.external_context_owner,true);
  assert.equal(ctx.authored_by_candidate,false);
  assert.equal(ctx.raw_page_text_present,false);
  assert.equal(ctx.raw_user_input_present,false);
  assert.equal(ctx.candidate_can_edit_context,false);
  assert.equal(ctx.authority_effect,false);
});

test('mode compatibility uses externally proven affordances instead of candidate preference',()=>{
  const ctx=context({skeleton_available:false,trace_history_available:false,lineage_candidate_count:1});
  const plan=createRsiSearchModeRoutingPlan({
    context:ctx,
    outcomes:[],
    routing_id:'routing.compatibility.1',
    proposal_budget_units:100,
    exploration_fraction:0.2,
    external_router:true,
    authored_by_candidate:false,
  });
  verifyRsiSearchModeRoutingPlan(plan);
  assert.deepEqual(plan.compatible_modes,['BROAD_ARCHITECTURE']);
  assert.equal(plan.allocations.length,1);
  assert.equal(plan.allocations[0].search_mode,'BROAD_ARCHITECTURE');
  assert.equal(plan.allocations[0].role,'ONLY_COMPATIBLE');
});

test('historically useful low-invalid mode receives exploitation budget while an underexplored compatible mode retains explicit exploration',()=>{
  const ctx=context();
  const outcomes=[
    outcome(ctx,'a1','FIXED_SKELETON',{win:true,cost:8}),
    outcome(ctx,'a2','FIXED_SKELETON',{win:true,cost:9}),
    outcome(ctx,'a3','FIXED_SKELETON',{win:true,cost:7}),
    outcome(ctx,'a4','FIXED_SKELETON',{win:false,cost:8}),
    outcome(ctx,'b1','BROAD_ARCHITECTURE',{win:false,cost:30}),
    outcome(ctx,'b2','BROAD_ARCHITECTURE',{win:false,valid:false,hard:false,cost:35}),
    outcome(ctx,'c1','RECURSIVE_DEPTH',{win:true,cost:20}),
  ];
  const plan=createRsiSearchModeRoutingPlan({
    context:ctx,outcomes,
    routing_id:'routing.portfolio.1',
    proposal_budget_units:100,
    exploration_fraction:0.2,
    external_router:true,
    authored_by_candidate:false,
  });
  verifyRsiSearchModeRoutingPlan(plan);
  const exploit=plan.allocations.find((row)=>row.role==='EXPLOIT');
  const explore=plan.allocations.find((row)=>row.role==='EXPLORE');
  assert.equal(exploit.search_mode,'FIXED_SKELETON');
  assert.ok(explore);
  assert.notEqual(explore.search_mode,exploit.search_mode);
  assert.equal(exploit.proposal_budget_units,80);
  assert.equal(explore.proposal_budget_units,20);
  assert.equal(plan.explicit_exploration_required,true);
  assert.equal(plan.candidate_can_choose_mode,false);
  assert.equal(plan.routing_is_scheduler_authority,false);
  assert.equal(plan.authority_effect,false);
});

test('invalid candidates penalize a search mode even if proposal count is high',()=>{
  const ctx=context();
  const outcomes=[];
  for(let i=0;i<8;i+=1){
    outcomes.push(outcome(ctx,`d${i+1}`,'BROAD_ARCHITECTURE',{
      win:false,hard:false,valid:false,cost:15,
    }));
  }
  outcomes.push(outcome(ctx,'e1','FIXED_SKELETON',{win:true,cost:10}));
  const plan=createRsiSearchModeRoutingPlan({
    context:ctx,outcomes,
    routing_id:'routing.invalid-penalty.1',
    proposal_budget_units:50,
    exploration_fraction:0.2,
    external_router:true,
    authored_by_candidate:false,
  });
  const broad=plan.mode_statistics.find((row)=>row.search_mode==='BROAD_ARCHITECTURE');
  const fixed=plan.mode_statistics.find((row)=>row.search_mode==='FIXED_SKELETON');
  assert.equal(broad.invalid,8);
  assert.ok(broad.selection_score<fixed.selection_score);
});

test('positive routing evidence cannot be claimed when hard invariants or validity failed',()=>{
  const ctx=context();
  assert.throws(()=>outcome(ctx,'z1','FIXED_SKELETON',{win:true,hard:false,valid:true}),/positive_without_validity/);
  assert.throws(()=>outcome(ctx,'z2','FIXED_SKELETON',{win:true,hard:true,valid:false}),/positive_without_validity/);
});

test('candidate-authored context or outcome cannot influence mode allocation',()=>{
  assert.throws(()=>createRsiSearchContext({
    context_id:'context.self',
    mutation_surface:'BROWSER_RUNTIME',
    problem_class:'LATENCY',
    budget_class:'LOW',
    skeleton_available:true,
    trace_history_available:true,
    lineage_candidate_count:2,
    failure_class:null,
    novelty_pressure:1,
    external_context_owner:false,
    authored_by_candidate:true,
  }),/external_origin_required/);

  const ctx=context();
  assert.throws(()=>createRsiSearchModeOutcome({
    outcome_id:'outcome.self',
    context:ctx,
    search_mode:'FIXED_SKELETON',
    net_benefit_verified:true,
    hard_invariants_pass:true,
    candidate_valid:true,
    cost_units:1,
    evaluation_digest:d('1'),
    evidence_refs:['MODEL_SELF_REPORT'],
    external_evaluator:false,
    authored_by_candidate:true,
  }),/external_origin_required/);
});

test('routing plan is deterministic for exact same external evidence',()=>{
  const ctx=context();
  const outcomes=[
    outcome(ctx,'a1','FIXED_SKELETON',{win:true,cost:10}),
    outcome(ctx,'b1','BROAD_ARCHITECTURE',{win:true,cost:20}),
  ];
  const input={
    context:ctx,outcomes,
    routing_id:'routing.deterministic.1',
    proposal_budget_units:60,
    exploration_fraction:0.25,
    external_router:true,
    authored_by_candidate:false,
  };
  const left=createRsiSearchModeRoutingPlan(input);
  const right=createRsiSearchModeRoutingPlan(input);
  assert.equal(left.routing_digest,right.routing_digest);
  assert.deepEqual(left.allocations,right.allocations);
});

function route(ctx,outcomes,routingId='routing.outcome-identity.1') {
  return createRsiSearchModeRoutingPlan({
    context:ctx,
    outcomes,
    routing_id:routingId,
    proposal_budget_units:100,
    exploration_fraction:0.2,
    external_router:true,
    authored_by_candidate:false,
  });
}

test('replayed canonical outcome is counted once and cannot flip exploitation budget',()=>{
  const ctx=context({trace_history_available:false,lineage_candidate_count:0});
  const fixed=outcome(ctx,'a1','FIXED_SKELETON',{win:true,cost:5});
  const broad=outcome(ctx,'b1','BROAD_ARCHITECTURE',{win:true,cost:1});
  const once=route(ctx,[fixed,broad]);
  const replayed=route(ctx,[structuredClone(fixed),broad,fixed,structuredClone(fixed)]);
  assert.equal(once.allocations.find((row)=>row.role==='EXPLOIT')?.search_mode,'BROAD_ARCHITECTURE');
  assert.equal(once.mode_statistics.find((row)=>row.search_mode==='FIXED_SKELETON')?.attempts,1);
  assert.deepEqual(replayed,once);
  assert.equal(replayed.evidence_outcome_digests.length,2);
  verifyRsiSearchModeRoutingPlan(replayed);
});

test('canonically equivalent replay with reordered evidence_refs is still one outcome',()=>{
  const ctx=context();
  const evidence=createRsiSearchModeOutcome({
    outcome_id:'outcome.a.canonical',context:ctx,search_mode:'FIXED_SKELETON',
    net_benefit_verified:true,hard_invariants_pass:true,candidate_valid:true,
    cost_units:4,evaluation_digest:d('a'),evidence_refs:['EVAL_B','EVAL_A'],
    external_evaluator:true,authored_by_candidate:false,
  });
  const reordered={...evidence,evidence_refs:['EVAL_B','EVAL_A']};
  const once=route(ctx,[evidence],'routing.canonical-replay.1');
  const repeated=route(ctx,[reordered,structuredClone(evidence)],'routing.canonical-replay.1');
  assert.deepEqual(repeated,once);
  assert.equal(repeated.evidence_outcome_digests.length,1);
});

test('reordering unique outcomes including fractional costs is deterministic',()=>{
  const ctx=context({trace_history_available:false,lineage_candidate_count:0});
  const a=outcome(ctx,'a1','FIXED_SKELETON',{win:true,cost:0.1});
  const b=outcome(ctx,'b1','FIXED_SKELETON',{win:true,cost:0.2});
  const c=outcome(ctx,'c1','FIXED_SKELETON',{win:false,cost:0.3});
  const d=outcome(ctx,'d1','BROAD_ARCHITECTURE',{win:false,cost:1});
  const original=route(ctx,[a,b,c,d],'routing.order-independent.1');
  const reversed=route(ctx,[d,c,b,a],'routing.order-independent.1');
  assert.deepEqual(reversed,original);
  assert.equal(reversed.routing_digest,original.routing_digest);
});

test('replay position and permutation cannot change statistics, budget, evidence or digest',()=>{
  const ctx=context();
  const a=outcome(ctx,'a1','FIXED_SKELETON',{win:true,cost:0.1});
  const b=outcome(ctx,'b1','FIXED_SKELETON',{win:false,cost:0.2});
  const c=outcome(ctx,'c1','BROAD_ARCHITECTURE',{win:true,cost:3});
  const d=outcome(ctx,'d1','RECURSIVE_DEPTH',{win:false,valid:false,hard:false,cost:7});
  const baseline=route(ctx,[a,b,c,d],'routing.replay-permutation.1');
  const inputs=[
    [a,b,c,d,a],
    [structuredClone(d),c,structuredClone(b),a,d,b],
    [b,a,c,a,b,d,c,structuredClone(d)],
    [d,c,b,a],
  ];
  for (const rows of inputs) {
    const candidate=route(ctx,rows,'routing.replay-permutation.1');
    assert.deepEqual(candidate.mode_statistics,baseline.mode_statistics);
    assert.deepEqual(candidate.allocations,baseline.allocations);
    assert.deepEqual(candidate.evidence_outcome_digests,baseline.evidence_outcome_digests);
    assert.equal(candidate.routing_digest,baseline.routing_digest);
    verifyRsiSearchModeRoutingPlan(candidate);
  }
});

test('same outcome_id with different valid canonical content is rejected in either order',()=>{
  const ctx=context();
  const first=outcome(ctx,'a1','FIXED_SKELETON',{win:true,cost:5});
  const variants=[
    outcome(ctx,'a1','BROAD_ARCHITECTURE',{win:true,cost:5}),
    outcome(ctx,'a1','FIXED_SKELETON',{win:true,cost:6}),
    outcome(ctx,'a1','FIXED_SKELETON',{win:false,cost:5}),
    createRsiSearchModeOutcome({
      outcome_id:first.outcome_id,context:ctx,search_mode:first.search_mode,
      net_benefit_verified:true,hard_invariants_pass:true,candidate_valid:true,
      cost_units:first.cost_units,evaluation_digest:d('f'),evidence_refs:first.evidence_refs,
      external_evaluator:true,authored_by_candidate:false,
    }),
  ];
  for(const other of variants){
    assert.notEqual(first.outcome_digest,other.outcome_digest);
    assert.throws(()=>route(ctx,[first,other]),/rsi_mode_outcome_id_conflict/);
    assert.throws(()=>route(ctx,[other,first]),/rsi_mode_outcome_id_conflict/);
    assert.throws(()=>route(ctx,[first,structuredClone(first),other]),/rsi_mode_outcome_id_conflict/);
  }
});

test('invalid or mismatched outcome digest cannot be laundered by a duplicate',()=>{
  const ctx=context();
  const first=outcome(ctx,'a1','FIXED_SKELETON',{win:true,cost:5});
  const other=outcome(ctx,'b1','BROAD_ARCHITECTURE',{win:false,cost:7});
  const forged={...first,cost_units:99};
  const borrowedDigest={...other,outcome_digest:first.outcome_digest};
  assert.throws(()=>route(ctx,[first,forged]),/rsi_mode_outcome_digest_mismatch/);
  assert.throws(()=>route(ctx,[forged,first]),/rsi_mode_outcome_digest_mismatch/);
  assert.throws(()=>route(ctx,[first,borrowedDigest]),/rsi_mode_outcome_digest_mismatch/);
  assert.throws(()=>route(ctx,[borrowedDigest,first]),/rsi_mode_outcome_digest_mismatch/);
});

test('distinct outcome IDs remain independent even if their evaluation_digest matches',()=>{
  const ctx=context();
  const first=outcome(ctx,'a1','FIXED_SKELETON',{win:true,cost:2});
  const second=outcome(ctx,'a2','FIXED_SKELETON',{win:false,cost:4});
  assert.equal(first.evaluation_digest,second.evaluation_digest);
  assert.notEqual(first.outcome_digest,second.outcome_digest);
  const stats=route(ctx,[first,second]).mode_statistics.find((row)=>row.search_mode==='FIXED_SKELETON');
  assert.equal(stats.attempts,2);
  assert.equal(stats.wins,1);
  assert.equal(stats.avgCost,3);
});

test('raw outcome array bound is enforced before replay deduplication',()=>{
  const ctx=context();
  const a=outcome(ctx,'a1','FIXED_SKELETON',{win:true,cost:2});
  assert.throws(()=>route(ctx,Array(4097).fill(a)),/rsi_mode_outcomes_invalid/);
});

test('routing changes proposal budget only and never becomes scheduler/evaluator/promotion authority',()=>{
  const ctx=context();
  const plan=createRsiSearchModeRoutingPlan({
    context:ctx,
    outcomes:[],
    routing_id:'routing.authority.1',
    proposal_budget_units:40,
    exploration_fraction:0.2,
    external_router:true,
    authored_by_candidate:false,
  });
  assert.equal(plan.routing_is_scheduler_authority,false);
  assert.equal(plan.routing_is_evaluation_authority,false);
  assert.equal(plan.routing_is_promotion_authority,false);
  assert.equal(plan.execution_authority,false);
  assert.equal(plan.production_mutation_authority,false);
  assert.equal(plan.promotion_authority,false);
  assert.equal(plan.self_update_authority,false);
  assert.equal(plan.scheduler_authority,false);
  assert.equal(plan.authority_effect,false);
});

test('search mode trust root combines AEL-style adaptive strategy selection with explicit exploration and immutable authority roots',()=>{
  const root=rsiSearchModeRouterTrustRootSnapshot();
  assert.equal(root.mechanism,'CONTEXTUAL_COST_AWARE_UCB_WITH_EXPLICIT_EXPLORATION');
  assert.equal(root.ael_contextual_bandit_inspired,true);
  assert.equal(root.adas_search_space_routing,true);
  assert.equal(root.funsearch_narrow_mode,true);
  assert.equal(root.meta_n_recursive_depth_mode,true);
  assert.equal(root.externally_verified_outcomes_only,true);
  assert.equal(root.explicit_exploration_required,true);
  assert.equal(root.candidate_can_choose_mode,false);
  assert.equal(root.routing_is_scheduler_authority,false);
  assert.equal(root.routing_is_evaluation_authority,false);
  assert.equal(root.routing_is_promotion_authority,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.search_mode_root_digest,/^sha256:[0-9a-f]{64}$/);
});
