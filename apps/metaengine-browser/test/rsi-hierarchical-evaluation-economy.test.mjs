import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RSI_EVALUATION_STAGES,
  createRsiEvaluationCascadePolicy,
  verifyRsiEvaluationCascadePolicy,
  createRsiEvaluationStageReceipt,
  verifyRsiEvaluationStageReceipt,
  createRsiEvaluationStageDecision,
  verifyRsiEvaluationStageDecision,
  rsiHierarchicalEvaluationEconomyTrustRootSnapshot,
} from '../src/rsi-hierarchical-evaluation-economy.mjs';

const sha=(c)=>c.repeat(40);
const d=(c)=>`sha256:${c.repeat(64)}`;
const cid=(c)=>`candidate_sha256_${c.repeat(64)}`;

function policy(){
  return createRsiEvaluationCascadePolicy({
    policy_id:'eval.cascade.1',
    targeted_shard_digest:d('a'),
    full_holdout_digest:d('b'),
    matched_budget_baseline_digest:d('c'),
    external_policy_owner:true,
    authored_by_candidate:false,
  });
}

function receipt({
  id='r.1',candidate='1',stage='LLM_JUDGE_TRIAGE',score=0.8,novelty=0.2,cost=1,
  pass=true,hard=true,workload=d('1'),matched=0,
}={}){
  const p=policy();
  const actualWorkload=stage==='TARGETED_SHARD'?p.targeted_shard_digest:stage==='FULL_HOLDOUT'?p.full_holdout_digest:workload;
  return createRsiEvaluationStageReceipt({
    receipt_id:id,policy:p,candidate_id:cid(candidate),candidate_sha:sha(candidate),stage,
    evaluator_root_digest:d('f'),workload_digest:actualWorkload,cost_units_used:cost,
    hard_invariants_pass:hard,stage_pass:pass,score,novelty_score:novelty,matched_budget_delta:matched,
    evidence_refs:[`RUN_${id}`],external_evaluator:true,authored_by_candidate:false,
  });
}

test('cascade orders static -> micro -> judge -> targeted -> full holdout and keeps low fidelity non-authoritative',()=>{
  const p=policy();
  verifyRsiEvaluationCascadePolicy(p);
  assert.deepEqual(p.stage_order,RSI_EVALUATION_STAGES);
  assert.equal(p.hierarchical_multi_fidelity,true);
  assert.equal(p.successive_halving_inspired,true);
  assert.equal(p.low_fidelity_allocates_compute_only,true);
  assert.equal(p.low_fidelity_archive_authority,false);
  assert.equal(p.low_fidelity_promotion_authority,false);
  assert.equal(p.full_holdout_required_for_archive_review,true);
  assert.equal(p.statistical_confirmation_required_for_promotion_review,true);
  assert.equal(p.exploration_escape_hatch_required,true);
  assert.equal(p.matched_budget_baseline_required,true);
  assert.equal(p.authority_effect,false);
});

test('candidate cannot author receipt, exceed stage budget or pass after hard invariant failure',()=>{
  const p=policy();
  assert.throws(()=>createRsiEvaluationStageReceipt({
    receipt_id:'r.self',policy:p,candidate_id:cid('1'),candidate_sha:sha('1'),stage:'LLM_JUDGE_TRIAGE',
    evaluator_root_digest:d('f'),workload_digest:d('1'),cost_units_used:1,hard_invariants_pass:true,stage_pass:true,
    score:1,novelty_score:1,evidence_refs:['MODEL_SELF_REPORT'],external_evaluator:false,authored_by_candidate:true,
  }),/external_origin_required/);
  assert.throws(()=>createRsiEvaluationStageReceipt({
    receipt_id:'r.over',policy:p,candidate_id:cid('1'),candidate_sha:sha('1'),stage:'MICRO_TESTS',
    evaluator_root_digest:d('f'),workload_digest:d('1'),cost_units_used:5,hard_invariants_pass:true,stage_pass:true,
    score:0.9,novelty_score:0.1,evidence_refs:['RUN_OVER'],external_evaluator:true,authored_by_candidate:false,
  }),/stage_budget_exceeded/);
  assert.throws(()=>createRsiEvaluationStageReceipt({
    receipt_id:'r.hard',policy:p,candidate_id:cid('1'),candidate_sha:sha('1'),stage:'STATIC_CONTRACT',
    evaluator_root_digest:d('f'),workload_digest:d('1'),cost_units_used:1,hard_invariants_pass:false,stage_pass:true,
    score:1,novelty_score:1,evidence_refs:['RUN_HARD'],external_evaluator:true,authored_by_candidate:false,
  }),/pass_without_hard_invariants/);
});

