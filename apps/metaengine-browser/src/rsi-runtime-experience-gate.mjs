import crypto from 'node:crypto';

export const RSI_RUNTIME_EXPERIENCE_GATE_SCHEMA = 'metaengine.rsi.runtime-experience-gate.v1';

const OBSERVATION_SCHEMA = 'metaengine.rsi.shadow-observation.v1';
const SHA40 = /^[0-9a-f]{40}$/;
const DIGEST64 = /^[0-9a-f]{64}$/;
const MAX_MIN_PERSIST_MS = 60_000;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function exactSha(value) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA40.test(out)) throw new Error('rsi_experience_gate_source_sha_invalid');
  return out;
}

function finiteNonNegative(value, label) {
  const out = Number(value);
  if (!Number.isFinite(out) || out < 0) throw new Error(`rsi_experience_gate_${label}_invalid`);
  return out;
}

function validateObservation(observation, sourceSha) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    throw new Error('rsi_experience_gate_observation_required');
  }
  if (observation.schema !== OBSERVATION_SCHEMA) throw new Error('rsi_experience_gate_observation_schema_invalid');
  if (String(observation.source_sha || '').toLowerCase() !== sourceSha) throw new Error('rsi_experience_gate_observation_source_mismatch');
  if (!DIGEST64.test(String(observation.observation_digest || ''))) throw new Error('rsi_experience_gate_observation_digest_invalid');
  for (const field of [
    'execution_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'automatic_retry_allowed',
    'authority_effect',
  ]) {
    if (observation[field] !== false) throw new Error(`rsi_experience_gate_${field}_invalid`);
  }
  for (const field of [
    'raw_dom_consumed',
    'raw_network_consumed',
    'page_text_consumed',
    'input_values_consumed',
    'command_payload_consumed',
  ]) {
    if (observation[field] !== false) throw new Error(`rsi_experience_gate_${field}_invalid`);
  }
  if (!Number.isSafeInteger(Number(observation.brain_process_revision)) || Number(observation.brain_process_revision) < 0) {
    throw new Error('rsi_experience_gate_process_revision_invalid');
  }
  if (!Number.isSafeInteger(Number(observation.brain_cognitive_sequence)) || Number(observation.brain_cognitive_sequence) < 0) {
    throw new Error('rsi_experience_gate_cognitive_sequence_invalid');
  }
  if (!Number.isSafeInteger(Number(observation.cell_count)) || Number(observation.cell_count) < 0) {
    throw new Error('rsi_experience_gate_cell_count_invalid');
  }
  return observation;
}

function opportunitySummary(observation) {
  const rows = Array.isArray(observation.opportunities) ? observation.opportunities : [];
  return rows.map((row) => ({
    opportunity_id: String(row?.opportunity_id || ''),
    signal: String(row?.signal || ''),
    mutation_surface: String(row?.mutation_surface || ''),
    priority: String(row?.priority || '').toUpperCase(),
    evidence: row?.evidence && typeof row.evidence === 'object' && !Array.isArray(row.evidence)
      ? stable(row.evidence)
      : {},
  })).sort((a, b) => a.opportunity_id.localeCompare(b.opportunity_id));
}

function stateSignature(observation) {
  return digest({
    source_sha: observation.source_sha,
    brain_snapshot_schema: observation.brain_snapshot_schema,
    brain_process_revision: Number(observation.brain_process_revision),
    cell_count: Number(observation.cell_count),
    cell_state_counts: stable(observation.cell_state_counts || {}),
    ambiguous_command_count: Number(observation.ambiguous_command_count) || 0,
    dropped_events: Number(observation.dropped_events) || 0,
    opportunities: opportunitySummary(observation),
  });
}

function isCritical(observation) {
  if ((Number(observation.ambiguous_command_count) || 0) > 0) return true;
  if ((Number(observation.dropped_events) || 0) > 0) return true;
  return (Array.isArray(observation.opportunities) ? observation.opportunities : [])
    .some((row) => String(row?.priority || '').toUpperCase() === 'P0');
}

function decision(action, reason, observation, signature, extra = {}) {
  return Object.freeze({
    schema: RSI_RUNTIME_EXPERIENCE_GATE_SCHEMA,
    action,
    reason,
    signature_digest: signature,
    observation_digest: observation?.observation_digest || null,
    observed_at: observation?.observed_at || null,
    critical: observation ? isCritical(observation) : false,
    authority_effect: false,
    automatic_retry_allowed: false,
    ...extra,
  });
}

