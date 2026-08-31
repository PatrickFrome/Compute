import { createFleetBrowserRuntimeTransport } from './fleet-browser-runtime-transport.mjs';

export const FLEET_BROWSER_MAIN_TRANSPORT_VERSION = '1.0.0';

export function createFleetBrowserMainTransport({ fleet, lookupView } = {}) {
  if (!fleet || typeof fleet.snapshot !== 'function') {
    throw new Error('fleet_main_transport_fleet_invalid');
  }
  if (typeof lookupView !== 'function') throw new Error('fleet_main_transport_lookup_invalid');

  const runtime = createFleetBrowserRuntimeTransport({
    provisioner: fleet,
    lookupView,
  });

  const promoteAgentFromLiveBrowser = async ({ agent_id } = {}) => {
    const id = String(agent_id || '').trim();
    if (!id) throw new Error('fleet_main_transport_agent_id_required');
    return runtime.promoteAgentFromLiveLocalTransport({ agent_id: id });
  };

  return Object.freeze({
    schema: 'metaengine.browser.fleet-main-transport.v1',
    version: FLEET_BROWSER_MAIN_TRANSPORT_VERSION,
    promoteAgentFromLiveBrowser,
    authority_source: 'METAENGINE_BROWSER_MAIN_PROCESS',
    renderer_input_authority: false,
    worker_browser_authority: false,
    raw_transport_promotion_exposed: false,
    proof_input_surface_exposed: false,
  });
}
