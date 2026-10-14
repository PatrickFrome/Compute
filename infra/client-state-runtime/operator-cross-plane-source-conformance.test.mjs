import assert from 'node:assert/strict';
import test from 'node:test';
import { OPERATOR_GATEWAY_SCHEMA } from './operator-readonly-gateway.mjs';
import { qualifyOperatorOwner } from './operator-own-pg-fleet-truth.mjs';
import {
  inspectW3SourceConformance, W3_SOURCE_CONFORMANCE_SCHEMA,
} from './operator-cross-plane-source-conformance.mjs';

// These are hermetic contract fixtures, NOT a W3 source provider, proof,
// signer, live PostgreSQL connection, Guardian or OS attestation.
const now = Date.parse('2026-10-14T09:00:00Z');
const stamp = delta => new Date(now + delta).toISOString();
const project = '00000000-0000-4000-8000-000000000091';
const workspace = '00000000-0000-4000-8000-000000000092';
const device = '00000000-0000-4000-8000-000000000093';
const gitSha = 'a'.repeat(40);
const secondSha = 'b'.repeat(40);
const owner = Object.freeze({
  schema: 'metaengine.operator.trusted-owner.v1',
  source: 'TRUSTED_OWNER_READBACK', verified: true,
  project_id: project, workspace_id: workspace, device_id: device,
  owner_id: 'owner:w10-wave2', client_id: 'owner:w10-wave2',
  owner_generation: 7, admin_grant_epoch: 2,
  process_incarnation: 'birth:1',
  observed_at: stamp(-100), heartbeat_at: stamp(-200), event_after_seq: 0,
});
function fixture() {
  return {
    nowMs: now, owner,
    gatewayResponse: {
      schema: OPERATOR_GATEWAY_SCHEMA, operation: 'context',
      storage: 'OWN_POSTGRES_ONLY', scope: 'READ_ONLY',
      authority_effect: false, scheduler_authority: false,
      automatic_retry_allowed: false, http_status: 200,
      run: {
        source: 'OWN_POSTGRES_READBACK', proof: 'TRUSTED_READBACK', fresh: true,
        owner_id: owner.owner_id, project_id: project,
        run_id: 'run:w10', owner_epoch: 7, cursor: '12',
        observed_at: stamp(-150),
        // Existing W3 intentionally has NO source_sha.
      },
    },
    continuity: {
      source: 'LOCAL_CHECKPOINT_LEDGER', state: 'AVAILABLE',
      proven: true, owner_id: owner.owner_id, owner_generation: 7,
      observed_at: stamp(-120), heartbeat_at: stamp(-200),
      event_seq: 12, cursor: {
        project_id: project, after_seq: 0, next_seq: 12,
        through_seq: 12, has_more: false,
      },
    },
    sourceWitness: {
      source: 'EXACT_GIT_READBACK', source_sha: gitSha,
      project_id: project, run_id: 'run:w10',
      owner_id: owner.owner_id, owner_epoch: 7, event_seq: 12,
      observed_at: stamp(-90), heartbeat_at: stamp(-120),
    },
  };
}
const withSha = x => {
  x.gatewayResponse.run.source_sha = gitSha; // FUTURE fixture, NOT existing W3.
  return x;
};
const inspect = x => inspectW3SourceConformance(x);
const prior = (patch = {}) => ({
  run_id: 'run:w10', owner_id: owner.owner_id, owner_epoch: 7,
  source_sha: gitSha, event_seq: 11, ...patch,
});
const assertNoAuthority = x => {
  assert.equal(x.schema, W3_SOURCE_CONFORMANCE_SCHEMA);
  assert.notEqual(x.state, 'READY');
  assert.notEqual(x.state, 'HEALTHY');
  assert.notEqual(x.state, 'ACTIVE');
  assert.equal(x.canonical_run_id, null);
  assert.equal(x.canonical_source_sha, null);
  assert.equal(x.canonical_event_seq, null);
  assert.equal(x.source_attestation, 'NOT_PROVEN');
  assert.equal(x.installed_runtime_proven, false);
  assert.equal(x.authority_effect, false);
  assert.equal(x.scheduler_authority, false);
  assert.equal(x.automatic_retry_allowed, false);
};

test('source-backed: current W3 response has a run cursor but no exact source SHA', () => {
  const x = fixture();
  assert.equal(qualifyOperatorOwner(x.owner, now), true);
  assert.equal('source_sha' in x.gatewayResponse.run, false);
  const result = inspect(x);
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(result.reason, 'W3_EXACT_SOURCE_SHA_NOT_EXPOSED');
  assertNoAuthority(result);
});

test('no W3 source witness stays UNKNOWN, regardless of HTTP 200 or healthy-looking data', () => {
  const x = withSha(fixture());
  x.sourceWitness = null;
  x.gatewayResponse.http_status = 200;
  x.gatewayResponse.run.health = 'HEALTHY';
  const result = inspect(x);
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(result.reason, 'W3_SOURCE_WITNESS_ABSENT');
  assertNoAuthority(result);
});

