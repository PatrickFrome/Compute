import test from 'node:test';
import assert from 'node:assert/strict';
import { DevOsNativeTaskCycle } from '../src/devos-native-task-cycle.mjs';
import { registerFleetRuntime, clearFleetRuntime } from '../src/fleet-runtime-bridge.mjs';

// D-C2/D-C3 contract tests: multiply-and-simultaneous command execution plus
// the poisoned-draft flush bootstrap. All surfaces are GLM (chat.z.ai).

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

const conversationUrl = (n) => `https://chat.z.ai/c/12345678-abcd-4abc-8abc-123456789ab${n}`;

function frame({ url = 'https://chat.z.ai/', tabId, targetId, composerValueLength = null } = {}) {
  return {
    schema: 'metaengine.native-browser.perception.v1',
    process_incarnation_id: 'process_test_incarnation_0001',
    tab_id: tabId,
    target_id: targetId,
    url,
    viewport: { width: 1200, height: 640 },
    semantic_targets: [
      { role: 'textbox', name: null, value_length: composerValueLength ?? undefined, semantic_ref: { schema: 'metaengine.native-browser.semantic-ref.v1', semantic_ref_id: 'semref_' + 'a'.repeat(64) }, backend_node_id: 3 },
    ],
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
      transport_proof: proofs.get(lease.agent_id) || {
        schema: 'metaengine.browser.fleet-transport-proof.v1',
        tab_id: lease.tab_id,
        target_id: lease.target_id,
        generation_epoch: lease.agent_generation_epoch,
        conversation_url_sha256: 'a'.repeat(64),
        proven_at: '2026-08-31T18:00:00.000Z',
        authority_effect: false,
      },
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

test('D-C3: poisoned root draft is flushed into a proven conversation BEFORE the lease effect', async () => {
  const lease = mkLease(3, 'tab_c7f6229c-cd7a-4629-a45c-e6575b0a23b9');
  const fleet = fleetOf([lease]);
  // Mock the fleet runtime bridge so the flush's transport-proof upgrade is
  // exercised end-to-end (markTransportProven → UPGRADED_CONVERSATION).
  const upgradedAgents = new Map();
  // The flush test's agent carries a root-stage proof (the poisoned-draft
  // precondition): the upgrade path requires PRECONVERSATION_ROOT to promote.
  const flushFleet = structuredClone(fleet);
  flushFleet.agents[0].transport_proof.transport_stage = 'PRECONVERSATION_ROOT';
  registerFleetRuntime({
    snapshot: () => ({ agents: [upgradedAgents.get(lease.agent_id) || flushFleet.agents[0]] }),
    markTransportProven: async ({ agent_id, conversation_url }) => {
      const base = structuredClone(flushFleet.agents[0]);
      base.transport_proof = {
        ...base.transport_proof,
        transport_stage: 'CONVERSATION',
        conversation_url,
      };
      upgradedAgents.set(agent_id, base);
      return { agents: [base] };
    },
  });
  try {
  const sequence = [];
  let flushed = false;
  const signedRequest = async (path) => {
    if (path === '/v1/devos/cycle') return { status: 200, ok: true, async json() { return { schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 1, running: 0 }, lease, running: [] }; } };
    if (path === '/v1/devos/mark-running') return { status: 200, ok: true, async json() { return { state: 'RUNNING' }; } };
    throw new Error(`unexpected:${path}`);
  };
  const executeCommand = async (command) => {
    if (command.action === 'FLEET_RECONCILE') return fleet;
    if (command.action === 'CAPTURE') {
      sequence.push(['capture', flushed]);
      // Root with a poisoned 31k draft until the flush lands, then the fresh conversation.
      return flushed
        ? frame({ url: conversationUrl(3), tabId: lease.tab_id, targetId: lease.target_id, composerValueLength: 0 })
        : frame({ url: 'https://chat.z.ai/', tabId: lease.tab_id, targetId: lease.target_id, composerValueLength: 31384 });
    }
    if (command.action === 'SEMANTIC_TYPE') {
      const payload = command.payload || {};
      if (payload.submit_after_type === true && payload.replace_existing === false) {
        assert.match(payload.text, /METAENGINE FLEET BOOTSTRAP FLUSH v1/);
        flushed = true;
        sequence.push(['flush', payload.text.length]);
        return { effect_state: 'PROVEN_NEW_CONVERSATION', composer_cleared: true, new_conversation_observed: true, stop_observed: false, automatic_retry_allowed: false, authority_effect: true };
      }
      sequence.push(['task_type', payload.text.slice(0, 40)]);
      return { effect_state: 'PROVEN_NEW_CONVERSATION', composer_cleared: true, new_conversation_observed: true, stop_observed: false, automatic_retry_allowed: false, authority_effect: true };
    }
    throw new Error(`unexpected_action:${command.action}`);
  };
  const cycle = new DevOsNativeTaskCycle({ getState: async () => ({ fleet, active_tab: { tab_id: 'tab_other' }, tabs: [] }), executeCommand, signedRequest });
  const out = await cycle.cycle();
  assert.equal(out.dispatch.state, 'RUNNING');
  assert.equal(out.dispatch.conversation_bootstrap, 'FLUSHED_CONVERSATION_PROVEN');
  const flushIndex = sequence.findIndex((row) => row[0] === 'flush');
  const taskIndex = sequence.findIndex((row) => row[0] === 'task_type');
  assert.ok(flushIndex >= 0, 'the flush fired');
  assert.ok(taskIndex > flushIndex, 'the real task typed only after the flush created the conversation');
  } finally {
    clearFleetRuntime();
  }
});

test('D-C3: an over-limit draft attempts the verified seed replace and still fails with the precise reason when it cannot be proven (no blind append)', async () => {
  const lease = mkLease(4, 'tab_c05a46b6-5fbd-4b36-97e2-d7dbbfe94d14');
  const fleet = fleetOf([lease]);
  const types = [];
  const signedRequest = async (path) => {
    if (path === '/v1/devos/cycle') return { status: 200, ok: true, async json() { return { schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 1, running: 0 }, lease, running: [] }; } };
    throw new Error(`unexpected:${path}`);
  };
  const executeCommand = async (command) => {
    if (command.action === 'FLEET_RECONCILE') return fleet;
    if (command.action === 'CAPTURE') return frame({ url: 'https://chat.z.ai/', tabId: lease.tab_id, targetId: lease.target_id, composerValueLength: 34064 });
    if (command.action === 'SEMANTIC_TYPE') { types.push(command.payload); return { effect_state: 'AMBIGUOUS_AFTER_ENTER', automatic_retry_allowed: false, authority_effect: true }; }
    throw new Error(`unexpected_action:${command.action}`);
  };
  const cycle = new DevOsNativeTaskCycle({ getState: async () => ({ fleet, active_tab: { tab_id: 'tab_other' }, tabs: [] }), executeCommand, signedRequest });
  await assert.rejects(() => cycle.cycle(), /fleet_task_root_draft_over_flush_limit:34064/);
  assert.equal(types.length, 1, 'exactly one verified-replace attempt: the SHORT seed replaces the dead draft wholesale');
  assert.equal(types[0].replace_existing, true, 'the seed replace never appends to the poisoned draft');
  assert.ok(types[0].text.length < 1000, 'the submitted text is tiny — no oversized garbage can ever be sent');
});

