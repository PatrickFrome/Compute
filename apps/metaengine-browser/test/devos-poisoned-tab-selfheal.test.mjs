import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import { DevOsNativeTaskCycle } from '../src/devos-native-task-cycle.mjs';

const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

// B-SH1 (live 2026-09-21 regression class): a replace-seed failure on an
// over-limit poisoned root draft used to leave the tab alive forever — the
// same 37921-char draft dead-ended every later lease (flush_over_limit=5
// live) and the per-(agent, epoch) guard blocked re-attempts. The dispatcher
// now re-captures and CLOSES a STILL-poisoned tab (the elastic governor
// re-provisions it on the next reconcile); a provably-cleared draft is
// preserved. These tests pin the proof-based self-healing.

const AGENT_ID = 'agent_selfheal-1111';
const TAB_ID = 'tab_selfheal-2222-3333-4444-555555555555';
const TARGET_ID = 'webcontents:77';
const TASK_ID = '86543210-1111-4222-8333-444455556666';
const ROOT = 'https://chat.z.ai/';

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) };
}

function frame({ url = ROOT, valueLength = 40000 } = {}) {
  return {
    schema: 'metaengine.native-browser.perception.v1',
    tab_id: TAB_ID,
    target_id: TARGET_ID,
    url,
    semantic_targets: [
      { role: 'textbox', name: null, semantic_ref: { schema: 'metaengine.native-browser.semantic-ref.v1', semantic_ref_id: 'semref_' + 'f'.repeat(64) }, backend_node_id: 5, value_length: valueLength },
    ],
    authority_effect: false,
  };
}

function fleetState({ valueLength = 40000 } = {}) {
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
  branch_name: 'work/devos-poisoned-tab-selfheal',
  automatic_retry_allowed: false,
  task_spec: {
    schema: 'metaengine.devos.task.v1',
    objective: 'Verify the poisoned agent tab is closed by proof after a failed replace-seed.',
    constraints: ['no blind retry'],
    deliverable: 'proof-based self-heal receipt',
  },
};

function registerNoopFleetRuntime() {
  return null;
}

test('a still-poisoned tab after a failed replace-seed is closed by proof and the over-limit error stays honest', async () => {
  const closes = [];
  const types = [];
  let captureCount = 0;
  const state = fleetState({ valueLength: 40000 });
  const executeCommand = async (command) => {
    if (command.action === 'FLEET_RECONCILE') return state.fleet;
    if (command.action === 'CAPTURE') {
      captureCount += 1;
      // Every capture shows the SAME 40000-char poisoned draft — the replace
      // provably never landed (the live OVER_LIMIT_REPLACE_SEED_FAILED shape).
      return frame({ url: ROOT, valueLength: 40000 });
    }
    if (command.action === 'SEMANTIC_TYPE') {
      types.push(String(command.payload?.text || ''));
      return { effect_state: 'AMBIGUOUS_AFTER_ENTER', composer_cleared: false, new_conversation_observed: false, stop_observed: false, authority_effect: true };
    }
    if (command.action === 'CLOSE_TAB') {
      closes.push(String(command.payload?.tab_id || ''));
      return { closed: true };
    }
    throw new Error(`unexpected_command:${command.action}`);
  };
  const signedRequest = async (path) => {
    if (path === '/v1/devos/cycle') return response(200, { schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 1, running: 0 }, lease, running: [] });
    throw new Error(`unexpected_http:${path}`);
  };
  const cycle = new DevOsNativeTaskCycle({ getState: async () => structuredClone(state), executeCommand, signedRequest });
  await assert.rejects(() => cycle.cycle(), /fleet_task_root_draft_over_flush_limit/);

  assert.equal(types.length, 1, 'only the seed replace was attempted');
  assert.deepEqual(closes, [TAB_ID], 'the still-poisoned tab was closed by proof (the governor re-provisions it)');
  const snap = cycle.snapshot();
  assert.equal(snap.dispatch_effect.last.state, 'POISONED_AGENT_TAB_CLOSED');
  assert.equal(snap.dispatch_effect.last.composer_chars_before, 40000);
  assert.equal(snap.dispatch_effect.counters.flush_over_limit, 1);
  void registerNoopFleetRuntime;
});

test('a draft that provably cleared between the replace and the recheck is preserved — no tab is closed', async () => {
  const closes = [];
  let captureCount = 0;
  const state = fleetState({ valueLength: 40000 });
  const executeCommand = async (command) => {
    if (command.action === 'FLEET_RECONCILE') return state.fleet;
    if (command.action === 'CAPTURE') {
      captureCount += 1;
      // Capture 1: the dispatch pre-capture (poisoned). Capture 2+: the
      // replace secretly landed late — the composer now holds nothing.
      return captureCount === 1 ? frame({ url: ROOT, valueLength: 40000 }) : frame({ url: ROOT, valueLength: 0 });
    }
    if (command.action === 'SEMANTIC_TYPE') {
      return { effect_state: 'AMBIGUOUS_AFTER_ENTER', composer_cleared: false, new_conversation_observed: false, stop_observed: false, authority_effect: true };
    }
    if (command.action === 'CLOSE_TAB') {
      closes.push(String(command.payload?.tab_id || ''));
      return { closed: true };
    }
    throw new Error(`unexpected_command:${command.action}`);
  };
  const signedRequest = async (path) => {
    if (path === '/v1/devos/cycle') return response(200, { schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 1, running: 0 }, lease, running: [] });
    throw new Error(`unexpected_http:${path}`);
  };
  const cycle = new DevOsNativeTaskCycle({ getState: async () => structuredClone(state), executeCommand, signedRequest });
  await assert.rejects(() => cycle.cycle(), /fleet_task_root_draft_over_flush_limit/);

  assert.deepEqual(closes, [], 'a healed surface is never closed');
  assert.equal(cycle.snapshot().dispatch_effect.last.state, 'POISONED_AGENT_TAB_PRESERVED_DRAFT_CLEARED');
});
