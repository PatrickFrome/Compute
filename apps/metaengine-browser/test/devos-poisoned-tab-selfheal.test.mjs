import assert from 'node:assert/strict';
import test from 'node:test';
import { DevOsNativeTaskCycle } from '../src/devos-native-task-cycle.mjs';

const AGENT_ID = 'agent_selfheal-1111';
const TAB_ID = 'tab_selfheal-2222-3333-4444-555555555555';
const TARGET_ID = 'webcontents:77';
const TASK_ID = '86543210-1111-4222-8333-444455556666';
const ROOT = 'https://chat.z.ai/';

const lease = {
  task_id: TASK_ID,
  agent_id: AGENT_ID,
  role: 'PLANNER',
  tab_id: TAB_ID,
  target_id: TARGET_ID,
  agent_generation_epoch: 3,
  lease_generation: 1,
  base_sha: 'db5c83db806197b38b37338cdaff1ce69b825c08',
  branch_name: 'work/devos-poisoned-tab-selfheal',
  automatic_retry_allowed: false,
  task_spec: { schema: 'metaengine.devos.task.v1', objective: 'Prove dirty Chat root never becomes task authority.' },
};

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) };
}

function state() {
  return {
    tabs: [
      { tab_id: 'tab_supervisor', url: 'https://chat.z.ai/c/supervisor', selected: true },
      { tab_id: TAB_ID, url: ROOT, selected: false },
    ],
    active_tab: { tab_id: 'tab_supervisor' },
    fleet: {
      schema: 'metaengine.browser.fleet-snapshot.v1',
      readiness_contract: 'TRANSPORT_PROOF_REQUIRED',
      policy: { warm_agents: 0, desired_agents: 1, spawn_burst_limit: 1 },
      agents: [{
        agent_id: AGENT_ID,
        role: 'PLANNER',
        ownership: 'FLEET_OWNED',
        lifecycle_state: 'BOUND_UNVERIFIED',
        tab_id: TAB_ID,
        target_id: TARGET_ID,
        generation_epoch: 3,
        transport_proof: {
          schema: 'metaengine.browser.fleet-transport-proof.v1',
          transport_stage: 'PRECONVERSATION_ROOT',
          tab_id: TAB_ID,
          target_id: TARGET_ID,
          generation_epoch: 3,
          conversation_url_sha256: 'a'.repeat(64),
          proven_at: '2026-09-28T00:00:00.000Z',
          authority_effect: false,
        },
        automatic_retry_allowed: false,
        authority_effect: false,
      }],
      authority_effect: false,
    },
  };
}

async function runLegacyRootFence() {
  const commands = [];
  const cycle = new DevOsNativeTaskCycle({
    getState: async () => state(),
    executeCommand: async (command) => {
      commands.push(command.action);
      if (command.action === 'FLEET_RECONCILE') return state().fleet;
      throw new Error(`unexpected_effect:${command.action}`);
    },
    signedRequest: async (path) => {
      if (path === '/v1/devos/promotion-lease') return response(404, { error: 'promotion_unavailable' });
      if (path === '/v1/devos/cycle') {
        return response(200, { schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 1, running: 0 }, lease, running: [] });
      }
      throw new Error(`unexpected_http:${path}`);
    },
  });
  await assert.rejects(() => cycle.cycle(), /devos_agent_state_invalid:ADMISSION_FENCED/);
  return { cycle, commands };
}

test('R98 poisoned root is fenced before seed/type/close task effects', async () => {
  const { cycle, commands } = await runLegacyRootFence();
  assert.deepEqual(commands, ['FLEET_RECONCILE']);
  assert.equal(commands.includes('SEMANTIC_TYPE'), false);
  assert.equal(commands.includes('CLOSE_TAB'), false);
  assert.equal(cycle.snapshot().bound_unverified_dispatch_allowed, false);
});

test('R98 root cleanliness cannot upgrade a Chat root into task authority', async () => {
  const { commands } = await runLegacyRootFence();
  assert.equal(commands.includes('CAPTURE'), false, 'scheduler does not inspect root composer after promotion failed');
  assert.equal(commands.includes('SEMANTIC_TYPE'), false);
});
