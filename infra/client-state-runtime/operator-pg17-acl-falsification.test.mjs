import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  auditOperatorPg17ReadOnlyAcl as audit, OPERATOR_PG17_REQUIRED_TABLES as names,
  OPERATOR_PG17_ROLE_SQL as ROLE, OPERATOR_PG17_TABLE_SQL as TABLES,
  OPERATOR_PG17_WIDE_WRITE_SQL as WIDE,
} from './operator-pg17-acl-falsification.mjs';

const goodRole = patch => ({
  database_name: 'fixture_pg17', server_version: 170007, isolation: 'repeatable read',
  read_only: 'on', login: 'fixture_observer', effective_role: 'fixture_observer',
  rolcanlogin: true, rolinherit: false, rolsuper: false, rolcreatedb: false,
  rolcreaterole: false, rolreplication: false, rolbypassrls: false,
  member_of_any_role: false, schema_usage: true, ...patch,
});
const goodTables = () => names.map(name => ({
  name, present: true, owns_relation: false, can_select: true,
  can_insert: false, can_update: false, can_delete: false,
  can_truncate: false, can_references: false, can_trigger: false,
}));
const wideGood = () => ({
  can_write_any_table: false, can_read_unapproved_table: false,
  can_advance_any_sequence: false,
});
function fake({ roles = [goodRole()], tables = goodTables(), wide = [wideGood()], errorAt, mutate } = {}) {
  const calls = [];
  let begins = 0;
  return { calls, get begins() { return begins; }, sql: { async begin(run) {
    begins++;
    const snapshot = { roles: structuredClone(roles), tables: structuredClone(tables), wide: structuredClone(wide) };
    return run({ async unsafe(query, args) {
      assert.equal(args, undefined, 'no dynamic SQL parameters or user-provided queries');
      calls.push(query);
      if (query === errorAt) throw Error('postgres://secret:password@hosted.invalid/database');
      if (query === ROLE) { mutate?.(); return snapshot.roles; }
      if (query === TABLES) return snapshot.tables;
      if (query === WIDE) return snapshot.wide;
      if (query.startsWith('SET TRANSACTION') || query.startsWith('SET LOCAL')) return [];
      throw Error('unexpected query');
    } });
  } } };
}
const check = (f, patch = {}) => audit({
  sql: f.sql, expectedDatabase: 'fixture_pg17', expectedLogin: 'fixture_observer', ...patch,
});

test('one repeatable-read READ ONLY transaction, three fixed catalog probes, no effects', async () => {
  const f = fake();
  const result = await check(f);
  assert.deepEqual(result, { schema: 'metaengine.operator.pg17-acl-falsification.v1',
    state: 'SOURCE_CONFORMANT', authority_effect: false, physical_pg17: 'UNVERIFIED' });
  assert.equal(f.begins, 1);
  assert.deepEqual(f.calls, [
    'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
    "SET LOCAL statement_timeout = '3s'",
    "SET LOCAL lock_timeout = '1s'", ROLE, TABLES, WIDE,
  ]);
  assert.equal((TABLES.match(/h205f22/g) || []).length, 5);
  assert(WIDE.includes('can_read_unapproved_table'));
  assert(WIDE.includes('has_sequence_privilege'));
  assert(!JSON.stringify(result).includes('secret'));
});

test('malicious or privileged identity rejects before opening any connection', async () => {
  for (const name of [null, '', 'postgres', 'service_role', 'a', 'UPPER', 'foo;DELETE FROM x', 'a'.repeat(100)]) {
    const f = fake();
    assert.equal((await check(f, { expectedLogin: name })).state, 'UNKNOWN');
    assert.equal(f.begins, 0);
  }
  const f = fake();
  assert.equal((await check(f, { expectedDatabase: 'fixture_pg17;DROP SCHEMA x' })).state, 'UNKNOWN');
  assert.equal(f.begins, 0);
});

