import crypto from 'node:crypto';

export const SYSTEM_INTELLIGENCE_VERSION = '1.0.0';
export const PROCESS_SOURCE_SYSTEMS = Object.freeze(['GITHUB','SUPABASE','NEON','NATIVE_CONTROL_PLANE','CI']);
export const PROCESS_STATES = Object.freeze(['ACTIVE','WAITING','BLOCKED','TERMINAL','FAILED','ARCHIVED','UNKNOWN']);
export const MEMORY_KINDS = Object.freeze(['EPISODIC','SEMANTIC','PROCEDURAL']);
export const LEARNING_TARGETS = Object.freeze(['ROUTER_HEURISTIC','SCHEDULER_HEURISTIC','SKILL_CANDIDATE','MEMORY_POLICY']);

const TRUSTED_AUTHORITIES = new Set(['GITHUB','SUPABASE','NEON_CONTROL_PLANE','TRUSTED_NATIVE_CONTROL_PLANE','TRUSTED_CI']);
const clone = (value) => value == null ? value : structuredClone(value);

function iso(clock, value = null) {
  const d = new Date(value == null ? clock() : value);
  if (!Number.isFinite(d.getTime())) throw new Error('system_intelligence_time_invalid');
  return d.toISOString();
}

function opaque(value, max = 240) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max || /[\r\n]/.test(text)) throw new Error('system_intelligence_opaque_invalid');
  return text;
}

function nullableOpaque(value, max = 500) {
  if (value == null || String(value).trim() === '') return null;
  return opaque(value, max);
}

function normalizeRefs(refs = []) {
  if (!Array.isArray(refs)) throw new Error('system_intelligence_refs_invalid');
  return refs.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('system_intelligence_ref_invalid');
    const system = String(row.system || '').toUpperCase();
    if (!TRUSTED_AUTHORITIES.has(system)) throw new Error('system_intelligence_ref_authority_invalid');
    const sha256 = String(row.sha256 || '').toLowerCase();
    if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('system_intelligence_ref_sha256_invalid');
    return {
      system,
      ref: opaque(row.ref, 700),
      sha256: sha256 || null,
      authority_effect: false,
    };
  });
}

function normalizeConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error('system_intelligence_confidence_invalid');
  return n;
}

function processKey(sourceSystem, sourceInstance, processKind, processId) {
  return `${sourceSystem}:${sourceInstance}:${processKind}:${processId}`;
}

export class SystemIntelligence {
  #store;
  #clock;
  #uuid;

  constructor({ store, clock = () => Date.now(), uuid = () => crypto.randomUUID() } = {}) {
    if (!store || typeof store.transact !== 'function' || typeof store.snapshot !== 'function') throw new Error('system_intelligence_store_required');
    this.#store = store;
    this.#clock = clock;
    this.#uuid = uuid;
  }

  snapshot() {
    const state = this.#store.snapshot();
    const now = this.#clock();
    const processes = state.process_observations.map((row) => ({
      ...clone(row),
      stale: now > new Date(row.stale_after_at).getTime(),
    }));
    return Object.freeze({
      schema: 'metaengine.browser.system-intelligence.snapshot.v1',
      version: SYSTEM_INTELLIGENCE_VERSION,
      processes,
      memories: clone(state.memory_records),
      learning_candidates: clone(state.learning_candidates),
      scheduler_decisions: clone(state.scheduler_decisions),
      policy: {
        raw_database_secrets_in_browser: false,
        page_or_model_memory_authority: false,
        self_learning_direct_production_activation: false,
        verified_learning_scope: 'BRANCH_LOCAL_ONLY',
      },
      authority_effect: false,
    });
  }

