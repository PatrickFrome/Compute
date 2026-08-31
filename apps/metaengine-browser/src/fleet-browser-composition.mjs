import { FleetProvisioner } from './fleet-provisioner.mjs';
import { createFleetBrowserMainTransport } from './fleet-browser-main-transport.mjs';
import { createFleetSupervisorPromotionGate } from './fleet-supervisor-promotion-gate.mjs';

export const FLEET_BROWSER_COMPOSITION_VERSION = '1.1.0';

export function createFleetBrowserComposition({
  createTab,
  loadTab,
  tabExists,
  loadState,
  saveState,
  lookupView,
  verifyActuationLease,
  policy,
  clock,
  uuid,
} = {}) {
  const fleet = new FleetProvisioner({
    createTab,
    loadTab,
    tabExists,
    loadState,
    saveState,
    policy,
    clock,
    uuid,
  });
  const transport = createFleetBrowserMainTransport({ fleet, lookupView });
  const supervisorPromotion = typeof verifyActuationLease === 'function'
    ? createFleetSupervisorPromotionGate({
      verifyActuationLease,
      promoteAgentFromLiveBrowser: ({ agent_id }) => transport.promoteAgentFromLiveBrowser({ agent_id }),
    })
    : null;

  return Object.freeze({
    schema: 'metaengine.browser.fleet-composition.v1',
    version: FLEET_BROWSER_COMPOSITION_VERSION,
    init: () => fleet.init(),
    snapshot: () => fleet.snapshot(),
    reconcile: (input = {}) => fleet.reconcile(input),
    setProfile: (profile) => fleet.setProfile(profile),
    revalidateTargetBinding: (input = {}) => fleet.revalidateTargetBinding(input),
    onTabClosed: (tabId, reason) => fleet.onTabClosed(tabId, reason),
    retire: (agentId) => fleet.retire(agentId),
    promoteAgentFromSupervisor: async ({ agent_id, lease_id } = {}) => {
      if (!supervisorPromotion) throw new Error('fleet_supervisor_lease_verifier_unavailable');
      return supervisorPromotion.promote({ agent_id, lease_id });
    },
    raw_transport_promotion_exposed: false,
    live_browser_promotion_exposed: false,
    proof_input_surface_exposed: false,
    renderer_input_authority: false,
    worker_browser_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
