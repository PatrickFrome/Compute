export const METAENGINE_DEVOS_SESSION_LAYOUT_SCHEMA = 'metaengine.devos.session-layout-registry.v1';
export const METAENGINE_DEVOS_SESSION_LAYOUT_ENTRY_SCHEMA = 'metaengine.devos.session-layout-entry.v1';

const SIDEBAR_MODES = new Set(['EXPANDED', 'COMPACT', 'HIDDEN']);
const INSPECTOR_MODES = new Set(['OPEN', 'CLOSED']);
const SURFACE_LAYOUT_MODES = new Set(['AUTO', 'SINGLE', 'SPLIT_VERTICAL', 'SPLIT_HORIZONTAL', 'TRIPLE_RIGHT', 'GRID_2X2']);
const MAX_SESSION_LAYOUT_ENTRIES = 512;

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

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function requiredBoundedInt(value, name, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`devos_session_layout_${name}_invalid`);
  }
  return parsed;
}

function boundedId(value, name, max = 200) {
  const out = String(value ?? '').trim();
  if (!out || out.length > max || /[\u0000-\u001f\u007f]/.test(out)) throw new Error(`devos_session_layout_${name}_invalid`);
  return out;
}

function normalizeSidebar(value, fallback = 'EXPANDED') {
  const out = String(value || fallback).trim().toUpperCase();
  if (!SIDEBAR_MODES.has(out)) throw new Error('devos_session_layout_sidebar_invalid');
  return out;
}

function normalizeInspector(value, fallback = 'CLOSED') {
  const out = String(value || fallback).trim().toUpperCase();
  if (!INSPECTOR_MODES.has(out)) throw new Error('devos_session_layout_inspector_invalid');
  return out;
}

function normalizeSurfaceLayout(value, fallback = 'AUTO') {
  const out = String(value || fallback).trim().toUpperCase();
  if (!SURFACE_LAYOUT_MODES.has(out)) throw new Error('devos_session_layout_surface_layout_invalid');
  return out;
}

function assertZeroAuthorityContract(source, name) {
  if (!source
    || source.projection_is_authority !== false
    || source.scheduler_authority !== false
    || source.execution_authority !== false
    || source.command_leasing !== false
    || source.automatic_effect_retry_allowed !== false
    || source.page_model_authority !== false
    || source.authority_effect !== false) {
    throw new Error(`devos_session_layout_${name}_authority_invalid`);
  }
}

function freezeEntry(entry) {
  return Object.freeze({
    schema: METAENGINE_DEVOS_SESSION_LAYOUT_ENTRY_SCHEMA,
    session_id: entry.session_id,
    requested_sidebar: entry.requested_sidebar,
    requested_inspector: entry.requested_inspector,
    requested_surface_layout: entry.requested_surface_layout,
    active_surface_id: entry.active_surface_id,
    revision: entry.revision,
    updated_sequence: entry.updated_sequence,
    ...zeroAuthorityContract(),
  });
}

function defaultEntry(sessionId, sequence) {
  return {
    session_id: sessionId,
    requested_sidebar: 'EXPANDED',
    requested_inspector: 'CLOSED',
    requested_surface_layout: 'AUTO',
    active_surface_id: null,
    revision: 1,
    updated_sequence: sequence,
  };
}

export class DevOSSessionLayoutRegistry {
  #maxSessions;
  #entries = new Map();
  #activeSessionId = null;
  #sequence = 0;

  constructor({ max_sessions = 128 } = {}) {
    this.#maxSessions = boundedInt(max_sessions, 128, 1, MAX_SESSION_LAYOUT_ENTRIES);
  }

