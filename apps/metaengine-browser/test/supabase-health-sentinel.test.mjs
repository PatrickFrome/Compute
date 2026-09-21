import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SUPABASE_HEALTH_SENTINEL_SCHEMA,
  createSupabaseHealthSentinel,
} from '../src/supabase-health-sentinel.mjs';

const CLOUD = 'https://cloud.example.test/functions/v1/a2-browser-native-supervisor-v1';
const LOCAL = 'http://127.0.0.1:3031/a2-browser-native-supervisor-v1';

function makeClock() {
  let t = 1_780_000_000_000;
  return {
    now: () => t,
    advance: (ms) => { t += ms; },
  };
}

// One shared script queue: every probe call (cloud AND local) consumes one
// step; the queue pins at its last step once exhausted. 'slow' inflates the
// measured latency on the mocked clock; 'fail' rejects; a number is a status.
function makeFetch(clock, script) {
  const queue = script.slice();
  return async (url) => {
    const step = queue.length > 1 ? queue.shift() : queue[0];
    if (step === 'fail') throw new Error('connect ECONNREFUSED');
    if (typeof step === 'number') return { status: step };
    if (step === 'slow') clock.advance(1500); // > degraded_latency_ms below
    return { status: 200 };
  };
}

function makeSentinel({ clock, script, local = LOCAL, restore_streak = 3, ...rest } = {}) {
  return createSupabaseHealthSentinel({
    cloud_base: CLOUD,
    local_base: local,
    interval_ms: 500,
    timeout_ms: 250,
    degraded_latency_ms: 1200,
    degrade_streak: 2,
    restore_streak,
    min_fallback_residency_ms: 0,
    now: clock.now,
    fetch_impl: makeFetch(clock, script),
    ...rest,
  });
}

function assertZeroAuthority(snap) {
  assert.equal(snap.authority_effect, false);
  assert.equal(snap.state, 'OK');
  assert.equal(snap.schema, SUPABASE_HEALTH_SENTINEL_SCHEMA);
}

test('constructor rejects missing cloud base, invalid local base and missing fetch', () => {
  assert.throws(
    () => createSupabaseHealthSentinel({ fetch_impl: async () => ({ status: 200 }) }),
    /cloud_base_required/,
  );
  assert.throws(
    () => createSupabaseHealthSentinel({ cloud_base: CLOUD, local_base: 'ftp://x', fetch_impl: async () => ({ status: 200 }) }),
    /local_base_invalid/,
  );
  assert.throws(
    () => createSupabaseHealthSentinel({ cloud_base: CLOUD, fetch_impl: null }),
    /fetch_unavailable/,
  );
});

test('UNKNOWN until the first probe resolves; gate starts locked in CLOUD_AUTHORITY', async () => {
  const clock = makeClock();
  const sentinel = makeSentinel({ clock, script: ['ok'] });
  const before = sentinel.snapshot();
  assert.equal(before.mode, 'CLOUD_AUTHORITY');
  assert.equal(before.targets.cloud.state, 'UNKNOWN');
  assert.equal(before.gate.locked, true);
  assertZeroAuthority(before);
  await sentinel.tick();
  const after = sentinel.snapshot();
  assert.equal(after.mode, 'CLOUD_AUTHORITY');
  assert.equal(after.targets.cloud.state, 'HEALTHY');
  assert.equal(after.targets.cloud.ok_streak, 1);
  assert.equal(after.targets.local.state, 'HEALTHY');
  assert.equal(after.counters.probes_total, 2); // cloud + local in one tick
  assertZeroAuthority(after);
});

test('cloud unresponsive for degrade_streak probes flips to LOCAL_FALLBACK only while the reserve is reachable', async () => {
  const clock = makeClock();
  // Interleaved per probe: [cloud, local] consume one step each per tick.
  const sentinel = makeSentinel({ clock, script: ['ok', 'ok', 'fail', 'ok', 'fail', 'ok'] });
  await sentinel.tick(); // both healthy
  await sentinel.tick(); // cloud fail #1 -> DEGRADED, streak < 2
  const warm = sentinel.snapshot();
  assert.equal(warm.mode, 'CLOUD_AUTHORITY');
  assert.equal(warm.targets.cloud.state, 'DEGRADED');
  await sentinel.tick(); // fail #2 -> DOWN + streak 2 -> flip
  const snap = sentinel.snapshot();
  assert.equal(snap.mode, 'LOCAL_FALLBACK');
  assert.equal(snap.gate.locked, false);
  assert.equal(snap.mode_reason, 'CLOUD_UNRESPONSIVE_LOCAL_RESERVE_AVAILABLE');
  assert.equal(snap.targets.cloud.state, 'DOWN');
  assert.equal(snap.counters.transitions_total, 1);
  assert.equal(snap.transitions[0].from, 'CLOUD_AUTHORITY');
  assert.equal(snap.transitions[0].to, 'LOCAL_FALLBACK');
  assertZeroAuthority(snap);
});

