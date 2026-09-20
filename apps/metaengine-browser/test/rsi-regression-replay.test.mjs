import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiMasteryAnchor,
  verifyRsiMasteryAnchor,
  createRsiMasteryLedger,
  verifyRsiMasteryLedger,
  createRsiRetentionReplayPlan,
  verifyRsiRetentionReplayPlan,
  createRsiRetentionReplayReceipt,
  verifyRsiRetentionReplayReceipt,
  finalizeRsiRetentionGate,
  verifyRsiRetentionGate,
  rsiRegressionReplayTrustRootSnapshot,
} from '../src/rsi-regression-replay.mjs';

const d=(c)=>`sha256:${c.repeat(64)}`;
const sha=(c)=>c.repeat(40);
const cid=(c)=>`candidate_sha256_${c.repeat(64)}`;

function anchor(id,family,{gen=5,baseline=0.95,floor=0.80,regressions=0,safety=false,char='1'}={}) {
  return createRsiMasteryAnchor({
    anchor_id:`mastery.${id}`,
    capability_family:family,
    challenge_digest:d(char),
    benchmark_admission_digest:d('f'),
    baseline_candidate_id:cid('a'),
    baseline_candidate_sha:sha('a'),
    mastered_generation:gen,
    mastered_at:'2026-09-18T00:00:00.000Z',
    baseline_success_rate:baseline,
    minimum_retained_success_rate:floor,
    historical_regression_count:regressions,
    safety_critical:safety,
    external_mastery_verifier:true,
    authored_by_candidate:false,
    contamination_resistant_evidence:true,
    hidden_holdout:true,
    evidence_refs:[`MASTER_RUN_${id}`],
  });
}
function ledger() {
  return createRsiMasteryLedger({
    ledger_id:'rsi.mastery.ledger.1',
    anchors:[
      anchor('auth','AUTH_CONTINUITY',{gen:2,regressions:2,safety:true,char:'1'}),
      anchor('control','CONTROL_LIVENESS',{gen:6,regressions:1,char:'2'}),
      anchor('workspace','WORKSPACE_ISOLATION',{gen:10,safety:true,char:'3'}),
      anchor('update','SELF_UPDATE_SAFETY',{gen:4,char:'4'}),
    ],
  });
}
function receipt(plan,l,anchorId,{attempts=16,successes=15,hard=true}={}) {
  return createRsiRetentionReplayReceipt({
    plan,ledger:l,anchor_id:anchorId,
    replay_attempts:attempts,replay_successes:successes,hard_invariants_pass:hard,
    evaluator_root_digest:d('e'),
    environment_fingerprint:'windows-x64-browsercell-v1',
    external_replay_evaluator:true,
    authored_by_candidate:false,
    evidence_refs:[`REPLAY_${anchorId}`],
  });
}

test('mastery anchor requires external contamination-resistant hidden-holdout evidence',()=>{
  const row=anchor('x','CAPABILITY_X',{char:'5'});
  verifyRsiMasteryAnchor(row);
  assert.equal(row.external_mastery_verifier,true);
  assert.equal(row.contamination_resistant_evidence,true);
  assert.equal(row.hidden_holdout,true);
  assert.equal(row.candidate_can_delete_anchor,false);
  assert.equal(row.candidate_can_lower_retention_floor,false);
  assert.equal(row.authority_effect,false);
  assert.throws(()=>createRsiMasteryAnchor({
    anchor_id:'bad.anchor',capability_family:'BAD',challenge_digest:d('6'),benchmark_admission_digest:d('f'),
    baseline_candidate_id:cid('a'),baseline_candidate_sha:sha('a'),mastered_generation:1,mastered_at:'2026-09-18T00:00:00Z',
    baseline_success_rate:1,minimum_retained_success_rate:.8,
    external_mastery_verifier:false,authored_by_candidate:true,contamination_resistant_evidence:false,hidden_holdout:false,
    evidence_refs:['MODEL_SELF_REPORT'],
  }),/external_origin_required|independent_evidence_required/);
});

test('mastery ledger is append-only and exact',()=>{
  const l=ledger();
  verifyRsiMasteryLedger(l);
  assert.equal(l.anchor_count,4);
  assert.equal(l.distinct_family_count,4);
  assert.equal(l.append_only,true);
  assert.equal(l.candidate_can_delete_anchors,false);
  assert.equal(l.candidate_can_rewrite_baselines,false);
  assert.equal(l.hidden_holdout_content_exposed,false);
});

test('replay plan is deterministic, diversity-first and prioritizes safety/staleness/regression history',()=>{
  const l=ledger();
  const input={ledger:l,current_candidate_id:cid('b'),current_candidate_sha:sha('b'),current_generation:30,max_replay_tasks:3};
  const a=createRsiRetentionReplayPlan(input);
  const b=createRsiRetentionReplayPlan(input);
  verifyRsiRetentionReplayPlan(a,l);
  assert.equal(a.plan_digest,b.plan_digest);
  assert.equal(a.task_count,3);
  assert.equal(a.selected_family_count,3);
  assert.equal(a.diversity_first_sampling,true);
  assert.equal(a.safety_critical_priority,true);
  assert.equal(a.candidate_can_select_replay_tasks,false);
  assert.equal(a.hidden_holdout_content_exposed,false);
  assert.equal(a.tasks.some(x=>x.anchor_id==='mastery.auth'),true);
});

