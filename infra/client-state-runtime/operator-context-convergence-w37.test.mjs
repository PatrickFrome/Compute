// W37 source-only cross-plane composition test. These mocked Owner/OS/SQL
// readers NEVER establish authentic installed process provenance or effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startDbApi } from './db-api.mjs';
import { RPC_ALLOWLIST } from './db-api-core.mjs';
import { OPERATOR_PG17_RESTART_ADMISSION_SQL } from './operator-pg17-restart-admission.mjs';
import { OPERATOR_OWN_PG_PROJECT_SQL, OPERATOR_OWN_PG_TASK_CLAIM_SQL,
  OPERATOR_OWN_PG_EVENT_SQL } from './operator-own-pg-fleet-truth.mjs';
import { startOperatorReadOnlyGateway } from './operator-readonly-gateway.mjs';
import { createOperatorNativeContextReader } from '../../apps/metaengine-browser/src/operator-native-context-bridge.mjs';

const uuid = last => '00000000-0000-4000-8000-' + String(last).padStart(12, '0');
const ownerId = 'native-owner-one';
const key = 'q'.repeat(64);
const born = new Date(Date.now() - 120000).toISOString();
const stamp = () => new Date().toISOString();
const owner = (epoch = 7) => ({
  schema: 'metaengine.operator.trusted-owner.v1', source: 'TRUSTED_OWNER_READBACK',
  verified: true, project_id: uuid(1), workspace_id: uuid(2), device_id: uuid(3),
  owner_id: ownerId, client_id: ownerId, admin_grant_epoch: epoch,
  owner_generation: epoch + 14, process_incarnation: 'browser-' + epoch,
  observed_at: stamp(), heartbeat_at: stamp(), event_after_seq: 0,
});
function fakeDatabase(state) {
  const calls = [];
  const now = Date.now();
  const sql = { json: x => x, array: x => x, begin: async fn => fn({ unsafe: async (query, values = []) => {
    calls.push({ query, values });
    if (query.includes('FROM pg_catalog.pg_proc'))
      return RPC_ALLOWLIST.map(name => ({ name, defaults: 0, returnsSet: false,
        returnComposite: false, args: [] }));
    if (query === OPERATOR_PG17_RESTART_ADMISSION_SQL)
      return [{ observed_at: new Date(), started_at: new Date(now - (state.restart ? 50000 : 60000)),
        database_name: 'own_pg_w37', server_version_num: 170006, transaction_read_only: 'on',
        transaction_isolation: 'repeatable read', readable_relations: 5 }];
    if (query.includes('pg_postmaster_start_time'))
      return [{ observed_at: new Date(), started_at: new Date(now - 60000),
        database_name: 'own_pg_w37' }];
    if (query.includes('devos_runtime_capabilities_v1'))
      return [{ value: { schema: 'own.pg.w37' } }];
    if (query === OPERATOR_OWN_PG_PROJECT_SQL)
      return [{ project_id: uuid(1), workspace_id: uuid(2), device_id: uuid(3),
        client_id: ownerId, admin_grant_epoch: state.epoch, total_tasks: 1,
        last_seq: 1, policy_generation: 1, observed_at: new Date() }];
    if (query === OPERATOR_OWN_PG_TASK_CLAIM_SQL)
      return [{ task_seq: 1, task_id: uuid(4), task_state: 'RUNNING', lease_generation: 5,
        lease_agent_id: 'agent-1', lease_agent_generation_epoch: state.epoch,
        lease_expires_at: new Date(now + 10000).toISOString(), claim_id: 101,
        claim_state: 'ACTIVE', claim_agent_id: 'agent-1', claim_generation: 5,
        claim_agent_generation: state.epoch, claim_workspace_id: uuid(2),
        claim_expires_at: new Date(now + 10000).toISOString() }];
    if (query === OPERATOR_OWN_PG_EVENT_SQL) {
      if (state.rollOwnerDuringSql) state.epoch += 1;
      return [{ seq: 1, event_type: 'TASK_PROGRESS', task_id: uuid(4),
        content: { secret: 'W37_PRIVATE_SQL_PAYLOAD' } }];
    }
    return [];
  } }) };
  return { sql, calls };
}
function binding(url, overrides = {}) {
  return { provider: 'LOCAL_POSTGRES', boot_state: 'READY',
    owner_binding_source: 'NATIVE_IN_PROCESS_OWNER', owner_id: ownerId,
    api_key: key, gateway_base_url: url, owner_epoch: 7,
    owner_generation: 21, owner_pid: 9319, owner_created_at: born,
    process_incarnation_id: 'native-incarnation-21', source_sha: 'a'.repeat(40),
    postgres_started_at: born, owner_observed_at: stamp(), ...overrides };
}
async function harness(stateOverrides = {}, readRunIdentity = null) {
  const state = { epoch: 7, restart: false, rollOwnerDuringSql: false, ...stateOverrides };
  const db = fakeDatabase(state);
  const api = await startDbApi({ apiKey: key, instanceId: ownerId, port: 0,
    sql: db.sql, operatorOwnerReadback: () => owner(state.epoch) });
  try {
    const gateway = await startOperatorReadOnlyGateway({ apiKey: key,
      ownerId, upstreamBaseUrl: api.address, readRunIdentity });
    return { state, db, api, gateway, async close() {
      await gateway.close(); await api.close();
    } };
  } catch (error) { await api.close(); throw error; }
}
const reader = (h, getTrustedBinding = () => binding(h.gateway.address)) =>
  createOperatorNativeContextReader({ getTrustedBinding });