test('unresponsive cloud never flips when no reserve is configured or the reserve itself is dead', async () => {
  const clock = makeClock();
  const noLocal = makeSentinel({ clock, script: ['fail', 'fail'], local: null });
  await noLocal.tick();
  await noLocal.tick();
  assert.equal(noLocal.snapshot().mode, 'CLOUD_AUTHORITY');
  assert.equal(noLocal.snapshot().targets.local, null);

  const clock2 = makeClock();
  const deadLocal = makeSentinel({ clock: clock2, script: ['fail', 'fail', 'fail', 'fail'] });
  await deadLocal.tick(); // cloud fail + local fail
  await deadLocal.tick(); // cloud DOWN (streak 2) but local is dead too -> stay
  const snap = deadLocal.snapshot();
  assert.equal(snap.mode, 'CLOUD_AUTHORITY');
  assert.equal(snap.targets.local.state, 'DOWN');
  assert.equal(snap.targets.local_usable, false);
  assert.equal(snap.gate.locked, true);
});

test('reachable-but-slow cloud counts as degraded and unlocks the reserve exactly like downtime', async () => {
  const clock = makeClock();
  const sentinel = makeSentinel({ clock, script: ['slow', 'slow'] });
  await sentinel.tick(); // slow probe #1
  const mid = sentinel.snapshot();
  assert.equal(mid.targets.cloud.state, 'DEGRADED');
  assert.equal(mid.targets.cloud.ok_streak, 1); // transport answered
  assert.equal(mid.targets.cloud.not_healthy_streak, 1);
  await sentinel.tick(); // slow probe #2 -> streak 2 -> flip
  const snap = sentinel.snapshot();
  assert.equal(snap.mode, 'LOCAL_FALLBACK');
  assert.equal(snap.mode_reason, 'CLOUD_DEGRADED_LOCAL_RESERVE_AVAILABLE');
  assert.equal(snap.gate.locked, false);
});

test('restore requires restore_streak healthy probes AND min fallback residency (no dual-authority race)', async () => {
  const clock = makeClock();
  const sentinel = createSupabaseHealthSentinel({
    cloud_base: CLOUD,
    local_base: LOCAL,
    interval_ms: 500,
    restore_streak: 3,
    min_fallback_residency_ms: 60_000,
    now: clock.now,
    fetch_impl: makeFetch(clock, ['fail', 'ok', 'fail', 'ok']),
  });
  await sentinel.tick(); // cloud fail + local ok
  await sentinel.tick(); // cloud fail #2 -> DOWN -> LOCAL_FALLBACK
  assert.equal(sentinel.snapshot().mode, 'LOCAL_FALLBACK');
  clock.advance(1000);
  await sentinel.tick(); // healthy #1
  await sentinel.tick(); // healthy #2 (streak 2 < 3)
  assert.equal(sentinel.snapshot().mode, 'LOCAL_FALLBACK');
  clock.advance(120_000); // residency long satisfied now
  await sentinel.tick(); // healthy #3 -> streak 3 AND residency -> restore
  const snap = sentinel.snapshot();
  assert.equal(snap.mode, 'CLOUD_AUTHORITY');
  assert.match(snap.mode_reason, /^CLOUD_RESTORED_STABLE_3_PROBES_RESIDENCY_/);
  assert.equal(snap.gate.locked, true);
  assert.ok(snap.transitions.some((t) => t.from === 'LOCAL_FALLBACK' && t.to === 'CLOUD_AUTHORITY'));
});

test('fallback holds while the cloud has not yet proven restore_streak stability', async () => {
  const clock = makeClock();
  const sentinel = makeSentinel({ clock, script: ['fail', 'ok', 'fail', 'ok', 'ok', 'ok'], restore_streak: 5 });
  await sentinel.tick(); // cloud fail + local ok
  await sentinel.tick(); // cloud fail #2 -> LOCAL_FALLBACK
  assert.equal(sentinel.snapshot().mode, 'LOCAL_FALLBACK');
  await sentinel.tick(); // cloud healthy #1 only (streak 1 < 5)
  const snap = sentinel.snapshot();
  assert.equal(snap.mode, 'LOCAL_FALLBACK');
  assert.equal(snap.counters.transitions_total, 1);
  assert.equal(snap.failover.enabled, true);
  assert.equal(snap.authority_effect, false);
});

test('probe ring, counters and freeze guarantees hold under repeated ticks', async () => {
  const clock = makeClock();
  const sentinel = makeSentinel({ clock, script: ['ok'], probes_ring_limit: 4 });
  for (let i = 0; i < 6; i += 1) await sentinel.tick();
  const snap = sentinel.snapshot();
  assert.equal(snap.probes.length, 4); // ring bounded
  assert.ok(snap.counters.probes_total >= 12);
  assert.throws(() => { snap.mode = 'LOCAL_FALLBACK'; }, TypeError);
  assert.throws(() => { snap.targets.cloud.state = 'HEALTHY'; }, TypeError);
  assert.ok(snap.probes.every((p) => p.name === 'cloud' || p.name === 'local'));
});
