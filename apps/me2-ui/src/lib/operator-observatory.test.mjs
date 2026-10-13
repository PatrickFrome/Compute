import assert from 'node:assert/strict';
import test from 'node:test';
import {
  reduceOperatorObservatory, emptyOperatorObservatory, OBSERVATORY_VIEWS,
} from './operator-observatory.mjs';

const now = Date.parse('2026-10-13T01:00:00Z');
const stamp = offset => new Date(now + offset).toISOString();
const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const base = (patch = {}) => ({
  schema: 'metaengine.operator.context.v1',
  scope: 'READ_ONLY',
  storage: 'OWN_POSTGRES_ONLY',
  authority_effect: false,
  scheduler_authority: false,
  automatic_retry_allowed: false,
  remote_fallback_allowed: false,
  cloud_database_dependency: false,
  generated_at: stamp(-30),
  planes: {
    database: { state: 'AVAILABLE', source: 'LOCAL_POSTGRES', fresh: true, proof: 'TRUSTED_READBACK', observed_at: stamp(-35) },
    fleet: { state: 'UNKNOWN', fresh: false, proof: 'NONE', observed_at: null },
  },
  ...patch,
});
const reduce = (value, previous = null, time = now) => reduceOperatorObservatory(value, { nowMs: time, previous });

test('seven pages share one read-only context and missing cursor is UNKNOWN (never inferred 0)', () => {
  const x = reduce(base());
  assert.equal(x.state, 'OBSERVED');
  assert.deepEqual(Object.keys(OBSERVATORY_VIEWS), ['Now', 'Missions', 'Fleet', 'Brain', 'Develop', 'System', 'Evidence']);
  assert.equal(x.planes.database.state, 'AVAILABLE');
  assert.equal(x.planes.fleet.state, 'UNKNOWN');
  assert.equal(x.planes.client.state, 'UNKNOWN');
  assert.equal(x.event_seq, null);
  assert.equal(x.cursor_state, 'UNKNOWN');
  assert.equal(x.authority_effect, false);
});

test('HTTP status or status-only positive claim cannot become ACTIVE or READY', () => {
  const x = reduce(base({ http_status: 200, ok: true, planes: {
    client: { state: 'ACTIVE', fresh: true, proof: 'TRUSTED_READBACK', observed_at: stamp(-30) },
    fleet: { state: 'READY', fresh: false, proof: 'TRUSTED_READBACK', observed_at: stamp(-30) },
    supervisor: { state: 'READY', fresh: true, proof: 'MODEL_CLAIM', observed_at: stamp(-30) },
  } }));
  assert.equal(x.planes.client.state, 'UNVERIFIED');
  assert.equal(x.planes.fleet.state, 'UNVERIFIED');
  assert.equal(x.planes.supervisor.state, 'UNVERIFIED');
  assert.equal(JSON.stringify(x).includes('ACTIVE'), false);
});

test('source contract rejects nonlocal storage, remote fallback, and effect authority', () => {
  for (const patch of [{ storage: 'CLOUD' }, { authority_effect: true }, { remote_fallback_allowed: true },
    { scheduler_authority: true }, { cloud_database_dependency: true }, { scope: 'WRITE' }, { schema: 'unknown' }]) {
    const x = reduce(base(patch));
    assert.equal(x.state, 'UNVERIFIED');
    assert.equal(x.planes.database.state, 'UNKNOWN');
  }
});

test('expired snapshot and individually stale facet fail closed', () => {
  const old = reduce(base({ generated_at: stamp(-31000) }));
  assert.equal(old.state, 'STALE');
  assert.equal(old.planes.database.state, 'STALE');
  const future = reduce(base({ planes: { database: {
    state: 'AVAILABLE', fresh: true, proof: 'TRUSTED_READBACK', observed_at: stamp(6000),
  } } }));
  assert.equal(future.planes.database.state, 'STALE');
});

test('run-scoped monotonic cursor and stable proof identity', () => {
  const a = reduce(base({ run_id: 'run:1', event_seq: 5, proof_identity: hashA }));
  assert.equal(a.cursor_state, 'VERIFIED_CURSOR');
  const b = reduce(base({ run_id: 'run:1', event_seq: 6, proof_identity: hashB }), a);
  assert.equal(b.event_seq, 6);
  assert.equal(b.cursor_state, 'VERIFIED_CURSOR');
  const rollback = reduce(base({ run_id: 'run:1', event_seq: 4, proof_identity: hashA }), a);
  assert.equal(rollback.state, 'AMBIGUOUS');
  assert.equal(rollback.planes.database.state, 'UNKNOWN');
  const split = reduce(base({ run_id: 'run:2', event_seq: 6, proof_identity: hashA }), a);
  assert.equal(split.reason, 'RUN_ID_CHANGED_WITHOUT_REBIND');
  const equivocation = reduce(base({ run_id: 'run:1', event_seq: 5, proof_identity: hashB }), a);
  assert.equal(equivocation.reason, 'CURSOR_PROOF_CONFLICT');
});

test('invalid or missing cursor never becomes verified', () => {
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '9', null]) {
    assert.equal(reduce(base({ run_id: 'r1', event_seq: value, proof_identity: hashA })).cursor_state, 'UNKNOWN');
  }
  assert.equal(reduce(base({ run_id: 'r1', event_seq: 0 })).cursor_state, 'UNKNOWN');
});

test('private input fields, URLs, text, credentials, page/worker payloads never escape reducer', () => {
  const x = reduce(base({
    credential: 'SECRET_XYZ', database_url: 'postgres://owner:SECRET_XYZ@localhost/x',
    payload: '<script>SECRET_XYZ</script>',
    planes: { database: {
      state: 'AVAILABLE', observed_at: stamp(-10), fresh: true, proof: 'TRUSTED_READBACK',
      details: { credential: 'SECRET_XYZ' }, raw_dom: 'SECRET_XYZ',
    } },
  }));
  assert.equal(JSON.stringify(x).includes('SECRET_XYZ'), false);
  assert.equal(Object.hasOwn(x.planes.database, 'details'), false);
});

test('unconnected reader yields explicit UNKNOWN; bounded clock arguments are validated', () => {
  assert.equal(emptyOperatorObservatory().planes.host.state, 'UNKNOWN');
  assert.equal(reduce(null).state, 'UNVERIFIED');
  assert.throws(() => reduceOperatorObservatory(base(), { nowMs: NaN }), /clock_invalid/);
  assert.throws(() => reduceOperatorObservatory(base(), { nowMs: now, maxAgeMs: 0 }), /age_invalid/);
});
