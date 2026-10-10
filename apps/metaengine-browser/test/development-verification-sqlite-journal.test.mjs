import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createDevelopmentVerificationSqliteJournal, verificationDigest } from '../src/development-verification-sqlite-journal.mjs';

async function fixture(t, limits = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verification-journal-'));
  const filePath = path.join(root, 'journal.sqlite');
  const journals = [];
  const open = () => { const journal = createDevelopmentVerificationSqliteJournal({ filePath, ...limits }); journals.push(journal); return journal; };
  t.after(async () => { journals.forEach(journal => journal.close()); await fs.rm(root, { recursive: true, force: true }); });
  return { root, filePath, open };
}
function intent(snapshotRoot, key = 'verification-test-1') {
  const bindingDigest = verificationDigest('binding');
  const runId = `verification_${verificationDigest({ idempotency_key: key, binding_digest: bindingDigest }).slice(7)}`;
  return { schema: 'metaengine.development-verification.journal-event.v1', run_id: runId, sequence: 1,
    idempotency_key: key, binding_digest: bindingDigest, kind: 'INTENT', at: '2026-10-09T10:00:00.000Z',
    data: { owner_pid: process.pid, owner_token: 'a'.repeat(32), session_key: `verify_${runId.slice(13)}`,
      candidate_id: `candidate_sha256_${'b'.repeat(64)}`, source_head: 'c'.repeat(40),
      executor_id: 'fixture', executor_configuration_digest: verificationDigest('fixture'), snapshot_root: snapshotRoot, step_ids: ['BUILD', 'TEST'] } };
}
function next(prior, kind, data) { return { ...prior, sequence: prior.sequence + 1, kind, data }; }
function terminal(first, state = 'AMBIGUOUS') {
  const core = { schema: 'metaengine.development-verification.receipt.v1', run_id: first.run_id,
    candidate_id: first.data.candidate_id, source_head: first.data.source_head, binding_digest: first.binding_digest,
    executor_id: first.data.executor_id, executor_configuration_digest: first.data.executor_configuration_digest,
    state, reason: state === 'PASSED' ? null : 'fixture_interrupted', input_manifest_digest: null, output_manifest_digest: null,
    steps: [], pending_step_id: null, teardown: null, started_at: first.at, completed_at: first.at,
    evidence_origin: 'HOST_OBSERVED_TRUSTED_EXECUTOR', isolation_qualification: 'NOT_ESTABLISHED_BY_THIS_RECEIPT',
    automatic_retry_allowed: false, promotion_authorized: false, authority_effect: false };
  return next(first, 'TERMINAL', { receipt: { ...core, receipt_digest: verificationDigest(core) } });
}

test('FULL committed intent survives close/reopen and terminal is immutable', async t => {
  const f = await fixture(t);
  const first = intent(f.root);
  const journal = f.open();
  journal.append(first);
  journal.close();
  const restored = f.open();
  assert.deepEqual(restored.find(first.idempotency_key), [first]);
  restored.append(terminal(first));
  assert.deepEqual(restored.unfinished(), []);
  assert.throws(() => restored.append(next(terminal(first), 'TERMINAL', terminal(first).data)), /append_failed/);
  const db = new DatabaseSync(f.filePath);
  try {
    assert.throws(() => db.exec("UPDATE verification_events SET payload='{}'"), /immutable/);
    assert.throws(() => db.exec('DELETE FROM verification_events'), /immutable/);
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
  } finally { db.close(); }
});

test('independent database handles cannot reserve the same key or run twice', async t => {
  const f = await fixture(t);
  const one = f.open();
  const two = f.open();
  const first = intent(f.root);
  one.append(first);
  assert.throws(() => two.append(first), /append_failed/);
  const other = intent(f.root, 'verification-test-2');
  assert.throws(() => two.append({ ...other, idempotency_key: first.idempotency_key }), /append_failed/);
  assert.deepEqual(one.find(first.idempotency_key), [first]);
});

test('step sequence and computed pass evidence are checked before append', async t => {
  const f = await fixture(t);
  const journal = f.open();
  const first = intent(f.root);
  journal.append(first);
  assert.throws(() => journal.append(next(first, 'STEP_INTENT', { step_id: 'BUILD' })), /append_failed/);
  const session = next(first, 'SESSION', { session_id: 'session-1' });
  journal.append(session);
  assert.throws(() => journal.append(next(session, 'STEP_INTENT', { step_id: 'TEST' })), /append_failed/);
  const pending = next(session, 'STEP_INTENT', { step_id: 'BUILD' });
  journal.append(pending);
  assert.throws(() => journal.append(next(pending, 'STEP_RESULT', { step_id: 'BUILD', exit_code: 1, timed_out: false,
    output_limit_exceeded: false, passed: true, stdout_bytes: 0, stdout_digest: verificationDigest(''), stderr_bytes: 0, stderr_digest: verificationDigest('') })), /append_failed/);
  assert.equal(journal.read(first.run_id).length, 3);
});

test('self-consistent passing digest without actual step results or teardown is rejected', async t => {
  const f = await fixture(t);
  const journal = f.open();
  const first = intent(f.root);
  journal.append(first);
  assert.throws(() => journal.append(terminal(first, 'PASSED')), /append_failed/);
  assert.deepEqual(journal.read(first.run_id), [first]);
});

test('capacity exhaustion and drift leave already committed intent intact', async t => {
  const f = await fixture(t, { maxRuns: 1 });
  const journal = f.open();
  const first = intent(f.root);
  journal.append(first);
  assert.throws(() => journal.append(intent(f.root, 'verification-test-2')), /append_failed/);
  assert.throws(() => journal.append(next(first, 'SESSION', { session_id: '../wrong/session' })), /append_failed/);
  assert.deepEqual(journal.find(first.idempotency_key), [first]);
});

test('foreign SQLite WAL database is refused without mutating its data or mode', async t => {
  const f = await fixture(t);
  const foreign = new DatabaseSync(f.filePath);
  try {
    foreign.exec("PRAGMA journal_mode=WAL; CREATE TABLE foreign_data(value TEXT); INSERT INTO foreign_data VALUES ('preserve')");
    const before = await fs.readFile(f.filePath);
    assert.throws(() => f.open(), /open_failed/);
    assert.deepEqual(await fs.readFile(f.filePath), before);
    assert.equal(foreign.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    assert.equal(foreign.prepare('SELECT value FROM foreign_data').get().value, 'preserve');
  } finally { foreign.close(); }
});

test('tampered schema, truncated database and nonregular journal paths fail closed', async t => {
  const f = await fixture(t);
  const journal = f.open();
  journal.append(intent(f.root));
  journal.close();
  const database = new DatabaseSync(f.filePath);
  database.exec('DROP TRIGGER verification_no_update');
  database.close();
  assert.throws(() => f.open(), /open_failed/);
  await fs.writeFile(f.filePath, Buffer.from('SQLite format 3\0truncated'));
  assert.throws(() => f.open(), /open_failed/);
  await fs.rm(f.filePath);
  await fs.mkdir(f.filePath);
  assert.throws(() => f.open(), /open_failed/);
});
