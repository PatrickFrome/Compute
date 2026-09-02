import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { SupervisorKeepalive } from '../src/supervisor-keepalive.mjs';
import { HostResilienceRuntime } from '../src/host-resilience-runtime.mjs';

const CONVERSATION = 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const NEXT_CONVERSATION = 'https://chatgpt.com/c/ffffffff-1111-2222-3333-444444444444';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../src');

function sharedHarness(seed = null) {
  let stored = seed == null ? null : structuredClone(seed);
  let now = Date.parse('2026-09-02T18:20:00.000Z');
  let seq = 0;
  const make = () => new SupervisorKeepalive({
    loadState: async () => structuredClone(stored),
    saveState: async (value) => { stored = structuredClone(value); },
    clock: () => now,
    uuid: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    minWakeIntervalMs: 30_000,
    maxCyclesPerEpoch: 4,
  });
  return { make, state: () => structuredClone(stored), advance: (ms) => { now += ms; } };
}

test('process restart converts unresolved WAKE_PENDING into non-replayable ambiguity', async () => {
  const h = sharedHarness();
  const first = h.make();
  await first.init();
  await first.bindConversation({ url: CONVERSATION, tab_id: 'tab_supervisor' });
  await first.enqueueWake('CONTINUE_DEVELOPMENT', { key: 'restart-gap' });
  const prepared = await first.prepareNextWake();
  assert.equal(first.snapshot().state, 'WAKE_PENDING');

  const restarted = h.make();
  await restarted.init();
  const snap = restarted.snapshot();
  assert.equal(snap.state, 'WAKE_AMBIGUOUS');
  assert.equal(snap.pending_wake.wake_id, prepared.pending.wake_id);
  assert.equal(snap.pending_wake.ambiguous_reason, 'PROCESS_RESTART_WITH_UNRESOLVED_WAKE_EFFECT');
  assert.equal(snap.pending_wake.automatic_retry_allowed, false);
  assert.equal(restarted.canWake(), false);
});

test('rollover has a durable pre-effect barrier and restart never replays the same attempt', async () => {
  const h = sharedHarness();
  const first = h.make();
  await first.init();
  await first.bindConversation({ url: CONVERSATION, tab_id: 'tab_old' });
  await first.requestRollover('MAX_CYCLES_PER_EPOCH');
  await first.approveRollover('TRUSTED_CONTINUOUS_SERVICE');
  const attempt = await first.beginRolloverAttempt();
  await first.bindRolloverAttemptTab('tab_rollover');
  assert.equal(first.snapshot().state, 'ROLLOVER_PENDING');

  const restarted = h.make();
  await restarted.init();
  const snap = restarted.snapshot();
  assert.equal(snap.state, 'ROLLOVER_AMBIGUOUS');
  assert.equal(snap.rollover_attempt.attempt_id, attempt.attempt_id);
  assert.equal(snap.rollover_attempt.automatic_retry_allowed, false);
  await assert.rejects(() => restarted.beginRolloverAttempt(), /rollover_not_released/);

  await restarted.bindRollover({ url: NEXT_CONVERSATION, tab_id: 'tab_rollover' });
  assert.equal(restarted.snapshot().supervisor_epoch, 2, 'positive readback may bind the already-attempted rollover');
  assert.equal(restarted.snapshot().rollover_attempt, null);
});

