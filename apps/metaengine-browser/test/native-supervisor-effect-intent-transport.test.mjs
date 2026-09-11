import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeSupervisorRuntimeTransport } from '../src/native-supervisor-runtime-transport.mjs';
import { NATIVE_SUPERVISOR_BASE, NATIVE_SUPERVISOR_RUNTIME_PATH } from '../src/native-supervisor-endpoints.mjs';

const COMMAND_ID = '33333333-3333-4333-8333-333333333333';

function identity() {
  const calls = [];
  return {
    calls,
    async ensure() { return { device_id: '22222222-2222-4222-8222-222222222222' }; },
    async deviceHeaders(method, requestPath, bodyText) {
      calls.push({ method, requestPath, bodyText });
      return { 'content-type': 'application/json', 'x-test-signature': 'browser-owned' };
    },
  };
}

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, async json() { return structuredClone(body); } };
}

function binding(overrides = {}) {
  return {
    schema: 'metaengine.native-supervisor.effect-binding.v2',
    command_id: COMMAND_ID,
    action: 'SEMANTIC_TYPE',
    tab_id: 'tab_123e4567-e89b-42d3-a456-426614174001',
    authority_effect: false,
    ...overrides,
  };
}

test('effect intent uses exact UUID route and returns server binding without claiming transport authority', async () => {
  const signer = identity();
  const fetchCalls = [];
  const serverBinding = { ...binding(), server_sealed: true };
  const transport = new NativeSupervisorRuntimeTransport({
    identity: signer,
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      return response(200, { accepted: true, effect_binding: serverBinding, effect_binding_sha256: 'a'.repeat(64) });
    },
  });

  const result = await transport.sealEffectIntent(COMMAND_ID, binding());
  assert.equal(signer.calls.length, 1);
  assert.equal(signer.calls[0].method, 'POST');
  assert.equal(signer.calls[0].requestPath, `${NATIVE_SUPERVISOR_RUNTIME_PATH}/v1/commands/${COMMAND_ID}/effect-intent`);
  assert.equal(fetchCalls[0].url, `${NATIVE_SUPERVISOR_BASE}/v1/commands/${COMMAND_ID}/effect-intent`);
  assert.deepEqual(JSON.parse(fetchCalls[0].init.body), { binding: binding() });
  assert.deepEqual(result.effect_binding, serverBinding);
  assert.equal(result.effect_binding_sha256, 'a'.repeat(64));
  assert.equal(result.server_accepted, true);
  assert.equal(result.transport_delivery_is_authority, false);
  assert.equal(result.automatic_effect_retry_allowed, false);
  assert.equal(result.authority_effect, false);
  assert.equal(transport.snapshot().effect_intent_transport, true);
  assert.equal(transport.snapshot().effect_intent_authority, false);
});

test('effect intent rejects malformed command binding and server response before Browser execution', async () => {
  const signer = identity();
  let fetches = 0;
  const transport = new NativeSupervisorRuntimeTransport({
    identity: signer,
    fetchImpl: async () => { fetches += 1; return response(409, { accepted: false, reason: 'binding_rejected' }); },
  });
  await assert.rejects(transport.sealEffectIntent('../escape', binding()), /command_id_invalid/);
  await assert.rejects(transport.sealEffectIntent(COMMAND_ID, binding({ command_id: '44444444-4444-4444-8444-444444444444' })), /effect_binding_command_mismatch/);
  await assert.rejects(transport.sealEffectIntent(COMMAND_ID, binding({ authority_effect: true })), /effect_binding_authority_invalid/);
  assert.equal(fetches, 0);
  assert.equal(signer.calls.length, 0);

  await assert.rejects(transport.sealEffectIntent(COMMAND_ID, binding()), /effect_intent_http_409:binding_rejected/);
  assert.equal(fetches, 1);
});