test('matching FUTURE source candidate checks owner epoch + SHA but still cannot attest itself', () => {
  const result = inspect(withSha(fixture()));
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(result.reason, 'SOURCE_SHAPE_ALIGNED_BUT_UNATTESTED');
  assert.equal(result.shape, 'ALIGNED');
  assert.equal(result.cursor_relation, 'NONDECREASING');
  assertNoAuthority(result);
});

test('exact source SHA mismatch is AMBIGUOUS even when both look plausible', () => {
  const x = withSha(fixture());
  x.sourceWitness.source_sha = secondSha;
  const result = inspect(x);
  assert.equal(result.reason, 'W3_SOURCE_SHA_CONFLICT');
  assert.equal(result.state, 'AMBIGUOUS');
  assertNoAuthority(result);
});

test('source must bind same run owner and epoch independently', () => {
  for (const [patch, label] of [
    [{ owner_id: 'other:owner' }, 'owner'],
    [{ run_id: 'run:other' }, 'run'],
    [{ owner_epoch: 8 }, 'epoch'],
  ]) {
    const x = withSha(fixture());
    Object.assign(x.sourceWitness, patch);
    const result = inspect(x);
    assert.equal(result.reason, 'W3_SOURCE_OWNER_RUN_EPOCH_CONFLICT', label);
    assert.equal(result.resync, 'EXTERNAL_OWNER_REBIND_REQUIRED', label);
    assertNoAuthority(result);
  }
});

test('W3 run identity must be fenced by the W2 trusted Owner generation', () => {
  for (const patch of [{ owner_epoch: 8 }, { owner_id: 'other:owner' }, { project_id: device }]) {
    const x = withSha(fixture());
    Object.assign(x.gatewayResponse.run, patch);
    const result = inspect(x);
    assert.equal(result.state, 'AMBIGUOUS');
    assertNoAuthority(result);
  }
});

test('W2 continuity owner and owner generation conflicts fail closed', () => {
  for (const patch of [{ owner_generation: 8 }, { owner_id: 'other:owner' }]) {
    const x = withSha(fixture());
    Object.assign(x.continuity, patch);
    const result = inspect(x);
    assert.equal(result.reason, 'OWN_PG_CONTINUITY_OWNER_CONFLICT');
    assertNoAuthority(result);
  }
});

test('gateway watermark must match W2 through_seq (not next_seq) and source event_seq', () => {
  const x = withSha(fixture());
  x.continuity.cursor.next_seq = 7;
  x.continuity.event_seq = 7;
  x.continuity.cursor.has_more = true;
  const page = inspect(x);
  assert.equal(page.shape, 'ALIGNED');
  assert.equal(page.cursor_relation, 'PAGE_PARTIAL');
  assert.equal(page.state, 'UNKNOWN');
  x.continuity.cursor.through_seq = 13;
  assert.equal(inspect(x).reason, 'W3_W2_EVENT_WATERMARK_CONFLICT');
  x.continuity.cursor.through_seq = 12;
  x.sourceWitness.event_seq = 11;
  assert.equal(inspect(x).reason, 'W3_SOURCE_CURSOR_CONFLICT');
});

test('invalid paged cursors and bogus integer encodings never produce alignment', () => {
  for (const broken of ['-1', '1.0', '01', 'NaN', '9007199254740993']) {
    const x = withSha(fixture());
    x.gatewayResponse.run.cursor = broken;
    assert.equal(inspect(x).reason, 'W3_RUN_IDENTITY_UNVERIFIED');
  }
  for (const patch of [
    { after_seq: 13 }, { next_seq: 13 },
    { has_more: true }, { through_seq: -1 }, { next_seq: '12' },
  ]) {
    const x = withSha(fixture());
    Object.assign(x.continuity.cursor, patch);
    assert.equal(inspect(x).reason, 'W3_W2_EVENT_WATERMARK_CONFLICT');
  }
});

test('event cursor rollback against prior projection is detected even WITHOUT future source', () => {
  const x = fixture();
  x.sourceWitness = null;
  x.previous = prior({ event_seq: 13 });
  const result = inspect(x);
  assert.equal(result.state, 'AMBIGUOUS');
  assert.equal(result.reason, 'EVENT_CURSOR_ROLLBACK');
  assert.equal(result.cursor_relation, 'REGRESSION');
  assert.equal(result.resync, 'EXTERNAL_OWNER_REBIND_REQUIRED');
  assertNoAuthority(result);
});

test('noncontiguous forward progress is allowed; no effect/admission inferred', () => {
  const x = withSha(fixture());
  x.previous = prior({ event_seq: 2 });
  const result = inspect(x);
  assert.equal(result.shape, 'ALIGNED');
  assert.equal(result.state, 'UNKNOWN');
  assertNoAuthority(result);
});