test('SIFT-like cheap judge can allocate next fidelity but can never archive or promote',()=>{
  const p=policy();
  const rows=[
    receipt({id:'judge.1',candidate:'1',score:0.99,novelty:0.1}),
    receipt({id:'judge.2',candidate:'2',score:0.8,novelty:0.2}),
  ];
  for(const row of rows)verifyRsiEvaluationStageReceipt(row,p);
  const decision=createRsiEvaluationStageDecision({
    decision_id:'decision.judge',policy:p,stage:'LLM_JUDGE_TRIAGE',receipts:rows,survivor_slots:1,exploration_slots:0,
  });
  verifyRsiEvaluationStageDecision(decision,p,rows);
  const winner=decision.decisions.find(x=>x.selected_for_next_fidelity);
  assert.equal(winner.candidate_id,cid('1'));
  assert.equal(winner.state,'ALLOCATE_NEXT_FIDELITY');
  assert.equal(winner.eligible_for_archive_review,false);
  assert.equal(winner.eligible_for_promotion_review,false);
  assert.equal(winner.low_fidelity_compute_allocation_only,true);
  assert.equal(winner.low_fidelity_final_verdict,false);
  assert.equal(decision.low_fidelity_compute_allocation_only,true);
  assert.equal(decision.low_fidelity_final_verdict,false);
});

test('exploration escape hatch preserves one high-novelty candidate that cheap score would otherwise prune',()=>{
  const p=policy();
  const rows=[
    receipt({id:'e.1',candidate:'1',score:0.95,novelty:0.1}),
    receipt({id:'e.2',candidate:'2',score:0.90,novelty:0.2}),
    receipt({id:'e.3',candidate:'3',score:0.20,novelty:1.0}),
  ];
  const decision=createRsiEvaluationStageDecision({
    decision_id:'decision.explore',policy:p,stage:'LLM_JUDGE_TRIAGE',receipts:rows,survivor_slots:2,exploration_slots:1,
  });
  assert.equal(decision.exploration_escape_hatch_active,true);
  const selected=decision.decisions.filter(x=>x.selected_for_next_fidelity);
  assert.equal(selected.length,2);
  assert.equal(selected.some(x=>x.candidate_id===cid('1')&&x.exploration_slot===false),true);
  assert.equal(selected.some(x=>x.candidate_id===cid('3')&&x.exploration_slot===true),true);
});

test('targeted and full holdout workloads are exact-bound and cannot alias',()=>{
  const p=policy();
  assert.throws(()=>createRsiEvaluationCascadePolicy({
    policy_id:'eval.bad.alias',targeted_shard_digest:d('a'),full_holdout_digest:d('a'),matched_budget_baseline_digest:d('c'),
    external_policy_owner:true,authored_by_candidate:false,
  }),/holdout_alias_forbidden/);
  assert.throws(()=>createRsiEvaluationStageReceipt({
    receipt_id:'r.bad.shard',policy:p,candidate_id:cid('1'),candidate_sha:sha('1'),stage:'TARGETED_SHARD',
    evaluator_root_digest:d('f'),workload_digest:d('9'),cost_units_used:2,hard_invariants_pass:true,stage_pass:true,
    score:0.7,novelty_score:0.3,evidence_refs:['RUN_BAD_SHARD'],external_evaluator:true,authored_by_candidate:false,
  }),/targeted_shard_mismatch/);
  assert.throws(()=>createRsiEvaluationStageReceipt({
    receipt_id:'r.bad.holdout',policy:p,candidate_id:cid('1'),candidate_sha:sha('1'),stage:'FULL_HOLDOUT',
    evaluator_root_digest:d('f'),workload_digest:d('9'),cost_units_used:10,hard_invariants_pass:true,stage_pass:true,
    score:0.7,novelty_score:0.3,evidence_refs:['RUN_BAD_HOLDOUT'],external_evaluator:true,authored_by_candidate:false,
  }),/full_holdout_mismatch/);
});

