import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DevOsNativeTaskCycle } from '../src/devos-native-task-cycle.mjs';

// R98/D-C2 contract tests: multiply-and-simultaneous task execution is
// permitted only for ACTIVE ChatGPT agent sessions. Root bootstrap belongs to
// the promotion lease path and is explicitly fenced from task dispatch.

const mkLease = (n, tabId) => ({
  task_id: `09f2e414-5c31-4fc7-87a3-f5de1315cb8${n}`,
  agent_id: `agent_a2bf77e6-66d3-4f10-9c9c-683df36f45${n}${n}`,
  role: 'IMPLEMENTER',
  tab_id: tabId,
  target_id: `webcontents:1${n}`,
  agent_generation_epoch: 7,
  lease_generation: 1,
  base_sha: '724612235eb7ceb4534c13d126425b274d876394',
  branch_name: `work/devos-concurrent-v1-${n}`,
  automatic_retry_allowed: false,
  task_spec: { schema: 'metaengine.devos.task.v1', objective: `Implement slice ${n}.`, constraints: [], deliverable: 'tests' },
});

const conversationUrl = (n) => `https://chatgpt.com/c/12345678-abcd-4abc-8abc-123456789ab${n}`;

function frame({ url = 'https://chatgpt.com/', tabId, targetId, composerValueLength = null } = {}) {
  return {
    schema: 'metaengine.native-browser.perception.v1',
    process_incarnation_id: 'process_test_incarnation_0001',
    tab_id: tabId,
    target_id: targetId,
    url,
    viewport: { width: 1200, height: 640 },
    semantic_targets: [
      { role: 'textbox', name: 'Message ChatGPT', value_length: composerValueLength ?? undefined, semantic_ref: { schema: 'metaengine.native-browser.semantic-ref.v1', semantic_ref_id: 'semref_' + 'a'.repeat(64) }, backend_node_id: 3 },
    ],
    interaction_tree: { schema:'metaengine.native-browser.interaction-tree.v1', elements:[] },
    authority_effect: false,
  };
}

function fleetOf(leases, proofs = new Map()) {
  return {
    schema: 'metaengine.browser.fleet-snapshot.v1',
    readiness_contract: 'TRANSPORT_PROOF_REQUIRED',
    policy: { warm_agents: 2, spawn_burst_limit: 4 },
    agents: leases.map((lease) => ({
      agent_id: lease.agent_id,
      role: lease.role,
      lifecycle_state: 'ACTIVE',
      tab_id: lease.tab_id,
      target_id: lease.target_id,
      generation_epoch: lease.agent_generation_epoch,
      transport_proof: proofs.get(lease.agent_id) || (() => {
        const suffix = String(lease.target_id || '').replace(/\D/g, '').slice(-1) || '1';
        const url = conversationUrl(suffix);
        return {
          schema: 'metaengine.browser.fleet-transport-proof.v1',
          tab_id: lease.tab_id,
          target_id: lease.target_id,
          generation_epoch: lease.agent_generation_epoch,
          conversation_url: url,
          conversation_url_sha256: crypto.createHash('sha256').update(url).digest('hex'),
          agent_surface_sha256: 'c'.repeat(64),
          proven_at: '2026-09-28T00:00:00.000Z',
          authority_effect: false,
        };
      })(),
      automatic_retry_allowed: false,
      authority_effect: false,
    })),
  };
}

