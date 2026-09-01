import assert from 'node:assert/strict';
import test from 'node:test';
import { assertZeroAuthorityMetaOutput, compileMetaPlan } from '../src/meta-orchestrator-core.mjs';
import { reconcileContinuousMetaOrchestrator } from '../src/meta-orchestrator-continuous-reconcile.mjs';

const SHA='d91e94b307ed60e890aabc53a2678a8ae9c6a79d';
const authority={roadmap_id:'compute-unified-v1',active_milestone_key:'META_ORCHESTRATOR_V1',integration_line:'work/browser-continuous-fleet-audit-v1',baseline_sha:SHA,alignment_epoch:7};
const node=(point_id,overrides={})=>({point_id,role:'IMPLEMENTER',objective:`Implement ${point_id}`,required_capabilities:['capability.repo_write'],evidence_contract:{required:['ci_green','commit_bound'],min_verified:2},...overrides});
const plan=(nodes=[node('meta.core')])=>compileMetaPlan({authority,plan_generation:3,nodes});
const evidenceFor=(point_id)=>[
  {point_id,kind:'ci_green',verified:true,authority_effect:false},
  {point_id,kind:'commit_bound',verified:true,authority_effect:false},
];
const run=(p,extra={})=>reconcileContinuousMetaOrchestrator({
  plan:p,
  observed_alignment_epoch:7,
  observed_plan_generation:3,
  leader:{expected_epoch:4,observed_epoch:4},
  tasks:[],
  evidence:[],
  capacity:{available_slots:8},
  policy:{max_parallel_proposals:8},
  ...extra,
});

test('critical point is never split when only one scheduler slot is available',()=>{
  const r=run(plan([node('meta.core',{risk:'CRITICAL'})]),{capacity:{available_slots:1}});
  assert.equal(r.state,'CAPACITY_WAIT');
  assert.equal(r.actions[0].type,'REQUEST_CAPACITY');
  assert.equal(r.actions[0].required_slots,3);
  assert.equal(r.actions.some((row)=>row.type==='PROPOSE_TASK'),false);
});

test('critical point is emitted as one complete three-point atomic frontier',()=>{
  const r=run(plan([node('meta.core',{risk:'CRITICAL'})]),{capacity:{available_slots:3}});
  assert.equal(r.state,'PROPOSING');
  assert.equal(r.atomic_frontier_required,true);
  assert.deepEqual(r.actions.map((row)=>row.point_id),['meta.core','meta.core.critic','meta.core.falsifier']);
  assert.equal(r.frontier_group_count,1);
  assert.equal(r.frontier_point_count,3);
});

test('proposal policy cannot truncate a critical safety group',()=>{
  const r=run(plan([node('meta.core',{risk:'CRITICAL'})]),{capacity:{available_slots:3},policy:{max_parallel_proposals:2}});
  assert.equal(r.state,'CAPACITY_WAIT');
  assert.equal(r.reason,'SAFETY_GROUP_EXCEEDS_PROPOSAL_BUDGET');
  assert.equal(r.actions[0].required_parallel_proposals,3);
});

test('normal independent nodes still fill available frontier slots',()=>{
  const p=plan([node('meta.a',{priority:90}),node('meta.b',{priority:80}),node('meta.c',{priority:70})]);
  const r=run(p,{capacity:{available_slots:2}});
  assert.deepEqual(r.actions.map((row)=>row.point_id),['meta.a','meta.b']);
});

test('legacy partial high-risk admission is repaired before new work',()=>{
  const p=plan([node('meta.risky',{risk:'HIGH',priority:50}),node('meta.new',{priority:100})]);
  const r=run(p,{tasks:[{point_id:'meta.risky',state:'RUNNING',lease_generation:1}],capacity:{available_slots:1}});
  assert.equal(r.state,'PROPOSING');
  assert.deepEqual(r.actions.map((row)=>row.point_id),['meta.risky.critic']);
});

test('critical partial group repairs only the missing companion',()=>{
  const p=plan([node('meta.core',{risk:'CRITICAL'})]);
  const tasks=[
    {point_id:'meta.core',state:'RUNNING',lease_generation:2},
    {point_id:'meta.core.critic',state:'READY',lease_generation:0},
  ];
  const r=run(p,{tasks,capacity:{available_slots:1}});
  assert.deepEqual(r.actions.map((row)=>row.point_id),['meta.core.falsifier']);
});

test('completed parent cannot converge while required critic is still active',()=>{
  const p=plan([node('meta.core',{risk:'HIGH'})]);
  const tasks=[
    {point_id:'meta.core',state:'COMPLETED',lease_generation:2},
    {point_id:'meta.core.critic',state:'RUNNING',lease_generation:1},
  ];
  const r=run(p,{tasks,evidence:evidenceFor('meta.core'),capacity:{available_slots:0}});
  assert.equal(r.state,'SAFETY_WAIT');
  assert.equal(r.actions[0].type,'NOOP');
});

test('completed parent converges only after required critic completes',()=>{
  const p=plan([node('meta.core',{risk:'HIGH'})]);
  const tasks=[
    {point_id:'meta.core',state:'COMPLETED',lease_generation:2},
    {point_id:'meta.core.critic',state:'COMPLETED',lease_generation:1},
  ];
  const r=run(p,{tasks,evidence:evidenceFor('meta.core'),capacity:{available_slots:0}});
  assert.equal(r.state,'CONVERGED');
});

test('ambiguous safety companion requests readback and never retry',()=>{
  const p=plan([node('meta.core',{risk:'HIGH'})]);
  const tasks=[
    {point_id:'meta.core',state:'RUNNING',lease_generation:2},
    {point_id:'meta.core.critic',state:'AMBIGUOUS',lease_generation:1},
  ];
  const r=run(p,{tasks});
  assert.equal(r.state,'RECONCILING');
  assert.equal(r.actions[0].type,'REQUEST_RECONCILIATION');
  assert.equal(r.actions[0].automatic_retry_allowed,false);
  assert.equal(r.actions.some((row)=>String(row.type).includes('RETRY')),false);
});

test('failed plan node cannot silently remain observing',()=>{
  const r=run(plan(),{tasks:[{point_id:'meta.core',state:'FAILED',lease_generation:3}]});
  assert.equal(r.state,'BLOCKED');
  assert.equal(r.actions[0].type,'REQUEST_REASONING');
});

test('continuous reconcile remains recursively zero-authority',()=>{
  const r=run(plan([node('meta.core',{risk:'CRITICAL'})]),{capacity:{available_slots:3}});
  assert.equal(assertZeroAuthorityMetaOutput(r),true);
});
