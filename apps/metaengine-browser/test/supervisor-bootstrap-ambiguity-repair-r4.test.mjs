import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SupervisorLifecycleRuntime } from '../src/supervisor-lifecycle-runtime-core.mjs';
import { buildSupervisorWakeMessage } from '../src/supervisor-keepalive.mjs';

const WAKE_ID = 'wake_bootstrap-r4';

function seedState() {
  return {
    schema: 'metaengine.supervisor-keepalive.state.v1',
    version: '1.5.0',
    supervisor_id: 'METAENGINE_SUPERVISOR',
    supervisor_epoch: 1,
    cycle_seq: 0,
    state: 'WAKE_AMBIGUOUS',
    conversation_url: null,
    tab_id: null,
    paused: false,
    process_incarnation_id: null,
    admission_state: 'UNKNOWN',
    queued_wakes: [],
    pending_wake: {
      wake_id: WAKE_ID,
      reason: 'CONTINUE_DEVELOPMENT',
      queue_key: 'CONTINUE_DEVELOPMENT:',
      prepared_at: '2026-09-16T00:00:00.000Z',
      supervisor_epoch: 1,
      cycle_seq: 1,
      process_incarnation_id: null,
      ambiguous_at: '2026-09-16T00:00:01.000Z',
      ambiguous_reason: 'TYPE_EFFECT_AMBIGUOUS',
      automatic_retry_allowed: false,
    },
    active_wake: null,
  };
}

function wakeMessage() {
  return buildSupervisorWakeMessage({
    supervisorEpoch: 1,
    cycleSeq: 1,
    wakeId: WAKE_ID,
    reason: 'CONTINUE_DEVELOPMENT',
  });
}

function composerFrame({ marker = false, composerSha = null } = {}) {
  return {
    url: 'https://chat.z.ai/',
    title: 'ChatGPT',
    text_excerpt: marker ? `message ${WAKE_ID}` : '',
    semantic_targets: [
      ...(composerSha ? [{ role: 'textbox', name: 'Message ChatGPT', semantic_ref: 'composer', value_sha256: composerSha }] : []),
      { role: 'button', name: 'Send prompt', semantic_ref: 'send' },
    ],
  };
}

async function makeRuntime({ tabs, frame, onClick = null, onSubmit = null }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-r4-'));
  const statePath = path.join(dir, 'keepalive.json');
  await fs.writeFile(statePath, `${JSON.stringify(seedState(), null, 2)}\n`);
  const actions = [];
  const executeCommand = async ({ action, payload }) => {
    actions.push(action);
    if (action === 'CAPTURE') return typeof frame === 'function' ? frame() : structuredClone(frame);
    if (action === 'SEMANTIC_TYPE') {
      if (onSubmit) return onSubmit({ action, payload });
      return { effect_state: 'PROVEN_COMPOSER_CLEARED', composer_cleared: true, new_conversation_observed: false, stop_observed: false, automatic_retry_allowed: false, authority_effect: true };
    }
    if (action === 'TYPED_CLICK') {
      if (onClick) return onClick({ action, payload });
      return { ok: true };
    }
    throw new Error(`unexpected_effect:${action}`);
  };
  const runtime = new SupervisorLifecycleRuntime({
    getState: async () => ({ tabs: structuredClone(tabs), fleet: { agents: [] } }),
    executeCommand,
    canActuate: () => true,
    statePath,
    researchMs: 24 * 60 * 60 * 1000,
  });
  return { runtime, actions, statePath };
}

test('bare bootstrap root transcript marker resolves ambiguity without a write effect', async () => {
  const { runtime, actions } = await makeRuntime({
    tabs: [{ tab_id: 'root-1', url: 'https://chat.z.ai/', selected: false }],
    frame: composerFrame({ marker: true }),
  });
  const snap = await runtime.start();
  assert.equal(snap.keepalive.state, 'ACTIVE');
  assert.equal(snap.keepalive.pending_wake, null);
  assert.equal(snap.keepalive.active_wake?.wake_id, WAKE_ID);
  assert.equal(actions.includes('TYPED_CLICK'), false);
  assert.equal(actions.includes('SEMANTIC_TYPE'), false);
  assert.equal(actions.includes('NEW_TAB'), false);
});

test('exact composer continuation is durably fenced before click and never repeated', async () => {
  const composerSha = crypto.createHash('sha256').update(wakeMessage(), 'utf8').digest('hex');
  let submits = 0;
  const { runtime, actions, statePath } = await makeRuntime({
    tabs: [{ tab_id: 'root-1', url: 'https://chat.z.ai/', selected: false }],
    frame: composerFrame({ composerSha }),
    onSubmit: () => {
      submits += 1;
      throw new Error('simulated_transport_loss_after_submit_boundary');
    },
  });
  let snap = await runtime.start();
  assert.equal(snap.keepalive.state, 'WAKE_AMBIGUOUS');
  assert.equal(submits, 1);
  const durable = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(durable.pending_wake.ambiguity_continuation_tab_id, 'root-1');
  assert.equal(durable.pending_wake.ambiguity_continuation_composer_sha256, composerSha);
  assert.ok(durable.pending_wake.ambiguity_continuation_attempted_at);

  snap = await runtime.cycle({ force: true });
  assert.equal(snap.keepalive.state, 'WAKE_AMBIGUOUS');
  assert.equal(submits, 1);
  assert.equal(actions.filter((row) => row === 'SEMANTIC_TYPE').length, 1);
  assert.equal(actions.includes('NEW_TAB'), false);
});

test('duplicate bootstrap candidates fail closed with zero effect continuation', async () => {
  const composerSha = crypto.createHash('sha256').update(wakeMessage(), 'utf8').digest('hex');
  const { runtime, actions } = await makeRuntime({
    tabs: [
      { tab_id: 'root-1', url: 'https://chat.z.ai/', selected: false },
      { tab_id: 'root-2', url: 'https://chat.z.ai/', selected: false },
    ],
    frame: composerFrame({ composerSha }),
  });
  const snap = await runtime.start();
  assert.equal(snap.keepalive.state, 'WAKE_AMBIGUOUS');
  assert.equal(actions.includes('TYPED_CLICK'), false);
  assert.equal(actions.includes('SEMANTIC_TYPE'), false);
  assert.equal(actions.includes('NEW_TAB'), false);
});
