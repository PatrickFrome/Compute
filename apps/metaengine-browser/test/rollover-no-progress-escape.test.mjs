import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SupervisorKeepalive } from '../src/supervisor-keepalive.mjs';
import { SupervisorLifecycleRuntime } from '../src/supervisor-lifecycle-runtime.mjs';

// D-C5 (live 2026-09-19): ROLLOVER_AMBIGUOUS with zero reconciliation progress
// is a terminal dead state — wakes do not run in rollover states, admission
// close PRESERVES the ambiguity, and restart reconciliation needs a positive
// readback. Lack of progress never proves that Send did not execute. A legacy
// unknown attempt must retain its binding even after the old eight-cycle gate.

const conversationUrl = 'https://chatgpt.com/c/0799499c-9ead-4a7e-8edc-be365222c4d4';

// Seed a keepalive state file with the exact live wedge: a bound conversation,
// a requested rollover, an ambiguous attempt bound to a poisoned tab.
function seedAmbiguousRollover(statePath) {
  let stored = null;
  const keepalive = new SupervisorKeepalive({
    loadState: async () => structuredClone(stored),
    saveState: async (next) => { stored = structuredClone(next); },
    processIncarnationId: 'process_test_current',
  });
  return keepalive.init().then(async () => {
    await keepalive.bindConversation({ url: conversationUrl, tab_id: 'tab_old' });
    await keepalive.requestRollover('TYPE_EFFECT_AMBIGUOUS', { autoRelease: true });
    await keepalive.beginRolloverAttempt();
    await keepalive.bindRolloverAttemptTab('tab_poisoned');
    await keepalive.markRolloverAmbiguous('TYPE_EFFECT_AMBIGUOUS');
    assert.equal(keepalive.snapshot().state, 'ROLLOVER_AMBIGUOUS');
    fs.writeFileSync(statePath, `${JSON.stringify(stored)}\n`);
    return structuredClone(stored);
  });
}

function makeRuntime(statePath) {
  return new SupervisorLifecycleRuntime({
    getState: async () => ({
      fleet: { agents: [] },
      tabs: [{ tab_id: 'tab_poisoned', url: 'https://chatgpt.com/' }],
    }),
    executeCommand: async () => { throw new Error('no_effects_expected'); },
    canActuate: () => true,
    statePath,
    monitorMs: 1000,
  });
}

test('unknown rollover Send stays fenced after prolonged no-progress without a new tab', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rollover-escape-'));
  const statePath = path.join(dir, 'keepalive.json');
  const original = await seedAmbiguousRollover(statePath);
  const runtime = makeRuntime(statePath);
  await runtime.start().catch(() => {});
  // The reconcile scan never finds the marker (no conversation tab in
  // getState) — pure no-progress. start() may run one cycle itself, so the
  // escape lands on the 8th no-progress cycle counting from start.
  for (let i = 0; i < 8; i += 1) {
    await runtime.cycle({ force: true });
  }
  const final = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(final.state, 'ROLLOVER_AMBIGUOUS');
  assert.equal(final.rollover_attempt.attempt_id, original.rollover_attempt.attempt_id);
  assert.equal(final.rollover_attempt.tab_id, 'tab_poisoned');
  assert.equal(final.rollover_attempt.automatic_retry_allowed, false);
  assert.equal(final.rollover_attempt.pre_send_no_effect, false);
});

test('D-C5: short ambiguity is preserved for reconciliation (no premature escape)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rollover-escape-'));
  const statePath = path.join(dir, 'keepalive.json');
  await seedAmbiguousRollover(statePath);
  const runtime = makeRuntime(statePath);
  await runtime.start().catch(() => {});
  for (let i = 0; i < 3; i += 1) {
    await runtime.cycle({ force: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(state.state, 'ROLLOVER_AMBIGUOUS', '3 no-progress cycles stay under the budget');
  assert.ok(state.rollover_attempt, 'the attempt remains bound for the throttled scan');
});

test('durable no-Send proof requires the pending attempt and cannot be added to an unknown attempt', async () => {
  let stored = null;
  const keepalive = new SupervisorKeepalive({
    loadState: async () => structuredClone(stored), saveState: async next => { stored = structuredClone(next); },
  });
  await keepalive.init();
  await keepalive.bindConversation({ url: conversationUrl, tab_id: 'tab_old' });
  await keepalive.requestRollover('TEST_PRE_SEND_FAILURE', { autoRelease: true });
  const attempt = await keepalive.beginRolloverAttempt();
  await keepalive.bindRolloverAttemptTab('tab_attempt');
  await assert.rejects(keepalive.markRolloverAmbiguous('TYPE_EFFECT_AMBIGUOUS', {
    pre_send_no_effect: true, expected_attempt_id: 'stale-attempt',
  }), /keepalive_rollover_no_effect_attempt_binding_mismatch/);
  await keepalive.markRolloverAmbiguous('TYPE_EFFECT_AMBIGUOUS', {
    pre_send_no_effect: true, expected_attempt_id: attempt.attempt_id,
  });
  assert.equal(stored.rollover_attempt.pre_send_no_effect, true);
  await keepalive.markRolloverAmbiguous('UNKNOWN_SEND_RESULT');
  assert.equal(stored.rollover_attempt.pre_send_no_effect, false);
  await assert.rejects(keepalive.markRolloverAmbiguous('TYPE_EFFECT_AMBIGUOUS', {
    pre_send_no_effect: true, expected_attempt_id: attempt.attempt_id,
  }), /keepalive_rollover_no_effect_attempt_binding_mismatch/);
  assert.equal(stored.rollover_attempt.pre_send_no_effect, false);
});
