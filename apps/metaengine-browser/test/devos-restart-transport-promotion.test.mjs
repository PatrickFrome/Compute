import assert from 'node:assert/strict';
import test from 'node:test';
import { DevOsNativeTaskCycle } from '../src/devos-native-task-cycle.mjs';
import { clearFleetRuntime, registerFleetRuntime } from '../src/fleet-runtime-bridge.mjs';

const AGENT_ID = 'agent_12345678-abcd';
const TAB_ID = 'tab_12345678-1234-4123-8123-123456789abc';
const TARGET_ID = 'webcontents:41';
const LEASE_ID = '12345678-1234-4123-8123-123456789abc';
const CONVERSATION = 'https://chatgpt.com/c/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) };
}

function harness({ tabUrl = CONVERSATION, releaseThrows = false } = {}) {
  const calls = [];
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
    markTransportProven: async ({ agent_id, tab_id, target_id, generation_epoch, conversation_url }) => {
      const agent = state.fleet.agents[0];
      assert.equal(agent_id, AGENT_ID);
      assert.equal(tab_id, TAB_ID);
      assert.equal(target_id, TARGET_ID);
      assert.equal(generation_epoch, 7);
      assert.equal(conversation_url, CONVERSATION);
      agent.lifecycle_state = 'ACTIVE';
      agent.transport_proof = {
        schema: 'metaengine.browser.fleet-transport-proof.v1',
        tab_id: TAB_ID,
        target_id: TARGET_ID,
        generation_epoch: 7,
        conversation_url_sha256: '1'.repeat(64),
        proven_at: new Date().toISOString(),
        authority_effect: false,
      };
      return structuredClone(state.fleet);
    },
  };
  registerFleetRuntime(fleetRuntime);

  const executeCommand = async (command) => {
    calls.push(['command', command.action]);
    if (command.action === 'CAPTURE') {
      return {
        schema: 'metaengine.native-browser.perception.v1',
        tab_id: TAB_ID,
        target_id: TARGET_ID,
        process_incarnation_id: 'process-incarnation-test-1',
        url: tabUrl,
        authority_effect: false,
      };
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
  return { cycle, state, calls, cleanup: () => clearFleetRuntime(fleetRuntime) };
}

test('one restored conversation is promoted locally before the normal scheduler cycle', async () => {
  const h = harness();
  try {
    const snapshot = await h.cycle.cycle();
    assert.equal(h.state.fleet.agents[0].lifecycle_state, 'ACTIVE');
    assert.equal(snapshot.fleet_transport_promotion.state, 'LOCAL_ACTIVE');
    assert.equal(snapshot.fleet_transport_promotion.release_state, 'CONFIRMED');
    assert.deepEqual(h.calls.slice(0, 4), [
      ['http', '/v1/devos/promotion-lease'],
      ['command', 'CAPTURE'],
      ['http', '/v1/devos/promotion-release'],
      ['http', '/v1/devos/cycle'],
    ]);
    assert.equal(h.calls.filter((row) => row[0] === 'command' && row[1] === 'CAPTURE').length, 1);
  } finally {
    h.cleanup();
  }
});

test('root ChatGPT tabs are never promoted merely to manufacture readiness', async () => {
  const h = harness({ tabUrl: 'https://chatgpt.com/' });
  try {
    const snapshot = await h.cycle.cycle();
    assert.equal(h.state.fleet.agents[0].lifecycle_state, 'BOUND_UNVERIFIED');
    assert.equal(snapshot.fleet_transport_promotion.state, 'NO_ELIGIBLE_CONVERSATION');
    assert.equal(h.calls.some((row) => row[1] === '/v1/devos/promotion-lease'), false);
    assert.equal(h.calls.some((row) => row[1] === 'CAPTURE'), false);
    assert.equal(h.calls.some((row) => row[1] === '/v1/devos/cycle'), true);
  } finally {
    h.cleanup();
  }
});

test('lost promotion-release ACK never repeats local Browser transport proof', async () => {
  const h = harness({ releaseThrows: true });
  try {
    const first = await h.cycle.cycle();
    assert.equal(h.state.fleet.agents[0].lifecycle_state, 'ACTIVE');
    assert.equal(first.fleet_transport_promotion.state, 'LOCAL_ACTIVE');
    assert.equal(first.fleet_transport_promotion.release_state, 'AMBIGUOUS');
    assert.equal(h.calls.filter((row) => row[1] === 'CAPTURE').length, 1);
    assert.equal(h.calls.some((row) => row[1] === '/v1/devos/cycle'), true, 'scheduler may be called; DB barrier owns mutual exclusion');

    await h.cycle.cycle();
    assert.equal(h.calls.filter((row) => row[1] === '/v1/devos/promotion-lease').length, 1);
    assert.equal(h.calls.filter((row) => row[1] === 'CAPTURE').length, 1);
  } finally {
    h.cleanup();
  }
});
