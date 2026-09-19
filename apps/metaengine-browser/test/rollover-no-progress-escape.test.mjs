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
// readback. After 8 no-progress cycles the lifecycle must re-request the
// rollover so #rollover() opens a FRESH tab instead of re-scanning the
// poisoned attempt tab forever (live: the rollover sat ambiguous 14+ hours).

const conversationUrl = 'https://chat.z.ai/c/0799499c-9ead-4a7e-8edc-be365222c4d4';

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
      tabs: [{ tab_id: 'tab_poisoned', url: 'https://chat.z.ai/' }],
    }),
    executeCommand: async () => { throw new Error('no_effects_expected'); },
    canActuate: () => true,
    statePath,
    monitorMs: 1000,
  });
}

test('D-C5: prolonged ROLLOVER_AMBIGUOUS no-progress re-requests the rollover for a fresh tab', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rollover-escape-'));
  const statePath = path.join(dir, 'keepalive.json');
  await seedAmbiguousRollover(statePath);
  const runtime = makeRuntime(statePath);
  await runtime.start().catch(() => {});
  // The reconcile scan never finds the marker (no conversation tab in
  // getState) — pure no-progress. start() may run one cycle itself, so the
  // escape lands on the 8th no-progress cycle counting from start.
  for (let i = 0; i < 8; i += 1) {
    await runtime.cycle({ force: true });
  }
  const final = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(final.state, 'ROLLOVER_REQUIRED');
  assert.equal(final.rollover_attempt, null);
  assert.match(final.rollover_reason, /ROLLOVER_AMBIGUOUS_NO_PROGRESS_FRESH_TAB/);
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
