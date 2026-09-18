import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeSupervisorHeartbeatTransport } from '../src/native-supervisor-client-core.mjs';

const BASE = 'https://example.test/functions/v1/a2-browser-native-supervisor-v1';
const BATCH_URL = `${BASE}/v1/commands/wait-batch`;
const BATCH_PATH = '/a2-browser-native-supervisor-v1/v1/commands/wait-batch';
const SINGLE_URL = `${BASE}/v1/commands/next`;
const SINGLE_PATH = '/a2-browser-native-supervisor-v1/v1/commands/next';

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

for (const transientStatus of [502, 503, 504]) {
  test(`batch-required production mode recovers HTTP ${transientStatus} for one cycle`, async () => {
    const signatures = [];
    const calls = [];
    const identity = {
      async deviceHeaders(method, path, bodyText) {
        signatures.push({ method, path, bodyText });
        return { 'content-type': 'application/json', 'x-test-signed-path': path };
      },
    };
    const command = { command_id: `cmd-${transientStatus}`, action: 'CONTROL_CAPABILITIES' };
    let batchCalls = 0;
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method, body: init.body, headers: init.headers });
      if (String(url) === BATCH_URL) {
        batchCalls += 1;
        if (batchCalls === 1) return jsonResponse({ error: 'native_supervisor_failure' }, transientStatus);
        return jsonResponse({ commands: [] }, 200);
      }
      if (String(url) === SINGLE_URL) return jsonResponse({ command }, 200);
      throw new Error(`unexpected_fetch:${url}`);
    };

    // This is the actual production invariant: ordinary legacy fallback remains off.
    // Transient gateway recovery is a separate one-cycle transport repair.
    const transport = createNativeSupervisorHeartbeatTransport({
      identity,
      fetchImpl,
      transientBatchGatewayFallback: true,
    });
    const batchBody = JSON.stringify({
      supervisor_mode: 'CONTROL',
      max_batch: 64,
      max_tab_mutations: 16,
      wait_ms: 15000,
    });

    const callBatch = async () => transport.fetchImpl(BATCH_URL, {
      method: 'POST',
      headers: await transport.identity.deviceHeaders('POST', BATCH_PATH, batchBody),
      body: batchBody,
      cache: 'no-store',
    });

    const response = await callBatch();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      commands: [command],
      transport_delivery_is_authority: false,
      transient_batch_gateway_fallback: true,
      authority_effect: false,
    });
    assert.deepEqual(calls.map((row) => row.url), [BATCH_URL, SINGLE_URL]);
    assert.deepEqual(signatures.map((row) => row.path), [BATCH_PATH, SINGLE_PATH]);
    assert.deepEqual(JSON.parse(signatures[1].bodyText), { supervisor_mode: 'CONTROL' });
    assert.equal(calls[1].headers['x-test-signed-path'], SINGLE_PATH);

    // Recovery does not permanently downgrade transport. The next cycle probes
    // wait-batch again rather than moving into a legacy steady-state loop.
    const nextResponse = await callBatch();
    assert.equal(nextResponse.status, 200);
    assert.deepEqual(await nextResponse.json(), { commands: [] });
    assert.deepEqual(calls.map((row) => row.url), [BATCH_URL, SINGLE_URL, BATCH_URL]);
  });
}

test('transient batch gateway recovery can be explicitly disabled', async () => {
  const calls = [];
  const identity = {
    async deviceHeaders(_method, path) {
      return { 'content-type': 'application/json', 'x-test-signed-path': path };
    },
  };
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return jsonResponse({ error: 'native_supervisor_failure' }, 502);
  };
  const transport = createNativeSupervisorHeartbeatTransport({
    identity,
    fetchImpl,
    transientBatchGatewayFallback: false,
  });
  const batchBody = JSON.stringify({ supervisor_mode: 'CONTROL', wait_ms: 15000 });
  const response = await transport.fetchImpl(BATCH_URL, {
    method: 'POST',
    headers: await transport.identity.deviceHeaders('POST', BATCH_PATH, batchBody),
    body: batchBody,
  });
  assert.equal(response.status, 502);
  assert.deepEqual(calls, [BATCH_URL]);
});

test('non-transient wait-batch HTTP 500 remains visible', async () => {
  const calls = [];
  const identity = {
    async deviceHeaders(_method, path) {
      return { 'content-type': 'application/json', 'x-test-signed-path': path };
    },
  };
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return jsonResponse({ error: 'native_supervisor_failure' }, 500);
  };
  const transport = createNativeSupervisorHeartbeatTransport({ identity, fetchImpl });
  const batchBody = JSON.stringify({ supervisor_mode: 'CONTROL', wait_ms: 15000 });
  const response = await transport.fetchImpl(BATCH_URL, {
    method: 'POST',
    headers: await transport.identity.deviceHeaders('POST', BATCH_PATH, batchBody),
    body: batchBody,
  });
  assert.equal(response.status, 500);
  assert.deepEqual(calls, [BATCH_URL]);
});
