export const CLIENT_ADMISSION_RECOVERY_SCHEMA = 'metaengine.client.admission-recovery.v1';
export const CLIENT_ADMISSION_RECOVERY_STATE_SCHEMA = 'metaengine.client.admission-recovery-state.v1';

const ACTIVE_STATES = new Set(['PENDING', 'READBACK_REQUIRED', 'AMBIGUOUS']);
const STORED_STATES = new Set([...ACTIVE_STATES, 'CONFIRMED', 'NO_EFFECT']);
const STATE_KEYS = ['schema', 'state', 'expected_generation_floor', 'requested_at', 'preattempt_heartbeat_at', 'confirmed_heartbeat_at'];
const isFloor = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;
const exactKeys = (value, keys) => isObject(value) && Reflect.ownKeys(value).length === keys.length
  && keys.every((key) => Object.hasOwn(value, key));

function validStoredState(value) {
  return exactKeys(value, STATE_KEYS)
    && value.schema === CLIENT_ADMISSION_RECOVERY_STATE_SCHEMA
    && STORED_STATES.has(value.state) && isFloor(value.expected_generation_floor)
    && isTime(value.requested_at) && isTime(value.preattempt_heartbeat_at)
    && Date.parse(value.preattempt_heartbeat_at) <= Date.parse(value.requested_at) + 5_000
    && (value.state === 'CONFIRMED'
      ? isTime(value.confirmed_heartbeat_at)
        && Date.parse(value.confirmed_heartbeat_at) > Date.parse(value.requested_at)
        && Date.parse(value.confirmed_heartbeat_at) > Date.parse(value.preattempt_heartbeat_at)
      : value.confirmed_heartbeat_at === null);
}

function publicStatus(state, reason, attempt = null) {
  return Object.freeze({
    schema: CLIENT_ADMISSION_RECOVERY_SCHEMA,
    state, reason,
    expected_generation_floor: attempt?.expected_generation_floor ?? null,
    requested_at: attempt?.requested_at ?? null,
    fresh_readback_required: ACTIVE_STATES.has(state) || (state === 'HOLD' && ACTIVE_STATES.has(attempt?.state)),
    automatic_retry_allowed: false,
    scheduler_authority: false,
    authority_effect: false,
  });
}

function trustedRuntime(snapshot) {
  const runtime = snapshot?.continuous_service?.runtime_control;
  return isObject(runtime)
    && runtime.schema === 'metaengine.devos.environment-state.v1'
    && runtime.authoritative === true && runtime.authority_effect === false && runtime.automatic_retry_allowed === false
    && isFloor(runtime.generation_floor)
    && typeof runtime.refill_enabled === 'boolean'
    && typeof runtime.supervisor_admission_enabled === 'boolean'
    && typeof runtime.continuous_service_allowed === 'boolean'
    ? runtime : null;
}

function freshHeartbeat(snapshot, now) {
  const heartbeat = snapshot?.last_heartbeat_at;
  if (!isTime(heartbeat)) return null;
  const at = Date.parse(heartbeat);
  return at <= now + 5_000 && now - at <= 30_000 ? heartbeat : null;
}

function validWorkObservation(work) {
  return isObject(work) && work.schema === 'metaengine.client.work-readiness.v1' && work.authority_effect === false
    && work.scheduler_authority === false && work.automatic_retry_allowed === false
    && work.recovery_effect_exposed === false && work.useful_work_verified === false;
}

function sameObservedFloor(work, snapshot, floor) {
  return validWorkObservation(work) && isFloor(work.generation_floor) && isFloor(work.local_generation_floor)
    && isFloor(snapshot?.lifecycle?.keepalive?.admission_generation_floor)
    && work.generation_floor === floor && work.local_generation_floor === floor
    && snapshot.lifecycle.keepalive.admission_generation_floor === floor;
}

