import crypto from 'node:crypto';

export const FLEET_RUNTIME_VERSION = '1.0.0';
export const ASSIGNMENT_STATES = Object.freeze([
  'BOUND_UNVERIFIED',
  'READY',
  'RUNNING',
  'SETTLED',
  'FAILED',
  'LOST',
  'AMBIGUOUS_EFFECT',
]);
export const WAKE_REASONS = Object.freeze([
  'WORKER_RESULT_READY',
  'WORKER_FAILED',
  'WORKER_LOST',
  'CI_TERMINAL',
  'INTEGRATION_HEAD_CHANGED',
  'MILESTONE_READY_FOR_REVIEW',
  'WATCHDOG_DEADLINE',
  'SUPERVISOR_RECOVERY_REQUIRED',
]);

const AUTHORITY_SYSTEMS = new Set(['GITHUB','SUPABASE','NATIVE_CONTROL_PLANE']);
const READINESS_AUTHORITIES = new Set(['TRUSTED_NATIVE_CONTROL_PLANE']);
const TRANSPORT_KINDS = new Set(['SUPERVISOR_MEDIATED_ROUNDTRIP','LOCAL_NATIVE_TRANSPORT']);
const RESULT_STATUSES = new Set(['SUCCEEDED','FAILED']);
const EFFECT_OUTCOMES = new Set(['CONFIRMED_EFFECT','CONFIRMED_NO_EFFECT','AMBIGUOUS_EFFECT']);
const clone = (value) => value == null ? value : structuredClone(value);

function iso(clock) {
  const d = new Date(clock());
  if (!Number.isFinite(d.getTime())) throw new Error('fleet_runtime_clock_invalid');
  return d.toISOString();
}

function opaque(value, max = 200) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max || /[\r\n]/.test(text)) throw new Error('fleet_runtime_opaque_value_invalid');
  return text;
}

function normalizeAuthorityRefs(refs = []) {
  if (!Array.isArray(refs)) throw new Error('fleet_runtime_authority_refs_invalid');
  return refs.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('fleet_runtime_authority_ref_invalid');
    const system = String(row.system || '').toUpperCase();
    if (!AUTHORITY_SYSTEMS.has(system)) throw new Error('fleet_runtime_authority_system_invalid');
    return { system, ref: opaque(row.ref, 500) };
  });
}

function normalizeEvidenceRefs(refs = []) {
  if (!Array.isArray(refs)) throw new Error('fleet_runtime_evidence_refs_invalid');
  return refs.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('fleet_runtime_evidence_ref_invalid');
    const sha256 = String(row.sha256 || '').toLowerCase();
    if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('fleet_runtime_evidence_sha256_invalid');
    return {
      kind: opaque(row.kind, 80).toUpperCase(),
      ref: opaque(row.ref, 700),
      sha256: sha256 || null,
      authority_effect: false,
    };
  });
}

function workerIncarnationId(binding) {
  return `${opaque(binding.agent_id, 100)}:g${Number(binding.generation_epoch)}:${opaque(binding.target_id, 240)}`;
}

function assignmentKey(assignmentId, attemptId) {
  return `${opaque(assignmentId, 160)}::${opaque(attemptId, 160)}`;
}

export class FleetRuntime {
  #store;
  #clock;
  #uuid;

  constructor({ store, clock = () => Date.now(), uuid = () => crypto.randomUUID() } = {}) {
    if (!store || typeof store.init !== 'function' || typeof store.transact !== 'function') throw new Error('fleet_runtime_store_required');
    this.#store = store;
    this.#clock = clock;
    this.#uuid = uuid;
  }

  async init() {
    await this.#store.init();
    return this.snapshot();
  }

  snapshot() {
    const state = this.#store.snapshot();
    return Object.freeze({
      schema: 'metaengine.browser.fleet-runtime-snapshot.v1',
      version: FLEET_RUNTIME_VERSION,
      worker_bindings: clone(state.worker_bindings),
      assignments: clone(state.assignments),
      readiness_proofs: clone(state.readiness_proofs),
      result_receipts: clone(state.result_receipts),
      wake_events: clone(state.wake_events),
      policy: {
        browser_authority: false,
        direct_peer_messaging: false,
        automatic_work_retry_after_ambiguous_effect: false,
        page_model_data_authority: false,
      },
      authority_effect: false,
    });
  }

