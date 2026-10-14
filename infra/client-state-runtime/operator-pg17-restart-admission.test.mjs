import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  OPERATOR_PG17_RESTART_ADMISSION_SQL as QUERY,
  admitOwnPg17LedgerReadback as admit,
} from './operator-pg17-restart-admission.mjs';

const NOW = Date.parse('2026-10-14T15:00:00Z');
const before = () => [{ started_at: new Date(NOW - 3600_000),
  observed_at: new Date(NOW - 1000), database_name: 'owned_postgres_17' }];
const after = (patch = {}) => ({ started_at: new Date(NOW - 3600_000),
  observed_at: new Date(NOW - 900), database_name: 'owned_postgres_17',
  server_version_num: 170006, transaction_isolation: 'repeatable read',
  transaction_read_only: 'on', readable_relations: 5, ...patch });
function fixture(rows, { error } = {}) {
  const calls = [];
  return { calls, tx: { async unsafe(sql, values) {
    calls.push({ sql, values });
    if (error) throw error;
    assert.equal(sql, QUERY);
    assert.equal(values, undefined);
    return rows;
  } } };
}
const read = (fake, options = {}) => admit({ tx: fake.tx, priorClockRows: before(), nowMs: NOW, ...options });

test('PG17 admission uses one SELECT, no SQL side effects or second provider', async () => {
  assert.match(QUERY.trimStart(), /^SELECT /);
  assert.match(QUERY, /pg_catalog\.pg_postmaster_start_time/);
  assert.match(QUERY, /pg_catalog\.current_setting\('transaction_read_only'\)/);
  assert.match(QUERY, /pg_catalog\.has_table_privilege/);
  assert.match(QUERY, /destruktion_meta\.project_event_h205f22/);
  assert.doesNotMatch(QUERY, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|COPY|EXECUTE|DO)\b/i);
  const fake = fixture([after()]);
  assert.deepEqual(await read(fake), { admitted: true, reason: 'ADMITTED', postmaster_same: true });
  assert.equal(fake.calls.length, 1);
  assert(Object.isFrozen(await read(fake)));
});

test('postmaster restart, same database name and changing server birth fail before lease SELECT', async () => {
  const fake = fixture([after({ started_at: new Date(NOW - 10_000) })]);
  assert.deepEqual(await read(fake), {
    admitted: false, reason: 'POSTMASTER_CHANGED', postmaster_same: false,
  });
  assert.equal(fake.calls.length, 1);
  const swap = fixture([after({ database_name: 'other_local_database' })]);
  assert.equal((await read(swap)).reason, 'POSTMASTER_CHANGED');
  assert.equal((await read(fixture([after({ started_at: new Date(NOW - 3600_000) })]))).admitted, true);
});

test('a fresh database socket is not proof of schema, role grants, PG version or transaction mode', async () => {
  const scenarios = [
    [after({ server_version_num: 160011 }), 'PG17_REQUIRED'],
    [after({ server_version_num: 180001 }), 'PG17_REQUIRED'],
    [after({ server_version_num: '170006' }), 'PG17_REQUIRED'],
    [after({ readable_relations: 4 }), 'LEDGER_SCHEMA_OR_GRANTS_INCOMPLETE'],
    [after({ readable_relations: 6 }), 'LEDGER_SCHEMA_OR_GRANTS_INCOMPLETE'],
    [after({ readable_relations: '5' }), 'LEDGER_SCHEMA_OR_GRANTS_INCOMPLETE'],
    [after({ transaction_isolation: 'read committed' }), 'READ_ONLY_SNAPSHOT_REQUIRED'],
    [after({ transaction_read_only: 'off' }), 'READ_ONLY_SNAPSHOT_REQUIRED'],
  ];
  for (const [candidate, reason] of scenarios) {
    const fake = fixture([candidate]);
    const result = await read(fake);
    assert.equal(result.admitted, false, reason);
    assert.equal(result.reason, reason);
    assert.equal(fake.calls.length, 1);
  }
});

test('invalid/stale/ambiguous or missing initial database identity never performs SQL', async () => {
  const sample = before()[0];
  for (const rows of [
    null, [], [sample, sample], [{ ...sample, database_name: '' }],
    [{ ...sample, observed_at: new Date(NOW - 31_000) }],
    [{ ...sample, observed_at: new Date(NOW + 10_000) }],
    [{ ...sample, started_at: new Date(NOW + 100) }],
    [{ ...sample, started_at: 'not-a-date' }],
  ]) {
    const fake = fixture([after()]);
    const result = await read(fake, { priorClockRows: rows });
    assert.equal(result.admitted, false);
    assert.equal(fake.calls.length, 0);
  }
});

test('unknown, skewed, duplicated, out-of-date and failed readback never become AVAILABLE', async () => {
  for (const candidate of [
    null, [], [after(), after()], [after({ observed_at: new Date(NOW + 10_000) })],
    [after({ observed_at: new Date(NOW - 40_000) })],
    [after({ started_at: 'bad timestamp' })],
    [after({ database_name: '' })],
    [after({ observed_at: new Date(NOW - 3_700_000) })],
  ]) {
    const fake = fixture(candidate);
    assert.equal((await read(fake)).admitted, false);
  }
  const denied = fixture(null, { error: new Error('postgres://user:SECRET@127.0.0.1/owned') });
  const result = await read(denied);
  assert.equal(result.admitted, false);
  assert.equal(result.reason, 'READBACK_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(result), /SECRET|postgres:\/\//);
});

test('source wiring preserves sole executor and never admits fleet before PG17 gate', async () => {
  const source = await readFile(new URL('./db-api.mjs', import.meta.url), 'utf8');
  const gate = source.indexOf('await admitOwnPg17LedgerReadback');
  const fleet = source.indexOf('return readOwnPostgresOperatorTruth({ tx, owner, nowMs })');
  assert(gate > 0 && fleet > gate);
  assert.match(source, /\{ readOnly: true \}/);
  assert.match(source, /postmasterChanged \? \[\] : clockRows/);
  assert.doesNotMatch(source.slice(gate, fleet), /\b(?:INSERT|UPDATE|DELETE|RETRY|spawn)\b/i);
});
