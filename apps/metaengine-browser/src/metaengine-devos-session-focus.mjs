export const METAENGINE_DEVOS_SESSION_FOCUS_PLAN_SCHEMA = 'metaengine.devos.session-focus-plan.v1';
export const METAENGINE_DEVOS_SURFACE_FOCUS_PLAN_SCHEMA = 'metaengine.devos.surface-focus-plan.v1';

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

function hasZeroAuthority(value) {
  return value
    && value.projection_is_authority === false
    && value.scheduler_authority === false
    && value.execution_authority === false
    && value.command_leasing === false
    && value.automatic_effect_retry_allowed === false
    && value.page_model_authority === false
    && value.authority_effect === false;
}

function id(value, label, max = 240) {
  const out = String(value ?? '').trim();
  if (!out || out.length > max || /[\u0000-\u001f\u007f]/.test(out)) throw new Error(`devos_focus_${label}_invalid`);
  return out;
}

function invalidPlan(schema, reason, requested = {}) {
  return Object.freeze({
    schema,
    valid: false,
    reason: String(reason || 'INVALID_DEVOS').slice(0, 200),
    requested_session_id: requested.session_id || null,
    requested_surface_id: requested.surface_id || null,
    target_session_id: null,
    target_surface_id: null,
    target_tab_id: null,
    surface_selection_required: false,
    session_only: false,
    shell_navigation_required: false,
    explicit_user_intent_required: true,
    automatic_surface_selection: false,
    stored_focus_is_execution_authority: false,
    plan_is_execution_authority: false,
    ...zeroAuthorityContract(),
  });
}

function validateDevOS(devos) {
  if (!devos
    || devos.schema !== 'metaengine.devos.projection.v1'
    || devos.primary_object !== 'SESSION'
    || devos.browser_is_shell !== false
    || devos.browser_is_surface !== true
    || !hasZeroAuthority(devos)
    || !Array.isArray(devos.sessions)
    || !Array.isArray(devos.surfaces)
    || !devos.selected
    || typeof devos.selected !== 'object') return null;

  const sessions = new Map();
  for (const source of devos.sessions) {
    let sessionId;
    try { sessionId = id(source?.session_id, 'session_id', 200); }
    catch { return null; }
    if (sessions.has(sessionId) || !hasZeroAuthority(source)) return null;
    sessions.set(sessionId, source);
  }

  const surfaces = new Map();
  for (const source of devos.surfaces) {
    let surfaceId;
    let sessionId;
    try {
      surfaceId = id(source?.surface_id, 'surface_id');
      sessionId = id(source?.session_id, 'surface_session_id', 200);
    } catch { return null; }
    if (surfaces.has(surfaceId) || !sessions.has(sessionId) || !hasZeroAuthority(source)) return null;
    surfaces.set(surfaceId, source);
  }

  const selectedSessionId = devos.selected.session_id == null ? null : String(devos.selected.session_id).trim();
  const selectedSurfaceId = devos.selected.surface_id == null ? null : String(devos.selected.surface_id).trim();
  if (selectedSessionId && !sessions.has(selectedSessionId)) return null;
  if (selectedSurfaceId) {
    const surface = surfaces.get(selectedSurfaceId);
    if (!surface || String(surface.session_id) !== selectedSessionId) return null;
  }
  return { sessions, surfaces, selectedSessionId, selectedSurfaceId };
}

function storedFocusFor(devos, sessionId, surfaces) {
  const prefs = devos?.layout_preferences;
  if (!prefs
    || prefs.schema !== 'metaengine.devos.session-layout-projection.v1'
    || !hasZeroAuthority(prefs)
    || prefs.stored_surface_is_selection_authority !== false
    || !Array.isArray(prefs.entries)) return null;
  const row = prefs.entries.find((entry) => String(entry?.session_id || '') === sessionId);
  if (!row
    || row.schema !== 'metaengine.devos.session-layout-preference.v1'
    || !hasZeroAuthority(row)
    || row.stored_surface_is_selection_authority !== false) return null;
  const surfaceId = String(row.stored_surface_id || '').trim();
  if (!surfaceId) return null;
  const surface = surfaces.get(surfaceId);
  if (!surface || String(surface.session_id) !== sessionId) return null;
  return surface;
}

function browserSurfaceRows(sessionId, surfaces) {
  return [...surfaces.values()].filter((surface) => String(surface.session_id) === sessionId && String(surface.type || '').toUpperCase() === 'BROWSER');
}

function tabIdFor(surface) {
  const value = String(surface?.tab_id || '').trim();
  return value || null;
}

