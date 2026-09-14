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
  test(`transient wait-batch HTTP ${transientStatus} uses one signed single-lease fallback`, async () => {
    const signatures = [];
    const calls = [];
    const identity = {
      async deviceHeaders(method, path, bodyText) {
        signatures.push({ method, path, bodyText });
        return { 'content-type': 'application/json', 'x-test-signed-path': path };
      },
    };
    const command = { command_id: `cmd-${transientStatus}`, action: 'CONTROL_CAPABILITIES' };
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method, body: init.body, headers: init.headers });
      if (String(url) === BATCH_URL) {
        return jsonResponse({ ok: false, error: 'native_supervisor_failure' }, transientStatus);
      }
      if (String(url) === SINGLE_URL) return jsonResponse({ command }, 200);
      throw new Error(`unexpected_fetch:${url}`);
    };

    const transport = createNativeSupervisorHeartbeatTransport({
      identity,
      fetchImpl,
      legacySingleLeaseFallback: true,
    });
    const batchBody = JSON.stringify({
      supervisor_mode: 'CONTROL',
      max_batch: 64,
      max_tab_mutations: 8,
      wait_ms: 4000,
    });
    const batchHeaders = await transport.identity.deviceHeaders('POST', BATCH_PATH, batchBody);
    const response = await transport.fetchImpl(BATCH_URL, {
      method: 'POST',
      headers: batchHeaders,
      body: batchBody,
      cache: 'no-store',
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      commands: [command],
      transport_delivery_is_authority: false,
      authority_effect: false,
      transient_batch_fallback: true,
    });
    assert.deepEqual(calls.map((row) => row.url), [BATCH_URL, SINGLE_URL]);
    assert.equal(signatures.length, 2);
    assert.equal(signatures[0].path, BATCH_PATH);
    assert.equal(signatures[1].path, SINGLE_PATH);
    assert.deepEqual(JSON.parse(signatures[1].bodyText), { supervisor_mode: 'CONTROL' });
    assert.equal(calls[1].headers['x-test-signed-path'], SINGLE_PATH);
  });
}

test('batch-required mode preserves transient wait-batch failure without single-lease downgrade', async () => {
  const calls = [];
  const identity = {
    async deviceHeaders(method, path) {
      return { 'content-type': 'application/json', 'x-test-signed-path': path };
    },
  };
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return jsonResponse({ ok: false, error: 'native_supervisor_failure' }, 502);
  };
  const transport = createNativeSupervisorHeartbeatTransport({
    identity,
    fetchImpl,
    legacySingleLeaseFallback: false,
  });
  const batchBody = JSON.stringify({ supervisor_mode: 'CONTROL', wait_ms: 4000 });
  const response = await transport.fetchImpl(BATCH_URL, {
    method: 'POST',
    headers: await transport.identity.deviceHeaders('POST', BATCH_PATH, batchBody),
    body: batchBody,
  });

  assert.equal(response.status, 502);
  assert.deepEqual(calls, [BATCH_URL]);
});

test('non-transient wait-batch HTTP 500 remains visible and is not downgraded', async () => {
  const calls = [];
  const identity = {
    async deviceHeaders(method, path) {
      return { 'content-type': 'application/json', 'x-test-signed-path': path };
    },
  };
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return jsonResponse({ ok: false, error: 'native_supervisor_failure' }, 500);
  };
  const transport = createNativeSupervisorHeartbeatTransport({ identity, fetchImpl });
  const batchBody = JSON.stringify({ supervisor_mode: 'CONTROL', wait_ms: 4000 });
  const response = await transport.fetchImpl(BATCH_URL, {
    method: 'POST',
    headers: await transport.identity.deviceHeaders('POST', BATCH_PATH, batchBody),
    body: batchBody,
  });

  assert.equal(response.status, 500);
  assert.deepEqual(calls, [BATCH_URL]);
});
