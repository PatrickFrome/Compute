export const FLEET_TRANSPORT_LOCAL_OBSERVER_VERSION = '1.0.0';
export const FLEET_TRANSPORT_LOCAL_SOURCE = 'METAENGINE_BROWSER_LOCAL_WEBCONTENTS';

const trustedObservers = new WeakSet();

function normalizeConversationUrl(value) {
  const url = new URL(String(value || '').trim());
  if (url.protocol !== 'https:' || !['chatgpt.com', 'www.chatgpt.com'].includes(url.hostname.toLowerCase())) {
    throw new Error('fleet_local_transport_origin_invalid');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (!/^\/c\/[a-z0-9-]+$/i.test(path)) throw new Error('fleet_local_transport_path_invalid');
  return `https://chatgpt.com${path.toLowerCase()}`;
}

export function createFleetTransportLocalObserver({ lookupView } = {}) {
  if (typeof lookupView !== 'function') throw new Error('fleet_local_transport_dependency_invalid');

  const observe = (tabId) => {
    const normalizedTabId = String(tabId || '');
    if (!normalizedTabId) throw new Error('fleet_local_transport_tab_missing');
    const view = lookupView(normalizedTabId);
    const webContents = view?.webContents;
    const live = Boolean(webContents)
      && typeof webContents.isDestroyed === 'function'
      && webContents.isDestroyed() === false;
    const webContentsId = live ? Number(webContents.id) : NaN;
    const targetId = Number.isSafeInteger(webContentsId) && webContentsId > 0 ? `webcontents:${webContentsId}` : null;
    const rawUrl = live && typeof webContents.getURL === 'function' ? String(webContents.getURL() || '') : '';
    const loadingMainFrame = live && typeof webContents.isLoadingMainFrame === 'function'
      ? webContents.isLoadingMainFrame() === true
      : true;

    return Object.freeze({
      schema: 'metaengine.browser.fleet-local-transport-observation.v1',
      source: FLEET_TRANSPORT_LOCAL_SOURCE,
      tab_id: normalizedTabId,
      target_id: targetId,
      conversation_url: rawUrl,
      tab_exists: live && Boolean(targetId),
      main_frame_loading: loadingMainFrame,
      authority_effect: false,
    });
  };

  trustedObservers.add(observe);
  return observe;
}

export function deriveFleetTransportProofInputFromLocalBrowser({ agent, observeLocalTransport } = {}) {
  if (!agent || typeof agent !== 'object') throw new Error('fleet_local_transport_agent_invalid');
  if (agent.lifecycle_state !== 'BOUND_UNVERIFIED') {
    throw new Error(`fleet_local_transport_state_invalid:${String(agent.lifecycle_state || '')}`);
  }
  if (typeof observeLocalTransport !== 'function' || !trustedObservers.has(observeLocalTransport)) {
    throw new Error('fleet_local_transport_observer_untrusted');
  }

  const observation = observeLocalTransport(agent.tab_id);
  if (observation?.source !== FLEET_TRANSPORT_LOCAL_SOURCE || observation?.authority_effect !== false) {
    throw new Error('fleet_local_transport_observation_invalid');
  }
  if (!observation.tab_exists) throw new Error('fleet_local_transport_tab_not_live');
  if (observation.main_frame_loading) throw new Error('fleet_local_transport_main_frame_loading');
  if (String(observation.tab_id || '') !== String(agent.tab_id || '')) {
    throw new Error('fleet_local_transport_tab_binding_mismatch');
  }
  if (String(observation.target_id || '').toLowerCase() !== String(agent.target_id || '').toLowerCase()) {
    throw new Error('fleet_local_transport_target_binding_mismatch');
  }
  const generationEpoch = Number(agent.generation_epoch);
  if (!Number.isSafeInteger(generationEpoch) || generationEpoch < 1) {
    throw new Error('fleet_local_transport_generation_invalid');
  }

  return Object.freeze({
    tab_id: String(agent.tab_id),
    target_id: String(agent.target_id).toLowerCase(),
    generation_epoch: generationEpoch,
    conversation_url: normalizeConversationUrl(observation.conversation_url),
    authority_effect: false,
  });
}