test('Windows login-start evidence self-heals on the existing resilience path', async () => {
  const monitor = new EventEmitter();
  let settingsReads = 0;
  let blocker = false;
  const electron = {
    app: {
      isPackaged: true,
      setLoginItemSettings: ({ openAtLogin, enabled }) => {
        assert.equal(openAtLogin, true);
        assert.equal(enabled, true);
      },
      getLoginItemSettings: () => {
        settingsReads += 1;
        return { openAtLogin: true, executableWillLaunchAtLogin: settingsReads >= 2 };
      },
    },
    powerSaveBlocker: {
      start: () => { blocker = true; return 7; },
      isStarted: () => blocker,
      stop: () => { blocker = false; return true; },
    },
    powerMonitor: monitor,
  };
  const runtime = new HostResilienceRuntime({ electron, platform: 'win32' });
  const first = await runtime.start();
  assert.equal(first.state, 'DEGRADED_LOGIN_START');
  assert.equal(first.login_start_verified, false);
  assert.equal(first.login_start_retry_pending, true);
  monitor.emit('resume');
  await new Promise((resolve) => setImmediate(resolve));
  const healed = runtime.snapshot();
  assert.equal(healed.state, 'ACTIVE');
  assert.equal(healed.login_start_verified, true);
  assert.equal(healed.executable_will_launch_at_login, true);
  assert.ok(healed.login_start_attempts >= 2);
  await runtime.stop();
  assert.equal(runtime.snapshot().external_stop_requested, true);
});

test('autonomy source invariants close UI, restart, host wiring and self-update gaps', async () => {
  const [main, mainEntry, lifecycle, nativeControl, nativeSupervisor, hostResilience] = await Promise.all([
    fs.readFile(path.join(src, 'main.mjs'), 'utf8'),
    fs.readFile(path.join(src, 'main-entry.mjs'), 'utf8'),
    fs.readFile(path.join(src, 'supervisor-lifecycle-runtime-core.mjs'), 'utf8'),
    fs.readFile(path.join(src, 'native-browser-control.mjs'), 'utf8'),
    fs.readFile(path.join(src, 'native-supervisor-client.mjs'), 'utf8'),
    fs.readFile(path.join(src, 'host-resilience-runtime.mjs'), 'utf8'),
  ]);
  assert.match(main, /event\.preventDefault\(\)/);
  assert.match(main, /windowRef\.hide\(\)/);
  const allClosed = main.slice(main.indexOf("app.on('window-all-closed'"), main.indexOf("app.once('ready'"));
  assert.doesNotMatch(allClosed, /app\.quit\(\)/);

  const rolloverAt = lifecycle.indexOf('await this.#keepalive.beginRolloverAttempt()');
  const newTabAt = lifecycle.indexOf("action: 'NEW_TAB'", rolloverAt);
  assert.ok(rolloverAt >= 0 && newTabAt > rolloverAt, 'durable rollover barrier must precede NEW_TAB');
  assert.match(lifecycle, /EXACT_COMPOSER_SHA256_THEN_POSITIVE_SEND_READBACK/);
  assert.match(lifecycle, /prompt_retyped: false/);
  assert.match(nativeControl, /value_sha256/);
  assert.match(nativeControl, /semantic_input_values_exposed: false/);
  assert.doesNotMatch(nativeControl, /row\.value\s*=/);

  assert.match(hostResilience, /sentinel_recovery_uses_existing_progress_tick:\s*true/);
  assert.match(hostResilience, /login_start_recovery_uses_existing_progress_tick:\s*true/);
  assert.equal((hostResilience.match(/setInterval\s*\(/g) || []).length, 1);

  assert.match(mainEntry, /new HostResilienceRuntime\(\)/);
  assert.match(mainEntry, /__METAENGINE_HOST_RESILIENCE_RUNTIME__/);
  assert.match(mainEntry, /app\.once\('ready',[\s\S]*hostResilience\.start\(\)/);
  assert.match(nativeSupervisor, /host_resilience:\s*hostResilienceSnapshot\(\)/);
  const prepareAt = nativeSupervisor.indexOf("prepareInstallerHandoff('SELF_UPDATE')");
  const priorHookAt = nativeSupervisor.indexOf('sourceBeforeSelfUpdateInstall?.(receipt)', prepareAt);
  assert.ok(prepareAt >= 0 && priorHookAt > prepareAt, 'sentinel installer handoff must precede external self-update hook');
  assert.match(nativeSupervisor, /host_resilience_second_polling_loop:\s*false/);
});
