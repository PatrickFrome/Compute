import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUnifiedOperatorContext } from './operator-unified-snapshot-core.mjs';
import {
  qualifyOperatorOwner, readOwnPostgresOperatorTruth,
  OPERATOR_OWN_PG_PROJECT_SQL, OPERATOR_OWN_PG_TASK_CLAIM_SQL, OPERATOR_OWN_PG_EVENT_SQL,
} from './operator-own-pg-fleet-truth.mjs';

const NOW = Date.parse('2026-10-13T01:00:00Z');
const uuid = tail => '00000000-0000-4000-8000-' + String(tail).padStart(12, '0');
const stamp = offset => new Date(NOW + offset).toISOString();
const owner = (patch = {}) => ({
  schema: 'metaengine.operator.trusted-owner.v1', source: 'TRUSTED_OWNER_READBACK',
  verified: true, project_id: uuid(1), workspace_id: uuid(2), device_id: uuid(3),
  owner_id: 'native-owner-one', client_id: 'native-owner-one',
  admin_grant_epoch: 7, owner_generation: 21, process_incarnation: 'owner-run-21',
  observed_at: stamp(-100), heartbeat_at: stamp(-100), event_after_seq: 0, ...patch,
});
const project = (patch = {}) => ({
  project_id: uuid(1), workspace_id: uuid(2), device_id: uuid(3),
  client_id: 'native-owner-one', admin_grant_epoch: 7,
  total_tasks: 1, last_seq: 2, policy_generation: 1, observed_at: stamp(-50), ...patch,
});
const task = (patch = {}) => ({
  task_seq: 1, task_id: uuid(4), task_state: 'RUNNING',
  lease_generation: 4, lease_agent_id: 'implementer-1', lease_agent_generation_epoch: 3,
  lease_expires_at: stamp(10000), claim_id: 42, claim_state: 'ACTIVE',
  claim_agent_id: 'implementer-1', claim_generation: 4, claim_agent_generation: 3,
  claim_expires_at: stamp(10000), claim_workspace_id: uuid(2),
  secret: 'DO_NOT_DISCLOSE_PRIVATE_SQL', ...patch,
});
const event = (seq, patch = {}) => ({ seq, event_type: 'TASK_PROGRESS', task_id: uuid(4),
  content: { secret: 'PRIVATE_EVENT_CONTENT' }, ...patch });
function db({ projects = [project()], tasks = [task()], events = [event(1), event(2)] } = {}) {
  const calls = [];
  return {
    calls,
    tx: { async unsafe(sql, params) {
      calls.push({ sql, params });
      if (sql === OPERATOR_OWN_PG_PROJECT_SQL) return projects;
      if (sql === OPERATOR_OWN_PG_TASK_CLAIM_SQL) return tasks;
      if (sql === OPERATOR_OWN_PG_EVENT_SQL) return events;
      throw new Error('unexpected_query');
    } },
  };
}
const read = (fake, identity = owner()) => readOwnPostgresOperatorTruth({ tx: fake.tx, owner: identity, nowMs: NOW });

