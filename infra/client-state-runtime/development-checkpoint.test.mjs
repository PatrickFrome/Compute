import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildDevelopmentCheckpoint,
  runDevelopmentCheckpointCli,
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
function fakeSql({ inserted = true, row, onCall, transformReadback = value => value } = {}) {
  const calls = [];
  const { canonical_payload_sha256, ...stored } = row || checkpoint();
  const pgJson = JSON.stringify(stored.payload, null, 1);
  const actual = { ...stored, payload_json: pgJson, payload_sha256: sha(pgJson) };
  const tx = { unsafe: async (query, values) => {
    calls.push({ query, values });
    if (query.startsWith('INSERT')) return inserted ? [{ checkpoint_id: actual.checkpoint_id }] : [];
    if (query.startsWith('SELECT')) return transformReadback([structuredClone(actual)]);
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
  assert.equal(value.canonical_payload_sha256, sha(canonical(value.payload)));
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
  assert.equal(insert.query.includes('payload_sha256'), false);
  assert.equal(insert.values.length, 8);
  assert.equal(first.canonical_payload_sha256, value.canonical_payload_sha256);
  assert.notEqual(first.payload_sha256, first.canonical_payload_sha256);
  const replaySql = fakeSql({ inserted: false, row: value });
  const replay = await writeDevelopmentCheckpoint({ sql: replaySql, checkpoint: value });
  assert.equal(replay.state, 'ALREADY_PRESENT');
});

test('canonical hashes ignore object key order and set ordering but bind material changes', () => {
  const left = payload({
    summaries: [{ code: 'SOURCE_AUDIT', status: 'VERIFIED' }, { code: 'CLIENT_UI', status: 'PARTIAL' }],
    github_urls: ['https://github.com/PatrickFrome/Compute/pull/1175', 'https://github.com/PatrickFrome/Compute/actions/runs/123/job/456'],
  });
  const right = { github_urls: [...left.github_urls].reverse(), tests: left.tests.map(row => Object.fromEntries(Object.entries(row).reverse())),
    summaries: [...left.summaries].reverse().map(row => ({ status: row.status, code: row.code })), source_sha: left.source_sha };
  assert.deepEqual(checkpoint({ payload: left }), checkpoint({ payload: right }));
  assert.notEqual(checkpoint({ payload: left }).checkpoint_id, checkpoint({ payload: { ...left, source_sha: 'b'.repeat(40) } }).checkpoint_id);
  assert.notEqual(checkpoint().checkpoint_id, checkpoint({ evidence_state: 'PARTIAL' }).checkpoint_id);
  assert.ok(Object.isFrozen(checkpoint().payload.tests[0]));
});

test('free text, credentials, authority flags, malformed counters and duplicate evidence never reach SQL', async () => {
  for (const mutation of [
    input => { input.payload.summary = 'token=private'; },
    input => { input.payload.summaries[0].code = 'ghp_private'; },
    input => { input.payload.summaries[0].detail = 'private'; },
    input => { input.payload.tests[0].suite = 'password'; },
    input => { input.payload.tests[0].total = '3'; },
    input => { input.payload.tests[0].passed = NaN; },
    input => { input.payload.tests[0].skipped = -1; },
    input => { input.payload.summaries.push({ ...input.payload.summaries[0] }); },
    input => { input.payload.github_urls.push(input.payload.github_urls[0]); },
    input => { input.payload.github_urls = ['https://github.com/PatrickFrome/Compute/pull/1?token=private']; },
    input => { input.payload.github_urls = ['https://user:private@github.com/PatrickFrome/Compute/pull/1']; },
    input => { input.canonical_checkpoint = true; },
    input => { input.payload.authority_effect = false; },
    input => { input.source_parent_sha = 'A'.repeat(40); },
  ]) {
    const input = { source_parent_sha: source, evidence_state: 'EVIDENCE_READY', payload: payload() };
    mutation(input);
    assert.throws(() => buildDevelopmentCheckpoint(input), /^Error: development_checkpoint_[a-z_]+$/);
  }
  let began = false;
  await assert.rejects(() => writeDevelopmentCheckpoint({
    sql: { begin() { began = true; } }, checkpoint: { ...checkpoint(), authority_effect: true },
  }), /checkpoint_mismatch/);
  assert.equal(began, false);
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

test('PostgreSQL generated digest and JSON readback must independently match before commit', async () => {
  for (const [transformReadback, reason] of [
    [rows => [{ ...rows[0], payload_sha256: '0'.repeat(64) }], 'readback_digest_mismatch'],
    [rows => [{ ...rows[0], payload_json: '{}', payload_sha256: sha('{}') }], 'readback_json_mismatch'],
    [rows => [{ ...rows[0], payload_json: '{', payload_sha256: sha('{') }], 'readback_json_invalid'],
    [() => [], 'readback_missing'],
  ]) {
    let state;
    const sql = fakeSql({ transformReadback, onCall: next => { state = next; } });
    await assert.rejects(() => writeDevelopmentCheckpoint({ sql, checkpoint: checkpoint() }), new RegExp(reason));
    assert.equal(state, 'rollback');
  }
});

test('CLI validates bounded public JSON before importing a driver or connecting and errors contain no input', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'checkpoint-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'input.json');
  await writeFile(input, '{"private":"synthetic-secret",broken');
  await assert.rejects(() => runDevelopmentCheckpointCli({ args: ['--input', input],
    env: { LOCAL_STATE_ADMIN_DATABASE_URL: 'postgres://user:synthetic-secret@127.0.0.1:1/postgres' } }),
  error => error.message === 'development_checkpoint_cli_failed');
  await writeFile(input, JSON.stringify({ source_parent_sha: source, evidence_state: 'PARTIAL', payload: { ...payload(), secret: 'synthetic-secret' } }));
  await assert.rejects(() => runDevelopmentCheckpointCli({ args: ['--input', input],
    env: { LOCAL_STATE_ADMIN_DATABASE_URL: 'postgres://user:synthetic-secret@127.0.0.1:1/postgres' } }),
  error => error.message === 'development_checkpoint_fields_invalid');
});

test('database URL accepts loopback postgres only', () => {
  assert.equal(validateCheckpointDatabaseUrl('postgres://admin:secret@127.0.0.1:5432/meta'), 'postgres://admin:secret@127.0.0.1:5432/meta');
  assert.throws(() => validateCheckpointDatabaseUrl('postgres://db.example.com/meta'), /loopback_database_required/);
  assert.throws(() => validateCheckpointDatabaseUrl('postgres://127.0.0.1/meta?sslmode=require'), /loopback_database_required/);
  assert.throws(() => validateCheckpointDatabaseUrl('https://127.0.0.1/meta'), /loopback_database_required/);
});
