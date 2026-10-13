// W6/P4 Causal Observatory: pure, read-only view of ONE operator context.
// Nothing here fetches endpoints, authenticates, schedules, mutates, or infers
// process/agent liveness from HTTP success, tabs, counts or cached UI state.
export const OBSERVATORY_VIEWS = Object.freeze({
  Now: ['database', 'client', 'supervisor', 'fleet', 'host', 'source', 'continuity'],
  Missions: ['fleet', 'continuity'],
  Fleet: ['fleet', 'supervisor', 'host'],
  Brain: ['source', 'continuity'],
  Develop: ['source', 'client'],
  System: ['database', 'client', 'supervisor', 'host'],
  Evidence: ['continuity', 'source', 'database'],
});
export const OBSERVATORY_PLANES = Object.freeze([
  'database', 'client', 'supervisor', 'fleet', 'host', 'source', 'continuity',
]);
const VALID_STATES = new Set([
  'UNKNOWN', 'UNVERIFIED', 'STALE', 'AMBIGUOUS', 'BLOCKED',
  'OFFLINE', 'DEGRADED', 'AVAILABLE', 'READY',
]);
const POSITIVE_STATES = new Set(['AVAILABLE', 'READY']);
const RUN_ID = /^[a-zA-Z0-9_.:-]{1,128}$/;
const PROOF_ID = /^[a-fA-F0-9]{64}$/;
const MAX_SKEW_MS = 5000;
const safeDate = value => {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};
const validCursor = x => Number.isSafeInteger(x) && x >= 0;
const unknownPlane = () => ({ state: 'UNKNOWN', fresh: false, proof: 'NONE', observed_at: null });

function safePlane(input, nowMs, maxAgeMs, snapshotStale) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return unknownPlane();
  if (input.state === 'UNKNOWN' && input.proof === 'NONE' && input.fresh === false
    && (input.observed_at === null || input.observed_at === undefined)) return unknownPlane();
  const observed = safeDate(input.observed_at);
  const stamp = observed === null ? null : new Date(observed).toISOString();
  const state = VALID_STATES.has(input.state) ? input.state : 'UNVERIFIED';
  if (observed === null) return { ...unknownPlane(), state: 'UNVERIFIED' };
  if (snapshotStale || observed - nowMs > MAX_SKEW_MS || nowMs - observed > maxAgeMs)
    return { state: 'STALE', fresh: false, proof: 'NONE', observed_at: stamp };
  // Even a formally positive upstream state has no evidentiary weight
  // without its own independent trusted readback proof and fresh flag.
  if (POSITIVE_STATES.has(state) && (input.proof !== 'TRUSTED_READBACK' || input.fresh !== true))
    return { state: 'UNVERIFIED', fresh: false, proof: 'NONE', observed_at: stamp };
  return {
    state,
    fresh: input.fresh === true && input.proof === 'TRUSTED_READBACK',
    proof: input.proof === 'TRUSTED_READBACK' ? 'TRUSTED_READBACK' : 'NONE',
    observed_at: stamp,
  };
}

export function emptyOperatorObservatory(reason = 'NO_TRUSTED_CONTEXT') {
  return Object.freeze({
    schema: 'metaengine.operator.observatory.v1',
    state: 'UNKNOWN',
    reason,
    run_id: null,
    event_seq: null,
    cursor_state: 'UNKNOWN',
    proof_identity: null,
    generated_at: null,
    planes: Object.fromEntries(OBSERVATORY_PLANES.map(name => [name, unknownPlane()])),
    views: OBSERVATORY_VIEWS,
    authority_effect: false,
    automatic_retry_allowed: false,
  });
}

function fenced(state, reason) {
  const empty = emptyOperatorObservatory(reason);
  return { ...empty, state, cursor_state: state };
}

export function reduceOperatorObservatory(context, { previous = null, nowMs = Date.now(), maxAgeMs = 30000 } = {}) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('observatory_clock_invalid');
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 100 || maxAgeMs > 300000) throw new Error('observatory_age_invalid');
  if (!context || typeof context !== 'object' || Array.isArray(context)
    || context.schema !== 'metaengine.operator.context.v1'
    || context.scope !== 'READ_ONLY'
    || context.storage !== 'OWN_POSTGRES_ONLY'
    || context.authority_effect !== false
    || context.scheduler_authority !== false
    || context.automatic_retry_allowed !== false
    || context.remote_fallback_allowed !== false
    || context.cloud_database_dependency !== false)
    return fenced('UNVERIFIED', 'INVALID_CONTEXT_CONTRACT');

  const generated = safeDate(context.generated_at);
  if (generated === null) return fenced('UNVERIFIED', 'MISSING_GENERATION_TIME');
  const snapshotStale = generated > nowMs + MAX_SKEW_MS || nowMs - generated > maxAgeMs;
  const run_id = typeof context.run_id === 'string' && RUN_ID.test(context.run_id)
    ? context.run_id : null;
  // P0 contexts have no event cursor: display UNKNOWN, do not synthesize 0.
  const event_seq = validCursor(context.event_seq) ? context.event_seq : null;
  const proof_identity = typeof context.proof_identity === 'string' && PROOF_ID.test(context.proof_identity)
    ? context.proof_identity.toLowerCase() : null;

  if (previous?.run_id && run_id && previous.run_id !== run_id)
    return fenced('AMBIGUOUS', 'RUN_ID_CHANGED_WITHOUT_REBIND');
  if (previous?.event_seq !== null && previous?.event_seq !== undefined
    && event_seq !== null && event_seq < previous.event_seq)
    return fenced('AMBIGUOUS', 'EVENT_CURSOR_REGRESSION');
  if (previous?.event_seq !== null && previous?.event_seq !== undefined
    && event_seq === previous.event_seq && previous?.proof_identity && proof_identity
    && previous.proof_identity !== proof_identity)
    return fenced('AMBIGUOUS', 'CURSOR_PROOF_CONFLICT');

  const planes = Object.fromEntries(OBSERVATORY_PLANES.map(name => [
    name, safePlane(context.planes?.[name], nowMs, maxAgeMs, snapshotStale),
  ]));
  const cursor_state = run_id === null || event_seq === null || proof_identity === null
    ? 'UNKNOWN' : snapshotStale ? 'STALE' : 'VERIFIED_CURSOR';
  const state = snapshotStale ? 'STALE' : 'OBSERVED';
  return Object.freeze({
    schema: 'metaengine.operator.observatory.v1',
    state,
    reason: snapshotStale ? 'SNAPSHOT_EXPIRED' : null,
    run_id,
    event_seq,
    cursor_state,
    proof_identity,
    generated_at: new Date(generated).toISOString(),
    planes,
    views: OBSERVATORY_VIEWS,
    authority_effect: false,
    automatic_retry_allowed: false,
  });
}
