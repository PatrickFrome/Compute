import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUnifiedOperatorContext, OPERATOR_PLANES } from './operator-unified-snapshot-core.mjs';

const now = Date.parse('2026-10-12T10:00:00Z');
const db = (patch = {}) => ({
  source: 'LOCAL_POSTGRES', state: 'AVAILABLE', proven: true, observed_at: new Date(now - 50).toISOString(),
  rpc_available: 36, rpc_expected: 36, tables_available: 5, tables_expected: 5,
  capability_schema: 'devos.capabilities.v1',
  private_key: 'SENSITIVE_SHOULD_NEVER_LEAK', connection_string: 'postgres://private:secret@127.0.0.1/',
  ...patch,
});

test('empty context has explicit unknown planes, zero authority and own PostgreSQL only', () => {
  const result = buildUnifiedOperatorContext({ nowMs: now });
  assert.equal(result.schema, 'metaengine.operator.context.v1');
  assert.deepEqual(Object.keys(result.planes), [...OPERATOR_PLANES]);
  assert.equal(result.storage, 'OWN_POSTGRES_ONLY');
  assert.equal(result.cloud_database_dependency, false);
  assert.equal(result.remote_fallback_allowed, false);
  assert.equal(result.authority_effect, false);
  assert.equal(result.scheduler_authority, false);
  assert.equal(result.operational_state, 'NOT_PROVEN');
  for (const plane of OPERATOR_PLANES) assert.equal(result.planes[plane].state, 'UNKNOWN');
});

test('live local DB availability never promotes Client, Fleet or Host', () => {
  const result = buildUnifiedOperatorContext({ nowMs: now, observations: { database: db() } });
  assert.equal(result.planes.database.state, 'AVAILABLE');
  assert.equal(result.planes.database.proof, 'TRUSTED_READBACK');
  assert.equal(result.planes.database.details.catalog_rpc_available, 36);
  assert.equal(result.planes.supervisor.state, 'UNKNOWN');
  assert.equal(result.planes.fleet.state, 'UNKNOWN');
  assert.equal(result.planes.host.state, 'UNKNOWN');
  assert.equal(result.operational_state, 'NOT_PROVEN');
  assert.equal(JSON.stringify(result).includes('SENSITIVE_SHOULD_NEVER_LEAK'), false);
  assert.equal(JSON.stringify(result).includes('private:secret'), false);
});

test('future, stale, wrong provenance and unproven states fail closed', () => {
  const projected = patch => buildUnifiedOperatorContext({ nowMs: now, observations: { database: db(patch) } }).planes.database.state;
  assert.equal(projected({ observed_at: new Date(now - 30001).toISOString() }), 'STALE');
  assert.equal(projected({ observed_at: new Date(now + 5001).toISOString() }), 'STALE');
  assert.equal(projected({ source: 'SIGNED_SUPERVISOR_READBACK' }), 'UNVERIFIED');
  assert.equal(projected({ proven: false }), 'UNVERIFIED');
  assert.equal(projected({ state: 'arbitrary' }), 'UNVERIFIED');
  assert.equal(projected({ observed_at: 'not-a-date' }), 'UNVERIFIED');
});

test('attacker properties are ignored and only bounded safe schema identifiers survive', () => {
  const result = buildUnifiedOperatorContext({ nowMs: now, observations: {
    database: db({ capability_schema: 'token=secret\n', details: { secret: 'oops' }, authority_effect: true }),
    rogue: { state: 'READY', proven: true },
  } });
  assert.equal(result.planes.database.details.capability_schema, null);
  assert.equal(result.authority_effect, false);
  assert.equal(Object.hasOwn(result.planes, 'rogue'), false);
  assert.equal(JSON.stringify(result).includes('oops'), false);
  assert.throws(() => buildUnifiedOperatorContext({ nowMs: NaN }), /clock_invalid/);
  assert.throws(() => buildUnifiedOperatorContext({ nowMs: now, maxAgeMs: 0 }), /freshness_policy_invalid/);
});
