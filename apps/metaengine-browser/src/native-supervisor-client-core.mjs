import {
  NativeSupervisorClient as UnwiredNativeSupervisorClient,
  sendBootstrapHeartbeat as sendBootstrapHeartbeatBase,
} from './native-supervisor-client-core-base.mjs';
import { createNativeGuardianDeveloperEmergencyUpdateController } from './developer-emergency-update-native-controller.mjs';

export * from './native-supervisor-client-core-base.mjs';

const DEV_RELEASE_VERSION = /^\d+\.\d+\.\d+-dev\.\d+\.1$/;
const STATE_ROUTE_SUFFIX = '/v1/state';
const HEARTBEAT_ROUTE_SUFFIX = '/v1/heartbeat';

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
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

export function createNativeSupervisorHeartbeatTransport({ identity, fetchImpl } = {}) {
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
    ? (url, init = {}) => rawFetch(nativeSupervisorHeartbeatTarget(url, init?.body), init)
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
    });

    super({
      ...options,
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
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
