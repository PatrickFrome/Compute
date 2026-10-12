import assert from 'node:assert/strict';
import test from 'node:test';
import { OPERATOR_DB_IDENTITY_SQL, qualifyLocalPostgresEvidence } from './operator-truth-readback.mjs';
import { buildUnifiedOperatorContext } from './operator-unified-snapshot-core.mjs';

const now = Date.parse('2026-10-12T10:00:00Z');
const base = () => ({
  nowMs: now,
  clockRows: [{ observed_at: new Date(now - 100), started_at: new Date(now - 3600000), database_name: 'owned_pg' }],
  capabilityRows: [{ value: { schema: 'devos.runtime.v1', secret: 'CAPABILITY_SECRET' } }],
  rpcAvailable: 46, rpcExpected: 46, tablesAvailable: 5, tablesExpected: 5,
});
const project = (args) => buildUnifiedOperatorContext({ nowMs: now, observations: {
  database: qualifyLocalPostgresEvidence(args),
} });
const client = (patch = {}) => ({
  source: 'NATIVE_BROWSER_READBACK', state: 'READY', proven: true,
  observed_at: new Date(now - 100).toISOString(), heartbeat_at: new Date(now - 200).toISOString(),
  owner_id: 'owner-A', process_incarnation: 'inc-1', ...patch,
});

test('fixed query is read-only, database session identity is the timestamp source', () => {
  assert.match(OPERATOR_DB_IDENTITY_SQL, /^SELECT /);
  assert.match(OPERATOR_DB_IDENTITY_SQL, /pg_catalog\.clock_timestamp\(\)/);
  assert.doesNotMatch(OPERATOR_DB_IDENTITY_SQL, /\b(?:INSERT|UPDATE|DELETE|DROP|COPY|DO|EXECUTE)\b/i);
  const value = project(base());
  assert.equal(value.planes.database.state, 'AVAILABLE');
  assert.equal(value.planes.database.observed_at, new Date(now - 100).toISOString());
  assert.equal(value.planes.database.proof, 'TRUSTED_READBACK');
  assert.equal(value.planes.supervisor.state, 'UNKNOWN');
  assert.equal(value.planes.fleet.state, 'UNKNOWN');
  assert.equal(value.planes.client.state, 'UNKNOWN');
  assert.equal(value.planes.host.state, 'UNKNOWN');
  assert.equal(value.planes.source.state, 'UNKNOWN');
  assert.equal(value.planes.continuity.state, 'UNKNOWN');
  assert.equal(value.operational_state, 'NOT_PROVEN');
  assert.equal(value.authority_effect, false);
  assert.equal(JSON.stringify(value).includes('CAPABILITY_SECRET'), false);
});

test('missing/corrupt/conflicting PostgreSQL witnesses never produce availability', () => {
  const sample = base();
  for (const patch of [
    { clockRows: [] }, { clockRows: [sample.clockRows[0], sample.clockRows[0]] },
    { clockRows: [{ ...sample.clockRows[0], started_at: new Date(now + 5) }] },
    { clockRows: [{ ...sample.clockRows[0], database_name: '' }] },
    { capabilityRows: [] }, { capabilityRows: [{ value: { schema: 'secret\n' } }] },
    { rpcAvailable: -1 }, { rpcAvailable: 99 }, { tablesExpected: NaN },
  ]) assert.equal(project({ ...sample, ...patch }).planes.database.state, 'UNVERIFIED');
  assert.equal(project({ ...sample, rpcAvailable: 45 }).planes.database.state, 'DEGRADED');
  assert.equal(project({ ...sample, clockRows: [{
    ...sample.clockRows[0], observed_at: new Date(now - 31_000),
  }] }).planes.database.state, 'STALE');
});

test('owner/heartbeat absence, corruption and contradictory witnesses fail closed', () => {
  const state = observation => buildUnifiedOperatorContext({ nowMs: now, observations: observation });
  assert.equal(state({ client: client({ owner_id: undefined }) }).planes.client.state, 'UNVERIFIED');
  assert.equal(state({ client: client({ heartbeat_at: undefined }) }).planes.client.state, 'UNVERIFIED');
  assert.equal(state({ client: client({ heartbeat_at: new Date(now - 31_000).toISOString() }) }).planes.client.state, 'STALE');
  assert.equal(state({ client: client({ process_incarnation: undefined }) }).planes.client.state, 'UNVERIFIED');
  assert.equal(state({ client: [client(), client({ owner_id: 'owner-B' })] }).planes.client.state, 'AMBIGUOUS');
  const supervisor = { source: 'SIGNED_SUPERVISOR_READBACK', proven: true, state: 'READY',
    observed_at: new Date(now).toISOString(), heartbeat_at: new Date(now).toISOString(),
    owner_id: 'owner-A', supervisor_epoch: 1 };
  assert.equal(state({ supervisor }).planes.supervisor.state, 'UNVERIFIED');
  assert.equal(state({ supervisor: { ...supervisor, signature_verified: true } }).planes.supervisor.state, 'READY');
  assert.equal(state({ client: client(), supervisor: { ...supervisor, signature_verified: true, owner_id: 'owner-B' } }).planes.client.state, 'AMBIGUOUS');
});

test('non-DB plane evidence rejects malformed source, continuity, fleet and secret properties', () => {
  const shared = { observed_at: new Date(now).toISOString(), heartbeat_at: new Date(now).toISOString(),
    owner_id: 'owner-A', proven: true, state: 'READY', secret: 'NEVER_PROJECT_THIS' };
  const observations = {
    source: { ...shared, source: 'EXACT_GIT_READBACK', source_sha: 'not-a-sha' },
    continuity: { ...shared, source: 'LOCAL_CHECKPOINT_LEDGER', event_seq: -1 },
    fleet: { ...shared, source: 'LOCAL_TASK_LEDGER', lease_generation: -1 },
    host: { ...shared, source: 'TRUSTED_HOST_READBACK' },
  };
  const output = buildUnifiedOperatorContext({ nowMs: now, observations });
  for (const key of Object.keys(observations)) assert.equal(output.planes[key].state, 'UNVERIFIED');
  assert.equal(JSON.stringify(output).includes('NEVER_PROJECT_THIS'), false);
  assert.equal(output.remote_fallback_allowed, false);
});
