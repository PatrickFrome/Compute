import assert from 'node:assert/strict';
import test from 'node:test';
import { SUPERVISOR_KEEPALIVE_VERSION, SupervisorKeepalive } from '../src/supervisor-keepalive.mjs';

const CONVERSATION = 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function harness(seed = null, { maxCyclesPerEpoch = 4, uuidStart = 0 } = {}) {
  let stored = seed == null ? null : structuredClone(seed);
  let now = Date.parse('2026-08-31T00:00:00.000Z');
  let seq = uuidStart;
  const keepalive = new SupervisorKeepalive({
    loadState: async () => structuredClone(stored),
    saveState: async (next) => { stored = structuredClone(next); },
    clock: () => now,
    uuid: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    minWakeIntervalMs: 30_000,
    maxCyclesPerEpoch,
  });
  return {
    keepalive,
    state: () => structuredClone(stored),
    advance: (ms) => { now += ms; },
  };
}

test('keepalive v1.3 owns local continuity scheduling', () => {
  assert.match(SUPERVISOR_KEEPALIVE_VERSION, /^1\.(?:[3-9]|[1-9][0-9]+)\./);
});

test('ambiguous wake becomes no-retry history and newer queue entry gets a fresh exact cycle', async () => {
  const h = harness();
  await h.keepalive.init();
  await h.keepalive.bindConversation({ url: CONVERSATION, tab_id: 'tab_supervisor' });

  await h.keepalive.enqueueWake('WORKER_LOST', { agent_id: 'agent_old' });
  const old = await h.keepalive.prepareNextWake();
  assert.equal(old.ok, true);
  await h.keepalive.markWakeAmbiguous(old.pending.wake_id, 'SEND_EFFECT_UNKNOWN');

  await h.keepalive.enqueueWake('CONTINUE_DEVELOPMENT', { key: 'durable-work-successor' });
  assert.equal(h.keepalive.snapshot().queued_wakes.length, 2, 'new logical work must remain durable behind the unresolved physical effect');

  await h.keepalive.retireAmbiguousAfterTerminal({
    tab_id: 'tab_supervisor',
    generation_epoch: 17,
    reason: 'TRUSTED_TERMINAL_IDLE',
  });

  const retired = h.keepalive.snapshot();
  assert.equal(retired.pending_wake, null);
  assert.equal(retired.queued_wakes.length, 1);
  assert.equal(retired.queued_wakes[0].reason, 'CONTINUE_DEVELOPMENT');
  assert.equal(retired.ambiguous_history.length, 1);
  assert.equal(retired.ambiguous_history[0].wake_id, old.pending.wake_id);
  assert.equal(retired.ambiguous_history[0].automatic_retry_allowed, false);
  assert.equal(retired.ambiguous_history[0].terminal_generation_epoch, 17);
  assert.ok(retired.cycle_seq >= old.pending.cycle_seq, 'ambiguous cycle identity must be burned');

  await assert.rejects(
    () => h.keepalive.retireAmbiguousAfterTerminal({ tab_id: 'tab_supervisor', generation_epoch: 17 }),
    /keepalive_no_ambiguous_wake/,
  );
  assert.equal(h.keepalive.snapshot().ambiguous_history.length, 1, 'duplicate terminal callback must not duplicate history');

  const successor = await h.keepalive.prepareNextWake();
  assert.equal(successor.ok, true);
  assert.notEqual(successor.pending.wake_id, old.pending.wake_id);
  assert.equal(successor.pending.supervisor_epoch, old.pending.supervisor_epoch);
  assert.ok(successor.pending.cycle_seq > old.pending.cycle_seq);
  assert.match(successor.message, new RegExp(`supervisor_epoch=${successor.pending.supervisor_epoch}`));
  assert.match(successor.message, new RegExp(`cycle_seq=${successor.pending.cycle_seq}`));
  assert.doesNotMatch(successor.message, new RegExp(old.pending.wake_id));
  assert.doesNotMatch(successor.message, /METAENGINE_SAME_WAKE_RETRY_V1/);

  await assert.rejects(
    () => h.keepalive.markWakeAmbiguous(old.pending.wake_id, 'STALE_CALLBACK'),
    /keepalive_wake_binding_mismatch/,
  );
  assert.equal(h.keepalive.snapshot().pending_wake.wake_id, successor.pending.wake_id, 'stale predecessor callback has zero authority over successor');
});

