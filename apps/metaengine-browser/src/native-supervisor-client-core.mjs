import {
  NativeSupervisorClient as UnwiredNativeSupervisorClient,
  NATIVE_SUPERVISOR_RUNTIME_PATH,
  sendBootstrapHeartbeat as sendBootstrapHeartbeatBase,
} from './native-supervisor-client-core-base.mjs';
import { createNativeGuardianDeveloperEmergencyUpdateController } from './developer-emergency-update-native-controller.mjs';

export * from './native-supervisor-client-core-base.mjs';

const DEV_RELEASE_VERSION = /^\d+\.\d+\.\d+-dev\.\d+\.1$/;
const STATE_ROUTE_SUFFIX = '/v1/state';
const HEARTBEAT_ROUTE_SUFFIX = '/v1/heartbeat';
const BATCH_WAIT_ROUTE_SUFFIX = '/v1/commands/wait-batch';
const SINGLE_NEXT_ROUTE_SUFFIX = '/v1/commands/next';
const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);
const DEFAULT_BATCH_WAIT_MS = 4000;
const DEFAULT_REQUEST_DEADLINE_MS = 8000;
const REQUEST_DEADLINE_MARGIN_MS = 5000;

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function nativeSupervisorRequestDeadlineMs(options = {}) {
  const batchWaitMs = Math.max(250, Math.min(15000, Number(options.commandBatchWaitMs) || DEFAULT_BATCH_WAIT_MS));
  const requested = Number(options.requestDeadlineMs);
  const requestedDeadlineMs = Number.isFinite(requested)
    ? Math.max(1000, Math.min(30000, requested))
    : DEFAULT_REQUEST_DEADLINE_MS;
  return Math.min(30000, Math.max(requestedDeadlineMs, batchWaitMs + REQUEST_DEADLINE_MARGIN_MS));
}

function nativeEmergencyIdentityCapable(identity) {
  return identity
    && typeof identity.guardianOwnerChallenge === 'function'
    && typeof identity.guardianUpdateActuatorProof === 'function';
}

export function nativeSupervisorHeartbeatPayload(bodyText) {
  if (typeof bodyText !== 'string' || bodyText.length === 0) return false;
  try {
    const body = JSON.parse(bodyText);
    return body?.state?.bootstrap_heartbeat === true || body?.state?.watchdog_heartbeat === true;
  } catch {
    return false;
  }
}

export function nativeSupervisorHeartbeatTarget(target, bodyText) {
  const value = String(target || '');
  if (!nativeSupervisorHeartbeatPayload(bodyText) || !value.endsWith(STATE_ROUTE_SUFFIX)) return value;
  return `${value.slice(0, -STATE_ROUTE_SUFFIX.length)}${HEARTBEAT_ROUTE_SUFFIX}`;
}

