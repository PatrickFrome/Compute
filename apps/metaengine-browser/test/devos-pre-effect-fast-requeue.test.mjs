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
  lease_generation: 3,
  base_sha: '724612235eb7ceb4534c13d126425b274d876394',
  branch_name: 'work/devos-pre-effect-fast-requeue',
  automatic_retry_allowed: false,
  task_spec: {
    schema: 'metaengine.devos.task.v1',
    objective: 'Implement one safe bounded repair.',
    constraints: ['no main merge'],
    deliverable: 'commit tests',
  },
};

const fleet = {
  schema: 'metaengine.browser.fleet-snapshot.v1',
  readiness_contract: 'TRANSPORT_PROOF_REQUIRED',
  policy: { warm_agents: 1, spawn_burst_limit: 2 },
  agents: [{
    agent_id: lease.agent_id,
    role: lease.role,
    ownership: 'FLEET_OWNED',
    lifecycle_state: 'ACTIVE',
    tab_id: lease.tab_id,
    target_id: lease.target_id,
    generation_epoch: lease.agent_generation_epoch,
    transport_proof: {
      schema: 'metaengine.browser.fleet-transport-proof.v1',
      transport_stage: 'PRECONVERSATION_ROOT',
      tab_id: lease.tab_id,
      target_id: lease.target_id,
      generation_epoch: lease.agent_generation_epoch,
      conversation_url_sha256: 'a'.repeat(64),
      proven_at: '2026-09-02T18:00:00.000Z',
      authority_effect: false,
    },
    automatic_retry_allowed: false,
    authority_effect: false,
  }],
};

const composer = { role: 'textbox', name: 'Message ChatGPT' };
const send = { role: 'button', name: 'Send prompt' };
const supervisorTab = 'tab_supervisor';

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, async json() { return structuredClone(body); } };
}

function browserState(selected = supervisorTab) {
  return {
    fleet,
    active_tab: { tab_id: selected },
    tabs: [
      { tab_id: supervisorTab, selected: selected === supervisorTab },
      { tab_id: lease.tab_id, selected: selected === lease.tab_id },
    ],
  };
}

function frame({ targetId = lease.target_id, viewport = { width: 1200, height: 640 } } = {}) {
  return {
    schema: 'metaengine.native-browser.perception.v1',
    tab_id: lease.tab_id,
    target_id: targetId,
    url: 'https://chatgpt.com/',
    viewport,
    semantic_targets: [composer, send],
    authority_effect: false,
  };
}

