import assert from 'node:assert/strict';
import test from 'node:test';
import { createGuardianEnrollmentRedemptionForwarder } from '../../../coordination/client-v1/edge/guardian-enrollment-redemption-forwarder.mjs';

const body = { ticket: 'B'.repeat(43), key_fingerprint_sha256: 'a'.repeat(64), owner_sid_sha256: 'b'.repeat(64) };
const req = (patch = {}) => new Request('https://example.invalid/v1/guardian/enrollment/redeem', { method: 'POST', body: JSON.stringify({ ...body, ...patch }) });

test('redemption bridge has one exact destination and preserves raw bounded ticket bytes without credentials', async () => {
  let calls = 0;
  const forward = createGuardianEnrollmentRedemptionForwarder({ fetchImpl: async (url, init) => {
    calls += 1;
    assert.equal(url, 'https://jhriwwsryeqsvvvufkok.supabase.co/functions/v1/a2-browser-native-supervisor-v14-canary/v1/guardian/enrollment/redeem');
    assert.equal(new TextDecoder().decode(init.body), JSON.stringify(body));
    assert.equal(init.headers.authorization, undefined);
    assert.equal(init.headers['x-a2-chat-bridge-client'], undefined);
    assert.equal(init.redirect, 'error');
    return new Response('{"accepted":true}', { status: 200 });
  } });
  assert.equal((await forward(req(), '/v1/device/guardian-enrollment/ticket')), null);
  const result = await forward(req(), '/v1/guardian/enrollment/redeem');
  assert.equal(result.status, 200);
  assert.equal(calls, 1);
});

test('invalid, oversized and caller URL/path fields never reach upstream', async () => {
  let calls = 0;
  const forward = createGuardianEnrollmentRedemptionForwarder({ fetchImpl: async () => { calls += 1; throw new Error('not_allowed'); } });
  for (const patch of [{ ticket: '' }, { url: 'https://example.invalid' }, { ticket: 'B'.repeat(2000) }]) {
    assert.equal((await forward(req(patch), '/v1/guardian/enrollment/redeem')).status, 400);
  }
  assert.equal(calls, 0);
});

test('uncertain upstream response stays 503 with one attempt and no legacy fallback', async () => {
  let calls = 0;
  const forward = createGuardianEnrollmentRedemptionForwarder({ timeoutMs: 20, fetchImpl: async () => {
    calls += 1; return new Promise(() => {});
  } });
  const result = await forward(req(), '/v1/guardian/enrollment/redeem');
  assert.equal(result.status, 503);
  assert.equal(calls, 1);
});

test('upstream body limit and stream deadline stay active after HTTP headers arrive', async () => {
  for (const responseBody of ['x'.repeat(16 * 1024 + 1), new ReadableStream({ start() {} })]) {
    let calls = 0;
    const forward = createGuardianEnrollmentRedemptionForwarder({ timeoutMs: 20, fetchImpl: async () => {
      calls += 1; return new Response(responseBody);
    } });
    assert.equal((await forward(req(), '/v1/guardian/enrollment/redeem')).status, 503);
    assert.equal(calls, 1);
  }
});
