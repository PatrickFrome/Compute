import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DevOsNativeTaskCycle } from '../src/devos-native-task-cycle.mjs';

const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');

const mkLease = (n, tabId, targetId = `webcontents:1${n}`) => ({
  task_id: `09f2e414-5c31-4fc7-87a3-f5de1315cb8${n}`,
  agent_id: `agent_a2bf77e6-66d3-4f10-9c9c-683df36f45${n}${n}`,
  role: 'IMPLEMENTER',
  tab_id: tabId,
  target_id: targetId,
  agent_generation_epoch: 7,
  lease_generation: 1,
  base_sha: '724612235eb7ceb4534c13d126425b274d876394',
  branch_name: `work/devos-concurrent-v1-${n}`,
  automatic_retry_allowed: false,
  task_spec: { schema: 'metaengine.devos.task.v1', objective: `Implement slice ${n}.`, constraints: [], deliverable: 'tests' },
});

const conversationUrl = (n) => `https://chat.z.ai/c/12345678-abcd-4abc-8abc-123456789ab${n}`;

function frame({ url, tabId, targetId } = {}) {
  return {
    schema: 'metaengine.native-browser.perception.v1',
    process_incarnation_id: 'process_test_incarnation_0001',
    state_revision_id: 'rev_' + 'e'.repeat(64),
    tab_id: tabId,
    target_id: targetId,
    url,
    viewport: { width: 1200, height: 640 },
    semantic_targets: [{
      role: 'textbox',
      name: 'Send a Message',
      value_length: 0,
      semantic_ref: { schema: 'metaengine.native-browser.semantic-ref.v1', semantic_ref_id: 'semref_' + 'a'.repeat(64) },
      backend_node_id: 3,
    }],
    interaction_tree: { schema:'metaengine.native-browser.interaction-tree.v1', elements:[{ role:'statictext', text:'GLM-5.3-Flash' }] },
    authority_effect: false,
  };
}

function fleetOf(leases) {
  return {
    schema: 'metaengine.browser.fleet-snapshot.v1',
    readiness_contract: 'TRANSPORT_PROOF_REQUIRED',
    policy: { warm_agents: 2, spawn_burst_limit: 4 },
    agents: leases.map((lease) => {
      const suffix = Number(String(lease.target_id).match(/(\d)$/)?.[1] || 1);
      return {
        agent_id: lease.agent_id,
        role: lease.role,
        lifecycle_state: 'ACTIVE',
        tab_id: lease.tab_id,
        target_id: lease.target_id,
        generation_epoch: lease.agent_generation_epoch,
        transport_proof: {
          schema: 'metaengine.browser.fleet-transport-proof.v1',
          tab_id: lease.tab_id,
          target_id: lease.target_id,
          generation_epoch: lease.agent_generation_epoch,
          conversation_url_sha256: sha256(conversationUrl(suffix)),
          agent_surface_sha256: 'c'.repeat(64),
          proven_at: '2026-09-28T00:00:00.000Z',
          authority_effect: false,
        },
        automatic_retry_allowed: false,
        authority_effect: false,
      };
    }),
  };
}

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, async json() { return structuredClone(body); } };
}