function readyReconciliation() {
  return {
    schema: 'metaengine.devos.ambiguity-reconciliation.v1',
    task_id: lease.task_id,
    lease_generation: lease.lease_generation,
    state: 'READY',
    recovery_class: 'PRE_EFFECT_ABORTED',
    retry_via_scheduler: true,
    physical_effect_replayed: false,
    new_lease_generation_allocated: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

function harness({ captureFrame }) {
  let selected = supervisorTab;
  const commands = [];
  const requests = [];
  let recoveryPayload = null;
  const signedRequest = async (requestPath, request = {}) => {
    requests.push(requestPath);
    if (requestPath === '/v1/devos/promotion-lease') return response(404, { error: 'not_needed' });
    if (requestPath === '/v1/devos/cycle') {
      return response(200, {
        schema: 'metaengine.devos.browser-cycle.v1',
        backlog: { ready: 1, running: 0 },
        lease,
        running: [],
      });
    }
    if (requestPath === '/v1/devos/reconcile-ambiguous') {
      recoveryPayload = structuredClone(request.payload);
      return response(200, readyReconciliation());
    }
    throw new Error(`unexpected_request:${requestPath}`);
  };
  const executeCommand = async (command) => {
    commands.push(command.action);
    if (command.action === 'FLEET_RECONCILE') return fleet;
    if (command.action === 'SELECT_TAB') {
      selected = command.payload.tab_id;
      return { ok: true, tab_id: selected, authority_effect: true };
    }
    if (command.action === 'CAPTURE') return captureFrame();
    throw new Error(`task_effect_must_not_run:${command.action}`);
  };
  const cycle = new DevOsNativeTaskCycle({
    getState: async () => browserState(selected),
    executeCommand,
    signedRequest,
  });
  return { cycle, commands, requests, recovery: () => recoveryPayload, selected: () => selected };
}

test('zero viewport is requeued immediately as proven pre-effect absence instead of waiting lease TTL', async () => {
  const h = harness({ captureFrame: () => frame({ viewport: { width: 0, height: 0 } }) });
  const out = await h.cycle.cycle();
  assert.equal(out.pre_effect_lease_stall_fast_requeue, true);
  assert.equal(out.pre_effect_reconciliation.state, 'PRE_EFFECT_REQUEUED');
  assert.equal(out.pre_effect_reconciliation.retry_via_scheduler, true);
  assert.equal(out.pre_effect_reconciliation.physical_effect_attempted, false);
  assert.equal(out.pre_effect_reconciliation.physical_effect_replayed, false);
  assert.equal(h.commands.includes('SEMANTIC_TYPE'), false);
  assert.equal(h.commands.includes('TYPED_CLICK'), false);
  assert.equal(h.requests.filter((row) => row === '/v1/devos/reconcile-ambiguous').length, 1);
  const recovery = h.recovery();
  assert.equal(recovery.task_id, lease.task_id);
  assert.equal(recovery.agent_id, lease.agent_id);
  assert.equal(recovery.lease_generation, lease.lease_generation);
  assert.equal(recovery.tab_id, lease.tab_id);
  assert.equal(recovery.target_id, lease.target_id);
  assert.equal(recovery.agent_generation_epoch, lease.agent_generation_epoch);
  assert.equal(recovery.recovery.recovery_class, 'PRE_EFFECT_ABORTED');
  assert.equal(recovery.recovery.physical_effect_attempted, false);
  assert.equal(recovery.recovery.effect_barrier_crossed, false);
  assert.equal(recovery.recovery.automatic_retry_allowed, false);
  assert.equal(recovery.recovery.authority_effect, false);
  assert.match(recovery.recovery.prompt_sha256, /^[a-f0-9]{64}$/);
});

test('native target drift before type is fail-closed and exact lease is requeued without task effect', async () => {
  const h = harness({ captureFrame: () => frame({ targetId: 'webcontents:99' }) });
  const out = await h.cycle.cycle();
  assert.equal(out.pre_effect_reconciliation.state, 'PRE_EFFECT_REQUEUED');
  assert.match(out.pre_effect_reconciliation.original_error, /devos_pre_effect_frame_target_mismatch/);
  assert.equal(h.commands.includes('SEMANTIC_TYPE'), false);
  assert.equal(h.commands.includes('TYPED_CLICK'), false);
});

test('once semantic type is attempted, wrapper never classifies the failure as PRE_EFFECT_ABORTED', async () => {
  let selected = supervisorTab;
  const requests = [];
  const commands = [];
  const signedRequest = async (requestPath) => {
    requests.push(requestPath);
    if (requestPath === '/v1/devos/promotion-lease') return response(404, { error: 'not_needed' });
    if (requestPath === '/v1/devos/cycle') return response(200, { schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 1, running: 0 }, lease, running: [] });
    if (requestPath === '/v1/devos/complete') return response(200, { state: 'AMBIGUOUS' });
    throw new Error(`unexpected_request:${requestPath}`);
  };
  const executeCommand = async (command) => {
    commands.push(command.action);
    if (command.action === 'FLEET_RECONCILE') return fleet;
    if (command.action === 'SELECT_TAB') { selected = command.payload.tab_id; return { ok: true }; }
    if (command.action === 'CAPTURE') return frame();
    if (command.action === 'SEMANTIC_TYPE') throw new Error('type_transport_ambiguous');
    throw new Error(`unexpected_action:${command.action}`);
  };
  const cycle = new DevOsNativeTaskCycle({ getState: async () => browserState(selected), executeCommand, signedRequest });
  await assert.rejects(() => cycle.cycle(), /type_transport_ambiguous/);
  assert.equal(commands.filter((row) => row === 'SEMANTIC_TYPE').length, 1);
  assert.equal(requests.includes('/v1/devos/reconcile-ambiguous'), false);
  assert.equal(cycle.snapshot().pre_effect_reconciliation, null);
});
