import { nativeActionRequiresExactTabTarget } from './native-supervisor-command-lanes.mjs';
import {
  resolveExactWebContentsTabBinding,
  resolveTabIdForWebContents,
} from './browser-webcontents-tab-index.mjs';

export const NATIVE_SUPERVISOR_EXACT_TARGET_SCHEMA = 'metaengine.native-supervisor.exact-target.v1';

const TAB_ID_RE = /^tab_[0-9a-f-]{36}$/i;

function actionOf(command) {
  return String(command?.action || '').trim().toUpperCase();
}

function exactTabId(command) {
  const value = String(command?.payload?.tab_id || '').trim().toLowerCase();
  return TAB_ID_RE.test(value) ? value : null;
}

function liveView(views, tabId) {
  const view = views?.get?.(tabId) || null;
  const webContents = view?.webContents || null;
  if (!view || !webContents || webContents.isDestroyed?.() === true) {
    throw new Error('native_supervisor_exact_target_view_unavailable');
  }
  return { view, webContents };
}

/**
 * Resolve one existing-tab mutation exclusively from its explicit tab_id.
 * Platform, URL, title, focus and selected-tab state are never consulted.
 */
export function resolveExactNativeSupervisorMutationTarget(command, {
  registry,
  views,
  resolveIndexedBinding = resolveExactWebContentsTabBinding,
  resolveIndexedTab = resolveTabIdForWebContents,
} = {}) {
  const action = actionOf(command);
  if (!nativeActionRequiresExactTabTarget(action)) return null;
  const tabId = exactTabId(command);
  if (!tabId) throw new Error(`native_supervisor_exact_tab_required:${action || 'UNKNOWN'}`);
  const tab = registry?.get?.(tabId) || null;
  if (!tab || String(tab.tab_id || '').toLowerCase() !== tabId) {
    throw new Error('native_supervisor_exact_target_tab_unavailable');
  }
  const { view, webContents } = liveView(views, tabId);
  const indexed = resolveIndexedBinding?.(tabId) || null;
  const reverseTab = resolveIndexedTab?.(webContents) || null;
  const webContentsId = Number(webContents.id);
  if (
    !indexed
    || indexed.tab_id !== tabId
    || indexed.web_contents_id !== webContentsId
    || reverseTab !== tabId
  ) {
    throw new Error('native_supervisor_exact_target_index_mismatch');
  }
  return Object.freeze({
    schema: NATIVE_SUPERVISOR_EXACT_TARGET_SCHEMA,
    action,
    tab_id: tabId,
    web_contents_id: webContentsId,
    binding_generation: indexed.binding_generation,
    tab,
    view,
    webContents,
    exact_identity: true,
    selected_tab_fallback: false,
    platform_fallback: false,
    url_fallback: false,
    title_fallback: false,
    authority_effect: false,
  });
}

/** Revalidate the exact map generation immediately before the physical effect. */
export function assertExactNativeSupervisorMutationTargetCurrent(target, {
  views,
  resolveIndexedBinding = resolveExactWebContentsTabBinding,
  resolveIndexedTab = resolveTabIdForWebContents,
} = {}) {
  if (!target || target.schema !== NATIVE_SUPERVISOR_EXACT_TARGET_SCHEMA) {
    throw new Error('native_supervisor_exact_target_binding_invalid');
  }
  const { view, webContents } = liveView(views, target.tab_id);
  const indexed = resolveIndexedBinding?.(target.tab_id) || null;
  if (
    view !== target.view
    || webContents !== target.webContents
    || Number(webContents.id) !== target.web_contents_id
    || resolveIndexedTab?.(webContents) !== target.tab_id
    || indexed?.web_contents_id !== target.web_contents_id
    || indexed?.binding_generation !== target.binding_generation
  ) {
    throw new Error('native_supervisor_exact_target_generation_mismatch');
  }
  return target;
}
