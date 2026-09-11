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
  task_spec: { objective: 'Use an already transport-proven Browser incarnation.' },
};
const composer = { role: 'textbox', name: 'Message ChatGPT' };
const send = { role: 'button', name: 'Send prompt' };
const stop = { role: 'button', name: 'Stop generating' };
const conversation = 'https://chatgpt.com/c/12345678-abcd-4abc-8abc-123456789abc';
const supervisorTab = 'tab_supervisor';
const fleetProof = {
  schema: 'metaengine.browser.fleet-transport-proof.v1',
  tab_id: lease.tab_id,
  target_id: lease.target_id,
  generation_epoch: lease.agent_generation_epoch,
  conversation_url_sha256: 'b'.repeat(64),
  proven_at: '2026-08-31T18:00:00.000Z',
  authority_effect: false,
};

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, async json() { return structuredClone(body); } };
}

function harness({ lifecycle = 'ACTIVE', proof = fleetProof, postTarget = lease.target_id } = {}) {
  let selectedTab = supervisorTab;
  const order = [];
  const commands = [];
  const snapshot = () => ({
    schema: 'metaengine.browser.fleet-snapshot.v1',
    readiness_contract: 'TRANSPORT_PROOF_REQUIRED',
    policy: { warm_agents: 1, spawn_burst_limit: 2 },
    agents: [{
      agent_id: lease.agent_id,
      role: lease.role,
      lifecycle_state: lifecycle,
      tab_id: lease.tab_id,
      target_id: lease.target_id,
      generation_epoch: lease.agent_generation_epoch,
      transport_proof: proof ? structuredClone(proof) : null,
      automatic_retry_allowed: false,
      authority_effect: false,
    }],
  });
  const state = () => ({
    fleet: snapshot(),
    active_tab: { tab_id: selectedTab },
    tabs: [
      { tab_id: supervisorTab, selected: selectedTab === supervisorTab },
      { tab_id: lease.tab_id, selected: selectedTab === lease.tab_id },
    ],
  });

  const runtime = {
    snapshot,
    async markTransportProven() {
      order.push('forbidden-late-fleet-proof');
      throw new Error('late_transport_promotion_must_not_run');
    },
  };

  let captures = 0;
  const executeCommand = async (command) => {
    commands.push(command.action);
    if (command.action === 'FLEET_RECONCILE') return snapshot();
    if (command.action === 'SELECT_TAB') {
      selectedTab = command.payload.tab_id;
      return { ok: true, tab_id: selectedTab };
    }
    if (command.action === 'SEMANTIC_TYPE') {
      assert.equal(command.payload.submit_after_type, false);
      return { authority_effect: true };
    }
    if (command.action === 'TYPED_CLICK') return { authority_effect: true };
    if (command.action === 'CAPTURE') {
      captures += 1;
      const post = captures >= 3;
      return {
        schema: 'metaengine.native-browser.perception.v1',
        tab_id: lease.tab_id,
        target_id: post ? postTarget : lease.target_id,
        process_incarnation_id: 'browser-process-incarnation-001',
        url: post ? conversation : 'https://chatgpt.com/',
        viewport: { width: 1200, height: 640 },
        semantic_targets: post ? [composer, stop] : [composer, send],
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
  return { runtime, snapshot, state, executeCommand, signedRequest, order, commands, selected: () => selectedTab };
}

test('BOUND_UNVERIFIED is rejected before Browser selection even if a local fleet runtime is registered', async () => {
  const h = harness({ lifecycle: 'BOUND_UNVERIFIED', proof: null });
  registerFleetRuntime(h.runtime);
  const cycle = new DevOsNativeTaskCycle({ getState: h.state, executeCommand: h.executeCommand, signedRequest: h.signedRequest });
  await assert.rejects(() => cycle.cycle(), /devos_agent_state_invalid:ADMISSION_FENCED/);
  assert.deepEqual(h.order, []);
  assert.deepEqual(h.commands, ['FLEET_RECONCILE']);
  assert.equal(h.selected(), supervisorTab);
  clearFleetRuntime(h.runtime);
});

test('ACTIVE exact fleet proof is revalidated before DB mark-running and late promotion is never invoked', async () => {
  const h = harness();
  registerFleetRuntime(h.runtime);
  const cycle = new DevOsNativeTaskCycle({ getState: h.state, executeCommand: h.executeCommand, signedRequest: h.signedRequest });
  const out = await cycle.cycle();
  assert.equal(out.dispatch.state, 'RUNNING');
  assert.deepEqual(h.order, ['db-running']);
  assert.equal(out.fleet_transport_proof.state, 'PREEXISTING_ACTIVE_PROOF_REVALIDATED');
  assert.equal(out.fleet_transport_proof_before_physical_dispatch, true);
  assert.equal(out.bound_unverified_dispatch_allowed, false);
  assert.equal(h.selected(), supervisorTab);
  clearFleetRuntime(h.runtime);
});

test('ACTIVE with missing or drifted transport proof is fenced before Browser effect', async () => {
  const missing = harness({ lifecycle: 'ACTIVE', proof: null });
  const missingCycle = new DevOsNativeTaskCycle({ getState: missing.state, executeCommand: missing.executeCommand, signedRequest: missing.signedRequest });
  await assert.rejects(() => missingCycle.cycle(), /devos_agent_state_invalid:ADMISSION_FENCED/);
  assert.deepEqual(missing.commands, ['FLEET_RECONCILE']);

  const drifted = structuredClone(fleetProof);
  drifted.target_id = 'webcontents:11';
  const h = harness({ lifecycle: 'ACTIVE', proof: drifted });
  const cycle = new DevOsNativeTaskCycle({ getState: h.state, executeCommand: h.executeCommand, signedRequest: h.signedRequest });
  await assert.rejects(() => cycle.cycle(), /devos_agent_state_invalid:ADMISSION_FENCED/);
  assert.deepEqual(h.commands, ['FLEET_RECONCILE']);
});

test('post-send native target replacement still fails closed before DB running', async () => {
  const h = harness({ postTarget: 'webcontents:11' });
  const cycle = new DevOsNativeTaskCycle({ getState: h.state, executeCommand: h.executeCommand, signedRequest: h.signedRequest });
  await assert.rejects(() => cycle.cycle(), /devos_transport_active_frame_target_mismatch/);
  assert.deepEqual(h.order, []);
  assert.equal(h.selected(), supervisorTab);
});
