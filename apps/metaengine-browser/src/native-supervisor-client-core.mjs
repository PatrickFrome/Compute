import {
  NativeSupervisorClient as UnwiredNativeSupervisorClient,
  NATIVE_SUPERVISOR_BASE,
  NATIVE_SUPERVISOR_RUNTIME_PATH,
  sendBootstrapHeartbeat as sendBootstrapHeartbeatBase,
} from './native-supervisor-client-core-base.mjs';
import { createNativeGuardianDeveloperEmergencyUpdateController } from './developer-emergency-update-native-controller.mjs';

export * from './native-supervisor-client-core-base.mjs';

const DEV_RELEASE_VERSION = /^\d+\.\d+\.\d+-dev\.\d+\.1$/;

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function nativeEmergencyIdentityCapable(identity) {
  return identity
    && typeof identity.guardianOwnerChallenge === 'function'
    && typeof identity.guardianUpdateActuatorProof === 'function';
}

export function createHeartbeatCoherentFetch({ identity, fetchImpl } = {}) {
  if (!identity || typeof identity.deviceHeaders !== 'function') throw new Error('native_supervisor_heartbeat_identity_required');
  if (typeof fetchImpl !== 'function') throw new Error('native_supervisor_heartbeat_fetch_required');
  const stateUrl = `${NATIVE_SUPERVISOR_BASE}/v1/state`;
  const heartbeatUrl = `${NATIVE_SUPERVISOR_BASE}/v1/heartbeat`;

  return async (url, init = {}) => {
    if (String(url) !== stateUrl || String(init?.method || 'GET').toUpperCase() !== 'POST') {
      return fetchImpl(url, init);
    }

    let payload = null;
    try { payload = JSON.parse(String(init?.body || '')); } catch {}
    const phase = payload?.state?.watchdog_heartbeat === true
      ? 'WATCHDOG'
      : (payload?.state?.bootstrap_heartbeat === true ? 'BOOTSTRAP' : null);
    if (!phase) return fetchImpl(url, init);

    const heartbeatBody = JSON.stringify({ phase, authority_effect: false });
    const requestPath = `${NATIVE_SUPERVISOR_RUNTIME_PATH}/v1/heartbeat`;
    const headers = await identity.deviceHeaders('POST', requestPath, heartbeatBody);
    return fetchImpl(heartbeatUrl, {
      ...init,
      method: 'POST',
      headers,
      body: heartbeatBody,
      cache: 'no-store',
    });
  };
}

export async function sendBootstrapHeartbeat(options = {}) {
  const identity = options.identity;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!identity || typeof identity.ensure !== 'function' || typeof identity.deviceHeaders !== 'function') {
    throw new Error('native_supervisor_identity_required');
  }
  if (typeof fetchImpl !== 'function') throw new Error('native_supervisor_fetch_required');
  if (typeof options.getState !== 'function') throw new Error('native_supervisor_state_provider_required');
  return sendBootstrapHeartbeatBase({
    ...options,
    fetchImpl: createHeartbeatCoherentFetch({ identity, fetchImpl }),
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
 * leaving full semantic state publication on /v1/state. This is transport-only and
 * does not add command leasing, scheduling, or mutation authority.
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

    const coherentFetch = identity
      && typeof identity.deviceHeaders === 'function'
      && typeof sourceFetch === 'function'
      ? createHeartbeatCoherentFetch({ identity, fetchImpl: sourceFetch })
      : sourceFetch;

    super({
      ...options,
      fetchImpl: coherentFetch,
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
