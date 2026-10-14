import { qualifyOperatorOwner } from './operator-own-pg-fleet-truth.mjs';
import { OPERATOR_GATEWAY_SCHEMA } from './operator-readonly-gateway.mjs';

// W10 wave 2: candidate W3 source/watermark compatibility, NOT a verifier,
// source witness producer, reset token, or new authority. All outputs remain
// untrusted until independently attested Owner/Source evidence is wired.
// In particular W3 currently exports no exact source SHA. Missing is UNKNOWN.
export const W3_SOURCE_CONFORMANCE_SCHEMA = 'metaengine.operator.w3-source-conformance.v1';
const SHA = /^[a-f0-9]{40}$/i;
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_AGE_MS = 30_000;
const FUTURE_SKEW_MS = 5_000;
const seq = n => Number.isSafeInteger(n) && n >= 0;
const id = v => typeof v === 'string' && ID.test(v);
const sourceSha = v => typeof v === 'string' && SHA.test(v) ? v.toLowerCase() : null;
const parseCursor = v => typeof v === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(v) &&
  seq(Number(v)) ? Number(v) : null;
function fresh(v, nowMs) {
  if (typeof v !== 'string') return false;
  const timestamp = Date.parse(v);
  return Number.isFinite(timestamp) && timestamp >= nowMs - MAX_AGE_MS &&
    timestamp <= nowMs + FUTURE_SKEW_MS;
}

function result(state, reason, { shape = 'NONE', cursor = 'UNKNOWN',
  resync = 'NONE' } = {}) {
  // Never return caller-controlled raw witnesses, credentials or page data.
  return Object.freeze({
    schema: W3_SOURCE_CONFORMANCE_SCHEMA, state, reason, shape,
    cursor_relation: cursor, resync,
    canonical_run_id: null, canonical_source_sha: null, canonical_event_seq: null,
    physical_attestation: 'NOT_PROVEN', source_attestation: 'NOT_PROVEN',
    installed_runtime_proven: false, authority_effect: false,
    scheduler_authority: false, automatic_retry_allowed: false,
  });
}

/**
 * Conformance-only inspection of the EXISTING public W3 context "run" shape,
 * the EXISTING W2 own-PostgreSQL continuity page and an OPTIONAL FUTURE source
 * candidate. A synthetic shape can match but cannot itself establish trust.
 *
 * "previous" is a previous projection used only as a conflict fence, never
 * as authority. "resetRequested" is caller intent, never a reset receipt.
 * No SQL, fetch, HTTP listener, file/OS access, effects or implicit resync.
 */
