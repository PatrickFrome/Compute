export const METAENGINE_DEVOS_SURFACE_GRID_SCHEMA = 'metaengine.devos.surface-grid.v1';
export const METAENGINE_DEVOS_SURFACE_PANE_SCHEMA = 'metaengine.devos.surface-pane.v1';
export const METAENGINE_DEVOS_SURFACE_LAYOUT_MODES = Object.freeze([
  'AUTO',
  'SINGLE',
  'SPLIT_VERTICAL',
  'SPLIT_HORIZONTAL',
  'TRIPLE_RIGHT',
  'GRID_2X2',
]);

const MAX_VISIBLE_SURFACES = 4;
const MIN_PANE_WIDTH = 280;
const MIN_PANE_HEIGHT = 180;
const PANE_HEADER_HEIGHT = 28;
const GAP = 2;

function zeroAuthorityContract() {
  return Object.freeze({
    projection_is_authority: false,
    scheduler_authority: false,
    execution_authority: false,
    command_leasing: false,
    automatic_effect_retry_allowed: false,
    page_model_authority: false,
    authority_effect: false,
  });
}

function int(value, name) {
  const out = Math.floor(Number(value));
  if (!Number.isFinite(out) || out < 0) throw new Error(`devos_surface_grid_${name}_invalid`);
  return out;
}

function id(value, name, max = 240) {
  const out = String(value ?? '').trim();
  if (!out || out.length > max || /[\u0000-\u001f\u007f]/.test(out)) throw new Error(`devos_surface_grid_${name}_invalid`);
  return out;
}

function layoutMode(value, fallback = 'AUTO') {
  const out = String(value || fallback).trim().toUpperCase();
  if (!METAENGINE_DEVOS_SURFACE_LAYOUT_MODES.includes(out)) throw new Error('devos_surface_grid_layout_mode_invalid');
  return out;
}

function normalizeBounds(bounds = {}) {
  return Object.freeze({
    x: int(bounds.x, 'x'),
    y: int(bounds.y, 'y'),
    width: int(bounds.width, 'width'),
    height: int(bounds.height, 'height'),
  });
}

function normalizeSurface(source = {}) {
  const surfaceId = id(source.surface_id, 'surface_id');
  const sessionId = id(source.session_id, 'session_id', 200);
  const type = String(source.type || 'UNKNOWN').trim().toUpperCase().slice(0, 48) || 'UNKNOWN';
  const tabId = source.tab_id == null ? null : id(source.tab_id, 'tab_id', 200);
  if (source.authority_effect !== false
    || source.projection_is_authority !== false
    || source.scheduler_authority !== false
    || source.execution_authority !== false
    || source.command_leasing !== false
    || source.automatic_effect_retry_allowed !== false
    || source.page_model_authority !== false) {
    throw new Error('devos_surface_grid_surface_authority_invalid');
  }
  return Object.freeze({ surface_id: surfaceId, session_id: sessionId, type, tab_id: tabId, title: String(source.title || surfaceId).slice(0, 300) });
}

function effectiveMode(requested, count, bounds) {
  if (count <= 1) return 'SINGLE';
  const enoughVertical = bounds.width >= MIN_PANE_WIDTH * 2 + GAP;
  const enoughHorizontal = bounds.height >= MIN_PANE_HEIGHT * 2 + GAP;
  if (requested === 'AUTO') {
    if (count === 2) return enoughVertical ? 'SPLIT_VERTICAL' : (enoughHorizontal ? 'SPLIT_HORIZONTAL' : 'SINGLE');
    if (count === 3) return enoughVertical && enoughHorizontal ? 'TRIPLE_RIGHT' : (enoughVertical ? 'SPLIT_VERTICAL' : 'SINGLE');
    return enoughVertical && enoughHorizontal ? 'GRID_2X2' : (enoughVertical ? 'SPLIT_VERTICAL' : 'SINGLE');
  }
  if (requested === 'SPLIT_VERTICAL' && !enoughVertical) return enoughHorizontal ? 'SPLIT_HORIZONTAL' : 'SINGLE';
  if (requested === 'SPLIT_HORIZONTAL' && !enoughHorizontal) return enoughVertical ? 'SPLIT_VERTICAL' : 'SINGLE';
  if (requested === 'TRIPLE_RIGHT' && !(enoughVertical && enoughHorizontal)) return enoughVertical ? 'SPLIT_VERTICAL' : 'SINGLE';
  if (requested === 'GRID_2X2' && !(enoughVertical && enoughHorizontal)) return enoughVertical ? 'SPLIT_VERTICAL' : 'SINGLE';
  return requested;
}

function split(total, parts, gap = GAP) {
  if (parts <= 1) return [total];
  const usable = Math.max(0, total - gap * (parts - 1));
  const base = Math.floor(usable / parts);
  const remainder = usable - base * parts;
  return Array.from({ length: parts }, (_, index) => base + (index < remainder ? 1 : 0));
}

