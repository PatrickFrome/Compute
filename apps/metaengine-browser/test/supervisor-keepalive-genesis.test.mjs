import assert from 'node:assert/strict';
import test from 'node:test';
import { SupervisorKeepalive } from '../src/supervisor-keepalive.mjs';

test('fresh keepalive genesis records current incarnation without fabricating predecessor evidence', async () => {
  let stored = null;
  const now = Date.parse('2026-09-09T09:31:00.000Z');
  const keepalive = new SupervisorKeepalive({
    loadState: async () => structuredClone(stored),
    saveState: async (next) => { stored = structuredClone(next); },
    clock: () => now,
    processIncarnationId: 'process_genesis_current',
    minWakeIntervalMs: 30000,
  });

  const snapshot = await keepalive.init();

  assert.equal(snapshot.version, '1.4.1');
  assert.equal(snapshot.state, 'RECOVERING');
  assert.equal(snapshot.process_incarnation_id, 'process_genesis_current');
  assert.equal(snapshot.process_incarnation_started_at, '2026-09-09T09:31:00.000Z');
  assert.equal(snapshot.predecessor_process_incarnation_id, null);
  assert.equal(snapshot.predecessor_fenced_at, null);
  assert.equal(snapshot.predecessor_queued_wake_count, 0);
  assert.deepEqual(snapshot.predecessor_wake_history, []);
  assert.deepEqual(snapshot.queued_wakes, []);
  assert.deepEqual(snapshot.previous_worker_generation, {});
  assert.equal(snapshot.authority_effect, false);
});
