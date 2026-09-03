import { probeNativeSupervisorRuntimeCapabilities } from './runtime-capabilities.mjs';

function zero(state, reason, capabilities = null) {
  return Object.freeze({
    schema: 'metaengine.native-browser-supervisor.capability-health.v1',
    state,
    reason,
    capabilities,
    readiness_eligible: capabilities != null,
    physical_dispatch_allowed: false,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
  });
}

/**
 * Health remains a liveness surface. Runtime capabilities become visible only
 * after the service-role DB RPC exactly attests the source declaration.
 * Missing/drifted attestation therefore degrades readiness, never liveness and
 * never grants fallback authority from source constants alone.
 */
export async function projectNativeSupervisorRuntimeCapabilityHealth({ rpc } = {}) {
  if (typeof rpc !== 'function') return zero('UNATTESTED', 'CAPABILITY_RPC_UNAVAILABLE');
  try {
    const capabilities = await probeNativeSupervisorRuntimeCapabilities({ rpc });
    return zero('ATTESTED', 'EXACT_DB_SOURCE_MATCH', capabilities);
  } catch (error) {
    const message = String(error?.message || error);
    const reason = /404|PGRST202|Could not find the function|runtime_capability_attestation_invalid/i.test(message)
      ? 'RUNTIME_NOT_DEPLOYED'
      : 'DB_SOURCE_ATTESTATION_FAILED';
    return zero('UNATTESTED', reason);
  }
}
