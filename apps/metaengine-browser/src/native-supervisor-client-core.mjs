import {
  NativeSupervisorClient as UnwiredNativeSupervisorClient,
  NATIVE_SUPERVISOR_BASE,
  NATIVE_SUPERVISOR_RUNTIME_PATH,
  sendBootstrapHeartbeat as sendBootstrapHeartbeatBase,
} from './native-supervisor-client-core-base.mjs';
import { createNativeGuardianDeveloperEmergencyUpdateController } from './developer-emergency-update-native-controller.mjs';

export * from './native-supervisor-client-core-base.mjs';

const DEV_RELEASE_VERSION = /^\d+\.\d+\.\d+-dev\.\d+\.1$/;
const STATE_PATH = `${NATIVE_SUPERVISOR_RUNTIME_PATH}/v1/state`;
const HEARTBEAT_PATH = `${NATIVE_SUPERVISOR_RUNTIME_PATH}/v1/heartbeat`;
const STATE_URL = `${NATIVE_SUPERVISOR_BASE}/v1/state`;
const HEARTBEAT_URL = `${NATIVE_SUPERVISOR_BASE}/v1/heartbeat`;

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function nativeEmergencyIdentityCapable(identity) {
  return identity
    && typeof identity.guardianOwnerChallenge === 'function'
    && typeof identity.guardianUpdateActuatorProof === 'function';
}

function heartbeatPhaseFromBody(bodyText) {
  let payload = null;
  try { payload = JSON.parse(String(bodyText || '')); } catch {}
  if (payload?.state?.watchdog_heartbeat === true) return 'WATCHDOG';
  if (payload?.state?.bootstrap_heartbeat === true) return 'BOOTSTRAP';
  return null;
}

function heartbeatProjection({ method, path = null, url = null, bodyText = '' } = {}) {
  if (String(method || 'GET').toUpperCase() !== 'POST') return null;
  if (path != null && String(path) !== STATE_PATH) return null;
  if (url != null && String(url) !== STATE_URL) return null;
  const phase = heartbeatPhaseFromBody(bodyText);
  if (!phase) return null;
  const canonicalBodyText = JSON.stringify({ phase, authority_effect: false });
  return Object.freeze({
    phase,
    path: HEARTBEAT_PATH,
    url: HEARTBEAT_URL,
    bodyText: canonicalBodyText,
    authority_effect: false,
  });
}

export function createHeartbeatCoherentIdentity(identity) {
  if (!identity || typeof identity.deviceHeaders !== 'function') throw new Error('native_supervisor_heartbeat_identity_required');
  return new Proxy(identity, {
    get(target, property) {
      if (property === 'deviceHeaders') {
        return async (method, path, bodyText) => {
          const projected = heartbeatProjection({ method, path, bodyText });
          if (projected) {
            return target.deviceHeaders.call(target, 'POST', projected.path, projected.bodyText);
          }
          return target.deviceHeaders.call(target, method, path, bodyText);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export function createHeartbeatCoherentFetch({ fetchImpl } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('native_supervisor_heartbeat_fetch_required');
  return async (url, init = {}) => {
    const projected = heartbeatProjection({
      method: init?.method,
      url,
      bodyText: init?.body,
    });
    if (!projected) return fetchImpl(url, init);
    return fetchImpl(projected.url, {
      ...init,
      method: 'POST',
      body: projected.bodyText,
      cache: 'no-store',
    });
  };
}

function heartbeatCoherentTransport({ identity, fetchImpl } = {}) {
  return Object.freeze({
    identity: createHeartbeatCoherentIdentity(identity),
    fetchImpl: createHeartbeatCoherentFetch({ fetchImpl }),
  });
}

export async function sendBootstrapHeartbeat(options = {}) {
  const identity = options.identity;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!identity || typeof identity.ensure !== 'function' || typeof identity.deviceHeaders !== 'function') {
    throw new Error('native_supervisor_identity_required');
  }
  if (typeof fetchImpl !== 'function') throw new Error('native_supervisor_fetch_required');
  if (typeof options.getState !== 'function') throw new Error('native_supervisor_state_provider_required');
  const coherent = heartbeatCoherentTransport({ identity, fetchImpl });
  return sendBootstrapHeartbeatBase({
    ...options,
    identity: coherent.identity,
    fetchImpl: coherent.fetchImpl,
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
 * The same layer canonicalizes bootstrap/watchdog liveness onto /v1/heartbeat while
 * leaving full semantic state publication on /v1/state. Identity signing and fetch
 * transport share the same projection so path/body signature material cannot drift.
 * This is transport-only and does not add command leasing, scheduling, or mutation
 * authority.
 */
export class NativeSupervisorClient extends UnwiredNativeSupervisorClient {
  constructor(options = {}) {
    const explicit = hasOwn(options, 'developerEmergencyUpdate');
    const version = String(options.version || '');
    const identity = options.identity;
    const sourceFetch = options.fetchImpl ?? globalThis.fetch;
    let developerEmergencyUpdate = explicit ? options.developerEmergencyUpdate : null;

    if (!explicit && DEV_RELEASE_VERSION.test(version) && nativeEmergencyIdentityCapable(identity)) {
      developerEmergencyUpdate = createNativeGuardianDeveloperEmergencyUpdateController({
        identity,
        currentVersion: version,
        fetchImpl: sourceFetch,
      });
    }

    const coherent = identity
      && typeof identity.deviceHeaders === 'function'
      && typeof sourceFetch === 'function'
      ? heartbeatCoherentTransport({ identity, fetchImpl: sourceFetch })
      : { identity, fetchImpl: sourceFetch };

    super({
      ...options,
      identity: coherent.identity,
      fetchImpl: coherent.fetchImpl,
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
