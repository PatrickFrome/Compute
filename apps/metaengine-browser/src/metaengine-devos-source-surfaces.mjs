export const METAENGINE_DEVOS_SOURCE_SURFACE_SCHEMA = 'metaengine.devos.source-surface-attachment.v1';
export const METAENGINE_DEVOS_SOURCE_SNAPSHOT_SCHEMA = 'metaengine.devos.source-snapshot.v1';

const MAX_SOURCE_SURFACES = 256;
const MAX_CODE_FILES_PER_SESSION = 2;
const MAX_CODE_TEXT = 24 * 1024;
const MAX_TRANSCRIPT_ENTRIES = 48;
const MAX_DIFF_COMPONENTS = 64;
const MAX_TEST_RECEIPTS = 32;
const MAX_LOG_ENTRIES = 64;

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
  return Object.freeze({
    ...surface,
    source_backed: true,
    runtime_bound: false,
    presentation_only: true,
    ...zeroAuthorityContract(),
  });
}

function sourceSnapshotValid(snapshot) {
  return snapshot
    && snapshot.schema === METAENGINE_DEVOS_SOURCE_SNAPSHOT_SCHEMA
    && snapshot.bounded === true
    && snapshot.source_backed === true
    && snapshot.renderer_authority === false
    && hasZeroAuthority(snapshot)
    && Array.isArray(snapshot.code_files)
    && Array.isArray(snapshot.terminal_entries)
    && Array.isArray(snapshot.diff_components)
    && Array.isArray(snapshot.test_receipts)
    && Array.isArray(snapshot.log_entries);
}

function slug(value, fallback = 'source') {
  return String(value || fallback).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96) || fallback;
}

function codeSurfaces(sessionId, snapshot) {
  const rows = [];
  for (const file of snapshot.code_files.slice(0, MAX_CODE_FILES_PER_SESSION)) {
    const relativePath = text(file?.relative_path, 400);
    const digest = text(file?.sha256, 80);
    const content = typeof file?.text === 'string' ? file.text.slice(0, MAX_CODE_TEXT) : '';
    if (!relativePath || !digest || !content) continue;
    rows.push(freezeSurface({
      surface_id: `code:${sessionId}:${slug(relativePath)}`.slice(0, 240),
      session_id: sessionId,
      type: 'CODE',
      title: relativePath,
      state: 'AVAILABLE',
      source: 'DEVELOPMENT_PLANE_REPO_READ_MODEL',
      source_ref: relativePath,
      source_sha256: digest,
      source_bytes: Math.max(0, Number(file.bytes || 0)),
      source_truncated: file.truncated === true,
      language: text(file.language, 48) || 'text',
      code_text: content,
    }));
  }
  return rows;
}

function terminalSurface(sessionId, snapshot) {
  const entries = snapshot.terminal_entries.slice(-MAX_TRANSCRIPT_ENTRIES).map((entry) => Object.freeze({
    seq: Math.max(0, Number(entry?.seq || 0)),
    at: text(entry?.at, 80),
    capability: text(entry?.capability, 96),
    state: text(entry?.state, 48) || 'UNKNOWN',
    summary: text(entry?.summary, 800),
    ...zeroAuthorityContract(),
  }));
  if (!entries.length) return null;
  return freezeSurface({
    surface_id: `terminal:${sessionId}:development-plane`,
    session_id: sessionId,
    type: 'TERMINAL',
    title: 'Development Plane',
    state: 'AVAILABLE',
    source: 'DEVELOPMENT_PLANE_REQUEST_TRANSCRIPT',
    terminal_mode: 'READ_ONLY_TRANSCRIPT',
    terminal_entries: Object.freeze(entries),
    terminal_entry_count: Math.max(entries.length, Number(snapshot.terminal_entry_count || entries.length)),
    input_authority: false,
  });
}

function diffSurface(sessionId, snapshot) {
  const components = snapshot.diff_components.slice(0, MAX_DIFF_COMPONENTS).map((row) => Object.freeze({
    path: text(row?.path, 400),
    change: text(row?.change, 24),
    digest: text(row?.digest, 80),
    ...zeroAuthorityContract(),
  })).filter((row) => row.path && row.change && row.digest);
  if (!components.length) return null;
  return freezeSurface({
    surface_id: `diff:${sessionId}:candidate`,
    session_id: sessionId,
    type: 'DIFF',
    title: 'Candidate changes',
    state: 'AVAILABLE',
    source: 'DEVELOPMENT_PLANE_CANDIDATE_COMPONENTS',
    candidate_id: text(snapshot.candidate_id, 180),
    source_head: text(snapshot.source_head, 80),
    diff_components: Object.freeze(components),
    diff_component_count: Math.max(components.length, Number(snapshot.diff_component_count || components.length)),
    textual_diff_claimed: false,
  });
}

