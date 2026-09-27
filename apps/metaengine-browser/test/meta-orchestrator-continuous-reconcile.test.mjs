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

test('critical point starts with primary only even when one scheduler slot is available',()=>{
  const r=run(plan([node('meta.core',{risk:'CRITICAL'})]),{capacity:{available_slots:1}});
  assert.equal(r.state,'PROPOSING');
  assert.deepEqual(r.actions.map((row)=>row.point_id),['meta.core']);
});

test('critical point never races critic or falsifier in the initial frontier',()=>{
  const r=run(plan([node('meta.core',{risk:'CRITICAL'})]),{capacity:{available_slots:3}});
  assert.equal(r.state,'PROPOSING');
  assert.deepEqual(r.actions.map((row)=>row.point_id),['meta.core']);
  assert.equal(r.frontier_group_count,1);
  assert.equal(r.frontier_point_count,1);
});

test('proposal policy no longer reserves verifier slots before a result exists',()=>{
  const r=run(plan([node('meta.core',{risk:'CRITICAL'})]),{capacity:{available_slots:1},policy:{max_parallel_proposals:1}});
  assert.equal(r.state,'PROPOSING');
  assert.deepEqual(r.actions.map((row)=>row.point_id),['meta.core']);
});

test('normal independent nodes still fill available frontier slots',()=>{
  const p=plan([node('meta.a',{priority:90}),node('meta.b',{priority:80}),node('meta.c',{priority:70})]);
  const r=run(p,{capacity:{available_slots:2}});
  assert.deepEqual(r.actions.map((row)=>row.point_id),['meta.a','meta.b']);
});

test('ready saturation blocks new frontier while preserving physical slots',()=>{
  const p=plan([node('meta.a',{priority:90}),node('meta.b',{priority:80})]);
  const r=run(p,{capacity:{available_slots:4,new_frontier_slots:0,pressure_state:'READY_SATURATED'}});
  assert.equal(r.state,'CAPACITY_WAIT');
  assert.equal(r.reason,'NEW_FRONTIER_PRESSURE_BUDGET_REQUIRED');
  assert.equal(r.actions[0].available_slots,4);
  assert.equal(r.actions[0].new_frontier_slots,0);
  assert.equal(r.actions[0].group_kind,'NEW_FRONTIER');
});

test('recovery debt can restrict growth to one normal point',()=>{
  const p=plan([node('meta.a',{priority:90}),node('meta.b',{priority:80})]);
  const r=run(p,{capacity:{available_slots:4,new_frontier_slots:1,pressure_state:'RECOVERY_DEBT_HIGH'}});
  assert.deepEqual(r.actions.map((row)=>row.point_id),['meta.a']);
  assert.equal(r.scheduler_pressure.available_slots,4);
  assert.equal(r.scheduler_pressure.new_frontier_slots,1);
});

test('critical primary may use one soft-pressure frontier slot without preallocating verifiers',()=>{
  const r=run(plan([node('meta.core',{risk:'CRITICAL'})]),{capacity:{available_slots:4,new_frontier_slots:1,pressure_state:'RECOVERY_DEBT_HIGH'}});
  assert.equal(r.state,'PROPOSING');
  assert.deepEqual(r.actions.map((row)=>row.point_id),['meta.core']);
});

test('running primary does not admit verifier before RESULT_READY',()=>{
  const p=plan([node('meta.risky',{risk:'HIGH',priority:50}),node('meta.new',{priority:100})]);
  const r=run(p,{tasks:[{point_id:'meta.risky',state:'RUNNING',lease_generation:1}],capacity:{available_slots:1}});
  assert.equal(r.actions.some((row)=>row.point_id==='meta.risky.critic'),false);
});

test('ready saturation does not block mandatory post-result verification',()=>{
  const p=plan([node('meta.risky',{risk:'HIGH',priority:50}),node('meta.new',{priority:100})]);
  const r=run(p,{
    tasks:[{point_id:'meta.risky',state:'RESULT_READY',lease_generation:1}],
    capacity:{available_slots:1,new_frontier_slots:0,pressure_state:'READY_SATURATED'},
  });
  assert.equal(r.state,'VERIFYING');
  assert.deepEqual(r.actions.map((row)=>row.point_id),['meta.risky.critic']);
});

test('critical RESULT_READY repairs only the missing verifier companion',()=>{
  const p=plan([node('meta.core',{risk:'CRITICAL'})]);
  const tasks=[
    {point_id:'meta.core',state:'RESULT_READY',lease_generation:2},
    {point_id:'meta.core.critic',state:'READY',lease_generation:1},
  ];
  const r=run(p,{tasks,capacity:{available_slots:1}});
  assert.equal(r.state,'VERIFYING');
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
    {point_id:'meta.core',state:'RESULT_READY',lease_generation:2},
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
  const r=run(plan([node('meta.core',{risk:'CRITICAL'})]),{capacity:{available_slots:3,new_frontier_slots:3,pressure_state:'NORMAL'}});
  assert.equal(assertZeroAuthorityMetaOutput(r),true);
});