test('W37 actual native reader -> authenticated Gateway -> fixed own-PG SQL; only projected context', async () => {
  const h = await harness();
  try {
    const value = await reader(h).readContext();
    assert.equal(value.schema, 'metaengine.operator.context.v1');
    assert.equal(value.planes.database.state, 'AVAILABLE');
    assert.equal(value.planes.fleet.state, 'AVAILABLE');
    assert.equal(value.run_id, null, 'no independent run adapter: no run identity');
    assert.equal(value.proof_identity, null);
    assert.equal(value.authority_effect, false);
    assert.equal(value.automatic_retry_allowed, false);
    assert.equal(value.remote_fallback_allowed, false);
    assert.ok(h.db.calls.some(x => x.query === OPERATOR_PG17_RESTART_ADMISSION_SQL));
    assert.ok(h.db.calls.some(x => x.query === OPERATOR_OWN_PG_PROJECT_SQL));
    assert.doesNotMatch(JSON.stringify(value), /W37_PRIVATE_SQL_PAYLOAD|api_key|password|postgres:\/\//);
    assert.notEqual(value.operational_state, 'HEALTHY');
  } finally { await h.close(); }
});

test('W37 Owner generation rollover between lease query and response discards positive fleet and cursor', async () => {
  const h = await harness({ rollOwnerDuringSql: true });
  try {
    const value = await reader(h).readContext();
    assert.equal(value.planes.fleet.state, 'UNKNOWN');
    assert.equal(value.planes.continuity.state, 'UNKNOWN');
    assert.equal(value.authority_effect, false);
    assert.equal(h.state.epoch, 8);
  } finally { await h.close(); }
});

test('W37 W25 postmaster restart before ledger readback fails closed through both HTTP hops', async () => {
  const h = await harness({ restart: true });
  try {
    const value = await reader(h).readContext();
    assert.equal(value.planes.fleet.state, 'UNKNOWN');
    assert.equal(value.planes.continuity.state, 'UNKNOWN');
    assert.notEqual(value.planes.database.state, 'AVAILABLE');
    assert.equal(h.db.calls.filter(x => x.query === OPERATOR_OWN_PG_PROJECT_SQL).length, 0);
  } finally { await h.close(); }
});

test('W37 native Owner PID/birth/epoch/SHA/PG incarnation drift during GET is UNKNOWN', async () => {
  const h = await harness();
  try {
    for (const patch of [
      { owner_generation: 22 }, { owner_pid: 9320 },
      { owner_created_at: new Date(Date.parse(born) + 1).toISOString() },
      { owner_epoch: 8 }, { source_sha: 'b'.repeat(40) },
      { postgres_started_at: new Date(Date.parse(born) + 1).toISOString() },
      { gateway_base_url: 'http://127.0.0.1:43119' },
      { api_key: 'z'.repeat(64) },
      { boot_state: 'UNKNOWN' },
    ]) {
      let n = 0;
      const value = await reader(h, () => binding(h.gateway.address, ++n === 1 ? {} : patch)).readContext();
      assert.equal(value.state, 'UNKNOWN', JSON.stringify(patch));
      assert.equal(value.authority_effect, false);
    }
    for (const patch of [{ owner_pid: null }, { owner_created_at: null },
      { process_incarnation_id: 'a' }, { source_sha: 'not-a-source-sha' },
      { owner_epoch: null }, { postgres_started_at: null }]) {
      const value = await reader(h, () => binding(h.gateway.address, patch)).readContext();
      assert.equal(value.state, 'UNKNOWN', JSON.stringify(patch));
    }
  } finally { await h.close(); }
});

test('W37 run epoch cannot launder an unrelated own-PG generation into native context', async () => {
  const h = await harness({}, async () => ({
    proven: true, source: 'OWN_POSTGRES_READBACK', owner_id: ownerId,
    project_id: 'project-alpha', run_id: 'run-alpha', owner_epoch: 8,
    event_seq: 1, observed_at: stamp(),
  }));
  try {
    const value = await reader(h).readContext();
    assert.equal(value.state, 'UNKNOWN');
    assert.equal(value.run_id, null);
    assert.equal(value.event_seq, null);
  } finally { await h.close(); }
});

test('W37 absent trusted native Owner, wrong key and no cloud fallback stay fail-closed', async () => {
  const h = await harness();
  try {
    let networkCalls = 0;
    const unavailable = createOperatorNativeContextReader({ fetchImpl: async () => {
      networkCalls++; throw new Error('forbidden-network');
    } });
    assert.equal((await unavailable.readContext()).state, 'UNKNOWN');
    assert.equal(networkCalls, 0);
    const invalid = await reader(h, () => binding(h.gateway.address, { api_key: 'z'.repeat(64) })).readContext();
    assert.equal(invalid.state, 'UNKNOWN');
    assert.equal(invalid.remote_fallback_allowed, false);
    assert.equal(invalid.cloud_database_dependency, false);
  } finally { await h.close(); }
});
