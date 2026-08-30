import { createHash } from 'node:crypto';
import {
  qualifyUpdatedSuccessor,
} from './self-update-handoff.mjs';
import {
  quarantineSelfUpdateTransaction,
  readSelfUpdateTransaction,
} from './self-update-transaction-journal.mjs';

export const NATIVE_SUPERVISOR_HOST = 'xpeibufgzjknrhbhpffp.supabase.co';
export const NATIVE_SUPERVISOR_STATE_PATH = '/functions/v1/a2-browser-native-supervisor-v1/v1/state';
export const NATIVE_SUPERVISOR_DEVICE_PROFILE = 'A2_DEVICE_HTTP_SIGNATURE_V1';

const HARD_CONTINUITY_FAILURES = new Set(['PARTIAL', 'ERROR', 'TARGET_VERSION_MISMATCH']);

function normalizeState(value) {
  return String(value || '').trim().toUpperCase();
}

function parseHeartbeatPayload(body) {
  if (typeof body !== 'string' || body.length === 0 || body.length > 2_000_000) return null;
  try {
    const row = JSON.parse(body);
    return row && typeof row === 'object' && !Array.isArray(row) ? row : null;
  } catch {
    return null;
  }
}

function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return typeof input?.url === 'string' ? input.url : '';
}

function headerBag(input, init = {}) {
  try {
    return new Headers(init?.headers ?? input?.headers ?? {});
  } catch {
    return new Headers();
  }
}

function bodySha256(body) {
  return createHash('sha256').update(String(body || '')).digest('hex');
}

export function inspectSignedNativeSupervisorStateRequest(input, init = {}) {
  const method = String(init?.method || input?.method || 'GET').toUpperCase();
  if (method !== 'POST') return Object.freeze({ valid: false, reason: 'method_mismatch', body: null });

  let url;
  try { url = new URL(requestUrl(input)); }
  catch { return Object.freeze({ valid: false, reason: 'url_invalid', body: null }); }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== NATIVE_SUPERVISOR_HOST || url.pathname !== NATIVE_SUPERVISOR_STATE_PATH) {
    return Object.freeze({ valid: false, reason: 'endpoint_mismatch', body: null });
  }

  const body = typeof init?.body === 'string' ? init.body : null;
  if (!body) return Object.freeze({ valid: false, reason: 'body_missing', body: null });
  const headers = headerBag(input, init);
  const profile = String(headers.get('x-a2-device-profile') || '');
  const deviceId = String(headers.get('x-a2-device-id') || '');
  const clientId = String(headers.get('x-a2-chat-bridge-client') || '');
  const timestamp = String(headers.get('x-a2-device-timestamp') || '');
  const nonce = String(headers.get('x-a2-device-nonce') || '');
  const declaredBodyHash = String(headers.get('x-a2-device-body-sha256') || '').toLowerCase();
  const signature = String(headers.get('x-a2-device-signature') || '');

  if (profile !== NATIVE_SUPERVISOR_DEVICE_PROFILE) return Object.freeze({ valid: false, reason: 'device_profile_mismatch', body: null });
  if (!/^[0-9a-f-]{36}$/i.test(deviceId) || !/^[0-9a-f-]{36}$/i.test(clientId)) {
    return Object.freeze({ valid: false, reason: 'device_binding_invalid', body: null });
  }
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return Object.freeze({ valid: false, reason: 'timestamp_invalid', body: null });
  if (!/^[A-Za-z0-9_-]{16,}$/.test(nonce)) return Object.freeze({ valid: false, reason: 'nonce_invalid', body: null });
  if (!/^[0-9a-f]{64}$/.test(declaredBodyHash) || declaredBodyHash !== bodySha256(body)) {
    return Object.freeze({ valid: false, reason: 'body_hash_mismatch', body: null });
  }
  if (!/^[A-Za-z0-9_-]{40,}$/.test(signature)) return Object.freeze({ valid: false, reason: 'signature_missing', body: null });

  return Object.freeze({
    valid: true,
    reason: 'signed_request_shape_valid',
    body,
    device_id: deviceId,
    client_id: clientId,
    body_sha256: declaredBodyHash,
  });
}

