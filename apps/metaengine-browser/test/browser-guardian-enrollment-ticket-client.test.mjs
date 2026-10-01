import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  BROWSER_GUARDIAN_ENROLLMENT_TICKET_PATH,
  browserGuardianEnrollmentTicketClientContract,
  requestBrowserGuardianEnrollmentTicket,
} from '../src/browser-guardian-enrollment-ticket-client.mjs';
import { NATIVE_SUPERVISOR_RUNTIME_PATH } from '../src/native-supervisor-endpoints.mjs';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID = 'client-guardian-ticket-test';
const FINGERPRINT = 'a'.repeat(64);
const TICKET = Buffer.alloc(32, 7).toString('base64url');
const TICKET_SHA = crypto.createHash('sha256').update(TICKET).digest('hex');

function identity() {
  return {
    async ensure() {
      return {
        device_id: DEVICE_ID,
        client_id: CLIENT_ID,
        key_fingerprint_sha256: FINGERPRINT,
      };
    },
    async deviceHeaders(method, path, bodyText) {
      assert.equal(method, 'POST');
      assert.equal(path, `${NATIVE_SUPERVISOR_RUNTIME_PATH}${BROWSER_GUARDIAN_ENROLLMENT_TICKET_PATH}`);
      assert.equal(bodyText, '{}');
      return {
        'content-type': 'application/json',
        'x-a2-device-id': DEVICE_ID,
        'x-a2-chat-bridge-client': CLIENT_ID,
      };
    },
  };
}

test('ticket client accepts only exact ADMIN-bound single-use response and keeps it memory-only', async () => {
  const nowMs = Date.parse('2026-10-01T03:30:00.000Z');
  let calls = 0;
  const result = await requestBrowserGuardianEnrollmentTicket({
    identity: identity(),
    nowMs,
    fetchImpl: async (url, init) => {
      calls += 1;
      assert.equal(new URL(url).pathname.endsWith(BROWSER_GUARDIAN_ENROLLMENT_TICKET_PATH), true);
      assert.equal(init.method, 'POST');
      assert.equal(init.cache, 'no-store');
      return new Response(JSON.stringify({
        schema: 'metaengine.guardian-enrollment-ticket-issue.v1',
        accepted: true,
        ticket: TICKET,
        ticket_sha256: TICKET_SHA,
        device_id: DEVICE_ID,
        client_id: CLIENT_ID,
        key_fingerprint_sha256: FINGERPRINT,
        admin_grant_epoch: 7,
        expires_at: new Date(nowMs + 90_000).toISOString(),
        single_use: true,
        plaintext_persisted: false,
        ticket_persisted_server_side: false,
        owner_sid_must_come_from_impersonated_pipe_token: true,
        authority_effect: false,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ticket, TICKET);
  assert.equal(result.ticket_sha256, TICKET_SHA);
  assert.equal(result.persisted_locally, false);
  assert.equal(result.automatic_retry_allowed, false);
});

test('ticket client rejects digest, device and lifetime drift', async () => {
  const nowMs = Date.parse('2026-10-01T03:30:00.000Z');
  for (const patch of [
    { ticket_sha256: 'b'.repeat(64) },
    { device_id: '22222222-2222-4222-8222-222222222222' },
    { expires_at: new Date(nowMs + 131_000).toISOString() },
    { single_use: false },
  ]) {
    await assert.rejects(
      () => requestBrowserGuardianEnrollmentTicket({
        identity: identity(),
        nowMs,
        fetchImpl: async () => new Response(JSON.stringify({
          schema: 'metaengine.guardian-enrollment-ticket-issue.v1',
          accepted: true,
          ticket: TICKET,
          ticket_sha256: TICKET_SHA,
          device_id: DEVICE_ID,
          client_id: CLIENT_ID,
          key_fingerprint_sha256: FINGERPRINT,
          admin_grant_epoch: 7,
          expires_at: new Date(nowMs + 90_000).toISOString(),
          single_use: true,
          plaintext_persisted: false,
          ticket_persisted_server_side: false,
          owner_sid_must_come_from_impersonated_pipe_token: true,
          authority_effect: false,
          ...patch,
        }), { status: 200, headers: { 'content-type': 'application/json' } }),
      }),
      /guardian_enrollment_ticket_response_invalid/,
    );
  }
});

test('ticket client contract grants no retry or SID authority', () => {
  const row = browserGuardianEnrollmentTicketClientContract();
  assert.equal(row.ticket_bits, 256);
  assert.equal(row.ticket_single_use, true);
  assert.equal(row.ticket_persisted_locally, false);
  assert.equal(row.server_persists_digest_only, true);
  assert.equal(row.owner_sid_from_server_allowed, false);
  assert.equal(row.automatic_retry_allowed, false);
  assert.equal(row.authority_effect, false);
});

test('stalled ticket exchange reaches a deadline, aborts and never retries', async () => {
  let calls = 0;
  let signal;
  await assert.rejects(requestBrowserGuardianEnrollmentTicket({
    identity: identity(), timeoutMs: 20,
    fetchImpl: async (_url, init) => {
      calls += 1;
      signal = init.signal;
      return new Promise(() => {});
    },
  }), /guardian_enrollment_ticket_deadline/);
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
});

test('response body has the same deadline and a bounded byte count', async () => {
  for (const body of [
    new ReadableStream({ start() {} }),
    'x'.repeat(16 * 1024 + 1),
  ]) {
    let calls = 0;
    await assert.rejects(requestBrowserGuardianEnrollmentTicket({
      identity: identity(), timeoutMs: 20,
      fetchImpl: async (_url, init) => {
        calls += 1;
        assert.equal(init.redirect, 'error');
        return new Response(body);
      },
    }), /guardian_enrollment_ticket_(deadline|response_too_large)/);
    assert.equal(calls, 1);
  }
});
