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

function classifyFailure(error) {
  const message = String(error?.message || error);
  if (/404|PGRST202|Could not find the function|RUNTIME_NOT_DEPLOYED/i.test(message)) return 'RUNTIME_NOT_DEPLOYED';
  if (/AbortError|TimeoutError|timed?\s*out|deadline/i.test(message)) return 'ATTESTATION_TIMEOUT';
  if (/native_runtime_capability_attestation_(?:invalid|drift)/i.test(message)) return 'DB_SOURCE_ATTESTATION_FAILED';
  return 'DB_SOURCE_READ_FAILED';
}

/**
 * Pure readiness projection. The caller owns transport bounding; this function
 * never creates a timer, scheduler, retry loop, Browser effect or authority.
 * Source constants are not advertised unless the service-role DB RPC exactly
 * attests the same capability envelope.
 */
export async function projectNativeSupervisorRuntimeCapabilityHealth({ rpc } = {}) {
  if (typeof rpc !== 'function') return zero('UNATTESTED', 'CAPABILITY_RPC_UNAVAILABLE');
  try {
    const capabilities = await probeNativeSupervisorRuntimeCapabilities({ rpc });
    return zero('ATTESTED', 'EXACT_DB_SOURCE_MATCH', capabilities);
  } catch (error) {
    return zero('UNATTESTED', classifyFailure(error));
  }
}
