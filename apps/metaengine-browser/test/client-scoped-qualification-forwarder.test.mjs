import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientScopedQualificationForwarder, QUALIFIED_META_CANARY_BASE } from '../supabase/a2-browser-native-supervisor-v1/client-scoped-qualification-forwarder.mjs';

const clientId = '2a60d6a2-c7c2-4dcc-b4c9-99de768443c9';
const root = 'https://jhriwwsryeqsvvvufkok.supabase.co/functions/v1/a2-browser-native-supervisor-v1';
const request = (path, init = {}) => new Request(root + path, {
  ...init,
  headers: { 'x-a2-chat-bridge-client': clientId, ...(init.headers || {}) },
});

test('forwards exact signed bytes once while retaining logical signature identity', async () => {
  const bytes = new TextEncoder().encode('{"state":{"text":"Я → 确认","n":1}}');
  let calls = 0;
  const forward = createClientScopedQualificationForwarder({
    clientId,
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(url, QUALIFIED_META_CANARY_BASE + '/v1/state');
      assert.deepEqual(new Uint8Array(init.body), bytes);
      assert.equal(init.headers.get('x-a2-device-signature'), 'signature');
      assert.equal(init.headers.get('x-a2-device-nonce'), 'unique-nonce');
      assert.equal(init.headers.get('x-a2-device-body-sha256'), 'digest');
      assert.equal(init.headers.get('authorization'), 'existing-header');
      assert.equal(init.headers.get('host'), null);
      assert.equal(init.redirect, 'error');
      assert.ok(init.signal instanceof AbortSignal);
      return new Response('{"accepted":true}', { status: 202, headers: { 'content-type': 'application/json' } });
    },
  });
  const r = await forward(request('/v1/state', {
    method: 'POST', body: bytes,
    headers: { 'host': 'legacy.example', 'x-a2-device-signature': 'signature', 'x-a2-device-nonce': 'unique-nonce', 'x-a2-device-body-sha256': 'digest', 'authorization': 'existing-header' },
  }), '/v1/state');
  assert.equal(r.status, 202);
  assert.equal(await r.text(), '{"accepted":true}');
  assert.equal(r.headers.get('x-metaengine-qualified-client-route'), 'META_QUALIFIED_CANARY');
  assert.equal(calls, 1);
});

test('a spoofed identity still receives the upstream signature denial unchanged', async () => {
  const forward = createClientScopedQualificationForwarder({
    clientId, fetchImpl: async () => new Response('{"reason":"SIGNATURE_INVALID"}', { status: 401 }),
  });
  const r = await forward(request('/v1/admin/status'), '/v1/admin/status');
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { reason: 'SIGNATURE_INVALID' });
});

test('leaves other clients and non-native methods with the original handler', async () => {
  let calls = 0;
  const forward = createClientScopedQualificationForwarder({
    clientId, fetchImpl: async () => { calls++; throw new Error('must not fetch'); },
  });
  assert.equal(await forward(request('/v1/admin/status', { headers: { 'x-a2-chat-bridge-client': 'other-client' } }), '/v1/admin/status'), null);
  assert.equal(await forward(request('/v1/state', { method: 'OPTIONS' }), '/v1/state'), null);
  assert.equal(calls, 0);
});

test('keeps GET query and response body with no invented request body', async () => {
  const forward = createClientScopedQualificationForwarder({
    clientId, fetchImpl: async (url, init) => {
      assert.equal(url, QUALIFIED_META_CANARY_BASE + '/v1/status?cursor=12');
      assert.equal(init.body, undefined);
      return new Response('status', { status: 200 });
    },
  });
  const r = await forward(request('/v1/status?cursor=12'), '/v1/status');
  assert.equal(await r.text(), 'status');
});

test('rejects an untrusted destination, malformed identity and unbounded transport', () => {
  assert.throws(() => createClientScopedQualificationForwarder({ clientId, targetBase: 'https://example.com' }), /destination_invalid/);
  assert.throws(() => createClientScopedQualificationForwarder({ clientId: 'anything' }), /identity_invalid/);
  assert.throws(() => createClientScopedQualificationForwarder({ clientId, timeoutMs: 60_000 }), /transport_invalid/);
});

test('rejects ambiguous paths and route loops before fetching', async () => {
  let calls = 0;
  const forward = createClientScopedQualificationForwarder({
    clientId, fetchImpl: async () => { calls++; return new Response(); },
  });
  for (const path of ['/v1/../health', '/v1//state', '/v1/%2e%2e/health', '/health']) {
    assert.equal((await forward(request('/v1/state'), path)).status, 400);
  }
  const loop = await forward(request('/v1/state', { headers: { 'x-metaengine-qualified-route-hop': '1' } }), '/v1/state');
  assert.equal(loop.status, 508);
  assert.equal(calls, 0);
});

test('an uncertain submission never falls back or resends', async () => {
  let calls = 0;
  const forward = createClientScopedQualificationForwarder({
    clientId, fetchImpl: async () => { calls++; throw new Error('submitted then disconnected'); },
  });
  const r = await forward(request('/v1/state', { method: 'POST', body: '{}' }), '/v1/state');
  assert.equal(r.status, 503);
  const proof = await r.json();
  assert.equal(proof.automatic_effect_retry_allowed, false);
  assert.equal(proof.transport_is_authority, false);
  assert.equal('authority_effect' in proof, false);
  assert.equal(calls, 1);
});

test('upstream redirects cannot create a second submission', async () => {
  let calls = 0;
  const forward = createClientScopedQualificationForwarder({
    clientId, fetchImpl: async () => { calls++; return new Response(null, { status: 307, headers: { location: 'https://example.com' } }); },
  });
  assert.equal((await forward(request('/v1/state', { method: 'POST', body: '{}' }), '/v1/state')).status, 502);
  assert.equal(calls, 1);
});
