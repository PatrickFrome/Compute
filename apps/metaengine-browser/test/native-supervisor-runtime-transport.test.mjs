import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  NativeSupervisorRuntimeTransport,
  NATIVE_SUPERVISOR_RUNTIME_TRANSPORT_SCHEMA,
} from '../src/native-supervisor-runtime-transport.mjs';
import { NATIVE_SUPERVISOR_BASE, NATIVE_SUPERVISOR_RUNTIME_PATH } from '../src/native-supervisor-endpoints.mjs';

function fakeIdentity() {
  const calls = [];
  return {
    calls,
    async ensure() { return { device_id: '22222222-2222-4222-8222-222222222222' }; },
    async deviceHeaders(method, requestPath, bodyText) {
      calls.push({ method, requestPath, bodyText });
      return {
        'content-type': 'application/json',
        'x-a2-device-id': '22222222-2222-4222-8222-222222222222',
        'x-a2-device-body-sha256': crypto.createHash('sha256').update(bodyText, 'utf8').digest('hex'),
      };
    },
  };
}

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return structuredClone(body); },
  };
}

test('wait-batch signs exact runtime path and performs one no-store request without legacy polling fallback', async () => {
  const identity = fakeIdentity();
  const fetchCalls = [];
  const transport = new NativeSupervisorRuntimeTransport({
    identity,
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      return response(200, { commands: [{ command_id: '33333333-3333-4333-8333-333333333333', action: 'CAPTURE' }] });
    },
  });

  const result = await transport.waitBatch({ supervisor_mode: 'CONTROL', max_batch: 64, max_tab_mutations: 16, wait_ms: 15000 });
  assert.equal(result.commands.length, 1);
  assert.equal(identity.calls.length, 1);
  assert.equal(identity.calls[0].method, 'POST');
  assert.equal(identity.calls[0].requestPath, `${NATIVE_SUPERVISOR_RUNTIME_PATH}/v1/commands/wait-batch`);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, `${NATIVE_SUPERVISOR_BASE}/v1/commands/wait-batch`);
  assert.equal(fetchCalls[0].init.cache, 'no-store');
  assert.equal(result.transport_delivery_is_authority, false);
  assert.equal(result.automatic_effect_retry_allowed, false);
  assert.equal(transport.snapshot().legacy_command_next, false);
  assert.equal(transport.snapshot().command_scheduler, false);
  assert.equal(transport.snapshot().timers, false);
});

test('state result cognitive and workspace requests share canonical signing path without enrollment surface', async () => {
  const identity = fakeIdentity();
  const urls = [];
  const transport = new NativeSupervisorRuntimeTransport({
    identity,
    fetchImpl: async (url, init) => {
      urls.push([url, init.method]);
      if (url.endsWith('/v1/state')) return response(202, { accepted: true });
      if (url.endsWith('/v1/devos/workspace-snapshot')) return response(200, { workspace: { state: 'READY' } });
      return response(200, { accepted: true, results: [] });
    },
  });

  await transport.postState({ state: { authority_effect: false } });
  await transport.postResultBatch([{ command_id: '33333333-3333-4333-8333-333333333333', ok: true }]);
  await transport.postCommandResult('33333333-3333-4333-8333-333333333333', { ok: true });
  await transport.postCognitiveDeltas({ stream_id: 's1', events: [] });
  await transport.workspaceSnapshot();

  assert.equal(urls.length, 5);
  assert.deepEqual(identity.calls.map((row) => row.requestPath), [
    `${NATIVE_SUPERVISOR_RUNTIME_PATH}/v1/state`,
    `${NATIVE_SUPERVISOR_RUNTIME_PATH}/v1/commands/result-batch`,
    `${NATIVE_SUPERVISOR_RUNTIME_PATH}/v1/commands/33333333-3333-4333-8333-333333333333/result`,
    `${NATIVE_SUPERVISOR_RUNTIME_PATH}/v1/cognitive/deltas`,
    `${NATIVE_SUPERVISOR_RUNTIME_PATH}/v1/devos/workspace-snapshot`,
  ]);
  const snap = transport.snapshot();
  assert.equal(snap.schema, NATIVE_SUPERVISOR_RUNTIME_TRANSPORT_SCHEMA);
  assert.equal(snap.enrollment_authority, false);
  assert.equal(snap.browser_execution_authority, false);
  assert.equal(snap.automatic_retry, false);
  assert.equal(snap.arbitrary_origin, false);
});

test('transport validates bounded wait and command identity before signing or network effects', async () => {
  const identity = fakeIdentity();
  let fetches = 0;
  const transport = new NativeSupervisorRuntimeTransport({ identity, fetchImpl: async () => { fetches += 1; return response(200, {}); } });
  await assert.rejects(transport.waitBatch({ supervisor_mode: 'BAD', max_batch: 64, max_tab_mutations: 16, wait_ms: 10 }), /mode_invalid/);
  await assert.rejects(transport.waitBatch({ supervisor_mode: 'CONTROL', max_batch: 0, max_tab_mutations: 0, wait_ms: 10 }), /max_batch_invalid/);
  await assert.rejects(transport.waitBatch({ supervisor_mode: 'CONTROL', max_batch: 8, max_tab_mutations: 9, wait_ms: 10 }), /max_tab_mutations_invalid/);
  await assert.rejects(transport.waitBatch({ supervisor_mode: 'CONTROL', max_batch: 8, max_tab_mutations: 2, wait_ms: 30001 }), /wait_ms_invalid/);
  await assert.rejects(transport.postCommandResult('../escape', { ok: true }), /command_id_invalid/);
  assert.equal(identity.calls.length, 0);
  assert.equal(fetches, 0);
});
