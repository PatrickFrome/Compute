import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acquirePrimaryInstance,
  METAENGINE_BROWSER_APP_ID,
  SINGLE_INSTANCE_LOCK_SCHEMA,
  validSingleInstanceLaunchData,
} from '../src/single-instance-guard.mjs';

const PRIMARY_LAUNCH_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SECONDARY_LAUNCH_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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

test('primary runtime acquires stable app identity and launch-bound lock', () => {
  const app = fakeApp({ lock: true });
  const result = acquirePrimaryInstance(app, { launch_id: PRIMARY_LAUNCH_ID });
  assert.equal(result.primary, true);
  assert.equal(result.bypassed, false);
  assert.equal(result.app_id, METAENGINE_BROWSER_APP_ID);
  assert.equal(result.launch_id, PRIMARY_LAUNCH_ID);
  assert.equal(result.secondary_ack_required, false);
  assert.equal(app.lockCalls, 1);
  assert.equal(app.quitCalls, 0);
  assert.deepEqual(app.lastData, {
    schema: SINGLE_INSTANCE_LOCK_SCHEMA,
    app_id: METAENGINE_BROWSER_APP_ID,
    launch_id: PRIMARY_LAUNCH_ID,
  });
  assert.equal(validSingleInstanceLaunchData(app.lastData), true);
});

test('losing runtime defers exit until entrypoint can prove primary UI activation', () => {
  const app = fakeApp({ lock: false });
  const result = acquirePrimaryInstance(app, { launch_id: SECONDARY_LAUNCH_ID });
  assert.equal(result.primary, false);
  assert.equal(result.bypassed, false);
  assert.equal(result.secondary_ack_required, true);
  assert.equal(result.launch_id, SECONDARY_LAUNCH_ID);
  assert.equal(app.lockCalls, 1);
  assert.equal(app.quitCalls, 0);
  assert.equal(validSingleInstanceLaunchData(app.lastData), true);
});

test('isolated smoke harness can bypass runtime singleton without weakening normal startup', () => {
  const app = fakeApp({ lock: false });
  const result = acquirePrimaryInstance(app, {
    bypass: true,
    launch_id: PRIMARY_LAUNCH_ID,
  });
  assert.equal(result.primary, true);
  assert.equal(result.bypassed, true);
  assert.equal(result.secondary_ack_required, false);
  assert.equal(app.lockCalls, 0);
  assert.equal(app.quitCalls, 0);
});