function independentOpenHeartbeat(observation, attempt, now) {
  const runtime = trustedRuntime(observation.snapshot);
  const heartbeat = freshHeartbeat(observation.snapshot, now);
  return runtime?.state === 'OPEN' && runtime.refill_enabled === true && runtime.supervisor_admission_enabled === true
    && runtime.continuous_service_allowed === true && runtime.generation_floor === attempt.expected_generation_floor
    && sameObservedFloor(observation.work, observation.snapshot, attempt.expected_generation_floor)
    && observation.work.heartbeat_fresh === true && heartbeat
    && Date.parse(heartbeat) > Date.parse(attempt.preattempt_heartbeat_at)
    && Date.parse(heartbeat) > Date.parse(attempt.requested_at) ? heartbeat : null;
}

function admissionGuard({ connection, work, snapshot }, now, expectedFloor = null) {
  if (connection?.schema !== 'metaengine.client.connection-status.v1' || connection.authority_effect !== false
    || connection.local_runtime_ready !== true || connection.secure_device_key_ready !== true
    || connection.device_enrolled !== true || connection.admin_ready !== true || connection.access_tier !== 'ADMIN'
    || connection.cloud_control_state !== 'CONNECTED' || !Array.isArray(connection.admin_scopes)
    || !connection.admin_scopes.includes('CONTROL_PLANE')) return 'ADMIN_CONTROL_CONNECTION_REQUIRED';
  if (!validWorkObservation(work) || work.execution_ready !== false || work.state !== 'PAUSED'
    || work.reason !== 'WORKSPACE_EXECUTION_PAUSED') {
    return 'WORKSPACE_PAUSE_READBACK_REQUIRED';
  }
  if (work.heartbeat_fresh !== true || !freshHeartbeat(snapshot, now)) return 'FRESH_HEARTBEAT_REQUIRED';
  const runtime = trustedRuntime(snapshot);
  const localFloor = snapshot?.lifecycle?.keepalive?.admission_generation_floor;
  if (!runtime || runtime.state !== 'CLOSED' || runtime.continuous_service_allowed !== false
    || (runtime.refill_enabled === true && runtime.supervisor_admission_enabled === true)) return 'WORKSPACE_AUTHORITY_REQUIRED';
  if (!isFloor(localFloor) || !sameObservedFloor(work, snapshot, runtime.generation_floor)
    || (expectedFloor !== null && runtime.generation_floor !== expectedFloor)) return 'GENERATION_FLOOR_MISMATCH';
  return null;
}

function validOwnerReceipt(value, floor) {
  return isObject(value) && value.schema === 'metaengine.devos.environment-resume.v1'
    && value.resumed === true && value.requested_floor === floor
    && value.before?.generation_floor === floor && value.after?.generation_floor === floor
    && value.before?.state === 'CLOSED' && typeof value.before?.supervisor_admission_enabled === 'boolean'
    && value.after?.state === 'OPEN' && value.after?.supervisor_admission_enabled === true
    && value.after?.continuous_service_allowed === true
    && value.operator_initiated === true && value.automatic_retry_allowed === false && value.authority_effect === false;
}

export function assertClientAdmissionRecoverySender(event, { webContents, primaryShellMode, primaryShellUrl } = {}) {
  let trusted = false;
  try {
    const sender = event?.sender;
    const frame = event?.senderFrame;
    const expected = new URL(primaryShellUrl);
    const actual = new URL(frame?.url);
    trusted = Boolean(webContents && sender && frame && webContents.mainFrame
      && sender === webContents
      && frame === webContents.mainFrame && primaryShellMode === 'ME2_PRIMARY'
      && expected.protocol === 'http:' && expected.hostname === '127.0.0.1'
      && expected.port && expected.pathname === '/' && !expected.search && !expected.username && !expected.password
      && !actual.username && !actual.password && actual.origin === expected.origin
      && frame.origin === expected.origin
      && actual.pathname === '/' && !actual.search
      && (typeof webContents.isDestroyed !== 'function' || webContents.isDestroyed() !== true)
      && frame.detached !== true);
  } catch { /* invalid/missing frame and URL fail closed */ }
  if (!trusted) throw new Error('client_admission_recovery_sender_not_trusted');
}

