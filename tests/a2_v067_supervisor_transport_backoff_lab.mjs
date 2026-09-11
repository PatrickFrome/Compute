import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

const source = fs.readFileSync('coordination/chat-control-plane/extension/supervisor-device-transport-v067.js', 'utf8');
const LEGACY = 'https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-supervisor-v3-canary/v1/state';

function storageArea(seed = {}) {
  const data = { ...seed };
  return {
    data,
    async get(keys) {
      if (keys == null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => Object.hasOwn(data, k)).map((k) => [k, data[k]]));
    },
    async set(rows) { Object.assign(data, rows); },
    async remove(keys) { for (const k of (Array.isArray(keys) ? keys : [keys])) delete data[k]; }
  };
}

function makeContext({ enroll, status, nativeFetch }) {
  const session = storageArea();
  const context = vm.createContext({
    console, URL, Headers, Response, Request, TextEncoder, TextDecoder,
    Date, Error, String, Number, Math, Object, Array, Promise, RegExp,
    setTimeout, clearTimeout, crypto: webcrypto,
    chrome: { storage: { session } },
    fetch: nativeFetch || (async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })),
    A2_BRIDGE_BOOTSTRAP: {
      pairingEpoch: 'epoch-v067-test',
      supervisorBootstrapSecret: 's'.repeat(48)
    },
    A2_DEVICE_STATUS: status,
    A2_DEVICE_ENROLL: enroll,
    A2_DEVICE_SIGN_REQUEST: async () => ({
      profile: 'A2_DEVICE_HTTP_SIGNATURE_V1',
      device_id: '30246c89-e1c5-4593-8cc6-07eeb4cd1ca2',
      timestamp: new Date().toISOString(), nonce: 'n'.repeat(24),
      body_sha256: '0'.repeat(64), signature_b64url: 'x'.repeat(86)
    })
  });
  context.globalThis = context;
  vm.runInContext(source, context, { filename: 'supervisor-device-transport-v067.js' });
  return { context, session };
}

async function call(context) {
  return context.fetch(LEGACY, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-a2-chat-bridge-client': 'client-v067-test',
      'x-a2-chat-bridge-secret': 'legacy-secret-that-must-not-be-forwarded-123456'
    },
    body: '{}'
  });
}

// Terminal 4xx enrollment failure: one wire attempt, then session-scoped hold blocks repeats.
{
  let enrollCalls = 0;
  const { context, session } = makeContext({
    status: async () => ({ enrolled: false }),
    enroll: async () => {
      enrollCalls += 1;
      const e = new Error('device_enrollment_rejected');
      e.a2Terminal = true;
      e.a2HttpStatus = 409;
      e.a2ServerReason = 'embedded_bootstrap_rotation_failed';
      throw e;
    }
  });
  for (let i = 0; i < 2; i += 1) {
    await assert.rejects(call(context), (e) => e?.a2ExecutionClass === 'BLOCKED' && /terminal_hold/.test(String(e.message)));
  }
  assert.equal(enrollCalls, 1, 'terminal hold must suppress repeated enrollment wire calls');
  const hold = session.data.a2SupervisorEnrollmentHoldV067;
  assert.equal(hold.epoch, 'epoch-v067-test');
  assert.equal(hold.terminal, true);
  assert.equal(hold.status, 409);
  assert.equal(hold.reason, 'embedded_bootstrap_rotation_failed');
  assert.equal(hold.next_retry_at, null);
}

// Transient enrollment failure: immediate repeat is backoff-blocked, not a hot loop.
{
  let enrollCalls = 0;
  const { context, session } = makeContext({
    status: async () => ({ enrolled: false }),
    enroll: async () => { enrollCalls += 1; throw new Error('temporary_network_failure'); }
  });
  await assert.rejects(call(context), (e) => e?.a2ExecutionClass === 'BLOCKED' && /backoff/.test(String(e.message)));
  await assert.rejects(call(context), (e) => e?.a2ExecutionClass === 'BLOCKED' && /backoff/.test(String(e.message)));
  assert.equal(enrollCalls, 1);
  const hold = session.data.a2SupervisorEnrollmentHoldV067;
  assert.equal(hold.terminal, false);
  assert.ok(Date.parse(hold.next_retry_at) > Date.now());
}

// Signed-device revocation is fail-closed and must not silently fall back to bootstrap re-enrollment.
{
  let enrollCalls = 0;
  let forwardedSecret = null;
  const { context } = makeContext({
    status: async () => ({ enrolled: true, device_id: '30246c89-e1c5-4593-8cc6-07eeb4cd1ca2' }),
    enroll: async () => { enrollCalls += 1; },
    nativeFetch: async (_url, init) => {
      const headers = new Headers(init?.headers || {});
      forwardedSecret = headers.get('x-a2-chat-bridge-secret');
      return new Response(JSON.stringify({ reason: 'DEVICE_REVOKED' }), { status: 401, headers: { 'content-type': 'application/json' } });
    }
  });
  await assert.rejects(call(context), (e) => e?.a2ExecutionClass === 'BLOCKED' && /DEVICE_REVOKED/.test(String(e.message)));
  assert.equal(enrollCalls, 0, 'revoked signed identity must not auto-re-enroll with bootstrap');
  assert.equal(forwardedSecret, null, 'bootstrap/bridge secret must not be forwarded on signed requests');
}

assert.ok(source.includes('DEVICE_SIGNED_NO_BEARER_FALLBACK'));
assert.ok(source.includes('SCOPED_SINGLE_USE_BOOTSTRAP_THEN_DEVICE_GRANT'));
console.log('A2 v0.6.7 supervisor transport terminal/backoff/revoke contract: PASS');