export function planDevOSSessionFocus(devos, request = {}) {
  let requestedSessionId = null;
  try { requestedSessionId = id(request.session_id, 'requested_session_id', 200); }
  catch (error) { return invalidPlan(METAENGINE_DEVOS_SESSION_FOCUS_PLAN_SCHEMA, error.message); }

  const validated = validateDevOS(devos);
  if (!validated) return invalidPlan(METAENGINE_DEVOS_SESSION_FOCUS_PLAN_SCHEMA, 'DEVOS_PROJECTION_INVALID', { session_id: requestedSessionId });
  const { sessions, surfaces, selectedSessionId, selectedSurfaceId } = validated;
  if (!sessions.has(requestedSessionId)) return invalidPlan(METAENGINE_DEVOS_SESSION_FOCUS_PLAN_SCHEMA, 'SESSION_NOT_FOUND', { session_id: requestedSessionId });

  const browserSurfaces = browserSurfaceRows(requestedSessionId, surfaces);
  const currentSurface = selectedSurfaceId ? surfaces.get(selectedSurfaceId) : null;
  let target = null;
  let targetReason = null;

  if (selectedSessionId === requestedSessionId && currentSurface && String(currentSurface.session_id) === requestedSessionId) {
    target = currentSurface;
    targetReason = 'CURRENT_SELECTED_SURFACE';
  } else {
    const stored = storedFocusFor(devos, requestedSessionId, surfaces);
    if (stored && String(stored.type || '').toUpperCase() === 'BROWSER') {
      target = stored;
      targetReason = 'STORED_FOCUS_PREFERENCE';
    } else if (browserSurfaces.length === 1) {
      target = browserSurfaces[0];
      targetReason = 'ONLY_BROWSER_SURFACE';
    }
  }

  const targetSurfaceId = target ? String(target.surface_id) : null;
  const targetTabId = target ? tabIdFor(target) : null;
  const sessionOnly = browserSurfaces.length === 0;
  const surfaceSelectionRequired = !sessionOnly && !target && browserSurfaces.length > 1;

  return Object.freeze({
    schema: METAENGINE_DEVOS_SESSION_FOCUS_PLAN_SCHEMA,
    valid: true,
    reason: targetReason || (surfaceSelectionRequired ? 'EXPLICIT_SURFACE_SELECTION_REQUIRED' : 'SESSION_HAS_NO_BROWSER_SURFACE'),
    requested_session_id: requestedSessionId,
    requested_surface_id: null,
    target_session_id: requestedSessionId,
    target_surface_id: targetSurfaceId,
    target_tab_id: targetTabId,
    surface_selection_required: surfaceSelectionRequired,
    session_only: sessionOnly,
    browser_surface_count: browserSurfaces.length,
    shell_navigation_required: Boolean(targetTabId && targetSurfaceId !== selectedSurfaceId),
    explicit_user_intent_required: true,
    automatic_surface_selection: false,
    stored_focus_is_execution_authority: false,
    plan_is_execution_authority: false,
    ...zeroAuthorityContract(),
  });
}

export function planDevOSSurfaceFocus(devos, request = {}) {
  let requestedSessionId = null;
  let requestedSurfaceId = null;
  try {
    requestedSessionId = id(request.session_id, 'requested_session_id', 200);
    requestedSurfaceId = id(request.surface_id, 'requested_surface_id');
  } catch (error) {
    return invalidPlan(METAENGINE_DEVOS_SURFACE_FOCUS_PLAN_SCHEMA, error.message, { session_id: requestedSessionId, surface_id: requestedSurfaceId });
  }

  const validated = validateDevOS(devos);
  if (!validated) return invalidPlan(METAENGINE_DEVOS_SURFACE_FOCUS_PLAN_SCHEMA, 'DEVOS_PROJECTION_INVALID', { session_id: requestedSessionId, surface_id: requestedSurfaceId });
  const { sessions, surfaces, selectedSurfaceId } = validated;
  if (!sessions.has(requestedSessionId)) return invalidPlan(METAENGINE_DEVOS_SURFACE_FOCUS_PLAN_SCHEMA, 'SESSION_NOT_FOUND', { session_id: requestedSessionId, surface_id: requestedSurfaceId });
  const surface = surfaces.get(requestedSurfaceId);
  if (!surface) return invalidPlan(METAENGINE_DEVOS_SURFACE_FOCUS_PLAN_SCHEMA, 'SURFACE_NOT_FOUND', { session_id: requestedSessionId, surface_id: requestedSurfaceId });
  if (String(surface.session_id) !== requestedSessionId) return invalidPlan(METAENGINE_DEVOS_SURFACE_FOCUS_PLAN_SCHEMA, 'SURFACE_SESSION_MISMATCH', { session_id: requestedSessionId, surface_id: requestedSurfaceId });
  const type = String(surface.type || '').toUpperCase();
  const targetTabId = type === 'BROWSER' ? tabIdFor(surface) : null;
  if (type === 'BROWSER' && !targetTabId) return invalidPlan(METAENGINE_DEVOS_SURFACE_FOCUS_PLAN_SCHEMA, 'BROWSER_SURFACE_TAB_BINDING_MISSING', { session_id: requestedSessionId, surface_id: requestedSurfaceId });

  return Object.freeze({
    schema: METAENGINE_DEVOS_SURFACE_FOCUS_PLAN_SCHEMA,
    valid: true,
    reason: requestedSurfaceId === selectedSurfaceId ? 'SURFACE_ALREADY_SELECTED' : 'EXPLICIT_SURFACE_SELECTION',
    requested_session_id: requestedSessionId,
    requested_surface_id: requestedSurfaceId,
    target_session_id: requestedSessionId,
    target_surface_id: requestedSurfaceId,
    target_tab_id: targetTabId,
    surface_type: type || 'UNKNOWN',
    surface_selection_required: false,
    session_only: false,
    shell_navigation_required: Boolean(targetTabId && requestedSurfaceId !== selectedSurfaceId),
    explicit_user_intent_required: true,
    automatic_surface_selection: false,
    stored_focus_is_execution_authority: false,
    plan_is_execution_authority: false,
    ...zeroAuthorityContract(),
  });
}
