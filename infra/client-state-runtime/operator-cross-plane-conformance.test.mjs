import test from 'node:test';
import assert from 'node:assert/strict';
import { readOwnPostgresOperatorTruth } from './operator-own-pg-fleet-truth.mjs';
import { conformOperatorReadbacks } from './operator-cross-plane-conformance.mjs';

const now = Date.parse('2026-10-14T00:00:00.000Z');
const at = delta => new Date(now + delta).toISOString();
const project = '00000000-0000-4000-8000-000000000011';
const workspace = '00000000-0000-4000-8000-000000000012';
const device = '00000000-0000-4000-8000-000000000013';
const taskId = '00000000-0000-4000-8000-000000000014';
const sha = 'a'.repeat(40);
const proof = 'b'.repeat(64);
const owner = Object.freeze({
  schema: 'metaengine.operator.trusted-owner.v1',
  source: 'TRUSTED_OWNER_READBACK', verified: true,
  project_id: project, workspace_id: workspace, device_id: device,
  owner_id: 'owner:one', client_id: 'owner:one',
  owner_generation: 7, admin_grant_epoch: 3,
  process_incarnation: 'process:instance:one', observed_at: at(-100),
  heartbeat_at: at(-200), event_after_seq: 0,
});
const run = Object.freeze({
  source: 'OWN_POSTGRES_READBACK', proven: true, project_id: project,
  owner_id: owner.owner_id, run_id: 'run:one', owner_epoch: 7, event_seq: 5,
  source_sha: sha, proof_sha256: proof, observed_at: at(-150),
});

async function witness({ through = 5, after = 0 } = {}) {
  const queries = [];
  const rows = [
    [{ project_id: project, workspace_id: workspace, device_id: device,
      client_id: owner.client_id, admin_grant_epoch: 3, total_tasks: 1,
      last_seq: through, policy_generation: 1, observed_at: at(-120) }],
    [{ task_seq: 1, task_id: taskId, task_state: 'COMPLETED',
      lease_generation: 0, claim_id: null }],
    Array.from({ length: through - after }, (_, index) => ({
      seq: after + index + 1, event_type: 'TASK_COMPLETED', task_id: taskId,
    })),
  ];
  const tx = { unsafe: async (sql, params) => {
    assert.match(sql, /^SELECT /);
    assert.doesNotMatch(sql, /\b(INSERT|DELETE|UPDATE|ALTER|DROP)\b/i);
    assert.ok(Array.isArray(params));
    queries.push(sql);
    return rows[queries.length - 1];
  } };
  const truth = await readOwnPostgresOperatorTruth({ tx, owner: { ...owner, event_after_seq: after }, nowMs: now });
  assert.equal(queries.length, 3, 'only existing three bounded W2 SELECTs');
  return truth;
}
async function inputs() {
  const truth = await witness();
  assert.equal(truth.reason, null);
  assert.equal(truth.continuity.cursor.through_seq, 5);
  return {
    owner, nowMs: now, runIdentity: { ...run }, observations: {
      ...truth,
      source: { source: 'EXACT_GIT_READBACK', state: 'AVAILABLE', proven: true,
        owner_id: owner.owner_id, source_sha: sha,
        observed_at: at(-100), heartbeat_at: at(-200) },
    },
  };
}
const conform = input => conformOperatorReadbacks(input);

test('real W2 fixed-select witness flows into one W6 canonical context, with no runtime readiness', async () => {
  const x = conform(await inputs());
  assert.equal(x.state, 'CONSISTENT_SHAPE');
  assert.equal(x.identity.run_id, x.context.run_id);
  assert.equal(x.identity.event_seq, x.context.event_seq);
  assert.equal(x.observatory.run_id, x.context.run_id);
  assert.equal(x.observatory.event_seq, x.context.event_seq);
  assert.equal(x.identity.owner_epoch, 7);
  assert.equal(x.identity.source_sha, sha);
  assert.equal(x.context.planes.fleet.state, 'AVAILABLE');
  assert.equal(x.observatory.planes.continuity.state, 'AVAILABLE');
  assert.equal(x.context.operational_state, 'NOT_PROVEN');
  assert.equal(x.physical_attestation, 'NOT_PROVEN');
  assert.equal(x.authority_effect, false);
});

test('current W3 readRunIdentity lacks source SHA/proof: explicit UNKNOWN, not fabricated identity', async () => {
  const x = await inputs();
  delete x.runIdentity.source_sha;
  delete x.runIdentity.proof_sha256;
  const actual = conform(x);
  assert.equal(actual.state, 'UNKNOWN');
  assert.equal(actual.reason, 'SOURCE_IDENTITY_NOT_COLOCATED');
  assert.equal(actual.identity, null);
  assert.equal(actual.observatory.cursor_state, 'UNKNOWN');
  assert.equal(actual.context.planes.fleet.state, 'UNKNOWN');
});

