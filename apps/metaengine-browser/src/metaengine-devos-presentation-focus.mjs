export const METAENGINE_DEVOS_PRESENTATION_FOCUS_SCHEMA = 'metaengine.devos.presentation-focus.v1';
export const METAENGINE_DEVOS_PRESENTATION_FOCUS_RECONCILE_SCHEMA = 'metaengine.devos.presentation-focus-reconcile.v1';

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

function boundedId(value, label, max = 240) {
  const out = String(value ?? '').trim();
  if (!out || out.length > max || /[\u0000-\u001f\u007f]/.test(out)) throw new Error(`devos_presentation_focus_${label}_invalid`);
  return out;
}

function frozenState({ sessionId = null, surfaceId = null, revision = 0 } = {}) {
  return Object.freeze({
    schema: METAENGINE_DEVOS_PRESENTATION_FOCUS_SCHEMA,
    source: 'USER_SHELL_EXPLICIT',
    active_session_id: sessionId,
    active_surface_id: surfaceId,
    revision,
    presentation_only: true,
    durable_persistence_enabled: false,
    browser_tab_selection_is_focus_authority: false,
    layout_preference_is_focus_authority: false,
    model_or_page_is_focus_authority: false,
    ...zeroAuthorityContract(),
  });
}

function invalidReconcile(reason, state = null) {
  return Object.freeze({
    schema: METAENGINE_DEVOS_PRESENTATION_FOCUS_RECONCILE_SCHEMA,
    valid: false,
    source_state: 'INVALID_DEVOS',
    reason: String(reason || 'DEVOS_PROJECTION_INVALID').slice(0, 200),
    requested_session_id: state?.active_session_id || null,
    requested_surface_id: state?.active_surface_id || null,
    effective_session_id: null,
    effective_surface_id: null,
    session_focus_valid: false,
    surface_focus_valid: false,
    stale_focus_detected: false,
    replacement_selected_automatically: false,
    presentation_only: true,
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
    || !Array.isArray(devos.surfaces)) return null;
  const sessions = new Map();
  for (const row of devos.sessions) {
    let sessionId;
    try { sessionId = boundedId(row?.session_id, 'session_id', 200); }
    catch { return null; }
    if (sessions.has(sessionId) || !hasZeroAuthority(row)) return null;
    sessions.set(sessionId, row);
  }
  const surfaces = new Map();
  for (const row of devos.surfaces) {
    let surfaceId;
    let sessionId;
    try {
      surfaceId = boundedId(row?.surface_id, 'surface_id');
      sessionId = boundedId(row?.session_id, 'surface_session_id', 200);
    } catch { return null; }
    if (surfaces.has(surfaceId) || !sessions.has(sessionId) || !hasZeroAuthority(row)) return null;
    surfaces.set(surfaceId, row);
  }
  return { sessions, surfaces };
}

export class DevOSPresentationFocusState {
  #sessionId = null;
  #surfaceId = null;
  #revision = 0;

  selectSession(sessionId) {
    const id = boundedId(sessionId, 'session_id', 200);
    if (this.#sessionId === id && this.#surfaceId == null) return this.snapshot();
    this.#sessionId = id;
    this.#surfaceId = null;
    this.#revision += 1;
    return this.snapshot();
  }

  selectSurface(sessionId, surfaceId) {
    const session = boundedId(sessionId, 'session_id', 200);
    const surface = boundedId(surfaceId, 'surface_id');
    if (this.#sessionId === session && this.#surfaceId === surface) return this.snapshot();
    this.#sessionId = session;
    this.#surfaceId = surface;
    this.#revision += 1;
    return this.snapshot();
  }

  clear() {
    if (this.#sessionId == null && this.#surfaceId == null) return this.snapshot();
    this.#sessionId = null;
    this.#surfaceId = null;
    this.#revision += 1;
    return this.snapshot();
  }

  snapshot() {
    return frozenState({ sessionId: this.#sessionId, surfaceId: this.#surfaceId, revision: this.#revision });
  }

  reconcile(devos) {
    const state = this.snapshot();
    const validated = validateDevOS(devos);
    if (!validated) return invalidReconcile('DEVOS_PROJECTION_INVALID', state);
    const { sessions, surfaces } = validated;

    if (!state.active_session_id) {
      return Object.freeze({
        schema: METAENGINE_DEVOS_PRESENTATION_FOCUS_RECONCILE_SCHEMA,
        valid: true,
        source_state: 'EMPTY',
        reason: 'NO_EXPLICIT_PRESENTATION_FOCUS',
        requested_session_id: null,
        requested_surface_id: null,
        effective_session_id: null,
        effective_surface_id: null,
        session_focus_valid: false,
        surface_focus_valid: false,
        stale_focus_detected: false,
        replacement_selected_automatically: false,
        presentation_only: true,
        ...zeroAuthorityContract(),
      });
    }

    if (!sessions.has(state.active_session_id)) {
      return Object.freeze({
        schema: METAENGINE_DEVOS_PRESENTATION_FOCUS_RECONCILE_SCHEMA,
        valid: true,
        source_state: 'STALE_SESSION',
        reason: 'EXPLICIT_SESSION_NO_LONGER_PRESENT',
        requested_session_id: state.active_session_id,
        requested_surface_id: state.active_surface_id,
        effective_session_id: null,
        effective_surface_id: null,
        session_focus_valid: false,
        surface_focus_valid: false,
        stale_focus_detected: true,
        replacement_selected_automatically: false,
        presentation_only: true,
        ...zeroAuthorityContract(),
      });
    }

    if (!state.active_surface_id) {
      return Object.freeze({
        schema: METAENGINE_DEVOS_PRESENTATION_FOCUS_RECONCILE_SCHEMA,
        valid: true,
        source_state: 'SESSION_ONLY',
        reason: 'EXPLICIT_SESSION_WITHOUT_SURFACE',
        requested_session_id: state.active_session_id,
        requested_surface_id: null,
        effective_session_id: state.active_session_id,
        effective_surface_id: null,
        session_focus_valid: true,
        surface_focus_valid: false,
        stale_focus_detected: false,
        replacement_selected_automatically: false,
        presentation_only: true,
        ...zeroAuthorityContract(),
      });
    }

    const surface = surfaces.get(state.active_surface_id);
    if (!surface || String(surface.session_id) !== state.active_session_id) {
      return Object.freeze({
        schema: METAENGINE_DEVOS_PRESENTATION_FOCUS_RECONCILE_SCHEMA,
        valid: true,
        source_state: 'STALE_SURFACE',
        reason: surface ? 'EXPLICIT_SURFACE_SESSION_MISMATCH' : 'EXPLICIT_SURFACE_NO_LONGER_PRESENT',
        requested_session_id: state.active_session_id,
        requested_surface_id: state.active_surface_id,
        effective_session_id: state.active_session_id,
        effective_surface_id: null,
        session_focus_valid: true,
        surface_focus_valid: false,
        stale_focus_detected: true,
        replacement_selected_automatically: false,
        presentation_only: true,
        ...zeroAuthorityContract(),
      });
    }

    return Object.freeze({
      schema: METAENGINE_DEVOS_PRESENTATION_FOCUS_RECONCILE_SCHEMA,
      valid: true,
      source_state: 'AVAILABLE',
      reason: 'EXPLICIT_PRESENTATION_FOCUS_CURRENT',
      requested_session_id: state.active_session_id,
      requested_surface_id: state.active_surface_id,
      effective_session_id: state.active_session_id,
      effective_surface_id: state.active_surface_id,
      session_focus_valid: true,
      surface_focus_valid: true,
      stale_focus_detected: false,
      replacement_selected_automatically: false,
      presentation_only: true,
      ...zeroAuthorityContract(),
    });
  }
}

export function createDevOSPresentationFocusState() {
  return new DevOSPresentationFocusState();
}