function testsSurface(sessionId, snapshot) {
  const receipts = snapshot.test_receipts.slice(-MAX_TEST_RECEIPTS).map((row) => Object.freeze({
    capability: text(row?.capability, 96),
    state: text(row?.state, 48) || 'UNKNOWN',
    receipt_schema: text(row?.receipt_schema, 160),
    valid: row?.valid === true || row?.ok === true,
    ref: text(row?.ref, 240),
    ...zeroAuthorityContract(),
  }));
  if (!receipts.length) return null;
  return freezeSurface({
    surface_id: `tests:${sessionId}:verification`,
    session_id: sessionId,
    type: 'TESTS',
    title: 'Verification',
    state: receipts.every((row) => row.valid) ? 'PASS' : 'AVAILABLE',
    source: 'DEVELOPMENT_PLANE_VERIFICATION_RECEIPTS',
    test_receipts: Object.freeze(receipts),
    test_receipt_count: Math.max(receipts.length, Number(snapshot.test_receipt_count || receipts.length)),
  });
}

function logsSurface(sessionId, snapshot) {
  const entries = snapshot.log_entries.slice(-MAX_LOG_ENTRIES).map((row) => Object.freeze({
    seq: Math.max(0, Number(row?.seq || 0)),
    at: text(row?.at, 80),
    level: text(row?.level, 24) || 'INFO',
    source: text(row?.source, 96) || 'DEVOS',
    message: text(row?.message, 1200),
    ...zeroAuthorityContract(),
  })).filter((row) => row.message);
  if (!entries.length) return null;
  return freezeSurface({
    surface_id: `logs:${sessionId}:runtime`,
    session_id: sessionId,
    type: 'LOGS',
    title: 'Runtime logs',
    state: entries.some((row) => row.level === 'ERROR') ? 'ATTENTION' : 'AVAILABLE',
    source: 'TRUSTED_MAIN_AND_DEVELOPMENT_PLANE_EVENTS',
    log_entries: Object.freeze(entries),
    log_entry_count: Math.max(entries.length, Number(snapshot.log_entry_count || entries.length)),
  });
}

export function attachDevOSSourceSurfaces(devos, sourceSnapshot) {
  if (!devos
    || devos.schema !== 'metaengine.devos.projection.v1'
    || devos.primary_object !== 'SESSION'
    || !hasZeroAuthority(devos)
    || !Array.isArray(devos.sessions)
    || !Array.isArray(devos.surfaces)
    || !sourceSnapshotValid(sourceSnapshot)) return devos;

  const existing = new Set(devos.surfaces.map((row) => text(row?.surface_id, 240)).filter(Boolean));
  const added = [];
  for (const session of devos.sessions) {
    if (session?.browser_only === true) continue;
    const sessionId = text(session?.session_id, 200);
    if (!sessionId || !hasZeroAuthority(session)) continue;
    const candidates = [
      ...codeSurfaces(sessionId, sourceSnapshot),
      terminalSurface(sessionId, sourceSnapshot),
      diffSurface(sessionId, sourceSnapshot),
      testsSurface(sessionId, sourceSnapshot),
      logsSurface(sessionId, sourceSnapshot),
    ].filter(Boolean);
    for (const surface of candidates) {
      if (added.length >= MAX_SOURCE_SURFACES) break;
      if (existing.has(surface.surface_id)) continue;
      existing.add(surface.surface_id);
      added.push(surface);
    }
    if (added.length >= MAX_SOURCE_SURFACES) break;
  }
  if (!added.length) return devos;

  const bySession = new Map();
  for (const surface of added) {
    const ids = bySession.get(surface.session_id) || [];
    ids.push(surface.surface_id);
    bySession.set(surface.session_id, ids);
  }
  const sessions = devos.sessions.map((session) => Object.freeze({
    ...session,
    surface_ids: Object.freeze([...(Array.isArray(session.surface_ids) ? session.surface_ids : []), ...(bySession.get(session.session_id) || [])]),
    ...zeroAuthorityContract(),
  }));
  const surfaces = Object.freeze([...devos.surfaces, ...added]);
  const selectedSessionId = text(devos.selected?.session_id, 200);
  const selectedSession = selectedSessionId ? sessions.find((row) => row.session_id === selectedSessionId) : null;
  const activeSession = devos.active_session && selectedSession
    ? Object.freeze({ ...devos.active_session, surface_count: selectedSession.surface_ids.length, ...zeroAuthorityContract() })
    : devos.active_session;
  const types = Object.freeze([...new Set(added.map((row) => row.type))].sort());

  return Object.freeze({
    ...devos,
    sessions: Object.freeze(sessions),
    surfaces,
    active_session: activeSession,
    counts: Object.freeze({ ...devos.counts, surfaces: surfaces.length }),
    source_surface_attachment: Object.freeze({
      schema: METAENGINE_DEVOS_SOURCE_SURFACE_SCHEMA,
      source_surface_count: added.length,
      source_types: types,
      all_surfaces_source_backed: true,
      arbitrary_renderer_source_selection: false,
      ...zeroAuthorityContract(),
    }),
    ...zeroAuthorityContract(),
  });
}