test('D-C3: a refused flush (Enter refused by the site) degrades to the normal root dispatch path', async () => {
  const lease = mkLease(5, 'tab_0c5f2143-02ba-4775-9520-6b937dd5ddc2');
  const fleet = fleetOf([lease]);
  const types = [];
  let conversation = null;
  const signedRequest = async (path) => {
    if (path === '/v1/devos/cycle') return { status: 200, ok: true, async json() { return { schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 1, running: 0 }, lease, running: [] }; } };
    if (path === '/v1/devos/mark-running') return { status: 200, ok: true, async json() { return { state: 'RUNNING' }; } };
    throw new Error(`unexpected:${path}`);
  };
  const executeCommand = async (command) => {
    if (command.action === 'FLEET_RECONCILE') return fleet;
    if (command.action === 'CAPTURE') {
      return conversation
        ? frame({ url: conversation, tabId: lease.tab_id, targetId: lease.target_id, composerValueLength: 0 })
        : frame({ url: 'https://chat.z.ai/', tabId: lease.tab_id, targetId: lease.target_id, composerValueLength: 800 });
    }
    if (command.action === 'SEMANTIC_TYPE') {
      types.push(command.payload.replace_existing);
      // Flush submit refused; the REAL dispatch then submits normally and the
      // surface moves to the fresh conversation.
      if (command.payload.replace_existing === false) {
        return { effect_state: 'AMBIGUOUS_AFTER_ENTER', composer_cleared: false, new_conversation_observed: false, stop_observed: false, automatic_retry_allowed: false, authority_effect: true };
      }
      conversation = conversationUrl(5);
      return { effect_state: 'PROVEN_NEW_CONVERSATION', composer_cleared: true, new_conversation_observed: true, stop_observed: false, automatic_retry_allowed: false, authority_effect: true };
    }
    throw new Error(`unexpected_action:${command.action}`);
  };
  const cycle = new DevOsNativeTaskCycle({ getState: async () => ({ fleet, active_tab: { tab_id: 'tab_other' }, tabs: [] }), executeCommand, signedRequest });
  const out = await cycle.cycle();
  assert.equal(out.dispatch.state, 'RUNNING');
  assert.deepEqual(types, [false, true], 'flush attempted first, then the real task dispatch proceeded');
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