test('database, version, transaction isolation, read-only and exact effective identity are fenced', async () => {
  for (const patch of [
    { server_version: 160016 }, { server_version: 180000 }, { server_version: null },
    { isolation: 'read committed' }, { read_only: 'off' },
    { database_name: 'wrong' }, { login: 'postgres' }, { effective_role: 'service_role' },
  ]) {
    const f = fake({ roles: [goodRole(patch)] });
    assert.equal((await check(f)).state, 'DENIED', JSON.stringify(patch));
    assert(!f.calls.includes(TABLES));
  }
});

test('no inheritance, membership, superuser, role DDL, replication or BYPASSRLS', async () => {
  for (const patch of [
    { rolcanlogin: false }, { rolinherit: true }, { rolsuper: true },
    { rolcreatedb: true }, { rolcreaterole: true }, { rolreplication: true },
    { rolbypassrls: true }, { member_of_any_role: true },
    { schema_usage: false }, { schema_usage: null },
  ]) assert.equal((await check(fake({ roles: [goodRole(patch)] }))).state, 'DENIED');
});

test('all five W2 tables: exact identity, SELECT, not owner, no DML or TRIGGER/REFERENCES', async () => {
  for (const patch of [
    { present: false }, { owns_relation: true }, { can_select: false },
    { can_select: null }, { can_insert: true }, { can_update: true },
    { can_delete: true }, { can_truncate: true }, { can_references: true },
    { can_trigger: true },
  ]) {
    const tables = goodTables(); tables[2] = { ...tables[2], ...patch };
    assert.equal((await check(fake({ tables }))).state, 'DENIED', JSON.stringify(patch));
  }
  assert.equal((await check(fake({ tables: goodTables().slice(1) }))).state, 'UNKNOWN');
  assert.equal((await check(fake({ tables: [goodTables()[0], ...goodTables().slice(0, -1)] }))).state, 'DENIED');
  assert.equal((await check(fake({ tables: [...goodTables().slice(0, -1), { ...goodTables()[4], name: 'rogue' }] }))).state, 'DENIED');
});

test('unrelated private-table SELECT, other-table writes, and sequence writes reject ACL', async () => {
  for (const patch of [
    { can_read_unapproved_table: true }, { can_write_any_table: true },
    { can_advance_any_sequence: true }, { can_write_any_table: null },
  ]) assert.equal((await check(fake({ wide: [{ ...wideGood(), ...patch }] }))).state, 'DENIED');
});

test('missing, duplicate, malformed catalog or SQL error -> UNKNOWN with no secret or fallback', async () => {
  for (const f of [
    fake({ roles: [] }), fake({ roles: [goodRole(), goodRole()] }),
    fake({ tables: null }), fake({ wide: [] }), fake({ wide: [wideGood(), wideGood()] }),
    fake({ errorAt: ROLE }), fake({ errorAt: TABLES }), fake({ errorAt: WIDE }),
  ]) {
    const result = await check(f);
    assert.equal(result.state, 'UNKNOWN');
    assert.equal(result.authority_effect, false);
    assert.equal(result.physical_pg17, 'UNVERIFIED');
    assert(!JSON.stringify(result).includes('password'));
    assert(!JSON.stringify(result).includes('hosted'));
  }
  for (const sql of [null, undefined, {}, { begin: 42 }]) {
    assert.equal((await audit({ sql, expectedDatabase: 'fixture_pg17',
      expectedLogin: 'fixture_observer' })).state, 'UNKNOWN');
  }
});

test('adversarial concurrent mutation is contained in one hermetic snapshot (not physical proof)', async () => {
  const tables = goodTables();
  const f = fake({ tables, mutate: () => { tables[0].can_insert = true; } });
  assert.equal((await check(f)).state, 'SOURCE_CONFORMANT');
  assert.equal(tables[0].can_insert, true);
  assert.equal(f.begins, 1);
});

