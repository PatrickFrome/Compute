import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import test from 'node:test';
import { HostResilienceRuntime } from '../src/host-resilience-runtime.mjs';

function fakeElectron() {
  const monitor = new EventEmitter();
  let login = false;
  let blocker = false;
  return {
    app: {
      isPackaged: true,
      setLoginItemSettings: ({ openAtLogin }) => { login = openAtLogin === true; },
      getLoginItemSettings: () => ({ openAtLogin: login, executableWillLaunchAtLogin: login }),
    },
    powerSaveBlocker: {
      start: (type) => { assert.equal(type, 'prevent-app-suspension'); blocker = true; return 7; },
      isStarted: () => blocker,
      stop: () => { blocker = false; return true; },
    },
    powerMonitor: monitor,
  };
}

test('enables Windows login start and prevent-app-suspension', async () => {
  const electron = fakeElectron();
  const runtime = new HostResilienceRuntime({ electron, platform: 'win32' });
  const state = await runtime.start();
  assert.equal(state.state, 'ACTIVE');
  assert.equal(state.open_at_login, true);
  assert.equal(state.executable_will_launch_at_login, true);
  assert.equal(state.prevent_app_suspension, true);
  await runtime.stop();
  assert.equal(runtime.snapshot().prevent_app_suspension, false);
});

test('resume event triggers recovery callback without page authority', async () => {
  const electron = fakeElectron();
  let resumed = 0;
  const runtime = new HostResilienceRuntime({ electron, platform: 'win32', onResume: async () => { resumed += 1; } });
  await runtime.start();
  electron.powerMonitor.emit('resume');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resumed, 1);
  assert.ok(runtime.snapshot().last_resume_at);
  assert.equal(runtime.snapshot().authority_effect, false);
});

test('sentinel self-heal reuses the one parent-progress tick and creates no second scheduler', async () => {
  const source = await fs.readFile(new URL('../src/host-resilience-runtime.mjs', import.meta.url), 'utf8');
  assert.match(source, /recoverWorkerIfProvenAbsent/);
  assert.match(source, /sentinel_recovery_requires_exact_old_pid_absence:\s*true/);
  assert.match(source, /sentinel_recovery_uses_existing_progress_tick:\s*true/);
  assert.equal((source.match(/setInterval\s*\(/g) || []).length, 1);
  assert.match(source, /await this\.\#progressLease\.mark\(\{ kind, detail \}\)[\s\S]*recoverWorkerIfProvenAbsent/);
  assert.doesNotMatch(source, /watchdog_task_leasing:\s*true|watchdog_scheduler_authority:\s*true/);
});

test('initial sentinel bootstrap retries only when spawn effect is proven absent', async () => {
  const source = await fs.readFile(new URL('../src/host-resilience-runtime.mjs', import.meta.url), 'utf8');
  const spawnInvokeAt = source.indexOf('spawnInvoked = true');
  const spawnReturnAt = source.indexOf('spawnReturned = true', spawnInvokeAt);
  const retryProofAt = source.indexOf('const retrySafe = spawnReturned !== true', spawnReturnAt);
  const retryStateAt = source.indexOf("'PROVEN_NO_SPAWN_EFFECT'", retryProofAt);
  const retryTickAt = source.indexOf('this.#sentinelBootstrapRetrySafe) await this.#bootstrapSentinel()', retryStateAt);
  assert.ok(spawnInvokeAt >= 0 && spawnReturnAt > spawnInvokeAt);
  assert.ok(retryProofAt > spawnReturnAt);
  assert.ok(retryStateAt > retryProofAt);
  assert.ok(retryTickAt > retryStateAt);
  assert.match(source, /sentinel_bootstrap_retry_requires_proven_no_spawn_effect:\s*true/);
  assert.match(source, /sentinel_bootstrap_recovery_uses_existing_progress_tick:\s*true/);
  assert.match(source, /automatic_retry_allowed:\s*retrySafe/);
  assert.match(source, /host_resilience_sentinel_not_ready_for_installer_handoff/);
  assert.equal((source.match(/setInterval\s*\(/g) || []).length, 1, 'bootstrap recovery must reuse the existing resilience scheduler');
});
