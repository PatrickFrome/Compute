import { createHash } from 'node:crypto';
import { recordAcceptedSignedSupervisorHeartbeat } from './self-update-successor-qualification.mjs';

export const NATIVE_SUPERVISOR_HOST = 'xpeibufgzjknrhbhpffp.supabase.co';
export const NATIVE_SUPERVISOR_STATE_PATH = '/functions/v1/a2-browser-native-supervisor-v1/v1/state';
export const NATIVE_SUPERVISOR_DEVICE_PROFILE = 'A2_DEVICE_HTTP_SIGNATURE_V1';

function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return typeof input?.url === 'string' ? input.url : '';
}

function headerBag(input, init = {}) {
  try { return new Headers(init?.headers ?? input?.headers ?? {}); }
  catch { return new Headers(); }
}

function bodySha256(body) {
  return createHash('sha256').update(String(body || '')).digest('hex');
}

function parsePayload(body) {
  if (typeof body !== 'string' || body.length === 0 || body.length > 2_000_000) return null;
  try {
    const value = JSON.parse(body);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function inspectSignedNativeSupervisorStateRequest(input, init = {}) {
  const method = String(init?.method || input?.method || 'GET').toUpperCase();
  if (method !== 'POST') return Object.freeze({ valid: false, reason: 'method_mismatch' });
  let url;
  try { url = new URL(requestUrl(input)); }
  catch { return Object.freeze({ valid: false, reason: 'url_invalid' }); }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== NATIVE_SUPERVISOR_HOST || url.pathname !== NATIVE_SUPERVISOR_STATE_PATH) {
    return Object.freeze({ valid: false, reason: 'endpoint_mismatch' });
  }

  const body = typeof init?.body === 'string' ? init.body : null;
  if (!body) return Object.freeze({ valid: false, reason: 'body_missing' });
  const headers = headerBag(input, init);
  const profile = String(headers.get('x-a2-device-profile') || '');
  const deviceId = String(headers.get('x-a2-device-id') || '');
  const clientId = String(headers.get('x-a2-chat-bridge-client') || '');
  const timestamp = String(headers.get('x-a2-device-timestamp') || '');
  const nonce = String(headers.get('x-a2-device-nonce') || '');
  const declaredHash = String(headers.get('x-a2-device-body-sha256') || '').toLowerCase();
  const signature = String(headers.get('x-a2-device-signature') || '');

  if (profile !== NATIVE_SUPERVISOR_DEVICE_PROFILE) return Object.freeze({ valid: false, reason: 'device_profile_mismatch' });
  if (!/^[0-9a-f-]{36}$/i.test(deviceId) || !/^[0-9a-f-]{36}$/i.test(clientId)) return Object.freeze({ valid: false, reason: 'device_binding_invalid' });
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return Object.freeze({ valid: false, reason: 'timestamp_invalid' });
  if (!/^[A-Za-z0-9_-]{16,}$/.test(nonce)) return Object.freeze({ valid: false, reason: 'nonce_invalid' });
  if (!/^[0-9a-f]{64}$/.test(declaredHash) || declaredHash !== bodySha256(body)) return Object.freeze({ valid: false, reason: 'body_hash_mismatch' });
  if (!/^[A-Za-z0-9_-]{40,}$/.test(signature)) return Object.freeze({ valid: false, reason: 'signature_missing' });
  const payload = parsePayload(body);
  if (!payload) return Object.freeze({ valid: false, reason: 'payload_invalid' });

  return Object.freeze({
    valid: true,
    reason: 'signed_request_shape_valid',
    payload,
    device_id: deviceId,
    client_id: clientId,
    body_sha256: declaredHash,
  });
}

export function installSignedSupervisorHeartbeatQualificationHook({ app, fetchImpl = globalThis.fetch } = {}) {
  if (!app || typeof app.getVersion !== 'function') throw new Error('self_update_signed_heartbeat_app_invalid');
  if (typeof fetchImpl !== 'function') throw new Error('self_update_signed_heartbeat_fetch_invalid');
  if (fetchImpl.__metaengineSignedHeartbeatQualificationHook === true) return fetchImpl;

  const wrapped = async (input, init = {}) => {
    const signed = inspectSignedNativeSupervisorStateRequest(input, init);
    const response = await fetchImpl(input, init);
    if (signed.valid && response?.status === 202) {
      await recordAcceptedSignedSupervisorHeartbeat({
        app,
        state: signed.payload?.state,
        acceptedAtMs: Date.now(),
      }).catch(() => {});
    }
    return response;
  };
  Object.defineProperty(wrapped, '__metaengineSignedHeartbeatQualificationHook', { value: true });
  return wrapped;
}