test('absent trusted Owner or missing real W2 ledger cannot be promoted by HTTP 200', async () => {
  const x = await inputs();
  for (const patch of [
    { owner: null, http_status: 200, ok: true },
    { owner: { ...owner, source: 'HTTP_REQUEST' } },
    { observations: { database: { state: 'READY', source: 'HTTP_200' } } },
    { runIdentity: null },
  ]) {
    const got = conform({ ...x, ...patch });
    assert.equal(got.state, 'UNKNOWN');
    assert.equal(got.identity, null);
    assert.equal(got.observatory.planes.fleet.state, 'UNKNOWN');
    assert.equal(got.observatory.cursor_state, 'UNKNOWN');
  }
});

test('source Git SHA mismatches fail closed and never show READY', async () => {
  const x = await inputs();
  x.observations.source.source_sha = 'c'.repeat(40);
  const got = conform(x);
  assert.equal(got.state, 'AMBIGUOUS');
  assert.equal(got.reason, 'SOURCE_SHA_CONFLICT');
  assert.equal(got.identity, null);
  assert.equal(got.context.planes.source.state, 'UNKNOWN');
});

test('cross-plane conflicting owner and Owner epoch are independently fenced', async () => {
  const x = await inputs();
  assert.equal(conform({ ...x, observations: {
    ...x.observations, fleet: { ...x.observations.fleet, owner_id: 'owner:other' },
  } }).reason, 'OWNER_CONFLICT');
  assert.equal(conform({ ...x, runIdentity: { ...x.runIdentity, owner_epoch: 8 } }).reason, 'OWNER_EPOCH_CONFLICT');
  assert.equal(conform({ ...x, observations: {
    ...x.observations, continuity: { ...x.observations.continuity, owner_generation: 8 },
  } }).reason, 'OWNER_EPOCH_CONFLICT');
});

test('W2 cursor page vs canonical event watermark are not confused', async () => {
  const x = await inputs();
  const page = await witness({ through: 5, after: 3 });
  const partial = { ...x, observations: { ...x.observations, ...page } };
  const good = conform(partial);
  assert.equal(good.state, 'CONSISTENT_SHAPE');
  assert.equal(good.identity.event_seq, 5);
  assert.equal(good.context.planes.continuity.details.next_seq, 5);
  const bad = conform({ ...x, runIdentity: { ...x.runIdentity, event_seq: 4 } });
  assert.equal(bad.reason, 'EVENT_CURSOR_CONFLICT');
  assert.equal(bad.state, 'AMBIGUOUS');
});

test('event_seq rollback is rejected across repeated readbacks', async () => {
  const x = await inputs();
  const prev = conform(x);
  const newTruth = await witness({ through: 4 });
  const got = conform({ ...x, previous: prev, runIdentity: { ...run, event_seq: 4 },
    observations: { ...x.observations, ...newTruth } });
  assert.equal(got.reason, 'EVENT_CURSOR_ROLLBACK');
  assert.equal(got.state, 'AMBIGUOUS');
  assert.equal(got.observatory.state, 'AMBIGUOUS');
});

test('same cursor with a changed proof is equivocation, not a new event', async () => {
  const x = await inputs();
  const prev = conform(x);
  const got = conform({ ...x, previous: prev,
    runIdentity: { ...run, proof_sha256: 'f'.repeat(64) } });
  assert.equal(got.reason, 'EQUAL_CURSOR_PROOF_CONFLICT');
  assert.equal(got.identity, null);
});

test('run identity swap and source SHA swap require explicit rebind', async () => {
  const x = await inputs();
  const prev = conform(x);
  assert.equal(conform({ ...x, previous: prev,
    runIdentity: { ...run, run_id: 'run:other' } }).reason, 'RUN_OWNER_CHANGED');
  const sourceSha = 'c'.repeat(40);
  const newSource = { ...x.observations.source, source_sha: sourceSha };
  assert.equal(conform({ ...x, previous: prev,
    runIdentity: { ...run, source_sha: sourceSha },
    observations: { ...x.observations, source: newSource } }).reason,
  'SOURCE_SHA_CHANGED_WITHOUT_REBIND');
});

test('stale source/heartbeat cannot elevate context or W6 to ACTIVE/HEALTHY', async () => {
  const x = await inputs();
  const staleSource = { ...x.observations.source, heartbeat_at: at(-60000) };
  const got = conform({ ...x, http_status: 200,
    observations: { ...x.observations, source: staleSource } });
  assert.equal(got.identity, null);
  assert.equal(got.context.planes.source.state, 'UNKNOWN');
  assert.notEqual(got.observatory.state, 'OBSERVED');
});

test('bounded public projections redact opaque secrets and payloads', async () => {
  const x = await inputs();
  x.observations.fleet.private_sql = 'SECRET_XYZ';
  x.observations.source.access_token = 'SECRET_XYZ';
  x.runIdentity.page_text = 'SECRET_XYZ';
  x.observations.database = { state: 'UNKNOWN', source: 'LOCAL_POSTGRES', password: 'SECRET_XYZ' };
  const got = conform(x);
  assert.equal(got.state, 'CONSISTENT_SHAPE');
  assert.equal(JSON.stringify(got).includes('SECRET_XYZ'), false);
  assert.equal(got.observatory.authority_effect, false);
});
