import assert from 'node:assert/strict';
import test from 'node:test';
import { DevOsNativeTaskCycle } from '../src/devos-native-task-cycle.mjs';
import { buildDevosRuntimeObservability } from '../src/devos-runtime-observability.mjs';

const AGENT_ID = 'agent_seedtest-1111';
const TAB_ID = 'tab_seedtest-2222-3333-4444-555555555555';
const TARGET_ID = 'webcontents:77';
const TASK_ID = '76543210-1111-4222-8333-444455556666';
const ROOT = 'https://chatgpt.com/';

const lease = {
  task_id: TASK_ID,
  agent_id: AGENT_ID,
  role: 'PLANNER',
  tab_id: TAB_ID,
  target_id: TARGET_ID,
  agent_generation_epoch: 3,
  lease_generation: 1,
  base_sha: 'db5c83db806197b38b37338cdaff1ce69b825c08',
  branch_name: 'work/devos-root-conversation-seed',
  automatic_retry_allowed: false,
  task_spec: { schema: 'metaengine.devos.task.v1', objective: 'Prove legacy root seed cannot bypass Agent promotion.' },
};

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) };
}

function rootFleet() {
  return {
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
  };
}

test('R98 legacy root seed is not a task-dispatch fallback when Agent promotion is unavailable', async () => {
  const fleet = rootFleet();
  const commands = [];
  const requests = [];
  const cycle = new DevOsNativeTaskCycle({
    getState: async () => ({
      fleet,
      active_tab: { tab_id: 'tab_supervisor' },
      tabs: [
        { tab_id: 'tab_supervisor', url: 'https://chatgpt.com/c/supervisor', selected: true },
        { tab_id: TAB_ID, url: ROOT, selected: false },
      ],
    }),
    executeCommand: async (command) => {
      commands.push(command.action);
      if (command.action === 'FLEET_RECONCILE') return fleet;
      throw new Error(`unexpected_effect:${command.action}`);
    },
    signedRequest: async (path) => {
      requests.push(path);
      if (path === '/v1/devos/promotion-lease') return response(404, { error: 'promotion_unavailable' });
      if (path === '/v1/devos/cycle') {
        return response(200, {
          schema: 'metaengine.devos.browser-cycle.v1',
          backlog: { ready: 1, running: 0 },
          lease,
          running: [],
        });
      }
      throw new Error(`unexpected_http:${path}`);
    },
  });

  await assert.rejects(() => cycle.cycle(), /devos_agent_state_invalid:ADMISSION_FENCED/);
  assert.deepEqual(commands, ['FLEET_RECONCILE']);
  assert.equal(commands.includes('SEMANTIC_TYPE'), false);
  assert.equal(requests.includes('/v1/devos/promotion-lease'), true);
  assert.equal(cycle.snapshot().bound_unverified_dispatch_allowed, false);
});

test('dispatch observability remains bounded and distinguishes historical seed evidence without granting authority', () => {
  const projection = buildDevosRuntimeObservability({
    devos_task_cycle: {
      dispatch_effect: {
        last: {
          at: '2026-09-21T08:30:00.000Z',
          stage: 'SEED',
          state: 'SEED_CONVERSATION_PROVEN',
          effect_state: 'PROVEN_NEW_CONVERSATION',
          task_id: TASK_ID,
          agent_id: AGENT_ID,
          composer_chars_before: 40000,
        },
        counters: { dispatches: 2, proven: 1, ambiguous: 1, seed_attempts: 2, seed_proven: 1, flush_over_limit: 0 },
      },
    },
  });
  assert.equal(projection.dispatch.last_state, 'SEED_CONVERSATION_PROVEN');
  assert.equal(projection.dispatch.last_stage, 'SEED');
  assert.equal(projection.dispatch.last_effect_state, 'PROVEN_NEW_CONVERSATION');
  assert.equal(projection.dispatch.last_composer_chars_before, 40000);
  assert.equal(projection.dispatch.seed_attempts, 2);
  assert.equal(projection.dispatch.seed_proven, 1);
  assert.equal(projection.dispatch.authority_effect, false);
  const empty = buildDevosRuntimeObservability({});
  assert.equal(empty.dispatch.last_state, null);
  assert.equal(empty.dispatch.dispatches, null);
});