export function inspectW3SourceConformance({
  gatewayResponse = null, owner = null, continuity = null,
  sourceWitness = null, previous = null, resetRequested = false,
  nowMs = Date.now(),
} = {}) {
  if (!seq(nowMs)) throw new Error('w3_source_conformance_clock_invalid');
  const unknown = (reason, opts) => result('UNKNOWN', reason, opts);
  const conflict = (reason, opts) => result('AMBIGUOUS', reason, opts);
  const stale = reason => result('STALE', reason);
  if (!qualifyOperatorOwner(owner, nowMs)) return unknown('OWNER_TRUTH_ABSENT');
  if (!gatewayResponse || gatewayResponse.schema !== OPERATOR_GATEWAY_SCHEMA ||
      gatewayResponse.operation !== 'context' || gatewayResponse.scope !== 'READ_ONLY' ||
      gatewayResponse.storage !== 'OWN_POSTGRES_ONLY' ||
      gatewayResponse.authority_effect !== false ||
      gatewayResponse.scheduler_authority !== false ||
      gatewayResponse.automatic_retry_allowed !== false) {
    return unknown('W3_CONTEXT_NOT_QUALIFIED');
  }

  const run = gatewayResponse.run;
  if (!run || run.source !== 'OWN_POSTGRES_READBACK' ||
      run.proof !== 'TRUSTED_READBACK' || run.fresh !== true ||
      !id(run.run_id) || run.owner_id !== owner.owner_id ||
      run.project_id !== owner.project_id ||
      !seq(run.owner_epoch) || run.owner_epoch < 1 ||
      parseCursor(run.cursor) === null) {
    return unknown('W3_RUN_IDENTITY_UNVERIFIED');
  }
  if (!fresh(run.observed_at, nowMs)) return stale('W3_RUN_IDENTITY_STALE');

  if (!continuity || continuity.source !== 'LOCAL_CHECKPOINT_LEDGER' ||
      continuity.proven !== true || continuity.owner_id !== owner.owner_id ||
      continuity.owner_generation !== owner.owner_generation ||
      !continuity.cursor || continuity.cursor.project_id !== owner.project_id) {
    return unknown('OWN_PG_CONTINUITY_ABSENT');
  }
  if (!fresh(continuity.observed_at, nowMs) ||
      !fresh(continuity.heartbeat_at, nowMs)) return stale('OWN_PG_CONTINUITY_STALE');

  const page = continuity.cursor, watermark = parseCursor(run.cursor);
  if (![page.after_seq, page.next_seq, page.through_seq, continuity.event_seq].every(seq) ||
      page.after_seq > page.next_seq || page.next_seq > page.through_seq ||
      page.next_seq !== continuity.event_seq ||
      page.has_more !== (page.next_seq < page.through_seq) ||
      watermark !== page.through_seq) {
    return conflict('W3_W2_EVENT_WATERMARK_CONFLICT');
  }
  if (run.owner_epoch !== owner.owner_generation) {
    return conflict('W3_OWNER_EPOCH_CONFLICT', { resync: 'EXTERNAL_OWNER_REBIND_REQUIRED' });
  }

  // A reset flag, HTTP 200, signed-looking string, and proof:true are not
  // independent identity evidence; there is intentionally NO acceptance path.
  if (resetRequested) return unknown('RESET_REQUIRES_INDEPENDENT_REBIND', {
    resync: 'EXTERNAL_OWNER_REBIND_REQUIRED',
  });

  if (!sourceWitness) return unknown('W3_SOURCE_WITNESS_ABSENT');
  if (sourceWitness.source !== 'EXACT_GIT_READBACK' ||
      !sourceSha(sourceWitness.source_sha) ||
      !id(sourceWitness.run_id) || !id(sourceWitness.owner_id) ||
      !seq(sourceWitness.owner_epoch) ||
      !seq(sourceWitness.event_seq) ||
      sourceWitness.project_id !== owner.project_id) {
    return unknown('W3_SOURCE_WITNESS_UNVERIFIED');
  }
  if (!fresh(sourceWitness.observed_at, nowMs) ||
      !fresh(sourceWitness.heartbeat_at, nowMs)) {
    return stale('W3_SOURCE_WITNESS_STALE');
  }
  if (sourceWitness.owner_id !== owner.owner_id ||
      sourceWitness.run_id !== run.run_id ||
      sourceWitness.owner_epoch !== owner.owner_generation) {
    return conflict('W3_SOURCE_OWNER_RUN_EPOCH_CONFLICT', {
      resync: 'EXTERNAL_OWNER_REBIND_REQUIRED',
    });
  }
  if (sourceWitness.event_seq !== watermark) {
    return conflict('W3_SOURCE_CURSOR_CONFLICT');
  }
  // The forthcoming source comparison also needs an independently read exact
  // SHA on the other side. Current W3 run omits it. Never invent it from HEAD.
  const runSha = sourceSha(run.source_sha);
  if (!runSha) return unknown('W3_EXACT_SOURCE_SHA_NOT_EXPOSED');
  if (runSha !== sourceSha(sourceWitness.source_sha)) {
    return conflict('W3_SOURCE_SHA_CONFLICT');
  }

  if (previous !== null) {
    if (!previous || typeof previous !== 'object' || !id(previous.run_id) ||
        !id(previous.owner_id) || !seq(previous.owner_epoch) ||
        !seq(previous.event_seq) || !sourceSha(previous.source_sha)) {
      return unknown('PREVIOUS_CURSOR_BINDING_UNVERIFIED');
    }
    if (previous.run_id !== run.run_id || previous.owner_id !== owner.owner_id ||
        previous.owner_epoch !== run.owner_epoch ||
        sourceSha(previous.source_sha) !== runSha) {
      return conflict('PREVIOUS_OWNER_RUN_SOURCE_REBIND_REQUIRED', {
        resync: 'EXTERNAL_OWNER_REBIND_REQUIRED',
      });
    }
    if (watermark < previous.event_seq) {
      return conflict('EVENT_CURSOR_ROLLBACK', {
        cursor: 'REGRESSION', resync: 'EXTERNAL_OWNER_REBIND_REQUIRED',
      });
    }
  }

  // An untrusted supplied "witness" cannot assert real source provenance.
  // The shape is useful for CI falsification and future integration only.
  return unknown('SOURCE_SHAPE_ALIGNED_BUT_UNATTESTED', {
    shape: 'ALIGNED', cursor: page.has_more ? 'PAGE_PARTIAL' : 'NONDECREASING',
  });
}
