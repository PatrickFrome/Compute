import { qualifyOperatorOwner } from './operator-own-pg-fleet-truth.mjs';
import { buildUnifiedOperatorContext } from './operator-unified-snapshot-core.mjs';
import { reduceOperatorObservatory, emptyOperatorObservatory } from '../../apps/me2-ui/src/lib/operator-observatory.mjs';

// W10/P0-P4 source-level *conformance*, not an attestation provider.
// Caller must supply independently obtained, in-process W2/W3/Source witnesses.
// W3 does not yet expose source_sha + proof_sha256, so deployed/unwired
// inputs deliberately stay UNKNOWN. No I/O, transport, SQL, effects, or timers.
export const CROSS_PLANE_CONFORMANCE_SCHEMA = 'metaengine.operator.cross-plane-conformance.v1';
const SHA40 = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_AGE_MS = 30_000;
const SKEW_MS = 5_000;
const safeSeq = value => Number.isSafeInteger(value) && value >= 0;
const fresh = (stamp, nowMs) => {
  if (typeof stamp !== 'string') return false;
  const ms = Date.parse(stamp);
  return Number.isFinite(ms) && ms <= nowMs + SKEW_MS && ms >= nowMs - MAX_AGE_MS;
};
const safeOwner = value => typeof value === 'string' && IDENTIFIER.test(value);

function safeOutput({ state, reason, observations, nowMs }) {
  // Do not forward positive non-database facets from an unbound run.
  // Even a successful upstream HTTP response is not an Owner witness.
  const context = buildUnifiedOperatorContext({
    observations: { database: observations?.database }, nowMs,
  });
  const observatory = emptyOperatorObservatory(reason);
  return Object.freeze({
    schema: CROSS_PLANE_CONFORMANCE_SCHEMA, state, reason,
    identity: null, context,
    observatory: state === 'UNKNOWN' ? observatory : Object.freeze({
      ...observatory, state, cursor_state: state,
    }),
    authority_effect: false, scheduler_authority: false,
    automatic_retry_allowed: false, physical_attestation: 'NOT_PROVEN',
  });
}

/**
 * Checks exact W2 fleet/continuity witnesses, W3 run identity and W6 reducer.
 * Importing this file never starts PostgreSQL, Gateway, Browser or a scheduler.
 * A positive result means only that source *shapes* agree in this observation;
 * it never grants READY, HEALTHY, ACTIVE, installed or effect authority.
 */