  async ingestProcessObservation({
    source_system,
    source_instance,
    process_kind,
    process_id,
    state,
    authority,
    source_cursor,
    observed_at = null,
    stale_after_ms = 60_000,
    payload_ref = null,
    payload_sha256 = null,
  } = {}) {
    const sourceSystem = String(source_system || '').toUpperCase();
    if (!PROCESS_SOURCE_SYSTEMS.includes(sourceSystem)) throw new Error('system_intelligence_process_source_invalid');
    const sourceInstance = opaque(source_instance, 200);
    const processKind = opaque(process_kind, 120).toUpperCase();
    const processId = opaque(process_id, 240);
    const processState = String(state || 'UNKNOWN').toUpperCase();
    if (!PROCESS_STATES.includes(processState)) throw new Error('system_intelligence_process_state_invalid');
    const trustedAuthority = String(authority || '').toUpperCase();
    if (!TRUSTED_AUTHORITIES.has(trustedAuthority)) throw new Error('system_intelligence_process_authority_invalid');
    const cursor = opaque(source_cursor, 500);
    const observedAt = iso(this.#clock, observed_at);
    const staleMs = Number(stale_after_ms);
    if (!Number.isFinite(staleMs) || staleMs < 5_000 || staleMs > 24 * 60 * 60_000) throw new Error('system_intelligence_stale_window_invalid');
    const sha256 = String(payload_sha256 || '').toLowerCase();
    if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('system_intelligence_payload_sha256_invalid');
    const row = {
      schema: 'metaengine.browser.process-observation.v1',
      process_key: processKey(sourceSystem, sourceInstance, processKind, processId),
      source_system: sourceSystem,
      source_instance: sourceInstance,
      process_kind: processKind,
      process_id: processId,
      state: processState,
      authority: trustedAuthority,
      source_cursor: cursor,
      payload_ref: nullableOpaque(payload_ref, 700),
      payload_sha256: sha256 || null,
      observed_at: observedAt,
      stale_after_at: new Date(new Date(observedAt).getTime() + staleMs).toISOString(),
      authority_effect: false,
    };
    return this.#store.transact((runtime) => {
      const index = runtime.process_observations.findIndex((x) => x.process_key === row.process_key);
      if (index >= 0) {
        const prior = runtime.process_observations[index];
        if (new Date(prior.observed_at).getTime() > new Date(row.observed_at).getTime()) return clone(prior);
        if (prior.source_cursor === row.source_cursor && prior.state === row.state) {
          runtime.process_observations[index] = { ...prior, stale_after_at: row.stale_after_at };
          return clone(runtime.process_observations[index]);
        }
        runtime.process_observations[index] = row;
      } else runtime.process_observations.push(row);
      runtime.process_observations = runtime.process_observations.slice(-2048);
      return clone(row);
    });
  }

  listFreshProcesses() {
    const now = this.#clock();
    return this.#store.snapshot().process_observations
      .filter((row) => now <= new Date(row.stale_after_at).getTime())
      .map(clone);
  }

  async remember({ kind, subject, summary_ref, confidence, source_refs = [], tags = [], outcome = 'OBSERVED' } = {}) {
    const memoryKind = String(kind || '').toUpperCase();
    if (!MEMORY_KINDS.includes(memoryKind)) throw new Error('system_intelligence_memory_kind_invalid');
    const refs = normalizeRefs(source_refs);
    if (refs.length === 0) throw new Error('system_intelligence_memory_provenance_required');
    const tagList = Array.isArray(tags) ? [...new Set(tags.map((x) => opaque(x, 80).toLowerCase()))].slice(0, 24) : [];
    const record = {
      schema: 'metaengine.browser.memory-record.v1',
      memory_id: `memory_${this.#uuid()}`,
      kind: memoryKind,
      subject: opaque(subject, 240),
      summary_ref: opaque(summary_ref, 700),
      confidence: normalizeConfidence(confidence),
      source_refs: refs,
      tags: tagList,
      outcome: opaque(outcome, 100).toUpperCase(),
      status: memoryKind === 'PROCEDURAL' ? 'CANDIDATE' : 'VERIFIED_SOURCE_BOUND',
      created_at: iso(this.#clock),
      verified_at: null,
      verifier_refs: [],
      executable_payload_persisted: false,
      authority_effect: false,
    };
    return this.#store.transact((runtime) => {
      runtime.memory_records.push(record);
      runtime.memory_records = runtime.memory_records.slice(-4096);
      return clone(record);
    });
  }

  async verifyProceduralMemory({ memory_id, verifier_refs = [], replay_pass, safety_pass } = {}) {
    const id = opaque(memory_id, 180);
    const refs = normalizeRefs(verifier_refs);
    if (refs.length === 0) throw new Error('system_intelligence_verifier_refs_required');
    return this.#store.transact((runtime) => {
      const row = runtime.memory_records.find((x) => x.memory_id === id);
      if (!row) throw new Error('system_intelligence_memory_not_found');
      if (row.kind !== 'PROCEDURAL') throw new Error('system_intelligence_memory_not_procedural');
      row.verifier_refs = refs;
      row.verified_at = iso(this.#clock);
      row.status = replay_pass === true && safety_pass === true ? 'VERIFIED_BRANCH_LOCAL' : 'REJECTED';
      return clone(row);
    });
  }

  async proposeLearningCandidate({ target, rationale_ref, memory_ids = [], evaluation_plan_ref } = {}) {
    const learningTarget = String(target || '').toUpperCase();
    if (!LEARNING_TARGETS.includes(learningTarget)) throw new Error('system_intelligence_learning_target_invalid');
    if (!Array.isArray(memory_ids) || memory_ids.length === 0) throw new Error('system_intelligence_learning_memories_required');
    const ids = [...new Set(memory_ids.map((x) => opaque(x, 180)))];
    const known = new Set(this.#store.snapshot().memory_records.map((x) => x.memory_id));
    if (ids.some((id) => !known.has(id))) throw new Error('system_intelligence_learning_memory_unknown');
    const candidate = {
      schema: 'metaengine.browser.learning-candidate.v1',
      candidate_id: `learn_${this.#uuid()}`,
      target: learningTarget,
      rationale_ref: opaque(rationale_ref, 700),
      memory_ids: ids,
      evaluation_plan_ref: opaque(evaluation_plan_ref, 700),
      status: 'CANDIDATE',
      activation_scope: 'NONE',
      verifier_refs: [],
      benchmark_delta: null,
      regression_count: null,
      created_at: iso(this.#clock),
      verified_at: null,
      production_activation_authority: false,
      authority_effect: false,
    };
    return this.#store.transact((runtime) => {
      runtime.learning_candidates.push(candidate);
      runtime.learning_candidates = runtime.learning_candidates.slice(-1024);
      return clone(candidate);
    });
  }

  async verifyLearningCandidate({ candidate_id, verifier_refs = [], replay_pass, safety_pass, benchmark_delta = 0, regression_count = 0 } = {}) {
    const id = opaque(candidate_id, 180);
    const refs = normalizeRefs(verifier_refs);
    if (refs.length === 0) throw new Error('system_intelligence_learning_verifiers_required');
    const delta = Number(benchmark_delta);
    const regressions = Number(regression_count);
    if (!Number.isFinite(delta) || !Number.isSafeInteger(regressions) || regressions < 0) throw new Error('system_intelligence_learning_metrics_invalid');
    return this.#store.transact((runtime) => {
      const row = runtime.learning_candidates.find((x) => x.candidate_id === id);
      if (!row) throw new Error('system_intelligence_learning_candidate_not_found');
      row.verifier_refs = refs;
      row.benchmark_delta = delta;
      row.regression_count = regressions;
      row.verified_at = iso(this.#clock);
      const pass = replay_pass === true && safety_pass === true && regressions === 0 && delta >= 0;
      row.status = pass ? 'VERIFIED' : 'REJECTED';
      row.activation_scope = pass ? 'BRANCH_LOCAL_ONLY' : 'NONE';
      row.production_activation_authority = false;
      return clone(row);
    });
  }
}