test('D-C2: a lease BATCH dispatches concurrently across distinct agent tabs', async () => {
  const leases = [mkLease(1, 'tab_ff91dce7-eeb3-425d-9052-94d521c2dfa1'), mkLease(2, 'tab_5c081392-f073-4a40-9a2a-f6e01a9361d2')];
  const fleet = fleetOf(leases);
  const inFlight = new Set();
  let maxConcurrent = 0;
  const concurrencyProbe = async (tabId) => {
    inFlight.add(tabId);
    maxConcurrent = Math.max(maxConcurrent, inFlight.size);
    await new Promise((resolve) => setTimeout(resolve, 60));
    inFlight.delete(tabId);
  };
  const marks = [];
  const signedRequest = async (path) => {
    if (path === '/v1/devos/cycle') return { status: 200, ok: true, async json() { return { schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 2, running: 0 }, lease: leases[0], leases, running: [] }; } };
    if (path === '/v1/devos/mark-running') return { status: 200, ok: true, async json() { return { state: 'RUNNING' }; } };
    throw new Error(`unexpected:${path}`);
  };
  const executeCommand = async (command) => {
    if (command.action === 'FLEET_RECONCILE') return fleet;
    if (command.action === 'CAPTURE') {
      const n = leases.findIndex((l) => l.tab_id === command.payload.tab_id) + 1;
      await concurrencyProbe(command.payload.tab_id);
      return frame({ url: conversationUrl(n), tabId: command.payload.tab_id, targetId: `webcontents:1${n}` });
    }
    if (command.action === 'SEMANTIC_TYPE') {
      marks.push([command.payload.tab_id, 'type']);
      return { effect_state: 'PROVEN_NEW_CONVERSATION', composer_cleared: true, new_conversation_observed: true, stop_observed: false, automatic_retry_allowed: false, authority_effect: true };
    }
    if (command.action === 'SELECT_TAB') throw new Error('dc2_select_tab_forbidden');
    throw new Error(`unexpected_action:${command.action}`);
  };
  const cycle = new DevOsNativeTaskCycle({ getState: async () => ({ fleet, active_tab: { tab_id: 'tab_other' }, tabs: [] }), executeCommand, signedRequest });
  const out = await cycle.cycle();
  assert.equal(out.dispatch.state, 'BATCH_DISPATCHED');
  assert.equal(out.dispatch.dispatched, 2);
  assert.equal(out.dispatch.failed, 0);
  assert.equal(out.dispatch.parallel, true);
  assert.equal(marks.length, 2, 'both leases typed');
  assert.equal(maxConcurrent, 2, 'captures for the two distinct tabs genuinely overlapped');
});

test('D-C2: same-tab leases serialize through the tab gate; one flaky lease never starves the batch', async () => {
  const leaseA = mkLease(1, 'tab_ff91dce7-eeb3-425d-9052-94d521c2dfa1');
  // Same tab => same physical webContents: the second lease binds to the
  // identical target incarnation, exactly like two queued tasks for one agent.
  const leaseB = { ...mkLease(2, 'tab_ff91dce7-eeb3-425d-9052-94d521c2dfa1'), target_id: leaseA.target_id };
  const fleet = fleetOf([leaseA, leaseB]);
  let activeOnTab = 0;
  let maxActiveOnTab = 0;
  const signedRequest = async (path) => {
    if (path === '/v1/devos/cycle') return { status: 200, ok: true, async json() { return { schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 2, running: 0 }, leases: [leaseA, leaseB], running: [] }; } };
    if (path === '/v1/devos/mark-running') return { status: 200, ok: true, async json() { return { state: 'RUNNING' }; } };
    throw new Error(`unexpected:${path}`);
  };
  const executeCommand = async (command) => {
    if (command.action === 'FLEET_RECONCILE') return fleet;
    if (command.action === 'CAPTURE') {
      activeOnTab += 1;
      maxActiveOnTab = Math.max(maxActiveOnTab, activeOnTab);
      await new Promise((resolve) => setTimeout(resolve, 40));
      activeOnTab -= 1;
      return frame({ url: conversationUrl(1), tabId: command.payload.tab_id, targetId: leaseA.target_id });
    }
    if (command.action === 'SEMANTIC_TYPE') {
      if (command.payload.text.includes('slice 1.')) throw new Error('flaky_tab_effect');
      return { effect_state: 'PROVEN_NEW_CONVERSATION', composer_cleared: true, new_conversation_observed: true, stop_observed: false, automatic_retry_allowed: false, authority_effect: true };
    }
    throw new Error(`unexpected_action:${command.action}`);
  };
  const cycle = new DevOsNativeTaskCycle({ getState: async () => ({ fleet, active_tab: { tab_id: 'tab_other' }, tabs: [] }), executeCommand, signedRequest });
  const out = await cycle.cycle();
  assert.equal(out.dispatch.state, 'BATCH_DISPATCHED');
  assert.equal(out.dispatch.dispatched, 1, 'the healthy lease still delivered');
  assert.equal(out.dispatch.failed, 1, 'the flaky lease failed isolated');
  assert.match(out.dispatch.results.find((row) => row.state === 'DISPATCH_FAILED').reason, /flaky_tab_effect/);
  assert.equal(maxActiveOnTab, 1, 'same-tab effects never overlapped');
});

