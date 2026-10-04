import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { DevOsNativeTaskCycle } from '../src/devos-native-task-cycle.mjs';
import { clearFleetRuntime, registerFleetRuntime } from '../src/fleet-runtime-bridge.mjs';

const AGENT_ID = 'agent_12345678-abcd';
const TAB_ID = 'tab_12345678-1234-4123-8123-123456789abc';
const TARGET_ID = 'webcontents:41';
const LEASE_ID = '12345678-1234-4123-8123-123456789abc';
const ROOT = 'https://chatgpt.com/';
const CONVERSATION = 'https://chatgpt.com/c/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) };
}

function harness({ tabUrl = CONVERSATION, releaseThrows = false, bootstrapSucceeds = true, resetThrows = false } = {}) {
  const calls = [];
  let surfaceState = tabUrl === ROOT ? 'CHAT_ROOT' : 'CONVERSATION';
  let submitCount = 0;
  let typedDraft = '';
  const state = {
    tabs: [{ tab_id: TAB_ID, url: tabUrl, selected: false }],
    active_tab: null,
    fleet: {
      schema: 'metaengine.browser.fleet-snapshot.v1',
      readiness_contract: 'TRANSPORT_PROOF_REQUIRED',
      policy: { warm_agents: 0, spawn_burst_limit: 1 },
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
        agent_id: AGENT_ID, tab_id: TAB_ID, target_id: TARGET_ID, generation_epoch: 7, transport_url: ROOT,
      });
      const agent = state.fleet.agents[0];
      agent.lifecycle_state = 'BOUND_UNVERIFIED';
      agent.transport_proof = {
        schema: 'metaengine.browser.fleet-transport-proof.v1',
        transport_stage: 'PRECONVERSATION_ROOT',
        tab_id: TAB_ID,
        target_id: TARGET_ID,
        generation_epoch: 7,
        conversation_url_sha256: sha256(ROOT),
        proven_at: new Date().toISOString(),
        authority_effect: false,
      };
      return structuredClone(state.fleet);
    },
    markTransportProven: async ({ agent_id, tab_id, target_id, generation_epoch, conversation_url, agent_surface_sha256 }) => {
      assert.deepEqual({ agent_id, tab_id, target_id, generation_epoch, conversation_url }, {
        agent_id: AGENT_ID, tab_id: TAB_ID, target_id: TARGET_ID, generation_epoch: 7, conversation_url: CONVERSATION,
      });
      assert.match(agent_surface_sha256, /^[a-f0-9]{64}$/);
      const agent = state.fleet.agents[0];
      agent.lifecycle_state = 'ACTIVE';
      agent.ambiguous_reason = null;
      agent.transport_proof = {
        schema: 'metaengine.browser.fleet-transport-proof.v1',
        tab_id: TAB_ID,
        target_id: TARGET_ID,
        generation_epoch: 7,
        conversation_url: CONVERSATION,
        conversation_url_sha256: sha256(CONVERSATION),
        agent_surface_sha256,
        proven_at: new Date().toISOString(),
        authority_effect: false,
      };
      return structuredClone(state.fleet);
    },
  };
  registerFleetRuntime(fleetRuntime);

  const ref = (char) => ({
    schema: 'metaengine.native-browser.semantic-ref.v1',
    semantic_ref_id: 'semref_' + char.repeat(64),
  });
  const rawFrame = () => {
    const base = {
      schema: 'metaengine.native-browser.perception.v1',
      tab_id: TAB_ID,
      target_id: TARGET_ID,
      process_incarnation_id: 'process-incarnation-test-1',
      state_revision_id: 'rev_' + sha256(surfaceState),
      url: surfaceState === 'CONVERSATION' ? CONVERSATION : ROOT,
      authority_effect: false,
    };
    if (surfaceState === 'CHAT_ROOT') {
      return {
        ...base,
        semantic_targets: [{ role: 'textbox', name: 'Message ChatGPT', value_length: 0, semantic_ref: ref('a'), backend_node_id: 11 }],
        interaction_tree: { elements: [] },
      };
    }
    if (surfaceState === 'AGENT_HOME' || surfaceState === 'AGENT_TASK') {
      return {
        ...base,
        semantic_targets: [
          { role: 'button', name: 'Agent', semantic_ref: ref('b'), backend_node_id: 21 },
          { role: 'button', name: 'New Task', semantic_ref: ref('c'), backend_node_id: 22 },
          { role: 'button', name: 'Full-Stack', semantic_ref: ref('d'), backend_node_id: 23 },
          { role: 'button', name: 'Writing', semantic_ref: ref('e'), backend_node_id: 24 },
          { role: 'button', name: 'Select a model', semantic_ref: ref('f'), backend_node_id: 25 },
          ...(surfaceState === 'AGENT_TASK'
            ? [{ role: 'textbox', name: 'Describe your task', value_length: 0, semantic_ref: ref('1'), backend_node_id: 31 }]
            : []),
        ],
        interaction_tree: { elements: [{ role: 'button', text: 'CHATGPT_ACCOUNT_SELECTED' }] },
      };
    }
    return {
      ...base,
      semantic_targets: [{ role: 'textbox', name: 'Message ChatGPT', value_length: 0, semantic_ref: ref('2'), backend_node_id: 41 }],
      interaction_tree: { elements: [{ role: 'button', text: 'CHATGPT_ACCOUNT_SELECTED' }] },
    };
  };

  const frame = (...args) => {
    const out = rawFrame(...args);
    const composer = out.semantic_targets?.find((row) => row.role === 'textbox' && row.name === 'Message ChatGPT');
    if (composer) {
      composer.value_length = typedDraft.length;
      composer.value_sha256 = typedDraft ? sha256(typedDraft) : null;
      if (typedDraft) out.semantic_targets.push({ role:'button',name:'Send prompt',backend_node_id:99,semantic_ref:{ schema:'metaengine.native-browser.semantic-ref.v1',semantic_ref_id:'semref_' + '9'.repeat(64) } });
    }
    return out;
  };

  const executeCommand = async (command) => {
    calls.push(['command', command.action, command.payload?.accessible_name || command.payload?.key || null]);
    if (command.action === 'CAPTURE') return frame();
    if (command.action === 'NAVIGATE') {
      assert.equal(command.payload.tab_id, TAB_ID);
      assert.equal(command.payload.url, ROOT);
      if (resetThrows) throw new Error('navigation_receipt_lost');
      surfaceState = 'CHAT_ROOT';
      state.tabs[0].url = ROOT;
      return { ok: true, tab_id: TAB_ID, url: ROOT, authority_effect: true };
    }
    if (command.action === 'SEMANTIC_TYPE') {
      assert.equal(command.payload.submit_after_type, false);
      assert.equal(command.payload.replace_existing, true);
      typedDraft = command.payload.text;
      return { replace_verified:true,authority_effect:true };
    }
    if (command.action === 'TYPED_CLICK') {
      assert.equal(surfaceState, 'CHAT_ROOT');
      assert.equal(command.payload.chatgpt_submit, true);
      assert.equal(command.payload.accessible_name, 'Send prompt');
      typedDraft = '';
      submitCount += 1;
      if (bootstrapSucceeds) {
        surfaceState = 'CONVERSATION';
        state.tabs[0].url = CONVERSATION;
      }
      return {
        effect_state: bootstrapSucceeds ? 'PROVEN_NEW_CONVERSATION' : 'AMBIGUOUS_AFTER_SEND',
        composer_cleared: bootstrapSucceeds,
        new_conversation_observed: bootstrapSucceeds,
        automatic_retry_allowed: false,
        authority_effect: true,
      };
    }
    if (command.action === 'PRESS_KEY') {
      return { key: command.payload.key, mouse_geometry_required: false, authority_effect: true };
    }
    if (command.action === 'FLEET_RECONCILE') return { ok: true, authority_effect: false };
    throw new Error(`unexpected_command:${command.action}`);
  };

  const signedRequest = async (path) => {
    calls.push(['http', path]);
    if (path === '/v1/devos/promotion-lease') {
      return response(200, {
        schema: 'metaengine.devos.transport-promotion-lease.v1',
        leased: true,
        lease_id: LEASE_ID,
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
    }
    if (path === '/v1/devos/promotion-release') {
      if (releaseThrows) throw new Error('release_ack_lost');
      return response(200, {
        schema: 'metaengine.devos.transport-promotion-release.v1',
        released: true,
        lease_id: LEASE_ID,
        authority_effect: false,
      });
    }
    if (path === '/v1/devos/cycle') {
      return response(200, {
        schema: 'metaengine.devos.browser-cycle.v1',
        backlog: { ready: 0, running: 0 },
        lease: null,
        running: [],
        authority_effect: false,
      });
    }
    throw new Error(`unexpected_http:${path}`);
  };

  const cycle = new DevOsNativeTaskCycle({
    getState: async () => structuredClone(state),
    executeCommand,
    signedRequest,
  });
  return { cycle, state, calls, getSurfaceState: () => surfaceState, cleanup: () => clearFleetRuntime(fleetRuntime) };
}

test('restored bare conversation is reset to canonical root and rebuilt as a proven Agent session', async () => {
  const h = harness();
  try {
    const snapshot = await h.cycle.cycle();
    assert.equal(h.state.fleet.agents[0].lifecycle_state, 'ACTIVE');
    assert.equal(snapshot.fleet_transport_promotion.state, 'LOCAL_ACTIVE_AGENT_SESSION');
    assert.equal(snapshot.fleet_transport_promotion.transport_stage, 'CONVERSATION');
    assert.equal(snapshot.fleet_transport_promotion.release_state, 'CONFIRMED');
    assert.equal(snapshot.fleet_transport_promotion.bootstrap_effect_state, 'PROVEN_NEW_CONVERSATION');
    assert.match(snapshot.fleet_transport_promotion.agent_surface_sha256, /^[a-f0-9]{64}$/);
    assert.equal(h.calls.filter((row) => row[1] === 'NAVIGATE').length, 1, 'unproven conversation is reset exactly once');
    assert.equal(h.calls.filter((row) => row[1] === 'SEMANTIC_TYPE').length, 1, 'only the canonical ChatGPT seed is submitted');
    assert.deepEqual(
      h.calls.filter((row) => row[1] === 'TYPED_CLICK').map((row) => row[2]),
      ['Send prompt'],
    );
  } finally {
    h.cleanup();
  }
});

test('ambiguous restart reset is write-ahead fenced and never blindly navigated again', async () => {
  const h = harness({ resetThrows: true });
  try {
    const first = await h.cycle.cycle();
    assert.equal(h.state.fleet.agents[0].lifecycle_state, 'PROVISIONING_AMBIGUOUS');
    assert.equal(h.state.fleet.agents[0].ambiguous_reason, 'TRANSPORT_BOOTSTRAP_EFFECT_PENDING');
    assert.equal(first.fleet_transport_promotion.state, 'LOCAL_PRECONVERSATION_BOOTSTRAP_AMBIGUOUS');
    assert.equal(first.fleet_transport_promotion.write_ahead_barrier_persisted, true);
    assert.equal(first.fleet_transport_promotion.release_state, 'CONFIRMED');
    assert.equal(h.calls.filter((row) => row[1] === 'NAVIGATE').length, 1);

    await h.cycle.cycle();
    assert.equal(h.calls.filter((row) => row[1] === 'NAVIGATE').length, 1, 'ambiguous navigation must never be replayed');
    assert.equal(h.calls.filter((row) => row[1] === '/v1/devos/promotion-lease').length, 1);
  } finally {
    h.cleanup();
  }
});

test('root ChatGPT tab is bootstrapped into an isolated conversation before scheduler cycle', async () => {
  const h = harness({ tabUrl: ROOT });
  try {
    const snapshot = await h.cycle.cycle();
    assert.equal(h.state.fleet.agents[0].lifecycle_state, 'ACTIVE');
    assert.match(h.state.fleet.agents[0].transport_proof.agent_surface_sha256, /^[a-f0-9]{64}$/);
    assert.equal(snapshot.fleet_transport_promotion.state, 'LOCAL_ACTIVE_AGENT_SESSION');
    assert.equal(snapshot.fleet_transport_promotion.transport_stage, 'CONVERSATION');
    assert.match(snapshot.fleet_transport_promotion.agent_surface_sha256, /^[a-f0-9]{64}$/);
    assert.match(snapshot.fleet_transport_promotion.bootstrap_prompt_sha256, /^[a-f0-9]{64}$/);
    assert.equal(snapshot.fleet_transport_promotion.write_ahead_barrier_persisted, true);
    assert.equal(h.calls.filter((row) => row[1] === 'SEMANTIC_TYPE').length, 1);
    assert.deepEqual(
      h.calls.filter((row) => row[1] === 'TYPED_CLICK').map((row) => row[2]),
      ['Send prompt'],
    );
    const bootstrapIndex = h.calls.findIndex((row) => row[1] === 'SEMANTIC_TYPE');
    const cycleIndex = h.calls.findIndex((row) => row[1] === '/v1/devos/cycle');
    assert.ok(bootstrapIndex >= 0 && cycleIndex > bootstrapIndex, 'ChatGPT agent bootstrap must complete before scheduler cycle');
  } finally {
    h.cleanup();
  }
});

test('lost promotion-release ACK never repeats successful ChatGPT agent bootstrap', async () => {
  const h = harness({ tabUrl: ROOT, releaseThrows: true });
  try {
    const first = await h.cycle.cycle();
    assert.equal(h.state.fleet.agents[0].lifecycle_state, 'ACTIVE');
    assert.equal(first.fleet_transport_promotion.state, 'LOCAL_ACTIVE_AGENT_SESSION');
    assert.equal(first.fleet_transport_promotion.release_state, 'AMBIGUOUS');
    const firstSeedCount = h.calls.filter((row) => row[1] === 'SEMANTIC_TYPE').length;
    assert.equal(firstSeedCount, 1);
    assert.equal(h.calls.some((row) => row[1] === '/v1/devos/cycle'), true);

    await h.cycle.cycle();
    assert.equal(h.calls.filter((row) => row[1] === '/v1/devos/promotion-lease').length, 1);
    assert.equal(h.calls.filter((row) => row[1] === 'SEMANTIC_TYPE').length, 1, 'successful ChatGPT agent bootstrap must not replay');
  } finally {
    h.cleanup();
  }
});

test('ambiguous ChatGPT agent bootstrap is write-ahead fenced and never auto-submitted again', async () => {
  const h = harness({ tabUrl: ROOT, bootstrapSucceeds: false });
  try {
    const first = await h.cycle.cycle();
    assert.equal(h.state.fleet.agents[0].lifecycle_state, 'PROVISIONING_AMBIGUOUS');
    assert.equal(h.state.fleet.agents[0].ambiguous_reason, 'TRANSPORT_BOOTSTRAP_EFFECT_PENDING');
    assert.equal(first.fleet_transport_promotion.state, 'LOCAL_AGENT_SESSION_BOOTSTRAP_AMBIGUOUS');
    assert.equal(first.fleet_transport_promotion.write_ahead_barrier_persisted, true);
    assert.equal(h.calls.filter((row) => row[1] === 'SEMANTIC_TYPE').length, 1);

    await h.cycle.cycle();
    assert.equal(h.calls.filter((row) => row[1] === 'SEMANTIC_TYPE').length, 1, 'ambiguous ChatGPT agent bootstrap must not replay');
    assert.equal(h.calls.filter((row) => row[1] === '/v1/devos/promotion-lease').length, 1);
  } finally {
    h.cleanup();
  }
});