test('existing W2 HTTP reducer: source-backed one READ ONLY transaction and no hosted route', async () => {
  const [http, ledger, ledgerTests] = await Promise.all([
    readFile(new URL('./db-api.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./operator-own-pg-fleet-truth.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./operator-own-pg-fleet-truth.test.mjs', import.meta.url), 'utf8'),
  ]);
  for (const line of [
    "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    'readOwnPostgresOperatorTruth({ tx, owner, nowMs })', '{ readOnly: true }',
    'qualifyOperatorOwner(owner, nowMs)', 'catch { ledger = null; }',
    "if (host !== '127.0.0.1')",
  ]) assert(http.includes(line), 'missing source fence: ' + line);
  for (const line of [
    'OPERATOR_OWN_PG_PROJECT_SQL', 'OPERATOR_OWN_PG_TASK_CLAIM_SQL',
    'OPERATOR_OWN_PG_EVENT_SQL', 'LIMIT 65', 'active.length > 1', 'nextSeq + 1',
  ]) assert(ledger.includes(line), 'missing ledger fence: ' + line);
  assert(ledgerTests.includes('duplicate active claims'));
  assert(ledgerTests.includes('event cursor respects trusted after_seq'));
  for (const source of [http, ledger]) {
    assert(!source.includes('https://provider.supabase.co'));
    assert(!source.includes('https://functions.supabase.co'));
  }
});

test('W2 active-lease conflict, cursor rollback and owner epoch mismatch fail closed despite ACL success', async () => {
  const {
    readOwnPostgresOperatorTruth: read, OPERATOR_OWN_PG_PROJECT_SQL: PROJECT,
    OPERATOR_OWN_PG_TASK_CLAIM_SQL: CLAIM, OPERATOR_OWN_PG_EVENT_SQL: EVENT,
  } = await import('./operator-own-pg-fleet-truth.mjs');
  const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const nowMs = Date.parse('2026-10-14T12:00:00Z');
  const iso = offset => new Date(nowMs + offset).toISOString();
  const owner = {
    schema: 'metaengine.operator.trusted-owner.v1', source: 'TRUSTED_OWNER_READBACK',
    verified: true, project_id: id(1), workspace_id: id(2), device_id: id(3),
    owner_id: 'w12_owner', client_id: 'w12_owner', admin_grant_epoch: 4,
    owner_generation: 12, process_incarnation: 'w12_owner_12',
    observed_at: iso(-100), heartbeat_at: iso(-100), event_after_seq: 0,
  };
  const project = { project_id: id(1), workspace_id: id(2), device_id: id(3),
    client_id: 'w12_owner', admin_grant_epoch: 4,
    total_tasks: 1, last_seq: 2, policy_generation: 1, observed_at: iso(-50) };
  const task = { task_seq: 1, task_id: id(4), task_state: 'RUNNING',
    lease_generation: 2, lease_agent_id: 'agent1', lease_agent_generation_epoch: 1,
    lease_expires_at: iso(20000), claim_id: 10, claim_state: 'ACTIVE',
    claim_agent_id: 'agent1', claim_generation: 2, claim_agent_generation: 1,
    claim_expires_at: iso(20000), claim_workspace_id: id(2) };
  const db = (rows, p = project) => ({ async unsafe(query) {
    if (query === PROJECT) return [p];
    if (query === CLAIM) return rows;
    if (query === EVENT) return [1, 2].map(seq => ({ seq, event_type: 'TASK_PROGRESS', task_id: id(4) }));
    throw Error('unexpected query');
  } });
  assert.equal((await check(fake())).state, 'SOURCE_CONFORMANT');
  const conflict = await read({ tx: db([task, { ...task, claim_id: 11 }]), owner, nowMs });
  assert.equal(conflict.fleet.state, 'AMBIGUOUS');
  assert.notEqual(conflict.continuity.state, 'AVAILABLE');
  const rollback = await read({ tx: db([task]), owner: { ...owner, event_after_seq: 3 }, nowMs });
  assert.equal(rollback.fleet, null);
  assert.equal(rollback.continuity, null);
  const epoch = await read({ tx: db([task], { ...project, admin_grant_epoch: 5 }), owner, nowMs });
  assert.equal(epoch.fleet, null);
});
