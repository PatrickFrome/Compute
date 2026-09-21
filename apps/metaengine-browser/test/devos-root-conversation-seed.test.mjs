import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import { DevOsNativeTaskCycle } from '../src/devos-native-task-cycle.mjs';
import { buildDevosRuntimeObservability } from '../src/devos-runtime-observability.mjs';
import { clearFleetRuntime, registerFleetRuntime } from '../src/fleet-runtime-bridge.mjs';

const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

// LIVE 2026-09-21 (B0/A1/C10 triple-AMBIGUOUS regression class): the GLM root
// composer silently refuses Enter on oversized drafts, so a capsule-sized
// FIRST dispatch could never create the conversation. The dispatcher now
// bootstraps the root surface with a tiny deterministic SEED message (and
// replaces an over-limit poisoned draft with it) before the real dispatch.
const AGENT_ID = 'agent_seedtest-1111';
const TAB_ID = 'tab_seedtest-2222-3333-4444-555555555555';
const TARGET_ID = 'webcontents:77';
const TASK_ID = '76543210-1111-4222-8333-444455556666';
const CONVERSATION = 'https://chat.z.ai/c/11111111-abcd-4ccc-8ddd-eeeeffff0000';
const ROOT = 'https://chat.z.ai/';

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) };
}

function frame({ url = ROOT, valueLength = 0 } = {}) {
  return {
    schema: 'metaengine.native-browser.perception.v1',
    tab_id: TAB_ID,
    target_id: TARGET_ID,
    process_incarnation_id: 'process-incarnation-seed-test',
    url,
    viewport: { width: 1200, height: 800 },
    semantic_targets: [
      { role: 'textbox', name: null, semantic_ref: { schema: 'metaengine.native-browser.semantic-ref.v1', semantic_ref_id: 'semref_' + 'e'.repeat(64) }, backend_node_id: 5, value_length: valueLength },
    ],
    authority_effect: false,
  };
}

function fleetState({ valueLength = 0 } = {}) {
  return {
    tabs: [
      { tab_id: 'tab_supervisor', url: 'https://chat.z.ai/c/supervisor-1', selected: true },
      { tab_id: TAB_ID, url: ROOT, selected: false },
    ],
    active_tab: { tab_id: 'tab_supervisor' },
    fleet: {
      schema: 'metaengine.browser.fleet-snapshot.v1',
      readiness_contract: 'TRANSPORT_PROOF_REQUIRED',
      policy: { warm_agents: 0, desired_agents: 1, spawn_burst_limit: 1 },
      agents: [{
        agent_id: AGENT_ID,
        role: 'PLANNER',
        ownership: 'FLEET_OWNED',
        lifecycle_state: 'ACTIVE',
        tab_id: TAB_ID,
        target_id: TARGET_ID,
        generation_epoch: 3,
        transport_proof: {
          schema: 'metaengine.browser.fleet-transport-proof.v1',
          transport_stage: 'PRECONVERSATION_ROOT',
          tab_id: TAB_ID,
          target_id: TARGET_ID,
          generation_epoch: 3,
          conversation_url_sha256: sha256(ROOT),
          proven_at: new Date().toISOString(),
          authority_effect: false,
        },
        automatic_retry_allowed: false,
        authority_effect: false,
      }],
      authority_effect: false,
    },
    __valueLength: valueLength,
  };
}

const lease = {
  task_id: TASK_ID,
  agent_id: AGENT_ID,
  role: 'PLANNER',
  tab_id: TAB_ID,
  target_id: TARGET_ID,
  agent_generation_epoch: 3,
  lease_generation: 1,
  base_sha: 'db5c83db806197b38b37338cdaff1ce69b825c08',
  branch_name: 'work/devos-root-conversation-seed',
  automatic_retry_allowed: false,
  task_spec: {
    schema: 'metaengine.devos.task.v1',
    objective: 'Verify the conversation seed bootstrap proves the root surface before the full dispatch.',
    constraints: ['no blind retry'],
    deliverable: 'seed proof and running receipt',
  },
};

