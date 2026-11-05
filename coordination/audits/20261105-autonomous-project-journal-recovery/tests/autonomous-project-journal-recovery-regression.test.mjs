import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createAutonomousProjectJournal } from '../src/autonomous-project-journal.mjs';
import { AutonomousProjectTaskRuntime } from '../src/autonomous-project-task-runtime.mjs';
import { createAutonomousProjectProviderFixture } from './fixtures/autonomous-project-provider.mjs';

const projectId = '11111111-1111-4111-8111-111111111111';
const rootLease = Object.freeze({ task_id: '22222222-2222-4222-8222-222222222222',
  parent_task_id: null, root_task_id: '22222222-2222-4222-8222-222222222222',
  agent_id: 'agent_root-fixture-001', claim_id: 10, lease_generation: 1,
  depth: 0, role: 'CODER', state: 'RUNNING' });
const flags = { authority_effect: false, scheduler_authority: false, second_scheduler_loop: false, automatic_retry_allowed: false };

async function fixture(t) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-journal-sqlite-recovery-')));
  const journalPath = path.join(directory, 'effects.sqlite');
  const provider = createAutonomousProjectProviderFixture({ filePath: path.join(directory, 'provider.sqlite'), projectId, rootTask: structuredClone(rootLease) });
  const journal = createAutonomousProjectJournal({ filePath: journalPath });
  const runtime = new AutonomousProjectTaskRuntime({ journal, request: input => provider.request(input),
    materializeProject: async () => ({ state: 'NOT_REQUIRED' }) });
  const otherResources = [];
  t.after(async () => {
    await runtime.close();
    for (const resource of otherResources.toReversed()) await resource.close();
    provider.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { directory, journal, journalPath, provider, runtime, own: r => (otherResources.push(r), r) };
}
const turnIntent = (overrides = {}) => ({ schema: 'metaengine.devos.project-conversation-turn.v1',
  project_id: projectId, task_id: rootLease.task_id, agent_id: rootLease.agent_id,
  lease_generation: 1, prompt_sha256: 'a'.repeat(64), transcript_floor: 80,
  delivery_history_complete: true, delivered_tool_results: [], unresolved_tool_effects: [],
  ...flags, ...overrides });
const turnKey = name => `turn:${rootLease.task_id}:1:${name}`;

for (const [name, overrides, checkpoint] of [
  ['legacy without complete delivery history', { delivery_history_complete: false, delivered_tool_results: undefined }, 'DURABLE_DELIVERY_CHECKPOINT_REQUIRED'],
  ['legacy without delivered result identities', { delivered_tool_results: undefined }, 'DURABLE_DELIVERY_CHECKPOINT_REQUIRED'],
  ['legacy with unknown tool effect', { unresolved_tool_effects: ['unknown-tool:001'] }, 'UNKNOWN_TOOL_EFFECT_REQUIRES_READBACK'],
  ['malformed delivered result identity', { delivered_tool_results: [{ request_id: 'known:001', result_sha256: 'not-a-hash' }] }, 'DURABLE_DELIVERY_CHECKPOINT_REQUIRED'],
]) {
  test(`confirmed local SQLite turn ${name} cannot grant a recovery tool window`, async t => {
    const f = await fixture(t);
    const intent = turnIntent(overrides);
    if (Object.hasOwn(overrides, 'delivered_tool_results') && overrides.delivered_tool_results === undefined) delete intent.delivered_tool_results;
    const key = turnKey('old-' + name.replaceAll(' ', '-'));
    await f.journal.begin(key, intent);
    await f.journal.confirm(key, { effect_state: 'PROVEN_COMPOSER_CLEARED', transcript_floor: 80, prompt_sha256: intent.prompt_sha256 });
    assert.equal((await f.journal.conversationCheckpoint(rootLease)).state, checkpoint);
    const saved = await f.journal.find(key);
    const recovering = f.own(createAutonomousProjectAuthedRuntime(f));
    assert.equal((await recovering.latestTurnForLease(rootLease)).state, 'AMBIGUOUS');
    assert.deepEqual(await f.journal.find(key), saved, 'recovery observation may not mutate immutable SQLite history');
  });
}

function createAutonomousProjectAuthedRuntime(f) {
  // Separate runtime object reproduces process-local replay state loss while
  // preserving the genuine on-disk SQLite journal and current SQL snapshot.
  return new AutonomousProjectTaskRuntime({ journal: {
    ...f.journal, close: async () => {} }, request: input => f.provider.request(input),
    materializeProject: async () => ({ state: 'NOT_REQUIRED' }) });
}

test('truncated SQLite journal fails closed without changing damaged bytes or replaying effects', async t => {
  const f = await fixture(t);
  await f.journal.begin('fixture:durable:001', { schema: 'fixture.sqlite-intent.v1', effect: 'NOT_SENT' });
  await f.runtime.close();
  const original = await fs.readFile(f.journalPath);
  assert.ok(original.length > 1024);
  await fs.truncate(f.journalPath, 1024);
  const truncated = await fs.readFile(f.journalPath);
  assert.notDeepEqual(truncated, original);
  assert.throws(() => createAutonomousProjectJournal({ filePath: f.journalPath }), /SQLITE|database|schema_invalid|file_invalid/i);
  assert.deepEqual(await fs.readFile(f.journalPath), truncated);
});

test('old JSONL WAL is not mistaken for a valid SQLite checkpoint and remains byte-for-byte untouched', async t => {
  const f = await fixture(t);
  const old = path.join(f.directory, 'legacy-effects.sqlite');
  const bytes = Buffer.from('{"effect":"candidate"}\n{"effect":"partial",');
  await fs.writeFile(old, bytes);
  assert.throws(() => createAutonomousProjectJournal({ filePath: old }), /SQLITE|database|schema_invalid|file_invalid/i);
  assert.deepEqual(await fs.readFile(old), bytes);
});

test('incomplete durable SQLite intent survives close/reopen with unknown receipt and no implicit retry', async t => {
  const f = await fixture(t);
  const key = turnKey('unknown-before-crash');
  await f.journal.begin(key, turnIntent({ transcript_floor: 100 }));
  await f.runtime.close();
  const reopened = f.own(createAutonomousProjectJournal({ filePath: f.journalPath }));
  assert.equal((await reopened.find(key)).receipt, null);
  assert.equal(await reopened.hasPendingConversationTurn(rootLease), true);
  assert.equal((await reopened.conversationCheckpoint(rootLease)).state, 'CONFIRMED_CONTINUATION_REQUIRED');
  const runtime = f.own(new AutonomousProjectTaskRuntime({ journal: { ...reopened, close: async () => {} },
    request: input => f.provider.request(input), materializeProject: async () => ({ state: 'NOT_REQUIRED' }) }));
  assert.equal((await runtime.latestTurnForLease(rootLease)).state, 'AMBIGUOUS');
});

test('SQLite capacity failure preserves existing intent and does not assert a receipt or grant effect authority', async t => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-journal-capacity-')));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'effects.sqlite');
  const journal = createAutonomousProjectJournal({ filePath, maxEntries: 1 });
  await journal.begin('fixture:capacity:001', { schema: 'fixture.capacity.v1', stage: 'PREPARED' });
  await assert.rejects(journal.begin('fixture:capacity:002', { schema: 'fixture.capacity.v1', stage: 'NEW' }), /capacity_exceeded/);
  assert.equal((await journal.find('fixture:capacity:001')).receipt, null);
  assert.equal(await journal.find('fixture:capacity:002'), null);
  await journal.close();
  const reopened = createAutonomousProjectJournal({ filePath });
  try {
    assert.equal((await reopened.find('fixture:capacity:001')).receipt, null);
    assert.equal(await reopened.find('fixture:capacity:002'), null);
  } finally { await reopened.close(); }
});

