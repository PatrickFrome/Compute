import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSupervisorRsiResultDeliveryAdapter,
  RSI_RESULT_DELIVERY_ADAPTER_SCHEMA,
} from '../src/supervisor-rsi-result-delivery-adapter.mjs';
import {
  createRsiResultReceiptReadback,
  projectRsiResultReceiptReadback,
  RSI_RESULT_RECEIPT_READBACK_SCHEMA,
} from '../supabase/a2-browser-native-supervisor-v1/result-receipt-readback.mjs';

const COMMAND_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID = 'metaengine-browser-test';
const RECEIPT = Object.freeze({
  schema: 'metaengine.native-supervisor.command-receipt.v2',
  command_id: COMMAND_ID,
  action: 'SCROLL',
  platform: 'CHATGPT',
  result: { moved: true },
  effect_outcome: 'CONFIRMED',
  recorded_at: '2026-09-17T05:09:49.879Z',
  authority_effect: false,
});
const OK_PAYLOAD = Object.freeze({ ok: true, receipt: RECEIPT, error: null });

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return structuredClone(body); },
  };
}

function terminalReadback({ status = 'COMPLETED', receipt = RECEIPT, error = null } = {}) {
  return {
    schema: RSI_RESULT_RECEIPT_READBACK_SCHEMA,
    command_id: COMMAND_ID,
    found: true,
    terminal: true,
    status,
    receipt: structuredClone(receipt),
    error,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

test('server readback projects only same-client COMPLETED/FAILED receipts', () => {
  const completed = projectRsiResultReceiptReadback({
    commandId: COMMAND_ID,
    clientId: CLIENT_ID,
    row: { command_id: COMMAND_ID, leased_by: CLIENT_ID, status: 'COMPLETED', receipt: RECEIPT, error: null },
  });
  assert.equal(completed.terminal, true);
  assert.deepEqual(completed.receipt, RECEIPT);
  assert.equal(completed.authority_effect, false);
  assert.equal(completed.execution_authority, false);

  const wrongClient = projectRsiResultReceiptReadback({
    commandId: COMMAND_ID,
    clientId: `${CLIENT_ID}-other`,
    row: { command_id: COMMAND_ID, leased_by: CLIENT_ID, status: 'COMPLETED', receipt: RECEIPT, error: null },
  });
  assert.deepEqual({ found: wrongClient.found, terminal: wrongClient.terminal, receipt: wrongClient.receipt }, { found: false, terminal: false, receipt: null });

  const expired = projectRsiResultReceiptReadback({
    commandId: COMMAND_ID,
    clientId: CLIENT_ID,
    row: { command_id: COMMAND_ID, leased_by: CLIENT_ID, status: 'EXPIRED', receipt: RECEIPT, error: 'lease_timeout_no_retry' },
  });
  assert.equal(expired.terminal, false);
  assert.equal(expired.receipt, null);
});

test('server readback rejects authority-bearing or command-mismatched receipts', () => {
  assert.throws(() => projectRsiResultReceiptReadback({
    commandId: COMMAND_ID,
    clientId: CLIENT_ID,
    row: { command_id: COMMAND_ID, leased_by: CLIENT_ID, status: 'COMPLETED', receipt: { ...RECEIPT, authority_effect: true } },
  }), /rsi_result_receipt_authority_invalid/);

  assert.throws(() => projectRsiResultReceiptReadback({
    commandId: COMMAND_ID,
    clientId: CLIENT_ID,
    row: { command_id: COMMAND_ID, leased_by: CLIENT_ID, status: 'COMPLETED', receipt: { ...RECEIPT, command_id: '22222222-2222-4222-8222-222222222222' } },
  }), /rsi_result_receipt_command_mismatch/);
});

test('server readback factory passes exact workspace/command/client identity to lookup', async () => {
  const calls = [];
  const reader = createRsiResultReceiptReadback({
    lookupCommand: async (input) => {
      calls.push(input);
      return { command_id: COMMAND_ID, leased_by: CLIENT_ID, status: 'FAILED', receipt: RECEIPT, error: 'command_failed' };
    },
  });
  const value = await reader.read({ workspaceId: 'workspace-test', commandId: COMMAND_ID, clientId: CLIENT_ID });
  assert.equal(reader.schema, RSI_RESULT_RECEIPT_READBACK_SCHEMA);
  assert.equal(value.status, 'FAILED');
  assert.deepEqual(calls, [{ workspaceId: 'workspace-test', commandId: COMMAND_ID, clientId: CLIENT_ID }]);
});

test('adapter reconciles a timed-out send only after exact matching independent readback', async () => {
  const calls = [];
  const adapter = createSupervisorRsiResultDeliveryAdapter({
    deadlineMs: 50,
    attempts: 2,
    backoffMs: [0],
    sleep: async () => {},
    signedRequest: async (path, options) => {
      calls.push({ path, method: options.method, has_signal: options.signal instanceof AbortSignal });
      if (options.method === 'POST') throw new Error('socket_timeout');
      return response(200, terminalReadback());
    },
  });
  assert.equal(adapter.schema, RSI_RESULT_DELIVERY_ADAPTER_SCHEMA);
  const outcome = await adapter.deliver({ commandId: COMMAND_ID, effectKey: 'effect-1', payload: OK_PAYLOAD });
  assert.equal(outcome.state, 'RECONCILED');
  assert.equal(outcome.delivery_attempts, 1);
  assert.equal(outcome.physical_effect_replay_allowed, false);
  assert.equal(outcome.automatic_effect_retry_allowed, false);
  assert.deepEqual(calls.map((call) => [call.method, call.path]), [
    ['POST', `/v1/commands/${COMMAND_ID}/result`],
    ['GET', `/v1/commands/${COMMAND_ID}/receipt`],
  ]);
  assert.equal(calls[0].has_signal, true);
});

test('mismatched terminal readback never reconciles and only same receipt transport is retried', async () => {
  let postCount = 0;
  let getCount = 0;
  const mismatched = { ...RECEIPT, result: { moved: false } };
  const adapter = createSupervisorRsiResultDeliveryAdapter({
    deadlineMs: 50,
    attempts: 2,
    backoffMs: [0],
    sleep: async () => {},
    signedRequest: async (_path, options) => {
      if (options.method === 'POST') {
        postCount += 1;
        assert.deepEqual(options.payload, OK_PAYLOAD);
        throw new Error('socket_timeout');
      }
      getCount += 1;
      return response(200, terminalReadback({ receipt: mismatched }));
    },
  });
  const outcome = await adapter.deliver({ commandId: COMMAND_ID, effectKey: 'effect-1', payload: OK_PAYLOAD });
  assert.equal(outcome.state, 'AMBIGUOUS');
  assert.equal(postCount, 2);
  assert.equal(getCount, 2);
  assert.equal(outcome.physical_effect_replay_allowed, false);
});

test('4xx completion rejection is terminal and is not retried or read back', async () => {
  let calls = 0;
  const adapter = createSupervisorRsiResultDeliveryAdapter({
    deadlineMs: 50,
    attempts: 3,
    backoffMs: [0],
    sleep: async () => {},
    signedRequest: async () => {
      calls += 1;
      return response(409, { error: 'completion_rejected' });
    },
  });
  const outcome = await adapter.deliver({ commandId: COMMAND_ID, payload: OK_PAYLOAD });
  assert.equal(outcome.state, 'REJECTED');
  assert.equal(outcome.delivery_attempts, 1);
  assert.equal(calls, 1);
});

test('batch fallback can read back before any same-receipt replay', async () => {
  const methods = [];
  const adapter = createSupervisorRsiResultDeliveryAdapter({
    deadlineMs: 50,
    attempts: 2,
    backoffMs: [0],
    sleep: async () => {},
    signedRequest: async (_path, options) => {
      methods.push(options.method);
      if (options.method === 'GET') return response(200, terminalReadback());
      throw new Error('unexpected_post');
    },
  });
  const outcome = await adapter.deliver({ commandId: COMMAND_ID, payload: OK_PAYLOAD, readbackBeforeReplay: true });
  assert.equal(outcome.state, 'RECONCILED');
  assert.equal(outcome.delivery_attempts, 0);
  assert.deepEqual(methods, ['GET']);
});

test('failed command reconciliation requires exact FAILED status and exact error', async () => {
  const failedPayload = { ok: false, receipt: { ...RECEIPT, result: null, effect_outcome: 'AMBIGUOUS' }, error: 'renderer_lost' };
  const adapter = createSupervisorRsiResultDeliveryAdapter({
    deadlineMs: 50,
    attempts: 1,
    backoffMs: [0],
    sleep: async () => {},
    signedRequest: async (_path, options) => {
      if (options.method === 'POST') throw new Error('socket_timeout');
      return response(200, terminalReadback({ status: 'FAILED', receipt: failedPayload.receipt, error: 'renderer_lost' }));
    },
  });
  const outcome = await adapter.deliver({ commandId: COMMAND_ID, payload: failedPayload });
  assert.equal(outcome.state, 'RECONCILED');
  assert.equal(outcome.execution_authority, false);
  assert.equal(outcome.self_update_authority, false);
});


test('sidecar readStoredReceipt performs bounded exact readback only and never posts a result', async () => {
  const calls = [];
  const adapter = createSupervisorRsiResultDeliveryAdapter({
    deadlineMs: 50,
    attempts: 1,
    backoffMs: [0],
    sleep: async () => {},
    signedRequest: async (path, options) => {
      calls.push({ path, method: options.method, has_signal: options.signal instanceof AbortSignal });
      return response(200, terminalReadback());
    },
  });
  const observed = await adapter.readStoredReceipt({ commandId: COMMAND_ID, payload: OK_PAYLOAD });
  assert.equal(observed?.terminal, true);
  assert.equal(observed?.status, 'COMPLETED');
  assert.deepEqual(observed?.receipt, RECEIPT);
  assert.deepEqual(calls.map((call) => call.method), ['GET']);
  assert.equal(calls[0].has_signal, true);
});

test('sidecar readStoredReceipt fails closed on receipt mismatch without replaying transport', async () => {
  let calls = 0;
  const adapter = createSupervisorRsiResultDeliveryAdapter({
    deadlineMs: 50,
    attempts: 3,
    backoffMs: [0],
    sleep: async () => {},
    signedRequest: async (_path, options) => {
      calls += 1;
      assert.equal(options.method, 'GET');
      return response(200, terminalReadback({ receipt: { ...RECEIPT, result: { moved: false } } }));
    },
  });
  const observed = await adapter.readStoredReceipt({ commandId: COMMAND_ID, payload: OK_PAYLOAD });
  assert.equal(observed, null);
  assert.equal(calls, 1);
});

test('sidecar readStoredReceipt timeout is bounded and resolves null without physical-effect retry', async () => {
  let calls = 0;
  let abortObserved = false;
  const adapter = createSupervisorRsiResultDeliveryAdapter({
    deadlineMs: 50,
    attempts: 3,
    backoffMs: [0],
    sleep: async () => {},
    signedRequest: async (_path, options) => {
      calls += 1;
      assert.equal(options.method, 'GET');
      options.signal?.addEventListener('abort', () => { abortObserved = true; }, { once: true });
      return new Promise(() => {});
    },
  });
  const started = Date.now();
  const observed = await adapter.readStoredReceipt({ commandId: COMMAND_ID, payload: OK_PAYLOAD });
  const elapsed = Date.now() - started;
  assert.equal(observed, null);
  assert.equal(calls, 1);
  assert.equal(abortObserved, true);
  assert.ok(elapsed >= 40 && elapsed < 1000, `bounded readback elapsed=${elapsed}ms`);
});
