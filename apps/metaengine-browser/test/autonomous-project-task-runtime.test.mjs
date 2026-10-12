import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { AutonomousProjectTaskRuntime } from '../src/autonomous-project-task-runtime.mjs';
import { createAutonomousProjectJournal } from '../src/autonomous-project-journal.mjs';
import { createAutonomousProjectProviderFixture } from './fixtures/autonomous-project-provider.mjs';

const projectId = '11111111-1111-4111-8111-111111111111';
const rootTask = () => ({ task_id: '22222222-2222-4222-8222-222222222222', parent_task_id: null,
  root_task_id: '22222222-2222-4222-8222-222222222222', agent_id: 'agent_root-fixture-001',
  claim_id: 10, lease_generation: 1, depth: 0, role: 'CODER', state: 'RUNNING' });
const spawnRequest = (request_id = 'fixture:spawn:one') => ({ request_id, action: 'PROJECT_SPAWN',
  payload: { children: [{ objective: 'Implement one useful child task with independent evidence', role: 'CODER' }] } });
async function fixture(t, options = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-autonomous-project-')));
  const journalPath = path.join(root, 'effects.sqlite'), providerPath = path.join(root, 'provider.sqlite');
  const provider = createAutonomousProjectProviderFixture({ filePath: providerPath, projectId, rootTask: rootTask(), ...options });
  const journal = createAutonomousProjectJournal({ filePath: journalPath });
  const runtime = new AutonomousProjectTaskRuntime({ journal, request: input => provider.request(input), materializeProject: async () => ({ state: 'PROVEN' }) });
  t.after(async () => { await runtime.close(); provider.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, journalPath, providerPath, provider, journal, runtime };
}

test('recursive root/child/grandchild admission shares committed history while external ChatGPT creation remains unclaimed', async t => {
  const f = await fixture(t);
  assert.equal((await f.runtime.prepareLease(rootTask())).project_id, projectId);
  assert.match(f.runtime.contextForLease(rootTask()), /PROJECT_HISTORY/);
  await f.runtime.serveToolRequests({ lease: rootTask(), requests: [spawnRequest()] });
  const child = f.provider.read().tasks[1];
  await f.runtime.prepareLease(child);
  await f.runtime.serveToolRequests({ lease: child, requests: [spawnRequest('fixture:spawn:grandchild')] });
  const grandchild = f.provider.read().tasks[2];
  assert.equal(grandchild.depth, 2); assert.equal(grandchild.parent_task_id, child.task_id);
  const history = await f.runtime.serveToolRequests({ lease: grandchild,
    requests: [{ request_id: 'fixture:history:one', action: 'PROJECT_HISTORY', payload: { after_seq: 0, limit: 16 } }] });
  const readback = JSON.parse(history[0].summary);
  assert.deepEqual(readback.entries.map(row => row.seq), [1, 2]);
  assert.equal(readback.cursor.commit_ordered, true);
  assert.equal(f.provider.read().physical_provider_creations, 0);
  assert.equal(f.runtime.snapshot().physical_provider_creation_claimed, false);
  assert.equal((await f.runtime.waitForChildren(rootTask())).waiting, true);
  f.provider.update(state => { state.tasks[1].state = 'FAILED'; });
  assert.equal((await f.runtime.waitForChildren(rootTask())).failed, true);
});

for (const [role, state] of [['CODER', 'FAILED'], ['CRITIC', 'BLOCKED'], ['CRITIC', 'AMBIGUOUS'], ['CODER', 'FENCED']]) {
  test(`blocking ${role} child ${state} takes priority over open children and pending proposals`, async t => {
    const f = await fixture(t);
    await f.runtime.serveToolRequests({ lease: rootTask(), requests: [{ ...spawnRequest(), payload: { children: [
      { objective: 'Produce or independently verify one child result', role },
      { objective: 'Unfinished sibling work', role: 'CODER' },
    ] } }] });
    f.provider.update(value => {
      value.tasks[1].state = state;
      // Match the PostgreSQL projection: every non-COMPLETED child remains
      // open, including a failed/rejected verifier, alongside queued work.
      value.tasks[0].open_children = 2;
      value.tasks[0].blocking_children = 1;
      value.tasks[0].pending_proposals = 1;
    });
    const before = f.provider.read();
    const result = await f.runtime.waitForChildren(rootTask());
    assert.equal(result.failed, true);
    assert.equal(result.waiting, false, 'the parent must reach its existing BLOCKED path instead of waiting indefinitely');
    assert.deepEqual(result.children, before.tasks.slice(1).map(child => ({ task_id: child.task_id, state: child.state, role: child.role })));
    assert.equal(result.authority_effect, false);
    assert.equal(result.automatic_retry_allowed, false);
    assert.deepEqual(f.provider.read(), before, 'readback must not repair, replay or promote a failed/unknown child');
  });
}

for (const signal of ['blocking_children', 'selected_task_children_failed']) {
  test(`blocking aggregate ${signal} takes priority when failed children are outside the resident page`, async t => {
    const f = await fixture(t);
    f.provider.update(value => {
      value.tasks[0].open_children = 2;
      value.tasks[0].pending_proposals = 1;
      if (signal === 'blocking_children') value.tasks[0].blocking_children = 1;
      else value.selected_task_children_failed = true;
    });
    const before = f.provider.read();
    const result = await f.runtime.waitForChildren(rootTask());
    assert.equal(result.failed, true);
    assert.equal(result.waiting, false);
    assert.deepEqual(result.children, []);
    assert.deepEqual(f.provider.read(), before);
  });
}

test('open and queued children without a blocking result still make the parent wait', async t => {
  const f = await fixture(t);
  f.provider.update(value => { value.tasks[0].open_children = 2; value.tasks[0].pending_proposals = 1; });
  const result = await f.runtime.waitForChildren(rootTask());
  assert.equal(result.failed, false);
  assert.equal(result.waiting, true);
});

test('a rejected verifier in the visible child page blocks even without aggregate counters', async t => {
  const f = await fixture(t);
  await f.runtime.serveToolRequests({ lease: rootTask(), requests: [{ ...spawnRequest(),
    payload: { children: [{ objective: 'Independently verify the proposed result', role: 'CRITIC' }] } }] });
  f.provider.update(value => { value.tasks[1].state = 'BLOCKED'; });
  const before = f.provider.read();
  const result = await f.runtime.waitForChildren(rootTask());
  assert.equal(result.failed, true);
  assert.equal(result.waiting, false);
  assert.equal(result.children[0].role, 'CRITIC');
  assert.equal(result.children[0].state, 'BLOCKED');
  assert.deepEqual(f.provider.read(), before);
});

test('physical process crash after provider COMMIT reconciles immutable batch without another child', async t => {
  const f = await fixture(t); await f.runtime.close();
  const script = fileURLToPath(new URL('./fixtures/autonomous-project-crash-child.mjs', import.meta.url));
  const child = spawn(process.execPath, [script, f.journalPath, f.providerPath, projectId, JSON.stringify(rootTask())], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = ''; child.stderr.on('data', bytes => { errors += bytes; }); child.stdout.resume();
  const code = await new Promise(resolve => child.once('close', resolve));
  assert.equal(code, 66, errors); assert.equal(f.provider.read().tasks.length, 2);
  const restarted = new AutonomousProjectTaskRuntime({ journal: createAutonomousProjectJournal({ filePath: f.journalPath }),
    request: input => f.provider.request(input), materializeProject: async () => ({ state: 'PROVEN' }) });
  try {
    const result = await restarted.serveToolRequests({ lease: rootTask(), requests: [spawnRequest('fixture:spawn:crash')] });
    assert.equal(result[0].status, 'COMPLETED'); assert.equal(f.provider.read().tasks.length, 2);
    assert.equal(f.provider.read().entries.length, 1);
  } finally { await restarted.close(); }
});

test('malformed proposals, stale parent claims and owner stop prevent child admission', async t => {
  const f = await fixture(t);
  await assert.rejects(f.runtime.serveToolRequests({ lease: rootTask(), requests: [{ ...spawnRequest(), payload: { children: [{ role: 'CODER', objective: 'Task', claim_id: 999 }] } }] }), /proposal_invalid/);
  await assert.rejects(f.runtime.serveToolRequests({ lease: { ...rootTask(), claim_id: 999 }, requests: [spawnRequest()] }), /claim_drift/);
  f.provider.update(state => { state.policy.owner_stop = true; });
  await assert.rejects(f.runtime.serveToolRequests({ lease: rootTask(), requests: [spawnRequest()] }), /owner_stopped/);
  assert.equal(f.provider.read().tasks.length, 1);
});

test('same task continuation journals one send and a crash before receipt never blindly resends', async t => {
  const f = await fixture(t); await f.runtime.prepareLease(rootTask());
  let sends = 0; const results = [{ request_id: 'fixture:tool:done', status: 'COMPLETED', summary: 'verified tool readback' }];
  const send = async () => { sends++; return { effect_state: 'PROVEN_COMPOSER_CLEARED' }; };
  const observedBoundary = { observeTranscriptFloor: async () => 1200 };
  const delivered = await f.runtime.continueConversation(rootTask(), results, send, observedBoundary);
  assert.equal(delivered.state, 'DELIVERED'); assert.equal(delivered.transcript_floor, 1200);
  assert.equal((await f.runtime.continueConversation(rootTask(), results, send)).state, 'ALREADY_DELIVERED');
  assert.equal((await f.runtime.latestTurnForLease(rootTask())).transcript_floor, 1200);
  assert.equal(sends, 1);
  const ambiguousResults = [{ ...results[0], request_id: 'fixture:tool:ambiguous' }];
  await assert.rejects(f.runtime.continueConversation(rootTask(), ambiguousResults, async () => { sends++; throw new Error('fixture_process_loss_after_send'); }, observedBoundary), /fixture_process_loss/);
  assert.equal((await f.runtime.continueConversation(rootTask(), ambiguousResults, send)).state, 'AMBIGUOUS');
  assert.equal((await f.runtime.latestTurnForLease(rootTask())).state, 'AMBIGUOUS');
  assert.equal(sends, 2);
});

test('confirmed continuation transcript boundary survives journal restart and is scoped to its exact lease', async t => {
  const f = await fixture(t); await f.runtime.prepareLease(rootTask());
  const originalContext = f.runtime.contextForLease(rootTask());
  await assert.rejects(f.runtime.continueConversation(rootTask(), [{ request_id: 'fixture:boundary:missing' }], async () => {
    assert.fail('boundaryless turn must never send');
  }), /continuation_boundary_required/);
  const results = [{ request_id: 'fixture:boundary:done', status: 'COMPLETED', summary: 'observed result' }];
  let originalPrompt;
  await f.runtime.continueConversation(rootTask(), results, async prompt => {
    originalPrompt = prompt; return { effect_state: 'PROVEN_COMPOSER_CLEARED' };
  },
    { observeTranscriptFloor: async () => 4096 });
  const originalTurn = await f.journal.latestConversationTurn(rootTask());
  await f.runtime.close();
  let materialized = 0;
  const restartedJournal = createAutonomousProjectJournal({ filePath: f.journalPath });
  const restarted = new AutonomousProjectTaskRuntime({ journal: restartedJournal,
    request: input => f.provider.request(input), materializeProject: async () => { materialized++; return { state: 'PROVEN' }; } });
  try {
    assert.equal((await restarted.latestTurnForLease(rootTask())).transcript_floor, 4096);
    assert.equal(await restarted.latestTurnForLease({ ...rootTask(), lease_generation: 2 }), null);
    const replay = await restarted.continueConversation(rootTask(), results, async () => { assert.fail('confirmed send must not be repeated'); });
    assert.equal(replay.state, 'ALREADY_DELIVERED'); assert.equal(replay.transcript_floor, 4096);
    assert.equal(restarted.contextForLease(rootTask()), originalContext);
    assert.ok(originalPrompt.includes(originalContext));
    assert.deepEqual(await restartedJournal.latestConversationTurn(rootTask()), originalTurn);
    assert.equal(materialized, 0);

    // A changed authoritative project identity cannot reuse the old receipt.
    f.provider.update(state => { state.root_task_id = '33333333-3333-4333-8333-333333333333'; });
    await assert.rejects(restarted.continueConversation(rootTask(), results, async () => {
      assert.fail('changed project context must never resend a confirmed turn');
    }), /continuation_binding_drift/);
    assert.deepEqual(await restartedJournal.latestConversationTurn(rootTask()), originalTurn);
  } finally { await restarted.close(); }
});

test('unfinished continuation recovers its context after restart and never repeats the uncertain send', async t => {
  const f = await fixture(t); await f.runtime.prepareLease(rootTask());
  const originalContext = f.runtime.contextForLease(rootTask());
  const results = [{ request_id: 'fixture:boundary:uncertain', status: 'COMPLETED', summary: 'observed result' }];
  let sends = 0;
  await assert.rejects(f.runtime.continueConversation(rootTask(), results, async () => {
    sends++; throw new Error('fixture_process_loss_after_send');
  }, { observeTranscriptFloor: async () => 2048 }), /fixture_process_loss_after_send/);
  const originalTurn = await f.journal.latestConversationTurn(rootTask());
  await f.runtime.close();
  const restartedJournal = createAutonomousProjectJournal({ filePath: f.journalPath });
  const restarted = new AutonomousProjectTaskRuntime({ journal: restartedJournal,
    request: input => f.provider.request(input), materializeProject: async () => { assert.fail('recovery must not rematerialize the worktree'); } });
  try {
    const replay = await restarted.continueConversation(rootTask(), results, async () => { sends++; assert.fail('uncertain send must not be repeated'); });
    assert.equal(replay.state, 'AMBIGUOUS');
    assert.equal(replay.physical_effect_replayed, false);
    assert.equal(restarted.contextForLease(rootTask()), originalContext);
    assert.equal((await restarted.latestTurnForLease(rootTask())).state, 'AMBIGUOUS');
    assert.deepEqual(await restartedJournal.latestConversationTurn(rootTask()), originalTurn);
    assert.equal(sends, 1);
  } finally { await restarted.close(); }
});

test('current project context is recovered after runtime restart without rematerializing a running worktree', async t => {
  const f = await fixture(t); await f.runtime.prepareLease(rootTask()); await f.runtime.close();
  let materialized = 0;
  const restarted = new AutonomousProjectTaskRuntime({ journal: createAutonomousProjectJournal({ filePath: f.journalPath }),
    request: input => f.provider.request(input), materializeProject: async () => { materialized++; return { state: 'PROVEN' }; } });
  try {
    await restarted.refreshContext(rootTask());
    assert.match(restarted.contextForLease(rootTask()), /PROJECT CONTINUITY V1/);
    assert.equal(materialized, 0);
  } finally { await restarted.close(); }
});

test('foreign SQLite schema is refused before changing its mode or bytes', async t => {
  const f = await fixture(t); const foreign = path.join(f.root, 'foreign.sqlite');
  const db = new DatabaseSync(foreign); db.exec('CREATE TABLE foreign_table(value TEXT)'); db.close();
  const before = await fs.readFile(foreign);
  assert.throws(() => createAutonomousProjectJournal({ filePath: foreign }), /schema_invalid/);
  assert.deepEqual(await fs.readFile(foreign), before);
});