function paneRectangles(bounds, mode, count) {
  if (count <= 0) return [];
  if (mode === 'SINGLE') return [bounds];
  if (mode === 'SPLIT_VERTICAL') {
    const widths = split(bounds.width, Math.min(2, count));
    return widths.map((width, index) => Object.freeze({
      x: bounds.x + widths.slice(0, index).reduce((sum, value) => sum + value, 0) + GAP * index,
      y: bounds.y,
      width,
      height: bounds.height,
    }));
  }
  if (mode === 'SPLIT_HORIZONTAL') {
    const heights = split(bounds.height, Math.min(2, count));
    return heights.map((height, index) => Object.freeze({
      x: bounds.x,
      y: bounds.y + heights.slice(0, index).reduce((sum, value) => sum + value, 0) + GAP * index,
      width: bounds.width,
      height,
    }));
  }
  if (mode === 'TRIPLE_RIGHT') {
    const widths = split(bounds.width, 2);
    const rightHeights = split(bounds.height, 2);
    return [
      Object.freeze({ x: bounds.x, y: bounds.y, width: widths[0], height: bounds.height }),
      Object.freeze({ x: bounds.x + widths[0] + GAP, y: bounds.y, width: widths[1], height: rightHeights[0] }),
      Object.freeze({ x: bounds.x + widths[0] + GAP, y: bounds.y + rightHeights[0] + GAP, width: widths[1], height: rightHeights[1] }),
    ];
  }
  const widths = split(bounds.width, 2);
  const heights = split(bounds.height, 2);
  return [0, 1, 2, 3].slice(0, count).map((index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    return Object.freeze({
      x: bounds.x + (col ? widths[0] + GAP : 0),
      y: bounds.y + (row ? heights[0] + GAP : 0),
      width: widths[col],
      height: heights[row],
    });
  });
}

function reorderForFocus(surfaces, focusedSurfaceId) {
  if (!focusedSurfaceId) return surfaces;
  const index = surfaces.findIndex((surface) => surface.surface_id === focusedSurfaceId);
  if (index <= 0) return surfaces;
  return Object.freeze([surfaces[index], ...surfaces.slice(0, index), ...surfaces.slice(index + 1)]);
}

export function planDevOSSurfaceGrid({ bounds, surfaces = [], focused_surface_id = null, requested_layout = 'AUTO' } = {}) {
  const contentBounds = normalizeBounds(bounds);
  const normalized = [];
  const seen = new Set();
  let sessionId = null;
  for (const source of surfaces) {
    const surface = normalizeSurface(source);
    if (seen.has(surface.surface_id)) throw new Error('devos_surface_grid_duplicate_surface');
    seen.add(surface.surface_id);
    if (sessionId && surface.session_id !== sessionId) throw new Error('devos_surface_grid_cross_session_surface');
    sessionId = surface.session_id;
    normalized.push(surface);
  }
  const requested = layoutMode(requested_layout);
  const focused = focused_surface_id == null ? null : id(focused_surface_id, 'focused_surface_id');
  if (focused && !seen.has(focused)) throw new Error('devos_surface_grid_focused_surface_missing');
  const ordered = reorderForFocus(Object.freeze(normalized), focused).slice(0, MAX_VISIBLE_SURFACES);
  const mode = effectiveMode(requested, ordered.length, contentBounds);
  const visible = mode === 'SINGLE' ? ordered.slice(0, 1) : ordered;
  const rects = paneRectangles(contentBounds, mode, visible.length);
  const panes = visible.map((surface, index) => {
    const boundsForPane = rects[index];
    const contentHeight = Math.max(0, boundsForPane.height - PANE_HEADER_HEIGHT);
    return Object.freeze({
      schema: METAENGINE_DEVOS_SURFACE_PANE_SCHEMA,
      surface_id: surface.surface_id,
      session_id: surface.session_id,
      type: surface.type,
      title: surface.title,
      tab_id: surface.tab_id,
      focused: surface.surface_id === focused || (!focused && index === 0),
      pane_bounds: boundsForPane,
      content_bounds: Object.freeze({
        x: boundsForPane.x,
        y: Math.min(boundsForPane.y + PANE_HEADER_HEIGHT, boundsForPane.y + boundsForPane.height),
        width: boundsForPane.width,
        height: contentHeight,
      }),
      runtime_bound: surface.type === 'BROWSER' && Boolean(surface.tab_id),
      renderer_content_required: surface.type !== 'BROWSER',
      ...zeroAuthorityContract(),
    });
  });
  return Object.freeze({
    schema: METAENGINE_DEVOS_SURFACE_GRID_SCHEMA,
    session_id: sessionId,
    requested_layout: requested,
    effective_layout: mode,
    max_visible_surfaces: MAX_VISIBLE_SURFACES,
    requested_surface_count: normalized.length,
    visible_surface_count: panes.length,
    surfaces_truncated: normalized.length > panes.length,
    pane_header_height: PANE_HEADER_HEIGHT,
    gap: GAP,
    bounds: contentBounds,
    panes: Object.freeze(panes),
    browser_panes: Object.freeze(panes.filter((pane) => pane.runtime_bound)),
    shell_panes: Object.freeze(panes.filter((pane) => pane.renderer_content_required)),
    multi_surface: panes.length > 1,
    renderer_dimensions_authoritative: false,
    browser_views_owned_by_main: true,
    session_crossing_allowed: false,
    ...zeroAuthorityContract(),
  });
}
