import assert from 'node:assert/strict';
import test from 'node:test';
import { startDbApi } from './db-api.mjs';
import { RPC_ALLOWLIST } from './db-api-core.mjs';
import { OPERATOR_PG17_RESTART_ADMISSION_SQL } from './operator-pg17-restart-admission.mjs';
import {
  OPERATOR_OWN_PG_PROJECT_SQL, OPERATOR_OWN_PG_TASK_CLAIM_SQL, OPERATOR_OWN_PG_EVENT_SQL,
} from './operator-own-pg-fleet-truth.mjs';

const uuid = tail => '00000000-0000-4000-8000-' + String(tail).padStart(12, '0');
const owner = () => ({
  schema: 'metaengine.operator.trusted-owner.v1', source: 'TRUSTED_OWNER_READBACK',
  verified: true, project_id: uuid(1), workspace_id: uuid(2), device_id: uuid(3),
  owner_id: 'native-owner-one', client_id: 'native-owner-one',
  admin_grant_epoch: 7, owner_generation: 21, process_incarnation: 'browser-21',
  observed_at: new Date().toISOString(), heartbeat_at: new Date().toISOString(),
  event_after_seq: 0,
});
const signature = name => ({ name, defaults: 0, returnsSet: false, returnComposite: false, args: [] });
function fakeDatabase({ denied = false, duplicate = false, restarted = false, missingSchema = false,
  wrongVersion = false, wrongTransaction = false, deniedCatalog = false, cursorGap = false } = {}) {
  const calls = [];
  const now = Date.now();
  const task = {
    task_seq: 1, task_id: uuid(4), task_state: 'RUNNING', lease_generation: 5,
    lease_agent_id: 'worker-1', lease_agent_generation_epoch: 7,
    lease_expires_at: new Date(now + 10000).toISOString(),
    claim_id: 101, claim_state: 'ACTIVE', claim_agent_id: 'worker-1',
    claim_generation: 5, claim_agent_generation: 7, claim_workspace_id: uuid(2),
    claim_expires_at: new Date(now + 10000).toISOString(),
  };
  const tx = { unsafe: async (text, values = []) => {
    calls.push({ text, values });
    if (text.includes('FROM pg_catalog.pg_proc')) return RPC_ALLOWLIST.map(signature);
    if (text === OPERATOR_PG17_RESTART_ADMISSION_SQL) {
      if (deniedCatalog) throw new Error('postgres://secret:password@127.0.0.1/private');
      return [{ observed_at: new Date(), started_at: new Date(now - (restarted ? 50000 : 60000)),
        database_name: 'own_pg_test', server_version_num: wrongVersion ? 160008 : 170006,
        transaction_read_only: wrongTransaction ? 'off' : 'on',
        transaction_isolation: wrongTransaction ? 'read committed' : 'repeatable read',
        readable_relations: missingSchema ? 4 : 5 }];
    }
    if (text.includes('pg_postmaster_start_time')) return [{
      observed_at: new Date(), started_at: new Date(now - 60000), database_name: 'own_pg_test',
    }];
    if (text.includes('devos_runtime_capabilities_v1')) return [{ value: { schema: 'own.pg.test' } }];
    if (text === OPERATOR_OWN_PG_PROJECT_SQL) {
      if (denied) throw new Error('permission denied for relation private_ledger');
      return [{ project_id: uuid(1), workspace_id: uuid(2), device_id: uuid(3),
        client_id: 'native-owner-one', admin_grant_epoch: 7, total_tasks: 1,
        last_seq: 1, policy_generation: 1, observed_at: new Date() }];
    }
    if (text === OPERATOR_OWN_PG_TASK_CLAIM_SQL) return duplicate ? [task, { ...task, claim_id: 102 }] : [task];
    if (text === OPERATOR_OWN_PG_EVENT_SQL) return [{ seq: cursorGap ? 2 : 1, event_type: 'TASK_PROGRESS',
      task_id: uuid(4), content: { token: 'MUST_NEVER_LEAK' } }];
    return [];
  } };
  return { calls, sql: { begin: async callback => callback(tx), json: x => x, array: x => x } };
}

