import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('worker recovery handoff is exact-intent-only and does not weaken ambiguity fencing', async () => {
  const worker = await fs.readFile(new URL('../src/browser-sentinel-worker.cjs', import.meta.url), 'utf8');
  assert.match(worker, /worker_recovery_state === 'INTENT_PROVEN_OLD_PID_ABSENT'/);
  assert.match(worker, /worker_recovery_old_pid/);
  assert.match(worker, /worker_recovery_generation/);
  assert.match(worker, /expected_restart !== true/);
  assert.match(worker, /installer_handoff !== true/);
  assert.match(worker, /worker_released !== true/);
  assert.match(worker, /boundPid !== process\.pid\s*\n\s*&& !exactRecoveryHandoffPending/);
  assert.doesNotMatch(worker, /automatic_retry_allowed\s*:\s*true/);
});