test('disposable SQLite SQLITE_FULL is atomic, not a substitute for real disk-ENOSPC qualification', async t => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-sqlite-full-')));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  const db = new DatabaseSync(path.join(directory, 'full.sqlite'));
  try {
    db.exec('PRAGMA page_size=512; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE example (id TEXT PRIMARY KEY, v BLOB) STRICT;');
    db.prepare('INSERT INTO example VALUES(?,?)').run('original', Buffer.from('SAFE'));
    const pages = db.prepare('PRAGMA page_count').get().page_count;
    assert.equal(db.prepare(`PRAGMA max_page_count=${pages}`).get().max_page_count, pages);
    assert.throws(() => {
      db.exec('BEGIN IMMEDIATE');
      try { db.prepare('INSERT INTO example VALUES(?,?)').run('candidate', Buffer.alloc(16384)); db.exec('COMMIT'); }
      catch (err) { if (db.isTransaction) db.exec('ROLLBACK'); throw err; }
    }, /full|SQLITE_FULL/i);
    assert.deepEqual(db.prepare('SELECT id FROM example ORDER BY id').all().map(row => row.id), ['original']);
  } finally { db.close(); }
});


test('transcript readback cannot authorize a physical send after the original parent claim changes during await', async t => {
  const f = await fixture(t);
  const results = [{ request_id: 'fixture:turn:after-observation', status: 'COMPLETED', summary: 'known result' }];
  let sends = 0;
  await assert.rejects(f.runtime.continueConversation(rootLease, results,
    async () => { sends++; return { effect_state: 'PROVEN_COMPOSER_CLEARED' }; },
    { observeTranscriptFloor: async () => {
      f.provider.update(state => { state.tasks[0].claim_id = rootLease.claim_id + 1; });
      return 120;
    } }), /parent_claim_drift|parent_lease_not_current|continuation_binding_drift/);
  assert.equal(sends, 0, 'observed transcript cannot override revoked parent authority');
  assert.equal(await f.journal.latestConversationTurn(rootLease), null,
    'revocation before write-ahead custody must not create a new physical-turn intent');
});

