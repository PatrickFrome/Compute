export const NATIVE_SPLIT_VIEW_VERSION = '1.0.0';
export const NATIVE_SPLIT_MIN_PANE_WIDTH = 360;
export const NATIVE_SPLIT_GAP = 8;

const MIN_RATIO = 0.30;
const MAX_RATIO = 0.70;

const clone = (value) => value == null ? value : structuredClone(value);

function tabId(value, name) {
  const out = String(value || '').trim();
  if (!out) throw new Error(`native_split_${name}_required`);
  return out;
}

function ratio(value) {
  const out = value == null ? 0.5 : Number(value);
  if (!Number.isFinite(out) || out < MIN_RATIO || out > MAX_RATIO) throw new Error('native_split_ratio_invalid');
  return out;
}

function rect(value) {
  const x = Math.floor(Number(value?.x));
  const y = Math.floor(Number(value?.y));
  const width = Math.floor(Number(value?.width));
  const height = Math.floor(Number(value?.height));
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width < 0 || height < 0) {
    throw new Error('native_split_remote_bounds_invalid');
  }
  return Object.freeze({ x, y, width, height });
}

export function normalizeNativeSplitState(input = null) {
  if (input == null || input.enabled !== true) {
    return Object.freeze({
      schema: 'metaengine.browser.native-split-state.v1',
      version: NATIVE_SPLIT_VIEW_VERSION,
      enabled: false,
      secondary_tab_id: null,
      ratio: 0.5,
      selection_authority: 'PRIMARY_SELECTED_TAB_ONLY',
      secondary_selection_authority: false,
      supervisor_implicit_target_uses_secondary: false,
      authority_effect: false,
    });
  }
  return Object.freeze({
    schema: 'metaengine.browser.native-split-state.v1',
    version: NATIVE_SPLIT_VIEW_VERSION,
    enabled: true,
    secondary_tab_id: tabId(input.secondary_tab_id, 'secondary_tab_id'),
    ratio: ratio(input.ratio),
    selection_authority: 'PRIMARY_SELECTED_TAB_ONLY',
    secondary_selection_authority: false,
    supervisor_implicit_target_uses_secondary: false,
    authority_effect: false,
  });
}

export function setNativeSplitSecondary(state, { selected_tab_id, secondary_tab_id, ratio: nextRatio = null, tab_exists } = {}) {
  const primary = tabId(selected_tab_id, 'selected_tab_id');
  const secondary = tabId(secondary_tab_id, 'secondary_tab_id');
  if (primary === secondary) throw new Error('native_split_secondary_must_differ_from_primary');
  if (typeof tab_exists !== 'function' || tab_exists(secondary) !== true) throw new Error('native_split_secondary_tab_not_live');
  const current = normalizeNativeSplitState(state);
  return normalizeNativeSplitState({
    enabled: true,
    secondary_tab_id: secondary,
    ratio: nextRatio == null ? current.ratio : nextRatio,
  });
}

export function clearNativeSplit() {
  return normalizeNativeSplitState(null);
}

export function reconcileNativeSplitSelection(state, {
  previous_selected_tab_id,
  selected_tab_id,
  tab_exists,
} = {}) {
  const current = normalizeNativeSplitState(state);
  if (!current.enabled) return current;
  const nextPrimary = tabId(selected_tab_id, 'selected_tab_id');
  const previousPrimary = String(previous_selected_tab_id || '').trim();
  if (typeof tab_exists !== 'function' || tab_exists(current.secondary_tab_id) !== true) return clearNativeSplit();

  // Clicking the visible secondary pane promotes it to the one authoritative
  // selected tab and demotes the prior primary into the presentation-only pane.
  if (nextPrimary === current.secondary_tab_id) {
    if (!previousPrimary || previousPrimary === nextPrimary || tab_exists(previousPrimary) !== true) return clearNativeSplit();
    return normalizeNativeSplitState({
      enabled: true,
      secondary_tab_id: previousPrimary,
      ratio: 1 - current.ratio,
    });
  }

  if (nextPrimary === current.secondary_tab_id) return clearNativeSplit();
  return current;
}

export function reconcileNativeSplitTabClosed(state, { closed_tab_id, selected_tab_id, tab_exists } = {}) {
  const current = normalizeNativeSplitState(state);
  if (!current.enabled) return current;
  const closed = String(closed_tab_id || '').trim();
  const primary = String(selected_tab_id || '').trim();
  if (!primary || typeof tab_exists !== 'function') return clearNativeSplit();
  if (closed === current.secondary_tab_id || current.secondary_tab_id === primary || tab_exists(current.secondary_tab_id) !== true) return clearNativeSplit();
  return current;
}

export function planNativeSplitView({ remote_bounds, state, selected_tab_id, tab_exists } = {}) {
  const bounds = rect(remote_bounds);
  const primary = selected_tab_id ? String(selected_tab_id) : null;
  const current = normalizeNativeSplitState(state);
  const base = {
    schema: 'metaengine.browser.native-split-plan.v1',
    version: NATIVE_SPLIT_VIEW_VERSION,
    requested: clone(current),
    active_tab_id: primary,
    secondary_tab_id: null,
    effective_enabled: false,
    degradation_reason: null,
    primary_bounds: bounds,
    secondary_bounds: null,
    visible_tab_ids: primary ? [primary] : [],
    selection_authority: 'PRIMARY_SELECTED_TAB_ONLY',
    secondary_selection_authority: false,
    supervisor_implicit_target_uses_secondary: false,
    renderer_dimensions_authoritative: false,
    authority_effect: false,
  };
  if (!current.enabled) return Object.freeze(base);
  if (!primary || current.secondary_tab_id === primary || typeof tab_exists !== 'function' || tab_exists(current.secondary_tab_id) !== true) {
    return Object.freeze({ ...base, degradation_reason: 'SECONDARY_BINDING_INVALID' });
  }
  if (bounds.width < (NATIVE_SPLIT_MIN_PANE_WIDTH * 2) + NATIVE_SPLIT_GAP) {
    return Object.freeze({ ...base, degradation_reason: 'INSUFFICIENT_NATIVE_WIDTH' });
  }

  const usable = bounds.width - NATIVE_SPLIT_GAP;
  const primaryWidth = Math.max(NATIVE_SPLIT_MIN_PANE_WIDTH, Math.min(usable - NATIVE_SPLIT_MIN_PANE_WIDTH, Math.floor(usable * current.ratio)));
  const secondaryWidth = usable - primaryWidth;
  const primaryBounds = Object.freeze({ x: bounds.x, y: bounds.y, width: primaryWidth, height: bounds.height });
  const secondaryBounds = Object.freeze({
    x: bounds.x + primaryWidth + NATIVE_SPLIT_GAP,
    y: bounds.y,
    width: secondaryWidth,
    height: bounds.height,
  });
  return Object.freeze({
    ...base,
    secondary_tab_id: current.secondary_tab_id,
    effective_enabled: true,
    primary_bounds: primaryBounds,
    secondary_bounds: secondaryBounds,
    visible_tab_ids: [primary, current.secondary_tab_id],
  });
}
