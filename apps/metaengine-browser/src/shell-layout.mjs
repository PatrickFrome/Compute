export const SHELL_TOP_HEIGHT = 52;
export const SHELL_SIDEBAR_EXPANDED_WIDTH = 288;
export const SHELL_SIDEBAR_COMPACT_WIDTH = 64;
export const SHELL_OPERATIONS_WIDTH = 368;
export const SHELL_MIN_REMOTE_WIDTH = 680;

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
      operations: 'OPEN',
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

export function planShellLayout({ width, height, state } = {}) {
  const windowWidth = finiteDimension(width, 'width');
  const windowHeight = finiteDimension(height, 'height');
  const requested = state?.schema === 'metaengine.browser-shell.layout-state.v1'
    ? normalizeShellLayoutState(state)
    : normalizeShellLayoutState(state ?? null);

  let effectiveSidebar = requested.sidebar;
  let effectiveOperations = requested.operations;
  let left = sidebarWidth(effectiveSidebar);
  let right = effectiveOperations === 'OPEN' ? SHELL_OPERATIONS_WIDTH : 0;

  const remoteWidth = () => Math.max(0, windowWidth - left - right);

  // Degrade presentation only. Requested state is retained and no hidden actuation is
  // performed. The remote page always gets a real, non-overlapped rectangle.
  if (remoteWidth() < SHELL_MIN_REMOTE_WIDTH && effectiveSidebar === 'EXPANDED') {
    effectiveSidebar = 'COMPACT';
    left = SHELL_SIDEBAR_COMPACT_WIDTH;
  }
  if (remoteWidth() < SHELL_MIN_REMOTE_WIDTH && effectiveOperations === 'OPEN') {
    effectiveOperations = 'CLOSED';
    right = 0;
  }
  if (remoteWidth() < SHELL_MIN_REMOTE_WIDTH && effectiveSidebar === 'COMPACT') {
    effectiveSidebar = 'HIDDEN';
    left = 0;
  }

  const top = Math.min(SHELL_TOP_HEIGHT, windowHeight);
  const remoteHeight = Math.max(0, windowHeight - top);
  const contentWidth = Math.max(0, windowWidth - left - right);

  return Object.freeze({
    schema: 'metaengine.browser-shell.layout-plan.v1',
    requested: structuredClone(requested),
    effective_sidebar: effectiveSidebar,
    effective_operations: effectiveOperations,
    shell_bounds: Object.freeze({ x: 0, y: 0, width: windowWidth, height: windowHeight }),
    remote_bounds: Object.freeze({ x: left, y: top, width: contentWidth, height: remoteHeight }),
    sidebar_bounds: Object.freeze({ x: 0, y: top, width: left, height: remoteHeight }),
    operations_bounds: Object.freeze({ x: Math.max(0, windowWidth - right), y: top, width: right, height: remoteHeight }),
    remote_min_width: SHELL_MIN_REMOTE_WIDTH,
    overlay_remote_content: false,
    renderer_dimensions_authoritative: false,
    authority_effect: false,
  });
}
