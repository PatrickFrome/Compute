import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import {
  FALLBACK_CONSOLE_SCHEMA,
  createFallbackConsoleRuntime,
} from '../src/fallback-console-runtime.mjs';
import {
  NATIVE_SUPERVISOR_DEFAULT_BASE,
  setNativeSupervisorBase,
} from '../src/native-supervisor-endpoints.mjs';

const CLOUD = 'https://cloud.example.test/functions/v1/a2-browser-native-supervisor-v1';
const LOCAL = 'http://127.0.0.1:3031/a2-browser-native-supervisor-v1';

// setNativeSupervisorBase mutates a process-global live binding; every test
// that can trigger a swap must restore the import-time value in finally.
const ORIGINAL_BASE = setNativeSupervisorBase(NATIVE_SUPERVISOR_DEFAULT_BASE);

function makeClock() {
  let t = 1_780_000_000_000;
  return {
    now: () => t,
    advance: (ms) => { t += ms; },
  };
}

function makeFetch(clock, script) {
  const queue = script.slice();
  return async (url) => {
    const step = queue.length > 1 ? queue.shift() : queue[0];
    if (step === 'fail') throw new Error('connect ECONNREFUSED');
    return { status: typeof step === 'number' ? step : 200 };
  };
}

// The real production sentinel (scripted transport + fake clock), so runtime
// tests exercise the exact flip choreography that will run inside the shell.
async function makeSentinel({ clock, script, local = LOCAL }) {
  const { createSupabaseHealthSentinel } = await import('../src/supabase-health-sentinel.mjs');
  return createSupabaseHealthSentinel({
    cloud_base: CLOUD,
    local_base: local,
    interval_ms: 500,
    degrade_streak: 2,
    restore_streak: 2,
    min_fallback_residency_ms: 0,
    now: clock.now,
    fetch_impl: makeFetch(clock, script),
  });
}

test('constructor validates sentinel, cloud base and fetch availability', () => {
  assert.throws(
    () => createFallbackConsoleRuntime({ sentinel: null, cloud_default_base: CLOUD }),
    /sentinel_required/,
  );
  assert.throws(
    () => createFallbackConsoleRuntime({ sentinel: { snapshot() {}, tick() {} }, cloud_default_base: '' }),
    /cloud_base_required/,
  );
  assert.throws(
    () => createFallbackConsoleRuntime({ sentinel: { snapshot() {}, tick() {} }, cloud_default_base: CLOUD, fetch_impl: null }),
    /fetch_unavailable/,
  );
});

test('console is LOCKED while the cloud is healthy — the reserve never rivals the authority', async () => {
  const clock = makeClock();
  const sentinel = await makeSentinel({ clock, script: ['ok'] });
  const runtime = createFallbackConsoleRuntime({ sentinel, local_base: LOCAL, cloud_default_base: CLOUD });
  await runtime.probe();
  const snap = runtime.snapshot();
  assert.equal(snap.schema, FALLBACK_CONSOLE_SCHEMA);
  assert.equal(snap.embedded, true);
  assert.equal(snap.gate.mode, 'CLOUD_AUTHORITY');
  assert.equal(snap.gate.locked, true);
  assert.equal(snap.gate.locked_reason, 'CLOUD_SUPERVISOR_HEALTHY_RESERVE_NOT_REQUIRED');
  assert.equal(snap.gate.drill_available, true);
  assert.equal(snap.gate.reserve_usable, true);
  assert.equal(snap.failover.active_base, ORIGINAL_BASE);
  assert.equal(snap.counters.base_swaps_total, 0);
  assert.equal(snap.authority_effect, false);
});

test('on LOCAL_FALLBACK flip the live supervisor base re-points to the reserve edge; hands back on restore', async () => {
  const clock = makeClock();
  const sentinel = await makeSentinel({ clock, script: ['ok', 'ok', 'fail', 'ok', 'fail', 'ok', 'ok', 'ok', 'ok', 'ok'] });
  const runtime = createFallbackConsoleRuntime({ sentinel, local_base: LOCAL, cloud_default_base: CLOUD });
  await runtime.probe(); // healthy boot observation
  assert.equal(runtime.applied_mode, 'CLOUD_AUTHORITY');
  try {
    await runtime.probe(); // cloud fail #1
    await runtime.probe(); // cloud fail #2 -> LOCAL_FALLBACK
    let snap = runtime.snapshot();
    assert.equal(snap.gate.mode, 'LOCAL_FALLBACK');
    assert.equal(snap.gate.locked, false);
    assert.equal(snap.gate.locked_reason, 'RESERVE_MODE_ACTIVE_LOCAL_SUPERVISOR_EDGE_IS_AUTHORITY');
    assert.equal(snap.failover.enabled, true);
    assert.equal(snap.failover.active_base, LOCAL);
    assert.equal(snap.counters.base_swaps_total, 1);
    assert.equal(snap.failover.base_swaps[0].mode, 'LOCAL_FALLBACK');

    await runtime.probe(); // cloud healthy #1
    await runtime.probe(); // healthy #2 -> restore (restore_streak 2)
    snap = runtime.snapshot();
    assert.equal(snap.gate.mode, 'CLOUD_AUTHORITY');
    assert.equal(snap.gate.locked, true);
    assert.equal(snap.failover.active_base, CLOUD); // handed back to the configured cloud default
    assert.equal(snap.counters.base_swaps_total, 2);
  } finally {
    setNativeSupervisorBase(ORIGINAL_BASE);
  }
});

