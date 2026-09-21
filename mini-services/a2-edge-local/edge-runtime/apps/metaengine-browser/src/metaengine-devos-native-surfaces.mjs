export const METAENGINE_DEVOS_NATIVE_SURFACE_ATTACHMENT_SCHEMA = 'metaengine.devos.native-surface-attachment.v1';
const MAX_NATIVE_SURFACES = 512;
const MAX_TIMELINE_TASKS = 32;

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

function text(value, max = 240) {
  const out = String(value ?? '').trim();
  return out ? out.slice(0, max) : null;
}

function freezeSurface(surface) {
  return Object.freeze({ ...surface, ...zeroAuthorityContract() });
}

function timelineSurface(session) {
  const tasks = Array.isArray(session.tasks) ? session.tasks.slice(0, MAX_TIMELINE_TASKS) : [];
  const entries = tasks.map((task) => Object.freeze({
    task_id: text(task?.task_id, 160),
    title: text(task?.objective, 320) || text(task?.task_id, 160) || 'Task',
    status: text(task?.status, 48) || 'UNKNOWN',
    updated_at: text(task?.updated_at, 80),
    blocker: text(task?.blocker, 320),
    ...zeroAuthorityContract(),
  }));
  return freezeSurface({
    surface_id: `timeline:${session.session_id}`,
    session_id: session.session_id,
    type: 'TIMELINE',
    title: 'Timeline',
    state: entries.length ? 'AVAILABLE' : 'EMPTY',
    source: 'CANONICAL_SESSION_TASKS',
    runtime_bound: false,
    presentation_only: true,
    timeline_entries: Object.freeze(entries),
    timeline_entry_count: tasks.length,
  });
}

function memorySurface(session, memory) {
  if (!memory || memory.source_state !== 'AVAILABLE' || !hasZeroAuthority(memory)) return null;
  return freezeSurface({
    surface_id: `memory:${session.session_id}`,
    session_id: session.session_id,
    type: 'MEMORY',
    title: 'Memory',
    state: 'AVAILABLE',
    source: 'CANONICAL_DEVOS_MEMORY_READ_MODEL',
    runtime_bound: false,
    presentation_only: true,
    episode_count: Math.max(0, Number(memory.episode_count || 0)),
    semantic_fact_count: Math.max(0, Number(memory.semantic_fact_count || 0)),
    procedural_playbook_count: Math.max(0, Number(memory.procedural_playbook_count || 0)),
  });
}

function artifactSurfaces(session, artifacts) {
  const rows = [];
  for (const artifact of artifacts) {
    if (artifact?.session_id !== session.session_id || !hasZeroAuthority(artifact)) continue;
    const artifactId = text(artifact.artifact_id ?? artifact.ref, 240);
    if (!artifactId) continue;
    rows.push(freezeSurface({
      surface_id: `artifact:${session.session_id}:${artifactId}`.slice(0, 240),
      session_id: session.session_id,
      type: 'ARTIFACT',
      title: text(artifact.ref, 240) || artifactId,
      state: 'AVAILABLE',
      source: 'CANONICAL_ARTIFACT_REFERENCE',
      runtime_bound: false,
      presentation_only: true,
      artifact_id: artifactId,
      artifact_ref: text(artifact.ref, 500),
      immutable_reference: artifact.immutable_reference === true,
    }));
  }
  return rows;
}

export function attachDevOSNativeSurfaces(devos) {
  if (!devos
    || devos.schema !== 'metaengine.devos.projection.v1'
    || devos.primary_object !== 'SESSION'
    || !hasZeroAuthority(devos)
    || !Array.isArray(devos.sessions)
    || !Array.isArray(devos.surfaces)
    || !Array.isArray(devos.artifacts)) return devos;

  const existing = new Map();
  for (const surface of devos.surfaces) {
    const surfaceId = text(surface?.surface_id, 240);
    if (!surfaceId || existing.has(surfaceId) || !hasZeroAuthority(surface)) return devos;
    existing.set(surfaceId, surface);
  }

  const native = [];
  const memory = devos.navigation?.memory;
  for (const session of devos.sessions) {
    const sessionId = text(session?.session_id, 200);
    if (!sessionId || !hasZeroAuthority(session)) return devos;
    native.push(timelineSurface({ ...session, session_id: sessionId }));
    native.push(...artifactSurfaces({ ...session, session_id: sessionId }, devos.artifacts));
    const memoryRow = memorySurface({ ...session, session_id: sessionId }, memory);
    if (memoryRow) native.push(memoryRow);
    if (native.length >= MAX_NATIVE_SURFACES) break;
  }

  const uniqueNative = [];
  for (const surface of native.slice(0, MAX_NATIVE_SURFACES)) {
    if (existing.has(surface.surface_id)) continue;
    existing.set(surface.surface_id, surface);
    uniqueNative.push(surface);
  }

  const bySession = new Map();
  for (const surface of uniqueNative) {
    const rows = bySession.get(surface.session_id) || [];
    rows.push(surface.surface_id);
    bySession.set(surface.session_id, rows);
  }

  const sessions = devos.sessions.map((session) => {
    const sessionId = text(session.session_id, 200);
    const current = Array.isArray(session.surface_ids) ? session.surface_ids.map((value) => text(value, 240)).filter(Boolean) : [];
    const added = bySession.get(sessionId) || [];
    return Object.freeze({ ...session, surface_ids: Object.freeze([...current, ...added]), ...zeroAuthorityContract() });
  });
  const surfaces = Object.freeze([...devos.surfaces, ...uniqueNative]);
  const selectedSessionId = text(devos.selected?.session_id, 200);
  const activeSessionSource = selectedSessionId ? sessions.find((session) => session.session_id === selectedSessionId) : null;
  const activeSession = devos.active_session && activeSessionSource
    ? Object.freeze({ ...devos.active_session, surface_count: activeSessionSource.surface_ids.length, ...zeroAuthorityContract() })
    : devos.active_session;

  return Object.freeze({
    ...devos,
    sessions: Object.freeze(sessions),
    surfaces,
    active_session: activeSession,
    counts: Object.freeze({ ...devos.counts, surfaces: surfaces.length }),
    native_surface_attachment: Object.freeze({
      schema: METAENGINE_DEVOS_NATIVE_SURFACE_ATTACHMENT_SCHEMA,
      native_surface_count: uniqueNative.length,
      browser_runtime_surface_type: 'BROWSER',
      shell_native_types: Object.freeze(['ARTIFACT', 'TIMELINE', 'MEMORY']),
      absent_runtime_types_are_not_invented: true,
      ...zeroAuthorityContract(),
    }),
    ...zeroAuthorityContract(),
  });
}
