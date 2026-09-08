import { reconcileDevOSPresentationFocus } from './metaengine-devos-presentation-focus.mjs';

export const METAENGINE_DEVOS_SHELL_VIEW_MODEL_SCHEMA = 'metaengine.devos.shell-view-model.v1';

const SESSION_GROUP_ORDER = Object.freeze(['NEEDS_ATTENTION', 'ACTIVE', 'BACKGROUND', 'COMPLETED', 'UNBOUND']);
const SELECTED_SESSION_SURFACE_LIMIT = 256;
const TIMELINE_ENTRY_LIMIT = 32;

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

function freezeRow(row) {
  return Object.freeze({ ...row, ...zeroAuthorityContract() });
}

function timelinePayload(surface) {
  const source = Array.isArray(surface?.timeline_entries) ? surface.timeline_entries.slice(0, TIMELINE_ENTRY_LIMIT) : [];
  const rows = [];
  for (const row of source) {
    if (!hasZeroAuthorityContract(row)) return null;
    rows.push(freezeRow({
      task_id: text(row.task_id, 160),
      title: text(row.title, 320) || text(row.task_id, 160) || 'Task',
      status: text(row.status, 48) || 'UNKNOWN',
      updated_at: text(row.updated_at, 80),
      blocker: text(row.blocker, 320),
    }));
  }
  return Object.freeze(rows);
}

function surfaceView(surface, surfaceId = null) {
  const id = surfaceId || text(surface?.surface_id, 240);
  const type = text(surface?.type, 48) || 'UNKNOWN';
  const base = {
    surface_id: id,
    session_id: text(surface?.session_id, 200),
    type,
    title: text(surface?.title, 300) || id,
    state: text(surface?.state, 48) || 'UNKNOWN',
    tab_id: text(surface?.tab_id, 200),
    runtime_bound: type === 'BROWSER' && Boolean(text(surface?.tab_id, 200)),
    presentation_only: type !== 'BROWSER',
  };
  if (type === 'ARTIFACT') {
    base.artifact_id = text(surface?.artifact_id, 240);
    base.artifact_ref = text(surface?.artifact_ref, 500);
    base.immutable_reference = surface?.immutable_reference === true;
  } else if (type === 'TIMELINE') {
    const timeline = timelinePayload(surface);
    if (!timeline) return null;
    base.timeline_entries = timeline;
    base.timeline_entry_count = Math.max(timeline.length, Number(surface?.timeline_entry_count || 0));
  } else if (type === 'MEMORY') {
    base.episode_count = Math.max(0, Number(surface?.episode_count || 0));
    base.semantic_fact_count = Math.max(0, Number(surface?.semantic_fact_count || 0));
    base.procedural_playbook_count = Math.max(0, Number(surface?.procedural_playbook_count || 0));
  }
  return freezeRow(base);
}

function invalidView(reason) {
  return Object.freeze({
    schema: METAENGINE_DEVOS_SHELL_VIEW_MODEL_SCHEMA,
    valid: false,
    reason: text(reason, 200) || 'INVALID_DEVOS',
    primary_object: 'SESSION',
    roots: Object.freeze([]),
    session_groups: Object.freeze([]),
    now: Object.freeze([]),
    selected_session: null,
    selected_surface: null,
    selected_session_surfaces: Object.freeze([]),
    selected_session_surface_count: 0,
    selected_session_surfaces_truncated: false,
    presentation_focus: null,
    layout_preferences: null,
    counts: Object.freeze({ sessions: 0, surfaces: 0, attention: 0, visible_groups: 0 }),
    browser_is_shell: false,
    browser_is_surface: true,
    renderer_selection_authority: false,
    renderer_routing_authority: false,
    ...zeroAuthorityContract(),
  });
}

function validateRoot(root) {
  const rootId = text(root?.root_id, 64);
  const label = text(root?.label, 80);
  return rootId && label && hasZeroAuthorityContract(root)
    ? freezeRow({ root_id: rootId, label, source_state: text(root.source_state, 48) || 'UNKNOWN', count: Math.max(0, Number(root.count || 0)), state: text(root.state, 48) || 'UNKNOWN' })
    : null;
}

function selectedLayout(devos, selectedSessionId) {
  const prefs = devos?.layout_preferences;
  if (!prefs || !selectedSessionId) return null;
  if (prefs.schema !== 'metaengine.devos.session-layout-projection.v1' || !hasZeroAuthorityContract(prefs) || !Array.isArray(prefs.entries)) return null;
  const active = prefs.entries.find((entry) => text(entry?.session_id, 200) === selectedSessionId) || null;
  if (active && (active.schema !== 'metaengine.devos.session-layout-preference.v1' || !hasZeroAuthorityContract(active) || active.stored_surface_is_selection_authority !== false)) return null;
  return freezeRow({
    source_state: text(prefs.source_state, 48) || 'UNKNOWN',
    selection_alignment: text(prefs.selection_alignment, 80) || 'UNKNOWN',
    requested_sidebar: text(active?.requested_sidebar, 32) || 'EXPANDED',
    requested_inspector: text(active?.requested_inspector, 32) || 'CLOSED',
    requested_surface_layout: text(active?.requested_surface_layout, 40) || 'AUTO',
    stored_surface_id: text(active?.stored_surface_id, 240),
    stored_surface_is_focus_preference: active ? active.stored_surface_is_focus_preference === true : true,
    stored_surface_is_selection_authority: false,
  });
}

