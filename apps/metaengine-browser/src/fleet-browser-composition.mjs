import { FleetProvisioner } from './fleet-provisioner.mjs';
import { createFleetBrowserMainTransport } from './fleet-browser-main-transport.mjs';
import { dispatchFleetTask } from './fleet-task-dispatcher.mjs';

export const FLEET_BROWSER_COMPOSITION_VERSION = '1.1.0';

export function createFleetBrowserComposition({
  createTab,
  loadTab,
  tabExists,
  loadState,
  saveState,
  lookupView,
  selectTab,
  getSelectedTabId,
  captureSemanticFrame,
  executeSemanticCommand,
  publishSnapshot = async () => {},
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

  const dispatchTask = async (payload = {}) => dispatchFleetTask({
    payload,
    fleet,
    getView: lookupView,
    selectTab,
    getSelectedTabId,
    captureSemanticFrame,
    executeSemanticCommand,
    publishSnapshot,
  });

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
    promoteAgentFromLiveBrowser: ({ agent_id } = {}) => transport.promoteAgentFromLiveBrowser({ agent_id }),
    dispatchTask,
    dispatch_surface: 'TYPED_EXACT_BOUND_TASK_ONLY',
    raw_dispatcher_exposed: false,
    raw_transport_promotion_exposed: false,
    proof_input_surface_exposed: false,
    renderer_input_authority: false,
    worker_browser_authority: false,
    authority_effect: false,
  });
}
