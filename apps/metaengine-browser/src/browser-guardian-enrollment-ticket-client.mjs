import crypto from 'node:crypto';

import {
  nativeSupervisorRuntimeUrl,
  nativeSupervisorSigningPath,
} from './native-supervisor-endpoints.mjs';

export const BROWSER_GUARDIAN_ENROLLMENT_TICKET_SCHEMA = 'metaengine.guardian-enrollment-ticket-issue.v1';
export const BROWSER_GUARDIAN_ENROLLMENT_TICKET_PATH = '/v1/device/guardian-enrollment/ticket';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const TICKET = /^[A-Za-z0-9_-]{43}$/;
const MAX_RESPONSE_BYTES = 16 * 1024;

async function readBoundedJson(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('guardian_enrollment_ticket_response_body_missing');
  const chunks = [];
  let bytes = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error('guardian_enrollment_ticket_response_too_large');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    // Cancels oversized/incomplete streams as well as releasing the lock.
    await reader.cancel().catch(() => {});
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export async function requestBrowserGuardianEnrollmentTicket({
  identity,
  fetchImpl = globalThis.fetch,
  nowMs = Date.now(),
  timeoutMs = 8_000,
} = {}) {
  if (!identity || typeof identity.ensure !== 'function' || typeof identity.deviceHeaders !== 'function') {
    throw new Error('guardian_enrollment_ticket_identity_required');
  }
  if (typeof fetchImpl !== 'function') throw new Error('guardian_enrollment_ticket_fetch_required');

  const snapshot = await identity.ensure();
  if (!snapshot?.device_id) throw new Error('guardian_enrollment_ticket_device_not_enrolled');
  const bodyText = '{}';
  const signingPath = nativeSupervisorSigningPath(BROWSER_GUARDIAN_ENROLLMENT_TICKET_PATH);
  const headers = await identity.deviceHeaders('POST', signingPath, bodyText);
  const controller = new AbortController();
  const started = performance.now();
  const boundedTimeout = Math.min(8_000, Math.max(1, Number(timeoutMs) || 8_000));
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('guardian_enrollment_ticket_deadline'));
    }, boundedTimeout);
  });
  let response;
  let body;
  try {
    const exchange = (async () => {
      response = await fetchImpl(nativeSupervisorRuntimeUrl(BROWSER_GUARDIAN_ENROLLMENT_TICKET_PATH), {
        method: 'POST', headers, body: bodyText, cache: 'no-store',
        redirect: 'error', signal: controller.signal,
      });
      return readBoundedJson(response, controller.signal);
    })();
    body = await Promise.race([exchange, deadline]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  if (response.status !== 200 || body?.accepted !== true) {
    throw new Error(`guardian_enrollment_ticket_http_${response.status}:${String(body?.reason || body?.error || 'unknown').slice(0,160)}`);
  }

  const ticket = String(body.ticket || '');
  const ticketSha256 = String(body.ticket_sha256 || '').toLowerCase();
  const deviceId = String(body.device_id || '').toLowerCase();
  const clientId = String(body.client_id || '');
  const fingerprint = String(body.key_fingerprint_sha256 || '').toLowerCase();
  const adminEpoch = Number(body.admin_grant_epoch);
  const expiresAtMs = Date.parse(String(body.expires_at || ''));
  if (body.schema !== BROWSER_GUARDIAN_ENROLLMENT_TICKET_SCHEMA
      || !TICKET.test(ticket)
      || !SHA256.test(ticketSha256)
      || ticketSha256 !== sha256(ticket)
      || !UUID.test(deviceId)
      || deviceId !== String(snapshot.device_id || '').toLowerCase()
      || clientId !== String(snapshot.client_id || '')
      || fingerprint !== String(snapshot.key_fingerprint_sha256 || '').toLowerCase()
      || !Number.isSafeInteger(adminEpoch)
      || adminEpoch < 1
      || !Number.isFinite(expiresAtMs)
      || expiresAtMs <= nowMs + (performance.now() - started)
      || expiresAtMs > nowMs + 130_000
      || body.single_use !== true
      || body.plaintext_persisted !== false
      || body.ticket_persisted_server_side !== false
      || body.owner_sid_must_come_from_impersonated_pipe_token !== true
      || body.authority_effect !== false) {
    throw new Error('guardian_enrollment_ticket_response_invalid');
  }

  return freeze({
    schema: BROWSER_GUARDIAN_ENROLLMENT_TICKET_SCHEMA,
    ticket,
    ticket_sha256: ticketSha256,
    device_id: deviceId,
    client_id: clientId,
    key_fingerprint_sha256: fingerprint,
    admin_grant_epoch: adminEpoch,
    expires_at: new Date(expiresAtMs).toISOString(),
    single_use: true,
    persisted_locally: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function browserGuardianEnrollmentTicketClientContract() {
  return freeze({
    schema: 'metaengine.browser-guardian.enrollment-ticket-client.v1',
    authenticated_admin_device_route: true,
    ticket_bits: 256,
    ticket_single_use: true,
    overall_https_deadline_ms: 8_000,
    response_byte_limit: MAX_RESPONSE_BYTES,
    redirects_allowed: false,
    ticket_persisted_locally: false,
    server_persists_digest_only: true,
    owner_sid_from_server_allowed: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
