import {
  METAENGINE_DEVOS_SESSION_LAYOUT_ENTRY_SCHEMA,
  METAENGINE_DEVOS_SESSION_LAYOUT_SCHEMA,
  createDevOSSessionLayoutRegistry,
} from './metaengine-devos-session-layout.mjs';

export const METAENGINE_DEVOS_SESSION_LAYOUT_PROJECTION_SCHEMA = 'metaengine.devos.session-layout-projection.v1';

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

function hasZeroAuthorityContract(value) {
  return value
    && value.projection_is_authority === false
    && value.scheduler_authority === false
    && value.execution_authority === false
    && value.command_leasing === false
    && value.automatic_effect_retry_allowed === false
    && value.page_model_authority === false
    && value.authority_effect === false;
}

function text(value, max = 240) {
  const out = String(value ?? '').trim();
  return out ? out.slice(0, max) : null;
}

function unavailableProjection(devos, sourceState, registryReason = null) {
  const selectedSessionId = text(devos?.selected?.session_id, 200);
  const selectedSurfaceId = text(devos?.selected?.surface_id, 240);
  return Object.freeze({
    schema: METAENGINE_DEVOS_SESSION_LAYOUT_PROJECTION_SCHEMA,
    source_state: sourceState,
    registry_reason: registryReason,
    selected_session_id: selectedSessionId,
    selected_surface_id: selectedSurfaceId,
    registry_active_session_id: null,
    selection_alignment: selectedSessionId ? 'REGISTRY_NOT_AVAILABLE' : 'NO_SELECTED_SESSION',
    entries: Object.freeze([]),
    active: selectedSessionId ? Object.freeze({
      session_id: selectedSessionId,
      requested_sidebar: 'EXPANDED',
      requested_inspector: 'CLOSED',
      stored_surface_id: null,
      selected_surface_id: selectedSurfaceId,
      source: 'DEFAULT_SESSION_PREFERENCE',
      stored_surface_is_focus_preference: true,
      stored_surface_is_selection_authority: false,
      ...zeroAuthorityContract(),
    }) : null,
    selected_session_is_authoritative_from_devos: true,
    registry_active_session_is_selection_authority: false,
    stored_surface_is_selection_authority: false,
    effective_responsive_state_persisted: false,
    ...zeroAuthorityContract(),
  });
}

function validDevOS(devos) {
  return devos
    && devos.schema === 'metaengine.devos.projection.v1'
    && devos.primary_object === 'SESSION'
    && Array.isArray(devos.sessions)
    && devos.selected
    && typeof devos.selected === 'object'
    && hasZeroAuthorityContract(devos);
}

function projectEntry(entry) {
  return Object.freeze({
    schema: METAENGINE_DEVOS_SESSION_LAYOUT_ENTRY_SCHEMA,
    session_id: entry.session_id,
    requested_sidebar: entry.requested_sidebar,
    requested_inspector: entry.requested_inspector,
    stored_surface_id: entry.active_surface_id,
    revision: entry.revision,
    updated_sequence: entry.updated_sequence,
    stored_surface_is_focus_preference: true,
    stored_surface_is_selection_authority: false,
    ...zeroAuthorityContract(),
  });
}

export function projectDevOSSessionLayout(devos, registrySnapshot = null) {
  if (!validDevOS(devos)) return unavailableProjection(devos, 'INVALID_DEVOS', 'DEVOS_PROJECTION_INVALID');
  if (registrySnapshot == null) return unavailableProjection(devos, 'NOT_EXPOSED');

  let validated;
  try {
    if (registrySnapshot.schema !== METAENGINE_DEVOS_SESSION_LAYOUT_SCHEMA) throw new Error('registry_schema_invalid');
    const validator = createDevOSSessionLayoutRegistry({ max_sessions: 512 });
    validated = validator.restore(registrySnapshot);
  } catch (error) {
    return unavailableProjection(devos, 'INVALID_REGISTRY', text(error?.message, 200) || 'REGISTRY_INVALID');
  }

  const sessionIds = new Set(devos.sessions.map((session) => text(session?.session_id, 200)).filter(Boolean));
  const selectedSessionId = text(devos.selected.session_id, 200);
  const selectedSurfaceId = text(devos.selected.surface_id, 240);
  const entries = validated.entries
    .filter((entry) => sessionIds.has(entry.session_id))
    .map(projectEntry);
  const bySession = new Map(entries.map((entry) => [entry.session_id, entry]));
  const activeEntry = selectedSessionId ? bySession.get(selectedSessionId) || null : null;
  const registryActive = text(validated.active_session_id, 200);
  const selectionAlignment = !selectedSessionId
    ? 'NO_SELECTED_SESSION'
    : (registryActive === selectedSessionId ? 'ALIGNED' : 'STALE_REGISTRY_ACTIVE_SESSION');

  return Object.freeze({
    schema: METAENGINE_DEVOS_SESSION_LAYOUT_PROJECTION_SCHEMA,
    source_state: 'AVAILABLE',
    registry_reason: null,
    selected_session_id: selectedSessionId,
    selected_surface_id: selectedSurfaceId,
    registry_active_session_id: registryActive,
    selection_alignment: selectionAlignment,
    entries: Object.freeze(entries),
    active: selectedSessionId ? Object.freeze({
      session_id: selectedSessionId,
      requested_sidebar: activeEntry?.requested_sidebar || 'EXPANDED',
      requested_inspector: activeEntry?.requested_inspector || 'CLOSED',
      stored_surface_id: activeEntry?.stored_surface_id || null,
      selected_surface_id: selectedSurfaceId,
      source: activeEntry ? 'REGISTRY' : 'DEFAULT_SESSION_PREFERENCE',
      stored_surface_is_focus_preference: true,
      stored_surface_is_selection_authority: false,
      ...zeroAuthorityContract(),
    }) : null,
    selected_session_is_authoritative_from_devos: true,
    registry_active_session_is_selection_authority: false,
    stored_surface_is_selection_authority: false,
    effective_responsive_state_persisted: false,
    ...zeroAuthorityContract(),
  });
}

export function attachDevOSSessionLayout(devos, registrySnapshot = null) {
  const layoutPreferences = projectDevOSSessionLayout(devos, registrySnapshot);
  if (!devos || typeof devos !== 'object') {
    return Object.freeze({ layout_preferences: layoutPreferences, ...zeroAuthorityContract() });
  }
  return Object.freeze({ ...devos, layout_preferences: layoutPreferences });
}
