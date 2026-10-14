import assert from 'node:assert/strict';
import test from 'node:test';
import { OBSERVATORY_VIEWS } from './operator-observatory.mjs';
import {
  advanceOperatorObservatoryResync as step,
  emptyOperatorObservatoryResync as empty,
  expireOperatorObservatoryResync as expire,
} from './operator-observatory-resync.mjs';

const now = Date.parse('2026-10-14T10:00:00.000Z');
const time = ms => new Date(now + ms).toISOString();
const A40 = 'a'.repeat(40);
const B40 = 'b'.repeat(40);
const A64 = 'a'.repeat(64);
const B64 = 'b'.repeat(64);
const context = (patch = {}) => ({
  schema: 'metaengine.operator.context.v1',
  scope: 'READ_ONLY', storage: 'OWN_POSTGRES_ONLY', authority_effect: false,
  scheduler_authority: false, automatic_retry_allowed: false,
  remote_fallback_allowed: false, cloud_database_dependency: false,
  generated_at: time(-100),
  run_id: 'run:1', owner_id: 'owner:1', owner_epoch: 7,
  source_sha: A40, event_seq: 10, proof_identity: A64,
  planes: {
    database: { state: 'AVAILABLE', source: 'LOCAL_POSTGRES', fresh: true,
      proof: 'TRUSTED_READBACK', observed_at: time(-120) },
    fleet: { state: 'UNKNOWN', proof: 'NONE', fresh: false, observed_at: null },
    source: { state: 'AVAILABLE', source: 'EXACT_GIT_READBACK',
      proof: 'TRUSTED_READBACK', fresh: true, proven: true,
      observed_at: time(-120), run_id: patch.run_id ?? 'run:1',
      owner_id: patch.owner_id ?? 'owner:1',
      owner_epoch: patch.owner_epoch ?? 7, source_sha: patch.source_sha ?? A40 },
    continuity: { state: 'AVAILABLE', source: 'LOCAL_CHECKPOINT_LEDGER',
      proof: 'TRUSTED_READBACK', fresh: true, proven: true,
      observed_at: time(-120), run_id: patch.run_id ?? 'run:1',
      owner_id: patch.owner_id ?? 'owner:1',
      owner_epoch: patch.owner_epoch ?? 7, event_seq: patch.event_seq ?? 10,
      proof_identity: patch.proof_identity ?? A64 },
  }, ...patch,
});
const read = (previous, value, intent = 'POLL', timeNow = now) =>
  step(previous, value, { nowMs: timeNow, intent });
const baseline = () => read(empty(), context());
const cert = (previous, newer, patch = {}) => ({
  schema: 'metaengine.operator.context-resync.v1',
  source: 'OWN_POSTGRES_READBACK', proven: true, authority_effect: false,
  scheduler_authority: false, automatic_retry_allowed: false,
  observed_at: newer.generated_at,
  previous_run_id: previous.checkpoint.run_id,
  previous_owner_id: previous.checkpoint.owner_id,
  previous_owner_epoch: previous.checkpoint.owner_epoch,
  previous_source_sha: previous.checkpoint.source_sha,
  previous_event_seq: previous.checkpoint.event_seq,
  previous_proof_identity: previous.checkpoint.proof_identity,
  run_id: newer.run_id, owner_id: newer.owner_id,
  owner_epoch: newer.owner_epoch, source_sha: newer.source_sha,
  through_seq: newer.event_seq, proof_identity: newer.proof_identity,
  ...patch,
});
const allHidden = state => {
  for (const view of Object.keys(OBSERVATORY_VIEWS)) {
    const names = OBSERVATORY_VIEWS[view];
    for (const name of names) {
      assert.equal(state.projection.planes[name].state, 'UNKNOWN',
        view + '/' + name + ' must be unknown');
      assert.equal(state.projection.planes[name].fresh, false);
    }
  }
};

test('first complete readback is one canonical checkpoint, seven views share it', () => {
  const initial = baseline();
  assert.equal(initial.mode, 'TRACKING');
  assert.equal(initial.checkpoint.run_id, 'run:1');
  assert.equal(initial.checkpoint.event_seq, 10);
  assert.equal(initial.projection.planes.database.state, 'AVAILABLE');
  assert.equal(initial.projection.planes.fleet.state, 'UNKNOWN');
  assert.equal(initial.authority_effect, false);
  assert.equal(initial.scheduler_authority, false);
});

