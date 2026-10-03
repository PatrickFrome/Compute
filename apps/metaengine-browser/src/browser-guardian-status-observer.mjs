export const BROWSER_GUARDIAN_STATUS_OBSERVATION_TTL_MS = 10_000;
export const BROWSER_GUARDIAN_STATUS_OBSERVATION_DEADLINE_MS = 2_500;
export const BROWSER_GUARDIAN_MACHINE_BOOTSTRAP_LAUNCHER_SCHEMA =
  'metaengine.browser-guardian.machine-bootstrap-launcher.v1';

const STATUS_STATES = new Set([
  'READY',
  'ACTIVATION_REQUIRED',
  'OWNER_ENROLLMENT_REQUIRED',
  'HOLD',
  'AMBIGUOUS',
  'UNAVAILABLE',
]);

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function positive(value) {
  return value === true;
}

function historical(status, observedAtMs = 0) {
  if (!status || typeof status !== 'object') return null;
  return freeze({
    state: String(status.state || '') || null,
    observed_at: observedAtMs > 0 ? new Date(observedAtMs).toISOString() : null,
    guardian_service_ready: positive(status.guardian_service_ready),
    owner_binding_proven: positive(status.owner_binding_proven),
    device_binding_proven: positive(status.device_binding_proven),
  });
}

function historicalProjection(lastConfirmed) {
  return {
    last_confirmed_state: lastConfirmed?.state || null,
    last_confirmed_at: lastConfirmed?.observed_at || null,
    last_confirmed_guardian_service_ready: lastConfirmed?.guardian_service_ready === true,
    last_confirmed_owner_binding_proven: lastConfirmed?.owner_binding_proven === true,
    last_confirmed_device_binding_proven: lastConfirmed?.device_binding_proven === true,
  };
}

function validateStatus(value) {
  if (!value || value.schema !== BROWSER_GUARDIAN_MACHINE_BOOTSTRAP_LAUNCHER_SCHEMA) {
    throw new Error('guardian_status_observation_schema_invalid');
  }
  const state = String(value.state || '');
  if (!STATUS_STATES.has(state)) throw new Error('guardian_status_observation_state_invalid');
  if (value.authority_effect !== false || value.automatic_retry_allowed !== false) {
    throw new Error('guardian_status_observation_authority_invalid');
  }
  if (value.fixed_packaged_bootstrap !== true
      || value.caller_supplied_path_used !== false
      || value.caller_supplied_arguments_used !== false
      || value.arbitrary_shell_used !== false) {
    throw new Error('guardian_status_observation_bootstrap_contract_invalid');
  }
  if (value.ready !== (state === 'READY')
      || value.explicit_user_action_required !== (state !== 'READY')
      || value.uac_consent_required !== (state === 'ACTIVATION_REQUIRED')) {
    throw new Error('guardian_status_observation_state_flags_invalid');
  }

  const serviceReady = positive(value.guardian_service_ready);
  const ownerProven = positive(value.owner_binding_proven);
  const deviceProven = positive(value.device_binding_proven);

  if (state === 'READY') {
    if (!serviceReady || !ownerProven || !deviceProven) {
      throw new Error('guardian_status_observation_ready_proof_invalid');
    }
  } else if (ownerProven || deviceProven) {
    throw new Error('guardian_status_observation_nonready_proof_invalid');
  }

  if (state === 'OWNER_ENROLLMENT_REQUIRED') {
    if (!serviceReady || value.owner_binding_proven !== false || value.device_binding_proven !== false) {
      throw new Error('guardian_status_observation_enrollment_proof_invalid');
    }
  }
  if (state === 'ACTIVATION_REQUIRED' && value.guardian_service_ready !== false) {
    throw new Error('guardian_status_observation_activation_proof_invalid');
  }

  return value;
}

