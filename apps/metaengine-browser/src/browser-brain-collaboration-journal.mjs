import crypto from 'node:crypto';

export const BROWSER_BRAIN_COLLABORATION_JOURNAL_SCHEMA = 'metaengine.browser-brain.collaboration-journal.v1';
export const BROWSER_BRAIN_COLLABORATION_CHECKPOINT_SCHEMA = 'metaengine.browser-brain.collaboration-checkpoint.v1';

const SAFE_KIND = new Set(['TASK_RECORDED','TASK_ADVANCED','TASK_MATERIALIZED','MESSAGE_RECORDED','ARTIFACT_RECORDED','CLAIM_RECORDED','CLAIM_RELEASED','HANDOFF_RECORDED']);

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}
function clone(value) { return value == null ? value : structuredClone(value); }
function safePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('browser_brain_collaboration_journal_payload_invalid');
  const copy = clone(payload);
  const encoded = JSON.stringify(copy);
  if (encoded.length > 32_768) throw new Error('browser_brain_collaboration_journal_payload_too_large');
  return copy;
}

export class BrowserBrainCollaborationJournal {
  #clock;
  #maxEntries;
  #entries = [];
  #nextSeq = 1;
  #evictions = 0;

  constructor({ clock = () => Date.now(), maxEntries = 16_384 } = {}) {
    if (typeof clock !== 'function') throw new Error('browser_brain_collaboration_journal_clock_invalid');
    this.#clock = clock;
    this.#maxEntries = boundedInt(maxEntries, 16_384, 64, 65_536);
  }

  #nowIso() {
    const value = Number(this.#clock());
    if (!Number.isFinite(value) || value < 0) throw new Error('browser_brain_collaboration_journal_clock_invalid');
    return new Date(value).toISOString();
  }

