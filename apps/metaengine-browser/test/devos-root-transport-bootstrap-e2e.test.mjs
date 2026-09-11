import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { DevOsNativeTaskCycle } from '../src/devos-native-task-cycle.mjs';
import { clearFleetRuntime, registerFleetRuntime } from '../src/fleet-runtime-bridge.mjs';

const AGENT_ID = 'agent_87654321-abcd';
const TAB_ID = 'tab_87654321-1234-4123-8123-123456789abc';
const TARGET_ID = 'webcontents:51';
const TASK_ID = '12345678-1111-4111-8111-123456789abc';
const PROMOTION_LEASE_ID = '12345678-2222-4222-8222-123456789abc';
const CONVERSATION = 'https://chatgpt.com/c/aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff';
const ROOT = 'https://chatgpt.com/';
const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) };
}

function proof(stage, url) {
  return {
    schema: 'metaengine.browser.fleet-transport-proof.v1',
    ...(stage === 'PRECONVERSATION_ROOT' ? { transport_stage: stage } : {}),
    tab_id: TAB_ID,
    target_id: TARGET_ID,
    generation_epoch: 7,
    conversation_url_sha256: sha256(url),
    proven_at: new Date().toISOString(),
    authority_effect: false,
  };
}

test('root worker is promoted without effect, leased once, then upgraded to canonical proof before mark-running', async () => {
  const calls = [];
  let selected = 'tab_supervisor';
  let captureCount = 0;
  let markRunningObservedCanonicalProof = false;
  let clickCount = 0;
  const state = {
    tabs: [
      { tab_id: 'tab_supervisor', url: 'https://chatgpt.com/c/supervisor-1234', selected: true },
      { tab_id: TAB_ID, url: ROOT, selected: false },
    ],
    active_tab: { tab_id: 'tab_supervisor' },
    fleet: {
      schema: 'metaengine.browser.fleet-snapshot.v1',
      readiness_contract: 'TRANSPORT_PROOF_REQUIRED',
      policy: { warm_agents: 1, desired_agents: 1, spawn_burst_limit: 1 },
      agents: [{
        agent_id: AGENT_ID,
        role: 'IMPLEMENTER',
        ownership: 'FLEET_OWNED',
        lifecycle_state: 'BOUND_UNVERIFIED',
        tab_id: TAB_ID,
        target_id: TARGET_ID,
        generation_epoch: 7,
        transport_proof: null,
        automatic_retry_allowed: false,
        authority_effect: false,
      }],
      authority_effect: false,
    },
  };

  const fleetRuntime = {
    snapshot: () => structuredClone(state.fleet),
    markTransportPreconversationProven: async ({ agent_id, tab_id, target_id, generation_epoch, transport_url }) => {
      assert.deepEqual({ agent_id, tab_id, target_id, generation_epoch, transport_url }, {
        agent_id: AGENT_ID,
        tab_id: TAB_ID,
        target_id: TARGET_ID,
        generation_epoch: 7,
        transport_url: ROOT,
      });
      const agent = state.fleet.agents[0];
      agent.lifecycle_state = 'ACTIVE';
      agent.transport_proof = proof('PRECONVERSATION_ROOT', ROOT);
      return structuredClone(state.fleet);
    },
    markTransportProven: async ({ agent_id, tab_id, target_id, generation_epoch, conversation_url }) => {
      assert.deepEqual({ agent_id, tab_id, target_id, generation_epoch, conversation_url }, {
        agent_id: AGENT_ID,
        tab_id: TAB_ID,
        target_id: TARGET_ID,
        generation_epoch: 7,
        conversation_url: CONVERSATION,
      });
      const agent = state.fleet.agents[0];
      agent.lifecycle_state = 'ACTIVE';
      agent.transport_proof = proof('CONVERSATION', CONVERSATION);
      return structuredClone(state.fleet);
    },
  };
  registerFleetRuntime(fleetRuntime);

  const syncSelection = (tabId) => {
    selected = tabId;
    state.active_tab = { tab_id: tabId };
    for (const row of state.tabs) row.selected = row.tab_id === tabId;
  };

  const frame = ({ url, generating = false } = {}) => ({
    schema: 'metaengine.native-browser.perception.v1',
    tab_id: TAB_ID,
    target_id: TARGET_ID,
    process_incarnation_id: 'process-incarnation-root-bootstrap-e2e',
    url,
    viewport: { width: 1200, height: 800 },
    semantic_targets: [
      { role: 'textbox', name: 'Message ChatGPT' },
      ...(generating ? [{ role: 'button', name: 'Stop generating' }] : [{ role: 'button', name: 'Send prompt' }]),
    ],
    authority_effect: false,
  });

  const executeCommand = async (command) => {
    calls.push(['command', command.action]);
    if (command.action === 'FLEET_RECONCILE') return structuredClone(state.fleet);
    if (command.action === 'SELECT_TAB') {
      syncSelection(command.payload.tab_id);
      return { ok: true, tab_id: command.payload.tab_id };
    }
    if (command.action === 'CAPTURE') {
      captureCount += 1;
      if (captureCount === 1) return frame({ url: ROOT }); // promotion CAPTURE
      if (captureCount === 2) return frame({ url: ROOT }); // pre-type
      if (captureCount === 3) return frame({ url: ROOT }); // pre-click after type
      return frame({ url: CONVERSATION, generating: true }); // post-send and any revalidation
    }
    if (command.action === 'SEMANTIC_TYPE') {
      assert.equal(command.payload.submit_after_type, false);
      return { authority_effect: true };
    }
    if (command.action === 'TYPED_CLICK') {
      clickCount += 1;
      return { authority_effect: true };
    }
    throw new Error(`unexpected_command:${command.action}`);
  };

  const lease = {
    task_id: TASK_ID,
    agent_id: AGENT_ID,
    role: 'IMPLEMENTER',
    tab_id: TAB_ID,
    target_id: TARGET_ID,
    agent_generation_epoch: 7,
    lease_generation: 1,
    base_sha: '84a71aaedc49186c24a992f507ca1d3f14767181',
    branch_name: 'work/devos-root-bootstrap-e2e',
    automatic_retry_allowed: false,
    task_spec: {
      schema: 'metaengine.devos.task.v1',
      objective: 'Prove root transport bootstrap reaches canonical task transport safely.',
      constraints: ['branch-local only', 'no main merge', 'no blind retry'],
      deliverable: 'transport proof and receipt',
    },
  };

  const signedRequest = async (path, request = {}) => {
    calls.push(['http', path]);
    if (path === '/v1/devos/promotion-lease') return response(200, {
      schema: 'metaengine.devos.transport-promotion-lease.v1',
      leased: true,
      lease_id: PROMOTION_LEASE_ID,
      agent_id: AGENT_ID,
      tab_id: TAB_ID,
      target_id: TARGET_ID,
      agent_generation_epoch: 7,
      status: 'ACTIVE',
      effect_scope: 'BROWSER_CLIENT_ACTUATION',
      effect_key: `fleet.transport-promotion:${AGENT_ID}`,
      expires_at: new Date(Date.now() + 45_000).toISOString(),
      not_expired: true,
      holder_verified: true,
      target_verified: true,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
    if (path === '/v1/devos/promotion-release') return response(200, {
      schema: 'metaengine.devos.transport-promotion-release.v1',
      released: true,
      lease_id: PROMOTION_LEASE_ID,
      authority_effect: false,
    });
    if (path === '/v1/devos/cycle') {
      assert.equal(state.fleet.agents[0].lifecycle_state, 'ACTIVE', 'scheduler must see preconversation ACTIVE overlay');
      assert.equal(state.fleet.agents[0].transport_proof.transport_stage, 'PRECONVERSATION_ROOT');
      return response(200, {
        schema: 'metaengine.devos.browser-cycle.v1',
        backlog: { ready: 1, running: 0, by_role: { IMPLEMENTER: 1 } },
        lease,
        running: [],
        automatic_retry_allowed: false,
        authority_effect: false,
      });
    }
    if (path === '/v1/devos/mark-running') {
      assert.equal(request.payload.task_id, TASK_ID);
      assert.equal(request.payload.proof.conversation_url_sha256, sha256(CONVERSATION));
      const current = state.fleet.agents[0].transport_proof;
      markRunningObservedCanonicalProof = current.transport_stage !== 'PRECONVERSATION_ROOT'
        && current.conversation_url_sha256 === sha256(CONVERSATION);
      return response(200, { state: 'RUNNING', automatic_retry_allowed: false, authority_effect: false });
    }
    throw new Error(`unexpected_http:${path}`);
  };

  const cycle = new DevOsNativeTaskCycle({
    getState: async () => structuredClone(state),
    executeCommand,
    signedRequest,
  });

  try {
    const snapshot = await cycle.cycle();
    assert.equal(snapshot.fleet_transport_promotion.state, 'LOCAL_ACTIVE');
    assert.equal(snapshot.fleet_transport_promotion.transport_stage, 'PRECONVERSATION_ROOT');
    assert.equal(snapshot.dispatch.state, 'RUNNING');
    assert.equal(snapshot.fleet_transport_proof.state, 'PRECONVERSATION_PROOF_UPGRADED');
    assert.equal(markRunningObservedCanonicalProof, true, 'canonical proof must exist before DB RUNNING receipt');
    assert.equal(state.fleet.agents[0].transport_proof.transport_stage, undefined);
    assert.equal(state.fleet.agents[0].transport_proof.conversation_url_sha256, sha256(CONVERSATION));
    assert.equal(clickCount, 1, 'only one Send effect is allowed');
    assert.equal(calls.filter((row) => row[0] === 'command' && row[1] === 'SEMANTIC_TYPE').length, 1);
    assert.equal(calls.filter((row) => row[0] === 'command' && row[1] === 'TYPED_CLICK').length, 1);
    assert.ok(calls.findIndex((row) => row[1] === '/v1/devos/promotion-release') < calls.findIndex((row) => row[1] === '/v1/devos/cycle'));
    assert.ok(calls.findIndex((row) => row[1] === 'TYPED_CLICK') < calls.findIndex((row) => row[1] === '/v1/devos/mark-running'));
  } finally {
    clearFleetRuntime(fleetRuntime);
  }
});
