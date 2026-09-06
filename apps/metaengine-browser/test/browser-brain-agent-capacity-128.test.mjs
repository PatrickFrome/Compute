import test from 'node:test';
import assert from 'node:assert/strict';

import { BrowserBrainCognitionFabric } from '../src/browser-brain-cognition-fabric.mjs';

const tab = (n) => `tab_00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function agent(n, { status = 'READY', generation = 1 } = {}) {
  return {
    agent_id: `agent.capacity.${String(n).padStart(3, '0')}`,
    role: n % 5 === 0 ? 'CRITIC' : n % 3 === 0 ? 'RESEARCHER' : 'WORKER',
    provider: n % 2 === 0 ? 'openai' : 'provider-b',
    capabilities: ['observe', 'reason'],
    generation,
    status,
    target_tab_id: tab(((n - 1) % 128) + 1),
    observed_at: new Date(1_800_000_000_000 + n).toISOString(),
  };
}

test('default cognition retains 128 bounded agent observations while routes stay advisory and batch-bounded', () => {
  const fabric = new BrowserBrainCognitionFabric();
  assert.equal(fabric.snapshot().max_agents, 128);

  for (let i = 1; i <= 128; i += 1) fabric.observeAgent(agent(i));
  const full = fabric.snapshot();
  assert.equal(full.agent_count, 128);
  assert.equal(full.max_agents, 128);
  assert.equal(full.bounded_memory, true);

  const route = fabric.routeAgents({ required_capabilities: ['observe', 'reason'], limit: 999 });
  assert.equal(route.candidates.length, 64);
  assert.equal(route.selection_is_advisory, true);
  assert.equal(route.assignment_created, false);
  assert.equal(route.command_leasing, false);
  assert.equal(route.scheduler_authority, false);
  assert.equal(route.execution_authority, false);
  assert.equal(route.authority_effect, false);

  assert.throws(
    () => fabric.observeAgent(agent(129)),
    /browser_brain_cognition_agent_capacity_exceeded/,
  );

  fabric.observeAgent(agent(1, { status: 'LOST', generation: 2 }));
  fabric.observeAgent(agent(129));
  const replaced = fabric.snapshot();
  assert.equal(replaced.agent_count, 128);
  assert.equal(replaced.max_agents, 128);
  assert.equal(replaced.agent_updates, 130);
  assert.equal(replaced.bounded_memory, true);
  assert.equal(replaced.second_scheduler, false);
  assert.equal(replaced.automatic_effect_retry_allowed, false);
});
