import assert from 'node:assert/strict';
import test from 'node:test';
import { SupervisorKeepalive } from '../src/supervisor-keepalive.mjs';

// LIVE 2026-09-21 (self-update restart window regression): a wake that went
// TYPE_EFFECT_AMBIGUOUS exactly across the successor boot leaves
// ROLLOVER_REQUIRED + pending-ambiguous — a state pair the rollover retire
// paths cannot consume (they only accept WAKE_AMBIGUOUS), deadlocking the
// lifecycle with keepalive_no_ambiguous_wake on every tick and starving the
// devos task cycle of its idle-maintenance window (no leases).

function harness(seed = null) {
  let stored = seed;
  let now = Date.parse('2026-08-29T13:00:00.000Z');
  let seq = 0;
  const keepalive = new SupervisorKeepalive({
    loadState: async () => structuredClone(stored),
    saveState: async (next) => { stored = structuredClone(next); },
    clock: () => now,
    uuid: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    processIncarnationId: 'process_test_successor',
    minWakeIntervalMs: 30000,
    maxCyclesPerEpoch: 4,
  });
  return { keepalive, state: () => structuredClone(stored), advance: (ms) => { now += ms; } };
}

async function deadlock(h) {
  // reproduce the exact live sequence: wake prepared → send cut ambiguous →
  // composer unclearable on the same conversation → rollover requested.
  await h.keepalive.init();
  await h.keepalive.bindConversation({ url: 'https://chat.z.ai/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', tab_id: 'tab_supervisor' });
  await h.keepalive.enqueueWake('CONTINUE_DEVELOPMENT');
  const wake = await h.keepalive.prepareNextWake();
  await h.keepalive.markWakeAmbiguous(wake.pending.wake_id, 'TYPE_EFFECT_AMBIGUOUS');
  await h.keepalive.requestRollover('COMPOSER_UNCLEARABLE_DK7', { autoRelease: true });
  return wake.pending.wake_id;
}

test('a pending ambiguous wake blocks nothing once positively proven from ROLLOVER_REQUIRED', async () => {
  const h = harness();
  const wakeId = await deadlock(h);
  assert.equal(h.state().state, 'ROLLOVER_REQUIRED');
  assert.ok(h.state().pending_wake?.ambiguous_at, 'the ambiguous wake is pending');

  await h.keepalive.settleRolloverBlockedAmbiguousWake({ observed_sent: true });
  const settled = h.state();
  assert.equal(settled.state, 'ACTIVE', 'positive proof confirms the wake and resumes normal processing');
  assert.equal(settled.pending_wake, null);
  assert.equal(settled.active_wake?.wake_id, wakeId);
  assert.ok(settled.active_wake?.confirmed_at);
});

test('a provably unsent wake is dropped from ROLLOVER_REQUIRED and the rollover request survives', async () => {
  const h = harness();
  await deadlock(h);

  await h.keepalive.settleRolloverBlockedAmbiguousWake({ observed_sent: false });
  const settled = h.state();
  assert.equal(settled.state, 'ROLLOVER_REQUIRED', 'postWakeSettlementState preserves the rollover request');
  assert.equal(settled.pending_wake, null);
  assert.ok(settled.last_unsent_attempt_at, 'D-K5 anti-storm price is paid before the re-prepare');
  assert.equal(settled.rollover_reason, 'COMPOSER_UNCLEARABLE_DK7');
});

test('settlement refuses to act outside the ROLLOVER_REQUIRED + ambiguous-pending pair', async () => {
  const h = harness();
  await h.keepalive.init();
  await h.keepalive.bindConversation({ url: 'https://chat.z.ai/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
  await h.keepalive.enqueueWake('CONTINUE_DEVELOPMENT');
  const wake = await h.keepalive.prepareNextWake();
  await h.keepalive.markWakeAmbiguous(wake.pending.wake_id, 'TYPE_EFFECT_AMBIGUOUS');
  // WAKE_AMBIGUOUS: the existing resolveAmbiguous owns this state — settlement must not shortcut it.
  await assert.rejects(() => h.keepalive.settleRolloverBlockedAmbiguousWake({ observed_sent: true }), /keepalive_no_rollover_blocked_ambiguous_wake/);
  // no pending wake at all:
  await h.keepalive.resolveAmbiguous({ observed_sent: false });
  await h.keepalive.requestRollover('COMPOSER_UNCLEARABLE_DK7', { autoRelease: true });
  await assert.rejects(() => h.keepalive.settleRolloverBlockedAmbiguousWake({ observed_sent: false }), /keepalive_no_rollover_blocked_ambiguous_wake/);
});