// This is a product intent boundary over the existing signed/CAS owner rail.
// Durable state records ambiguity; no receipt grants local execution authority.
export function createClientAdmissionRecovery({
  readConnection, readWorkReadiness, readSnapshot, resumeAdmission, loadState, saveState, now = Date.now,
  deadlineMs = 15_000,
} = {}) {
  for (const fn of [readConnection, readWorkReadiness, readSnapshot, resumeAdmission, loadState, saveState, now]) {
    if (typeof fn !== 'function') throw new Error('client_admission_recovery_dependencies_invalid');
  }
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 30_000) {
    throw new Error('client_admission_recovery_deadline_invalid');
  }
  let attempt = null;
  let initialization = null;
  let stateCorrupt = false;
  let storageFailed = false;
  let resumeBusy = false;
  let statusBusy = null;

  function readClock() {
    try {
      const value = now();
      return Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime()) ? value : null;
    } catch { return null; }
  }

  async function initialize() {
    if (!initialization) initialization = (async () => {
      try {
        const loaded = await loadState();
        if (!validStoredState(loaded)) { stateCorrupt = true; return; }
        attempt = Object.freeze({ ...loaded });
      } catch (error) {
        if (error?.code === 'ENOENT') return;
        if (error instanceof SyntaxError) stateCorrupt = true;
        else storageFailed = true;
      }
    })();
    await initialization;
  }

  async function persist(next) {
    try {
      await saveState(Object.freeze({ ...next }));
      attempt = Object.freeze({ ...next });
      storageFailed = false;
      return true;
    } catch {
      storageFailed = true;
      return false;
    }
  }

  async function observe() {
    const [connection, work, snapshot] = await Promise.all([readConnection(), readWorkReadiness(), readSnapshot()]);
    return { connection, work, snapshot };
  }

  async function awaitOwner(request) {
    let timer;
    const abortController = new AbortController();
    try {
      return await Promise.race([
        Promise.resolve().then(() => resumeAdmission({ ...request, signal: abortController.signal })),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            abortController.abort();
            reject(new Error('client_admission_owner_deadline'));
          }, deadlineMs);
        }),
      ]);
    } finally { clearTimeout(timer); }
  }

  function stateHold() {
    if (stateCorrupt) return publicStatus('HOLD', 'RECOVERY_STATE_INVALID', attempt);
    if (storageFailed) return publicStatus('HOLD', 'RECOVERY_STATE_STORAGE_UNAVAILABLE', attempt);
    return null;
  }

  async function status() {
    await initialize();
    if (stateHold()) return stateHold();
    if (resumeBusy) return publicStatus('PENDING', 'OPERATOR_REQUEST_IN_PROGRESS', attempt);
    if (statusBusy) return statusBusy;
    statusBusy = (async () => {
      let observation;
      try { observation = await observe(); }
      catch { return publicStatus('HOLD', 'NATIVE_READBACK_UNAVAILABLE', attempt); }
      const observedAt = readClock();
      if (observedAt === null) return publicStatus('HOLD', 'CLOCK_UNAVAILABLE', attempt);
      if (attempt && ACTIVE_STATES.has(attempt.state)) {
        const heartbeat = independentOpenHeartbeat(observation, attempt, observedAt);
        if (heartbeat) {
          if (!await persist({ ...attempt, state: 'CONFIRMED', confirmed_heartbeat_at: heartbeat })) return stateHold();
          return publicStatus('CONFIRMED', 'AUTHORITATIVE_OPEN_OBSERVED', attempt);
        }
        if (storageFailed) return stateHold();
        return publicStatus(attempt.state, 'INDEPENDENT_OPEN_READBACK_REQUIRED', attempt);
      }
      if (storageFailed) return stateHold();
      const reason = admissionGuard(observation, observedAt);
      if (attempt?.state === 'CONFIRMED') {
        const heartbeat = independentOpenHeartbeat(observation, attempt, observedAt);
        if (heartbeat && Date.parse(heartbeat) >= Date.parse(attempt.confirmed_heartbeat_at)) {
          if (Date.parse(heartbeat) > Date.parse(attempt.confirmed_heartbeat_at)
            && !await persist({ ...attempt, confirmed_heartbeat_at: heartbeat })) return stateHold();
          return publicStatus('CONFIRMED', 'AUTHORITATIVE_OPEN_OBSERVED', attempt);
        }
        if (reason) return publicStatus('HOLD', reason, attempt);
        const nextFloor = observation.work.generation_floor;
        if (nextFloor < attempt.expected_generation_floor
          || (nextFloor === attempt.expected_generation_floor
            && Date.parse(observation.snapshot.last_heartbeat_at) <= Date.parse(attempt.confirmed_heartbeat_at))) {
          return publicStatus('HOLD', 'NEW_PAUSE_READBACK_REQUIRED', attempt);
        }
      }
      if (!reason) return publicStatus('IDLE', 'EXPLICIT_CONFIRMATION_REQUIRED');
      if (attempt?.state === 'NO_EFFECT') return publicStatus('NO_EFFECT', reason, attempt);
      return publicStatus('HOLD', reason);
    })().finally(() => { statusBusy = null; });
    return statusBusy;
  }

  async function resume(input) {
    if (resumeBusy || statusBusy) return publicStatus('PENDING', 'OPERATOR_REQUEST_IN_PROGRESS', attempt);
    resumeBusy = true;
    try {
      await initialize();
      if (stateHold()) return stateHold();
      if (attempt && ACTIVE_STATES.has(attempt.state)) return publicStatus(attempt.state, 'INDEPENDENT_OPEN_READBACK_REQUIRED', attempt);
      if (!exactKeys(input, ['confirm', 'expected_generation_floor']) || input.confirm !== true || !isFloor(input.expected_generation_floor)) {
        return publicStatus('HOLD', 'EXPLICIT_CONFIRMATION_AND_FLOOR_REQUIRED');
      }
      let observation;
      try { observation = await observe(); }
      catch { return publicStatus('HOLD', 'NATIVE_READBACK_UNAVAILABLE'); }
      const requestedAt = readClock();
      if (requestedAt === null) return publicStatus('HOLD', 'CLOCK_UNAVAILABLE');
      const reason = admissionGuard(observation, requestedAt, input.expected_generation_floor);
      if (reason) return publicStatus('HOLD', reason);
      if (attempt?.state === 'CONFIRMED'
        && (input.expected_generation_floor < attempt.expected_generation_floor
          || (input.expected_generation_floor === attempt.expected_generation_floor
            && Date.parse(observation.snapshot.last_heartbeat_at) <= Date.parse(attempt.confirmed_heartbeat_at)))) {
        return publicStatus('HOLD', 'NEW_PAUSE_READBACK_REQUIRED', attempt);
      }
      const pending = {
        schema: CLIENT_ADMISSION_RECOVERY_STATE_SCHEMA, state: 'PENDING',
        expected_generation_floor: input.expected_generation_floor,
        requested_at: new Date(requestedAt).toISOString(),
        preattempt_heartbeat_at: observation.snapshot.last_heartbeat_at,
        confirmed_heartbeat_at: null,
      };
      // A failed durable write prevents the first possible admission effect.
      if (!await persist(pending)) return stateHold();
      try {
        const receipt = await awaitOwner({ expected_generation_floor: input.expected_generation_floor });
        const nextState = validOwnerReceipt(receipt, input.expected_generation_floor) ? 'READBACK_REQUIRED' : 'AMBIGUOUS';
        if (!await persist({ ...attempt, state: nextState })) return stateHold();
        return publicStatus(nextState, nextState === 'READBACK_REQUIRED' ? 'OWNER_RESUMED_READBACK_REQUIRED' : 'OWNER_RECEIPT_UNPROVEN', attempt);
      } catch (error) {
        const knownRejection = error?.message === 'native_supervisor_devos_resume_http_409:devos_resume_generation_mismatch';
        const nextState = knownRejection ? 'NO_EFFECT' : 'AMBIGUOUS';
        if (!await persist({ ...attempt, state: nextState })) return stateHold();
        return publicStatus(nextState, knownRejection ? 'GENERATION_FLOOR_CHANGED' : 'OWNER_EFFECT_OUTCOME_UNKNOWN', attempt);
      }
    } finally { resumeBusy = false; }
  }

  return Object.freeze({ status, resume });
}
