import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserBrainRoutingV2, planAdaptiveSparseFanout } from '../src/browser-brain-routing-v2.mjs';

for (const [budget, unit] of [[0, 1], [0.99, 1], [-1, 1], [Infinity, 1], [1, NaN], [1, 0], [1, -1]]) {
  test(`no agent is allocated outside a valid affordable budget (${budget}, ${unit})`, () => {
    const plan = planAdaptiveSparseFanout({ parallelizability: 1, cost_budget_units: budget, unit_cost_per_agent: unit });
    assert.equal(plan.fanout, 0);
    assert.equal(plan.estimated_cost_units, 0);
    assert.ok(plan.blocked_reason);
  });
}

test('verification cannot silently degrade to a single evaluator', () => {
  const denied = planAdaptiveSparseFanout({ verification_mode: true, cost_budget_units: 1 });
  assert.equal(denied.fanout, 0);
  assert.equal(denied.blocked_reason, 'INDEPENDENT_VERIFICATION_UNAFFORDABLE');
  const allowed = planAdaptiveSparseFanout({ verification_mode: true, cost_budget_units: 2 });
  assert.equal(allowed.fanout, 2);
  assert.equal(allowed.independent_verification_possible, true);
});

test('all finite positive fanouts respect total cost, including fractional agent costs', () => {
  for (const budget of [0, 0.1, 0.9, 1, 2, 5, 100]) for (const unit of [0.01, 0.1, 0.3, 1, 7]) {
    const plan = planAdaptiveSparseFanout({ parallelizability: 1, cost_budget_units: budget, unit_cost_per_agent: unit });
    assert.ok(plan.fanout >= 0 && plan.fanout <= 5);
    assert.ok(plan.estimated_cost_units <= budget);
  }
});

test('stale routing observations expire and cannot be resurrected by a delayed generation or timestamp', () => {
  let now = 10_000;
  const routing = new BrowserBrainRoutingV2({ clock: () => now, observationTtlMs: 30_000 });
  const agent = { agent_id: 'agent.implementer', capabilities: ['coding'], status: 'READY', generation: 2 };
  routing.observeAgent(agent);
  assert.equal(routing.route({ required_capabilities: ['coding'] }).candidates.length, 1);
  now = 40_001;
  assert.equal(routing.route({ required_capabilities: ['coding'] }).candidates.length, 0);
  assert.throws(() => routing.observeAgent({ ...agent, generation: 1 }), /generation_regression/);
  assert.throws(() => routing.observeAgent({ ...agent, observed_at_ms: 9_999 }), /observation_regression/);
  assert.throws(() => routing.observeAgent({ ...agent, observed_at_ms: now + 5_001 }), /observation_time_invalid/);
  routing.observeAgent({ ...agent, generation: 3 });
  assert.equal(routing.route({ required_capabilities: ['coding'] }).candidates[0].generation, 3);
});