export class RsiRuntimeExperienceGate {
  #sourceSha;
  #clock;
  #minPersistMs;
  #lastPersistedSignature = null;
  #lastPersistedAtMs = null;
  #pending = null;
  #offered = 0;
  #persisted = 0;
  #coalesced = 0;
  #deduplicated = 0;

  constructor({ source_sha, clock = () => Date.now(), min_persist_interval_ms = 1000 } = {}) {
    this.#sourceSha = exactSha(source_sha);
    if (typeof clock !== 'function') throw new Error('rsi_experience_gate_clock_required');
    this.#clock = clock;
    const interval = finiteNonNegative(min_persist_interval_ms, 'min_persist_interval_ms');
    if (interval > MAX_MIN_PERSIST_MS) throw new Error('rsi_experience_gate_min_persist_interval_ms_too_large');
    this.#minPersistMs = interval;
  }

  offer(observation) {
    const checked = validateObservation(observation, this.#sourceSha);
    const signature = stateSignature(checked);
    const now = Number(this.#clock());
    if (!Number.isFinite(now)) throw new Error('rsi_experience_gate_clock_invalid');
    this.#offered += 1;

    if (signature === this.#lastPersistedSignature) {
      // A newer observation may have reverted a coalesced transient change back
      // to the already durable state. Drop that pending transient so a later
      // flush cannot persist stale experience after the system has recovered.
      if (this.#pending) {
        this.#pending = null;
        this.#coalesced += 1;
      }
      this.#deduplicated += 1;
      return decision('DEDUPLICATE', 'UNCHANGED_FROM_PERSISTED', checked, signature);
    }

    if (this.#pending?.signature_digest === signature) {
      this.#coalesced += 1;
      this.#pending = Object.freeze({ observation: checked, signature_digest: signature, admitted_at_ms: this.#pending.admitted_at_ms });
      return decision('COALESCE', 'UNCHANGED_PENDING', checked, signature);
    }

    const critical = isCritical(checked);
    const first = this.#lastPersistedSignature == null;
    const intervalElapsed = this.#lastPersistedAtMs == null || now - this.#lastPersistedAtMs >= this.#minPersistMs;

    if (first || critical || intervalElapsed) {
      return decision('PERSIST', first ? 'FIRST_OBSERVATION' : critical ? 'CRITICAL_CHANGE' : 'INTERVAL_ELAPSED', checked, signature, {
        observation: checked,
        supersedes_pending: this.#pending != null,
      });
    }

    this.#coalesced += 1;
    this.#pending = Object.freeze({ observation: checked, signature_digest: signature, admitted_at_ms: now });
    return decision('COALESCE', 'BOUNDED_COALESCE', checked, signature);
  }

  flush() {
    if (!this.#pending) return null;
    const pending = this.#pending;
    return decision('PERSIST', 'FLUSH_PENDING', pending.observation, pending.signature_digest, {
      observation: pending.observation,
      supersedes_pending: false,
    });
  }

  commitPersist(decisionRow) {
    if (!decisionRow || decisionRow.schema !== RSI_RUNTIME_EXPERIENCE_GATE_SCHEMA || decisionRow.action !== 'PERSIST') {
      throw new Error('rsi_experience_gate_commit_decision_invalid');
    }
    if (!DIGEST64.test(String(decisionRow.signature_digest || ''))) throw new Error('rsi_experience_gate_commit_signature_invalid');
    if (!decisionRow.observation || decisionRow.observation.observation_digest !== decisionRow.observation_digest) {
      throw new Error('rsi_experience_gate_commit_observation_invalid');
    }
    validateObservation(decisionRow.observation, this.#sourceSha);
    if (stateSignature(decisionRow.observation) !== decisionRow.signature_digest) {
      throw new Error('rsi_experience_gate_commit_signature_mismatch');
    }
    const now = Number(this.#clock());
    if (!Number.isFinite(now)) throw new Error('rsi_experience_gate_clock_invalid');
    this.#lastPersistedSignature = decisionRow.signature_digest;
    this.#lastPersistedAtMs = now;
    this.#pending = null;
    this.#persisted += 1;
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      schema: RSI_RUNTIME_EXPERIENCE_GATE_SCHEMA,
      source_sha: this.#sourceSha,
      min_persist_interval_ms: this.#minPersistMs,
      offered_count: this.#offered,
      persisted_count: this.#persisted,
      coalesced_count: this.#coalesced,
      deduplicated_count: this.#deduplicated,
      pending: this.#pending != null,
      pending_signature_digest: this.#pending?.signature_digest || null,
      last_persisted_signature_digest: this.#lastPersistedSignature,
      sidecar_observation_only: true,
      raw_page_text_allowed: false,
      raw_dom_allowed: false,
      execution_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      scheduler_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }
}
