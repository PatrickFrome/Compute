export const SHELL_TOP_HEIGHT = 44;
export const SHELL_SIDEBAR_EXPANDED_WIDTH = 240;
export const SHELL_SIDEBAR_COMPACT_WIDTH = 52;
export const SHELL_OPERATIONS_WIDTH = 320;
export const SHELL_MIN_REMOTE_WIDTH = 720;

// R85/R75 primary ME2 Desktop composition. Presentation density changed, so
// the native WebContents geometry moves with the exact visible chrome rather
// than retaining stale R74 dimensions. The renderer still owns no authority.
export const ME2_PRIMARY_TOP_HEIGHT = 42;
export const ME2_PRIMARY_PAGEBAR_HEIGHT = 36;
export const ME2_PRIMARY_STATUSBAR_HEIGHT = 22;
export const ME2_PRIMARY_PAGE_PADDING = 6;
export const ME2_PRIMARY_COMMAND_SIDEBAR_WIDTH = 252;
export const ME2_PRIMARY_COMMAND_GAP = 0;
export const ME2_PRIMARY_COMMAND_AGENT_HEADER_HEIGHT = 32;
// Compact BrowserStage chrome remains renderer-owned and must stay physically
// clickable above/below the native WebContentsView viewport.
export const ME2_PRIMARY_BROWSER_TABSTRIP_HEIGHT = 28;
export const ME2_PRIMARY_BROWSER_URLBAR_HEIGHT = 36;
export const ME2_PRIMARY_BROWSER_STATUS_HEIGHT = 24;
export const ME2_PRIMARY_CONTEXT_DRAWER_HEIGHT = 200;
export const ME2_PRIMARY_CONTEXT_DRAWER_MIN_HEIGHT = 160;
export const ME2_PRIMARY_CONTEXT_DRAWER_MAX_HEIGHT = 360;
export const ME2_PRIMARY_CONTEXT_DRAWER_WIDTH = 380;
export const ME2_PRIMARY_CONTEXT_DRAWER_MIN_WIDTH = 320;
export const ME2_PRIMARY_CONTEXT_DRAWER_MAX_WIDTH = 520;
export const ME2_PRIMARY_MIN_BROWSER_HEIGHT = 320;
export const ME2_PRIMARY_RUN_INSPECTOR_WIDTH = 384;
export const ME2_PRIMARY_RUN_INSPECTOR_GAP = 8;
export const ME2_PRIMARY_RUN_INSPECTOR_MIN_WINDOW_WIDTH = 1280;

const SIDEBAR_MODES = new Set(['EXPANDED', 'COMPACT', 'HIDDEN']);
const OPERATIONS_MODES = new Set(['OPEN', 'CLOSED']);
const ME2_DRAWER_DOCKS = new Set(['BOTTOM', 'RIGHT']);

function finiteDimension(value, name) {
  const out = Math.floor(Number(value));
  if (!Number.isFinite(out) || out < 0) throw new Error(`shell_layout_${name}_invalid`);
  return out;
}

function clamp(value, min, max, fallback) {
  const number = Math.floor(Number(value));
  const safe = Number.isFinite(number) ? number : fallback;
  return Math.max(min, Math.min(max, safe));
}

