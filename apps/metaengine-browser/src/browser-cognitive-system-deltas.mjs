// T3-8 delta bus unification: system-level lifecycle deltas ride the SAME
// BrowserCognitiveDeltaBus as the semantic/process/metrics streams, making the
// cognitive bus the single nervous system of the browser runtime. Publishers
// are pure functions over (bus, ring); the ring keeps a small session-scoped
// tail of system deltas for the Mission Control live-effects projection
// (semantic noise never drowns system events there). Everything stays
// observation-only: no raw payloads, no authority, no command leasing.

export const COGNITIVE_SYSTEM_DELTA_SCHEMA = 'metaengine.browser.cognitive-system-delta.v1';

export const COGNITIVE_SYSTEM_DELTA_KINDS = Object.freeze({
  FLEET_AGENT_LIFECYCLE: 'FLEET_AGENT_LIFECYCLE',
  SUPERVISOR_COMMAND: 'SUPERVISOR_COMMAND',
  ARTIFACT_RECORDED: 'ARTIFACT_RECORDED',
  COMPUTE_BRIDGE_HEALTH: 'COMPUTE_BRIDGE_HEALTH',
});

const KIND_RE = /^(FLEET_AGENT_LIFECYCLE|SUPERVISOR_COMMAND|ARTIFACT_RECORDED|COMPUTE_BRIDGE_HEALTH)$/;
const HARD_MAX_RING = 256;
const HARD_TAIL_LIMIT = 64;

const clip = (value, max = 160) => value == null ? null : String(value).slice(0, max);

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function normalizeSystemDeltaInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('cognitive_system_delta_input_invalid');
  }
  const systemKind = String(input.system_kind || '');
  if (!KIND_RE.test(systemKind)) throw new Error('cognitive_system_delta_kind_invalid');
  const subjectId = clip(input.subject_id, 160);
  if (!subjectId) throw new Error('cognitive_system_delta_subject_required');
  return Object.freeze({
    type: 'SYSTEM_EVENT',
    system_kind: systemKind,
    subject_id: subjectId,
    detail: clip(input.detail, 240),
    observed_at: clip(input.observed_at, 64) || new Date().toISOString(),
  });
}

export function publishCognitiveSystemDelta(bus, ring, input = {}) {
  const normalized = normalizeSystemDeltaInput(input);
  let published = null;
  if (bus && typeof bus.publish === 'function') {
    published = bus.publish(normalized);
  }
  if (ring && typeof ring.push === 'function') {
    try { ring.push(normalized); } catch { /* ring failure never gates the bus */ }
  }
  return published;
}

export function publishFleetAgentLifecycle(bus, ring, { agent_id, role, lifecycle_state, generation_epoch } = {}) {
  return publishCognitiveSystemDelta(bus, ring, {
    system_kind: COGNITIVE_SYSTEM_DELTA_KINDS.FLEET_AGENT_LIFECYCLE,
    subject_id: agent_id,
    detail: `${clip(role, 48) || 'role?'}/${clip(lifecycle_state, 48) || 'state?'}/g${Number.isSafeInteger(Number(generation_epoch)) ? Number(generation_epoch) : 0}`,
  });
}

export function publishSupervisorCommand(bus, ring, { command_id, action, status, duration_ms } = {}) {
  return publishCognitiveSystemDelta(bus, ring, {
    system_kind: COGNITIVE_SYSTEM_DELTA_KINDS.SUPERVISOR_COMMAND,
    subject_id: command_id || `action:${clip(action, 64) || 'UNKNOWN'}`,
    detail: `${clip(action, 64) || 'UNKNOWN'}/${clip(status, 32) || 'OK'}${Number.isSafeInteger(Number(duration_ms)) ? `/${Math.max(0, Number(duration_ms))}ms` : ''}`,
  });
}

export function publishArtifactRecorded(bus, ring, { artifact_id, kind, task_id } = {}) {
  return publishCognitiveSystemDelta(bus, ring, {
    system_kind: COGNITIVE_SYSTEM_DELTA_KINDS.ARTIFACT_RECORDED,
    subject_id: artifact_id,
    detail: `${clip(kind, 96) || 'artifact'}${task_id ? ` task:${clip(task_id, 96)}` : ''}`,
  });
}

export function publishComputeBridgeHealth(bus, ring, { state, reason_code } = {}) {
  return publishCognitiveSystemDelta(bus, ring, {
    system_kind: COGNITIVE_SYSTEM_DELTA_KINDS.COMPUTE_BRIDGE_HEALTH,
    subject_id: clip(state, 48) || 'UNKNOWN',
    detail: clip(reason_code, 160) || 'transition',
  });
}

export class BrowserCognitiveSystemDeltaRing {
  #maxEntries;
  #entries = [];
  #droppedTotal = 0;

  constructor({ maxEntries = 64 } = {}) {
    this.#maxEntries = boundedInt(maxEntries, 64, 1, HARD_MAX_RING);
  }

  push(normalized = {}) {
    if (!normalized || typeof normalized !== 'object') throw new Error('cognitive_system_ring_entry_invalid');
    const entry = Object.freeze({
      system_kind: String(normalized.system_kind || ''),
      subject_id: clip(normalized.subject_id, 160),
      detail: clip(normalized.detail, 240),
      observed_at: clip(normalized.observed_at, 64),
    });
    if (!KIND_RE.test(entry.system_kind) || !entry.subject_id) {
      throw new Error('cognitive_system_ring_entry_invalid');
    }
    this.#entries.push(entry);
    if (this.#entries.length > this.#maxEntries) {
      this.#droppedTotal += this.#entries.length - this.#maxEntries;
      this.#entries = this.#entries.slice(this.#entries.length - this.#maxEntries);
    }
    return entry;
  }

  rows() {
    return this.#entries.map((entry, index) => Object.freeze({ ...entry, ring_index: index }));
  }

  snapshot() {
    return Object.freeze({
      schema: COGNITIVE_SYSTEM_DELTA_SCHEMA,
      entries: this.#entries.length,
      max_entries: this.#maxEntries,
      dropped_total: this.#droppedTotal,
      authority_effect: false,
    });
  }
}

export function projectSystemDeltaTail(ring, limit = 32) {
  const bounded = boundedInt(limit, 32, 1, HARD_TAIL_LIMIT);
  const rows = ring && typeof ring.rows === 'function' ? ring.rows() : [];
  return Object.freeze(rows.slice(-bounded).map((row) => Object.freeze({
    system_kind: row.system_kind,
    subject_id: row.subject_id,
    detail: row.detail,
    observed_at: row.observed_at,
    authority_effect: false,
  })));
}
