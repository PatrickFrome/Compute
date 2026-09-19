import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { SupervisorLifecycleRuntime } from '../src/supervisor-lifecycle-runtime.mjs';

const WORKSPACE_ID = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const ROOT_URL = 'https://chat.z.ai/';
const BOOTSTRAP_URL = 'https://chat.z.ai/c/11111111-2222-4333-8444-555555555555';
const FLEET_URL = 'https://chat.z.ai/c/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const runtimeOpen = Object.freeze({
  schema: 'metaengine.devos.environment-state.v1',
  workspace_id: WORKSPACE_ID,
  generation_floor: 28,
  refill_enabled: true,
  supervisor_admission_enabled: true,
  authority_effect: false,
});

function idleFrame(url, text = '') {
  return {
    url,
    title: 'ChatGPT',
    text_excerpt: text,
    semantic_targets: [
      { role: 'textbox', name: null, semantic_ref: { schema: 'metaengine.native-browser.semantic-ref.v1', semantic_ref_id: 'semref_' + '1'.repeat(64) }, backend_node_id: 3, value_length: 0 },
      { role: 'button', name: 'Send' },
    ],
  };
}

function generatingFrame(url, text = '') {
  return {
    url,
    title: 'ChatGPT',
    text_excerpt: text,
    semantic_targets: [
      { role: 'textbox', name: null, semantic_ref: { schema: 'metaengine.native-browser.semantic-ref.v1', semantic_ref_id: 'semref_' + '1'.repeat(64) }, backend_node_id: 3 },
      { role: 'button', name: 'Stop generating' },
    ],
  };
}

async function tempStatePath(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return { dir, statePath: path.join(dir, 'keepalive.json') };
}

test('authoritative OPEN bootstraps one dedicated root into the first bound supervisor conversation', async () => {
  const { dir, statePath } = await tempStatePath('metaengine-bootstrap-success-');
  const tabs = [
    { tab_id: 'user_root', url: ROOT_URL, selected: true },
    { tab_id: 'fleet_tab', url: FLEET_URL, selected: false },
  ];
  let bootstrapCreated = 0;
  let semanticSubmit = 0;
  let typed = '';
  let bootstrapGenerating = false;

  const getState = async () => ({
    tabs: structuredClone(tabs),
    fleet: { agents: [{ agent_id: 'agent_fleet', tab_id: 'fleet_tab', lifecycle_state: 'BOUND_UNVERIFIED' }] },
  });
  const executeCommand = async (command) => {
    const action = String(command.action || '');
    const tabId = String(command.payload?.tab_id || '');
    if (action === 'NEW_TAB') {
      bootstrapCreated += 1;
      const tab = { tab_id: `bootstrap_${bootstrapCreated}`, url: ROOT_URL, selected: false };
      tabs.push(tab);
      return structuredClone(tab);
    }
    if (action === 'CAPTURE') {
      if (tabId === 'fleet_tab') return idleFrame(FLEET_URL);
      if (tabId.startsWith('bootstrap_')) {
        return bootstrapGenerating ? generatingFrame(BOOTSTRAP_URL, typed) : idleFrame(ROOT_URL, typed);
      }
      if (tabId === 'user_root') return idleFrame(ROOT_URL);
      throw new Error(`unexpected_capture:${tabId}`);
    }
    if (action === 'SEMANTIC_TYPE') {
      assert.equal(tabId, 'bootstrap_1');
      assert.equal(command.payload?.submit_after_type, true);
      semanticSubmit += 1;
      typed = String(command.payload?.text || '');
      bootstrapGenerating = true;
      const tab = tabs.find((row) => row.tab_id === tabId);
      tab.url = BOOTSTRAP_URL;
      return {
        effect_state: 'PROVEN_NEW_CONVERSATION',
        event_driven_readback: true,
        url: BOOTSTRAP_URL,
        text_excerpt: typed,
        semantic_targets: [{ role: 'button', name: 'Stop generating' }],
        authority_effect: true,
      };
    }
    if (action === 'TYPED_CLICK') throw new Error('bootstrap must not dispatch a second send effect');
    throw new Error(`unexpected_action:${action}`);
  };

  const runtime = new SupervisorLifecycleRuntime({
    getState,
    executeCommand,
    canActuate: () => true,
    statePath,
    monitorMs: 1000,
    researchMs: 5 * 60 * 1000,
    requireAuthoritativeAdmission: true,
  });
  await runtime.applyRuntimeControl(runtimeOpen);
  await runtime.start();

  const snap = runtime.snapshot();
  assert.equal(bootstrapCreated, 1);
  assert.equal(semanticSubmit, 1);
  assert.match(typed, /METAENGINE_SUPERVISOR_WAKE_V1/);
  assert.equal(snap.keepalive.conversation_url, BOOTSTRAP_URL);
  assert.equal(snap.keepalive.tab_id, 'bootstrap_1');
  assert.equal(snap.keepalive.state, 'ACTIVE');
  assert.equal(snap.keepalive.cycle_seq, 1);
  assert.equal(snap.keepalive.active_wake?.cycle_seq, 1);
  assert.equal(snap.last_recovery?.action, 'SUPERVISOR_BOOTSTRAP_BOUND');
  assert.equal(tabs.find((row) => row.tab_id === 'user_root')?.url, ROOT_URL, 'existing user root must not be hijacked');
  assert.equal(tabs.find((row) => row.tab_id === 'fleet_tab')?.url, FLEET_URL, 'fleet tab must not be selected as supervisor');

  await fs.rm(dir, { recursive: true, force: true });
});

