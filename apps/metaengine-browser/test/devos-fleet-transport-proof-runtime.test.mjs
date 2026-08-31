import assert from 'node:assert/strict';
import test from 'node:test';
import { DevOsNativeTaskCycle } from '../src/devos-native-task-cycle.mjs';
import { clearFleetRuntime, registerFleetRuntime } from '../src/fleet-runtime-bridge.mjs';

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
  task_spec: { objective: 'Prove the local transport before DB RUNNING.' },
};
const composer = { role: 'textbox', name: 'Message ChatGPT' };
const conversation = 'https://chatgpt.com/c/12345678-abcd-4abc-8abc-123456789abc';

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, async json() { return structuredClone(body); } };
}

function harness({ postTarget = lease.target_id } = {}) {
  let lifecycle = 'BOUND_UNVERIFIED';
  const order = [];
  const snapshot = () => ({
    schema: 'metaengine.browser.fleet-snapshot.v1',
    policy: { warm_agents: 1, spawn_burst_limit: 2 },
    agents: [{
      agent_id: lease.agent_id,
      role: lease.role,
      lifecycle_state: lifecycle,
      tab_id: lease.tab_id,
      target_id: lease.target_id,
      generation_epoch: lease.agent_generation_epoch,
      transport_proof: lifecycle === 'ACTIVE' ? { schema: 'metaengine.browser.fleet-transport-proof.v1' } : null,
    }],
  });
  const runtime = {
    snapshot,
    async markTransportProven(payload) {
      order.push('fleet-proof');
      assert.deepEqual({
        agent_id: payload.agent_id,
        tab_id: payload.tab_id,
        target_id: payload.target_id,
        generation_epoch: payload.generation_epoch,
        conversation_url: payload.conversation_url,
      }, {
        agent_id: lease.agent_id,
        tab_id: lease.tab_id,
        target_id: lease.target_id,
        generation_epoch: lease.agent_generation_epoch,
        conversation_url: conversation,
      });
      lifecycle = 'ACTIVE';
      return snapshot();
    },
  };

  let captures = 0;
  const executeCommand = async (command) => {
    if (command.action === 'FLEET_RECONCILE') return snapshot();
    if (command.action === 'SEMANTIC_TYPE') return { effect_state: 'PROVEN_GENERATING', stop_observed: true };
    if (command.action === 'CAPTURE') {
      captures += 1;
      return {
        schema: 'metaengine.native-browser.perception.v1',
        tab_id: lease.tab_id,
        target_id: captures === 1 ? lease.target_id : postTarget,
        process_incarnation_id: 'browser-process-incarnation-001',
        url: captures === 1 ? 'https://chatgpt.com/' : conversation,
        semantic_targets: captures === 1 ? [composer] : [composer, { role: 'button', name: 'Stop generating' }],
        authority_effect: false,
      };
    }
    throw new Error(`unexpected_action:${command.action}`);
  };
  const signedRequest = async (path) => {
    if (path === '/v1/devos/cycle') return response(200, { schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 1, running: 0 }, lease, running: [] });
    if (path === '/v1/devos/mark-running') {
      order.push('db-running');
      return response(200, { state: 'RUNNING' });
    }
    throw new Error(`unexpected_request:${path}`);
  };
  return { runtime, snapshot, executeCommand, signedRequest, order };
}

test('BOUND_UNVERIFIED native frame is durably proven before DB mark-running', async () => {
  const h = harness();
  registerFleetRuntime(h.runtime);
  const cycle = new DevOsNativeTaskCycle({ getState: async () => ({ fleet: h.snapshot() }), executeCommand: h.executeCommand, signedRequest: h.signedRequest });
  const out = await cycle.cycle();
  assert.equal(out.dispatch.state, 'RUNNING');
  assert.deepEqual(h.order, ['fleet-proof', 'db-running']);
  assert.equal(h.snapshot().agents[0].lifecycle_state, 'ACTIVE');
  assert.equal(out.fleet_transport_proof.state, 'PROVEN');
  assert.equal(out.fleet_transport_proof_before_db_running, true);
  clearFleetRuntime(h.runtime);
});

test('post-capture target replacement fails closed before fleet proof and DB running', async () => {
  const h = harness({ postTarget: 'webcontents:11' });
  registerFleetRuntime(h.runtime);
  const cycle = new DevOsNativeTaskCycle({ getState: async () => ({ fleet: h.snapshot() }), executeCommand: h.executeCommand, signedRequest: h.signedRequest });
  await assert.rejects(cycle.cycle(), /fleet_runtime_frame_target_mismatch/);
  assert.deepEqual(h.order, []);
  assert.equal(h.snapshot().agents[0].lifecycle_state, 'BOUND_UNVERIFIED');
  clearFleetRuntime(h.runtime);
});

test('BOUND_UNVERIFIED dispatch cannot claim DB running without registered local fleet runtime', async () => {
  const h = harness();
  clearFleetRuntime();
  const cycle = new DevOsNativeTaskCycle({ getState: async () => ({ fleet: h.snapshot() }), executeCommand: h.executeCommand, signedRequest: h.signedRequest });
  await assert.rejects(cycle.cycle(), /devos_fleet_runtime_transport_proof_unavailable/);
  assert.deepEqual(h.order, []);
});