  get maxSessions() { return this.#maxSessions; }
  get activeSessionId() { return this.#activeSessionId; }

  #nextSequence() {
    this.#sequence += 1;
    return this.#sequence;
  }

  #evictIfNeeded() {
    while (this.#entries.size > this.#maxSessions) {
      let candidate = null;
      for (const entry of this.#entries.values()) {
        if (entry.session_id === this.#activeSessionId) continue;
        if (!candidate || entry.updated_sequence < candidate.updated_sequence
          || (entry.updated_sequence === candidate.updated_sequence && entry.session_id.localeCompare(candidate.session_id) < 0)) {
          candidate = entry;
        }
      }
      if (!candidate) {
        const [first] = this.#entries.values();
        if (!first) break;
        candidate = first;
      }
      this.#entries.delete(candidate.session_id);
    }
  }

  ensure(sessionId) {
    const id = boundedId(sessionId, 'session_id');
    let entry = this.#entries.get(id);
    if (!entry) {
      entry = defaultEntry(id, this.#nextSequence());
      this.#entries.set(id, entry);
      this.#evictIfNeeded();
    }
    return freezeEntry(entry);
  }

  activate(sessionId) {
    const id = boundedId(sessionId, 'session_id');
    const existing = this.#entries.get(id) || defaultEntry(id, this.#nextSequence());
    existing.updated_sequence = this.#nextSequence();
    this.#entries.set(id, existing);
    this.#activeSessionId = id;
    this.#evictIfNeeded();
    return freezeEntry(existing);
  }

  setRequested(sessionId, patch = {}) {
    const id = boundedId(sessionId, 'session_id');
    const current = this.#entries.get(id) || defaultEntry(id, this.#nextSequence());
    const nextSidebar = patch.sidebar == null ? current.requested_sidebar : normalizeSidebar(patch.sidebar, current.requested_sidebar);
    const nextInspector = patch.inspector == null ? current.requested_inspector : normalizeInspector(patch.inspector, current.requested_inspector);
    const nextSurfaceLayout = patch.surface_layout == null ? current.requested_surface_layout : normalizeSurfaceLayout(patch.surface_layout, current.requested_surface_layout);
    if (nextSidebar === current.requested_sidebar && nextInspector === current.requested_inspector && nextSurfaceLayout === current.requested_surface_layout) {
      this.#entries.set(id, current);
      this.#evictIfNeeded();
      return freezeEntry(current);
    }
    const next = {
      ...current,
      requested_sidebar: nextSidebar,
      requested_inspector: nextInspector,
      requested_surface_layout: nextSurfaceLayout,
      revision: current.revision + 1,
      updated_sequence: this.#nextSequence(),
    };
    this.#entries.set(id, next);
    this.#evictIfNeeded();
    return freezeEntry(next);
  }

  setSurfaceLayout(sessionId, mode) {
    return this.setRequested(sessionId, { surface_layout: mode });
  }

  setActiveSurface(sessionId, surfaceId = null) {
    const id = boundedId(sessionId, 'session_id');
    const current = this.#entries.get(id) || defaultEntry(id, this.#nextSequence());
    const nextSurface = surfaceId == null ? null : boundedId(surfaceId, 'surface_id', 240);
    if (nextSurface === current.active_surface_id) {
      this.#entries.set(id, current);
      this.#evictIfNeeded();
      return freezeEntry(current);
    }
    const next = {
      ...current,
      active_surface_id: nextSurface,
      revision: current.revision + 1,
      updated_sequence: this.#nextSequence(),
    };
    this.#entries.set(id, next);
    this.#evictIfNeeded();
    return freezeEntry(next);
  }

  get(sessionId) {
    const id = boundedId(sessionId, 'session_id');
    const entry = this.#entries.get(id);
    return entry ? freezeEntry(entry) : null;
  }

  forget(sessionId) {
    const id = boundedId(sessionId, 'session_id');
    const removed = this.#entries.delete(id);
    if (this.#activeSessionId === id) this.#activeSessionId = null;
    return removed;
  }

  snapshot() {
    const entries = [...this.#entries.values()]
      .sort((a, b) => b.updated_sequence - a.updated_sequence || a.session_id.localeCompare(b.session_id))
      .map(freezeEntry);
    return Object.freeze({
      schema: METAENGINE_DEVOS_SESSION_LAYOUT_SCHEMA,
      bounded: true,
      max_sessions: this.#maxSessions,
      session_count: entries.length,
      active_session_id: this.#activeSessionId,
      latest_sequence: this.#sequence,
      entries: Object.freeze(entries),
      requested_state_is_user_preference: true,
      effective_responsive_state_persisted: false,
      session_layout_is_execution_authority: false,
      ...zeroAuthorityContract(),
    });
  }

  restore(snapshot) {
    if (!snapshot || snapshot.schema !== METAENGINE_DEVOS_SESSION_LAYOUT_SCHEMA
      || snapshot.bounded !== true
      || snapshot.requested_state_is_user_preference !== true
      || snapshot.effective_responsive_state_persisted !== false
      || snapshot.session_layout_is_execution_authority !== false
      || !Array.isArray(snapshot.entries)
      || snapshot.entries.length > MAX_SESSION_LAYOUT_ENTRIES) {
      throw new Error('devos_session_layout_restore_invalid');
    }
    assertZeroAuthorityContract(snapshot, 'restore');
    requiredBoundedInt(snapshot.max_sessions, 'restore_max_sessions', 1, MAX_SESSION_LAYOUT_ENTRIES);
    const latestSequence = requiredBoundedInt(snapshot.latest_sequence, 'restore_latest_sequence', 0, Number.MAX_SAFE_INTEGER);
    const declaredCount = requiredBoundedInt(snapshot.session_count, 'restore_session_count', 0, MAX_SESSION_LAYOUT_ENTRIES);
    if (declaredCount !== snapshot.entries.length) throw new Error('devos_session_layout_restore_session_count_mismatch');

    const validated = [];
    const seenSessionIds = new Set();
    let maxEntrySequence = 0;
    for (const source of snapshot.entries) {
      if (!source || source.schema !== METAENGINE_DEVOS_SESSION_LAYOUT_ENTRY_SCHEMA) {
        throw new Error('devos_session_layout_restore_entry_invalid');
      }
      assertZeroAuthorityContract(source, 'restore_entry');
      const sessionId = boundedId(source.session_id, 'session_id');
      if (seenSessionIds.has(sessionId)) throw new Error('devos_session_layout_restore_duplicate_session');
      seenSessionIds.add(sessionId);
      const revision = requiredBoundedInt(source.revision, 'restore_revision', 1, Number.MAX_SAFE_INTEGER);
      const updatedSequence = requiredBoundedInt(source.updated_sequence, 'restore_updated_sequence', 0, Number.MAX_SAFE_INTEGER);
      maxEntrySequence = Math.max(maxEntrySequence, updatedSequence);
      validated.push({
        session_id: sessionId,
        requested_sidebar: normalizeSidebar(source.requested_sidebar),
        requested_inspector: normalizeInspector(source.requested_inspector),
        requested_surface_layout: normalizeSurfaceLayout(source.requested_surface_layout, 'AUTO'),
        active_surface_id: source.active_surface_id == null ? null : boundedId(source.active_surface_id, 'surface_id', 240),
        revision,
        updated_sequence: updatedSequence,
      });
    }
    if (latestSequence < maxEntrySequence) throw new Error('devos_session_layout_restore_sequence_regression');

    const active = snapshot.active_session_id == null ? null : boundedId(snapshot.active_session_id, 'active_session_id');
    if (active && !seenSessionIds.has(active)) throw new Error('devos_session_layout_restore_active_session_missing');

    validated.sort((a, b) => b.updated_sequence - a.updated_sequence || a.session_id.localeCompare(b.session_id));
    const selected = [];
    if (active) {
      const activeEntry = validated.find((entry) => entry.session_id === active);
      if (activeEntry) selected.push(activeEntry);
    }
    for (const entry of validated) {
      if (selected.length >= this.#maxSessions) break;
      if (entry.session_id === active) continue;
      selected.push(entry);
    }

    this.#entries = new Map(selected.map((entry) => [entry.session_id, entry]));
    this.#activeSessionId = active && this.#entries.has(active) ? active : null;
    this.#sequence = latestSequence;
    this.#evictIfNeeded();
    return this.snapshot();
  }
}

export function createDevOSSessionLayoutRegistry(options = {}) {
  return new DevOSSessionLayoutRegistry(options);
}