  append(kind, payload) {
    const normalizedKind = String(kind || '').toUpperCase();
    if (!SAFE_KIND.has(normalizedKind)) throw new Error('browser_brain_collaboration_journal_kind_invalid');
    const row = Object.freeze({
      seq: this.#nextSeq++,
      kind: normalizedKind,
      payload: Object.freeze(safePayload(payload)),
      recorded_at: this.#nowIso(),
      execution_authority: false,
      authority_effect: false,
    });
    this.#entries.push(row);
    if (this.#entries.length > this.#maxEntries) this.#compact();
    return row;
  }

  #compact() {
    const taskCreate = new Map();
    const taskState = new Map();
    const claimState = new Map();
    const retained = [];
    for (const row of this.#entries) {
      const taskId = row.payload?.task_id ? String(row.payload.task_id) : null;
      if (row.kind === 'TASK_RECORDED' && taskId) taskCreate.set(taskId, row);
      else if ((row.kind === 'TASK_ADVANCED' || row.kind === 'TASK_MATERIALIZED') && taskId) taskState.set(taskId, row);
      else if (row.kind === 'CLAIM_RECORDED') claimState.set(String(row.payload?.claim_id || ''), row);
      else if (row.kind === 'CLAIM_RELEASED') claimState.delete(String(row.payload?.claim_id || ''));
      else retained.push(row);
    }
    const essential = [...taskCreate.values(), ...taskState.values(), ...claimState.values()];
    essential.sort((a, b) => a.seq - b.seq);
    retained.sort((a, b) => a.seq - b.seq);
    const available = Math.max(0, this.#maxEntries - essential.length);
    const tail = retained.slice(-available);
    const next = [...essential, ...tail].sort((a, b) => a.seq - b.seq);
    const dropped = Math.max(0, this.#entries.length - next.length);
    if (dropped > 0) this.#evictions += dropped;
    this.#entries = next;
    if (this.#entries.length > this.#maxEntries) throw new Error('browser_brain_collaboration_journal_active_state_exceeds_capacity');
  }

  entries({ context_id = null, task_id = null, kinds = null } = {}) {
    const allowKinds = kinds == null ? null : new Set(kinds.map((row) => String(row).toUpperCase()));
    return Object.freeze(this.#entries.filter((row) => {
      if (allowKinds && !allowKinds.has(row.kind)) return false;
      if (context_id != null && String(row.payload?.context_id || '') !== String(context_id)) return false;
      if (task_id != null && String(row.payload?.task_id || '') !== String(task_id)) return false;
      return true;
    }).map((row) => clone(row)));
  }

  provenanceForTask(taskId) {
    const rows = this.entries({ task_id: taskId });
    const artifacts = rows.filter((row) => row.kind === 'ARTIFACT_RECORDED').map((row) => row.payload);
    const handoffs = rows.filter((row) => row.kind === 'HANDOFF_RECORDED').map((row) => row.payload);
    const messages = rows.filter((row) => row.kind === 'MESSAGE_RECORDED').map((row) => row.payload);
    const baseSha = [...artifacts].reverse().find((row) => row.base_sha)?.base_sha || [...handoffs].reverse().find((row) => row.base_sha)?.base_sha || null;
    const branch = [...artifacts].reverse().find((row) => row.branch)?.branch || [...handoffs].reverse().find((row) => row.branch)?.branch || null;
    return Object.freeze({
      task_id: String(taskId),
      artifact_refs: Object.freeze([...new Set(artifacts.map((row) => row.artifact_id).filter(Boolean))]),
      evidence_refs: Object.freeze([...new Set(messages.flatMap((row) => Array.isArray(row.evidence_refs) ? row.evidence_refs : []).filter(Boolean))]),
      verified_facts: Object.freeze([...new Set(handoffs.flatMap((row) => Array.isArray(row.verified_facts) ? row.verified_facts : []).filter(Boolean))].slice(-32)),
      rejected_paths: Object.freeze([...new Set(handoffs.flatMap((row) => Array.isArray(row.rejected_paths) ? row.rejected_paths : []).filter(Boolean))].slice(-32)),
      next_actions: Object.freeze([...new Set(handoffs.flatMap((row) => Array.isArray(row.next_actions) ? row.next_actions : []).filter(Boolean))].slice(-32)),
      base_sha: baseSha,
      branch,
      authority_effect: false,
    });
  }

  checkpoint() {
    const material = {
      schema: BROWSER_BRAIN_COLLABORATION_CHECKPOINT_SCHEMA,
      version: 1,
      created_at: this.#nowIso(),
      next_seq: this.#nextSeq,
      evictions: this.#evictions,
      entries: this.#entries.map((row) => clone(row)),
      bounded: true,
      external_confirmation_required: false,
      scheduler_authority: false,
      execution_authority: false,
      authority_effect: false,
    };
    return Object.freeze({ ...material, checkpoint_sha256: sha256(material) });
  }

  restore(checkpoint) {
    if (!checkpoint || checkpoint.schema !== BROWSER_BRAIN_COLLABORATION_CHECKPOINT_SCHEMA || checkpoint.version !== 1) {
      throw new Error('browser_brain_collaboration_checkpoint_schema_invalid');
    }
    const material = clone(checkpoint);
    const expected = String(material.checkpoint_sha256 || '');
    delete material.checkpoint_sha256;
    if (!/^[a-f0-9]{64}$/.test(expected) || sha256(material) !== expected) throw new Error('browser_brain_collaboration_checkpoint_hash_mismatch');
    if (!Array.isArray(material.entries) || material.entries.length > this.#maxEntries) throw new Error('browser_brain_collaboration_checkpoint_size_invalid');
    let priorSeq = 0;
    const rows = material.entries.map((row) => {
      if (!SAFE_KIND.has(String(row?.kind || '').toUpperCase())) throw new Error('browser_brain_collaboration_checkpoint_kind_invalid');
      const seq = Number(row?.seq);
      if (!Number.isSafeInteger(seq) || seq <= priorSeq) throw new Error('browser_brain_collaboration_checkpoint_sequence_invalid');
      priorSeq = seq;
      return Object.freeze({
        seq,
        kind: String(row.kind).toUpperCase(),
        payload: Object.freeze(safePayload(row.payload)),
        recorded_at: String(row.recorded_at || ''),
        execution_authority: false,
        authority_effect: false,
      });
    });
    this.#entries = rows;
    this.#nextSeq = Math.max(priorSeq + 1, Number(material.next_seq) || 1);
    this.#evictions = Math.max(0, Number(material.evictions) || 0);
    return this.snapshot();
  }

  replayInto(fabric) {
    if (!fabric || typeof fabric.recordTask !== 'function') throw new Error('browser_brain_collaboration_replay_fabric_invalid');
    let applied = 0;
    for (const row of this.#entries) {
      const payload = clone(row.payload);
      if (row.kind === 'TASK_RECORDED') fabric.recordTask(payload);
      else if (row.kind === 'TASK_ADVANCED' || row.kind === 'TASK_MATERIALIZED') fabric.advanceTask(payload);
      else if (row.kind === 'MESSAGE_RECORDED') fabric.recordMessage(payload);
      else if (row.kind === 'ARTIFACT_RECORDED') fabric.recordArtifact(payload);
      else if (row.kind === 'CLAIM_RECORDED') {
        const recordedAt = new Date(row.recorded_at).getTime();
        const originalTtl = Number(payload.ttl_ms) || 15 * 60_000;
        const age = Math.max(0, Number(this.#clock()) - recordedAt);
        const remaining = originalTtl - age;
        if (remaining > 0) {
          fabric.claimWork({ ...payload, ttl_ms: remaining });
        } else {
          const replayed = fabric.claimWork({ ...payload, ttl_ms: 1_000 });
          if (replayed?.claimed === true && replayed?.claim?.claim_id) fabric.releaseClaim(replayed.claim.claim_id, 'EXPIRED_DURING_REPLAY');
        }
      }
      else if (row.kind === 'CLAIM_RELEASED') fabric.releaseClaim(payload.claim_id, payload.reason);
      else if (row.kind === 'HANDOFF_RECORDED') fabric.recordHandoff(payload);
      applied += 1;
    }
    return Object.freeze({ applied, synthetic_effects: 0, scheduler_authority: false, execution_authority: false, authority_effect: false });
  }

  snapshot() {
    return Object.freeze({
      schema: BROWSER_BRAIN_COLLABORATION_JOURNAL_SCHEMA,
      entry_count: this.#entries.length,
      max_entries: this.#maxEntries,
      next_seq: this.#nextSeq,
      evictions: this.#evictions,
      hash_verified_checkpoint: true,
      replay_is_information_only: true,
      materialized_task_state: true,
      expired_claim_replay_preserves_task_state: true,
      work_cycle_limit: null,
      external_confirmation_required: false,
      scheduler_authority: false,
      execution_authority: false,
      authority_effect: false,
    });
  }
}