export function normalizeShellLayoutState(input = null) {
  if (input == null) {
    return Object.freeze({
      schema: 'metaengine.browser-shell.layout-state.v1',
      sidebar: 'EXPANDED',
      operations: 'CLOSED',
      authority_effect: false,
    });
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('shell_layout_state_invalid');
  const sidebar = String(input.sidebar || '').trim().toUpperCase();
  const operations = String(input.operations || '').trim().toUpperCase();
  if (!SIDEBAR_MODES.has(sidebar)) throw new Error('shell_layout_sidebar_invalid');
  if (!OPERATIONS_MODES.has(operations)) throw new Error('shell_layout_operations_invalid');
  return Object.freeze({
    schema: 'metaengine.browser-shell.layout-state.v1',
    sidebar,
    operations,
    authority_effect: false,
  });
}

function sidebarWidth(mode) {
  if (mode === 'EXPANDED') return SHELL_SIDEBAR_EXPANDED_WIDTH;
  if (mode === 'COMPACT') return SHELL_SIDEBAR_COMPACT_WIDTH;
  return 0;
}

export function planShellLayout({
  width,
  height,
  state,
  surface_profile = 'LEGACY_BROWSER_SHELL',
  me2_command_rail_open = true,
  me2_context_drawer_open = false,
  me2_context_drawer_dock = 'BOTTOM',
  me2_context_drawer_height = ME2_PRIMARY_CONTEXT_DRAWER_HEIGHT,
  me2_context_drawer_width = ME2_PRIMARY_CONTEXT_DRAWER_WIDTH,
} = {}) {
  const windowWidth = finiteDimension(width, 'width');
  const windowHeight = finiteDimension(height, 'height');
  const requested = state?.schema === 'metaengine.browser-shell.layout-state.v1'
    ? normalizeShellLayoutState(state)
    : normalizeShellLayoutState(state ?? null);

  let effectiveSidebar = requested.sidebar;
  let effectiveOperations = requested.operations;
  let left = sidebarWidth(effectiveSidebar);
  let right = effectiveOperations === 'OPEN' ? SHELL_OPERATIONS_WIDTH : 0;
  const adaptations = [];

  const remoteWidth = () => Math.max(0, windowWidth - left - right);

  // Presentation degrades before page space. The renderer never owns geometry and
  // remote WebContents pixels are never overlaid by shell UI.
  if (remoteWidth() < SHELL_MIN_REMOTE_WIDTH && effectiveSidebar === 'EXPANDED') {
    effectiveSidebar = 'COMPACT';
    left = SHELL_SIDEBAR_COMPACT_WIDTH;
    adaptations.push('SIDEBAR_COMPACTED_FOR_ACTIVE_SURFACE');
  }
  if (remoteWidth() < SHELL_MIN_REMOTE_WIDTH && effectiveOperations === 'OPEN') {
    effectiveOperations = 'CLOSED';
    right = 0;
    adaptations.push('INSPECTOR_CLOSED_FOR_ACTIVE_SURFACE');
  }
  if (remoteWidth() < SHELL_MIN_REMOTE_WIDTH && effectiveSidebar === 'COMPACT') {
    effectiveSidebar = 'HIDDEN';
    left = 0;
    adaptations.push('SIDEBAR_HIDDEN_FOR_ACTIVE_SURFACE');
  }

  let top = Math.min(SHELL_TOP_HEIGHT, windowHeight);
  let bottom = 0;
  let contentWidth = Math.max(0, windowWidth - left - right);
  let remoteHeight = Math.max(0, windowHeight - top);
  let surfaceProfile = String(surface_profile || 'LEGACY_BROWSER_SHELL').toUpperCase();

  let me2DrawerRequestedOpen = null;
  let me2DrawerRequestedDock = null;
  let me2DrawerRequestedHeight = null;
  let me2DrawerRequestedWidth = null;
  let me2DrawerEffectiveOpen = null;
  let me2DrawerEffectiveDock = null;
  let me2DrawerHeight = 0;
  let me2DrawerWidth = 0;

  if (surfaceProfile === 'ME2_R75_COMMAND') {
    // ME2 shell itself owns all chrome. Reserve the exact visible chrome and
    // command-page agent rail, then place the native Browser in the center.
    // On constrained windows optional chrome degrades before the native Browser.
    top = Math.min(
      ME2_PRIMARY_TOP_HEIGHT
        + ME2_PRIMARY_PAGE_PADDING
        + ME2_PRIMARY_COMMAND_AGENT_HEADER_HEIGHT
        + ME2_PRIMARY_COMMAND_GAP
        + ME2_PRIMARY_BROWSER_TABSTRIP_HEIGHT
        + ME2_PRIMARY_BROWSER_URLBAR_HEIGHT,
      windowHeight,
    );
    const baseBottom = Math.min(
      ME2_PRIMARY_PAGEBAR_HEIGHT
        + ME2_PRIMARY_STATUSBAR_HEIGHT
        + ME2_PRIMARY_PAGE_PADDING
        + ME2_PRIMARY_BROWSER_STATUS_HEIGHT,
      Math.max(0, windowHeight - top),
    );

    const preferredLeft = ME2_PRIMARY_PAGE_PADDING
      + ME2_PRIMARY_COMMAND_SIDEBAR_WIDTH
      + ME2_PRIMARY_COMMAND_GAP;
    const railRequested = me2_command_rail_open !== false;
    const railFits = windowWidth - preferredLeft - ME2_PRIMARY_PAGE_PADDING >= SHELL_MIN_REMOTE_WIDTH;
    left = railRequested && railFits ? preferredLeft : ME2_PRIMARY_PAGE_PADDING;
    right = ME2_PRIMARY_PAGE_PADDING;
    bottom = baseBottom;

    if (!railRequested) {
      adaptations.push('ME2_AGENT_RAIL_HIDDEN_BY_PRESENTATION');
    } else if (!railFits) {
      adaptations.push('ME2_AGENT_RAIL_RESERVED_SPACE_RELEASED_FOR_ACTIVE_SURFACE');
    }

    const rawDock = String(me2_context_drawer_dock || 'BOTTOM').trim().toUpperCase();
    const requestedDock = ME2_DRAWER_DOCKS.has(rawDock) ? rawDock : 'BOTTOM';
    const drawerRequested = me2_context_drawer_open === true;
    const requestedDrawerHeight = clamp(
      me2_context_drawer_height,
      ME2_PRIMARY_CONTEXT_DRAWER_MIN_HEIGHT,
      ME2_PRIMARY_CONTEXT_DRAWER_MAX_HEIGHT,
      ME2_PRIMARY_CONTEXT_DRAWER_HEIGHT,
    );
    const requestedDrawerWidth = clamp(
      me2_context_drawer_width,
      ME2_PRIMARY_CONTEXT_DRAWER_MIN_WIDTH,
      ME2_PRIMARY_CONTEXT_DRAWER_MAX_WIDTH,
      ME2_PRIMARY_CONTEXT_DRAWER_WIDTH,
    );

    me2DrawerRequestedOpen = drawerRequested;
    me2DrawerRequestedDock = requestedDock;
    me2DrawerRequestedHeight = requestedDrawerHeight;
    me2DrawerRequestedWidth = requestedDrawerWidth;
    me2DrawerEffectiveDock = requestedDock;

    if (drawerRequested && requestedDock === 'BOTTOM') {
      const capacity = Math.max(0, windowHeight - top - baseBottom - ME2_PRIMARY_MIN_BROWSER_HEIGHT);
      const effectiveHeight = capacity >= ME2_PRIMARY_CONTEXT_DRAWER_MIN_HEIGHT
        ? Math.min(requestedDrawerHeight, capacity)
        : 0;
      if (effectiveHeight >= ME2_PRIMARY_CONTEXT_DRAWER_MIN_HEIGHT) {
        me2DrawerEffectiveOpen = true;
        me2DrawerHeight = effectiveHeight;
        bottom = Math.min(baseBottom + effectiveHeight, Math.max(0, windowHeight - top));
        if (effectiveHeight < requestedDrawerHeight) {
          adaptations.push('ME2_CONTEXT_DRAWER_CLAMPED_FOR_ACTIVE_SURFACE');
        }
      } else {
        me2DrawerEffectiveOpen = false;
        adaptations.push('ME2_CONTEXT_DRAWER_CLOSED_FOR_ACTIVE_SURFACE');
      }
    } else if (drawerRequested && requestedDock === 'RIGHT') {
      const capacity = Math.max(0, windowWidth - left - ME2_PRIMARY_PAGE_PADDING - SHELL_MIN_REMOTE_WIDTH);
      const effectiveWidth = capacity >= ME2_PRIMARY_CONTEXT_DRAWER_MIN_WIDTH
        ? Math.min(requestedDrawerWidth, capacity)
        : 0;
      if (effectiveWidth >= ME2_PRIMARY_CONTEXT_DRAWER_MIN_WIDTH) {
        me2DrawerEffectiveOpen = true;
        me2DrawerWidth = effectiveWidth;
        right = ME2_PRIMARY_PAGE_PADDING + effectiveWidth;
        if (effectiveWidth < requestedDrawerWidth) {
          adaptations.push('ME2_CONTEXT_DRAWER_CLAMPED_FOR_ACTIVE_SURFACE');
        }
      } else {
        me2DrawerEffectiveOpen = false;
        adaptations.push('ME2_CONTEXT_DRAWER_CLOSED_FOR_ACTIVE_SURFACE');
      }
    } else {
      me2DrawerEffectiveOpen = false;
    }

    contentWidth = Math.max(0, windowWidth - left - right);
    remoteHeight = Math.max(0, windowHeight - top - bottom);
    effectiveSidebar = left === preferredLeft ? 'EXPANDED' : 'HIDDEN';
    effectiveOperations = 'CLOSED';
  } else if (surfaceProfile === 'ME2_R95_RUN') {
    // RUN is the only primary ME2 page that owns native Browser pixels.
    // Reserve renderer chrome, optional telemetry inspector, and the global
    // Utility Panel before projecting the Browser WebContentsView.
    top = Math.min(
      ME2_PRIMARY_TOP_HEIGHT
        + ME2_PRIMARY_PAGE_PADDING
        + ME2_PRIMARY_COMMAND_AGENT_HEADER_HEIGHT
        + ME2_PRIMARY_COMMAND_GAP
        + ME2_PRIMARY_BROWSER_TABSTRIP_HEIGHT
        + ME2_PRIMARY_BROWSER_URLBAR_HEIGHT,
      windowHeight,
    );
    const baseBottom = Math.min(
      ME2_PRIMARY_PAGEBAR_HEIGHT
        + ME2_PRIMARY_STATUSBAR_HEIGHT
        + ME2_PRIMARY_PAGE_PADDING
        + ME2_PRIMARY_BROWSER_STATUS_HEIGHT,
      Math.max(0, windowHeight - top),
    );
    left = ME2_PRIMARY_PAGE_PADDING;
    const rawDock = String(me2_context_drawer_dock || 'BOTTOM').trim().toUpperCase();
    const requestedDock = ME2_DRAWER_DOCKS.has(rawDock) ? rawDock : 'BOTTOM';
    const drawerRequested = me2_context_drawer_open === true;
    const requestedDrawerHeight = clamp(
      me2_context_drawer_height,
      ME2_PRIMARY_CONTEXT_DRAWER_MIN_HEIGHT,
      ME2_PRIMARY_CONTEXT_DRAWER_MAX_HEIGHT,
      ME2_PRIMARY_CONTEXT_DRAWER_HEIGHT,
    );
    const requestedDrawerWidth = clamp(
      me2_context_drawer_width,
      ME2_PRIMARY_CONTEXT_DRAWER_MIN_WIDTH,
      ME2_PRIMARY_CONTEXT_DRAWER_MAX_WIDTH,
      ME2_PRIMARY_CONTEXT_DRAWER_WIDTH,
    );

    // The telemetry inspector is optional. A user-requested Right Utility Panel
    // gets first claim on the presentation budget, then the inspector may use
    // the remaining width. Native Browser minimum remains the hard floor.
    const inspectorRequested = windowWidth >= ME2_PRIMARY_RUN_INSPECTOR_MIN_WINDOW_WIDTH;
    const rightUtilityRequested = drawerRequested && requestedDock === 'RIGHT';
    const inspectorFits = windowWidth
      - ME2_PRIMARY_PAGE_PADDING * 2
      - (ME2_PRIMARY_RUN_INSPECTOR_WIDTH + ME2_PRIMARY_RUN_INSPECTOR_GAP)
      >= SHELL_MIN_REMOTE_WIDTH;
    const inspectorVisible = inspectorRequested && inspectorFits && !rightUtilityRequested;
    const baseRight = inspectorVisible
      ? ME2_PRIMARY_PAGE_PADDING + ME2_PRIMARY_RUN_INSPECTOR_WIDTH + ME2_PRIMARY_RUN_INSPECTOR_GAP
      : ME2_PRIMARY_PAGE_PADDING;
    right = baseRight;
    bottom = baseBottom;
    me2DrawerRequestedOpen = drawerRequested;
    me2DrawerRequestedDock = requestedDock;
    me2DrawerRequestedHeight = requestedDrawerHeight;
    me2DrawerRequestedWidth = requestedDrawerWidth;
    me2DrawerEffectiveDock = requestedDock;

    if (drawerRequested && requestedDock === 'BOTTOM') {
      const capacity = Math.max(0, windowHeight - top - baseBottom - ME2_PRIMARY_MIN_BROWSER_HEIGHT);
      const effectiveHeight = capacity >= ME2_PRIMARY_CONTEXT_DRAWER_MIN_HEIGHT
        ? Math.min(requestedDrawerHeight, capacity)
        : 0;
      if (effectiveHeight >= ME2_PRIMARY_CONTEXT_DRAWER_MIN_HEIGHT) {
        me2DrawerEffectiveOpen = true;
        me2DrawerHeight = effectiveHeight;
        bottom = Math.min(baseBottom + effectiveHeight, Math.max(0, windowHeight - top));
        if (effectiveHeight < requestedDrawerHeight) adaptations.push('ME2_CONTEXT_DRAWER_CLAMPED_FOR_ACTIVE_SURFACE');
      } else {
        me2DrawerEffectiveOpen = false;
        adaptations.push('ME2_CONTEXT_DRAWER_CLOSED_FOR_ACTIVE_SURFACE');
      }
    } else if (drawerRequested && requestedDock === 'RIGHT') {
      const capacity = Math.max(0, windowWidth - left - baseRight - SHELL_MIN_REMOTE_WIDTH);
      const effectiveWidth = capacity >= ME2_PRIMARY_CONTEXT_DRAWER_MIN_WIDTH
        ? Math.min(requestedDrawerWidth, capacity)
        : 0;
      if (effectiveWidth >= ME2_PRIMARY_CONTEXT_DRAWER_MIN_WIDTH) {
        me2DrawerEffectiveOpen = true;
        me2DrawerWidth = effectiveWidth;
        right = baseRight + effectiveWidth;
        if (effectiveWidth < requestedDrawerWidth) adaptations.push('ME2_CONTEXT_DRAWER_CLAMPED_FOR_ACTIVE_SURFACE');
      } else {
        me2DrawerEffectiveOpen = false;
        adaptations.push('ME2_CONTEXT_DRAWER_CLOSED_FOR_ACTIVE_SURFACE');
      }
    } else {
      me2DrawerEffectiveOpen = false;
    }

    contentWidth = Math.max(0, windowWidth - left - right);
    remoteHeight = Math.max(0, windowHeight - top - bottom);
    effectiveSidebar = 'HIDDEN';
    effectiveOperations = 'CLOSED';
    if (inspectorRequested && !inspectorVisible) {
      adaptations.push(rightUtilityRequested
        ? 'ME2_RUN_INSPECTOR_RELEASED_FOR_UTILITY_PANEL'
        : 'ME2_RUN_INSPECTOR_RELEASED_FOR_ACTIVE_SURFACE');
    }
  } else if (surfaceProfile !== 'LEGACY_BROWSER_SHELL') {
    surfaceProfile = 'LEGACY_BROWSER_SHELL';
  }

  const activeSurfaceWidthTarget = Math.min(SHELL_MIN_REMOTE_WIDTH, windowWidth);
  const isMe2DrawerSurface = surfaceProfile === 'ME2_R75_COMMAND' || surfaceProfile === 'ME2_R95_RUN';

  return Object.freeze({
    schema: 'metaengine.browser-shell.layout-plan.v1',
    requested: structuredClone(requested),
    effective_sidebar: effectiveSidebar,
    effective_operations: effectiveOperations,
    shell_bounds: Object.freeze({ x: 0, y: 0, width: windowWidth, height: windowHeight }),
    remote_bounds: Object.freeze({ x: left, y: top, width: contentWidth, height: remoteHeight }),
    reserved_bottom_height: bottom,
    surface_profile: surfaceProfile,
    sidebar_bounds: Object.freeze({ x: 0, y: top, width: left, height: remoteHeight }),
    operations_bounds: Object.freeze({ x: Math.max(0, windowWidth - right), y: top, width: right, height: remoteHeight }),
    remote_min_width: SHELL_MIN_REMOTE_WIDTH,
    active_surface_width_target: activeSurfaceWidthTarget,
    active_surface_target_satisfied: contentWidth >= activeSurfaceWidthTarget,
    active_surface_priority: true,
    me2_command_rail_requested_open: surfaceProfile === 'ME2_R75_COMMAND' ? me2_command_rail_open !== false : null,
    me2_context_drawer_requested_open: isMe2DrawerSurface ? me2DrawerRequestedOpen : null,
    me2_context_drawer_requested_dock: isMe2DrawerSurface ? me2DrawerRequestedDock : null,
    me2_context_drawer_requested_height: isMe2DrawerSurface ? me2DrawerRequestedHeight : null,
    me2_context_drawer_requested_width: isMe2DrawerSurface ? me2DrawerRequestedWidth : null,
    me2_context_drawer_effective_open: isMe2DrawerSurface ? me2DrawerEffectiveOpen : null,
    me2_context_drawer_effective_dock: isMe2DrawerSurface ? me2DrawerEffectiveDock : null,
    me2_context_drawer_height: isMe2DrawerSurface ? me2DrawerHeight : 0,
    me2_context_drawer_width: isMe2DrawerSurface ? me2DrawerWidth : 0,
    chrome_degrades_before_active_surface: true,
    adaptations: Object.freeze(adaptations),
    adapted: adaptations.length > 0,
    overlay_remote_content: false,
    renderer_dimensions_authoritative: false,
    authority_effect: false,
  });
}
