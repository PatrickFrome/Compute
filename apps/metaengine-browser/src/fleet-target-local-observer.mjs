import { revalidateFleetTargetBinding } from './fleet-target-revalidation.mjs';

export const FLEET_TARGET_LOCAL_OBSERVER_VERSION = '1.0.0';
export const FLEET_TARGET_LOCAL_SOURCE = 'METAENGINE_BROWSER_LOCAL_WEBCONTENTS';

const trustedObservers = new WeakSet();

export function createFleetTargetLocalObserver({ lookupView } = {}) {
  if (typeof lookupView !== 'function') throw new Error('fleet_local_observer_dependency_invalid');

  const observe = (tabId) => {
    const normalizedTabId = String(tabId || '');
    if (!normalizedTabId) throw new Error('fleet_local_observer_tab_missing');
    const view = lookupView(normalizedTabId);
    const webContents = view?.webContents;
    const live = Boolean(webContents) && typeof webContents.isDestroyed === 'function' && webContents.isDestroyed() === false;
    const webContentsId = live ? Number(webContents.id) : NaN;
    const targetId = Number.isSafeInteger(webContentsId) && webContentsId > 0 ? `webcontents:${webContentsId}` : null;
    return Object.freeze({
      schema: 'metaengine.browser.fleet-local-target-observation.v1',
      source: FLEET_TARGET_LOCAL_SOURCE,
      tab_id: normalizedTabId,
      target_id: targetId,
      tab_exists: live && Boolean(targetId),
      authority_effect: false,
    });
  };

  trustedObservers.add(observe);
  return observe;
}

export function revalidateFleetTargetFromLocalBrowser({ agent, observeLocalTarget } = {}) {
  if (!agent || typeof agent !== 'object') throw new Error('fleet_local_revalidation_agent_invalid');
  if (typeof observeLocalTarget !== 'function' || !trustedObservers.has(observeLocalTarget)) {
    throw new Error('fleet_local_revalidation_observer_untrusted');
  }

  const observation = observeLocalTarget(agent.tab_id);
  if (observation?.source !== FLEET_TARGET_LOCAL_SOURCE || observation?.authority_effect !== false) {
    throw new Error('fleet_local_revalidation_observation_invalid');
  }

  return revalidateFleetTargetBinding({
    lifecycle_state: agent.lifecycle_state,
    bound_tab_id: agent.tab_id,
    bound_target_id: agent.target_id,
    generation_epoch: agent.generation_epoch,
    observed_tab_id: observation.tab_id,
    observed_target_id: observation.target_id,
    tab_exists: observation.tab_exists,
  });
}
