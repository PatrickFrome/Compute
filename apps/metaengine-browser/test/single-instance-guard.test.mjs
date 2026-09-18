import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acquirePrimaryInstance,
  METAENGINE_BROWSER_APP_ID,
  SECONDARY_INSTANCE_RENOTIFY_DELAY_MS,
  SINGLE_INSTANCE_LOCK_SCHEMA,
} from '../src/single-instance-guard.mjs';

const LAUNCH_ID = '123e4567-e89b-42d3-a456-426614174000';

function schedulerHarness() {
  let task = null;
  let delay = null;
  let unrefCount = 0;
  return {
    schedule(fn, ms) {
      task = fn;
      delay = ms;
      return { unref() { unrefCount += 1; } };
    },
    run() {
      assert.equal(typeof task, 'function');
      task();
    },
    snapshot() { return { delay, unrefCount }; },
  };
}

test('losing secondary re-notifies primary once with the exact same launch identity', () => {
  const requests = [];
  const scheduler = schedulerHarness();
  let releases = 0;
  const app = {
    requestSingleInstanceLock(data) {
      requests.push(data);
      return false;
    },
    releaseSingleInstanceLock() { releases += 1; },
  };

  const guard = acquirePrimaryInstance(app, {
    launch_id: LAUNCH_ID,
    schedule: scheduler.schedule,
  });

  assert.equal(guard.primary, false);
  assert.equal(guard.secondary_ack_required, true);
  assert.equal(guard.secondary_renotify_scheduled, true);
  assert.equal(guard.secondary_renotify_delay_ms, SECONDARY_INSTANCE_RENOTIFY_DELAY_MS);
  assert.deepEqual(requests, [{
    schema: SINGLE_INSTANCE_LOCK_SCHEMA,
    app_id: METAENGINE_BROWSER_APP_ID,
    launch_id: LAUNCH_ID,
  }]);
  assert.deepEqual(scheduler.snapshot(), {
    delay: SECONDARY_INSTANCE_RENOTIFY_DELAY_MS,
    unrefCount: 1,
  });

  scheduler.run();

  assert.equal(requests.length, 2);
  assert.strictEqual(requests[1], requests[0], 'retry must reuse the identical frozen additionalData object');
  assert.equal(Object.isFrozen(requests[1]), true);
  assert.equal(releases, 0);
});

test('secondary fail-closes if retry unexpectedly acquires the singleton after primary disappears', () => {
  const scheduler = schedulerHarness();
  const lockResults = [false, true];
  let releases = 0;
  let calls = 0;
  const app = {
    requestSingleInstanceLock() {
      const result = lockResults[calls];
      calls += 1;
      return result;
    },
    releaseSingleInstanceLock() { releases += 1; },
  };

  const guard = acquirePrimaryInstance(app, {
    launch_id: LAUNCH_ID,
    schedule: scheduler.schedule,
  });
  assert.equal(guard.primary, false);
  scheduler.run();

  assert.equal(calls, 2);
  assert.equal(releases, 1, 'secondary must release an accidentally acquired retry lock');
  assert.equal(guard.primary, false, 'secondary identity can never be promoted by retry');
  assert.equal(guard.authority_effect, false);
});

test('primary does not schedule a redundant re-notification', () => {
  const scheduler = schedulerHarness();
  let calls = 0;
  const app = {
    requestSingleInstanceLock() { calls += 1; return true; },
  };

  const guard = acquirePrimaryInstance(app, {
    launch_id: LAUNCH_ID,
    schedule: scheduler.schedule,
  });

  assert.equal(guard.primary, true);
  assert.equal(guard.secondary_ack_required, false);
  assert.equal(guard.secondary_renotify_scheduled, false);
  assert.equal(guard.secondary_renotify_delay_ms, null);
  assert.deepEqual(scheduler.snapshot(), { delay: null, unrefCount: 0 });
  assert.equal(calls, 1);
});

test('secondary re-notify delay is bounded and rejects unsafe scheduler configuration', () => {
  const app = { requestSingleInstanceLock() { return false; } };
  assert.throws(() => acquirePrimaryInstance(app, {
    launch_id: LAUNCH_ID,
    secondary_retry_delay_ms: 0,
  }), /single_instance_secondary_renotify_delay_invalid/);
  assert.throws(() => acquirePrimaryInstance(app, {
    launch_id: LAUNCH_ID,
    secondary_retry_delay_ms: 10_001,
  }), /single_instance_secondary_renotify_delay_invalid/);
  assert.throws(() => acquirePrimaryInstance(app, {
    launch_id: LAUNCH_ID,
    schedule: null,
  }), /single_instance_secondary_renotify_scheduler_invalid/);
});
