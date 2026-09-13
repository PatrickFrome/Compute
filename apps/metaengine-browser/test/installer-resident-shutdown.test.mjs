import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {
  acquirePrimaryInstance,
  INSTALLER_SHUTDOWN_ARG,
  isInstallerShutdownArgv,
} from '../src/single-instance-guard.mjs';

const FIXED_LAUNCH_ID = '123e4567-e89b-42d3-a456-426614174000';

function fakePrimaryApp() {
  const listeners = new Map();
  const events = [];
  return {
    events,
    listeners,
    requestSingleInstanceLock: () => true,
    on: (name, handler) => listeners.set(name, handler),
    quit: () => events.push('quit'),
  };
}

function withInstallerArg(run) {
  const original = [...process.argv];
  process.argv.push(INSTALLER_SHUTDOWN_ARG);
  try {
    return run();
  } finally {
    process.argv.splice(0, process.argv.length, ...original);
  }
}

test('installer shutdown argv is exact and ordinary launches do not match', () => {
  assert.equal(isInstallerShutdownArgv(['browser.exe', INSTALLER_SHUTDOWN_ARG]), true);
  assert.equal(isInstallerShutdownArgv(['browser.exe', '--metaengine-installer-shutdown-extra']), false);
  assert.equal(isInstallerShutdownArgv(null), false);
});

test('primary installer shutdown stops HostResilience before Electron quit', async () => {
  delete globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__;
  const app = fakePrimaryApp();
  globalThis.__METAENGINE_HOST_RESILIENCE_RUNTIME__ = {
    stop: async () => {
      app.events.push('host-stop-start');
      await new Promise((resolve) => setImmediate(resolve));
      app.events.push('host-stop-end');
    },
  };
  globalThis.__METAENGINE_SELF_UPDATE_CONTINUITY_WATCHDOG__ = {
    cancel: () => app.events.push('watchdog-cancel'),
  };

  try {
    const guard = acquirePrimaryInstance(app, { launch_id: FIXED_LAUNCH_ID });
    assert.equal(guard.primary, true);
    const handler = app.listeners.get('second-instance');
    assert.equal(typeof handler, 'function');

    handler(null, ['browser.exe', INSTALLER_SHUTDOWN_ARG]);
    await new Promise((resolve) => setImmediate(() => setImmediate(resolve)));

    assert.deepEqual(app.events, [
      'watchdog-cancel',
      'host-stop-start',
      'host-stop-end',
      'quit',
    ]);
  } finally {
    delete globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__;
    delete globalThis.__METAENGINE_HOST_RESILIENCE_RUNTIME__;
    delete globalThis.__METAENGINE_SELF_UPDATE_CONTINUITY_WATCHDOG__;
  }
});

test('ordinary second-instance does not request installer shutdown', async () => {
  delete globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__;
  const app = fakePrimaryApp();
  globalThis.__METAENGINE_HOST_RESILIENCE_RUNTIME__ = {
    stop: async () => app.events.push('host-stop'),
  };
  try {
    acquirePrimaryInstance(app, { launch_id: FIXED_LAUNCH_ID });
    app.listeners.get('second-instance')(null, ['browser.exe']);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(app.events, []);
  } finally {
    delete globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__;
    delete globalThis.__METAENGINE_HOST_RESILIENCE_RUNTIME__;
  }
});

test('installer control exits immediately and releases an accidentally acquired primary lock', () => {
  const events = [];
  const listeners = new Map();
  const app = {
    requestSingleInstanceLock: () => true,
    releaseSingleInstanceLock: () => events.push('release-lock'),
    exit: (code) => events.push(`exit:${code}`),
    on: (name, handler) => listeners.set(name, handler),
  };

  const guard = withInstallerArg(() => acquirePrimaryInstance(app, { launch_id: FIXED_LAUNCH_ID }));
  assert.equal(guard.primary, true);
  assert.equal(guard.installer_shutdown_control, true);
  assert.equal(guard.secondary_ack_required, false);
  assert.equal(guard.secondary_renotify_scheduled, false);
  assert.equal(listeners.has('second-instance'), false);
  assert.deepEqual(events, ['release-lock', 'exit:0']);
});

test('installer control losing the lock keeps one bounded re-notify then exits before UI ACK timeout', () => {
  const events = [];
  const scheduled = [];
  let lockCalls = 0;
  const app = {
    requestSingleInstanceLock: () => {
      lockCalls += 1;
      return false;
    },
    releaseSingleInstanceLock: () => events.push('release-lock'),
    exit: (code) => events.push(`exit:${code}`),
    on: () => {},
  };
  const schedule = (fn, delay) => {
    scheduled.push({ fn, delay });
    return { unref() {} };
  };

  const guard = withInstallerArg(() => acquirePrimaryInstance(app, {
    launch_id: FIXED_LAUNCH_ID,
    schedule,
  }));
  assert.equal(guard.primary, false);
  assert.equal(guard.installer_shutdown_control, true);
  assert.equal(guard.secondary_ack_required, false);
  assert.equal(guard.secondary_renotify_scheduled, true);
  assert.deepEqual(scheduled.map((row) => row.delay), [4_000, 4_250]);

  scheduled[0].fn();
  assert.equal(lockCalls, 2);
  assert.deepEqual(events, []);
  scheduled[1].fn();
  assert.deepEqual(events, ['exit:0']);
});

test('NSIS migration fallback is bounded and exact-path only', async () => {
  const ps1 = await fs.readFile(new URL('../build/installer-shutdown.ps1', import.meta.url), 'utf8');
  const nsh = await fs.readFile(new URL('../build/installer.nsh', import.meta.url), 'utf8');
  const physical = await fs.readFile(new URL('./installer-resident-upgrade-physical.ps1', import.meta.url), 'utf8');

  assert.match(ps1, /Win32_Process/);
  assert.match(ps1, /ExecutablePath/);
  assert.match(ps1, /OrdinalIgnoreCase\.Equals/);
  assert.match(ps1, /Stop-Process -Id/);
  assert.match(ps1, /AddSeconds\(\$GraceSeconds\)/);
  assert.match(ps1, /AddSeconds\(\$ForceSeconds\)/);
  assert.doesNotMatch(ps1, /taskkill/i);
  assert.doesNotMatch(ps1, /Stop-Process\s+-Name/i);

  assert.match(nsh, /!macro customInit/);
  assert.match(nsh, /\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}/);
  assert.match(nsh, /metaengine-installer-shutdown\.ps1/);
  assert.match(nsh, /ExecWait/);
  assert.match(nsh, /Abort/);

  assert.match(physical, /planned_shutdown_signal_exit_/);
  assert.match(physical, /installer-resident-upgrade-proof\.json/);
});