// Registers an in-memory fleet runtime so the seed's transport-proof upgrade
// (root → conversation) can persist before the mark-running receipt.
function registerSeedFleetRuntime(state) {
  const fleetRuntime = {
    snapshot: () => structuredClone(state.fleet),
    markTransportProven: async ({ conversation_url }) => {
      const agent = state.fleet.agents[0];
      agent.lifecycle_state = 'ACTIVE';
      agent.transport_proof = {
        schema: 'metaengine.browser.fleet-transport-proof.v1',
        tab_id: TAB_ID,
        target_id: TARGET_ID,
        generation_epoch: 3,
        conversation_url_sha256: sha256(conversation_url),
        proven_at: new Date().toISOString(),
        authority_effect: false,
      };
      return structuredClone(state.fleet);
    },
  };
  registerFleetRuntime(fleetRuntime);
  return fleetRuntime;
}

test('clean root composer is seeded first: tiny seed submit proves the conversation, then the full prompt dispatches there', async () => {
  const types = [];
  let captureCount = 0;
  const state = fleetState({ valueLength: 0 });
  const executeCommand = async (command) => {
    if (command.action === 'FLEET_RECONCILE') return state.fleet;
    if (command.action === 'CAPTURE') {
      captureCount += 1;
      if (captureCount === 1) return frame({ url: ROOT, valueLength: 0 }); // dispatch pre-capture (root, clean composer)
      return frame({ url: CONVERSATION }); // seed readback + rebind + dispatch readback
    }
    if (command.action === 'SEMANTIC_TYPE') {
      types.push({ text: command.payload.text, replace: command.payload.replace_existing === true });
      return { effect_state: 'PROVEN_COMPOSER_CLEARED', composer_cleared: true, new_conversation_observed: types.length === 1, stop_observed: false, automatic_retry_allowed: false, authority_effect: true };
    }
    throw new Error(`unexpected_command:${command.action}`);
  };
  const signedRequest = async (path) => {
    if (path === '/v1/devos/cycle') return response(200, { schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 1, running: 0 }, lease, running: [] });
    if (path === '/v1/devos/mark-running') return response(200, { state: 'RUNNING' });
    throw new Error(`unexpected_http:${path}`);
  };
  const cycle = new DevOsNativeTaskCycle({ getState: async () => structuredClone(state), executeCommand, signedRequest });
  const runtime = registerSeedFleetRuntime(state);
  let snapshot;
  try {
    snapshot = await cycle.cycle();
  } finally {
    clearFleetRuntime(runtime);
  }
  assert.equal(snapshot.dispatch.state, 'RUNNING');
  assert.equal(types.length, 2, 'exactly two submits: the conversation seed, then the full task prompt');
  assert.equal(types[0].replace, true, 'the seed replaces the (empty) root draft');
  assert.ok(types[0].text.length < 1000, 'the seed must stay far below any site-side oversize refusal threshold');
  assert.ok(!types[0].text.includes('METAENGINE FLEET TASK V1'), 'the seed is not the task prompt');
  assert.ok(types[1].text.includes('METAENGINE FLEET TASK V1'), 'the real dispatch carries the task prompt');
  assert.equal(snapshot.dispatch.conversation_bootstrap, 'SEED_CONVERSATION_PROVEN');
  assert.deepEqual(snapshot.dispatch_effect.counters, { dispatches: 1, proven: 1, ambiguous: 0, seed_attempts: 1, seed_proven: 1, flush_over_limit: 0 });
  assert.equal(snapshot.dispatch_effect.last.state, 'PROVEN');
  assert.equal(snapshot.dispatch_effect.last.stage, 'DISPATCH');
});

