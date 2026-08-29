import assert from 'node:assert/strict';
import test from 'node:test';
import { acquirePrimaryInstance, METAENGINE_BROWSER_APP_ID } from '../src/single-instance-guard.mjs';

function fakeApp({ lock = true } = {}) {
  return {
    lockCalls: 0,
    quitCalls: 0,
    requestSingleInstanceLock(data) {
      this.lockCalls += 1;
      this.lastData = data;
      return lock;
    },
    quit() { this.quitCalls += 1; },
  };
}

test('primary runtime acquires stable app identity lock', () => {
  const app = fakeApp({ lock: true });
  const result = acquirePrimaryInstance(app);
  assert.equal(result.primary, true);
  assert.equal(result.bypassed, false);
  assert.equal(result.app_id, METAENGINE_BROWSER_APP_ID);
  assert.equal(app.lockCalls, 1);
  assert.equal(app.quitCalls, 0);
  assert.deepEqual(app.lastData, {
    schema: 'metaengine.browser.single-instance-lock.v1',
    app_id: 'com.metaengine.browser.test',
  });
});

test('second runtime exits before browser supervisor startup', () => {
  const app = fakeApp({ lock: false });
  const result = acquirePrimaryInstance(app);
  assert.equal(result.primary, false);
  assert.equal(app.lockCalls, 1);
  assert.equal(app.quitCalls, 1);
});

test('isolated smoke harness can bypass runtime singleton without weakening normal startup', () => {
  const app = fakeApp({ lock: false });
  const result = acquirePrimaryInstance(app, { bypass: true });
  assert.equal(result.primary, true);
  assert.equal(result.bypassed, true);
  assert.equal(app.lockCalls, 0);
  assert.equal(app.quitCalls, 0);
});