test('full holdout pass enables archive review only and still requires separate statistical confirmation for promotion',()=>{
  const p=policy();
  const rows=[
    receipt({id:'h.1',candidate:'1',stage:'FULL_HOLDOUT',score:0.82,novelty:0.1,cost:40,matched:0.03}),
    receipt({id:'h.2',candidate:'2',stage:'FULL_HOLDOUT',score:0.79,novelty:0.2,cost:40,matched:0.01}),
  ];
  const decision=createRsiEvaluationStageDecision({
    decision_id:'decision.holdout',policy:p,stage:'FULL_HOLDOUT',receipts:rows,survivor_slots:1,exploration_slots:0,
  });
  for(const row of decision.decisions){
    assert.equal(row.eligible_for_archive_review,true);
    assert.equal(row.eligible_for_promotion_review,false);
    assert.equal(row.statistical_confirmation_required_for_promotion,true);
    assert.equal(row.low_fidelity_compute_allocation_only,false);
    assert.equal(row.low_fidelity_final_verdict,false);
    assert.equal(row.state,'FULL_HOLDOUT_PASS_FOR_ARCHIVE_REVIEW');
  }
  assert.equal(decision.full_holdout_required_for_archive_review,true);
  assert.equal(decision.statistical_confirmation_required_for_promotion_review,true);
  assert.equal(decision.authority_effect,false);
});

test('hard-invariant or stage failure is rejected regardless of proxy score',()=>{
  const p=policy();
  const rows=[
    receipt({id:'f.1',candidate:'1',score:1,novelty:1,hard:false,pass:false}),
    receipt({id:'f.2',candidate:'2',score:0.5,novelty:0.1,hard:true,pass:true}),
  ];
  const decision=createRsiEvaluationStageDecision({
    decision_id:'decision.failclosed',policy:p,stage:'LLM_JUDGE_TRIAGE',receipts:rows,survivor_slots:1,exploration_slots:0,
  });
  const failed=decision.decisions.find(x=>x.candidate_id===cid('1'));
  const passed=decision.decisions.find(x=>x.candidate_id===cid('2'));
  assert.equal(failed.state,'REJECTED_AT_STAGE');
  assert.equal(failed.selected_for_next_fidelity,false);
  assert.equal(passed.selected_for_next_fidelity,true);
});

test('stage decision requires one evaluator root and deterministic exact replay',()=>{
  const p=policy();
  const rows=[
    receipt({id:'d.1',candidate:'1',score:0.7,novelty:0.7}),
    receipt({id:'d.2',candidate:'2',score:0.7,novelty:0.7}),
  ];
  const input={decision_id:'decision.det',policy:p,stage:'LLM_JUDGE_TRIAGE',receipts:rows,survivor_slots:1,exploration_slots:0};
  const left=createRsiEvaluationStageDecision(input);
  const right=createRsiEvaluationStageDecision(input);
  assert.equal(left.decision_digest,right.decision_digest);
  assert.deepEqual(left.decisions,right.decisions);

  const bad=createRsiEvaluationStageReceipt({
    receipt_id:'d.bad',policy:p,candidate_id:cid('3'),candidate_sha:sha('3'),stage:'LLM_JUDGE_TRIAGE',
    evaluator_root_digest:d('e'),workload_digest:d('1'),cost_units_used:1,hard_invariants_pass:true,stage_pass:true,
    score:0.8,novelty_score:0.2,evidence_refs:['RUN_BAD_ROOT'],external_evaluator:true,authored_by_candidate:false,
  });
  assert.throws(()=>createRsiEvaluationStageDecision({
    decision_id:'decision.root',policy:p,stage:'LLM_JUDGE_TRIAGE',receipts:[rows[0],bad],survivor_slots:1,exploration_slots:0,
  }),/evaluator_root_mismatch/);
});

test('evaluation economy trust root freezes compute allocation away from promotion authority',()=>{
  const root=rsiHierarchicalEvaluationEconomyTrustRootSnapshot();
  assert.deepEqual(root.stages,RSI_EVALUATION_STAGES);
  assert.equal(root.hierarchical_multi_fidelity,true);
  assert.equal(root.successive_halving_inspired,true);
  assert.equal(root.sift_inspired_cheap_judge_triage,true);
  assert.equal(root.cheap_judge_is_full_evaluator,false);
  assert.equal(root.low_fidelity_allocates_compute_only,true);
  assert.equal(root.exploration_escape_hatch_required,true);
  assert.equal(root.full_holdout_required_for_archive_review,true);
  assert.equal(root.statistical_confirmation_required_for_promotion_review,true);
  assert.equal(root.matched_budget_baseline_required,true);
  assert.equal(root.candidate_can_choose_stage,false);
  assert.equal(root.candidate_can_choose_budget,false);
  assert.equal(root.candidate_can_choose_survivors,false);
  assert.equal(root.scheduler_action_authorized,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.evaluation_root_digest,/^sha256:[0-9a-f]{64}$/);
});