test('an over-limit poisoned root draft is REPLACED with the seed instead of the permanent over_flush_limit dead end', async () => {
  const types = [];
  let captureCount = 0;
  const state = fleetState({ valueLength: 40000 });
  const executeCommand = async (command) => {
    if (command.action === 'FLEET_RECONCILE') return state.fleet;
    if (command.action === 'CAPTURE') {
      captureCount += 1;
      if (captureCount === 1) return frame({ url: ROOT, valueLength: 40000 }); // dispatch pre-capture (root, poisoned)
      return frame({ url: CONVERSATION });
    }
    if (command.action === 'SEMANTIC_TYPE') {
      types.push({ text: command.payload.text, replace: command.payload.replace_existing === true });
      return { effect_state: 'PROVEN_COMPOSER_CLEARED', composer_cleared: true, new_conversation_observed: types.length === 1, stop_observed: false, automatic_retry_allowed: false, authority_effect: true };
    }
    throw new Error(`unexpected_command:${command.action}`);
  };
  const signedRequest = async (path) => {
    if (path === '/v1/devos/cycle') return response(200, { schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 1, running: 0 }, lease, running: [] });
    if (path === '/v1/devos/mark-running') return response(200, { state: 'RUNNING' });
    throw new Error(`unexpected_http:${path}`);
  };
  const cycle = new DevOsNativeTaskCycle({ getState: async () => structuredClone(state), executeCommand, signedRequest });
  const runtime = registerSeedFleetRuntime(state);
  let snapshot;
  try {
    snapshot = await cycle.cycle();
  } finally {
    clearFleetRuntime(runtime);
  }
  assert.equal(snapshot.dispatch.state, 'RUNNING');
  assert.equal(types[0].replace, true, 'the over-limit draft path must REPLACE (CLICK_SELECT wholesale), never append');
  assert.ok(types[0].text.length < 1000);
  assert.equal(snapshot.dispatch_effect.last.composer_chars_before, 40000);
  assert.equal(snapshot.dispatch_effect.counters.flush_over_limit, 0, 'no over_flush_limit dead end when the replace verifies');
});

test('a refused seed submit fails the dispatch honestly and never types the oversized task prompt into the root composer', async () => {
  const types = [];
  const state = fleetState({ valueLength: 0 });
  const executeCommand = async (command) => {
    if (command.action === 'FLEET_RECONCILE') return state.fleet;
    if (command.action === 'CAPTURE') return frame({ url: ROOT, valueLength: 0 });
    if (command.action === 'SEMANTIC_TYPE') {
      types.push(command.payload.text);
      return { effect_state: 'AMBIGUOUS_AFTER_ENTER', composer_cleared: false, new_conversation_observed: false, stop_observed: false, automatic_retry_allowed: false, authority_effect: true };
    }
    throw new Error(`unexpected_command:${command.action}`);
  };
  const signedRequest = async (path) => {
    if (path === '/v1/devos/cycle') return response(200, { schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 1, running: 0 }, lease, running: [] });
    throw new Error(`unexpected_http:${path}`);
  };
  const cycle = new DevOsNativeTaskCycle({ getState: async () => structuredClone(state), executeCommand, signedRequest });
  await assert.rejects(() => cycle.cycle(), /devos_seed_submit_refused/);
  assert.equal(types.length, 1, 'only the seed was typed — the task prompt must not poison the root composer');
  assert.ok(types[0].length < 1000);
  assert.equal(cycle.snapshot().dispatch_effect.last.state, 'SEED_SUBMIT_REFUSED');
});

test('dispatch_effect telemetry rides the bounded devos runtime observability plane', () => {
  const projection = buildDevosRuntimeObservability({
    devos_task_cycle: {
      dispatch_effect: {
        last: { at: '2026-09-21T08:30:00.000Z', stage: 'SEED', state: 'SEED_CONVERSATION_PROVEN', effect_state: 'PROVEN_NEW_CONVERSATION', task_id: TASK_ID, agent_id: AGENT_ID, composer_chars_before: 40000 },
        counters: { dispatches: 2, proven: 1, ambiguous: 1, seed_attempts: 2, seed_proven: 1, flush_over_limit: 0 },
      },
    },
  });
  assert.equal(projection.dispatch.last_state, 'SEED_CONVERSATION_PROVEN');
  assert.equal(projection.dispatch.last_stage, 'SEED');
  assert.equal(projection.dispatch.last_effect_state, 'PROVEN_NEW_CONVERSATION');
  assert.equal(projection.dispatch.last_composer_chars_before, 40000);
  assert.equal(projection.dispatch.dispatches, 2);
  assert.equal(projection.dispatch.seed_attempts, 2);
  assert.equal(projection.dispatch.seed_proven, 1);
  assert.equal(projection.dispatch.authority_effect, false);
  // absent telemetry must stay null-shaped, never throw
  const empty = buildDevosRuntimeObservability({});
  assert.equal(empty.dispatch.last_state, null);
  assert.equal(empty.dispatch.dispatches, null);
});
