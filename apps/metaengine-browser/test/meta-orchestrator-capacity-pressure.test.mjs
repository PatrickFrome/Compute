import assert from 'node:assert/strict';
import test from 'node:test';
import { projectMetaSchedulerPressure } from '../src/meta-orchestrator-capacity-pressure.mjs';

function snapshot(overrides={}){
  return {
    schema:'metaengine.devos.scheduler-capacity.v1',
    state:'FRESH',
    source:'DEVOS_SCHEDULER_SNAPSHOT',
    available_slots:3,
    new_frontier_slots:3,
    live_transport_slots:4,
    ready_backlog:1,
    leased_backlog:0,
    running_backlog:1,
    result_ready_backlog:0,
    ambiguous_backlog:2,
    blocked_backlog:0,
    active_claims:1,
    ready_backlog_limit:8,
    ambiguity_pressure_limit:8,
    pressure_state:'NORMAL',
    pressure_policy:'RECOVERY_AWARE_FRONTIER_V1',
    automatic_retry_allowed:false,
    authority_effect:false,
    ...overrides,
  };
}

test('normal scheduler pressure preserves only bounded aggregate counters',()=>{
  const out=projectMetaSchedulerPressure(snapshot(),{expectedAvailableSlots:3});
  assert.equal(out.available_slots,3);
  assert.equal(out.new_frontier_slots,3);
  assert.equal(out.pressure_state,'NORMAL');
  assert.equal(out.scheduler_authority,false);
  assert.equal('by_role' in out,false);
});

test('ready saturation closes only new frontier budget',()=>{
  const out=projectMetaSchedulerPressure(snapshot({ready_backlog:8,new_frontier_slots:0,pressure_state:'READY_SATURATED'}),{expectedAvailableSlots:3});
  assert.equal(out.available_slots,3);
  assert.equal(out.new_frontier_slots,0);
});

test('high recovery debt allows at most one new frontier slot without hiding physical repair capacity',()=>{
  const out=projectMetaSchedulerPressure(snapshot({ambiguous_backlog:8,new_frontier_slots:1,pressure_state:'RECOVERY_DEBT_HIGH'}),{expectedAvailableSlots:3});
  assert.equal(out.available_slots,3);
  assert.equal(out.new_frontier_slots,1);
});

test('capacity disagreement between old membrane and pressure projection is fenced',()=>{
  assert.throws(()=>projectMetaSchedulerPressure(snapshot(),{expectedAvailableSlots:2}),/capacity_projection_drift/);
});

test('fresh pressure state cannot claim inconsistent saturation or recovery debt',()=>{
  assert.throws(()=>projectMetaSchedulerPressure(snapshot({pressure_state:'READY_SATURATED',new_frontier_slots:0}),{expectedAvailableSlots:3}),/ready_saturation_inconsistent/);
  assert.throws(()=>projectMetaSchedulerPressure(snapshot({pressure_state:'RECOVERY_DEBT_HIGH',new_frontier_slots:1}),{expectedAvailableSlots:3}),/recovery_debt_inconsistent/);
});

test('non-fresh state must fail closed to zero',()=>{
  const out=projectMetaSchedulerPressure(snapshot({state:'STALE_FAIL_CLOSED',available_slots:0,new_frontier_slots:0,pressure_state:'CAPACITY_UNAVAILABLE'}),{expectedAvailableSlots:0});
  assert.equal(out.available_slots,0);
  assert.equal(out.new_frontier_slots,0);
  assert.throws(()=>projectMetaSchedulerPressure(snapshot({state:'STALE_FAIL_CLOSED',new_frontier_slots:0,pressure_state:'CAPACITY_UNAVAILABLE'}),{expectedAvailableSlots:3}),/fail_closed_state_inconsistent/);
});