export function conformOperatorReadbacks({
  observations = {}, owner = null, runIdentity = null,
  previous = null, nowMs = Date.now(),
} = {}) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('cross_plane_clock_invalid');
  if (!observations || typeof observations !== 'object' || Array.isArray(observations)) {
    return safeOutput({ state: 'UNKNOWN', reason: 'OBSERVATIONS_MISSING', observations: {}, nowMs });
  }
  const fallback = (state, reason) => safeOutput({ state, reason, observations, nowMs });
  if (!qualifyOperatorOwner(owner, nowMs)) return fallback('UNKNOWN', 'TRUSTED_OWNER_ABSENT');
  const fleet = observations.fleet, continuity = observations.continuity, source = observations.source;
  if (!fleet || !continuity || !source || !runIdentity) {
    return fallback('UNKNOWN', 'CROSS_PLANE_READBACK_ABSENT');
  }
  // Structurally valid in-process W2 W3 witnesses are necessary, never sufficient
  // for real installed Owner authority. Do not accept HTTP/page claims as input.
  if (runIdentity.source !== 'OWN_POSTGRES_READBACK' || runIdentity.proven !== true ||
      !safeOwner(runIdentity.owner_id) || !safeOwner(runIdentity.run_id) ||
      runIdentity.project_id !== owner.project_id ||
      !safeSeq(runIdentity.owner_epoch) || !safeSeq(runIdentity.event_seq)) {
    return fallback('UNKNOWN', 'RUN_READBACK_UNVERIFIED');
  }
  if (!fresh(runIdentity.observed_at, nowMs)) return fallback('STALE', 'RUN_READBACK_STALE');
  // Current W3 does not carry these two fields. Do NOT manufacture a source
  // binding or proof from HTTP 200, local git HEAD, or the client clock.
  if (!SHA40.test(runIdentity.source_sha || '') || !SHA256.test(runIdentity.proof_sha256 || '')) {
    return fallback('UNKNOWN', 'SOURCE_IDENTITY_NOT_COLOCATED');
  }
  if (fleet.source !== 'LOCAL_TASK_LEDGER' || continuity.source !== 'LOCAL_CHECKPOINT_LEDGER' ||
      source.source !== 'EXACT_GIT_READBACK' ||
      [fleet, continuity, source].some(v => v.proven !== true)) {
    return fallback('UNKNOWN', 'PLANE_PROVENANCE_UNVERIFIED');
  }
  if ([fleet, continuity, source].some(v =>
      !fresh(v.observed_at, nowMs) || !fresh(v.heartbeat_at, nowMs))) {
    return fallback('STALE', 'PLANE_READBACK_STALE');
  }
  const ownerIds = [runIdentity.owner_id, fleet.owner_id, continuity.owner_id, source.owner_id];
  if (ownerIds.some(id => id !== owner.owner_id)) return fallback('AMBIGUOUS', 'OWNER_CONFLICT');
  if (runIdentity.owner_epoch !== owner.owner_generation ||
      fleet.owner_generation !== owner.owner_generation ||
      continuity.owner_generation !== owner.owner_generation) {
    return fallback('AMBIGUOUS', 'OWNER_EPOCH_CONFLICT');
  }
  if (!SHA40.test(source.source_sha || '') ||
      source.source_sha.toLowerCase() !== runIdentity.source_sha.toLowerCase()) {
    return fallback('AMBIGUOUS', 'SOURCE_SHA_CONFLICT');
  }
  const cursor = continuity.cursor;
  if (!cursor || cursor.project_id !== owner.project_id ||
      fleet.project_id !== owner.project_id ||
      !safeSeq(cursor.after_seq) || !safeSeq(cursor.next_seq) ||
      !safeSeq(cursor.through_seq) || !safeSeq(continuity.event_seq) ||
      cursor.after_seq > cursor.next_seq || cursor.next_seq > cursor.through_seq ||
      cursor.next_seq !== continuity.event_seq ||
      cursor.has_more !== (cursor.next_seq < cursor.through_seq) ||
      cursor.through_seq !== runIdentity.event_seq) {
    return fallback('AMBIGUOUS', 'EVENT_CURSOR_CONFLICT');
  }
  const previousIdentity = previous?.identity;
  if (previousIdentity) {
    if (previousIdentity.run_id !== runIdentity.run_id ||
        previousIdentity.owner_epoch !== runIdentity.owner_epoch ||
        previousIdentity.owner_id !== owner.owner_id) return fallback('AMBIGUOUS', 'RUN_OWNER_CHANGED');
    if (previousIdentity.source_sha !== runIdentity.source_sha.toLowerCase())
      return fallback('AMBIGUOUS', 'SOURCE_SHA_CHANGED_WITHOUT_REBIND');
    if (safeSeq(previousIdentity.event_seq) && runIdentity.event_seq < previousIdentity.event_seq)
      return fallback('AMBIGUOUS', 'EVENT_CURSOR_ROLLBACK');
    if (previousIdentity.event_seq === runIdentity.event_seq &&
        previousIdentity.proof_identity !== runIdentity.proof_sha256.toLowerCase())
      return fallback('AMBIGUOUS', 'EQUAL_CURSOR_PROOF_CONFLICT');
  }
  const context = buildUnifiedOperatorContext({ observations, nowMs });
  if (['fleet', 'continuity', 'source'].some(name =>
      context.planes[name].fresh !== true ||
      context.planes[name].proof !== 'TRUSTED_READBACK')) {
    const stale = ['fleet', 'continuity', 'source'].some(name => context.planes[name].state === 'STALE');
    return fallback(stale ? 'STALE' : 'UNKNOWN', 'PLANE_CONTEXT_NOT_FRESH');
  }
  const identity = Object.freeze({
    owner_id: owner.owner_id, run_id: runIdentity.run_id,
    owner_epoch: runIdentity.owner_epoch, source_sha: runIdentity.source_sha.toLowerCase(),
    event_seq: runIdentity.event_seq,
    proof_identity: runIdentity.proof_sha256.toLowerCase(),
  });
  const projectedContext = Object.freeze({
    ...context, run_id: identity.run_id,
    // W6's cursor is the canonical *watermark*, not W2's paged next_seq.
    event_seq: identity.event_seq, proof_identity: identity.proof_identity,
  });
  const observatory = reduceOperatorObservatory(projectedContext, {
    nowMs, previous: previous?.observatory ?? null,
  });
  if (observatory.state === 'AMBIGUOUS' || observatory.cursor_state !== 'VERIFIED_CURSOR') {
    return fallback('AMBIGUOUS', 'OBSERVATORY_PROJECTION_CONFLICT');
  }
  return Object.freeze({
    schema: CROSS_PLANE_CONFORMANCE_SCHEMA, state: 'CONSISTENT_SHAPE',
    reason: null, identity, context: projectedContext, observatory,
    authority_effect: false, scheduler_authority: false,
    automatic_retry_allowed: false, physical_attestation: 'NOT_PROVEN',
  });
}
