import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
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
