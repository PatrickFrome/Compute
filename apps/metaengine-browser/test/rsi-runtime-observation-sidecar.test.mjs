import assert from 'node:assert/strict';
import test from 'node:test';

import { RsiRuntimeObservationSidecar } from '../src/rsi-runtime-observation-sidecar.mjs';

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

test('sidecar keeps one latest pending Brain snapshot behind one in-flight observation', async () => {
  const gate = deferred();
  const seen = [];
  let calls = 0;
  const runtime = {
    async observeBrainSnapshot(snapshot) {
      calls += 1;
      seen.push(snapshot.seq);
      if (calls === 1) await gate.promise;
      return { observed_at: `t:${snapshot.seq}` };
    },
    async flushObservations() { return false; },
  };
  const sidecar = new RsiRuntimeObservationSidecar({ runtimeProvider: () => runtime });

  sidecar.submit({ seq: 1 });
  await Promise.resolve();
  sidecar.submit({ seq: 2 });
  sidecar.submit({ seq: 3 });
  sidecar.submit({ seq: 4 });

  const during = sidecar.snapshot();
  assert.equal(during.max_pending_snapshots, 1);
  assert.ok(during.replaced_pending_count >= 2);
  assert.equal(during.second_scheduler, false);

  gate.resolve();
  await sidecar.flush();

  assert.deepEqual(seen, [1, 4]);
  assert.equal(sidecar.snapshot().pending, false);
  assert.equal(sidecar.snapshot().authority_effect, false);
});

test('sidecar flush drains latest snapshot then asks runtime to flush coalesced persistence', async () => {
  const calls = [];
  const runtime = {
    async observeBrainSnapshot(snapshot) {
      calls.push(['observe', snapshot.seq]);
      return { observed_at: 'done' };
    },
    async flushObservations() {
      calls.push(['flush']);
      return true;
    },
  };
  const sidecar = new RsiRuntimeObservationSidecar({ runtimeProvider: () => runtime });
  sidecar.submit({ seq: 9 });
  const flushed = await sidecar.flush();
  assert.equal(flushed, true);
  assert.deepEqual(calls, [['observe', 9], ['flush']]);
  assert.equal(sidecar.snapshot().independent_timer, false);
});

test('sidecar records observation failures without retrying or gaining authority', async () => {
  const runtime = {
    async observeBrainSnapshot() { throw new Error('synthetic_failure'); },
    async flushObservations() { return false; },
  };
  const sidecar = new RsiRuntimeObservationSidecar({ runtimeProvider: () => runtime });
  sidecar.submit({ seq: 1 });
  await sidecar.flush();
  const snapshot = sidecar.snapshot();
  assert.equal(snapshot.failed_count, 1);
  assert.match(snapshot.last_error, /synthetic_failure/);
  assert.equal(snapshot.automatic_retry_allowed, false);
  assert.equal(snapshot.execution_authority, false);
  assert.equal(snapshot.authority_effect, false);
});