test('equal cursor is legal but NEVER HEALTHY, especially with HTTP 200', () => {
  const x = withSha(fixture());
  x.previous = prior({ event_seq: 12 });
  x.gatewayResponse.http_status = 200;
  const result = inspect(x);
  assert.equal(result.shape, 'ALIGNED');
  assertNoAuthority(result);
});

test('new run, changed owner epoch or changed source SHA require independently authenticated rebind', () => {
  for (const previous of [
    prior({ run_id: 'run:old' }),
    prior({ owner_epoch: 6 }),
    prior({ source_sha: secondSha }),
  ]) {
    const x = withSha(fixture());
    x.previous = previous;
    const got = inspect(x);
    assert.equal(got.state, 'AMBIGUOUS');
    assert.equal(got.reason, 'PREVIOUS_OWNER_RUN_SOURCE_REBIND_REQUIRED');
    assert.equal(got.resync, 'EXTERNAL_OWNER_REBIND_REQUIRED');
  }
});

test('reset_requested=true, forged signatures and response 200 cannot authorize reset', () => {
  const x = withSha(fixture());
  x.resetRequested = { signed: true, authorized: true, proof_sha256: 'f'.repeat(64) };
  x.previous = prior({ event_seq: 999 });
  x.gatewayResponse.http_status = 200;
  const got = inspect(x);
  assert.equal(got.reason, 'RESET_REQUIRES_INDEPENDENT_REBIND');
  assert.equal(got.state, 'UNKNOWN');
  assert.equal(got.resync, 'EXTERNAL_OWNER_REBIND_REQUIRED');
  assertNoAuthority(got);
});

test('owner epoch reset cannot bypass W2 epoch fence even with reset hint', () => {
  const x = withSha(fixture());
  x.gatewayResponse.run.owner_epoch = 8;
  x.resetRequested = true;
  const got = inspect(x);
  assert.equal(got.state, 'AMBIGUOUS');
  assert.equal(got.reason, 'W3_OWNER_EPOCH_CONFLICT');
});

test('missing, stale or forged Owner remains UNKNOWN/STALE, with no resync authority', () => {
  const x = withSha(fixture());
  assert.equal(inspect({ ...x, owner: null }).reason, 'OWNER_TRUTH_ABSENT');
  assert.equal(inspect({ ...x, owner: { ...owner, source: 'HTTP_REQUEST' } }).reason, 'OWNER_TRUTH_ABSENT');
  x.sourceWitness.observed_at = stamp(-31000);
  assert.equal(inspect(x).state, 'STALE');
  x.sourceWitness.observed_at = stamp(-90);
  x.continuity.heartbeat_at = stamp(-31000);
  assert.equal(inspect(x).reason, 'OWN_PG_CONTINUITY_STALE');
  x.continuity.heartbeat_at = stamp(-200);
  x.gatewayResponse.run.observed_at = stamp(-31000);
  assert.equal(inspect(x).reason, 'W3_RUN_IDENTITY_STALE');
});

test('prior checkpoint corruption fails closed instead of silently discarding regression history', () => {
  const x = withSha(fixture());
  x.previous = { ...prior(), event_seq: '9' };
  assert.equal(inspect(x).reason, 'PREVIOUS_CURSOR_BINDING_UNVERIFIED');
  assertNoAuthority(inspect(x));
});

test('cloud fallback, executable effect scope, and forged source claims are rejected', () => {
  for (const patch of [
    { storage: 'SUPABASE' }, { scheduler_authority: true },
    { authority_effect: true }, { scope: 'MUTATE' },
    { automatic_retry_allowed: true }, { schema: 'cloud.gateway' },
  ]) {
    const x = withSha(fixture());
    Object.assign(x.gatewayResponse, patch);
    assert.equal(inspect(x).reason, 'W3_CONTEXT_NOT_QUALIFIED');
  }
  const x = withSha(fixture());
  x.sourceWitness.source = 'PAGE_SCRIPT';
  assert.equal(inspect(x).reason, 'W3_SOURCE_WITNESS_UNVERIFIED');
});

test('no secret/raw SQL/DOM/worker text leaks from any conformance result', () => {
  const x = withSha(fixture());
  x.gatewayResponse.token = 'SECRET_VALUE';
  x.sourceWitness.raw_sql = 'SECRET_VALUE';
  x.owner = { ...owner, raw_dom: 'SECRET_VALUE' };
  const got = inspect(x);
  assert.equal(JSON.stringify(got).includes('SECRET_VALUE'), false);
  assertNoAuthority(got);
});

test('clock input is bounded and pure no-I/O module rejects malformed time', () => {
  assert.throws(() => inspect({ nowMs: -1 }), /clock_invalid/);
  assert.throws(() => inspect({ nowMs: NaN }), /clock_invalid/);
});