test('sequential increments and same-sequence/same-proof repeat are allowed', () => {
  const x = baseline();
  const repeat = read(x, context());
  assert.equal(repeat.mode, 'TRACKING');
  const advance = read(repeat, context({ event_seq: 11, proof_identity: B64 }));
  assert.equal(advance.checkpoint.event_seq, 11);
  assert.equal(advance.projection.event_seq, 11);
});

test('rollback fences all seven perspectives and does not lower saved high-water', () => {
  const x = baseline();
  const rollback = read(x, context({ event_seq: 9, proof_identity: B64 }));
  assert.equal(rollback.mode, 'RESYNC_REQUIRED');
  assert.equal(rollback.reason, 'CURSOR_ROLLBACK');
  assert.equal(rollback.checkpoint.event_seq, 10);
  allHidden(rollback);
  const laterPoll = read(rollback, context({ event_seq: 11, proof_identity: B64 }));
  assert.equal(laterPoll.mode, 'RESYNC_REQUIRED');
  allHidden(laterPoll);
});

test('jump across a monotonic watermark is a gap, not a contiguous delta', () => {
  const x = baseline();
  const gap = read(x, context({ event_seq: 12, proof_identity: B64 }));
  assert.equal(gap.reason, 'CURSOR_GAP');
  assert.equal(gap.requires_explicit_resync, true);
  allHidden(gap);
});

test('equal seq with conflicting proof is equivocation; exact replay does not reset fence', () => {
  const x = baseline();
  const split = read(x, context({ proof_identity: B64 }));
  assert.equal(split.reason, 'CURSOR_EQUIVOCATION');
  allHidden(split);
  assert.equal(read(split, context()).mode, 'RESYNC_REQUIRED');
});

test('Owner ID, Owner epoch, source SHA and run rollover require bound reconciliation', () => {
  for (const mutation of [
    { owner_id: 'owner:2' }, { owner_epoch: 8 }, { source_sha: B40 }, { run_id: 'run:2' },
  ]) {
    const changed = read(baseline(), context(mutation));
    assert.equal(changed.reason, 'OWNER_SOURCE_OR_RUN_ROLLOVER');
    allHidden(changed);
  }
});

test('missing source/owner epoch/proof stay UNKNOWN and never erase prior history', () => {
  const x = baseline();
  for (const missing of [{ owner_id: null }, { owner_epoch: null }, { source_sha: null },
    { proof_identity: null }, { event_seq: null }]) {
    const y = read(x, context(missing));
    assert.equal(y.mode, 'UNKNOWN');
    assert.equal(y.checkpoint.event_seq, 10);
    allHidden(y);
  }
  const p0 = read(empty(), context({ event_seq: undefined, owner_epoch: undefined }));
  assert.equal(p0.mode, 'UNKNOWN');
  allHidden(p0);
});

test('stale canonical snapshot and clock expiry hide all planes, preserve high-water', () => {
  const x = baseline();
  const old = read(x, context({ generated_at: time(-40_000) }));
  assert.equal(old.mode, 'STALE');
  assert.equal(old.checkpoint.event_seq, 10);
  allHidden(old);
  const elapsed = expire(x, { nowMs: now + 31_000 });
  assert.equal(elapsed.mode, 'STALE');
  allHidden(elapsed);
  assert.equal(elapsed.checkpoint.event_seq, 10);
});

test('explicit resync without bound source proof fails closed even with fresh HTTP 200', () => {
  const x = baseline();
  const pending = read(x, context({ event_seq: 13, proof_identity: B64 }));
  const y = read(pending, context({ event_seq: 13, proof_identity: B64, http_status: 200 }), 'EXPLICIT_RESYNC');
  assert.equal(y.mode, 'RESYNC_REQUIRED');
  assert.equal(y.checkpoint.event_seq, 10);
  allHidden(y);
});

test('explicit resync with same-context full witness can rebind after gap', () => {
  const x = baseline();
  const next = context({ event_seq: 13, proof_identity: B64 });
  const pending = read(x, next);
  const trusted = read(pending, { ...next, resync: cert(x, next) }, 'EXPLICIT_RESYNC');
  assert.equal(trusted.mode, 'TRACKING');
  assert.equal(trusted.checkpoint.event_seq, 13);
  assert.equal(trusted.projection.event_seq, 13);
  assert.equal(trusted.projection.proof_identity, B64);
  assert.equal(trusted.projection.planes.database.state, 'AVAILABLE');
});