test('operator env pin wins: failover disabled, console stays locked even in LOCAL_FALLBACK, no swap', async () => {
  const clock = makeClock();
  const sentinel = await makeSentinel({ clock, script: ['fail', 'ok', 'fail', 'ok'] });
  const runtime = createFallbackConsoleRuntime({
    sentinel,
    local_base: LOCAL,
    cloud_default_base: CLOUD,
    base_pinned_by_env: true,
  });
  try {
    await runtime.probe(); // boot observation: no swap by design
    await runtime.probe(); // flip observed, but the env pin must hold
    const snap = runtime.snapshot();
    assert.equal(snap.gate.mode, 'LOCAL_FALLBACK'); // sentinel observes the outage...
    assert.equal(snap.gate.locked, true); // ...but the console stays fail-closed
    assert.equal(snap.gate.locked_reason, 'BASE_PINNED_BY_OPERATOR_ENV_FAILOVER_DISABLED');
    assert.equal(snap.failover.enabled, false);
    assert.equal(snap.failover.base_pinned_by_env, true);
    assert.equal(snap.failover.active_base, ORIGINAL_BASE);
    assert.equal(snap.counters.base_swaps_total, 0);
  } finally {
    setNativeSupervisorBase(ORIGINAL_BASE);
  }
});

test('read-only drill is always available, even while locked; reports readiness honestly', async () => {
  const clock = makeClock();
  const sentinel = await makeSentinel({ clock, script: ['ok'] });
  const runtime = createFallbackConsoleRuntime({
    sentinel,
    local_base: LOCAL,
    cloud_default_base: CLOUD,
    fetch_impl: makeFetch(clock, [200]),
  });
  const drill = await runtime.drill();
  assert.equal(drill.ok, true);
  assert.equal(drill.reason, 'RESERVE_READY');
  assert.equal(drill.base, LOCAL);
  assert.equal(drill.authority_effect, false);

  const noLocal = createFallbackConsoleRuntime({
    sentinel,
    local_base: null,
    cloud_default_base: CLOUD,
    fetch_impl: makeFetch(clock, [200]),
  });
  const absent = await noLocal.drill();
  assert.equal(absent.ok, false);
  assert.equal(absent.reason, 'LOCAL_RESERVE_BASE_NOT_CONFIGURED');

  const dead = createFallbackConsoleRuntime({
    sentinel,
    local_base: LOCAL,
    cloud_default_base: CLOUD,
    fetch_impl: async () => { throw new Error('ECONNREFUSED'); },
  });
  const unreachable = await dead.drill();
  assert.equal(unreachable.ok, false);
  assert.equal(unreachable.reason, 'RESERVE_UNREACHABLE');

  const snap = runtime.snapshot();
  assert.equal(snap.drill.last.reason, 'RESERVE_READY');
  assert.equal(snap.counters.drills_total, 1);
  assert.equal(snap.drill.history.length, 1);
});

test('boot observation records the starting authority; a later sustained outage still swaps', async () => {
  const clock = makeClock();
  const sentinel = await makeSentinel({ clock, script: ['fail', 'ok', 'fail', 'ok', 'fail'] });
  const runtime = createFallbackConsoleRuntime({ sentinel, local_base: LOCAL, cloud_default_base: CLOUD });
  try {
    await runtime.probe(); // first observation: recorded, never swapped on boot
    assert.equal(runtime.applied_mode, 'CLOUD_AUTHORITY');
    assert.equal(runtime.snapshot().counters.base_swaps_total, 0);
    await runtime.probe(); // cloud DOWN streak 2 -> flip -> swap
    assert.equal(runtime.applied_mode, 'LOCAL_FALLBACK');
    assert.equal(runtime.snapshot().counters.base_swaps_total, 1);
    assert.equal(runtime.snapshot().failover.active_base, LOCAL);
  } finally {
    setNativeSupervisorBase(ORIGINAL_BASE);
  }
});
