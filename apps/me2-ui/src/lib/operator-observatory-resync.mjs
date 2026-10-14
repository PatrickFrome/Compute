// W6 source-only, fail-closed continuity of ONE canonical Operator Context.
// No I/O, event bus, scheduler, token handling, retries, or authority transfer.
import { emptyOperatorObservatory, reduceOperatorObservatory } from './operator-observatory.mjs';

export const OPERATOR_OBSERVATORY_RESYNC_SCHEMA = 'metaengine.operator.observatory-resync.v1';
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const SHA40 = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const MAX_AGE_MS = 30_000;
const MAX_SKEW_MS = 5_000;
const seq = x => Number.isSafeInteger(x) && x >= 0;
const observedMs = value => typeof value === 'string' ? Date.parse(value) : NaN;
const validId = value => typeof value === 'string' && ID.test(value);
const blank = reason => emptyOperatorObservatory(reason);
const hidden = (reason, state = 'UNKNOWN') => Object.freeze({
  ...blank(reason), state, cursor_state: state,
});
const safeIdentity = context => {
  if (!context || !validId(context.run_id) || !validId(context.owner_id)
    || !seq(context.owner_epoch) || !SHA40.test(context.source_sha || '')
    || !seq(context.event_seq) || !SHA256.test(context.proof_identity || '')) return null;
  return Object.freeze({
    run_id: context.run_id, owner_id: context.owner_id,
    owner_epoch: context.owner_epoch, source_sha: context.source_sha.toLowerCase(),
    event_seq: context.event_seq, proof_identity: context.proof_identity.toLowerCase(),
  });
};
const sameOrigin = (a, b) => a.run_id === b.run_id && a.owner_id === b.owner_id
  && a.owner_epoch === b.owner_epoch && a.source_sha === b.source_sha;

// A top-level SHA/cursor claim is not an independent source witness. The
// canonical context must co-locate bounded Source AND Continuity evidence
// bound to the same trusted Owner epoch before a cursor can be tracked.
function hasSourceBoundCursor(context, projection, identity) {
  const source = context?.planes?.source;
  const continuity = context?.planes?.continuity;
  const trusted = name => {
    const plane = projection.planes?.[name];
    return plane?.fresh === true && plane?.proof === 'TRUSTED_READBACK'
      && (plane.state === 'AVAILABLE' || plane.state === 'READY');
  };
  const bound = value => value?.proven === true
    && value.run_id === identity.run_id
    && value.owner_id === identity.owner_id
    && value.owner_epoch === identity.owner_epoch;
  return trusted('source') && trusted('continuity')
    && bound(source) && bound(continuity)
    && typeof source.source_sha === 'string'
    && source.source_sha.toLowerCase() === identity.source_sha
    && continuity.event_seq === identity.event_seq
    && typeof continuity.proof_identity === 'string'
    && continuity.proof_identity.toLowerCase() === identity.proof_identity;
}

// Keep the checkpoint across stale/missing reads, but NEVER keep a positive
// rendered projection across loss of source. All seven views render this ONE
// redacted projection, without caching their own independent cursor.
function frame(mode, reason, identity = null, projection = blank(reason), checkpoint = null) {
  return Object.freeze({
    schema: OPERATOR_OBSERVATORY_RESYNC_SCHEMA,
    mode, reason, identity, checkpoint, projection,
    requires_explicit_resync: mode === 'RESYNC_REQUIRED',
    authority_effect: false, scheduler_authority: false,
    automatic_retry_allowed: false,
  });
}

export function emptyOperatorObservatoryResync(reason = 'NO_CANONICAL_CONTEXT') {
  return frame('UNKNOWN', reason);
}
function fence(previous, reason) {
  return frame('RESYNC_REQUIRED', reason, null, hidden(reason, 'AMBIGUOUS'), previous?.checkpoint ?? null);
}
const stable = (identity, projection) => frame('TRACKING', null, identity, projection, identity);

/**
 * Future trusted W3 Owner must emit this bound, READ_ONLY resync witness in the
 * SAME fresh canonical context as the new full snapshot. A UI button or HTTP
 * status alone is never evidence to reset/skip/rewind a cursor.
 * This verifies only shape/binding; does NOT attest a native Owner/Guardian.
 */
function hasBoundResync(context, oldIdentity, nextIdentity, nowMs, maxAgeMs) {
  const r = context?.resync;
  if (!r || !oldIdentity || !nextIdentity || r.schema !== 'metaengine.operator.context-resync.v1'
    || r.source !== 'OWN_POSTGRES_READBACK' || r.proven !== true
    || r.authority_effect !== false || r.scheduler_authority !== false
    || r.automatic_retry_allowed !== false
    || r.run_id !== nextIdentity.run_id || r.owner_id !== nextIdentity.owner_id
    || r.owner_epoch !== nextIdentity.owner_epoch || r.source_sha !== nextIdentity.source_sha
    || r.through_seq !== nextIdentity.event_seq || r.proof_identity !== nextIdentity.proof_identity
    || r.previous_run_id !== oldIdentity.run_id || r.previous_owner_id !== oldIdentity.owner_id
    || r.previous_owner_epoch !== oldIdentity.owner_epoch || r.previous_source_sha !== oldIdentity.source_sha
    || r.previous_event_seq !== oldIdentity.event_seq
    || r.previous_proof_identity !== oldIdentity.proof_identity) return false;
  const ms = observedMs(r.observed_at);
  const contextMs = observedMs(context.generated_at);
  return Number.isFinite(ms) && Number.isFinite(contextMs)
    && ms >= nowMs - maxAgeMs && ms <= nowMs + MAX_SKEW_MS
    && Math.abs(ms - contextMs) <= MAX_SKEW_MS;
}