test('R98: PRECONVERSATION_ROOT cannot enter task dispatch; promotion owns Agent bootstrap', async () => {
  const lease = mkLease(3, 'tab_c7f6229c-cd7a-4629-a45c-e6575b0a23b9');
  const rootProof = {
    schema: 'metaengine.browser.fleet-transport-proof.v1',
    transport_stage: 'PRECONVERSATION_ROOT',
    tab_id: lease.tab_id,
    target_id: lease.target_id,
    generation_epoch: lease.agent_generation_epoch,
    conversation_url: 'https://chatgpt.com/',
    conversation_url_sha256: crypto.createHash('sha256').update('https://chatgpt.com/').digest('hex'),
    proven_at: '2026-09-28T00:00:00.000Z',
    authority_effect: false,
  };
  const fleet = fleetOf([lease], new Map([[lease.agent_id, rootProof]]));
  const effects = [];
  const cycle = new DevOsNativeTaskCycle({
    getState: async () => ({ fleet, active_tab: { tab_id: 'tab_other' }, tabs: [] }),
    executeCommand: async (command) => {
      effects.push(command.action);
      if (command.action === 'FLEET_RECONCILE') return fleet;
      throw new Error(`unexpected_physical_effect:${command.action}`);
    },
    signedRequest: async (path) => {
      if (path === '/v1/devos/cycle') return {
        status: 200, ok: true,
        async json() { return { schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 1, running: 0 }, lease, running: [] }; },
      };
      throw new Error(`unexpected:${path}`);
    },
  });
  await assert.rejects(() => cycle.cycle(), /devos_agent_state_invalid:ADMISSION_FENCED/);
  assert.deepEqual(effects, ['FLEET_RECONCILE']);
  assert.equal(cycle.snapshot().bound_unverified_dispatch_allowed, false);
});

test('D-C1: every dispatched prompt carries the per-agent isolated-context briefing', async () => {
  const lease = mkLease(6, 'tab_5c081392-f073-4a40-9a2a-f6e01a9361d2');
  const fleet = fleetOf([lease]);
  let seenPrompt = null;
  const signedRequest = async (path) => {
    if (path === '/v1/devos/cycle') return { status: 200, ok: true, async json() { return { schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 1, running: 0 }, lease, running: [] }; } };
    if (path === '/v1/devos/mark-running') return { status: 200, ok: true, async json() { return { state: 'RUNNING' }; } };
    throw new Error(`unexpected:${path}`);
  };
  const executeCommand = async (command) => {
    if (command.action === 'FLEET_RECONCILE') return fleet;
    if (command.action === 'CAPTURE') return frame({ url: conversationUrl(6), tabId: lease.tab_id, targetId: lease.target_id });
    if (command.action === 'SEMANTIC_TYPE') {
      seenPrompt = String(command.payload.text);
      return { effect_state: 'PROVEN_NEW_CONVERSATION', composer_cleared: true, new_conversation_observed: true, stop_observed: false, automatic_retry_allowed: false, authority_effect: true };
    }
    throw new Error(`unexpected_action:${command.action}`);
  };
  const cycle = new DevOsNativeTaskCycle({
    getState: async () => ({ fleet, active_tab: { tab_id: 'tab_other' }, tabs: [] }),
    executeCommand,
    signedRequest,
    identity: {
      agentContextTokenProof: async ({ agent_id, role, generation_epoch, mission_digest }) => ({
        schema: 'metaengine.agent-context-token.v1',
        client_id: 'test-client',
        agent_id, role, generation_epoch, mission_digest,
        issued_at: '2026-09-19T12:00:00.000Z',
        expires_at: '2026-12-19T12:00:00.000Z',
        signature: 'c2ln',
        token_sha256: 'b'.repeat(64),
        public_jwk: null,
        key_fingerprint_sha256: null,
        authority_effect: false,
      }),
    },
  });
  const out = await cycle.cycle();
  assert.equal(out.dispatch.state, 'RUNNING');
  assert.match(seenPrompt, /METAENGINE FLEET TASK V1/);
  assert.match(seenPrompt, /AGENT CONTEXT \(isolated session/);
  assert.match(seenPrompt, new RegExp(`agent=${lease.agent_id}`));
  assert.match(seenPrompt, /role=IMPLEMENTER/);
  assert.match(seenPrompt, /context_token_sha256=b{64}/);
  assert.match(seenPrompt, /TOKEN_ACK/);
  assert.ok(seenPrompt.length <= 24000, 'prompt budget preserved');
});