test('restart preserves queued successor while ambiguous predecessor is retired exactly once', async () => {
  const first = harness();
  await first.keepalive.init();
  await first.keepalive.bindConversation({ url: CONVERSATION, tab_id: 'tab_supervisor' });
  await first.keepalive.enqueueWake('CI_TERMINAL', { key: 'old-effect' });
  const old = await first.keepalive.prepareNextWake();
  await first.keepalive.markWakeAmbiguous(old.pending.wake_id, 'POST_CLICK_TRANSPORT_LOST');
  await first.keepalive.enqueueWake('CONTINUE_DEVELOPMENT', { key: 'durable-work-after-restart' });

  const persisted = first.state();
  const restarted = harness(persisted, { uuidStart: 100 });
  await restarted.keepalive.init();
  assert.equal(restarted.keepalive.snapshot().state, 'WAKE_AMBIGUOUS');
  assert.equal(restarted.keepalive.canWake(), false, 'physical actuation remains fenced until trusted terminal/IDLE');
  assert.equal(restarted.keepalive.snapshot().queued_wakes.at(-1).reason, 'CONTINUE_DEVELOPMENT');

  await restarted.keepalive.retireAmbiguousAfterTerminal({
    tab_id: 'tab_supervisor',
    generation_epoch: 23,
    reason: 'RESTART_TRUSTED_TERMINAL_IDLE',
  });
  const after = restarted.keepalive.snapshot();
  assert.equal(after.ambiguous_history.length, 1);
  assert.equal(after.ambiguous_history[0].wake_id, old.pending.wake_id);
  assert.equal(after.ambiguous_history[0].automatic_retry_allowed, false);
  assert.deepEqual(after.queued_wakes.map((row) => row.reason), ['CONTINUE_DEVELOPMENT']);

  const successor = await restarted.keepalive.prepareNextWake();
  assert.equal(successor.ok, true);
  assert.notEqual(successor.pending.wake_id, old.pending.wake_id);
  assert.ok(successor.pending.cycle_seq > old.pending.cycle_seq);
});

test('rollover remains repeatable indefinitely across supervisor epochs without reviving archived wakes', async () => {
  const h = harness(null, { maxCyclesPerEpoch: 4 });
  await h.keepalive.init();
  await h.keepalive.bindConversation({ url: CONVERSATION, tab_id: 'tab_epoch_1' });

  await h.keepalive.enqueueWake('WATCHDOG_DEADLINE', { key: 'archive-seed' });
  const old = await h.keepalive.prepareNextWake();
  await h.keepalive.markWakeAmbiguous(old.pending.wake_id, 'ROLLOVER_TEST_AMBIGUITY');
  await h.keepalive.retireAmbiguousAfterTerminal({ tab_id: 'tab_epoch_1', generation_epoch: 1 });
  assert.equal(h.keepalive.snapshot().ambiguous_history.length, 1);

  const rolloverCount = 64;
  for (let i = 0; i < rolloverCount; i += 1) {
    const before = h.keepalive.snapshot().supervisor_epoch;
    await h.keepalive.requestRollover('MAX_CYCLES_PER_EPOCH');
    await h.keepalive.approveRollover('TRUSTED_CONTINUOUS_SERVICE');
    const nextUrl = `https://chatgpt.com/c/epoch-${String(i + 2).padStart(4, '0')}-aaaaaaaa`;
    await h.keepalive.bindRollover({ url: nextUrl, tab_id: `tab_epoch_${i + 2}` });
    const snap = h.keepalive.snapshot();
    assert.equal(snap.supervisor_epoch, before + 1);
    assert.equal(snap.cycle_seq, 0);
    assert.equal(snap.state, 'WAITING');
    assert.equal(snap.ambiguous_history.length, 1);
    assert.equal(snap.ambiguous_history[0].wake_id, old.pending.wake_id);
    assert.equal(snap.pending_wake, null);
    assert.equal(snap.active_wake, null);
  }
  assert.equal(h.keepalive.snapshot().supervisor_epoch, rolloverCount + 1);
});
