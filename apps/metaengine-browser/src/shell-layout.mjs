export const SHELL_TOP_HEIGHT = 44;
export const SHELL_SIDEBAR_EXPANDED_WIDTH = 240;
export const SHELL_SIDEBAR_COMPACT_WIDTH = 52;
export const SHELL_OPERATIONS_WIDTH = 320;
export const SHELL_MIN_REMOTE_WIDTH = 720;

// R84/R75 primary ME2 Desktop composition. These constants mirror the actual
// packaged ME2 shell geometry: TopBar h-12, PageBar h-11, StatusBar h-7,
// PageOutlet p-2, Command agent rail w-[264px], gap-2, current-agent row h-8.
// The native Browser WebContentsView occupies only the center stage; it never
// overlays the ME2 chrome or agent list.
export const ME2_PRIMARY_TOP_HEIGHT = 48;
export const ME2_PRIMARY_PAGEBAR_HEIGHT = 44;
export const ME2_PRIMARY_STATUSBAR_HEIGHT = 28;
export const ME2_PRIMARY_PAGE_PADDING = 8;
export const ME2_PRIMARY_COMMAND_SIDEBAR_WIDTH = 264;
export const ME2_PRIMARY_COMMAND_GAP = 8;
export const ME2_PRIMARY_COMMAND_AGENT_HEADER_HEIGHT = 32;

const SIDEBAR_MODES = new Set(['EXPANDED', 'COMPACT', 'HIDDEN']);
const OPERATIONS_MODES = new Set(['OPEN', 'CLOSED']);

function finiteDimension(value, name) {
  const out = Math.floor(Number(value));
  if (!Number.isFinite(out) || out < 0) throw new Error(`shell_layout_${name}_invalid`);
  return out;
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

export function planShellLayout({ width, height, state, surface_profile = 'LEGACY_BROWSER_SHELL' } = {}) {
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

  if (surfaceProfile === 'ME2_R75_COMMAND') {
    // ME2 shell itself owns all chrome. Reserve the exact visible chrome and
    // command-page agent rail, then place the native Browser in the center.
    // On narrow windows the rail degrades before the native browser stage.
    top = Math.min(
      ME2_PRIMARY_TOP_HEIGHT
        + ME2_PRIMARY_PAGE_PADDING
        + ME2_PRIMARY_COMMAND_AGENT_HEADER_HEIGHT
        + ME2_PRIMARY_COMMAND_GAP,
      windowHeight,
    );
    bottom = Math.min(
      ME2_PRIMARY_PAGEBAR_HEIGHT
        + ME2_PRIMARY_STATUSBAR_HEIGHT
        + ME2_PRIMARY_PAGE_PADDING,
      Math.max(0, windowHeight - top),
    );
    const preferredLeft = ME2_PRIMARY_PAGE_PADDING
      + ME2_PRIMARY_COMMAND_SIDEBAR_WIDTH
      + ME2_PRIMARY_COMMAND_GAP;
    left = windowWidth - preferredLeft >= SHELL_MIN_REMOTE_WIDTH
      ? preferredLeft
      : ME2_PRIMARY_PAGE_PADDING;
    right = ME2_PRIMARY_PAGE_PADDING;
    contentWidth = Math.max(0, windowWidth - left - right);
    remoteHeight = Math.max(0, windowHeight - top - bottom);
    effectiveSidebar = left === preferredLeft ? 'EXPANDED' : 'HIDDEN';
    effectiveOperations = 'CLOSED';
    if (left !== preferredLeft) adaptations.push('ME2_AGENT_RAIL_RESERVED_SPACE_RELEASED_FOR_ACTIVE_SURFACE');
  } else if (surfaceProfile !== 'LEGACY_BROWSER_SHELL') {
    surfaceProfile = 'LEGACY_BROWSER_SHELL';
  }

  const activeSurfaceWidthTarget = Math.min(SHELL_MIN_REMOTE_WIDTH, windowWidth);

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
    chrome_degrades_before_active_surface: true,
    adaptations: Object.freeze(adaptations),
    adapted: adaptations.length > 0,
    overlay_remote_content: false,
    renderer_dimensions_authoritative: false,
    authority_effect: false,
  });
}
