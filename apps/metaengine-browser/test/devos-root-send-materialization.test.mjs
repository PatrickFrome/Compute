import test from 'node:test';
import assert from 'node:assert/strict';
import { DevOsNativeTaskCycle } from '../src/devos-native-task-cycle.mjs';

const lease = {
  task_id: '09f2e414-5c31-4fc7-87a3-f5de1315cb81',
  agent_id: 'agent_a2bf77e6-66d3-4f10-9c9c-683df36f4510',
  role: 'IMPLEMENTER',
  tab_id: 'tab_ff91dce7-eeb3-425d-9052-94d521c2dfa6',
  target_id: 'webcontents:10',
  agent_generation_epoch: 7,
  lease_generation: 1,
  base_sha: '724612235eb7ceb4534c13d126425b274d876394',
  branch_name: 'work/devos-native-task-dispatch-v1',
  automatic_retry_allowed: false,
  task_spec: { schema: 'metaengine.devos.task.v1', objective: 'Implement safe slice.' },
};
const proof = {
  schema: 'metaengine.browser.fleet-transport-proof.v1',
  tab_id: lease.tab_id,
  target_id: lease.target_id,
  generation_epoch: 7,
  transport_stage: 'PRECONVERSATION_ROOT',
  conversation_url_sha256: 'a'.repeat(64),
  proven_at: '2026-09-18T16:00:00.000Z',
  authority_effect: false,
};
const fleet = {
  schema: 'metaengine.browser.fleet-snapshot.v1',
  readiness_contract: 'TRANSPORT_PROOF_REQUIRED',
  policy: { warm_agents: 1, spawn_burst_limit: 4 },
  agents: [{
    agent_id: lease.agent_id,
    role: lease.role,
    lifecycle_state: 'ACTIVE',
    tab_id: lease.tab_id,
    target_id: lease.target_id,
    generation_epoch: 7,
    transport_proof: proof,
    automatic_retry_allowed: false,
    authority_effect: false,
  }],
};
const composer = { role: 'textbox', name: null, semantic_ref: { schema: 'metaengine.native-browser.semantic-ref.v1', semantic_ref_id: 'semref_' + 'c'.repeat(64) }, backend_node_id: 3 };
const send = { role: 'button', name: 'Send prompt' };
const stop = { role: 'button', name: 'Stop generating' };
const conversationUrl = 'https://chatgpt.com/c/12345678-abcd-4abc-8abc-123456789abc';
const supervisorTab = 'tab_supervisor';

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, async json(){ return structuredClone(body); } };
}
function frame({ sendVisible, conversation = false } = {}) {
  return {
    tab_id: lease.tab_id,
    target_id: lease.target_id,
    url: conversation ? conversationUrl : 'https://chatgpt.com/',
    viewport: { width: 1200, height: 640 },
    semantic_targets: [composer, ...(sendVisible ? [send] : []), ...(conversation ? [stop] : [])],
    authority_effect: false,
  };
}
function state(selected) {
  return {
    fleet,
    active_tab: { tab_id: selected },
    tabs: [
      { tab_id: supervisorTab, selected: selected === supervisorTab },
      { tab_id: lease.tab_id, selected: selected === lease.tab_id },
    ],
  };
}

test('R98 direct root task materialization is fenced before any composer effect', async () => {
  const calls = [];
  const cycle = new DevOsNativeTaskCycle({
    getState: async () => state(supervisorTab),
    executeCommand: async (command) => {
      calls.push(command.action);
      if (command.action === 'FLEET_RECONCILE') return fleet;
      throw new Error(`unexpected_effect:${command.action}`);
    },
    signedRequest: async (path) => {
      if (path === '/v1/devos/promotion-lease') return response(404, { error: 'not_ready' });
      if (path === '/v1/devos/cycle') {
        return response(200, { schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 1, running: 0 }, lease, running: [] });
      }
      throw new Error(`unexpected_request:${path}`);
    },
  });

  await assert.rejects(() => cycle.cycle(), /devos_agent_state_invalid:ADMISSION_FENCED/);
  assert.deepEqual(calls, ['FLEET_RECONCILE']);
  assert.equal(cycle.snapshot().bound_unverified_dispatch_allowed, false);
});
