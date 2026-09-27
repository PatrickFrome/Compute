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
const CONVERSATION = 'https://chat.z.ai/c/aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff';
const ROOT = 'https://chat.z.ai/';
const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) };
}

function proof(stage, url, agentSurfaceSha256 = null) {
  return {
    schema: 'metaengine.browser.fleet-transport-proof.v1',
    ...(stage === 'PRECONVERSATION_ROOT' ? { transport_stage: stage } : {}),
    tab_id: TAB_ID,
    target_id: TARGET_ID,
    generation_epoch: 7,
    conversation_url_sha256: sha256(url),
    ...(stage === 'CONVERSATION' ? { agent_surface_sha256: agentSurfaceSha256 } : {}),
    proven_at: new Date().toISOString(),
    authority_effect: false,
  };
}

test('root worker is bootstrapped under promotion lease before task lease and revalidates canonical proof before mark-running', async () => {
  const calls = [];
  let selected = 'tab_supervisor';
  let captureCount = 0;
  let markRunningObservedCanonicalProof = false;
  let submitCount = 0;
  const state = {
    tabs: [
      { tab_id: 'tab_supervisor', url: 'https://chat.z.ai/c/supervisor-1234', selected: true },
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
    beginTransportBootstrapAttempt: async ({ agent_id, tab_id, target_id, generation_epoch }) => {
      assert.deepEqual({ agent_id, tab_id, target_id, generation_epoch }, {
        agent_id: AGENT_ID, tab_id: TAB_ID, target_id: TARGET_ID, generation_epoch: 7,
      });
      const agent = state.fleet.agents[0];
      agent.lifecycle_state = 'PROVISIONING_AMBIGUOUS';
      agent.ambiguous_reason = 'TRANSPORT_BOOTSTRAP_EFFECT_PENDING';
      agent.transport_proof = null;
      return structuredClone(state.fleet);
    },
    markTransportPreconversationProven: async ({ agent_id, tab_id, target_id, generation_epoch, transport_url }) => {
      assert.deepEqual({ agent_id, tab_id, target_id, generation_epoch, transport_url }, {
        agent_id: AGENT_ID,
        tab_id: TAB_ID,
        target_id: TARGET_ID,
        generation_epoch: 7,
        transport_url: ROOT,
      });
      const agent = state.fleet.agents[0];
      agent.lifecycle_state = 'BOUND_UNVERIFIED';
      agent.transport_proof = proof('PRECONVERSATION_ROOT', ROOT);
      return structuredClone(state.fleet);
    },
    markTransportProven: async ({ agent_id, tab_id, target_id, generation_epoch, conversation_url, agent_surface_sha256 }) => {
      assert.deepEqual({ agent_id, tab_id, target_id, generation_epoch, conversation_url }, {
        agent_id: AGENT_ID,
        tab_id: TAB_ID,
        target_id: TARGET_ID,
        generation_epoch: 7,
        conversation_url: CONVERSATION,
      });
      assert.match(agent_surface_sha256, /^[a-f0-9]{64}$/);
      const agent = state.fleet.agents[0];
      agent.lifecycle_state = 'ACTIVE';
      agent.transport_proof = proof('CONVERSATION', CONVERSATION, agent_surface_sha256);
      return structuredClone(state.fleet);
    },
  };
  registerFleetRuntime(fleetRuntime);

  const syncSelection = (tabId) => {
    selected = tabId;
    state.active_tab = { tab_id: tabId };
    for (const row of state.tabs) row.selected = row.tab_id === tabId;
  };

  let surfaceState = 'CHAT_ROOT';
  const semanticRef = (suffix) => ({
    schema: 'metaengine.native-browser.semantic-ref.v1',
    semantic_ref_id: 'semref_' + suffix.repeat(64).slice(0, 64),
  });
  const frame = ({ generating = false } = {}) => {
    const base = {
      schema: 'metaengine.native-browser.perception.v1',
      tab_id: TAB_ID,
      target_id: TARGET_ID,
      process_incarnation_id: 'process-incarnation-root-bootstrap-e2e',
      state_revision_id: `rev_${sha256(surfaceState)}`,
      url: surfaceState === 'CONVERSATION' ? CONVERSATION : ROOT,
      viewport: { width: 1200, height: 800 },
      authority_effect: false,
    };
    if (surfaceState === 'CHAT_ROOT') {
      return {
        ...base,
        semantic_targets: [
          { role: 'button', name: 'Agent', semantic_ref: semanticRef('a'), backend_node_id: 11 },
        ],
        interaction_tree: { elements: [{ role: 'button', text: 'GLM-5.2' }] },
      };
    }
    if (surfaceState === 'AGENT_HOME' || surfaceState === 'AGENT_TASK') {
      return {
        ...base,
        semantic_targets: [
          { role: 'button', name: 'Agent', semantic_ref: semanticRef('b'), backend_node_id: 21 },
          { role: 'button', name: 'New Task', semantic_ref: semanticRef('c'), backend_node_id: 22 },
          { role: 'button', name: 'Full-Stack', semantic_ref: semanticRef('d'), backend_node_id: 23 },
          { role: 'button', name: 'Writing', semantic_ref: semanticRef('e'), backend_node_id: 24 },
          { role: 'button', name: 'Select a model', semantic_ref: semanticRef('f'), backend_node_id: 25 },
          ...(surfaceState === 'AGENT_TASK'
            ? [{ role: 'textbox', name: 'Describe your task', value_length: 0, value_sha256: null, semantic_ref: semanticRef('1'), backend_node_id: 31 }]
            : []),
        ],
        interaction_tree: { elements: [{ role: 'button', text: 'GLM-5.3-Flash' }] },
      };
    }
    return {
      ...base,
      semantic_targets: [
        { role: 'textbox', name: 'Send a Message', value_length: 0, semantic_ref: semanticRef('2'), backend_node_id: 41 },
        ...(generating ? [{ role: 'button', name: 'Stop generating', semantic_ref: semanticRef('3'), backend_node_id: 42 }] : []),
      ],
      interaction_tree: { elements: [{ role: 'button', text: 'GLM-5.3-Flash' }] },
    };
  };

  const executeCommand = async (command) => {
    calls.push(['command', command.action, command.payload?.accessible_name || command.payload?.key || null]);
    if (command.action === 'FLEET_RECONCILE') return structuredClone(state.fleet);
    if (command.action === 'SELECT_TAB') {
      syncSelection(command.payload.tab_id);
      return { ok: true, tab_id: command.payload.tab_id };
    }
    if (command.action === 'CAPTURE') {
      captureCount += 1;
      return frame({ generating: surfaceState === 'CONVERSATION' && submitCount >= 2 });
    }
    if (command.action === 'TYPED_CLICK') {
      if (command.payload.accessible_name === 'Agent' && surfaceState === 'CHAT_ROOT') {
        surfaceState = 'AGENT_HOME';
        return { activation: { method: 'DOM_CLICK' }, mouse_geometry_required: false, authority_effect: true };
      }
      if (command.payload.accessible_name === 'New Task' && surfaceState === 'AGENT_HOME') {
        surfaceState = 'AGENT_TASK';
        return { activation: { method: 'DOM_CLICK' }, mouse_geometry_required: false, authority_effect: true };
      }
      throw new Error(`unexpected_activation:${command.payload.accessible_name}:${surfaceState}`);
    }
    if (command.action === 'SEMANTIC_TYPE') {
      assert.equal(command.payload.submit_after_type, true);
      submitCount += 1;
      if (submitCount === 1) {
        assert.equal(surfaceState, 'AGENT_TASK');
        surfaceState = 'CONVERSATION';
        state.tabs[1].url = CONVERSATION;
      }
      return {
        effect_state: submitCount === 1 ? 'PROVEN_NEW_CONVERSATION' : 'PROVEN_COMPOSER_CLEARED',
        composer_cleared: true,
        new_conversation_observed: submitCount === 1,
        stop_observed: false,
        automatic_retry_allowed: false,
        authority_effect: true,
      };
    }
    if (command.action === 'PRESS_KEY') {
      return { key: command.payload.key, mouse_geometry_required: false, authority_effect: true };
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
      assert.equal(state.fleet.agents[0].lifecycle_state, 'ACTIVE', 'scheduler must see only canonical conversation ACTIVE');
      assert.equal(state.fleet.agents[0].transport_proof.transport_stage, undefined);
      assert.equal(state.fleet.agents[0].transport_proof.conversation_url_sha256, sha256(CONVERSATION));
      assert.match(state.fleet.agents[0].transport_proof.agent_surface_sha256, /^[a-f0-9]{64}$/);
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
      assert.match(request.payload.proof.agent_surface_sha256, /^[a-f0-9]{64}$/);
      const current = state.fleet.agents[0].transport_proof;
      markRunningObservedCanonicalProof = current.transport_stage !== 'PRECONVERSATION_ROOT'
        && current.conversation_url_sha256 === sha256(CONVERSATION)
        && /^[a-f0-9]{64}$/.test(current.agent_surface_sha256);
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
    assert.equal(snapshot.fleet_transport_promotion.state, 'LOCAL_ACTIVE_AGENT_SESSION');
    assert.equal(snapshot.fleet_transport_promotion.transport_stage, 'CONVERSATION');
    assert.equal(snapshot.fleet_transport_promotion.write_ahead_barrier_persisted, true);
    assert.equal(snapshot.dispatch.state, 'RUNNING');
    assert.equal(snapshot.fleet_transport_proof.state, 'PREEXISTING_ACTIVE_PROOF_REVALIDATED');
    assert.equal(markRunningObservedCanonicalProof, true, 'canonical proof must exist before DB RUNNING receipt');
    assert.equal(state.fleet.agents[0].transport_proof.transport_stage, undefined);
    assert.equal(state.fleet.agents[0].transport_proof.conversation_url_sha256, sha256(CONVERSATION));
    assert.equal(submitCount, 2, 'one bootstrap seed and one task submit are expected');
    assert.equal(calls.filter((row) => row[0] === 'command' && row[1] === 'SEMANTIC_TYPE').length, 2);
    const activations = calls.filter((row) => row[0] === 'command' && row[1] === 'TYPED_CLICK');
    assert.deepEqual(activations.map((row) => row[2]), ['Agent', 'New Task']);
    const typeIndexes = calls.map((row, index) => row[1] === 'SEMANTIC_TYPE' ? index : -1).filter((index) => index >= 0);
    const cycleIndex = calls.findIndex((row) => row[1] === '/v1/devos/cycle');
    const markRunningIndex = calls.findIndex((row) => row[1] === '/v1/devos/mark-running');
    assert.ok(calls.findIndex((row) => row[1] === '/v1/devos/promotion-release') < cycleIndex);
    assert.ok(typeIndexes[0] < cycleIndex, 'bootstrap seed must precede scheduler lease');
    assert.ok(typeIndexes[1] > cycleIndex && typeIndexes[1] < markRunningIndex, 'task submit must follow scheduler lease and precede mark-running');
  } finally {
    clearFleetRuntime(fleetRuntime);
  }
});
