import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

const source = fs.readFileSync('coordination/chat-control-plane/extension/supervisor-device-transport-v068.js', 'utf8');
const LEGACY = 'https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-supervisor-v3-canary/v1/state';
const HEALTH = 'https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-supervisor-v4/health';
const HOLD_KEY = 'a2SupervisorEnrollmentHoldV067';

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

function oldHold(reason, extra = {}) {
  return {
    schema: 'metaengine.a2-browser-supervisor.enrollment-hold.v1',
    epoch: 'epoch-v068-test', terminal: true, attempts: 1, status: 409,
    reason, observed_at: '2026-08-27T16:07:00.000Z', next_retry_at: null,
    ...extra
  };
}

function makeContext({ hold, healthSupported = true, initiallyEnrolled = false, healthDelay = 0 }) {
  const session = storageArea(hold ? { [HOLD_KEY]: hold } : {});
  let enrolled = initiallyEnrolled;
  let enrollCalls = 0;
  let healthCalls = 0;
  let signedWireCalls = 0;
  let secretLeak = false;

  const nativeFetch = async (input, init = {}) => {
    const url = String(input);
    const headers = new Headers(init.headers || {});
    if (headers.has('x-a2-chat-bridge-secret')) secretLeak = true;
    if (url === HEALTH) {
      healthCalls += 1;
      if (healthDelay) await new Promise((r) => setTimeout(r, healthDelay));
      return new Response(JSON.stringify({
        ok: true,
        schema: 'metaengine.a2-browser-supervisor.health.v7',
        profile: 'A2_DEVICE_HTTP_SIGNATURE_V1',
        embedded_bootstrap_rotation: true,
        enrollment_recovery_after_rotation: healthSupported
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    signedWireCalls += 1;
    return new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { 'content-type': 'application/json' } });
  };

  const context = vm.createContext({
    console, URL, Headers, Response, Request, TextEncoder, TextDecoder,
    Date, Error, String, Number, Math, Object, Array, Promise, RegExp,
    Uint32Array, setTimeout, clearTimeout, crypto: webcrypto,
    chrome: { storage: { session } },
    fetch: nativeFetch,
    A2_BRIDGE_BOOTSTRAP: {
      pairingEpoch: 'epoch-v068-test',
      supervisorBootstrapSecret: 's'.repeat(48)
    },
    A2_DEVICE_STATUS: async () => ({ enrolled, device_id: enrolled ? '30246c89-e1c5-4593-8cc6-07eeb4cd1ca2' : null }),
    A2_DEVICE_ENROLL: async () => { enrollCalls += 1; enrolled = true; return { accepted: true }; },
    A2_DEVICE_SIGN_REQUEST: async () => ({
      profile: 'A2_DEVICE_HTTP_SIGNATURE_V1',
      device_id: '30246c89-e1c5-4593-8cc6-07eeb4cd1ca2',
      timestamp: new Date().toISOString(), nonce: 'n'.repeat(24),
      body_sha256: '0'.repeat(64), signature_b64url: 'x'.repeat(86)
    })
  });
  context.globalThis = context;
  vm.runInContext(source, context, { filename: 'supervisor-device-transport-v068.js' });

  return {
    context, session,
    stats: () => ({ enrollCalls, healthCalls, signedWireCalls, secretLeak })
  };
}

async function call(context) {
  return context.fetch(LEGACY, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-a2-chat-bridge-client': 'client-v068-test',
      'x-a2-chat-bridge-secret': 'legacy-secret-that-must-never-reach-signed-wire-123456'
    },
    body: '{}'
  });
}

// Known historical rotation failure + explicit v7 capability -> exactly one safe reconciliation and enrollment.
{
  const lab = makeContext({ hold: oldHold('EMBEDDED_BOOTSTRAP_ROTATION_FAILED') });
  const response = await call(lab.context);
  assert.equal(response.status, 202);
  assert.deepEqual(lab.stats(), { enrollCalls: 1, healthCalls: 1, signedWireCalls: 1, secretLeak: false });
  assert.equal(lab.session.data[HOLD_KEY], undefined, 'successful recovered enrollment must clear hold');
}

// Unknown/credential terminal failures remain fail-fast and do not even health-probe.
{
  const lab = makeContext({ hold: oldHold('SUPERVISOR_BOOTSTRAP_SCOPE_REQUIRED', { status: 403 }) });
  await assert.rejects(call(lab.context), (e) => e?.a2ExecutionClass === 'BLOCKED' && /terminal_hold/.test(String(e.message)));
  assert.deepEqual(lab.stats(), { enrollCalls: 0, healthCalls: 0, signedWireCalls: 0, secretLeak: false });
}

// Capability absent -> hold remains terminal, no enrollment retry.
{
  const lab = makeContext({ hold: oldHold('EMBEDDED_BOOTSTRAP_ROTATION_FAILED'), healthSupported: false });
  await assert.rejects(call(lab.context), (e) => e?.a2ExecutionClass === 'BLOCKED');
  assert.deepEqual(lab.stats(), { enrollCalls: 0, healthCalls: 1, signedWireCalls: 0, secretLeak: false });
  assert.equal(lab.session.data[HOLD_KEY].reconcile_attempts || 0, 0);
  assert.match(String(lab.session.data[HOLD_KEY].last_reconcile_result), /CAPABILITY_ABSENT/);
}

// A capability-confirmed terminal reconciliation is single-shot for one pairing epoch.
{
  const lab = makeContext({ hold: oldHold('EMBEDDED_BOOTSTRAP_ROTATION_FAILED', { reconcile_attempts: 1, reconcile_after: null }) });
  await assert.rejects(call(lab.context), (e) => e?.a2ExecutionClass === 'BLOCKED');
  assert.deepEqual(lab.stats(), { enrollCalls: 0, healthCalls: 0, signedWireCalls: 0, secretLeak: false });
}

// Concurrent callers share both the capability reconciliation and the enrollment promise.
{
  const lab = makeContext({ hold: oldHold('EMBEDDED_BOOTSTRAP_ROTATION_FAILED'), healthDelay: 20 });
  const [a, b] = await Promise.all([call(lab.context), call(lab.context)]);
  assert.equal(a.status, 202); assert.equal(b.status, 202);
  const stats = lab.stats();
  assert.equal(stats.healthCalls, 1, 'concurrent reconciliation must be single-flight');
  assert.equal(stats.enrollCalls, 1, 'concurrent enrollment must be single-flight');
  assert.equal(stats.signedWireCalls, 2, 'each original signed request may proceed after shared enrollment');
  assert.equal(stats.secretLeak, false);
}

for (const required of [
  'KNOWN_TERMINAL_SERVER_CAPABILITY_ONCE',
  'RECOVERABLE_TERMINAL_REASONS',
  'EMBEDDED_BOOTSTRAP_ROTATION_FAILED',
  'enrollment_recovery_after_rotation',
  'TERMINAL_RECONCILE_LIMIT = 1',
  'credentials: "omit"'
]) assert.ok(source.includes(required), `missing reconciliation contract: ${required}`);

console.log('A2 v0.6.8 supervisor capability-confirmed reconciliation: PASS');