export function advanceOperatorObservatoryResync(previous, context, {
  nowMs = Date.now(), maxAgeMs = MAX_AGE_MS, intent = 'POLL',
} = {}) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0
    || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 100 || maxAgeMs > 300_000)
    throw new Error('observatory_resync_clock_invalid');
  if (intent !== 'POLL' && intent !== 'EXPLICIT_RESYNC')
    throw new Error('observatory_resync_intent_invalid');
  const old = previous?.schema === OPERATOR_OBSERVATORY_RESYNC_SCHEMA ? previous : emptyOperatorObservatoryResync();
  const checkpoint = old.checkpoint;
  const projection = reduceOperatorObservatory(context, { nowMs, maxAgeMs });
  // Return UNVERIFIED/STALE/UNKNOWN with no positive planes. A transient outage
  // cannot silently erase a high-water mark or release a prior conflict fence.
  if (old.requires_explicit_resync && intent !== 'EXPLICIT_RESYNC')
    return fence(old, old.reason || 'RECONCILIATION_REQUIRED');
  if (projection.state !== 'OBSERVED' || projection.cursor_state !== 'VERIFIED_CURSOR') {
    if (old.requires_explicit_resync) return fence(old, 'RESYNC_READBACK_INCOMPLETE');
    const mode = projection.state === 'STALE' ? 'STALE' : 'UNKNOWN';
    return frame(mode, mode === 'STALE' ? 'SNAPSHOT_EXPIRED' : 'CANONICAL_SOURCE_UNKNOWN',
      null, hidden('CANONICAL_SOURCE_UNKNOWN', mode), checkpoint);
  }
  const identity = safeIdentity(context);
  if (identity && !hasSourceBoundCursor(context, projection, identity)) {
    if (old.requires_explicit_resync) return fence(old, 'RESYNC_SOURCE_WITNESS_MISSING');
    return frame('UNKNOWN', 'CANONICAL_SOURCE_CURSOR_NOT_BOUND', null,
      blank('CANONICAL_SOURCE_CURSOR_NOT_BOUND'), checkpoint);
  }
  if (!identity) {
    if (old.requires_explicit_resync) return fence(old, 'RESYNC_SOURCE_IDENTITY_MISSING');
    return frame('UNKNOWN', 'SOURCE_OWNER_EPOCH_UNVERIFIED', null,
      blank('SOURCE_OWNER_EPOCH_UNVERIFIED'), checkpoint);
  }

  if (!checkpoint) {
    // Starting an unbound observation is not a cursor reset. A first baseline
    // has no prior effects to skip in this view; it remains source-only.
    return stable(identity, projection);
  }

  let conflict = null;
  if (!sameOrigin(checkpoint, identity)) conflict = 'OWNER_SOURCE_OR_RUN_ROLLOVER';
  else if (identity.event_seq < checkpoint.event_seq) conflict = 'CURSOR_ROLLBACK';
  else if (identity.event_seq === checkpoint.event_seq
    && identity.proof_identity !== checkpoint.proof_identity) conflict = 'CURSOR_EQUIVOCATION';
  else if (identity.event_seq > checkpoint.event_seq + 1) conflict = 'CURSOR_GAP';

  if (old.requires_explicit_resync || conflict) {
    // Even the explicit action must be backed by a fresh, single-context,
    // source-bound reset witness. Never grant UI resync on operator intent.
    if (intent === 'EXPLICIT_RESYNC'
      && hasBoundResync(context, checkpoint, identity, nowMs, maxAgeMs))
      return stable(identity, projection);
    return fence(old, conflict || 'RESYNC_PROOF_MISSING_OR_MISMATCHED');
  }
  return stable(identity, projection);
}

// Clock-only expiry; does not poll, mutate, retry, or erase checkpoint.
export function expireOperatorObservatoryResync(previous, { nowMs = Date.now(), maxAgeMs = MAX_AGE_MS } = {}) {
  if (!previous || previous.schema !== OPERATOR_OBSERVATORY_RESYNC_SCHEMA)
    return emptyOperatorObservatoryResync();
  if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 100)
    throw new Error('observatory_resync_clock_invalid');
  if (previous.mode !== 'TRACKING') return previous;
  const ms = observedMs(previous.projection.generated_at);
  if (!Number.isFinite(ms) || nowMs - ms > maxAgeMs || ms - nowMs > MAX_SKEW_MS)
    return frame('STALE', 'SNAPSHOT_EXPIRED', null,
      hidden('SNAPSHOT_EXPIRED', 'STALE'), previous.checkpoint);
  return previous;
}
