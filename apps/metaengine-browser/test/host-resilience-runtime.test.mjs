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
  assert.equal(state.login_start_verified, true);
  assert.equal(state.login_start_policy_hold, false);
  assert.equal(state.login_start_repair_attempts, 1);
  assert.equal(state.prevent_app_suspension, true);
  await runtime.stop();
  assert.equal(runtime.snapshot().prevent_app_suspension, false);
});

test('Windows Startup Approval hold is advisory and never grants registration repair authority', async () => {
  const monitor = new EventEmitter();
  let writes = 0;
  const electron = {
    app: {
      isPackaged: true,
      setLoginItemSettings: () => { writes += 1; },
      getLoginItemSettings: () => ({ openAtLogin: true, executableWillLaunchAtLogin: false }),
    },
    powerMonitor: monitor,
  };
  const runtime = new HostResilienceRuntime({ electron, platform: 'win32' });
  const state = await runtime.start();
  assert.equal(state.state, 'ACTIVE');
  assert.equal(state.open_at_login, true);
  assert.equal(state.executable_will_launch_at_login, false);
  assert.equal(state.login_start_verified, true);
  assert.equal(state.login_start_policy_hold, true);
  assert.equal(state.login_start_repair_attempts, 0);
  assert.equal(state.login_start_retry_pending, false);
  assert.equal(state.login_start_policy_hold_is_advisory, true);
  assert.equal(state.login_start_policy_hold_grants_repair_authority, false);
  assert.equal(writes, 0);

  monitor.emit('resume');
  await new Promise((resolve) => setImmediate(resolve));
  const resumed = runtime.snapshot();
  assert.ok(resumed.login_start_attempts >= 2, 'resume must refresh policy readback');
  assert.equal(resumed.login_start_policy_hold, true);
  assert.equal(resumed.login_start_repair_attempts, 0);
  assert.equal(resumed.login_start_retry_pending, false);
  assert.equal(writes, 0, 'policy hold must not rewrite login registration');
  await runtime.stop();
});

test('proven absent login registration receives one repair before readback verification', async () => {
  const monitor = new EventEmitter();
  let registered = false;
  let writes = 0;
  const electron = {
    app: {
      isPackaged: true,
      setLoginItemSettings: ({ openAtLogin }) => {
        writes += 1;
        registered = openAtLogin === true;
      },
      getLoginItemSettings: () => ({
        openAtLogin: registered,
        executableWillLaunchAtLogin: registered,
      }),
    },
    powerMonitor: monitor,
  };
  const runtime = new HostResilienceRuntime({ electron, platform: 'win32' });
  const state = await runtime.start();
  assert.equal(state.state, 'ACTIVE');
  assert.equal(state.login_start_verified, true);
  assert.equal(state.login_start_policy_hold, false);
  assert.equal(state.login_start_repair_attempts, 1);
  assert.equal(state.login_start_repair_requires_fresh_absence_readback, true);
  assert.equal(writes, 1);

  await runtime.markProgress({ kind: 'TEST_HEARTBEAT' });
  assert.equal(runtime.snapshot().login_start_repair_attempts, 1);
  assert.equal(writes, 1, 'healthy registration must not be rewritten by resilience ticks');
  await runtime.stop();
});

test('ambiguous login-start readback degrades without invoking repair', async () => {
  let writes = 0;
  const electron = {
    app: {
      isPackaged: true,
      setLoginItemSettings: () => { writes += 1; },
      getLoginItemSettings: () => { throw new Error('startup_approval_read_denied'); },
    },
    powerMonitor: new EventEmitter(),
  };
  const runtime = new HostResilienceRuntime({ electron, platform: 'win32' });
  const state = await runtime.start();
  assert.equal(state.state, 'DEGRADED_LOGIN_START');
  assert.equal(state.login_start_verified, false);
  assert.equal(state.login_start_policy_hold, false);
  assert.equal(state.login_start_repair_attempts, 0);
  assert.equal(state.login_start_retry_pending, true);
  assert.match(state.last_error, /startup_approval_read_denied/);
  assert.equal(writes, 0, 'failed readback must not grant write authority');
  await runtime.stop();
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
  await runtime.stop();
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