test('R98 distinct proven Agent conversations dispatch concurrently without foreground selection', async () => {
  const leases = [
    mkLease(1, 'tab_ff91dce7-eeb3-425d-9052-94d521c2dfa1'),
    mkLease(2, 'tab_5c081392-f073-4a40-9a2a-f6e01a9361d2'),
  ];
  const fleet = fleetOf(leases);
  const inFlight = new Set();
  let maxConcurrent = 0;
  let typed = 0;
  const cycle = new DevOsNativeTaskCycle({
    getState: async () => ({ fleet, active_tab: { tab_id: 'tab_user' }, tabs: [] }),
    executeCommand: async (command) => {
      if (command.action === 'FLEET_RECONCILE') return fleet;
      if (command.action === 'CAPTURE') {
        inFlight.add(command.payload.tab_id);
        maxConcurrent = Math.max(maxConcurrent, inFlight.size);
        await new Promise((resolve) => setTimeout(resolve, 40));
        inFlight.delete(command.payload.tab_id);
        const lease = leases.find((row) => row.tab_id === command.payload.tab_id);
        const suffix = Number(String(lease.target_id).match(/(\d)$/)?.[1] || 1);
        return frame({ url: conversationUrl(suffix), tabId: lease.tab_id, targetId: lease.target_id });
      }
      if (command.action === 'SEMANTIC_TYPE') {
        typed += 1;
        return { effect_state:'PROVEN_COMPOSER_CLEARED', composer_cleared:true, new_conversation_observed:false, automatic_retry_allowed:false, authority_effect:true };
      }
      if (command.action === 'SELECT_TAB') throw new Error('foreground_selection_forbidden');
      throw new Error(`unexpected_action:${command.action}`);
    },
    signedRequest: async (requestPath) => {
      if (requestPath === '/v1/devos/cycle') return response(200, { schema:'metaengine.devos.browser-cycle.v1', backlog:{ready:2,running:0}, lease:leases[0], leases, running:[] });
      if (requestPath === '/v1/devos/mark-running') return response(200, { state:'RUNNING' });
      throw new Error(`unexpected_request:${requestPath}`);
    },
  });
  const out = await cycle.cycle();
  assert.equal(out.dispatch.state, 'BATCH_DISPATCHED');
  assert.equal(out.dispatch.dispatched, 2);
  assert.equal(out.dispatch.failed, 0);
  assert.equal(typed, 2);
  assert.equal(maxConcurrent, 2);
});

test('R98 same-tab leases serialize while a failed task does not starve its peer', async () => {
  const leaseA = mkLease(1, 'tab_ff91dce7-eeb3-425d-9052-94d521c2dfa1');
  const leaseB = mkLease(2, leaseA.tab_id, leaseA.target_id);
  const leases = [leaseA, leaseB];
  const fleet = fleetOf(leases);
  let active = 0;
  let maxActive = 0;
  const cycle = new DevOsNativeTaskCycle({
    getState: async () => ({ fleet, active_tab:{tab_id:'tab_user'}, tabs:[] }),
    executeCommand: async (command) => {
      if (command.action === 'FLEET_RECONCILE') return fleet;
      if (command.action === 'CAPTURE') {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 25));
        active -= 1;
        return frame({ url:conversationUrl(1), tabId:leaseA.tab_id, targetId:leaseA.target_id });
      }
      if (command.action === 'SEMANTIC_TYPE') {
        if (String(command.payload.text).includes('slice 1.')) throw new Error('flaky_tab_effect');
        return { effect_state:'PROVEN_COMPOSER_CLEARED', composer_cleared:true, new_conversation_observed:false, automatic_retry_allowed:false, authority_effect:true };
      }
      throw new Error(`unexpected_action:${command.action}`);
    },
    signedRequest: async (requestPath) => {
      if (requestPath === '/v1/devos/cycle') return response(200, { schema:'metaengine.devos.browser-cycle.v1', backlog:{ready:2,running:0}, leases, running:[] });
      if (requestPath === '/v1/devos/mark-running') return response(200, { state:'RUNNING' });
      if (requestPath === '/v1/devos/complete') return response(200, { state:'AMBIGUOUS' });
      throw new Error(`unexpected_request:${requestPath}`);
    },
  });
  const out = await cycle.cycle();
  assert.equal(out.dispatch.state, 'BATCH_DISPATCHED');
  assert.equal(out.dispatch.dispatched, 1);
  assert.equal(out.dispatch.failed, 1);
  assert.equal(maxActive, 1);
});

