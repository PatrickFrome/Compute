import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeSupervisorClient } from '../src/native-supervisor-client-base.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('transient identity failure cannot terminate the native supervisor scheduler', async () => {
  let ensureCalls = 0;
  const identity = {
    ensure: async () => {
      ensureCalls += 1;
      if (ensureCalls === 1) throw new Error('transient_identity_failure');
      return { device_id: null, enrollment_request_id: 'req_pending' };
    },
    snapshot: () => ({ device_id: null, enrollment_request_id: 'req_pending' }),
    enrollmentHeaders: async () => ({}),
    deviceHeaders: async () => ({}),
    clearEnrollmentRequest: async () => {},
    bindEnrollmentRequest: async () => {},
    bindDevice: async () => {},
  };
  const client = new NativeSupervisorClient({
    identity,
    fetchImpl: async () => ({ status: 202, ok: true, json: async () => ({}) }),
    getState: async () => ({ tabs: [], fleet: { agents: [] } }),
    executeCommand: async () => ({ ok: true, authority_effect: false }),
    version: 'test',
    intervalMs: 1000,
  });

  await assert.rejects(client.start(), /transient_identity_failure/);
  assert.equal(client.snapshot().running, true);
  assert.equal(client.snapshot().continuous_service?.startup_scheduler_armed_before_enrollment, true);
  await sleep(1100);
  assert.ok(ensureCalls >= 2, 'scheduler must retry a failed startup without another external start call');
  client.stop();
  assert.equal(client.snapshot().running, false);
});