export function evaluateSuccessorHealth({
  appVersion,
  transaction,
  heartbeatPayload,
  responseStatus,
} = {}) {
  const version = String(appVersion || '');
  if (!transaction || normalizeState(transaction.state) !== 'SUCCESSOR_BOOTED') {
    return Object.freeze({ action: 'IGNORE', reason: 'no_successor_transaction', authority_effect: false });
  }
  if (!version || String(transaction.target_version || '') !== version) {
    return Object.freeze({ action: 'QUARANTINE', reason: 'successor_target_version_mismatch', authority_effect: false });
  }
  if (Number(responseStatus) !== 202) {
    return Object.freeze({ action: 'WAIT', reason: 'signed_heartbeat_not_accepted', authority_effect: false });
  }

  const state = heartbeatPayload?.state;
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return Object.freeze({ action: 'WAIT', reason: 'heartbeat_state_missing', authority_effect: false });
  }
  if (String(state.shell_version || '') !== version) {
    return Object.freeze({ action: 'QUARANTINE', reason: 'heartbeat_shell_version_mismatch', authority_effect: false });
  }

  const continuityState = normalizeState(state.self_update_session_continuity?.state);
  if (HARD_CONTINUITY_FAILURES.has(continuityState)) {
    return Object.freeze({ action: 'QUARANTINE', reason: `session_continuity_${continuityState.toLowerCase()}`, authority_effect: false });
  }
  if (continuityState !== 'RESTORED') {
    return Object.freeze({ action: 'WAIT', reason: `session_continuity_${continuityState.toLowerCase() || 'unknown'}`, authority_effect: false });
  }

  const updater = state.self_update;
  if (!updater || typeof updater !== 'object' || Array.isArray(updater)) {
    return Object.freeze({ action: 'WAIT', reason: 'self_update_snapshot_missing', authority_effect: false });
  }
  if (String(updater.current_version || '') !== version) {
    return Object.freeze({ action: 'WAIT', reason: 'self_update_version_not_bound', authority_effect: false });
  }
  if (updater.last_error != null && String(updater.last_error).trim() !== '') {
    return Object.freeze({ action: 'WAIT', reason: 'self_update_runtime_error', authority_effect: false });
  }
  if (['ERROR', 'FAILED'].includes(normalizeState(updater.state))) {
    return Object.freeze({ action: 'WAIT', reason: 'self_update_runtime_unhealthy', authority_effect: false });
  }

  const resilience = updater.host_resilience;
  if (normalizeState(resilience?.state) !== 'ACTIVE') {
    return Object.freeze({ action: 'WAIT', reason: 'host_resilience_not_active', authority_effect: false });
  }
  if (normalizeState(resilience?.sentinel?.lifecycle) !== 'ARMED') {
    return Object.freeze({ action: 'WAIT', reason: 'sentinel_not_armed', authority_effect: false });
  }

  return Object.freeze({
    action: 'QUALIFY',
    reason: 'signed_runtime_health_verified',
    authority_effect: false,
  });
}

export async function applySuccessorHealthEvidence({ app, heartbeatPayload, responseStatus }) {
  const transaction = await readSelfUpdateTransaction(app).catch(() => null);
  const decision = evaluateSuccessorHealth({
    appVersion: app.getVersion(),
    transaction,
    heartbeatPayload,
    responseStatus,
  });

  if (decision.action === 'QUALIFY') {
    await qualifyUpdatedSuccessor(app, {
      signed_heartbeat_accepted: true,
      session_continuity_restored: true,
      self_update_runtime_healthy: true,
      host_resilience_active: true,
      sentinel_armed: true,
      qualification_source: 'native_supervisor_state_202',
    });
  } else if (decision.action === 'QUARANTINE') {
    await quarantineSelfUpdateTransaction(app, decision.reason);
  }
  return decision;
}

export function installSelfUpdateHealthQualificationFetchHook({ app, fetchImpl = globalThis.fetch } = {}) {
  if (!app || typeof app.getVersion !== 'function' || typeof app.getPath !== 'function') {
    throw new Error('self_update_health_app_invalid');
  }
  if (typeof fetchImpl !== 'function') throw new Error('self_update_health_fetch_invalid');
  if (fetchImpl.__metaengineSelfUpdateHealthHook === true) return fetchImpl;

  const wrapped = async (input, init = {}) => {
    const signedRequest = inspectSignedNativeSupervisorStateRequest(input, init);
    const response = await fetchImpl(input, init);
    if (signedRequest.valid && response?.status === 202) {
      const heartbeatPayload = parseHeartbeatPayload(signedRequest.body);
      await applySuccessorHealthEvidence({
        app,
        heartbeatPayload,
        responseStatus: response.status,
      }).catch(() => {});
    }
    return response;
  };
  Object.defineProperty(wrapped, '__metaengineSelfUpdateHealthHook', { value: true });
  return wrapped;
}
