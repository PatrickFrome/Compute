import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { readClientGoalSubmissionMode } from '../src/client-native-coding-goal.mjs';

// Execute the actual presentation registration without launching Electron,
// starting a runtime host, or importing the production main process.
async function fixture() {
  const source = await readFile(new URL('./me2-r85-visual-evidence.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('function registerPresentationIpc() {');
  const end = source.indexOf('\nasync function waitFor(', start);
  assert.ok(start >= 0 && end > start);
  const handlers = new Map();
  const context = vm.createContext({
    ipcMain: { handle(channel, handler) {
      assert.equal(handlers.has(channel), false, `duplicate handler: ${channel}`);
      handlers.set(channel, handler);
    } },
    goalSubmitCount: 0,
  });
  vm.runInContext(source.slice(start, end) + '\nregisterPresentationIpc();', context);
  const invoke = async (channel, ...args) => {
    assert.ok(handlers.has(channel), `No handler registered for '${channel}'`);
    return handlers.get(channel)({}, ...args);
  };
  const exposed = {};
  const preload = await readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');
  vm.runInNewContext(preload, {
    require(name) {
      assert.equal(name, 'electron');
      return { contextBridge: { exposeInMainWorld: (key, value) => { exposed[key] = value; } },
        ipcRenderer: { invoke, on() {} } };
    },
    location: { protocol: 'http:', hostname: '127.0.0.1', port: '8137' },
  });
  return { invoke, bridge: exposed.metaengineClient, context };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('R97 actual preload can read the browser route without claiming readiness or submitting work', async () => {
  const { bridge, context } = await fixture();
  const expected = await readClientGoalSubmissionMode({
    readSummary: () => ({ status_file: '/disposable-fixture/status.json' }),
    lstat: async () => { throw Object.assign(new Error('fixture profile absent'), { code: 'ENOENT' }); },
  });
  for (let i = 0; i < 3; i++) {
    const mode = await bridge.goalSubmissionMode();
    assert.deepEqual(plain(mode), expected);
    assert.equal(Object.isFrozen(mode), true);
    assert.equal(mode.state, 'HOST_VERIFICATION_REQUIRED');
    assert.equal(mode.kind, 'BROWSER');
    assert.equal(await bridge.latestGoal(), null);
    assert.equal(await bridge.goalStatus(''), null);
    assert.equal(context.goalSubmitCount, 0);
  }
});

test('R97 mode fixture rejects caller parameters, like production read-only IPC', async () => {
  const { invoke, context } = await fixture();
  for (const args of [[true], [undefined], [{ state: 'READY', authority_effect: true }]]) {
    await assert.rejects(() => invoke('metaengine:client:goal-submission-mode', ...args),
      /client_goal_submission_mode_params_forbidden/);
  }
  assert.equal(context.goalSubmitCount, 0);
});

test('R97 route read leaves the existing isolated submit and queued progress fixture unchanged', async () => {
  const { bridge, context } = await fixture();
  await bridge.goalSubmissionMode();
  const receipt = await bridge.submitGoal('A presentation-only test goal');
  assert.equal(receipt.schema, 'metaengine.client.goal-submission.v1');
  assert.equal(receipt.authority_effect, false);
  const before = plain(await bridge.latestGoal());
  await bridge.goalSubmissionMode();
  assert.deepEqual(plain(await bridge.latestGoal()), before);
  assert.equal(context.goalSubmitCount, 1);
  const progress = await bridge.goalStatus(receipt.request_id);
  assert.equal(progress.task_state, 'READY');
  assert.equal(progress.authority_effect, false);
  assert.equal(context.goalSubmitCount, 1);
});