export function projectDevOSShellViewModel(devos, presentationFocusState = null) {
  if (!devos
    || devos.schema !== 'metaengine.devos.projection.v1'
    || devos.primary_object !== 'SESSION'
    || devos.browser_is_shell !== false
    || devos.browser_is_surface !== true
    || !hasZeroAuthorityContract(devos)
    || !Array.isArray(devos.sessions)
    || !Array.isArray(devos.surfaces)
    || !Array.isArray(devos.attention)
    || !devos.selected
    || typeof devos.selected !== 'object'
    || !devos.navigation
    || devos.navigation.schema !== 'metaengine.devos.navigation.v1'
    || !hasZeroAuthorityContract(devos.navigation)
    || !Array.isArray(devos.navigation.roots)
    || !Array.isArray(devos.navigation.session_groups)) {
    return invalidView('DEVOS_PROJECTION_INVALID');
  }

  const sessions = new Map();
  for (const source of devos.sessions) {
    const sessionId = text(source?.session_id, 200);
    if (!sessionId || sessions.has(sessionId) || !hasZeroAuthorityContract(source)) return invalidView('SESSION_SET_INVALID');
    sessions.set(sessionId, source);
  }
  const surfaces = new Map();
  for (const source of devos.surfaces) {
    const surfaceId = text(source?.surface_id, 240);
    const sessionId = text(source?.session_id, 200);
    if (!surfaceId || surfaces.has(surfaceId) || !sessionId || !sessions.has(sessionId) || !hasZeroAuthorityContract(source)) return invalidView('SURFACE_SET_INVALID');
    surfaces.set(surfaceId, source);
  }

  const canonicalSessionId = text(devos.selected.session_id, 200);
  const canonicalSurfaceId = text(devos.selected.surface_id, 240);
  const canonicalSession = canonicalSessionId ? sessions.get(canonicalSessionId) : null;
  const canonicalSurface = canonicalSurfaceId ? surfaces.get(canonicalSurfaceId) : null;
  if ((canonicalSessionId && !canonicalSession) || (canonicalSurfaceId && !canonicalSurface)) return invalidView('SELECTION_NOT_FOUND');
  if (canonicalSurface && canonicalSurface.session_id !== canonicalSessionId) return invalidView('SELECTION_OWNERSHIP_MISMATCH');

  const presentationFocus = reconcileDevOSPresentationFocus(presentationFocusState, devos);
  if (!presentationFocus.valid) return invalidView(presentationFocus.reason || 'PRESENTATION_FOCUS_INVALID');
  const selectedSessionId = text(presentationFocus.effective_session_id, 200);
  const selectedSurfaceId = text(presentationFocus.effective_surface_id, 240);
  const selectedSession = selectedSessionId ? sessions.get(selectedSessionId) : null;
  const selectedSurface = selectedSurfaceId ? surfaces.get(selectedSurfaceId) : null;
  if ((selectedSessionId && !selectedSession) || (selectedSurfaceId && !selectedSurface)) return invalidView('PRESENTATION_FOCUS_NOT_FOUND');
  if (selectedSurface && selectedSurface.session_id !== selectedSessionId) return invalidView('PRESENTATION_FOCUS_OWNERSHIP_MISMATCH');

  const roots = [];
  const rootIds = new Set();
  for (const source of devos.navigation.roots) {
    const row = validateRoot(source);
    if (!row || rootIds.has(row.root_id)) return invalidView('NAVIGATION_ROOT_INVALID');
    rootIds.add(row.root_id);
    roots.push(row);
  }

  const groupsById = new Map();
  const assignedSessions = new Set();
  for (const source of devos.navigation.session_groups) {
    const groupId = text(source?.group_id, 64);
    if (!SESSION_GROUP_ORDER.includes(groupId) || groupsById.has(groupId) || !hasZeroAuthorityContract(source) || !Array.isArray(source.session_ids)) {
      return invalidView('SESSION_GROUP_INVALID');
    }
    const rows = [];
    for (const rawId of source.session_ids) {
      const sessionId = text(rawId, 200);
      const session = sessionId ? sessions.get(sessionId) : null;
      if (!session || assignedSessions.has(sessionId)) return invalidView('SESSION_GROUP_MEMBERSHIP_INVALID');
      assignedSessions.add(sessionId);
      rows.push(freezeRow({
        session_id: sessionId,
        title: text(session.title, 300) || sessionId,
        status: text(session.status, 48) || 'UNKNOWN',
        browser_only: session.browser_only === true,
        task_count: Math.max(0, Number(session.task_count || 0)),
        surface_count: Array.isArray(session.surface_ids) ? session.surface_ids.length : 0,
        selected: sessionId === selectedSessionId,
      }));
    }
    groupsById.set(groupId, freezeRow({ group_id: groupId, count: rows.length, sessions: Object.freeze(rows) }));
  }
  if (assignedSessions.size !== sessions.size) return invalidView('SESSION_GROUP_COVERAGE_INVALID');
  const sessionGroups = SESSION_GROUP_ORDER.map((groupId) => groupsById.get(groupId)).filter(Boolean);

  const now = [];
  for (const source of devos.attention.slice(0, 256)) {
    if (!hasZeroAuthorityContract(source)) return invalidView('ATTENTION_ROW_INVALID');
    const sessionId = text(source.session_id, 200);
    if (sessionId && !sessions.has(sessionId)) return invalidView('ATTENTION_SESSION_INVALID');
    now.push(freezeRow({
      kind: text(source.kind, 64) || 'UNKNOWN',
      severity: text(source.severity, 32) || 'UNKNOWN',
      priority: text(source.priority, 32) || 'UNKNOWN',
      session_id: sessionId,
      task_id: text(source.task_id, 200),
      title: text(source.title, 600) || 'Attention required',
      reason: text(source.reason, 800),
    }));
  }

  const selectedSessionView = selectedSession ? freezeRow({
    session_id: selectedSessionId,
    title: text(selectedSession.title, 300) || selectedSessionId,
    status: text(selectedSession.status, 48) || 'UNKNOWN',
    browser_only: selectedSession.browser_only === true,
    task_count: Math.max(0, Number(selectedSession.task_count || 0)),
    surface_ids: Object.freeze(Array.isArray(selectedSession.surface_ids) ? selectedSession.surface_ids.map((id) => text(id, 240)).filter(Boolean) : []),
  }) : null;
  const selectedSurfaceView = selectedSurface ? surfaceView(selectedSurface, selectedSurfaceId) : null;
  if (selectedSurface && !selectedSurfaceView) return invalidView('SELECTED_SURFACE_PAYLOAD_INVALID');

  const selectedSessionSurfaces = [];
  let selectedSessionSurfaceCount = 0;
  let selectedSessionSurfacesTruncated = false;
  if (selectedSession) {
    if (!Array.isArray(selectedSession.surface_ids)) return invalidView('SELECTED_SESSION_SURFACE_MEMBERSHIP_INVALID');
    const seenSurfaceIds = new Set();
    for (const rawSurfaceId of selectedSession.surface_ids) {
      const surfaceId = text(rawSurfaceId, 240);
      const surface = surfaceId ? surfaces.get(surfaceId) : null;
      if (!surfaceId || !surface || seenSurfaceIds.has(surfaceId) || text(surface.session_id, 200) !== selectedSessionId) {
        return invalidView('SELECTED_SESSION_SURFACE_MEMBERSHIP_INVALID');
      }
      seenSurfaceIds.add(surfaceId);
      selectedSessionSurfaceCount += 1;
      if (selectedSessionSurfaces.length < SELECTED_SESSION_SURFACE_LIMIT) {
        const projected = surfaceView(surface, surfaceId);
        if (!projected) return invalidView('SELECTED_SESSION_SURFACE_PAYLOAD_INVALID');
        selectedSessionSurfaces.push(projected);
      }
    }
    selectedSessionSurfacesTruncated = selectedSessionSurfaceCount > selectedSessionSurfaces.length;
  }

  return Object.freeze({
    schema: METAENGINE_DEVOS_SHELL_VIEW_MODEL_SCHEMA,
    valid: true,
    reason: null,
    primary_object: 'SESSION',
    default_root: text(devos.navigation.default_root, 64) || 'NOW',
    roots: Object.freeze(roots),
    session_groups: Object.freeze(sessionGroups),
    now: Object.freeze(now),
    selected_session: selectedSessionView,
    selected_surface: selectedSurfaceView,
    selected_session_surfaces: Object.freeze(selectedSessionSurfaces),
    selected_session_surface_count: selectedSessionSurfaceCount,
    selected_session_surfaces_truncated: selectedSessionSurfacesTruncated,
    presentation_focus: presentationFocus,
    layout_preferences: selectedLayout(devos, selectedSessionId),
    counts: Object.freeze({ sessions: sessions.size, surfaces: surfaces.size, attention: now.length, visible_groups: sessionGroups.filter((group) => group.count > 0).length }),
    browser_is_shell: false,
    browser_is_surface: true,
    renderer_selection_authority: false,
    renderer_routing_authority: false,
    ...zeroAuthorityContract(),
  });
}
