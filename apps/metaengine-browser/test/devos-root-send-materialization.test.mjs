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
const composer = { role: 'textbox', name: 'Message ChatGPT' };
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

test('root dispatch types before Send exists, then requires fresh Send and clicks once', async () => {
  const calls = [];
  let selected = supervisorTab;
  let captures = 0;
  const cycle = new DevOsNativeTaskCycle({
    getState: async () => state(selected),
    executeCommand: async (command) => {
      calls.push(command.action);
      if (command.action === 'FLEET_RECONCILE') return fleet;
      if (command.action === 'SELECT_TAB') {
        selected = command.payload.tab_id;
        return { tab_id: selected, authority_effect: false };
      }
      if (command.action === 'CAPTURE') {
        captures += 1;
        if (captures === 1) return frame({ sendVisible: false });
        if (captures === 2) return frame({ sendVisible: true });
        return frame({ sendVisible: false, conversation: true });
      }
      if (command.action === 'SEMANTIC_TYPE') {
        assert.equal(command.payload.submit_after_type, false);
        return { authority_effect: true };
      }
      if (command.action === 'TYPED_CLICK') return { authority_effect: true };
      throw new Error('unexpected_action');
    },
    signedRequest: async (path) => {
      if (path === '/v1/devos/cycle') {
        return response(200, { schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 1, running: 0 }, lease, running: [] });
      }
      if (path === '/v1/devos/mark-running') return response(200, { state: 'RUNNING' });
      throw new Error('unexpected_request');
    },
  });

  const result = await cycle.cycle();
  assert.equal(result.dispatch.state, 'RUNNING');
  assert.equal(result.dispatch.proof.effect_state, 'PROVEN_GENERATING');
  assert.equal(calls.filter((x) => x === 'SEMANTIC_TYPE').length, 1);
  assert.equal(calls.filter((x) => x === 'TYPED_CLICK').length, 1);
  assert.ok(calls.indexOf('TYPED_CLICK') > calls.indexOf('SEMANTIC_TYPE'));
  assert.equal(selected, supervisorTab);
});
