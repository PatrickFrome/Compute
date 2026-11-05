import assert from 'node:assert/strict';
import test from 'node:test';
import { assertZeroAuthorityMetaOutput, compileMetaPlan } from '../src/meta-orchestrator-core.mjs';
import { buildMetaAuthoritativeSnapshot, reconcileMetaAuthoritativeSnapshot } from '../src/meta-orchestrator-authoritative-snapshot.mjs';

const SHA = 'd91e94b307ed60e890aabc53a2678a8ae9c6a79d';
const authority = {
  authority_key: 'METAENGINE_DEVOS',
  roadmap_id: 'compute-unified-v1',
  active_milestone_key: 'META_ORCHESTRATOR_V1',
  integration_line: 'work/source-transfer-c26565e-20261103',
  baseline_sha: SHA,
  alignment_epoch: 7,
};
const makePlan = (risk = 'HIGH') => compileMetaPlan({
  authority,
  plan_generation: 3,
  nodes: [{
    point_id: 'meta.core',
    role: 'IMPLEMENTER',
    objective: 'Pure parent/child safety test',
    risk,
    evidence_contract: { required: ['roadmap_receipt:ci_green'], min_verified: 1 },
  }],
});
function task(plan, point_id, state, id = 1, lease_generation = 1, plan_generation = 3) {
  return {
    task_id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    point_id,
    state,
    role: point_id === 'meta.core' ? 'IMPLEMENTER' : 'CRITIC',
    base_sha: SHA,
    lease_generation,
    authority_effect: false,
    task_spec: {
      meta_orchestrator: {
        roadmap_id: plan.roadmap_id,
        alignment_epoch: plan.alignment_epoch,
        plan_generation,
        parent_plan_point: 'meta.core',
        parent_point_id: point_id === 'meta.core' ? null : 'meta.core',
      },
    },
  };
}
function run({ risk = 'HIGH', children = [], observedPlanGeneration = 3, additionalParents = [] } = {}) {
  const plan = makePlan(risk);
  const tasks = [task(plan, 'meta.core', 'COMPLETED'), ...additionalParents.map((row, i) =>
    task(plan, 'meta.core', row.state, 100 + i, row.lease_generation)),
  ...children.map((row, i) =>
    task(plan, row.point_id ?? 'meta.core.critic', row.state, i + 2, row.lease_generation ?? 1,
      row.plan_generation ?? 3))];
  const snapshot = buildMetaAuthoritativeSnapshot({
    roadmapAuthority: authority,
    plan,
    observedPlanGeneration,
    tasks,
    roadmapReceipts: [{
      roadmap_id: plan.roadmap_id,
      milestone_key: 'meta.core',
      step_kind: 'CI_GREEN',
      status: 'VERIFIED',
      result_checkpoint_id: 'durable_checkpoint_test_001',
    }],
    capacity: { source: 'DEVOS_SCHEDULER_SNAPSHOT', available_slots: 0 },
  });
  const result = reconcileMetaAuthoritativeSnapshot({
    plan, snapshot, leader: { expected_epoch: 4, observed_epoch: 4 },
  });
  assert.equal(assertZeroAuthorityMetaOutput(result), true);
  assert.equal(result.actions.some((action) => String(action.type).includes('RETRY')), false);
  return { result, snapshot };
}

for (const [state, expected] of [
  ['READY', 'SAFETY_WAIT'],
  ['RUNNING', 'SAFETY_WAIT'],
  ['RESULT_READY', 'SAFETY_WAIT'],
  ['AMBIGUOUS', 'RECONCILING'],
  ['FAILED', 'BLOCKED'],
  ['CANCELLED', 'BLOCKED'],
  ['FENCED', 'BLOCKED'],
  ['COMPLETED', 'CONVERGED'],
]) {
  test(`authoritative snapshot: required child ${state} -> ${expected}`, () => {
    const { result } = run({ children: [{ state }] });
    assert.equal(result.state, expected);
    if (state === 'AMBIGUOUS') {
      assert.equal(result.actions[0].type, 'REQUEST_RECONCILIATION');
      assert.equal(result.actions[0].automatic_retry_allowed, false);
    }
  });
}

test('required child missing cannot masquerade as completed', () => {
  assert.equal(run().result.state, 'CAPACITY_WAIT');
});
test('old plan-generation child cannot satisfy current companion requirement', () => {
  assert.equal(run({ children: [{ state: 'COMPLETED', plan_generation: 2 }] }).result.state, 'CAPACITY_WAIT');
});
test('stale observed plan generation fences completion', () => {
  assert.equal(run({ children: [{ state: 'COMPLETED' }], observedPlanGeneration: 4 }).result.state, 'STALE');
});
test('partial failure: completed critic never masks failed falsifier', () => {
  const { result } = run({ risk: 'CRITICAL', children: [
    { point_id: 'meta.core.critic', state: 'COMPLETED' },
    { point_id: 'meta.core.falsifier', state: 'FAILED' },
  ] });
  assert.equal(result.state, 'BLOCKED');
});
test('normal-risk plan still waits for observed non-safety descendant', () => {
  const { result } = run({ risk: 'NORMAL', children: [{ point_id: 'meta.core.aux', state: 'RUNNING' }] });
  assert.equal(result.state, 'SAFETY_WAIT');
});
test('generic descendant ambiguity requests readback without automatic retry', () => {
  const { result } = run({ risk: 'NORMAL', children: [{ point_id: 'meta.core.aux', state: 'AMBIGUOUS' }] });
  assert.equal(result.state, 'RECONCILING');
  assert.equal(result.actions[0].automatic_retry_allowed, false);
});
test('older ambiguous child effect is not hidden by a newer completed lease', () => {
  const { result } = run({ risk: 'NORMAL', children: [
    { point_id: 'meta.core.aux', state: 'AMBIGUOUS', lease_generation: 1 },
    { point_id: 'meta.core.aux', state: 'COMPLETED', lease_generation: 2 },
  ] });
  assert.equal(result.state, 'RECONCILING');
});
test('older ambiguous parent effect is not hidden by a newer completed lease', () => {
  const { result } = run({ risk: 'NORMAL', additionalParents: [
    { state: 'AMBIGUOUS', lease_generation: 0 },
  ] });
  assert.equal(result.state, 'RECONCILING');
});
test('observer does not introduce a global child or agent ceiling', () => {
  const children = Array.from({ length: 140 }, (_, i) => ({
    point_id: `meta.core.child${i}`,
    state: i === 139 ? 'RUNNING' : 'COMPLETED',
  }));
  const { result, snapshot } = run({ risk: 'NORMAL', children });
  assert.equal(snapshot.tasks.length, 141);
  assert.equal(result.state, 'SAFETY_WAIT');
});
test('unknown child state is fenced instead of interpreted as success', () => {
  assert.equal(run({ risk: 'NORMAL', children: [{ point_id: 'meta.core.aux', state: 'UNRECOGNIZED' }] }).result.state, 'BLOCKED');
});
