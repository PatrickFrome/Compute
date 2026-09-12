import assert from 'node:assert/strict';
import test from 'node:test';

import { NativeSupervisorClient } from '../src/native-supervisor-client-base.mjs';

const ALWAYS_ON_CONTROL_ERROR = 'FINAL_RUNTIME_ALWAYS_ON_CONTROL_REQUIRED';

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return body; },
  };
}

function commandId(index) {
  return `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`;
}

function createHarness(command) {
  const deliveredResults = [];
  let delegatedExecutions = 0;
  let batchDelivered = false;

  const identity = {
    async ensure() {
      return {
        device_id: 'test-device',
        enrollment_request_id: null,
        public_jwk: {},
        key_fingerprint_sha256: 'test-key',
      };
    },
    snapshot() {
      return {
        device_id: 'test-device',
        enrollment_request_id: null,
        public_jwk: {},
        key_fingerprint_sha256: 'test-key',
      };
    },
    async deviceHeaders() {
      return { 'content-type': 'application/json' };
    },
  };

  const fetchImpl = async (url, init = {}) => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/v1/state')) {
      return jsonResponse(202, { accepted: true, authority_effect: false });
    }
    if (pathname.endsWith('/v1/commands/wait-batch')) {
      if (batchDelivered) return jsonResponse(200, { commands: [] });
      batchDelivered = true;
      return jsonResponse(200, { commands: [command] });
    }
    if (pathname.endsWith('/v1/commands/result-batch')) {
      const payload = JSON.parse(String(init.body || '{}'));
      deliveredResults.push(...(payload.results || []));
      return jsonResponse(200, {
        authority_effect: false,
        results: (payload.results || []).map((row) => ({
          command_id: row.command_id,
          accepted: true,
          status: row.ok === true ? 'COMPLETED' : 'FAILED',
        })),
      });
    }
    throw new Error(`unexpected_native_supervisor_request:${pathname}`);
  };

  const client = new NativeSupervisorClient({
    identity,
    fetchImpl,
    getState: async () => ({ tabs: [], active_tab: null }),
    executeCommand: async () => {
      delegatedExecutions += 1;
      throw new Error('legacy_set_mode_must_not_reach_generic_executor');
    },
    version: '0.0.0-test',
    legacySingleLeaseFallback: false,
    commandFastlane: false,
  });

  return {
    client,
    deliveredResults,
    delegatedExecutions: () => delegatedExecutions,
  };
}

for (const [index, requestedMode] of ['OBSERVE', 'GATE_SEND', 'CONTROL'].entries()) {
  test(`leased legacy SET_MODE ${requestedMode} canonicalizes to always-on CONTROL`, async () => {
    const harness = createHarness({
      command_id: commandId(index + 1),
      action: 'SET_MODE',
      payload: { mode: requestedMode },
    });

    await harness.client.cycle();

    assert.equal(harness.delegatedExecutions(), 0);
    assert.equal(harness.deliveredResults.length, 1);
    const [delivery] = harness.deliveredResults;
    assert.equal(delivery.ok, true);
    assert.equal(delivery.receipt.effect_outcome, 'CONFIRMED');
    assert.deepEqual(delivery.receipt.result, {
      operator_mode: 'CONTROL',
      supervisor_mode: 'CONTROL',
      armed: true,
      authority_effect: true,
    });

    const snapshot = harness.client.snapshot();
    assert.equal(snapshot.supervisor_mode, 'CONTROL');
    assert.equal(snapshot.armed, true);
  });
}

test('legacy operator_mode field is canonicalized without restoring OBSERVE authority', async () => {
  const harness = createHarness({
    command_id: commandId(4),
    action: 'SET_MODE',
    payload: { operator_mode: 'OBSERVE' },
  });

  await harness.client.cycle();

  assert.equal(harness.delegatedExecutions(), 0);
  assert.equal(harness.deliveredResults[0]?.ok, true);
  assert.equal(harness.deliveredResults[0]?.receipt?.result?.supervisor_mode, 'CONTROL');
  assert.equal(harness.client.snapshot().supervisor_mode, 'CONTROL');
  assert.equal(harness.client.snapshot().armed, true);
});

test('strict control API still rejects direct MONITOR and leased MONITOR fails closed', async () => {
  const harness = createHarness({
    command_id: commandId(5),
    action: 'SET_MODE',
    payload: { mode: 'MONITOR' },
  });

  assert.throws(
    () => harness.client.setControlState({ mode: 'MONITOR' }),
    (error) => error?.code === ALWAYS_ON_CONTROL_ERROR && error?.message === ALWAYS_ON_CONTROL_ERROR,
  );

  await harness.client.cycle();

  assert.equal(harness.delegatedExecutions(), 0);
  assert.equal(harness.deliveredResults.length, 1);
  const [delivery] = harness.deliveredResults;
  assert.equal(delivery.ok, false);
  assert.equal(delivery.error, ALWAYS_ON_CONTROL_ERROR);
  assert.equal(delivery.receipt.effect_outcome, 'AMBIGUOUS');
  assert.equal(harness.client.snapshot().supervisor_mode, 'CONTROL');
  assert.equal(harness.client.snapshot().armed, true);
});