  async bindWorkerIncarnation(agent) {
    const agentId = opaque(agent?.agent_id, 100).toLowerCase();
    const targetId = opaque(agent?.target_id, 240).toLowerCase();
    const tabId = opaque(agent?.tab_id, 160);
    const generationEpoch = Number(agent?.generation_epoch);
    if (!Number.isSafeInteger(generationEpoch) || generationEpoch < 1) throw new Error('fleet_runtime_generation_epoch_invalid');
    if (String(agent?.lifecycle_state || '') !== 'BOUND_UNVERIFIED') throw new Error('fleet_runtime_worker_not_bound_unverified');
    const binding = {
      agent_id: agentId,
      role: opaque(agent?.role || 'WORKER', 80).toUpperCase(),
      worker_incarnation_id: workerIncarnationId({ agent_id: agentId, generation_epoch: generationEpoch, target_id: targetId }),
      generation_epoch: generationEpoch,
      conversation_epoch: Number.isSafeInteger(Number(agent?.conversation_epoch)) ? Number(agent.conversation_epoch) : 0,
      tab_id: tabId,
      target_id: targetId,
      lifecycle_state: 'BOUND_UNVERIFIED',
      browser_authority: false,
      direct_peer_messaging: false,
      automatic_work_retry: false,
      bound_at: iso(this.#clock),
      authority_effect: false,
    };
    return this.#store.transact((state) => {
      const index = state.worker_bindings.findIndex((row) => row.agent_id === agentId);
      if (index >= 0) state.worker_bindings[index] = binding;
      else state.worker_bindings.push(binding);
      return clone(binding);
    });
  }

  async createAssignment({
    assignment_id = `assign_${this.#uuid()}`,
    attempt_id = `attempt_${this.#uuid()}`,
    worker_id,
    cycle_id,
    task_kind = 'FLEET_WORK',
    authority_refs = [],
  } = {}) {
    const assignmentId = opaque(assignment_id, 160);
    const attemptId = opaque(attempt_id, 160);
    const workerId = opaque(worker_id, 100).toLowerCase();
    const cycleId = opaque(cycle_id || `cycle_${this.#uuid()}`, 160);
    const authorityRefs = normalizeAuthorityRefs(authority_refs);
    return this.#store.transact((state) => {
      const key = assignmentKey(assignmentId, attemptId);
      const existing = state.assignments.find((row) => row.assignment_key === key);
      if (existing) return clone(existing);
      if (state.assignments.some((row) => row.assignment_id === assignmentId && row.attempt_id !== attemptId)) throw new Error('fleet_runtime_assignment_attempt_conflict');
      const binding = state.worker_bindings.find((row) => row.agent_id === workerId);
      if (!binding) throw new Error('fleet_runtime_worker_binding_required');
      const assignment = {
        schema: 'metaengine.browser.fleet-assignment.v1',
        assignment_key: key,
        assignment_id: assignmentId,
        attempt_id: attemptId,
        cycle_id: cycleId,
        worker_id: workerId,
        worker_incarnation_id: binding.worker_incarnation_id,
        task_kind: opaque(task_kind, 100).toUpperCase(),
        state: 'BOUND_UNVERIFIED',
        authority_refs: authorityRefs,
        browser_authority: false,
        direct_peer_messaging: false,
        automatic_work_retry: false,
        retry_barrier: null,
        created_at: iso(this.#clock),
        updated_at: iso(this.#clock),
        authority_effect: false,
      };
      state.assignments.push(assignment);
      return clone(assignment);
    });
  }

  async recordReadinessProof({
    assignment_id,
    attempt_id,
    worker_incarnation_id,
    proof_id = `proof_${this.#uuid()}`,
    authority,
    source_taint,
    transport_kind,
    transport_session_id,
    ready,
  } = {}) {
    const assignmentId = opaque(assignment_id, 160);
    const attemptId = opaque(attempt_id, 160);
    const incarnationId = opaque(worker_incarnation_id, 500);
    const proofAuthority = String(authority || '').toUpperCase();
    const taint = String(source_taint || '').toUpperCase();
    const transportKind = String(transport_kind || '').toUpperCase();
    if (!READINESS_AUTHORITIES.has(proofAuthority)) throw new Error('fleet_runtime_readiness_authority_invalid');
    if (taint !== 'TRUSTED_CONTROL_PLANE') throw new Error('fleet_runtime_readiness_taint_invalid');
    if (!TRANSPORT_KINDS.has(transportKind)) throw new Error('fleet_runtime_transport_kind_invalid');
    if (ready !== true) throw new Error('fleet_runtime_readiness_not_proven');
    const transportSessionId = opaque(transport_session_id, 240);
    const proofId = opaque(proof_id, 160);
    return this.#store.transact((state) => {
      const assignment = state.assignments.find((row) => row.assignment_key === assignmentKey(assignmentId, attemptId));
      if (!assignment) throw new Error('fleet_runtime_assignment_not_found');
      if (assignment.worker_incarnation_id !== incarnationId) throw new Error('fleet_runtime_incarnation_mismatch');
      if (!['BOUND_UNVERIFIED','READY'].includes(assignment.state)) throw new Error('fleet_runtime_readiness_state_invalid');
      const existing = state.readiness_proofs.find((row) => row.proof_id === proofId);
      if (existing) {
        if (existing.assignment_key !== assignment.assignment_key) throw new Error('fleet_runtime_readiness_proof_conflict');
        return clone(existing);
      }
      const proof = {
        schema: 'metaengine.browser.fleet-readiness-proof.v1',
        proof_id: proofId,
        assignment_key: assignment.assignment_key,
        assignment_id: assignment.assignment_id,
        attempt_id: assignment.attempt_id,
        worker_incarnation_id: incarnationId,
        authority: proofAuthority,
        source_taint: taint,
        transport_kind: transportKind,
        transport_session_id: transportSessionId,
        ready: true,
        observed_at: iso(this.#clock),
        authority_effect: false,
      };
      state.readiness_proofs.push(proof);
      assignment.state = 'READY';
      assignment.updated_at = proof.observed_at;
      return clone(proof);
    });
  }

  async startAssignment({ assignment_id, attempt_id } = {}) {
    return this.#store.transact((state) => {
      const assignment = state.assignments.find((row) => row.assignment_key === assignmentKey(assignment_id, attempt_id));
      if (!assignment) throw new Error('fleet_runtime_assignment_not_found');
      if (assignment.state !== 'READY') throw new Error('fleet_runtime_assignment_not_ready');
      assignment.state = 'RUNNING';
      assignment.updated_at = iso(this.#clock);
      return clone(assignment);
    });
  }

  async recordResultReceipt({
    assignment_id,
    attempt_id,
    worker_incarnation_id,
    receipt_id = `receipt_${this.#uuid()}`,
    result_status,
    effect_outcome,
    evidence_refs = [],
  } = {}) {
    const assignmentId = opaque(assignment_id, 160);
    const attemptId = opaque(attempt_id, 160);
    const incarnationId = opaque(worker_incarnation_id, 500);
    const receiptId = opaque(receipt_id, 160);
    const status = String(result_status || '').toUpperCase();
    const effect = String(effect_outcome || '').toUpperCase();
    if (!RESULT_STATUSES.has(status)) throw new Error('fleet_runtime_result_status_invalid');
    if (!EFFECT_OUTCOMES.has(effect)) throw new Error('fleet_runtime_effect_outcome_invalid');
    const evidenceRefs = normalizeEvidenceRefs(evidence_refs);
    return this.#store.transact((state) => {
      const assignment = state.assignments.find((row) => row.assignment_key === assignmentKey(assignmentId, attemptId));
      if (!assignment) throw new Error('fleet_runtime_assignment_not_found');
      if (assignment.worker_incarnation_id !== incarnationId) throw new Error('fleet_runtime_incarnation_mismatch');
      if (!['READY','RUNNING'].includes(assignment.state)) throw new Error('fleet_runtime_result_state_invalid');
      const existing = state.result_receipts.find((row) => row.receipt_id === receiptId);
      if (existing) {
        if (existing.assignment_key !== assignment.assignment_key) throw new Error('fleet_runtime_result_receipt_conflict');
        return clone(existing);
      }
      const at = iso(this.#clock);
      const receipt = {
        schema: 'metaengine.browser.fleet-result-receipt.v1',
        receipt_id: receiptId,
        assignment_key: assignment.assignment_key,
        assignment_id: assignment.assignment_id,
        attempt_id: assignment.attempt_id,
        cycle_id: assignment.cycle_id,
        worker_id: assignment.worker_id,
        worker_incarnation_id: incarnationId,
        result_status: status,
        effect_outcome: effect,
        evidence_refs: evidenceRefs,
        received_at: at,
        browser_authority: false,
        authority_effect: false,
      };
      state.result_receipts.push(receipt);
      let wakeReason;
      if (effect === 'AMBIGUOUS_EFFECT') {
        assignment.state = 'AMBIGUOUS_EFFECT';
        assignment.retry_barrier = 'AMBIGUOUS_EFFECT_REQUIRES_MANUAL_RECONCILIATION';
        assignment.automatic_work_retry = false;
        wakeReason = 'SUPERVISOR_RECOVERY_REQUIRED';
      } else if (status === 'SUCCEEDED') {
        assignment.state = 'SETTLED';
        wakeReason = 'WORKER_RESULT_READY';
      } else {
        assignment.state = 'FAILED';
        wakeReason = 'WORKER_FAILED';
      }
      assignment.updated_at = at;
      this.#appendWakeEvent(state, {
        cycle_id: assignment.cycle_id,
        reason: wakeReason,
        assignment_key: assignment.assignment_key,
        cause_id: receipt.receipt_id,
      });
      return clone(receipt);
    });
  }

  async markWorkerLost({ worker_id, worker_incarnation_id, reason = 'WORKER_LOST' } = {}) {
    const workerId = opaque(worker_id, 100).toLowerCase();
    const incarnationId = worker_incarnation_id ? opaque(worker_incarnation_id, 500) : null;
    return this.#store.transact((state) => {
      const binding = state.worker_bindings.find((row) => row.agent_id === workerId);
      if (binding && incarnationId && binding.worker_incarnation_id !== incarnationId) return { changed: false, stale_incarnation: true };
      let changed = 0;
      for (const assignment of state.assignments) {
        if (assignment.worker_id !== workerId) continue;
        if (incarnationId && assignment.worker_incarnation_id !== incarnationId) continue;
        if (['SETTLED','FAILED','LOST','AMBIGUOUS_EFFECT'].includes(assignment.state)) continue;
        assignment.state = 'LOST';
        assignment.automatic_work_retry = false;
        assignment.retry_barrier = opaque(reason, 200);
        assignment.updated_at = iso(this.#clock);
        this.#appendWakeEvent(state, {
          cycle_id: assignment.cycle_id,
          reason: 'WORKER_LOST',
          assignment_key: assignment.assignment_key,
          cause_id: `lost:${workerId}:${assignment.updated_at}`,
        });
        changed += 1;
      }
      return { changed, authority_effect: false };
    });
  }

  async authorizeWake({ cycle_id, reason, cause_id, authority = 'TRUSTED_CONTROL_PLANE' } = {}) {
    if (String(authority || '').toUpperCase() !== 'TRUSTED_CONTROL_PLANE') throw new Error('fleet_runtime_wake_authority_invalid');
    const wakeReason = String(reason || '').toUpperCase();
    if (!WAKE_REASONS.includes(wakeReason) || wakeReason === 'WATCHDOG_DEADLINE') throw new Error('fleet_runtime_wake_reason_invalid');
    return this.#store.transact((state) => this.#appendWakeEvent(state, {
      cycle_id: opaque(cycle_id, 160),
      reason: wakeReason,
      assignment_key: null,
      cause_id: opaque(cause_id, 240),
    }));
  }

  listWakeEvents() {
    return this.#store.snapshot().wake_events
      .filter((row) => row.status === 'PENDING')
      .map(clone);
  }

  async markWakeEvent({ event_id, status, wake_id } = {}) {
    const eventId = opaque(event_id, 160);
    const nextStatus = String(status || '').toUpperCase();
    if (!['SENT','AMBIGUOUS','NO_EFFECT'].includes(nextStatus)) throw new Error('fleet_runtime_wake_event_status_invalid');
    return this.#store.transact((state) => {
      const event = state.wake_events.find((row) => row.event_id === eventId);
      if (!event) throw new Error('fleet_runtime_wake_event_not_found');
      if (event.status !== 'PENDING' && event.status !== nextStatus) throw new Error('fleet_runtime_wake_event_terminal');
      event.status = nextStatus;
      event.wake_id = opaque(wake_id, 160);
      event.updated_at = iso(this.#clock);
      return clone(event);
    });
  }

  #appendWakeEvent(state, { cycle_id, reason, assignment_key, cause_id }) {
    const wakeReason = String(reason || '').toUpperCase();
    if (!WAKE_REASONS.includes(wakeReason) || wakeReason === 'WATCHDOG_DEADLINE') throw new Error('fleet_runtime_wake_reason_invalid');
    const causeId = opaque(cause_id, 240);
    const dedupeKey = `${wakeReason}:${causeId}`;
    const existing = state.wake_events.find((row) => row.dedupe_key === dedupeKey);
    if (existing) return clone(existing);
    const at = iso(this.#clock);
    const event = {
      schema: 'metaengine.browser.fleet-wake-event.v1',
      event_id: `event_${this.#uuid()}`,
      dedupe_key: dedupeKey,
      cycle_id: opaque(cycle_id, 160),
      reason: wakeReason,
      assignment_key: assignment_key ? opaque(assignment_key, 340) : null,
      cause_id: causeId,
      status: 'PENDING',
      wake_id: null,
      created_at: at,
      updated_at: at,
      authority_effect: false,
    };
    state.wake_events.push(event);
    return clone(event);
  }
}
