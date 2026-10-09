import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  buildDevelopmentCheckpoint,
  validateCheckpointDatabaseUrl,
  writeDevelopmentCheckpoint,
} from './development-checkpoint.mjs';

const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
const source = 'a'.repeat(40);
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
function payload(overrides = {}) {
  return {
    source_sha: source,
    summaries: [{ code: 'SOURCE_AUDIT', status: 'VERIFIED' }],
    tests: [{ suite: 'CHECKPOINT', total: 3, passed: 3, failed: 0, skipped: 0 }],
    github_urls: ['https://github.com/PatrickFrome/Compute/commit/' + 'b'.repeat(40)],
    ...overrides,
  };
}
function checkpoint(overrides = {}) {
  return buildDevelopmentCheckpoint({ source_parent_sha: source, evidence_state: 'EVIDENCE_READY', payload: payload(), ...overrides });
}
function fakeSql({ inserted = true, row, onCall } = {}) {
  const calls = [];
  const actual = row || checkpoint();
  const tx = { unsafe: async (query, values) => {
    calls.push({ query, values });
    if (query.startsWith('INSERT')) return inserted ? [{ checkpoint_id: actual.checkpoint_id }] : [];
    if (query.startsWith('SELECT')) return [structuredClone(actual)];
    return [];
  } };
  return { calls, async begin(...args) {
    const callback = args.at(-1);
    try { const result = await callback(tx); onCall?.('commit'); return result; }
    catch (error) { onCall?.('rollback'); throw error; }
  } };
}

test('checkpoint payload is typed, sorted and hashed from canonical JSON', () => {
  const value = checkpoint({ payload: payload({
    summaries: [{ code: 'DATABASE_AUDIT', status: 'PARTIAL' }, { code: 'SOURCE_AUDIT', status: 'VERIFIED' }],
    tests: [{ suite: 'CHECKPOINT', total: 3, passed: 2, failed: 0, skipped: 1 }],
  }) });
  assert.equal(value.project_ref, 'jhriwwsryeqsvvvufkok');
  assert.equal(value.scope, 'OPERATIONAL_AUDIT_ONLY');
  assert.equal(value.canonical_checkpoint, false);
  assert.equal(value.authority_effect, false);
  assert.deepEqual(value.payload.summaries.map(row => row.code), ['DATABASE_AUDIT', 'SOURCE_AUDIT']);
  assert.equal(value.payload_sha256, sha(canonical(value.payload)));
  assert.match(value.checkpoint_id, /^[a-f0-9]{64}$/);
  assert.throws(() => buildDevelopmentCheckpoint({ source_parent_sha: source, evidence_state: 'EVIDENCE_READY', payload: payload({ github_urls: ['https://example.com/secret'] }) }), /github_url_invalid/);
  assert.throws(() => buildDevelopmentCheckpoint({ source_parent_sha: source, evidence_state: 'EVIDENCE_READY', payload: payload({ tests: [{ suite: 'CHECKPOINT', total: 1, passed: 1, failed: 1, skipped: 0 }] }) }), /test_count_mismatch/);
});

test('append-only writer inserts once and exact readback is idempotent', async () => {
  const value = checkpoint();
  let state;
  const sql = fakeSql({ row: value, onCall: next => { state = next; } });
  const first = await writeDevelopmentCheckpoint({ sql, checkpoint: value });
  assert.equal(first.state, 'INSERTED');
  assert.equal(state, 'commit');
  const insert = sql.calls.find(row => row.query.startsWith('INSERT'));
  assert.match(insert.query, /ON CONFLICT \(checkpoint_id\) DO NOTHING/);
  assert.equal(insert.query.includes('UPDATE'), false);
  const replaySql = fakeSql({ inserted: false, row: value });
  const replay = await writeDevelopmentCheckpoint({ sql: replaySql, checkpoint: value });
  assert.equal(replay.state, 'ALREADY_PRESENT');
});

test('same checkpoint id with changed immutable payload is rejected', async () => {
  const value = checkpoint({ checkpoint_id: 'c'.repeat(64) });
  const changed = checkpoint({ checkpoint_id: value.checkpoint_id, payload: payload({ summaries: [{ code: 'DATABASE_AUDIT', status: 'FAILED' }] }) });
  const sql = fakeSql({ inserted: false, row: value });
  await assert.rejects(() => writeDevelopmentCheckpoint({ sql, checkpoint: changed }), /development_checkpoint_id_conflict/);
});

test('insert readback mismatch rolls back and does not leak database error details', async () => {
  const value = checkpoint();
  let state;
  const mismatch = { ...value, source_parent_sha: 'd'.repeat(40) };
  const sql = fakeSql({ row: mismatch, onCall: next => { state = next; } });
  await assert.rejects(() => writeDevelopmentCheckpoint({ sql, checkpoint: value }), /development_checkpoint_readback_mismatch/);
  assert.equal(state, 'rollback');
});

test('unexpected SQL failure is sanitized and transaction is rolled back', async () => {
  let state;
  const sql = { async begin(...args) {
    try { await args.at(-1)({ unsafe: async () => { throw new Error('postgres password=secret host=private'); } }); }
    catch (error) { state = 'rollback'; throw error; }
  } };
  await assert.rejects(() => writeDevelopmentCheckpoint({ sql, checkpoint: checkpoint() }), /development_checkpoint_transaction_failed/);
  assert.equal(state, 'rollback');
});

test('database URL accepts loopback postgres only', () => {
  assert.equal(validateCheckpointDatabaseUrl('postgres://admin:secret@127.0.0.1:5432/meta'), 'postgres://admin:secret@127.0.0.1:5432/meta');
  assert.throws(() => validateCheckpointDatabaseUrl('postgres://db.example.com/meta'), /loopback_database_required/);
  assert.throws(() => validateCheckpointDatabaseUrl('postgres://127.0.0.1/meta?sslmode=require'), /loopback_database_required/);
  assert.throws(() => validateCheckpointDatabaseUrl('https://127.0.0.1/meta'), /loopback_database_required/);
});
