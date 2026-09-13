export const BROWSER_WEBCONTENTS_TAB_INDEX_SCHEMA = 'metaengine.browser.webcontents-tab-index.v1';

const tabByWebContents = new WeakMap();
const tabByWebContentsId = new Map();
const webContentsIdByTab = new Map();
const bindingGenerationByTab = new Map();
const destroyedHandlerByWebContents = new WeakMap();
let bindingSequence = 0;

function validTabId(value) {
  const tabId = String(value || '');
  if (!/^tab_[0-9a-f-]{36}$/i.test(tabId)) throw new Error('browser_webcontents_tab_index_tab_id_invalid');
  return tabId;
}

function exactWebContentsId(webContentsOrId) {
  const id = Number(
    webContentsOrId && typeof webContentsOrId === 'object'
      ? webContentsOrId.id
      : webContentsOrId,
  );
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('browser_webcontents_tab_index_webcontents_id_invalid');
  return id;
}

export function bindWebContentsToTab(tabIdRaw, webContents) {
  if (!webContents || typeof webContents !== 'object') throw new Error('browser_webcontents_tab_index_webcontents_required');
  const tabId = validTabId(tabIdRaw);
  const webContentsId = exactWebContentsId(webContents);

  const priorTab = tabByWebContentsId.get(webContentsId) || null;
  if (priorTab && priorTab !== tabId) {
    webContentsIdByTab.delete(priorTab);
    bindingGenerationByTab.delete(priorTab);
  }
  const priorId = webContentsIdByTab.get(tabId) || null;
  if (priorId && priorId !== webContentsId) tabByWebContentsId.delete(priorId);

  let bindingGeneration = bindingGenerationByTab.get(tabId) || null;
  if (priorId !== webContentsId || priorTab !== tabId || bindingGeneration == null) {
    bindingSequence += 1;
    bindingGeneration = bindingSequence;
  }

  tabByWebContents.set(webContents, tabId);
  tabByWebContentsId.set(webContentsId, tabId);
  webContentsIdByTab.set(tabId, webContentsId);
  bindingGenerationByTab.set(tabId, bindingGeneration);

  return Object.freeze({
    schema: BROWSER_WEBCONTENTS_TAB_INDEX_SCHEMA,
    tab_id: tabId,
    web_contents_id: webContentsId,
    binding_generation: bindingGeneration,
    exact_identity: true,
    selected_tab_fallback: false,
    url_fallback: false,
    authority_effect: false,
  });
}

export function unbindWebContentsFromTab(webContentsOrId, expectedTabId = null) {
  let webContentsId;
  try { webContentsId = exactWebContentsId(webContentsOrId); } catch { return false; }
  const current = tabByWebContentsId.get(webContentsId) || null;
  if (!current) return false;
  if (expectedTabId != null && current !== String(expectedTabId)) return false;

  tabByWebContentsId.delete(webContentsId);
  if (webContentsIdByTab.get(current) === webContentsId) {
    webContentsIdByTab.delete(current);
    bindingGenerationByTab.delete(current);
  }
  if (webContentsOrId && typeof webContentsOrId === 'object') tabByWebContents.delete(webContentsOrId);
  return true;
}

export function unbindTab(tabIdRaw) {
  let tabId;
  try { tabId = validTabId(tabIdRaw); } catch { return false; }
  const webContentsId = webContentsIdByTab.get(tabId);
  if (!webContentsId) return false;
  webContentsIdByTab.delete(tabId);
  bindingGenerationByTab.delete(tabId);
  if (tabByWebContentsId.get(webContentsId) === tabId) tabByWebContentsId.delete(webContentsId);
  return true;
}

export function resolveTabIdForWebContents(webContentsOrId) {
  if (webContentsOrId && typeof webContentsOrId === 'object') {
    const exactObjectBinding = tabByWebContents.get(webContentsOrId);
    if (exactObjectBinding) return exactObjectBinding;
  }
  let webContentsId;
  try { webContentsId = exactWebContentsId(webContentsOrId); } catch { return null; }
  return tabByWebContentsId.get(webContentsId) || null;
}

export function resolveWebContentsIdForTab(tabIdRaw) {
  let tabId;
  try { tabId = validTabId(tabIdRaw); } catch { return null; }
  return webContentsIdByTab.get(tabId) || null;
}

export function resolveExactWebContentsTabBinding(tabIdRaw) {
  let tabId;
  try { tabId = validTabId(tabIdRaw); } catch { return null; }
  const webContentsId = webContentsIdByTab.get(tabId) || null;
  const bindingGeneration = bindingGenerationByTab.get(tabId) || null;
  if (!webContentsId || !bindingGeneration || tabByWebContentsId.get(webContentsId) !== tabId) return null;
  return Object.freeze({
    schema: BROWSER_WEBCONTENTS_TAB_INDEX_SCHEMA,
    tab_id: tabId,
    web_contents_id: webContentsId,
    binding_generation: bindingGeneration,
    exact_identity: true,
    selected_tab_fallback: false,
    url_fallback: false,
    title_fallback: false,
    authority_effect: false,
  });
}

export function clearWebContentsTabIndex() {
  tabByWebContentsId.clear();
  webContentsIdByTab.clear();
  bindingGenerationByTab.clear();
}

/**
 * Canonical tab_id -> WebContentsView map with an exact O(1) reverse index.
 * Existing shell code can keep using normal Map set/delete/clear calls while the
 * Brain process plane resolves every live WebContents through one identity table.
 */
export class ExactBrowserTabViewMap extends Map {
  set(tabIdRaw, view) {
    const tabId = validTabId(tabIdRaw);
    const prior = super.get(tabId);
    if (prior?.webContents && prior !== view) unbindWebContentsFromTab(prior.webContents, tabId);
    const result = super.set(tabId, view);
    const webContents = view?.webContents;
    if (!webContents || typeof webContents !== 'object') {
      super.delete(tabId);
      throw new Error('browser_webcontents_tab_index_view_invalid');
    }
    bindWebContentsToTab(tabId, webContents);
    if (!destroyedHandlerByWebContents.has(webContents) && typeof webContents.once === 'function') {
      const handler = () => {
        unbindWebContentsFromTab(webContents, tabId);
        if (super.get(tabId) === view) super.delete(tabId);
      };
      destroyedHandlerByWebContents.set(webContents, handler);
      webContents.once('destroyed', handler);
    }
    return result;
  }

  delete(tabIdRaw) {
    const tabId = String(tabIdRaw || '');
    const view = super.get(tabId);
    if (view?.webContents) unbindWebContentsFromTab(view.webContents, tabId);
    return super.delete(tabId);
  }

  clear() {
    for (const [tabId, view] of this.entries()) {
      if (view?.webContents) unbindWebContentsFromTab(view.webContents, tabId);
    }
    super.clear();
    clearWebContentsTabIndex();
  }
}

export function webContentsTabIndexSnapshot() {
  return Object.freeze({
    schema: BROWSER_WEBCONTENTS_TAB_INDEX_SCHEMA,
    binding_count: tabByWebContentsId.size,
    bindings: [...tabByWebContentsId.entries()].map(([webContentsId, tabId]) => Object.freeze({
      web_contents_id: webContentsId,
      tab_id: tabId,
      binding_generation: bindingGenerationByTab.get(tabId) || null,
    })),
    lookup_complexity: 'O(1)',
    exact_identity_only: true,
    selected_tab_fallback: false,
    url_fallback: false,
    title_fallback: false,
    automatic_destroy_cleanup: true,
    binding_generation_monotonic_within_process: true,
    authority_effect: false,
  });
}
