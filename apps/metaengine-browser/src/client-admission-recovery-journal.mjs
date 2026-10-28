const SCHEMA = 'metaengine.client.admission-recovery-journal.v1';
const ATTEMPT_SCHEMA = 'metaengine.client.admission-recovery-attempt.v1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES = new Set([
  'PREPARED',
  'SEND_INTENT_DURABLE',
  'AMBIGUOUS',
  'RECEIPT_RECEIVED',
  'OPEN_CONFIRMED',
  'ABSENCE_CONFIRMED',
  'REJECTED',
]);
const PENDING = new Set(['PREPARED', 'SEND_INTENT_DURABLE', 'AMBIGUOUS', 'RECEIPT_RECEIVED']);

const clone = (value) => value == null ? value : structuredClone(value);
const nowIso = () => new Date().toISOString();

function attemptId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!UUID_RE.test(id)) throw new Error('client_admission_recovery_attempt_id_invalid');
  return id;
}

function floor(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('client_admission_recovery_generation_floor_invalid');
  return number;
}

function safeError(value) {
  return String(value?.message || value || '').slice(0, 240) || null;
}

function normalizeAttempt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('client_admission_recovery_attempt_invalid');
  }
  const state = String(value.state || '').toUpperCase();
  if (!STATES.has(state)) throw new Error('client_admission_recovery_state_invalid');
  if (value.operator_initiated !== true || value.automatic_retry_allowed !== false || value.authority_effect !== false) {
    throw new Error('client_admission_recovery_authority_invalid');
  }
  const receipt = value.receipt && typeof value.receipt === 'object' && !Array.isArray(value.receipt)
    ? Object.freeze(clone(value.receipt))
    : null;
  const observation = value.observation && typeof value.observation === 'object' && !Array.isArray(value.observation)
    ? Object.freeze(clone(value.observation))
    : null;
  return Object.freeze({
    schema: ATTEMPT_SCHEMA,
    attempt_id: attemptId(value.attempt_id),
    expected_generation_floor: floor(value.expected_generation_floor),
    state,
    receipt,
    observation,
    last_error: value.last_error == null ? null : String(value.last_error).slice(0, 240),
    created_at: String(value.created_at || nowIso()),
    updated_at: String(value.updated_at || nowIso()),
    operator_initiated: true,
    effect_intent_durable: value.effect_intent_durable === true,
    retry_requires_new_user_action: true,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function emptyState() {
  return Object.freeze({
    schema: SCHEMA,
    latest: null,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function isAuthoritativeState(value) {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value)
    && value.schema === 'metaengine.devos.environment-state.v1'
    && value.authoritative === true
    && value.authority_effect === false
    && UUID_RE.test(String(value.read_request_id || ''))
    && value.observation_source === 'AUTHENTICATED_POST_RESPONSE'
    && Number.isFinite(Date.parse(String(value.observed_at || '')))
    && Number.isSafeInteger(Number(value.generation_floor))
    && Number(value.generation_floor) >= 0
    && typeof value.refill_enabled === 'boolean'
    && typeof value.supervisor_admission_enabled === 'boolean'
    && typeof value.continuous_service_allowed === 'boolean'
  );
}

export function classifyAdmissionRecoveryObservation(attempt, environmentState) {
  const current = normalizeAttempt(attempt);
  if (!isAuthoritativeState(environmentState)) {
    return Object.freeze({ disposition: 'UNAVAILABLE', terminal: false, authority_effect: false });
  }
  const observedAtMs = Date.parse(String(environmentState.observed_at || ''));
  const attemptUpdatedAtMs = Date.parse(String(current.updated_at || ''));
  if (!Number.isFinite(observedAtMs) || !Number.isFinite(attemptUpdatedAtMs) || observedAtMs < attemptUpdatedAtMs) {
    return Object.freeze({
      disposition: 'STALE_OBSERVATION',
      terminal: false,
      authority_effect: false,
    });
  }
  const observedFloor = Number(environmentState.generation_floor);
  if (observedFloor !== current.expected_generation_floor) {
    return Object.freeze({
      disposition: 'GENERATION_DRIFT',
      terminal: true,
      observed_generation_floor: observedFloor,
      authority_effect: false,
    });
  }
  const open = environmentState.state === 'OPEN'
    && environmentState.refill_enabled === true
    && environmentState.supervisor_admission_enabled === true
    && environmentState.continuous_service_allowed === true;
  return Object.freeze({
    disposition: open ? 'OPEN_CONFIRMED' : 'ABSENCE_CONFIRMED',
    terminal: true,
    observed_generation_floor: observedFloor,
    authority_effect: false,
  });
}

export class ClientAdmissionRecoveryJournal {
  #loadState;
  #saveState;
  #state = emptyState();
  #loaded = false;
  #loadPromise = null;
  #writeTail = Promise.resolve();
  #persistenceFenced = false;

  constructor({ loadState, saveState } = {}) {
    if (typeof loadState !== 'function' || typeof saveState !== 'function') {
      throw new Error('client_admission_recovery_storage_required');
    }
    this.#loadState = loadState;
    this.#saveState = saveState;
  }

  async load() {
    if (this.#loaded) return this.snapshot();
    // Every startup caller must observe the same read. A slower second read
    // must never overwrite an admission already persisted by the first caller.
    if (!this.#loadPromise) {
      this.#loadPromise = this.#readInitialState().finally(() => { this.#loadPromise = null; });
    }
    return this.#loadPromise;
  }

  async #readInitialState() {
    let raw = null;
    try { raw = await this.#loadState(); } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (raw != null) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)
        || raw.schema !== SCHEMA
        || raw.automatic_retry_allowed !== false
        || raw.authority_effect !== false) {
        throw new Error('client_admission_recovery_snapshot_invalid');
      }
      this.#state = Object.freeze({
        ...emptyState(),
        latest: raw.latest == null ? null : normalizeAttempt(raw.latest),
      });
    }
    this.#loaded = true;
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze(clone(this.#state));
  }

  latest() {
    return this.#state.latest ? Object.freeze(clone(this.#state.latest)) : null;
  }

  hasPending() {
    return this.#persistenceFenced || PENDING.has(String(this.#state.latest?.state || ''));
  }

  persistenceStatus() {
    return Object.freeze({ schema: 'metaengine.client.admission-recovery-persistence.v1',
      fenced: this.#persistenceFenced, automatic_retry_allowed: false, authority_effect: false });
  }

  #replace(change) {
    const write = this.#writeTail.then(async () => {
      if (this.#persistenceFenced) throw new Error('client_admission_recovery_persistence_reconciliation_required');
      if (!this.#loaded) await this.load();
      const next = normalizeAttempt(change(this.#state.latest));
      const state = Object.freeze({ ...emptyState(), latest: next });
      try { await this.#saveState(clone(state)); }
      catch (error) {
        // The rename might already be durable, even if readback failed.
        // Fail closed until the next process reads the exact on-disk record.
        this.#persistenceFenced = true;
        throw error;
      }
      this.#state = state;
      return Object.freeze(clone(next));
    });
    this.#writeTail = write.catch(() => {});
    return write;
  }

  async begin({ attempt_id, expected_generation_floor }) {
    if (!this.#loaded) await this.load();
    if (this.hasPending()) throw new Error('client_admission_recovery_pending_reconcile_required');
    const observed = nowIso();
    return this.#replace(existing => {
      // This check must execute INSIDE the serialized write tail. Two callers
      // can both pass the optimistic hasPending() check before either write.
      if (PENDING.has(String(existing?.state || ''))) {
        throw new Error('client_admission_recovery_pending_reconcile_required');
      }
      return {
      schema: ATTEMPT_SCHEMA,
      attempt_id: attemptId(attempt_id),
      expected_generation_floor: floor(expected_generation_floor),
      state: 'PREPARED',
      receipt: null,
      observation: null,
      last_error: null,
      created_at: observed,
      updated_at: observed,
      operator_initiated: true,
      effect_intent_durable: false,
      automatic_retry_allowed: false,
      authority_effect: false,
      };
    });
  }

  async markSendIntent() {
    return this.#replace((existing) => {
      if (!existing || existing.state !== 'PREPARED') throw new Error('client_admission_recovery_prepare_missing');
      return {
        ...existing,
        state: 'SEND_INTENT_DURABLE',
        effect_intent_durable: true,
        updated_at: nowIso(),
      };
    });
  }

  async markAmbiguous(error) {
    return this.#replace((existing) => {
      if (!existing || !PENDING.has(existing.state)) throw new Error('client_admission_recovery_pending_missing');
      return {
        ...existing,
        state: 'AMBIGUOUS',
        effect_intent_durable: true,
        last_error: safeError(error),
        updated_at: nowIso(),
      };
    });
  }

  async recordReceipt(receipt) {
    return this.#replace((existing) => {
      if (!existing || !PENDING.has(existing.state)) throw new Error('client_admission_recovery_pending_missing');
      if (receipt?.schema !== 'metaengine.devos.environment-resume.v1'
        || receipt?.resumed !== true
        || Number(receipt?.requested_floor) !== existing.expected_generation_floor
        || receipt?.operator_initiated !== true
        || receipt?.automatic_retry_allowed !== false
        || receipt?.authority_effect !== false) {
        throw new Error('client_admission_recovery_receipt_invalid');
      }
      return {
        ...existing,
        state: 'RECEIPT_RECEIVED',
        receipt: clone(receipt),
        effect_intent_durable: true,
        last_error: null,
        updated_at: nowIso(),
      };
    });
  }

  async reconcile(environmentState) {
    if (this.#persistenceFenced) throw new Error('client_admission_recovery_persistence_reconciliation_required');
    if (!this.#loaded) await this.load();
    const existing = this.#state.latest;
    if (!existing || !PENDING.has(existing.state)) return existing ? Object.freeze(clone(existing)) : null;
    const classification = classifyAdmissionRecoveryObservation(existing, environmentState);
    if (classification.terminal !== true) return Object.freeze(clone(existing));
    return this.#replace(current => {
      // The readback was classified against a snapshot outside the write
      // queue. Never let it finalize a newer attempt or a state advanced by
      // another concurrent observer in the meantime.
      if (!current || current.attempt_id !== existing.attempt_id
        || current.state !== existing.state || current.updated_at !== existing.updated_at
        || current.expected_generation_floor !== existing.expected_generation_floor) {
        throw new Error('client_admission_recovery_reconcile_snapshot_changed');
      }
      const fresh = classifyAdmissionRecoveryObservation(current, environmentState);
      if (fresh.terminal !== true || fresh.disposition !== classification.disposition) {
        throw new Error('client_admission_recovery_reconcile_observation_stale');
      }
      const nextState = fresh.disposition === 'OPEN_CONFIRMED'
        ? 'OPEN_CONFIRMED' : fresh.disposition === 'ABSENCE_CONFIRMED'
          ? 'ABSENCE_CONFIRMED' : 'REJECTED';
      return {
        ...current,
        state: nextState,
        observation: clone(environmentState),
        last_error: fresh.disposition === 'GENERATION_DRIFT' ? 'GENERATION_DRIFT' : null,
        updated_at: nowIso(),
      };
    });
  }
}

export const CLIENT_ADMISSION_RECOVERY_JOURNAL_SCHEMA = SCHEMA;
export const CLIENT_ADMISSION_RECOVERY_ATTEMPT_SCHEMA = ATTEMPT_SCHEMA;
export const CLIENT_ADMISSION_RECOVERY_PENDING_STATES = Object.freeze([...PENDING]);