async function transientStateHeartbeatFallback({ response, target, init, identity, rawFetch, enabled }) {
  if (enabled !== true
    || !response
    || !TRANSIENT_HTTP_STATUSES.has(response.status)
    || typeof rawFetch !== 'function'
    || !identity
    || typeof identity.deviceHeaders !== 'function') return response;

  const requestTarget = String(target || '');
  if (!requestTarget.endsWith(STATE_ROUTE_SUFFIX)) return response;
  if (String(init?.method || 'GET').toUpperCase() !== 'POST') return response;

  const bodyText = String(init?.body || '');
  try { JSON.parse(bodyText); } catch { return response; }

  const fallbackPath = `${NATIVE_SUPERVISOR_RUNTIME_PATH}${HEARTBEAT_ROUTE_SUFFIX}`;
  const fallbackTarget = `${requestTarget.slice(0, -STATE_ROUTE_SUFFIX.length)}${HEARTBEAT_ROUTE_SUFFIX}`;
  try {
    const fallbackHeaders = await identity.deviceHeaders('POST', fallbackPath, bodyText);
    const fallbackResponse = await rawFetch(fallbackTarget, {
      ...init,
      method: 'POST',
      headers: fallbackHeaders,
      body: bodyText,
    });
    if (fallbackResponse?.status !== 202) return response;
    const fallbackPayload = await fallbackResponse.json().catch(() => null);
    if (!fallbackPayload || fallbackPayload.accepted !== true) return response;
    return new Response(JSON.stringify({
      ...fallbackPayload,
      transient_state_heartbeat_fallback: true,
      authority_effect: false,
    }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    return response;
  }
}

async function transientBatchGatewayFallback({ response, target, init, identity, rawFetch, enabled }) {
  if (enabled !== true
    || !response
    || !TRANSIENT_HTTP_STATUSES.has(response.status)
    || typeof rawFetch !== 'function'
    || !identity
    || typeof identity.deviceHeaders !== 'function') return response;

  const requestTarget = String(target || '');
  if (!requestTarget.endsWith(BATCH_WAIT_ROUTE_SUFFIX)) return response;
  if (String(init?.method || 'GET').toUpperCase() !== 'POST') return response;

  let batchPayload;
  try { batchPayload = JSON.parse(String(init?.body || '')); } catch { return response; }
  const supervisorMode = String(batchPayload?.supervisor_mode || '').trim();
  if (!supervisorMode) return response;

  const fallbackBodyText = JSON.stringify({ supervisor_mode: supervisorMode });
  const fallbackPath = `${NATIVE_SUPERVISOR_RUNTIME_PATH}${SINGLE_NEXT_ROUTE_SUFFIX}`;
  const fallbackTarget = `${requestTarget.slice(0, -BATCH_WAIT_ROUTE_SUFFIX.length)}${SINGLE_NEXT_ROUTE_SUFFIX}`;
  try {
    const fallbackHeaders = await identity.deviceHeaders('POST', fallbackPath, fallbackBodyText);
    const fallbackResponse = await rawFetch(fallbackTarget, {
      ...init,
      method: 'POST',
      headers: fallbackHeaders,
      body: fallbackBodyText,
    });
    if (!fallbackResponse?.ok) return response;
    const fallbackPayload = await fallbackResponse.json().catch(() => null);
    if (!fallbackPayload || !hasOwn(fallbackPayload, 'command')) return response;
    return new Response(JSON.stringify({
      commands: fallbackPayload.command ? [fallbackPayload.command] : [],
      transport_delivery_is_authority: false,
      transient_batch_gateway_fallback: true,
      authority_effect: false,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    return response;
  }
}

export function createNativeSupervisorHeartbeatTransport({
  identity,
  fetchImpl,
  transientStateHeartbeatFallback: stateFallbackEnabled = true,
  transientBatchGatewayFallback: batchGatewayFallbackEnabled = true,
} = {}) {
  const rawFetch = fetchImpl ?? globalThis.fetch;
  const transportIdentity = identity && typeof identity.deviceHeaders === 'function'
    ? new Proxy(identity, {
      get(target, property) {
        if (property === 'deviceHeaders') {
          return async (method, path, bodyText) => target.deviceHeaders(
            method,
            nativeSupervisorHeartbeatTarget(path, bodyText),
            bodyText,
          );
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    })
    : identity;
  const transportFetch = typeof rawFetch === 'function'
    ? async (url, init = {}) => {
      const target = nativeSupervisorHeartbeatTarget(url, init?.body);
      const response = await rawFetch(target, init);
      const stateRecovered = await transientStateHeartbeatFallback({
        response,
        target,
        init,
        identity,
        rawFetch,
        enabled: stateFallbackEnabled !== false,
      });
      if (stateRecovered !== response) return stateRecovered;
      return transientBatchGatewayFallback({
        response,
        target,
        init,
        identity,
        rawFetch,
        enabled: batchGatewayFallbackEnabled !== false,
      });
    }
    : rawFetch;
  return Object.freeze({ identity: transportIdentity, fetchImpl: transportFetch });
}

// Keep the proven core helper byte-stable while making the public standalone producer
// obey the same bounded-heartbeat transport contract as the production client class.
// This prevents tests or bootstrap call sites from bypassing the atomic signing+URL rewrite.
export async function sendBootstrapHeartbeat(options = {}) {
  const heartbeatTransport = createNativeSupervisorHeartbeatTransport({
    identity: options.identity,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    transientStateHeartbeatFallback: false,
    transientBatchGatewayFallback: false,
  });
  return sendBootstrapHeartbeatBase({
    ...options,
    identity: heartbeatTransport.identity,
    fetchImpl: heartbeatTransport.fetchImpl,
  });
}

/**
 * Production wiring layer around the proven Native Supervisor core.
 *
 * Explicit developerEmergencyUpdate, including explicit null, always wins. When the
 * caller omits it, only a release-formatted Browser with the enrolled Guardian proof
 * surface gets the native emergency controller. Test/mock identities and non-release
 * versions stay fail-closed instead of accidentally acquiring physical update power.
 *
 * Bootstrap/watchdog liveness remains isolated from full state publication here as a
 * compatibility transport shim: the proven core can keep constructing its bounded
 * heartbeat projections while the signed path and HTTP target both move atomically
 * from /v1/state to /v1/heartbeat. Ordinary state snapshots stay on /v1/state.
 *
 * Transient gateway recovery is intentionally independent from the core's
 * legacySingleLeaseFallback option. Production requires batch transport in steady
 * state, but a 502/503/504 from the wait proxy may recover one cycle through the
 * already authenticated single-lease endpoint. The core never marks batch transport
 * unavailable, so the next cycle probes wait-batch again. HTTP 500 and other failures
 * remain visible.
 *
 * The request deadline is also coupled to the configured held batch wait. A client
 * must never abort its own authoritative long poll before the server's bounded wait
 * can complete; the invariant is batchWait + 5s margin, capped by the core's 30s
 * transport ceiling.
 */
export class NativeSupervisorClient extends UnwiredNativeSupervisorClient {
  constructor(options = {}) {
    const explicit = hasOwn(options, 'developerEmergencyUpdate');
    const version = String(options.version || '');
    const identity = options.identity;
    let developerEmergencyUpdate = explicit ? options.developerEmergencyUpdate : null;

    if (!explicit && DEV_RELEASE_VERSION.test(version) && nativeEmergencyIdentityCapable(identity)) {
      developerEmergencyUpdate = createNativeGuardianDeveloperEmergencyUpdateController({
        identity,
        currentVersion: version,
        fetchImpl: options.fetchImpl ?? globalThis.fetch,
      });
    }

    const heartbeatTransport = createNativeSupervisorHeartbeatTransport({
      identity,
      fetchImpl: options.fetchImpl ?? globalThis.fetch,
      transientStateHeartbeatFallback: options.transientStateHeartbeatFallback !== false,
      transientBatchGatewayFallback: options.transientBatchGatewayFallback !== false,
    });

    super({
      ...options,
      requestDeadlineMs: nativeSupervisorRequestDeadlineMs(options),
      identity: heartbeatTransport.identity,
      fetchImpl: heartbeatTransport.fetchImpl,
      developerEmergencyUpdate,
    });
  }
}

export function nativeSupervisorEmergencyProductionWiringContract() {
  return Object.freeze({
    schema: 'metaengine.native-supervisor.emergency-production-wiring.v1',
    explicit_handler_override_preserved: true,
    explicit_null_disables_auto_wiring: true,
    release_version_required_for_auto_wiring: true,
    enrolled_guardian_proof_surface_required: true,
    native_guardian_actuator_only: true,
    electron_updater_fallback_allowed: false,
    request_deadline_coupled_to_batch_wait: true,
    request_deadline_margin_ms: REQUEST_DEADLINE_MARGIN_MS,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}