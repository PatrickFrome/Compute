import { dispatchFleetTask } from './fleet-task-dispatcher.mjs';

export const FLEET_BROWSER_TASK_DISPATCH_VERSION = '1.0.0';

export function createFleetBrowserTaskDispatch({
  fleet,
  lookupView,
  selectTab,
  getSelectedTabId,
  captureSemanticFrame,
  executeSemanticCommand,
  publishSnapshot = async () => {},
} = {}) {
  if (!fleet || typeof fleet.snapshot !== 'function' || typeof fleet.markTransportProven !== 'function') {
    throw new Error('fleet_task_dispatch_fleet_invalid');
  }
  if (typeof lookupView !== 'function') throw new Error('fleet_task_dispatch_lookup_invalid');
  if (typeof selectTab !== 'function' || typeof getSelectedTabId !== 'function') {
    throw new Error('fleet_task_dispatch_selection_invalid');
  }
  if (typeof captureSemanticFrame !== 'function' || typeof executeSemanticCommand !== 'function') {
    throw new Error('fleet_task_dispatch_control_invalid');
  }

  const dispatchTrustedTask = async (payload) => dispatchFleetTask({
    payload,
    fleet,
    getView: lookupView,
    selectTab,
    getSelectedTabId,
    publishSnapshot,
    captureSemanticFrame,
    executeSemanticCommand,
  });

  return Object.freeze({
    schema: 'metaengine.browser.fleet-task-dispatch-composition.v1',
    version: FLEET_BROWSER_TASK_DISPATCH_VERSION,
    dispatchTrustedTask,
    authority_source: 'METAENGINE_BROWSER_MAIN_PROCESS',
    raw_fleet_exposed: false,
    raw_view_lookup_exposed: false,
    raw_selection_exposed: false,
    raw_semantic_control_exposed: false,
    renderer_input_authority: false,
    worker_browser_authority: false,
    page_data_authority: false,
    arbitrary_eval: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