function unavailable(reason, extra = {}) {
  return freeze({
    schema: BROWSER_GUARDIAN_MACHINE_BOOTSTRAP_LAUNCHER_SCHEMA,
    state: 'HOLD',
    reason,
    ready: false,
    guardian_service_ready: false,
    owner_binding_proven: false,
    device_binding_proven: false,
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

function staleProjection(cached, {
  observedAt,
  expiresAt,
  inFlight,
  generation,
  revision,
  lastError,
  invalidatedReason,
} = {}) {
  const lastConfirmed = historical(cached, observedAt ? Date.parse(observedAt) : 0);
  return freeze({
    ...cached,
    state: 'HOLD',
    reason: 'GUARDIAN_OBSERVATION_STALE',
    ready: false,
    guardian_service_ready: false,
    owner_binding_proven: false,
    device_binding_proven: false,
    explicit_user_action_required: true,
    uac_consent_required: false,
    ...historicalProjection(lastConfirmed),
    observed_at: observedAt,
    expires_at: expiresAt,
    stale: true,
    refresh_in_flight: inFlight,
    observation_generation: generation,
    observation_revision: revision,
    observation_error: lastError,
    invalidated_reason: invalidatedReason,
    automatic_retry_allowed: false,
    authority_effect: false,
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
  let lastConfirmed = null;
  let observedAtMs = 0;
  let lastError = null;
  let retryNotBeforeMs = 0;
  let invalidatedReason = 'GUARDIAN_OBSERVATION_NOT_YET_AVAILABLE';
  let inFlight = null;

  function isFresh(at = now()) {
    return Boolean(cached && observedAtMs > 0 && at - observedAtMs <= ttl);
  }

  // A failed background observation is itself bounded negative evidence: it
  // cannot prove Guardian readiness, but immediately retrying the same failing
  // pipe/filesystem path on every 2s heartbeat can monopolize the Electron main
  // process. Suppress only automatic background refreshes for one observation
  // TTL. Explicit force=true operator reads still bypass this backoff.
  function backgroundRetrySuppressed(at = now()) {
    return Boolean(lastError && retryNotBeforeMs > at);
  }

  function retryProjection() {
    return retryNotBeforeMs > 0 ? new Date(retryNotBeforeMs).toISOString() : null;
  }

  function projected(at = now()) {
    if (!cached) {
      return unavailable(lastError ? 'GUARDIAN_OBSERVATION_FAILED' : invalidatedReason, {
        ...historicalProjection(lastConfirmed),
        observed_at: null,
        expires_at: null,
        stale: true,
        refresh_in_flight: inFlight != null,
        observation_generation: generation,
        observation_revision: revision,
        observation_error: lastError,
        observation_retry_not_before: retryProjection(),
        invalidated_reason: invalidatedReason,
      });
    }
    const observedAt = observedAtMs > 0 ? new Date(observedAtMs).toISOString() : null;
    const expiresAt = observedAtMs > 0 ? new Date(observedAtMs + ttl).toISOString() : null;
    const stale = !isFresh(at);
    if (stale) {
      return staleProjection(cached, {
        observedAt,
        expiresAt,
        inFlight: inFlight != null,
        generation,
        revision,
        lastError,
        invalidatedReason,
      });
    }
    return freeze({
      ...cached,
      ...historicalProjection(lastConfirmed),
      observed_at: observedAt,
      expires_at: expiresAt,
      stale: false,
      refresh_in_flight: inFlight != null,
      observation_generation: generation,
      observation_revision: revision,
      observation_error: lastError,
      observation_retry_not_before: retryProjection(),
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
      lastConfirmed = historical(cached, observedAtMs);
      lastError = null;
      retryNotBeforeMs = 0;
      invalidatedReason = null;
      return projected();
    } catch (error) {
      if (capturedGeneration === generation) {
        lastError = String(error?.message || error).slice(0, 240);
        retryNotBeforeMs = now() + ttl;
      }
      return projected();
    } finally {
      if (timer != null) clearTimeoutImpl(timer);
    }
  }

  async function observe({ force = false } = {}) {
    if (!force && (isFresh() || backgroundRetrySuppressed())) return projected();
    if (inFlight) return inFlight;
    const capturedGeneration = generation;
    const promise = boundedRead(capturedGeneration).finally(() => {
      if (inFlight === promise) inFlight = null;
    });
    inFlight = promise;
    return promise;
  }

  function refreshIfDue() {
    if (inFlight || isFresh() || backgroundRetrySuppressed()) return false;
    void observe().catch(() => {});
    return true;
  }

  function invalidate(reason = 'GUARDIAN_OBSERVATION_INVALIDATED') {
    if (cached) lastConfirmed = historical(cached, observedAtMs);
    generation += 1;
    cached = null;
    observedAtMs = 0;
    lastError = null;
    retryNotBeforeMs = 0;
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
    lastConfirmed = historical(cached, observedAtMs);
    lastError = null;
    retryNotBeforeMs = 0;
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
    failed_background_read_backoff_ms: BROWSER_GUARDIAN_STATUS_OBSERVATION_TTL_MS,
    forced_operator_read_bypasses_background_backoff: true,
    freshness_ttl_ms: BROWSER_GUARDIAN_STATUS_OBSERVATION_TTL_MS,
    stale_ready_is_positive: false,
    stale_current_proof_flags_cleared: true,
    historical_proof_fields_explicit: true,
    activation_invalidates_prior_read_generation: true,
    activation_invalidation_clears_current_cached_proof: true,
    accepted_observation_revision_monotonic_within_process: true,
    discarded_late_read_advances_revision: false,
    late_prior_read_can_overwrite_post_activation_state: false,
    launcher_positive_state_requires_owner_and_device_proof: true,
    supervisor_admission_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