test('R98 PRECONVERSATION_ROOT is fenced before leased dispatch; bootstrap belongs to pre-admission wrapper', async () => {
  const lease = mkLease(3, 'tab_root');
  const fleet = {
    ...fleetOf([lease]),
    agents: [{
      ...fleetOf([lease]).agents[0],
      lifecycle_state:'BOUND_UNVERIFIED',
      transport_proof:{
        schema:'metaengine.browser.fleet-transport-proof.v1',
        transport_stage:'PRECONVERSATION_ROOT',
        tab_id:lease.tab_id,
        target_id:lease.target_id,
        generation_epoch:lease.agent_generation_epoch,
        conversation_url_sha256:sha256('https://chat.z.ai/'),
        proven_at:'2026-09-28T00:00:00.000Z',
        authority_effect:false,
      },
    }],
  };
  const commands = [];
  const cycle = new DevOsNativeTaskCycle({
    getState: async () => ({ fleet, active_tab:{tab_id:'tab_user'}, tabs:[] }),
    executeCommand: async (command) => {
      commands.push(command.action);
      if (command.action === 'FLEET_RECONCILE') return fleet;
      throw new Error(`root_effect_forbidden:${command.action}`);
    },
    signedRequest: async (requestPath) => {
      if (requestPath === '/v1/devos/cycle') return response(200, { schema:'metaengine.devos.browser-cycle.v1', backlog:{ready:1,running:0}, lease, running:[] });
      throw new Error(`unexpected_request:${requestPath}`);
    },
  });
  await assert.rejects(() => cycle.cycle(), /devos_agent_state_invalid:ADMISSION_FENCED/);
  assert.deepEqual(commands, ['FLEET_RECONCILE']);
  assert.equal(cycle.snapshot().pre_admission_agent_bootstrap_owner, 'DEVOS_NATIVE_TASK_CYCLE_WRAPPER');
});

test('R98 every dispatched prompt still carries the per-agent isolated-context briefing', async () => {
  const lease = mkLease(6, 'tab_5c081392-f073-4a40-9a2a-f6e01a9361d2');
  const fleet = fleetOf([lease]);
  let seenPrompt = null;
  const cycle = new DevOsNativeTaskCycle({
    getState: async () => ({ fleet, active_tab:{tab_id:'tab_other'}, tabs:[] }),
    executeCommand: async (command) => {
      if (command.action === 'FLEET_RECONCILE') return fleet;
      if (command.action === 'CAPTURE') return frame({ url:conversationUrl(6), tabId:lease.tab_id, targetId:lease.target_id });
      if (command.action === 'SEMANTIC_TYPE') {
        seenPrompt = String(command.payload.text);
        return { effect_state:'PROVEN_COMPOSER_CLEARED', composer_cleared:true, new_conversation_observed:false, automatic_retry_allowed:false, authority_effect:true };
      }
      throw new Error(`unexpected_action:${command.action}`);
    },
    signedRequest: async (requestPath) => {
      if (requestPath === '/v1/devos/cycle') return response(200, { schema:'metaengine.devos.browser-cycle.v1', backlog:{ready:1,running:0}, lease, running:[] });
      if (requestPath === '/v1/devos/mark-running') return response(200, { state:'RUNNING' });
      throw new Error(`unexpected_request:${requestPath}`);
    },
    identity: {
      agentContextTokenProof: async ({ agent_id, role, generation_epoch, mission_digest }) => ({
        schema:'metaengine.agent-context-token.v1',
        client_id:'test-client',
        agent_id, role, generation_epoch, mission_digest,
        issued_at:'2026-09-19T12:00:00.000Z',
        expires_at:'2026-12-19T12:00:00.000Z',
        signature:'c2ln',
        token_sha256:'b'.repeat(64),
        public_jwk:null,
        key_fingerprint_sha256:null,
        authority_effect:false,
      }),
    },
  });
  const out = await cycle.cycle();
  assert.equal(out.dispatch.state, 'RUNNING');
  assert.match(seenPrompt, /METAENGINE FLEET TASK V1/);
  assert.match(seenPrompt, /AGENT CONTEXT \(isolated session/);
  assert.match(seenPrompt, new RegExp(`agent=${lease.agent_id}`));
  assert.match(seenPrompt, /context_token_sha256=b{64}/);
});