test('source rollover may only be rebound by explicit witness of previous and next', () => {
  const x = baseline();
  const next = context({ run_id: 'run:2', owner_id: 'owner:2', owner_epoch: 8,
    source_sha: B40, event_seq: 0, proof_identity: B64 });
  const pending = read(x, next);
  assert.equal(read(pending, { ...next, resync: cert(x, next) }).mode, 'RESYNC_REQUIRED');
  const accepted = read(pending, { ...next, resync: cert(x, next) }, 'EXPLICIT_RESYNC');
  assert.equal(accepted.mode, 'TRACKING');
  assert.equal(accepted.checkpoint.source_sha, B40);
  assert.equal(accepted.checkpoint.owner_epoch, 8);
});

test('forged or stale resync witness rejects field-by-field without clearing fence', () => {
  const x = baseline(), next = context({ event_seq: 15, proof_identity: B64 });
  const pending = read(x, next);
  for (const patch of [
    { previous_event_seq: 9 }, { previous_owner_epoch: 8 }, { previous_source_sha: B40 },
    { previous_run_id: 'other' }, { previous_proof_identity: B64 },
    { source_sha: B40 }, { through_seq: 14 }, { proof_identity: A64 },
    { owner_id: 'owner:other' }, { owner_epoch: 9 },
    { source: 'HTTP_REQUEST' }, { proven: false }, { authority_effect: true },
    { scheduler_authority: true }, { automatic_retry_allowed: true },
    { observed_at: time(-40_000) }, { observed_at: time(6_000) },
  ]) {
    const altered = read(pending, { ...next, resync: cert(x, next, patch) }, 'EXPLICIT_RESYNC');
    assert.equal(altered.mode, 'RESYNC_REQUIRED', JSON.stringify(patch));
    allHidden(altered);
  }
});

test('older same-run snapshot after timeout does not bypass previous watermark', () => {
  const x = baseline();
  const disconnected = read(x, null);
  assert.equal(disconnected.mode, 'UNKNOWN');
  assert.equal(disconnected.checkpoint.event_seq, 10);
  const attempted = read(disconnected, context({ event_seq: 8 }));
  assert.equal(attempted.reason, 'CURSOR_ROLLBACK');
});

test('no private data, page text or arbitrary fields escape projection or frame', () => {
  const contextWithSecret = context({ password: 'SENSITIVE', raw_dom: 'SENSITIVE',
    resync: { access_token: 'SENSITIVE' }, planes: {
      database: { ...context().planes.database, details: { token: 'SENSITIVE' } },
    },
  });
  const got = read(empty(), contextWithSecret);
  assert.equal(JSON.stringify(got).includes('SENSITIVE'), false);
  assert.equal(got.automatic_retry_allowed, false);
});

test('invalid clock/intent rejected, and malformed claims do not grant tracking', () => {
  assert.throws(() => step(null, null, { nowMs: NaN }), /clock_invalid/);
  assert.throws(() => step(null, null, { intent: 'CONTROL' }), /intent_invalid/);
  assert.equal(read(empty(), context({ storage: 'HOSTED' })).mode, 'UNKNOWN');
  assert.equal(read(empty(), context({ source_sha: 'x' })).mode, 'UNKNOWN');
  assert.equal(read(empty(), context({ owner_epoch: -1 })).mode, 'UNKNOWN');
});

test('missing or forged Source and Continuity readback never establishes tracking', () => {
  const genuine = context();
  const samples = [
    { source: undefined },
    { continuity: undefined },
    { source: { ...genuine.planes.source, source_sha: B40 } },
    { continuity: { ...genuine.planes.continuity, event_seq: 11 } },
    { continuity: { ...genuine.planes.continuity, proof_identity: B64 } },
    { source: { ...genuine.planes.source, owner_epoch: 8 } },
    { continuity: { ...genuine.planes.continuity, run_id: 'wrong-run' } },
    { source: { ...genuine.planes.source, proven: false } },
    { continuity: { ...genuine.planes.continuity, proof: 'MODEL_CLAIM' } },
    { source: { ...genuine.planes.source, observed_at: time(-40000) } },
  ];
  for (const p of samples) {
    const next = read(empty(), context({ planes: { ...genuine.planes, ...p } }));
    assert.equal(next.mode, 'UNKNOWN');
    allHidden(next);
  }
});
