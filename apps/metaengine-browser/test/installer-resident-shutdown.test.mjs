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

test('NSIS migration fallback is bounded and exact-path only', async () => {
  const ps1 = await fs.readFile(new URL('../build/installer-shutdown.ps1', import.meta.url), 'utf8');
  const nsh = await fs.readFile(new URL('../build/installer.nsh', import.meta.url), 'utf8');

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
});