test('ambiguous bootstrap is fenced after one submit and cannot create a second root on the next cycle', async () => {
  const { dir, statePath } = await tempStatePath('metaengine-bootstrap-ambiguous-');
  const tabs = [{ tab_id: 'user_root', url: ROOT_URL, selected: true }];
  let bootstrapCreated = 0;
  let semanticSubmit = 0;

  const getState = async () => ({ tabs: structuredClone(tabs), fleet: { agents: [] } });
  const executeCommand = async (command) => {
    const action = String(command.action || '');
    const tabId = String(command.payload?.tab_id || '');
    if (action === 'NEW_TAB') {
      bootstrapCreated += 1;
      const tab = { tab_id: `bootstrap_${bootstrapCreated}`, url: ROOT_URL, selected: false };
      tabs.push(tab);
      return structuredClone(tab);
    }
    if (action === 'CAPTURE') return idleFrame(ROOT_URL);
    if (action === 'SEMANTIC_TYPE') {
      semanticSubmit += 1;
      return { suppressed: true, reason: 'TYPE_EFFECT_AMBIGUOUS', authority_effect: false };
    }
    if (action === 'TYPED_CLICK') throw new Error('ambiguous semantic submit must never fall through to a second click');
    throw new Error(`unexpected_action:${action}:${tabId}`);
  };

  const runtime = new SupervisorLifecycleRuntime({
    getState,
    executeCommand,
    canActuate: () => true,
    statePath,
    monitorMs: 1000,
    researchMs: 5 * 60 * 1000,
    requireAuthoritativeAdmission: true,
  });
  await runtime.applyRuntimeControl(runtimeOpen);
  await runtime.start();
  await runtime.cycle({ force: true });

  // First cycle after start(): the suppressed TYPE_EFFECT_AMBIGUOUS submit
  // left the bootstrap composer provably empty (captured zero, root URL, no
  // marker), so the D-S1 repair retires the unresolved wake instead of
  // deadlocking the keepalive forever (2026-09-19 contract update). The
  // retirement is a bounded superstep: state RECOVERING, no pending wake.
  const snap = runtime.snapshot();
  assert.equal(bootstrapCreated, 1);
  assert.equal(semanticSubmit, 1);
  assert.equal(snap.keepalive.state, 'RECOVERING');
  assert.equal(snap.keepalive.pending_wake, null, 'the fenced wake was retired by proof');
  assert.equal(snap.keepalive.conversation_url, null);
  assert.ok((snap.keepalive.queued_wakes || []).length >= 1, 'a fresh continuous wake is queued');
  const retiredWakeId = ((JSON.parse(await fs.readFile(statePath, 'utf8')).ambiguous_history || []).slice(-1)[0] || {}).wake_id;
  assert.ok(retiredWakeId, 'the retired wake is in durable history');

  // Second cycle: the fresh bootstrap runs from clean RECOVERING state with a
  // NEW wake — one new root, one NEW submit; the old wake is never retried.
  await runtime.cycle({ force: true });
  const snap2 = runtime.snapshot();
  assert.equal(bootstrapCreated, 2, 'one fresh root after proof-based retirement');
  assert.equal(semanticSubmit, 2, 'one submit per wake, no blind retry');
  assert.notEqual(snap2.keepalive.pending_wake?.wake_id, retiredWakeId,
    'a fresh wake replaced the retired one');
  assert.equal(snap2.keepalive.pending_wake?.automatic_retry_allowed, false);
  assert.equal(snap2.keepalive.conversation_url, null);

  await fs.rm(dir, { recursive: true, force: true });
});
