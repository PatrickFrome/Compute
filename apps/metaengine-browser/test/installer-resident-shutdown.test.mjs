import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {
  acquirePrimaryInstance,
  INSTALLER_SHUTDOWN_ARG,
  isInstallerShutdownArgv,
  registerPrimaryInstallerShutdownBarrier,
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

test('primary installer shutdown requests cooperative quit without any forced-exit fallback', async () => {
  delete globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__;
  const app = fakePrimaryApp();
  const scheduled = [];
  let unrefCount = 0;
  app.exit = (code) => app.events.push(`exit:${code}`);
  const schedule = (fn, delay) => {
    app.events.push(`fallback-arm:${delay}`);
    scheduled.push({ fn, delay });
    return {
      unref() {
        unrefCount += 1;
        app.events.push('fallback-unref');
      },
    };
  };
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
    const guard = acquirePrimaryInstance(app, {
      launch_id: FIXED_LAUNCH_ID,
      schedule,
    });
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
    assert.equal(scheduled.length, 0, 'a prevented quit must never be bypassed');
    assert.equal(unrefCount, 0);
    assert.equal(app.events.some((event) => event.startsWith('exit:')), false);

    const eventCountBeforeRepeat = app.events.length;
    handler(null, ['browser.exe', INSTALLER_SHUTDOWN_ARG]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(scheduled.length, 0, 'repeated installer shutdown must not force exit');
    assert.equal(app.events.length, eventCountBeforeRepeat);

    assert.equal(app.events.some((event) => event.startsWith('exit:')), false);
  } finally {
    delete globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__;
    delete globalThis.__METAENGINE_HOST_RESILIENCE_RUNTIME__;
    delete globalThis.__METAENGINE_SELF_UPDATE_CONTINUITY_WATCHDOG__;
  }
});

test('ordinary second-instance does not request installer shutdown or arm forced-exit fallback', async () => {
  delete globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__;
  const app = fakePrimaryApp();
  let scheduleCalls = 0;
  const schedule = () => {
    scheduleCalls += 1;
    return { unref() {} };
  };
  globalThis.__METAENGINE_HOST_RESILIENCE_RUNTIME__ = {
    stop: async () => app.events.push('host-stop'),
  };
  try {
    acquirePrimaryInstance(app, { launch_id: FIXED_LAUNCH_ID, schedule });
    app.listeners.get('second-instance')(null, ['browser.exe']);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(app.events, []);
    assert.equal(scheduleCalls, 0);
  } finally {
    delete globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__;
    delete globalThis.__METAENGINE_HOST_RESILIENCE_RUNTIME__;
  }
});

test('primary waits for its registered preparation barrier before resilience stop and cooperative quit', async () => {
  delete globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__;
  const app = fakePrimaryApp();
  let release;
  const cleanup = new Promise(resolve => { release = resolve; });
  let schedules = 0;
  globalThis.__METAENGINE_HOST_RESILIENCE_RUNTIME__ = { stop: async () => app.events.push('resilience-stop') };
  try {
    acquirePrimaryInstance(app, { launch_id: FIXED_LAUNCH_ID, schedule: () => {
      schedules++; app.events.push('fallback'); return { unref() {} };
    } });
    registerPrimaryInstallerShutdownBarrier(app, async () => {
      app.events.push('owned-cleanup-start'); await cleanup; app.events.push('owned-cleanup-confirmed');
    });
    app.listeners.get('second-instance')(null, ['browser.exe', INSTALLER_SHUTDOWN_ARG]);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(app.events, ['owned-cleanup-start']);
    assert.equal(schedules, 0);
    release();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(app.events, ['owned-cleanup-start', 'owned-cleanup-confirmed', 'resilience-stop', 'quit']);
  } finally {
    delete globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__;
    delete globalThis.__METAENGINE_HOST_RESILIENCE_RUNTIME__;
  }
});

test('failed owned cleanup keeps the primary alive without quit or a forced-exit timer', async () => {
  delete globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__;
  const app = fakePrimaryApp();
  let schedules = 0;
  const errors = [];
  let attempts = 0;
  const originalError = console.error;
  console.error = row => errors.push(JSON.parse(row));
  try {
    acquirePrimaryInstance(app, { launch_id: FIXED_LAUNCH_ID, schedule: () => { schedules++; } });
    registerPrimaryInstallerShutdownBarrier(app, async () => { attempts++; throw new Error('private-fixture-config'); });
    app.listeners.get('second-instance')(null, ['browser.exe', INSTALLER_SHUTDOWN_ARG]);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(app.events, []);
    assert.equal(schedules, 0);
    assert.equal(globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__, true);
    assert.equal(errors[0].state, 'PRIMARY_SHUTDOWN_BLOCKED');
    assert.equal(errors[0].primary_kept_alive, true);
    assert.doesNotMatch(JSON.stringify(errors), /private-fixture-config/);
    app.listeners.get('second-instance')(null, ['browser.exe', INSTALLER_SHUTDOWN_ARG]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(attempts, 2, 'a later explicit signal may retry cleanup while startup stays fenced');
    assert.equal(schedules, 0);
  } finally {
    console.error = originalError;
    delete globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__;
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

test('NSIS installed-file gate is read-only and rejects unqualified shutdown protocols', async () => {
  const ps1 = await fs.readFile(new URL('../build/installer-shutdown.ps1', import.meta.url), 'utf8');
  const nsh = await fs.readFile(new URL('../build/installer.nsh', import.meta.url), 'utf8');
  const physical = await fs.readFile(new URL('./installer-resident-upgrade-physical.ps1', import.meta.url), 'utf8');

  assert.match(ps1, /Win32_Process/);
  assert.match(ps1, /ExecutablePath/);
  assert.match(ps1, /OrdinalIgnoreCase\.Equals/);
  assert.doesNotMatch(ps1, /Start-Process|Stop-Process|--metaengine-installer-shutdown|Start-Sleep/);
  assert.match(ps1, /installer_shutdown_controlled_quit_required/);
  assert.match(ps1, /installer_shutdown_process_identity_unknown/);
  assert.match(ps1, /if \(\$existing.Count -ne 0\) \{[\s\S]*?exit 23/);
  assert.doesNotMatch(ps1, /^\s*(?:&\s*)?taskkill(?:\.exe)?\b/im);
  assert.doesNotMatch(ps1, /Stop-Process\s+-Name/i);

  assert.match(nsh, /!macro customCheckAppRunning/);
  assert.doesNotMatch(nsh, /!macro customInit\b/);
  assert.match(nsh, /\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}/);
  assert.match(nsh, /metaengine-installer-shutdown\.ps1/);
  assert.match(nsh, /ExecWait/);
  assert.match(nsh, /Abort/);

  assert.match(physical, /planned_shutdown_signal_exit_/);
  assert.match(physical, /installer-resident-upgrade-proof\.json/);
});


test('installer shutdown has no authority over daemon locks, credentials or bridge files', async () => {
  const ps1 = await fs.readFile(new URL('../build/installer-shutdown.ps1', import.meta.url), 'utf8');
  // A stale PID does not bind any artifact to this installation, and a failed
  // inventory is UNKNOWN. The installer must not even select credential paths.
  assert.doesNotMatch(ps1, /Remove-DeadComputeDaemonState|Remove-Item|control-token|compute-bridge\.json|a2-daemon\.lock|\$env:USERPROFILE/);
});

test('installer preparation preserves Host capability until the canonical Electron quit barriers drain', async () => {
  const entry = await fs.readFile(new URL('../src/main-entry.mjs', import.meta.url), 'utf8');
  const main = await fs.readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const host = await fs.readFile(new URL('../src/local-runtime-host-controller.mjs', import.meta.url), 'utf8');
  const barrier = /registerPrimaryInstallerShutdownBarrier\(app, async \(\) => \{([\s\S]*?)\n  \}\);/.exec(entry)?.[1];
  assert.ok(barrier);
  assert.match(barrier, /await primaryPreparation/);
  assert.doesNotMatch(barrier, /stopOwnedLocalRuntimeHost/);
  assert.match(entry, /installLocalRuntimeHostShutdown\(app\)/);
  assert.match(main, /app\.on\('before-quit',[\s\S]*?event\.preventDefault\(\)[\s\S]*?closeManagedTaskProjectHost\(\)/);
  assert.match(host, /app\.on\('will-quit',[\s\S]*?event\.preventDefault\(\)[\s\S]*?stopOwnedLocalRuntimeHost\(\)/);
});


test('failed Sentinel shutdown cannot authorize a primary quit or a success exit', async () => {
  const app=fakePrimaryApp();let schedules=0;app.exit=code=>app.events.push('exit:'+code);
  const previous=console.error;const diagnostics=[];console.error=row=>diagnostics.push(JSON.parse(row));
  globalThis.__METAENGINE_HOST_RESILIENCE_RUNTIME__={stop:async()=>{throw Error('fixture_sentinel_cleanup_unknown');}};
  try {
    acquirePrimaryInstance(app,{launch_id:FIXED_LAUNCH_ID,schedule:()=>{schedules++;}});
    app.listeners.get('second-instance')(null,['browser.exe',INSTALLER_SHUTDOWN_ARG]);
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(app.events,[]);assert.equal(schedules,0);
    assert.equal(diagnostics[0].state,'PRIMARY_SHUTDOWN_BLOCKED');
    assert.equal(diagnostics[0].primary_kept_alive,true);
    assert.equal(globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__,true);
  } finally {console.error=previous;delete globalThis.__METAENGINE_HOST_RESILIENCE_RUNTIME__;delete globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__;}
});
