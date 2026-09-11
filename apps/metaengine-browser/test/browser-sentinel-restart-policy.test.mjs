import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.resolve(here, '../src/browser-sentinel-worker.cjs');

async function source() { return fs.readFile(workerPath, 'utf8'); }

test('sentinel retries only positively proven no-effect relaunch failures', async () => {
  const text = await source();
  assert.ok(text.includes('async function relaunchUntilResolved'));
  assert.ok(text.includes('retryAllowedForOutcome(outcome) && journal.relaunchRetryAllowed()'));
  assert.ok(text.includes("relaunch_effect_absent: true"));
  assert.ok(text.includes("relaunch_pid_confirmed_absent: true"));
  assert.ok(text.includes('exact_relaunch_pid_absent_without_successor_binding'));
});

test('sentinel never converts elapsed time alone into relaunch retry authority', async () => {
  const text = await source();
  const resolutionAt = text.indexOf('async function awaitDispatchedRelaunchResolution');
  const retryAt = text.indexOf('async function relaunchUntilResolved', resolutionAt);
  const resolution = text.slice(resolutionAt, retryAt);
  assert.ok(resolution.includes('while (true)'));
  assert.ok(resolution.includes('!processAlive(pid)'));
  assert.ok(!resolution.includes('Date.now() +'), 'dispatched relaunch resolution must not gain retry authority from a timeout');
});

test('ambiguous spawn acknowledgement never enters retry loop', async () => {
  const text = await source();
  assert.ok(text.includes("lifecycle: 'RELAUNCH_AMBIGUOUS'"));
  assert.ok(text.includes('// Ambiguous effects are terminal for actuation, not for evidence: never replay.'));
});