test('only authenticated local HTTP and internal Owner readback may inspect PostgreSQL ledger', async () => {
  const fake = fakeDatabase();
  let reads = 0;
  const key = 'k'.repeat(64);
  const runtime = await startDbApi({ apiKey: key, sql: fake.sql, port: 0,
    operatorOwnerReadback: () => { reads += 1; return owner(); } });
  try {
    assert.equal((await fetch(runtime.address + '/operator/v1/context')).status, 401);
    assert.equal((await fetch(runtime.address + '/operator/v1/context?owner_id=override',
      { headers: { apikey: key } })).status, 400);
    assert.equal((await fetch(runtime.address + '/operator/v1/context',
      { method: 'POST', headers: { apikey: key } })).status, 405);
    assert.equal((await fetch(runtime.address + '/operator/v1/context',
      { headers: { apikey: key, origin: 'https://evil.example' } })).status, 403);
    assert.equal(reads, 0);
    assert.equal(fake.calls.filter(c => c.text === OPERATOR_OWN_PG_PROJECT_SQL).length, 0);
    const response = await fetch(runtime.address + '/operator/v1/context', { headers: { apikey: key } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(reads, 2, 'W37 must independently recheck the native Owner after SQL readback');
    assert.equal(body.planes.fleet.state, 'AVAILABLE');
    assert.equal(body.planes.fleet.details.claim_count, 1);
    assert.equal(body.planes.continuity.details.next_seq, 1);
    assert.equal(body.planes.client.state, 'UNKNOWN');
    assert.equal(body.operational_state, 'NOT_PROVEN');
    assert.equal(body.authority_effect, false);
    assert.equal(body.scheduler_authority, false);
    assert.doesNotMatch(JSON.stringify(body), /MUST_NEVER_LEAK|lease_agent_id|connection_string/);
    assert.ok(fake.calls.some(c => c.text === 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'));
    assert.deepEqual(fake.calls.find(c => c.text === OPERATOR_OWN_PG_PROJECT_SQL).values,
      [uuid(1), uuid(2), uuid(3), 'native-owner-one', 7]);
  } finally { await runtime.close(); }
});

test('unproven Owner and permission errors are explicit UNKNOWN, never alternate network fallback', async () => {
  for (const ownerReadback of [null, () => ({ ...owner(), verified: false }), () => owner()]) {
    const fake = fakeDatabase({ denied: true });
    const key = 'q'.repeat(64);
    const runtime = await startDbApi({ apiKey: key, sql: fake.sql, port: 0, operatorOwnerReadback: ownerReadback });
    try {
      const response = await fetch(runtime.address + '/operator/v1/context', { headers: { apikey: key } });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.planes.fleet.state, 'UNKNOWN');
      assert.equal(body.planes.continuity.state, 'UNKNOWN');
      assert.equal(body.cloud_database_dependency, false);
      assert.equal(body.remote_fallback_allowed, false);
      const sqlCalls = fake.calls.filter(c => c.text === OPERATOR_OWN_PG_PROJECT_SQL);
      assert.equal(sqlCalls.length, ownerReadback === null ? 0 : ownerReadback().verified ? 1 : 0);
    } finally { await runtime.close(); }
  }
});

test('HTTP snapshot never accepts duplicate live claim rows as a valid lease', async () => {
  const fake = fakeDatabase({ duplicate: true });
  const key = 'z'.repeat(64);
  const runtime = await startDbApi({ apiKey: key, sql: fake.sql, port: 0, operatorOwnerReadback: owner });
  try {
    const response = await fetch(runtime.address + '/operator/v1/context', { headers: { apikey: key } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.planes.fleet.state, 'AMBIGUOUS');
    assert.notEqual(body.operational_state, 'ALL_PLANES_REPORTED_READY');
  } finally { await runtime.close(); }
});

test('W25 PostgreSQL 17 restart, schema admission, grants and isolation fail closed at HTTP', async () => {
  for (const scenario of [
    { restarted: true, expectedDatabase: 'UNVERIFIED' },
    { missingSchema: true }, { wrongVersion: true },
    { wrongTransaction: true }, { deniedCatalog: true },
  ]) {
    const fake = fakeDatabase(scenario);
    const key = 'p'.repeat(64);
    const runtime = await startDbApi({ apiKey: key, sql: fake.sql, port: 0, operatorOwnerReadback: owner });
    try {
      const response = await fetch(runtime.address + '/operator/v1/context', { headers: { apikey: key } });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.planes.fleet.state, 'UNKNOWN');
      assert.equal(body.planes.continuity.state, 'UNKNOWN');
      if (scenario.expectedDatabase) assert.equal(body.planes.database.state, scenario.expectedDatabase);
      assert.equal(body.authority_effect, false);
      assert.equal(body.remote_fallback_allowed, false);
      assert.equal(fake.calls.filter(c => c.text === OPERATOR_OWN_PG_PROJECT_SQL).length, 0,
        'failed admission must not query any lease or event');
      assert.doesNotMatch(JSON.stringify(body), /secret|password|private/i);
    } finally { await runtime.close(); }
  }
});

test('W25 event cursor corruption cannot gain continuity availability after restart fence', async () => {
  const fake = fakeDatabase({ cursorGap: true });
  const key = 'c'.repeat(64);
  const runtime = await startDbApi({ apiKey: key, sql: fake.sql, port: 0, operatorOwnerReadback: owner });
  try {
    const response = await fetch(runtime.address + '/operator/v1/context', { headers: { apikey: key } });
    assert.equal(response.status, 200);
    const body = await response.json();
    // Evidence reduction can classify a poisoned fleet/continuity facet
    // AMBIGUOUS or UNVERIFIED depending on cross-plane corroboration;
    // neither classification can be positive or authorize any effect.
    for (const name of ['fleet', 'continuity']) {
      assert.match(body.planes[name].state, /^(AMBIGUOUS|UNVERIFIED)$/);
      assert.notEqual(body.planes[name].state, 'AVAILABLE');
    }
    assert.equal(body.authority_effect, false);
    assert.ok(fake.calls.some(c => c.text === OPERATOR_PG17_RESTART_ADMISSION_SQL));
    assert.deepEqual(fake.calls.filter(c => c.text === OPERATOR_OWN_PG_EVENT_SQL)
      .map(c => c.values), [[uuid(1), 0, 1]]);
  } finally { await runtime.close(); }
});
