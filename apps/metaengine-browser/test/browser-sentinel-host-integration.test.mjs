import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { HostResilienceRuntime } from '../src/host-resilience-runtime.mjs';

function fakeElectron() {
  const app = new EventEmitter();
  app.isPackaged = true;
  let login = false;
  app.setLoginItemSettings = ({ openAtLogin }) => { login = openAtLogin === true; };
  app.getLoginItemSettings = () => ({ openAtLogin: login, executableWillLaunchAtLogin: login });
  const powerMonitor = new EventEmitter();
  let blocker = false;
  return {
    app,
    powerMonitor,
    powerSaveBlocker: {
      start: () => { blocker = true; return 1; },
      isStarted: () => blocker,
      stop: () => { blocker = false; },
    },
  };
}

class FakeSentinel {
  constructor() { this.started = 0; this.intents = []; this.state = 'UNINITIALIZED'; }
  async start() { this.started += 1; this.state = 'ACTIVE'; return this.snapshot(); }
  snapshot() { return { state:this.state, authority_effect:false }; }
  stopSync({ intent }) { this.intents.push(intent); this.state='STOPPED'; return this.snapshot(); }
  async stop({ intent }) { this.intents.push(intent); this.state='STOPPED'; return this.snapshot(); }
}

test('host starts injected sentinel and normal quit latches USER_EXIT', async () => {
  const electron = fakeElectron();
  const sentinel = new FakeSentinel();
  const runtime = new HostResilienceRuntime({ electron, platform:'win32', browserSentinel:sentinel, getUpdateState:()=> 'IDLE' });
  const snap = await runtime.start();
  assert.equal(snap.browser_sentinel.state,'ACTIVE');
  assert.equal(sentinel.started,1);
  electron.app.emit('before-quit');
  assert.equal(sentinel.intents.at(-1),'USER_EXIT');
});

test('self-update restart maps only to UPDATE_RESTART shutdown intent', async () => {
  const electron = fakeElectron();
  const sentinel = new FakeSentinel();
  let updateState = 'IDLE';
  const runtime = new HostResilienceRuntime({ electron, platform:'win32', browserSentinel:sentinel, getUpdateState:()=> updateState });
  await runtime.start();
  updateState = 'RESTARTING';
  electron.app.emit('before-quit');
  assert.equal(sentinel.intents.at(-1),'UPDATE_RESTART');
});