test('external replay receipt classifies retained, capability regression and hard-invariant regression',()=>{
  const l=ledger();
  const plan=createRsiRetentionReplayPlan({ledger:l,current_candidate_id:cid('b'),current_candidate_sha:sha('b'),current_generation:30,max_replay_tasks:4});
  const auth=plan.tasks.find(x=>x.anchor_id==='mastery.auth');
  const kept=receipt(plan,l,auth.anchor_id,{attempts:16,successes:15,hard:true});
  verifyRsiRetentionReplayReceipt(kept,plan,l);
  assert.equal(kept.state,'RETAINED');
  assert.equal(kept.candidate_can_self_certify_retention,false);
  assert.equal(kept.no_statistical_alpha_spent,true);

  const degraded=receipt(plan,l,auth.anchor_id,{attempts:16,successes:8,hard:true});
  assert.equal(degraded.state,'DEGRADED_CAPABILITY');

  const hard=receipt(plan,l,auth.anchor_id,{attempts:16,successes:15,hard:false});
  assert.equal(hard.state,'DEGRADED_HARD_INVARIANT');
});

test('candidate cannot self-certify retention',()=>{
  const l=ledger();
  const plan=createRsiRetentionReplayPlan({ledger:l,current_candidate_id:cid('b'),current_candidate_sha:sha('b'),current_generation:30,max_replay_tasks:1});
  assert.throws(()=>createRsiRetentionReplayReceipt({
    plan,ledger:l,anchor_id:plan.tasks[0].anchor_id,replay_attempts:16,replay_successes:16,hard_invariants_pass:true,
    evaluator_root_digest:d('e'),environment_fingerprint:'win',
    external_replay_evaluator:false,authored_by_candidate:true,evidence_refs:['SELF'],
  }),/external_origin_required/);
});

test('retention gate passes only when every planned mastery anchor is retained',()=>{
  const l=ledger();
  const plan=createRsiRetentionReplayPlan({ledger:l,current_candidate_id:cid('b'),current_candidate_sha:sha('b'),current_generation:30,max_replay_tasks:4});
  const receipts=plan.tasks.map(t=>receipt(plan,l,t.anchor_id,{attempts:20,successes:19,hard:true}));
  const gate=finalizeRsiRetentionGate({plan,ledger:l,receipts});
  verifyRsiRetentionGate(gate,plan,l,receipts);
  assert.equal(gate.state,'RETENTION_GATE_PASS_FOR_EXTERNAL_REVIEW');
  assert.equal(gate.retention_gate_pass,true);
  assert.equal(gate.retained_count,4);
  assert.equal(gate.existing_promotion_gate_still_required,true);
  assert.equal(gate.statistical_confirmation_still_required,true);
  assert.equal(gate.direct_promotion_authorized,false);
  assert.equal(gate.promotion_token,null);
  assert.equal(gate.promotion_authority,false);
});

test('any regression holds promotion review but candidate may remain nonpromotable stepping stone',()=>{
  const l=ledger();
  const plan=createRsiRetentionReplayPlan({ledger:l,current_candidate_id:cid('b'),current_candidate_sha:sha('b'),current_generation:30,max_replay_tasks:4});
  const receipts=plan.tasks.map((t,i)=>receipt(plan,l,t.anchor_id,{attempts:20,successes:i===0?5:19,hard:true}));
  const gate=finalizeRsiRetentionGate({plan,ledger:l,receipts});
  assert.equal(gate.state,'RETENTION_GATE_HELD');
  assert.equal(gate.retention_gate_pass,false);
  assert.equal(gate.degraded_capability_count,1);
  assert.equal(gate.regression_memory_must_be_retained,true);
  assert.equal(gate.held_candidate_may_remain_nonpromotable_stepping_stone,true);
  assert.equal(gate.direct_promotion_authorized,false);
});

test('gate fails closed on incomplete receipt set',()=>{
  const l=ledger();
  const plan=createRsiRetentionReplayPlan({ledger:l,current_candidate_id:cid('b'),current_candidate_sha:sha('b'),current_generation:30,max_replay_tasks:3});
  const receipts=plan.tasks.slice(0,2).map(t=>receipt(plan,l,t.anchor_id));
  assert.throws(()=>finalizeRsiRetentionGate({plan,ledger:l,receipts}),/receipt_set_incomplete/);
});

test('regression replay trust root protects old capabilities without becoming promotion authority',()=>{
  const root=rsiRegressionReplayTrustRootSnapshot();
  assert.equal(root.mastery_requires_external_verifier,true);
  assert.equal(root.mastery_requires_contamination_resistant_evidence,true);
  assert.equal(root.mastery_ledger_append_only,true);
  assert.equal(root.diversity_first_replay_sampling,true);
  assert.equal(root.candidate_can_select_replay_tasks,false);
  assert.equal(root.candidate_can_self_certify_retention,false);
  assert.equal(root.candidate_can_delete_mastery_anchors,false);
  assert.equal(root.retention_gate_is_promotion_authority,false);
  assert.equal(root.full_hidden_holdout_still_required,true);
  assert.equal(root.statistical_confirmation_still_required,true);
  assert.equal(root.existing_promotion_gate_still_required,true);
  assert.equal(root.authority_effect,false);
  assert.match(root.retention_root_digest,/^sha256:[0-9a-f]{64}$/);
});