test('actual disposable SQLite journal SQLITE_FULL leaves prior records readable and propagates the original failure', async t => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-journal-sqlite-full-')));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'effects.sqlite');
  const journal = createAutonomousProjectJournal({ filePath, maxEntries: 2000 });
  let committed = 0;
  let error = null;
  const largeIntent = { schema: 'fixture.disposable-full-journal.v1', bytes: 'z'.repeat(61000) };
  try {
    for (let i = 0; i < 850; i++) {
      const key = `fixture:sqlite:full:${String(i).padStart(4, '0')}`;
      try { await journal.begin(key, { ...largeIntent, sequence: i }); committed++; }
      catch (failure) { error = failure; assert.equal(await journal.find(key), null, 'failed INSERT may not be confirmed'); break; }
    }
    assert.ok(committed > 1 && committed < 850, `expected real SQLite page cap, wrote ${committed} rows`);
    assert.match(error?.message || '', /database or disk is full|SQLITE_FULL/i,
      'caller must see original SQLITE_FULL, not a secondary ROLLBACK failure');
    const first = await journal.find('fixture:sqlite:full:0000');
    assert.equal(first?.intent.sequence, 0);
    assert.equal(first?.receipt, null);
  } finally { await journal.close(); }
  const reopened = createAutonomousProjectJournal({ filePath, maxEntries: 2000 });
  try {
    assert.equal((await reopened.find('fixture:sqlite:full:0000')).receipt, null);
    assert.equal((await reopened.find(`fixture:sqlite:full:${String(committed-1).padStart(4, '0')}`)).intent.sequence, committed-1);
    assert.equal(await reopened.find(`fixture:sqlite:full:${String(committed).padStart(4, '0')}`), null);
  } finally { await reopened.close(); }
});