test('bounded project-task-claim + monotonic event projection uses exactly three parameterized SELECTs', async () => {
  const fake = db();
  const result = await read(fake);
  assert.equal(result.reason, null);
  assert.equal(result.fleet.state, 'AVAILABLE');
  assert.equal(result.fleet.lease_generation, 4);
  assert.equal(result.fleet.claim_count, 1);
  assert.deepEqual(result.continuity.cursor, {
    project_id: uuid(1), after_seq: 0, next_seq: 2, through_seq: 2, has_more: false,
  });
  assert.deepEqual(fake.calls.map(x => x.sql), [
    OPERATOR_OWN_PG_PROJECT_SQL, OPERATOR_OWN_PG_TASK_CLAIM_SQL, OPERATOR_OWN_PG_EVENT_SQL,
  ]);
  assert.deepEqual(fake.calls[0].params, [uuid(1), uuid(2), uuid(3), 'native-owner-one', 7]);
  assert.match(fake.calls[1].sql, /LIMIT 65$/);
  assert.match(fake.calls[2].sql, /LIMIT 65$/);
  for (const call of fake.calls) assert.doesNotMatch(call.sql, /DO_NOT_DISCLOSE/);
  const projection = buildUnifiedOperatorContext({ nowMs: NOW, observations: result });
  assert.equal(projection.planes.fleet.details.claim_count, 1);
  assert.equal(projection.planes.continuity.details.next_seq, 2);
  assert.equal(projection.planes.host.state, 'UNKNOWN');
  assert.equal(projection.operational_state, 'NOT_PROVEN');
  assert.equal(projection.authority_effect, false);
  assert.equal(projection.automatic_retry_allowed, false);
  const text = JSON.stringify(projection);
  assert.doesNotMatch(text, /DO_NOT_DISCLOSE|PRIVATE_EVENT_CONTENT|secret|postgres:\/\//);
});

test('missing, stale, forged, conflicting Owner/generation never issues SQL', async () => {
  for (const identity of [
    null, owner({ verified: false }), owner({ source: 'MODEL_CLAIM' }),
    owner({ owner_id: 'other-owner' }), owner({ admin_grant_epoch: -1 }),
    owner({ event_after_seq: -1 }), owner({ event_after_seq: '' }), owner({ process_incarnation: '' }),
    owner({ heartbeat_at: stamp(-60_000) }), owner({ observed_at: stamp(6_000) }),
    owner({ project_id: "'; DROP TABLE projects; --" }),
  ]) {
    const fake = db();
    assert.equal(qualifyOperatorOwner(identity, NOW), false);
    const result = await read(fake, identity);
    assert.equal(result.fleet, null);
    assert.equal(result.continuity, null);
    assert.equal(fake.calls.length, 0);
  }
});

test('wrong Owner/epoch, duplicate project, missing or malformed readback is UNKNOWN', async () => {
  for (const data of [
    { projects: [] }, { projects: [project(), project()] },
    { projects: [project({ admin_grant_epoch: 8 })] },
    { projects: [project({ client_id: 'other-owner' })] },
    { projects: [project({ last_seq: NaN })] },
    { projects: [project({ observed_at: null })] },
    { projects: [project({ observed_at: stamp(-60000) })] },
    { tasks: [] }, { tasks: null }, { events: null },
  ]) {
    const result = await read(db(data));
    assert.equal(result.fleet, null);
    assert.equal(result.continuity, null);
  }
});

test('duplicate active claims, conflicting task snapshots and event gaps are AMBIGUOUS', async () => {
  for (const data of [
    { tasks: [task(), task({ claim_id: 43 })] },
    { tasks: [task(), task({ task_state: 'COMPLETED' })] },
    { tasks: [task({ claim_generation: 5 })] },
    { tasks: [task({ claim_agent_id: 'different-agent' })] },
    { tasks: [task({ claim_workspace_id: uuid(6) })] },
    { events: [event(1), event(3)] },
  ]) {
    const result = await read(db(data));
    assert.equal(result.fleet?.state, 'AMBIGUOUS', JSON.stringify(data));
    assert.equal(buildUnifiedOperatorContext({ nowMs: NOW, observations: result }).planes.fleet.state, 'AMBIGUOUS');
  }
});

test('lease missing or expired never promotes fleet', async () => {
  for (const data of [
    { tasks: [task({ claim_id: null })] },
    { tasks: [task({ claim_expires_at: stamp(-1), lease_expires_at: stamp(-1) })] },
    { tasks: [task({ lease_generation: -1 })] },
    { tasks: [task({ task_state: 'INVENTED_STATE' })] },
    { tasks: [task({ task_state: 'COMPLETED' })] },
  ]) {
    const result = await read(db(data));
    assert.notEqual(result.fleet?.state, 'AVAILABLE');
  }
});

test('event cursor respects trusted after_seq, contiguous sequence, and 64-row page boundary', async () => {
  const many = Array.from({ length: 65 }, (_, n) => event(n + 1));
  const first = await read(db({ projects: [project({ last_seq: 65 })], events: many }));
  assert.equal(first.continuity.cursor.next_seq, 64);
  assert.equal(first.continuity.cursor.has_more, true);
  const next = await read(db({ projects: [project({ last_seq: 65 })], events: [event(65)] }), owner({ event_after_seq: 64 }));
  assert.deepEqual(next.continuity.cursor, {
    project_id: uuid(1), after_seq: 64, next_seq: 65, through_seq: 65, has_more: false,
  });
  const replay = await read(db(), owner({ event_after_seq: 3 }));
  assert.equal(replay.fleet, null);
});

test('ledger reducer rejects cross-plane generation disagreement', () => {
  const good = {
    source: 'LOCAL_TASK_LEDGER', proven: true, state: 'AVAILABLE', observed_at: stamp(-100),
    owner_id: 'native-owner-one', heartbeat_at: stamp(-100), lease_generation: 4,
    owner_generation: 1,
  };
  const different = {
    source: 'LOCAL_CHECKPOINT_LEDGER', proven: true, state: 'AVAILABLE', observed_at: stamp(-100),
    owner_id: 'native-owner-one', heartbeat_at: stamp(-100), event_seq: 0,
    owner_generation: 2, cursor: { project_id: uuid(1), after_seq: 0, next_seq: 0, through_seq: 0, has_more: false },
  };
  const result = buildUnifiedOperatorContext({ nowMs: NOW, observations: { fleet: good, continuity: different } });
  assert.equal(result.planes.fleet.state, 'AMBIGUOUS');
  assert.equal(result.planes.continuity.state, 'AMBIGUOUS');
});
