// W29: read-only primary Now/Missions/Fleet presentation from ONE W6/W23 frame.
// No HTTP, native IPC, scheduler, legacy workspace, or independently cached liveness.
export const PRIMARY_OPERATOR_VIEWS = Object.freeze(['Now', 'Missions', 'Fleet']);
const FIELDS = Object.freeze({
  Now: Object.freeze(['database', 'client', 'supervisor', 'fleet', 'host', 'source', 'continuity']),
  Missions: Object.freeze(['fleet', 'continuity']),
  Fleet: Object.freeze(['fleet', 'supervisor', 'host']),
});
const SUBJECTS = Object.freeze({
  Now: Object.freeze({ title: 'Current state', unknown: 'Active execution: UNKNOWN. A database or browser process is not a running mission.' }),
  Missions: Object.freeze({ title: 'Mission evidence', unknown: 'Mission records: UNKNOWN, not zero. Context v1 has no trusted task listing.' }),
  Fleet: Object.freeze({ title: 'Fleet provenance', unknown: 'Agent inventory: UNKNOWN, not zero. Context v1 has no agent census.' }),
});
const ALLOWED_STATES = new Set([
  'UNKNOWN', 'UNVERIFIED', 'STALE', 'AMBIGUOUS', 'BLOCKED',
  'OFFLINE', 'DEGRADED', 'AVAILABLE', 'READY',
]);
const DELIVERY = new Set(['IDLE', 'LOADING', 'READING', 'UNBOUND', 'TIMED_OUT', 'FAILED']);
const HINTS = Object.freeze({
  RECONCILE: 'Event gap, rollback or Owner/source change: fresh, bound reconciliation proof required.',
  STALE: 'Trusted snapshot expired; no current activity is asserted.',
  UNBOUND: 'Native Operator reader is not connected. Legacy workspace fallback is disabled.',
  TIMED_OUT: 'Canonical read timed out. Previous checkpoint remains fenced; no cached activity is shown.',
  FAILED: 'Canonical read failed. No alternate transport, workspace or hosted source was consulted.',
  LOADING: 'Waiting for the first authenticated native context readback; nothing is assumed active.',
  READING: 'Checking the canonical context. The preceding evidence still expires on the clock.',
  TRACKING: 'One source-bound cursor is observed. This is not proof of an active mission or fleet.',
  UNKNOWN: 'Owner/source/cursor witness is missing or unverified; state remains UNKNOWN.',
});

// UI can describe a previously observed field only from the *same* source-bound
// frame. Renderer delivery success, HTTP 200 and shape-valid model payloads
// do not themselves grant this gate or any native Owner attestation.
function boundFrame(frame) {
  const identity = frame?.identity, projection = frame?.projection;
  return frame?.schema === 'metaengine.operator.observatory-resync.v1'
    && frame.mode === 'TRACKING'
    && frame.authority_effect === false
    && frame.scheduler_authority === false
    && frame.automatic_retry_allowed === false
    && projection?.schema === 'metaengine.operator.observatory.v1'
    && projection.state === 'OBSERVED'
    && projection.cursor_state === 'VERIFIED_CURSOR'
    && identity !== null && typeof identity === 'object'
    && identity.run_id === projection.run_id
    && identity.event_seq === projection.event_seq
    && identity.proof_identity === projection.proof_identity;
}
const unknown = name => Object.freeze({
  name, state: 'UNKNOWN', proof: 'NONE', fresh: false, observed_at: null,
});
function plane(name, projection) {
  const p = projection?.planes?.[name];
  if (!p || !ALLOWED_STATES.has(p.state)) return unknown(name);
  // The pure W6 reducer already qualified source and freshness; keep an
  // allowlist, never leak raw records, private messages or endpoint details.
  return Object.freeze({
    name, state: p.state, proof: p.proof === 'TRUSTED_READBACK' ? 'TRUSTED_READBACK' : 'NONE',
    fresh: p.fresh === true && p.proof === 'TRUSTED_READBACK',
    observed_at: typeof p.observed_at === 'string' && Number.isFinite(Date.parse(p.observed_at))
      ? new Date(p.observed_at).toISOString() : null,
  });
}

export function projectPrimaryOperatorView(frame, view, {
  delivery = 'IDLE', firstTruthMs = null,
} = {}) {
  if (!Object.hasOwn(FIELDS, view)) throw new Error('primary_view_invalid');
  if (!DELIVERY.has(delivery)) throw new Error('primary_delivery_invalid');
  const tracked = boundFrame(frame);
  const phase = frame?.requires_explicit_resync === true ? 'RECONCILE'
    : frame?.mode === 'STALE' ? 'STALE'
    : delivery === 'UNBOUND' ? 'UNBOUND'
    : delivery === 'TIMED_OUT' ? 'TIMED_OUT'
    : delivery === 'FAILED' ? 'FAILED'
    : delivery === 'LOADING' ? 'LOADING'
    : delivery === 'READING' ? 'READING'
    : tracked ? 'TRACKING' : 'UNKNOWN';
  const visible = tracked && phase !== 'RECONCILE' && phase !== 'STALE'
    && phase !== 'UNBOUND' && phase !== 'TIMED_OUT' && phase !== 'FAILED';
  const projection = visible ? frame.projection : null;
  return Object.freeze({
    schema: 'metaengine.operator.primary-view.v1',
    view,
    title: SUBJECTS[view].title,
    phase,
    hint: HINTS[phase],
    missing_detail: SUBJECTS[view].unknown,
    source_bound: visible,
    // A VERIFIED_CURSOR means source-bound structural continuity, NOT native
    // installation attestation or that any mission/agent is executing.
    run_id: visible ? projection.run_id : null,
    event_seq: visible ? projection.event_seq : null,
    facets: Object.freeze(FIELDS[view].map(name => projection ? plane(name, projection) : unknown(name))),
    first_truth_ms: visible && Number.isSafeInteger(firstTruthMs)
      && firstTruthMs >= 0 && firstTruthMs <= 300_000 ? firstTruthMs : null,
    authority_effect: false,
    automatic_retry_allowed: false,
  });
}
