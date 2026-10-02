export const BROWSER_GUARDIAN_STATUS_OBSERVATION_TTL_MS = 10_000;
export const BROWSER_GUARDIAN_STATUS_OBSERVATION_DEADLINE_MS = 2_500;
export const BROWSER_GUARDIAN_MACHINE_BOOTSTRAP_LAUNCHER_SCHEMA =
  'metaengine.browser-guardian.machine-bootstrap-launcher.v1';

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function validateStatus(value) {
  if (!value || value.schema !== BROWSER_GUARDIAN_MACHINE_BOOTSTRAP_LAUNCHER_SCHEMA) {
    throw new Error('guardian_status_observation_schema_invalid');
  }
  if (value.authority_effect !== false || value.automatic_retry_allowed !== false) {
    throw new Error('guardian_status_observation_authority_invalid');
  }
  return value;
}

function unavailable(reason, extra = {}) {
  return freeze({
    schema: BROWSER_GUARDIAN_MACHINE_BOOTSTRAP_LAUNCHER_SCHEMA,
    state: 'HOLD',
    reason,
    ready: false,
    explicit_user_action_required: true,
    uac_consent_required: false,
    fixed_packaged_bootstrap: true,
    caller_supplied_path_used: false,
    caller_supplied_arguments_used: false,
    arbitrary_shell_used: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...extra,
  });
}

export function createBrowserGuardianStatusObserver({
  readStatus,
  ttlMs = BROWSER_GUARDIAN_STATUS_OBSERVATION_TTL_MS,
  deadlineMs = BROWSER_GUARDIAN_STATUS_OBSERVATION_DEADLINE_MS,
  now = () => Date.now(),
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  if (typeof readStatus !== 'function') throw new Error('guardian_status_observer_reader_required');
  const ttl = Math.max(1_000, Math.min(60_000, Number(ttlMs) || BROWSER_GUARDIAN_STATUS_OBSERVATION_TTL_MS));
  const deadline = Math.max(500, Math.min(5_000, Number(deadlineMs) || BROWSER_GUARDIAN_STATUS_OBSERVATION_DEADLINE_MS));

  let generation = 0;
  let revision = 0;
  let cached = null;
  let observedAtMs = 0;
  let lastError = null;
  let invalidatedReason = 'GUARDIAN_OBSERVATION_NOT_YET_AVAILABLE';
  let inFlight = null;

  function isFresh(at = now()) {
    return Boolean(cached && observedAtMs > 0 && at - observedAtMs <= ttl);
  }

  function projected(at = now()) {
    if (!cached) {
      return unavailable(lastError ? 'GUARDIAN_OBSERVATION_FAILED' : invalidatedReason, {
        observed_at: null,
        expires_at: null,
        stale: true,
        refresh_in_flight: inFlight != null,
        observation_generation: generation,
        observation_revision: revision,
        observation_error: lastError,
      });
    }
    const observedAt = observedAtMs > 0 ? new Date(observedAtMs).toISOString() : null;
    const expiresAt = observedAtMs > 0 ? new Date(observedAtMs + ttl).toISOString() : null;
    const stale = !isFresh(at);
    if (stale) {
      return freeze({
        ...cached,
        state: 'HOLD',
        reason: 'GUARDIAN_OBSERVATION_STALE',
        ready: false,
        last_confirmed_state: cached.state,
        observed_at: observedAt,
        expires_at: expiresAt,
        stale: true,
        refresh_in_flight: inFlight != null,
        observation_generation: generation,
        observation_revision: revision,
        observation_error: lastError,
        invalidated_reason: invalidatedReason,
        automatic_retry_allowed: false,
        authority_effect: false,
      });
    }
    return freeze({
      ...cached,
      observed_at: observedAt,
      expires_at: expiresAt,
      stale: false,
      refresh_in_flight: inFlight != null,
      observation_generation: generation,
      observation_revision: revision,
      observation_error: lastError,
      invalidated_reason: invalidatedReason,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }

  async function boundedRead(capturedGeneration) {
    let timer = null;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => readStatus()),
        new Promise((_, reject) => {
          timer = setTimeoutImpl(
            () => reject(Object.assign(new Error('guardian_status_observation_deadline'), { code: 'GUARDIAN_STATUS_OBSERVATION_DEADLINE' })),
            deadline,
          );
        }),
      ]);
      if (capturedGeneration !== generation) return projected();
      cached = validateStatus(result);
      observedAtMs = now();
      revision += 1;
      lastError = null;
      invalidatedReason = null;
      return projected();
    } catch (error) {
      if (capturedGeneration === generation) {
        lastError = String(error?.message || error).slice(0, 240);
      }
      return projected();
    } finally {
      if (timer != null) clearTimeoutImpl(timer);
    }
  }

  async function observe({ force = false } = {}) {
    if (!force && isFresh()) return projected();
    if (inFlight) return inFlight;
    const capturedGeneration = generation;
    const promise = boundedRead(capturedGeneration).finally(() => {
      if (inFlight === promise) inFlight = null;
    });
    inFlight = promise;
    return promise;
  }

  function refreshIfDue() {
    if (inFlight || isFresh()) return false;
    void observe().catch(() => {});
    return true;
  }

  function invalidate(reason = 'GUARDIAN_OBSERVATION_INVALIDATED') {
    generation += 1;
    observedAtMs = 0;
    lastError = null;
    invalidatedReason = String(reason || 'GUARDIAN_OBSERVATION_INVALIDATED').slice(0, 120);
    return projected();
  }

  async function quiesce() {
    if (!inFlight) return projected();
    try { await inFlight; } catch {}
    return projected();
  }

  function record(status) {
    generation += 1;
    cached = validateStatus(status);
    observedAtMs = now();
    revision += 1;
    lastError = null;
    invalidatedReason = null;
    return projected();
  }

  return Object.freeze({
    snapshot: () => projected(),
    observe,
    refreshIfDue,
    invalidate,
    quiesce,
    record,
  });
}

export function browserGuardianStatusObserverContract() {
  return freeze({
    shared_settings_and_heartbeat_observer: true,
    single_inflight_read: true,
    bounded_read_deadline_ms: BROWSER_GUARDIAN_STATUS_OBSERVATION_DEADLINE_MS,
    freshness_ttl_ms: BROWSER_GUARDIAN_STATUS_OBSERVATION_TTL_MS,
    stale_ready_is_positive: false,
    activation_invalidates_prior_read_generation: true,
    accepted_observation_revision_monotonic_within_process: true,
    discarded_late_read_advances_revision: false,
    late_prior_read_can_overwrite_post_activation_state: false,
    supervisor_admission_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
